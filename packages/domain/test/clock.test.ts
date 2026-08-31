import { describe, expect, it } from "vitest";

import { AdjustableClock, authenticateDemoBearer } from "../src/index.js";

describe("실행 기반", () => {
  it("가상시각을 실제 대기 없이 이동한다", () => {
    const clock = new AdjustableClock(new Date("2026-08-31T00:00:00.000Z"));

    expect(clock.advance(61_000).toISOString()).toBe("2026-08-31T00:01:01.000Z");
  });

  it("명시된 합성 Bearer만 인증한다", () => {
    expect(authenticateDemoBearer("Bearer demo:investor-a")?.role).toBe("INVESTOR");
    expect(authenticateDemoBearer("Bearer real-looking-secret")).toBeNull();
  });
});
