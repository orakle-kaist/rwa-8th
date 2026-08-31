// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IMarketPolicyRegistry} from "./interfaces/IMarketPolicyRegistry.sol";
import {NonceAlreadyUsed, PaymentMismatch, PolicyVersionMismatch, SignatureExpired} from "./shared/Errors.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {IntentTypes} from "./shared/IntentTypes.sol";
import {RoleIds} from "./shared/RoleIds.sol";

contract IntentVerifier is AccessControl, EIP712, EvidenceGuard {
    bytes32 private constant PRIMARY_ORDER_TYPEHASH = keccak256(
        "PrimaryOrderIntent(bytes16 orderId,address investor,string securityId,uint256 shareQuantity,uint256 krwLimitPrice,string targetTradingDate,string fundingMode,uint256 fundingAmountMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant SECONDARY_ORDER_TYPEHASH = keccak256(
        "SecondaryOrderIntent(bytes16 orderId,bytes16 quoteId,address investor,address token,string investorSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant REDEMPTION_TYPEHASH = keccak256(
        "RedemptionIntent(bytes16 redemptionId,address investor,address token,uint256 shareQuantity,uint256 krwLimitPrice,string targetTradingDate,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant MARKET_MAKER_QUOTE_TYPEHASH = keccak256(
        "MarketMakerQuote(bytes16 quoteId,address marketMaker,address token,string marketMakerSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 unitPriceMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant BROKER_APPROVAL_TYPEHASH = keccak256(
        "BrokerSettlementApproval(bytes16 approvalId,bytes16 orderId,address investor,address marketMaker,address token,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,bytes32 rightsEvidenceHash,bytes32 fundsEvidenceHash,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant BUY = keccak256("BUY");
    bytes32 private constant SELL = keccak256("SELL");

    IMarketPolicyRegistry private immutable _policyRegistry;
    mapping(address signer => mapping(uint256 nonce => bool used)) private _usedNonces;
    address private _brokerSettlementSigner;

    event IntentConsumed(address indexed signer, uint256 indexed nonce, bytes32 indexed digest);
    event NonceCancelled(address indexed signer, uint256 indexed nonce);

    event BrokerSettlementSignerChanged(
        bytes16 indexed workflowId, address indexed previousSigner, address indexed newSigner, bytes32 evidenceHash
    );

    constructor(address administrator, IMarketPolicyRegistry policyRegistry) EIP712("Korean Equity RWA Intent", "1") {
        require(administrator != address(0), "administrator is zero");
        require(address(policyRegistry) != address(0), "policy registry is zero");
        _policyRegistry = policyRegistry;
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function verifyAndConsumePrimaryOrder(IntentTypes.PrimaryOrderIntent calldata intent, bytes calldata signature)
        external
        onlyRole(RoleIds.ISSUANCE_EXECUTOR_ROLE)
        returns (bytes32 digest)
    {
        require(intent.orderId != bytes16(0), "order is zero");
        require(intent.investor != address(0), "investor is zero");
        require(intent.shareQuantity != 0, "quantity is zero");
        _validatePolicyAndExpiry(intent.policyVersion, intent.expiresAt);
        digest = _hashTypedDataV4(_hashPrimary(intent));
        _verifyUnusedSignature(intent.investor, intent.nonce, digest, signature);
        _consumeNonce(intent.investor, intent.nonce, digest);
    }

    function verifyAndConsumeSecondaryBundle(
        IntentTypes.SecondaryOrderIntent calldata investorIntent,
        bytes calldata investorSignature,
        IntentTypes.MarketMakerQuote calldata quote,
        bytes calldata marketMakerSignature,
        IntentTypes.BrokerSettlementApproval calldata approval,
        bytes calldata brokerSignature,
        uint256 fillQuantity,
        uint256 paymentAmountMinor
    ) external onlyRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE) returns (bytes32 bundleDigest) {
        _validateSecondaryBundle(investorIntent, quote, approval, fillQuantity, paymentAmountMinor);
        bytes32 investorDigest = _hashTypedDataV4(_hashSecondary(investorIntent));
        bytes32 quoteDigest = _hashTypedDataV4(_hashQuote(quote));
        bytes32 approvalDigest = _hashTypedDataV4(_hashApproval(approval));
        address brokerSigner = _brokerSettlementSigner;
        require(brokerSigner != address(0), "broker signer is not configured");

        _verifyUnusedSignature(investorIntent.investor, investorIntent.nonce, investorDigest, investorSignature);
        _verifyUnusedSignature(quote.marketMaker, quote.nonce, quoteDigest, marketMakerSignature);
        _verifyUnusedSignature(brokerSigner, approval.nonce, approvalDigest, brokerSignature);

        _consumeNonce(investorIntent.investor, investorIntent.nonce, investorDigest);
        _consumeNonce(quote.marketMaker, quote.nonce, quoteDigest);
        _consumeNonce(brokerSigner, approval.nonce, approvalDigest);
        bundleDigest =
            keccak256(abi.encode(investorDigest, quoteDigest, approvalDigest, fillQuantity, paymentAmountMinor));
    }

    function verifyAndConsumeRedemption(IntentTypes.RedemptionIntent calldata intent, bytes calldata signature)
        external
        onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE)
        returns (bytes32 digest)
    {
        require(intent.redemptionId != bytes16(0), "redemption is zero");
        require(intent.investor != address(0), "investor is zero");
        require(intent.token != address(0), "token is zero");
        require(intent.shareQuantity != 0, "quantity is zero");
        _validatePolicyAndExpiry(intent.policyVersion, intent.expiresAt);
        digest = _hashTypedDataV4(_hashRedemption(intent));
        _verifyUnusedSignature(intent.investor, intent.nonce, digest, signature);
        _consumeNonce(intent.investor, intent.nonce, digest);
    }

    function cancelNonce(uint256 nonce) external {
        if (_usedNonces[msg.sender][nonce]) revert NonceAlreadyUsed(msg.sender, nonce);
        _usedNonces[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }

    function setBrokerSettlementSigner(bytes16 workflowId, address newSigner, bytes32 evidenceHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(workflowId != bytes16(0), "workflow is zero");
        require(newSigner != address(0), "broker signer is zero");
        _consumeEvidence(evidenceHash);
        address previousSigner = _brokerSettlementSigner;
        _brokerSettlementSigner = newSigner;
        emit BrokerSettlementSignerChanged(workflowId, previousSigner, newSigner, evidenceHash);
    }

    function brokerSettlementSigner() external view returns (address) {
        return _brokerSettlementSigner;
    }

    function _validateSecondaryBundle(
        IntentTypes.SecondaryOrderIntent calldata investorIntent,
        IntentTypes.MarketMakerQuote calldata quote,
        IntentTypes.BrokerSettlementApproval calldata approval,
        uint256 fillQuantity,
        uint256 paymentAmountMinor
    ) private view {
        require(fillQuantity != 0, "fill quantity is zero");
        require(investorIntent.orderId == approval.orderId, "order mismatch");
        require(investorIntent.quoteId == quote.quoteId, "quote mismatch");
        require(investorIntent.investor == approval.investor, "investor mismatch");
        require(quote.marketMaker == approval.marketMaker, "market maker mismatch");
        require(investorIntent.token == quote.token && quote.token == approval.token, "token mismatch");
        require(
            _stringHash(investorIntent.paymentMode) == _stringHash(quote.paymentMode)
                && _stringHash(quote.paymentMode) == _stringHash(approval.paymentMode),
            "payment mode mismatch"
        );
        require(
            investorIntent.paymentAssetId == quote.paymentAssetId && quote.paymentAssetId == approval.paymentAssetId,
            "payment asset mismatch"
        );
        require(
            investorIntent.policyVersion == quote.policyVersion && quote.policyVersion == approval.policyVersion,
            "bundle policy mismatch"
        );
        _validatePolicyAndExpiry(investorIntent.policyVersion, investorIntent.expiresAt);
        _validatePolicyAndExpiry(quote.policyVersion, quote.expiresAt);
        _validatePolicyAndExpiry(approval.policyVersion, approval.expiresAt);
        require(fillQuantity <= investorIntent.shareQuantity, "investor quantity exceeded");
        require(fillQuantity <= quote.shareQuantity, "quote quantity exceeded");
        require(approval.shareQuantity == fillQuantity, "approval quantity mismatch");
        if (approval.paymentAmountMinor != paymentAmountMinor) {
            revert PaymentMismatch(approval.paymentAmountMinor, paymentAmountMinor);
        }
        uint256 quotedPayment = quote.unitPriceMinor * fillQuantity;
        if (quotedPayment != paymentAmountMinor) {
            revert PaymentMismatch(quotedPayment, paymentAmountMinor);
        }

        bytes32 investorSide = _stringHash(investorIntent.investorSide);
        bytes32 marketMakerSide = _stringHash(quote.marketMakerSide);
        require(
            (investorSide == BUY && marketMakerSide == SELL) || (investorSide == SELL && marketMakerSide == BUY),
            "trade sides are not opposite"
        );
        uint256 approvedProRata = investorIntent.paymentAmountMinor * fillQuantity;
        uint256 actualProRata = paymentAmountMinor * investorIntent.shareQuantity;
        if (investorSide == BUY && actualProRata > approvedProRata) {
            revert PaymentMismatch(investorIntent.paymentAmountMinor, paymentAmountMinor);
        }
        if (investorSide == SELL && actualProRata < approvedProRata) {
            revert PaymentMismatch(investorIntent.paymentAmountMinor, paymentAmountMinor);
        }
    }

    function _validatePolicyAndExpiry(bytes32 providedPolicyVersion, uint256 expiresAt) private view {
        if (expiresAt <= block.timestamp) revert SignatureExpired(expiresAt, block.timestamp);
        bytes32 currentPolicyVersion = _policyRegistry.policyVersion();
        if (providedPolicyVersion != currentPolicyVersion) {
            revert PolicyVersionMismatch(providedPolicyVersion, currentPolicyVersion);
        }
    }

    function _verifyUnusedSignature(address signer, uint256 nonce, bytes32 digest, bytes calldata signature)
        private
        view
    {
        if (_usedNonces[signer][nonce]) revert NonceAlreadyUsed(signer, nonce);
        require(SignatureChecker.isValidSignatureNow(signer, digest, signature), "invalid signature");
    }

    function _consumeNonce(address signer, uint256 nonce, bytes32 digest) private {
        _usedNonces[signer][nonce] = true;
        emit IntentConsumed(signer, nonce, digest);
    }

    function _hashPrimary(IntentTypes.PrimaryOrderIntent calldata intent) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PRIMARY_ORDER_TYPEHASH,
                intent.orderId,
                intent.investor,
                _stringHash(intent.securityId),
                intent.shareQuantity,
                intent.krwLimitPrice,
                _stringHash(intent.targetTradingDate),
                _stringHash(intent.fundingMode),
                intent.fundingAmountMinor,
                intent.nonce,
                intent.expiresAt,
                intent.policyVersion
            )
        );
    }

    function _hashSecondary(IntentTypes.SecondaryOrderIntent calldata intent) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SECONDARY_ORDER_TYPEHASH,
                intent.orderId,
                intent.quoteId,
                intent.investor,
                intent.token,
                _stringHash(intent.investorSide),
                _stringHash(intent.paymentMode),
                intent.paymentAssetId,
                intent.shareQuantity,
                intent.paymentAmountMinor,
                intent.nonce,
                intent.expiresAt,
                intent.policyVersion
            )
        );
    }

    function _hashRedemption(IntentTypes.RedemptionIntent calldata intent) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                REDEMPTION_TYPEHASH,
                intent.redemptionId,
                intent.investor,
                intent.token,
                intent.shareQuantity,
                intent.krwLimitPrice,
                _stringHash(intent.targetTradingDate),
                intent.nonce,
                intent.expiresAt,
                intent.policyVersion
            )
        );
    }

    function _hashQuote(IntentTypes.MarketMakerQuote calldata quote) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MARKET_MAKER_QUOTE_TYPEHASH,
                quote.quoteId,
                quote.marketMaker,
                quote.token,
                _stringHash(quote.marketMakerSide),
                _stringHash(quote.paymentMode),
                quote.paymentAssetId,
                quote.shareQuantity,
                quote.unitPriceMinor,
                quote.nonce,
                quote.expiresAt,
                quote.policyVersion
            )
        );
    }

    function _hashApproval(IntentTypes.BrokerSettlementApproval calldata approval) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BROKER_APPROVAL_TYPEHASH,
                approval.approvalId,
                approval.orderId,
                approval.investor,
                approval.marketMaker,
                approval.token,
                _stringHash(approval.paymentMode),
                approval.paymentAssetId,
                approval.shareQuantity,
                approval.paymentAmountMinor,
                approval.rightsEvidenceHash,
                approval.fundsEvidenceHash,
                approval.nonce,
                approval.expiresAt,
                approval.policyVersion
            )
        );
    }

    function _stringHash(string calldata value) private pure returns (bytes32) {
        return keccak256(bytes(value));
    }
}
