# 7단계 이벤트 계약

상태: **7단계 팀 내부 승인 완료**

이 문서는 기관 결과, 체인 결과와 내부 상태변경을 잃지 않고 재처리하는 비동기 계약을 정한다. 기계 판독 기준은 [AsyncAPI](specs/asyncapi.yaml)와 [이벤트 JSON Schema](specs/schemas/events.schema.json)다.

상태축별 필수 이벤트와 구성요소별 인터페이스는 [기계 추적표](specs/traceability.json)로 빠짐없이 검사한다.

## 1. 전달 구조

```text
HTTP 명령
  → 업무기록과 발송할 이벤트를 PostgreSQL에 함께 저장
  → 발송함 처리기가 이벤트 전달
  → 업무 모듈이 이벤트 ID와 순번 검사
  → 상태와 조회 투영 갱신
  → 실패하면 재시도 또는 격리
```

별도 Kafka, RabbitMQ와 클라우드 메시지 서비스를 사용하지 않는다. AsyncAPI의 채널은 PostgreSQL 발송함에서 전달되는 논리 흐름을 설명한다.

## 2. 전달 보장

- 전달은 최소 한 번이므로 같은 이벤트가 다시 올 수 있다.
- `eventId`가 같으면 기존 결과를 반환하고 새 효과를 만들지 않는다.
- 기관별 `sourceSequence`가 이미 처리한 순번이면 중복 또는 늦은 정정 여부를 확인한다.
- 예상보다 큰 순번이면 `EVENT_SEQUENCE_GAP`으로 보류하고 누락 이벤트를 요청한다.
- 같은 업무대상의 `aggregateVersion`은 한 단계씩 증가해야 한다.
- 소비가 끝난 뒤에만 처리완료를 기록한다.
- 영구 실패는 원문을 지우지 않고 격리함에 보낸다.

## 3. 이벤트 봉투

모든 이벤트는 다음 공통값을 가진다.

| 필드 | 의미 |
|---|---|
| `eventId` | 이벤트 고유 UUID |
| `eventType` | 점으로 구분한 이름과 `.v1` 버전 |
| `schemaVersion` | payload schema 버전 |
| `occurredAt` | 업무 사실이 발생한 UTC 시각 |
| `recordedAt` | 생산자가 기록한 UTC 시각 |
| `producer` | 이벤트 생산 모듈 또는 기관 |
| `workflowId` | 전체 업무 연결 |
| `correlationId` | 기관과 체인 흐름 연결 |
| `causationId` | 바로 앞 명령 또는 이벤트 |
| `aggregateType`, `aggregateId`, `aggregateVersion` | 순서를 보장할 업무대상 |
| `sourceSequence` | 기관 이벤트면 필수인 기관별 순번 |
| `data` | 이벤트별 payload |

기관 이벤트는 출처정보, `keyId`와 Ed25519 `signature`를 추가한다. 내부 이벤트는 발송함 기록과 생산자 역할을 증거로 사용한다.

## 4. 논리 채널

| 채널 | 생산자 | 소비자 | 내용 |
|---|---|---|---|
| `workflow.events.v1` | 업무 모듈 | 조회 투영, 감사 | 명령 접수, 거절과 상태변경 |
| `institution.events.v1` | 모의 기관 어댑터 | 주문, 결제, 수탁, 자금과 권리 모듈 | 권위 있는 모의 기관 사실과 정정 |
| `chain.events.v1` | 블록체인 연계 | 발행, 24/7, 환매와 대사 | 제출, 확정, 실패와 실제 수량 |
| `reconciliation.events.v1` | 대사 모듈 | 중지, 준법과 감사 | 대사 통과, 불일치와 보정결과 |
| `audit.events.v1` | 모든 제한 업무 | 감사 투영 | 사람 승인, 권한변경, 중지와 재개 |
| `quarantine.events.v1` | 이벤트 처리기 | 운영과 감사 | 순번공백, 서명실패와 영구 처리실패 |
| `investor-protection.events.v1` | 고객과 준법 모듈 | 주문 사전조건과 감사 | 위험공시 전자 동의와 만료 |
| `complaint.events.v1` | 민원 모듈과 책임기관 | 투자자 조회, 준법과 감사 | 접수, 배정, 답변, 정정 연결과 종결 |

## 5. 이벤트 유형

### 5.1 공통 업무

- `workflow.command.accepted.v1`
- `workflow.command.rejected.v1`
- `workflow.state.changed.v1`
- `workflow.correction.recorded.v1`
- `workflow.quarantined.v1`

`workflow.state.changed.v1`은 `stateAxis`, 이전 기계상태, 새 기계상태, 근거와 실행 및 승인 역할을 가진다. 정의되지 않은 전이는 거절한다.

### 5.2 1차 발행과 T+2

- `primary.order.submitted.v1`
- `primary.execution.recorded.v1`
- `primary.execution.corrected.v1`
- `primary.allocation.completed.v1`
- `primary.execution-allocation.confirmed.v1`
- `primary.risk.approved.v1`
- `rights.entry.approved.v1`
- `rights.entry.completed.v1`
- `token.mint.confirmed.v1`
- `domestic.settlement.confirmed.v1`
- `custody.position.confirmed.v1`
- `token.trading-enabled.v1`

