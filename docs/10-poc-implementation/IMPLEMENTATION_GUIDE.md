# 10단계 PoC 구현 안내

상태: **10단계 구현 검토 대기**

이 문서는 승인된 1~9단계를 코드로 옮기는 방법과 검증 증거를 연결한다. 구현은 실제 자금, 주식, 개인정보나 기관 API를 사용하지 않는다.

화면만 순서대로 확인하려면 [PoC 화면 직접 확인 가이드](MANUAL_DEMO_GUIDE.md)에서 시작한다. 기능별 구현범위와 시험 결과는 [제한형 토큰 기반 구현 증거](TOKEN_FOUNDATION_EVIDENCE.md), [고객·상품·투자자 보호 구현 증거](ELIGIBILITY_AND_PROTECTION_EVIDENCE.md), [1차 발행과 T+2 구현 증거](PRIMARY_ISSUANCE_EVIDENCE.md), [24/7 제한 거래 구현 증거](SECONDARY_TRADING_EVIDENCE.md), [시장조성자 헤지와 재고조정 구현 증거](HEDGE_WORKFLOW_EVIDENCE.md), [일반 투자자 환매 구현 증거](REDEMPTION_LIFECYCLE_EVIDENCE.md), [권리업무와 운영 통제 구현 증거](RIGHTS_AND_RECOVERY_EVIDENCE.md), [전체 시연과 로컬 인수시험 구현 증거](LOCAL_ACCEPTANCE_EVIDENCE.md), [Fuji 배포와 검증 증거](FUJI_DEPLOYMENT_EVIDENCE.md)에 정리한다. 마스터부터 실제 화면과 로컬·Fuji 증거를 역방향으로 확인한 결과는 [10단계 구현 정합성 검토](IMPLEMENTATION_REVIEW.md)에서 확인한다.

## 1. 현재 구현 범위

실행 기반과 제한형 토큰 기반 위에 고객·상품·투자자 보호, 1차 발행과 T+2 및 24/7 제한 거래 흐름을 구현했다.

- Node.js와 pnpm 버전 및 모든 패키지 버전 고정
- Next.js 투자자 앱의 실제 업무 내비게이션과 통합 기관 콘솔의 역할별 업무공간
- Fastify API, 합성 Bearer 인증과 주입 가능한 시계
- PostgreSQL 업무, 멱등, 발송함, 수신함, 증거와 감사 기반 테이블
- 기관 모의 서버의 프로세스 수명 Ed25519 키
- Anvil, Foundry, Vitest와 Playwright Chromium 검증환경
- OpenAPI, AsyncAPI, 계약 ABI와 9단계 시험 명세의 개수 및 승인상태 검사
- 종목별 제한형 권리토큰, 적격성 레지스트리, 결정적 상품 배포와 시장정책 레지스트리
- 다섯 EIP-712 의사 형식, EOA 및 ERC-1271 검증과 nonce 재사용 차단
- 실제 Safe 3인 중 2인 승인과 OpenZeppelin 60초 지연 실행 계약
- 일반 투자자 부분환매까지 포함한 업무 ABI 71개와 별도 관리 ABI를 컴파일 결과에 대조하는 자동 검증
- Foundry 배포 도우미와 viem 기반 Anvil 배포 및 조회 시험
- 합성 허용·거절·만료 고객, 위험공시와 전자 동의 및 주문·권리수령 준비상태
- KRX 기준일 원본의 체크섬을 검증한 201개 상품 후보와 대표 6종목 표시
- 브라우저 지갑 소유확인, 기관 승인과 적격성 레지스트리 반영을 분리한 전용 지갑 흐름
- 투자자 민원 접수, 책임기관 분류, 답변·정정 연결·종결과 고객별 접근통제
- 투자자 앱과 통합 기관 콘솔의 실제 PostgreSQL 비동기 업무 조회
- USD·USDC 1차 지정가 주문, 취합·정수 배분, 결제 대기 선발행과 T+2 전환
- 지정 시장조성자의 30초 지정가 호가, 결제완료 재고 예약과 24/7 부분체결
- USD 장부 정산과 시험 USDC 원자적 DvP를 분리한 정산 컨트롤러
- 권리 원장, 토큰과 자금의 함께 반영, 체인 성공 뒤 원장 실패 격리와 RPC 응답 유실 통제
- 시장조성자 결제완료·결제대기 재고, 예약수량과 순포지션 화면
- 24/7 체결과 같은 처리에서 한 번만 생성되는 다음 KRX 개장 헤지 대기열
- 시장조성자 주문 서명, 해외 증권사 위험승인과 외국인 한도·거래정지 방향 통제
- 매수 헤지의 결제·수탁 후 재고보충과 매도 헤지의 권리종료·지급청구·소각
- 부분체결분만 재고에 반영하고 미체결 잔량을 같은 헤지에 보류하는 통제
- 결제완료 권리의 일반 투자자 환매 요청, 종목·가격·거래일별 취합매도와 정수 비례배분
- 미체결 수량의 즉시 잠금해제, T+2 뒤 권리종료와 USD 지급청구 전환
- USD 지급과 토큰 소각의 독립 확인, 일부 완료 격리 및 중복 실행 방지
- 기준일 수탁권리 스냅샷을 사용하는 현금배당, 선택형 USDC 전환과 의결권 지시
- 월별 최종투자자 보고, 증거 누락 주문 보류와 정정·보관 증거
- 권리·준법 독립 승인, 다섯 수량 보존과 전체 대사를 요구하는 지갑 복구
- 소각 대기 수량을 제외한 2대1 합성 주식분할과 비정수 기업행동 전체 원복
- 두 축 수량 대사, 가장 좁은 범위의 중지, 보정·독립 승인과 60초 지연 재개
- 한 종목의 연속 투자자 여정, 업무별 처리 과정 패널, 기관 역할별 업무공간과 같은 업무 ID의 거래실
- 승인된 76개 로컬 시험의 독립 실행결과와 실제 시험계층 양방향 추적
- 승인된 175개 상태의 기계 판독 허용·금지 전환표
- 안전한 로컬 합성 시연 초기화와 커밋별 검증 증거 생성

