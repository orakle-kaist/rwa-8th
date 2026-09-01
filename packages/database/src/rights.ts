import { createHash, randomUUID } from "node:crypto";

import {
  LOCAL_CORPORATE_ACTION_SECURITY_ID,
  LOCAL_RIGHTS_SECURITY_ID,
  SYNTHETIC_DIVIDEND_QUOTE_SECONDS,
  allocateSyntheticDividend,
  classifyReportSubmission,
  expectedSplitSupply,
} from "@rwa/domain";
import type { Pool, PoolClient } from "pg";

import type { OutboxMessage } from "./outbox.js";
import { commandHash, type ProjectionMetadata } from "./protection.js";

function projection(now: Date): ProjectionMetadata {
  return { projectionAsOf: now.toISOString(), lastEventSequence: 0, projectionStatus: "CURRENT" };
}

function evidence(value: string) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function required(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || !value) throw new Error(`${name} 값이 필요하다.`);
  return value;
}

async function history(
  client: PoolClient,
  workflowId: string,
  previous: string | null,
  next: string,
  actorId: string,
  actorRole: string,
  now: Date,
  evidenceHash?: string,
) {
  await client.query(
    `INSERT INTO rights_state_history
      (history_id,workflow_id,previous_state,new_state,actor_id,actor_role,evidence_hash,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), workflowId, previous, next, actorId, actorRole, evidenceHash ?? null, now],
  );
}

export async function isRightsWorkflow(pool: Pool, workflowId: string) {
  const result = await pool.query<{ workflow_type: string }>(
    `SELECT workflow_type FROM workflows WHERE workflow_id=$1 AND workflow_type IN
      ('DIVIDEND','VOTING','REGULATORY_REPORT','WALLET_REPLACEMENT','CORPORATE_ACTION','RECONCILIATION')`,
    [workflowId],
  );
  return result.rows[0]?.workflow_type;
}

export async function getLocalRightsScenario(pool: Pool, principalId: string, now: Date) {
  const dividend = await pool.query<Record<string, unknown>>(
    `SELECT event.event_id,event.security_id,event.record_date::text,event.ex_date::text,event.status,
       event.gross_per_share_usd_minor::text,event.domestic_total_usd_minor::text,
       payment.payment_id,payment.eligible_quantity::text,payment.net_usd_minor::text,
       payment.status payment_status,payment.quote_id,payment.quote_expires_at,
       payment.conversion_status,payment.usdc_paid_minor::text
     FROM dividend_events event
     LEFT JOIN dividend_payments payment ON payment.event_id=event.event_id AND payment.principal_id=$1
     ORDER BY event.created_at DESC LIMIT 1`,
    [principalId],
  );
  const voting = await pool.query<Record<string, unknown>>(
    `SELECT meeting.meeting_id,meeting.security_id,meeting.record_date::text,meeting.instruction_deadline,
       meeting.status,meeting.aggregate_result,meeting.standing_proxy_result_evidence_hash,
       agenda.agenda_id,agenda.title_ko,snapshot.eligible_quantity::text,
       instruction.instruction
     FROM voting_meetings meeting JOIN voting_agendas agenda ON agenda.meeting_id=meeting.meeting_id
     LEFT JOIN voting_snapshots snapshot ON snapshot.meeting_id=meeting.meeting_id AND snapshot.principal_id=$1
     LEFT JOIN voting_instructions instruction ON instruction.meeting_id=meeting.meeting_id
       AND instruction.agenda_id=agenda.agenda_id AND instruction.principal_id=$1 AND instruction.active
     ORDER BY meeting.created_at DESC LIMIT 1`,
    [principalId],
  );
  const recovery = await pool.query<Record<string, unknown>>(
    `SELECT workflow_id,old_wallet,new_wallet,rights_approved,compliance_approved,chain_executed,
       rights_ledger_updated,reconciled,status,transaction_hash
     FROM wallet_recoveries WHERE principal_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [principalId],
  );
  const action = await pool.query<Record<string, unknown>>(
    `SELECT action_id,security_id,action_type,numerator::text,denominator::text,expected_supply::text,
       rights_approved,audit_approved,domestic_applied,token_applied,reconciled,status,transaction_hash
     FROM corporate_actions WHERE security_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [LOCAL_CORPORATE_ACTION_SECURITY_ID],
  );
  const dividendRow = dividend.rows[0];
  const votingRow = voting.rows[0];
  return {
    securityId: LOCAL_RIGHTS_SECURITY_ID,
    simulation: true,
    notices: [
      "권리수량은 인가 해외 증권사의 기준일 고객별 수탁권리 스냅샷을 사용한다.",
      "합성 배당은 1주당 USD 1.00, 세금과 수수료 0이며 실제 시장조건이 아니다.",
      "분실한 자기보관 지갑의 USDC는 토큰 플랫폼이 복구하지 않는다.",
    ],
    dividend: dividendRow
      ? {
          eventId: dividendRow.event_id,
          recordDate: dividendRow.record_date,
          exDate: dividendRow.ex_date,
          status: dividendRow.status,
          grossPerShareUsdMinor: dividendRow.gross_per_share_usd_minor,
          domesticTotalUsdMinor: dividendRow.domestic_total_usd_minor,
          ...(dividendRow.payment_id
            ? {
                paymentId: dividendRow.payment_id,
                eligibleQuantity: dividendRow.eligible_quantity,
                netUsdMinor: dividendRow.net_usd_minor,
                paymentStatus: dividendRow.payment_status,
                quoteId: dividendRow.quote_id,
                quoteExpiresAt: dividendRow.quote_expires_at
                  ? (dividendRow.quote_expires_at as Date).toISOString()
                  : undefined,
                conversionStatus: dividendRow.conversion_status,
                usdcPaidMinor: dividendRow.usdc_paid_minor,
              }
            : {}),
        }
      : undefined,
    voting: votingRow
      ? {
          meetingId: votingRow.meeting_id,
          agendaId: votingRow.agenda_id,
          titleKo: votingRow.title_ko,
          recordDate: votingRow.record_date,
          instructionDeadline: (votingRow.instruction_deadline as Date).toISOString(),
          eligibleQuantity: votingRow.eligible_quantity ?? "0",
          status: votingRow.status,
          instruction: votingRow.instruction,
          aggregateResult: votingRow.aggregate_result,
          standingProxyResultEvidenceHash: votingRow.standing_proxy_result_evidence_hash,
        }
      : undefined,
    recovery: recovery.rows[0] ?? undefined,
    corporateAction: action.rows[0] ?? undefined,
    projection: projection(now),
  };
}

export async function listHolds(pool: Pool, now: Date) {
  const result = await pool.query<Record<string, unknown>>(
    "SELECT * FROM operational_holds ORDER BY created_at DESC",
  );
  return {
    items: result.rows.map((row) => ({
      workflowId: row.hold_id,
      workflowType: "OPERATIONAL_HOLD",
      states: [{ axis: "RECONCILIATION", code: row.status, labelKo: String(row.status) }],
      securityId: row.security_id,
      scope: row.scope,
      reasonCode: row.reason_code,
      projection: projection(now),
    })),
    projection: projection(now),
  };
}

export async function listRegulatoryReports(pool: Pool, now: Date) {
  const result = await pool.query<Record<string, unknown>>(
    "SELECT * FROM regulatory_reports ORDER BY reporting_month DESC",
  );
  return {
    items: result.rows.map((row) => ({
      workflowId: row.report_id,
      workflowType: "REGULATORY_REPORT",
      states: [{ axis: "REGULATORY_REPORT", code: row.status, labelKo: String(row.status) }],
      reportingMonth: row.reporting_month,
      dueDate: row.due_date,
      recordCount: row.record_count,
      retentionUntil: row.retention_until,
      receiptReference: row.receipt_reference,
      projection: projection(now),
    })),
    projection: projection(now),
  };
}

export async function hasActiveOrderHold(pool: Pool, securityId?: string) {
  const result = await pool.query(
    `SELECT 1 FROM operational_holds
     WHERE status IN ('WORK_HALTED','RELEASE_SCHEDULED')
       AND (security_id IS NULL OR security_id=$1)
       AND scope IN ('NEW_ORDERS','PRIMARY_AND_SECONDARY','ALL') LIMIT 1`,
    [securityId ?? null],
  );
  return result.rows.length > 0;
}

async function snapshotDividend(client: PoolClient, workflowId: string, now: Date) {
  const event = await client.query<{
    security_id: string;
    ex_date: string;
    gross_per_share_usd_minor: string;
    status: string;
  }>(
    "SELECT security_id,ex_date::text,gross_per_share_usd_minor::text,status FROM dividend_events WHERE event_id=$1 FOR UPDATE",
    [workflowId],
  );
  if (!event.rows[0] || event.rows[0].status !== "DIVIDEND_SNAPSHOT_REVIEW")
    throw new Error("배당 스냅샷 검토상태가 아니다.");
  const positions = await client.query<{ principal_id: string; quantity: string }>(
    `WITH pre_ex_date_allocations AS (
       SELECT principal_id,COALESCE(SUM(allocated_quantity),0) eligible_pending
       FROM primary_orders
       WHERE security_id=$1 AND accepted_at < ($2::date AT TIME ZONE 'Asia/Seoul')
         AND rights_status IN ('RIGHTS_RECORDED','RIGHTS_SETTLED')
       GROUP BY principal_id
     )
     SELECT position.principal_id,
       (position.settled_quantity + LEAST(position.pending_quantity,
         COALESCE(allocation.eligible_pending,0)))::text quantity
     FROM customer_rights_positions position
     LEFT JOIN pre_ex_date_allocations allocation USING (principal_id)
     WHERE position.security_id=$1
       AND position.settled_quantity + LEAST(position.pending_quantity,
         COALESCE(allocation.eligible_pending,0)) > 0`,
    [event.rows[0].security_id, event.rows[0].ex_date],
  );
  let domesticTotal = 0n;
  for (const position of positions.rows) {
    const allocation = allocateSyntheticDividend(BigInt(position.quantity));
    domesticTotal += allocation.netUsdMinor;
    const paymentId = randomUUID();
    const quoteId = randomUUID();
    await client.query(
      `INSERT INTO dividend_payments
        (payment_id,event_id,principal_id,eligible_quantity,gross_usd_minor,tax_usd_minor,fee_usd_minor,
         net_usd_minor,status,usd_paid_at,payment_evidence_hash,quote_id,quote_expires_at,
         conversion_status,updated_at)
       VALUES ($1,$2,$3,$4,$5,0,0,$5,'DIVIDEND_USD_PAID',$6,$7,$8,$9,
         'DIVIDEND_USDC_QUOTED',$6)
       ON CONFLICT (event_id,principal_id) DO NOTHING`,
      [
        paymentId,
        workflowId,
        position.principal_id,
        position.quantity,
        allocation.netUsdMinor.toString(),
        now,
        evidence(`dividend-payment:${workflowId}:${position.principal_id}`),
        quoteId,
        new Date(now.getTime() + SYNTHETIC_DIVIDEND_QUOTE_SECONDS * 1000),
      ],
    );
    await client.query(
      `UPDATE customer_cash_accounts SET usd_available_minor=usd_available_minor+$2,updated_at=$3
       WHERE principal_id=$1`,
      [position.principal_id, allocation.netUsdMinor.toString(), now],
    );
  }
  await client.query(
    "UPDATE dividend_events SET domestic_total_usd_minor=$2,status='DIVIDEND_USD_PAID',updated_at=$3 WHERE event_id=$1",
    [workflowId, domesticTotal.toString(), now],
  );
  const votingMeeting = await client.query<{ meeting_id: string }>(
    "SELECT meeting_id FROM voting_meetings WHERE security_id=$1 AND record_date=(SELECT record_date FROM dividend_events WHERE event_id=$2) LIMIT 1",
    [event.rows[0].security_id, workflowId],
  );
  if (votingMeeting.rows[0]) {
    for (const position of positions.rows) {
      await client.query(
        `INSERT INTO voting_snapshots (meeting_id,principal_id,eligible_quantity)
         VALUES ($1,$2,$3) ON CONFLICT (meeting_id,principal_id) DO NOTHING`,
        [votingMeeting.rows[0].meeting_id, position.principal_id, position.quantity],
      );
    }
  }
  return "DIVIDEND_USD_PAID";
}

async function convertDividend(
  client: PoolClient,
  payload: Record<string, unknown>,
  actorId: string,
  now: Date,
) {
  const paymentId = required(payload, "dividendPaymentId");
  const quoteId = required(payload, "quoteId");
  const payment = await client.query<{
    net_usd_minor: string;
    status: string;
    quote_id: string;
    quote_expires_at: Date;
    conversion_status: string;
  }>(
    `SELECT net_usd_minor::text,status,quote_id,quote_expires_at,conversion_status
     FROM dividend_payments WHERE payment_id=$1 AND principal_id=$2 FOR UPDATE`,
    [paymentId, actorId],
  );
  const row = payment.rows[0];
  if (!row || row.quote_id !== quoteId || row.status !== "DIVIDEND_USD_PAID")
    throw new Error("전환 가능한 배당 지급건이 아니다.");
  if (row.conversion_status === "DIVIDEND_CONVERSION_COMPLETED") return;
  if (row.quote_expires_at <= now) {
    await client.query(
      "UPDATE dividend_payments SET conversion_status='DIVIDEND_RESERVATION_RELEASED',updated_at=$2 WHERE payment_id=$1",
      [paymentId, now],
    );
    return;
  }
  const usd = BigInt(row.net_usd_minor);
  const usdc = usd * 10_000n;
  const cash = await client.query<{ usd_available_minor: string }>(
    "SELECT usd_available_minor::text FROM customer_cash_accounts WHERE principal_id=$1 FOR UPDATE",
    [actorId],
  );
  if (BigInt(cash.rows[0]?.usd_available_minor ?? "0") < usd)
    throw new Error("배당 USD 잔액이 부족하다.");
  await client.query(
    `UPDATE customer_cash_accounts SET usd_available_minor=usd_available_minor-$2,
       usdc_available_minor=usdc_available_minor+$3,updated_at=$4 WHERE principal_id=$1`,
    [actorId, usd.toString(), usdc.toString(), now],
  );
  await client.query(
    `UPDATE dividend_payments SET conversion_status='DIVIDEND_CONVERSION_COMPLETED',
       usdc_paid_minor=$2,conversion_evidence_hash=$3,updated_at=$4 WHERE payment_id=$1`,
    [paymentId, usdc.toString(), evidence(`dividend-conversion:${paymentId}`), now],
  );
}

async function recordVote(
  client: PoolClient,
  payload: Record<string, unknown>,
  actorId: string,
  now: Date,
) {
  const meetingId = required(payload, "meetingId");
  const agendaId = required(payload, "agendaId");
  const instruction = required(payload, "instruction");
  if (!new Set(["FOR", "AGAINST", "ABSTAIN"]).has(instruction))
    throw new Error("의결 지시가 올바르지 않다.");
  const meeting = await client.query<{ instruction_deadline: Date; status: string }>(
    "SELECT instruction_deadline,status FROM voting_meetings WHERE meeting_id=$1 FOR UPDATE",
    [meetingId],
  );
  if (
    !meeting.rows[0] ||
    meeting.rows[0].status !== "VOTE_INSTRUCTION_COLLECTION" ||
    meeting.rows[0].instruction_deadline <= now
  )
    throw new Error("의결권 지시기간이 아니다.");
  const snapshot = await client.query<{ eligible_quantity: string }>(
    "SELECT eligible_quantity::text FROM voting_snapshots WHERE meeting_id=$1 AND principal_id=$2",
    [meetingId, actorId],
  );
  if (BigInt(snapshot.rows[0]?.eligible_quantity ?? "0") <= 0n)
    throw new Error("의결권 기준수량이 없다.");
  const previous = await client.query<{ instruction_id: string }>(
    "SELECT instruction_id FROM voting_instructions WHERE meeting_id=$1 AND agenda_id=$2 AND principal_id=$3 AND active FOR UPDATE",
    [meetingId, agendaId, actorId],
  );
  if (previous.rows[0])
    await client.query("UPDATE voting_instructions SET active=false WHERE instruction_id=$1", [
      previous.rows[0].instruction_id,
    ]);
  await client.query(
    `INSERT INTO voting_instructions
      (instruction_id,meeting_id,agenda_id,principal_id,instruction,corrects_instruction_id,submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      meetingId,
      agendaId,
      actorId,
      instruction,
      previous.rows[0]?.instruction_id ?? null,
      now,
    ],
  );
}

