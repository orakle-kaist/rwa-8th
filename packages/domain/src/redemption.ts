import { allocateProRata, nextKrxBusinessDate } from "./primary-issuance.js";

export const LOCAL_REDEMPTION_SECURITY_ID = "990001";
export const LOCAL_REDEMPTION_TOKEN_ADDRESS = "0x0000000000000000000000000000000000009901" as const;
export const LOCAL_REDEMPTION_POLICY = "REDEMPTION-SIM-1";
export const LOCAL_REDEMPTION_LIMIT_KRW = 257_000n;
export const LOCAL_REDEMPTION_TOTAL_USD_MINOR = 74_476n;

export function parseRedemptionQuantity(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("환매 수량은 1주 이상의 정수여야 한다.");
  return BigInt(value);
}

export function availableForRedemption(input: {
  settled: bigint;
  secondaryReserved: bigint;
  hedgeLocked: bigint;
  redemptionLocked: bigint;
  burnPending: bigint;
}): bigint {
  const available =
    input.settled - input.secondaryReserved - input.hedgeLocked - input.redemptionLocked;
  if (available < 0n || input.burnPending < 0n)
    throw new Error("고객 권리 수량 상태가 서로 일치하지 않는다.");
  return available;
}

export function effectiveRedemptionTradingDate(requestedDate: string): string {
  return nextKrxBusinessDate(requestedDate);
}

export function allocateRedemptionFill(
  orders: Array<{
    orderId: string;
    requestedQuantity: bigint;
    acceptedAt: Date;
    acceptanceRank?: number;
  }>,
  filledQuantity: bigint,
) {
  return allocateProRata(orders, filledQuantity).map((allocation) => ({
    ...allocation,
    releasedQuantity:
      orders.find((order) => order.orderId === allocation.orderId)!.requestedQuantity -
      allocation.allocatedQuantity,
  }));
}

export function allocateUsdClaims(
  allocations: Array<{ orderId: string; allocatedQuantity: bigint; acceptedAt: Date }>,
  totalUsdMinor: bigint,
) {
  const totalQuantity = allocations.reduce((sum, item) => sum + item.allocatedQuantity, 0n);
  if (totalQuantity <= 0n || totalUsdMinor < 0n)
    throw new Error("USD 지급청구 배분값이 올바르지 않다.");
  const result = allocations.map((item) => ({
    ...item,
    usdAmountMinor: (totalUsdMinor * item.allocatedQuantity) / totalQuantity,
  }));
  let remainder = totalUsdMinor - result.reduce((sum, item) => sum + item.usdAmountMinor, 0n);
  for (const item of [...result].sort(
    (left, right) =>
      left.acceptedAt.getTime() - right.acceptedAt.getTime() ||
      left.orderId.localeCompare(right.orderId),
  )) {
    if (remainder === 0n) break;
    item.usdAmountMinor += 1n;
    remainder -= 1n;
  }
  return result.map(({ orderId, usdAmountMinor }) => ({ orderId, usdAmountMinor }));
}
