# Korean Equity RWA Institutional PoC

KORE는 투자자의 주식 매수 주문부터 토큰 발행, 거래, 환매와 소각까지 기관들이 어떤 일을 하는지 보여주는 시연 프로그램이다. 아래 안내를 따라 내 컴퓨터에서 화면을 열고 투자자와 기관의 버튼을 직접 눌러 볼 수 있다.

실제 자금, 주식 또는 개인정보를 다루지 않으며 이 저장소의 팀 내부 승인은 법률의견, 기관 승인이나 인허가 적합성 확인을 뜻하지 않는다.

## 처음 사용하는 사람을 위한 실행 안내

이 안내는 코딩 경험이 없어도 내 컴퓨터에서 시연 화면을 열어 보는 방법이다. 순서는 **Docker 설치 → 받은 파일 압축 풀기 → 실행 명령 입력 → 브라우저에서 시연**이다. 외부 사이트에 배포하거나 클라우드 서버를 구매할 필요는 없다.

Docker는 **이 시연에 필요한 프로그램을 한꺼번에 실행해 주는 도구**다. 화면, 데이터베이스, 모의 기관과 시험용 블록체인을 묶어서 실행하므로 Node.js, pnpm, PostgreSQL, Foundry를 따로 설치하지 않는다. Git, 코딩 편집기, MetaMask 같은 지갑도 필요 없다. `.env` 파일이나 비밀키를 직접 만들지 않으며, 실제 계좌 개설·입금·가상자산 구매도 하지 않는다.

준비물은 인터넷에 연결된 Windows 또는 Mac 컴퓨터, 웹 브라우저, **담당자에게 받은 최신 프로젝트 ZIP**이다. 처음에는 실행에 필요한 파일을 내려받으므로 시간과 여유 저장 공간이 필요하다. 휴대전화에서 설치하는 방식은 아니며, 화면은 데스크톱 브라우저를 권장한다. 회사 PC라면 Docker 설치 권한과 회사에 적용되는 이용 조건을 먼저 확인한다.

### 1. Docker Desktop 설치하고 켜기 — 처음 한 번

