import { AdjustableClock } from "@rwa/domain";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("합성 세션 API", () => {
  it("승인된 OpenAPI 형태로 합성 사용자를 반환한다", async () => {
    const app = await buildApp({
      clock: new AdjustableClock(new Date("2026-08-31T00:00:00.000Z")),
      logger: false,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { authorization: "Bearer demo:investor-a" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      actorId: "00000000-0000-4000-8000-000000000001",
      role: "INVESTOR",
      simulation: true,
      projection: { projectionStatus: "CURRENT" },
    });
  });

  it("알 수 없는 토큰을 거절한다", async () => {
    const app = await buildApp({ clock: new AdjustableClock(new Date()), logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/session" });

    expect(response.statusCode).toBe(401);
  });
});
