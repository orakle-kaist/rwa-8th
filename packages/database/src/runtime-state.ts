import { randomUUID } from "node:crypto";

import {
  approvedState,
  assertApprovedInitialState,
  assertApprovedStateTransition,
} from "@rwa/domain";
import type { Pool, PoolClient } from "pg";

export interface WorkflowStateAxisView {
  axis: string;
  code: string;
  labelKo: string;
  aggregateVersion: number;
  updatedAt: string;
}

export async function initializeWorkflowState(
  client: PoolClient,
  input: {
    workflowId: string;
    axis: string;
    state: string;
    actorId: string;
    actorRole: string;
    now: Date;
    evidenceHash?: string;
    reason?: string;
  },
): Promise<void> {
  assertApprovedInitialState(input.axis, input.state);
  const inserted = await client.query(
    `INSERT INTO workflow_state_axes
      (workflow_id,state_axis,state_code,aggregate_version,updated_at)
     VALUES ($1,$2,$3,1,$4)
     ON CONFLICT (workflow_id,state_axis) DO NOTHING
     RETURNING workflow_id`,
    [input.workflowId, input.axis, input.state, input.now],
  );
  if (inserted.rowCount === 0) {
    const existing = await client.query<{ state_code: string }>(
      "SELECT state_code FROM workflow_state_axes WHERE workflow_id=$1 AND state_axis=$2",
      [input.workflowId, input.axis],
    );
    if (existing.rows[0]?.state_code !== input.state)
      assertApprovedStateTransition(input.axis, existing.rows[0]?.state_code ?? "", input.state);
    return;
  }
  await client.query(
    `INSERT INTO workflow_state_axis_history
      (history_id,workflow_id,state_axis,previous_state,new_state,aggregate_version,
       actor_id,actor_role,evidence_hash,reason,occurred_at)
     VALUES ($1,$2,$3,NULL,$4,1,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      input.workflowId,
      input.axis,
      input.state,
      input.actorId,
      input.actorRole,
      input.evidenceHash ?? null,
      input.reason ?? null,
      input.now,
    ],
  );
}

export async function transitionWorkflowState(
  client: PoolClient,
  input: {
    workflowId: string;
    axis: string;
    expectedState: string;
    nextState: string;
    actorId: string;
    actorRole: string;
    now: Date;
    evidenceHash?: string;
    reason?: string;
  },
): Promise<number> {
  const current = await client.query<{ state_code: string; aggregate_version: number }>(
    `SELECT state_code,aggregate_version FROM workflow_state_axes
     WHERE workflow_id=$1 AND state_axis=$2 FOR UPDATE`,
    [input.workflowId, input.axis],
  );
  const row = current.rows[0];
  if (!row || row.state_code !== input.expectedState)
    throw Object.assign(new Error("현재 상태가 요청한 전환 시작점과 다르다."), {
      code: "STATE_CONFLICT",
      axis: input.axis,
      current: row?.state_code ?? "<UNINITIALIZED>",
      target: input.nextState,
    });
  assertApprovedStateTransition(input.axis, row.state_code, input.nextState);
  const version = row.aggregate_version + 1;
  await client.query(
    `UPDATE workflow_state_axes SET state_code=$3,aggregate_version=$4,updated_at=$5
     WHERE workflow_id=$1 AND state_axis=$2`,
    [input.workflowId, input.axis, input.nextState, version, input.now],
  );
  await client.query(
    `INSERT INTO workflow_state_axis_history
      (history_id,workflow_id,state_axis,previous_state,new_state,aggregate_version,
       actor_id,actor_role,evidence_hash,reason,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      input.workflowId,
      input.axis,
      row.state_code,
      input.nextState,
      version,
      input.actorId,
      input.actorRole,
      input.evidenceHash ?? null,
      input.reason ?? null,
      input.now,
    ],
  );
  return version;
}

export async function transitionCurrentWorkflowState(
  client: PoolClient,
  input: Omit<Parameters<typeof transitionWorkflowState>[1], "expectedState">,
): Promise<number> {
  const current = await client.query<{ state_code: string }>(
    `SELECT state_code FROM workflow_state_axes
     WHERE workflow_id=$1 AND state_axis=$2 FOR UPDATE`,
    [input.workflowId, input.axis],
  );
  const state = current.rows[0]?.state_code;
  if (!state)
    throw Object.assign(new Error("전환할 독립 상태축이 초기화되지 않았다."), {
      code: "STATE_CONFLICT",
      axis: input.axis,
      current: "<UNINITIALIZED>",
      target: input.nextState,
    });
  return transitionWorkflowState(client, { ...input, expectedState: state });
}

export async function getWorkflowStateAxes(
  pool: Pool,
  workflowId: string,
): Promise<WorkflowStateAxisView[]> {
  const result = await pool.query<{
    state_axis: string;
    state_code: string;
    aggregate_version: number;
    updated_at: Date;
  }>(
    `SELECT state_axis,state_code,aggregate_version,updated_at
     FROM workflow_state_axes WHERE workflow_id=$1 ORDER BY state_axis`,
    [workflowId],
  );
  return result.rows.map((row) => ({
    axis: row.state_axis,
    code: row.state_code,
    labelKo: approvedState(row.state_code)?.labelKo ?? row.state_code,
    aggregateVersion: row.aggregate_version,
    updatedAt: row.updated_at.toISOString(),
  }));
}
