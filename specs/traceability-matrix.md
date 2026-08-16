# 요구사항 추적성 매트릭스

| Requirement | 설계 결정 | Interface/Invariant | Acceptance |
|---|---|---|---|
| REQ-01 기존 통합계좌를 보완 | D-001 | order→custody adapter 경계 | core: market execution before mint |
| REQ-02 1 token = 1 settled share entitlement | D-002 | `INV_SUPPLY_BACKING_EQUAL`, `INV_BACKING_NOT_ABOVE_CUSTODY` | core mint scenario, duplicate evidence failure |
| REQ-03 단일원장 원자적 DvP | D-003 | `DvPSettlement`, `INV_DVP_ATOMIC` | core secondary RFQ, insufficient cash |
| REQ-04 모의 KRW 결제 | D-004 | `DepositToken` | fixture balances, DvP BDD |
| REQ-05 관할중립 코어 | D-005 | `PolicyEvaluationRequest/Decision` | HK profile replacement scenario |
| REQ-06 홍콩은 참조 사례 | D-006 | `HK_DIST_POLICY_001`, `legalStatus` | onboarding and replacement scenarios |
| REQ-07 KRX·T+2 현실성 | D-007 | primary state machine | execution does not mint scenario |
| REQ-08 permissioned RFQ | D-008 | `TradeInstruction` | atomic secondary scenario |
| REQ-09 AI는 초안만 | D-009 | `HumanSignature`, role matrix | AI draft scenario |
| REQ-10 공유 PII 금지 | D-010 | `INV_NO_SHARED_PII`, closed schemas | PII field rejection scenario |
| REQ-11 불일치 안전정지 | D-011 | hold state machine | mismatch and recovery scenarios |
| REQ-12 2단계 별도 승인 | D-012 | legal transition gates | design review checklist |
| REQ-13 외국인 room 정확한 시점 | D-005/D-007 | `INV_FOREIGN_ROOM_AT_INVENTORY_CHANGE` | KT acquisition and internal transfer scenarios |
| REQ-14 중복·순서 이벤트 안전성 | D-011 | event envelope, error taxonomy | duplicate and out-of-order KSD scenarios |
| REQ-15 현금배당 | D-001 | corporate action state machine | core dividend scenario |
| REQ-16 통제된 환매 | D-001/D-011 | redemption state machine | core redemption, disposition failure |
| REQ-17 관리자 역할분리 | D-011 | role matrix, audit event | manual review and recovery scenarios |
| REQ-18 선택적 public anchor | D-003 | architecture trust boundary | anchor failure scenario |

## 변경 규칙

요구사항을 바꾸려면 다음 네 곳을 같은 변경에서 갱신한다.

1. `design/00_master_proposal.md`의 결정 또는 명시적 후속결정
2. 관련 JSON Schema/OpenAPI/AsyncAPI 또는 상태기계
3. 불변식·오류·권한 중 해당 항목
4. 최소 한 개의 성공 또는 실패 BDD 시나리오
