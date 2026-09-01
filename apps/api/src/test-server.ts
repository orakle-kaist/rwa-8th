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
import { LocalChainSynchronizer } from "./local-chain-synchronizer.js";
import { dispatchNextHedgeMockResult } from "./mock-institution-client.js";

const config = loadApiConfig(process.env);
const clock = createClock(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const localChain = await LocalChainSynchronizer.create(pool, process.env);
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
      let handledTarget = message.workflowId;
      if (message.eventType === "ELIGIBILITY_CHAIN_SYNC_REQUESTED") {
        const payload = message.payload as Record<string, string>;
        const transactionHash = await localChain.executeEligibility(
          message.workflowId,
          payload.wallet as `0x${string}`,
          new Date(payload.validUntil!),
        );
        const { completeEligibilityChainSync } = await import("@rwa/database");
        await completeEligibilityChainSync(pool, {
          workflowId: message.workflowId,
          outboxId: message.outboxId,
          transactionHash,
          now: clock.now(),
        });
      } else if (
        !(await processPrimaryOutbox(pool, message, clock.now())) &&
        !(await processHedgeOutbox(pool, message, clock.now())) &&
        !(await processRedemptionOutbox(pool, message, clock.now())) &&
        !(await processRightsOutbox(pool, message, clock.now())) &&
        !(await processSecondaryOutbox(pool, message, clock.now(), (payload) =>
          localChain.executeSecondary(message.workflowId, payload),
        ))
      ) {
        await processProtectionMessage(pool, message, clock.now());
      }
      const messagePayload = message.payload as Record<string, unknown>;
      if (typeof messagePayload.taskId === "string") handledTarget = messagePayload.taskId;
      else if (messagePayload.data) {
        const data = messagePayload.data as Record<string, unknown>;
        for (const key of ["taskId", "hedgeId", "redemptionId", "orderId"])
          if (typeof data[key] === "string") {
            handledTarget = String(data[key]);
            break;
          }
      }
      await localChain.synchronize(handledTarget);
      await dispatchNextHedgeMockResult(pool, handledTarget, clock.now());
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