체결, 결제, 수탁과 토큰 결과는 서로 다른 이벤트다. 결제와 수탁 두 이벤트가 모두 확인돼야 거래 가능 이벤트를 만들 수 있다.

### 5.3 투자자 보호와 민원

- `disclosure.consent-recorded.v1`
- `complaint.submitted.v1`
- `complaint.assigned.v1`
- `complaint.processing-started.v1`
- `complaint.response-recorded.v1`
- `complaint.correction-linked.v1`
- `complaint.closed.v1`

공유 이벤트에는 민원 본문이나 자유형 기관 답변을 넣지 않는다. 민원 ID, 종류, 책임기관, 관련 주문이나 업무, 공시 버전과 증거 위치만 기록한다.

### 5.4 24/7 거래와 시장조성

- `market-maker.quote.published.v1`
- `market-maker.quote.expired.v1`
- `secondary.order.accepted.v1`
- `secondary.reservation.completed.v1`
- `secondary.chain-settlement.confirmed.v1`
- `secondary.rights-ledger.confirmed.v1`
- `secondary.funds-ledger.confirmed.v1`
- `secondary.trade.completed.v1`
- `market-maker.position.changed.v1`
- `market-maker.hedge.requested.v1`

USDC DvP는 체인에서 함께 성공하거나 함께 실패한다. USD 거래와 두 자금경로의 권리 원장 확인은 체인 밖이므로 별도 완료 이벤트가 필요하다.

### 5.5 환매와 권리업무

- `redemption.locked.v1`
- `redemption.execution.recorded.v1`
- `redemption.cash-claim.created.v1`
- `token.burn.confirmed.v1`
- `redemption.usd-paid.v1`
- `redemption.completed.v1`
- `dividend.snapshot.recorded.v1`
- `dividend.usd-paid.v1`
- `dividend.usdc-converted.v1`
- `vote.instruction.recorded.v1`
- `vote.execution.recorded.v1`
- `corporate-action.hold-placed.v1`
- `corporate-action.adjustment-approved.v1`
- `regulatory-report.submitted.v1`
- `regulatory-report.corrected.v1`

### 5.6 대사, 중지와 복구

- `reconciliation.completed.v1`
- `reconciliation.mismatch-detected.v1`
- `hold.placed.v1`
- `hold.release-approved.v1`
- `hold.released.v1`
- `audit.privileged-action-recorded.v1`

재개는 보정완료, 전체 재대사 통과와 독립 승인이 각각 확인된 뒤에만 가능하다.

## 6. 정정과 사건시간

- 최초 이벤트를 수정하거나 삭제하지 않는다.
- 정정 이벤트는 `correctsEventId`, 정정사유, 새 `asOf`와 영향받은 업무 ID를 가진다.
- `occurredAt`은 기관 사건시간이고 `recordedAt`은 생산자 기록시간이다.
- 늦게 도착한 정상 이벤트와 정정 이벤트를 구분한다.
- 늦은 이벤트가 이미 발행, 이전, 소각 또는 지급한 결과에 영향을 주면 자동 덮어쓰기 대신 격리한다.

## 7. 정보 신선도

| 정보 | 유효 기준 |
|---|---|
| 지정 시장조성자 호가 | 30초 또는 명시된 더 이른 만료시각 |
| 모의 환율, USDC 가격과 위험정보 | 기준시각부터 60초 |
| KRX 마지막 공식 종가 | 다음 예정 개장 전까지. 중요사건, 거래정지 또는 비현금 기업행동이면 즉시 무효 |
| 체결, 결제, 수탁과 기업행동 | 일반 TTL 대신 기관 순번, 정정과 사건상태를 사용 |
| 적격성과 위험공시 동의 | 각 판정의 `validUntil` |

오래된 정보는 관련 범위의 새 승인만 막는다. 가격과 환율 지연으로 환매대금 지급이나 이미 완료된 권리업무를 임의 취소하지 않는다.

## 8. 재시도와 재시작

- 일시 오류는 지수형 지연으로 재시도하되 같은 이벤트 ID와 명령 멱등키를 유지한다.
- 만료된 호가와 주문은 재시도하지 않고 새 주문을 요구한다.
- 시스템 재시작 뒤 발송함의 미완료 기록부터 다시 처리한다.
- 체인 거래는 같은 nonce로 무조건 재전송하지 않고 영수증과 계정 nonce를 먼저 재조회한다.
- 기준 기록 하나가 이미 바뀐 요청은 자동 실패나 삭제 대신 격리한다.

정확한 재시도 횟수와 지연시간은 10단계 운영설정으로 둘 수 있지만 업무상 재시도 가능 여부는 오류코드가 정한다.

## 9. 승인 기준

- [x] 모든 이벤트에 고유 ID, 업무 연결, 원인과 순서정보가 있다.
- [x] 중복 이벤트가 두 번째 자산효과를 만들지 않는다.
- [x] 순번공백과 알 수 없는 주요버전이 격리된다.
- [x] 기관 정정이 원이벤트를 덮어쓰지 않는다.
- [x] 1차 발행, 24/7 거래, 환매와 권리업무의 완료증거가 구분된다.
- [x] PostgreSQL 발송함만으로 재시작 뒤 흐름을 복원할 수 있다.

이 문서와 데이터 및 API 계약을 함께 승인했으므로 8단계 스마트컨트랙트 설계를 시작할 수 있다.
