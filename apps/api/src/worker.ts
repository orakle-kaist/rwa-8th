import { createHash } from "node:crypto";

import { setWalletEligibility } from "@rwa/contracts-client";
import {
  claimOutbox,
  completeEligibilityChainSync,
  expirePrimaryOrders,
  processProtectionMessage,
  processPrimaryOutbox,
  recordEligibilityChainSyncFailure,
} from "@rwa/database";
import { createClock, seoulCalendarDate } from "@rwa/domain";
import { Pool } from "pg";

import { loadApiConfig } from "./config.js";

const config = loadApiConfig(process.env);
const clock = createClock(process.env);
const pool = new Pool({ connectionString: config.databaseUrl });
let stopping = false;
let lastExpiryDate: string | undefined;

async function processChainSync(message: Awaited<ReturnType<typeof claimOutbox>>[number]) {
  const payload = message.payload as Record<string, string>;
  const rpcUrl = process.env.CHAIN_RPC_URL;
  const registryAddress = process.env.ELIGIBILITY_REGISTRY_ADDRESS;
  const operatorPrivateKey = process.env.ELIGIBILITY_OPERATOR_PRIVATE_KEY;
  const chainId = Number(process.env.CHAIN_ID ?? "31337");
  if (
    !rpcUrl ||
    !/^0x[0-9a-fA-F]{40}$/.test(registryAddress ?? "") ||
    !/^0x[0-9a-fA-F]{64}$/.test(operatorPrivateKey ?? "") ||
    ![31_337, 43_113].includes(chainId) ||
    !payload.wallet ||
    !payload.validUntil
  ) {
    throw new Error("적격성 체인 반영 설정 또는 업무값이 올바르지 않다.");
  }
  const evidenceHash = `0x${createHash("sha256")
    .update(`${message.workflowId}:${payload.wallet}:${payload.validUntil}`)
    .digest("hex")}` as `0x${string}`;
  const transactionHash = await setWalletEligibility({
    rpcUrl,
    chainId: chainId as 31_337 | 43_113,
    registryAddress: registryAddress as `0x${string}`,
    operatorPrivateKey: operatorPrivateKey as `0x${string}`,
    workflowId: message.workflowId,
    wallet: payload.wallet as `0x${string}`,
    validUntil: new Date(payload.validUntil),
    evidenceHash,
  });
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
      if (message.eventType === "ELIGIBILITY_CHAIN_SYNC_REQUESTED") {
        await processChainSync(message);
      } else if (!(await processPrimaryOutbox(pool, message, clock.now()))) {
        await processProtectionMessage(pool, message, clock.now());
      }
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
