import { randomUUID } from "node:crypto";

import {
  LOCAL_REDEMPTION_LIMIT_KRW,
  LOCAL_REDEMPTION_POLICY,
  LOCAL_REDEMPTION_SECURITY_ID,
  LOCAL_REDEMPTION_TOKEN_ADDRESS,
  authenticateDemoBearer,
  parseRedemptionQuantity,
  type Clock,
} from "@rwa/domain";
import {
  acceptRedemption,
  cancelRedemption,
  getCustomerReadiness,
  getLocalChainMetadata,
  listRedemptions,
} from "@rwa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { getAddress, keccak256, stringToBytes, verifyTypedData } from "viem";

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
const localIntentVerifier = "0x0000000000000000000000000000000000000990" as const;

function fail(reply: FastifyReply, status: number, code: string, messageKo: string) {
  return reply.status(status).send({
    code,
    messageKo,
    retryable: false,
    requestId: randomUUID(),
    correlationId: randomUUID(),
    responsibleRole: "OVERSEAS_BROKER_OPERATOR",
    nextActionKo: "환매 가능수량, 서명과 현재 업무단계를 확인한다.",
    simulation: true,
  });
}

function investor(request: FastifyRequest, reply: FastifyReply) {
  const actor = authenticateDemoBearer(request.headers.authorization);
  if (!actor || actor.role !== "INVESTOR") {
    fail(reply, 403, "AUTHORIZATION_DENIED", "합성 투자자 역할이 필요하다.");
    return undefined;
  }
  return actor;
}

