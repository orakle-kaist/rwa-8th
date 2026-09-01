import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { LOCAL_SECONDARY_NORMAL_ASK_USD_MINOR, LOCAL_SECONDARY_SECURITY_ID } from "@rwa/domain";
import {
  MARKET_MAKER_PRINCIPAL_ID,
  MARKET_MAKER_WALLET,
  acceptHedgeAdapterEvent,
  acceptMarketMakerQuote,
  acceptSecondaryOrder,
  completeSecondaryChainExecution,
  decideMarketMakerHedge,
  decideSecondarySettlement,
  hedgeTotals,
  listMarketMakerHedges,
  processHedgeOutbox,
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
const institution = "00000000-0000-4000-8000-000000000401";
let sourceSequence = 0;

beforeAll(async () => pool.query("SELECT 1"));

beforeEach(async () => {
  await pool.query(
    "TRUNCATE market_maker_hedge_history,market_maker_hedge_sources,market_maker_hedges,secondary_settlement_attempts,secondary_state_history,secondary_orders,market_maker_quotes,market_maker_positions,secondary_market_state,primary_state_history,primary_default_resolutions,primary_corrections,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,complaint_history,complaints,products,disclosures,synthetic_customer_profiles,audit_records,inbox_messages,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, now);
  await seedSecondaryData(pool, now);
  sourceSequence = 0;
});

afterAll(async () => pool.end());

async function completeSecondary(marketMakerSide: "BUY" | "SELL", quantity: bigint) {
  const investorSide = marketMakerSide === "SELL" ? "BUY" : "SELL";
  const fundingMode = marketMakerSide === "SELL" ? "USDC_ONCHAIN" : "USD_LEDGER";
  const unitPrice =
    marketMakerSide === "SELL" ? 1_203_550_000n : LOCAL_SECONDARY_NORMAL_ASK_USD_MINOR;
  const quoteId = randomUUID();
  const quote = await acceptMarketMakerQuote(pool, {
    principalId: MARKET_MAKER_PRINCIPAL_ID,
    wallet: MARKET_MAKER_WALLET,
    idempotencyKey: `quote-${randomUUID()}`,
    correlationId: randomUUID(),
    quote: {
      quoteId,
      securityId: LOCAL_SECONDARY_SECURITY_ID,
      marketMakerSide,
      fundingMode,
      paymentAssetId: `0x${"00".repeat(31)}01`,
      shareQuantity: quantity,
      unitPriceMinor: unitPrice,
      halfSpreadBps: 50,
      nonce: BigInt(Date.now()),
      expiresAt: new Date(now.getTime() + 30_000),
      signedQuote: { primaryType: "MarketMakerQuote", message: { nonce: String(Date.now()) } },
    },
    now,
  });
  if (!("workflowId" in quote)) throw new Error("호가 생성 실패");
  const orderId = randomUUID();
  const order = await acceptSecondaryOrder(pool, {
    principalId: investorB,
    wallet: investorBWallet,
    idempotencyKey: `order-${randomUUID()}`,
    correlationId: randomUUID(),
    order: {
      orderId,
      quoteId,
      shareQuantity: quantity,
      investorSide,
      fundingMode,
      paymentAssetId: `0x${"00".repeat(31)}01`,
      signedIntent: {
        primaryType: "SecondaryOrderIntent",
        message: { nonce: String(Date.now() + 1) },
      },
    },
    now,
  });
  if (!("workflowId" in order)) throw new Error("주문 생성 실패");
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
  return orderId;
}

async function decideHedge(hedgeId: string) {
  const current = (await listMarketMakerHedges(pool, now)).items.find(
    (item) => item.hedgeId === hedgeId,
  );
  if (!current) throw new Error("승인할 헤지가 없다.");
  await decideMarketMakerHedge(pool, {
    hedgeId,
    principalId: MARKET_MAKER_PRINCIPAL_ID,
    actorRole: "MARKET_MAKER",
    decision: "APPROVE",
    reasonKo: "모의 헤지 확인",
    expectedAggregateVersion: Number(current.aggregateVersion),
    signedIntent: { primaryType: "PrimaryOrderIntent", simulation: true },
    idempotencyKey: `mm-${randomUUID()}`,
    correlationId: randomUUID(),
    now,
  });
  await decideMarketMakerHedge(pool, {
    hedgeId,
    principalId: "00000000-0000-4000-8000-000000000102",
    actorRole: "OVERSEAS_BROKER_OPERATOR",
    decision: "APPROVE",
    reasonKo: "외국인 한도와 위험 승인",
    expectedAggregateVersion: Number(current.aggregateVersion) + 1,
    idempotencyKey: `broker-${randomUUID()}`,
    correlationId: randomUUID(),
    now,
  });
}

async function adapter(hedgeId: string, eventType: string, data: Record<string, unknown>) {
  sourceSequence += 1;
  await acceptHedgeAdapterEvent(pool, {
    sourceInstitutionId: institution,
    eventId: randomUUID(),
    sourceSequence,
    eventType,
    data: { hedgeId, ...data },
    payloadHash: `payload-${sourceSequence}`,
    now,
  });
  const message = await pool.query<{
    outbox_id: string;
    workflow_id: string;
    event_type: string;
    payload: unknown;
  }>(
    `SELECT outbox_id,workflow_id,event_type,payload FROM outbox_messages
     WHERE workflow_id=$1 AND event_type='HEDGE_ADAPTER_EVENT_RECEIVED' AND delivered_at IS NULL
     ORDER BY occurred_at,outbox_id LIMIT 1`,
    [hedgeId],
  );
  const row = message.rows[0]!;
  await processHedgeOutbox(
    pool,
    {
      outboxId: row.outbox_id,
      workflowId: row.workflow_id,
      eventType: row.event_type,
      payload: row.payload,
    },
    now,
  );
}

describe("시장조성자 헤지 PostgreSQL 생애주기", () => {
  it("순매도 5주를 매수 헤지하고 T+2 뒤 재고와 순포지션을 복원한다", async () => {
    const sourceOrderId = await completeSecondary("SELL", 5n);
    const queue = await listMarketMakerHedges(pool, now);
    expect(queue.items[0]).toMatchObject({
      direction: "BUY",
      requestedQuantity: "5",
      status: "HEDGE_CREATED",
      sourceSecondaryOrderIds: [sourceOrderId],
    });
    const hedgeId = String(queue.items[0]!.hedgeId);
    await decideHedge(hedgeId);
    await adapter(hedgeId, "market-maker.hedge.execution-confirmed.v1", {
      tradingDate: "2026-09-01",
      filledQuantity: "5",
      domesticOrderReference: "SIM-KRX-BUY-5",
    });
    let totals = await hedgeTotals(pool);
    expect(totals).toMatchObject({
      net_position: "-5",
      settled_quantity: "95",
      pending_quantity: "25",
    });
    await adapter(hedgeId, "market-maker.hedge.domestic-settlement-confirmed.v1", {});
    totals = await hedgeTotals(pool);
    expect(totals?.net_position).toBe("-5");
    await adapter(hedgeId, "market-maker.hedge.custody-confirmed.v1", {});
    totals = await hedgeTotals(pool);
    expect(totals).toMatchObject({
      net_position: "0",
      settled_quantity: "100",
      pending_quantity: "20",
      next_session_starting_quantity: "100",
      domestic_total_quantity: "125",
      token_total_supply: "125",
    });
    expect((await listMarketMakerHedges(pool, now)).items[0]?.status).toBe(
      "HEDGE_INVENTORY_ADJUSTED",
    );
  });

  it("순매수 4주를 매도 헤지하고 지급청구와 소각 뒤 노출을 닫는다", async () => {
    await pool.query(
      `INSERT INTO customer_rights_positions
        (principal_id,security_id,pending_quantity,settled_quantity,updated_at)
       VALUES ($1,$2,0,4,$3) ON CONFLICT (principal_id,security_id)
       DO UPDATE SET settled_quantity=4,updated_at=$3`,
      [investorB, LOCAL_SECONDARY_SECURITY_ID, now],
    );
    await pool.query(
      `UPDATE secondary_market_state SET domestic_total_quantity=domestic_total_quantity+4,
         token_total_supply=token_total_supply+4 WHERE security_id=$1`,
      [LOCAL_SECONDARY_SECURITY_ID],
    );
    await completeSecondary("BUY", 4n);
    const hedge = (await listMarketMakerHedges(pool, now)).items[0]!;
    expect(hedge).toMatchObject({ direction: "SELL", requestedQuantity: "4" });
    const hedgeId = String(hedge.hedgeId);
    await decideHedge(hedgeId);
    await adapter(hedgeId, "market-maker.hedge.execution-confirmed.v1", {
      tradingDate: "2026-09-01",
      filledQuantity: "4",
      domesticOrderReference: "SIM-KRX-SELL-4",
    });
    await adapter(hedgeId, "market-maker.hedge.domestic-settlement-confirmed.v1", {});
    let totals = await hedgeTotals(pool);
    expect(totals).toMatchObject({
      net_position: "4",
      settled_quantity: "100",
      burn_pending_quantity: "4",
      domestic_total_quantity: "120",
      token_total_supply: "124",
    });
    await adapter(hedgeId, "market-maker.hedge.usd-paid.v1", {});
    totals = await hedgeTotals(pool);
    expect(totals).toMatchObject({
      net_position: "0",
      settled_quantity: "100",
      burn_pending_quantity: "0",
      domestic_total_quantity: "120",
      token_total_supply: "120",
    });
  });

  it("승인 전 반대 방향 체결은 같은 헤지를 상계하고 승인 뒤 체결은 별도 헤지를 만든다", async () => {
    await completeSecondary("SELL", 5n);
    await pool.query(
      `INSERT INTO customer_rights_positions
        (principal_id,security_id,pending_quantity,settled_quantity,updated_at)
       VALUES ($1,$2,0,2,$3) ON CONFLICT (principal_id,security_id)
       DO UPDATE SET settled_quantity=2,updated_at=$3`,
      [investorB, LOCAL_SECONDARY_SECURITY_ID, now],
    );
    await completeSecondary("BUY", 2n);
    let queue = await listMarketMakerHedges(pool, now);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ direction: "BUY", requestedQuantity: "3" });
    await decideHedge(String(queue.items[0]!.hedgeId));
    await pool.query(
      "UPDATE customer_rights_positions SET settled_quantity=1 WHERE principal_id=$1 AND security_id=$2",
      [investorB, LOCAL_SECONDARY_SECURITY_ID],
    );
    await completeSecondary("BUY", 1n);
    queue = await listMarketMakerHedges(pool, now);
    expect(queue.items).toHaveLength(2);
  });

  it("국내 주문이 부분체결되면 체결분만 재고에 반영하고 잔량은 같은 헤지에 보류한다", async () => {
    await completeSecondary("SELL", 5n);
    const hedge = (await listMarketMakerHedges(pool, now)).items[0]!;
    const hedgeId = String(hedge.hedgeId);
    await decideHedge(hedgeId);
    await adapter(hedgeId, "market-maker.hedge.execution-confirmed.v1", {
      tradingDate: "2026-09-01",
      filledQuantity: "3",
      domesticOrderReference: "SIM-KRX-PARTIAL-3",
    });
    await adapter(hedgeId, "market-maker.hedge.domestic-settlement-confirmed.v1", {});
    await adapter(hedgeId, "market-maker.hedge.custody-confirmed.v1", {});

    const current = (await listMarketMakerHedges(pool, now)).items[0]!;
    expect(current).toMatchObject({
      status: "HEDGE_ON_HOLD",
      filledQuantity: "3",
      remainingQuantity: "2",
      holdReasonKo: "체결분의 T+2 재고조정은 완료됐고 미체결 잔량은 같은 헤지에서 보류한다.",
    });
    expect(await hedgeTotals(pool)).toMatchObject({
      net_position: "-2",
      settled_quantity: "98",
      pending_quantity: "20",
      next_session_starting_quantity: "98",
    });
    const position = await pool.query<{
      risk_reducing_only: boolean;
      quote_direction_blocked: string;
    }>(
      `SELECT risk_reducing_only,quote_direction_blocked FROM market_maker_positions
       WHERE principal_id=$1 AND security_id=$2`,
      [MARKET_MAKER_PRINCIPAL_ID, LOCAL_SECONDARY_SECURITY_ID],
    );
    expect(position.rows[0]).toMatchObject({
      risk_reducing_only: true,
      quote_direction_blocked: "SELL",
    });
    const blocked = await acceptMarketMakerQuote(pool, {
      principalId: MARKET_MAKER_PRINCIPAL_ID,
      wallet: MARKET_MAKER_WALLET,
      idempotencyKey: `blocked-${randomUUID()}`,
      correlationId: randomUUID(),
      quote: {
        quoteId: randomUUID(),
        securityId: LOCAL_SECONDARY_SECURITY_ID,
        marketMakerSide: "SELL",
        fundingMode: "USDC_ONCHAIN",
        paymentAssetId: `0x${"00".repeat(31)}01`,
        shareQuantity: 1n,
        unitPriceMinor: 1_203_550_000n,
        halfSpreadBps: 50,
        nonce: BigInt(Date.now() + 50),
        expiresAt: new Date(now.getTime() + 30_000),
        signedQuote: { primaryType: "MarketMakerQuote", message: { nonce: "50" } },
      },
      now,
    });
    expect(blocked).toEqual({ rejected: "QUOTE_RISK_LIMIT" });
  });
});
