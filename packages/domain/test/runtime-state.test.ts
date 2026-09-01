import {
  APPROVED_STATE_TRANSITIONS,
  StateConflictError,
  assertApprovedInitialState,
  assertApprovedStateTransition,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("승인 상태 전환기", () => {
  it("승인된 175개 상태와 축을 런타임 자료로 제공한다", () => {
    expect(Object.keys(APPROVED_STATE_TRANSITIONS)).toHaveLength(175);
    expect(() => assertApprovedInitialState("PRIMARY_ORDER", "PRIMARY_DRAFT")).not.toThrow();
    expect(() => assertApprovedInitialState("PRIMARY_ORDER", "TOKEN_TRADABLE")).toThrow(
      StateConflictError,
    );
  });

  it("허용 전환은 통과하고 금지 전환은 STATE_CONFLICT로 거절한다", () => {
    expect(() =>
      assertApprovedStateTransition("PRIMARY_ORDER", "PRIMARY_DRAFT", "PRIMARY_FUNDS_CHECK"),
    ).not.toThrow();
    expect(() =>
      assertApprovedStateTransition("PRIMARY_ORDER", "PRIMARY_DRAFT", "PRIMARY_FULLY_FILLED"),
    ).toThrowError(expect.objectContaining({ code: "STATE_CONFLICT", axis: "PRIMARY_ORDER" }));
  });
});
