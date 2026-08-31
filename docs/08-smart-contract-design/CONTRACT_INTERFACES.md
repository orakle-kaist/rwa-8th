# 8단계 계약 인터페이스

상태: **8단계 팀 내부 승인 완료**

이 문서는 외부에서 관찰하고 호출할 동작, 이벤트, 오류와 전환조건을 정한다. 함수, 구조체, 반환값, 이벤트와 오류의 정확한 Solidity 자료형과 `indexed` 항목은 [기계 판독 ABI](specs/contract-abi.json)를 기준으로 한다.

## 1. 공통 입력과 실행 규칙

모든 상태변경에는 `workflowId`, `evidenceHash`, 적용할 `policyVersion`을 연결한다. 주문 실행에는 EIP-712 서명, nonce와 만료시각을 추가한다.

- `workflowId`는 하나의 기관 업무를 처음부터 끝까지 묶는다.
- `evidenceHash`는 비식별 증거 연결값이며 같은 승인 목적에 한 번만 사용한다.
- 정정은 원기록을 지우지 않고 새 증거가 기존 증거를 참조한다.
- 실패해 전체 체인 거래가 되돌아가면 nonce와 증거도 소비하지 않는다.
- 실행이 성공하면 nonce, 업무와 증거 사용을 같은 체인 거래에서 확정한다.

## 2. `RestrictedEquityToken`

### 조회

| 함수 | 반환 의미 |
|---|---|
| `name`, `symbol`, `decimals` | 종목 표시정보와 항상 0인 소수점 |
| `balanceOf` | 해당 지갑의 다섯 상태 수량 합계 |
| `allowance` | 임의 운영자 승인을 지원하지 않으므로 항상 0 |
| `availableBalanceOf` | 거래 가능 수량 |
| `pendingSettlementBalanceOf` | 국내 결제 대기 수량 |
| `redemptionLockedBalanceOf` | 환매 잠금 수량 |
| `burnPendingBalanceOf` | 환매대금 결제 후 소각 대기 수량 |
| `administrativeFrozenBalanceOf` | 관리상 동결 수량 |
| `isAddressFrozen` | 해당 주소의 실행 제한 여부 |
| `totalSupply` | 다섯 상태 수량의 전체 합계 |

### 제한 동작

| 함수 | 호출 주체 | 전환조건과 결과 |
|---|---|---|
| `mintPending` | 발행 통제 계약 | 승인된 고객 지갑에 국내 결제 대기로 발행 |
| `releasePending` | 발행 통제 계약 | 결제와 수탁 확인이 모두 끝난 수량을 거래 가능으로 전환 |
| `controlledTransfer` | 2차 정산 통제 계약 | 거래 가능 수량만 투자자와 지정 시장조성자 사이에서 이전 |
| `lockForRedemption` | 환매 통제 계약 | 거래 가능에서 환매 잠금으로 전환 |
| `cancelRedemptionLock` | 환매 통제 계약 | 국내 매도가 취소 가능한 단계에서만 거래 가능으로 복귀 |
| `markBurnPending` | 환매 통제 계약 | 권리종료 뒤 환매 잠금에서 소각 대기로 전환 |
| `burnPending` | 환매 통제 계약 | 승인된 소각 대기 수량만 소각 |
| `freezeAvailable` | 관리 통제 역할 | 거래 가능에서 관리상 동결로 전환 |
| `unfreezeAvailable` | 관리 통제 역할 | 원인 해소와 승인 뒤 관리상 동결에서 거래 가능으로 복귀 |
| `freezeAddress` | 복구 또는 긴급 통제 | 지갑의 모든 실행을 차단하되 수량 상태는 유지 |
| `recoverAllBuckets` | 복구 통제 계약 | 다섯 상태를 새 지갑으로 그대로 이동하고 총량 보존 |
| `applySplitBatch` | 기업행동 통제 계약 | 전 종목 중지와 독립 승인 뒤 모든 상태를 정수 비율로 조정 |

