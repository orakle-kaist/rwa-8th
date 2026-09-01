import { randomUUID } from "node:crypto";

import {
  DIVIDEND_EVENT_ID,
  REGULATORY_REPORT_ID,
  acceptCommand,
  claimOutbox,
  processRightsOutbox,
  seedPrimaryData,
  seedProtectionData,
  seedRightsData,
} from "@rwa/database";
import { createClock } from "@rwa/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const clock = createClock({ TEST_CLOCK_MODE: "fixed", TEST_CLOCK_ISO: "2026-09-01T00:00:00.000Z" });
const app = await buildApp({ pool, clock, logger: false });

async function processAll() {
  for (;;) {
    const messages = await claimOutbox(pool, 20, clock.now());
    if (!messages.length) return;
    for (const message of messages) await processRightsOutbox(pool, message, clock.now());
  }
}

beforeAll(async () => {
  await pool.query(
    "TRUNCATE rights_state_history,operational_holds,reconciliation_runs,corporate_actions,wallet_recoveries,voting_instructions,voting_snapshots,voting_agendas,voting_meetings,dividend_payments,dividend_events,regulatory_reports,redemption_state_history,redemption_cash_claims,redemption_batch_orders,redemption_batches,redemption_orders,instrument_control_totals,primary_state_history,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,audit_records,inbox_messages,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, clock.now());
  await pool.query(
    `INSERT INTO customer_rights_positions
      (principal_id,security_id,pending_quantity,settled_quantity,updated_at)
     VALUES
      ('00000000-0000-4000-8000-000000000001','990001',0,4,$1),
      ('00000000-0000-4000-8000-000000000002','990001',0,2,$1)`,
    [clock.now()],
  );
  await pool.query(
    "UPDATE instrument_control_totals SET domestic_settled_quantity=6,token_total_supply=6,updated_at=$1 WHERE security_id='990001'",
    [clock.now()],
  );
  await seedRightsData(pool, clock.now());
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("권리업무와 운영 통제 API", () => {
  it("기준일 권리를 배당·의결권에 고정하고 USD 지급 뒤 선택 전환한다", async () => {
    await acceptCommand(pool, {
      principalId: "00000000-0000-4000-8000-000000000102",
      role: "OVERSEAS_BROKER_OPERATOR",
      idempotencyKey: "rights-dividend-approval-01",
      correlationId: randomUUID(),
      workflowType: "INSTITUTION_DECISION",
      commandType: "RIGHTS_DECISION_REQUESTED",
      payload: {
        taskId: DIVIDEND_EVENT_ID,
        decision: "APPROVE",
        actorId: "00000000-0000-4000-8000-000000000102",
        actorRole: "OVERSEAS_BROKER_OPERATOR",
      },
      now: clock.now(),
    });
    await processAll();

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { authorization: "Bearer demo:investor-a" },
    });
    const rights = session.json().localRightsScenario;
    expect(rights.dividend).toMatchObject({ eligibleQuantity: "4", netUsdMinor: "400" });
    expect(rights.voting).toMatchObject({ eligibleQuantity: "4" });

    const conversion = await app.inject({
      method: "POST",
      url: "/api/v1/dividend-conversions",
      headers: {
        authorization: "Bearer demo:investor-a",
        "idempotency-key": "dividend-conversion-0001",
        "x-correlation-id": randomUUID(),
      },
      payload: { dividendPaymentId: rights.dividend.paymentId, quoteId: rights.dividend.quoteId },
    });
    expect(conversion.statusCode).toBe(202);
    await processAll();
    const payment = await pool.query(
      "SELECT conversion_status,usdc_paid_minor::text FROM dividend_payments WHERE payment_id=$1",
      [rights.dividend.paymentId],
    );
    expect(payment.rows[0]).toMatchObject({
      conversion_status: "DIVIDEND_CONVERSION_COMPLETED",
      usdc_paid_minor: "4000000",
    });
  });

  it("월별 보고 증거 누락은 신규 주문 중지를 만들고 제출 증거를 보존한다", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/regulatory-reports/${REGULATORY_REPORT_ID}/submission-results`,
      headers: {
        authorization: "Bearer demo:broker-operator",
        "idempotency-key": "report-correction-required-01",
        "x-correlation-id": randomUUID(),
      },
      payload: {
        result: "CORRECTION_REQUIRED",
        sourceMetadata: { sourceRecordId: "SIM-MISSING-EVIDENCE", simulation: true },
      },
    });
    expect(response.statusCode).toBe(202);
    await processAll();
    const hold = await pool.query(
      "SELECT scope,status FROM operational_holds WHERE reason_code='REPORT_EVIDENCE_MISSING'",
    );
    expect(hold.rows[0]).toMatchObject({ scope: "NEW_ORDERS", status: "WORK_HALTED" });
  });
});
