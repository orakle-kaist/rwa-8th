import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claimOutbox, enqueueOutbox } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
}

const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query("TRUNCATE outbox_messages, idempotency_records, workflows CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("PostgreSQL 발송함", () => {
  it("한 작업자를 위한 메시지를 중복 없이 점유한다", async () => {
    const workflowId = randomUUID();
    const now = new Date("2026-08-31T00:00:00.000Z");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO workflows
          (workflow_id, workflow_type, status, principal_id, correlation_id, created_at, updated_at)
         VALUES ($1, 'FOUNDATION', 'ACCEPTED', 'investor-a', $2, $3, $3)`,
        [workflowId, randomUUID(), now],
      );
      await enqueueOutbox(client, {
        workflowId,
        eventType: "WORKFLOW_ACCEPTED",
        payload: { simulation: true },
        now,
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const firstClaim = await claimOutbox(pool, 10, now);
    const secondClaim = await claimOutbox(pool, 10, now);

    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]?.attempts).toBe(1);
    expect(secondClaim).toHaveLength(0);
  });
});
