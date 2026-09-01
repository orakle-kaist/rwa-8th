// This file is generated from the approved stage-ten state transition matrix.
// Run pnpm generate after changing the approved matrix.

export const APPROVED_STATE_TRANSITIONS = {
  ELIGIBILITY_PENDING: {
    axis: "CUSTOMER_ELIGIBILITY",
    labelKo: "판정 대기",
    allowedTargets: ["ELIGIBLE", "INELIGIBLE", "ELIGIBILITY_EXPIRED"],
  },
  ELIGIBLE: {
    axis: "CUSTOMER_ELIGIBILITY",
    labelKo: "판매 허용",
    allowedTargets: ["ELIGIBILITY_EXPIRED", "ELIGIBILITY_SUSPENDED"],
  },
  INELIGIBLE: {
    axis: "CUSTOMER_ELIGIBILITY",
    labelKo: "판매 거절",
    allowedTargets: ["ELIGIBILITY_PENDING"],
  },
  ELIGIBILITY_EXPIRED: {
    axis: "CUSTOMER_ELIGIBILITY",
    labelKo: "판정 만료",
    allowedTargets: ["ELIGIBILITY_PENDING"],
  },
  ELIGIBILITY_SUSPENDED: {
    axis: "CUSTOMER_ELIGIBILITY",
    labelKo: "일시중지",
    allowedTargets: ["ELIGIBLE", "INELIGIBLE"],
  },
  PROTECTION_REVIEW_PENDING: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "보호판정 대기",
    allowedTargets: ["PROTECTION_PASSED", "PROTECTION_FAILED"],
  },
  PROTECTION_PASSED: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "보호판정 통과",
    allowedTargets: ["PROTECTION_EXPIRED", "DISCLOSURE_CONSENT_PENDING"],
  },
  PROTECTION_FAILED: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "보호판정 실패",
    allowedTargets: ["PROTECTION_REVIEW_PENDING"],
  },
  PROTECTION_EXPIRED: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "보호판정 만료",
    allowedTargets: ["PROTECTION_REVIEW_PENDING"],
  },
  DISCLOSURE_CONSENT_PENDING: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "위험공시 동의 대기",
    allowedTargets: ["DISCLOSURE_CONSENT_VALID", "DISCLOSURE_CONSENT_MISSING"],
  },
  DISCLOSURE_CONSENT_VALID: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "동의 유효",
    allowedTargets: ["DISCLOSURE_CONSENT_EXPIRED"],
  },
  DISCLOSURE_CONSENT_MISSING: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "동의 누락",
    allowedTargets: ["DISCLOSURE_CONSENT_VALID"],
  },
  DISCLOSURE_CONSENT_EXPIRED: {
    axis: "INVESTOR_PROTECTION",
    labelKo: "동의 만료",
    allowedTargets: ["DISCLOSURE_CONSENT_PENDING"],
  },
  COMPLAINT_SUBMITTED: {
    axis: "COMPLAINT",
    labelKo: "접수",
    allowedTargets: ["COMPLAINT_ASSIGNED"],
  },
  COMPLAINT_ASSIGNED: {
    axis: "COMPLAINT",
    labelKo: "책임기관 배정",
    allowedTargets: ["COMPLAINT_IN_PROGRESS"],
  },
  COMPLAINT_IN_PROGRESS: {
    axis: "COMPLAINT",
    labelKo: "처리 중",
    allowedTargets: ["COMPLAINT_RESPONSE_RECORDED"],
  },
  COMPLAINT_RESPONSE_RECORDED: {
    axis: "COMPLAINT",
    labelKo: "답변 기록",
    allowedTargets: ["COMPLAINT_CORRECTION_REVIEW", "COMPLAINT_CLOSED"],
  },
  COMPLAINT_CORRECTION_REVIEW: {
    axis: "COMPLAINT",
    labelKo: "정정 검토",
    allowedTargets: ["COMPLAINT_IN_PROGRESS", "COMPLAINT_CLOSED"],
  },
  COMPLAINT_CLOSED: { axis: "COMPLAINT", labelKo: "종결", allowedTargets: [] },
  WALLET_UNLINKED: {
    axis: "WALLET_LINKAGE",
    labelKo: "지갑 미연결",
    allowedTargets: ["WALLET_LINK_APPROVAL_PENDING"],
  },
  WALLET_LINK_APPROVAL_PENDING: {
    axis: "WALLET_LINKAGE",
    labelKo: "연결 승인 대기",
    allowedTargets: ["WALLET_LINKED", "WALLET_UNLINKED"],
  },
  WALLET_LINKED: {
    axis: "WALLET_LINKAGE",
    labelKo: "연결 완료",
    allowedTargets: ["WALLET_REPLACEMENT_REVIEW", "WALLET_FROZEN"],
  },
  WALLET_REPLACEMENT_REVIEW: {
    axis: "WALLET_LINKAGE",
    labelKo: "교체 검토",
    allowedTargets: ["WALLET_LINKED", "WALLET_FROZEN"],
  },
  WALLET_FROZEN: {
    axis: "WALLET_LINKAGE",
    labelKo: "지갑 동결",
    allowedTargets: ["WALLET_REPLACEMENT_REVIEW", "WALLET_LINKED"],
  },
  PRODUCT_CANDIDATE: {
    axis: "PRODUCT_COMMON",
    labelKo: "후보",
    allowedTargets: ["PRODUCT_REVIEWED", "PRODUCT_INFORMATION_UNCONFIRMED"],
  },
  PRODUCT_REVIEWED: {
    axis: "PRODUCT_COMMON",
    labelKo: "검토 완료",
    allowedTargets: ["PRODUCT_INFORMATION_UNCONFIRMED", "MATERIAL_EVENT_REVIEW"],
  },
  PRODUCT_INFORMATION_UNCONFIRMED: {
    axis: "PRODUCT_COMMON",
    labelKo: "정보 미확인",
    allowedTargets: ["PRODUCT_CANDIDATE", "PRODUCT_REVIEWED"],
  },
  MATERIAL_EVENT_REVIEW: {
    axis: "PRODUCT_COMMON",
    labelKo: "중요사건 검토",
    allowedTargets: ["PRODUCT_REVIEWED"],
  },
  PRIMARY_ENABLED: {
    axis: "PRIMARY_AVAILABILITY",
    labelKo: "발행 허용",
    allowedTargets: ["PRIMARY_DISABLED"],
  },
  PRIMARY_DISABLED: {
    axis: "PRIMARY_AVAILABILITY",
    labelKo: "발행 중지",
    allowedTargets: ["PRIMARY_ENABLED"],
  },
  SECONDARY_ENABLED: {
    axis: "SECONDARY_AVAILABILITY",
    labelKo: "24/7 허용",
    allowedTargets: ["SECONDARY_DISABLED"],
  },
  SECONDARY_DISABLED: {
    axis: "SECONDARY_AVAILABILITY",
    labelKo: "24/7 중지",
    allowedTargets: ["SECONDARY_ENABLED"],
  },
  REDEMPTION_ENABLED: {
    axis: "REDEMPTION_AVAILABILITY",
    labelKo: "환매 허용",
    allowedTargets: ["REDEMPTION_RESTRICTED"],
  },
  REDEMPTION_RESTRICTED: {
    axis: "REDEMPTION_AVAILABILITY",
    labelKo: "환매 제한",
    allowedTargets: ["REDEMPTION_ENABLED"],
  },
  PRIMARY_DRAFT: {
    axis: "PRIMARY_ORDER",
    labelKo: "주문 작성",
    allowedTargets: ["PRIMARY_FUNDS_CHECK", "PRIMARY_CANCELLED"],
  },
  PRIMARY_FUNDS_CHECK: {
    axis: "PRIMARY_ORDER",
    labelKo: "자금 확인",
    allowedTargets: ["PRIMARY_AGGREGATION_PENDING", "PRIMARY_FUNDS_CHECK_FAILED"],
  },
  PRIMARY_FUNDS_CHECK_FAILED: {
    axis: "PRIMARY_ORDER",
    labelKo: "자금 확인 실패",
    allowedTargets: ["PRIMARY_DRAFT", "PRIMARY_CANCELLED"],
  },
  PRIMARY_AGGREGATION_PENDING: {
    axis: "PRIMARY_ORDER",
    labelKo: "취합 대기",
    allowedTargets: [
      "PRIMARY_KRX_OPEN_PENDING",
      "PRIMARY_SUBMITTED_DOMESTICALLY",
      "PRIMARY_CANCELLED",
    ],
  },
  PRIMARY_KRX_OPEN_PENDING: {
    axis: "PRIMARY_ORDER",
    labelKo: "KRX 개장 대기",
    allowedTargets: ["PRIMARY_SUBMITTED_DOMESTICALLY", "PRIMARY_CANCELLED"],
  },
  PRIMARY_SUBMITTED_DOMESTICALLY: {
    axis: "PRIMARY_ORDER",
    labelKo: "국내 제출",
    allowedTargets: [
      "PRIMARY_UNFILLED",
      "PRIMARY_PARTIALLY_FILLED",
      "PRIMARY_FULLY_FILLED",
      "PRIMARY_CORRECTION_REVIEW",
    ],
  },
  PRIMARY_UNFILLED: {
    axis: "PRIMARY_ORDER",
    labelKo: "미체결",
    allowedTargets: ["RESERVATION_RELEASED", "PRIMARY_CORRECTION_REVIEW"],
  },
  PRIMARY_PARTIALLY_FILLED: {
    axis: "PRIMARY_ORDER",
    labelKo: "부분체결",
    allowedTargets: ["PRIMARY_ALLOCATION_COMPLETED", "PRIMARY_CORRECTION_REVIEW"],
  },
  PRIMARY_FULLY_FILLED: {
    axis: "PRIMARY_ORDER",
    labelKo: "전량체결",
    allowedTargets: ["PRIMARY_ALLOCATION_COMPLETED", "PRIMARY_CORRECTION_REVIEW"],
  },
  PRIMARY_ALLOCATION_COMPLETED: {
    axis: "PRIMARY_ORDER",
    labelKo: "고객별 배분",
    allowedTargets: ["EXECUTED_NOT_ISSUED"],
  },
  PRIMARY_CORRECTION_REVIEW: {
    axis: "PRIMARY_ORDER",
    labelKo: "정정 검토",
    allowedTargets: [
      "PRIMARY_SUBMITTED_DOMESTICALLY",
      "PRIMARY_UNFILLED",
      "PRIMARY_PARTIALLY_FILLED",
      "PRIMARY_FULLY_FILLED",
      "RIGHTS_ENTRY_QUARANTINED",
    ],
  },
  PRIMARY_CANCELLED: { axis: "PRIMARY_ORDER", labelKo: "취소 완료", allowedTargets: [] },
  EXECUTED_NOT_ISSUED: {
    axis: "RIGHTS_ENTRY",
    labelKo: "체결 후 미발행",
    allowedTargets: ["T2_RISK_APPROVAL_PENDING", "RIGHTS_ENTRY_QUARANTINED"],
  },
  T2_RISK_APPROVAL_PENDING: {
    axis: "RIGHTS_ENTRY",
    labelKo: "위험 승인 대기",
    allowedTargets: ["RIGHTS_APPROVAL_PENDING", "RIGHTS_ENTRY_QUARANTINED"],
  },
  RIGHTS_APPROVAL_PENDING: {
    axis: "RIGHTS_ENTRY",
    labelKo: "권리기입 승인 대기",
    allowedTargets: ["RIGHTS_ENTRY_PENDING", "RIGHTS_ENTRY_QUARANTINED"],
  },
  RIGHTS_ENTRY_PENDING: {
    axis: "RIGHTS_ENTRY",
    labelKo: "권리기입 실행 대기",
    allowedTargets: ["RIGHTS_ENTRY_COMPLETED", "RIGHTS_ENTRY_QUARANTINED"],
  },
  RIGHTS_ENTRY_COMPLETED: {
    axis: "RIGHTS_ENTRY",
    labelKo: "권리기입 완료",
    allowedTargets: ["TOKEN_MINT_PENDING", "RIGHTS_ENTRY_QUARANTINED"],
  },
  TOKEN_MINT_PENDING: {
    axis: "RIGHTS_ENTRY",
    labelKo: "발행 실행 대기",
    allowedTargets: ["TOKEN_SETTLEMENT_PENDING", "RIGHTS_ENTRY_QUARANTINED"],
  },
  RIGHTS_ENTRY_QUARANTINED: {
    axis: "RIGHTS_ENTRY",
    labelKo: "격리 검토",
    allowedTargets: ["TOKEN_MINT_PENDING", "TOKEN_SETTLEMENT_PENDING", "CORRECTION_PENDING"],
  },
  TOKEN_UNMINTED: {
    axis: "TOKEN_LIFECYCLE",
    labelKo: "미발행",
    allowedTargets: ["TOKEN_SETTLEMENT_PENDING"],
  },
  TOKEN_SETTLEMENT_PENDING: {
    axis: "TOKEN_LIFECYCLE",
    labelKo: "국내 결제 대기",
    allowedTargets: ["TOKEN_TRADABLE", "TOKEN_QUARANTINED"],
  },
  TOKEN_TRADABLE: {
    axis: "TOKEN_LIFECYCLE",
    labelKo: "거래 가능",
    allowedTargets: ["TOKEN_RESERVED", "TOKEN_REDEMPTION_LOCKED", "TOKEN_QUARANTINED"],
  },
  TOKEN_RESERVED: {
    axis: "TOKEN_LIFECYCLE",
    labelKo: "24/7 예약",
    allowedTargets: ["TOKEN_TRADABLE", "TOKEN_QUARANTINED"],
  },
  TOKEN_REDEMPTION_LOCKED: {
    axis: "TOKEN_LIFECYCLE",
    labelKo: "환매 잠금",
    allowedTargets: ["TOKEN_TRADABLE", "TOKEN_BURN_PENDING", "TOKEN_QUARANTINED"],
  },
  TOKEN_BURN_PENDING: {
    axis: "TOKEN_LIFECYCLE",
    labelKo: "환매 소각 대기",
    allowedTargets: ["TOKEN_BURNED", "TOKEN_QUARANTINED"],
  },
  TOKEN_BURNED: { axis: "TOKEN_LIFECYCLE", labelKo: "소각 완료", allowedTargets: [] },
  TOKEN_QUARANTINED: {
    axis: "TOKEN_LIFECYCLE",
    labelKo: "격리 검토",
    allowedTargets: ["TOKEN_TRADABLE", "TOKEN_BURN_PENDING", "CORRECTION_PENDING"],
  },
  SETTLEMENT_AND_CUSTODY_PENDING: {
    axis: "DOMESTIC_SETTLEMENT",
    labelKo: "두 확인 대기",
    allowedTargets: [
      "SETTLEMENT_ONLY_CONFIRMED",
      "CUSTODY_ONLY_CONFIRMED",
      "SETTLEMENT_AND_CUSTODY_CONFIRMED",
      "SETTLEMENT_EXCEPTION_REVIEW",
    ],
  },
  SETTLEMENT_ONLY_CONFIRMED: {
    axis: "DOMESTIC_SETTLEMENT",
    labelKo: "결제만 확인",
    allowedTargets: ["SETTLEMENT_AND_CUSTODY_CONFIRMED", "SETTLEMENT_EXCEPTION_REVIEW"],
  },
  CUSTODY_ONLY_CONFIRMED: {
    axis: "DOMESTIC_SETTLEMENT",
    labelKo: "수탁만 확인",
    allowedTargets: ["SETTLEMENT_AND_CUSTODY_CONFIRMED", "SETTLEMENT_EXCEPTION_REVIEW"],
  },
  SETTLEMENT_AND_CUSTODY_CONFIRMED: {
    axis: "DOMESTIC_SETTLEMENT",
    labelKo: "거래 가능",
    allowedTargets: [],
  },
  SETTLEMENT_EXCEPTION_REVIEW: {
    axis: "DOMESTIC_SETTLEMENT",
    labelKo: "결제 예외 검토",
    allowedTargets: [
      "SETTLEMENT_AND_CUSTODY_PENDING",
      "SETTLEMENT_AND_CUSTODY_CONFIRMED",
      "RECONCILIATION_QUARANTINED",
    ],
  },
  CUSTODY_CONFIRMATION_PENDING: {
    axis: "CUSTODY_CONFIRMATION",
    labelKo: "수탁 확인 대기",
    allowedTargets: ["CUSTODY_CONFIRMED", "CUSTODY_MISMATCH"],
  },
  CUSTODY_CONFIRMED: {
    axis: "CUSTODY_CONFIRMATION",
    labelKo: "수탁 확인 완료",
    allowedTargets: [],
  },
  CUSTODY_MISMATCH: {
    axis: "CUSTODY_CONFIRMATION",
    labelKo: "수탁수량 불일치",
    allowedTargets: ["CUSTODY_CONFIRMATION_PENDING", "RECONCILIATION_QUARANTINED"],
  },
  FUNDS_AVAILABLE: { axis: "FUNDING", labelKo: "사용 가능", allowedTargets: ["FUNDS_RESERVED"] },
  FUNDS_RECEIPT_CONFIRMED: {
    axis: "FUNDING",
    labelKo: "수취 확인",
    allowedTargets: ["USD_CONVERSION_PENDING"],
  },
  USD_CONVERSION_PENDING: {
    axis: "FUNDING",
    labelKo: "USD 전환 대기",
    allowedTargets: ["USD_ATTRIBUTED", "FUNDS_RETURN_PENDING"],
  },
  USD_ATTRIBUTED: { axis: "FUNDING", labelKo: "USD 귀속", allowedTargets: ["FUNDS_RESERVED"] },
  FUNDS_RESERVED: { axis: "FUNDING", labelKo: "예약", allowedTargets: ["USDC_PAYMENT_CONFIRMED"] },
  FUNDS_USED: { axis: "FUNDING", labelKo: "사용", allowedTargets: ["RESERVATION_RELEASED"] },
  RESERVATION_RELEASED: { axis: "FUNDING", labelKo: "잔여 예약 해제", allowedTargets: [] },
  FUNDS_RETURN_PENDING: {
    axis: "FUNDING",
    labelKo: "반환 검토",
    allowedTargets: ["FUNDS_AVAILABLE"],
  },
  WALLET_BALANCE_CONFIRMED: {
    axis: "FUNDING",
    labelKo: "지갑잔액 확인",
    allowedTargets: ["FUNDS_RESERVED"],
  },
  TRANSFER_CONFIRMED: { axis: "FUNDING", labelKo: "이전 확인", allowedTargets: [] },
  PAYMENT_PENDING: { axis: "FUNDING", labelKo: "지급 대기", allowedTargets: ["PAYMENT_COMPLETED"] },
  PAYMENT_COMPLETED: {
    axis: "FUNDING",
    labelKo: "지급 완료",
    allowedTargets: ["CONVERSION_QUOTED"],
  },
  CONVERSION_QUOTED: {
    axis: "FUNDING",
    labelKo: "견적 제시",
    allowedTargets: ["CUSTOMER_CONVERSION_CONFIRMED", "RESERVATION_RELEASED_AFTER_FAILURE"],
  },
  CUSTOMER_CONVERSION_CONFIRMED: {
    axis: "FUNDING",
    labelKo: "고객 확인",
    allowedTargets: ["FUNDS_RESERVED", "RESERVATION_RELEASED_AFTER_FAILURE"],
  },
  USDC_PAYMENT_CONFIRMED: { axis: "FUNDING", labelKo: "USDC 지급 확인", allowedTargets: [] },
  RESERVATION_RELEASED_AFTER_FAILURE: {
    axis: "FUNDING",
    labelKo: "예약 해제",
    allowedTargets: ["FUNDS_AVAILABLE"],
  },
  QUOTE_DRAFT: {
    axis: "MARKET_MAKER_QUOTE",
    labelKo: "호가 작성",
    allowedTargets: ["QUOTE_REVIEW"],
  },
  QUOTE_REVIEW: {
    axis: "MARKET_MAKER_QUOTE",
    labelKo: "호가 검토",
    allowedTargets: ["QUOTE_ACTIVE", "QUOTE_BLOCKED", "QUOTE_WITHDRAWN"],
  },
  QUOTE_ACTIVE: {
    axis: "MARKET_MAKER_QUOTE",
    labelKo: "유효 호가",
    allowedTargets: [
      "QUOTE_PARTIALLY_FILLED",
      "QUOTE_FULLY_FILLED",
      "QUOTE_EXPIRED",
      "QUOTE_WITHDRAWN",
      "QUOTE_BLOCKED",
    ],
  },
  QUOTE_PARTIALLY_FILLED: {
    axis: "MARKET_MAKER_QUOTE",
    labelKo: "일부 소진",
    allowedTargets: ["QUOTE_FULLY_FILLED", "QUOTE_EXPIRED", "QUOTE_WITHDRAWN", "QUOTE_BLOCKED"],
  },
  QUOTE_FULLY_FILLED: { axis: "MARKET_MAKER_QUOTE", labelKo: "전량 소진", allowedTargets: [] },
  QUOTE_EXPIRED: { axis: "MARKET_MAKER_QUOTE", labelKo: "만료", allowedTargets: [] },
  QUOTE_WITHDRAWN: { axis: "MARKET_MAKER_QUOTE", labelKo: "철회", allowedTargets: [] },
  QUOTE_BLOCKED: {
    axis: "MARKET_MAKER_QUOTE",
    labelKo: "호가 차단",
    allowedTargets: ["QUOTE_REVIEW"],
  },
  SECONDARY_ORDER_RECEIVED: {
    axis: "SECONDARY_TRADE",
    labelKo: "주문 접수",
    allowedTargets: ["SECONDARY_PRECHECK"],
  },
  SECONDARY_PRECHECK: {
    axis: "SECONDARY_TRADE",
    labelKo: "사전검사",
    allowedTargets: ["SECONDARY_RESERVED", "SECONDARY_REJECTED"],
  },
  SECONDARY_RESERVED: {
    axis: "SECONDARY_TRADE",
    labelKo: "예약",
    allowedTargets: [
      "SECONDARY_PARTIALLY_CONFIRMED",
      "SECONDARY_FULLY_CONFIRMED",
      "SECONDARY_AUTO_REVERSED",
      "SECONDARY_QUARANTINED",
    ],
  },
  SECONDARY_PARTIALLY_CONFIRMED: {
    axis: "SECONDARY_TRADE",
    labelKo: "부분 확정",
    allowedTargets: ["SECONDARY_COMPLETED", "SECONDARY_AUTO_REVERSED", "SECONDARY_QUARANTINED"],
  },
  SECONDARY_FULLY_CONFIRMED: {
    axis: "SECONDARY_TRADE",
    labelKo: "전량 확정",
    allowedTargets: ["SECONDARY_COMPLETED", "SECONDARY_QUARANTINED"],
  },
  SECONDARY_AUTO_REVERSED: { axis: "SECONDARY_TRADE", labelKo: "자동 원복", allowedTargets: [] },
  SECONDARY_QUARANTINED: {
    axis: "SECONDARY_TRADE",
    labelKo: "격리 검토",
    allowedTargets: ["SECONDARY_COMPLETED", "CORRECTION_PENDING"],
  },
  SECONDARY_COMPLETED: { axis: "SECONDARY_TRADE", labelKo: "완료", allowedTargets: [] },
  SECONDARY_REJECTED: { axis: "SECONDARY_TRADE", labelKo: "거절", allowedTargets: [] },
  MM_NORMAL: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "정상 운영",
    allowedTargets: ["MM_RISK_REDUCING_ONLY", "MM_QUOTING_HALTED", "HEDGE_CREATED"],
  },
  MM_RISK_REDUCING_ONLY: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "위험 축소 전용",
    allowedTargets: ["MM_NORMAL", "MM_QUOTING_HALTED", "HEDGE_CREATED"],
  },
  MM_QUOTING_HALTED: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "호가 중지",
    allowedTargets: ["MM_RISK_REDUCING_ONLY", "MM_NORMAL"],
  },
  HEDGE_CREATED: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "헤지 생성",
    allowedTargets: ["HEDGE_RISK_REVIEW"],
  },
  HEDGE_RISK_REVIEW: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "위험 검토",
    allowedTargets: ["HEDGE_KRX_OPEN_PENDING", "HEDGE_ON_HOLD"],
  },
  HEDGE_KRX_OPEN_PENDING: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "KRX 개장 대기",
    allowedTargets: ["HEDGE_SUBMITTED_DOMESTICALLY", "HEDGE_ON_HOLD"],
  },
  HEDGE_SUBMITTED_DOMESTICALLY: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "국내 제출",
    allowedTargets: ["HEDGE_PARTIALLY_FILLED", "HEDGE_FULLY_FILLED", "HEDGE_ON_HOLD"],
  },
  HEDGE_PARTIALLY_FILLED: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "부분체결",
    allowedTargets: ["HEDGE_T2_PENDING", "HEDGE_ON_HOLD"],
  },
  HEDGE_FULLY_FILLED: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "전량체결",
    allowedTargets: ["HEDGE_T2_PENDING"],
  },
  HEDGE_T2_PENDING: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "T+2 대기",
    allowedTargets: ["HEDGE_INVENTORY_ADJUSTED", "HEDGE_ON_HOLD"],
  },
  HEDGE_INVENTORY_ADJUSTED: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "재고조정 완료",
    allowedTargets: ["MM_NORMAL", "MM_RISK_REDUCING_ONLY"],
  },
  HEDGE_ON_HOLD: {
    axis: "MARKET_MAKER_HEDGE",
    labelKo: "헤지 보류",
    allowedTargets: ["HEDGE_RISK_REVIEW", "HEDGE_KRX_OPEN_PENDING", "MM_QUOTING_HALTED"],
  },
  REDEMPTION_REQUESTED: {
    axis: "REDEMPTION",
    labelKo: "환매 요청",
    allowedTargets: ["REDEMPTION_CANCELLED", "RIGHTS_AND_TOKEN_LOCKED"],
  },
  REDEMPTION_CANCELLED: {
    axis: "REDEMPTION",
    labelKo: "국내 제출 전 환매 취소",
    allowedTargets: [],
  },
  RIGHTS_AND_TOKEN_LOCKED: {
    axis: "REDEMPTION",
    labelKo: "권리와 토큰 잠금",
    allowedTargets: ["DOMESTIC_SALE_PENDING", "REDEMPTION_CANCELLED"],
  },
  DOMESTIC_SALE_PENDING: {
    axis: "REDEMPTION",
    labelKo: "국내 매도 대기",
    allowedTargets: ["REDEMPTION_SUBMITTED_DOMESTICALLY", "REDEMPTION_CANCELLED"],
  },
  REDEMPTION_SUBMITTED_DOMESTICALLY: {
    axis: "REDEMPTION",
    labelKo: "국내 제출",
    allowedTargets: [
      "REDEMPTION_UNFILLED",
      "REDEMPTION_PARTIALLY_FILLED",
      "REDEMPTION_FULLY_FILLED",
      "REDEMPTION_EXCEPTION_REVIEW",
    ],
  },
  REDEMPTION_UNFILLED: {
    axis: "REDEMPTION",
    labelKo: "미체결",
    allowedTargets: ["TOKEN_TRADABLE", "REDEMPTION_EXCEPTION_REVIEW"],
  },
  REDEMPTION_PARTIALLY_FILLED: {
    axis: "REDEMPTION",
    labelKo: "부분체결",
    allowedTargets: [
      "SALE_PROCEEDS_SETTLEMENT_PENDING",
      "TOKEN_TRADABLE",
      "REDEMPTION_EXCEPTION_REVIEW",
    ],
  },
  REDEMPTION_FULLY_FILLED: {
    axis: "REDEMPTION",
    labelKo: "전량체결",
    allowedTargets: ["SALE_PROCEEDS_SETTLEMENT_PENDING"],
  },
  SALE_PROCEEDS_SETTLEMENT_PENDING: {
    axis: "REDEMPTION",
    labelKo: "매도대금 결제 대기",
    allowedTargets: ["RIGHTS_TERMINATED_CASH_CLAIM_CREATED", "REDEMPTION_EXCEPTION_REVIEW"],
  },
  RIGHTS_TERMINATED_CASH_CLAIM_CREATED: {
    axis: "REDEMPTION",
    labelKo: "권리종료와 지급청구 전환",
    allowedTargets: ["REDEMPTION_BURN_PENDING"],
  },
  REDEMPTION_BURN_PENDING: {
    axis: "REDEMPTION",
    labelKo: "환매 소각 대기",
    allowedTargets: ["REDEMPTION_COMPLETED"],
  },
  REDEMPTION_COMPLETED: { axis: "REDEMPTION", labelKo: "환매 완료", allowedTargets: [] },
  REDEMPTION_EXCEPTION_REVIEW: {
    axis: "REDEMPTION",
    labelKo: "환매 예외 검토",
    allowedTargets: [
      "SALE_PROCEEDS_SETTLEMENT_PENDING",
      "REDEMPTION_QUARANTINED",
      "TOKEN_TRADABLE",
    ],
  },
  REDEMPTION_QUARANTINED: {
    axis: "REDEMPTION",
    labelKo: "격리 검토",
    allowedTargets: ["CORRECTION_PENDING", "REDEMPTION_COMPLETED"],
  },
  DIVIDEND_EVENT_CONFIRMED: {
    axis: "DIVIDEND",
    labelKo: "사건 확인",
    allowedTargets: ["DIVIDEND_SNAPSHOT_REVIEW"],
  },
  DIVIDEND_SNAPSHOT_REVIEW: {
    axis: "DIVIDEND",
    labelKo: "권리 스냅샷 검토",
    allowedTargets: ["DIVIDEND_ALLOCATION_APPROVED", "DIVIDEND_RIGHTS_EXCEPTION_REVIEW"],
  },
  DIVIDEND_ALLOCATION_APPROVED: {
    axis: "DIVIDEND",
    labelKo: "배분안 승인",
    allowedTargets: ["DIVIDEND_USD_PAYMENT_PENDING"],
  },
  DIVIDEND_USD_PAYMENT_PENDING: {
    axis: "DIVIDEND",
    labelKo: "USD 지급 대기",
    allowedTargets: ["DIVIDEND_USD_PAID", "DIVIDEND_RIGHTS_EXCEPTION_REVIEW"],
  },
  DIVIDEND_USD_PAID: {
    axis: "DIVIDEND",
    labelKo: "USD 배당 완료",
    allowedTargets: ["DIVIDEND_USDC_QUOTED"],
  },
  DIVIDEND_USDC_QUOTED: {
    axis: "DIVIDEND",
    labelKo: "USDC 전환 견적",
    allowedTargets: ["DIVIDEND_CONVERSION_CONFIRMED", "DIVIDEND_QUOTE_EXPIRED"],
  },
  DIVIDEND_CONVERSION_CONFIRMED: {
    axis: "DIVIDEND",
    labelKo: "고객 전환 확인",
    allowedTargets: ["DIVIDEND_USD_RESERVED", "DIVIDEND_QUOTE_EXPIRED"],
  },
  DIVIDEND_USD_RESERVED: {
    axis: "DIVIDEND",
    labelKo: "USD 예약",
    allowedTargets: [
      "DIVIDEND_USDC_PAID",
      "DIVIDEND_RESERVATION_RELEASED",
      "RECONCILIATION_QUARANTINED",
    ],
  },
  DIVIDEND_USDC_PAID: {
    axis: "DIVIDEND",
    labelKo: "USDC 지급 확인",
    allowedTargets: ["DIVIDEND_CONVERSION_COMPLETED"],
  },
  DIVIDEND_QUOTE_EXPIRED: {
    axis: "DIVIDEND",
    labelKo: "견적 만료",
    allowedTargets: ["DIVIDEND_USD_PAID"],
  },
  DIVIDEND_RESERVATION_RELEASED: {
    axis: "DIVIDEND",
    labelKo: "예약 해제",
    allowedTargets: ["DIVIDEND_USD_PAID"],
  },
  DIVIDEND_CONVERSION_COMPLETED: { axis: "DIVIDEND", labelKo: "전환 완료", allowedTargets: [] },
  DIVIDEND_RIGHTS_EXCEPTION_REVIEW: {
    axis: "DIVIDEND",
    labelKo: "권리 예외 검토",
    allowedTargets: [
      "DIVIDEND_SNAPSHOT_REVIEW",
      "DIVIDEND_ALLOCATION_APPROVED",
      "RECONCILIATION_QUARANTINED",
    ],
  },
  VOTE_AGENDA_CONFIRMED: {
    axis: "VOTING",
    labelKo: "안건 확인",
    allowedTargets: ["VOTE_INSTRUCTION_COLLECTION"],
  },
  VOTE_INSTRUCTION_COLLECTION: {
    axis: "VOTING",
    labelKo: "지시 수집",
    allowedTargets: ["VOTE_TALLY_APPROVED"],
  },
  VOTE_TALLY_APPROVED: {
    axis: "VOTING",
    labelKo: "집계 승인",
    allowedTargets: ["VOTE_DOMESTIC_EXECUTION_PENDING"],
  },
  VOTE_DOMESTIC_EXECUTION_PENDING: {
    axis: "VOTING",
    labelKo: "국내 행사 대기",
    allowedTargets: ["VOTE_EXECUTION_CONFIRMED"],
  },
  VOTE_EXECUTION_CONFIRMED: {
    axis: "VOTING",
    labelKo: "행사 결과 확인",
    allowedTargets: ["VOTE_COMPLETED", "DIVIDEND_RIGHTS_EXCEPTION_REVIEW"],
  },
  VOTE_COMPLETED: { axis: "VOTING", labelKo: "의결권 완료", allowedTargets: [] },
  CORPORATE_ACTION_DETECTED: {
    axis: "CORPORATE_ACTION",
    labelKo: "사건 감지",
    allowedTargets: ["CORPORATE_ACTION_ALL_WORK_HELD"],
  },
  CORPORATE_ACTION_ALL_WORK_HELD: {
    axis: "CORPORATE_ACTION",
    labelKo: "세 업무 중지",
    allowedTargets: ["CORPORATE_ACTION_PLAN_REVIEW"],
  },
  CORPORATE_ACTION_PLAN_REVIEW: {
    axis: "CORPORATE_ACTION",
    labelKo: "변경안 검토",
    allowedTargets: ["CORPORATE_ACTION_PLAN_APPROVED"],
  },
  CORPORATE_ACTION_PLAN_APPROVED: {
    axis: "CORPORATE_ACTION",
    labelKo: "변경안 승인",
    allowedTargets: ["CORPORATE_ACTION_QUANTITY_APPLIED"],
  },
  CORPORATE_ACTION_QUANTITY_APPLIED: {
    axis: "CORPORATE_ACTION",
    labelKo: "수량 반영",
    allowedTargets: ["CORPORATE_ACTION_RECONCILED"],
  },
  CORPORATE_ACTION_RECONCILED: {
    axis: "CORPORATE_ACTION",
    labelKo: "전체 재대사",
    allowedTargets: ["CORPORATE_ACTION_RELEASE_APPROVED"],
  },
  CORPORATE_ACTION_RELEASE_APPROVED: {
    axis: "CORPORATE_ACTION",
    labelKo: "재개 승인",
    allowedTargets: [],
  },
  REPORTING_PERIOD_CLOSED: {
    axis: "REGULATORY_REPORT",
    labelKo: "보고기간 마감",
    allowedTargets: ["REPORT_GENERATED"],
  },
  REPORT_GENERATED: {
    axis: "REGULATORY_REPORT",
    labelKo: "보고 생성",
    allowedTargets: ["REPORT_APPROVED"],
  },
  REPORT_APPROVED: {
    axis: "REGULATORY_REPORT",
    labelKo: "보고 승인",
    allowedTargets: ["REPORT_SUBMISSION_PENDING", "REPORT_CORRECTION_REVIEW"],
  },
  REPORT_SUBMISSION_PENDING: {
    axis: "REGULATORY_REPORT",
    labelKo: "제출 대기",
    allowedTargets: ["REPORT_SUBMITTED_ON_TIME", "REPORT_SUBMITTED_LATE"],
  },
  REPORT_SUBMITTED_ON_TIME: {
    axis: "REGULATORY_REPORT",
    labelKo: "기한 내 제출",
    allowedTargets: ["REPORT_RECEIPT_CONFIRMED"],
  },
  REPORT_SUBMITTED_LATE: {
    axis: "REGULATORY_REPORT",
    labelKo: "지연 제출",
    allowedTargets: ["REPORT_RECEIPT_CONFIRMED", "REPORT_CORRECTION_REVIEW"],
  },
  REPORT_RECEIPT_CONFIRMED: {
    axis: "REGULATORY_REPORT",
    labelKo: "제출 확인",
    allowedTargets: ["REPORT_COMPLETED", "REPORT_CORRECTION_REVIEW"],
  },
  REPORT_CORRECTION_REVIEW: {
    axis: "REGULATORY_REPORT",
    labelKo: "정정 검토",
    allowedTargets: ["REPORT_GENERATED", "REPORT_APPROVED", "REPORT_CORRECTED"],
  },
  REPORT_CORRECTED: {
    axis: "REGULATORY_REPORT",
    labelKo: "정정 제출",
    allowedTargets: ["REPORT_RECEIPT_CONFIRMED"],
  },
  REPORT_COMPLETED: { axis: "REGULATORY_REPORT", labelKo: "보고 완료", allowedTargets: [] },
  RECONCILIATION_MATCHED: {
    axis: "RECONCILIATION",
    labelKo: "대사 일치",
    allowedTargets: ["EXPECTED_TRANSITION_CONFIRMED", "MISMATCH_SUSPECTED"],
  },
  EXPECTED_TRANSITION_CONFIRMED: {
    axis: "RECONCILIATION",
    labelKo: "정상 과도기 확인",
    allowedTargets: ["RECONCILIATION_MATCHED", "MISMATCH_SUSPECTED"],
  },
  MISMATCH_SUSPECTED: {
    axis: "RECONCILIATION",
    labelKo: "불일치 의심",
    allowedTargets: ["WORK_HALTED", "RECONCILIATION_MATCHED"],
  },
  WORK_HALTED: {
    axis: "RECONCILIATION",
    labelKo: "업무 중지",
    allowedTargets: ["EVIDENCE_COLLECTION"],
  },
  EVIDENCE_COLLECTION: {
    axis: "RECONCILIATION",
    labelKo: "증거 수집",
    allowedTargets: ["ROOT_CAUSE_CONFIRMED", "RECONCILIATION_QUARANTINED"],
  },
  ROOT_CAUSE_CONFIRMED: {
    axis: "RECONCILIATION",
    labelKo: "원인 확정",
    allowedTargets: ["CORRECTION_PENDING"],
  },
  RECONCILIATION_QUARANTINED: {
    axis: "RECONCILIATION",
    labelKo: "격리 검토",
    allowedTargets: ["CORRECTION_PENDING", "RECONCILIATION_MATCHED"],
  },
  CORRECTION_PENDING: {
    axis: "RECONCILIATION",
    labelKo: "보정 대기",
    allowedTargets: ["FULL_RECONCILIATION_COMPLETED"],
  },
  FULL_RECONCILIATION_COMPLETED: {
    axis: "RECONCILIATION",
    labelKo: "전체 재대사",
    allowedTargets: ["RELEASE_APPROVED", "MISMATCH_SUSPECTED"],
  },
  RELEASE_APPROVED: {
    axis: "RECONCILIATION",
    labelKo: "재개 승인",
    allowedTargets: ["WORK_RESUMED", "CORRECTION_PENDING"],
  },
  WORK_RESUMED: {
    axis: "RECONCILIATION",
    labelKo: "업무 재개",
    allowedTargets: ["RECONCILIATION_MATCHED"],
  },
} as const;

export type ApprovedStateCode = keyof typeof APPROVED_STATE_TRANSITIONS;
export type ApprovedStateAxis = (typeof APPROVED_STATE_TRANSITIONS)[ApprovedStateCode]["axis"];

export class StateConflictError extends Error {
  readonly code = "STATE_CONFLICT";
  constructor(
    readonly axis: string,
    readonly current: string,
    readonly target: string,
  ) {
    super(`허용되지 않은 상태전환이다: ${axis} ${current} -> ${target}`);
  }
}

export function approvedState(code: string) {
  return APPROVED_STATE_TRANSITIONS[code as ApprovedStateCode];
}

export function assertApprovedInitialState(axis: string, state: string): void {
  const definition = approvedState(state);
  if (!definition || definition.axis !== axis)
    throw new StateConflictError(axis, "<UNINITIALIZED>", state);
}

export function assertApprovedStateTransition(axis: string, current: string, target: string): void {
  const definition = approvedState(current);
  const targetDefinition = approvedState(target);
  if (
    !definition ||
    !targetDefinition ||
    definition.axis !== axis ||
    targetDefinition.axis !== axis ||
    !(definition.allowedTargets as readonly string[]).includes(target)
  ) {
    throw new StateConflictError(axis, current, target);
  }
}
