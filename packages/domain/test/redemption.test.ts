import { describe, expect, it } from "vitest";

import {
  allocateRedemptionFill,
  allocateUsdClaims,
  availableForRedemption,
  effectiveRedemptionTradingDate,
  parseRedemptionQuantity,
} from "../src/redemption.js";

describe("일반 투자자 환매 규칙", () => {
  it("정수 환매 가능수량과 잠금 차감을 계산한다", () => {
    expect(parseRedemptionQuantity("3")).toBe(3n);
    expect(() => parseRedemptionQuantity("0.5")).toThrow("정수");
    expect(
      availableForRedemption({
        settled: 6n,
        secondaryReserved: 1n,
        hedgeLocked: 0n,
        redemptionLocked: 2n,
        burnPending: 0n,
      }),
    ).toBe(3n);
  });

  it("A 3주·B 2주의 4주 체결을 A 3주·B 1주로 배분하고 USD 청구도 맞춘다", () => {
    const at = new Date("2026-08-31T12:00:00Z");
    const allocations = allocateRedemptionFill(
      [
        { orderId: "A", requestedQuantity: 3n, acceptedAt: at },
        { orderId: "B", requestedQuantity: 2n, acceptedAt: new Date(at.getTime() + 1) },
      ],
      4n,
    );
    expect(
      allocations.map((item) => [item.orderId, item.allocatedQuantity, item.releasedQuantity]),
    ).toEqual([
      ["A", 3n, 0n],
      ["B", 1n, 1n],
    ]);
    expect(
      allocateUsdClaims(
        allocations.map((item, index) => ({ ...item, acceptedAt: new Date(at.getTime() + index) })),
        74_476n,
      ).map((item) => [item.orderId, item.usdAmountMinor]),
    ).toEqual([
      ["A", 55_857n],
      ["B", 18_619n],
    ]);
  });

  it("주말 요청을 다음 KRX 영업일로 보낸다", () => {
    expect(effectiveRedemptionTradingDate("2026-08-30")).toBe("2026-08-31");
  });
});
