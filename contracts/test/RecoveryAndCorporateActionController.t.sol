// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CorporateActionController} from "../src/CorporateActionController.sol";
import {EligibilityRegistry} from "../src/EligibilityRegistry.sol";
import {MarketPolicyRegistry} from "../src/MarketPolicyRegistry.sol";
import {RecoveryController} from "../src/RecoveryController.sol";
import {RestrictedEquityToken} from "../src/RestrictedEquityToken.sol";
import {MissingIndependentApproval, NonIntegralCorporateAction} from "../src/shared/Errors.sol";
import {PolicyScopes} from "../src/shared/PolicyScopes.sol";
import {RoleIds} from "../src/shared/RoleIds.sol";
import {TestBase} from "./TestBase.sol";

contract RecoveryAndCorporateActionControllerTest is TestBase {
    address private constant OLD_WALLET = address(0xA11CE);
    address private constant NEW_WALLET = address(0xB0B);

    EligibilityRegistry private eligibility;
    MarketPolicyRegistry private policy;
    RestrictedEquityToken private token;
    RecoveryController private recovery;
    CorporateActionController private corporateAction;
    uint256 private sequence;

    function setUp() public {
        vm.warp(1_800_000_000);
        eligibility = new EligibilityRegistry(address(this));
        policy = new MarketPolicyRegistry(address(this), keccak256("RIGHTS-SIM-1"));
        token = new RestrictedEquityToken("Synthetic Rights", "SIM990003", address(this), eligibility, policy);
        recovery = new RecoveryController(address(this));
        corporateAction = new CorporateActionController(address(this));

        eligibility.grantRole(RoleIds.ELIGIBILITY_OPERATOR_ROLE, address(this));
        token.grantRole(RoleIds.ISSUANCE_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.REDEMPTION_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.RECOVERY_EXECUTOR_ROLE, address(this));
        token.grantRole(RoleIds.RECOVERY_EXECUTOR_ROLE, address(recovery));
        token.grantRole(RoleIds.CORPORATE_ACTION_EXECUTOR_ROLE, address(corporateAction));
        policy.grantRole(RoleIds.EMERGENCY_PAUSER_ROLE, address(this));

        recovery.grantRole(RoleIds.RECOVERY_RIGHTS_APPROVER_ROLE, address(this));
        recovery.grantRole(RoleIds.RECOVERY_COMPLIANCE_APPROVER_ROLE, address(this));
        recovery.grantRole(RoleIds.RECOVERY_EXECUTOR_ROLE, address(this));
        corporateAction.grantRole(RoleIds.CORPORATE_ACTION_RIGHTS_APPROVER_ROLE, address(this));
        corporateAction.grantRole(RoleIds.CORPORATE_ACTION_AUDIT_APPROVER_ROLE, address(this));
        corporateAction.grantRole(RoleIds.CORPORATE_ACTION_EXECUTOR_ROLE, address(this));

        _eligible(OLD_WALLET);
        _eligible(NEW_WALLET);
        _seedFiveBuckets();
    }

    function test_RecoveryRequiresTwoMatchingApprovalsAndPreservesEveryBucket() public {
        bytes16 workflowId = _workflow();
        token.freezeAddress(_workflow(), OLD_WALLET, true, _evidence());
        recovery.approveRightsRecovery(workflowId, OLD_WALLET, NEW_WALLET, _evidence());
        vm.expectRevert(abi.encodeWithSelector(MissingIndependentApproval.selector, workflowId, keccak256("COMPLIANCE_RECOVERY")));
        recovery.executeRecovery(workflowId, address(token), OLD_WALLET, NEW_WALLET);
        recovery.approveComplianceRecovery(workflowId, OLD_WALLET, NEW_WALLET, _evidence());
        recovery.executeRecovery(workflowId, address(token), OLD_WALLET, NEW_WALLET);

        assertEq(token.availableBalanceOf(NEW_WALLET), 4);
        assertEq(token.pendingSettlementBalanceOf(NEW_WALLET), 2);
        assertEq(token.redemptionLockedBalanceOf(NEW_WALLET), 2);
        assertEq(token.burnPendingBalanceOf(NEW_WALLET), 1);
        assertEq(token.administrativeFrozenBalanceOf(NEW_WALLET), 1);
        assertEq(token.balanceOf(OLD_WALLET), 0);
        assertEq(token.totalSupply(), 10);
    }

    function test_TwoForOneSplitScalesOnlyRightsBackedBuckets() public {
        _pauseAll();
        bytes16 workflowId = _workflow();
        corporateAction.approveRightsPlan(workflowId, address(token), 2, 1, 19, _evidence());
        corporateAction.approveAuditPlan(workflowId, address(token), 2, 1, 19, _evidence());
        address[] memory accounts = new address[](1);
        accounts[0] = OLD_WALLET;
        corporateAction.applySplitBatch(workflowId, address(token), accounts);
        corporateAction.finalizeSplit(workflowId);

        assertEq(token.availableBalanceOf(OLD_WALLET), 8);
        assertEq(token.pendingSettlementBalanceOf(OLD_WALLET), 4);
        assertEq(token.redemptionLockedBalanceOf(OLD_WALLET), 4);
        assertEq(token.administrativeFrozenBalanceOf(OLD_WALLET), 2);
        assertEq(token.burnPendingBalanceOf(OLD_WALLET), 1);
        assertEq(token.totalSupply(), 19);
    }

    function test_NonIntegralPlanRevertsWithoutPartialMutation() public {
        _pauseAll();
        bytes16 workflowId = _workflow();
        corporateAction.approveRightsPlan(workflowId, address(token), 1, 3, 4, _evidence());
        corporateAction.approveAuditPlan(workflowId, address(token), 1, 3, 4, _evidence());
        address[] memory accounts = new address[](1);
        accounts[0] = OLD_WALLET;
        vm.expectRevert(abi.encodeWithSelector(NonIntegralCorporateAction.selector, OLD_WALLET, 4, 3));
        corporateAction.applySplitBatch(workflowId, address(token), accounts);
        assertEq(token.availableBalanceOf(OLD_WALLET), 4);
        assertEq(token.totalSupply(), 10);
    }

    function _seedFiveBuckets() private {
        token.mintPending(_workflow(), OLD_WALLET, 10, _evidence());
        token.releasePending(_workflow(), OLD_WALLET, 8, _evidence());
        token.lockForRedemption(_workflow(), OLD_WALLET, 3, _evidence());
        token.markBurnPending(_workflow(), OLD_WALLET, 1, _evidence());
        token.freezeAvailable(_workflow(), OLD_WALLET, 1, _evidence());
    }

    function _pauseAll() private {
        policy.pauseScope(_workflow(), address(token), PolicyScopes.ISSUANCE, keccak256("corp"), _evidence());
        policy.pauseScope(_workflow(), address(token), PolicyScopes.SECONDARY, keccak256("corp"), _evidence());
        policy.pauseScope(_workflow(), address(token), PolicyScopes.REDEMPTION, keccak256("corp"), _evidence());
    }

    function _eligible(address wallet) private {
        eligibility.setEligibility(_workflow(), wallet, true, block.timestamp + 30 days, _evidence());
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
