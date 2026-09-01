import { createHash, randomUUID } from "node:crypto";

import {
  LOCAL_PRIMARY_SECURITY_ID,
  allocateProRata,
  nextKrxBusinessDate,
  reserveAmountForOrder,
  type PrimaryFundingMode,
} from "@rwa/domain";
import type { Pool, PoolClient } from "pg";

import { commandHash, getCustomerReadiness, type ProjectionMetadata } from "./protection.js";
import { getLocalChainMetadata } from "./chain-execution.js";
import {
  initializeWorkflowState,
  transitionCurrentWorkflowState,
  transitionWorkflowState,
} from "./runtime-state.js";

const primaryRoles = new Set([
  "EXECUTION_ALLOCATION_CONFIRMER",
  "T2_RISK_APPROVER",
  "RIGHTS_ENTRY_APPROVER",
  "RIGHTS_RECORDING_CONFIRMER",
  "DOMESTIC_SETTLEMENT_CONFIRMER",
  "CUSTODY_QUANTITY_CONFIRMER",
  "OVERSEAS_BROKER_OPERATOR",
  "COMPLIANCE_AUDITOR",
]);

function projection(now: Date): ProjectionMetadata {
  return { projectionAsOf: now.toISOString(), lastEventSequence: 0, projectionStatus: "CURRENT" };
}

