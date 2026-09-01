import { describe, expect, it } from "vitest";

import {
  allocateProRata,
  assertPrimaryOrder,
  nextKrxBusinessDate,
  reserveAmountForOrder,
} from "../src/index.js";

describe("1차 발행 업무 규칙", () => {
  it("5주와 3주 주문의 6주 체결을 4주와 2주로 결정적으로 배분한다", () => {
    const result = allocateProRata(
      [
        { orderId: "a", requestedQuantity: 5n, acceptedAt: new Date("2026-08-31T00:00:00Z") },
        { orderId: "b", requestedQuantity: 3n, acceptedAt: new Date("2026-08-31T00:00:01Z") },
      ],
      6n,
    );
    expect(result.map((item) => item.allocatedQuantity)).toEqual([4n, 2n]);
  });

  it("같은 접수시각이면 보존된 접수순번으로 잔여 1주를 배정한다", () => {
    const sameTime = new Date("2026-08-31T00:00:00Z");
    const result = allocateProRata(
      [
        { orderId: "z-order", requestedQuantity: 5n, acceptedAt: sameTime, acceptanceRank: 1 },
        { orderId: "a-order", requestedQuantity: 3n, acceptedAt: sameTime, acceptanceRank: 2 },
      ],
      6n,
    );
    expect(result.map((item) => item.allocatedQuantity)).toEqual([4n, 2n]);
  });

  it("주말 요청을 다음 KRX 영업일로 이동한다", () => {
    expect(nextKrxBusinessDate("2026-09-05")).toBe("2026-09-07");
  });

  it("KRW를 USD 센트로 올림하고 시장가·소수수량을 거절한다", () => {
    expect(reserveAmountForOrder(5n, 257_000n)).toBe(93_096n);
    expect(() =>
      assertPrimaryOrder({
        securityId: "990001",
        shareQuantity: "0.5",
        krwLimitPrice: "257000",
        fundingMode: "USD_LEDGER",
      }),
    ).toThrow(/양의 정수/);
  });
});
