import {
  claimOutbox,
  completeEligibilityChainSync,
  expirePrimaryOrders,
  processProtectionMessage,
  processPrimaryOutbox,
  processHedgeOutbox,
  processSecondaryOutbox,
  processRedemptionOutbox,
  recordEligibilityChainSyncFailure,
  processRightsOutbox,
  releaseMaturedHolds,
} from "@rwa/database";
import { createClock, seoulCalendarDate } from "@rwa/domain";
import { Pool } from "pg";

import { loadApiConfig } from "./config.js";
import { LocalChainSynchronizer } from "./local-chain-synchronizer.js";
import { dispatchNextHedgeMockResult } from "./mock-institution-client.js";

const config = loadApiConfig(process.env);
const clock = createClock(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
const localChain = await LocalChainSynchronizer.create(pool, process.env);
let stopping = false;
let lastExpiryDate: string | undefined;

async function processChainSync(message: Awaited<ReturnType<typeof claimOutbox>>[number]) {
  const payload = message.payload as Record<string, string>;
  if (!/^0x[0-9a-fA-F]{40}$/.test(payload.wallet ?? "") || !payload.validUntil) {
    throw new Error("적격성 체인 반영 설정 또는 업무값이 올바르지 않다.");
  }
  const transactionHash = await localChain.executeEligibility(
    message.workflowId,
    payload.wallet as `0x${string}`,
    new Date(payload.validUntil),
  );
  await completeEligibilityChainSync(pool, {
    workflowId: message.workflowId,
    outboxId: message.outboxId,
    transactionHash,
    now: clock.now(),
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

while (!stopping) {
  await releaseMaturedHolds(pool, clock.now());
  const currentDate = seoulCalendarDate(clock.now());
  if (lastExpiryDate !== currentDate) {
    await expirePrimaryOrders(pool, currentDate, clock.now());
    lastExpiryDate = currentDate;
  }
  const messages = await claimOutbox(pool, 20, clock.now());
  if (messages.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    continue;
  }
  for (const message of messages) {
    try {
      let handledTarget = message.workflowId;
      if (message.eventType === "ELIGIBILITY_CHAIN_SYNC_REQUESTED") {
        await processChainSync(message);
      } else if (
        !(await processRightsOutbox(pool, message, clock.now())) &&
        !(await processPrimaryOutbox(pool, message, clock.now())) &&
        !(await processHedgeOutbox(pool, message, clock.now())) &&
        !(await processRedemptionOutbox(pool, message, clock.now())) &&
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
      process.stdout.write(
        `${JSON.stringify({ level: "info", simulation: true, message: "outbox processed", outboxId: message.outboxId, workflowId: message.workflowId })}\n`,
      );
    } catch (error) {
      if (message.eventType === "ELIGIBILITY_CHAIN_SYNC_REQUESTED") {
        await recordEligibilityChainSyncFailure(pool, {
          workflowId: message.workflowId,
          outboxId: message.outboxId,
          reason: error instanceof Error ? error.message : "unknown",
          now: clock.now(),
        });
      }
      process.stderr.write(
        `${JSON.stringify({ level: "error", simulation: true, message: "outbox quarantined", outboxId: message.outboxId, workflowId: message.workflowId, error: error instanceof Error ? error.message : "unknown" })}\n`,
      );
    }
  }
}

await pool.end();
