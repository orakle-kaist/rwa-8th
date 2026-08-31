import { randomUUID } from "node:crypto";

import {
  claimOutbox,
  processPrimaryOutbox,
  seedPrimaryData,
  seedProtectionData,
} from "@rwa/database";
import { createClock, reserveAmountForOrder } from "@rwa/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const clock = createClock({ TEST_CLOCK_MODE: "fixed", TEST_CLOCK_ISO: "2026-08-31T12:00:00.000Z" });
const app = await buildApp({ pool, clock, logger: false });
const account = privateKeyToAccount(
  "0xd3fa36629c3d29b0633bdeb3e75a9c14ea7bb72711edca33778f8f8c162d87a1" as Hex,
);

beforeAll(async () => {
  await pool.query(
    "TRUNCATE primary_state_history,primary_corrections,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,audit_records,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, clock.now());
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("1차 발행 API", () => {
  it("서명된 USD 정수 지정가 주문을 202로 접수하고 상세 진행상태를 조회한다", async () => {
    const orderId = randomUUID();
    const domain = {
      name: "Korean Equity RWA Intent",
      version: "1",
      chainId: 31337,
      verifyingContract: "0x0000000000000000000000000000000000000990" as const,
    };
    const message = {
      orderId,
      investor: account.address,
      securityId: "990001",
      shareQuantity: "5",
      krwLimitPrice: "257000",
      targetTradingDate: "2026-08-31",
      fundingMode: "USD_LEDGER",
      fundingAmountMinor: reserveAmountForOrder(5n, 257000n).toString(),
      nonce: "1",
      expiresAt: "1800003600",
      policyVersion: `0x${"11".repeat(32)}` as const,
    };
    const signature = await account.signTypedData({
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
        ...message,
        orderId: `0x${orderId.replaceAll("-", "")}` as Hex,
        shareQuantity: 5n,
        krwLimitPrice: 257000n,
        fundingAmountMinor: BigInt(message.fundingAmountMinor),
        nonce: 1n,
        expiresAt: 1800003600n,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/primary-orders",
      headers: {
        authorization: "Bearer demo:investor-a",
        "idempotency-key": "primary-api-test-00000001",
        "x-correlation-id": randomUUID(),
      },
      payload: {
        securityId: "990001",
        shareQuantity: "5",
        krwLimitPrice: "257000",
        targetTradingDate: "2026-08-31",
        fundingMode: "USD_LEDGER",
        signedIntent: {
          domain,
          primaryType: "PrimaryOrderIntent",
          message,
          signer: account.address,
          signature,
        },
      },
    });
    expect(response.statusCode).toBe(202);
    const messages = await claimOutbox(pool, 10, clock.now());
    for (const event of messages)
      expect(await processPrimaryOutbox(pool, event, clock.now())).toBe(true);
    const orders = await app.inject({
      method: "GET",
      url: "/api/v1/primary-orders",
      headers: { authorization: "Bearer demo:investor-a" },
    });
    expect(orders.json().items[0]).toMatchObject({
      orderId,
      status: "BATCHED",
      shareQuantity: "5",
      fundingMode: "USD_LEDGER",
    });
  });

  it("소수수량과 다른 고객 주문 조회를 차단한다", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/primary-orders",
      headers: {
        authorization: "Bearer demo:investor-a",
        "idempotency-key": "primary-api-invalid-00001",
        "x-correlation-id": randomUUID(),
      },
      payload: {
        securityId: "990001",
        shareQuantity: "0.5",
        krwLimitPrice: "257000",
        targetTradingDate: "2026-08-31",
        fundingMode: "USD_LEDGER",
        signedIntent: {},
      },
    });
    expect(invalid.statusCode).toBe(422);
    const other = await app.inject({
      method: "GET",
      url: "/api/v1/primary-orders",
      headers: { authorization: "Bearer demo:investor-b" },
    });
    expect(other.json().items).toHaveLength(0);
  });
});