async function runReconciliation(
  client: PoolClient,
  workflowId: string,
  payload: Record<string, unknown>,
  now: Date,
) {
  const securityId =
    typeof payload.securityId === "string" ? payload.securityId : LOCAL_RIGHTS_SECURITY_ID;
  const totals = await client.query<{
    rights_total: string;
    burn_pending: string;
    settled_rights: string;
  }>(
    `SELECT COALESCE(SUM(pending_quantity+settled_quantity),0)::text rights_total,
       COALESCE(SUM(burn_pending_quantity),0)::text burn_pending,
       COALESCE(SUM(settled_quantity),0)::text settled_rights
     FROM customer_rights_positions WHERE security_id=$1`,
    [securityId],
  );
  const control = await client.query<{
    token_total_supply: string;
    domestic_settled_quantity: string;
  }>(
    "SELECT token_total_supply::text,domestic_settled_quantity::text FROM instrument_control_totals WHERE security_id=$1",
    [securityId],
  );
  const rights = BigInt(totals.rows[0]?.rights_total ?? "0");
  const burn = BigInt(totals.rows[0]?.burn_pending ?? "0");
  const settled = BigInt(totals.rows[0]?.settled_rights ?? "0");
  const supply = BigInt(control.rows[0]?.token_total_supply ?? "0");
  const domestic = BigInt(control.rows[0]?.domestic_settled_quantity ?? "0");
  const matched = rights === supply - burn && settled === domestic;
  const status = matched ? "RECONCILIATION_MATCHED" : "MISMATCH_SUSPECTED";
  const reason = matched ? null : "고객 권리·토큰 또는 국내 결제완료 수량이 일치하지 않는다.";
  await client.query(
    `INSERT INTO reconciliation_runs
      (reconciliation_id,security_id,scope,as_of,status,rights_total,token_supply,burn_pending,
       domestic_settled,settled_rights,mismatch_reason,evidence_hash,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$4)`,
    [
      workflowId,
      securityId,
      payload.scope ?? "SECURITY",
      now,
      status,
      rights.toString(),
      supply.toString(),
      burn.toString(),
      domestic.toString(),
      settled.toString(),
      reason,
      evidence(`reconciliation:${workflowId}`),
    ],
  );
  if (!matched) {
    await client.query(
      `INSERT INTO operational_holds
        (hold_id,source_workflow_id,security_id,scope,reason_code,status,created_at,updated_at)
       VALUES ($1,$2,$3,'PRIMARY_AND_SECONDARY','RECONCILIATION_MISMATCH','WORK_HALTED',$4,$4)`,
      [randomUUID(), workflowId, securityId, now],
    );
  }
  return status;
}

