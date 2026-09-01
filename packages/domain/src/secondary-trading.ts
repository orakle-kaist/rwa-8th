export const LOCAL_SECONDARY_SECURITY_ID = "990002";
export const LOCAL_SECONDARY_NAME = "모의 SK하이닉스 24/7 시나리오";
export const LOCAL_SECONDARY_SYMBOL = "SIM990002";
export const LOCAL_SECONDARY_DEPLOYMENT_KEY = "TEST00000002";
export const LOCAL_SECONDARY_REFERENCE_SECURITY_ID = "000660";
export const LOCAL_SECONDARY_REFERENCE_KRW = 1_653_000n;
export const LOCAL_SECONDARY_REFERENCE_USD_MINOR = 119_757n;
export const LOCAL_SECONDARY_NORMAL_ASK_USD_MINOR = 120_355n;
export const LOCAL_SECONDARY_NORMAL_ASK_USDC_MINOR = 1_203_550_000n;
export const LOCAL_SECONDARY_POLICY = "LOCAL-POLICY-V1";

export const QUOTE_VALIDITY_SECONDS = 30;
export const MARKET_INFORMATION_MAX_AGE_SECONDS = 60;
export const MARKET_MAKER_START_SETTLED = 100n;
export const MARKET_MAKER_START_PENDING = 20n;
export const MARKET_MAKER_POSITION_LIMIT = 20n;
export const MARKET_MAKER_SECURITY_LOSS_LIMIT_BPS = 200;
export const MARKET_MAKER_PORTFOLIO_LOSS_LIMIT_BPS = 150;
export const MAX_HALF_SPREAD_BPS = 150;
export const USDC_USD_MIN_PPM = 995_000n;
export const USDC_USD_MAX_PPM = 1_005_000n;

export type SecondaryFundingMode = "USD_LEDGER" | "USDC_ONCHAIN";
export type InvestorSide = "BUY" | "SELL";
export type MarketMakerSide = "BUY" | "SELL";

export function oppositeMarketMakerSide(side: InvestorSide): MarketMakerSide {
  return side === "BUY" ? "SELL" : "BUY";
}

export function parsePositiveShareQuantity(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("24시간 거래 수량은 1주 이상의 정수여야 한다.");
  return BigInt(value);
}

export function quoteIsActive(now: Date, expiresAt: Date): boolean {
  return now.getTime() < expiresAt.getTime();
}

export function informationIsFresh(now: Date, effectiveAt: Date): boolean {
  const ageMs = now.getTime() - effectiveAt.getTime();
  return ageMs >= 0 && ageMs <= MARKET_INFORMATION_MAX_AGE_SECONDS * 1_000;
}

export function usdcPathIsAllowed(usdcUsdPpm: bigint): boolean {
  return usdcUsdPpm >= USDC_USD_MIN_PPM && usdcUsdPpm <= USDC_USD_MAX_PPM;
}

export function computeFill(
  requested: bigint,
  remainingQuote: bigint,
): {
  fillQuantity: bigint;
  cancelledQuantity: bigint;
} {
  if (requested <= 0n || remainingQuote <= 0n)
    throw new Error("주문과 호가 수량은 1주 이상이어야 한다.");
  const fillQuantity = requested < remainingQuote ? requested : remainingQuote;
  return { fillQuantity, cancelledQuantity: requested - fillQuantity };
}

export function paymentAmount(unitPriceMinor: bigint, fillQuantity: bigint): bigint {
  if (unitPriceMinor <= 0n || fillQuantity <= 0n)
    throw new Error("가격과 체결수량은 0보다 커야 한다.");
  return unitPriceMinor * fillQuantity;
}

export function nextNetPosition(
  current: bigint,
  marketMakerSide: MarketMakerSide,
  fillQuantity: bigint,
): bigint {
  return marketMakerSide === "BUY" ? current + fillQuantity : current - fillQuantity;
}

export function positionWithinLimit(position: bigint): boolean {
  const absolute = position < 0n ? -position : position;
  return absolute <= MARKET_MAKER_POSITION_LIMIT;
}

export function assertQuoteRisk(input: {
  now: Date;
  expiresAt: Date;
  informationEffectiveAt: Date;
  fundingMode: SecondaryFundingMode;
  usdcUsdPpm: bigint;
  halfSpreadBps: number;
  securityLossBps: number;
  portfolioLossBps: number;
  resultingNetPosition: bigint;
}): void {
  if (!quoteIsActive(input.now, input.expiresAt)) throw new Error("호가가 만료됐다.");
  if (!informationIsFresh(input.now, input.informationEffectiveAt))
    throw new Error("시장·위험정보가 60초를 초과했다.");
  if (input.fundingMode === "USDC_ONCHAIN" && !usdcPathIsAllowed(input.usdcUsdPpm))
    throw new Error("USDC 확인가격이 허용범위를 벗어났다.");
  if (
    !Number.isInteger(input.halfSpreadBps) ||
    input.halfSpreadBps < 0 ||
    input.halfSpreadBps > MAX_HALF_SPREAD_BPS
  )
    throw new Error("합성 반쪽 스프레드 한도를 초과했다.");
  if (input.securityLossBps >= MARKET_MAKER_SECURITY_LOSS_LIMIT_BPS)
    throw new Error("종목별 평가손실 한도에 도달했다.");
  if (input.portfolioLossBps >= MARKET_MAKER_PORTFOLIO_LOSS_LIMIT_BPS)
    throw new Error("전체 평가손실 한도에 도달했다.");
  if (!positionWithinLimit(input.resultingNetPosition))
    throw new Error("시장조성자 순포지션 한도를 초과한다.");
}
