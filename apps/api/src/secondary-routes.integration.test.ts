import { generateKeyPairSync, randomUUID, sign } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { keccak256, padHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  claimOutbox,
  processHedgeOutbox,
  processSecondaryOutbox,
  seedPrimaryData,
  seedProtectionData,
  seedSecondaryData,
} from "@rwa/database";
import { createClock } from "@rwa/domain";
import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const now = new Date("2026-08-31T12:00:00Z");
const clock = createClock({ TEST_CLOCK_MODE: "fixed", TEST_CLOCK_ISO: now.toISOString() });
const app = await buildApp({ clock, logger: false, pool });
const investor = privateKeyToAccount(keccak256(toHex("PRIMARY-DEMO-B")));
const marketMaker = privateKeyToAccount(keccak256(toHex("SECONDARY-DEMO-MM")));
const broker = privateKeyToAccount(keccak256(toHex("SECONDARY-BROKER")));
const verifyingContract = "0x0000000000000000000000000000000000000990" as const;
const tokenAddress = "0x0000000000000000000000000000000000009902" as const;
const usdcAddress = "0x0000000000000000000000000000000000000dC2" as const;
const policyVersion = keccak256(toHex("LOCAL-POLICY-V1"));
const domain = {
  name: "Korean Equity RWA Intent",
  version: "1",
  chainId: 31337,
  verifyingContract,
} as const;
const adapterKeys = generateKeyPairSync("ed25519");
const adapterInstitutionId = "00000000-0000-4000-8000-000000000401";
let adapterSequence = 0;
process.env.MOCK_ADAPTER_PUBLIC_KEY = adapterKeys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

