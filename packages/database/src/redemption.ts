import { createHash, randomUUID } from "node:crypto";

import {
  LOCAL_REDEMPTION_LIMIT_KRW,
  LOCAL_REDEMPTION_POLICY,
  LOCAL_REDEMPTION_SECURITY_ID,
  LOCAL_REDEMPTION_TOKEN_ADDRESS,
  LOCAL_REDEMPTION_TOTAL_USD_MINOR,
  allocateRedemptionFill,
  allocateUsdClaims,
  availableForRedemption,
  effectiveRedemptionTradingDate,
} from "@rwa/domain";
import type { Pool, PoolClient } from "pg";

import { commandHash, getCustomerReadiness, type ProjectionMetadata } from "./protection.js";
import {
  initializeWorkflowState,
  transitionCurrentWorkflowState,
  transitionWorkflowState,
} from "./runtime-state.js";
import { getLocalChainMetadata } from "./chain-execution.js";

const decisionRoles = new Set([
  "EXECUTION_ALLOCATION_CONFIRMER",
  "DOMESTIC_SETTLEMENT_CONFIRMER",
  "RIGHTS_RECORDING_CONFIRMER",
  "OVERSEAS_BROKER_OPERATOR",
]);

function projection(now: Date): ProjectionMetadata {
  return { projectionAsOf: now.toISOString(), lastEventSequence: 0, projectionStatus: "CURRENT" };
}

