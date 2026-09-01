import { describe, expect, it } from "vitest";

import {
  assertQuoteRisk,
  computeFill,
  informationIsFresh,
  nextNetPosition,
  parsePositiveShareQuantity,
  positionWithinLimit,
  quoteIsActive,
  usdcPathIsAllowed,
} from "../src/secondary-trading.js";

describe("24시간 제한 거래 규칙", () => {
  const now = new Date("2026-08-31T12:00:00Z");

  it("8주 주문을 잔여호가 5주로 한 번만 부분체결한다", () => {
    expect(computeFill(8n, 5n)).toEqual({ fillQuantity: 5n, cancelledQuantity: 3n });
    expect(nextNetPosition(0n, "SELL", 5n)).toBe(-5n);
  });

  it("정수 수량과 호가 만료 경계를 적용한다", () => {
    expect(parsePositiveShareQuantity("8")).toBe(8n);
    expect(() => parsePositiveShareQuantity("0.5")).toThrow(/정수/);
    expect(quoteIsActive(now, new Date("2026-08-31T12:00:30Z"))).toBe(true);
    expect(quoteIsActive(now, now)).toBe(false);
  });

  it("정보 60초와 순포지션 20은 허용하고 초과는 차단한다", () => {
    expect(informationIsFresh(now, new Date("2026-08-31T11:59:00Z"))).toBe(true);
    expect(informationIsFresh(now, new Date("2026-08-31T11:58:59Z"))).toBe(false);
    expect(positionWithinLimit(20n)).toBe(true);
    expect(positionWithinLimit(-20n)).toBe(true);
    expect(positionWithinLimit(21n)).toBe(false);
  });

  it("USDC 경계값은 포함하고 경계 밖만 차단한다", () => {
    expect(usdcPathIsAllowed(995_000n)).toBe(true);
    expect(usdcPathIsAllowed(1_005_000n)).toBe(true);
    expect(usdcPathIsAllowed(994_999n)).toBe(false);
    expect(usdcPathIsAllowed(1_005_001n)).toBe(false);
  });

  it("손실한도 도달과 스트레스 스프레드 초과를 거절한다", () => {
    const base = {
      now,
      expiresAt: new Date("2026-08-31T12:00:30Z"),
      informationEffectiveAt: new Date("2026-08-31T11:59:00Z"),
      fundingMode: "USDC_ONCHAIN" as const,
      usdcUsdPpm: 1_000_000n,
      halfSpreadBps: 150,
      securityLossBps: 199,
      portfolioLossBps: 149,
      resultingNetPosition: -20n,
    };
    expect(() => assertQuoteRisk(base)).not.toThrow();
    expect(() => assertQuoteRisk({ ...base, resultingNetPosition: -21n })).toThrow(/순포지션/);
    expect(() => assertQuoteRisk({ ...base, halfSpreadBps: 151 })).toThrow(/스프레드/);
    expect(() => assertQuoteRisk({ ...base, securityLossBps: 200 })).toThrow(/평가손실/);
    expect(() => assertQuoteRisk({ ...base, portfolioLossBps: 150 })).toThrow(/평가손실/);
  });
});