async function decideRightsTask(
  client: PoolClient,
  payload: Record<string, unknown>,
  actorId: string,
  actorRole: string,
  now: Date,
) {
  const taskId = required(payload, "taskId");
  const decision = required(payload, "decision");
  if (decision !== "APPROVE") throw new Error("이 시연에서는 승인된 보정 흐름만 진행한다.");
  const target = await client.query<{
    workflow_type: string;
    status: string;
    principal_id: string;
  }>("SELECT workflow_type,status,principal_id FROM workflows WHERE workflow_id=$1 FOR UPDATE", [
    taskId,
  ]);
  const row = target.rows[0];
  if (!row) throw new Error("권리업무를 찾을 수 없다.");
  let next = row.status;
  if (row.workflow_type === "DIVIDEND" && actorRole === "OVERSEAS_BROKER_OPERATOR") {
    next = await snapshotDividend(client, taskId, now);
  } else if (row.workflow_type === "VOTING" && actorRole === "OVERSEAS_BROKER_OPERATOR") {
    const aggregate = await client.query<{ instruction: string | null; quantity: string }>(
      `SELECT instruction.instruction,COALESCE(SUM(snapshot.eligible_quantity),0)::text quantity
       FROM voting_snapshots snapshot
       LEFT JOIN voting_instructions instruction ON instruction.meeting_id=snapshot.meeting_id
         AND instruction.principal_id=snapshot.principal_id AND instruction.active
       WHERE snapshot.meeting_id=$1 GROUP BY instruction.instruction`,
      [taskId],
    );
    const result = Object.fromEntries(
      aggregate.rows.map((item) => [item.instruction ?? "NO_RESPONSE", item.quantity]),
    );
    await client.query(
      `UPDATE voting_meetings SET status='VOTE_COMPLETED',aggregate_result=$2::jsonb,
       standing_proxy_result_evidence_hash=$3,updated_at=$4 WHERE meeting_id=$1`,
      [taskId, JSON.stringify(result), evidence(`standing-proxy-result:${taskId}`), now],
    );
    next = "VOTE_COMPLETED";
  } else if (row.workflow_type === "WALLET_REPLACEMENT") {
    const recovery = await client.query<Record<string, unknown>>(
      "SELECT * FROM wallet_recoveries WHERE workflow_id=$1 FOR UPDATE",
      [taskId],
    );
    if (!recovery.rows[0]) throw new Error("지갑 복구 기록이 없다.");
    if (actorRole === "RIGHTS_ENTRY_APPROVER")
      await client.query(
        "UPDATE wallet_recoveries SET rights_approved=true,updated_at=$2 WHERE workflow_id=$1",
        [taskId, now],
      );
    else if (actorRole === "COMPLIANCE_AUDITOR")
      await client.query(
        "UPDATE wallet_recoveries SET compliance_approved=true,updated_at=$2 WHERE workflow_id=$1",
        [taskId, now],
      );
    else throw new Error("지갑 복구 승인 역할이 아니다.");
    const approved = await client.query<{
      rights_approved: boolean;
      compliance_approved: boolean;
      principal_id: string;
      old_wallet: string;
      new_wallet: string;
    }>(
      "SELECT rights_approved,compliance_approved,principal_id,old_wallet,new_wallet FROM wallet_recoveries WHERE workflow_id=$1",
      [taskId],
    );
    const approvedRecovery = approved.rows[0];
    if (!approvedRecovery) throw new Error("지갑 복구 승인기록이 없다.");
    if (approvedRecovery.rights_approved && approvedRecovery.compliance_approved) {
      const transactionHash = evidence(`wallet-recovery:${taskId}`);
      await client.query(
        "UPDATE customer_wallets SET status='REVOKED',active=false,updated_at=$2 WHERE principal_id=$1 AND wallet_address=$3",
        [approvedRecovery.principal_id, now, approvedRecovery.old_wallet],
      );
      await client.query(
        "UPDATE customer_wallets SET status='LINKED',active=true,chain_sync_status='CONFIRMED',updated_at=$2 WHERE principal_id=$1 AND wallet_address=$3",
        [approvedRecovery.principal_id, now, approvedRecovery.new_wallet],
      );
      await client.query(
        `UPDATE wallet_recoveries SET chain_executed=true,rights_ledger_updated=true,reconciled=true,
        transaction_hash=$2,status='RECOVERY_COMPLETED',updated_at=$3 WHERE workflow_id=$1`,
        [taskId, transactionHash, now],
      );
      next = "RECOVERY_COMPLETED";
    } else next = "RECOVERY_APPROVAL_PENDING";
  } else if (row.workflow_type === "CORPORATE_ACTION") {
    if (actorRole === "RIGHTS_ENTRY_APPROVER")
      await client.query(
        "UPDATE corporate_actions SET rights_approved=true,updated_at=$2 WHERE action_id=$1",
        [taskId, now],
      );
    else if (actorRole === "COMPLIANCE_AUDITOR")
      await client.query(
        "UPDATE corporate_actions SET audit_approved=true,updated_at=$2 WHERE action_id=$1",
        [taskId, now],
      );
    else throw new Error("기업행동 승인 역할이 아니다.");
    const action = await client.query<{
      rights_approved: boolean;
      audit_approved: boolean;
      security_id: string;
      numerator: string;
      denominator: string;
      expected_supply: string;
    }>(
      "SELECT rights_approved,audit_approved,security_id,numerator::text,denominator::text,expected_supply::text FROM corporate_actions WHERE action_id=$1",
      [taskId],
    );
    const approvedAction = action.rows[0];
    if (!approvedAction) throw new Error("기업행동 승인기록이 없다.");
    if (approvedAction.rights_approved && approvedAction.audit_approved) {
      const pos = await client.query<{
        settled_quantity: string;
        pending_quantity: string;
        redemption_locked_quantity: string;
        administrative_frozen_quantity: string;
        burn_pending_quantity: string;
      }>(
        `SELECT settled_quantity::text,pending_quantity::text,redemption_locked_quantity::text,
          administrative_frozen_quantity::text,burn_pending_quantity::text
         FROM customer_rights_positions WHERE security_id=$1 FOR UPDATE`,
        [approvedAction.security_id],
      );
      let expectedTotal = 0n;
      for (const p of pos.rows) {
        const admin = BigInt(p.administrative_frozen_quantity);
        const locked = BigInt(p.redemption_locked_quantity);
        const settled = BigInt(p.settled_quantity);
        const available = settled - locked - admin;
        expectedTotal += expectedSplitSupply({
          available,
          pending: BigInt(p.pending_quantity),
          redemptionLocked: locked,
          administrativeFrozen: admin,
          burnPending: BigInt(p.burn_pending_quantity),
          numerator: BigInt(approvedAction.numerator),
          denominator: BigInt(approvedAction.denominator),
        });
      }
      if (expectedTotal !== BigInt(approvedAction.expected_supply))
        throw new Error("기업행동 예상 공급량이 일치하지 않는다.");
      await client.query(
        `UPDATE customer_rights_positions SET
        settled_quantity=settled_quantity*$2/$3,
        pending_quantity=pending_quantity*$2/$3,
        redemption_locked_quantity=redemption_locked_quantity*$2/$3,
        administrative_frozen_quantity=administrative_frozen_quantity*$2/$3,
        updated_at=$4 WHERE security_id=$1`,
        [approvedAction.security_id, approvedAction.numerator, approvedAction.denominator, now],
      );
      await client.query(
        "UPDATE instrument_control_totals SET domestic_settled_quantity=domestic_settled_quantity*$2/$3,token_total_supply=$4,updated_at=$5 WHERE security_id=$1",
        [
          approvedAction.security_id,
          approvedAction.numerator,
          approvedAction.denominator,
          approvedAction.expected_supply,
          now,
        ],
      );
      await client.query(
        `UPDATE corporate_actions SET domestic_applied=true,token_applied=true,reconciled=true,
        status='CORPORATE_ACTION_RECONCILED',transaction_hash=$2,updated_at=$3 WHERE action_id=$1`,
        [taskId, evidence(`corporate-action:${taskId}`), now],
      );
      next = "CORPORATE_ACTION_RECONCILED";
    } else next = "CORPORATE_ACTION_PLAN_REVIEW";
  } else throw new Error("지원하지 않는 권리업무 결정이다.");
  await client.query("UPDATE workflows SET status=$2,updated_at=$3 WHERE workflow_id=$1", [
    taskId,
    next,
    now,
  ]);
  await history(
    client,
    taskId,
    row.status,
    next,
    actorId,
    actorRole,
    now,
    evidence(`decision:${taskId}:${actorRole}`),
  );
}

