# Korean Equity RWA Institutional PoC Design

Dinari의 해외 수탁형 토큰화 주식 사례를 출발점으로 삼되, 외국인의 한국 상장주식 접근 과정에 맞게 계좌, T+2 결제, 수탁, 권리배정, 보고와 국가별 판매규제를 다시 설계한 기관용 프로젝트입니다.

이 저장소의 현재 산출물은 **PoC 코드가 아니라 구현 판단을 제거한 설계 패키지**입니다. 실제 자금·증권을 취급하지 않으며, 법률의견이나 인허가를 대체하지 않습니다.

`final_candidate.md`는 기관·학회 구성원이 전체 제안을 이해하고 판단하는 **사람용 마스터 제안서**입니다. 구현의 규범적 기준은 `design/00_master_proposal.md`와 `specs/`이며, 사람용 제안서에는 코드명·데이터 필드·API 세부사항을 싣지 않습니다.

## 먼저 읽을 문서

1. [기관 검토용 마스터 제안서](research/korean-equity-rwa/drafts/final_candidate.md)
2. [규범적 설계 결정 요약](design/00_master_proposal.md)
3. [법률·상품 경계](design/01_legal_product.md)
4. [운영 모델과 라이프사이클](design/02_operating_model.md)
5. [아키텍처·보안 통제](design/03_architecture_security.md)
6. [데모·인수 기준](design/04_demo_acceptance.md)
7. [위험·2단계 로드맵](design/05_risk_roadmap.md)

구현 에이전트는 위 설명 문서보다 `specs/`의 OpenAPI, AsyncAPI, JSON Schema, 상태기계, 오류 분류 및 BDD 시나리오를 우선해야 합니다. 문서 간 충돌 시 [추적성 매트릭스](specs/traceability-matrix.md)의 우선순위를 따릅니다.

## 한 문장 구조

해외 판매기관이 확인한 투자자와 전용 권리계정·지갑을 국내 외국인 통합계좌 및 상임대리인 수탁계좌에 연결하고, 한국시장의 T+2 결제와 수탁이 완료된 수량만큼만 `1 token = 1 share entitlement`를 발행합니다. 국내 수탁장부, 해외 투자자 권리장부와 허가형 토큰 기록은 서로 대사합니다.

PoC는 같은 거래를 투자자 거래 화면, 토큰화 운영 콘솔, 국내 브로커·수탁 인프라 콘솔에서 각각 보여줍니다. 공개자료로 확인되는 Dinari·Alpaca의 계좌·주문·활동 개념을 참고하되, 비공개 내부 화면이나 실제 업체 연동을 재현한다고 주장하지 않습니다.

## 고정된 설계 원칙

- 코어는 관할 중립적입니다. 한국은 기초자산 관할이고 홍콩은 교체 가능한 첫 참조 판매 관할입니다.
- Dinari의 Regulation S 국제형과 미국 내 완전공개 계좌형은 서로 다른 운영모델로 구분하며, 어느 하나를 한국에 그대로 복제하지 않습니다.
- 1단계 토큰은 직접 주식이나 주주명부상 지위가 아니라 수탁 중인 주식에 대한 계약상·수익적 권리입니다.
- 발행량은 결제 완료된 수탁수량을 초과할 수 없습니다.
- 투자자 PII, 여권번호 및 그 해시는 원장·이벤트·로그에 기록하지 않습니다.
- AI는 설명과 주문 초안만 만들며 주문 확정과 서명은 사람이 수행합니다.
- 1차 KRX 매입은 시장시간과 T+2 외부결제를 따릅니다. 24/7 즉시 유동성을 주장하지 않습니다.
- 2차 권리토큰 거래만 동일 원장 내 원자적 DvP를 사용합니다.

## 저장소 구조

```text
research/korean-equity-rwa/  조사 원본 인덱스, 공식 출처, 최종 후보 보고서, 리뷰 기록
design/                      기관·운영·개발팀이 함께 읽는 모듈형 설계
specs/                       구현 에이전트가 준수할 기계 판독 및 테스트 명세
tmp/                         팀이 제공한 중간발표 자료 원본(변경 금지)
```

## 현재 상태

- 설계 상태: `review-ready`
- 리서치 기준일: `2026-08-17 Asia/Seoul`
- PoC 구현 상태: 미착수
- 승인 상태: 인간 검토 대기

## 설계 검증

Node.js, Python, PyYAML, jsonschema가 준비된 환경에서 다음 한 명령으로 문서·스키마·fixture·출처 체크섬·OpenAPI·AsyncAPI·BDD와 리서치 review gate를 다시 검사할 수 있습니다.

```bash
bash scripts/validate-design.sh
```
