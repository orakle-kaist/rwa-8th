import { describe, expect, it } from "vitest";

import {
  allocateSyntheticDividend,
  classifyReportSubmission,
  expectedSplitSupply,
} from "../src/rights-and-controls.js";

describe("권리업무 계산", () => {
  it("1주당 100센트의 합성 배당을 세금과 수수료 없이 배분한다", () => {
    expect(allocateSyntheticDividend(6n)).toEqual({
      grossUsdMinor: 600n,
      taxUsdMinor: 0n,
      feeUsdMinor: 0n,
      netUsdMinor: 600n,
    });
  });

  it("한국시간 9월 10일과 11일 제출을 구분한다", () => {
    expect(classifyReportSubmission(new Date("2026-09-10T14:59:59Z"), "2026-09-10")).toBe(
      "ON_TIME",
    );
    expect(classifyReportSubmission(new Date("2026-09-10T15:00:00Z"), "2026-09-10")).toBe("LATE");
  });

  it("2대1 분할에서 소각 대기 수량을 조정하지 않는다", () => {
    expect(
      expectedSplitSupply({
        available: 4n,
        pending: 2n,
        redemptionLocked: 2n,
        administrativeFrozen: 1n,
        burnPending: 1n,
        numerator: 2n,
        denominator: 1n,
      }),
    ).toBe(19n);
  });

  it("정수로 계산되지 않는 기업행동을 차단한다", () => {
    expect(() =>
      expectedSplitSupply({
        available: 4n,
        pending: 2n,
        redemptionLocked: 2n,
        administrativeFrozen: 1n,
        burnPending: 1n,
        numerator: 1n,
        denominator: 3n,
      }),
    ).toThrow("정수");
  });
});
