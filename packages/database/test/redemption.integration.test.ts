import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptCommand,
  acceptPrimaryOrder,
  acceptRedemption,
  cancelRedemption,
  claimOutbox,
  listRedemptions,
  processPrimaryOutbox,
  processRedemptionOutbox,
  seedPrimaryData,
  seedProtectionData,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const now = new Date("2026-08-31T12:00:00.000Z");
const investorA = "00000000-0000-4000-8000-000000000001";
const investorB = "00000000-0000-4000-8000-000000000002";

async function drain(at = now) {
  for (;;) {
    const messages = await claimOutbox(pool, 20, at);
    if (!messages.length) return;
    for (const message of messages) {
      if (await processPrimaryOutbox(pool, message, at)) continue;
      if (await processRedemptionOutbox(pool, message, at)) continue;
      throw new Error(`예상하지 않은 이벤트 ${message.eventType}`);
    }
  }
}

async function decide(taskId: string, actorRole: string, extra: Record<string, string> = {}) {
  await acceptCommand(pool, {
    principalId: `institution:${actorRole.toLowerCase()}`,
    role: actorRole,
    idempotencyKey: `decision-${randomUUID()}`,
    correlationId: randomUUID(),
    workflowType: "INSTITUTION_DECISION",
    commandType: taskId.startsWith("primary:")
      ? "PRIMARY_DECISION_REQUESTED"
      : "REDEMPTION_DECISION_REQUESTED",
    payload: { taskId: taskId.replace("primary:", ""), decision: "APPROVE", ...extra },
    now,
  });
  await drain();
}

async function completePrimaryRights() {
  for (const [index, input] of [
    {
      principalId: investorA,
      wallet: "0x5c4c1f8b0d64104c09829957fa47d68570729c71",
      quantity: 5n,
      fundingMode: "USD_LEDGER" as const,
    },
    {
      principalId: investorB,
      wallet: "0xa98b91226575d5037e865d679b750353d2d40305",
      quantity: 3n,
      fundingMode: "USDC_CONVERSION" as const,
    },
  ].entries()) {
    await acceptPrimaryOrder(pool, {
      principalId: input.principalId,
      role: "INVESTOR",
      wallet: input.wallet,
      idempotencyKey: `redemption-primary-${index}-0001`,
      correlationId: randomUUID(),
      order: {
        orderId: randomUUID(),
        securityId: "990001",
        shareQuantity: input.quantity,
        krwLimitPrice: 257000n,
        requestedTradingDate: "2026-08-31",
        fundingMode: input.fundingMode,
        signedIntent: { simulation: true },
      },
      now,
    });
  }
  await drain();
  const batch = await pool.query<{ batch_id: string }>(
    "SELECT batch_id FROM primary_batches WHERE status='OPEN'",
  );
  await decide(`primary:${batch.rows[0]!.batch_id}`, "EXECUTION_ALLOCATION_CONFIRMER", {
    filledQuantity: "6",
  });
  const orders = await pool.query<{ order_id: string }>(
    "SELECT order_id FROM primary_orders ORDER BY acceptance_sequence",
  );
  for (const order of orders.rows) {
    await decide(`primary:${order.order_id}`, "T2_RISK_APPROVER");
    await decide(`primary:${order.order_id}`, "RIGHTS_ENTRY_APPROVER");
    await decide(`primary:${order.order_id}`, "RIGHTS_RECORDING_CONFIRMER");
    await decide(`primary:${order.order_id}`, "DOMESTIC_SETTLEMENT_CONFIRMER");
    await decide(`primary:${order.order_id}`, "CUSTODY_QUANTITY_CONFIRMER");
  }
}

