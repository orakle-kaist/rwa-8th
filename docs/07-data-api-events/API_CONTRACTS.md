# 7단계 API 계약

상태: **7단계 팀 내부 승인 완료**

이 문서는 투자자 앱, 통합 기관 콘솔과 모의 기관 어댑터가 주고받는 HTTP 계약을 정한다. 기계 판독 기준은 [플랫폼 OpenAPI](specs/openapi.platform.yaml)와 [어댑터 OpenAPI](specs/openapi.adapters.yaml)다.

5단계 상태축과 6단계 구성요소가 어떤 API와 연결되는지는 [기계 추적표](specs/traceability.json)에서 함께 확인한다.

## 1. 처리 원칙

- 기본경로는 `/api/v1`이다.
- 조회는 현재 투영과 완전성을 반환한다.
- 상태변경 명령은 업무 완료가 아니라 `202 Accepted`를 반환한다.
- 명령 결과는 비동기 이벤트로 반영하고 클라이언트는 업무 조회와 증거 흐름을 다시 조회한다.
- 화면은 REST 조회를 사용한다. WebSocket과 SSE는 사용하지 않는다.
- 실제 개인정보와 실제 기관 API를 사용하지 않는다.

## 2. 인증과 권한

PoC는 역할과 기관이 포함된 합성 Bearer 토큰을 사용한다.

| 역할 | 허용 범위 |
|---|---|
| 투자자 | 자기 계좌, 주문, 보유권리, 환매와 권리업무 |
| 토큰 플랫폼 운영 | 업무 조정, 토큰 실행과 예외 대기열 |
| 해외 증권사 계좌 및 준법 | 적격성, 지갑, 투자자 보호와 민원 |
| 해외 증권사 주문 및 권리 | 주문 취합, 위험 승인, 권리기입, 자금과 보고 |
| 국내 주문집행 | 국내 주문 접수, 체결, 취소와 정정 결과 |
| 수탁 및 상임대리 | 수탁수량, 배당, 의결권과 기업행동 확인 |
| 지정 시장조성자 | 호가, 재고와 헤지 |
| 준법 및 감사 | 대사, 격리, 보정과 재개 승인 |
| 모의 어댑터 | 허용된 기관 이벤트 제출만 가능 |

역할화면 전환은 토큰의 역할을 바꾸지 않는다. 금지된 호출은 `403 ROLE_FORBIDDEN`을 반환한다.

## 3. 공통 HTTP 규칙

모든 상태변경 `POST`에는 다음 헤더가 필요하다.

- `Authorization: Bearer <synthetic-token>`
- `Idempotency-Key`: 호출자와 경로 범위에서 유일한 값
- `X-Correlation-Id`: UUID

같은 호출자, 경로, 키와 같은 본문이면 기존 `workflowId`와 결과를 반환한다. 같은 키로 다른 본문을 보내면 `409 IDEMPOTENCY_CONFLICT`다.

명령 접수 응답은 다음 값만 보장한다.

```json
{
  "requestId": "UUID",
  "workflowId": "UUID",
  "status": "ACCEPTED",
  "statusUrl": "/api/v1/workflows/UUID"
}
```

`202`는 체결, 결제, 권리기입, 토큰 실행이나 지급의 성공을 뜻하지 않는다.

## 4. 공통 조회

| 경로 | 사용자 | 결과 |
|---|---|---|
| `GET /session` | 전체 | 합성 사용자, 역할과 기관. 투자자에게는 고객확인, 보호판정, 지갑, 주문 및 권리수령 가능 여부와 차단사유를 함께 제공한다. |
| `GET /products` | 전체 | 상품목록, 대표 시연종목 여부, 기능별 가능상태와 기준정보 버전 및 차단사유 |
| `GET /products/{securityId}` | 전체 | 상품 상세, 가격 기준시각, 중지사유와 토큰주소 |
| `GET /positions` | 투자자와 기관 | 결제 대기, 거래 가능, 환매 잠금, 소각 대기와 지급청구 |
| `GET /activities` | 투자자와 기관 | 주문, 권리, 자금과 토큰 활동 |
| `GET /workflows/{workflowId}` | 관련 사용자 | 독립 상태축의 현재값과 투영 완전성 |
| `GET /workflows/{workflowId}/timeline` | 관련 사용자 | 명령, 기관사실, 승인, 체인 결과와 정정 계보 |
| `GET /disclosures/current` | 투자자와 기관 | 현재 적용 위험공시, 버전, 유효기간과 책임기관 |
| `GET /disclosure-consents/current` | 투자자와 기관 | 현재 공시 동의의 유효, 누락 또는 만료 상태 |
| `GET /complaints` | 투자자와 기관 | 권한 범위의 민원 목록과 책임기관 및 처리상태 |
| `GET /complaints/{complaintId}` | 관련 사용자 | 민원, 관련 주문, 공시 버전, 답변 참조, 정정 연결과 종결 근거 |

