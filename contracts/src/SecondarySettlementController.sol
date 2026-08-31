// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {EligibilityRegistry} from "./EligibilityRegistry.sol";
import {IntentVerifier} from "./IntentVerifier.sol";
import {RestrictedEquityToken} from "./RestrictedEquityToken.sol";
import {IMarketPolicyRegistry} from "./interfaces/IMarketPolicyRegistry.sol";
import {PaymentMismatch, ScopePaused} from "./shared/Errors.sol";
import {IntentTypes} from "./shared/IntentTypes.sol";
import {PolicyScopes} from "./shared/PolicyScopes.sol";
import {RoleIds} from "./shared/RoleIds.sol";

/// @notice Executes the chain leg of an approved investor-to-market-maker settlement.
/// @dev The broker's customer rights ledger remains the business record. These events
///      prove chain execution only and must not be treated as business completion.
contract SecondarySettlementController is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 private constant USD_LEDGER_ASSET_ID = keccak256("USD_LEDGER");
    bytes32 private constant USD_LEDGER_MODE = keccak256("USD_LEDGER");
    bytes32 private constant USDC_ONCHAIN_MODE = keccak256("USDC_ONCHAIN");
    bytes32 private constant BUY = keccak256("BUY");

    IntentVerifier private immutable _intentVerifier;
    EligibilityRegistry private immutable _eligibilityRegistry;
    IMarketPolicyRegistry private immutable _policyRegistry;

    event UsdLedgerSettlementRecorded(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        address marketMaker,
        uint256 quantity,
        uint256 paymentAmountMinor
    );
    event UsdcDvpSettled(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        address marketMaker,
        uint256 quantity,
        uint256 paymentAmountMinor,
        address paymentAsset
    );

    constructor(
        address administrator,
        IntentVerifier intentVerifier,
        EligibilityRegistry eligibilityRegistry,
        IMarketPolicyRegistry policyRegistry
    ) {
        require(administrator != address(0), "administrator is zero");
        require(address(intentVerifier) != address(0), "intent verifier is zero");
        require(address(eligibilityRegistry) != address(0), "eligibility registry is zero");
        require(address(policyRegistry) != address(0), "policy registry is zero");
        _intentVerifier = intentVerifier;
        _eligibilityRegistry = eligibilityRegistry;
        _policyRegistry = policyRegistry;
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function settleUsdLedger(
        bytes16 workflowId,
        IntentTypes.SecondaryOrderIntent calldata investorIntent,
        bytes calldata investorSignature,
        IntentTypes.MarketMakerQuote calldata quote,
        bytes calldata marketMakerSignature,
        IntentTypes.BrokerSettlementApproval calldata approval,
        bytes calldata brokerSignature,
        uint256 fillQuantity,
        uint256 paymentAmountMinor
    ) external onlyRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE) {
        _requireWorkflow(workflowId);
        _requireMode(investorIntent.paymentMode, USD_LEDGER_MODE);
        if (investorIntent.paymentAssetId != USD_LEDGER_ASSET_ID) {
            revert PaymentMismatch(uint256(USD_LEDGER_ASSET_ID), uint256(investorIntent.paymentAssetId));
        }
        _verifyAndTransfer(
            workflowId,
            investorIntent,
            investorSignature,
            quote,
            marketMakerSignature,
            approval,
            brokerSignature,
            fillQuantity,
            paymentAmountMinor
        );
        emit UsdLedgerSettlementRecorded(
            workflowId,
            investorIntent.token,
            investorIntent.investor,
            quote.marketMaker,
            fillQuantity,
            paymentAmountMinor
        );
    }

    function settleUsdc(
        bytes16 workflowId,
        IntentTypes.SecondaryOrderIntent calldata investorIntent,
        bytes calldata investorSignature,
        IntentTypes.MarketMakerQuote calldata quote,
        bytes calldata marketMakerSignature,
        IntentTypes.BrokerSettlementApproval calldata approval,
        bytes calldata brokerSignature,
        uint256 fillQuantity,
        uint256 paymentAmountMinor
    ) external onlyRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE) {
        _requireWorkflow(workflowId);
        _requireMode(investorIntent.paymentMode, USDC_ONCHAIN_MODE);
        address paymentAsset = address(uint160(uint256(investorIntent.paymentAssetId)));
        require(paymentAsset != address(0), "payment asset is zero");
        if (_policyRegistry.isScopePaused(investorIntent.token, PolicyScopes.USDC_PATH)) {
            revert ScopePaused(investorIntent.token, PolicyScopes.USDC_PATH);
        }

        bool investorBuys = keccak256(bytes(investorIntent.investorSide)) == BUY;
        address payer = investorBuys ? investorIntent.investor : quote.marketMaker;
        address receiver = investorBuys ? quote.marketMaker : investorIntent.investor;

        // The restricted token transfer and payment transfer share one EVM transaction.
        // Any failure reverts both legs.
        _verifyAndTransfer(
            workflowId,
            investorIntent,
            investorSignature,
            quote,
            marketMakerSignature,
            approval,
            brokerSignature,
            fillQuantity,
            paymentAmountMinor
        );
        IERC20(paymentAsset).safeTransferFrom(payer, receiver, paymentAmountMinor);
        emit UsdcDvpSettled(
            workflowId,
            investorIntent.token,
            investorIntent.investor,
            quote.marketMaker,
            fillQuantity,
            paymentAmountMinor,
            paymentAsset
        );
    }

    function _verifyAndTransfer(
        bytes16 workflowId,
        IntentTypes.SecondaryOrderIntent calldata investorIntent,
        bytes calldata investorSignature,
        IntentTypes.MarketMakerQuote calldata quote,
        bytes calldata marketMakerSignature,
        IntentTypes.BrokerSettlementApproval calldata approval,
        bytes calldata brokerSignature,
        uint256 fillQuantity,
        uint256 paymentAmountMinor
    ) private {
        require(!_eligibilityRegistry.isMarketMaker(investorIntent.investor), "investor cannot be market maker");
        require(_eligibilityRegistry.isMarketMaker(quote.marketMaker), "designated market maker required");
        _intentVerifier.verifyAndConsumeSecondaryBundle(
            investorIntent,
            investorSignature,
            quote,
            marketMakerSignature,
            approval,
            brokerSignature,
            fillQuantity,
            paymentAmountMinor
        );
        bool investorBuys = keccak256(bytes(investorIntent.investorSide)) == BUY;
        address seller = investorBuys ? quote.marketMaker : investorIntent.investor;
        address buyer = investorBuys ? investorIntent.investor : quote.marketMaker;
        bytes32 evidenceHash = keccak256(
            abi.encode(
                workflowId, approval.rightsEvidenceHash, approval.fundsEvidenceHash, fillQuantity, paymentAmountMinor
            )
        );
        RestrictedEquityToken(investorIntent.token)
            .controlledTransfer(workflowId, seller, buyer, fillQuantity, evidenceHash);
    }

    function _requireMode(string calldata provided, bytes32 expected) private pure {
        require(keccak256(bytes(provided)) == expected, "payment mode mismatch");
    }

    function _requireWorkflow(bytes16 workflowId) private pure {
        require(workflowId != bytes16(0), "workflow is zero");
    }
}