| 사용하는 컴퓨터 | 설치 방법 |
| --- | --- |
| Windows | [Docker Desktop 공식 Windows 설치 페이지](https://docs.docker.com/desktop/setup/install/windows-install/)에서 컴퓨터에 맞는 설치 파일을 받는다. 일반적인 Intel·AMD PC는 x86_64를 선택한다. 설치 중 실행 방식 선택이 나오면 WSL 2를 사용한다. WSL은 Windows 안에서 필요한 Linux 프로그램을 실행하는 기능이다. 설치·업데이트 또는 재부팅 안내가 나오면 완료한 뒤 Docker Desktop을 연다. |
| Mac | 왼쪽 위 Apple 메뉴의 **이 Mac에 관하여**에서 칩을 확인한다. [Docker Desktop 공식 Mac 설치 페이지](https://docs.docker.com/desktop/setup/install/mac-install/)에서 M 시리즈는 **Apple silicon**, Intel Mac은 **Intel chip**용을 받는다. 내려받은 파일을 열고 Docker를 응용 프로그램 폴더로 옮긴 뒤 실행한다. |

Docker Desktop 창을 열고 시작 준비가 끝날 때까지 기다린다. 엔진이 실행 중이라는 표시가 나오면 다음 단계로 넘어간다. 설치만 하고 앱을 켜지 않으면 시연이 실행되지 않는다. 운영체제 지원 범위와 메모리 요구사항은 위 공식 설치 페이지를 기준으로 확인한다.

Linux 사용자는 [Docker Engine 공식 설치 안내](https://docs.docker.com/engine/install/)에서 배포판에 맞게 Docker와 Compose 플러그인을 준비한 뒤 아래 명령을 사용한다. 권한 문제가 있으면 [개발자용 구현 안내](docs/10-poc-implementation/IMPLEMENTATION_GUIDE.md#자주-발생하는-docker-문제)를 참고한다.

### 2. 프로젝트 파일 준비하고 명령 입력 창 열기

1. 전달받은 ZIP을 다운로드 폴더 등에 저장한다. Windows에서는 **모두 압축 풀기**, Mac에서는 ZIP을 더블클릭해 압축을 푼다. ZIP 안에서 바로 실행하지 않는다.
2. 압축을 푼 폴더를 열어 **`README.md`와 `compose.yaml`이 함께 있는 폴더**를 찾는다. 폴더가 한 번 더 들어 있을 수도 있다. 이 폴더가 실행 위치다.
3. 아래에서 운영체제에 맞는 방법으로 명령 입력 창을 연다. 명령어는 브라우저 주소창이 아니라 이 창에 입력한다.

**Windows:** 파일 탐색기로 위 폴더를 연다. 탐색기 위쪽 주소 표시줄을 클릭하고 `powershell`을 입력한 다음 Enter를 누르면 해당 폴더에서 PowerShell이 열린다. 직접 폴더를 지정할 때는 다음처럼 입력한다. 따옴표 안은 내 컴퓨터의 실제 폴더 경로로 바꾼다.

```powershell
cd "C:\Users\사용자이름\Downloads\rwa-8th"
```

**Mac:** Spotlight 검색(Command + Space)에서 `터미널`을 찾아 연다. `cd` 뒤에 공백 하나를 입력하고 Finder에서 프로젝트 폴더를 터미널 창으로 끌어 놓은 다음 Enter를 누른다. 직접 입력할 때의 예시는 다음과 같다. 실제 폴더 이름이 다르면 경로도 바꾼다.

```bash
cd "/Users/사용자이름/Downloads/rwa-8th"
```

위 경로는 예시다. 폴더 이름이 `rwa-8th-main` 등으로 되어 있다면 받은 폴더 이름을 그대로 사용한다. 이후 안내의 명령은 모두 이 위치에서 실행한다. 다음 두 명령을 **한 줄씩** 입력해 Enter를 누르면 Docker와 실행 위치를 확인할 수 있다.

```text
docker compose version
docker compose config --quiet
```

첫 명령은 버전이 나오면 정상이다. 두 번째는 별다른 문구 없이 다음 입력을 받으면 정상이다. `no configuration file provided`가 나오면 다른 폴더에 있는 것이므로 `compose.yaml`이 있는 폴더로 다시 이동한다.

> GitHub에서 임의로 내려받은 파일이 최신 시연 화면과 같다고 단정할 수는 없다. 시연 코드가 아직 원격 저장소에 반영되지 않았을 수 있으므로, 처음 체험할 때는 담당자가 확인해 전달한 최신 프로젝트 ZIP을 사용한다. 이 README만 받았다면 프로젝트 파일도 함께 요청한다.

### 3. 시연 실행하고 화면 열기

열어 둔 PowerShell 또는 터미널에 아래 한 줄을 붙여 넣고 Enter를 누른다.

```bash
docker compose up --build --wait
```

여러 줄의 영문 메시지가 나오는 것은 필요한 파일을 내려받고 프로그램을 준비하는 과정이다. 첫 실행은 컴퓨터와 인터넷 속도에 따라 오래 걸릴 수 있다. `Building`, `Downloading`, `Waiting`이 표시되는 동안 창을 닫거나 같은 명령을 반복하지 않는다. 오류 없이 다시 명령을 입력할 수 있는 상태가 되면 아래 링크를 연다.

특히 `chain-deploy`는 시험용 계약과 권한을 순서대로 준비하는 작업이다. 몇 분 동안 새 로그가 적을 수 있으며 `Waiting` 표시만으로 실패한 것은 아니다. 종료 후 재기동할 때도 이 준비 과정에 시간이 걸릴 수 있다. `Error`, `Failed` 등과 함께 명령이 끝나면 아래 문제 해결 항목을 확인한다.

**[시연 화면 열기 — http://localhost:3000/demo/00](http://localhost:3000/demo/00)**

`localhost`는 지금 사용 중인 컴퓨터를 뜻한다. 이 주소를 다른 사람에게 보내도 내 시연 화면에 접속되는 것은 아니다. 주소는 `https`가 아닌 **`http`**로 연다. 실행 명령이 정상적으로 끝난 뒤에는 터미널 창을 닫아도 되지만 Docker Desktop은 계속 켜 두어야 한다.

처음에는 다음 상태인지 확인한다.

- 장면 `00 계좌 준비`에 **투자 준비 완료**와 판매 가능·투자자 보호 확인·위험공시 동의·전용 지갑 연결이 표시된다.
- `다음 단계`로 장면 `01`에 가면 고객 A의 가상 USD 잔액이 **2,000.00**, 예약금이 **0**, 주문이 **0건**이다.
- 아래 세 수량은 순서대로 **100 / 120 / 120**이다. 초기 시연에는 시장조성자의 결제완료 100주와 결제대기 20주가 있어 처음부터 세 숫자가 모두 같지는 않다. 이 차이 자체는 오류가 아니다.

이전에 사용한 컴퓨터라면 과거 주문이나 잔액이 보일 수 있다. 이때는 아래의 **전체 플로우 다시 시작** 절차로 초기화한다. 데이터베이스와 로컬 블록체인 준비는 자동으로 진행되며, 별도 입금이나 외부 지갑 연결은 하지 않는다.

### 4. 일곱 장면 따라 해 보기

왼쪽 **투자자 화면**에서 주문·환매를 요청하고, 오른쪽 **기관 화면**에서 지금 담당 기관의 승인·확인 버튼을 누른다. 투자자 버튼만 누른다고 모든 기관 업무가 자동 완료되는 것은 아니다. 필요한 승인 뒤 시험용 블록체인 실행은 자동으로 이어지므로 화면 밖에서 따로 명령을 입력하지 않는다.

| 장면 | 처음 시연할 때 할 일 |
| --- | --- |
| 00 계좌 준비 | 네 준비상태를 확인하고 헤더의 `다음 단계`로 이동한다. 계좌를 새로 만들 필요는 없다. |
| 01 1차 매수 주문 | 수량을 **1주**로 입력하고 `서명하고 주문 접수`를 누른다. 가상 USD가 주문용으로 예약되고 국내 체결 대기로 바뀌는지 확인한다. |
| 02 국내 체결·배분 | 기관 화면의 `매수 체결`을 눌러 체결·배분 결과를 확인한다. |
| 03 토큰화 주식 발행 | 기관 화면에 나타나는 위험 승인·권리기입 승인·권리원장 반영 확인을 처리한다. 자동 발행 뒤 국내 결제·수탁수량 확인까지 진행해 거래 가능 전환을 기다린다. |
| 04 오프아워 거래 | **지정가**를 선택하고 표시된 기본 가격과 **2주**로 주문한다. 기관 화면의 `스프레드 개입 · 최우선 매수호가 체결`을 누르고 이어지는 정산 승인까지 처리한다. 시장가 주문은 먼저 유효한 매도호가가 있어야 한다. |
| 05 환매·즉시 지급 | **1주**를 입력하고 `서명하고 환매 요청`을 누른 뒤 기관 화면에서 국내 매도 체결을 처리한다. 매도 체결대금은 바로 재투자할 수 있지만 아직 현금화할 수 없다. |
| 06 환매 정산·토큰 소각 | `T+2 현금화 가능 전환`, 권리종료 확인, `토큰 소각 승인`을 순서대로 처리하고 자동 소각 뒤 `두 축 수량 대사`를 실행한다. USD를 다시 지급하는 단계는 아니다. |

다음 장면으로 갈 때는 헤더 오른쪽의 **다음 단계**를 사용한다. 버튼이 비활성화되어 있으면 현재 상태의 차단 사유와 기관 화면의 남은 업무를 확인한다. 상단 장면 탭은 화면을 둘러보는 용도이며, 탭을 누르는 것만으로 업무가 완료되지는 않는다. `T+2` 같은 실제 결제 절차는 모의 기관 확인으로 진행하므로 이 시연에서 실제로 이틀을 기다릴 필요는 없다.

`접수됨`은 요청을 받았다는 뜻이지 완료가 아니다. `처리 중`이면 같은 버튼을 반복해서 누르지 않고 결과를 기다린다. `확인 필요`가 나오면 원인과 다음 행동을 확인한다. 주문이 많거나 다른 업무가 가려져 있으면 **전체 내역 보기** 또는 **전체 업무·증거 보기**를 연다. 온체인 증거도 이 창에서 확인할 수 있으며, 체인 거래 성공만으로 고객 권리 업무 전체가 끝난 것은 아니다.

기관별 역할과 화면 읽는 법은 [PoC 화면 직접 확인 가이드](docs/10-poc-implementation/MANUAL_DEMO_GUIDE.md)에 더 자세히 설명되어 있다.

### 5. 잔액을 채우고 처음부터 다시 시연하기

1. 화면 위쪽의 **전체 플로우 다시 시작**을 누른다.
2. 확인창에 **전체 초기화**를 그대로 입력하고 **전체 초기화** 버튼을 누른다.
3. 초기화가 끝날 때까지 기다린다. 이 작업은 현재 컴퓨터에서 실행 중인 PoC의 모든 합성 고객 잔액, 주문·승인·업무 이력과 로컬 체인을 초기 상태로 되돌린다. 이전 시연 기록을 계속 볼 필요가 있다면 먼저 보관한다.
4. 장면 00으로 돌아오면 장면 01의 USD 2,000.00, 예약금·주문 0건과 아래 수량 100 / 120 / 120을 확인한다.

브라우저의 **새로고침은 화면만 다시 조회**한다. 사용한 돈을 채우거나 주문을 지우지 않는다. 전체 초기화는 별도의 데이터 변경 작업이며 실제 자산이나 Fuji 공개 시험망은 건드리지 않는다.

### 6. 종료하고 나중에 다시 실행하기

브라우저 탭만 닫으면 시연 프로그램은 계속 실행된다. 완전히 종료하려면 프로젝트 폴더의 PowerShell 또는 터미널에서 다음 명령을 입력한다.

```bash
docker compose down
```

이 명령이 끝난 뒤 필요하면 Docker Desktop도 종료한다. 다른 Docker 프로젝트를 사용 중이라면 Docker Desktop 전체를 종료하지 않는다.

나중에 다시 실행할 때는 Docker Desktop을 먼저 켜고 같은 프로젝트 폴더에서 다음 명령을 입력한다. 프로젝트 파일이 바뀌지 않았다면 다시 빌드할 필요는 없다.

```bash
docker compose up --wait
```

화면을 연 뒤 **전체 플로우 다시 시작**으로 새 시연을 시작한다. 데이터베이스 일부는 남아 있어도 시험용 블록체인 Anvil은 종료·재기동으로 상태를 잃을 수 있으므로, 이전 거래가 그대로 이어진다고 가정하지 않는다. 이미 정상 실행 중일 때는 위 명령을 다시 입력하지 말고 화면의 초기화 버튼을 사용한다. 실행 명령이 실패해 화면도 열리지 않으면 아래 문제 해결 절차로 기록을 확인한다.

> 종료 명령에 `-v`를 추가하거나 Docker의 전체 정리 기능을 실행하지 않는다. 저장 데이터가 삭제될 수 있고, 다른 프로젝트까지 영향을 주는 정리 명령은 이 안내에 필요하지 않다.

### 7. 잘 안 될 때

먼저 아래 표에서 화면에 나온 증상과 가까운 항목을 확인한다. 회사 보안 설정이나 다른 프로그램을 임의로 끄지 않는다.

| 증상 | 확인할 것 | 조치 |
| --- | --- | --- |
| `docker`를 찾을 수 없거나 명령으로 인식하지 못함 | Docker Desktop 설치 여부 | 설치 후 Docker Desktop을 실행하고 PowerShell·터미널을 새로 연다. |
| `Cannot connect to the Docker daemon`, Docker 엔진 연결 실패 | Docker가 설치만 되고 실행되지 않았는지 | Docker Desktop을 열고 엔진 시작을 기다린 뒤 다시 실행한다. |
| `no configuration file provided` | 현재 폴더에 `compose.yaml`이 있는지 | 2단계처럼 압축을 푼 프로젝트 폴더로 이동한다. |
| Windows에서 WSL·가상화 관련 오류 | Docker 설치 창이 요구하는 WSL 설치·업데이트와 재부팅을 마쳤는지 | 위 Windows 공식 설치 안내를 따른다. 회사 PC의 가상화 설정이 막혔다면 관리자에게 요청한다. |
| `port is already allocated`, `address already in use` | 다른 프로그램이 3000·4000·4100 주소의 포트를 쓰는지 | 오류에 나온 포트 번호를 담당자에게 전달한다. 다른 프로그램을 강제 종료하거나 `compose.yaml` 숫자 하나만 임의로 바꾸지 않는다. |
| `Downloading`·`Building` 중 실패, 다운로드 시간 초과 | 인터넷·회사 네트워크 제한·저장 공간과 오류 메시지 | 연결과 공간을 확인한다. 첫 실행이 실패해 종료된 경우에만 실행 명령을 다시 시도한다. 반복되면 아래 기록을 전달한다. |
| `unhealthy`, `dependency failed to start`, 시작 준비 실패 | 어떤 프로그램이 준비되지 않았는지 | 아래 상태·로그 명령 결과를 담당자에게 전달한다. `healthy`가 될 때까지 무조건 같은 명령을 반복하지 않는다. |
| 브라우저에서 연결 거부·빈 화면 | 실행 명령이 성공했는지, Docker가 켜져 있는지, 주소가 `http://localhost:3000/demo/00`인지 | 주소와 실행 상태를 먼저 확인한다. 준비 완료 직후라면 잠시 기다린 뒤 브라우저를 새로고침한다. |
| 주문할 돈이 없거나 과거 주문이 보임 | 이전 시연 데이터를 사용 중인지 | 5단계의 화면 전체 초기화로 잔액과 주문을 복원한다. |
| 다음 단계나 기관 버튼이 비활성화됨 | 현재 상태 줄과 기관 업무의 차단 사유 | 필요한 승인·호가·정수 수량을 확인하고 자동 처리 중이면 기다린다. 해결되지 않는 사유는 화면과 함께 전달한다. |

상태와 최근 실행 기록은 **프로젝트 폴더**에서 다음 명령으로 확인한다. 이 명령들은 데이터를 초기화하거나 삭제하지 않는다.

```bash
docker compose ps -a
docker compose logs --tail=100 web api worker mock-institutions chain-deploy migrate postgres anvil
```

`chain-deploy`와 `migrate`가 **Exited (0)**이면 계약·데이터 준비를 정상적으로 마치고 종료된 것이다. 계속 실행할 필요가 없는 준비 작업이므로 오류로 보지 않는다. 다른 프로그램의 종료나 0이 아닌 종료 코드는 담당자에게 함께 전달한다.

문의할 때는 **운영체제와 Mac 칩 종류, 사용한 프로젝트 ZIP 버전, 실패한 단계, 오류 화면, 위 두 명령의 결과**를 제공한다. 화면의 업무 ID도 원인 확인에 도움이 된다. 로그에 사용자 폴더 경로나 민감한 정보가 섞여 있지 않은지 확인하고 공개 게시판보다는 담당자에게 전달한다.

PoC 데이터베이스와 로컬 체인은 Docker 내부에서 통신하므로 기존 PostgreSQL의 5432 포트나 다른 체인의 8545 포트를 비울 필요는 없다. 다만 현재 실행 설정은 개발·시연용이며 인터넷 공개용 보안 구성이 아니다. 신뢰할 수 있는 네트워크에서 사용하고 공유기의 외부 포트 개방이나 터널 연결은 하지 않는다.

더 깊은 점검과 개발환경 설정은 [구현 안내](docs/10-poc-implementation/IMPLEMENTATION_GUIDE.md)에 있다. 처음 화면을 실행하는 사람은 그 문서의 Node.js·pnpm 설치나 개발 명령을 추가로 따라 할 필요가 없다.

### 이 실행 안내의 검증 범위

2026년 9월 13일 Linux x86_64의 별도 Docker 환경에서 최초 빌드·기동, 브라우저의 1주 주문과 자금 예약, 새로고침 후 주문 유지, 화면 전체 초기화를 확인했다. 종료 후 저장 공간을 유지한 재기동과 화면 초기화도 통과했으며, 고객 A의 USD 2,000.00·예약금과 주문 0건·세 수량 100 / 120 / 120 및 실제 로컬 체인 공급량 120을 확인했다. 기존 사용자 데이터와 충돌하지 않도록 시험 환경의 이름·저장 공간·접속 포트는 분리했다. Windows·macOS의 설치 안내는 공식 문서를 기준으로 작성했으며, 해당 운영체제에서 직접 실행한 검증 결과는 아니다.

## 프로젝트 검토 상태

이 프로젝트는 `Dinari 사례를 한국 시장에 맞게 변환해, 한국주식 수탁권리 토큰의 통제된 24/7 2차거래를 구현할 수 있는가`를 검증하는 PoC다. 외국인의 개별주식 계좌 경로로 외국인 통합계좌를, 토큰화 권리모델로 제3자 수탁형을 선택하고 한국의 KRX 거래, KSD 법적 장부, T+2 결제와 권리관리 구조에 맞춘다.

> 현재 상태: **10단계 구현 검토 대기** (일곱 장면 재구성 검증 완료)
>
> 다음 행동: 구현·검증을 마친 `계좌 → 주문 → 체결 → 발행 → 24/7 권리거래 → 환매 → 소각` 일곱 장면을 검토하고 승인한다. 사용자 승인 전에는 11단계를 시작하지 않는다.
>
> 화면 직접 확인: [PoC 화면 직접 확인 가이드](docs/10-poc-implementation/MANUAL_DEMO_GUIDE.md)를 따라 `/demo/00`부터 `/demo/06`까지 확인한다.
>
> 실제 PoC 코드 구현: **10단계**에서 시작한다.

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
| 1. 마스터 확정 | 목표·분류체계 재승인 완료 | [마스터 설계](docs/01-master/MASTER.md) | 프로젝트 목적, 계좌 경로, 토큰화 권리모델과 기관 역할을 이해할 때 |
| 2. PoC 정의 | 승인 완료 | [목표와 성공 기준](docs/02-poc-definition/POC_GOALS.md), [시험 데이터](docs/02-poc-definition/POC_TEST_DATA.md) | 구현 범위, 불변식, 대표 종목과 합성 통제값을 확인할 때 |
| 3. 제품 요구사항 | 승인 완료 | [제품 요구사항](docs/03-product-requirements/PRD.md) | 사용자와 기관에 필요한 기능 및 완료 조건을 확인할 때 |
| 4. 기관 업무 설계 | 승인 완료 | [기관 업무와 책임](docs/04-institution-design/INSTITUTION_WORKFLOWS.md), [종목 기준정보](docs/04-institution-design/REFERENCE_DATA.md) | 업무 인계, 기준 장부, 승인 책임과 데이터 원본을 확인할 때 |
| 5. 제품 동작 설계 | 화면 구조 개정 승인 완료 | [화면 흐름](docs/05-screens-states-recovery/SCREEN_FLOWS.md), [상태와 전환](docs/05-screens-states-recovery/STATE_MODEL.md), [오류와 복구](docs/05-screens-states-recovery/ERROR_AND_RECOVERY.md) | 화면, 업무 상태, 차단, 격리와 재개 규칙을 확인할 때 |
| 6. 시스템 구조와 보안 | 웹 접근 구조 개정 승인 완료 | [시스템 구조](docs/06-architecture-security/ARCHITECTURE.md), [기술 선택](docs/06-architecture-security/TECHNOLOGY_DECISIONS.md), [보안과 개인정보](docs/06-architecture-security/SECURITY_AND_PRIVACY.md) | 구성요소, 토큰과 체인 및 외부정보, 권한과 키, 개인정보와 위협 통제를 확인할 때 |
| 7. 데이터와 연계 | 승인 완료 | [공통 데이터](docs/07-data-api-events/DATA_MODEL.md), [API 계약](docs/07-data-api-events/API_CONTRACTS.md), [이벤트 계약](docs/07-data-api-events/EVENT_CONTRACTS.md)과 [기계 명세](docs/07-data-api-events/specs/) | 공통 데이터, API와 이벤트를 설계할 때 |
| 8. 스마트컨트랙트 | 승인 완료 | [계약 구조](docs/08-smart-contract-design/CONTRACT_ARCHITECTURE.md), [계약 인터페이스](docs/08-smart-contract-design/CONTRACT_INTERFACES.md), [역할과 변경관리](docs/08-smart-contract-design/ROLES_AND_GOVERNANCE.md), [불변식](docs/08-smart-contract-design/INVARIANTS.md)과 [기계 명세](docs/08-smart-contract-design/specs/contract-manifest.json) | 제한형 권리토큰의 발행, 상태, 정산, 환매, 복구와 권한을 확인할 때 |
| 9. 테스트 설계 | 화면 시험 개정 승인 완료 | [테스트 전략](docs/09-test-design/TEST_STRATEGY.md), [테스트 시나리오](docs/09-test-design/TEST_SCENARIOS.md), [fixture와 증거](docs/09-test-design/FIXTURES_AND_EVIDENCE.md), [시연 확인표](docs/09-test-design/DEMO_CHECKLIST.md)와 [기계 명세](docs/09-test-design/specs/) | 구현 전 요구사항, 상태, API와 계약에 연결된 시험 기준을 확인할 때 |
| 10. PoC 구현 | 구현 검토 대기 | [화면 직접 확인 가이드](docs/10-poc-implementation/MANUAL_DEMO_GUIDE.md), [구현 안내](docs/10-poc-implementation/IMPLEMENTATION_GUIDE.md), [구현 정합성 검토](docs/10-poc-implementation/IMPLEMENTATION_REVIEW.md), [로컬 인수시험 증거](docs/10-poc-implementation/LOCAL_ACCEPTANCE_EVIDENCE.md), [Fuji 배포 증거](docs/10-poc-implementation/FUJI_DEPLOYMENT_EVIDENCE.md)와 기능별 구현 증거 | 브라우저 시연이나 실제 PostgreSQL·Anvil·모의 기관 서명으로 연결된 로컬 생애주기와 Fuji 온체인 통제 결과를 검토할 때 |
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

PoC는 `1차 지정가 발행 → T+2 결제완료 전환 → 오프아워 주문장 거래 → 시장조성자 재고관리 → 환매 국내 매도 → 거래용 USD 즉시 지급 → T+2 현금화 가능 전환 → 토큰 소각`의 닫힌 흐름을 모의 기관 응답과 합성 데이터로 시연한다. 오프아워 거래에서는 결제 완료 재고만 고객 A와 지정 마켓메이커 사이의 USD 시장가와 지정가 거래에 사용한다.

24/7 완결 대상은 국내 결제가 끝난 수탁 권리의 제한된 2차거래다. 실제 시장 유동성, 가격 공정성, 시장조성자의 사업성, 일반 개인 판매 가능성이나 규제 허용을 증명하지 않는다.

## 검증

다음은 개발·설계 검증용이며 시연 화면 실행에는 필요 없다. 이 명령은 단계별 필수 문서, 내부 링크, 구조화 데이터, 원자료 체크섬과 승인된 설계 규칙을 확인한다.

```bash
bash scripts/validate-research.sh
```
