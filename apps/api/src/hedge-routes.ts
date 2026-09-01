import { randomUUID } from "node:crypto";

import {
  MARKET_MAKER_PRINCIPAL_ID,
  MARKET_MAKER_WALLET,
  decideMarketMakerHedge,
  getMarketMakerHedge,
  listMarketMakerHedges,
} from "@rwa/database";
import {
  LOCAL_SECONDARY_POLICY,
  LOCAL_SECONDARY_SECURITY_ID,
  authenticateDemoBearer,
  type Clock,
} from "@rwa/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { getAddress, keccak256, toHex, verifyTypedData } from "viem";

const primaryTypes = {
  PrimaryOrderIntent: [
    { name: "orderId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "securityId", type: "string" },
    { name: "shareQuantity", type: "uint256" },
    { name: "krwLimitPrice", type: "uint256" },
    { name: "targetTradingDate", type: "string" },
    { name: "fundingMode", type: "string" },
    { name: "fundingAmountMinor", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;

const redemptionTypes = {
  RedemptionIntent: [
    { name: "redemptionId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "token", type: "address" },
    { name: "shareQuantity", type: "uint256" },
    { name: "krwLimitPrice", type: "uint256" },
    { name: "targetTradingDate", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;

function fail(reply: FastifyReply, status: number, code: string, messageKo: string) {
  return reply.status(status).send({
    code,
    messageKo,
    retryable: false,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    responsibleRole: "OVERSEAS_BROKER_OPERATOR",
    nextActionKo: "헤지 상태, 역할과 서명값을 확인한다.",
    simulation: true,
  });
}

function headers(request: FastifyRequest, reply: FastifyReply) {
  const idempotencyKey = request.headers["idempotency-key"];
  const correlationId = request.headers["x-correlation-id"];
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 16 ||
    typeof correlationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(correlationId)
  ) {
    fail(reply, 422, "INPUT_VALIDATION_FAILED", "멱등키와 상관관계 ID가 필요하다.");
    return undefined;
  }
  return { idempotencyKey, correlationId };
}

function uuidToBytes16(value: string): `0x${string}` {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) throw new Error("헤지 UUID가 올바르지 않다.");
  return `0x${compact}`;
}

function typedMessage(value: unknown): Record<string, string> {
  const message = (value as { message?: Record<string, string> } | undefined)?.message;
  if (!message) throw new Error("시장조성자의 서명된 헤지 주문이 없다.");
  return message;
}

async function validateHedgeIntent(input: {
  signedIntent: unknown;
  direction: string;
  hedgeId: string;
  quantity: string;
  targetTradingDate: string;
  krwLimitPrice: string;
  now: Date;
}) {
  const signed = input.signedIntent as {
    primaryType?: string;
    message?: Record<string, string>;
    signature?: `0x${string}`;
    domain?: {
      name?: string;
      version?: string;
      chainId?: number;
      verifyingContract?: `0x${string}`;
    };
  };
  const message = typedMessage(signed);
  const expectedType = input.direction === "BUY" ? "PrimaryOrderIntent" : "RedemptionIntent";
  const idField = input.direction === "BUY" ? "orderId" : "redemptionId";
  const signedWorkflowId = message[idField]?.includes("-")
    ? uuidToBytes16(message[idField])
    : message[idField];
  if (
    signed.primaryType !== expectedType ||
    signedWorkflowId?.toLowerCase() !== uuidToBytes16(input.hedgeId).toLowerCase() ||
    message.investor?.toLowerCase() !== MARKET_MAKER_WALLET.toLowerCase() ||
    message.shareQuantity !== input.quantity ||
    message.krwLimitPrice !== input.krwLimitPrice ||
    message.targetTradingDate !== input.targetTradingDate ||
    message.policyVersion?.toLowerCase() !==
      keccak256(toHex(LOCAL_SECONDARY_POLICY)).toLowerCase() ||
    BigInt(message.expiresAt ?? "0") <= BigInt(Math.floor(input.now.getTime() / 1000))
  )
    throw new Error("헤지 주문 서명 내용이 헤지 대기열과 일치하지 않는다.");
  if (input.direction === "BUY" && message.securityId !== LOCAL_SECONDARY_SECURITY_ID)
    throw new Error("매수 헤지 상품번호가 다르다.");
  if (
    input.direction === "BUY" &&
    (message.fundingMode !== "USD_LEDGER" ||
      !/^[1-9][0-9]*$/.test(message.fundingAmountMinor ?? ""))
  )
    throw new Error("매수 헤지는 해외 증권사의 USD 장부 경로를 사용해야 한다.");
  if (input.direction === "SELL" && !/^0x[0-9a-fA-F]{40}$/.test(message.token ?? ""))
    throw new Error("매도 헤지 토큰 주소가 올바르지 않다.");
  if (!signed.signature || !signed.domain?.verifyingContract)
    throw new Error("헤지 주문 서명과 도메인이 없다.");
  const valid = await verifyTypedData({
    address: getAddress(MARKET_MAKER_WALLET),
    domain: {
      name: signed.domain.name ?? "Korean Equity RWA Intent",
      version: signed.domain.version ?? "1",
      chainId: signed.domain.chainId ?? 31337,
      verifyingContract: getAddress(signed.domain.verifyingContract),
    },
    types: input.direction === "BUY" ? primaryTypes : redemptionTypes,
    primaryType: expectedType,
    message: Object.fromEntries(
      Object.entries(message).map(([key, value]) => [
        key,
        key === idField
          ? uuidToBytes16(value)
          : ["shareQuantity", "krwLimitPrice", "fundingAmountMinor", "nonce", "expiresAt"].includes(
                key,
              )
            ? BigInt(value)
            : value,
      ]),
    ),
    signature: signed.signature,
  } as never);
  if (!valid) throw new Error("시장조성자 헤지 주문 서명이 유효하지 않다.");
}

export async function registerHedgeRoutes(app: FastifyInstance, pool: Pool, clock: Clock) {
  app.get("/api/v1/market-maker/hedges", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    if (
      !actor ||
      !["MARKET_MAKER", "OVERSEAS_BROKER_OPERATOR", "COMPLIANCE_AUDITOR"].includes(actor.role)
    )
      return fail(reply, 403, "AUTHORIZATION_DENIED", "헤지 대기열을 조회할 기관 역할이 필요하다.");
    return listMarketMakerHedges(pool, clock.now());
  });

  app.post("/api/v1/market-maker/hedges/:hedgeId/decisions", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    if (!actor || !["MARKET_MAKER", "OVERSEAS_BROKER_OPERATOR"].includes(actor.role))
      return fail(
        reply,
        403,
        "AUTHORIZATION_DENIED",
        "시장조성자 또는 해외 증권사 역할이 필요하다.",
      );
    const commandHeaders = headers(request, reply);
    if (!commandHeaders) return;
    const hedgeId = (request.params as { hedgeId: string }).hedgeId;
    const body = request.body as {
      decision: "APPROVE" | "REJECT" | "REQUEST_CORRECTION";
      reasonKo: string;
      expectedAggregateVersion: number;
      signedHedgeIntent?: unknown;
    };
    try {
      const hedge = await getMarketMakerHedge(pool, hedgeId, clock.now());
      if (!hedge) return fail(reply, 404, "HEDGE_NOT_FOUND", "헤지 업무가 없다.");
      if (actor.role === "MARKET_MAKER" && body.decision === "APPROVE") {
        await validateHedgeIntent({
          signedIntent: body.signedHedgeIntent,
          direction: String(hedge.direction),
          hedgeId,
          quantity: String(hedge.requestedQuantity),
          targetTradingDate: String(hedge.targetTradingDate),
          krwLimitPrice: String(hedge.krwLimitPrice),
          now: clock.now(),
        });
      }
      const result = await decideMarketMakerHedge(pool, {
        hedgeId,
        principalId: actor.principalId,
        actorRole: actor.role,
        decision: body.decision,
        reasonKo: body.reasonKo,
        expectedAggregateVersion: body.expectedAggregateVersion,
        ...(body.signedHedgeIntent ? { signedIntent: body.signedHedgeIntent } : {}),
        ...commandHeaders,
        now: clock.now(),
      });
      if ("conflict" in result)
        return fail(reply, 409, "IDEMPOTENCY_CONFLICT", "같은 멱등키의 요청 내용이 다르다.");
      return reply.status(202).send({
        requestId: result.workflowId,
        workflowId: result.workflowId,
        status: "ACCEPTED",
        statusUrl: `/api/v1/workflows/${result.workflowId}`,
      });
    } catch (error) {
      return fail(
        reply,
        error instanceof Error && /버전/.test(error.message) ? 409 : 422,
        "HEDGE_DECISION_INVALID",
        error instanceof Error ? error.message : "헤지 결정을 처리하지 못했다.",
      );
    }
  });
}
