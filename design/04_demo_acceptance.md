# 데모와 인수 기준

## 1. 데모 목적과 표현 원칙

데모는 “토큰을 전송했다”가 아니라 동일한 고객 주문을 세 책임영역이 서로 다른 권위장부에 근거해 처리하고, T+2 결제 전 발행을 차단하는 모습을 보여준다. 발표자는 모든 화면에서 다음 질문에 답할 수 있어야 한다.

- 누가 이 상태를 만들었고 어느 account·book이 권위기록인가?
- 고객요청, 국내 시장주문, fill, 결제, 수탁배정과 issuance를 어떻게 연결했는가?
- 어떤 policy·terms version과 data as-of를 사용했는가?
- 실제 수탁주식, 최종투자자 entitlement와 token supply가 맞는가?
- 실패·정정·재전송 시 현금이나 권리가 중복 반영되지 않았는가?
- PII를 공유하지 않으면서 10년 기록보존과 월별 보고 증거를 확인할 수 있는가?

모든 화면에 `DEMO_ONLY`를 고정 표시한다. “Dinari reference”와 “Alpaca reference” 설명은 source-backed reconstruction badge 안에서만 사용한다. 실제 Dinari·Alpaca 연동, 내부 UI 복제 또는 특정 account configuration을 사용한다는 표현은 금지한다.

## 2. 세 개의 핵심 workbench

### A. Investor Trading App

#### A-1. Onboarding and disclosures

- current distribution profile, investor category, eligibility status·expiry
- product를 crypto·non-security RWA와 분리한 securities listing
- facing foreign distributor, Korean underlying, custody chain의 역할 설명
- custodial entitlement, not direct registered share, T+2 issuance, transfer·liquidity·FX·tax risk
- agreement/disclosure version과 human acceptance timestamp
- raw PII는 화면 밖 foreign distributor vault에 있다는 설명

#### A-2. Instrument detail

- `marketIdentifier`, underlying name, 1 share : 1 entitlement, `tokenDecimals=0`
- KRX mock quote source, bid/ask 또는 last price, local timestamp, session, quote freshness
- supported order types: MARKET·LIMIT, supported TIF와 partial fill policy
- dividend·redemption terms, voting은 legal path 설명만 하고 core unavailable 표시
- direct account·DR·ETF alternative와 본 product 차이 link

미국 Dinari 가이드의 NBBO 15초 규칙을 한국 의무처럼 복사하지 않는다. 한국 화면은 KRX source·session·tick/price constraints와 quote timestamp를 사용하며 mock임을 명확히 한다.

#### A-3. Pre-trade confirmation

- side, integer quantity, order type, limit price와 TIF
- estimated KRW notional, source currency, FX rate·as-of, fees·tax disclosure
- expected settlement date와 earliest issuance time
- partial fill·unfilled fund release·correction/bust·settlement failure behavior
- exact `termsVersion`, policy outcome summary와 quote refresh action
- AI가 만든 draft와 human-confirmed fields diff
- EIP-712 human signature 직전 final confirmation

#### A-4. Order tracker

다음 stage를 한 progress bar로 뭉치지 않고 각 source와 timestamp를 표시한다.

1. `DRAFT`
2. `CONFIRMED`
3. `FUNDING_PENDING`
4. `READY_FOR_MARKET`
5. `MARKET_SUBMITTED`
6. `PARTIALLY_FILLED` 또는 `EXECUTED`
7. `AWAITING_CUSTODY_SETTLEMENT`
8. `BACKED`
9. `MINTED`

fill drawer에는 `executionId`, quantity, price, cumulative quantity, leaves quantity, executed time, expected settlement date를 표시한다. terminal partial fill은 `PARTIAL_FILL_REVIEW`와 unfilled fund release를 표시한다. settlement·issuance는 fill 완료와 별도 card로 보여준다.

#### A-5. Portfolio and entitlements

