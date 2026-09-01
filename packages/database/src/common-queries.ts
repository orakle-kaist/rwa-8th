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
    display_name: string;
    reference_security_id: string | null;
    settled_rights: string;
    pending_rights: string;
    locked_rights: string;
    burn_pending_tokens: string;
    cash_claim_minor: string;
  }>(
    `SELECT position.security_id,
       COALESCE(instrument.display_name,product.name_ko,position.security_id) AS display_name,
       instrument.reference_security_id,
       sum(position.settled_quantity)::text AS settled_rights,
       sum(position.pending_quantity)::text AS pending_rights,
       sum(position.secondary_reserved_quantity + position.hedge_locked_quantity +
           position.redemption_locked_quantity + position.administrative_frozen_quantity)::text AS locked_rights,
       sum(position.burn_pending_quantity)::text AS burn_pending_tokens,
       COALESCE(sum(claim.net_usd_minor) FILTER (WHERE claim.status <> 'PAID'),0)::text AS cash_claim_minor
     FROM customer_rights_positions position
     LEFT JOIN local_simulation_instruments instrument USING (security_id)
     LEFT JOIN products product USING (security_id)
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
      displayName: row.display_name,
      referenceSecurityId: row.reference_security_id,
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
    workflow_id: string;
    workflow_type: string;
    security_id: string | null;
    event_type: string;
    occurred_at: Date;
    label_ko: string;
    actor_role: string;
  }>(
    `SELECT event_id,workflow_id,workflow_type,security_id,event_type,occurred_at,label_ko,actor_role FROM (
       SELECT audit.audit_id AS event_id,audit.action AS event_type,audit.occurred_at,
              ('감사기록: ' || audit.action) AS label_ko,workflow.principal_id,
              workflow.workflow_id,workflow.workflow_type,
              workflow.request_payload->>'securityId' AS security_id,audit.actor_role
       FROM audit_records audit
       LEFT JOIN workflows workflow ON workflow.workflow_id=audit.workflow_id
       UNION ALL
       SELECT outbox.outbox_id,outbox.event_type,outbox.occurred_at,
              ('기관 요청: ' || outbox.event_type),workflow.principal_id,
              workflow.workflow_id,workflow.workflow_type,
              COALESCE(outbox.payload->>'securityId',workflow.request_payload->>'securityId'),
              'PLATFORM_OPERATOR'
       FROM outbox_messages outbox JOIN workflows workflow USING (workflow_id)
       UNION ALL
       SELECT history.history_id,('STATE_' || history.new_state),history.occurred_at,
              ('상태변경: ' || history.state_axis || ' → ' || history.new_state),workflow.principal_id,
              workflow.workflow_id,workflow.workflow_type,
              workflow.request_payload->>'securityId',history.actor_role
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
      workflowId: row.workflow_id,
      workflowType: row.workflow_type,
      securityId: row.security_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(),
      labelKo: row.label_ko,
      category: activityCategory(row.event_type),
      actorRoleKo: roleLabel(row.actor_role),
      recordLayerKo: recordLayer(row.actor_role, row.event_type),
      nextActionKo: nextAction(activityCategory(row.event_type)),
      simulation: true,
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
    actor_role: string;
    source_organization: string | null;
    evidence_reference: string | null;
    transaction_hash: string | null;
    category: string;
  }>(
    `SELECT event_id,event_type,occurred_at,label_ko,actor_role,source_organization,
            evidence_reference,transaction_hash,category FROM (
       SELECT outbox_id AS event_id,event_type,occurred_at,('기관 요청: ' || event_type) AS label_ko,
              'PLATFORM_OPERATOR' AS actor_role,NULL::text AS source_organization,
              NULL::text AS evidence_reference,NULL::text AS transaction_hash,'REQUEST' AS category
       FROM outbox_messages WHERE workflow_id=$1
       UNION ALL
       SELECT audit_id,action,occurred_at,('감사기록: ' || action),actor_role,NULL,
              evidence_hash,NULL,'AUDIT'
       FROM audit_records WHERE workflow_id=$1
       UNION ALL
       SELECT evidence_id,evidence_type,received_at,('기관사실: ' || evidence_type),
              'INSTITUTION_RESPONDER',source_organization,evidence_hash,NULL,'INSTITUTION_FACT'
       FROM evidence_records WHERE workflow_id=$1
       UNION ALL
       SELECT history_id,('STATE_' || new_state),occurred_at,
              ('상태변경: ' || state_axis || ' → ' || new_state),actor_role,NULL,
              evidence_hash,NULL,'STATE'
       FROM workflow_state_axis_history WHERE workflow_id=$1
       UNION ALL
       SELECT execution_id,('CHAIN_' || stage),COALESCE(confirmed_at,submitted_at,updated_at),
              ('체인 실행: ' || function_name || ' · ' || status),'CHAIN_EXECUTOR',
              contract_address,NULL,transaction_hash,'CHAIN'
       FROM chain_execution_steps WHERE workflow_id=$1
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
      category: row.category,
      actorRoleKo: roleLabel(row.actor_role),
      recordLayerKo: recordLayer(row.actor_role, row.event_type),
      ...(row.source_organization ? { sourceOrganization: row.source_organization } : {}),
      ...(safeReference(row.evidence_reference)
        ? { evidenceReference: safeReference(row.evidence_reference) }
        : {}),
      ...(row.transaction_hash ? { transactionHash: row.transaction_hash } : {}),
      nextActionKo: nextAction(row.category),
      simulation: true,
    })),
    projection: projection(input.now, result.rows.length),
  };
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    INVESTOR: "투자자",
    PLATFORM_OPERATOR: "토큰 플랫폼",
    OVERSEAS_BROKER_OPERATOR: "인가 해외 증권사",
    BROKER_OPERATOR: "인가 해외 증권사",
    T2_RISK_APPROVER: "인가 해외 증권사 위험 담당",
    RISK_APPROVER: "해외 증권사 위험 담당",
    RIGHTS_APPROVER: "해외 증권사 권리 담당",
    RIGHTS_RECORDER: "고객별 수탁권리 원장 담당",
    EXECUTION_CONFIRMER: "국내 주문집행 증권사",
    EXECUTION_ALLOCATION_CONFIRMER: "국내 주문집행 증권사",
    SETTLEMENT_CONFIRMER: "국내 결제 확인 담당",
    DOMESTIC_SETTLEMENT_CONFIRMER: "국내 주문집행 증권사·결제 담당",
    CUSTODY_CONFIRMER: "수탁은행·상임대리인",
    CUSTODY_QUANTITY_CONFIRMER: "수탁은행·상임대리인",
    RIGHTS_ENTRY_APPROVER: "인가 해외 증권사 권리 담당",
    RIGHTS_RECORDING_CONFIRMER: "인가 해외 증권사 권리 원장 담당",
    MARKET_MAKER: "지정 시장조성자",
    COMPLIANCE_AUDITOR: "준법·독립 감사",
    CHAIN_EXECUTOR: "제한형 토큰 실행",
    INSTITUTION_RESPONDER: "모의 외부기관",
  };
  return labels[role] ?? "업무 담당기관";
}

function activityCategory(eventType: string): string {
  if (eventType.startsWith("STATE_")) return "STATE";
  if (eventType.includes("CHAIN") || eventType.includes("TOKEN")) return "CHAIN";
  if (eventType.includes("FUND") || eventType.includes("PAYMENT")) return "FUNDS";
  return eventType.includes("REQUEST") ? "REQUEST" : "AUDIT";
}

function recordLayer(role: string, eventType: string): string {
  if (role === "CHAIN_EXECUTOR" || eventType.includes("CHAIN") || eventType.includes("TOKEN"))
    return "제한형 토큰 장부";
  if (role.includes("RIGHTS")) return "해외 증권사 고객별 수탁권리 원장";
  if (role === "SETTLEMENT_CONFIRMER" || role === "CUSTODY_CONFIRMER")
    return "국내 결제·통합 보유 기록";
  if (eventType.includes("FUND") || eventType.includes("PAYMENT")) return "USD·USDC 자금 기록";
  return "기관 업무·감사 기록";
}

function safeReference(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.length > 18 ? `${value.slice(0, 14)}…${value.slice(-4)}` : value;
}

function nextAction(category: string): string {
  const actions: Record<string, string> = {
    REQUEST: "책임기관의 응답을 기다린다.",
    INSTITUTION_FACT: "다음 독립 확인 또는 실행 단계로 진행한다.",
    STATE: "표시된 현재 단계와 차단 사유를 확인한다.",
    CHAIN: "고객별 수탁권리 원장과 자금 반영을 별도로 확인한다.",
    AUDIT: "연결된 증거와 승인범위를 확인한다.",
  };
  return actions[category] ?? "연결된 다음 업무를 확인한다.";
}