목록 조회는 `limit`과 불투명 `cursor`를 사용한다. 모든 조회에는 `projectionAsOf`, `lastEventSequence`와 `projectionStatus`가 포함된다.

## 5. 투자자 명령

| 경로 | 핵심 입력 | 비동기 완료조건 |
|---|---|---|
| `POST /wallet-link-requests` | 지갑, 소유확인 서명 | 계좌 담당 승인과 적격성 반영 |
| `POST /wallet-replacement-requests` | 기존 및 새 지갑, 교체사유 | 기존지갑 동결, 두 승인과 복구 실행 |
| `POST /disclosure-consents` | 공시 ID, 버전, 전자 동의시각 | 동의 유효상태와 주문 연결 가능 여부 반영 |
| `POST /complaints` | 민원 종류, 제목, 내용, 관련 업무와 공시 버전 | 책임기관 배정, 답변, 정정 연결 또는 종결 |
| `POST /primary-orders` | 1차 주문 서명, 종목, 수량, KRW 지정가격, 거래일, 자금경로 | 국내 체결, 권리기입, 발행과 T+2 두 확인 |
| `POST /primary-orders/{orderId}/cancellations` | 취소사유 | 국내 제출 전 취소 또는 기관 취소결과 |
| `POST /redemptions/{redemptionId}/cancellations` | 취소사유 | 국내 매도 제출 전 권리와 토큰 잠금해제 또는 제출 뒤 거절 |
| `GET /quotes` | 종목, 자금경로와 방향 | 유효한 지정 시장조성자 호가 조회 |
| `POST /secondary-orders` | 투자자 서명과 `quoteId` | 토큰, 권리와 자금 확정 또는 격리 |
| `POST /redemptions` | 환매 서명, 수량과 KRW 지정가격 | 매도대금 결제, 지급청구, 소각과 USD 지급 |
| `POST /dividend-conversions` | 배당지급 ID와 견적 동의 | USDC 지급 또는 USD 예약해제 |
| `POST /voting-instructions` | 안건, 찬성, 반대 또는 기권 | 해외 증권사 승인과 상임대리인 모의 결과 |

소수수량, 시장가, 결제 대기 수량의 24/7 거래와 환매는 동기 검증에서 거절한다.

## 6. 기관 콘솔 명령

| 경로 | 용도 |
|---|---|
| `GET /institution/tasks` | 역할별 승인, 정정과 예외 대기열 조회 |
| `POST /institution/tasks/{taskId}/decisions` | 승인, 거절 또는 보정요청. task 유형별 schema 사용 |
| `POST /market-maker/quotes` | 만료시각이 있는 지정가 호가 제출 |
| `GET /market-maker/positions` | 결제완료 재고, 순포지션과 위험한도 조회 |
| `GET /market-maker/hedges` | 다음 KRX 개장 헤지 대기열 조회 |
| `POST /market-maker/hedges/{hedgeId}/decisions` | 제출 승인, 보류 또는 취소 |
| `POST /reconciliations` | 같은 기준시각의 두 축 대사 실행 요청 |
| `GET /holds` | 고객, 종목, 자금경로와 전체 중지 조회 |
| `POST /holds/{holdId}/release-decisions` | 보정, 전체 재대사와 독립 승인 뒤 재개 |
| `GET /regulatory-reports` | 월말 보고 생성, 제출, 접수와 정정증거 조회 |
| `POST /regulatory-reports/{reportId}/submission-results` | 접수 또는 실패와 정정 연결 |
| `POST /institution/complaints/{complaintId}/assignments` | 플랫폼 또는 해외 증권사를 책임기관으로 배정 |
| `POST /institution/complaints/{complaintId}/processing-starts` | 책임기관이 처리 시작과 내부 담당 참조번호 기록 |
| `POST /institution/complaints/{complaintId}/responses` | 답변 참조번호와 투자자 제공시각 기록 |
| `POST /institution/complaints/{complaintId}/correction-links` | 원기록을 바꾸지 않고 별도 정정 업무 연결 |
| `POST /institution/complaints/{complaintId}/closures` | 답변과 필요한 정정 결과 확인 뒤 종결 |

`institution/tasks`는 업무를 일반화하지만 `taskType`별 입력은 JSON Schema `oneOf`로 제한한다. 임의의 상태명이나 자유형 승인 payload는 허용하지 않는다.

## 7. 모의 기관 어댑터

플랫폼은 다음 어댑터 명령을 보낸다.

- 국내 주문 제출, 취소와 정정조회
- 자금 예약, 확정, 해제와 USDC 전환
- KSD 결제조회
- 수탁수량, 배당, 의결권과 기업행동 조회

