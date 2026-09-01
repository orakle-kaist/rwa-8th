import { describe, expect, it } from "vitest";

import {
  assertHedgeCanProceed,
  hedgeDirectionForNetPosition,
  hedgePriority,
  nextHedgeTradingDate,
  unhedgedQuantity,
} from "../src/market-maker-hedge.js";

describe("시장조성자 헤지", () => {
  it("순매도는 매수, 순매수는 매도 방향으로 계산한다", () => {
    expect(hedgeDirectionForNetPosition(-5n)).toBe("BUY");
    expect(hedgeDirectionForNetPosition(4n)).toBe("SELL");
    expect(hedgeDirectionForNetPosition(0n)).toBeNull();
  });

  it("이미 승인된 수량을 제외한 미헤지 수량만 계산한다", () => {
    expect(
      unhedgedQuantity({ netPosition: -8n, committedBuyQuantity: 5n, committedSellQuantity: 0n }),
    ).toEqual({ direction: "BUY", quantity: 3n });
    expect(
      unhedgedQuantity({ netPosition: 6n, committedBuyQuantity: 0n, committedSellQuantity: 4n }),
    ).toEqual({ direction: "SELL", quantity: 2n });
  });

  it("다음 KRX 영업일과 방향별 외국인 한도 통제를 적용한다", () => {
    expect(nextHedgeTradingDate(new Date("2026-08-31T12:00:00Z"))).toBe("2026-09-01");
    expect(() =>
      assertHedgeCanProceed({
        direction: "BUY",
        foreignLimitStatus: "BLOCKED",
        krxStatus: "OPEN",
        riskInformationFresh: true,
      }),
    ).toThrow(/외국인 한도/);
    expect(() =>
      assertHedgeCanProceed({
        direction: "SELL",
        foreignLimitStatus: "BLOCKED",
        krxStatus: "OPEN",
        riskInformationFresh: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertHedgeCanProceed({
        direction: "SELL",
        foreignLimitStatus: "ALLOWED",
        krxStatus: "HALTED",
        riskInformationFresh: true,
      }),
    ).toThrow(/거래정지/);
    expect(() =>
      assertHedgeCanProceed({
        direction: "BUY",
        foreignLimitStatus: "ALLOWED",
        krxStatus: "OPEN",
        riskInformationFresh: false,
      }),
    ).toThrow(/오래됐다/);
  });

  it("위험위반 감소, 한도사용률, 생성시각과 종목코드로 결정적 우선순위를 만든다", () => {
    expect(
      hedgePriority({
        riskViolationReducing: true,
        positionAbsolute: 21n,
        positionLimit: 20n,
        createdAt: new Date("2026-08-31T12:00:00Z"),
        securityId: "990002",
      }),
    ).toMatchObject({ riskRank: 0, utilizationBps: 10_500, securityId: "990002" });
  });
});
