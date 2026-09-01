import {
  claimOutbox,
  expirePrimaryOrders,
  processPrimaryOutbox,
  processHedgeOutbox,
  processSecondaryOutbox,
  processProtectionMessage,
  processRedemptionOutbox,
  processRightsOutbox,
  releaseMaturedHolds,
} from "@rwa/database";
import { createClock, seoulCalendarDate } from "@rwa/domain";
import { Pool } from "pg";

import { buildApp } from "./app.js";
import { loadApiConfig } from "./config.js";

const config = loadApiConfig(process.env);
const clock = createClock(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const app = await buildApp({ clock, pool });
let processing = false;
let lastExpiryDate: string | undefined;

const timer = setInterval(() => {
  if (processing) return;
  processing = true;
  void (async () => {
    const currentDate = seoulCalendarDate(clock.now());
    if (lastExpiryDate !== currentDate) {
      await expirePrimaryOrders(pool, currentDate, clock.now());
      lastExpiryDate = currentDate;
    }
    await releaseMaturedHolds(pool, clock.now());
    // 브라우저 전체 시연에서는 모의 시장정보 제공자가 정상값을 계속 갱신한다.
    // 60·61초 지연 차단은 시간 고정 통합시험에서 별도로 검증한다.
    await pool.query(
      "UPDATE secondary_market_state SET information_effective_at=$1,updated_at=$1 WHERE security_id='990002'",
      [new Date(clock.now().getTime() - 1_000)],
    );
    const messages = await claimOutbox(pool, 20, clock.now());
    for (const message of messages) {
      if (message.eventType === "ELIGIBILITY_CHAIN_SYNC_REQUESTED") {
        throw new Error("브라우저 시험 서버에서는 체인 적격성 반영을 실행하지 않는다.");
      }
      if (
        !(await processPrimaryOutbox(pool, message, clock.now())) &&
        !(await processHedgeOutbox(pool, message, clock.now())) &&
        !(await processRedemptionOutbox(pool, message, clock.now())) &&
        !(await processRightsOutbox(pool, message, clock.now())) &&
        !(await processSecondaryOutbox(
          pool,
          message,
          clock.now(),
          async () => `0x${message.workflowId.replaceAll("-", "").padEnd(64, "0")}`,
        ))
      ) {
        await processProtectionMessage(pool, message, clock.now());
      }
    }
  })()
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({ level: "error", simulation: true, message: "browser outbox processing failed", error: error instanceof Error ? error.message : "unknown" })}\n`,
      );
    })
    .finally(() => {
      processing = false;
    });
}, 50);

app.addHook("onClose", async () => {
  clearInterval(timer);
  await pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ host: config.host, port: config.port });