모의 어댑터는 명령을 `202`로 접수하고 나중에 `POST /api/v1/adapter-events`로 결과를 돌려준다. 동기 응답 본문에 체결이나 결제완료를 넣지 않는다.

어댑터 이벤트에는 `eventId`, `sourceInstitutionId`, `sourceSequence`, `sentAt`, `keyId`, `signature`와 업무 payload가 필요하다. 서명은 Ed25519로 검증하며 서명대상은 서명필드를 제외한 RFC 8785 방식의 정규화 JSON이다.

## 8. 오류 응답

모든 오류는 한국어 설명, 재시도 가능 여부, 책임 역할과 다음 행동을 함께 제공한다.

```json
{
  "code": "QUOTE_EXPIRED",
  "messageKo": "호가 유효시간이 끝났다.",
  "retryable": true,
  "requestId": "UUID",
  "correlationId": "UUID",
  "responsibleRole": "MARKET_MAKER",
  "nextActionKo": "새 호가를 조회한다."
}
```

| HTTP | 대표 코드 |
|---:|---|
| 400 | `REQUEST_MALFORMED` |
| 401 | `AUTH_TOKEN_INVALID` |
| 403 | `ROLE_FORBIDDEN` |
| 404 | `RESOURCE_NOT_FOUND` |
| 409 | `IDEMPOTENCY_CONFLICT`, `STATE_CONFLICT`, `EVENT_SEQUENCE_GAP`, `RECONCILIATION_MISMATCH` |
| 422 | `INTEGER_QUANTITY_REQUIRED`, `STALE_DATA`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_SETTLED_RIGHTS`, `QUOTE_EXPIRED`, `PENDING_TOKEN_LOCKED` |
| 423 | `WORKFLOW_HELD` |
| 429 | `RATE_LIMITED` |
| 503 | `DEPENDENCY_UNAVAILABLE` |

`DVP_REVERTED`, `RIGHTS_LEDGER_CONFIRMATION_FAILED`와 `MANUAL_REVIEW_REQUIRED`는 비동기 업무결과일 수 있다. 이미 기준 기록이 바뀐 뒤에는 단순 HTTP 실패로 원상복구됐다고 표현하지 않는다.

## 9. 승인 기준

- [x] 모든 상태변경 명령이 `202`와 조회 가능한 업무 ID를 반환한다.
- [x] 모든 명령에 멱등키, 상관관계 ID와 역할통제가 있다.
- [x] 투자자, 기관과 어댑터 API가 같은 공통 schema를 참조한다.
- [x] 결제, 수탁과 체인 완료를 동기 응답으로 가장하지 않는다.
- [x] 불완전하거나 오래된 투영이 신규 자산이동에 사용되지 않는다.
- [x] 오류가 책임 역할과 다음 행동을 설명한다.

이 문서와 데이터 및 이벤트 계약을 함께 승인했으므로 8단계 스마트컨트랙트 설계를 시작할 수 있다.

## 10. 로컬 1차 발행 시연 계약

공식 상품 후보 201개와 별도로 `990001` 로컬 합성 상품만 1차 발행 생애주기에 사용한다. 세션 조회는 이 상품, 참고 지정가, 적용 환율, 합성 고객자금과 서명 도메인을 `localPrimaryScenario`로 제공한다. 이 정보는 실제 삼성전자 상품이나 공식 ISIN을 뜻하지 않는다.

미체결 주문은 유효 거래일이 지난 첫 만료 처리에서 예약 USD를 해제하고 원주문과 만료 이력을 보존한다. 결제불이행은 먼저 요청 단위로 격리한다. 이후 인가 해외 증권사가 `대체주식 조달` 또는 `약관상 현금보상`을 선택하며, 현금보상액은 플랫폼 계산값이 아니라 기관이 입력하고 승인한 USD 센트 금액으로 기록한다.

`POST /primary-orders`는 투자자의 EIP-712 주문 의사, 정수 수량, KRW 지정가격, 요청일, 유효 거래일과 USD 또는 USDC 자금경로를 검증한다. `GET /primary-orders`는 예약과 전환금액, 체결과 배분수량, 권리기입, 선발행, 국내 결제와 수탁 확인을 분리해 반환한다. USDC는 합성 1대1 전환 뒤 USD 장부에 귀속하며 미체결분은 USD로 해제한다.

기관 업무 결정은 국내 체결과 배분, T+2 위험, 권리기입 승인, 실제 권리 원장 반영, 국내 결제와 수탁수량 확인을 서로 다른 역할로 받는다. 모의 기관 결과는 프로세스 실행 중 만든 Ed25519 키, 기관별 순번과 이벤트 ID를 사용해 `/adapter-events`로 수신한다. 중복은 기존 결과를 가리키고 순번 공백은 처리하지 않는다.
