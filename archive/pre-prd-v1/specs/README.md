# Normative Korean Custodial Tokenization PoC Specifications

이 폴더는 구현 에이전트의 규범적 입력이다. 설명 문서와 충돌하면 이 폴더의 데이터 제약과 BDD 합격 조건을 우선한다.

## 사용 순서

1. `schemas/domain.schema.json`: 타입, enum, 필수필드와 PII 부재 확인
2. `openapi.yaml`: 동기 명령·조회 경계 구현
3. `asyncapi.yaml`: 서명·순서·멱등 이벤트 구현
4. `state-machines.md`: 허용 상태전이와 guard 구현
5. `contract-interfaces.md`: 원장 모듈 권한과 효과 구현
6. `invariants.md`: 모든 상태변경 후 검증할 수량·통제식 구현
7. `role-permission-matrix.md`, `error-taxonomy.md`: 접근통제와 안정적 오류 구현
8. `fixtures/demo-data.yaml`: 합성 데이터 seed
9. `bdd/*.feature`: 완료조건 검증

## 구현해야 할 세 업무화면

명세는 하나의 데모를 세 관점으로 투영한다. 각 화면이 별도 사실을 만들면 안 되며 동일한 correlation ID, 계좌 연결, 시장활동, 수탁 포지션과 발행 증거를 조회해야 한다.

1. 투자자 거래 화면: 상품의 법적 성격과 위험, 한국시장 기준시각·1주 단위·예상 T+2 일정, 주문 확인, 부분체결, 결제대기, 발행 완료와 기업행동을 보여준다.
2. 토큰화 운영 콘솔: 투자자 요청과 시장주문을 분리하고, 계좌 연결·개별 체결·미체결금·T+2 수탁·발행·정정/취소·기업행동·보고 증거를 한 계보로 관리한다.
3. 국내 브로커·수탁 인프라 콘솔: 법적 외국인 통합계좌, 상임대리인 수탁계좌, 결제현금, 계좌 활동, 일말 포지션, 기업행동 배정, 잔여분과 월말 보고 증거를 보여준다.

`institutionalAccounts`는 법적·운영상 계좌의 조회모델이고 `accountLinkages`는 투자자 권리계정과 전용 지갑을 통합·수탁 계좌에 연결한다. `custodyPositions`는 기초주식의 수탁 상태, `entitlementPositions`는 해외 유통사 장부의 최종투자자별 권리와 토큰 기록의 일치 상태, `regulatoryReports`는 보고서 본문이 아닌 제출·보존 증거다. 투자자 개인정보와 세무 원본은 이 공유 명세에 포함하지 않는다.

## 버전 정책

- 현재 major version은 `1`이다.
- 선택 필드 추가는 minor, 의미 변화·필드 제거·enum 축소는 major 변경이다.
- event consumer는 알 수 없는 minor 필드를 무시할 수 있지만 알 수 없는 major version은 격리한다.
- 상태명·오류코드·불변식 변경에는 설계 승인과 traceability matrix 갱신이 필요하다.

## 공통 규칙

- 모든 수량은 음이 아닌 정수이고 주식 권리에는 소수점이 없다.
- 모든 시간은 RFC 3339 UTC offset 포함 문자열이다.
- 모든 공유 payload는 allowlist schema를 사용하며 PII 확장 필드를 허용하지 않는다.
- 모든 command는 `Idempotency-Key`, 모든 흐름은 UUID `X-Correlation-Id`를 사용한다.
- 외부 사실 event는 Ed25519 서명, 사람 주문·거래는 EIP-712 secp256k1 서명을 사용한다.
- 주문요청, 시장주문, 개별 체결, 정정·취소, 증권결제, 수탁배정과 토큰발행은 서로 다른 기록이며 원본 활동을 덮어쓰지 않는다.
- 기초주식 수량의 권위기록은 국내 수탁장부, 최종 투자자 권리의 권위기록은 해외 판매기관 하위장부다. 허가형 토큰 기록은 양 장부와 대사되는 동기화 기록이다.
- 한국형 기본경로는 체결 시점이 아니라 T+2 증권결제와 수탁확인 뒤에만 발행한다.
- 모든 fixture와 UI에는 `DEMO_ONLY`; 법률 예시에는 `ILLUSTRATIVE_ONLY`를 표시한다.
