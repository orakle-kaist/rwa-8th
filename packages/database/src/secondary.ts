import { createHash, randomUUID } from "node:crypto";

import {
  LOCAL_SECONDARY_NAME,
  LOCAL_SECONDARY_NORMAL_ASK_USD_MINOR,
  LOCAL_SECONDARY_POLICY,
  LOCAL_SECONDARY_REFERENCE_USD_MINOR,
  LOCAL_SECONDARY_SECURITY_ID,
  MARKET_MAKER_POSITION_LIMIT,
  assertQuoteRisk,
  computeFill,
  nextNetPosition,
  paymentAmount,
  type InvestorSide,
  type MarketMakerSide,
  type SecondaryFundingMode,
} from "@rwa/domain";
import type { Pool, PoolClient } from "pg";

import { commandHash, getCustomerReadiness, type ProjectionMetadata } from "./protection.js";
import { initializeWorkflowState, transitionWorkflowState } from "./runtime-state.js";
import { MARKET_MAKER_PRINCIPAL_ID, MARKET_MAKER_WALLET } from "./seed-secondary.js";
import { createOrNetHedgeForSecondaryTrade } from "./hedge.js";
import { getLocalChainMetadata } from "./chain-execution.js";

function projection(now: Date): ProjectionMetadata {
  return { projectionAsOf: now.toISOString(), lastEventSequence: 0, projectionStatus: "CURRENT" };
}

