# Korean Equity RWA Institutional PoC

이 프로젝트는 비거주 일반 개인투자자가 해외 금융기관을 통해 한국 상장주식에 접근할 수 있도록 `한국형 규제 수탁 권리의 24/7 2차시장 통제`를 설계하고 검증하는 PoC다. Dinari의 수탁형 토큰화 주식을 참고하되 한국의 외국인 통합계좌, KRX 거래, KSD 법적 장부, T+2 결제와 권리관리 구조에 맞춘다.

> 현재 상태: **10단계 PoC 구현 중 — 24/7 제한 거래 기능 구현 완료, 사용자 검토 대기**
>
> 다음 행동: 이번 기능을 검토한 뒤 시장조성자 헤지 기능을 구현한다.
>
> 실제 PoC 코드 구현: **10단계**에서 시작한다.

실제 자금, 주식 또는 개인정보를 다루지 않으며 이 저장소의 팀 내부 승인은 법률의견, 기관 승인이나 인허가 적합성 확인을 뜻하지 않는다.

## 처음 읽는 순서

처음 보는 사람은 다음 네 문서만 순서대로 읽으면 프로젝트의 목적과 구현 범위를 이해할 수 있다.

1. [마스터 설계](docs/01-master/MASTER.md): 왜 이 구조를 선택했고 어떤 권리를 다루는지 설명한다.
2. [PoC 목표와 성공 기준](docs/02-poc-definition/POC_GOALS.md): 무엇을 구현하고 무엇을 통과로 판단하는지 정한다.
3. [제품 요구사항](docs/03-product-requirements/PRD.md): 제품이 반드시 제공해야 할 기능을 정한다.
4. [전체 작업 순서](docs/00-project/WORKFLOW.md): 설계부터 구현과 결과 정리까지 11단계를 안내한다.

## 단계별 기준 문서

| 단계 | 상태 | 산출물 | 언제 읽는가 |
|---|---|---|---|
| 0. 프로젝트 관리 | 계속 갱신 | [작업 순서](docs/00-project/WORKFLOW.md), [결정 기록](docs/00-project/DECISIONS.md) | 현재 단계와 확정된 결정 및 남은 쟁점을 확인할 때 |
| 1. 마스터 확정 | 승인 완료 | [마스터 설계](docs/01-master/MASTER.md) | 프로젝트 목적, 권리 구조, 기관 역할과 범위를 이해할 때 |
| 2. PoC 정의 | 승인 완료 | [목표와 성공 기준](docs/02-poc-definition/POC_GOALS.md), [시험 데이터](docs/02-poc-definition/POC_TEST_DATA.md) | 구현 범위, 불변식, 대표 종목과 합성 통제값을 확인할 때 |
| 3. 제품 요구사항 | 승인 완료 | [제품 요구사항](docs/03-product-requirements/PRD.md) | 사용자와 기관에 필요한 기능 및 완료 조건을 확인할 때 |
| 4. 기관 업무 설계 | 승인 완료 | [기관 업무와 책임](docs/04-institution-design/INSTITUTION_WORKFLOWS.md), [종목 기준정보](docs/04-institution-design/REFERENCE_DATA.md) | 업무 인계, 기준 장부, 승인 책임과 데이터 원본을 확인할 때 |
| 5. 제품 동작 설계 | 승인 완료 | [화면 흐름](docs/05-screens-states-recovery/SCREEN_FLOWS.md), [상태와 전환](docs/05-screens-states-recovery/STATE_MODEL.md), [오류와 복구](docs/05-screens-states-recovery/ERROR_AND_RECOVERY.md) | 화면, 업무 상태, 차단, 격리와 재개 규칙을 확인할 때 |
| 6. 시스템 구조와 보안 | 승인 완료 | [시스템 구조](docs/06-architecture-security/ARCHITECTURE.md), [기술 선택](docs/06-architecture-security/TECHNOLOGY_DECISIONS.md), [보안과 개인정보](docs/06-architecture-security/SECURITY_AND_PRIVACY.md) | 구성요소, 토큰과 체인 및 외부정보, 권한과 키, 개인정보와 위협 통제를 확인할 때 |
| 7. 데이터와 연계 | 승인 완료 | [공통 데이터](docs/07-data-api-events/DATA_MODEL.md), [API 계약](docs/07-data-api-events/API_CONTRACTS.md), [이벤트 계약](docs/07-data-api-events/EVENT_CONTRACTS.md)과 [기계 명세](docs/07-data-api-events/specs/) | 공통 데이터, API와 이벤트를 설계할 때 |
| 8. 스마트컨트랙트 | 승인 완료 | [계약 구조](docs/08-smart-contract-design/CONTRACT_ARCHITECTURE.md), [계약 인터페이스](docs/08-smart-contract-design/CONTRACT_INTERFACES.md), [역할과 변경관리](docs/08-smart-contract-design/ROLES_AND_GOVERNANCE.md), [불변식](docs/08-smart-contract-design/INVARIANTS.md)과 [기계 명세](docs/08-smart-contract-design/specs/contract-manifest.json) | 제한형 권리토큰의 발행, 상태, 정산, 환매, 복구와 권한을 확인할 때 |
| 9. 테스트 설계 | 승인 완료 | [테스트 전략](docs/09-test-design/TEST_STRATEGY.md), [테스트 시나리오](docs/09-test-design/TEST_SCENARIOS.md), [fixture와 증거](docs/09-test-design/FIXTURES_AND_EVIDENCE.md), [시연 확인표](docs/09-test-design/DEMO_CHECKLIST.md)와 [기계 명세](docs/09-test-design/specs/) | 구현 전 요구사항, 상태, API와 계약에 연결된 시험 기준을 확인할 때 |
| 10. PoC 구현 | 구현 중 | [구현 안내](docs/10-poc-implementation/IMPLEMENTATION_GUIDE.md), [제한형 토큰 기반 증거](docs/10-poc-implementation/TOKEN_FOUNDATION_EVIDENCE.md), [고객·상품·투자자 보호 증거](docs/10-poc-implementation/ELIGIBILITY_AND_PROTECTION_EVIDENCE.md), [1차 발행과 T+2 증거](docs/10-poc-implementation/PRIMARY_ISSUANCE_EVIDENCE.md), [24/7 제한 거래 증거](docs/10-poc-implementation/SECONDARY_TRADING_EVIDENCE.md)와 구현 코드 | 승인된 9단계 시험 기준에 따라 설계를 실제 코드로 만들고 검증할 때 |
| 11. 결과 정리 | 시작 전 | `docs/11-results/` 예정 | 시연 결과, 확인된 사실과 한계를 정리할 때 |

