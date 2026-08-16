# 역할·권한 매트릭스

`E`는 실행, `A`는 공동승인, `R`은 읽기, `—`는 금지다. API gateway와 원장 role 모두 같은 결과를 강제해야 한다.

| 기능 | INVESTOR | FOREIGN_DISTRIBUTOR | KR_BROKER_CUSTODIAN | SETTLEMENT_BANK | COMPLIANCE_OPERATOR | TOKEN_OPERATOR | INDEPENDENT_CONTROL | AUDITOR | AI_AGENT |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 상품·공시 조회 | R | R | R | R | R | R | R | R | R |
| KYC case 생성·원본 조회 | — | E | — | — | R¹ | — | — | — | — |
| 관할 정책 평가 요청 | — | E | E | — | E | — | R | R | — |
| 정책 버전 작성 | — | — | — | — | E | — | — | R | — |
| 정책 배포 승인 | — | — | — | — | A | — | A | R | — |
| 주문 설명·초안 | E | E | R | — | R | — | R | R | E |
| 주문 인간확정·서명 | E | — | — | — | — | — | — | R | — |
| 자금·FX 확인 | R | R | R | E | R | — | R | R | — |
| KRX mock 주문·체결 | R | R | E | — | R | — | R | R | — |
| KSD mock 결제 | R | R | E | — | R | — | R | R | — |
| 준비금 증명 작성 | — | R | E | R | R | R | A | R | — |
| 권리토큰 mint 요청 | — | — | R | — | R | E | R | R | — |
| 현금토큰 발행·소각 | — | — | R | E | R | — | R | R | — |
| 2차 RFQ 제안·서명 | E | E | R | R | R | — | R | R | — |
| DvP 제출 | — | E | E | R | R | — | R | R | — |
| 배당 이벤트·수탁총액 | R | R | E | E | R | — | R | R | — |
| 환매 요청·서명 | E | E | R | R | R | — | R | R | — |
| 토큰 동결 요청 | — | — | E | — | E | — | A | R | — |
| 강제이전 실행 | — | — | E | — | E | — | A | R | — |
| 대사 실행 | — | R | E | R | R | R | A | R | — |
| hold 배치 | — | — | E/A | — | R | — | A | R | — |
| hold 해제 | — | — | A | — | R | — | A | R | — |
| 감사 lineage 조회 | 본인 | 관련고객 | R | R | R | R | R | R | — |
| 공개 anchor 제출 | — | — | — | — | — | — | E | R | — |

¹ 컴플라이언스 운영자의 PII 원본 조회는 case 배정과 필요성 승인을 받은 경우만 허용하며 공용 감사 payload에는 결과만 남긴다.

## 권한 결합 금지

동일 service account 또는 인간 principal에는 다음 조합을 부여하지 않는다.

- `KR_BROKER_CUSTODIAN` 준비금 작성 + `TOKEN_OPERATOR` mint 실행
- `COMPLIANCE_OPERATOR` 정책 작성 + `INDEPENDENT_CONTROL` 정책 승인
- hold 원인 정정 실행 + hold 해제의 두 승인 모두
- `AI_AGENT` + `INVESTOR` 서명 capability
- `SETTLEMENT_BANK` 현금발행 + `TOKEN_OPERATOR` 자산발행

로컬 데모의 role switcher는 화면 컨텍스트만 바꾼다. 실제 API 토큰은 역할별 별도 principal이며 UI에서 role을 바꿨다는 이유로 기존 principal 권한이 확대돼서는 안 된다.

## 2인 승인 규칙

- 요구 승인자: `KR_BROKER_CUSTODIAN` 또는 해당 실행기관 1명 + `INDEPENDENT_CONTROL` 1명
- 두 서명은 다른 `institutionId`, `kid`, principal이어야 한다.
- 승인 payload hash가 완전히 같아야 한다.
- 첫 승인 후 15분 안에 두 번째 승인이 없으면 만료된다.
- 승인 대상: 정책배포, 준비금 증명, 강제이전, 긴급정지·재개, contract upgrade.
