// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IntentVerifier} from "./IntentVerifier.sol";
import {RestrictedEquityToken} from "./RestrictedEquityToken.sol";
import {SecurityTokenFactory} from "./SecurityTokenFactory.sol";
import {
    AllocationExceeded,
    IssuanceEvidenceMismatch,
    MissingIndependentApproval
} from "./shared/Errors.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {IntentTypes} from "./shared/IntentTypes.sol";
import {RoleIds} from "./shared/RoleIds.sol";

contract IssuanceController is AccessControl, EvidenceGuard {
    bytes32 private constant EXECUTION = keccak256("EXECUTION_ALLOCATION");
    bytes32 private constant RISK = keccak256("T2_RISK");
    bytes32 private constant RIGHTS_APPROVAL = keccak256("RIGHTS_ENTRY_APPROVAL");
    bytes32 private constant RIGHTS_RECORDED = keccak256("RIGHTS_RECORDED");
    bytes32 private constant DOMESTIC_SETTLEMENT = keccak256("DOMESTIC_SETTLEMENT");
    bytes32 private constant CUSTODY_QUANTITY = keccak256("CUSTODY_QUANTITY");
    bytes32 private constant CORRECTION_APPROVAL = keccak256("PENDING_CORRECTION_APPROVAL");
    bytes32 private constant CORRECTION_RECORDED = keccak256("PENDING_CORRECTION_RECORDED");

    struct IssuanceFacts {
        address token;
        address investor;
        uint256 executedQuantity;
        uint256 allocatedQuantity;
        uint256 cancelledQuantity;
        bool executionConfirmed;
        bool riskApproved;
        bool rightsApproved;
        bool rightsRecorded;
        bool minted;
        bool domesticSettled;
        bool custodyConfirmed;
        bool released;
        bytes32 executionEvidenceHash;
        bytes32 allocationEvidenceHash;
        bytes32 riskEvidenceHash;
        bytes32 rightsApprovalEvidenceHash;
        bytes32 rightsRecordedEvidenceHash;
    }

    struct PendingCorrection {
        bytes16 issuanceWorkflowId;
        address token;
        address investor;
        uint256 quantity;
        bool approved;
        bool recorded;
        bool executed;
        bytes32 approvalEvidenceHash;
        bytes32 recordedEvidenceHash;
    }

    IntentVerifier private immutable _intentVerifier;
    SecurityTokenFactory private immutable _tokenFactory;
    mapping(bytes16 workflowId => IssuanceFacts facts) private _issuances;
    mapping(bytes16 correctionId => PendingCorrection correction) private _corrections;

    event ExecutionAllocationConfirmed(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        uint256 executedQuantity,
        uint256 allocatedQuantity,
        bytes32 executionEvidenceHash,
        bytes32 allocationEvidenceHash
    );
    event T2RiskApproved(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        uint256 quantity,
        bytes32 evidenceHash
    );
    event RightsEntryApproved(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        uint256 quantity,
        bytes32 evidenceHash
    );
    event RightsRecordingConfirmed(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        uint256 quantity,
        bytes32 evidenceHash
    );
    event DomesticSettlementConfirmed(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        uint256 quantity,
        bytes32 evidenceHash
    );
    event CustodyQuantityConfirmed(
        bytes16 indexed workflowId,
        address indexed token,
        address indexed investor,
        uint256 quantity,
        bytes32 evidenceHash
    );
    event PendingMintCorrectionApproved(
        bytes16 indexed correctionId,
        bytes16 indexed issuanceWorkflowId,
        address indexed investor,
        address token,
        uint256 quantity,
        bytes32 evidenceHash
    );
    event PendingRightsCorrectionConfirmed(
        bytes16 indexed correctionId,
        bytes16 indexed issuanceWorkflowId,
        address indexed investor,
        uint256 quantity,
        bytes32 evidenceHash
    );

    constructor(address administrator, IntentVerifier intentVerifier, SecurityTokenFactory tokenFactory) {
        require(administrator != address(0), "administrator is zero");
        require(address(intentVerifier) != address(0), "intent verifier is zero");
        require(address(tokenFactory) != address(0), "token factory is zero");
        _intentVerifier = intentVerifier;
        _tokenFactory = tokenFactory;
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function confirmExecutionAllocation(
        bytes16 workflowId,
        address token,
        address investor,
        uint256 executedQuantity,
        uint256 allocatedQuantity,
        bytes32 executionEvidenceHash,
        bytes32 allocationEvidenceHash
    ) external onlyRole(RoleIds.EXECUTION_ALLOCATION_CONFIRMER_ROLE) {
        _requireIdentity(workflowId, token, investor, allocatedQuantity);
        if (allocatedQuantity > executedQuantity) revert AllocationExceeded(allocatedQuantity, executedQuantity);
        IssuanceFacts storage facts = _issuances[workflowId];
        if (facts.executionConfirmed) revert IssuanceEvidenceMismatch(workflowId);
        _consumeEvidence(executionEvidenceHash);
        _consumeEvidence(allocationEvidenceHash);
        facts.token = token;
        facts.investor = investor;
        facts.executedQuantity = executedQuantity;
        facts.allocatedQuantity = allocatedQuantity;
        facts.executionConfirmed = true;
        facts.executionEvidenceHash = executionEvidenceHash;
        facts.allocationEvidenceHash = allocationEvidenceHash;
        emit ExecutionAllocationConfirmed(
            workflowId,
            token,
            investor,
            executedQuantity,
            allocatedQuantity,
            executionEvidenceHash,
            allocationEvidenceHash
        );
    }

    function approveT2Risk(
        bytes16 workflowId,
        address token,
        address investor,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.RISK_APPROVER_ROLE) {
        IssuanceFacts storage facts = _matchingFacts(workflowId, token, investor, quantity);
        if (facts.riskApproved) revert IssuanceEvidenceMismatch(workflowId);
        _consumeEvidence(evidenceHash);
        facts.riskApproved = true;
        facts.riskEvidenceHash = evidenceHash;
        emit T2RiskApproved(workflowId, token, investor, quantity, evidenceHash);
    }

    function approveRightsEntry(
        bytes16 workflowId,
        address token,
        address investor,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.RIGHTS_ENTRY_APPROVER_ROLE) {
        IssuanceFacts storage facts = _matchingFacts(workflowId, token, investor, quantity);
        if (!facts.riskApproved) revert MissingIndependentApproval(workflowId, RISK);
        if (facts.rightsApproved) revert IssuanceEvidenceMismatch(workflowId);
        _consumeEvidence(evidenceHash);
        facts.rightsApproved = true;
        facts.rightsApprovalEvidenceHash = evidenceHash;
        emit RightsEntryApproved(workflowId, token, investor, quantity, evidenceHash);
    }

    function confirmRightsRecorded(
        bytes16 workflowId,
        address token,
        address investor,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.RIGHTS_RECORDING_CONFIRMER_ROLE) {
        IssuanceFacts storage facts = _matchingFacts(workflowId, token, investor, quantity);
        if (!facts.rightsApproved) revert MissingIndependentApproval(workflowId, RIGHTS_APPROVAL);
        if (facts.rightsRecorded) revert IssuanceEvidenceMismatch(workflowId);
        _consumeEvidence(evidenceHash);
        facts.rightsRecorded = true;
        facts.rightsRecordedEvidenceHash = evidenceHash;
        emit RightsRecordingConfirmed(workflowId, token, investor, quantity, evidenceHash);
    }

    function executePendingMint(
        bytes16 workflowId,
        IntentTypes.PrimaryOrderIntent calldata intent,
        bytes calldata investorSignature
    ) external onlyRole(RoleIds.ISSUANCE_EXECUTOR_ROLE) {
        IssuanceFacts storage facts = _issuances[workflowId];
        if (!facts.executionConfirmed) revert MissingIndependentApproval(workflowId, EXECUTION);
        if (!facts.riskApproved) revert MissingIndependentApproval(workflowId, RISK);
        if (!facts.rightsApproved) revert MissingIndependentApproval(workflowId, RIGHTS_APPROVAL);
        if (!facts.rightsRecorded) revert MissingIndependentApproval(workflowId, RIGHTS_RECORDED);
        if (facts.minted || intent.orderId != workflowId || intent.investor != facts.investor) {
            revert IssuanceEvidenceMismatch(workflowId);
        }
        if (intent.shareQuantity < facts.allocatedQuantity) {
            revert AllocationExceeded(facts.allocatedQuantity, intent.shareQuantity);
        }
        if (keccak256(bytes(_tokenFactory.getTokenSecurityId(facts.token))) != keccak256(bytes(intent.securityId))) {
            revert IssuanceEvidenceMismatch(workflowId);
        }
        _intentVerifier.verifyAndConsumePrimaryOrder(intent, investorSignature);
        facts.minted = true;
        RestrictedEquityToken(facts.token).mintPending(
            workflowId, facts.investor, facts.allocatedQuantity, _issuanceEvidence(facts, workflowId)
        );
    }

    function confirmDomesticSettlement(
        bytes16 workflowId,
        address token,
        address investor,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.SETTLEMENT_CONFIRMER_ROLE) {
        IssuanceFacts storage facts = _matchingEffectiveFacts(workflowId, token, investor, quantity);
        if (!facts.minted || facts.domesticSettled) revert IssuanceEvidenceMismatch(workflowId);
        _consumeEvidence(evidenceHash);
        facts.domesticSettled = true;
        emit DomesticSettlementConfirmed(workflowId, token, investor, quantity, evidenceHash);
    }

    function confirmCustodyQuantity(
        bytes16 workflowId,
        address token,
        address investor,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.CUSTODY_CONFIRMER_ROLE) {
        IssuanceFacts storage facts = _matchingEffectiveFacts(workflowId, token, investor, quantity);
        if (!facts.minted || facts.custodyConfirmed) revert IssuanceEvidenceMismatch(workflowId);
        _consumeEvidence(evidenceHash);
        facts.custodyConfirmed = true;
        emit CustodyQuantityConfirmed(workflowId, token, investor, quantity, evidenceHash);
    }

    function executeRelease(bytes16 workflowId, address token, address investor, uint256 quantity)
        external
        onlyRole(RoleIds.ISSUANCE_EXECUTOR_ROLE)
    {
        IssuanceFacts storage facts = _matchingEffectiveFacts(workflowId, token, investor, quantity);
        if (!facts.domesticSettled) revert MissingIndependentApproval(workflowId, DOMESTIC_SETTLEMENT);
        if (!facts.custodyConfirmed) revert MissingIndependentApproval(workflowId, CUSTODY_QUANTITY);
        if (facts.released) revert IssuanceEvidenceMismatch(workflowId);
        facts.released = true;
        RestrictedEquityToken(token).releasePending(
            workflowId, investor, quantity, keccak256(abi.encode(workflowId, token, investor, quantity, "RELEASE"))
        );
    }

    function approvePendingCorrection(
        bytes16 correctionId,
        bytes16 issuanceWorkflowId,
        address token,
        address investor,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.RIGHTS_ENTRY_APPROVER_ROLE) {
        _requireIdentity(correctionId, token, investor, quantity);
        IssuanceFacts storage facts = _matchingEffectiveFacts(
            issuanceWorkflowId, token, investor, _factsRemaining(issuanceWorkflowId)
        );
        if (!facts.minted || facts.released || quantity > _factsRemaining(issuanceWorkflowId)) {
            revert IssuanceEvidenceMismatch(issuanceWorkflowId);
        }
        PendingCorrection storage correction = _corrections[correctionId];
        if (correction.approved) revert IssuanceEvidenceMismatch(correctionId);
        _consumeEvidence(evidenceHash);
        correction.issuanceWorkflowId = issuanceWorkflowId;
        correction.token = token;
        correction.investor = investor;
        correction.quantity = quantity;
        correction.approved = true;
        correction.approvalEvidenceHash = evidenceHash;
        emit PendingMintCorrectionApproved(
            correctionId, issuanceWorkflowId, investor, token, quantity, evidenceHash
        );
    }

    function confirmPendingRightsCorrection(
        bytes16 correctionId,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.RIGHTS_RECORDING_CONFIRMER_ROLE) {
        PendingCorrection storage correction = _corrections[correctionId];
        if (!correction.approved) revert MissingIndependentApproval(correctionId, CORRECTION_APPROVAL);
        if (correction.recorded || correction.quantity != quantity) revert IssuanceEvidenceMismatch(correctionId);
        _consumeEvidence(evidenceHash);
        correction.recorded = true;
        correction.recordedEvidenceHash = evidenceHash;
        emit PendingRightsCorrectionConfirmed(
            correctionId,
            correction.issuanceWorkflowId,
            correction.investor,
            quantity,
            evidenceHash
        );
    }

    function executePendingCorrection(bytes16 correctionId)
        external
        onlyRole(RoleIds.ISSUANCE_EXECUTOR_ROLE)
    {
        PendingCorrection storage correction = _corrections[correctionId];
        if (!correction.approved) revert MissingIndependentApproval(correctionId, CORRECTION_APPROVAL);
        if (!correction.recorded) revert MissingIndependentApproval(correctionId, CORRECTION_RECORDED);
        if (correction.executed) revert IssuanceEvidenceMismatch(correctionId);
        IssuanceFacts storage facts = _issuances[correction.issuanceWorkflowId];
        if (correction.quantity > _factsRemaining(correction.issuanceWorkflowId)) {
            revert AllocationExceeded(correction.quantity, _factsRemaining(correction.issuanceWorkflowId));
        }
        correction.executed = true;
        facts.cancelledQuantity += correction.quantity;
        RestrictedEquityToken(correction.token).cancelPendingMint(
            correctionId,
            correction.investor,
            correction.quantity,
            keccak256(
                abi.encode(
                    correctionId,
                    correction.issuanceWorkflowId,
                    correction.approvalEvidenceHash,
                    correction.recordedEvidenceHash
                )
            )
        );
    }

    function _factsRemaining(bytes16 workflowId) private view returns (uint256) {
        IssuanceFacts storage facts = _issuances[workflowId];
        return facts.allocatedQuantity - facts.cancelledQuantity;
    }

    function _matchingFacts(bytes16 workflowId, address token, address investor, uint256 quantity)
        private
        view
        returns (IssuanceFacts storage facts)
    {
        facts = _issuances[workflowId];
        if (
            !facts.executionConfirmed || facts.token != token || facts.investor != investor
                || facts.allocatedQuantity != quantity
        ) revert IssuanceEvidenceMismatch(workflowId);
    }

    function _matchingEffectiveFacts(bytes16 workflowId, address token, address investor, uint256 quantity)
        private
        view
        returns (IssuanceFacts storage facts)
    {
        facts = _issuances[workflowId];
        if (
            !facts.executionConfirmed || facts.token != token || facts.investor != investor
                || _factsRemaining(workflowId) != quantity
        ) revert IssuanceEvidenceMismatch(workflowId);
    }

    function _requireIdentity(bytes16 workflowId, address token, address investor, uint256 quantity) private pure {
        require(workflowId != bytes16(0), "workflow is zero");
        require(token != address(0), "token is zero");
        require(investor != address(0), "investor is zero");
        require(quantity != 0, "quantity is zero");
    }

    function _issuanceEvidence(IssuanceFacts storage facts, bytes16 workflowId) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                workflowId,
                facts.executionEvidenceHash,
                facts.allocationEvidenceHash,
                facts.riskEvidenceHash,
                facts.rightsApprovalEvidenceHash,
                facts.rightsRecordedEvidenceHash
            )
        );
    }
}
