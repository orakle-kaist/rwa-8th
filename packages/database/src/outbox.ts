import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

export interface OutboxMessage {
  outboxId: string;
  workflowId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
}

export async function enqueueOutbox(
  client: PoolClient,
  input: {
    workflowId: string;
    eventType: string;
    payload: unknown;
    now: Date;
  },
): Promise<string> {
  const outboxId = randomUUID();
  await client.query(
    `INSERT INTO outbox_messages
      (outbox_id, workflow_id, event_type, payload, occurred_at, available_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $5)`,
    [outboxId, input.workflowId, input.eventType, JSON.stringify(input.payload), input.now],
  );
  return outboxId;
}

export async function claimOutbox(pool: Pool, limit: number, now: Date): Promise<OutboxMessage[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("발송함 조회 한도는 1부터 100까지의 정수여야 한다.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      outbox_id: string;
      workflow_id: string;
      event_type: string;
      payload: unknown;
      attempts: number;
    }>(
      `WITH ready AS (
         SELECT outbox_id
         FROM outbox_messages
         WHERE delivered_at IS NULL
           AND available_at <= $1
           AND (claimed_at IS NULL OR claimed_at < $1 - interval '30 seconds')
         ORDER BY occurred_at, outbox_id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE outbox_messages AS message
       SET claimed_at = $1,
           attempts = message.attempts + 1
       FROM ready
       WHERE message.outbox_id = ready.outbox_id
       RETURNING message.outbox_id, message.workflow_id, message.event_type,
                 message.payload, message.attempts`,
      [now, limit],
    );
    await client.query("COMMIT");
    return result.rows.map((row) => ({
      outboxId: row.outbox_id,
      workflowId: row.workflow_id,
      eventType: row.event_type,
      payload: row.payload,
      attempts: row.attempts,
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