애플리케이션과 생성 결과는 TypeScript 7.0.2로 검사한다. `openapi-typescript` 7.13.0은 TypeScript 7의 변경된 내부 API와 호환되지 않으므로 생성 도구 프로세스에만 TypeScript 5.9.3을 격리한다. 이 버전은 제품 런타임이나 업무 코드에 사용하지 않는다.

로컬 통합 재검토에서 확인한 공백은 보완했다. 175개 승인 상태를 런타임 전환 검사로 강제하고 플랫폼 API 43개를 모두 구현했으며, 1차 발행, 24/7 정산, 시장조성자 헤지, 환매, 지갑복구와 기업행동을 실제 Anvil 계약 호출에 연결했다. 모의 기관 버튼은 데이터베이스를 직접 바꾸지 않고 프로세스 수명 Ed25519 키로 서명한 결과를 회신한다. 전체 시연에서 체인 성공과 권리 원장 반영을 별도로 확인하며 일부 완료는 격리한다. 공식 ISIN을 확인한 대표 6종목의 Fuji 배포와 사람시험 3개도 완료했으며, 10단계 구현의 사람 검토와 승인만 남아 있다.

## 2. 로컬 준비

### 가장 쉬운 방법: Docker로 한 번에 실행

로컬 화면을 확인할 때는 **`.env`를 만들거나 값을 채울 필요가 없다.** `compose.yaml`에 합성 데이터베이스, 로컬 체인, API와 모의 기관의 로컬 설정이 이미 들어 있다. Docker Desktop 또는 Docker Engine만 실행한 뒤 저장소 루트에서 다음 명령을 실행한다.

```bash
docker compose up --build --wait
```

처음 실행할 때는 이미지를 만들기 때문에 시간이 걸릴 수 있다. 명령이 끝나면 브라우저에서 `http://localhost:3000`을 열고 **투자자 앱 → 모의 계좌 개설부터 시작**을 누른다. 데이터베이스 생성, 로컬 컨트랙트 배포와 테이블 준비는 자동으로 수행된다.

Docker 이미지 빌드 과정은 고정된 Foundry 버전으로 스마트컨트랙트를 직접 컴파일한다. 호스트에 남아 있는 `contracts/out`을 복사하지 않으므로 별도의 `forge build`도 필요 없다. API, 작업 실행기, 배포기, 마이그레이션, 모의 기관과 웹은 같은 애플리케이션 이미지를 사용한다.

PoC의 PostgreSQL과 로컬 체인은 컨테이너 내부에서만 사용한다. 컴퓨터에 이미 실행 중인 PostgreSQL의 `5432` 포트나 개발용 체인의 `8545` 포트를 차지하지 않으며, 기존 서비스를 중지할 필요도 없다.

