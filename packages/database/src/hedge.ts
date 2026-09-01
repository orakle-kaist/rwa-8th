import { createHash, randomUUID } from "node:crypto";

import {
  LOCAL_SECONDARY_SECURITY_ID,
  MARKET_MAKER_HEDGE_LIMIT_KRW,
  MARKET_MAKER_POSITION_LIMIT,
  assertHedgeCanProceed,
  hedgePriority,
  nextHedgeTradingDate,
  reserveAmountForOrder,
  unhedgedQuantity,
  type HedgeDirection,
} from "@rwa/domain";
import type { Pool, PoolClient } from "pg";

import { commandHash, type ProjectionMetadata } from "./protection.js";
import { MARKET_MAKER_PRINCIPAL_ID } from "./seed-secondary.js";

const terminal = new Set(["HEDGE_INVENTORY_ADJUSTED"]);

function projection(now: Date): ProjectionMetadata {
  return { projectionAsOf: now.toISOString(), lastEventSequence: 0, projectionStatus: "CURRENT" };
}

function evidence(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function dateOnly(value: unknown): string {
  return value instanceof Date
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(value)
    : String(value).slice(0, 10);
}

async function recordHistory(
  client: PoolClient,
  hedgeId: string,
  previous: string | null,
  next: string,
  actorId: string,
  actorRole: string,
  now: Date,
  input: { evidenceHash?: string; reason?: string } = {},
) {
  await client.query(
    `INSERT INTO market_maker_hedge_history
      (history_id,hedge_id,previous_state,new_state,actor_id,actor_role,evidence_hash,reason,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      hedgeId,
      previous,
      next,
      actorId,
      actorRole,
      input.evidenceHash ?? null,
      input.reason ?? null,
      now,
    ],
  );
}

async function setWorkflowState(client: PoolClient, hedgeId: string, state: string, now: Date) {
  await client.query("UPDATE workflows SET status=$2,updated_at=$3 WHERE workflow_id=$1", [
    hedgeId,
    state,
    now,
  ]);
}

/** Called inside the same transaction that finalizes a 24/7 rights-ledger transfer. */
export async function createOrNetHedgeForSecondaryTrade(
  client: PoolClient,
  input: {
    secondaryOrderId: string;
    securityId: string;
    signedPositionDelta: bigint;
    completedAt: Date;
  },
): Promise<string | undefined> {
  const alreadyLinked = await client.query<{ hedge_id: string }>(
    "SELECT hedge_id FROM market_maker_hedge_sources WHERE secondary_order_id=$1",
    [input.secondaryOrderId],
  );
  if (alreadyLinked.rows[0]) return alreadyLinked.rows[0].hedge_id;

  const position = await client.query<{
    net_position: string;
    foreign_limit_status: "ALLOWED" | "BLOCKED" | "UNKNOWN";
    krx_status: "OPEN" | "CLOSED" | "HALTED";
  }>(
    `SELECT position.net_position::text,state.foreign_limit_status,state.krx_status
     FROM market_maker_positions position JOIN secondary_market_state state USING (security_id)
     WHERE position.principal_id=$1 AND position.security_id=$2 FOR UPDATE OF position,state`,
    [MARKET_MAKER_PRINCIPAL_ID, input.securityId],
  );
  const row = position.rows[0];
  if (!row) throw new Error("시장조성자 포지션이 없다.");
  const targetTradingDate = nextHedgeTradingDate(input.completedAt);
  const committed = await client.query<{ direction: HedgeDirection; quantity: string }>(
    `SELECT direction,sum(remaining_quantity)::text quantity FROM market_maker_hedges
     WHERE principal_id=$1 AND security_id=$2 AND status NOT IN ('HEDGE_CREATED','HEDGE_INVENTORY_ADJUSTED')
     GROUP BY direction`,
    [MARKET_MAKER_PRINCIPAL_ID, input.securityId],
  );
  const committedBuy = BigInt(
    committed.rows.find((item) => item.direction === "BUY")?.quantity ?? 0,
  );
  const committedSell = BigInt(
    committed.rows.find((item) => item.direction === "SELL")?.quantity ?? 0,
  );
  const needed = unhedgedQuantity({
    netPosition: BigInt(row.net_position),
    committedBuyQuantity: committedBuy,
    committedSellQuantity: committedSell,
  });
  const open = await client.query<{ hedge_id: string; status: string }>(
    `SELECT hedge_id,status FROM market_maker_hedges
     WHERE principal_id=$1 AND security_id=$2 AND target_trading_date=$3 AND status='HEDGE_CREATED'
     ORDER BY created_at LIMIT 1 FOR UPDATE`,
    [MARKET_MAKER_PRINCIPAL_ID, input.securityId, targetTradingDate],
  );
  let hedgeId = open.rows[0]?.hedge_id;
  if (!hedgeId) {
    hedgeId = randomUUID();
    await client.query(
      `INSERT INTO workflows
        (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
       VALUES ($1,'MARKET_MAKER_HEDGE',$2,$3,$4,$5::jsonb,$6,$6)`,
      [
        hedgeId,
        needed.direction ? "HEDGE_CREATED" : "HEDGE_INVENTORY_ADJUSTED",
        MARKET_MAKER_PRINCIPAL_ID,
        randomUUID(),
        JSON.stringify({ sourceSecondaryOrderId: input.secondaryOrderId, simulation: true }),
        input.completedAt,
      ],
    );
    const positionAbsolute =
      BigInt(row.net_position) < 0n ? -BigInt(row.net_position) : BigInt(row.net_position);
    const priority = hedgePriority({
      riskViolationReducing: positionAbsolute > MARKET_MAKER_POSITION_LIMIT,
      positionAbsolute,
      positionLimit: MARKET_MAKER_POSITION_LIMIT,
      createdAt: input.completedAt,
      securityId: input.securityId,
    });
    await client.query(
      `INSERT INTO market_maker_hedges
        (hedge_id,principal_id,security_id,direction,requested_quantity,remaining_quantity,
         net_position_snapshot,krw_limit_price,target_trading_date,status,risk_violation_reducing,
         position_utilization_bps,foreign_limit_status,krx_status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [
        hedgeId,
        MARKET_MAKER_PRINCIPAL_ID,
        input.securityId,
        needed.direction ?? "BUY",
        needed.quantity.toString(),
        row.net_position,
        MARKET_MAKER_HEDGE_LIMIT_KRW.toString(),
        targetTradingDate,
        needed.direction ? "HEDGE_CREATED" : "HEDGE_INVENTORY_ADJUSTED",
        priority.riskRank === 0,
        priority.utilizationBps,
        row.foreign_limit_status,
        row.krx_status,
        input.completedAt,
      ],
    );
    await recordHistory(
      client,
      hedgeId,
      null,
      needed.direction ? "HEDGE_CREATED" : "HEDGE_INVENTORY_ADJUSTED",
      "secondary-worker",
      "PLATFORM_OPERATOR",
      input.completedAt,
      { reason: needed.direction ? "24시간 체결에 따른 헤지 생성" : "반대 방향 체결로 노출 상계" },
    );
  } else {
    const nextState = needed.direction ? "HEDGE_CREATED" : "HEDGE_INVENTORY_ADJUSTED";
    await client.query(
      `UPDATE market_maker_hedges SET direction=$2,requested_quantity=$3,remaining_quantity=$3,
         net_position_snapshot=$4,status=$5,foreign_limit_status=$6,krx_status=$7,
         aggregate_version=aggregate_version+1,updated_at=$8 WHERE hedge_id=$1`,
      [
        hedgeId,
        needed.direction ?? "BUY",
        needed.quantity.toString(),
        row.net_position,
        nextState,
        row.foreign_limit_status,
        row.krx_status,
        input.completedAt,
      ],
    );
    await setWorkflowState(client, hedgeId, nextState, input.completedAt);
    await recordHistory(
      client,
      hedgeId,
      "HEDGE_CREATED",
      nextState,
      "secondary-worker",
      "PLATFORM_OPERATOR",
      input.completedAt,
      { reason: "승인 전 반대 방향 체결을 순포지션 기준으로 상계" },
    );
  }
  await client.query(
    `INSERT INTO market_maker_hedge_sources
      (hedge_id,secondary_order_id,signed_position_delta,linked_at) VALUES ($1,$2,$3,$4)`,
    [hedgeId, input.secondaryOrderId, input.signedPositionDelta.toString(), input.completedAt],
  );
  return hedgeId;
}

type HedgeHistoryProjection = {
  state: string;
  actorRole: string;
  occurredAt: string;
  evidenceHash?: string;
  reasonKo?: string;
};

function mapHedge(
  row: Record<string, unknown>,
  sourceOrderIds: string[],
  history: HedgeHistoryProjection[],
  now: Date,
) {
  return {
    hedgeId: row.hedge_id,
    securityId: row.security_id,
    direction: row.direction,
    requestedQuantity: String(row.requested_quantity),
    filledQuantity: String(row.filled_quantity),
    remainingQuantity: String(row.remaining_quantity),
    netPositionSnapshot: String(row.net_position_snapshot),
    krwLimitPrice: String(row.krw_limit_price),
    targetTradingDate: dateOnly(row.target_trading_date),
    status: row.status,
    aggregateVersion: Number(row.aggregate_version),
    riskViolationReducing: Boolean(row.risk_violation_reducing),
    positionUtilizationBps: Number(row.position_utilization_bps),
    foreignLimitStatus: row.foreign_limit_status,
    krxStatus: row.krx_status,
    marketMakerConfirmed: Boolean(row.market_maker_confirmed),
    brokerRiskApproved: Boolean(row.broker_risk_approved),
    domesticSettlementConfirmed: Boolean(row.domestic_settlement_confirmed),
    custodyQuantityConfirmed: Boolean(row.custody_quantity_confirmed),
    usdPaymentConfirmed: Boolean(row.usd_payment_confirmed),
    sourceSecondaryOrderIds: sourceOrderIds,
    history,
    ...(row.domestic_order_reference
      ? { domesticOrderReference: row.domestic_order_reference }
      : {}),
    ...(row.hold_reason ? { holdReasonKo: row.hold_reason } : {}),
    ...(row.token_transaction_hash ? { tokenTransactionHash: row.token_transaction_hash } : {}),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
    simulation: true,
    projection: projection(now),
  };
}

export async function listMarketMakerHedges(pool: Pool, now: Date) {
  const hedges = await pool.query<Record<string, unknown>>(
    `SELECT * FROM market_maker_hedges ORDER BY risk_violation_reducing DESC,
       position_utilization_bps DESC,created_at,security_id`,
  );
  const sources = await pool.query<{ hedge_id: string; secondary_order_id: string }>(
    "SELECT hedge_id,secondary_order_id FROM market_maker_hedge_sources ORDER BY linked_at",
  );
  const history = await pool.query<{
    hedge_id: string;
    new_state: string;
    actor_role: string;
    occurred_at: Date;
    evidence_hash: string | null;
    reason: string | null;
  }>(
    `SELECT hedge_id,new_state,actor_role,occurred_at,evidence_hash,reason
     FROM market_maker_hedge_history ORDER BY occurred_at,history_id`,
  );
  return {
    items: hedges.rows.map((row) =>
      mapHedge(
        row,
        sources.rows
          .filter((item) => item.hedge_id === row.hedge_id)
          .map((item) => item.secondary_order_id),
        history.rows
          .filter((item) => item.hedge_id === row.hedge_id)
          .map((item) => ({
            state: item.new_state,
            actorRole: item.actor_role,
            occurredAt: item.occurred_at.toISOString(),
            ...(item.evidence_hash ? { evidenceHash: item.evidence_hash } : {}),
            ...(item.reason ? { reasonKo: item.reason } : {}),
          })),
        now,
      ),
    ),
    projection: projection(now),
  };
}

export async function getMarketMakerHedge(pool: Pool, hedgeId: string, now: Date) {
  const result = await pool.query<Record<string, unknown>>(
    "SELECT * FROM market_maker_hedges WHERE hedge_id=$1",
    [hedgeId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const sources = await pool.query<{ secondary_order_id: string }>(
    "SELECT secondary_order_id FROM market_maker_hedge_sources WHERE hedge_id=$1 ORDER BY linked_at",
    [hedgeId],
  );
  const history = await pool.query<{
    new_state: string;
    actor_role: string;
    occurred_at: Date;
    evidence_hash: string | null;
    reason: string | null;
  }>(
    `SELECT new_state,actor_role,occurred_at,evidence_hash,reason
     FROM market_maker_hedge_history WHERE hedge_id=$1 ORDER BY occurred_at,history_id`,
    [hedgeId],
  );
  return mapHedge(
    row,
    sources.rows.map((item) => item.secondary_order_id),
    history.rows.map((item) => ({
      state: item.new_state,
      actorRole: item.actor_role,
      occurredAt: item.occurred_at.toISOString(),
      ...(item.evidence_hash ? { evidenceHash: item.evidence_hash } : {}),
      ...(item.reason ? { reasonKo: item.reason } : {}),
    })),
    now,
  );
}

export async function decideMarketMakerHedge(
  pool: Pool,
  input: {
    hedgeId: string;
    principalId: string;
    actorRole: string;
    decision: "APPROVE" | "REJECT" | "REQUEST_CORRECTION";
    reasonKo: string;
    expectedAggregateVersion: number;
    signedIntent?: unknown;
    idempotencyKey: string;
    correlationId: string;
    now: Date;
  },
) {
  const requestHash = commandHash({
    hedgeId: input.hedgeId,
    decision: input.decision,
    reasonKo: input.reasonKo,
    expectedAggregateVersion: input.expectedAggregateVersion,
    signedIntent: input.signedIntent,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query<{ request_hash: string; workflow_id: string }>(
      "SELECT request_hash,workflow_id FROM idempotency_records WHERE principal_id=$1 AND idempotency_key=$2",
      [input.principalId, input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      await client.query("ROLLBACK");
      return duplicate.rows[0].request_hash === requestHash
        ? { workflowId: duplicate.rows[0].workflow_id, repeated: true as const }
        : { conflict: true as const };
    }
    const result = await client.query<Record<string, unknown>>(
      `SELECT hedge.*,state.information_effective_at FROM market_maker_hedges hedge
       JOIN secondary_market_state state USING (security_id) WHERE hedge.hedge_id=$1 FOR UPDATE OF hedge,state`,
      [input.hedgeId],
    );
    const hedge = result.rows[0];
    if (!hedge) throw new Error("헤지 업무가 없다.");
    if (Number(hedge.aggregate_version) !== input.expectedAggregateVersion)
      throw new Error("헤지 집계 버전이 오래됐다.");
    const previous = String(hedge.status);
    let next: string;
    let holdReason: string | null = null;
    if (input.decision !== "APPROVE") {
      next = "HEDGE_ON_HOLD";
      holdReason = input.reasonKo;
    } else if (input.actorRole === "MARKET_MAKER" && previous === "HEDGE_CREATED") {
      if (!input.signedIntent) throw new Error("시장조성자 헤지 주문 서명이 필요하다.");
      if (hedge.direction === "SELL") {
        const locked = await client.query(
          `UPDATE customer_rights_positions SET hedge_locked_quantity=hedge_locked_quantity+$3,
             updated_at=$4 WHERE principal_id=$1 AND security_id=$2
             AND settled_quantity-secondary_reserved_quantity-hedge_locked_quantity >= $3`,
          [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, hedge.requested_quantity, input.now],
        );
        if (locked.rowCount !== 1) throw new Error("매도 헤지에 잠글 결제완료 권리가 부족하다.");
      }
      next = "HEDGE_RISK_REVIEW";
      await client.query(
        `UPDATE market_maker_hedges SET market_maker_confirmed=true,signed_intent=$2::jsonb,
           market_maker_evidence_hash=$3 WHERE hedge_id=$1`,
        [
          input.hedgeId,
          JSON.stringify(input.signedIntent),
          evidence(`${input.hedgeId}:MM_CONFIRM`),
        ],
      );
    } else if (input.actorRole === "OVERSEAS_BROKER_OPERATOR" && previous === "HEDGE_RISK_REVIEW") {
      try {
        assertHedgeCanProceed({
          direction: hedge.direction as HedgeDirection,
          foreignLimitStatus: hedge.foreign_limit_status as "ALLOWED" | "BLOCKED" | "UNKNOWN",
          krxStatus: hedge.krx_status as "OPEN" | "CLOSED" | "HALTED",
          riskInformationFresh:
            input.now.getTime() - (hedge.information_effective_at as Date).getTime() <= 60_000,
        });
        next = "HEDGE_KRX_OPEN_PENDING";
        await client.query(
          `UPDATE market_maker_hedges SET broker_risk_approved=true,risk_evidence_hash=$2 WHERE hedge_id=$1`,
          [input.hedgeId, evidence(`${input.hedgeId}:RISK_APPROVAL`)],
        );
      } catch (error) {
        next = "HEDGE_ON_HOLD";
        holdReason = error instanceof Error ? error.message : "헤지 위험검토 실패";
        const blockedDirection = hedge.direction === "BUY" ? "SELL" : "BUY";
        await client.query(
          `UPDATE market_maker_positions SET risk_reducing_only=true,quote_direction_blocked=$3,
             hedge_hold_reason=$4,updated_at=$5 WHERE principal_id=$1 AND security_id=$2`,
          [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, blockedDirection, holdReason, input.now],
        );
      }
    } else throw new Error("역할과 현재 헤지 단계가 일치하지 않는다.");

    await client.query(
      `UPDATE market_maker_hedges SET status=$2,hold_reason=$3,aggregate_version=aggregate_version+1,
         updated_at=$4 WHERE hedge_id=$1`,
      [input.hedgeId, next, holdReason, input.now],
    );
    await setWorkflowState(client, input.hedgeId, next, input.now);
    await recordHistory(
      client,
      input.hedgeId,
      previous,
      next,
      input.principalId,
      input.actorRole,
      input.now,
      {
        reason: holdReason ?? input.reasonKo,
      },
    );
    await client.query(
      `INSERT INTO idempotency_records
        (principal_id,idempotency_key,request_hash,workflow_id,created_at) VALUES ($1,$2,$3,$4,$5)`,
      [input.principalId, input.idempotencyKey, requestHash, input.hedgeId, input.now],
    );
    await client.query("COMMIT");
    return { workflowId: input.hedgeId, repeated: false as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function isHedgeAdapterEvent(eventType: string): boolean {
  return eventType.startsWith("market-maker.hedge.");
}

export async function acceptHedgeAdapterEvent(
  pool: Pool,
  input: {
    sourceInstitutionId: string;
    eventId: string;
    sourceSequence: number;
    eventType: string;
    data: Record<string, unknown>;
    payloadHash: string;
    now: Date;
  },
) {
  if (!isHedgeAdapterEvent(input.eventType) || typeof input.data.hedgeId !== "string")
    throw new Error("지원하지 않는 헤지 기관 결과다.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query<{ payload_hash: string }>(
      "SELECT payload_hash FROM inbox_messages WHERE source_id=$1 AND event_id=$2",
      [input.sourceInstitutionId, input.eventId],
    );
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].payload_hash !== input.payloadHash)
        throw new Error("같은 기관 이벤트 ID의 내용이 다르다.");
      await client.query("COMMIT");
      return { repeated: true, workflowId: String(input.data.hedgeId) };
    }
    const last = await client.query<{ sequence: string }>(
      "SELECT COALESCE(max(source_sequence),0)::text sequence FROM inbox_messages WHERE source_id=$1",
      [input.sourceInstitutionId],
    );
    if (input.sourceSequence !== Number(last.rows[0]?.sequence ?? 0) + 1)
      throw new Error("기관 이벤트 순번 공백이 있다.");
    await client.query(
      `INSERT INTO inbox_messages
        (source_id,event_id,source_sequence,payload_hash,received_at,processed_at)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [
        input.sourceInstitutionId,
        input.eventId,
        input.sourceSequence,
        input.payloadHash,
        input.now,
      ],
    );
    await client.query(
      `INSERT INTO outbox_messages (outbox_id,workflow_id,event_type,payload,occurred_at,available_at)
       VALUES ($1,$2,'HEDGE_ADAPTER_EVENT_RECEIVED',$3::jsonb,$4,$4)`,
      [
        randomUUID(),
        input.data.hedgeId,
        JSON.stringify({
          eventType: input.eventType,
          data: input.data,
          sourceInstitutionId: input.sourceInstitutionId,
        }),
        input.now,
      ],
    );
    await client.query("COMMIT");
    return { repeated: false, workflowId: String(input.data.hedgeId) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processHedgeOutbox(
  pool: Pool,
  message: { outboxId: string; workflowId: string; eventType: string; payload: unknown },
  now: Date,
): Promise<boolean> {
  if (message.eventType !== "HEDGE_ADAPTER_EVENT_RECEIVED") return false;
  const payload = message.payload as {
    eventType: string;
    data: Record<string, unknown>;
    sourceInstitutionId: string;
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Record<string, unknown>>(
      "SELECT * FROM market_maker_hedges WHERE hedge_id=$1 FOR UPDATE",
      [message.workflowId],
    );
    const hedge = result.rows[0];
    if (!hedge) throw new Error("헤지 업무가 없다.");
    const previous = String(hedge.status);
    if (payload.eventType === "market-maker.hedge.execution-confirmed.v1") {
      if (previous !== "HEDGE_KRX_OPEN_PENDING") throw new Error("국내 제출 대기 헤지가 아니다.");
      if (String(payload.data.tradingDate) !== dateOnly(hedge.target_trading_date))
        throw new Error("서명된 모의 거래일이 예정 개장일과 다르다.");
      const filled = BigInt(String(payload.data.filledQuantity));
      const requested = BigInt(String(hedge.requested_quantity));
      if (filled <= 0n || filled > requested) throw new Error("헤지 체결수량이 올바르지 않다.");
      const fillState = filled === requested ? "HEDGE_FULLY_FILLED" : "HEDGE_PARTIALLY_FILLED";
      await recordHistory(
        client,
        message.workflowId,
        previous,
        "HEDGE_SUBMITTED_DOMESTICALLY",
        payload.sourceInstitutionId,
        "DOMESTIC_EXECUTION_BROKER",
        now,
      );
      await recordHistory(
        client,
        message.workflowId,
        "HEDGE_SUBMITTED_DOMESTICALLY",
        fillState,
        payload.sourceInstitutionId,
        "DOMESTIC_EXECUTION_BROKER",
        now,
      );
      await recordHistory(
        client,
        message.workflowId,
        fillState,
        "HEDGE_T2_PENDING",
        payload.sourceInstitutionId,
        "DOMESTIC_EXECUTION_BROKER",
        now,
      );
      await client.query(
        `UPDATE market_maker_hedges SET filled_quantity=$2,remaining_quantity=requested_quantity-$2,
           status='HEDGE_T2_PENDING',domestic_order_reference=$3,execution_evidence_hash=$4,
           aggregate_version=aggregate_version+1,updated_at=$5 WHERE hedge_id=$1`,
        [
          message.workflowId,
          filled.toString(),
          String(
            payload.data.domesticOrderReference ?? `SIM-KRX-${message.workflowId.slice(0, 8)}`,
          ),
          evidence(`${message.workflowId}:EXECUTION:${filled}`),
          now,
        ],
      );
      if (hedge.direction === "BUY") {
        await client.query(
          `UPDATE customer_rights_positions SET pending_quantity=pending_quantity+$3,updated_at=$4
           WHERE principal_id=$1 AND security_id=$2`,
          [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, filled.toString(), now],
        );
        await client.query(
          `UPDATE market_maker_positions SET pending_quantity=pending_quantity+$3,updated_at=$4
           WHERE principal_id=$1 AND security_id=$2`,
          [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, filled.toString(), now],
        );
      } else if (filled < requested) {
        // Only the executed part stays locked; the unfilled remainder returns to available rights.
        await client.query(
          `UPDATE customer_rights_positions SET hedge_locked_quantity=hedge_locked_quantity-$3,updated_at=$4
           WHERE principal_id=$1 AND security_id=$2`,
          [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, (requested - filled).toString(), now],
        );
      }
      await setWorkflowState(client, message.workflowId, "HEDGE_T2_PENDING", now);
    } else if (payload.eventType === "market-maker.hedge.domestic-settlement-confirmed.v1") {
      if (previous !== "HEDGE_T2_PENDING") throw new Error("T+2 대기 헤지가 아니다.");
      await client.query(
        "UPDATE market_maker_hedges SET domestic_settlement_confirmed=true,updated_at=$2 WHERE hedge_id=$1",
        [message.workflowId, now],
      );
      if (hedge.direction === "SELL") {
        const quantity = BigInt(String(hedge.filled_quantity));
        const claim = reserveAmountForOrder(quantity, BigInt(String(hedge.krw_limit_price)));
        await client.query(
          `UPDATE customer_rights_positions SET settled_quantity=settled_quantity-$3,
             hedge_locked_quantity=hedge_locked_quantity-$3,burn_pending_quantity=burn_pending_quantity+$3,
             updated_at=$4 WHERE principal_id=$1 AND security_id=$2 AND hedge_locked_quantity >= $3`,
          [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, quantity.toString(), now],
        );
        await client.query(
          `UPDATE secondary_market_state SET domestic_total_quantity=domestic_total_quantity-$2,updated_at=$3
           WHERE security_id=$1`,
          [hedge.security_id, quantity.toString(), now],
        );
        await client.query(
          `UPDATE market_maker_hedges SET rights_terminated=true,cash_claim_usd_minor=$2,
             token_transaction_hash=NULL,updated_at=$3 WHERE hedge_id=$1`,
          [
            message.workflowId,
            claim.toString(),
            now,
          ],
        );
      }
    } else if (payload.eventType === "market-maker.hedge.custody-confirmed.v1") {
      if (previous !== "HEDGE_T2_PENDING" || hedge.direction !== "BUY")
        throw new Error("매수 헤지 수탁확인 단계가 아니다.");
      await client.query(
        "UPDATE market_maker_hedges SET custody_quantity_confirmed=true,updated_at=$2 WHERE hedge_id=$1",
        [message.workflowId, now],
      );
    } else if (payload.eventType === "market-maker.hedge.usd-paid.v1") {
      if (previous !== "HEDGE_T2_PENDING" || hedge.direction !== "SELL" || !hedge.rights_terminated)
        throw new Error("USD 지급 가능한 매도 헤지가 아니다.");
      await finalizeSellHedge(client, hedge, now);
    } else throw new Error("지원하지 않는 헤지 기관 결과다.");

    if (payload.eventType !== "market-maker.hedge.usd-paid.v1") {
      const refreshed = await client.query<Record<string, unknown>>(
        "SELECT * FROM market_maker_hedges WHERE hedge_id=$1",
        [message.workflowId],
      );
      const current = refreshed.rows[0]!;
      if (
        current.direction === "BUY" &&
        current.domestic_settlement_confirmed &&
        current.custody_quantity_confirmed
      )
        await finalizeBuyHedge(client, current, now);
    }
    await client.query(
      "UPDATE outbox_messages SET delivered_at=$2,last_error=NULL WHERE outbox_id=$1",
      [message.outboxId, now],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finalizeBuyHedge(client: PoolClient, hedge: Record<string, unknown>, now: Date) {
  const quantity = BigInt(String(hedge.filled_quantity));
  const remaining = BigInt(String(hedge.remaining_quantity));
  await client.query(
    `UPDATE customer_rights_positions SET pending_quantity=pending_quantity-$3,
       settled_quantity=settled_quantity+$3,updated_at=$4
     WHERE principal_id=$1 AND security_id=$2 AND pending_quantity >= $3`,
    [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, quantity.toString(), now],
  );
  await client.query(
    `UPDATE market_maker_positions SET pending_quantity=pending_quantity-$3,net_position=net_position+$3,
       next_session_starting_quantity=(SELECT settled_quantity FROM customer_rights_positions
         WHERE principal_id=$1 AND security_id=$2),risk_reducing_only=$4,
       quote_direction_blocked=$5,hedge_hold_reason=$6,updated_at=$7
     WHERE principal_id=$1 AND security_id=$2`,
    [
      MARKET_MAKER_PRINCIPAL_ID,
      hedge.security_id,
      quantity.toString(),
      remaining > 0n,
      remaining > 0n ? "SELL" : null,
      remaining > 0n ? "국내 주문의 미체결 잔량을 다음 개장 대기열에서 재검토한다." : null,
      now,
    ],
  );
  await client.query(
    `UPDATE secondary_market_state SET domestic_total_quantity=domestic_total_quantity+$2,
       token_total_supply=token_total_supply+$2,updated_at=$3 WHERE security_id=$1`,
    [hedge.security_id, quantity.toString(), now],
  );
  await completeHedge(client, hedge, now, evidence(`${hedge.hedge_id}:BUY_RELEASE`));
}

async function finalizeSellHedge(client: PoolClient, hedge: Record<string, unknown>, now: Date) {
  const quantity = BigInt(String(hedge.filled_quantity));
  const claim = BigInt(String(hedge.cash_claim_usd_minor));
  const remaining = BigInt(String(hedge.remaining_quantity));
  await client.query(
    `UPDATE customer_rights_positions SET burn_pending_quantity=burn_pending_quantity-$3,updated_at=$4
     WHERE principal_id=$1 AND security_id=$2 AND burn_pending_quantity >= $3`,
    [MARKET_MAKER_PRINCIPAL_ID, hedge.security_id, quantity.toString(), now],
  );
  await client.query(
    `UPDATE customer_cash_accounts SET usd_available_minor=usd_available_minor+$2,updated_at=$3
     WHERE principal_id=$1`,
    [MARKET_MAKER_PRINCIPAL_ID, claim.toString(), now],
  );
  await client.query(
    `UPDATE market_maker_positions SET net_position=net_position-$3,
       next_session_starting_quantity=(SELECT settled_quantity FROM customer_rights_positions
         WHERE principal_id=$1 AND security_id=$2),risk_reducing_only=$4,
       quote_direction_blocked=$5,hedge_hold_reason=$6,updated_at=$7
     WHERE principal_id=$1 AND security_id=$2`,
    [
      MARKET_MAKER_PRINCIPAL_ID,
      hedge.security_id,
      quantity.toString(),
      remaining > 0n,
      remaining > 0n ? "BUY" : null,
      remaining > 0n ? "국내 주문의 미체결 잔량을 다음 개장 대기열에서 재검토한다." : null,
      now,
    ],
  );
  await client.query(
    `UPDATE secondary_market_state SET token_total_supply=token_total_supply-$2,updated_at=$3
     WHERE security_id=$1`,
    [hedge.security_id, quantity.toString(), now],
  );
  await client.query(
    "UPDATE market_maker_hedges SET usd_payment_confirmed=true WHERE hedge_id=$1",
    [hedge.hedge_id],
  );
  await completeHedge(client, hedge, now, evidence(`${hedge.hedge_id}:SELL_BURN`));
}

async function completeHedge(
  client: PoolClient,
  hedge: Record<string, unknown>,
  now: Date,
  transactionHash: string,
) {
  const remaining = BigInt(String(hedge.remaining_quantity));
  const next = remaining > 0n ? "HEDGE_ON_HOLD" : "HEDGE_INVENTORY_ADJUSTED";
  const reason =
    remaining > 0n
      ? "체결분의 T+2 재고조정은 완료됐고 미체결 잔량은 같은 헤지에서 보류한다."
      : null;
  await client.query(
    `UPDATE market_maker_hedges SET status=$2,token_transaction_hash=$3,hold_reason=$4,
       aggregate_version=aggregate_version+1,updated_at=$5 WHERE hedge_id=$1`,
    [hedge.hedge_id, next, transactionHash, reason, now],
  );
  await setWorkflowState(client, String(hedge.hedge_id), next, now);
  await recordHistory(
    client,
    String(hedge.hedge_id),
    "HEDGE_T2_PENDING",
    next,
    "hedge-worker",
    "PLATFORM_OPERATOR",
    now,
    { evidenceHash: transactionHash, ...(reason ? { reason } : {}) },
  );
}

export async function hedgeTotals(pool: Pool) {
  const result = await pool.query<Record<string, string>>(
    `SELECT position.net_position::text,position.next_session_starting_quantity::text,
       rights.settled_quantity::text,rights.pending_quantity::text,rights.hedge_locked_quantity::text,
       rights.burn_pending_quantity::text,state.domestic_total_quantity::text,state.token_total_supply::text
     FROM market_maker_positions position
     JOIN customer_rights_positions rights USING (principal_id,security_id)
     JOIN secondary_market_state state USING (security_id)
     WHERE position.principal_id=$1 AND position.security_id=$2`,
    [MARKET_MAKER_PRINCIPAL_ID, LOCAL_SECONDARY_SECURITY_ID],
  );
  return result.rows[0];
}

export function hedgeIsTerminal(status: string): boolean {
  return terminal.has(status);
}
