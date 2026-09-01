import { createHash, randomUUID, verify } from "node:crypto";

import {
  acceptPrimaryAdapterEvent,
  acceptRedemptionAdapterEvent,
  acceptHedgeAdapterEvent,
  isHedgeAdapterEvent,
  acceptPrimaryOrder,
  isRedemptionAdapterEvent,
  cancelPrimaryOrder,
  getCustomerReadiness,
  listPrimaryOrders,
} from "@rwa/database";
import {
  assertPrimaryOrder,
  authenticateDemoBearer,
  reserveAmountForOrder,
  type Clock,
} from "@rwa/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { getAddress, verifyTypedData } from "viem";

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

function fail(
  reply: FastifyReply,
  status: number,
  code: string,
  messageKo: string,
  nextActionKo: string,
) {
  return reply.status(status).send({
    code,
    messageKo,
    retryable: false,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    responsibleRole: "OVERSEAS_BROKER_OPERATOR",
    nextActionKo,
    simulation: true,
  });
}

function investor(request: FastifyRequest, reply: FastifyReply) {
  const actor = authenticateDemoBearer(request.headers.authorization);
  if (!actor || actor.role !== "INVESTOR") {
    fail(
      reply,
      403,
      "AUTHORIZATION_DENIED",
      "합성 투자자 역할이 필요하다.",
      "투자자 프로필을 선택한다.",
    );
    return undefined;
  }
  return actor;
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
    fail(
      reply,
      422,
      "INPUT_VALIDATION_FAILED",
      "멱등키와 상관관계 ID가 필요하다.",
      "요청 헤더를 확인한다.",
    );
    return undefined;
  }
  return { idempotencyKey, correlationId };
}

