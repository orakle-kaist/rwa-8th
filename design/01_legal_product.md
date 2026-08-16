# 법률·상품 경계 설계

## 1. 분류 원칙

PoC 화면, API와 이벤트는 다음 세 개념을 구분해야 한다.

| 분류 | 정의 | 본 PoC |
|---|---|---|
| Native tokenized share | 발행인 참여 아래 법적 주식 기록 자체가 분산원장에 존재 | 2단계 로드맵만 |
| Custodial entitlement | 제3자가 수탁 중인 주식에 대응하는 계약상·수익적 권리를 발행 | 1단계 구현 대상 |
| Synthetic exposure | 주식을 수탁하지 않고 가격 또는 수익만 약정 | 제외 |

UI의 상품명에는 `수탁 권리 토큰`을 사용하고 `토큰화 주식`, `전자등록주식`, `실물 주식 직접 보유`라는 단축 표현을 사용하지 않는다. 영문 표기는 `Korean Equity Custodial Entitlement`다.

## 2. 권리조건 데이터

종목별 `ProductTerms`는 최소한 다음을 포함해야 한다.

- `instrumentId`: 내부 불변 ID
- `marketIdentifier`: `KRX:종목코드` 형식
- `underlyingName`, `underlyingIsin`
- `entitlementRatio`: 항상 `1/1`
- `tokenDecimals`: 항상 `0`
- `legalForm`: `CUSTODIAL_CONTRACTUAL_ENTITLEMENT`
- `issuerRoleId`, `koreanBrokerCustodianRoleId`, `settlementBankRoleId`
- `custodyAccountReference`: 공개되지 않는 불투명 참조
- `governingLaw`, `disputeForum`
- `eligibleJurisdictions`: 정책 프로파일 ID 목록이며 계약 조건문이 아님
- `distributionPolicyVersion`, `krAssetPolicyVersion`
- `dividendTreatment`, `votingTreatment`, `redemptionTerms`
- `feesDisclosureRef`, `taxDisclosureRef`, `riskDisclosureRef`
- `termsVersion`, `effectiveFrom`, `effectiveUntil`

PoC fixture의 법률·세무 문구는 `ILLUSTRATIVE_ONLY`로 표시한다. 실제 약관이 없으면 빈칸을 추정하지 않고 `LEGAL_REVIEW_REQUIRED` 상태를 반환한다.

## 3. 권리와 책임

### 투자자 권리

- 결제 완료 수탁주식 1주에 대응하는 권리 1단위를 보유한다.
- 적격성 및 이전정책을 충족하는 상대방에게 권리를 이전할 수 있다.
- 기준일 보유분에 따라 실제 수령·원천징수 후의 현금배당 순액을 배정받는다.
- 약정된 환매 절차에 따라 토큰을 잠그고 권리 종료를 요청할 수 있다.
- 자신의 주문·정책결정·결제·발행·기업행동에 대한 감사 타임라인을 조회한다.

### 자동 부여하지 않는 권리

- 발행회사 주주명부 또는 전자등록계좌부상 직접 명의
- 보장된 호가, 즉시환매, 원금 또는 환율 보장
- 토큰 보유만으로 생기는 직접 의결권
- 무허가 지갑이나 관할 밖 상대방으로의 자유 전송
- 수탁기관·발행주체 도산 시 우선순위에 대한 코드 차원의 보장

### 운영기관 의무

- 결제 완료 전 발행하지 않는다.
- 고객자산·고유자산·미토큰화 재고·토큰화 준비금을 구분한다.
- 기업행동을 옴니버스 총액에서 최종투자자별로 배정하고 차이를 대사한다.
- 정책 변경을 소급적용하지 않고 거래 당시 버전을 보존한다.
- 동결·강제이전·환매·비상정지는 사유, 요청자, 승인자와 증거를 남긴다.

## 4. `JurisdictionPolicy` 계약

### 입력

```text
participantId
residenceJurisdiction
investorCategory
distributorInstitutionId
distributorLicenseClaims[]
instrumentId
productLegalForm
action: ONBOARD | BUY_PRIMARY | TRANSFER_SECONDARY | RECEIVE | REDEEM | DIVIDEND
quantity
disclosureAcceptanceRefs[]
evaluationTime
```

