import { nextKrxBusinessDate } from "./primary-issuance.js";

export const MARKET_MAKER_HEDGE_LIMIT_KRW = 1_653_000n;

export type HedgeDirection = "BUY" | "SELL";

export function hedgeDirectionForNetPosition(netPosition: bigint): HedgeDirection | null {
  if (netPosition < 0n) return "BUY";
  if (netPosition > 0n) return "SELL";
  return null;
}

export function signedHedgeQuantity(direction: HedgeDirection, quantity: bigint): bigint {
  if (quantity <= 0n) throw new Error("헤지 수량은 양의 정수여야 한다.");
  return direction === "BUY" ? quantity : -quantity;
}

export function unhedgedQuantity(input: {
  netPosition: bigint;
  committedBuyQuantity: bigint;
  committedSellQuantity: bigint;
}): { direction: HedgeDirection | null; quantity: bigint } {
  const coveredPosition =
    input.netPosition + input.committedBuyQuantity - input.committedSellQuantity;
  const direction = hedgeDirectionForNetPosition(coveredPosition);
  return { direction, quantity: coveredPosition < 0n ? -coveredPosition : coveredPosition };
}

export function nextHedgeTradingDate(completedAt: Date): string {
  const seoul = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(completedAt);
  const next = new Date(`${seoul}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return nextKrxBusinessDate(next.toISOString().slice(0, 10));
}

export function hedgePriority(input: {
  riskViolationReducing: boolean;
  positionAbsolute: bigint;
  positionLimit: bigint;
  createdAt: Date;
  securityId: string;
}) {
  if (input.positionLimit <= 0n) throw new Error("순포지션 한도가 올바르지 않다.");
  return {
    riskRank: input.riskViolationReducing ? 0 : 1,
    utilizationBps: Number((input.positionAbsolute * 10_000n) / input.positionLimit),
    createdAt: input.createdAt,
    securityId: input.securityId,
  };
}

export function assertHedgeCanProceed(input: {
  direction: HedgeDirection;
  foreignLimitStatus: "ALLOWED" | "BLOCKED" | "UNKNOWN";
  krxStatus: "OPEN" | "CLOSED" | "HALTED";
  riskInformationFresh: boolean;
}) {
  if (!input.riskInformationFresh) throw new Error("헤지 위험정보가 오래됐다.");
  if (input.krxStatus === "HALTED") throw new Error("KRX 거래정지로 헤지를 제출할 수 없다.");
  if (input.direction === "BUY" && input.foreignLimitStatus !== "ALLOWED")
    throw new Error("외국인 한도 때문에 매수 헤지를 제출할 수 없다.");
}