function commandHeaders(request: FastifyRequest, reply: FastifyReply) {
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

export async function registerRedemptionRoutes(app: FastifyInstance, pool: Pool, clock: Clock) {
  app.get("/api/v1/redemptions", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    if (!actor) return fail(reply, 401, "AUTHENTICATION_REQUIRED", "합성 인증이 필요하다.");
    return listRedemptions(pool, actor.principalId, actor.role, clock.now());
  });

  app.post("/api/v1/redemptions", async (request, reply) => {
    const actor = investor(request, reply);
    const headers = commandHeaders(request, reply);
    if (!actor || !headers) return;
    try {
      const body = request.body as Record<string, unknown>;
      const signed = body.signedIntent as Record<string, unknown> | undefined;
      const message = signed?.message as Record<string, string> | undefined;
      if (
        !message ||
        signed?.primaryType !== "RedemptionIntent" ||
        typeof signed.signature !== "string"
      )
        throw new Error("서명된 환매 의사가 없다.");
      const requiredFields = [
        "redemptionId",
        "investor",
        "token",
        "shareQuantity",
        "krwLimitPrice",
        "targetTradingDate",
        "nonce",
        "expiresAt",
        "policyVersion",
      ] as const;
      if (requiredFields.some((field) => !message[field]))
        throw new Error("환매 서명 필드가 빠졌다.");
      const intent = message as Record<(typeof requiredFields)[number], string>;
      const quantity = parseRedemptionQuantity(String(body.shareQuantity ?? ""));
      const chainMetadata = await getLocalChainMetadata(pool);
      const expectedToken =
        chainMetadata.tokens[LOCAL_REDEMPTION_SECURITY_ID] ?? LOCAL_REDEMPTION_TOKEN_ADDRESS;
      const expectedVerifier =
        chainMetadata.verifyingContract === "0x0000000000000000000000000000000000000000"
          ? localIntentVerifier
          : chainMetadata.verifyingContract;
      if (
        String(body.securityId) !== LOCAL_REDEMPTION_SECURITY_ID ||
        BigInt(String(body.krwLimitPrice)) !== LOCAL_REDEMPTION_LIMIT_KRW ||
        intent.token.toLowerCase() !== expectedToken.toLowerCase() ||
        intent.shareQuantity !== quantity.toString() ||
        intent.krwLimitPrice !== String(body.krwLimitPrice) ||
        intent.targetTradingDate !== body.targetTradingDate ||
        intent.policyVersion.toLowerCase() !==
          keccak256(stringToBytes(LOCAL_REDEMPTION_POLICY)).toLowerCase()
      )
        throw new Error("환매 요청과 서명내용이 일치하지 않는다.");
      const readiness = await getCustomerReadiness(pool, actor.principalId, clock.now());
      if (
        !readiness?.activeWallet ||
        getAddress(intent.investor) !== getAddress(readiness.activeWallet)
      )
        throw new Error("승인된 전용 지갑이 아니다.");
      if (BigInt(intent.expiresAt) <= BigInt(Math.floor(clock.now().getTime() / 1000)))
        throw new Error("환매 서명이 만료됐다.");
      const domain = signed.domain as {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      };
      if (
        domain?.name !== "Korean Equity RWA Intent" ||
        domain.version !== "1" ||
        ![31_337, 43_113].includes(Number(domain.chainId)) ||
        getAddress(domain.verifyingContract) !== getAddress(expectedVerifier)
      )
        throw new Error("환매 서명 도메인이 일치하지 않는다.");
      const valid = await verifyTypedData({
        address: getAddress(readiness.activeWallet),
        domain,
        types: redemptionTypes,
        primaryType: "RedemptionIntent",
        message: {
          redemptionId: uuidToBytes16(intent.redemptionId),
          investor: getAddress(intent.investor),
          token: getAddress(intent.token),
          shareQuantity: BigInt(intent.shareQuantity),
          krwLimitPrice: BigInt(intent.krwLimitPrice),
          targetTradingDate: intent.targetTradingDate,
          nonce: BigInt(intent.nonce),
          expiresAt: BigInt(intent.expiresAt),
          policyVersion: intent.policyVersion as `0x${string}`,
        },
        signature: signed.signature as `0x${string}`,
      });
      if (!valid) throw new Error("환매 서명이 유효하지 않다.");
      const result = await acceptRedemption(pool, {
        principalId: actor.principalId,
        role: actor.role,
        wallet: readiness.activeWallet,
        ...headers,
        redemptionId: intent.redemptionId,
        securityId: String(body.securityId),
        shareQuantity: quantity,
        krwLimitPrice: BigInt(String(body.krwLimitPrice)),
        requestedTradingDate: String(body.targetTradingDate),
        signedIntent: signed,
        now: clock.now(),
      });
      if ("conflict" in result)
        return fail(reply, 409, "IDEMPOTENCY_CONFLICT", "같은 멱등키의 본문이 다르다.");
      if ("rejected" in result)
        return fail(reply, 422, result.rejected, "환매 조건을 충족하지 않는다.");
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
        "REDEMPTION_INVALID",
        error instanceof Error ? error.message : "환매 요청이 올바르지 않다.",
      );
    }
  });

  app.post("/api/v1/redemptions/:redemptionId/cancellations", async (request, reply) => {
    const actor = investor(request, reply);
    const headers = commandHeaders(request, reply);
    if (!actor || !headers) return;
    try {
      const redemptionId = (request.params as { redemptionId: string }).redemptionId;
      const reasonKo = String((request.body as { reasonKo?: string }).reasonKo ?? "");
      if (!reasonKo) throw new Error("취소 사유가 필요하다.");
      await cancelRedemption(pool, redemptionId, actor.principalId, clock.now(), {
        idempotencyKey: headers.idempotencyKey,
        reasonKo,
      });
      return reply.status(202).send({
        requestId: redemptionId,
        workflowId: redemptionId,
        status: "ACCEPTED",
        statusUrl: `/api/v1/workflows/${redemptionId}`,
      });
    } catch (error) {
      return fail(
        reply,
        409,
        "REDEMPTION_NOT_CANCELLABLE",
        error instanceof Error ? error.message : "환매를 취소할 수 없다.",
      );
    }
  });
}

function uuidToBytes16(value: string): `0x${string}` {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error("환매 UUID가 올바르지 않다.");
  return `0x${value.replaceAll("-", "")}`;
}