export async function processRightsOutbox(
  pool: Pool,
  message: OutboxMessage,
  now: Date,
): Promise<boolean> {
  const supported = new Set([
    "DIVIDEND_CONVERSION_REQUESTED",
    "VOTING_INSTRUCTION_REQUESTED",
    "RECONCILIATION_REQUESTED",
    "RIGHTS_DECISION_REQUESTED",
    "REPORT_SUBMISSION_REQUESTED",
    "HOLD_RELEASE_DECISION_REQUESTED",
  ]);
  if (!supported.has(message.eventType)) return false;
  const payload = message.payload as Record<string, unknown>;
  const actorId = required(payload, "actorId");
  const actorRole = required(payload, "actorRole");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let status = "COMPLETED";
    if (message.eventType === "DIVIDEND_CONVERSION_REQUESTED")
      await convertDividend(client, payload, actorId, now);
    else if (message.eventType === "VOTING_INSTRUCTION_REQUESTED")
      await recordVote(client, payload, actorId, now);
    else if (message.eventType === "RECONCILIATION_REQUESTED")
      status = await runReconciliation(client, message.workflowId, payload, now);
    else if (message.eventType === "RIGHTS_DECISION_REQUESTED")
      await decideRightsTask(client, payload, actorId, actorRole, now);
    else if (message.eventType === "REPORT_SUBMISSION_REQUESTED") {
      const reportId = required(payload, "reportId");
      const result = required(payload, "result");
      const submitted = classifyReportSubmission(now, "2026-09-10");
      status =
        result === "ACCEPTED"
          ? submitted === "ON_TIME"
            ? "REPORT_SUBMITTED_ON_TIME"
            : "REPORT_SUBMITTED_LATE"
          : "REPORT_CORRECTION_REVIEW";
      const recordCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text count FROM customer_rights_positions
         WHERE pending_quantity+settled_quantity+burn_pending_quantity>0`,
      );
      await client.query(
        `UPDATE regulatory_reports SET status=$2,submitted_at=$3,
        submission_evidence_hash=$4,receipt_reference=$5,record_count=$6,updated_at=$3 WHERE report_id=$1`,
        [
          reportId,
          status,
          now,
          evidence(`report:${reportId}:${result}`),
          payload.sourceRecordId ?? `SIM-REPORT-${reportId}`,
          Number(recordCount.rows[0]?.count ?? "0"),
        ],
      );
      await client.query("UPDATE workflows SET status=$2,updated_at=$3 WHERE workflow_id=$1", [
        reportId,
        status,
        now,
      ]);
      if (result !== "ACCEPTED") {
        await client.query(
          `INSERT INTO operational_holds
          (hold_id,source_workflow_id,scope,reason_code,status,created_at,updated_at)
          VALUES ($1,$2,'NEW_ORDERS','REPORT_EVIDENCE_MISSING','WORK_HALTED',$3,$3)`,
          [randomUUID(), reportId, now],
        );
      }
    } else if (message.eventType === "HOLD_RELEASE_DECISION_REQUESTED") {
      if (actorRole !== "COMPLIANCE_AUDITOR")
        throw new Error("독립 준법·감사 승인만 중지를 해제할 수 있다.");
      const holdId = required(payload, "holdId");
      const matched = await client.query(
        `SELECT 1 FROM reconciliation_runs WHERE status='RECONCILIATION_MATCHED' ORDER BY updated_at DESC LIMIT 1`,
      );
      if (!matched.rows.length) throw new Error("전체 재대사 일치 결과가 없다.");
      await client.query(
        `UPDATE operational_holds SET independent_approval=true,status='RELEASE_SCHEDULED',
        release_scheduled_at=$2,updated_at=$3 WHERE hold_id=$1 AND status='WORK_HALTED'`,
        [holdId, new Date(now.getTime() + 60_000), now],
      );
    }
    await client.query(
      "UPDATE workflows SET status=$2,updated_at=$3 WHERE workflow_id=$1 AND workflow_type NOT IN ('DIVIDEND','VOTING','CORPORATE_ACTION','WALLET_REPLACEMENT','REGULATORY_REPORT')",
      [message.workflowId, status, now],
    );
    await client.query("UPDATE outbox_messages SET delivered_at=$2 WHERE outbox_id=$1", [
      message.outboxId,
      now,
    ]);
    await client.query(
      "INSERT INTO audit_records (audit_id,workflow_id,actor_id,actor_role,action,occurred_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [randomUUID(), message.workflowId, actorId, actorRole, message.eventType, now],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query(
      "UPDATE workflows SET status='QUARANTINED',updated_at=$2 WHERE workflow_id=$1",
      [message.workflowId, now],
    );
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseMaturedHolds(pool: Pool, now: Date) {
  await pool.query(
    `UPDATE operational_holds SET status='WORK_RESUMED',released_at=$1,updated_at=$1
    WHERE status='RELEASE_SCHEDULED' AND release_scheduled_at <= $1`,
    [now],
  );
}

export function rightsCommandHash(payload: object) {
  return commandHash(payload);
}
