# 규범적 불변식

아래 식은 구현 방식과 관계없이 항상 만족해야 한다. ID는 테스트·로그·대사결과에서 그대로 사용한다.

## 자산 준비금

### `INV_SUPPLY_BACKING_EQUAL`

정상 운영 상태에서 종목별 유통 토큰 총공급은 토큰화 준비금과 같아야 한다.

```text
totalSupply(instrumentId) == tokenizedBackingQuantity(instrumentId)
```

발행·소각과 준비금 증감이 하나의 업무 전이에서 일시적으로 분리되면 차이는 명시된 `inFlight` 항목이어야 하며 같은 command 완료 전에 0으로 돌아와야 한다.

### `INV_BACKING_NOT_ABOVE_CUSTODY`

```text
tokenizedBackingQuantity(instrumentId) <= settledCustodyQuantity(instrumentId)
```

위반 가능성이 있는 reserve update와 mint는 실행 전 거절한다. 사후 위반을 발견하면 `RECONCILIATION_HOLD`를 즉시 건다.

### `INV_CUSTODY_ALLOCATION_COMPLETE`

```text
settledCustody
== unallocatedCustody + tokenizedBacking + redemptionPendingUnderlying
```

한 주가 두 범주에 중복 포함될 수 없다.

### `INV_TOKEN_BALANCE_COMPLETE`

```text
totalSupply
== circulatingTokens + lockedTokens + settlementEscrowTokens
```

### `INV_ENTITLEMENT_BOOK_MATCH`

```text
sum(activeFinalInvestorEntitlementPositions(instrumentId))
== totalSupply(instrumentId)
```

해외 유통사의 최종투자자 권리장부 합계는 토큰 공급량과 같아야 한다. 차이가 있으면 `RECONCILIATION_HOLD`를 걸고 어느 장부도 다른 장부를 자동 덮어쓰지 않는다.

### `INV_ENTITLEMENT_POSITION_COMPLETE`

```text
totalEntitlementQuantity
== availableQuantity + lockedQuantity + settlementEscrowQuantity
== tokenRecordedQuantity
```

첫 번째 등식은 해외 유통사 권리장부의 투자자별 완결성을 뜻한다. 두 번째 등식은 projection이 `CURRENT`일 때만 성립해야 하며, 불일치 또는 source sequence gap이 있으면 해당 position을 `STALE_OR_INCOMPLETE`로 표시하고 mint·transfer·redemption에 사용하지 않는다.

## 발행·환매

### `INV_MINT_EVIDENCE_SINGLE_USE`

mint에 사용된 `custodySettlementId`와 `reserveAttestationId` 조합은 한 번만 소비할 수 있다. 동일 idempotency key는 기존 결과를 반환하고 다른 payload가 같은 키를 사용하면 `IDEMPOTENCY_CONFLICT`다.

### `INV_MINT_AFTER_SETTLEMENT`

```text
mintAllowed
== custodySettlement.status == COMPLETED
AND reserveAttestation.status == ACTIVE
AND accountLinkage.status == ACTIVE
AND policyDecisions.all(ALLOW and unexpired)
AND eligibility.status == ACTIVE
AND systemHold == false
```

시장 체결만으로는 mint를 허용하지 않는다.

### `INV_ACCOUNT_WALLET_ONE_TO_ONE`

한 시점에 active `participantId`, `entitlementAccountRef`와 `wallet`은 1:1이어야 한다. 같은 wallet 또는 entitlement account를 다른 participant에 연결하는 create/remap은 `ACCOUNT_LINKAGE_INVALID`로 거절한다. remap은 기존 linkage 종료와 새 linkage activation을 하나의 audited workflow로 수행한다.

### `INV_FILL_ACCOUNTING_COMPLETE`

```text
orderQuantity
== cumulativeFilledQuantity + leavesQuantity
```

`PARTIALLY_FILLED`에서는 두 값이 모두 0보다 커야 한다. `EXECUTED`에서는 `leavesQuantity == 0`이어야 한다. terminal partial fill은 `PARTIAL_FILL_REVIEW`이며 승인된 settled filled quantity가 정해지기 전에는 mint할 수 없다.

### `INV_CORRECTION_APPEND_ONLY`

fill correction 또는 bust는 원 `activityId`를 수정·삭제하지 않고 `previousActivityId`로 연결된 새 activity를 추가한다. correction 대상 order는 재결제·대사 완료 전 `RECONCILIATION_HOLD` 또는 order-level hold 상태여야 한다.

