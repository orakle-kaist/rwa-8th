// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {IntentVerifier} from "../src/IntentVerifier.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {RestrictedEquityToken} from "../src/RestrictedEquityToken.sol";
import {SecondarySettlementController} from "../src/SecondarySettlementController.sol";
import {IntentTypes} from "../src/shared/IntentTypes.sol";
import {PolicyScopes} from "../src/shared/PolicyScopes.sol";
import {RoleIds} from "../src/shared/RoleIds.sol";
import {MockUsdc} from "../src/test/MockUsdc.sol";
import {TestBase} from "./TestBase.sol";

contract SecondarySettlementControllerTest is TestBase {
    bytes32 private constant POLICY = keccak256("LOCAL-POLICY-V1");
    uint256 private constant INVESTOR_KEY = 0xA11CE;
    uint256 private constant MARKET_MAKER_KEY = 0xBEEF;
    uint256 private constant BROKER_KEY = 0xB0B;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SECONDARY_TYPEHASH = keccak256(
        "SecondaryOrderIntent(bytes16 orderId,bytes16 quoteId,address investor,address token,string investorSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "MarketMakerQuote(bytes16 quoteId,address marketMaker,address token,string marketMakerSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 unitPriceMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant APPROVAL_TYPEHASH = keccak256(
        "BrokerSettlementApproval(bytes16 approvalId,bytes16 orderId,address investor,address marketMaker,address token,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,bytes32 rightsEvidenceHash,bytes32 fundsEvidenceHash,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );

    EligibilityRegistry private eligibility;
    MarketPolicyRegistry private policy;
    IntentVerifier private verifier;
    RestrictedEquityToken private token;
    SecondarySettlementController private controller;
    MockUsdc private usdc;
    address private investor;
    address private marketMaker;
    address private broker;
    uint256 private sequence;

    function setUp() public {
        vm.warp(1_800_000_000);
        investor = vm.addr(INVESTOR_KEY);
        marketMaker = vm.addr(MARKET_MAKER_KEY);
        broker = vm.addr(BROKER_KEY);
        eligibility = new EligibilityRegistry(address(this));
        policy = new MarketPolicyRegistry(address(this), POLICY);
        verifier = new IntentVerifier(address(this), policy);
        token = new RestrictedEquityToken("Synthetic Hynix Rights", "SIM990002", address(this), eligibility, policy);
        controller = new SecondarySettlementController(address(this), verifier, eligibility, policy);
        usdc = new MockUsdc();

        eligibility.grantRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE, address(this));
        token.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE, address(controller));
        verifier.grantRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE, address(controller));
        controller.grantRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE, address(this));
        verifier.setBrokerSettlementSigner(_workflow(), broker, _evidence());
        _eligible(investor);
        _eligible(marketMaker);
        eligibility.setMarketMaker(_workflow(), marketMaker, true, block.timestamp + 30 days, _evidence());

        token.mintPending(_workflow(), marketMaker, 120, _evidence());
        token.releasePending(_workflow(), marketMaker, 100, _evidence());
        usdc.mint(investor, 10_000 * 1e6);
        vm.prank(investor);
        usdc.approve(address(controller), type(uint256).max);
    }

    function test_UsdcDvpPartiallyFillsOnceAndPreservesPendingInventory() public {
        (IntentTypes.SecondaryOrderIntent memory order, IntentTypes.MarketMakerQuote memory quote) =
            _orderAndQuote("USDC_ONCHAIN", _assetId(address(usdc)), 8, 5, 1_203_550_000);
        IntentTypes.BrokerSettlementApproval memory approval = _approval(order, quote, 5, 6_017_750_000);

        controller.settleUsdc(
            order.orderId,
            order,
            _sign(INVESTOR_KEY, _typedDigest(_hashSecondary(order))),
            quote,
            _sign(MARKET_MAKER_KEY, _typedDigest(_hashQuote(quote))),
            approval,
            _sign(BROKER_KEY, _typedDigest(_hashApproval(approval))),
            5,
            6_017_750_000
        );

        assertEq(token.availableBalanceOf(investor), 5);
        assertEq(token.availableBalanceOf(marketMaker), 95);
        assertEq(token.pendingSettlementBalanceOf(marketMaker), 20);
        assertEq(usdc.balanceOf(marketMaker), 6_017_750_000);
        assertEq(token.totalSupply(), 120);

        vm.expectRevert();
        controller.settleUsdc(
            order.orderId,
            order,
            _sign(INVESTOR_KEY, _typedDigest(_hashSecondary(order))),
            quote,
            _sign(MARKET_MAKER_KEY, _typedDigest(_hashQuote(quote))),
            approval,
            _sign(BROKER_KEY, _typedDigest(_hashApproval(approval))),
            5,
            6_017_750_000
        );
    }

    function test_UsdLedgerMovesOnlyTradableRightsToken() public {
        (IntentTypes.SecondaryOrderIntent memory order, IntentTypes.MarketMakerQuote memory quote) =
            _orderAndQuote("USD_LEDGER", keccak256("USD_LEDGER"), 5, 5, 120_355);
        IntentTypes.BrokerSettlementApproval memory approval = _approval(order, quote, 5, 601_775);
        controller.settleUsdLedger(
            order.orderId,
            order,
            _sign(INVESTOR_KEY, _typedDigest(_hashSecondary(order))),
            quote,
            _sign(MARKET_MAKER_KEY, _typedDigest(_hashQuote(quote))),
            approval,
            _sign(BROKER_KEY, _typedDigest(_hashApproval(approval))),
            5,
            601_775
        );
        assertEq(token.availableBalanceOf(investor), 5);
        assertEq(token.pendingSettlementBalanceOf(marketMaker), 20);
    }

    function test_DvpFailureRevertsBothAssets() public {
        (IntentTypes.SecondaryOrderIntent memory order, IntentTypes.MarketMakerQuote memory quote) =
            _orderAndQuote("USDC_ONCHAIN", _assetId(address(usdc)), 8, 5, 1_203_550_000);
        IntentTypes.BrokerSettlementApproval memory approval = _approval(order, quote, 5, 6_017_750_000);
        vm.prank(investor);
        usdc.approve(address(controller), 0);
        vm.expectRevert();
        controller.settleUsdc(
            order.orderId,
            order,
            _sign(INVESTOR_KEY, _typedDigest(_hashSecondary(order))),
            quote,
            _sign(MARKET_MAKER_KEY, _typedDigest(_hashQuote(quote))),
            approval,
            _sign(BROKER_KEY, _typedDigest(_hashApproval(approval))),
            5,
            6_017_750_000
        );
        assertEq(token.availableBalanceOf(investor), 0);
        assertEq(token.availableBalanceOf(marketMaker), 100);
        assertEq(usdc.balanceOf(marketMaker), 0);
    }

    function test_PausedUsdcPathAndPendingOnlyInventoryAreRejected() public {
        policy.pauseScope(_workflow(), address(token), PolicyScopes.USDC_PATH, keccak256("depeg"), _evidence());
        (IntentTypes.SecondaryOrderIntent memory order, IntentTypes.MarketMakerQuote memory quote) =
            _orderAndQuote("USDC_ONCHAIN", _assetId(address(usdc)), 8, 5, 1_203_550_000);
        IntentTypes.BrokerSettlementApproval memory approval = _approval(order, quote, 5, 6_017_750_000);
        vm.expectRevert();
        controller.settleUsdc(
            order.orderId,
            order,
            _sign(INVESTOR_KEY, _typedDigest(_hashSecondary(order))),
            quote,
            _sign(MARKET_MAKER_KEY, _typedDigest(_hashQuote(quote))),
            approval,
            _sign(BROKER_KEY, _typedDigest(_hashApproval(approval))),
            5,
            6_017_750_000
        );
        assertEq(token.availableBalanceOf(marketMaker), 100);
        assertEq(token.pendingSettlementBalanceOf(marketMaker), 20);
    }

    function _orderAndQuote(
        string memory mode,
        bytes32 assetId,
        uint256 orderQuantity,
        uint256 quoteQuantity,
        uint256 unitPrice
    ) private view returns (IntentTypes.SecondaryOrderIntent memory order, IntentTypes.MarketMakerQuote memory quote) {
        bytes16 orderId = bytes16(uint128(1));
        bytes16 quoteId = bytes16(uint128(2));
        order = IntentTypes.SecondaryOrderIntent({
            orderId: orderId,
            quoteId: quoteId,
            investor: investor,
            token: address(token),
            investorSide: "BUY",
            paymentMode: mode,
            paymentAssetId: assetId,
            shareQuantity: orderQuantity,
            paymentAmountMinor: unitPrice * orderQuantity,
            nonce: 101,
            expiresAt: block.timestamp + 30,
            policyVersion: POLICY
        });
        quote = IntentTypes.MarketMakerQuote({
            quoteId: quoteId,
            marketMaker: marketMaker,
            token: address(token),
            marketMakerSide: "SELL",
            paymentMode: mode,
            paymentAssetId: assetId,
            shareQuantity: quoteQuantity,
            unitPriceMinor: unitPrice,
            nonce: 102,
            expiresAt: block.timestamp + 30,
            policyVersion: POLICY
        });
    }

    function _approval(
        IntentTypes.SecondaryOrderIntent memory order,
        IntentTypes.MarketMakerQuote memory quote,
        uint256 quantity,
        uint256 amount
    ) private view returns (IntentTypes.BrokerSettlementApproval memory) {
        return IntentTypes.BrokerSettlementApproval({
            approvalId: bytes16(uint128(3)),
            orderId: order.orderId,
            investor: investor,
            marketMaker: marketMaker,
            token: address(token),
            paymentMode: order.paymentMode,
            paymentAssetId: order.paymentAssetId,
            shareQuantity: quantity,
            paymentAmountMinor: amount,
            rightsEvidenceHash: keccak256("rights-ledger-reservation"),
            fundsEvidenceHash: keccak256("funds-reservation"),
            nonce: 103,
            expiresAt: quote.expiresAt,
            policyVersion: POLICY
        });
    }

    function _typedDigest(bytes32 structHash) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("Korean Equity RWA Intent"), keccak256("1"), block.chainid, address(verifier)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _hashSecondary(IntentTypes.SecondaryOrderIntent memory value) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SECONDARY_TYPEHASH,
                value.orderId,
                value.quoteId,
                value.investor,
                value.token,
                keccak256(bytes(value.investorSide)),
                keccak256(bytes(value.paymentMode)),
                value.paymentAssetId,
                value.shareQuantity,
                value.paymentAmountMinor,
                value.nonce,
                value.expiresAt,
                value.policyVersion
            )
        );
    }

    function _hashQuote(IntentTypes.MarketMakerQuote memory value) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                value.quoteId,
                value.marketMaker,
                value.token,
                keccak256(bytes(value.marketMakerSide)),
                keccak256(bytes(value.paymentMode)),
                value.paymentAssetId,
                value.shareQuantity,
                value.unitPriceMinor,
                value.nonce,
                value.expiresAt,
                value.policyVersion
            )
        );
    }

    function _hashApproval(IntentTypes.BrokerSettlementApproval memory value) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                APPROVAL_TYPEHASH,
                value.approvalId,
                value.orderId,
                value.investor,
                value.marketMaker,
                value.token,
                keccak256(bytes(value.paymentMode)),
                value.paymentAssetId,
                value.shareQuantity,
                value.paymentAmountMinor,
                value.rightsEvidenceHash,
                value.fundsEvidenceHash,
                value.nonce,
                value.expiresAt,
                value.policyVersion
            )
        );
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _eligible(address account) private {
        eligibility.setEligibility(_workflow(), account, true, block.timestamp + 30 days, _evidence());
    }

    function _assetId(address asset) private pure returns (bytes32) {
        return bytes32(uint256(uint160(asset)));
    }

    function _workflow() private returns (bytes16) {
        sequence += 1;
        return bytes16(uint128(sequence));
    }

    function _evidence() private returns (bytes32) {
        sequence += 1;
        return keccak256(abi.encode("secondary-test", sequence));
    }
}