function evidence(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

async function history(
  client: PoolClient,
  orderId: string,
  axis: string,
  previous: string | null,
  next: string,
  actorId: string,
  actorRole: string,
  now: Date,
  evidenceHash?: string,
) {
  await client.query(
    `INSERT INTO primary_state_history
      (history_id, order_id, state_axis, previous_state, new_state, actor_id, actor_role, evidence_hash, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), orderId, axis, previous, next, actorId, actorRole, evidenceHash ?? null, now],
  );
}

export async function getLocalPrimaryScenario(pool: Pool, principalId: string, now: Date) {
  const chain = await getLocalChainMetadata(pool);
  const instrument = await pool.query<Record<string, unknown>>(
    "SELECT * FROM local_simulation_instruments WHERE security_id=$1",
    [LOCAL_PRIMARY_SECURITY_ID],
  );
  const cash = await pool.query<Record<string, unknown>>(
    "SELECT * FROM customer_cash_accounts WHERE principal_id=$1",
    [principalId],
  );
  const row = instrument.rows[0];
  if (!row) return undefined;
  return {
    securityId: row.security_id,
    displayName: row.display_name,
    tokenSymbol: row.token_symbol,
    referenceLimitKrw: String(row.reference_limit_krw),
    usdKrwRate: "1380.3",
    primaryEnabled: row.primary_enabled,
    officialProduct: false,
    notices: [
      "로컬 전용 합성 상품이며 실제 삼성전자 주식이나 공식 ISIN 상품이 아니다.",
      "체결 뒤 발행되지만 국내 결제와 수탁 확인 전에는 이전할 수 없다.",
      "USDC 미체결 잔액은 전환된 USD 잔액으로 해제되며 자동 재전환하지 않는다.",
    ],
    cash: cash.rows[0]
      ? {
          usdAvailableMinor: String(cash.rows[0].usd_available_minor),
          usdReservedMinor: String(cash.rows[0].usd_reserved_minor),
          usdcAvailableMinor: String(cash.rows[0].usdc_available_minor),
        }
      : undefined,
    intentDomain: {
      name: "Korean Equity RWA Intent",
      version: "1",
      chainId: 31337,
      verifyingContract: chain.verifyingContract,
    },
    policyVersion: chain.policyVersion,
    simulation: true,
    projection: projection(now),
  };
}

export interface PrimaryOrderInput {
  orderId: string;
  securityId: string;
  shareQuantity: bigint;
  krwLimitPrice: bigint;
  requestedTradingDate: string;
  fundingMode: PrimaryFundingMode;
  signedIntent: unknown;
}

export async function acceptPrimaryOrder(
  pool: Pool,
  input: {
    principalId: string;
    role: string;
    wallet: string;
    idempotencyKey: string;
    correlationId: string;
    order: PrimaryOrderInput;
    now: Date;
  },
) {
  const requestPayload = {
    securityId: input.order.securityId,
    shareQuantity: input.order.shareQuantity.toString(),
    krwLimitPrice: input.order.krwLimitPrice.toString(),
    requestedTradingDate: input.order.requestedTradingDate,
    fundingMode: input.order.fundingMode,
    signedIntent: input.order.signedIntent,
  };
  const requestHash = commandHash(requestPayload);
  const hold = await pool.query(
    `SELECT 1 FROM operational_holds
     WHERE status IN ('WORK_HALTED','RELEASE_SCHEDULED')
       AND scope IN ('NEW_ORDERS','PRIMARY_AND_SECONDARY')
       AND (security_id IS NULL OR security_id=$1)
     LIMIT 1`,
    [input.order.securityId],
  );
  if (hold.rows.length) return { rejected: "OPERATIONAL_HOLD" as const };
  const readiness = await getCustomerReadiness(pool, input.principalId, input.now);
  if (
    !readiness?.canPlaceNewOrder ||
    readiness.activeWallet?.toLowerCase() !== input.wallet.toLowerCase()
  ) {
    return { rejected: "CUSTOMER_NOT_READY" as const };
  }
  const requiredUsd = reserveAmountForOrder(input.order.shareQuantity, input.order.krwLimitPrice);
  const convertedUsdc = input.order.fundingMode === "USDC_CONVERSION" ? requiredUsd * 10_000n : 0n;
  const effectiveDate = nextKrxBusinessDate(input.order.requestedTradingDate);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query<{ request_hash: string; workflow_id: string }>(
      "SELECT request_hash, workflow_id FROM idempotency_records WHERE principal_id=$1 AND idempotency_key=$2",
      [input.principalId, input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      await client.query("COMMIT");
      return duplicate.rows[0].request_hash === requestHash
        ? { workflowId: duplicate.rows[0].workflow_id, repeated: true as const }
        : { conflict: true as const };
    }
    const cash = await client.query<{
      usd_available_minor: string;
      usdc_available_minor: string;
    }>(
      "SELECT usd_available_minor::text, usdc_available_minor::text FROM customer_cash_accounts WHERE principal_id=$1 FOR UPDATE",
      [input.principalId],
    );
    if (!cash.rows[0]) throw new Error("합성 고객자금 계정이 없다.");
    const usdAvailable = BigInt(cash.rows[0].usd_available_minor);
    const usdcAvailable = BigInt(cash.rows[0].usdc_available_minor);
    if (input.order.fundingMode === "USD_LEDGER" && usdAvailable < requiredUsd)
      return await rollbackResult(client, { rejected: "INSUFFICIENT_USD" as const });
    if (input.order.fundingMode === "USDC_CONVERSION" && usdcAvailable < convertedUsdc)
      return await rollbackResult(client, { rejected: "INSUFFICIENT_USDC" as const });

    if (input.order.fundingMode === "USD_LEDGER") {
      await client.query(
        `UPDATE customer_cash_accounts SET
           usd_available_minor=usd_available_minor-$2,
           usd_reserved_minor=usd_reserved_minor+$2,
           updated_at=$3
         WHERE principal_id=$1`,
        [input.principalId, requiredUsd.toString(), input.now],
      );
    } else {
      await client.query(
        `UPDATE customer_cash_accounts SET
           usd_reserved_minor=usd_reserved_minor+$2,
           usdc_available_minor=usdc_available_minor-$3,
           updated_at=$4
         WHERE principal_id=$1`,
        [input.principalId, requiredUsd.toString(), convertedUsdc.toString(), input.now],
      );
    }
    await client.query(
      `INSERT INTO workflows
        (workflow_id, workflow_type, status, principal_id, correlation_id, request_payload, created_at, updated_at)
       VALUES ($1,'PRIMARY_ISSUANCE','ORDER_ACCEPTED',$2,$3,$4::jsonb,$5,$5)`,
      [
        input.order.orderId,
        input.principalId,
        input.correlationId,
        JSON.stringify(requestPayload),
        input.now,
      ],
    );
    await client.query(
      "INSERT INTO idempotency_records (principal_id,idempotency_key,request_hash,workflow_id,created_at) VALUES ($1,$2,$3,$4,$5)",
      [input.principalId, input.idempotencyKey, requestHash, input.order.orderId, input.now],
    );
    await client.query(
      `INSERT INTO primary_orders
        (order_id,principal_id,wallet_address,security_id,share_quantity,krw_limit_price,requested_trading_date,effective_trading_date,
         funding_mode,requested_usd_minor,converted_usdc_minor,reserved_usd_minor,status,accepted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,'ORDER_ACCEPTED',$12,$12)`,
      [
        input.order.orderId,
        input.principalId,
        input.wallet.toLowerCase(),
        input.order.securityId,
        input.order.shareQuantity.toString(),
        input.order.krwLimitPrice.toString(),
        input.order.requestedTradingDate,
        effectiveDate,
        input.order.fundingMode,
        requiredUsd.toString(),
        convertedUsdc.toString(),
        input.now,
      ],
    );
    await initializeWorkflowState(client, {
      workflowId: input.order.orderId,
      axis: "PRIMARY_ORDER",
      state: "PRIMARY_DRAFT",
      actorId: input.principalId,
      actorRole: input.role,
      now: input.now,
    });
    await transitionWorkflowState(client, {
      workflowId: input.order.orderId,
      axis: "PRIMARY_ORDER",
      expectedState: "PRIMARY_DRAFT",
      nextState: "PRIMARY_FUNDS_CHECK",
      actorId: "primary-orchestrator",
      actorRole: "PLATFORM_OPERATOR",
      now: input.now,
    });
    await transitionWorkflowState(client, {
      workflowId: input.order.orderId,
      axis: "PRIMARY_ORDER",
      expectedState: "PRIMARY_FUNDS_CHECK",
      nextState: "PRIMARY_AGGREGATION_PENDING",
      actorId: "primary-orchestrator",
      actorRole: "PLATFORM_OPERATOR",
      now: input.now,
    });
    await client.query("INSERT INTO primary_approval_facts (order_id,updated_at) VALUES ($1,$2)", [
      input.order.orderId,
      input.now,
    ]);
    await history(
      client,
      input.order.orderId,
      "PRIMARY_ORDER",
      null,
      "ORDER_ACCEPTED",
      input.principalId,
      input.role,
      input.now,
    );
    await client.query(
      `INSERT INTO outbox_messages (outbox_id,workflow_id,event_type,payload,occurred_at,available_at)
       VALUES ($1,$2,'PRIMARY_ORDER_ACCEPTED',$3::jsonb,$4,$4)`,
      [
        randomUUID(),
        input.order.orderId,
        JSON.stringify({ actorId: input.principalId, actorRole: input.role }),
        input.now,
      ],
    );
    await client.query("COMMIT");
    return { workflowId: input.order.orderId, repeated: false as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackResult<T>(client: PoolClient, value: T): Promise<T> {
  await client.query("ROLLBACK");
  return value;
}

function mapOrder(row: Record<string, unknown>, now: Date) {
  return {
    orderId: row.order_id,
    principalId: row.principal_id,
    wallet: row.wallet_address,
    securityId: row.security_id,
    shareQuantity: String(row.share_quantity),
    krwLimitPrice: String(row.krw_limit_price),
    requestedTradingDate: String(row.requested_trading_date).slice(0, 10),
    effectiveTradingDate: String(row.effective_trading_date).slice(0, 10),
    fundingMode: row.funding_mode,
    requestedUsdMinor: String(row.requested_usd_minor),
    convertedUsdcMinor: String(row.converted_usdc_minor),
    reservedUsdMinor: String(row.reserved_usd_minor),
    usedUsdMinor: String(row.used_usd_minor),
    releasedUsdMinor: String(row.released_usd_minor),
    status: row.status,
    filledQuantity: String(row.filled_quantity),
    allocatedQuantity: String(row.allocated_quantity),
    rightsStatus: row.rights_status,
    tokenStatus: row.token_status,
    settlementStatus: row.settlement_status,
    ...(row.batch_id ? { batchId: row.batch_id } : {}),
    ...(row.token_transaction_hash ? { tokenTransactionHash: row.token_transaction_hash } : {}),
    ...(row.release_transaction_hash
      ? { releaseTransactionHash: row.release_transaction_hash }
      : {}),
    ...(row.quarantine_reason ? { quarantineReason: row.quarantine_reason } : {}),
    ...(row.default_resolution ? { defaultResolution: row.default_resolution } : {}),
    ...(row.cash_compensation_usd_minor !== null && row.cash_compensation_usd_minor !== undefined
      ? { cashCompensationUsdMinor: String(row.cash_compensation_usd_minor) }
      : {}),
    simulation: true,
    projection: projection(now),
  };
}

export async function listPrimaryOrders(pool: Pool, principalId: string, role: string, now: Date) {
  const result =
    role === "INVESTOR"
      ? await pool.query(
          "SELECT * FROM primary_orders WHERE principal_id=$1 ORDER BY accepted_at,order_id",
          [principalId],
        )
      : await pool.query("SELECT * FROM primary_orders ORDER BY accepted_at,order_id");
  return { items: result.rows.map((row) => mapOrder(row, now)), projection: projection(now) };
}

export async function cancelPrimaryOrder(
  pool: Pool,
  orderId: string,
  principalId: string,
  now: Date,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Record<string, unknown>>(
      "SELECT * FROM primary_orders WHERE order_id=$1 AND principal_id=$2 FOR UPDATE",
      [orderId, principalId],
    );
    const order = result.rows[0];
    if (!order || order.status !== "ORDER_ACCEPTED")
      throw new Error("취소 가능한 접수 주문이 아니다.");
    await client.query(
      "UPDATE customer_cash_accounts SET usd_reserved_minor=usd_reserved_minor-$2,usd_available_minor=usd_available_minor+$2,updated_at=$3 WHERE principal_id=$1",
      [principalId, order.reserved_usd_minor, now],
    );
    await client.query(
      "UPDATE primary_orders SET status='CANCELLED',released_usd_minor=reserved_usd_minor,reserved_usd_minor=0,updated_at=$2 WHERE order_id=$1",
      [orderId, now],
    );
    await client.query(
      "UPDATE workflows SET status='CANCELLED',updated_at=$2 WHERE workflow_id=$1",
      [orderId, now],
    );
    await transitionCurrentWorkflowState(client, {
      workflowId: orderId,
      axis: "PRIMARY_ORDER",
      nextState: "PRIMARY_CANCELLED",
      actorId: principalId,
      actorRole: "INVESTOR",
      now,
    });
    await history(
      client,
      orderId,
      "PRIMARY_ORDER",
      "ORDER_ACCEPTED",
      "CANCELLED",
      principalId,
      "INVESTOR",
      now,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function formBatch(client: PoolClient, orderId: string, now: Date) {
  const order = await client.query<{
    security_id: string;
    krw_limit_price: string;
    effective_trading_date: Date;
  }>(
    "SELECT security_id,krw_limit_price::text,effective_trading_date FROM primary_orders WHERE order_id=$1",
    [orderId],
  );
  const row = order.rows[0];
  if (!row) throw new Error("주문이 없다.");
  let batch = await client.query<{ batch_id: string }>(
    `SELECT batch_id FROM primary_batches WHERE security_id=$1 AND krw_limit_price=$2 AND effective_trading_date=$3 AND status='OPEN' FOR UPDATE`,
    [row.security_id, row.krw_limit_price, row.effective_trading_date],
  );
  let batchId = batch.rows[0]?.batch_id;
  if (!batchId) {
    batchId = randomUUID();
    await client.query(
      `INSERT INTO workflows (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
       VALUES ($1,'PRIMARY_BATCH','AWAITING_KRX_EXECUTION','institution:domestic-execution',$2,$3::jsonb,$4,$4)`,
      [
        batchId,
        randomUUID(),
        JSON.stringify({ securityId: row.security_id, krwLimitPrice: row.krw_limit_price }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO primary_batches (batch_id,security_id,krw_limit_price,effective_trading_date,requested_quantity,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,0,'OPEN',$5,$5)`,
      [batchId, row.security_id, row.krw_limit_price, row.effective_trading_date, now],
    );
  }
  const rank = await client.query<{ count: string }>(
    "SELECT count(*)::text count FROM primary_batch_orders WHERE batch_id=$1",
    [batchId],
  );
  await client.query(
    "INSERT INTO primary_batch_orders (batch_id,order_id,allocation_rank) VALUES ($1,$2,$3)",
    [batchId, orderId, Number(rank.rows[0]?.count ?? 0) + 1],
  );
  await client.query(
    "UPDATE primary_orders SET batch_id=$2,status='BATCHED',updated_at=$3 WHERE order_id=$1",
    [orderId, batchId, now],
  );
  await transitionWorkflowState(client, {
    workflowId: orderId,
    axis: "PRIMARY_ORDER",
    expectedState: "PRIMARY_AGGREGATION_PENDING",
    nextState: "PRIMARY_KRX_OPEN_PENDING",
    actorId: "primary-orchestrator",
    actorRole: "PLATFORM_OPERATOR",
    now,
  });
  await client.query(
    `UPDATE primary_batches SET requested_quantity=(SELECT sum(share_quantity) FROM primary_orders WHERE batch_id=$1),updated_at=$2 WHERE batch_id=$1`,
    [batchId, now],
  );
}

export async function processPrimaryOutbox(
  pool: Pool,
  message: { outboxId: string; workflowId: string; eventType: string; payload: unknown },
  now: Date,
): Promise<boolean> {
  if (
    message.eventType !== "PRIMARY_ORDER_ACCEPTED" &&
    message.eventType !== "PRIMARY_DECISION_REQUESTED"
  )
    return false;
  const payload = message.payload as Record<string, string>;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (message.eventType === "PRIMARY_ORDER_ACCEPTED") {
      await formBatch(client, message.workflowId, now);
      await client.query(
        "UPDATE workflows SET status='BATCHED',updated_at=$2 WHERE workflow_id=$1",
        [message.workflowId, now],
      );
    } else {
      if (!payload.taskId || !payload.actorId || !payload.actorRole)
        throw new Error("기관 결정 업무값이 없다.");
      await applyPrimaryDecision(
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

async function applyPrimaryDecision(
  client: PoolClient,
  taskId: string,
  actorId: string,
  actorRole: string,
  payload: Record<string, string>,
  now: Date,
) {
  if (!primaryRoles.has(actorRole)) throw new Error("1차 발행 업무 역할이 아니다.");
  const workflow = await client.query<{ workflow_type: string; status: string }>(
    "SELECT workflow_type,status FROM workflows WHERE workflow_id=$1 FOR UPDATE",
    [taskId],
  );
  if (!workflow.rows[0]) throw new Error("대상 1차 발행 업무가 없다.");
  if (workflow.rows[0].workflow_type === "PRIMARY_BATCH") {
    if (
      actorRole !== "EXECUTION_ALLOCATION_CONFIRMER" ||
      workflow.rows[0].status !== "AWAITING_KRX_EXECUTION"
    )
      throw new Error("체결·배분 확인 담당자만 처리할 수 있다.");
    const filledQuantity = BigInt(payload.filledQuantity ?? "6");
    const orders = await client.query<{
      order_id: string;
      share_quantity: string;
      accepted_at: Date;
      acceptance_sequence: string;
      principal_id: string;
      reserved_usd_minor: string;
      krw_limit_price: string;
    }>(
      `SELECT orders.order_id,orders.share_quantity::text,orders.accepted_at,orders.acceptance_sequence::text,
       orders.principal_id,orders.reserved_usd_minor::text,orders.krw_limit_price::text
       FROM primary_orders orders JOIN primary_batch_orders links ON links.order_id=orders.order_id
       WHERE orders.batch_id=$1 ORDER BY orders.accepted_at,orders.acceptance_sequence,orders.order_id FOR UPDATE OF orders`,
      [taskId],
    );
    const allocations = allocateProRata(
      orders.rows.map((row) => ({
        orderId: row.order_id,
        requestedQuantity: BigInt(row.share_quantity),
        acceptedAt: row.accepted_at,
        acceptanceRank: Number(row.acceptance_sequence),
      })),
      filledQuantity,
    );
    const execEvidence = evidence(`${taskId}:KRX:${filledQuantity}:${now.toISOString()}`);
    for (const allocation of allocations) {
      const order = orders.rows.find((item) => item.order_id === allocation.orderId)!;
      const used = reserveAmountForOrder(
        allocation.allocatedQuantity,
        BigInt(order.krw_limit_price),
      );
      const released = BigInt(order.reserved_usd_minor) - used;
      await client.query(
        "UPDATE customer_cash_accounts SET usd_reserved_minor=usd_reserved_minor-$2,usd_available_minor=usd_available_minor+$3,updated_at=$4 WHERE principal_id=$1",
        [order.principal_id, order.reserved_usd_minor, released.toString(), now],
      );
      await client.query(
        `UPDATE primary_orders SET status='T2_RISK_APPROVAL_PENDING',filled_quantity=$2,allocated_quantity=$2,used_usd_minor=$3,released_usd_minor=$4,reserved_usd_minor=0,updated_at=$5 WHERE order_id=$1`,
        [
          order.order_id,
          allocation.allocatedQuantity.toString(),
          used.toString(),
          released.toString(),
          now,
        ],
      );
      await client.query(
        `UPDATE primary_approval_facts SET execution_allocation_confirmed=true,execution_evidence_hash=$2,allocation_evidence_hash=$3,updated_at=$4 WHERE order_id=$1`,
        [
          order.order_id,
          execEvidence,
          evidence(`${order.order_id}:ALLOCATION:${allocation.allocatedQuantity}`),
          now,
        ],
      );
      await history(
        client,
        order.order_id,
        "ISSUANCE",
        "BATCHED",
        "T2_RISK_APPROVAL_PENDING",
        actorId,
        actorRole,
        now,
        execEvidence,
      );
      await client.query(
        "UPDATE workflows SET status='T2_RISK_APPROVAL_PENDING',updated_at=$2 WHERE workflow_id=$1",
        [order.order_id, now],
      );
    }
    await client.query(
      "UPDATE primary_batches SET status='EXECUTION_CONFIRMED',filled_quantity=$2,domestic_order_reference=$3,execution_evidence_hash=$4,updated_at=$5 WHERE batch_id=$1",
      [taskId, filledQuantity.toString(), `SIM-KRX-${taskId.slice(0, 8)}`, execEvidence, now],
    );
    await client.query(
      "UPDATE workflows SET status='COMPLETED',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    return;
  }
  const order = await client.query<{
    status: string;
    allocated_quantity: string;
    principal_id: string;
    security_id: string;
  }>(
    "SELECT status,allocated_quantity::text,principal_id,security_id FROM primary_orders WHERE order_id=$1 FOR UPDATE",
    [taskId],
  );
  const row = order.rows[0];
  if (!row) throw new Error("대상 주문이 없다.");
  const quantity = BigInt(row.allocated_quantity);
  const proof = evidence(`${taskId}:${actorRole}:${row.status}:${now.toISOString()}`);
  if (row.status === "T2_RISK_APPROVAL_PENDING" && actorRole === "T2_RISK_APPROVER") {
    const risk = await client.query<{ limit_quantity: string; used_quantity: string }>(
      "SELECT limit_quantity::text,used_quantity::text FROM t2_risk_limits WHERE security_id=$1 FOR UPDATE",
      [row.security_id],
    );
    if (
      !risk.rows[0] ||
      BigInt(risk.rows[0].used_quantity) + quantity > BigInt(risk.rows[0].limit_quantity)
    )
      throw new Error("T+2 위험한도를 초과한다.");
    await client.query(
      "UPDATE t2_risk_limits SET used_quantity=used_quantity+$2,updated_at=$3 WHERE security_id=$1",
      [row.security_id, quantity.toString(), now],
    );
    await advanceFact(
      client,
      taskId,
      "risk_approved",
      "risk_evidence_hash",
      proof,
      "RIGHTS_ENTRY_APPROVAL_PENDING",
      actorId,
      actorRole,
      now,
    );
  } else if (
    row.status === "RIGHTS_ENTRY_APPROVAL_PENDING" &&
    actorRole === "RIGHTS_ENTRY_APPROVER"
  ) {
    await advanceFact(
      client,
      taskId,
      "rights_entry_approved",
      "rights_approval_evidence_hash",
      proof,
      "RIGHTS_RECORDING_PENDING",
      actorId,
      actorRole,
      now,
    );
  } else if (
    row.status === "RIGHTS_RECORDING_PENDING" &&
    actorRole === "RIGHTS_RECORDING_CONFIRMER"
  ) {
    await client.query(
      "UPDATE primary_approval_facts SET rights_recorded=true,rights_recorded_evidence_hash=$2,updated_at=$3 WHERE order_id=$1",
      [taskId, proof, now],
    );
    await client.query(
      `INSERT INTO customer_rights_positions (principal_id,security_id,pending_quantity,settled_quantity,updated_at)
       VALUES ($1,$2,$3,0,$4) ON CONFLICT (principal_id,security_id) DO UPDATE SET pending_quantity=customer_rights_positions.pending_quantity+EXCLUDED.pending_quantity,updated_at=EXCLUDED.updated_at`,
      [row.principal_id, row.security_id, quantity.toString(), now],
    );
    await client.query(
      "UPDATE primary_orders SET status='SETTLEMENT_AND_CUSTODY_PENDING',rights_status='RIGHTS_RECORDED',token_status='PENDING_SETTLEMENT',token_transaction_hash=NULL,updated_at=$2 WHERE order_id=$1",
      [taskId, now],
    );
    await client.query(
      `UPDATE instrument_control_totals SET token_total_supply=token_total_supply+$2,updated_at=$3
       WHERE security_id=$1`,
      [row.security_id, quantity.toString(), now],
    );
    await client.query(
      "UPDATE workflows SET status='SETTLEMENT_AND_CUSTODY_PENDING',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    await history(
      client,
      taskId,
      "ISSUANCE",
      row.status,
      "SETTLEMENT_AND_CUSTODY_PENDING",
      actorId,
      actorRole,
      now,
      proof,
    );
  } else if (
    row.status === "SETTLEMENT_AND_CUSTODY_PENDING" &&
    actorRole === "DOMESTIC_SETTLEMENT_CONFIRMER"
  ) {
    await confirmSettlementSide(
      client,
      taskId,
      "domestic_settlement_confirmed",
      "settlement_evidence_hash",
      actorId,
      actorRole,
      proof,
      now,
    );
  } else if (
    row.status === "SETTLEMENT_AND_CUSTODY_PENDING" &&
    actorRole === "CUSTODY_QUANTITY_CONFIRMER"
  ) {
    await confirmSettlementSide(
      client,
      taskId,
      "custody_quantity_confirmed",
      "custody_evidence_hash",
      actorId,
      actorRole,
      proof,
      now,
    );
  } else if (
    row.status === "SETTLEMENT_AND_CUSTODY_PENDING" &&
    payload.action === "QUARANTINE_DEFAULT" &&
    actorRole === "OVERSEAS_BROKER_OPERATOR"
  ) {
    const settlementFacts = await client.query<{
      domestic_settlement_confirmed: boolean;
      custody_quantity_confirmed: boolean;
    }>(
      "SELECT domestic_settlement_confirmed,custody_quantity_confirmed FROM primary_approval_facts WHERE order_id=$1",
      [taskId],
    );
    if (
      settlementFacts.rows[0]?.domestic_settlement_confirmed ||
      settlementFacts.rows[0]?.custody_quantity_confirmed
    )
      throw new Error("일부 결제 또는 수탁 확인 뒤에는 결제불이행 경로로 전환할 수 없다.");
    await client.query(
      "UPDATE primary_orders SET status='QUARANTINED',quarantine_reason=$2,updated_at=$3 WHERE order_id=$1",
      [taskId, payload.reasonKo ?? "결제불이행 예외처리 필요", now],
    );
    await client.query(
      "UPDATE workflows SET status='QUARANTINED',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    await history(
      client,
      taskId,
      "SETTLEMENT_DEFAULT",
      row.status,
      "QUARANTINED",
      actorId,
      actorRole,
      now,
      proof,
    );
  } else if (
    row.status === "QUARANTINED" &&
    payload.action === "APPROVE_REPLACEMENT_SHARES" &&
    actorRole === "OVERSEAS_BROKER_OPERATOR"
  ) {
    await recordDefaultResolution(client, {
      taskId,
      actorId,
      resolutionType: "REPLACEMENT_SHARES",
      ...(payload.reasonKo ? { reasonKo: payload.reasonKo } : {}),
      proof,
      now,
    });
    await client.query(
      `UPDATE primary_orders SET status='SETTLEMENT_AND_CUSTODY_PENDING',default_resolution='REPLACEMENT_SHARES',
       default_resolution_evidence_hash=$2,quarantine_reason=NULL,updated_at=$3 WHERE order_id=$1`,
      [taskId, proof, now],
    );
    await client.query(
      "UPDATE workflows SET status='SETTLEMENT_AND_CUSTODY_PENDING',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    await history(
      client,
      taskId,
      "SETTLEMENT_DEFAULT",
      "QUARANTINED",
      "SETTLEMENT_AND_CUSTODY_PENDING",
      actorId,
      actorRole,
      now,
      proof,
    );
  } else if (
    row.status === "QUARANTINED" &&
    payload.action === "APPROVE_CASH_COMPENSATION" &&
    actorRole === "OVERSEAS_BROKER_OPERATOR"
  ) {
    const compensationAmount = payload.cashCompensationUsdMinor;
    if (!/^[1-9][0-9]*$/.test(compensationAmount ?? ""))
      throw new Error("기관이 승인한 현금보상 USD 센트 금액이 필요하다.");
    await recordDefaultResolution(client, {
      taskId,
      actorId,
      resolutionType: "CASH_COMPENSATION",
      cashCompensationUsdMinor: compensationAmount!,
      ...(payload.reasonKo ? { reasonKo: payload.reasonKo } : {}),
      proof,
      now,
    });
    const rightsUpdate = await client.query(
      `UPDATE customer_rights_positions SET pending_quantity=pending_quantity-$3,updated_at=$4
       WHERE principal_id=$1 AND security_id=$2 AND pending_quantity >= $3`,
      [row.principal_id, row.security_id, quantity.toString(), now],
    );
    if (rightsUpdate.rowCount !== 1) throw new Error("취소할 결제 대기 수탁권리수량이 부족하다.");
    await client.query(
      "UPDATE t2_risk_limits SET used_quantity=used_quantity-$2,updated_at=$3 WHERE security_id=$1",
      [row.security_id, quantity.toString(), now],
    );
    await client.query(
      `UPDATE instrument_control_totals SET token_total_supply=token_total_supply-$2,updated_at=$3
       WHERE security_id=$1 AND token_total_supply >= $2`,
      [row.security_id, quantity.toString(), now],
    );
    await client.query(
      `UPDATE primary_orders SET status='DEFAULT_CASH_COMPENSATION_APPROVED',token_status='PENDING_MINT_CANCELLED',
       cancelled_pending_quantity=$2,default_resolution='CASH_COMPENSATION',cash_compensation_usd_minor=$3,
       default_resolution_evidence_hash=$4,updated_at=$5 WHERE order_id=$1`,
      [taskId, quantity.toString(), compensationAmount, proof, now],
    );
    await client.query(
      "UPDATE workflows SET status='DEFAULT_CASH_COMPENSATION_APPROVED',updated_at=$2 WHERE workflow_id=$1",
      [taskId, now],
    );
    await history(
      client,
      taskId,
      "SETTLEMENT_DEFAULT",
      "QUARANTINED",
      "DEFAULT_CASH_COMPENSATION_APPROVED",
      actorId,
      actorRole,
      now,
      proof,
    );
  } else throw new Error("역할과 현재 단계가 일치하지 않는다.");
}

export async function expirePrimaryOrders(
  pool: Pool,
  throughTradingDate: string,
  now: Date,
): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(throughTradingDate))
    throw new Error("만료 기준 거래일이 올바르지 않다.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      order_id: string;
      principal_id: string;
      reserved_usd_minor: string;
      batch_id: string | null;
    }>(
      `SELECT order_id,principal_id,reserved_usd_minor::text,batch_id
       FROM primary_orders
       WHERE effective_trading_date < $1 AND status IN ('ORDER_ACCEPTED','BATCHED')
       ORDER BY effective_trading_date,accepted_at,order_id
       FOR UPDATE`,
      [throughTradingDate],
    );
    for (const order of result.rows) {
      await client.query(
        `UPDATE customer_cash_accounts SET usd_reserved_minor=usd_reserved_minor-$2,
         usd_available_minor=usd_available_minor+$2,updated_at=$3 WHERE principal_id=$1`,
        [order.principal_id, order.reserved_usd_minor, now],
      );
      await client.query(
        `UPDATE primary_orders SET status='EXPIRED',released_usd_minor=reserved_usd_minor,
         reserved_usd_minor=0,updated_at=$2 WHERE order_id=$1`,
        [order.order_id, now],
      );
      await client.query(
        "UPDATE workflows SET status='EXPIRED',updated_at=$2 WHERE workflow_id=$1",
        [order.order_id, now],
      );
      await history(
        client,
        order.order_id,
        "PRIMARY_ORDER",
        order.batch_id ? "BATCHED" : "ORDER_ACCEPTED",
        "EXPIRED",
        "system:krx-calendar",
        "SYSTEM",
        now,
      );
      if (order.batch_id)
        await client.query("DELETE FROM primary_batch_orders WHERE batch_id=$1 AND order_id=$2", [
          order.batch_id,
          order.order_id,
        ]);
    }
    const affectedBatches = [
      ...new Set(result.rows.flatMap((row) => (row.batch_id ? [row.batch_id] : []))),
    ];
    for (const batchId of affectedBatches) {
      await client.query(
        `UPDATE primary_batches SET
         requested_quantity=COALESCE((SELECT sum(share_quantity) FROM primary_orders WHERE batch_id=$1 AND status='BATCHED'),0),
         status=CASE WHEN EXISTS (SELECT 1 FROM primary_orders WHERE batch_id=$1 AND status='BATCHED') THEN 'OPEN' ELSE 'EXPIRED' END,
         updated_at=$2 WHERE batch_id=$1`,
        [batchId, now],
      );
      await client.query(
        `UPDATE workflows SET status=CASE WHEN EXISTS
         (SELECT 1 FROM primary_orders WHERE batch_id=$1 AND status='BATCHED') THEN 'AWAITING_KRX_EXECUTION' ELSE 'EXPIRED' END,
         updated_at=$2 WHERE workflow_id=$1`,
        [batchId, now],
      );
    }
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordDefaultResolution(
  client: PoolClient,
  input: {
    taskId: string;
    actorId: string;
    resolutionType: "REPLACEMENT_SHARES" | "CASH_COMPENSATION";
    cashCompensationUsdMinor?: string;
    reasonKo?: string;
    proof: string;
    now: Date;
  },
) {
  await client.query(
    `INSERT INTO primary_default_resolutions
      (resolution_id,order_id,resolution_type,cash_compensation_usd_minor,institution_reason,evidence_hash,status,approved_by,approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,'APPROVED',$7,$8)`,
    [
      randomUUID(),
      input.taskId,
      input.resolutionType,
      input.cashCompensationUsdMinor ?? null,
      input.reasonKo ?? "인가 해외 증권사가 제공한 결제불이행 처리안",
      input.proof,
      input.actorId,
      input.now,
    ],
  );
}

async function advanceFact(
  client: PoolClient,
  orderId: string,
  flag: string,
  hashColumn: string,
  proof: string,
  next: string,
  actorId: string,
  actorRole: string,
  now: Date,
) {
  const safeFlags = new Set(["risk_approved", "rights_entry_approved"]);
  const safeHashes = new Set(["risk_evidence_hash", "rights_approval_evidence_hash"]);
  if (!safeFlags.has(flag) || !safeHashes.has(hashColumn))
    throw new Error("허용되지 않은 승인 필드다.");
  const current = await client.query<{ status: string }>(
    "SELECT status FROM primary_orders WHERE order_id=$1",
    [orderId],
  );
  await client.query(
    `UPDATE primary_approval_facts SET ${flag}=true,${hashColumn}=$2,updated_at=$3 WHERE order_id=$1`,
    [orderId, proof, now],
  );
  await client.query("UPDATE primary_orders SET status=$2,updated_at=$3 WHERE order_id=$1", [
    orderId,
    next,
    now,
  ]);
  await client.query("UPDATE workflows SET status=$2,updated_at=$3 WHERE workflow_id=$1", [
    orderId,
    next,
    now,
  ]);
  await history(
    client,
    orderId,
    "ISSUANCE",
    current.rows[0]?.status ?? null,
    next,
    actorId,
    actorRole,
    now,
    proof,
  );
}

async function confirmSettlementSide(
  client: PoolClient,
  orderId: string,
  flag: string,
  hashColumn: string,
  actorId: string,
  actorRole: string,
  proof: string,
  now: Date,
) {
  const safeFlags = new Set(["domestic_settlement_confirmed", "custody_quantity_confirmed"]);
  const safeHashes = new Set(["settlement_evidence_hash", "custody_evidence_hash"]);
  if (!safeFlags.has(flag) || !safeHashes.has(hashColumn))
    throw new Error("허용되지 않은 결제 확인 필드다.");
  await client.query(
    `UPDATE primary_approval_facts SET ${flag}=true,${hashColumn}=$2,updated_at=$3 WHERE order_id=$1`,
    [orderId, proof, now],
  );
  await client.query(
    "UPDATE primary_orders SET settlement_status=$2,updated_at=$3 WHERE order_id=$1",
    [
      orderId,
      flag === "domestic_settlement_confirmed"
        ? "DOMESTIC_SETTLEMENT_CONFIRMED"
        : "CUSTODY_QUANTITY_CONFIRMED",
      now,
    ],
  );
  const facts = await client.query<{
    domestic_settlement_confirmed: boolean;
    custody_quantity_confirmed: boolean;
  }>(
    "SELECT domestic_settlement_confirmed,custody_quantity_confirmed FROM primary_approval_facts WHERE order_id=$1",
    [orderId],
  );
  if (facts.rows[0]?.domestic_settlement_confirmed && facts.rows[0]?.custody_quantity_confirmed) {
    const order = await client.query<{
      principal_id: string;
      security_id: string;
      allocated_quantity: string;
      status: string;
    }>(
      "SELECT principal_id,security_id,allocated_quantity::text,status FROM primary_orders WHERE order_id=$1 FOR UPDATE",
      [orderId],
    );
    const row = order.rows[0]!;
    if (row.status === "TRADABLE") return;
    await client.query(
      "UPDATE customer_rights_positions SET pending_quantity=pending_quantity-$3,settled_quantity=settled_quantity+$3,updated_at=$4 WHERE principal_id=$1 AND security_id=$2",
      [row.principal_id, row.security_id, row.allocated_quantity, now],
    );
    await client.query(
      "UPDATE t2_risk_limits SET used_quantity=used_quantity-$2,updated_at=$3 WHERE security_id=$1",
      [row.security_id, row.allocated_quantity, now],
    );
    await client.query(
      `UPDATE instrument_control_totals SET domestic_settled_quantity=domestic_settled_quantity+$2,updated_at=$3
       WHERE security_id=$1`,
      [row.security_id, row.allocated_quantity, now],
    );
    await client.query(
      "UPDATE primary_orders SET status='TRADABLE',token_status='TRADABLE',settlement_status='SETTLED_AND_CUSTODIED',release_transaction_hash=NULL,updated_at=$2 WHERE order_id=$1",
      [orderId, now],
    );
    await client.query(
      "UPDATE workflows SET status='COMPLETED',updated_at=$2 WHERE workflow_id=$1",
      [orderId, now],
    );
    await history(
      client,
      orderId,
      "SETTLEMENT",
      "SETTLEMENT_AND_CUSTODY_PENDING",
      "TRADABLE",
      actorId,
      actorRole,
      now,
      proof,
    );
  }
}

export async function isPrimaryWorkflow(pool: Pool, workflowId: string): Promise<boolean> {
  const result = await pool.query<{ workflow_type: string }>(
    "SELECT workflow_type FROM workflows WHERE workflow_id=$1",
    [workflowId],
  );
  return ["PRIMARY_ISSUANCE", "PRIMARY_BATCH"].includes(result.rows[0]?.workflow_type ?? "");
}

export async function acceptPrimaryAdapterEvent(
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
  const mapping: Record<string, string> = {
    "primary.execution-confirmed.v1": "EXECUTION_ALLOCATION_CONFIRMER",
    "primary.domestic-settlement-confirmed.v1": "DOMESTIC_SETTLEMENT_CONFIRMER",
    "primary.custody-confirmed.v1": "CUSTODY_QUANTITY_CONFIRMER",
  };
  const actorRole = mapping[input.eventType];
  if (!actorRole || typeof input.data.taskId !== "string")
    throw new Error("지원하지 않는 모의 기관 결과다.");
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
      "INSERT INTO inbox_messages (source_id,event_id,source_sequence,payload_hash,received_at) VALUES ($1,$2,$3,$4,$5)",
      [
        input.sourceInstitutionId,
        input.eventId,
        input.sourceSequence,
        input.payloadHash,
        input.now,
      ],
    );
    const decisionId = randomUUID();
    await client.query(
      `INSERT INTO workflows (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at) VALUES ($1,'INSTITUTION_DECISION','ACCEPTED',$2,$3,$4::jsonb,$5,$5)`,
      [decisionId, input.sourceInstitutionId, randomUUID(), JSON.stringify(input.data), input.now],
    );
    await client.query(
      `INSERT INTO outbox_messages (outbox_id,workflow_id,event_type,payload,occurred_at,available_at) VALUES ($1,$2,'PRIMARY_DECISION_REQUESTED',$3::jsonb,$4,$4)`,
      [
        randomUUID(),
        decisionId,
        JSON.stringify({ ...input.data, actorId: input.sourceInstitutionId, actorRole }),
        input.now,
      ],
    );
    await client.query(
      "UPDATE inbox_messages SET processed_at=$3 WHERE source_id=$1 AND event_id=$2",
      [input.sourceInstitutionId, input.eventId, input.now],
    );
    await client.query("COMMIT");
    return { repeated: false, workflowId: decisionId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