function evidence(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

async function recordHistory(
  client: PoolClient,
  redemptionId: string,
  previous: string | null,
  next: string,
  actorId: string,
  actorRole: string,
  now: Date,
  input: { evidenceHash?: string; reason?: string } = {},
) {
  await client.query(
    `INSERT INTO redemption_state_history
      (history_id,redemption_id,previous_state,new_state,actor_id,actor_role,evidence_hash,reason,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      redemptionId,
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

export async function getLocalRedemptionScenario(pool: Pool, principalId: string, now: Date) {
  const chain = await getLocalChainMetadata(pool);
  const result = await pool.query<Record<string, unknown>>(
    `SELECT instrument.security_id,instrument.display_name,instrument.redemption_enabled,instrument.token_address,
       COALESCE(rights.settled_quantity,0)::text settled_quantity,
       COALESCE(rights.secondary_reserved_quantity,0)::text secondary_reserved_quantity,
       COALESCE(rights.hedge_locked_quantity,0)::text hedge_locked_quantity,
       COALESCE(rights.redemption_locked_quantity,0)::text redemption_locked_quantity,
       COALESCE(rights.burn_pending_quantity,0)::text burn_pending_quantity,
       COALESCE(totals.domestic_settled_quantity,0)::text domestic_settled_quantity,
       COALESCE(totals.token_total_supply,0)::text token_total_supply
     FROM local_simulation_instruments instrument
     LEFT JOIN customer_rights_positions rights ON rights.security_id=instrument.security_id AND rights.principal_id=$2
     LEFT JOIN instrument_control_totals totals ON totals.security_id=instrument.security_id
     WHERE instrument.security_id=$1`,
    [LOCAL_REDEMPTION_SECURITY_ID, principalId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const quantities = {
    settled: BigInt(String(row.settled_quantity)),
    secondaryReserved: BigInt(String(row.secondary_reserved_quantity)),
    hedgeLocked: BigInt(String(row.hedge_locked_quantity)),
    redemptionLocked: BigInt(String(row.redemption_locked_quantity)),
    burnPending: BigInt(String(row.burn_pending_quantity)),
  };
  return {
    securityId: LOCAL_REDEMPTION_SECURITY_ID,
    displayName: row.display_name,
    tokenAddress: row.token_address
      ? chain.tokens[LOCAL_REDEMPTION_SECURITY_ID] ?? String(row.token_address)
      : LOCAL_REDEMPTION_TOKEN_ADDRESS,
    referenceLimitKrw: LOCAL_REDEMPTION_LIMIT_KRW.toString(),
    redemptionEnabled: Boolean(row.redemption_enabled),
    settledQuantity: quantities.settled.toString(),
    availableQuantity: availableForRedemption(quantities).toString(),
    redemptionLockedQuantity: quantities.redemptionLocked.toString(),
    burnPendingQuantity: quantities.burnPending.toString(),
    domesticSettledQuantity: String(row.domestic_settled_quantity),
    tokenTotalSupply: String(row.token_total_supply),
    policyVersion: chain.policyVersion,
    simulation: true,
    notices: [
      "기존 로컬 1차 발행의 T+2 완료 권리만 환매할 수 있다.",
      "환매대금은 모의 해외 증권사 USD 고객계좌로만 지급한다.",
      "가격·세금·수수료는 실제 시장조건이 아니며 합성 수수료는 0이다.",
    ],
    intentDomain: {
      name: "Korean Equity RWA Intent",
      version: "1",
      chainId: 31337,
      verifyingContract: row.token_address
        ? chain.verifyingContract
        : "0x0000000000000000000000000000000000000990",
    },
    projection: projection(now),
  };
}

export async function acceptRedemption(
  pool: Pool,
  input: {
    principalId: string;
    role: string;
    wallet: string;
    idempotencyKey: string;
    correlationId: string;
    redemptionId: string;
    securityId: string;
    shareQuantity: bigint;
    krwLimitPrice: bigint;
    requestedTradingDate: string;
    signedIntent: unknown;
    now: Date;
  },
) {
  const payload = {
    securityId: input.securityId,
    shareQuantity: input.shareQuantity.toString(),
    krwLimitPrice: input.krwLimitPrice.toString(),
    requestedTradingDate: input.requestedTradingDate,
    signedIntent: input.signedIntent,
  };
  const hash = commandHash(payload);
  const readiness = await getCustomerReadiness(pool, input.principalId, input.now);
  if (
    !readiness?.canPlaceNewOrder ||
    readiness.activeWallet?.toLowerCase() !== input.wallet.toLowerCase()
  )
    return { rejected: "CUSTOMER_NOT_READY" as const };
  if (
    input.securityId !== LOCAL_REDEMPTION_SECURITY_ID ||
    input.krwLimitPrice !== LOCAL_REDEMPTION_LIMIT_KRW
  )
    return { rejected: "REDEMPTION_PRODUCT_OR_PRICE_INVALID" as const };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query<{ request_hash: string; workflow_id: string }>(
      "SELECT request_hash,workflow_id FROM idempotency_records WHERE principal_id=$1 AND idempotency_key=$2",
      [input.principalId, input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      await client.query("COMMIT");
      return duplicate.rows[0].request_hash === hash
        ? { workflowId: duplicate.rows[0].workflow_id, repeated: true as const }
        : { conflict: true as const };
    }
    const rights = await client.query<{
      settled_quantity: string;
      secondary_reserved_quantity: string;
      hedge_locked_quantity: string;
      redemption_locked_quantity: string;
      burn_pending_quantity: string;
    }>(
      `SELECT settled_quantity::text,secondary_reserved_quantity::text,hedge_locked_quantity::text,
       redemption_locked_quantity::text,burn_pending_quantity::text
       FROM customer_rights_positions WHERE principal_id=$1 AND security_id=$2 FOR UPDATE`,
      [input.principalId, input.securityId],
    );
    if (!rights.rows[0]) throw new Error("환매할 결제완료 권리가 없다.");
    const available = availableForRedemption({
      settled: BigInt(rights.rows[0].settled_quantity),
      secondaryReserved: BigInt(rights.rows[0].secondary_reserved_quantity),
      hedgeLocked: BigInt(rights.rows[0].hedge_locked_quantity),
      redemptionLocked: BigInt(rights.rows[0].redemption_locked_quantity),
      burnPending: BigInt(rights.rows[0].burn_pending_quantity),
    });
    if (available < input.shareQuantity) throw new Error("환매 가능한 결제완료 권리가 부족하다.");
    await client.query(
      "UPDATE customer_rights_positions SET redemption_locked_quantity=redemption_locked_quantity+$3,updated_at=$4 WHERE principal_id=$1 AND security_id=$2",
      [input.principalId, input.securityId, input.shareQuantity.toString(), input.now],
    );
    await client.query(
      `INSERT INTO workflows
       (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
       VALUES ($1,'REDEMPTION','REDEMPTION_ACCEPTED',$2,$3,$4::jsonb,$5,$5)`,
      [
        input.redemptionId,
        input.principalId,
        input.correlationId,
        JSON.stringify(payload),
        input.now,
      ],
    );
    await client.query(
      "INSERT INTO idempotency_records (principal_id,idempotency_key,request_hash,workflow_id,created_at) VALUES ($1,$2,$3,$4,$5)",
      [input.principalId, input.idempotencyKey, hash, input.redemptionId, input.now],
    );
    await client.query(
      `INSERT INTO redemption_orders
       (redemption_id,principal_id,wallet_address,security_id,requested_quantity,krw_limit_price,
        requested_trading_date,effective_trading_date,status,accepted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REDEMPTION_ACCEPTED',$9,$9)`,
      [
        input.redemptionId,
        input.principalId,
        input.wallet.toLowerCase(),
        input.securityId,
        input.shareQuantity.toString(),
        input.krwLimitPrice.toString(),
        input.requestedTradingDate,
        effectiveRedemptionTradingDate(input.requestedTradingDate),
        input.now,
      ],
    );
    await initializeWorkflowState(client, {
      workflowId: input.redemptionId,
      axis: "REDEMPTION",
      state: "REDEMPTION_REQUESTED",
      actorId: input.principalId,
      actorRole: input.role,
      now: input.now,
    });
    await transitionWorkflowState(client, {
      workflowId: input.redemptionId,
      axis: "REDEMPTION",
      expectedState: "REDEMPTION_REQUESTED",
      nextState: "RIGHTS_AND_TOKEN_LOCKED",
      actorId: "redemption-orchestrator",
      actorRole: "PLATFORM_OPERATOR",
      now: input.now,
    });
    await transitionWorkflowState(client, {
      workflowId: input.redemptionId,
      axis: "REDEMPTION",
      expectedState: "RIGHTS_AND_TOKEN_LOCKED",
      nextState: "DOMESTIC_SALE_PENDING",
      actorId: "redemption-orchestrator",
      actorRole: "PLATFORM_OPERATOR",
      now: input.now,
    });
    await recordHistory(
      client,
      input.redemptionId,
      null,
      "REDEMPTION_ACCEPTED",
      input.principalId,
      input.role,
      input.now,
    );
    await client.query(
      `INSERT INTO outbox_messages (outbox_id,workflow_id,event_type,payload,occurred_at,available_at)
       VALUES ($1,$2,'REDEMPTION_ACCEPTED',$3::jsonb,$4,$4)`,
      [
        randomUUID(),
        input.redemptionId,
        JSON.stringify({ actorId: input.principalId, actorRole: input.role }),
        input.now,
      ],
    );
    await client.query("COMMIT");
    return { workflowId: input.redemptionId, repeated: false as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function formRedemptionBatch(client: PoolClient, redemptionId: string, now: Date) {
  const order = await client.query<{
    security_id: string;
    krw_limit_price: string;
    effective_trading_date: string;
    status: string;
  }>(
    "SELECT security_id,krw_limit_price::text,effective_trading_date::text,status FROM redemption_orders WHERE redemption_id=$1 FOR UPDATE",
    [redemptionId],
  );
  const row = order.rows[0];
  if (!row) throw new Error("환매 요청이 없다.");
  if (row.status === "REDEMPTION_CANCELLED") return;
  if (row.status !== "REDEMPTION_ACCEPTED") throw new Error("취합할 수 없는 환매 상태다.");
  let batch = await client.query<{ batch_id: string }>(
    `SELECT batch_id FROM redemption_batches WHERE security_id=$1 AND krw_limit_price=$2
     AND effective_trading_date=$3 AND status='OPEN' FOR UPDATE`,
    [row.security_id, row.krw_limit_price, row.effective_trading_date],
  );
  let batchId = batch.rows[0]?.batch_id;
  if (!batchId) {
    batchId = randomUUID();
    await client.query(
      `INSERT INTO workflows
       (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
       VALUES ($1,'REDEMPTION_BATCH','AWAITING_KRX_EXECUTION','institution:domestic-execution',$2,$3::jsonb,$4,$4)`,
      [
        batchId,
        randomUUID(),
        JSON.stringify({ securityId: row.security_id, simulation: true }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO redemption_batches
       (batch_id,security_id,krw_limit_price,effective_trading_date,requested_quantity,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,0,'OPEN',$5,$5)`,
      [batchId, row.security_id, row.krw_limit_price, row.effective_trading_date, now],
    );
  }
  const rank = await client.query<{ count: string }>(
    "SELECT count(*)::text count FROM redemption_batch_orders WHERE batch_id=$1",
    [batchId],
  );
  await client.query(
    "INSERT INTO redemption_batch_orders (batch_id,redemption_id,allocation_rank) VALUES ($1,$2,$3)",
    [batchId, redemptionId, Number(rank.rows[0]?.count ?? 0) + 1],
  );
  await client.query(
    "UPDATE redemption_orders SET batch_id=$2,status='BATCHED',updated_at=$3 WHERE redemption_id=$1",
    [redemptionId, batchId, now],
  );
  await client.query(
    `UPDATE redemption_batches SET requested_quantity=
     (SELECT sum(requested_quantity) FROM redemption_orders WHERE batch_id=$1),updated_at=$2 WHERE batch_id=$1`,
    [batchId, now],
  );
  await client.query("UPDATE workflows SET status='BATCHED',updated_at=$2 WHERE workflow_id=$1", [
    redemptionId,
    now,
  ]);
}

export async function cancelRedemption(
  pool: Pool,
  redemptionId: string,
  principalId: string,
  now: Date,
  input: { idempotencyKey?: string; reasonKo?: string } = {},
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cancellationHash = commandHash({ redemptionId, reasonKo: input.reasonKo ?? "환매 취소" });
    if (input.idempotencyKey) {
      const duplicate = await client.query<{ request_hash: string }>(
        "SELECT request_hash FROM idempotency_records WHERE principal_id=$1 AND idempotency_key=$2",
        [principalId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].request_hash !== cancellationHash)
          throw new Error("같은 멱등키의 취소 사유가 다르다.");
        await client.query("COMMIT");
        return { repeated: true as const };
      }
    }
    const result = await client.query<{
      security_id: string;
      requested_quantity: string;
      status: string;
      domestic_sale_submitted: boolean;
      batch_id: string | null;
    }>(
      `SELECT security_id,requested_quantity::text,status,domestic_sale_submitted,batch_id
       FROM redemption_orders WHERE redemption_id=$1 AND principal_id=$2 FOR UPDATE`,
      [redemptionId, principalId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("환매 요청이 없다.");
    if (row.domestic_sale_submitted || !["REDEMPTION_ACCEPTED", "BATCHED"].includes(row.status))
      throw new Error("국내 주문 제출 뒤에는 일반 취소할 수 없다.");
    await client.query(
      `UPDATE customer_rights_positions SET redemption_locked_quantity=redemption_locked_quantity-$3,updated_at=$4
       WHERE principal_id=$1 AND security_id=$2 AND redemption_locked_quantity >= $3`,
      [principalId, row.security_id, row.requested_quantity, now],
    );
    await client.query(
      "UPDATE redemption_orders SET status='REDEMPTION_CANCELLED',updated_at=$2 WHERE redemption_id=$1",
      [redemptionId, now],
    );
    await client.query(
      "UPDATE workflows SET status='REDEMPTION_CANCELLED',updated_at=$2 WHERE workflow_id=$1",
      [redemptionId, now],
    );
    await transitionCurrentWorkflowState(client, {
      workflowId: redemptionId,
      axis: "REDEMPTION",
      nextState: "REDEMPTION_CANCELLED",
      actorId: principalId,
      actorRole: "INVESTOR",
      now,
    });
    if (row.batch_id) {
      await client.query(
        "DELETE FROM redemption_batch_orders WHERE batch_id=$1 AND redemption_id=$2",
        [row.batch_id, redemptionId],
      );
      await client.query(
        `UPDATE redemption_batches SET requested_quantity=COALESCE((SELECT sum(requested_quantity)
         FROM redemption_orders WHERE batch_id=$1 AND status='BATCHED'),0),updated_at=$2 WHERE batch_id=$1`,
        [row.batch_id, now],
      );
    }
    await recordHistory(
      client,
      redemptionId,
      row.status,
      "REDEMPTION_CANCELLED",
      principalId,
      "INVESTOR",
      now,
    );
    if (input.idempotencyKey)
      await client.query(
        "INSERT INTO idempotency_records (principal_id,idempotency_key,request_hash,workflow_id,created_at) VALUES ($1,$2,$3,$4,$5)",
        [principalId, input.idempotencyKey, cancellationHash, redemptionId, now],
      );
    await client.query("COMMIT");
    return { repeated: false as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapRedemption(row: Record<string, unknown>, now: Date) {
  return {
    redemptionId: row.redemption_id,
    securityId: row.security_id,
    requestedQuantity: String(row.requested_quantity),
    allocatedQuantity: String(row.allocated_quantity),
    releasedQuantity: String(row.released_quantity),
    krwLimitPrice: String(row.krw_limit_price),
    requestedTradingDate: String(row.requested_trading_date).slice(0, 10),
    effectiveTradingDate: String(row.effective_trading_date).slice(0, 10),
    batchId: row.batch_id ?? undefined,
    status: row.status,
    domesticSaleSubmitted: row.domestic_sale_submitted,
    domesticExecutionConfirmed: row.domestic_execution_confirmed,
    saleProceedsSettled: row.sale_proceeds_settled,
    rightsTerminated: row.rights_terminated,
    cashClaimUsdMinor:
      row.cash_claim_usd_minor == null ? undefined : String(row.cash_claim_usd_minor),
    feeUsdMinor: "0",
    tokenBurned: row.token_burned,
    usdPaid: row.usd_paid,
    quarantineReasonKo: row.quarantine_reason ?? undefined,
    simulation: true,
    projection: projection(now),
  };
}

export async function listRedemptions(pool: Pool, principalId: string, role: string, now: Date) {
  const result =
    role === "INVESTOR"
      ? await pool.query<Record<string, unknown>>(
          "SELECT * FROM redemption_orders WHERE principal_id=$1 ORDER BY accepted_at,redemption_id",
          [principalId],
        )
      : await pool.query<Record<string, unknown>>(
          "SELECT * FROM redemption_orders ORDER BY accepted_at,redemption_id",
        );
  return { items: result.rows.map((row) => mapRedemption(row, now)), projection: projection(now) };
}

export async function isRedemptionWorkflow(pool: Pool, workflowId: string): Promise<boolean> {
  const result = await pool.query<{ workflow_type: string }>(
    "SELECT workflow_type FROM workflows WHERE workflow_id=$1",
    [workflowId],
  );
  return ["REDEMPTION", "REDEMPTION_BATCH"].includes(result.rows[0]?.workflow_type ?? "");
}

async function applyRedemptionDecision(
  client: PoolClient,
  taskId: string,
  actorId: string,
  actorRole: string,
  payload: Record<string, string>,
  now: Date,
) {
  if (!decisionRoles.has(actorRole)) throw new Error("환매 업무 역할이 아니다.");
  const workflow = await client.query<{ workflow_type: string; status: string }>(
    "SELECT workflow_type,status FROM workflows WHERE workflow_id=$1 FOR UPDATE",
    [taskId],
  );
  const work = workflow.rows[0];
  if (!work) throw new Error("환매 업무가 없다.");
  if (work.workflow_type === "REDEMPTION_BATCH") {
    if (actorRole !== "EXECUTION_ALLOCATION_CONFIRMER" || work.status !== "AWAITING_KRX_EXECUTION")
      throw new Error("체결·배분 확인 담당자만 국내 매도 결과를 확정할 수 있다.");
    const filled = BigInt(payload.filledQuantity ?? "4");
    const orders = await client.query<{
      redemption_id: string;
      requested_quantity: string;
      accepted_at: Date;
      acceptance_sequence: string;
      principal_id: string;
    }>(
      `SELECT redemption_id,requested_quantity::text,accepted_at,acceptance_sequence::text,principal_id
       FROM redemption_orders WHERE batch_id=$1 AND status='BATCHED'
       ORDER BY accepted_at,acceptance_sequence,redemption_id FOR UPDATE`,
      [taskId],
    );
    const allocations = allocateRedemptionFill(
      orders.rows.map((row) => ({
        orderId: row.redemption_id,
        requestedQuantity: BigInt(row.requested_quantity),
        acceptedAt: row.accepted_at,
        acceptanceRank: Number(row.acceptance_sequence),
      })),
      filled,
    );
    const proof = evidence(`${taskId}:REDEMPTION_EXECUTION:${filled}:${now.toISOString()}`);
    for (const allocation of allocations) {
      const order = orders.rows.find((item) => item.redemption_id === allocation.orderId)!;
      if (allocation.releasedQuantity > 0n) {
        await client.query(
          `UPDATE customer_rights_positions SET redemption_locked_quantity=redemption_locked_quantity-$3,updated_at=$4
           WHERE principal_id=$1 AND security_id=$2`,
          [
            order.principal_id,
            LOCAL_REDEMPTION_SECURITY_ID,
            allocation.releasedQuantity.toString(),
            now,
          ],
        );
      }
      await client.query(
        `UPDATE redemption_orders SET allocated_quantity=$2,released_quantity=$3,domestic_sale_submitted=true,
         domestic_execution_confirmed=true,status='SALE_PROCEEDS_SETTLEMENT_PENDING',updated_at=$4 WHERE redemption_id=$1`,
        [
          allocation.orderId,
          allocation.allocatedQuantity.toString(),
          allocation.releasedQuantity.toString(),
          now,
        ],
      );
      await client.query(
        "UPDATE workflows SET status='SALE_PROCEEDS_SETTLEMENT_PENDING',updated_at=$2 WHERE workflow_id=$1",
        [allocation.orderId, now],
      );
      await recordHistory(
        client,
        allocation.orderId,
        "BATCHED",
        "SALE_PROCEEDS_SETTLEMENT_PENDING",
        actorId,
        actorRole,
        now,
        { evidenceHash: proof },
      );
    }
    await client.query(
      `UPDATE redemption_batches SET status='EXECUTION_CONFIRMED',filled_quantity=$2,
       domestic_order_reference=$3,execution_evidence_hash=$4,updated_at=$5 WHERE batch_id=$1`,
      [taskId, filled.toString(), `SIM-KRX-SELL-${taskId.slice(0, 8)}`, proof, now],
    );
    await client.query(
      "UPDATE workflows SET status='COMPLETED',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    return;
  }
  const orderResult = await client.query<{
    principal_id: string;
    security_id: string;
    status: string;
    allocated_quantity: string;
    batch_id: string;
    token_burned: boolean;
    usd_paid: boolean;
  }>(
    `SELECT principal_id,security_id,status,allocated_quantity::text,batch_id,token_burned,usd_paid
     FROM redemption_orders WHERE redemption_id=$1 FOR UPDATE`,
    [taskId],
  );
  const order = orderResult.rows[0];
  if (!order) throw new Error("환매 요청이 없다.");
  const proof = evidence(
    `${taskId}:${actorRole}:${payload.action ?? order.status}:${now.toISOString()}`,
  );
  if (
    order.status === "SALE_PROCEEDS_SETTLEMENT_PENDING" &&
    actorRole === "DOMESTIC_SETTLEMENT_CONFIRMER"
  ) {
    await client.query(
      "UPDATE redemption_orders SET sale_proceeds_settled=true,status='RIGHTS_TERMINATION_PENDING',updated_at=$2 WHERE redemption_id=$1",
      [taskId, now],
    );
    await client.query(
      "UPDATE workflows SET status='RIGHTS_TERMINATION_PENDING',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    await recordHistory(
      client,
      taskId,
      order.status,
      "RIGHTS_TERMINATION_PENDING",
      actorId,
      actorRole,
      now,
      { evidenceHash: proof },
    );
  } else if (
    order.status === "RIGHTS_TERMINATION_PENDING" &&
    actorRole === "RIGHTS_RECORDING_CONFIRMER"
  ) {
    const batch = await client.query<{
      filled_quantity: string;
      total_net_usd_minor: string | null;
    }>(
      "SELECT filled_quantity::text,total_net_usd_minor::text FROM redemption_batches WHERE batch_id=$1 FOR UPDATE",
      [order.batch_id],
    );
    const batchOrders = await client.query<{
      redemption_id: string;
      allocated_quantity: string;
      accepted_at: Date;
    }>(
      "SELECT redemption_id,allocated_quantity::text,accepted_at FROM redemption_orders WHERE batch_id=$1 AND allocated_quantity>0 ORDER BY accepted_at,redemption_id",
      [order.batch_id],
    );
    const total =
      batch.rows[0]?.total_net_usd_minor == null
        ? LOCAL_REDEMPTION_TOTAL_USD_MINOR
        : BigInt(batch.rows[0].total_net_usd_minor);
    const claims = allocateUsdClaims(
      batchOrders.rows.map((item) => ({
        orderId: item.redemption_id,
        allocatedQuantity: BigInt(item.allocated_quantity),
        acceptedAt: item.accepted_at,
      })),
      total,
    );
    const claim = claims.find((item) => item.orderId === taskId);
    if (!claim) throw new Error("고객별 USD 지급청구를 배분할 수 없다.");
    const quantity = BigInt(order.allocated_quantity);
    const rightsUpdate = await client.query(
      `UPDATE customer_rights_positions SET settled_quantity=settled_quantity-$3,
       redemption_locked_quantity=redemption_locked_quantity-$3,burn_pending_quantity=burn_pending_quantity+$3,updated_at=$4
       WHERE principal_id=$1 AND security_id=$2 AND settled_quantity >= $3 AND redemption_locked_quantity >= $3`,
      [order.principal_id, order.security_id, quantity.toString(), now],
    );
    if (rightsUpdate.rowCount !== 1)
      throw new Error("종료할 수탁권리 또는 환매 잠금수량이 부족하다.");
    await client.query(
      `UPDATE instrument_control_totals SET domestic_settled_quantity=domestic_settled_quantity-$2,updated_at=$3
       WHERE security_id=$1 AND domestic_settled_quantity >= $2`,
      [order.security_id, quantity.toString(), now],
    );
    await client.query(
      `INSERT INTO redemption_cash_claims
       (claim_id,redemption_id,share_quantity,gross_usd_minor,fee_usd_minor,net_usd_minor,status,settlement_evidence_hash,created_at,updated_at)
       VALUES ($1,$2,$3,$4,0,$4,'PAYMENT_PENDING',$5,$6,$6)`,
      [randomUUID(), taskId, quantity.toString(), claim.usdAmountMinor.toString(), proof, now],
    );
    await client.query(
      `UPDATE redemption_orders SET rights_terminated=true,cash_claim_usd_minor=$2,
       status='PAYMENT_AND_BURN_PENDING',updated_at=$3 WHERE redemption_id=$1`,
      [taskId, claim.usdAmountMinor.toString(), now],
    );
    await client.query(
      "UPDATE workflows SET status='PAYMENT_AND_BURN_PENDING',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    await recordHistory(
      client,
      taskId,
      order.status,
      "PAYMENT_AND_BURN_PENDING",
      actorId,
      actorRole,
      now,
      { evidenceHash: proof },
    );
  } else if (
    order.status === "PAYMENT_AND_BURN_PENDING" &&
    actorRole === "OVERSEAS_BROKER_OPERATOR"
  ) {
    const action = payload.action ?? "COMPLETE_BOTH";
    if (!["PAY_USD", "BURN_TOKEN", "COMPLETE_BOTH", "FAIL_PAYMENT", "FAIL_BURN"].includes(action))
      throw new Error("지원하지 않는 지급·소각 결정이다.");
    if (action.startsWith("FAIL_")) {
      await client.query(
        "UPDATE redemption_orders SET status='QUARANTINED',quarantine_reason=$2,updated_at=$3 WHERE redemption_id=$1",
        [taskId, action === "FAIL_PAYMENT" ? "USD 지급 실패" : "토큰 소각 실패", now],
      );
      await client.query(
        "UPDATE workflows SET status='QUARANTINED',updated_at=$2 WHERE workflow_id=$1",
        [taskId, now],
      );
      await recordHistory(client, taskId, order.status, "QUARANTINED", actorId, actorRole, now, {
        evidenceHash: proof,
      });
      return;
    }
    let usdPaid = order.usd_paid;
    let tokenBurned = order.token_burned;
    if ((action === "PAY_USD" || action === "COMPLETE_BOTH") && !usdPaid) {
      const claim = await client.query<{ net_usd_minor: string }>(
        "SELECT net_usd_minor::text FROM redemption_cash_claims WHERE redemption_id=$1 FOR UPDATE",
        [taskId],
      );
      if (!claim.rows[0]) throw new Error("USD 지급청구가 없다.");
      await client.query(
        "UPDATE customer_cash_accounts SET usd_available_minor=usd_available_minor+$2,updated_at=$3 WHERE principal_id=$1",
        [order.principal_id, claim.rows[0].net_usd_minor, now],
      );
      await client.query(
        "UPDATE redemption_cash_claims SET status='PAID',updated_at=$2 WHERE redemption_id=$1",
        [taskId, now],
      );
      usdPaid = true;
    }
    if ((action === "BURN_TOKEN" || action === "COMPLETE_BOTH") && !tokenBurned) {
      const quantity = BigInt(order.allocated_quantity);
      const updated = await client.query(
        `UPDATE customer_rights_positions SET burn_pending_quantity=burn_pending_quantity-$3,updated_at=$4
         WHERE principal_id=$1 AND security_id=$2 AND burn_pending_quantity >= $3`,
        [order.principal_id, order.security_id, quantity.toString(), now],
      );
      if (updated.rowCount !== 1) throw new Error("소각 대기 수량이 부족하다.");
      await client.query(
        `UPDATE instrument_control_totals SET token_total_supply=token_total_supply-$2,updated_at=$3
         WHERE security_id=$1 AND token_total_supply >= $2`,
        [order.security_id, quantity.toString(), now],
      );
      tokenBurned = true;
    }
    const next = usdPaid && tokenBurned ? "REDEMPTION_COMPLETED" : "PAYMENT_AND_BURN_PENDING";
    await client.query(
      `UPDATE redemption_orders SET usd_paid=$2,token_burned=$3,payment_evidence_hash=CASE WHEN $2 THEN $4 ELSE payment_evidence_hash END,
       burn_evidence_hash=CASE WHEN $3 THEN $4 ELSE burn_evidence_hash END,status=$5,updated_at=$6 WHERE redemption_id=$1`,
      [taskId, usdPaid, tokenBurned, proof, next, now],
    );
    await client.query("UPDATE workflows SET status=$2,updated_at=$3 WHERE workflow_id=$1", [
      taskId,
      next === "REDEMPTION_COMPLETED" ? "COMPLETED" : next,
      now,
    ]);
    await recordHistory(client, taskId, order.status, next, actorId, actorRole, now, {
      evidenceHash: proof,
    });
  } else throw new Error("역할과 환매 단계가 일치하지 않는다.");
}

export async function processRedemptionOutbox(
  pool: Pool,
  message: { outboxId: string; workflowId: string; eventType: string; payload: unknown },
  now: Date,
): Promise<boolean> {
  if (!new Set(["REDEMPTION_ACCEPTED", "REDEMPTION_DECISION_REQUESTED"]).has(message.eventType))
    return false;
  const payload = message.payload as Record<string, string>;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (message.eventType === "REDEMPTION_ACCEPTED")
      await formRedemptionBatch(client, message.workflowId, now);
    else {
      if (!payload.taskId || !payload.actorId || !payload.actorRole)
        throw new Error("환매 기관 결정값이 없다.");
      await applyRedemptionDecision(
        client,
        payload.taskId,
        payload.actorId,
        payload.actorRole,
        payload,
        now,
      );
      await client.query(
        "UPDATE workflows SET status='COMPLETED',updated_at=$2 WHERE workflow_id=$1",
        [message.workflowId, now],
      );
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

export function isRedemptionAdapterEvent(eventType: string): boolean {
  return eventType.startsWith("redemption.");
}

export async function acceptRedemptionAdapterEvent(
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
  const roles: Record<string, string> = {
    "redemption.execution-confirmed.v1": "EXECUTION_ALLOCATION_CONFIRMER",
    "redemption.sale-proceeds-settled.v1": "DOMESTIC_SETTLEMENT_CONFIRMER",
    "redemption.rights-terminated.v1": "RIGHTS_RECORDING_CONFIRMER",
    "redemption.usd-paid.v1": "OVERSEAS_BROKER_OPERATOR",
  };
  const actorRole = roles[input.eventType];
  if (!actorRole || typeof input.data.taskId !== "string")
    throw new Error("지원하지 않는 환매 기관 결과다.");
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
      return { repeated: true };
    }
    const last = await client.query<{ sequence: string }>(
      "SELECT COALESCE(max(source_sequence),0)::text sequence FROM inbox_messages WHERE source_id=$1",
      [input.sourceInstitutionId],
    );
    if (input.sourceSequence !== Number(last.rows[0]?.sequence ?? 0) + 1)
      throw new Error("기관 이벤트 순번 공백이 있다.");
    await client.query(
      "INSERT INTO inbox_messages (source_id,event_id,source_sequence,payload_hash,received_at,processed_at) VALUES ($1,$2,$3,$4,$5,$5)",
      [
        input.sourceInstitutionId,
        input.eventId,
        input.sourceSequence,
        input.payloadHash,
        input.now,
      ],
    );
    const workflowId = randomUUID();
    await client.query(
      `INSERT INTO workflows (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
       VALUES ($1,'INSTITUTION_DECISION','ACCEPTED',$2,$3,$4::jsonb,$5,$5)`,
      [workflowId, input.sourceInstitutionId, randomUUID(), JSON.stringify(input.data), input.now],
    );
    await client.query(
      `INSERT INTO outbox_messages (outbox_id,workflow_id,event_type,payload,occurred_at,available_at)
       VALUES ($1,$2,'REDEMPTION_DECISION_REQUESTED',$3::jsonb,$4,$4)`,
      [
        randomUUID(),
        workflowId,
        JSON.stringify({ ...input.data, actorId: input.sourceInstitutionId, actorRole }),
        input.now,
      ],
    );
    await client.query("COMMIT");
    return { repeated: false, workflowId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