로컬 컨트랙트 배포는 Anvil이 단순히 실행된 시점이 아니라 RPC 요청에 정상 응답하는 시점부터 시작한다. 실패한 첫 실행을 정리한 뒤 다시 시작할 때는 `docker compose down --remove-orphans`를 먼저 실행한다.

```bash
docker compose down --remove-orphans
docker compose up --build --wait
```

기본 재시작에서는 `-v`를 붙이지 않는다. PostgreSQL과 배포 manifest가 들어 있는 합성 Docker 볼륨을 의도치 않게 삭제하지 않기 위해서다.

pnpm이 준비돼 있다면 같은 명령의 짧은 별칭도 사용할 수 있다.

```bash
pnpm demo:up
```

종료할 때는 다음 중 하나를 실행한다. 데이터는 Docker 볼륨에 남으므로 다음 실행에서 이어진다.

```bash
docker compose down
# 또는
pnpm demo:down
```

전체 거래 시연을 처음부터 다시 해야 할 때만 실행 중인 컨테이너에 합성 데이터 초기화를 요청한다.

```bash
pnpm demo:reset:docker
```

화면의 **온보딩 다시 시작**은 브라우저 단계만 되돌리므로 보통은 데이터 초기화가 필요 없다. 문제가 생겼을 때는 `pnpm demo:logs`로 웹, API, 작업 실행기와 모의 기관 기록을 함께 확인한다.

### 자주 발생하는 Docker 문제

#### Docker API 접근 권한이 없을 때

`permission denied while trying to connect to the docker API`가 나오면 현재 사용자를 Docker 그룹에 추가하고 새 로그인 세션을 시작한다. `docker` 그룹은 관리자 수준 권한을 가지므로 개인 개발환경에서만 적용한다.

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker info
```

#### 이전 실패 이미지가 남아 있을 때

`chain-deploy` 로그에 `contracts/out/...json` 파일이 없다고 나오면 계약 산출물이 포함되지 않은 과거 캐시 이미지다. 다음 한 번만 배포 이미지를 캐시 없이 다시 만들고 전체 서비스를 시작한다.

```bash
docker compose down --remove-orphans
docker compose build --no-cache chain-deploy
docker compose up --build --wait
```

정상 기동 뒤 `docker compose ps -a`에서 `chain-deploy`와 `migrate`는 작업을 마친 `Exited (0)`, PostgreSQL·Anvil·API·모의 기관·웹은 실행 또는 `healthy`로 표시된다. `Exited (0)`인 두 서비스는 오류가 아니라 시작 준비를 한 번 수행하고 끝나는 작업이다.

### `.env.example`은 언제 쓰는가

`.env.example`은 컨테이너 밖에서 웹과 백엔드를 각각 실행하는 개발자를 위한 참고값이다. 파일명을 `.env`로 바꾸는 것만으로는 백엔드가 자동으로 읽지 않으므로, 일반 화면 검토자가 이 경로를 사용할 이유가 없다.

| 하려는 일                        | `.env` 필요 여부 | 추가로 필요한 값                                              |
| -------------------------------- | ---------------- | ------------------------------------------------------------- |
| 브라우저로 로컬 PoC 확인         | 필요 없음        | 없음                                                          |
| 컨테이너 밖에서 서버를 직접 개발 | 선택 사항        | `.env.example`의 로컬값을 셸에 불러옴                         |
| 공식 ISIN 다시 조회              | `.env` 사용 금지 | 현재 셸의 `DATA_GO_KR_SERVICE_KEY`                            |
| Fuji 키 생성·재검증              | `.env` 사용 금지 | 현재 셸의 `FUJI_KEYSTORE_PASSWORD`, 선택적으로 `FUJI_RPC_URL` |

공공데이터 키와 Fuji 비밀번호를 이미 `.env`에 넣었다면 파일에서 지우고 필요한 명령을 실행하는 현재 셸에만 설정한다. 로컬 화면 확인에는 두 값 모두 사용하지 않으며, 그 밖의 실제 비밀값도 사용하거나 저장소에 넣지 않는다.

### 개발자용 직접 실행

Docker 밖에서 각 서버를 수정하며 실행해야 하는 경우에만 `.env.example`을 복사하고 셸에 명시적으로 불러온다. 이 경로는 작업 실행기와 로컬 컨트랙트 배포까지 따로 관리해야 하므로 일반 시연 경로가 아니다.

```bash
cp .env.example .env
set -a
source .env
set +a
```

직접 실행 환경에서 반복 시연 전에는 `pnpm demo:reset -- --confirm=RESET_LOCAL_SYNTHETIC_RWA_POC`를 사용할 수 있다. 이 명령은 로컬 `rwa_poc` 데이터베이스와 명시적 확인값을 모두 검사한 뒤에만 합성 fixture를 다시 적재한다.

가상시계로 승인 fixture를 재현할 때는 `TEST_CLOCK_MODE=fixed`와 `TEST_CLOCK_ISO`를 데이터 적재와 API 실행에 똑같이 적용한다. 한쪽에만 적용하면 시장정보 기준시각과 60초 신선도 판정이 달라지므로 검증 증거로 사용할 수 없다.

호스트에서 접근하는 기본 주소는 웹 `http://localhost:3000`, API `http://localhost:4000`, 기관 모의 서버 `http://localhost:4100`이다. PostgreSQL과 Anvil RPC는 Docker 내부 전용이며 호스트의 `5432`와 `8545`로 공개하지 않는다.

