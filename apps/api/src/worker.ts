import { createHash } from "node:crypto";

import {
  anvilChain,
  avalancheFuji,
  setWalletEligibility,
  writeSecondarySettlement,
} from "@rwa/contracts-client";
import {
  SecondaryRpcUncertainError,
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
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

function uuidToBytes16(value: string): Hex {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) throw new Error("24시간 거래 UUID가 올바르지 않다.");
  return `0x${compact}`;
}

function secondaryTuple(value: Record<string, string>, idFields: string[], numberFields: string[]) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      idFields.includes(key)
        ? uuidToBytes16(item)
        : numberFields.includes(key)
          ? BigInt(item)
          : item,
    ]),
  );
}

async function executeSecondaryChain(
  workflowId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  if (process.env.SECONDARY_SIMULATION_CHAIN === "true")
    return `0x${createHash("sha256")
      .update(`${workflowId}:${JSON.stringify(payload)}`)
      .digest("hex")}`;

  const rpcUrl = process.env.CHAIN_RPC_URL;
  const controller = process.env.SECONDARY_SETTLEMENT_CONTROLLER_ADDRESS;
  const privateKey = process.env.SECONDARY_SETTLEMENT_EXECUTOR_PRIVATE_KEY;
  const chainId = Number(process.env.CHAIN_ID ?? "31337");
  if (
    !rpcUrl ||
    !/^0x[0-9a-fA-F]{40}$/.test(controller ?? "") ||
    !/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "") ||
    ![31_337, 43_113].includes(chainId)
  )
    throw new Error("24시간 정산 체인 실행 설정이 올바르지 않다.");

  const signedIntent = payload.signed_intent as {
    message: Record<string, string>;
    signature: Hex;
  };
  const signedQuote = payload.signed_quote as {
    message: Record<string, string>;
    signature: Hex;
  };
  const signedApproval = payload.signed_broker_approval as {
    message: Record<string, string>;
    signature: Hex;
  };
  if (!signedIntent?.message || !signedQuote?.message || !signedApproval?.message)
    throw new Error("24시간 정산의 세 서명자료가 없다.");

  const chain = chainId === 43_113 ? avalancheFuji : anvilChain;
  const transport = http(rpcUrl);
  const account = privateKeyToAccount(privateKey as Hex);
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const investorIntent = secondaryTuple(
    signedIntent.message,
    ["orderId", "quoteId"],
    ["shareQuantity", "paymentAmountMinor", "nonce", "expiresAt"],
  );
  const quote = secondaryTuple(
    signedQuote.message,
    ["quoteId"],
    ["shareQuantity", "unitPriceMinor", "nonce", "expiresAt"],
  );
  const approval = secondaryTuple(
    signedApproval.message,
    ["approvalId", "orderId"],
    ["shareQuantity", "paymentAmountMinor", "nonce", "expiresAt"],
  );
  let transactionHash: Hex;
  transactionHash = await writeSecondarySettlement(wallet, {
    controller: controller as `0x${string}`,
    functionName: payload.funding_mode === "USDC_ONCHAIN" ? "settleUsdc" : "settleUsdLedger",
    args: [
      uuidToBytes16(workflowId),
      investorIntent,
      signedIntent.signature,
      quote,
      signedQuote.signature,
      approval,
      signedApproval.signature,
      BigInt(String(payload.fill_quantity)),
      BigInt(String(payload.payment_amount_minor)),
    ],
  });
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  } catch {
    throw new SecondaryRpcUncertainError("RPC_RESPONSE_LOST", transactionHash);
  }
  if (receipt.status !== "success") throw new Error("SECONDARY_CHAIN_TRANSACTION_REVERTED");
  return transactionHash;
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
      if (message.eventType === "ELIGIBILITY_CHAIN_SYNC_REQUESTED") {
        await processChainSync(message);
      } else if (
        !(await processRightsOutbox(pool, message, clock.now())) &&
        !(await processPrimaryOutbox(pool, message, clock.now())) &&
        !(await processHedgeOutbox(pool, message, clock.now())) &&
        !(await processRedemptionOutbox(pool, message, clock.now())) &&
        !(await processSecondaryOutbox(pool, message, clock.now(), (payload) =>
          executeSecondaryChain(message.workflowId, payload),
        ))
      ) {
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