일반 `transfer`, `transferFrom`, `approve`는 인터페이스에는 존재하지만 언제나 `DirectTransferDisabled` 또는 `ApprovalDisabled`로 실패한다. 사용자가 임의의 운영자를 승인해 통제 계약을 우회할 수 없다. 발행, 제한 이전, 복구와 소각은 표준 `Transfer` 이벤트도 함께 남기고, 주소가 바뀌지 않는 수량 상태 전환은 전용 상태 이벤트만 남긴다.

주요 이벤트는 `Transfer`, `PendingMinted`, `PendingReleased`, `ControlledTransfer`, `RedemptionLocked`, `BurnPendingMarked`, `PendingBurned`, `AdministrativeFreezeChanged`, `AddressFrozen`, `WalletRecovered`, `SplitBatchApplied`다.

## 3. `EligibilityRegistry`

| 함수 | 동작 |
|---|---|
| `setEligibility` | 지갑의 거래 가능 여부, 만료시각과 증거 해시 설정 |
| `setMarketMaker` | 지정 시장조성자 여부와 증거 해시 설정 |
| `revoke` | 적격성 또는 시장조성자 자격 철회 |
| `isEligible` | 현재시각 기준 거래 가능 여부 확인 |
| `isMarketMaker` | 현재 유효한 지정 시장조성자 여부 확인 |

온체인에는 고객 이름, 국적, 계좌번호와 판정사유 원문을 기록하지 않는다. 변경은 `EligibilityUpdated`와 `MarketMakerStatusUpdated` 이벤트로 남긴다.

## 4. `SecurityTokenFactory`

`deploySecurityToken`은 종목코드, 공식 ISIN, 표시 이름, 기호와 설계 버전을 받는다. 동일 종목코드, ISIN, 버전의 중복 배포를 거절하고 결정적 식별값과 주소를 `SecurityTokenRegistered` 이벤트로 남긴다.

- 공식 ISIN 미확인 상품은 배포하지 않는다.
- 프록시를 사용하지 않는다.
- 배포된 종목 계약의 컨트롤러와 관리자 주소를 초기화한 뒤 배포자 권한을 포기한다.
- 코드 변경은 기존 주소의 로직 교체가 아니라 새 설계 버전 배포다.

## 5. `IntentVerifier`

7단계에서 확정한 다섯 서명형을 그대로 사용한다.

| 서명형 | 실행 계약 | 핵심 목적 |
|---|---|---|
| 1차 지정가 주문 의사 | `IssuanceController` | 고객 주문과 발행 업무 연결 |
| 24/7 투자자 주문 | `SecondarySettlementController` | 방향, 한도가격과 체결수량 승인 |
| 환매 주문 의사 | `RedemptionController` | 잠글 수량과 지급경로 승인 |
| 지정 시장조성자 호가 | `SecondarySettlementController` | 반대 방향, 가격, 수량과 만료 승인 |
| 인가 해외 증권사의 정산 승인 | `SecondarySettlementController` | 고객, MM, 종목, 수량, 자금경로 승인 |

EIP-712 도메인의 `verifyingContract`는 공통 `IntentVerifier` 주소다. 외부 소유 계정과 ERC-1271을 지원하는 Safe 같은 계약지갑 서명을 모두 검증한다.

`verifyAndConsumePrimaryOrder`, `verifyAndConsumeSecondaryBundle`, `verifyAndConsumeRedemption`은 권한 있는 통제 계약만 호출할 수 있다. 서명자, 서명형, nonce 조합을 한 번만 소비한다. 서명자는 실행 전 `cancelNonce`로 미사용 nonce를 취소할 수 있다.

## 6. `IssuanceController`

