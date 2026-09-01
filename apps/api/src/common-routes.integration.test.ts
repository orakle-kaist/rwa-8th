import { randomUUID } from "node:crypto";

import { initializeWorkflowState, seedPrimaryData, seedProtectionData } from "@rwa/database";
import { AdjustableClock } from "@rwa/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const now = new Date("2026-08-31T12:00:00.000Z");
const clock = new AdjustableClock(now);
const workflowId = "00000000-0000-4000-8000-000000009901";
const investorA = "00000000-0000-4000-8000-000000000001";
const app = await buildApp({ pool, clock, logger: false });

beforeAll(async () => {
  await pool.query(
    `TRUNCATE workflow_state_axis_history,workflow_state_axes,redemption_cash_claims,
      redemption_orders,customer_rights_positions,audit_records,outbox_messages,
      idempotency_records,workflows CASCADE`,
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, now);
  await pool.query(
    `INSERT INTO customer_rights_positions
      (principal_id,security_id,pending_quantity,settled_quantity,secondary_reserved_quantity,
       hedge_locked_quantity,redemption_locked_quantity,burn_pending_quantity,
       administrative_frozen_quantity,updated_at)
     VALUES ($1,'990001',2,4,1,0,1,1,0,$2)`,
    [investorA, now],
  );
  await pool.query(
    `INSERT INTO workflows
      (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
     VALUES ($1,'PRIMARY_ORDER','IN_PROGRESS',$2,$3,'{}'::jsonb,$4,$4)`,
    [workflowId, investorA, randomUUID(), now],
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await initializeWorkflowState(client, {
      workflowId,
      axis: "PRIMARY_ORDER",
      state: "PRIMARY_DRAFT",
      actorId: investorA,
      actorRole: "INVESTOR",
      now,
    });
    await client.query(
      `INSERT INTO audit_records
        (audit_id,workflow_id,actor_id,actor_role,action,occurred_at)
       VALUES ($1,$2,$3,'INVESTOR','PRIMARY_ORDER_ACCEPTED',$4)`,
      [randomUUID(), workflowId, investorA, now],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("공통 권리·활동·업무 계보 API", () => {
  it("투자자 권리와 다섯 수량 상태를 역할 범위로 조회한다", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/positions",
      headers: { authorization: "Bearer demo:investor-a" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toContainEqual(
      expect.objectContaining({
        securityId: "990001",
        settledRights: "4",
        pendingRights: "2",
        lockedRights: "2",
        burnPendingTokens: "1",
      }),
    );
  });

  it("활동내역과 독립 상태축이 포함된 업무 타임라인을 조회한다", async () => {
    const headers = { authorization: "Bearer demo:investor-a" };
    const [activities, workflow, timeline] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/activities", headers }),
      app.inject({ method: "GET", url: `/api/v1/workflows/${workflowId}`, headers }),
      app.inject({ method: "GET", url: `/api/v1/workflows/${workflowId}/timeline`, headers }),
    ]);
    expect(activities.statusCode).toBe(200);
    expect(activities.json().items.map((item: { eventType: string }) => item.eventType)).toContain(
      "PRIMARY_ORDER_ACCEPTED",
    );
    expect(workflow.json().states).toContainEqual(
      expect.objectContaining({ axis: "PRIMARY_ORDER", code: "PRIMARY_DRAFT" }),
    );
    expect(timeline.json()).toMatchObject({ workflowId });
    expect(timeline.json().items).toHaveLength(2);
  });

  it("다른 투자자의 업무 계보를 숨긴다", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/workflows/${workflowId}/timeline`,
      headers: { authorization: "Bearer demo:investor-b" },
    });
    expect(response.statusCode).toBe(404);
  });
});
