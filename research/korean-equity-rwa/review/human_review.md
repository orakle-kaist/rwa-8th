# 인간 검토 메모

상태: **검토 준비 완료(review-ready)**
기준일: 2026-08-16
대상: `drafts/final_candidate.md` 및 저장소 루트 `design/`, `specs/`

## 내부 품질 게이트

- 외국인 통합계좌, 토큰증권 법제화 일정, Project Hangang, 홍콩 사례와 표준 상태를 공식 원문으로 재검증했다.
- 홍콩은 코어 의존성이 아닌 `HKDistributionPolicy` 참조 사례로 일관되게 분리했다.
- 직접 주식, 수탁 권리, 합성형 가격노출을 구분했고 1단계 권리를 주주명부상 주식으로 표현하지 않았다.
- 무담보 발행 금지, DvP 원자성, PII 비기록, 사람 서명, 대사 중지라는 검증 가능한 불변식을 명세했다.
- 내부 검토 기준에서 미해결 high severity 이슈는 없다.

## 실행된 검증

- `scripts/validate_design.py`: JSON·JSONL·YAML 파싱, Draft 2020-12 schema, 합성 fixture, 원본 13개 체크섬, 로컬 링크, PII key, 홍콩 코어 비종속성 및 BDD 오류 추적 통과
- Redocly CLI 2.46.1: `specs/openapi.yaml` 경고 없이 유효
- AsyncAPI CLI 6.0.2: `specs/asyncapi.yaml` 3.1.0 유효, governance issue 없음
- gherkin-lint 4.2.4: 두 feature 파일 통과
- `rwa-institutional-research` validator: base 및 candidate gate 통과
- `git diff --check`: whitespace 오류 없음

## 사람이 확인할 판단

1. 기관 제안의 주력 메시지를 “신규 유통채널”보다 “통합계좌의 제어·대사 계층”으로 두는 데 동의하는가.
2. 1단계 계약상 권리의 발행주체, 고객자산 분리, 도산절연 및 해외 판매 적법성을 외부 법률검토 과제로 명시한 수준이 적절한가.
3. PoC에서 실제 기관명 대신 역할명을 사용하고 하나–Emperor는 사례 부록에만 두는 것이 중립적 제안 목적에 맞는가.
4. 현금배당까지만 핵심 범위에 두고 의결권·주식분할·M&A는 후속단계로 미루는 것이 타당한가.

## 알려진 한계

- 공개된 KRX·KSD·은행 운영 API 계약을 확인하지 못했으므로 어댑터는 서명된 mock 명세다.
- 국가별 판매규제·세무·외국환 신고는 정책 인터페이스와 실패 처리를 설계했지만, 실제 규칙값은 관할별 자문 후 확정해야 한다.
- `final.md`와 승인 decision은 아직 만들지 않았다. 인간 승인 또는 수정 요청을 `review/decision.md`에 기록한 뒤 확정한다.
