import type { Pool } from "pg";

import type { ProjectionMetadata } from "./protection.js";

function projection(now: Date, sequence: number): ProjectionMetadata {
  return {
    projectionAsOf: now.toISOString(),
    lastEventSequence: sequence,
    projectionStatus: "CURRENT",
  };
}

function page(limit: number, cursor?: string): { limit: number; offset: number } {
  const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("조회 커서가 올바르지 않다.");
  return { limit, offset };
}

export async function listRightsPositions(
  pool: Pool,
  input: { principalId: string; role: string; limit: number; cursor?: string; now: Date },
) {
  const { limit, offset } = page(input.limit, input.cursor);
  const investor = input.role === "INVESTOR";
  const result = await pool.query<{
    security_id: string;
    settled_rights: string;
    pending_rights: string;
    locked_rights: string;
    burn_pending_tokens: string;
    cash_claim_minor: string;
  }>(
    `SELECT position.security_id,
       sum(position.settled_quantity)::text AS settled_rights,
       sum(position.pending_quantity)::text AS pending_rights,
       sum(position.secondary_reserved_quantity + position.hedge_locked_quantity +
           position.redemption_locked_quantity + position.administrative_frozen_quantity)::text AS locked_rights,
       sum(position.burn_pending_quantity)::text AS burn_pending_tokens,
       COALESCE(sum(claim.net_usd_minor) FILTER (WHERE claim.status <> 'PAID'),0)::text AS cash_claim_minor
     FROM customer_rights_positions position
     LEFT JOIN redemption_orders redemption
       ON redemption.principal_id=position.principal_id AND redemption.security_id=position.security_id
     LEFT JOIN redemption_cash_claims claim ON claim.redemption_id=redemption.redemption_id
     WHERE ($1::boolean=false OR position.principal_id=$2)
     GROUP BY position.security_id
     ORDER BY position.security_id
     LIMIT $3 OFFSET $4`,
    [investor, input.principalId, limit + 1, offset],
  );
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((row) => ({
      securityId: row.security_id,
      settledRights: row.settled_rights,
      pendingRights: row.pending_rights,
      lockedRights: row.locked_rights,
      burnPendingTokens: row.burn_pending_tokens,
      ...(row.cash_claim_minor !== "0"
        ? { cashClaim: { currency: "USD", amountMinor: row.cash_claim_minor, decimals: 2 } }
        : {}),
      projection: projection(input.now, 0),
    })),
    ...(result.rows.length > limit ? { nextCursor: String(offset + limit) } : {}),
    projection: projection(input.now, 0),
  };
}

export async function listWorkflowActivities(
  pool: Pool,
  input: { principalId: string; role: string; limit: number; cursor?: string; now: Date },
) {
  const { limit, offset } = page(input.limit, input.cursor);
  const investor = input.role === "INVESTOR";
  const result = await pool.query<{
    event_id: string;
    event_type: string;
    occurred_at: Date;
    label_ko: string;
  }>(
    `SELECT event_id,event_type,occurred_at,label_ko FROM (
       SELECT audit.audit_id AS event_id,audit.action AS event_type,audit.occurred_at,
              ('감사기록: ' || audit.action) AS label_ko,workflow.principal_id
       FROM audit_records audit
       LEFT JOIN workflows workflow ON workflow.workflow_id=audit.workflow_id
       UNION ALL
       SELECT outbox.outbox_id,outbox.event_type,outbox.occurred_at,
              ('기관 요청: ' || outbox.event_type),workflow.principal_id
       FROM outbox_messages outbox JOIN workflows workflow USING (workflow_id)
       UNION ALL
       SELECT history.history_id,('STATE_' || history.new_state),history.occurred_at,
              ('상태변경: ' || history.state_axis || ' → ' || history.new_state),workflow.principal_id
       FROM workflow_state_axis_history history JOIN workflows workflow USING (workflow_id)
     ) activity
     WHERE ($1::boolean=false OR activity.principal_id=$2)
     ORDER BY occurred_at DESC,event_id DESC
     LIMIT $3 OFFSET $4`,
    [investor, input.principalId, limit + 1, offset],
  );
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(),
      labelKo: row.label_ko,
    })),
    ...(result.rows.length > limit ? { nextCursor: String(offset + limit) } : {}),
    projection: projection(input.now, offset + rows.length),
  };
}

export async function getWorkflowTimeline(
  pool: Pool,
  input: { workflowId: string; principalId: string; role: string; now: Date },
) {
  const owned = await pool.query<{ workflow_id: string }>(
    `SELECT workflow_id FROM workflows
     WHERE workflow_id=$1 AND ($2::boolean=false OR principal_id=$3)`,
    [input.workflowId, input.role === "INVESTOR", input.principalId],
  );
  if (!owned.rows[0]) return undefined;
  const result = await pool.query<{
    event_id: string;
    event_type: string;
    occurred_at: Date;
    label_ko: string;
  }>(
    `SELECT event_id,event_type,occurred_at,label_ko FROM (
       SELECT outbox_id AS event_id,event_type,occurred_at,('기관 요청: ' || event_type) AS label_ko
       FROM outbox_messages WHERE workflow_id=$1
       UNION ALL
       SELECT audit_id,action,occurred_at,('감사기록: ' || action)
       FROM audit_records WHERE workflow_id=$1
       UNION ALL
       SELECT evidence_id,evidence_type,received_at,('기관사실: ' || evidence_type)
       FROM evidence_records WHERE workflow_id=$1
       UNION ALL
       SELECT history_id,('STATE_' || new_state),occurred_at,
              ('상태변경: ' || state_axis || ' → ' || new_state)
       FROM workflow_state_axis_history WHERE workflow_id=$1
     ) timeline ORDER BY occurred_at,event_id`,
    [input.workflowId],
  );
  return {
    workflowId: input.workflowId,
    items: result.rows.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(),
      labelKo: row.label_ko,
    })),
    projection: projection(input.now, result.rows.length),
  };
}
