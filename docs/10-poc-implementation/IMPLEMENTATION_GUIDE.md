# 10단계 PoC 구현 안내

상태: **10단계 구현 중**

이 문서는 승인된 1~9단계를 코드로 옮기는 방법과 검증 증거를 연결한다. 구현은 실제 자금, 주식, 개인정보나 기관 API를 사용하지 않는다.

두 번째 기능의 구현범위와 시험 결과는 [제한형 토큰 기반 구현 증거](TOKEN_FOUNDATION_EVIDENCE.md)에 정리한다.

## 1. 현재 구현 범위

실행 기반 커밋 위에 두 번째 기능인 제한형 토큰 기반을 구현한다.

- Node.js와 pnpm 버전 및 모든 패키지 버전 고정
- Next.js 투자자 앱과 통합 기관 콘솔의 화면 골격
- Fastify API, 합성 Bearer 인증과 주입 가능한 시계
- PostgreSQL 업무, 멱등, 발송함, 수신함, 증거와 감사 기반 테이블
- 기관 모의 서버의 프로세스 수명 Ed25519 키
- Anvil, Foundry, Vitest와 Playwright Chromium 검증환경
- OpenAPI, AsyncAPI, 계약 ABI와 9단계 시험 명세의 개수 및 승인상태 검사
- 종목별 제한형 권리토큰, 적격성 레지스트리, 결정적 상품 배포와 시장정책 레지스트리
- 다섯 EIP-712 의사 형식, EOA 및 ERC-1271 검증과 nonce 재사용 차단
- 실제 Safe 3인 중 2인 승인과 OpenZeppelin 60초 지연 실행 계약
- 업무 ABI 64개와 별도 관리 ABI를 컴파일 결과에 대조하는 자동 검증
- Foundry 배포 도우미와 viem 기반 Anvil 배포 및 조회 시험

애플리케이션과 생성 결과는 TypeScript 7.0.2로 검사한다. `openapi-typescript` 7.13.0은 TypeScript 7의 변경된 내부 API와 호환되지 않으므로 생성 도구 프로세스에만 TypeScript 5.9.3을 격리한다. 이 버전은 제품 런타임이나 업무 코드에 사용하지 않는다.

이번 기능은 발행·정산·환매 컨트롤러가 안전하게 호출할 온체인 기반까지만 만든다. 체결·배분과 권리기입 증거를 결합하는 발행 컨트롤러, USD·USDC 정산, 환매 지급청구와 독립승인 기업행동은 이후 생애주기 기능에서 구현한다.

## 2. 로컬 준비

1. `.env.example`을 참고해 로컬 환경변수를 설정한다. 실제 비밀값은 사용하거나 저장소에 넣지 않는다.
2. `corepack pnpm install --frozen-lockfile`로 고정 의존성을 설치한다.
3. `docker compose up -d postgres anvil`로 PostgreSQL과 로컬 EVM을 시작한다.
4. `pnpm db:migrate`로 기반 테이블을 만든다.
5. `pnpm dev`로 웹, API와 기관 모의 서버를 실행한다.

기본 주소는 웹 `http://localhost:3000`, API `http://localhost:4000`, 기관 모의 서버 `http://localhost:4100`, Anvil RPC `http://localhost:8545`다.

## 3. 검증 명령

- `pnpm test:quick`: 문서, 명세, 타입, 단위 및 Foundry 시험
- `pnpm test:database`: 실제 PostgreSQL 발송함 통합시험
- `pnpm test:chain`: 실제 Anvil 연결, 기반 계약 배포와 viem 조회시험
- `pnpm test:browser`: Playwright Chromium 화면 골격 시험
- `pnpm test:full`: 로컬 기반 전체시험

각 기능 커밋은 관련 자동시험을 추가하고 실행 결과를 보고한다. 자동 재시도와 건너뜀은 사용하지 않는다.

## 4. 설계 경계

- 승인된 OpenAPI, AsyncAPI, JSON Schema와 계약 ABI가 구현의 외부 계약이다.
- 고객·기관 업무용 ABI와 Safe·지연 실행 관리 ABI를 분리한다. 컴파일된 기반 계약의 공개 표면은 두 명세의 합집합을 넘을 수 없다.
- 일반 `transfer`, `transferFrom`과 `approve`는 항상 실패한다. 결제완료 거래 가능 수량만 향후 정산 컨트롤러가 투자자와 지정 시장조성자 사이에서 이전한다.
- 로컬 배포는 실제 Safe 계약을 2-of-3으로 초기화하고 Safe만 60초 지연 실행을 제안·실행하게 한다. 각 기반 계약의 관리자는 지연 실행 계약이며 배포자는 관리권을 갖지 않는다.
- 토큰은 고객별 수탁권리 원장을 대체하지 않는다.
- 합성 Bearer 값은 인증 제품이 아니라 역할별 화면과 권한 시험을 위한 명시적 데모 식별자다.
- 기관 모의 서명키는 매 프로세스 시작 때 새로 만들고 디스크에 저장하지 않는다.
- Fuji 키, 실제 기관 자격증명과 고객정보는 저장소에 넣지 않는다.
- 승인 문서와 구현이 충돌하면 코드를 우회하지 않고 설계를 다시 검토한다.
