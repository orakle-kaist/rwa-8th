import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptCommand,
  acceptPrimaryOrder,
  claimOutbox,
  expirePrimaryOrders,
  listPrimaryOrders,
  processPrimaryOutbox,
  seedPrimaryData,
  seedProtectionData,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const now = new Date("2026-08-31T12:00:00.000Z");
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";

async function drain(at = now) {
  for (;;) {
    const messages = await claimOutbox(pool, 20, at);
    if (!messages.length) return;
    for (const message of messages) {
      const handled = await processPrimaryOutbox(pool, message, at);
      if (!handled) throw new Error(`예상하지 않은 이벤트 ${message.eventType}`);
    }
  }
}

async function decide(
  taskId: string,
  actorId: string,
  actorRole: string,
  extra: Record<string, string> = {},
  at = now,
) {
  await acceptCommand(pool, {
    principalId: actorId,
    role: actorRole,
    idempotencyKey: `decision-${randomUUID()}`,
    correlationId: randomUUID(),
    workflowType: "INSTITUTION_DECISION",
    commandType: "PRIMARY_DECISION_REQUESTED",
    payload: { taskId, decision: "APPROVE", ...extra },
    now: at,
  });
  await drain(at);
}

beforeAll(async () => {
  await pool.query(
    "TRUNCATE primary_state_history,primary_default_resolutions,primary_corrections,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,audit_records,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, now);
});

afterAll(async () => pool.end());

describe("1차 발행과 T+2 PostgreSQL 생애주기", () => {
  it("USD 5주와 USDC 3주를 취합해 6주 체결을 4주·2주로 배분하고 두 확인 뒤 전환한다", async () => {
    const ids = [randomUUID(), randomUUID()];
    for (const [index, input] of [
      {
        principalId: a,
        wallet: "0x5c4c1f8b0d64104c09829957fa47d68570729c71",
        quantity: 5n,
        funding: "USD_LEDGER" as const,
      },
      {
        principalId: b,
        wallet: "0xa98b91226575d5037e865d679b750353d2d40305",
        quantity: 3n,
        funding: "USDC_CONVERSION" as const,
      },
    ].entries()) {
      const result = await acceptPrimaryOrder(pool, {
        principalId: input.principalId,
        role: "INVESTOR",
        wallet: input.wallet,
        idempotencyKey: `primary-order-${index}-00000001`,
        correlationId: randomUUID(),
        order: {
          orderId: ids[index]!,
          securityId: "990001",
          shareQuantity: input.quantity,
          krwLimitPrice: 257000n,
          requestedTradingDate: "2026-08-31",
          fundingMode: input.funding,
          signedIntent: { simulation: true },
        },
        now,
      });
      expect(result).toMatchObject({ workflowId: ids[index] });
    }
    await drain();
    const batch = await pool.query<{ batch_id: string }>("SELECT batch_id FROM primary_batches");
    expect(batch.rows).toHaveLength(1);
    await decide(batch.rows[0]!.batch_id, "execution", "EXECUTION_ALLOCATION_CONFIRMER", {
      filledQuantity: "6",
    });
    let orders = await listPrimaryOrders(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now);
    expect(
      ids.map(
        (orderId) => orders.items.find((order) => order.orderId === orderId)?.allocatedQuantity,
      ),
    ).toEqual(["4", "2"]);

    for (const orderId of ids) {
      await decide(orderId, "risk", "T2_RISK_APPROVER");
      await decide(orderId, "rights-approval", "RIGHTS_ENTRY_APPROVER");
      await decide(orderId, "rights-recording", "RIGHTS_RECORDING_CONFIRMER");
      const pending = await listPrimaryOrders(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now);
      expect(pending.items.find((order) => order.orderId === orderId)?.tokenStatus).toBe(
        "PENDING_SETTLEMENT",
      );
      await decide(orderId, "settlement", "DOMESTIC_SETTLEMENT_CONFIRMER");
      expect(
        (await listPrimaryOrders(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now)).items.find(
          (order) => order.orderId === orderId,
        )?.status,
      ).toBe("SETTLEMENT_AND_CUSTODY_PENDING");
      await decide(orderId, "custody", "CUSTODY_QUANTITY_CONFIRMER");
    }
    orders = await listPrimaryOrders(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now);
    expect(orders.items.map((order) => order.status)).toEqual(["TRADABLE", "TRADABLE"]);
    const rights = await pool.query(
      "SELECT principal_id,pending_quantity::text,settled_quantity::text FROM customer_rights_positions ORDER BY principal_id",
    );
    expect(rights.rows).toEqual([
      { principal_id: a, pending_quantity: "0", settled_quantity: "4" },
      { principal_id: b, pending_quantity: "0", settled_quantity: "2" },
    ]);
    const investorBCash = await pool.query<{
      usd_available_minor: string;
      usdc_available_minor: string;
    }>(
      "SELECT usd_available_minor::text,usdc_available_minor::text FROM customer_cash_accounts WHERE principal_id=$1",
      [b],
    );
    expect(BigInt(investorBCash.rows[0]!.usd_available_minor)).toBeGreaterThan(0n);
    expect(BigInt(investorBCash.rows[0]!.usd_available_minor)).toBeLessThan(55858n);
    expect(investorBCash.rows[0]!.usdc_available_minor).toBe("9441420000");
    expect(
      (
        await pool.query<{ used_quantity: string }>(
          "SELECT used_quantity::text FROM t2_risk_limits WHERE security_id='990001'",
        )
      ).rows[0]?.used_quantity,
    ).toBe("0");
  });

  it("미체결 주문을 다음 거래일에 만료하고 USD 예약을 해제한다", async () => {
    const orderId = randomUUID();
    const before = await pool.query<{ usd_available_minor: string }>(
      "SELECT usd_available_minor::text FROM customer_cash_accounts WHERE principal_id=$1",
      [a],
    );
    await acceptPrimaryOrder(pool, {
      principalId: a,
      role: "INVESTOR",
      wallet: "0x5c4c1f8b0d64104c09829957fa47d68570729c71",
      idempotencyKey: `expire-${randomUUID()}`,
      correlationId: randomUUID(),
      order: {
        orderId,
        securityId: "990001",
        shareQuantity: 1n,
        krwLimitPrice: 257000n,
        requestedTradingDate: "2026-08-30",
        fundingMode: "USD_LEDGER",
        signedIntent: { simulation: true },
      },
      now,
    });
    await drain();
    expect(await expirePrimaryOrders(pool, "2026-09-01", new Date("2026-09-01T00:00:00Z"))).toBe(1);
    const order = (
      await listPrimaryOrders(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now)
    ).items.find((item) => item.orderId === orderId);
    expect(order?.status).toBe("EXPIRED");
    const after = await pool.query<{ usd_available_minor: string }>(
      "SELECT usd_available_minor::text FROM customer_cash_accounts WHERE principal_id=$1",
      [a],
    );
    expect(after.rows[0]?.usd_available_minor).toBe(before.rows[0]?.usd_available_minor);
  });

  it("결제불이행을 격리한 뒤 기관 승인 현금보상과 결제 대기 취소를 연결한다", async () => {
    const orderId = randomUUID();
    const scenarioNow = new Date("2026-09-01T01:00:00Z");
    await acceptPrimaryOrder(pool, {
      principalId: a,
      role: "INVESTOR",
      wallet: "0x5c4c1f8b0d64104c09829957fa47d68570729c71",
      idempotencyKey: `default-${randomUUID()}`,
      correlationId: randomUUID(),
      order: {
        orderId,
        securityId: "990001",
        shareQuantity: 1n,
        krwLimitPrice: 257000n,
        requestedTradingDate: "2026-09-01",
        fundingMode: "USD_LEDGER",
        signedIntent: { simulation: true },
      },
      now: scenarioNow,
    });
    await drain(scenarioNow);
    const batch = await pool.query<{ batch_id: string }>(
      "SELECT batch_id FROM primary_batches WHERE status='OPEN' ORDER BY created_at DESC LIMIT 1",
    );
    await decide(
      batch.rows[0]!.batch_id,
      "execution",
      "EXECUTION_ALLOCATION_CONFIRMER",
      {
        filledQuantity: "1",
      },
      scenarioNow,
    );
    await decide(orderId, "risk", "T2_RISK_APPROVER", {}, scenarioNow);
    await decide(orderId, "rights-approval", "RIGHTS_ENTRY_APPROVER", {}, scenarioNow);
    await decide(orderId, "rights-recording", "RIGHTS_RECORDING_CONFIRMER", {}, scenarioNow);
    await decide(
      orderId,
      "broker",
      "OVERSEAS_BROKER_OPERATOR",
      {
        action: "QUARANTINE_DEFAULT",
      },
      scenarioNow,
    );
    await decide(
      orderId,
      "broker",
      "OVERSEAS_BROKER_OPERATOR",
      {
        action: "APPROVE_CASH_COMPENSATION",
        cashCompensationUsdMinor: "18620",
      },
      scenarioNow,
    );
    const order = (
      await listPrimaryOrders(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now)
    ).items.find((item) => item.orderId === orderId);
    expect(order).toMatchObject({
      status: "DEFAULT_CASH_COMPENSATION_APPROVED",
      tokenStatus: "PENDING_MINT_CANCELLED",
      defaultResolution: "CASH_COMPENSATION",
      cashCompensationUsdMinor: "18620",
    });
    const resolution = await pool.query(
      "SELECT resolution_type,cash_compensation_usd_minor::text,status FROM primary_default_resolutions WHERE order_id=$1",
      [orderId],
    );
    expect(resolution.rows).toEqual([
      {
        resolution_type: "CASH_COMPENSATION",
        cash_compensation_usd_minor: "18620",
        status: "APPROVED",
      },
    ]);
  });
});