- available, pending settlement, locked, redemption pending balances
- entitlement account와 verified wallet의 masked reference
- last reconciled time, position source와 stale warning
- dividend gross·tax·fee·net, redemption timeline
- authoritative-book explanation: custody book → foreign entitlement book → synchronized token record

### B. Tokenization Operator Console

Dinari가 공개한 Entity·Account·Wallet·OrderRequest·Order·OrderFulfillment·portfolio·activity 개념에서 업무기능을 추출하되 명칭과 데이터는 vendor-neutral core model을 사용한다.

#### B-1. Entity and eligibility cases

- opaque participant and entity reference, foreign distributor
- residence jurisdiction, investor category, KYC·policy status and expiry
- disclosure refs, source institution signatures, manual-review queue
- regulatory retrieval evidence without raw PII

#### B-2. Account mapping

- participant → entitlement account → verified wallet
- entitlement account → foreign distributor ledger reference
- foreign distributor → foreign omnibus brokerage account
- omnibus account → standing-proxy custody reference and settlement cash account
- authority column: underlying position, investor entitlement, token transfer record
- linkage status: `PENDING_VERIFICATION | ACTIVE | SUSPENDED | CLOSED`
- duplicate wallet, unknown account, expired mapping and last reconciliation alerts

#### B-3. Order orchestration

- customer order request and human signature
- funding·FX confirmation and fund release
- market order reference and all fills
- correction·bust·cancel linked as activities, not overwritten state
- T+2 settlement, custody allocation, reserve and issuance references
- `correlationId`, source request IDs, source sequence, idempotency outcome
- retry/replay status and missing-sequence alert

#### B-4. Issuance and redemption queue

- requested, settled, allocated, already tokenized and available-to-issue quantities
- `CustodySettlement`, `ReserveAttestation`, approvals and evidence
- mint/burn transaction, consumed evidence and duplicate prevention
- hold reason, responsible institution, next permitted action
- redemption: lock → underlying disposition/cash source → cash ready → burn → pay → reconcile

#### B-5. Portfolio, corporate actions and reports

- aggregate custody, sum of investor entitlement positions and token supply
- KSD aggregate dividend receipt → investor gross/tax/fee/net allocations → control residual
- EOD and incremental reconciliation, stale projection, open exceptions
- monthly beneficial-owner report period, generated/submitted timestamps, recipient and `retentionUntil`
- report body is not exposed; authorized evidence retrieval only

### C. Korean Broker and Custody Infrastructure Console

Alpaca Broker API·Brokerdash·OmniSub·Activities는 기능 비교사례다. Dinari가 OmniSub를 사용한다고 표시하지 않고, 국내 화면은 FSC foreign omnibus guideline과 KRX·KSD 역할을 우선한다.

#### C-1. Legal accounts

| view | meaning | required fields |
|---|---|---|
| Foreign omnibus brokerage | foreign distributor가 owner인 법적 국내 account | opaque account ID, owner institution, status, currency, capabilities |
| Standing-proxy custody reference | 상임대리인 보관계좌와 KSD-derived custody function | opaque ref, status, source, last verified |
| Settlement cash | trade·FX settlement cash | currency, available/held/pending amounts |
| Entitlement subledger | foreign distributor가 책임지는 technical/customer allocation | distributor, participant ref, position, reporting status |
| Control residual | rounding·correction·unallocated operations | position/activity and reason |

`custodial account`를 Alpaca의 별도 account product처럼 만들지 않는다. brokerage는 법적 거래·position account, custody는 safekeeping·settlement function/status로 설명한다. 같은 institution이 두 기능을 수행해도 `BROKERAGE_OPERATIONS`와 `CUSTODY_CONTROL` principal을 분리한다.

#### C-2. Orders and fills

- inbound token-operator request and validation result
- broker order ID, KRX mock order ID, accepted/rejected/canceled/replaced/expired state
- fills with quantity, cumulative/leaves, price, time, settlement date
- correction·bust activity with `previousActivityId`
- outbound acknowledgment and stable source reference

#### C-3. Settlement timeline

