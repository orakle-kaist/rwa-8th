import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { LOCAL_SECONDARY_NORMAL_ASK_USDC_MINOR, LOCAL_SECONDARY_SECURITY_ID } from "@rwa/domain";
import {
  MARKET_MAKER_PRINCIPAL_ID,
  MARKET_MAKER_WALLET,
  acceptMarketMakerQuote,
  acceptSecondaryOrder,
  claimOutbox,
  completeSecondaryChainExecution,
  decideSecondarySettlement,
  expireSecondaryQuotes,
  listMarketMakerPositions,
  listSecondaryOrders,
  processSecondaryOutbox,
  resolveSecondaryRpcUncertainty,
  SecondaryRpcUncertainError,
  retrySecondaryLedgerFinalization,
  secondaryTotals,
  seedPrimaryData,
  seedProtectionData,
  seedSecondaryData,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const now = new Date("2026-08-31T12:00:00Z");
const investorB = "00000000-0000-4000-8000-000000000002";
const investorBWallet = "0xa98b91226575d5037e865d679b750353d2d40305";

beforeAll(async () => {
  await pool.query("SELECT 1");
});

beforeEach(async () => {
  await pool.query(
    "TRUNCATE secondary_settlement_attempts,secondary_state_history,secondary_orders,market_maker_quotes,market_maker_positions,secondary_market_state,primary_state_history,primary_default_resolutions,primary_corrections,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,complaint_history,complaints,products,disclosures,synthetic_customer_profiles,audit_records,inbox_messages,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, now);
  await seedSecondaryData(pool, now);
});

afterAll(async () => {
  await pool.end();
});

async function quote(expiresAt = new Date(now.getTime() + 30_000)) {
  const quoteId = randomUUID();
  const result = await acceptMarketMakerQuote(pool, {
    principalId: MARKET_MAKER_PRINCIPAL_ID,
    wallet: MARKET_MAKER_WALLET,
    idempotencyKey: `quote-${randomUUID()}`,
    correlationId: randomUUID(),
    quote: {
      quoteId,
      securityId: LOCAL_SECONDARY_SECURITY_ID,
      marketMakerSide: "SELL",
      fundingMode: "USDC_ONCHAIN",
      paymentAssetId: `0x${"00".repeat(31)}01`,
      shareQuantity: 5n,
      unitPriceMinor: LOCAL_SECONDARY_NORMAL_ASK_USDC_MINOR,
      halfSpreadBps: 49,
      nonce: 1n,
      expiresAt,
      signedQuote: { primaryType: "MarketMakerQuote", message: { nonce: "1" } },
    },
    now,
  });
  if (!("workflowId" in result)) throw new Error("시험 호가가 거절됐다.");
  return quoteId;
}

async function order(quoteId: string, orderId = randomUUID()) {
  return acceptSecondaryOrder(pool, {
    principalId: investorB,
    wallet: investorBWallet,
    idempotencyKey: `order-${randomUUID()}`,
    correlationId: randomUUID(),
    order: {
      orderId,
      quoteId,
      shareQuantity: 8n,
      investorSide: "BUY",
      fundingMode: "USDC_ONCHAIN",
      paymentAssetId: `0x${"00".repeat(31)}01`,
      signedIntent: { primaryType: "SecondaryOrderIntent", message: { nonce: "2" } },
    },
    now,
  });
}

describe("24시간 제한 거래 PostgreSQL 생애주기", () => {
  it("8주 주문을 5주만 체결하고 권리·자금·재고를 함께 확정한다", async () => {
    const quoteId = await quote();
    const accepted = await order(quoteId);
    expect(accepted).toMatchObject({ repeated: false });
    const orderId = (accepted as { workflowId: string }).workflowId;
    await decideSecondarySettlement(pool, {
      orderId,
      actorId: "00000000-0000-4000-8000-000000000102",
      actorRole: "OVERSEAS_BROKER_OPERATOR",
      decision: "APPROVE",
      signedApproval: { primaryType: "BrokerSettlementApproval" },
      now,
    });
    await completeSecondaryChainExecution(pool, {
      orderId,
      transactionHash: `0x${"ab".repeat(32)}`,
      now,
    });

    const orders = await listSecondaryOrders(pool, investorB, "INVESTOR", now);
    expect(orders.items[0]).toMatchObject({
      requestedQuantity: "8",
      fillQuantity: "5",
      cancelledQuantity: "3",
      fundsReservationReleasedMinor: "3610650000",
      status: "COMPLETED",
      rightsFinalized: true,
      fundsFinalized: true,
      chainFinalized: true,
    });
    const positions = await listMarketMakerPositions(pool, now);
    expect(positions.items[0]).toMatchObject({
      settledInventory: "95",
      pendingInventory: "20",
      netPosition: "-5",
      reservedInventory: "0",
    });
    expect(await secondaryTotals(pool)).toEqual({ settled: "100", pending: "20", reserved: "0" });
  });

  it("체인 성공 뒤 권리 원장 실패를 격리하고 같은 거래를 재전송하지 않고 종결한다", async () => {
    const accepted = await order(await quote());
    const orderId = (accepted as { workflowId: string }).workflowId;
    await decideSecondarySettlement(pool, {
      orderId,
      actorId: "00000000-0000-4000-8000-000000000102",
      actorRole: "OVERSEAS_BROKER_OPERATOR",
      decision: "APPROVE",
      signedApproval: { primaryType: "BrokerSettlementApproval" },
      now,
    });
    await completeSecondaryChainExecution(pool, {
      orderId,
      transactionHash: `0x${"cd".repeat(32)}`,
      now,
      simulateLedgerFailure: true,
    });
    let orders = await listSecondaryOrders(pool, investorB, "INVESTOR", now);
    expect(orders.items[0]).toMatchObject({
      status: "QUARANTINED",
      chainFinalized: true,
      rightsFinalized: false,
      quarantineReason: "CHAIN_SUCCESS_RIGHTS_LEDGER_FAILED",
    });
    expect(await secondaryTotals(pool)).toEqual({ settled: "100", pending: "20", reserved: "5" });

    await retrySecondaryLedgerFinalization(pool, orderId, new Date(now.getTime() + 1_000));
    orders = await listSecondaryOrders(pool, investorB, "INVESTOR", now);
    expect(orders.items[0]).toMatchObject({
      status: "COMPLETED",
      chainFinalized: true,
      rightsFinalized: true,
    });
    expect(await secondaryTotals(pool)).toEqual({ settled: "100", pending: "20", reserved: "0" });
  });

  it("호가 만료 시 사용하지 않은 시장조성자 재고 예약을 해제한다", async () => {
    await quote(new Date(now.getTime() + 30_000));
    await expireSecondaryQuotes(pool, new Date(now.getTime() + 30_000));
    const positions = await listMarketMakerPositions(pool, new Date(now.getTime() + 30_000));
    expect(positions.items[0]).toMatchObject({
      settledInventory: "100",
      reservedInventory: "0",
      netPosition: "0",
    });
  });

  it("RPC 응답 유실 시 같은 거래를 재전송하지 않고 거래해시 확인 뒤 완료한다", async () => {
    const accepted = await order(await quote());
    const orderId = (accepted as { workflowId: string }).workflowId;
    await decideSecondarySettlement(pool, {
      orderId,
      actorId: "00000000-0000-4000-8000-000000000102",
      actorRole: "OVERSEAS_BROKER_OPERATOR",
      decision: "APPROVE",
      signedApproval: { primaryType: "BrokerSettlementApproval" },
      now,
    });
    const [message] = await claimOutbox(pool, 1, now);
    expect(message?.eventType).toBe("SECONDARY_CHAIN_EXECUTION_REQUESTED");
    const transactionHash = `0x${"ef".repeat(32)}`;
    let executionCount = 0;
    await processSecondaryOutbox(pool, message!, now, async () => {
      executionCount += 1;
      throw new SecondaryRpcUncertainError("RPC_RESPONSE_LOST", transactionHash);
    });
    let orders = await listSecondaryOrders(pool, investorB, "INVESTOR", now);
    expect(orders.items[0]).toMatchObject({
      status: "RPC_CONFIRMATION_PENDING",
      chainFinalized: false,
      chainTransactionHash: transactionHash,
    });
    expect(executionCount).toBe(1);
    expect(await secondaryTotals(pool)).toEqual({ settled: "100", pending: "20", reserved: "5" });

    await resolveSecondaryRpcUncertainty(pool, {
      orderId,
      transactionHash,
      confirmed: true,
      now: new Date(now.getTime() + 1_000),
    });
    orders = await listSecondaryOrders(pool, investorB, "INVESTOR", now);
    expect(orders.items[0]).toMatchObject({ status: "COMPLETED", chainFinalized: true });
    expect(executionCount).toBe(1);
  });
});
