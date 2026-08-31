import { randomUUID } from "node:crypto";

import {
  CURRENT_DISCLOSURE_ID,
  claimOutbox,
  processProtectionMessage,
  seedProtectionData,
} from "@rwa/database";
import { createClock, walletOwnershipMessage } from "@rwa/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { buildApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const clock = createClock({
  TEST_CLOCK_MODE: "fixed",
  TEST_CLOCK_ISO: "2026-08-31T12:00:00.000Z",
});
const app = await buildApp({ pool, clock, logger: false });

function commandHeaders(token = "demo:investor-a", key = randomUUID()) {
  return {
    authorization: `Bearer ${token}`,
    "idempotency-key": `integration-${key}`,
    "x-correlation-id": randomUUID(),
  };
}

async function processNext() {
  const messages = await claimOutbox(pool, 1, clock.now());
  expect(messages).toHaveLength(1);
  await processProtectionMessage(pool, messages[0]!, clock.now());
}

beforeAll(async () => {
  await pool.query(
    "TRUNCATE complaint_history, complaints, disclosure_consents, customer_wallets, audit_records, outbox_messages, idempotency_records, workflows CASCADE",
  );
  await seedProtectionData(pool);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("고객·상품·투자자 보호 API", () => {
  it("201개 상품 후보와 대표 6종목을 페이지로 조회한다", async () => {
    const pages = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/products?limit=100" }),
      app.inject({ method: "GET", url: "/api/v1/products?limit=100&cursor=100" }),
      app.inject({ method: "GET", url: "/api/v1/products?limit=100&cursor=200" }),
    ]);
    const items = pages.flatMap((response) => response.json().items);
    expect(items).toHaveLength(201);
    expect(items.filter((item) => item.representative)).toHaveLength(6);
    expect(items.every((item) => !item.isin && item.availability.primary === "DISABLED")).toBe(
      true,
    );
  });

  it("공시 동의는 202로 접수하고 동일 멱등키의 다른 본문은 거절한다", async () => {
    const headers = commandHeaders();
    const body = {
      disclosureId: CURRENT_DISCLOSURE_ID,
      version: "SIM-RISK-2",
      consentedAt: clock.now().toISOString(),
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/disclosure-consents",
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(202);
    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/disclosure-consents",
      headers,
      payload: body,
    });
    expect(repeated.statusCode).toBe(202);
    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/disclosure-consents",
      headers,
      payload: { ...body, consentedAt: "2026-08-31T12:01:00.000Z" },
    });
    expect(conflict.statusCode).toBe(409);
    await processNext();
  });

  it("브라우저 소유확인 서명은 검증하고 위조 서명은 거절한다", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({
      message: walletOwnershipMessage(
        "00000000-0000-4000-8000-000000000001",
        account.address,
        "LINK",
      ),
    });
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/wallet-link-requests",
      headers: commandHeaders(),
      payload: { wallet: account.address, ownershipSignature: signature },
    });
    expect(accepted.statusCode).toBe(202);
    await processNext();
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/wallet-link-requests",
      headers: commandHeaders(),
      payload: {
        wallet: "0x00000000000000000000000000000000000000b1",
        ownershipSignature: signature,
      },
    });
    expect(forged.statusCode).toBe(422);
  });

  it("투자자 민원 원문을 반환하되 다른 고객의 조회는 막는다", async () => {
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/complaints",
      headers: commandHeaders(),
      payload: {
        type: "PLATFORM_TECHNICAL",
        titleKo: "화면 표시 확인",
        descriptionKo: "모의 표시가 보이는지 확인해 달라.",
        disclosureVersion: "SIM-RISK-2",
      },
    });
    expect(accepted.statusCode).toBe(202);
    await processNext();
    const own = await app.inject({
      method: "GET",
      url: "/api/v1/complaints",
      headers: { authorization: "Bearer demo:investor-a" },
    });
    const complaint = own.json().items[0];
    expect(complaint).toMatchObject({ titleKo: "화면 표시 확인", status: "SUBMITTED" });
    const other = await app.inject({
      method: "GET",
      url: `/api/v1/complaints/${complaint.complaintId}`,
      headers: { authorization: "Bearer demo:investor-b" },
    });
    expect(other.statusCode).toBe(404);
  });

  it("거절·만료 프로필은 별도 차단 상태로 조회한다", async () => {
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { authorization: "Bearer demo:investor-denied" },
    });
    const expired = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { authorization: "Bearer demo:investor-expired" },
    });
    expect(denied.json().customerReadiness.canPlaceNewOrder).toBe(false);
    expect(expired.json().customerReadiness.eligibility).toBe("EXPIRED");
  });

  it("시장조성자의 고객 민원 조회와 잘못된 민원 유형을 차단한다", async () => {
    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/v1/complaints",
      headers: { authorization: "Bearer demo:market-maker" },
    });
    expect(unauthorized.statusCode).toBe(403);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/complaints",
      headers: commandHeaders(),
      payload: {
        type: "ACCOUNT",
        titleKo: "잘못된 유형",
        descriptionKo: "승인 명세에 없는 민원 유형이다.",
        disclosureVersion: "SIM-RISK-2",
      },
    });
    expect(invalid.statusCode).toBe(422);
  });
});
