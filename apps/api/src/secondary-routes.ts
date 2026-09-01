import { randomUUID } from "node:crypto";

import {
  MARKET_MAKER_WALLET,
  acceptMarketMakerQuote,
  acceptSecondaryOrder,
  getCustomerReadiness,
  getLocalSecondaryScenario,
  getSecondaryQuoteRecord,
  getSecondaryExecutionPayload,
  listMarketMakerPositions,
  listSecondaryOrders,
  listSecondaryQuotes,
} from "@rwa/database";
import {
  LOCAL_SECONDARY_POLICY,
  LOCAL_SECONDARY_REFERENCE_USD_MINOR,
  LOCAL_SECONDARY_SECURITY_ID,
  parsePositiveShareQuantity,
  type Clock,
  type InvestorSide,
  type MarketMakerSide,
  type SecondaryFundingMode,
} from "@rwa/domain";
import { authenticateDemoBearer } from "@rwa/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { getAddress, keccak256, padHex, toHex, verifyTypedData } from "viem";

type QuoteMessage = {
  quoteId: string;
  marketMaker: string;
  token: string;
  marketMakerSide: string;
  paymentMode: string;
  paymentAssetId: string;
  shareQuantity: string;
  unitPriceMinor: string;
  nonce: string;
  expiresAt: string;
  policyVersion: string;
};
type SecondaryMessage = {
  orderId: string;
  quoteId: string;
  investor: string;
  token: string;
  investorSide: string;
  paymentMode: string;
  paymentAssetId: string;
  shareQuantity: string;
  paymentAmountMinor: string;
  nonce: string;
  expiresAt: string;
  policyVersion: string;
};
type BrokerApprovalMessage = {
  approvalId: string;
  orderId: string;
  investor: string;
  marketMaker: string;
  token: string;
  paymentMode: string;
  paymentAssetId: string;
  shareQuantity: string;
  paymentAmountMinor: string;
  rightsEvidenceHash: string;
  fundsEvidenceHash: string;
  nonce: string;
  expiresAt: string;
  policyVersion: string;
};