async function submitHedgeAdapterEvent(
  hedgeId: string,
  eventType: string,
  data: Record<string, unknown>,
) {
  adapterSequence += 1;
  const unsigned = {
    eventId: randomUUID(),
    eventType,
    sourceInstitutionId: adapterInstitutionId,
    sourceSequence: adapterSequence,
    sentAt: now.toISOString(),
    keyId: "api-integration-ed25519",
    sourceMetadata: {
      sourceOrganization: "모의 국내 증권사·수탁기관",
      sourceRecordId: randomUUID(),
      effectiveAt: now.toISOString(),
      receivedAt: now.toISOString(),
      policyVersion: "LOCAL-POLICY-V1",
      simulation: true,
    },
    data: { hedgeId, ...data },
  };
  const signature = sign(
    null,
    Buffer.from(canonicalJson(unsigned)),
    adapterKeys.privateKey,
  ).toString("base64url");
  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/adapter-events",
    headers: { "x-correlation-id": randomUUID() },
    payload: { ...unsigned, signature },
  });
  expect(accepted.statusCode, accepted.body).toBe(202);
  const messages = await claimOutbox(pool, 20, now);
  const hedgeMessage = messages.find(
    (message) =>
      message.workflowId === hedgeId && message.eventType === "HEDGE_ADAPTER_EVENT_RECEIVED",
  );
  expect(hedgeMessage).toBeDefined();
  await processHedgeOutbox(pool, hedgeMessage!, now);
}

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await pool.query(
    "TRUNCATE secondary_settlement_attempts,secondary_state_history,secondary_orders,market_maker_quotes,market_maker_positions,secondary_market_state,primary_state_history,primary_default_resolutions,primary_corrections,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,complaint_history,complaints,products,disclosures,synthetic_customer_profiles,audit_records,inbox_messages,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, now);
  await seedSecondaryData(pool, now);
  adapterSequence = 0;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const commandHeaders = () => ({
  authorization: "Bearer demo:market-maker",
  "idempotency-key": randomUUID(),
  "x-correlation-id": randomUUID(),
});

describe("24시간 제한 거래 API", () => {
  it("시장조성자 5주 호가에 투자자 8주 주문을 접수하고 기관 승인 뒤 5주만 완료한다", async () => {
    const quoteId = randomUUID();
    const expiresAt = Math.floor(now.getTime() / 1000) + 30;
    const paymentAssetId = padHex(usdcAddress, { size: 32 });
    const quoteMessage = {
      quoteId,
      marketMaker: marketMaker.address,
      token: tokenAddress,
      marketMakerSide: "SELL",
      paymentMode: "USDC_ONCHAIN",
      paymentAssetId,
      shareQuantity: "5",
      unitPriceMinor: "187120000",
      nonce: "11",
      expiresAt: String(expiresAt),
      policyVersion,
    };
    const quoteSignature = await marketMaker.signTypedData({
      domain,
      types: {
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
      },
      primaryType: "MarketMakerQuote",
      message: {
        ...quoteMessage,
        quoteId: `0x${quoteId.replaceAll("-", "")}`,
        shareQuantity: 5n,
        unitPriceMinor: 1_203_550_000n,
        nonce: 11n,
        expiresAt: BigInt(expiresAt),
      },
    });
    const quoteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/market-maker/quotes",
      headers: commandHeaders(),
      payload: {
        securityId: "990001",
        marketMakerSide: "SELL",
        fundingMode: "USDC_ONCHAIN",
        shareQuantity: "5",
        unitPrice: { currency: "USDC", amountMinor: "187120000", decimals: 6 },
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        signedQuote: {
          domain,
          primaryType: "MarketMakerQuote",
          message: quoteMessage,
          signer: marketMaker.address,
          signature: quoteSignature,
        },
      },
    });
    expect(quoteResponse.statusCode, quoteResponse.body).toBe(202);

    const orderId = randomUUID();
    const orderMessage = {
      orderId,
      quoteId,
      investor: investor.address,
      token: tokenAddress,
      investorSide: "BUY",
      paymentMode: "USDC_ONCHAIN",
      paymentAssetId,
      shareQuantity: "8",
      paymentAmountMinor: "9628400000",
      nonce: "12",
      expiresAt: String(expiresAt),
      policyVersion,
    };
    const orderSignature = await investor.signTypedData({
      domain,
      types: {
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
      },
      primaryType: "SecondaryOrderIntent",
      message: {
        ...orderMessage,
        orderId: `0x${orderId.replaceAll("-", "")}`,
        quoteId: `0x${quoteId.replaceAll("-", "")}`,
        shareQuantity: 8n,
        paymentAmountMinor: 9_628_400_000n,
        nonce: 12n,
        expiresAt: BigInt(expiresAt),
      },
    });
    const orderResponse = await app.inject({
      method: "POST",
      url: "/api/v1/secondary-orders",
      headers: { ...commandHeaders(), authorization: "Bearer demo:investor-b" },
      payload: {
        quoteId,
        shareQuantity: "8",
        investorSide: "BUY",
        fundingMode: "USDC_ONCHAIN",
        signedIntent: {
          domain,
          primaryType: "SecondaryOrderIntent",
          message: orderMessage,
          signer: investor.address,
          signature: orderSignature,
        },
      },
    });
    expect(orderResponse.statusCode, orderResponse.body).toBe(202);

    const approvalId = randomUUID();
    const approvalMessage = {
      approvalId,
      orderId,
      investor: investor.address,
      marketMaker: marketMaker.address,
      token: tokenAddress,
      paymentMode: "USDC_ONCHAIN",
      paymentAssetId,
      shareQuantity: "5",
      paymentAmountMinor: "6017750000",
      rightsEvidenceHash: keccak256(toHex("rights")),
      fundsEvidenceHash: keccak256(toHex("funds")),
      nonce: "13",
      expiresAt: String(expiresAt),
      policyVersion,
    };
    const brokerSignature = await broker.signTypedData({
      domain,
      types: {
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
      },
      primaryType: "BrokerSettlementApproval",
      message: {
        ...approvalMessage,
        approvalId: `0x${approvalId.replaceAll("-", "")}`,
        orderId: `0x${orderId.replaceAll("-", "")}`,
        shareQuantity: 5n,
        paymentAmountMinor: 6_017_750_000n,
        nonce: 13n,
        expiresAt: BigInt(expiresAt),
      },
    });
    const decision = await app.inject({
      method: "POST",
      url: `/api/v1/institution/tasks/${orderId}/decisions`,
      headers: { ...commandHeaders(), authorization: "Bearer demo:broker-operator" },
      payload: {
        decision: "APPROVE",
        reasonKo: "모의 예약 증거 확인",
        expectedAggregateVersion: 1,
        signedSettlementApproval: {
          domain,
          primaryType: "BrokerSettlementApproval",
          message: approvalMessage,
          signer: broker.address,
          signature: brokerSignature,
        },
      },
    });
    expect(decision.statusCode, decision.body).toBe(202);
    const messages = await claimOutbox(pool, 10, now);
    const secondary = messages.find((message) => message.workflowId === orderId)!;
    await processSecondaryOutbox(pool, secondary, now, async () => `0x${"ab".repeat(32)}`);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/secondary-orders",
      headers: { authorization: "Bearer demo:investor-b" },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      status: "COMPLETED",
      fillQuantity: "5",
      cancelledQuantity: "3",
    });

    const hedgeList = await app.inject({
      method: "GET",
      url: "/api/v1/market-maker/hedges",
      headers: { authorization: "Bearer demo:broker-operator" },
    });
    expect(hedgeList.statusCode, hedgeList.body).toBe(200);
    const hedge = hedgeList.json().items[0] as {
      hedgeId: string;
      requestedQuantity: string;
      targetTradingDate: string;
      aggregateVersion: number;
    };
    expect(hedge).toMatchObject({ requestedQuantity: "5", targetTradingDate: "2026-09-01" });
    const hedgeExpiresAt = String(expiresAt + 3600);
    const hedgeMessage = {
      orderId: hedge.hedgeId,
      investor: marketMaker.address,
      securityId: "990001",
      shareQuantity: "5",
      krwLimitPrice: "1653000",
      targetTradingDate: "2026-09-01",
      fundingMode: "USD_LEDGER",
      fundingAmountMinor: "598783",
      nonce: "21",
      expiresAt: hedgeExpiresAt,
      policyVersion,
    };
    const hedgeSignature = await marketMaker.signTypedData({
      domain,
      types: {
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
      },
      primaryType: "PrimaryOrderIntent",
      message: {
        ...hedgeMessage,
        orderId: `0x${hedge.hedgeId.replaceAll("-", "")}`,
        shareQuantity: 5n,
        krwLimitPrice: 1_653_000n,
        fundingAmountMinor: 598_783n,
        nonce: 21n,
        expiresAt: BigInt(hedgeExpiresAt),
      },
    });
    const mmDecision = await app.inject({
      method: "POST",
      url: `/api/v1/market-maker/hedges/${hedge.hedgeId}/decisions`,
      headers: commandHeaders(),
      payload: {
        decision: "APPROVE",
        reasonKo: "시장조성자 매수 헤지 확인",
        expectedAggregateVersion: hedge.aggregateVersion,
        signedHedgeIntent: {
          domain,
          primaryType: "PrimaryOrderIntent",
          message: hedgeMessage,
          signer: marketMaker.address,
          signature: hedgeSignature,
        },
      },
    });
    expect(mmDecision.statusCode, mmDecision.body).toBe(202);
    const brokerDecision = await app.inject({
      method: "POST",
      url: `/api/v1/market-maker/hedges/${hedge.hedgeId}/decisions`,
      headers: {
        ...commandHeaders(),
        authorization: "Bearer demo:broker-operator",
      },
      payload: {
        decision: "APPROVE",
        reasonKo: "외국인 한도와 위험 확인",
        expectedAggregateVersion: hedge.aggregateVersion + 1,
      },
    });
    expect(brokerDecision.statusCode, brokerDecision.body).toBe(202);
    const approved = await app.inject({
      method: "GET",
      url: "/api/v1/market-maker/hedges",
      headers: { authorization: "Bearer demo:market-maker" },
    });
    expect(approved.json().items[0]).toMatchObject({ status: "HEDGE_KRX_OPEN_PENDING" });

    await submitHedgeAdapterEvent(hedge.hedgeId, "market-maker.hedge.execution-confirmed.v1", {
      tradingDate: "2026-09-01",
      filledQuantity: "5",
      domesticOrderReference: "SIM-KRX-API-BUY-5",
    });
    await submitHedgeAdapterEvent(
      hedge.hedgeId,
      "market-maker.hedge.domestic-settlement-confirmed.v1",
      {},
    );
    await submitHedgeAdapterEvent(hedge.hedgeId, "market-maker.hedge.custody-confirmed.v1", {});
    const adjusted = await app.inject({
      method: "GET",
      url: "/api/v1/market-maker/hedges",
      headers: { authorization: "Bearer demo:market-maker" },
    });
    expect(adjusted.json().items[0]).toMatchObject({
      status: "HEDGE_INVENTORY_ADJUSTED",
      domesticSettlementConfirmed: true,
      custodyQuantityConfirmed: true,
    });
    expect(adjusted.json().items[0].history.map((item: { state: string }) => item.state)).toEqual(
      expect.arrayContaining([
        "HEDGE_CREATED",
        "HEDGE_RISK_REVIEW",
        "HEDGE_KRX_OPEN_PENDING",
        "HEDGE_T2_PENDING",
        "HEDGE_INVENTORY_ADJUSTED",
      ]),
    );
  });
});