10단계 이후 폴더는 해당 단계가 시작될 때 만든다. 빈 폴더나 내용이 정해지지 않은 문서를 미리 만들지 않는다.

## 역할별 읽는 순서

- 기관 업무 검토자: [마스터](docs/01-master/MASTER.md) → [기관 업무](docs/04-institution-design/INSTITUTION_WORKFLOWS.md) → [기준정보](docs/04-institution-design/REFERENCE_DATA.md) → [오류와 복구](docs/05-screens-states-recovery/ERROR_AND_RECOVERY.md)
- 화면 및 개발 담당자: [제품 요구사항](docs/03-product-requirements/PRD.md) → [화면](docs/05-screens-states-recovery/SCREEN_FLOWS.md) → [상태](docs/05-screens-states-recovery/STATE_MODEL.md) → [오류와 복구](docs/05-screens-states-recovery/ERROR_AND_RECOVERY.md)
- 기술 설계 담당자: [결정 기록](docs/00-project/DECISIONS.md) → 재승인된 1~5단계 문서 → [시스템 구조](docs/06-architecture-security/ARCHITECTURE.md) → [기술 선택](docs/06-architecture-security/TECHNOLOGY_DECISIONS.md) → [보안과 개인정보](docs/06-architecture-security/SECURITY_AND_PRIVACY.md) → [계약 구조](docs/08-smart-contract-design/CONTRACT_ARCHITECTURE.md) → [불변식](docs/08-smart-contract-design/INVARIANTS.md)
- 근거 확인 담당자: [마스터](docs/01-master/MASTER.md) → [리서치 브리프](research/korean-equity-rwa/brief.md) → [공식 출처](research/korean-equity-rwa/sources/web/official-sources.md) → [내부 검토](research/korean-equity-rwa/review/human_review.md)

## 저장소에서 자료를 구분하는 법

```text
README.md                         처음 읽는 안내
docs/                             단계별 설계와 프로젝트 결정
  00-project/                     전체 작업 순서와 결정 기록
  01-master/                      1단계
  02-poc-definition/              2단계
  03-product-requirements/        3단계
  04-institution-design/          4단계
  05-screens-states-recovery/     5단계
  06-architecture-security/       6단계
  07-data-api-events/             7단계
  08-smart-contract-design/       8단계
  09-test-design/                 9단계
  10-poc-implementation/          10단계 구현과 검증 증거
research/korean-equity-rwa/
  brief.md                        조사 질문과 범위
  sources/                        공식 자료와 팀 제공 원문
  review/                         내부 검토와 알려진 한계
  _work/                          조사 이력과 기계용 기록
archive/pre-prd-v1/               폐기된 옛 설계, 구현 기준 아님
scripts/                          문서, 링크와 원자료 검증
```

- `docs/`는 단계별 기준 문서의 유일한 위치다. 1~5단계 문서는 정합성 보완까지 승인된 6단계 설계의 입력이다.
- 6단계 세 문서는 2026년 8월 31일 팀 내부 승인된 7단계 설계의 입력이다.
- 7단계 세 문서와 기계 명세는 2026년 8월 31일 팀 내부 승인된 8단계 설계의 입력이다.
- 8단계 네 문서와 계약 명세는 2026년 8월 31일 팀 내부 승인됐으며 9단계 테스트 설계의 입력이다.
- 9단계 네 문서와 기계 명세는 2026년 8월 31일 팀 내부 승인됐으며 10단계 구현과 검수의 기준이다.
- `research/`는 설계의 근거와 조사과정을 보존하지만 승인 문서를 대신하지 않는다.
- `research/korean-equity-rwa/_work/`는 검증과 이력용이므로 일반 독자가 먼저 읽을 필요가 없다.
- `archive/pre-prd-v1/`은 과거 아이디어를 보존한 자료이며 현재 요구사항이나 구현 기준으로 사용하지 않는다.

## 핵심 PoC 경계

PoC는 `1차 지정가 발행 → T+2 결제완료 전환 → 24/7 2차거래 → 시장조성자 헤지 → 1차 환매 → 주식 권리의 환매대금 지급청구 전환 → 토큰 소각과 USD 지급`의 닫힌 흐름을 모의 기관 응답과 합성 데이터로 시연한다. 24/7 2차거래에서는 결제 완료 재고만 적격 투자자와 지정 마켓메이커 사이의 지정가 거래에 사용한다.

24/7 완결 대상은 국내 결제가 끝난 수탁 권리의 제한된 2차거래다. 실제 시장 유동성, 가격 공정성, 시장조성자의 사업성, 일반 개인 판매 가능성이나 규제 허용을 증명하지 않는다.

## 검증

다음 명령은 단계별 필수 문서, 내부 링크, 구조화 데이터, 원자료 체크섬과 승인된 설계 규칙을 확인한다.

```bash
bash scripts/validate-research.sh
```
