import { describe, expect, it } from "vitest";

import {
  evidence,
  isinCheckDigitIsValid,
  roleAliases,
  workflow,
} from "../../../scripts/fuji-common.js";

describe("Fuji 배포 입력 통제", () => {
  it("대표 종목 ISIN의 검증숫자를 확인하고 변조값을 거절한다", () => {
    for (const isin of [
      "KR7005930003",
      "KR7000660001",
      "KR7017670001",
      "KR7005380001",
      "KR7035420009",
      "KR7006800007",
    ]) {
      expect(isinCheckDigitIsValid(isin)).toBe(true);
    }
    expect(isinCheckDigitIsValid("KR7005930004")).toBe(false);
    expect(isinCheckDigitIsValid("TEST00000001")).toBe(false);
  });

  it("거버넌스·기관·투자자 역할 별칭과 증거 식별자를 분리한다", () => {
    expect(new Set(roleAliases).size).toBe(roleAliases.length);
    expect(workflow("one")).toMatch(/^0x[0-9a-f]{32}$/);
    expect(evidence("one")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(workflow("one")).not.toBe(workflow("two"));
    expect(evidence("one")).not.toBe(evidence("two"));
  });
});
