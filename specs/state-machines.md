# 규범적 상태기계

정의되지 않은 전이는 `STATE_TRANSITION_INVALID`다. 같은 명령을 같은 idempotency key로 재전송하면 기존 결과를 반환하며 전이를 다시 수행하지 않는다.

## 1. 투자자 적격성

| From | Command/Event | Guard | To | 실패코드 |
|---|---|---|---|---|
| `DRAFT` | `SubmitKyc` | distributor role | `KYC_PENDING` | `UNAUTHORIZED_ROLE` |
| `KYC_PENDING` | `KycPassed` | signed evidence, no PII payload | `POLICY_PENDING` | `EVENT_SIGNATURE_INVALID` |
| `KYC_PENDING` | `KycFailed` | signed reason | `REJECTED` | — |
| `POLICY_PENDING` | `PolicyDecisionsRecorded` | KR+distribution both ALLOW | `ACTIVE` | `POLICY_DECISION_INCOMPLETE` |
| `POLICY_PENDING` | `PolicyDecisionsRecorded` | any MANUAL_REVIEW | `MANUAL_REVIEW` | — |
| `POLICY_PENDING` | `PolicyDecisionsRecorded` | any DENY | `REJECTED` | `JURISDICTION_POLICY_DENIED` 또는 `KR_ASSET_POLICY_DENIED` |
| `MANUAL_REVIEW` | `Approve` | two distinct required roles | `ACTIVE` | `DUAL_CONTROL_REQUIRED` |
| `MANUAL_REVIEW` | `Reject` | authorized reviewer | `REJECTED` | — |
| `ACTIVE` | `ValidityElapsed` | clock > validUntil | `EXPIRED` | — |
| `ACTIVE` | `Suspend` | sanctions/incident evidence | `SUSPENDED` | — |
| `EXPIRED` | `Refresh` | new KYC case | `KYC_PENDING` | — |
| `SUSPENDED` | `Remediate` | approved evidence | `KYC_PENDING` | `MANUAL_REVIEW_REQUIRED` |

`EXPIRED`, `SUSPENDED`, `REJECTED`에서는 신규 매수·일반 이전을 허용하지 않는다. 환매는 별도 `REDEEM` 정책결정이 `ALLOW`일 때만 시작한다.

## 2. 1차 취득·발행 주문

| From | Trigger | Guard | To | Side effects |
|---|---|---|---|---|
| `DRAFT` | `ConfirmOrder` | displayed hash=typed hash, human signature valid | `CONFIRMED` | signature nonce consumed |
| `CONFIRMED` | `StartFunding` | two policies ALLOW and current | `FUNDING_PENDING` | funding request created |
| `FUNDING_PENDING` | `FundingConfirmed` | bank signature, sufficient amount | `READY_FOR_MARKET` | institution cash reserved |
| `FUNDING_PENDING` | `FundingFailed` | signed failure | `REJECTED` | no token/cash movement |
| `READY_FOR_MARKET` | `MarketExecutionRecorded` | market open, quote fresh, aggregate room sufficient | `EXECUTED` | execution recorded only |
| `READY_FOR_MARKET` | `MarketRejected` | signed reason | `REJECTED` | release funding reservation |
| `EXECUTED` | internal | always | `AWAITING_CUSTODY_SETTLEMENT` | none |
| `AWAITING_CUSTODY_SETTLEMENT` | `CustodySettlementCompleted` | correct execution, quantity and sequence | `BACKED` | custody and reserve workflow update |
| `AWAITING_CUSTODY_SETTLEMENT` | `CustodySettlementFailed` | signed failure | `SETTLEMENT_FAILED` | manual cash unwind |
| `BACKED` | `IssueEntitlement` | all mint invariants pass | `MINTED` | evidence consumed and mint atomic |

부분체결·부분결제는 core demo에서 성공 전이로 구현하지 않는다. 이를 받으면 `PARTIAL_SETTLEMENT_UNSUPPORTED`로 `SETTLEMENT_FAILED`에 보내고 수동 처리한다.