function hash(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

async function rollback<T>(client: PoolClient, value: T): Promise<T> {
  await client.query("ROLLBACK");
  return value;
}

async function history(
  client: PoolClient,
  orderId: string,
  previous: string | null,
  next: string,
  actorId: string,
  actorRole: string,
  now: Date,
  evidenceHash?: string,
) {
  await client.query(
    `INSERT INTO secondary_state_history
      (history_id,order_id,previous_state,new_state,actor_id,actor_role,evidence_hash,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), orderId, previous, next, actorId, actorRole, evidenceHash ?? null, now],
  );
}

export async function getLocalSecondaryScenario(pool: Pool, principalId: string, now: Date) {
  const chain = await getLocalChainMetadata(pool);
  const result = await pool.query<Record<string, unknown>>(
    `SELECT instrument.*,state.reference_usd_minor,state.information_effective_at,state.usdc_usd_ppm,
            state.half_spread_bps,state.security_loss_bps,state.portfolio_loss_bps,
            state.secondary_paused,state.usdc_paused,state.pause_reason,
            COALESCE(rights.pending_quantity,0) AS pending_quantity,
            COALESCE(rights.settled_quantity,0) AS settled_quantity,
            COALESCE(rights.secondary_reserved_quantity,0) AS secondary_reserved_quantity,
            cash.usd_available_minor,cash.usd_reserved_minor,cash.usdc_available_minor,cash.usdc_reserved_minor
     FROM local_simulation_instruments instrument
     JOIN secondary_market_state state USING (security_id)
     LEFT JOIN customer_rights_positions rights ON rights.security_id=instrument.security_id AND rights.principal_id=$2
     LEFT JOIN customer_cash_accounts cash ON cash.principal_id=$2
     WHERE instrument.security_id=$1`,
    [LOCAL_SECONDARY_SECURITY_ID, principalId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    securityId: row.security_id,
    displayName: row.display_name,
    tokenSymbol: row.token_symbol,
    tokenAddress: String(row.token_address ?? "0x0000000000000000000000000000000000009902"),
    mockUsdcAddress: chain.mockUsdcAddress,
    referenceSecurityId: row.reference_security_id,
    referenceUsdMinor: String(row.reference_usd_minor),
    normalAskUsdMinor: LOCAL_SECONDARY_NORMAL_ASK_USD_MINOR.toString(),
    informationEffectiveAt: (row.information_effective_at as Date).toISOString(),
    usdcUsd: (Number(row.usdc_usd_ppm) / 1_000_000).toFixed(4),
    halfSpreadBps: Number(row.half_spread_bps),
    secondaryEnabled: Boolean(row.secondary_enabled) && !row.secondary_paused,
    officialProduct: false,
    balances: {
      settledRights: String(row.settled_quantity),
      pendingRights: String(row.pending_quantity),
      reservedRights: String(row.secondary_reserved_quantity),
      usdAvailableMinor: String(row.usd_available_minor ?? 0),
      usdReservedMinor: String(row.usd_reserved_minor ?? 0),
      usdcAvailableMinor: String(row.usdc_available_minor ?? 0),
      usdcReservedMinor: String(row.usdc_reserved_minor ?? 0),
    },
    risk: {
      positionLimit: MARKET_MAKER_POSITION_LIMIT.toString(),
      securityLossBps: Number(row.security_loss_bps),
      portfolioLossBps: Number(row.portfolio_loss_bps),
      secondaryPaused: Boolean(row.secondary_paused),
      usdcPaused: Boolean(row.usdc_paused),
      ...(row.pause_reason ? { pauseReasonKo: row.pause_reason } : {}),
    },
    intentDomain: {
      name: "Korean Equity RWA Intent",
      version: "1",
      chainId: 31337,
      verifyingContract: chain.verifyingContract,
    },
    policyVersion: chain.policyVersion,
    notices: [
      "로컬 전용 합성 상품이며 실제 SK하이닉스 주식이나 공식 ISIN 상품이 아니다.",
      "국내 결제완료 권리만 지정 시장조성자와 거래할 수 있다.",
      "USDC 체인 교환 뒤에도 해외 증권사의 고객별 수탁권리 원장 확인이 필요하다.",
    ],
    simulation: true,
    projection: projection(now),
  };
}

export interface QuoteInput {
  quoteId: string;
  securityId: string;
  marketMakerSide: MarketMakerSide;
  fundingMode: SecondaryFundingMode;
  paymentAssetId: string;
  shareQuantity: bigint;
  unitPriceMinor: bigint;
  halfSpreadBps: number;
  nonce: bigint;
  expiresAt: Date;
  signedQuote: unknown;
}

export async function acceptMarketMakerQuote(
  pool: Pool,
  input: {
    principalId: string;
    wallet: string;
    idempotencyKey: string;
    correlationId: string;
    quote: QuoteInput;
    now: Date;
  },
) {
  const requestPayload = {
    ...input.quote,
    shareQuantity: input.quote.shareQuantity.toString(),
    unitPriceMinor: input.quote.unitPriceMinor.toString(),
    nonce: input.quote.nonce.toString(),
    expiresAt: input.quote.expiresAt.toISOString(),
  };
  const requestHash = commandHash(requestPayload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query<{ request_hash: string; workflow_id: string }>(
      "SELECT request_hash,workflow_id FROM idempotency_records WHERE principal_id=$1 AND idempotency_key=$2",
      [input.principalId, input.idempotencyKey],
    );
    if (duplicate.rows[0])
      return await rollback(
        client,
        duplicate.rows[0].request_hash === requestHash
          ? { workflowId: duplicate.rows[0].workflow_id, repeated: true as const }
          : { conflict: true as const },
      );
    if (
      input.principalId !== MARKET_MAKER_PRINCIPAL_ID ||
      input.wallet.toLowerCase() !== MARKET_MAKER_WALLET.toLowerCase() ||
      input.quote.securityId !== LOCAL_SECONDARY_SECURITY_ID
    )
      return await rollback(client, { rejected: "DESIGNATED_MARKET_MAKER_REQUIRED" as const });

    const state = await client.query<Record<string, unknown>>(
      `SELECT state.*,position.net_position,position.reserved_sell_quantity,
              position.risk_reducing_only,position.quote_direction_blocked,
              rights.settled_quantity,rights.secondary_reserved_quantity,
              cash.usd_available_minor,cash.usdc_available_minor
       FROM secondary_market_state state
       JOIN market_maker_positions position USING (security_id)
       JOIN customer_rights_positions rights ON rights.security_id=state.security_id AND rights.principal_id=position.principal_id
       JOIN customer_cash_accounts cash ON cash.principal_id=position.principal_id
       WHERE state.security_id=$1 AND position.principal_id=$2 FOR UPDATE`,
      [input.quote.securityId, input.principalId],
    );
    const row = state.rows[0];
    if (!row || row.secondary_paused)
      return await rollback(client, { rejected: "SECONDARY_TRADING_PAUSED" as const });
    if (input.quote.fundingMode === "USDC_ONCHAIN" && row.usdc_paused)
      return await rollback(client, { rejected: "USDC_PATH_PAUSED" as const });
    if (
      row.risk_reducing_only &&
      String(row.quote_direction_blocked) === input.quote.marketMakerSide
    )
      return await rollback(client, { rejected: "QUOTE_RISK_LIMIT" as const });
    const resultingPosition = nextNetPosition(
      BigInt(String(row.net_position)),
      input.quote.marketMakerSide,
      input.quote.shareQuantity,
    );
    try {
      assertQuoteRisk({
        now: input.now,
        expiresAt: input.quote.expiresAt,
        informationEffectiveAt: row.information_effective_at as Date,
        fundingMode: input.quote.fundingMode,
        usdcUsdPpm: BigInt(String(row.usdc_usd_ppm)),
        halfSpreadBps: input.quote.halfSpreadBps,
        securityLossBps: Number(row.security_loss_bps),
        portfolioLossBps: Number(row.portfolio_loss_bps),
        resultingNetPosition: resultingPosition,
      });
    } catch {
      return await rollback(client, { rejected: "QUOTE_RISK_LIMIT" as const });
    }

    const maximumAmount = paymentAmount(input.quote.unitPriceMinor, input.quote.shareQuantity);
    if (input.quote.marketMakerSide === "SELL") {
      const available =
        BigInt(String(row.settled_quantity)) - BigInt(String(row.secondary_reserved_quantity));
      if (available < input.quote.shareQuantity)
        return await rollback(client, { rejected: "SETTLED_INVENTORY_INSUFFICIENT" as const });
      await client.query(
        `UPDATE customer_rights_positions SET secondary_reserved_quantity=secondary_reserved_quantity+$3,updated_at=$4
         WHERE principal_id=$1 AND security_id=$2`,
        [
          input.principalId,
          input.quote.securityId,
          input.quote.shareQuantity.toString(),
          input.now,
        ],
      );
      await client.query(
        `UPDATE market_maker_positions SET reserved_sell_quantity=reserved_sell_quantity+$3,updated_at=$4
         WHERE principal_id=$1 AND security_id=$2`,
        [
          input.principalId,
          input.quote.securityId,
          input.quote.shareQuantity.toString(),
          input.now,
        ],
      );
    } else if (input.quote.fundingMode === "USD_LEDGER") {
      if (BigInt(String(row.usd_available_minor)) < maximumAmount)
        return await rollback(client, { rejected: "INSUFFICIENT_USD" as const });
      await client.query(
        `UPDATE customer_cash_accounts SET usd_available_minor=usd_available_minor-$2,
           usd_reserved_minor=usd_reserved_minor+$2,updated_at=$3 WHERE principal_id=$1`,
        [input.principalId, maximumAmount.toString(), input.now],
      );
      await client.query(
        `UPDATE market_maker_positions SET reserved_buy_usd_minor=reserved_buy_usd_minor+$3,updated_at=$4
         WHERE principal_id=$1 AND security_id=$2`,
        [input.principalId, input.quote.securityId, maximumAmount.toString(), input.now],
      );
    } else {
      if (BigInt(String(row.usdc_available_minor)) < maximumAmount)
        return await rollback(client, { rejected: "INSUFFICIENT_USDC" as const });
      await client.query(
        `UPDATE customer_cash_accounts SET usdc_available_minor=usdc_available_minor-$2,
           usdc_reserved_minor=usdc_reserved_minor+$2,updated_at=$3 WHERE principal_id=$1`,
        [input.principalId, maximumAmount.toString(), input.now],
      );
      await client.query(
        `UPDATE market_maker_positions SET reserved_buy_usdc_minor=reserved_buy_usdc_minor+$3,updated_at=$4
         WHERE principal_id=$1 AND security_id=$2`,
        [input.principalId, input.quote.securityId, maximumAmount.toString(), input.now],
      );
    }
    await client.query(
      `INSERT INTO workflows
        (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
       VALUES ($1,'MARKET_MAKER_QUOTE','ACTIVE',$2,$3,$4::jsonb,$5,$5)`,
      [
        input.quote.quoteId,
        input.principalId,
        input.correlationId,
        JSON.stringify(requestPayload),
        input.now,
      ],
    );
    await client.query(
      `INSERT INTO idempotency_records
        (principal_id,idempotency_key,request_hash,workflow_id,created_at) VALUES ($1,$2,$3,$4,$5)`,
      [input.principalId, input.idempotencyKey, requestHash, input.quote.quoteId, input.now],
    );
    await client.query(
      `INSERT INTO market_maker_quotes
        (quote_id,principal_id,wallet_address,security_id,market_maker_side,funding_mode,payment_asset_id,
         share_quantity,remaining_quantity,unit_price_minor,half_spread_bps,status,policy_version,nonce,
         signed_quote,published_at,expires_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,'ACTIVE',$11,$12,$13::jsonb,$14,$15,$14)`,
      [
        input.quote.quoteId,
        input.principalId,
        input.wallet.toLowerCase(),
        input.quote.securityId,
        input.quote.marketMakerSide,
        input.quote.fundingMode,
        input.quote.paymentAssetId,
        input.quote.shareQuantity.toString(),
        input.quote.unitPriceMinor.toString(),
        input.quote.halfSpreadBps,
        LOCAL_SECONDARY_POLICY,
        input.quote.nonce.toString(),
        JSON.stringify(input.quote.signedQuote),
        input.now,
        input.quote.expiresAt,
      ],
    );
    await client.query("COMMIT");
    return { workflowId: input.quote.quoteId, repeated: false as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapQuote(row: Record<string, unknown>, now: Date) {
  return {
    quoteId: row.quote_id,
    securityId: row.security_id,
    designatedMarketMaker: "지정 시장조성자",
    marketMakerSide: row.market_maker_side,
    investorSide: row.market_maker_side === "SELL" ? "BUY" : "SELL",
    fundingMode: row.funding_mode,
    paymentAssetId: row.payment_asset_id,
    tokenAddress:
      (row.signed_quote as { message?: { token?: string } } | undefined)?.message?.token ??
      "0x0000000000000000000000000000000000009902",
    shareQuantity: String(row.share_quantity),
    remainingQuantity: String(row.remaining_quantity),
    unitPrice: {
      currency: row.funding_mode === "USD_LEDGER" ? "USD" : "USDC",
      amountMinor: String(row.unit_price_minor),
      decimals: row.funding_mode === "USD_LEDGER" ? 2 : 6,
    },
    halfSpreadBps: Number(row.half_spread_bps),
    status: row.status,
    publishedAt: (row.published_at as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
    signedQuote: row.signed_quote,
    simulation: true,
    projection: projection(now),
  };
}

export async function listSecondaryQuotes(
  pool: Pool,
  input: {
    securityId: string;
    investorSide: InvestorSide;
    fundingMode: SecondaryFundingMode;
    now: Date;
  },
) {
  await expireSecondaryQuotes(pool, input.now);
  const opposite = input.investorSide === "BUY" ? "SELL" : "BUY";
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM market_maker_quotes WHERE security_id=$1 AND market_maker_side=$2 AND funding_mode=$3
       AND status IN ('ACTIVE','PARTIALLY_CONSUMED') AND expires_at>$4
     ORDER BY unit_price_minor,expires_at`,
    [input.securityId, opposite, input.fundingMode, input.now],
  );
  return {
    items: result.rows.map((row) => mapQuote(row, input.now)),
    projection: projection(input.now),
  };
}

export async function getSecondaryQuoteRecord(pool: Pool, quoteId: string) {
  const result = await pool.query<Record<string, unknown>>(
    "SELECT * FROM market_maker_quotes WHERE quote_id=$1",
    [quoteId],
  );
  return result.rows[0];
}

export interface SecondaryOrderInput {
  orderId: string;
  quoteId: string;
  shareQuantity: bigint;
  investorSide: InvestorSide;
  fundingMode: SecondaryFundingMode;
  paymentAssetId: string;
  signedIntent: unknown;
}

export async function acceptSecondaryOrder(
  pool: Pool,
  input: {
    principalId: string;
    wallet: string;
    idempotencyKey: string;
    correlationId: string;
    order: SecondaryOrderInput;
    now: Date;
  },
) {
  const requestPayload = {
    ...input.order,
    shareQuantity: input.order.shareQuantity.toString(),
  };
  const requestHash = commandHash(requestPayload);
  const hold = await pool.query(
    `SELECT 1 FROM operational_holds
     WHERE status IN ('WORK_HALTED','RELEASE_SCHEDULED')
       AND scope IN ('NEW_ORDERS','PRIMARY_AND_SECONDARY')
       AND (security_id IS NULL OR security_id=$1)
     LIMIT 1`,
    [LOCAL_SECONDARY_SECURITY_ID],
  );
  if (hold.rows.length) return { rejected: "OPERATIONAL_HOLD" as const };
  const readiness = await getCustomerReadiness(pool, input.principalId, input.now);
  if (
    !readiness?.canPlaceNewOrder ||
    readiness.activeWallet?.toLowerCase() !== input.wallet.toLowerCase()
  )
    return { rejected: "CUSTOMER_NOT_READY" as const };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const duplicate = await client.query<{ request_hash: string; workflow_id: string }>(
      "SELECT request_hash,workflow_id FROM idempotency_records WHERE principal_id=$1 AND idempotency_key=$2",
      [input.principalId, input.idempotencyKey],
    );
    if (duplicate.rows[0])
      return await rollback(
        client,
        duplicate.rows[0].request_hash === requestHash
          ? { workflowId: duplicate.rows[0].workflow_id, repeated: true as const }
          : { conflict: true as const },
      );
    const quoteResult = await client.query<Record<string, unknown>>(
      `SELECT quote.*,position.net_position,state.*
       FROM market_maker_quotes quote
       JOIN market_maker_positions position USING (security_id)
       JOIN secondary_market_state state USING (security_id)
       WHERE quote.quote_id=$1 FOR UPDATE`,
      [input.order.quoteId],
    );
    const quote = quoteResult.rows[0];
    if (!quote || !["ACTIVE", "PARTIALLY_CONSUMED"].includes(String(quote.status)))
      return await rollback(client, { rejected: "QUOTE_NOT_ACTIVE" as const });
    if ((quote.expires_at as Date).getTime() <= input.now.getTime())
      return await rollback(client, { rejected: "QUOTE_EXPIRED" as const });
    if (
      quote.security_id !== LOCAL_SECONDARY_SECURITY_ID ||
      quote.funding_mode !== input.order.fundingMode ||
      quote.payment_asset_id !== input.order.paymentAssetId ||
      (input.order.investorSide === "BUY" ? "SELL" : "BUY") !== quote.market_maker_side
    )
      return await rollback(client, { rejected: "ORDER_QUOTE_MISMATCH" as const });
    const { fillQuantity, cancelledQuantity } = computeFill(
      input.order.shareQuantity,
      BigInt(String(quote.remaining_quantity)),
    );
    const amount = paymentAmount(BigInt(String(quote.unit_price_minor)), fillQuantity);
    const requestedAmount = paymentAmount(
      BigInt(String(quote.unit_price_minor)),
      input.order.shareQuantity,
    );
    const releasedAmount = requestedAmount - amount;
    const resultingPosition = nextNetPosition(
      BigInt(String(quote.net_position)),
      quote.market_maker_side as MarketMakerSide,
      fillQuantity,
    );
    try {
      assertQuoteRisk({
        now: input.now,
        expiresAt: quote.expires_at as Date,
        informationEffectiveAt: quote.information_effective_at as Date,
        fundingMode: input.order.fundingMode,
        usdcUsdPpm: BigInt(String(quote.usdc_usd_ppm)),
        halfSpreadBps: Number(quote.half_spread_bps),
        securityLossBps: Number(quote.security_loss_bps),
        portfolioLossBps: Number(quote.portfolio_loss_bps),
        resultingNetPosition: resultingPosition,
      });
    } catch {
      return await rollback(client, { rejected: "SECONDARY_RISK_LIMIT" as const });
    }

    let rightsReserved = 0n;
    let fundsReserved = 0n;
    if (input.order.investorSide === "SELL") {
      const rights = await client.query<{
        settled_quantity: string;
        secondary_reserved_quantity: string;
      }>(
        `SELECT settled_quantity::text,secondary_reserved_quantity::text FROM customer_rights_positions
         WHERE principal_id=$1 AND security_id=$2 FOR UPDATE`,
        [input.principalId, quote.security_id],
      );
      const available = rights.rows[0]
        ? BigInt(rights.rows[0].settled_quantity) -
          BigInt(rights.rows[0].secondary_reserved_quantity)
        : 0n;
      if (available < input.order.shareQuantity)
        return await rollback(client, { rejected: "SETTLED_RIGHTS_INSUFFICIENT" as const });
      await client.query(
        `UPDATE customer_rights_positions SET secondary_reserved_quantity=secondary_reserved_quantity+$3,updated_at=$4
         WHERE principal_id=$1 AND security_id=$2`,
        [input.principalId, quote.security_id, fillQuantity.toString(), input.now],
      );
      rightsReserved = fillQuantity;
    } else {
      const cash = await client.query<{
        usd_available_minor: string;
        usdc_available_minor: string;
      }>(
        `SELECT usd_available_minor::text,usdc_available_minor::text FROM customer_cash_accounts
         WHERE principal_id=$1 FOR UPDATE`,
        [input.principalId],
      );
      const available = BigInt(
        input.order.fundingMode === "USD_LEDGER"
          ? (cash.rows[0]?.usd_available_minor ?? "0")
          : (cash.rows[0]?.usdc_available_minor ?? "0"),
      );
      if (available < requestedAmount)
        return await rollback(client, {
          rejected:
            input.order.fundingMode === "USD_LEDGER" ? "INSUFFICIENT_USD" : "INSUFFICIENT_USDC",
        } as const);
      const availableColumn =
        input.order.fundingMode === "USD_LEDGER" ? "usd_available_minor" : "usdc_available_minor";
      const reservedColumn =
        input.order.fundingMode === "USD_LEDGER" ? "usd_reserved_minor" : "usdc_reserved_minor";
      await client.query(
        `UPDATE customer_cash_accounts SET ${availableColumn}=${availableColumn}-$2,
           ${reservedColumn}=${reservedColumn}+$2,updated_at=$3 WHERE principal_id=$1`,
        [input.principalId, amount.toString(), input.now],
      );
      fundsReserved = amount;
    }

    const remaining = BigInt(String(quote.remaining_quantity)) - fillQuantity;
    const quoteStatus = remaining === 0n ? "FULLY_CONSUMED" : "PARTIALLY_CONSUMED";
    await client.query(
      "UPDATE market_maker_quotes SET remaining_quantity=$2,status=$3,updated_at=$4 WHERE quote_id=$1",
      [input.order.quoteId, remaining.toString(), quoteStatus, input.now],
    );
    await client.query(
      `INSERT INTO workflows
        (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
       VALUES ($1,'SECONDARY_TRADE','SETTLEMENT_APPROVAL_PENDING',$2,$3,$4::jsonb,$5,$5)`,
      [
        input.order.orderId,
        input.principalId,
        input.correlationId,
        JSON.stringify(requestPayload),
        input.now,
      ],
    );
    await client.query(
      `INSERT INTO idempotency_records
        (principal_id,idempotency_key,request_hash,workflow_id,created_at) VALUES ($1,$2,$3,$4,$5)`,
      [input.principalId, input.idempotencyKey, requestHash, input.order.orderId, input.now],
    );
    await client.query(
      `INSERT INTO secondary_orders
        (order_id,principal_id,investor_wallet,quote_id,security_id,investor_side,funding_mode,payment_asset_id,
         requested_quantity,fill_quantity,cancelled_quantity,unit_price_minor,payment_amount_minor,
         rights_reserved_quantity,rights_reservation_released_quantity,funds_reserved_minor,
         funds_reservation_released_minor,status,signed_intent,accepted_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               'SETTLEMENT_APPROVAL_PENDING',$18::jsonb,$19,$19)`,
      [
        input.order.orderId,
        input.principalId,
        input.wallet.toLowerCase(),
        input.order.quoteId,
        quote.security_id,
        input.order.investorSide,
        input.order.fundingMode,
        input.order.paymentAssetId,
        input.order.shareQuantity.toString(),
        fillQuantity.toString(),
        cancelledQuantity.toString(),
        String(quote.unit_price_minor),
        amount.toString(),
        rightsReserved.toString(),
        input.order.investorSide === "SELL" ? cancelledQuantity.toString() : "0",
        fundsReserved.toString(),
        input.order.investorSide === "BUY" ? releasedAmount.toString() : "0",
        JSON.stringify(input.order.signedIntent),
        input.now,
      ],
    );
    await initializeWorkflowState(client, {
      workflowId: input.order.orderId,
      axis: "SECONDARY_TRADE",
      state: "SECONDARY_ORDER_RECEIVED",
      actorId: input.principalId,
      actorRole: "INVESTOR",
      now: input.now,
    });
    await transitionWorkflowState(client, {
      workflowId: input.order.orderId,
      axis: "SECONDARY_TRADE",
      expectedState: "SECONDARY_ORDER_RECEIVED",
      nextState: "SECONDARY_PRECHECK",
      actorId: "secondary-orchestrator",
      actorRole: "PLATFORM_OPERATOR",
      now: input.now,
    });
    await transitionWorkflowState(client, {
      workflowId: input.order.orderId,
      axis: "SECONDARY_TRADE",
      expectedState: "SECONDARY_PRECHECK",
      nextState: "SECONDARY_RESERVED",
      actorId: "secondary-orchestrator",
      actorRole: "PLATFORM_OPERATOR",
      now: input.now,
    });
    await history(
      client,
      input.order.orderId,
      null,
      "SETTLEMENT_APPROVAL_PENDING",
      input.principalId,
      "INVESTOR",
      input.now,
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

function mapSecondaryOrder(row: Record<string, unknown>, now: Date) {
  return {
    orderId: row.order_id,
    principalId: row.principal_id,
    quoteId: row.quote_id,
    securityId: row.security_id,
    investorSide: row.investor_side,
    fundingMode: row.funding_mode,
    investorWallet: row.investor_wallet,
    marketMakerWallet: row.market_maker_wallet,
    paymentAssetId: row.payment_asset_id,
    tokenAddress:
      (row.signed_intent as { message?: { token?: string } } | undefined)?.message?.token ??
      "0x0000000000000000000000000000000000009902",
    investorIntentMessage: (row.signed_intent as { message?: unknown } | undefined)?.message,
    marketMakerQuoteMessage: (row.signed_quote as { message?: unknown } | undefined)?.message,
    requestedQuantity: String(row.requested_quantity),
    fillQuantity: String(row.fill_quantity),
    cancelledQuantity: String(row.cancelled_quantity),
    unitPriceMinor: String(row.unit_price_minor),
    paymentAmountMinor: String(row.payment_amount_minor),
    rightsReservedQuantity: String(row.rights_reserved_quantity),
    rightsReservationReleasedQuantity: String(row.rights_reservation_released_quantity),
    fundsReservedMinor: String(row.funds_reserved_minor),
    fundsReservationReleasedMinor: String(row.funds_reservation_released_minor),
    rightsFinalized: Boolean(row.rights_finalized),
    fundsFinalized: Boolean(row.funds_finalized),
    chainFinalized: Boolean(row.chain_finalized),
    status: row.status,
    ...(row.chain_transaction_hash ? { chainTransactionHash: row.chain_transaction_hash } : {}),
    ...(row.quarantine_reason ? { quarantineReason: row.quarantine_reason } : {}),
    acceptedAt: (row.accepted_at as Date).toISOString(),
    simulation: true,
    projection: projection(now),
  };
}

export async function listSecondaryOrders(
  pool: Pool,
  principalId: string,
  role: string,
  now: Date,
) {
  const result =
    role === "INVESTOR"
      ? await pool.query(
          `SELECT orders.*,quotes.wallet_address AS market_maker_wallet,quotes.signed_quote
           FROM secondary_orders orders JOIN market_maker_quotes quotes USING (quote_id)
           WHERE orders.principal_id=$1 ORDER BY orders.accepted_at`,
          [principalId],
        )
      : await pool.query(
          `SELECT orders.*,quotes.wallet_address AS market_maker_wallet,quotes.signed_quote
           FROM secondary_orders orders JOIN market_maker_quotes quotes USING (quote_id)
           ORDER BY orders.accepted_at`,
        );
  return {
    items: result.rows.map((row) => mapSecondaryOrder(row, now)),
    projection: projection(now),
  };
}

export async function listMarketMakerPositions(pool: Pool, now: Date) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT position.*,rights.settled_quantity,rights.secondary_reserved_quantity,
            cash.usd_available_minor,cash.usd_reserved_minor,cash.usdc_available_minor,cash.usdc_reserved_minor,
            state.security_loss_bps,state.portfolio_loss_bps,state.secondary_paused,state.usdc_paused,state.pause_reason
     FROM market_maker_positions position
     JOIN customer_rights_positions rights USING (principal_id,security_id)
     JOIN customer_cash_accounts cash USING (principal_id)
     JOIN secondary_market_state state USING (security_id)
     ORDER BY position.security_id`,
  );
  return {
    items: result.rows.map((row) => ({
      securityId: row.security_id,
      settledInventory: String(row.settled_quantity),
      pendingInventory: String(row.pending_quantity),
      reservedInventory: String(row.secondary_reserved_quantity),
      netPosition: String(row.net_position),
      nextSessionStartingInventory: String(row.next_session_starting_quantity),
      riskReducingOnly: Boolean(row.risk_reducing_only),
      ...(row.quote_direction_blocked
        ? { quoteDirectionBlocked: row.quote_direction_blocked }
        : {}),
      ...(row.hedge_hold_reason ? { hedgeHoldReasonKo: row.hedge_hold_reason } : {}),
      positionLimit: MARKET_MAKER_POSITION_LIMIT.toString(),
      usdAvailableMinor: String(row.usd_available_minor),
      usdReservedMinor: String(row.usd_reserved_minor),
      usdcAvailableMinor: String(row.usdc_available_minor),
      usdcReservedMinor: String(row.usdc_reserved_minor),
      securityLossBps: Number(row.security_loss_bps),
      portfolioLossBps: Number(row.portfolio_loss_bps),
      secondaryPaused: Boolean(row.secondary_paused),
      usdcPaused: Boolean(row.usdc_paused),
      ...(row.pause_reason ? { pauseReasonKo: row.pause_reason } : {}),
      simulation: true,
    })),
    projection: projection(now),
  };
}

export async function decideSecondarySettlement(
  pool: Pool,
  input: {
    orderId: string;
    actorId: string;
    actorRole: string;
    decision: "APPROVE" | "REJECT" | "REQUEST_CORRECTION";
    signedApproval?: unknown;
    now: Date;
  },
) {
  if (input.actorRole !== "OVERSEAS_BROKER_OPERATOR")
    throw new Error("인가 해외 증권사만 정산을 승인할 수 있다.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Record<string, unknown>>(
      `SELECT orders.*,quotes.principal_id AS market_maker_id,quotes.market_maker_side
       FROM secondary_orders orders JOIN market_maker_quotes quotes USING (quote_id)
       WHERE orders.order_id=$1 FOR UPDATE`,
      [input.orderId],
    );
    const order = result.rows[0];
    if (!order) throw new Error("24시간 거래 주문이 없다.");
    if (order.status === "QUARANTINED" && input.decision === "APPROVE") {
      await client.query(
        "UPDATE secondary_orders SET status='LEDGER_RETRY_PENDING',updated_at=$2 WHERE order_id=$1",
        [input.orderId, input.now],
      );
      await client.query(
        "UPDATE workflows SET status='LEDGER_RETRY_PENDING',updated_at=$2 WHERE workflow_id=$1",
        [input.orderId, input.now],
      );
      await enqueue(
        client,
        input.orderId,
        "SECONDARY_LEDGER_RETRY_REQUESTED",
        { orderId: input.orderId },
        input.now,
      );
      await client.query("COMMIT");
      return;
    }
    if (order.status !== "SETTLEMENT_APPROVAL_PENDING")
      throw new Error("정산 승인 대기 주문이 아니다.");
    if (input.decision !== "APPROVE") {
      await releaseOrderReservations(client, order, input.now, true);
      await client.query(
        "UPDATE secondary_orders SET status='REJECTED',updated_at=$2 WHERE order_id=$1",
        [input.orderId, input.now],
      );
      await client.query(
        "UPDATE workflows SET status='REJECTED',updated_at=$2 WHERE workflow_id=$1",
        [input.orderId, input.now],
      );
      await history(
        client,
        input.orderId,
        String(order.status),
        "REJECTED",
        input.actorId,
        input.actorRole,
        input.now,
      );
      await client.query("COMMIT");
      return;
    }
    if (!input.signedApproval) throw new Error("해외 증권사의 서명된 정산 승인이 필요하다.");
    await client.query(
      `UPDATE secondary_orders SET signed_broker_approval=$2::jsonb,status='CHAIN_EXECUTION_PENDING',updated_at=$3
       WHERE order_id=$1`,
      [input.orderId, JSON.stringify(input.signedApproval), input.now],
    );
    await client.query(
      "UPDATE workflows SET status='CHAIN_EXECUTION_PENDING',updated_at=$2 WHERE workflow_id=$1",
      [input.orderId, input.now],
    );
    await enqueue(
      client,
      input.orderId,
      "SECONDARY_CHAIN_EXECUTION_REQUESTED",
      { orderId: input.orderId },
      input.now,
    );
    await history(
      client,
      input.orderId,
      String(order.status),
      "CHAIN_EXECUTION_PENDING",
      input.actorId,
      input.actorRole,
      input.now,
      hash(`${input.orderId}:BROKER_APPROVAL`),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function enqueue(
  client: PoolClient,
  workflowId: string,
  eventType: string,
  payload: unknown,
  now: Date,
) {
  await client.query(
    `INSERT INTO outbox_messages (outbox_id,workflow_id,event_type,payload,occurred_at,available_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$5)`,
    [randomUUID(), workflowId, eventType, JSON.stringify(payload), now],
  );
}

export async function getSecondaryExecutionPayload(pool: Pool, orderId: string) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT orders.*,quotes.signed_quote,quotes.wallet_address AS market_maker_wallet,
            quotes.market_maker_side,quotes.nonce AS quote_nonce
     FROM secondary_orders orders JOIN market_maker_quotes quotes USING (quote_id)
     WHERE orders.order_id=$1`,
    [orderId],
  );
  return result.rows[0];
}

export async function completeSecondaryChainExecution(
  pool: Pool,
  input: {
    orderId: string;
    transactionHash: string;
    now: Date;
    simulateLedgerFailure?: boolean;
  },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Record<string, unknown>>(
      `SELECT orders.*,quotes.principal_id AS market_maker_id,quotes.market_maker_side
       FROM secondary_orders orders JOIN market_maker_quotes quotes USING (quote_id)
       WHERE orders.order_id=$1 FOR UPDATE`,
      [input.orderId],
    );
    const order = result.rows[0];
    if (!order) throw new Error("정산할 주문이 없다.");
    if (order.status === "COMPLETED") {
      await client.query("COMMIT");
      return;
    }
    await client.query(
      `UPDATE secondary_orders SET chain_finalized=true,chain_transaction_hash=$2,status='RIGHTS_LEDGER_CONFIRMATION_PENDING',updated_at=$3
       WHERE order_id=$1`,
      [input.orderId, input.transactionHash, input.now],
    );
    await client.query("SAVEPOINT before_rights_ledger");
    try {
      if (input.simulateLedgerFailure) throw new Error("모의 권리 원장 반영 실패");
      await finalizeLedger(client, order, input.now);
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT before_rights_ledger");
      await quarantine(client, input.orderId, "CHAIN_SUCCESS_RIGHTS_LEDGER_FAILED", input.now);
      await attempt(
        client,
        input.orderId,
        "CHAIN_CONFIRMED",
        "QUARANTINED",
        input.transactionHash,
        input.now,
      );
      await client.query("COMMIT");
      return;
    }
    await client.query(
      `UPDATE secondary_orders SET rights_finalized=true,funds_finalized=true,status='COMPLETED',updated_at=$2
       WHERE order_id=$1`,
      [input.orderId, input.now],
    );
    await client.query(
      "UPDATE workflows SET status='COMPLETED',updated_at=$2 WHERE workflow_id=$1",
      [input.orderId, input.now],
    );
    await attempt(
      client,
      input.orderId,
      "CHAIN_AND_LEDGER",
      "COMPLETED",
      input.transactionHash,
      input.now,
    );
    await history(
      client,
      input.orderId,
      "CHAIN_EXECUTION_PENDING",
      "COMPLETED",
      "secondary-worker",
      "PLATFORM_OPERATOR",
      input.now,
      input.transactionHash,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function retrySecondaryLedgerFinalization(pool: Pool, orderId: string, now: Date) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Record<string, unknown>>(
      `SELECT orders.*,quotes.principal_id AS market_maker_id,quotes.market_maker_side
       FROM secondary_orders orders JOIN market_maker_quotes quotes USING (quote_id)
       WHERE orders.order_id=$1 FOR UPDATE`,
      [orderId],
    );
    const order = result.rows[0];
    if (
      !order?.chain_finalized ||
      !["QUARANTINED", "LEDGER_RETRY_PENDING"].includes(String(order.status))
    )
      throw new Error("장부 재처리 가능한 격리 주문이 아니다.");
    await finalizeLedger(client, order, now);
    await client.query(
      `UPDATE secondary_orders SET rights_finalized=true,funds_finalized=true,status='COMPLETED',
         quarantine_reason=NULL,updated_at=$2 WHERE order_id=$1`,
      [orderId, now],
    );
    await client.query(
      "UPDATE workflows SET status='COMPLETED',updated_at=$2 WHERE workflow_id=$1",
      [orderId, now],
    );
    await attempt(
      client,
      orderId,
      "LEDGER_RETRY",
      "COMPLETED",
      String(order.chain_transaction_hash),
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

export async function failSecondaryBeforeChain(
  pool: Pool,
  orderId: string,
  reason: string,
  now: Date,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Record<string, unknown>>(
      `SELECT orders.*,quotes.principal_id AS market_maker_id,quotes.market_maker_side
       FROM secondary_orders orders JOIN market_maker_quotes quotes USING (quote_id)
       WHERE orders.order_id=$1 FOR UPDATE`,
      [orderId],
    );
    const order = result.rows[0];
    if (!order || order.chain_finalized) throw new Error("자동 원복할 수 없는 주문이다.");
    await releaseOrderReservations(client, order, now, false);
    await client.query(
      "UPDATE secondary_orders SET status='ROLLED_BACK',quarantine_reason=$2,updated_at=$3 WHERE order_id=$1",
      [orderId, reason, now],
    );
    await client.query(
      "UPDATE workflows SET status='ROLLED_BACK',updated_at=$2 WHERE workflow_id=$1",
      [orderId, now],
    );
    await attempt(client, orderId, "BEFORE_CHAIN", "ROLLED_BACK", null, now, reason);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finalizeLedger(client: PoolClient, order: Record<string, unknown>, now: Date) {
  const quantity = BigInt(String(order.fill_quantity));
  const amount = BigInt(String(order.payment_amount_minor));
  const marketMakerId = String(order.market_maker_id);
  const investorId = String(order.principal_id);
  const investorBuys = order.investor_side === "BUY";
  const sellerId = investorBuys ? marketMakerId : investorId;
  const buyerId = investorBuys ? investorId : marketMakerId;
  await client.query(
    `UPDATE customer_rights_positions SET settled_quantity=settled_quantity-$3,
       secondary_reserved_quantity=secondary_reserved_quantity-$3,updated_at=$4
     WHERE principal_id=$1 AND security_id=$2 AND settled_quantity-secondary_reserved_quantity+$3 >= $3`,
    [sellerId, order.security_id, quantity.toString(), now],
  );
  await client.query(
    `INSERT INTO customer_rights_positions
      (principal_id,security_id,pending_quantity,settled_quantity,secondary_reserved_quantity,updated_at)
     VALUES ($1,$2,0,$3,0,$4)
     ON CONFLICT (principal_id,security_id) DO UPDATE SET settled_quantity=customer_rights_positions.settled_quantity+$3,updated_at=$4`,
    [buyerId, order.security_id, quantity.toString(), now],
  );
  const availableColumn =
    order.funding_mode === "USD_LEDGER" ? "usd_available_minor" : "usdc_available_minor";
  const reservedColumn =
    order.funding_mode === "USD_LEDGER" ? "usd_reserved_minor" : "usdc_reserved_minor";
  const payerId = investorBuys ? investorId : marketMakerId;
  const receiverId = investorBuys ? marketMakerId : investorId;
  await client.query(
    `UPDATE customer_cash_accounts SET ${reservedColumn}=${reservedColumn}-$2,updated_at=$3 WHERE principal_id=$1`,
    [payerId, amount.toString(), now],
  );
  await client.query(
    `UPDATE customer_cash_accounts SET ${availableColumn}=${availableColumn}+$2,updated_at=$3 WHERE principal_id=$1`,
    [receiverId, amount.toString(), now],
  );
  const positionDelta = order.market_maker_side === "BUY" ? quantity : -quantity;
  await client.query(
    `UPDATE market_maker_positions SET net_position=net_position+$3,
       reserved_sell_quantity=GREATEST(0,reserved_sell_quantity-$4),
       reserved_buy_usd_minor=GREATEST(0,reserved_buy_usd_minor-$5),
       reserved_buy_usdc_minor=GREATEST(0,reserved_buy_usdc_minor-$6),updated_at=$7
     WHERE principal_id=$1 AND security_id=$2`,
    [
      marketMakerId,
      order.security_id,
      positionDelta.toString(),
      order.market_maker_side === "SELL" ? quantity.toString() : "0",
      order.market_maker_side === "BUY" && order.funding_mode === "USD_LEDGER"
        ? amount.toString()
        : "0",
      order.market_maker_side === "BUY" && order.funding_mode === "USDC_ONCHAIN"
        ? amount.toString()
        : "0",
      now,
    ],
  );
  await createOrNetHedgeForSecondaryTrade(client, {
    secondaryOrderId: String(order.order_id),
    securityId: String(order.security_id),
    signedPositionDelta: positionDelta,
    completedAt: now,
  });
}

async function releaseOrderReservations(
  client: PoolClient,
  order: Record<string, unknown>,
  now: Date,
  restoreQuote: boolean,
) {
  const quantity = BigInt(String(order.fill_quantity));
  const amount = BigInt(String(order.payment_amount_minor));
  const marketMakerId = String(order.market_maker_id ?? MARKET_MAKER_PRINCIPAL_ID);
  if (order.investor_side === "SELL") {
    await client.query(
      `UPDATE customer_rights_positions SET secondary_reserved_quantity=secondary_reserved_quantity-$3,updated_at=$4
       WHERE principal_id=$1 AND security_id=$2`,
      [order.principal_id, order.security_id, quantity.toString(), now],
    );
  } else {
    const availableColumn =
      order.funding_mode === "USD_LEDGER" ? "usd_available_minor" : "usdc_available_minor";
    const reservedColumn =
      order.funding_mode === "USD_LEDGER" ? "usd_reserved_minor" : "usdc_reserved_minor";
    await client.query(
      `UPDATE customer_cash_accounts SET ${reservedColumn}=${reservedColumn}-$2,
         ${availableColumn}=${availableColumn}+$2,updated_at=$3 WHERE principal_id=$1`,
      [order.principal_id, amount.toString(), now],
    );
  }
  if (restoreQuote) {
    await client.query(
      `UPDATE market_maker_quotes SET remaining_quantity=remaining_quantity+$2,status='ACTIVE',updated_at=$3
       WHERE quote_id=$1 AND expires_at>$3`,
      [order.quote_id, quantity.toString(), now],
    );
  }
  // The quote-side reservation remains for an active restored quote and is released otherwise by expiry.
  if (!restoreQuote)
    await releaseConsumedQuoteReservation(client, order, marketMakerId, quantity, amount, now);
}

async function releaseConsumedQuoteReservation(
  client: PoolClient,
  order: Record<string, unknown>,
  marketMakerId: string,
  quantity: bigint,
  amount: bigint,
  now: Date,
) {
  if (order.market_maker_side === "SELL") {
    await client.query(
      `UPDATE customer_rights_positions SET secondary_reserved_quantity=secondary_reserved_quantity-$3,updated_at=$4
       WHERE principal_id=$1 AND security_id=$2`,
      [marketMakerId, order.security_id, quantity.toString(), now],
    );
    await client.query(
      `UPDATE market_maker_positions SET reserved_sell_quantity=reserved_sell_quantity-$3,updated_at=$4
       WHERE principal_id=$1 AND security_id=$2`,
      [marketMakerId, order.security_id, quantity.toString(), now],
    );
  } else {
    const availableColumn =
      order.funding_mode === "USD_LEDGER" ? "usd_available_minor" : "usdc_available_minor";
    const reservedColumn =
      order.funding_mode === "USD_LEDGER" ? "usd_reserved_minor" : "usdc_reserved_minor";
    await client.query(
      `UPDATE customer_cash_accounts SET ${reservedColumn}=${reservedColumn}-$2,
         ${availableColumn}=${availableColumn}+$2,updated_at=$3 WHERE principal_id=$1`,
      [marketMakerId, amount.toString(), now],
    );
  }
}

async function quarantine(client: PoolClient, orderId: string, reason: string, now: Date) {
  await client.query(
    "UPDATE secondary_orders SET status='QUARANTINED',quarantine_reason=$2,updated_at=$3 WHERE order_id=$1",
    [orderId, reason, now],
  );
  await client.query(
    "UPDATE workflows SET status='QUARANTINED',updated_at=$2 WHERE workflow_id=$1",
    [orderId, now],
  );
}

async function attempt(
  client: PoolClient,
  orderId: string,
  stage: string,
  outcome: string,
  transactionHash: string | null,
  now: Date,
  errorCode?: string,
) {
  const count = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM secondary_settlement_attempts WHERE order_id=$1",
    [orderId],
  );
  const number = Number(count.rows[0]?.count ?? "0") + 1;
  await client.query(
    `INSERT INTO secondary_settlement_attempts
      (attempt_id,order_id,attempt_number,stage,outcome,chain_transaction_hash,error_code,evidence_hash,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      orderId,
      number,
      stage,
      outcome,
      transactionHash,
      errorCode ?? null,
      hash(`${orderId}:${stage}:${number}`),
      now,
    ],
  );
}

export async function expireSecondaryQuotes(pool: Pool, now: Date) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const expired = await client.query<Record<string, unknown>>(
      `SELECT * FROM market_maker_quotes WHERE status IN ('ACTIVE','PARTIALLY_CONSUMED') AND expires_at<=$1 FOR UPDATE`,
      [now],
    );
    for (const quote of expired.rows) {
      const remaining = BigInt(String(quote.remaining_quantity));
      if (remaining > 0n) {
        const pseudoOrder = {
          market_maker_side: quote.market_maker_side,
          funding_mode: quote.funding_mode,
          security_id: quote.security_id,
        };
        await releaseConsumedQuoteReservation(
          client,
          pseudoOrder,
          String(quote.principal_id),
          remaining,
          paymentAmount(BigInt(String(quote.unit_price_minor)), remaining),
          now,
        );
      }
      await client.query(
        "UPDATE market_maker_quotes SET status='EXPIRED',updated_at=$2 WHERE quote_id=$1",
        [quote.quote_id, now],
      );
      await client.query(
        "UPDATE workflows SET status='EXPIRED',updated_at=$2 WHERE workflow_id=$1",
        [quote.quote_id, now],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function isSecondaryWorkflow(pool: Pool, workflowId: string): Promise<boolean> {
  const result = await pool.query<{ workflow_type: string }>(
    "SELECT workflow_type FROM workflows WHERE workflow_id=$1",
    [workflowId],
  );
  return result.rows[0]?.workflow_type === "SECONDARY_TRADE";
}

export async function secondaryTotals(pool: Pool) {
  const rights = await pool.query<{ settled: string; pending: string; reserved: string }>(
    `SELECT COALESCE(sum(settled_quantity),0)::text AS settled,
            COALESCE(sum(pending_quantity),0)::text AS pending,
            COALESCE(sum(secondary_reserved_quantity),0)::text AS reserved
     FROM customer_rights_positions WHERE security_id=$1`,
    [LOCAL_SECONDARY_SECURITY_ID],
  );
  return rights.rows[0];
}

export class SecondaryRpcUncertainError extends Error {
  constructor(
    message: string,
    readonly transactionHash: string,
  ) {
    super(message);
    this.name = "SecondaryRpcUncertainError";
  }
}

async function recordSecondaryRpcUncertainty(
  pool: Pool,
  orderId: string,
  transactionHash: string,
  reason: string,
  now: Date,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE secondary_orders SET status='RPC_CONFIRMATION_PENDING',chain_transaction_hash=$2,
         quarantine_reason=$3,updated_at=$4 WHERE order_id=$1 AND chain_finalized=false`,
      [orderId, transactionHash, reason, now],
    );
    await client.query(
      "UPDATE workflows SET status='RPC_CONFIRMATION_PENDING',updated_at=$2 WHERE workflow_id=$1",
      [orderId, now],
    );
    await attempt(
      client,
      orderId,
      "RPC_RESPONSE_LOST",
      "CONFIRMATION_PENDING",
      transactionHash,
      now,
      reason,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveSecondaryRpcUncertainty(
  pool: Pool,
  input: { orderId: string; transactionHash: string; confirmed: boolean; now: Date },
) {
  const current = await pool.query<{ status: string; chain_transaction_hash: string | null }>(
    "SELECT status,chain_transaction_hash FROM secondary_orders WHERE order_id=$1",
    [input.orderId],
  );
  const order = current.rows[0];
  if (
    order?.status !== "RPC_CONFIRMATION_PENDING" ||
    order.chain_transaction_hash?.toLowerCase() !== input.transactionHash.toLowerCase()
  )
    throw new Error("RPC 확인 대기 주문과 거래해시가 일치하지 않는다.");
  if (input.confirmed) {
    await completeSecondaryChainExecution(pool, {
      orderId: input.orderId,
      transactionHash: input.transactionHash,
      now: input.now,
    });
  } else {
    await failSecondaryBeforeChain(pool, input.orderId, "CHAIN_TRANSACTION_REVERTED", input.now);
  }
}

export async function processSecondaryOutbox(
  pool: Pool,
  message: { outboxId: string; workflowId: string; eventType: string; payload: unknown },
  now: Date,
  executeChain: (payload: Record<string, unknown>) => Promise<string>,
): Promise<boolean> {
  if (message.eventType === "SECONDARY_LEDGER_RETRY_REQUESTED") {
    await retrySecondaryLedgerFinalization(pool, message.workflowId, now);
    await pool.query(
      "UPDATE outbox_messages SET delivered_at=$2,last_error=NULL WHERE outbox_id=$1",
      [message.outboxId, now],
    );
    return true;
  }
  if (message.eventType !== "SECONDARY_CHAIN_EXECUTION_REQUESTED") return false;
  const payload = await getSecondaryExecutionPayload(pool, message.workflowId);
  if (!payload) throw new Error("체인 실행할 24시간 주문이 없다.");
  try {
    const transactionHash = await executeChain(payload);
    await completeSecondaryChainExecution(pool, {
      orderId: message.workflowId,
      transactionHash,
      now,
      simulateLedgerFailure: Boolean(
        (message.payload as { simulateLedgerFailure?: boolean })?.simulateLedgerFailure,
      ),
    });
    await pool.query(
      "UPDATE outbox_messages SET delivered_at=$2,last_error=NULL WHERE outbox_id=$1",
      [message.outboxId, now],
    );
  } catch (error) {
    if (error instanceof SecondaryRpcUncertainError) {
      await recordSecondaryRpcUncertainty(
        pool,
        message.workflowId,
        error.transactionHash,
        error.message,
        now,
      );
    } else {
      await failSecondaryBeforeChain(
        pool,
        message.workflowId,
        error instanceof Error ? error.message : "SECONDARY_CHAIN_EXECUTION_FAILED",
        now,
      );
    }
    await pool.query(
      "UPDATE outbox_messages SET delivered_at=$2,last_error=$3 WHERE outbox_id=$1",
      [message.outboxId, now, error instanceof Error ? error.message : "unknown"],
    );
  }
  return true;
}

export { LOCAL_SECONDARY_NAME, LOCAL_SECONDARY_REFERENCE_USD_MINOR };