const quoteTypes = {
  MarketMakerQuote: [
    { name: "quoteId", type: "bytes16" },
    { name: "marketMaker", type: "address" },
    { name: "token", type: "address" },
    { name: "marketMakerSide", type: "string" },
    { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" },
    { name: "shareQuantity", type: "uint256" },
    { name: "unitPriceMinor", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;

const secondaryTypes = {
  SecondaryOrderIntent: [
    { name: "orderId", type: "bytes16" },
    { name: "quoteId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "token", type: "address" },
    { name: "investorSide", type: "string" },
    { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" },
    { name: "shareQuantity", type: "uint256" },
    { name: "paymentAmountMinor", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "policyVersion", type: "bytes32" },
  ],
} as const;

const brokerApprovalTypes = {
  BrokerSettlementApproval: [
    { name: "approvalId", type: "bytes16" },
    { name: "orderId", type: "bytes16" },
    { name: "investor", type: "address" },
    { name: "marketMaker", type: "address" },
    { name: "token", type: "address" },
    { name: "paymentMode", type: "string" },
    { name: "paymentAssetId", type: "bytes32" },
    { name: "shareQuantity", type: "uint256" },
    { name: "paymentAmountMinor", type: "uint256" },
    { name: "rightsEvidenceHash", type: "bytes32" },
    { name: "fundsEvidenceHash", type: "bytes32" },
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

function domain(value: unknown) {
  const parsed = value as {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
  };
  if (
    parsed?.name !== "Korean Equity RWA Intent" ||
    parsed.version !== "1" ||
    ![31_337, 43_113].includes(Number(parsed.chainId)) ||
    !/^0x[0-9a-fA-F]{40}$/.test(parsed.verifyingContract ?? "")
  )
    throw new Error("서명 도메인이 일치하지 않는다.");
  return {
    name: parsed.name,
    version: parsed.version,
    chainId: Number(parsed.chainId),
    verifyingContract: getAddress(parsed.verifyingContract!),
  } as const;
}

function uuidToBytes16(value: string): `0x${string}` {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) throw new Error("UUID를 bytes16으로 변환할 수 없다.");
  return `0x${compact}`;
}

function accepted(reply: FastifyReply, workflowId: string) {
  return reply.status(202).send({
    requestId: workflowId,
    workflowId,
    status: "ACCEPTED",
    statusUrl: `/api/v1/workflows/${workflowId}`,
  });
}

export async function registerSecondaryRoutes(app: FastifyInstance, pool: Pool, clock: Clock) {
  app.get("/api/v1/quotes", async (request, reply) => {
    const query = request.query as {
      securityId?: string;
      investorSide?: string;
      fundingMode?: string;
    };
    if (
      query.securityId !== LOCAL_SECONDARY_SECURITY_ID ||
      !["BUY", "SELL"].includes(query.investorSide ?? "") ||
      !["USD_LEDGER", "USDC_ONCHAIN"].includes(query.fundingMode ?? "")
    )
      return fail(
        reply,
        422,
        "INPUT_VALIDATION_FAILED",
        "합성 상품, 방향과 자금경로가 필요하다.",
        "조회 조건을 확인한다.",
      );
    return listSecondaryQuotes(pool, {
      securityId: query.securityId,
      investorSide: query.investorSide as InvestorSide,
      fundingMode: query.fundingMode as SecondaryFundingMode,
      now: clock.now(),
    });
  });

  app.post("/api/v1/market-maker/quotes", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    const commandHeaders = headers(request, reply);
    if (!actor || actor.role !== "MARKET_MAKER")
      return fail(
        reply,
        403,
        "AUTHORIZATION_DENIED",
        "지정 시장조성자 역할이 필요하다.",
        "시장조성자 프로필을 선택한다.",
      );
    if (!commandHeaders) return;
    try {
      const body = request.body as Record<string, unknown>;
      const signed = body.signedQuote as Record<string, unknown>;
      const message = signed?.message as QuoteMessage;
      const price = body.unitPrice as {
        currency?: string;
        amountMinor?: string;
        decimals?: number;
      };
      if (
        !message ||
        signed.primaryType !== "MarketMakerQuote" ||
        typeof signed.signature !== "string"
      )
        throw new Error("시장조성자 서명호가가 필요하다.");
      const quantity = parsePositiveShareQuantity(String(body.shareQuantity ?? ""));
      const side = String(body.marketMakerSide) as MarketMakerSide;
      const fundingMode = String(body.fundingMode) as SecondaryFundingMode;
      if (
        !(["BUY", "SELL"] as string[]).includes(side) ||
        !(["USD_LEDGER", "USDC_ONCHAIN"] as string[]).includes(fundingMode)
      )
        throw new Error("호가 방향 또는 자금경로가 올바르지 않다.");
      const unitPriceMinor = BigInt(String(price?.amountMinor ?? "0"));
      if (unitPriceMinor <= 0n) throw new Error("호가 가격이 필요하다.");
      if (
        (fundingMode === "USD_LEDGER" && (price.currency !== "USD" || price.decimals !== 2)) ||
        (fundingMode === "USDC_ONCHAIN" && (price.currency !== "USDC" || price.decimals !== 6))
      )
        throw new Error("가격 통화와 소수점이 자금경로와 다르다.");
      const expiresAt = new Date(String(body.expiresAt));
      const seconds = (expiresAt.getTime() - clock.now().getTime()) / 1000;
      if (!(seconds > 0 && seconds <= 30)) throw new Error("호가 유효시간은 최대 30초다.");
      const scenario = await getLocalSecondaryScenario(pool, actor.principalId, clock.now());
      if (!scenario) throw new Error("로컬 24시간 상품이 없다.");
      const expectedAsset =
        fundingMode === "USD_LEDGER"
          ? usdLedgerPaymentAssetId
          : usdcPaymentAssetId(scenario.mockUsdcAddress as `0x${string}`);
      if (
        message.quoteId.length !== 36 ||
        message.marketMaker.toLowerCase() !== MARKET_MAKER_WALLET.toLowerCase() ||
        message.marketMakerSide !== side ||
        message.paymentMode !== fundingMode ||
        message.shareQuantity !== quantity.toString() ||
        message.unitPriceMinor !== unitPriceMinor.toString() ||
        message.expiresAt !== String(Math.floor(expiresAt.getTime() / 1000)) ||
        message.policyVersion !== keccak256(toHex(LOCAL_SECONDARY_POLICY)) ||
        message.token.toLowerCase() !== scenario.tokenAddress.toLowerCase() ||
        message.paymentAssetId.toLowerCase() !== expectedAsset.toLowerCase()
      )
        throw new Error("서명호가와 요청이 일치하지 않는다.");
      const valid = await verifyTypedData({
        address: getAddress(MARKET_MAKER_WALLET),
        domain: domain(signed.domain),
        types: quoteTypes,
        primaryType: "MarketMakerQuote",
        message: {
          quoteId: uuidToBytes16(message.quoteId),
          marketMaker: getAddress(message.marketMaker),
          token: getAddress(message.token),
          marketMakerSide: message.marketMakerSide,
          paymentMode: message.paymentMode,
          paymentAssetId: message.paymentAssetId as `0x${string}`,
          shareQuantity: BigInt(message.shareQuantity),
          unitPriceMinor: BigInt(message.unitPriceMinor),
          nonce: BigInt(message.nonce),
          expiresAt: BigInt(message.expiresAt),
          policyVersion: message.policyVersion as `0x${string}`,
        },
        signature: signed.signature as `0x${string}`,
      });
      if (!valid) throw new Error("시장조성자 호가 서명이 유효하지 않다.");
      const reference =
        fundingMode === "USD_LEDGER"
          ? LOCAL_SECONDARY_REFERENCE_USD_MINOR
          : LOCAL_SECONDARY_REFERENCE_USD_MINOR * 10_000n;
      const spread = Number(
        ((unitPriceMinor > reference ? unitPriceMinor - reference : reference - unitPriceMinor) *
          10_000n) /
          reference,
      );
      const result = await acceptMarketMakerQuote(pool, {
        principalId: actor.principalId,
        wallet: message.marketMaker,
        ...commandHeaders,
        quote: {
          quoteId: message.quoteId,
          securityId: String(body.securityId),
          marketMakerSide: side,
          fundingMode,
          paymentAssetId: message.paymentAssetId,
          shareQuantity: quantity,
          unitPriceMinor,
          halfSpreadBps: spread,
          nonce: BigInt(message.nonce),
          expiresAt,
          signedQuote: signed,
        },
        now: clock.now(),
      });
      if ("conflict" in result)
        return fail(
          reply,
          409,
          "IDEMPOTENCY_CONFLICT",
          "같은 멱등키가 다른 호가에 사용됐다.",
          "새 멱등키를 사용한다.",
        );
      if ("rejected" in result)
        return fail(
          reply,
          422,
          result.rejected,
          "호가가 재고·자금 또는 위험조건을 충족하지 않는다.",
          "시장조성자 재고와 통제값을 확인한다.",
        );
      return accepted(reply, result.workflowId);
    } catch (error) {
      return fail(
        reply,
        422,
        "MARKET_MAKER_QUOTE_INVALID",
        error instanceof Error ? error.message : "호가가 올바르지 않다.",
        "정수 수량, 가격, 만료와 서명을 확인한다.",
      );
    }
  });

  app.get("/api/v1/secondary-orders", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    if (!actor)
      return fail(
        reply,
        401,
        "AUTHENTICATION_REQUIRED",
        "합성 인증이 필요하다.",
        "데모 프로필을 선택한다.",
      );
    return listSecondaryOrders(pool, actor.principalId, actor.role, clock.now());
  });

  app.post("/api/v1/secondary-orders", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    const commandHeaders = headers(request, reply);
    if (!actor || actor.role !== "INVESTOR")
      return fail(
        reply,
        403,
        "AUTHORIZATION_DENIED",
        "투자자 역할이 필요하다.",
        "합성 투자자 프로필을 선택한다.",
      );
    if (!commandHeaders) return;
    try {
      const body = request.body as Record<string, unknown>;
      const signed = body.signedIntent as Record<string, unknown>;
      const message = signed?.message as SecondaryMessage;
      if (
        !message ||
        signed.primaryType !== "SecondaryOrderIntent" ||
        typeof signed.signature !== "string"
      )
        throw new Error("서명된 24시간 주문이 필요하다.");
      const quantity = parsePositiveShareQuantity(String(body.shareQuantity ?? ""));
      const side = String(body.investorSide) as InvestorSide;
      const fundingMode = String(body.fundingMode) as SecondaryFundingMode;
      const scenario = await getLocalSecondaryScenario(pool, actor.principalId, clock.now());
      if (!scenario?.balances || !scenario.secondaryEnabled)
        throw new Error("합성 24시간 상품을 사용할 수 없다.");
      if (message.quoteId !== body.quoteId) throw new Error("주문이 호가와 일치하지 않는다.");
      const readiness = await getCustomerReadiness(pool, actor.principalId, clock.now());
      if (
        !readiness?.activeWallet ||
        message.investor.toLowerCase() !== readiness.activeWallet.toLowerCase()
      )
        throw new Error("승인된 투자자 전용 지갑과 서명자가 다르다.");
      if (
        message.shareQuantity !== quantity.toString() ||
        message.investorSide !== side ||
        message.paymentMode !== fundingMode ||
        message.policyVersion !== keccak256(toHex(LOCAL_SECONDARY_POLICY)) ||
        BigInt(message.expiresAt) <= BigInt(Math.floor(clock.now().getTime() / 1000))
      )
        throw new Error("서명 주문과 요청이 일치하지 않는다.");
      const quote = await getSecondaryQuoteRecord(pool, String(body.quoteId));
      const quoteMessage = (quote?.signed_quote as { message?: QuoteMessage } | undefined)?.message;
      if (
        !quoteMessage ||
        message.token.toLowerCase() !== quoteMessage.token.toLowerCase() ||
        message.paymentAssetId.toLowerCase() !== quoteMessage.paymentAssetId.toLowerCase() ||
        message.paymentAmountMinor !== (BigInt(quoteMessage.unitPriceMinor) * quantity).toString()
      )
        throw new Error("투자자 주문의 토큰·지급자산·한도가 호가와 다르다.");
      const valid = await verifyTypedData({
        address: getAddress(readiness.activeWallet),
        domain: domain(signed.domain),
        types: secondaryTypes,
        primaryType: "SecondaryOrderIntent",
        message: {
          orderId: uuidToBytes16(message.orderId),
          quoteId: uuidToBytes16(message.quoteId),
          investor: getAddress(message.investor),
          token: getAddress(message.token),
          investorSide: message.investorSide,
          paymentMode: message.paymentMode,
          paymentAssetId: message.paymentAssetId as `0x${string}`,
          shareQuantity: BigInt(message.shareQuantity),
          paymentAmountMinor: BigInt(message.paymentAmountMinor),
          nonce: BigInt(message.nonce),
          expiresAt: BigInt(message.expiresAt),
          policyVersion: message.policyVersion as `0x${string}`,
        },
        signature: signed.signature as `0x${string}`,
      });
      if (!valid) throw new Error("투자자 주문 서명이 유효하지 않다.");
      const result = await acceptSecondaryOrder(pool, {
        principalId: actor.principalId,
        wallet: readiness.activeWallet,
        ...commandHeaders,
        order: {
          orderId: message.orderId,
          quoteId: String(body.quoteId),
          shareQuantity: quantity,
          investorSide: side,
          fundingMode,
          paymentAssetId: message.paymentAssetId,
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
          "주문이 호가·권리·자금 또는 위험조건을 충족하지 않는다.",
          "현재 호가와 결제완료 잔액을 확인한다.",
        );
      return accepted(reply, result.workflowId);
    } catch (error) {
      return fail(
        reply,
        422,
        "SECONDARY_ORDER_INVALID",
        error instanceof Error ? error.message : "주문이 올바르지 않다.",
        "호가, 수량, 자금경로와 서명을 확인한다.",
      );
    }
  });

  app.get("/api/v1/market-maker/positions", async (request, reply) => {
    const actor = authenticateDemoBearer(request.headers.authorization);
    if (
      !actor ||
      !["MARKET_MAKER", "OVERSEAS_BROKER_OPERATOR", "COMPLIANCE_AUDITOR"].includes(actor.role)
    )
      return fail(
        reply,
        403,
        "AUTHORIZATION_DENIED",
        "시장조성자 포지션 조회 권한이 없다.",
        "허용된 기관 역할을 선택한다.",
      );
    return listMarketMakerPositions(pool, clock.now());
  });
}

export const secondaryBrokerAddress = "0xb4e41457a08Aa8B512D2117eA1e22c8c0C42CbF9";
export const usdLedgerPaymentAssetId = keccak256(toHex("USD_LEDGER"));
export function usdcPaymentAssetId(address: `0x${string}`): `0x${string}` {
  return padHex(address, { size: 32 });
}

export async function validateSecondaryBrokerApproval(
  pool: Pool,
  orderId: string,
  signedValue: unknown,
  now: Date,
) {
  const signed = signedValue as Record<string, unknown>;
  const message = signed?.message as BrokerApprovalMessage;
  if (
    !message ||
    signed.primaryType !== "BrokerSettlementApproval" ||
    typeof signed.signature !== "string"
  )
    throw new Error("서명된 해외 증권사 정산 승인이 필요하다.");
  const order = await getSecondaryExecutionPayload(pool, orderId);
  if (!order) throw new Error("승인할 24시간 거래 주문이 없다.");
  const intentMessage = (order.signed_intent as { message?: SecondaryMessage }).message;
  const quoteMessage = (order.signed_quote as { message?: QuoteMessage }).message;
  if (!intentMessage || !quoteMessage) throw new Error("주문과 호가 서명자료가 없다.");
  if (
    message.orderId !== orderId ||
    message.investor.toLowerCase() !== String(order.investor_wallet).toLowerCase() ||
    message.marketMaker.toLowerCase() !== String(order.market_maker_wallet).toLowerCase() ||
    message.token.toLowerCase() !== intentMessage.token.toLowerCase() ||
    message.paymentMode !== order.funding_mode ||
    message.paymentAssetId !== order.payment_asset_id ||
    message.shareQuantity !== String(order.fill_quantity) ||
    message.paymentAmountMinor !== String(order.payment_amount_minor) ||
    message.policyVersion !== keccak256(toHex(LOCAL_SECONDARY_POLICY)) ||
    BigInt(message.expiresAt) <= BigInt(Math.floor(now.getTime() / 1000))
  )
    throw new Error("정산 승인과 예약된 주문·호가가 일치하지 않는다.");
  const valid = await verifyTypedData({
    address: getAddress(secondaryBrokerAddress),
    domain: domain(signed.domain),
    types: brokerApprovalTypes,
    primaryType: "BrokerSettlementApproval",
    message: {
      approvalId: uuidToBytes16(message.approvalId),
      orderId: uuidToBytes16(message.orderId),
      investor: getAddress(message.investor),
      marketMaker: getAddress(message.marketMaker),
      token: getAddress(message.token),
      paymentMode: message.paymentMode,
      paymentAssetId: message.paymentAssetId as `0x${string}`,
      shareQuantity: BigInt(message.shareQuantity),
      paymentAmountMinor: BigInt(message.paymentAmountMinor),
      rightsEvidenceHash: message.rightsEvidenceHash as `0x${string}`,
      fundsEvidenceHash: message.fundsEvidenceHash as `0x${string}`,
      nonce: BigInt(message.nonce),
      expiresAt: BigInt(message.expiresAt),
      policyVersion: message.policyVersion as `0x${string}`,
    },
    signature: signed.signature as `0x${string}`,
  });
  if (!valid) throw new Error("해외 증권사 정산 승인 서명이 유효하지 않다.");
  return signed;
}
