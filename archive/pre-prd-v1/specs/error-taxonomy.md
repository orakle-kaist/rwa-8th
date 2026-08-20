# 오류 분류

오류코드는 API·event dead-letter·UI·BDD에서 그대로 사용한다. `retryable=true`는 동일 payload 재전송이 아니라 원인 해소 후 같은 idempotency key로 결과를 조회하거나 명시된 새 명령을 제출할 수 있다는 뜻이다.

| Code | HTTP | Retryable | 의미·처리 |
|---|---:|---:|---|
| `AUTH_TOKEN_INVALID` | 401 | false | JWT 서명·aud·exp·jti 실패 |
| `UNAUTHORIZED_ROLE` | 403 | false | role matrix상 금지된 동작 |
| `DUAL_CONTROL_REQUIRED` | 409 | true | 두 번째 독립 승인 대기 |
| `DUAL_CONTROL_CONFLICT` | 422 | false | 같은 기관·role·principal의 중복 승인 |
| `SCHEMA_INVALID` | 422 | false | JSON Schema 위반 |
| `PII_FIELD_FORBIDDEN` | 422 | false | 공유 payload에 금지 PII key 탐지 |
| `IDEMPOTENCY_CONFLICT` | 409 | false | 같은 key에 다른 payload 사용 |
| `EVENT_DUPLICATE` | 200/202 | false | 이미 처리된 동일 event; 기존 결과 반환/no-op |
| `EVENT_SEQUENCE_GAP` | 409 | true | 예상 sequence보다 큰 번호; missing event 대기 |
| `EVENT_SEQUENCE_REVERSED` | 409 | false | 이미 지난 sequence의 다른 event |
| `EVENT_SIGNATURE_INVALID` | 422 | false | JWS 검증 실패 또는 알 수 없는 kid |
| `EVENT_CLOCK_SKEW` | 422 | true | 30초 초과 clock skew; 시계 보정 필요 |
| `EVENT_DATA_STALE` | 422 | true | 정책별 최대 신선도 초과 |
| `STATE_TRANSITION_INVALID` | 409 | false | 정의되지 않은 from→to 전이 |
| `POLICY_DECISION_INCOMPLETE` | 422 | true | KR 또는 해외 판매 결정 누락 |
| `JURISDICTION_POLICY_DENIED` | 422 | false | 해외 판매 프로파일 DENY |
| `KR_ASSET_POLICY_DENIED` | 422 | false | 한국 자산 프로파일 DENY |
| `MANUAL_REVIEW_REQUIRED` | 409 | true | 사람 심사·승인 대기 |
| `POLICY_DECISION_EXPIRED` | 422 | true | 새 정책평가 필요 |
| `ELIGIBILITY_EXPIRED` | 422 | true | KYC/적격성 갱신 필요 |
| `ELIGIBILITY_SUSPENDED` | 422 | false | 제재·사고 등으로 정지 |
| `KYC_FAILED` | 422 | false | 해외 판매기관의 KYC 결과 실패; 원본 사유는 해당 기관 vault에 보관 |
| `ACCOUNT_LINKAGE_INVALID` | 422 | false | participant·entitlement account·wallet·omnibus/custody ref 연결 누락, 중복 또는 충돌 |
| `ACCOUNT_LINKAGE_SUSPENDED` | 423 | true | remap·키복구·통제조치 중 account linkage 사용 금지 |
| `ORDER_HUMAN_SIGNATURE_REQUIRED` | 422 | true | AI 초안만 있고 인간서명 없음 |
| `ORDER_SIGNATURE_INVALID` | 422 | false | EIP-712 hash·signer·nonce·expiry 실패 |
| `ORDER_EXPIRED` | 422 | true | 새 주문초안 필요 |
| `MARKET_CLOSED` | 422 | true | 다음 허용 시장시간 대기 |
| `QUOTE_STALE` | 422 | true | 새 quote 필요 |
| `PARTIAL_FILL_REVIEW_REQUIRED` | 409 | true | terminal partial fill의 투자자 동의·정산수량·미체결 자금해제 검토 대기 |
| `EXECUTION_CORRECTION_HOLD` | 409 | true | fill correction 또는 bust의 결제·포지션 재대사 전 발행 금지 |
| `FOREIGN_ROOM_DATA_STALE` | 422 | true | 새 aggregate room data 필요 |
| `FOREIGN_ROOM_INSUFFICIENT` | 422 | false | 기초재고 증가 주문 수량 축소 또는 거절 |
| `FUNDING_NOT_CONFIRMED` | 409 | true | 은행·FX 확인 대기 |
| `INSUFFICIENT_CASH` | 422 | true | 현금 확보 후 새 거래지시 필요 |
| `CUSTODY_SETTLEMENT_PENDING` | 409 | true | T+2 결제 대기 |
| `CUSTODY_SETTLEMENT_FAILED` | 422 | false | 발행 금지, 자금 unwind/manual review |
| `PARTIAL_SETTLEMENT_UNSUPPORTED` | 422 | false | core PoC 범위 밖, 수동 처리 |
| `PROJECTION_STALE` | 409 | true | account·order·activity·position projection의 sequence/cursor 미완전, 원천 event 복구 필요 |
| `RESERVE_ATTESTATION_MISSING` | 422 | true | 유효한 이중승인 증명 필요 |
| `RESERVE_ATTESTATION_EXPIRED` | 422 | true | 새 증명 필요 |
| `EVIDENCE_ALREADY_CONSUMED` | 409 | false | mint 증거 재사용 차단 |
| `UNBACKED_MINT_BLOCKED` | 422 | false | 신규 공급이 backing/custody 초과 |
| `TOKEN_BALANCE_INSUFFICIENT` | 422 | true | 가용 토큰 부족 |
| `TOKEN_FROZEN` | 422 | false | 동결수량 이전 금지 |
| `TRADE_SIGNATURES_INCOMPLETE` | 422 | true | 매도·매수자 양쪽 서명 필요 |
| `TRADE_EXPIRED` | 422 | true | 새 trade ID·nonce 필요 |
| `DVP_ATOMIC_REVERT` | 409 | true | 양 자산 미이동; 원인 해소 후 새 trade |
| `CORPORATE_ACTION_AMOUNT_MISMATCH` | 422 | false | gross equation 불일치, 지급 hold |
| `CORPORATE_ACTION_HOLD_ACTIVE` | 409 | true | 정정·대사 전 지급 금지 |
| `REGULATORY_REPORT_OVERDUE` | 409 | true | 월별 최종투자자 보고 제출증거 누락·기한초과, 준법 검토 필요 |
| `REDEMPTION_DISPOSITION_FAILED` | 422 | true | 토큰 잠금 유지, manual review |
| `RECONCILIATION_MISMATCH` | 409 | false | 필수 불변식 실패와 hold 발동 |
| `RECONCILIATION_HOLD_ACTIVE` | 423 | true | mint·2차 DvP 금지 |
| `RECOVERY_RECONCILIATION_REQUIRED` | 409 | true | full reconciliation PASS 필요 |
| `ANCHOR_UNAVAILABLE` | 202 | true | 내부 성공 유지, anchor 재시도 큐 |
| `SEGREGATION_OF_DUTIES_VIOLATION` | 403 | false | 동일 principal이 시장집행과 수탁·준비금 등 금지된 capability를 결합 |

## 메시지 규칙

- `message`에는 PII·실계좌번호·원본 정책증거를 넣지 않는다.
- 사용자 메시지는 다음 행동을 설명하되 법률 결론을 만들지 않는다.
- 내부 stack trace와 원장 private key 정보는 API 응답에서 제외한다.
- 동일 오류상황은 화면·API·event에서 같은 code를 사용한다.