| 함수 | 독립 책임 | 실행 결과 |
|---|---|---|
| `confirmExecutionAllocation` | 국내 주문집행 담당 | 체결수량과 고객별 정수 배분 및 발행 상한 확인 |
| `approveT2Risk` | 해외 증권사 위험 담당 | 체결, 배분 수량의 선발행 한도 승인 |
| `approveRightsEntry` | 해외 증권사 권리기입 승인 담당 | 고객별 수탁권리 원장 기입 승인 |
| `confirmRightsRecorded` | 해외 증권사 원장 확인 담당 | 승인된 고객별 수탁권리가 실제 원장에 반영됐음을 확인 |
| `executePendingMint` | 발행 실행 역할 | 네 독립 증거와 1차 주문 의사를 검증하고 결제 대기 발행 |
| `confirmDomesticSettlement` | 국내 결제 확인 역할 | 국내 결제 완료 증거 연결 |
| `confirmCustodyQuantity` | 수탁수량 확인 역할 | 수탁수량 반영 증거 연결 |
| `executeRelease` | 발행 실행 역할 | 두 확인을 검증해 결제 대기를 거래 가능으로 전환 |

체결과 배분 확인, 위험 승인, 권리기입 승인, 원장 반영 확인과 발행 실행은 서로 다른 역할이다. 네 사실은 같은 업무 ID, 투자자, 종목과 수량을 가리켜야 한다. 체결과 배분 확인수량을 초과할 수 없고 원장 반영 완료 전에는 발행할 수 없다. 결제 또는 수탁 중 하나만 확인되면 거래 가능 전환을 할 수 없다.

주요 이벤트는 `ExecutionAllocationConfirmed`, `T2RiskApproved`, `RightsEntryApproved`, `RightsRecordingConfirmed`, `DomesticSettlementConfirmed`, `CustodyQuantityConfirmed`다. 권리기입 승인만 끝났거나 원장 반영 확인 뒤 발행이 실패한 상태를 이벤트 조합으로 구분할 수 있어야 한다.

## 7. `SecondarySettlementController`

### USD 장부 경로

`settleUsdLedger`는 세 서명을 검증하고 거래 가능 토큰만 이전한다. 해외 증권사의 USD와 권리 원장 변경은 오프체인 결과이므로, 이벤트 `UsdLedgerSettlementRecorded`는 체인 실행을 뜻할 뿐 업무상 완료를 뜻하지 않는다.

### USDC 경로

`settleUsdc`는 등록된 시험 USDC와 권리토큰을 한 체인 거래에서 교환한다. USDC 전송 또는 토큰 이전 중 하나라도 실패하면 전체 거래가 되돌아간다. `UsdcDvpSettled` 뒤에도 해외 증권사의 고객별 수탁권리 원장 반영을 확인해야 한다.

### 공통 검증

- 투자자와 시장조성자의 방향이 반대여야 한다.
- 정확히 한쪽만 유효한 지정 시장조성자여야 한다.
- 종목, 권리토큰, 지급자산, 자금경로와 정책버전이 같아야 한다.
- 실제 체결수량과 지급금액이 승인값 및 지정가 한도에 맞아야 한다.
- 매수 주문의 금액은 상한, 매도 주문의 금액은 하한으로 검사한다.
- 부분체결은 한 번만 실행하고 잔여수량은 취소한다.
- 성공할 때만 투자자, 시장조성자와 해외 증권사 nonce를 함께 소비한다.

## 8. `RedemptionController`

| 함수 | 조건과 결과 |
|---|---|
| `lockRedemption` | 환매 의사를 검증하고 거래 가능 수량을 환매 잠금으로 전환 |
| `cancelBeforeDomesticSale` | 국내 매도가 취소 가능한 단계이고 권리 담당이 승인한 경우만 잠금 해제 |
| `confirmRightsTerminated` | T+2 매도대금 결제와 주식 수탁권리 종료 확인 |
| `confirmCashClaim` | 같은 수량에 대응하는 USD 지급청구와 금액 연결 |
| `markBurnPending` | 권리종료와 지급청구가 모두 확인된 수량을 소각 대기로 전환 |
| `approveUsdPayment` | 해외 증권사 자금 담당의 USD 지급 실행 승인과 지급 지시 증거 연결 |
| `executeBurn` | 소각 승인과 지급 연결을 검증해 소각 대기 수량 소각 |

