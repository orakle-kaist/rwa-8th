// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {IntentVerifier} from "../src/IntentVerifier.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {RedemptionController} from "../src/RedemptionController.sol";
import {RestrictedEquityToken} from "../src/RestrictedEquityToken.sol";
import {IntentTypes} from "../src/shared/IntentTypes.sol";
import {RoleIds} from "../src/shared/RoleIds.sol";
import {TestBase} from "./TestBase.sol";

contract RedemptionControllerTest is TestBase {
    bytes32 private constant POLICY = keccak256("SECONDARY-SIM-1");
    uint256 private constant MARKET_MAKER_KEY = 0xBEEF;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant REDEMPTION_TYPEHASH = keccak256(
        "RedemptionIntent(bytes16 redemptionId,address investor,address token,uint256 shareQuantity,uint256 krwLimitPrice,string targetTradingDate,uint256 nonce,uint256 expiresAt,bytes32 policyVersion)"
    );

    EligibilityRegistry private eligibility;
    MarketPolicyRegistry private policy;
    IntentVerifier private verifier;
    RestrictedEquityToken private token;
    RedemptionController private controller;
    address private marketMaker;
    uint256 private sequence;

    function setUp() public {
        vm.warp(1_800_000_000);
        marketMaker = vm.addr(MARKET_MAKER_KEY);
        eligibility = new EligibilityRegistry(address(this));
        policy = new MarketPolicyRegistry(address(this), POLICY);
        verifier = new IntentVerifier(address(this), policy);
        token = new RestrictedEquityToken("Synthetic Hynix Rights", "SIM990002", address(this), eligibility, policy);
        controller = new RedemptionController(address(this), verifier);

        eligibility.grantRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE, address(this));
        eligibility.setEligibility(_workflow(), marketMaker, true, block.timestamp + 30 days, _evidence());
        token.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.REDEMPTION_EXECUTOR_ROLE, address(controller));
        verifier.grantRole(RoleIds.REDEMPTION_EXECUTOR_ROLE, address(controller));
        controller.grantRole(RoleIds.REDEMPTION_EXECUTOR_ROLE, address(this));
        controller.grantRole(RoleIds.REDEMPTION_RIGHTS_APPROVER_ROLE, address(this));
        controller.grantRole(RoleIds.SETTLEMENT_CONFIRMER_ROLE, address(this));
        controller.grantRole(RoleIds.PAYMENT_APPROVER_ROLE, address(this));

        token.mintPending(_workflow(), marketMaker, 104, _evidence());
        token.releasePending(_workflow(), marketMaker, 104, _evidence());
    }

    function test_SellHedgeLocksTerminatesClaimsAndBurnsFourShares() public {
        bytes16 workflowId = bytes16(uint128(101));
        IntentTypes.RedemptionIntent memory intent = _intent(workflowId, 4, 1);
        controller.lockRedemption(workflowId, intent, _signIntent(intent));
        assertEq(token.availableBalanceOf(marketMaker), 100);
        assertEq(token.redemptionLockedBalanceOf(marketMaker), 4);

        controller.markDomesticSaleSubmitted(workflowId, keccak256("submitted"));
        controller.confirmDomesticExecution(workflowId, 4, keccak256("executed"));
        controller.confirmSaleProceedsSettled(workflowId, 4, 478_840, keccak256("settled"));
        controller.confirmRightsTerminated(
            workflowId, address(token), marketMaker, 4, keccak256("rights-terminated")
        );
        controller.confirmCashClaim(workflowId, 4, 478_840, keccak256("cash-claim"));
        controller.markBurnPending(workflowId);
        assertEq(token.redemptionLockedBalanceOf(marketMaker), 0);
        assertEq(token.burnPendingBalanceOf(marketMaker), 4);

        vm.expectRevert();
        controller.executeBurn(workflowId);
        controller.approveUsdPayment(workflowId, 478_840, keccak256("payment"));
        controller.executeBurn(workflowId);
        assertEq(token.burnPendingBalanceOf(marketMaker), 0);
        assertEq(token.totalSupply(), 100);
    }

    function test_CancellationIsOnlyAllowedBeforeRightsTermination() public {
        bytes16 workflowId = bytes16(uint128(201));
        IntentTypes.RedemptionIntent memory intent = _intent(workflowId, 4, 2);
        controller.lockRedemption(workflowId, intent, _signIntent(intent));
        controller.cancelBeforeDomesticSale(workflowId, keccak256("cancel"));
        assertEq(token.availableBalanceOf(marketMaker), 104);
        assertEq(token.redemptionLockedBalanceOf(marketMaker), 0);

        bytes16 secondId = bytes16(uint128(202));
        IntentTypes.RedemptionIntent memory second = _intent(secondId, 4, 3);
        controller.lockRedemption(secondId, second, _signIntent(second));
        controller.markDomesticSaleSubmitted(secondId, keccak256("submitted-2"));
        vm.expectRevert();
        controller.cancelBeforeDomesticSale(secondId, keccak256("late-cancel"));
    }

    function test_PartialExecutionReleasesOnlyUnfilledQuantityAndRequiresSettlement() public {
        bytes16 workflowId = bytes16(uint128(301));
        IntentTypes.RedemptionIntent memory intent = _intent(workflowId, 5, 4);
        controller.lockRedemption(workflowId, intent, _signIntent(intent));
        controller.markDomesticSaleSubmitted(workflowId, keccak256("submitted-3"));
        controller.confirmDomesticExecution(workflowId, 4, keccak256("partial-execution"));

        assertEq(token.availableBalanceOf(marketMaker), 100);
        assertEq(token.redemptionLockedBalanceOf(marketMaker), 4);
        vm.expectRevert();
        controller.confirmRightsTerminated(
            workflowId, address(token), marketMaker, 4, keccak256("premature-termination")
        );

        controller.confirmSaleProceedsSettled(workflowId, 4, 744_76, keccak256("partial-settlement"));
        controller.confirmRightsTerminated(
            workflowId, address(token), marketMaker, 4, keccak256("partial-termination")
        );
        vm.expectRevert();
        controller.confirmCashClaim(workflowId, 4, 744_75, keccak256("wrong-cash-claim"));
        controller.confirmCashClaim(workflowId, 4, 744_76, keccak256("partial-cash-claim"));
        controller.markBurnPending(workflowId);
        controller.approveUsdPayment(workflowId, 744_76, keccak256("partial-payment"));
        controller.executeBurn(workflowId);

        assertEq(token.availableBalanceOf(marketMaker), 100);
        assertEq(token.totalSupply(), 100);
    }

    function _intent(bytes16 workflowId, uint256 quantity, uint256 nonce)
        private
        view
        returns (IntentTypes.RedemptionIntent memory)
    {
        return IntentTypes.RedemptionIntent({
            redemptionId: workflowId,
            investor: marketMaker,
            token: address(token),
            shareQuantity: quantity,
            krwLimitPrice: 1_653_000,
            targetTradingDate: "2026-09-01",
            nonce: nonce,
            expiresAt: block.timestamp + 1 hours,
            policyVersion: POLICY
        });
    }

    function _signIntent(IntentTypes.RedemptionIntent memory intent) private returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                REDEMPTION_TYPEHASH,
                intent.redemptionId,
                intent.investor,
                intent.token,
                intent.shareQuantity,
                intent.krwLimitPrice,
                keccak256(bytes(intent.targetTradingDate)),
                intent.nonce,
                intent.expiresAt,
                intent.policyVersion
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("Korean Equity RWA Intent"),
                keccak256("1"),
                block.chainid,
                address(verifier)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MARKET_MAKER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _workflow() private returns (bytes16) {
        sequence += 1;
        return bytes16(uint128(sequence));
    }

    function _evidence() private returns (bytes32) {
        sequence += 1;
        return keccak256(abi.encode(sequence));
    }
}
