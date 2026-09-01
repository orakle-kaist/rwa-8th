// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {RestrictedEquityToken} from "./RestrictedEquityToken.sol";
import {MissingIndependentApproval} from "./shared/Errors.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {RoleIds} from "./shared/RoleIds.sol";

/// @notice 권리 담당과 감사 담당이 같은 정수 수량안을 승인한 경우에만 분할을 실행한다.
contract CorporateActionController is AccessControl, EvidenceGuard {
    bytes32 private constant RIGHTS_PLAN = keccak256("CORPORATE_ACTION_RIGHTS_PLAN");
    bytes32 private constant AUDIT_PLAN = keccak256("CORPORATE_ACTION_AUDIT_PLAN");

    struct ActionPlan {
        address token;
        uint256 numerator;
        uint256 denominator;
        uint256 expectedSupply;
        bool rightsApproved;
        bool auditApproved;
        bool finalized;
    }

    mapping(bytes16 workflowId => ActionPlan plan) private _plans;
    mapping(bytes16 workflowId => mapping(address account => bool processed)) private _processed;

    event RightsPlanApproved(
        bytes16 indexed workflowId, address indexed token, bytes32 evidenceHash
    );
    event AuditPlanApproved(
        bytes16 indexed workflowId, address indexed token, bytes32 evidenceHash
    );
    event SplitBatchApplied(
        bytes16 indexed workflowId, address indexed token, uint256 accountCount
    );
    event SplitFinalized(
        bytes16 indexed workflowId, address indexed token, uint256 newTotalSupply
    );

    constructor(address administrator) {
        require(administrator != address(0), "administrator is zero");
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function approveRightsPlan(
        bytes16 workflowId,
        address token,
        uint256 numerator,
        uint256 denominator,
        uint256 expectedSupply,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.CORPORATE_ACTION_RIGHTS_APPROVER_ROLE) {
        ActionPlan storage plan = _plan(workflowId, token, numerator, denominator, expectedSupply);
        require(!plan.rightsApproved, "rights plan already approved");
        _consumeEvidence(evidenceHash);
        plan.rightsApproved = true;
        emit RightsPlanApproved(workflowId, token, evidenceHash);
    }

    function approveAuditPlan(
        bytes16 workflowId,
        address token,
        uint256 numerator,
        uint256 denominator,
        uint256 expectedSupply,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.CORPORATE_ACTION_AUDIT_APPROVER_ROLE) {
        ActionPlan storage plan = _plan(workflowId, token, numerator, denominator, expectedSupply);
        require(!plan.auditApproved, "audit plan already approved");
        _consumeEvidence(evidenceHash);
        plan.auditApproved = true;
        emit AuditPlanApproved(workflowId, token, evidenceHash);
    }

    function applySplitBatch(bytes16 workflowId, address token, address[] calldata accounts)
        external
        onlyRole(RoleIds.CORPORATE_ACTION_EXECUTOR_ROLE)
    {
        ActionPlan storage plan = _matching(workflowId, token);
        if (!plan.rightsApproved) revert MissingIndependentApproval(workflowId, RIGHTS_PLAN);
        if (!plan.auditApproved) revert MissingIndependentApproval(workflowId, AUDIT_PLAN);
        require(!plan.finalized, "split already finalized");
        require(accounts.length != 0, "accounts are empty");
        for (uint256 i = 0; i < accounts.length; ++i) {
            require(!_processed[workflowId][accounts[i]], "split account already processed");
            _processed[workflowId][accounts[i]] = true;
        }
        RestrictedEquityToken(token).applySplitBatch(
            workflowId,
            accounts,
            plan.numerator,
            plan.denominator,
            keccak256(abi.encode(workflowId, token, accounts, plan.numerator, plan.denominator))
        );
        emit SplitBatchApplied(workflowId, token, accounts.length);
    }

    function finalizeSplit(bytes16 workflowId) external onlyRole(RoleIds.CORPORATE_ACTION_EXECUTOR_ROLE) {
        ActionPlan storage plan = _plans[workflowId];
        require(plan.token != address(0), "corporate action is missing");
        if (!plan.rightsApproved) revert MissingIndependentApproval(workflowId, RIGHTS_PLAN);
        if (!plan.auditApproved) revert MissingIndependentApproval(workflowId, AUDIT_PLAN);
        require(!plan.finalized, "split already finalized");
        uint256 supply = RestrictedEquityToken(plan.token).totalSupply();
        require(supply == plan.expectedSupply, "split supply mismatch");
        plan.finalized = true;
        emit SplitFinalized(workflowId, plan.token, supply);
    }

    function _plan(
        bytes16 workflowId,
        address token,
        uint256 numerator,
        uint256 denominator,
        uint256 expectedSupply
    ) private returns (ActionPlan storage plan) {
        require(workflowId != bytes16(0), "workflow is zero");
        require(token != address(0), "token is zero");
        require(numerator != 0 && denominator != 0 && expectedSupply != 0, "invalid split plan");
        plan = _plans[workflowId];
        if (plan.token == address(0)) {
            plan.token = token;
            plan.numerator = numerator;
            plan.denominator = denominator;
            plan.expectedSupply = expectedSupply;
        } else {
            require(
                plan.token == token && plan.numerator == numerator && plan.denominator == denominator
                    && plan.expectedSupply == expectedSupply,
                "corporate action plan mismatch"
            );
        }
    }

    function _matching(bytes16 workflowId, address token) private view returns (ActionPlan storage plan) {
        plan = _plans[workflowId];
        require(plan.token != address(0) && plan.token == token, "corporate action plan mismatch");
    }
}