## 3. 2차 RFQ·DvP

| From | Trigger | Guard | To |
|---|---|---|---|
| `PROPOSED` | `EvaluateParties` | seller send, buyer receive, policies current | `POLICY_CHECKED` |
| `POLICY_CHECKED` | `AddSignatures` | seller+buyer EIP-712 signatures | `DUAL_SIGNED` |
| `DUAL_SIGNED` | `LockCash` | buyer cash available, no hold | `CASH_LOCKED` |
| `CASH_LOCKED` | `Settle` | seller token available, signatures unconsumed | `ATOMICALLY_SETTLED` |
| any pre-final | policy/expiry/balance rejection | no state side effect | `REJECTED` |
| `CASH_LOCKED` | ledger revert | atomic rollback | `FAILED` |

`ATOMICALLY_SETTLED`, `REJECTED`, `FAILED`는 terminal이다. `FAILED` 후 재시도는 새 `tradeId`와 새 nonce를 사용한다.

## 4. 현금배당

| From | Trigger | Guard | To |
|---|---|---|---|
| `ANNOUNCED` | `SnapshotRecordDate` | record date reached, token state final | `RECORD_DATE_SNAPSHOTTED` |
| `RECORD_DATE_SNAPSHOTTED` | `CashReceived` | bank/custody signed gross | `CASH_RECEIVED` |
| `CASH_RECEIVED` | `CalculateTax` | per-investor offchain evidence complete | `TAX_CALCULATED` |
| `TAX_CALCULATED` | `PreparePayout` | gross equation matches | `PAYOUT_READY` |
| `PAYOUT_READY` | `Pay` | bank cash available | `PAID` |
| `PAID` | `Reconcile` | all investor payouts accounted | `RECONCILED` |
| any non-terminal | amount/snapshot mismatch | mismatch evidence | `CORPORATE_ACTION_HOLD` |

`grossReceived = taxWithheld + netPayable + fees + residual`을 만족하지 않으면 지급을 시작하지 않는다.

## 5. 환매

| From | Trigger | Guard | To |
|---|---|---|---|
| `REQUESTED` | `EvaluateRedemption` | REDEEM policies ALLOW | `POLICY_CHECKED` |
| `POLICY_CHECKED` | `LockTokens` | available unfrozen quantity | `TOKENS_LOCKED` |
| `TOKENS_LOCKED` | `StartDisposition` | authorized custodian | `UNDERLYING_DISPOSITION_PENDING` |
| `UNDERLYING_DISPOSITION_PENDING` | `DispositionCompleted` | signed evidence | `CASH_READY` |
| `UNDERLYING_DISPOSITION_PENDING` | `DispositionFailed` | signed failure | `REDEMPTION_REVIEW` |
| `CASH_READY` | `Burn` | quantity and evidence match | `BURNED` |
| `BURNED` | `Pay` | settlement cash available | `PAID` |
| `PAID` | `Reconcile` | supply/backing/cash match | `RECONCILED` |

## 6. 대사·hold

| From | Trigger | Guard | To |
|---|---|---|---|
| `RUNNING` | `MismatchDetected` | any mandatory invariant FAIL | `RECONCILIATION_HOLD` |
| `RECONCILIATION_HOLD` | `CollectEvidence` | read-only | `RECONCILIATION_HOLD` |
| `RECONCILIATION_HOLD` | `CorrectionRecorded` | append-only correction event | `RECOVERY_VALIDATION` |
| `RECOVERY_VALIDATION` | `FullReconciliation` | all mandatory invariants PASS | `AWAITING_RESUME_APPROVAL` |
| `RECOVERY_VALIDATION` | `FullReconciliation` | any FAIL | `RECONCILIATION_HOLD` |
| `AWAITING_RESUME_APPROVAL` | `ApproveResume` | two distinct required roles | `RUNNING` |

hold 중 허용: 조회, 감사, 증거수집, 정정 이벤트, 전체 대사, resume 승인.
hold 중 금지: mint, 신규 reserve consumption, secondary DvP, 정책 우회 강제이전.
