// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IntentVerifier} from "../src/IntentVerifier.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {NonceAlreadyUsed, PolicyVersionMismatch, SignatureExpired} from "../src/shared/Errors.sol";
import {IntentTypes} from "../src/shared/IntentTypes.sol";
import {RoleIds} from "../src/shared/RoleIds.sol";
import {TestBase} from "./TestBase.sol";

contract Mock1271Wallet is IERC1271 {
    address private immutable _owner;

    constructor(address owner) {
        _owner = owner;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == _owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract IntentVerifierTest is TestBase {
    bytes32 private constant POLICY_VERSION = keccak256("policy-v1");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant PRIMARY_TYPEHASH = keccak256(
        "PrimaryOrderIntent(bytes16 orderId,address investor,string securityId,uint256 shareQuantity,uint256 krwLimitPrice,string targetTradingDate,string fundingMode,uint256 fundingAmountMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant SECONDARY_TYPEHASH = keccak256(
        "SecondaryOrderIntent(bytes16 orderId,bytes16 quoteId,address investor,address token,string investorSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "MarketMakerQuote(bytes16 quoteId,address marketMaker,address token,string marketMakerSide,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 unitPriceMinor,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );
    bytes32 private constant APPROVAL_TYPEHASH = keccak256(
        "BrokerSettlementApproval(bytes16 approvalId,bytes16 orderId,address investor,address marketMaker,address token,string paymentMode,bytes32 paymentAssetId,uint256 shareQuantity,uint256 paymentAmountMinor,bytes32 rightsEvidenceHash,bytes32 fundsEvidenceHash,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );

    uint256 private constant INVESTOR_KEY = 0xA11CE;
    uint256 private constant INVESTOR_OWNER_KEY = 0xB0B;
    uint256 private constant MARKET_MAKER_KEY = 0xC0FFEE;
    uint256 private constant BROKER_KEY = 0xB40C;

    MarketPolicyRegistry private policy;
    IntentVerifier private verifier;
    address private investor;
    address private marketMaker;
    address private broker;

    function setUp() public {
        vm.warp(1_800_000_000);
        investor = vm.addr(INVESTOR_KEY);
        marketMaker = vm.addr(MARKET_MAKER_KEY);
        broker = vm.addr(BROKER_KEY);
        policy = new MarketPolicyRegistry(address(this), POLICY_VERSION);
        verifier = new IntentVerifier(address(this), policy);
        verifier.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(this));
        verifier.grantRole(RoleIds.SETTLEMENT_EXECUTOR_ROLE, address(this));
        verifier.grantRole(RoleIds.REDEMPTION_EXECUTOR_ROLE, address(this));
        verifier.setBrokerSettlementSigner(bytes16(uint128(1)), broker, keccak256("broker-signer-evidence"));
    }

    function test_PrimaryEoaSignatureIsConsumedOnce() public {
        IntentTypes.PrimaryOrderIntent memory intent = _primaryIntent(investor, 7);
        bytes32 digest = _typedDigest(_hashPrimary(intent));
        bytes memory signature = _sign(INVESTOR_KEY, digest);

        assertEq(verifier.verifyAndConsumePrimaryOrder(intent, signature), digest);
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, investor, intent.nonce));
        verifier.verifyAndConsumePrimaryOrder(intent, signature);
    }

    function test_SecondaryBundleSupportsErc1271AndConsumesAllSigners() public {
        address owner = vm.addr(INVESTOR_OWNER_KEY);
        Mock1271Wallet contractInvestor = new Mock1271Wallet(owner);
        address token = address(0x5930);
        bytes16 orderId = bytes16(uint128(101));
        bytes16 quoteId = bytes16(uint128(102));
        IntentTypes.SecondaryOrderIntent memory order = IntentTypes.SecondaryOrderIntent({
            orderId: orderId,
            quoteId: quoteId,
            investor: address(contractInvestor),
            token: token,
            investorSide: "BUY",
            paymentMode: "USDC",
            paymentAssetId: keccak256("USDC"),
            shareQuantity: 10,
            paymentAmountMinor: 1_000,
            nonce: 11,
            expiresAt: block.timestamp + 1 hours,
            policyVersion: POLICY_VERSION
        });
        IntentTypes.MarketMakerQuote memory quote = IntentTypes.MarketMakerQuote({
            quoteId: quoteId,
            marketMaker: marketMaker,
            token: token,
            marketMakerSide: "SELL",
            paymentMode: "USDC",
            paymentAssetId: keccak256("USDC"),
            shareQuantity: 10,
            unitPriceMinor: 100,
            nonce: 12,
            expiresAt: block.timestamp + 1 hours,
            policyVersion: POLICY_VERSION
        });
        IntentTypes.BrokerSettlementApproval memory approval = IntentTypes.BrokerSettlementApproval({
            approvalId: bytes16(uint128(103)),
            orderId: orderId,
            investor: address(contractInvestor),
            marketMaker: marketMaker,
            token: token,
            paymentMode: "USDC",
            paymentAssetId: keccak256("USDC"),
            shareQuantity: 5,
            paymentAmountMinor: 500,
            rightsEvidenceHash: keccak256("rights"),
            fundsEvidenceHash: keccak256("funds"),
            nonce: 13,
            expiresAt: block.timestamp + 1 hours,
            policyVersion: POLICY_VERSION
        });

        bytes memory investorSignature = _sign(INVESTOR_OWNER_KEY, _typedDigest(_hashSecondary(order)));
        bytes memory marketMakerSignature = _sign(MARKET_MAKER_KEY, _typedDigest(_hashQuote(quote)));
        bytes memory brokerSignature = _sign(BROKER_KEY, _typedDigest(_hashApproval(approval)));

        bytes32 result = verifier.verifyAndConsumeSecondaryBundle(
            order, investorSignature, quote, marketMakerSignature, approval, brokerSignature, 5, 500
        );
        assertTrue(result != bytes32(0));

        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, address(contractInvestor), order.nonce));
        verifier.verifyAndConsumeSecondaryBundle(
            order, investorSignature, quote, marketMakerSignature, approval, brokerSignature, 5, 500
        );
    }

    function test_ExpiredAndWrongPolicySignaturesAreRejected() public {
        IntentTypes.PrimaryOrderIntent memory atExpiry = _primaryIntent(investor, 19);
        atExpiry.expiresAt = block.timestamp;
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, atExpiry.expiresAt, block.timestamp));
        verifier.verifyAndConsumePrimaryOrder(atExpiry, _sign(INVESTOR_KEY, _typedDigest(_hashPrimary(atExpiry))));

        IntentTypes.PrimaryOrderIntent memory expired = _primaryIntent(investor, 20);
        expired.expiresAt = block.timestamp - 1;
        vm.expectRevert(abi.encodeWithSelector(SignatureExpired.selector, expired.expiresAt, block.timestamp));
        verifier.verifyAndConsumePrimaryOrder(expired, _sign(INVESTOR_KEY, _typedDigest(_hashPrimary(expired))));

        IntentTypes.PrimaryOrderIntent memory wrongPolicy = _primaryIntent(investor, 21);
        wrongPolicy.policyVersion = keccak256("old-policy");
        vm.expectRevert(
            abi.encodeWithSelector(PolicyVersionMismatch.selector, wrongPolicy.policyVersion, POLICY_VERSION)
        );
        verifier.verifyAndConsumePrimaryOrder(wrongPolicy, _sign(INVESTOR_KEY, _typedDigest(_hashPrimary(wrongPolicy))));
    }

    function test_ForgedPrimarySignatureIsRejected() public {
        IntentTypes.PrimaryOrderIntent memory intent = _primaryIntent(investor, 31);
        bytes memory forged = _sign(MARKET_MAKER_KEY, _typedDigest(_hashPrimary(intent)));
        vm.expectRevert();
        verifier.verifyAndConsumePrimaryOrder(intent, forged);
    }

    function test_SignerCanCancelUnusedNonce() public {
        vm.prank(investor);
        verifier.cancelNonce(77);
        IntentTypes.PrimaryOrderIntent memory intent = _primaryIntent(investor, 77);
        vm.expectRevert(abi.encodeWithSelector(NonceAlreadyUsed.selector, investor, 77));
        verifier.verifyAndConsumePrimaryOrder(intent, _sign(INVESTOR_KEY, _typedDigest(_hashPrimary(intent))));
    }

    function _primaryIntent(address signer, uint256 nonce)
        private
        view
        returns (IntentTypes.PrimaryOrderIntent memory)
    {
        return IntentTypes.PrimaryOrderIntent({
            orderId: bytes16(uint128(nonce + 1)),
            investor: signer,
            securityId: "005930",
            shareQuantity: 5,
            krwLimitPrice: 70_000,
            targetTradingDate: "2026-09-01",
            fundingMode: "USD",
            fundingAmountMinor: 30_000,
            nonce: nonce,
            expiresAt: block.timestamp + 1 hours,
            policyVersion: POLICY_VERSION
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

    function _hashPrimary(IntentTypes.PrimaryOrderIntent memory intent) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PRIMARY_TYPEHASH,
                intent.orderId,
                intent.investor,
                keccak256(bytes(intent.securityId)),
                intent.shareQuantity,
                intent.krwLimitPrice,
                keccak256(bytes(intent.targetTradingDate)),
                keccak256(bytes(intent.fundingMode)),
                intent.fundingAmountMinor,
                intent.nonce,
                intent.expiresAt,
                intent.policyVersion
            )
        );
    }

    function _hashSecondary(IntentTypes.SecondaryOrderIntent memory intent) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SECONDARY_TYPEHASH,
                intent.orderId,
                intent.quoteId,
                intent.investor,
                intent.token,
                keccak256(bytes(intent.investorSide)),
                keccak256(bytes(intent.paymentMode)),
                intent.paymentAssetId,
                intent.shareQuantity,
                intent.paymentAmountMinor,
                intent.nonce,
                intent.expiresAt,
                intent.policyVersion
            )
        );
    }

    function _hashQuote(IntentTypes.MarketMakerQuote memory quote) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                quote.quoteId,
                quote.marketMaker,
                quote.token,
                keccak256(bytes(quote.marketMakerSide)),
                keccak256(bytes(quote.paymentMode)),
                quote.paymentAssetId,
                quote.shareQuantity,
                quote.unitPriceMinor,
                quote.nonce,
                quote.expiresAt,
                quote.policyVersion
            )
        );
    }

    function _hashApproval(IntentTypes.BrokerSettlementApproval memory approval) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                APPROVAL_TYPEHASH,
                approval.approvalId,
                approval.orderId,
                approval.investor,
                approval.marketMaker,
                approval.token,
                keccak256(bytes(approval.paymentMode)),
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

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
