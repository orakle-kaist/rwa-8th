export const LOCAL_RIGHTS_SECURITY_ID = "990001";
export const LOCAL_CORPORATE_ACTION_SECURITY_ID = "990003";
export const LOCAL_CORPORATE_ACTION_NAME = "모의 미래에셋증권 기업행동 시나리오";
export const LOCAL_CORPORATE_ACTION_SYMBOL = "SIM990003";
export const LOCAL_CORPORATE_ACTION_DEPLOYMENT_KEY = "TEST00000003";
export const SYNTHETIC_DIVIDEND_PER_SHARE_USD_MINOR = 100n;
export const SYNTHETIC_DIVIDEND_QUOTE_SECONDS = 30;

export function allocateSyntheticDividend(quantity: bigint) {
  if (quantity < 0n) throw new Error("배당 기준수량은 음수일 수 없다.");
  const grossUsdMinor = quantity * SYNTHETIC_DIVIDEND_PER_SHARE_USD_MINOR;
  return {
    grossUsdMinor,
    taxUsdMinor: 0n,
    feeUsdMinor: 0n,
    netUsdMinor: grossUsdMinor,
  };
}

export function classifyReportSubmission(submittedAt: Date, dueDate: string): "ON_TIME" | "LATE" {
  const koreaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(submittedAt);
  return koreaDate <= dueDate ? "ON_TIME" : "LATE";
}

export function expectedSplitSupply(input: {
  available: bigint;
  pending: bigint;
  redemptionLocked: bigint;
  administrativeFrozen: bigint;
  burnPending: bigint;
  numerator: bigint;
  denominator: bigint;
}) {
  const rightsBacked =
    input.available + input.pending + input.redemptionLocked + input.administrativeFrozen;
  const buckets = [
    input.available,
    input.pending,
    input.redemptionLocked,
    input.administrativeFrozen,
  ];
  if (
    input.denominator <= 0n ||
    input.numerator <= 0n ||
    buckets.some((quantity) => (quantity * input.numerator) % input.denominator !== 0n)
  )
    throw new Error("기업행동 결과가 정수로 계산되지 않는다.");
  return (rightsBacked * input.numerator) / input.denominator + input.burnPending;
}
