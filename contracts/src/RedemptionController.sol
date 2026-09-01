// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IntentVerifier} from "./IntentVerifier.sol";
import {RestrictedEquityToken} from "./RestrictedEquityToken.sol";
import {MissingIndependentApproval, PaymentMismatch} from "./shared/Errors.sol";
import {EvidenceGuard} from "./shared/EvidenceGuard.sol";
import {IntentTypes} from "./shared/IntentTypes.sol";
import {RoleIds} from "./shared/RoleIds.sol";

/// @notice Controls the custody-right termination path used by market-maker
/// inventory reductions and, later, investor redemptions. A chain burn is never
/// treated as proof that off-chain USD has actually been paid.
contract RedemptionController is AccessControl, EvidenceGuard {
    bytes32 private constant RIGHTS_TERMINATED = keccak256("RIGHTS_TERMINATED");
    bytes32 private constant CASH_CLAIM = keccak256("CASH_CLAIM");
    bytes32 private constant BURN_PENDING = keccak256("BURN_PENDING");
    bytes32 private constant PAYMENT_APPROVAL = keccak256("PAYMENT_APPROVAL");

    struct RedemptionFacts {
        address token;
        address investor;
        uint256 requestedQuantity;
        uint256 executedQuantity;
        uint256 usdAmountMinor;
        bool locked;
        bool cancelled;
        bool domesticSaleSubmitted;
        bool domesticExecutionConfirmed;
        bool saleProceedsSettled;
        bool rightsTerminated;
        bool cashClaimConfirmed;
        bool burnPending;
        bool usdPaymentApproved;
        bool burned;
    }

    IntentVerifier private immutable _intentVerifier;
    mapping(bytes16 workflowId => RedemptionFacts facts) private _redemptions;

    event RedemptionWorkflowLocked(
        bytes16 indexed workflowId, address indexed token, address indexed investor, uint256 quantity
    );
    event DomesticSaleSubmitted(bytes16 indexed workflowId, bytes32 evidenceHash);
    event DomesticExecutionConfirmed(
        bytes16 indexed workflowId, uint256 requestedQuantity, uint256 executedQuantity, bytes32 evidenceHash
    );
    event SaleProceedsSettled(
        bytes16 indexed workflowId, uint256 quantity, uint256 usdAmountMinor, bytes32 evidenceHash
    );
    event RightsTerminated(bytes16 indexed workflowId, uint256 quantity, bytes32 evidenceHash);
    event CashClaimConfirmed(
        bytes16 indexed workflowId, uint256 quantity, uint256 usdAmountMinor, bytes32 evidenceHash
    );
    event UsdPaymentApproved(bytes16 indexed workflowId, uint256 usdAmountMinor, bytes32 evidenceHash);

    constructor(address administrator, IntentVerifier intentVerifier) {
        require(administrator != address(0), "administrator is zero");
        require(address(intentVerifier) != address(0), "intent verifier is zero");
        _intentVerifier = intentVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
    }

    function lockRedemption(
        bytes16 workflowId,
        IntentTypes.RedemptionIntent calldata intent,
        bytes calldata investorSignature
    ) external onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE) {
        require(workflowId != bytes16(0) && workflowId == intent.redemptionId, "redemption id mismatch");
        RedemptionFacts storage facts = _redemptions[workflowId];
        require(!facts.locked, "redemption already exists");
        bytes32 intentDigest = _intentVerifier.verifyAndConsumeRedemption(intent, investorSignature);
        facts.token = intent.token;
        facts.investor = intent.investor;
        facts.requestedQuantity = intent.shareQuantity;
        facts.locked = true;
        RestrictedEquityToken(intent.token).lockForRedemption(
            workflowId, intent.investor, intent.shareQuantity, intentDigest
        );
        emit RedemptionWorkflowLocked(workflowId, intent.token, intent.investor, intent.shareQuantity);
    }

    function cancelBeforeDomesticSale(bytes16 workflowId, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.REDEMPTION_RIGHTS_APPROVER_ROLE)
    {
        RedemptionFacts storage facts = _active(workflowId);
        require(!facts.domesticSaleSubmitted, "domestic sale already submitted");
        _consumeEvidence(evidenceHash);
        facts.cancelled = true;
        RestrictedEquityToken(facts.token).cancelRedemptionLock(
            workflowId, facts.investor, facts.requestedQuantity, evidenceHash
        );
    }

    function markDomesticSaleSubmitted(bytes16 workflowId, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.REDEMPTION_RIGHTS_APPROVER_ROLE)
    {
        RedemptionFacts storage facts = _active(workflowId);
        require(!facts.domesticSaleSubmitted, "domestic sale already submitted");
        _consumeEvidence(evidenceHash);
        facts.domesticSaleSubmitted = true;
        emit DomesticSaleSubmitted(workflowId, evidenceHash);
    }

    function confirmDomesticExecution(bytes16 workflowId, uint256 executedQuantity, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.REDEMPTION_RIGHTS_APPROVER_ROLE)
    {
        RedemptionFacts storage facts = _active(workflowId);
        require(facts.domesticSaleSubmitted, "domestic sale is not submitted");
        require(!facts.domesticExecutionConfirmed, "domestic execution already confirmed");
        require(executedQuantity <= facts.requestedQuantity, "execution exceeds request");
        _consumeEvidence(evidenceHash);
        facts.domesticExecutionConfirmed = true;
        facts.executedQuantity = executedQuantity;
        uint256 unfilled = facts.requestedQuantity - executedQuantity;
        if (unfilled != 0) {
            RestrictedEquityToken(facts.token).cancelRedemptionLock(
                workflowId, facts.investor, unfilled, keccak256(abi.encode(evidenceHash, "UNFILLED"))
            );
        }
        if (executedQuantity == 0) facts.cancelled = true;
        emit DomesticExecutionConfirmed(workflowId, facts.requestedQuantity, executedQuantity, evidenceHash);
    }

    function confirmSaleProceedsSettled(
        bytes16 workflowId,
        uint256 quantity,
        uint256 usdAmountMinor,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.SETTLEMENT_CONFIRMER_ROLE) {
        RedemptionFacts storage facts = _active(workflowId);
        require(facts.domesticExecutionConfirmed, "domestic execution is not confirmed");
        require(quantity == facts.executedQuantity && quantity != 0, "settlement quantity mismatch");
        require(usdAmountMinor != 0, "sale proceeds are zero");
        require(!facts.saleProceedsSettled, "sale proceeds already settled");
        _consumeEvidence(evidenceHash);
        facts.saleProceedsSettled = true;
        facts.usdAmountMinor = usdAmountMinor;
        emit SaleProceedsSettled(workflowId, quantity, usdAmountMinor, evidenceHash);
    }

    function confirmRightsTerminated(
        bytes16 workflowId,
        address token,
        address investor,
        uint256 quantity,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.REDEMPTION_RIGHTS_APPROVER_ROLE) {
        RedemptionFacts storage facts = _matching(workflowId, token, investor, quantity);
        require(facts.saleProceedsSettled, "sale proceeds are not settled");
        require(!facts.rightsTerminated, "rights already terminated");
        _consumeEvidence(evidenceHash);
        facts.rightsTerminated = true;
        emit RightsTerminated(workflowId, quantity, evidenceHash);
    }

    function confirmCashClaim(
        bytes16 workflowId,
        uint256 quantity,
        uint256 usdAmountMinor,
        bytes32 evidenceHash
    ) external onlyRole(RoleIds.REDEMPTION_RIGHTS_APPROVER_ROLE) {
        RedemptionFacts storage facts = _active(workflowId);
        if (!facts.rightsTerminated) revert MissingIndependentApproval(workflowId, RIGHTS_TERMINATED);
        require(quantity == facts.executedQuantity, "cash claim quantity mismatch");
        if (usdAmountMinor != facts.usdAmountMinor) revert PaymentMismatch(facts.usdAmountMinor, usdAmountMinor);
        require(!facts.cashClaimConfirmed, "cash claim already confirmed");
        _consumeEvidence(evidenceHash);
        facts.usdAmountMinor = usdAmountMinor;
        facts.cashClaimConfirmed = true;
        emit CashClaimConfirmed(workflowId, quantity, usdAmountMinor, evidenceHash);
    }

    function markBurnPending(bytes16 workflowId) external onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE) {
        RedemptionFacts storage facts = _active(workflowId);
        if (!facts.rightsTerminated) revert MissingIndependentApproval(workflowId, RIGHTS_TERMINATED);
        if (!facts.cashClaimConfirmed) revert MissingIndependentApproval(workflowId, CASH_CLAIM);
        require(!facts.burnPending, "burn already pending");
        facts.burnPending = true;
        RestrictedEquityToken(facts.token).markBurnPending(
            workflowId,
            facts.investor,
            facts.executedQuantity,
            keccak256(abi.encode(workflowId, facts.executedQuantity, facts.usdAmountMinor, "BURN_PENDING"))
        );
    }

    function approveUsdPayment(bytes16 workflowId, uint256 usdAmountMinor, bytes32 evidenceHash)
        external
        onlyRole(RoleIds.PAYMENT_APPROVER_ROLE)
    {
        RedemptionFacts storage facts = _active(workflowId);
        if (!facts.cashClaimConfirmed) revert MissingIndependentApproval(workflowId, CASH_CLAIM);
        if (usdAmountMinor != facts.usdAmountMinor) revert PaymentMismatch(facts.usdAmountMinor, usdAmountMinor);
        require(!facts.usdPaymentApproved, "payment already approved");
        _consumeEvidence(evidenceHash);
        facts.usdPaymentApproved = true;
        emit UsdPaymentApproved(workflowId, usdAmountMinor, evidenceHash);
    }

    function executeBurn(bytes16 workflowId) external onlyRole(RoleIds.REDEMPTION_EXECUTOR_ROLE) {
        RedemptionFacts storage facts = _active(workflowId);
        if (!facts.burnPending) revert MissingIndependentApproval(workflowId, BURN_PENDING);
        if (!facts.usdPaymentApproved) revert MissingIndependentApproval(workflowId, PAYMENT_APPROVAL);
        require(!facts.burned, "redemption already burned");
        facts.burned = true;
        RestrictedEquityToken(facts.token).burnPending(
            workflowId,
            facts.investor,
            facts.executedQuantity,
            keccak256(abi.encode(workflowId, facts.usdAmountMinor, "EXECUTE_BURN"))
        );
    }

    function _active(bytes16 workflowId) private view returns (RedemptionFacts storage facts) {
        facts = _redemptions[workflowId];
        require(facts.locked && !facts.cancelled, "redemption is not active");
    }

    function _matching(bytes16 workflowId, address token, address investor, uint256 quantity)
        private
        view
        returns (RedemptionFacts storage facts)
    {
        facts = _active(workflowId);
        require(
            facts.token == token && facts.investor == investor && facts.executedQuantity == quantity,
            "redemption evidence mismatch"
        );
    }
}
