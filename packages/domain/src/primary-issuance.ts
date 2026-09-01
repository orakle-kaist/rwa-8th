export const LOCAL_PRIMARY_SECURITY_ID = "990001";
export const LOCAL_PRIMARY_NAME = "모의 삼성전자 수탁권리";
export const LOCAL_PRIMARY_SYMBOL = "SIM990001";
export const LOCAL_PRIMARY_DEPLOYMENT_KEY = "TEST00000001";
export const LOCAL_PRIMARY_LIMIT_KRW = 257_000n;
export const T2_RISK_LIMIT_SHARES = 20n;

export type PrimaryFundingMode = "USD_LEDGER" | "USDC_CONVERSION";

export interface AllocationInput {
  orderId: string;
  requestedQuantity: bigint;
  acceptedAt: Date;
  acceptanceRank?: number;
}

export interface AllocationResult extends AllocationInput {
  allocatedQuantity: bigint;
}

export function usdMinorForKrw(krwMinor: bigint): bigint {
  if (krwMinor < 0n) throw new Error("KRW 금액은 음수일 수 없다.");
  // 1 USD = 1,380.3 KRW. 센트 단위 부족 예약을 피하기 위해 올림한다.
  return (krwMinor * 1_000n + 13_803n - 1n) / 13_803n;
}

export function reserveAmountForOrder(quantity: bigint, limitKrw: bigint): bigint {
  if (quantity <= 0n || limitKrw <= 0n) throw new Error("수량과 지정가격은 양의 정수여야 한다.");
  return usdMinorForKrw(quantity * limitKrw);
}

export function nextKrxBusinessDate(requestedDate: string): string {
  const date = new Date(`${requestedDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("거래일 형식이 올바르지 않다.");
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function seoulCalendarDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function allocateProRata(
  orders: readonly AllocationInput[],
  filledQuantity: bigint,
): AllocationResult[] {
  if (orders.length === 0) throw new Error("배분할 주문이 없다.");
  const total = orders.reduce((sum, order) => sum + order.requestedQuantity, 0n);
  if (
    orders.some((order) => order.requestedQuantity <= 0n) ||
    filledQuantity < 0n ||
    filledQuantity > total
  )
    throw new Error("체결수량 또는 주문수량이 올바르지 않다.");
  const result = orders.map((order) => ({
    ...order,
    allocatedQuantity: (filledQuantity * order.requestedQuantity) / total,
  }));
  let remainder = filledQuantity - result.reduce((sum, order) => sum + order.allocatedQuantity, 0n);
  const priority = [...result].sort(
    (left, right) =>
      left.acceptedAt.getTime() - right.acceptedAt.getTime() ||
      (left.acceptanceRank ?? Number.MAX_SAFE_INTEGER) -
        (right.acceptanceRank ?? Number.MAX_SAFE_INTEGER) ||
      left.orderId.localeCompare(right.orderId),
  );
  for (const order of priority) {
    if (remainder === 0n) break;
    if (order.allocatedQuantity < order.requestedQuantity) {
      order.allocatedQuantity += 1n;
      remainder -= 1n;
    }
  }
  return result;
}

export function assertPrimaryOrder(input: {
  securityId: string;
  shareQuantity: string;
  krwLimitPrice: string;
  fundingMode: string;
}): { quantity: bigint; limitKrw: bigint; fundingMode: PrimaryFundingMode } {
  if (input.securityId !== LOCAL_PRIMARY_SECURITY_ID)
    throw new Error("로컬 전용 합성 상품만 1차 발행 시험에 사용할 수 있다.");
  if (!/^[1-9][0-9]*$/.test(input.shareQuantity) || !/^[1-9][0-9]*$/.test(input.krwLimitPrice))
    throw new Error("수량과 지정가격은 소수점 없는 양의 정수여야 한다.");
  if (!(["USD_LEDGER", "USDC_CONVERSION"] as string[]).includes(input.fundingMode))
    throw new Error("지원하지 않는 1차 발행 자금경로다.");
  return {
    quantity: BigInt(input.shareQuantity),
    limitKrw: BigInt(input.krwLimitPrice),
    fundingMode: input.fundingMode as PrimaryFundingMode,
  };
}
