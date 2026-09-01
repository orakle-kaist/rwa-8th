import { randomUUID } from "node:crypto";

import { seedPrimaryData, seedProtectionData } from "@rwa/database";
import { createClock } from "@rwa/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, stringToBytes, type Hex } from "viem";
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
    "TRUNCATE redemption_state_history,redemption_cash_claims,redemption_batch_orders,redemption_batches,redemption_orders,instrument_control_totals,primary_state_history,customer_rights_positions,primary_approval_facts,primary_batch_orders,primary_batches,primary_orders,customer_cash_accounts,t2_risk_limits,local_simulation_instruments,disclosure_consents,customer_wallets,audit_records,inbox_messages,outbox_messages,idempotency_records,workflows CASCADE",
  );
  await seedProtectionData(pool);
  await seedPrimaryData(pool, clock.now());
  await pool.query(
    `INSERT INTO customer_rights_positions
     (principal_id,security_id,pending_quantity,settled_quantity,updated_at)
     VALUES ('00000000-0000-4000-8000-000000000001','990001',0,4,$1)`,
    [clock.now()],
  );
  await pool.query(
    "UPDATE instrument_control_totals SET domestic_settled_quantity=4,token_total_supply=4,updated_at=$1 WHERE security_id='990001'",
    [clock.now()],
  );
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("일반 투자자 환매 API", () => {
  it("서명된 3주 환매를 접수하고 국내 제출 전 취소한다", async () => {
    const redemptionId = randomUUID();
    const domain = {
      name: "Korean Equity RWA Intent",
      version: "1",
      chainId: 31337,
      verifyingContract: "0x0000000000000000000000000000000000000990" as const,
    };
    const message = {
      redemptionId,
      investor: account.address,
      token: "0x0000000000000000000000000000000000009901" as const,
      shareQuantity: "3",
      krwLimitPrice: "257000",
      targetTradingDate: "2026-08-31",
      nonce: "1",
      expiresAt: "1800003600",
      policyVersion: keccak256(stringToBytes("REDEMPTION-SIM-1")),
    };
    const signature = await account.signTypedData({
      domain,
      types: {
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
      },
      primaryType: "RedemptionIntent",
      message: {
        ...message,
        redemptionId: `0x${redemptionId.replaceAll("-", "")}` as Hex,
        shareQuantity: 3n,
        krwLimitPrice: 257000n,
        nonce: 1n,
        expiresAt: 1800003600n,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/redemptions",
      headers: {
        authorization: "Bearer demo:investor-a",
        "idempotency-key": "redemption-api-00000001",
        "x-correlation-id": randomUUID(),
      },
      payload: {
        securityId: "990001",
        shareQuantity: "3",
        krwLimitPrice: "257000",
        targetTradingDate: "2026-08-31",
        signedIntent: {
          domain,
          primaryType: "RedemptionIntent",
          message,
          signer: account.address,
          signature,
        },
      },
    });
    expect(response.statusCode).toBe(202);
    const cancellation = await app.inject({
      method: "POST",
      url: `/api/v1/redemptions/${redemptionId}/cancellations`,
      headers: {
        authorization: "Bearer demo:investor-a",
        "idempotency-key": "redemption-cancel-api-001",
        "x-correlation-id": randomUUID(),
      },
      payload: { reasonKo: "시험 취소" },
    });
    expect(cancellation.statusCode).toBe(202);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/redemptions",
      headers: { authorization: "Bearer demo:investor-a" },
    });
    expect(list.json().items[0]).toMatchObject({ redemptionId, status: "REDEMPTION_CANCELLED" });
  });

  it("소수수량과 다른 고객 조회를 차단한다", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/redemptions",
      headers: {
        authorization: "Bearer demo:investor-a",
        "idempotency-key": "redemption-invalid-0001",
        "x-correlation-id": randomUUID(),
      },
      payload: {
        securityId: "990001",
        shareQuantity: "0.5",
        krwLimitPrice: "257000",
        targetTradingDate: "2026-08-31",
        signedIntent: {},
      },
    });
    expect(invalid.statusCode).toBe(422);
    const other = await app.inject({
      method: "GET",
      url: "/api/v1/redemptions",
      headers: { authorization: "Bearer demo:investor-b" },
    });
    expect(other.json().items).toHaveLength(0);
  });
});
