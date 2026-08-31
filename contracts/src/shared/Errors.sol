// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

error DirectTransferDisabled();
error ApprovalDisabled();
error UnauthorizedController(address caller);
error IneligibleWallet(address wallet);
error MarketMakerRequired(address wallet);
error InsufficientAvailableBalance(address wallet, uint256 available, uint256 required);
error ScopePaused(address token, bytes32 scope);
error SignatureExpired(uint256 expiresAt, uint256 currentTime);
error NonceAlreadyUsed(address signer, uint256 nonce);
error PolicyVersionMismatch(bytes32 provided, bytes32 current);
error EvidenceAlreadyUsed(bytes32 evidenceHash);
error MissingIndependentApproval(bytes16 workflowId, bytes32 approvalType);
error IssuanceEvidenceMismatch(bytes16 workflowId);
error AllocationExceeded(uint256 requested, uint256 confirmedAllocation);
error PaymentMismatch(uint256 expected, uint256 actual);
error NonIntegralCorporateAction(address wallet, uint256 quantity, uint256 denominator);