`burnPendingBalance`에는 항상 지급청구 금액과 국내 매도대금 결제 증거가 연결돼야 한다. 소각은 임의 보유수량이 아니라 특정 환매 업무의 소각 대기 수량에만 적용한다. 실제 USD 지급 완료는 해외 증권사의 오프체인 자금 이벤트로 확인하며, 지급과 소각 중 한쪽만 끝나면 업무 조정기가 격리한다.

## 9. 복구와 기업행동

`RecoveryController`는 `approveRightsRecovery`, `approveComplianceRecovery`, `executeRecovery`를 제공한다. 새 지갑은 적격하고 기존 권리계정의 다른 활성 지갑으로 사용되지 않아야 한다. 기존 지갑을 먼저 동결한 뒤 다섯 수량 상태를 그대로 이동한다. 복구는 전역 중지 중에도 두 독립 승인이 있어야 가능하다.

`CorporateActionController`는 `approveRightsPlan`, `approveAuditPlan`, `applySplitBatch`, `finalizeSplit`을 제공한다. 분할, 병합 비율을 적용한 모든 지갑과 모든 상태 수량이 정수여야 한다. 배치 처리 전후 예상 총량이 맞지 않거나 소수 잔여분이 생기면 전체를 되돌리고 재개를 금지한다.

## 10. `MarketPolicyRegistry`

| 정책 | 적용범위 |
|---|---|
| `issuancePaused` | 해당 종목 신규 발행 |
| `secondaryPaused` | 해당 종목 24/7 정산 |
| `redemptionPaused` | 해당 종목 신규 환매 및 진행 허용범위 |
| `usdcPathPaused` | USDC 정산 경로만 |
| `globalEmergencyPaused` | 복구를 제외한 전 업무 |

긴급중지 역할은 중지값을 `true`로만 바꿀 수 있다. 재개와 정책변경은 Safe 2-of-3와 60초 지연 실행을 거친다. `ScopePaused`, `ScopeResumed`, `PolicyVersionChanged` 이벤트가 이유 코드와 증거 해시를 남긴다.

## 11. 공통 오류

| 오류 | 의미 |
|---|---|
| `DirectTransferDisabled` | 일반 이전 시도 |
| `ApprovalDisabled` | 임의 운영자 승인 시도 |
| `UnauthorizedController` | 지정되지 않은 계약 또는 역할의 실행 |
| `IneligibleWallet` | 만료, 철회 또는 미등록 지갑 |
| `MarketMakerRequired` | 지정 시장조성자 조건 불충족 |
| `InsufficientAvailableBalance` | 거래 가능 수량 부족 |
| `ScopePaused` | 업무범위 중지 |
| `SignatureExpired` | 서명 만료 |
| `NonceAlreadyUsed` | nonce 재사용 |
| `PolicyVersionMismatch` | 승인 정책버전 불일치 |
| `EvidenceAlreadyUsed` | 증거 재사용 |
| `MissingIndependentApproval` | 독립 승인이 하나 이상 누락 |
| `IssuanceEvidenceMismatch` | 발행의 업무, 투자자, 종목 또는 수량이 네 증거 사이에서 불일치 |
| `AllocationExceeded` | 발행수량이 확인된 고객별 배분 또는 체결수량 상한을 초과 |
| `PaymentMismatch` | 지급자산, 금액 또는 지정가 한도 불일치 |
| `NonIntegralCorporateAction` | 기업행동 결과가 정수로 계산되지 않음 |

오류 인자와 선택자 충돌도 [기계 판독 ABI](specs/contract-abi.json)를 기준으로 9단계에서 검사한다. API의 UUID 문자열은 정규 UUID 16바이트를 순서대로 담은 `bytes16`, 증거 해시는 `bytes32`, 지갑과 계약은 `address`, 수량, 최소단위 금액과 nonce는 `uint256`, 만료시각은 Unix seconds `uint256`으로 손실 없이 변환한다.
