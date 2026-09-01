import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export async function submitMockInstitutionCommand(input: {
  path:
    | "domestic-orders"
    | "funding-requests"
    | "settlement-inquiries"
    | "custody-inquiries"
    | "rights-actions";
  workflowId: string;
  commandType: string;
  data: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string;
  now: Date;
}) {
  const base = process.env.MOCK_INSTITUTIONS_URL;
  if (!base) return false;
  const response = await fetch(`${base.replace(/\/$/, "")}/mock/v1/${input.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-synthetic-adapter",
      "idempotency-key": input.idempotencyKey,
      "x-correlation-id": input.correlationId ?? randomUUID(),
    },
    body: JSON.stringify({
      commandId: randomUUID(),
      workflowId: input.workflowId,
      commandType: input.commandType,
      requestedAt: input.now.toISOString(),
      simulation: true,
      data: { ...input.data, simulation: true },
    }),
  });
  if (!response.ok) throw new Error(`모의 기관 요청 접수 실패: ${response.status}`);
  return true;
}

/**
 * 모의 헤지 결과는 실제 기관처럼 한 단계씩 되돌려준다. 여러 결과를 한꺼번에
 * 보내면 동일 기준시각의 발송함 순서가 뒤바뀔 수 있으므로 현재 확정 상태에서
 * 다음 한 건만 멱등하게 요청한다.
 */
export async function dispatchNextHedgeMockResult(pool: Pool, hedgeId: string, now: Date) {
  if (!process.env.MOCK_INSTITUTIONS_URL) return false;
  const result = await pool.query<{
    status: string;
    direction: "BUY" | "SELL";
    requested_quantity: string;
    filled_quantity: string;
    target_trading_date: Date | string;
    domestic_settlement_confirmed: boolean;
    custody_quantity_confirmed: boolean;
    rights_terminated: boolean;
    usd_payment_confirmed: boolean;
  }>("SELECT * FROM market_maker_hedges WHERE hedge_id=$1", [hedgeId]);
  const hedge = result.rows[0];
  if (!hedge) return false;
  const tradingDate =
    hedge.target_trading_date instanceof Date
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(hedge.target_trading_date)
      : String(hedge.target_trading_date).slice(0, 10);

  if (hedge.status === "HEDGE_KRX_OPEN_PENDING")
    return submitMockInstitutionCommand({
      path: "domestic-orders",
      workflowId: hedgeId,
      commandType: "HEDGE_EXECUTION",
      data: {
        hedgeId,
        resultEventType: "market-maker.hedge.execution-confirmed.v1",
        tradingDate,
        filledQuantity: hedge.requested_quantity,
        domesticOrderReference: `SIM-KRX-HEDGE-${hedgeId.slice(0, 8)}`,
      },
      idempotencyKey: `${hedgeId}:HEDGE_EXECUTION`,
      now,
    });

  if (hedge.status !== "HEDGE_T2_PENDING") return false;
  if (!hedge.domestic_settlement_confirmed)
    return submitMockInstitutionCommand({
      path: "settlement-inquiries",
      workflowId: hedgeId,
      commandType: "HEDGE_SETTLEMENT",
      data: {
        hedgeId,
        resultEventType: "market-maker.hedge.domestic-settlement-confirmed.v1",
        settledQuantity: hedge.filled_quantity,
      },
      idempotencyKey: `${hedgeId}:HEDGE_SETTLEMENT`,
      now,
    });
  if (hedge.direction === "BUY" && !hedge.custody_quantity_confirmed)
    return submitMockInstitutionCommand({
      path: "custody-inquiries",
      workflowId: hedgeId,
      commandType: "HEDGE_CUSTODY",
      data: {
        hedgeId,
        resultEventType: "market-maker.hedge.custody-confirmed.v1",
        custodyQuantity: hedge.filled_quantity,
      },
      idempotencyKey: `${hedgeId}:HEDGE_CUSTODY`,
      now,
    });
  if (hedge.direction === "SELL" && hedge.rights_terminated && !hedge.usd_payment_confirmed)
    return submitMockInstitutionCommand({
      path: "funding-requests",
      workflowId: hedgeId,
      commandType: "HEDGE_USD_PAYMENT",
      data: {
        hedgeId,
        resultEventType: "market-maker.hedge.usd-paid.v1",
      },
      idempotencyKey: `${hedgeId}:HEDGE_USD_PAYMENT`,
      now,
    });
  return false;
}
