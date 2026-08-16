# Normative PoC Specifications

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
- 모든 fixture와 UI에는 `DEMO_ONLY`; 법률 예시에는 `ILLUSTRATIVE_ONLY`를 표시한다.
