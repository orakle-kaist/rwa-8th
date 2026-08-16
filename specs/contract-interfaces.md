# 논리 컨트랙트 인터페이스

이 문서는 Solidity ABI를 강제하지 않지만 public behavior, caller role, guard와 event를 강제한다. 구현이 EVM이면 아래 이름과 파라미터 의미를 ABI에 보존한다.

## 공통 타입

```text
InstrumentId = bytes32
ParticipantId = bytes32
EvidenceId = bytes32
PolicyDecisionId = bytes32
Quantity = uint256, integer shares only
```

모든 privileged method는 `reasonCode`와 `evidenceHash`를 받아 감사 이벤트에 포함한다.

## `EntitlementToken`

| Method | Caller | Guard | Effect/Event |
|---|---|---|---|
| `canSend(account, amount)` | anyone/read | eligibility, freeze, balance, policy validity | bool+reason |
| `canReceive(account, amount)` | anyone/read | eligibility, jurisdiction action | bool+reason |
| `canTransfer(from, to, amount)` | anyone/read | send+receive+instrument rules | bool+reason |
| `transferWithDecision(from, to, amount, tradeId, decisions)` | `DVP_SETTLEMENT` | current decisions, no hold | balances; `TransferWithPolicy` |
| `mintBacked(to, amount, issuanceId)` | `ISSUANCE_CONTROLLER` | controller already verified | supply; `BackedMint` |
| `burnForRedemption(from, amount, redemptionId)` | `ISSUANCE_CONTROLLER` | CASH_READY redemption | supply; `RedemptionBurn` |
| `setFrozenTokens(account, amount, reasonCode, evidenceHash)` | `FREEZE_OPERATOR` + approval | amount<=balance | freeze; ERC-7943-compatible event |
| `forcedTransfer(from, to, amount, reasonCode, evidenceHash)` | `ENFORCEMENT_OPERATOR` + approval | legal/incident evidence, receiver eligible | forced transfer audit |
| `pause(reasonCode, evidenceHash)` | emergency dual control | two distinct approvals | pause |
| `unpause(reasonCode, evidenceHash)` | resume dual control | full reconciliation PASS | resume |

일반 ERC-20 `transfer`와 `transferFrom`을 노출하면 동일한 policy guard를 우회할 수 없어야 한다.

## `EligibilityRegistry`

```text
recordEligibility(
  participantId,
  wallet,
  allowedActions,
  validUntil,
  policyDecisionIds,
  evidenceHash
)

suspendEligibility(participantId, reasonCode, evidenceHash)
getEligibility(participantId, action) -> status, validUntil, decisionIds
```

Caller는 `COMPLIANCE_OPERATOR`; record/suspend에는 독립 승인 정책을 적용한다. PII 문자열 또는 해시 인자는 제공하지 않는다.

## `PolicyRegistry`

```text
publishPolicy(policyId, version, contentHash, effectiveFrom, effectiveUntil)
recordDecision(decisionId, profileId, participantId, instrumentId, action, result, validUntil, evidenceHash)
revokeDecision(decisionId, reasonCode, evidenceHash)
isAllowed(decisionId, participantId, instrumentId, action, at) -> bool
```

`profileId`는 임의 ID다. core contract는 `HK`, `US`, `SG` 문자열을 분기조건으로 사용하지 않는다.

## `ReserveRegistry`

```text
recordAttestation(
  attestationId,
  instrumentId,
  settledCustody,
  tokenizedBacking,
  asOf,
  evidenceHash,
  approvals
)

consumeForIssuance(attestationId, settlementId, quantity, issuanceId)
releaseAfterRedemption(attestationId, redemptionId, quantity)
getReserve(instrumentId) -> settledCustody, tokenizedBacking, asOf, status
```

`recordAttestation`은 수탁기관과 독립 통제 서명을 모두 검증한다. 공급량 아래로 backing을 줄일 수 없다. 소비된 settlement/evidence 조합은 재사용할 수 없다.

## `IssuanceController`

```text
issue(
  issuanceId,
  orderId,
  participantId,
  instrumentId,
  quantity,
  custodySettlementId,
  reserveAttestationId,
  policyDecisionIds
) -> transactionHash

burn(redemptionId, participantId, instrumentId, quantity, dispositionEvidenceId)
```

`issue`는 `INV_MINT_AFTER_SETTLEMENT`, `INV_MINT_EVIDENCE_SINGLE_USE`, 공급·준비금 불변식을 모두 검사하고 evidence consumption과 mint를 한 트랜잭션으로 처리한다.

## `DvPSettlement`

```text
preflight(tradeInstruction) -> allowed, reasonCode
settle(tradeInstruction) -> DvPResult
```

`settle`은 양쪽 EIP-712 signature, nonce, policy decision, token/cash balance, freeze와 hold를 검증한다. 자산과 현금 transfer는 동일 트랜잭션 안에서 실행한다. retry는 새 trade ID를 요구한다.

## `DepositToken`

```text
issueToSettlementWallet(fundingId, wallet, amount)
transferForDvP(from, to, amount, tradeId)
redeemFromSettlementWallet(redemptionId, wallet, amount)
```

`SETTLEMENT_BANK`와 `DVP_SETTLEMENT`만 호출할 수 있다. metadata에 `DEMO_ONLY`, `NO_REAL_DEPOSIT_CLAIM`을 노출한다.

## `CorporateActionRegistry`

```text
announce(actionId, instrumentId, recordDate, evidenceHash)
recordSnapshot(actionId, snapshotHash, totalEligibleQuantity)
recordCash(actionId, grossAmount, bankEvidenceHash)
recordTaxAllocation(actionId, allocationHash, taxTotal, netTotal, fees, residual)
recordPayout(actionId, payoutHash)
reconcile(actionId, reconciliationId)
```

정의된 상태 순서를 건너뛸 수 없다. gross equation이 맞지 않으면 payout을 거절하고 hold event를 낸다.

## 필수 이벤트

```text
PolicyDecisionRecorded
EligibilityChanged
ReserveAttestationRecorded
CustodyEvidenceConsumed
BackedMint
RedemptionBurn
TradeAtomicallySettled
TokensFrozen
ForcedTransfer
SystemPaused
SystemResumed
CorporateActionUpdated
ReconciliationHoldPlaced
PrivilegedActionAudited
```

이벤트에는 domain ID만 넣고 PII, 외부 증거 원문, 실제 계좌번호를 넣지 않는다.