### 출력

```text
decision: ALLOW | DENY | MANUAL_REVIEW
reasonCodes[]
requirements[]
limits[]
policyId
policyVersion
dataAsOf
validUntil
evidenceHash
signature
```

정책엔진은 법률판단을 온체인에서 계산하지 않는다. 승인을 책임지는 기관이 버전된 규칙을 오프체인에서 평가하고 결과를 서명한다. 컨트랙트는 서명자, 유효기간, 정책 버전과 허용 action을 확인한다.

### 프로파일 구성

- `KRAssetPolicy`: 모든 상품에 필수. 종목상태, 시장시간, 기초재고 취득 시 외국인 room, 국내 중개·수탁, 기업행동을 평가한다.
- `HKDistributionPolicy`: 데모에서만 활성화되는 첫 해외 참조. 홍콩 현지 판매기관 자격, 투자자 분류, 공시·동의, 기술·수탁 위험 고지를 평가한다.
- 다른 프로파일은 같은 인터페이스와 공통 사유코드를 사용한다. 코어 서비스와 컨트랙트 배포를 바꾸지 않는다.

`HKDistributionPolicy` 값은 SFC 지침을 참고한 PoC 통제 예시이지 적법한 판매를 보증하는 규칙집이 아니다. fixture에 `legalStatus: ILLUSTRATIVE_ONLY`를 포함한다.

## 5. 외국인 한도와 기타 제한

정책은 다음을 분리한다.

- `MarketAggregateForeignRoomRule`: 국내 외국인 총보유를 변화시키는 재고 매입·보충에만 적용
- `InvestorPositionLimitRule`: 개별 투자자의 보유 또는 집중도에 적용
- `JurisdictionDistributionLimitRule`: 현지 투자자 범주·판매한도에 적용
- `SanctionsRule`: 송·수신자와 기관 적격성에 적용
- `LockupRule`: 특정 권리수량과 기간에 적용
- `MarketStatusRule`: KRX 1차 주문과 운영상 RFQ 가능시간에 적용

`MarketAggregateForeignRoomRule` 데이터가 만료되면 매입을 `MANUAL_REVIEW`로 보낸다. 외국인 A에서 외국인 B로의 내부 권리 이전은 aggregate room을 소비하지 않는다.

## 6. 2단계 전환 게이트

다음이 모두 충족되기 전에는 네이티브 토큰증권 전환을 시작하지 않는다.

1. 시행 법령과 하위규정에 대한 외부 법률의견
2. 발행인 참여와 이사회·내부승인
3. 전자등록기관·계좌관리기관 역할과 원장 요건 확정
4. 거래시장, 결제자산, 투자자 보호 및 해외 판매 경로 승인
5. 1단계 권리의 종료·승계 및 미결제 기업행동 처리계획
6. 이중발행 방지 대사와 전환 리허설 통과

전환은 `SNAPSHOT -> FREEZE -> RECONCILE -> BURN_OR_CANCEL -> NATIVE_REGISTER -> VERIFY -> RELEASE` 순서를 고정한다. 어느 단계에서든 수량 불일치가 발생하면 이전 상태로 되돌리지 않고 hold 상태에서 기관 공동 판정을 기다린다.

## 7. 외부 법률검토 체크리스트

- 권리 발행주체와 자본시장법상 지위
- 수탁계좌 명의, 고객자산 분리와 도산절연
- 최종투자자 장부의 법적 증거력
- 국내 중개·장외거래·권유·광고 해당 여부
- 해외 판매기관의 라이선스, 공시와 투자자 범주
- 외국환 수취·환전·송금·보고
- 배당·양도·환매 세무와 원천징수
- 동결·강제이전·키복구의 계약상 근거와 분쟁절차
- 데이터 국외이전, 보존기간, 정보주체 권리

검토 결과는 코드 분기 추가가 아니라 정책 버전, 상품 약관과 역할 승인표의 변경으로 반영한다.
