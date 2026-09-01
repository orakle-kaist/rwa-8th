import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getWorkflowStateAxes,
  initializeWorkflowState,
  transitionWorkflowState,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const workflowId = randomUUID();
const now = new Date("2026-08-31T12:00:00.000Z");

beforeAll(async () => {
  await pool.query(
    "TRUNCATE workflow_state_axis_history,workflow_state_axes,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await pool.query(
    `INSERT INTO workflows
      (workflow_id,workflow_type,status,principal_id,correlation_id,created_at,updated_at)
     VALUES ($1,'PRIMARY_ORDER','ACCEPTED','runtime-state-test',$2,$3,$3)`,
    [workflowId, randomUUID(), now],
  );
});

afterAll(async () => pool.end());

describe("업무별 독립 상태축", () => {
  it("허용 전환과 버전을 같은 DB 거래에서 기록한다", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await initializeWorkflowState(client, {
        workflowId,
        axis: "PRIMARY_ORDER",
        state: "PRIMARY_DRAFT",
        actorId: "investor-a",
        actorRole: "INVESTOR",
        now,
      });
      const version = await transitionWorkflowState(client, {
        workflowId,
        axis: "PRIMARY_ORDER",
        expectedState: "PRIMARY_DRAFT",
        nextState: "PRIMARY_FUNDS_CHECK",
        actorId: "primary-worker",
        actorRole: "PLATFORM_OPERATOR",
        now,
      });
      expect(version).toBe(2);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await getWorkflowStateAxes(pool, workflowId)).toMatchObject([
      { axis: "PRIMARY_ORDER", code: "PRIMARY_FUNDS_CHECK", aggregateVersion: 2 },
    ]);
  });

  it("금지 전환은 STATE_CONFLICT를 반환하고 상태를 유지한다", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(
        transitionWorkflowState(client, {
          workflowId,
          axis: "PRIMARY_ORDER",
          expectedState: "PRIMARY_FUNDS_CHECK",
          nextState: "PRIMARY_FULLY_FILLED",
          actorId: "primary-worker",
          actorRole: "PLATFORM_OPERATOR",
          now,
        }),
      ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect((await getWorkflowStateAxes(pool, workflowId))[0]?.code).toBe("PRIMARY_FUNDS_CHECK");
  });
});