### `INV_BURN_AFTER_DISPOSITION_READY`

환매 token burn은 기초주식 처분·이전과 현금준비가 확인된 후 실행한다. 실패한 처분에서는 토큰을 잠근 상태로 `REDEMPTION_REVIEW`에 두고 소각하지 않는다.

## 결제

### `INV_DVP_ATOMIC`

```text
(assetMoved == true AND cashMoved == true)
OR
(assetMoved == false AND cashMoved == false)
```

`true/false` 또는 `false/true` 조합은 관찰 가능해서는 안 된다.

### `INV_REJECTED_NO_EFFECT`

`DENY`, `REJECTED`, `FAILED`로 종료된 명령은 토큰·현금·준비금·적격성·정책 상태를 변경하지 않는다. 실패 로그와 audit event는 생성할 수 있다.

### `INV_NO_REPLAY`

거래 ID, user nonce, EIP-712 signature와 adapter sequence는 재사용할 수 없다.

## 정책·인간 통제

### `INV_DUAL_JURISDICTION_ALLOW`

신규 매수와 2차 수신은 유효한 `KRAssetPolicy`와 해당 해외 `JurisdictionPolicy` 결정이 모두 `ALLOW`여야 한다. profile ID가 `HK`인지 여부는 코어 guard에 들어가지 않는다.

### `INV_HUMAN_SIGNATURE_REQUIRED`

AI 생성 여부와 관계없이 주문 `DRAFT -> CONFIRMED`, 거래 `PROPOSED -> DUAL_SIGNED`에는 유효한 인간 EIP-712 서명이 필요하다. AI service role에는 confirm·settle 권한이 없다.

### `INV_POLICY_TIME_VALID`

정책결정은 `dataAsOf <= evaluationTime <= validUntil`이어야 하고 action·instrument·participant 범위가 일치해야 한다. 만료된 결정은 신규 위험행동에 사용할 수 없다.

### `INV_FOREIGN_ROOM_AT_INVENTORY_CHANGE`

시장 aggregate foreign room 검사는 외국인 기초재고 총량을 증가시키는 주문에 적용한다. 이미 토큰화된 외국인 권리의 외국인 간 이전에서는 aggregate room을 재소비하지 않는다.

## 개인정보·감사

### `INV_NO_SHARED_PII`

원장 calldata·state, event payload, API response, application log와 public anchor input에는 금지 PII key 또는 원본 PII hash가 없어야 한다.

### `INV_EVENT_PROVENANCE`

상태를 변경한 모든 외부 event는 schema, institution signature, active `kid`, source sequence, timestamp와 idempotency 검사를 통과해야 한다.

### `INV_AUDIT_COMPLETE`

모든 privileged action은 actor, role, reason, evidence refs, before/after hash와 승인자를 기록한다. 과거 이벤트는 수정·삭제하지 않고 정정 이벤트로 연결한다.

### `INV_REPORTING_EVIDENCE_COMPLETE`

각 active foreign omnibus account는 월별 `RegulatoryReportingEvidence`를 하나 이상 가져야 한다. evidence는 `reportingPeriod`, `generatedAt`, `submittedAt`, `recipientInstitutionId`, `retentionUntil`, `evidenceRef`를 포함하고 원문·PII는 포함하지 않는다. 기한이 지났는데 `submittedAt`이 없으면 `REGULATORY_REPORT_OVERDUE`이며 configurable order hold를 건다.

## 사고 대응

### `INV_HOLD_FAIL_CLOSED`

`RECONCILIATION_HOLD` 동안 신규 mint, 준비금 증가를 소비하는 발행과 2차 DvP는 금지한다. 조회·감사·증거수집은 허용한다.

### `INV_RESUME_DUAL_CONTROL`

hold 해제에는 `KR_BROKER_CUSTODIAN`과 `INDEPENDENT_CONTROL`의 서로 다른 기관키 서명이 각각 하나씩 필요하다. 동일 서명자·동일 role의 두 서명은 quorum으로 세지 않는다.

## 검증 시점

- 명령 실행 전: guard 관련 불변식
- 원장 트랜잭션 직후: 공급·준비금·DvP 불변식
- event 소비 후: provenance·sequence·멱등성
- 영업일 종료: 수탁·최종투자자 권리·토큰·현금·activity·기업행동 전체 대사
- 월말 및 다음 달 10일: 최종투자자 reporting evidence 생성·제출·보존기한 검증
- 사고 복구 전: 모든 불변식 전체 재실행