beforeAll(async () => {
  await pool.query(
    "TRUNCATE redemption_state_history,redemption_cash_claims,redemption_batch_orders,redemption_batches,redemption_orders,instrument_control_totals,primary_state_history,primary_default_resolutions,primary_corrections,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,audit_records,inbox_messages,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, now);
  await completePrimaryRights();
});

afterAll(async () => pool.end());

describe("일반 투자자 환매 PostgreSQL 생애주기", () => {
  it("A 3주·B 2주를 4주 부분체결하고 지급청구·소각·USD 지급을 완결한다", async () => {
    const ids = [randomUUID(), randomUUID()];
    for (const [index, principalId] of [investorA, investorB].entries()) {
      const quantity = index === 0 ? 3n : 2n;
      await acceptRedemption(pool, {
        principalId,
        role: "INVESTOR",
        wallet:
          index === 0
            ? "0x5c4c1f8b0d64104c09829957fa47d68570729c71"
            : "0xa98b91226575d5037e865d679b750353d2d40305",
        idempotencyKey: `redemption-${index}-00000001`,
        correlationId: randomUUID(),
        redemptionId: ids[index]!,
        securityId: "990001",
        shareQuantity: quantity,
        krwLimitPrice: 257000n,
        requestedTradingDate: "2026-08-31",
        signedIntent: { simulation: true },
        now,
      });
    }
    await drain();
    const batch = await pool.query<{ batch_id: string }>(
      "SELECT batch_id FROM redemption_batches WHERE status='OPEN'",
    );
    await decide(batch.rows[0]!.batch_id, "EXECUTION_ALLOCATION_CONFIRMER", {
      filledQuantity: "4",
    });
    let redemptions = await listRedemptions(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now);
    expect(
      ids.map((id) => {
        const item = redemptions.items.find((candidate) => candidate.redemptionId === id)!;
        return [item.allocatedQuantity, item.releasedQuantity];
      }),
    ).toEqual([
      ["3", "0"],
      ["1", "1"],
    ]);
    for (const id of ids) {
      await decide(id, "DOMESTIC_SETTLEMENT_CONFIRMER");
      await decide(id, "RIGHTS_RECORDING_CONFIRMER");
      await decide(id, "OVERSEAS_BROKER_OPERATOR", { action: "COMPLETE_BOTH" });
    }
    redemptions = await listRedemptions(pool, "institution", "OVERSEAS_BROKER_OPERATOR", now);
    expect(
      ids.map((id) => {
        const item = redemptions.items.find((candidate) => candidate.redemptionId === id)!;
        return [item.cashClaimUsdMinor, item.status];
      }),
    ).toEqual([
      ["55857", "REDEMPTION_COMPLETED"],
      ["18619", "REDEMPTION_COMPLETED"],
    ]);
    const rights = await pool.query(
      `SELECT principal_id,settled_quantity::text,redemption_locked_quantity::text,burn_pending_quantity::text
       FROM customer_rights_positions WHERE security_id='990001' ORDER BY principal_id`,
    );
    expect(rights.rows).toEqual([
      {
        principal_id: investorA,
        settled_quantity: "1",
        redemption_locked_quantity: "0",
        burn_pending_quantity: "0",
      },
      {
        principal_id: investorB,
        settled_quantity: "1",
        redemption_locked_quantity: "0",
        burn_pending_quantity: "0",
      },
    ]);
    const totals = await pool.query(
      "SELECT domestic_settled_quantity::text,token_total_supply::text FROM instrument_control_totals WHERE security_id='990001'",
    );
    expect(totals.rows[0]).toEqual({ domestic_settled_quantity: "2", token_total_supply: "2" });
  });

  it("국내 제출 전 취소는 잠금을 해제하고 제출 뒤에는 차단한다", async () => {
    const redemptionId = randomUUID();
    await acceptRedemption(pool, {
      principalId: investorA,
      role: "INVESTOR",
      wallet: "0x5c4c1f8b0d64104c09829957fa47d68570729c71",
      idempotencyKey: "redemption-cancel-0000001",
      correlationId: randomUUID(),
      redemptionId,
      securityId: "990001",
      shareQuantity: 1n,
      krwLimitPrice: 257000n,
      requestedTradingDate: "2026-08-31",
      signedIntent: { simulation: true },
      now,
    });
    await drain();
    await cancelRedemption(pool, redemptionId, investorA, now);
    expect(
      (await listRedemptions(pool, investorA, "INVESTOR", now)).items.find(
        (item) => item.redemptionId === redemptionId,
      )?.status,
    ).toBe("REDEMPTION_CANCELLED");
  });
});