- T, T+1 and T+2 business timeline
- securities leg, cash leg, KRX/KSD mock evidence and finality
- settlement completed/failed, source sequence and received time
- custody allocation to token backing only after final settlement
- failed or corrected fill automatically blocks downstream issuance

#### C-4. Custody positions

- `settledQuantity`
- `unsettledQuantity`
- `allocatedBackingQuantity`
- `unallocatedQuantity`
- `redemptionPendingQuantity`
- `controlHoldQuantity`
- `asOf`, evidence ref, source and status

`allocatedBackingQuantity <= settledQuantity`와 account-level sum을 실시간 표시한다. mismatch 또는 stale source에서는 `issuableQuantity=0`으로 projection한다.

#### C-5. Cash and activities

- funding, FX, fill, settlement, fee, dividend, refund, correction and journal-like adjustment
- financial-state activity와 non-financial order lifecycle event 구분
- stable `activityId`, source reference, previous activity, `effectiveAt`, settlement date
- stream cursor and duplicate/replay outcome

#### C-6. Corporate actions and reconciliation

- KSD aggregate receipt, effective account and record date
- foreign distributor allocation status, tax/fee/net and control residual
- incomplete corporate action causes instrument/account trading block
- EOD omnibus position, entitlement subledger sum and token supply comparison
- exception owner, evidence, correction and dual-approved resume

## 3. 보조 workbench

### Bank and FX

- source currency receipt, FX quote·expiry, KRW settlement amount
- settlement cash available/held/refunded
- mock KRW deposit token issue·burn and institutional wallet
- actual deposit·CBDC·foreign investor claim이 아니라는 fixed warning

### Compliance and Audit

- policy comparison, manual review, sanctions, freeze·forced transfer·resume dual approval
- one order/correlation based full lineage across all three workbenches
- account linkage history, privileged actions and evidence access audit
- invariant dashboard, `RECONCILIATION_HOLD`, regulatory report SLA
- ledger tx hash, evidence hash and optional anchor status

## 4. 정상 시연 스크립트

1. `INV_HK_001`의 KYC·공시동의와 두 policy decision이 유효해진다.
2. `LINK_INV_HK_001`이 entitlement account, dedicated wallet, foreign distributor ledger, omnibus brokerage와 custody reference를 `ACTIVE`로 연결한다.
3. 투자자가 SK하이닉스 10주를 선택하고 KRX mock quote, 환율·수수료, T+2와 권리성격을 확인한다.
4. AI draft와 구조화 필드를 비교한 뒤 사용자가 EIP-712로 서명한다.
5. Bank·FX mock이 funding을 확인하고 domestic settlement cash를 준비한다.
6. broker console이 order를 `MARKET_SUBMITTED`로 만들고 10주 fill을 기록한다. investor·operator 화면의 token balance는 0이다.
7. simulation clock을 T+2로 이동하고 KSD mock이 cash/securities settlement와 custody allocation 10주를 확인한다.
8. custody control과 independent control이 reserve 10주를 승인한다.
9. token operator가 entitlement token 10개를 발행하고 custody, foreign entitlement book과 token supply를 `MATCHED`로 표시한다.
10. 적격 investor 2와 2주 RFQ를 dual-sign한 뒤 mock KRW와 entitlement를 atomic DvP로 이동한다.
11. KSD aggregate cash dividend를 두 investor entitlement에 배분하고 gross·tax·fee·net·residual을 reconcile한다.
12. EOD reconciliation과 monthly reporting evidence를 생성해 세 workbench에 같은 correlation lineage를 보여준다.
13. 잔여 entitlement redemption에서 lock, underlying disposition, cash-ready, burn, pay, final reconciliation을 시연한다.

## 5. 실패 주입 시연

