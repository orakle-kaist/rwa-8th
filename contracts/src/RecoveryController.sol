// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {RestrictedEquityToken} from "./RestrictedEquityToken.sol";
import {MissingIndependentApproval} from "./shared/Errors.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {RoleIds} from "./shared/RoleIds.sol";

/// @notice 두 독립 승인을 받은 전용 지갑 교체만 실행한다.
contract RecoveryController is AccessControl, EvidenceGuard {
    bytes32 private constant RIGHTS_RECOVERY = keccak256("RIGHTS_RECOVERY");
    bytes32 private constant COMPLIANCE_RECOVERY = keccak256("COMPLIANCE_RECOVERY");

    struct RecoveryFacts {
        address oldWallet;
        address newWallet;
        bool rightsApproved;
        bool complianceApproved;
        bool executed;
    }

    mapping(bytes16 workflowId => RecoveryFacts facts) private _recoveries;

    event RightsRecoveryApproved(
        bytes16 indexed workflowId,
        address indexed oldWallet,
        address indexed newWallet,
        bytes32 evidenceHash
    );
    event ComplianceRecoveryApproved(
        bytes16 indexed workflowId,
        address indexed oldWallet,
        address indexed newWallet,
        bytes32 evidenceHash
    );
    event RecoveryExecuted(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed oldWallet,
        address newWallet
    );

    constructor(address administrator) {
        require(administrator != address(0), "administrator is zero");
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function approveRightsRecovery(
        bytes16 workflowId,
        address oldWallet,
        address newWallet,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.RECOVERY_RIGHTS_APPROVER_ROLE) {
        RecoveryFacts storage facts = _identity(workflowId, oldWallet, newWallet);
        require(!facts.rightsApproved, "rights recovery already approved");
        _consumeEvidence(evidenceHash);
        facts.rightsApproved = true;
        emit RightsRecoveryApproved(workflowId, oldWallet, newWallet, evidenceHash);
    }

    function approveComplianceRecovery(
        bytes16 workflowId,
        address oldWallet,
        address newWallet,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.RECOVERY_COMPLIANCE_APPROVER_ROLE) {
        RecoveryFacts storage facts = _identity(workflowId, oldWallet, newWallet);
        require(!facts.complianceApproved, "compliance recovery already approved");
        _consumeEvidence(evidenceHash);
        facts.complianceApproved = true;
        emit ComplianceRecoveryApproved(workflowId, oldWallet, newWallet, evidenceHash);
    }

    function executeRecovery(bytes16 workflowId, address token, address oldWallet, address newWallet)
        external
        onlyRole(RoleIds.RECOVERY_EXECUTOR_ROLE)
    {
        require(token != address(0), "token is zero");
        RecoveryFacts storage facts = _identity(workflowId, oldWallet, newWallet);
        if (!facts.rightsApproved) revert MissingIndependentApproval(workflowId, RIGHTS_RECOVERY);
        if (!facts.complianceApproved) revert MissingIndependentApproval(workflowId, COMPLIANCE_RECOVERY);
        require(!facts.executed, "recovery already executed");
        require(RestrictedEquityToken(token).isAddressFrozen(oldWallet), "old wallet is not frozen");
        facts.executed = true;
        RestrictedEquityToken(token).recoverAllBuckets(
            workflowId, oldWallet, newWallet, keccak256(abi.encode(workflowId, token, oldWallet, newWallet))
        );
        emit RecoveryExecuted(workflowId, token, oldWallet, newWallet);
    }

    function _identity(bytes16 workflowId, address oldWallet, address newWallet)
        private
        returns (RecoveryFacts storage facts)
    {
        require(workflowId != bytes16(0), "workflow is zero");
        require(oldWallet != address(0) && newWallet != address(0) && oldWallet != newWallet, "wallets are invalid");
        facts = _recoveries[workflowId];
        if (facts.oldWallet == address(0)) {
            facts.oldWallet = oldWallet;
            facts.newWallet = newWallet;
        } else {
            require(facts.oldWallet == oldWallet && facts.newWallet == newWallet, "recovery evidence mismatch");
        }
    }
}