export async function registerPrimaryRoutes(app: FastifyInstance, pool: Pool, clock: Clock) {
  app.get("/api/v1/primary-orders", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    if (!actor)
      return fail(
        reply,
        401,
        "AUTHENTICATION_REQUIRED",
        "합성 인증이 필요하다.",
        "허용된 데모 역할을 선택한다.",
      );
    return listPrimaryOrders(pool, actor.principalId, actor.role, clock.now());
  });

  app.post("/api/v1/primary-orders", async (request, reply) => {
    const actor = investor(request, reply);
    const commandHeaders = headers(request, reply);
    if (!actor || !commandHeaders) return;
    const body = request.body as Record<string, unknown>;
    const signed = body.signedIntent as Record<string, unknown> | undefined;
    const message = signed?.message as Record<string, string> | undefined;
    try {
      if (
        !message ||
        signed?.primaryType !== "PrimaryOrderIntent" ||
        typeof signed.signature !== "string"
      )
        throw new Error("서명된 주문 의사가 없다.");
      const requiredIntentFields = [
        "orderId",
        "investor",
        "securityId",
        "shareQuantity",
        "krwLimitPrice",
        "targetTradingDate",
        "fundingMode",
        "fundingAmountMinor",
        "nonce",
        "expiresAt",
        "policyVersion",
      ] as const;
      if (requiredIntentFields.some((field) => !message[field]))
        throw new Error("서명된 주문 필드가 빠졌다.");
      const intent = message as Record<(typeof requiredIntentFields)[number], string>;
      const parsed = assertPrimaryOrder({
        securityId: String(body.securityId ?? ""),
        shareQuantity: String(body.shareQuantity ?? ""),
        krwLimitPrice: String(body.krwLimitPrice ?? ""),
        fundingMode: String(body.fundingMode ?? ""),
      });
      const readiness = await getCustomerReadiness(pool, actor.principalId, clock.now());
      if (!readiness?.activeWallet) throw new Error("승인된 전용 지갑이 없다.");
      const requiredUsd = reserveAmountForOrder(parsed.quantity, parsed.limitKrw);
      if (
        intent.securityId !== body.securityId ||
        intent.shareQuantity !== body.shareQuantity ||
        intent.krwLimitPrice !== body.krwLimitPrice ||
        intent.targetTradingDate !== body.targetTradingDate ||
        intent.fundingMode !== body.fundingMode ||
        intent.fundingAmountMinor !== requiredUsd.toString() ||
        getAddress(intent.investor) !== getAddress(readiness.activeWallet) ||
        BigInt(intent.expiresAt) <= BigInt(Math.floor(clock.now().getTime() / 1000))
      )
        throw new Error("서명 내용과 주문이 일치하지 않는다.");
      const domain = signed.domain as
        | { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }
        | undefined;
      if (!domain || domain.name !== "Korean Equity RWA Intent" || domain.version !== "1")
        throw new Error("서명 도메인이 일치하지 않는다.");
      const valid = await verifyTypedData({
        address: getAddress(readiness.activeWallet),
        domain,
        types: primaryTypes,
        primaryType: "PrimaryOrderIntent",
        message: {
          orderId: uuidToBytes16(intent.orderId),
          investor: getAddress(intent.investor),
          securityId: intent.securityId,
          shareQuantity: BigInt(intent.shareQuantity),
          krwLimitPrice: BigInt(intent.krwLimitPrice),
          targetTradingDate: intent.targetTradingDate,
          fundingMode: intent.fundingMode,
          fundingAmountMinor: BigInt(intent.fundingAmountMinor),
          nonce: BigInt(intent.nonce),
          expiresAt: BigInt(intent.expiresAt),
          policyVersion: intent.policyVersion as `0x${string}`,
        },
        signature: signed.signature as `0x${string}`,
      });
      if (!valid) throw new Error("투자자 주문 서명이 유효하지 않다.");
      const result = await acceptPrimaryOrder(pool, {
        principalId: actor.principalId,
        role: actor.role,
        wallet: readiness.activeWallet,
        ...commandHeaders,
        order: {
          orderId: intent.orderId,
          securityId: String(body.securityId),
          shareQuantity: parsed.quantity,
          krwLimitPrice: parsed.limitKrw,
          requestedTradingDate: String(body.targetTradingDate),
          fundingMode: parsed.fundingMode,
          signedIntent: signed,
        },
        now: clock.now(),
      });
      if ("conflict" in result)
        return fail(
          reply,
          409,
          "IDEMPOTENCY_CONFLICT",
          "같은 멱등키가 다른 주문에 사용됐다.",
          "새 멱등키를 사용한다.",
        );
      if ("rejected" in result)
        return fail(
          reply,
          422,
          result.rejected,
          "고객 준비상태 또는 자금이 주문 조건을 충족하지 않는다.",
          "공시·지갑·잔액을 확인한다.",
        );
      return reply.status(202).send({
        requestId: result.workflowId,
        workflowId: result.workflowId,
        status: "ACCEPTED",
        statusUrl: `/api/v1/workflows/${result.workflowId}`,
      });
    } catch (error) {
      return fail(
        reply,
        422,
        "PRIMARY_ORDER_INVALID",
        error instanceof Error ? error.message : "주문이 올바르지 않다.",
        "정수 수량, 지정가, 자금과 서명을 확인한다.",
      );
    }
  });

  app.post("/api/v1/primary-orders/:orderId/cancellations", async (request, reply) => {
    const actor = investor(request, reply);
    const commandHeaders = headers(request, reply);
    if (!actor || !commandHeaders) return;
    try {
      const orderId = (request.params as { orderId: string }).orderId;
      await cancelPrimaryOrder(pool, orderId, actor.principalId, clock.now());
      return reply.status(202).send({
        requestId: orderId,
        workflowId: orderId,
        status: "ACCEPTED",
        statusUrl: `/api/v1/workflows/${orderId}`,
      });
    } catch (error) {
      return fail(
        reply,
        409,
        "ORDER_NOT_CANCELLABLE",
        error instanceof Error ? error.message : "주문을 취소할 수 없다.",
        "현재 주문 단계를 확인한다.",
      );
    }
  });

  app.post("/api/v1/adapter-events", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    try {
      const publicKey = process.env.MOCK_ADAPTER_PUBLIC_KEY?.replaceAll("\\n", "\n");
      if (!publicKey || typeof body.signature !== "string" || typeof body.keyId !== "string")
        throw new Error("등록된 모의 기관 서명키가 없다.");
      const unsigned = { ...body };
      delete unsigned.signature;
      const bytes = Buffer.from(canonicalJson(unsigned));
      if (!verify(null, bytes, publicKey, Buffer.from(body.signature, "base64url")))
        throw new Error("모의 기관 서명이 유효하지 않다.");
      const adapterInput = {
        sourceInstitutionId: String(body.sourceInstitutionId),
        eventId: String(body.eventId),
        sourceSequence: Number(body.sourceSequence),
        eventType: String(body.eventType),
        data: body.data as Record<string, unknown>,
        payloadHash: createHash("sha256").update(bytes).digest("hex"),
        now: clock.now(),
      };
      const result = isHedgeAdapterEvent(String(body.eventType))
        ? await acceptHedgeAdapterEvent(pool, adapterInput)
        : isRedemptionAdapterEvent(String(body.eventType))
          ? await acceptRedemptionAdapterEvent(pool, adapterInput)
          : await acceptPrimaryAdapterEvent(pool, adapterInput);
      const workflowId = result.workflowId ?? String(body.eventId);
      return reply.status(202).send({
        requestId: workflowId,
        workflowId,
        status: "ACCEPTED",
        statusUrl: `/api/v1/workflows/${workflowId}`,
      });
    } catch (error) {
      return fail(
        reply,
        422,
        "ADAPTER_EVENT_INVALID",
        error instanceof Error ? error.message : "기관 결과가 올바르지 않다.",
        "기관 서명과 순번을 확인한다.",
      );
    }
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function uuidToBytes16(value: string): `0x${string}` {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error("주문 UUID가 올바르지 않다.");
  return `0x${value.replaceAll("-", "")}`;
}