| ID | failure | expected result |
|---|---|---|
| F-01 | KYC expired | `ELIGIBILITY_EXPIRED`, 신규 주문 불가, balance unchanged |
| F-02 | sanctioned participant | send/receive blocked, compliance alert, raw PII absent |
| F-03 | jurisdiction denied | `JURISDICTION_POLICY_DENIED`, domestic order not created |
| F-04 | manual review | no next transition before dual approval |
| F-05 | market closed | `MARKET_CLOSED`, retry on permitted session |
| F-06 | quote stale | `QUOTE_STALE`, confirmation disabled until refresh |
| F-07 | foreign room insufficient | new underlying purchase rejected; entitlement transfer rule kept separate |
| F-08 | unknown or duplicate account-wallet mapping | `ACCOUNT_LINKAGE_INVALID`, order/receive/mint blocked |
| F-09 | terminal partial fill | unfilled funds released, `PARTIAL_FILL_REVIEW`, no auto mint |
| F-10 | fill correction or bust | compensating activity, settlement/issuance hold |
| F-11 | custody event duplicate | second event no-op, supply unchanged |
| F-12 | source sequence gap | projection stale, missing sequence alert, issuance blocked |
| F-13 | custody 9, requested mint 10 | `RECONCILIATION_HOLD`, mint and secondary settlement paused |
| F-14 | cash insufficient | DvP reverts, both balances unchanged |
| F-15 | single principal creates execution and reserve approval | `SEGREGATION_OF_DUTIES_VIOLATION` |
| F-16 | lost wallet key | old wallet freeze → new proof/linkage → dual-approved forced transfer |
| F-17 | corporate action residual mismatch | instrument trading block and `CORPORATE_ACTION_HOLD` |
| F-18 | monthly report overdue | `REGULATORY_REPORT_OVERDUE`, compliance alert and configurable new-order hold |
| F-19 | one validator unavailable | lifecycle continues only if quorum remains |
| F-20 | public anchor unavailable | core succeeds, warning and retry queue |

## 6. 합격 기준

### Cross-screen consistency

- investor, operator and broker/custody console show the same order request, fills, settlement and issuance by `correlationId`.
- no workbench labels a fill as settlement or a brokerage account as a separate custodial product.
- each state shows source, authority, `dataAsOf`, stale status and next responsible role.
- public-source reconstruction badges appear on vendor-reference explanation panels.

### Function and control

- all defined normal transitions complete in order and all failure scenarios return taxonomy codes.
- no market adapter request without human signature and active account linkage.
- fill alone never enables mint; settlement, custody allocation and reserve are all required.
- duplicate event replay changes state and balances once only.
- a correction/bust never deletes the original activity.
- no observable DvP state moves only cash or only entitlement.
- hold/resume, remap and forced transfer require distinct principals and dual approval.

### Data, privacy and reporting

- no forbidden PII key or real account number in shared DB, stream, ledger calldata, log or exported fixture.
- foreign distributor can expose regulatory-report evidence metadata and authorized retrieval path without sharing the report body.
- every external event validates schema, signature, `kid`, sequence, source time and idempotency.
- every privileged action includes before/after hashes, reason and evidence reference.
- every screen and export containing synthetic market/account data shows `DEMO_ONLY`.

### Reproducibility

- one documented bootstrap command starts all local services from an empty developer environment.
- fixed seed produces the same business states and balances except explicitly random IDs.
- core scenario finishes without paid APIs, real institution accounts, public testnet or internet.
- source-backed UI copy and fixture data can be replaced without changing normative state or invariant behavior.

## 7. 구현자가 선택할 수 없는 사항

구현 언어, web framework, database, event bus와 visual component는 자유다. 다음 의미는 바꿀 수 없다.

- public API path, schema, state, error and event semantics
- human confirmation fields and signature boundary
- account/book authority and one-to-one account-wallet linkage
- T+2 settlement-before-mint and dual control
- fill/activity/correction lineage and idempotency
- custody, final-investor entitlement and token-supply reconciliation
- regulatory reporting evidence without shared PII
- Hong Kong as replaceable demonstration profile
- vendor references as case studies rather than dependencies
- `DEMO_ONLY` representation of all mock integrations and values