## 3. 검증 명령

- `pnpm test:quick`: 문서, 명세, 타입, 단위 및 Foundry 시험
- `pnpm test:database`: 실제 PostgreSQL 발송함 통합시험
- `pnpm test:api`: 실제 PostgreSQL을 사용하는 API와 접근통제 통합시험
- `pnpm test:chain`: 실제 Anvil 연결, 기반 계약 배포와 viem 조회시험
- `pnpm test:browser`: Playwright Chromium 전체 생애주기 시험
- `pnpm test:full`: 실제 PostgreSQL, Anvil, API, 모의 기관 서버와 Chromium을 순서대로 실행하고 영수증·기관서명·수량을 대사하는 전체시험. 이름이 `_test`로 끝나는 `DATABASE_URL`이 필요하다.
- `pnpm test:acceptance:trace`: 승인된 76개 로컬 시험을 독립된 시험번호로 실행
- `pnpm test:acceptance`: 깨끗한 커밋에서 전체 로컬 검증과 76개 시험을 실행하고 증거 생성

### Fuji 최종 게이트와 완료 증거

1. 공공데이터포털에서 `금융위원회_KRX상장종목정보` 활용신청을 완료하고 `DATA_GO_KR_SERVICE_KEY`를 셸에만 설정한다.
2. `pnpm isin:verify`로 2026년 8월 28일 대표 6종목의 공식 ISIN과 체크섬 증거를 만든다.
3. 12자 이상의 `FUJI_KEYSTORE_PASSWORD`를 셸에만 설정하고 `pnpm fuji:keys`를 실행한다. 생성된 배포자 공개주소에만 Fuji 시험 AVAX를 충전한다.
4. 깨끗한 도구 커밋에서 `pnpm test:acceptance`를 통과한 뒤 `pnpm deploy:fuji`를 실행한다.
5. 같은 커밋에서 `pnpm test:fuji`를 실행해 배포, 직접이전 차단과 삼성전자 대표 생애주기를 검증한다.

위 게이트는 커밋 `52c47dc`에서 완료했다. 공식 ISIN 체크섬, 대표 6종목 주소, 거래해시와 수량 결과는 [Fuji 배포와 검증 증거](FUJI_DEPLOYMENT_EVIDENCE.md)에서 확인한다.

Fuji 키는 `.runtime/fuji/`의 암호화 키 저장소에만 두며 저장소와 증거에는 공개주소만 남긴다. 지급자산은 Circle 발행물이 아닌 소수점 6자리 `Mock USDC`이고, 토큰명과 증거에는 모의 테스트 전용임을 표시한다. 실행기는 체인 ID가 `43113`이 아니거나 공식 ISIN, 가스 잔액, 배포 커밋 중 하나가 다르면 중지한다.

각 기능 커밋은 관련 자동시험을 추가하고 실행 결과를 보고한다. 자동 재시도와 건너뜀은 사용하지 않는다.

```bash
DATABASE_URL=postgresql://rwa:rwa@127.0.0.1:5432/rwa_poc_test pnpm test:full
```

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
- 공식 ISIN이 없는 201개 기준종목은 상품 후보일 뿐이며 합성 토큰 배포 결과로 활성화하지 않는다.
- 전용 지갑은 기관 승인 뒤 적격성 레지스트리 반영까지 확인돼야 사용 가능하다. 체인 반영 실패는 해당 업무를 격리한다.
