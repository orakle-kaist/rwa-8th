import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { keccak256, padHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  claimOutbox,
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
const policyVersion = keccak256(toHex("SECONDARY-SIM-1"));
const domain = {
  name: "Korean Equity RWA Intent",
  version: "1",
  chainId: 31337,
  verifyingContract,
} as const;

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
      unitPriceMinor: "1203550000",
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
        securityId: "990002",
        marketMakerSide: "SELL",
        fundingMode: "USDC_ONCHAIN",
        shareQuantity: "5",
        unitPrice: { currency: "USDC", amountMinor: "1203550000", decimals: 6 },
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
  });
});
