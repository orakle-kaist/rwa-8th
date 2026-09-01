import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptCommand,
  BROKER_INSTITUTION_ID,
  claimOutbox,
  completeEligibilityChainSync,
  CURRENT_DISCLOSURE_ID,
  CURRENT_DISCLOSURE_VERSION,
  getCurrentConsent,
  getCustomerReadiness,
  listComplaints,
  processProtectionMessage,
  seedProtectionData,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("통합시험에는 DATABASE_URL이 필요하다.");
const pool = new Pool({ connectionString: databaseUrl });
const now = new Date("2026-08-31T12:00:00.000Z");
const investorA = "00000000-0000-4000-8000-000000000001";

async function processNext() {
  const messages = await claimOutbox(pool, 1, now);
  expect(messages).toHaveLength(1);
  await processProtectionMessage(pool, messages[0]!, now);
}

beforeAll(async () => {
  await pool.query(
    "TRUNCATE complaint_history, complaints, disclosure_consents, customer_wallets, audit_records, outbox_messages, idempotency_records, workflows CASCADE",
  );
  await seedProtectionData(pool);
});

afterAll(async () => pool.end());

describe("고객·상품·투자자 보호 PostgreSQL 흐름", () => {
  it("기준정보를 반복 적재해도 201개 후보와 대표 6종목만 유지한다", async () => {
    await seedProtectionData(pool);
    const result = await pool.query<{
      count: string;
      distinct_count: string;
      representatives: string;
      missing_isin: string;
      disabled: string;
    }>(`SELECT count(*)::text AS count,
              count(DISTINCT security_id)::text AS distinct_count,
              count(*) FILTER (WHERE representative)::text AS representatives,
              count(*) FILTER (WHERE isin IS NULL)::text AS missing_isin,
              count(*) FILTER (WHERE primary_availability='DISABLED' AND secondary_availability='DISABLED' AND redemption_availability='DISABLED')::text AS disabled
       FROM products`);
    expect(result.rows[0]).toEqual({
      count: "201",
      distinct_count: "201",
      representatives: "6",
      missing_isin: "201",
      disabled: "201",
    });
  });

  it("현재 공시 동의를 비동기로 반영하고 멱등 충돌을 구분한다", async () => {
    const idempotencyKey = "consent-test-key-00000001";
    const payload = {
      disclosureId: CURRENT_DISCLOSURE_ID,
      version: CURRENT_DISCLOSURE_VERSION,
      consentedAt: now.toISOString(),
    };
    const first = await acceptCommand(pool, {
      principalId: investorA,
      role: "INVESTOR",
      idempotencyKey,
      correlationId: randomUUID(),
      workflowType: "DISCLOSURE_CONSENT",
      commandType: "DISCLOSURE_CONSENT_REQUESTED",
      payload,
      now,
    });
    expect(first.conflict).toBe(false);
    await processNext();
    expect((await getCurrentConsent(pool, investorA, now))?.status).toBe("VALID");
    const repeated = await acceptCommand(pool, {
      principalId: investorA,
      role: "INVESTOR",
      idempotencyKey,
      correlationId: randomUUID(),
      workflowType: "DISCLOSURE_CONSENT",
      commandType: "DISCLOSURE_CONSENT_REQUESTED",
      payload,
      now,
    });
    expect(repeated).toMatchObject({ conflict: false, repeated: true });
    const conflict = await acceptCommand(pool, {
      principalId: investorA,
      role: "INVESTOR",
      idempotencyKey,
      correlationId: randomUUID(),
      workflowType: "DISCLOSURE_CONSENT",
      commandType: "DISCLOSURE_CONSENT_REQUESTED",
      payload: { ...payload, consentedAt: "2026-08-31T12:01:00.000Z" },
      now,
    });
    expect(conflict.conflict).toBe(true);
  });

  it("거절·만료 고객과 지갑 미연결 고객의 차단 사유를 분리한다", async () => {
    const eligible = await getCustomerReadiness(pool, investorA, now);
    const denied = await getCustomerReadiness(pool, "00000000-0000-4000-8000-000000000003", now);
    const expired = await getCustomerReadiness(pool, "00000000-0000-4000-8000-000000000004", now);
    expect(eligible?.blockingReasons.map((item) => item.code)).toContain("WALLET_NOT_LINKED");
    expect(denied?.canPlaceNewOrder).toBe(false);
    expect(expired?.eligibility).toBe("EXPIRED");
  });

  it("기관 승인과 적격성 체인 반영이 모두 끝난 뒤에만 지갑을 활성화한다", async () => {
    const wallet = "0x00000000000000000000000000000000000000a1";
    const request = await acceptCommand(pool, {
      principalId: investorA,
      role: "INVESTOR",
      idempotencyKey: "wallet-link-test-key-00001",
      correlationId: randomUUID(),
      workflowType: "WALLET_LINKAGE",
      commandType: "WALLET_LINK_REQUESTED",
      payload: { wallet, ownershipSignature: "0xsynthetic" },
      now,
    });
    if (request.conflict) throw new Error("예상하지 않은 멱등 충돌이다.");
    await processNext();
    expect((await getCustomerReadiness(pool, investorA, now))?.wallet).toBe("APPROVAL_PENDING");

    await acceptCommand(pool, {
      principalId: "00000000-0000-4000-8000-000000000102",
      role: "OVERSEAS_BROKER_OPERATOR",
      idempotencyKey: "wallet-approval-test-000001",
      correlationId: randomUUID(),
      workflowType: "INSTITUTION_DECISION",
      commandType: "INSTITUTION_DECISION_REQUESTED",
      payload: { taskId: request.workflowId, decision: "APPROVE", reasonKo: "합성 승인" },
      now,
    });
    await processNext();
    expect((await getCustomerReadiness(pool, investorA, now))?.wallet).toBe("CHAIN_SYNC_PENDING");
    const chainMessages = await claimOutbox(pool, 1, now);
    expect(chainMessages[0]?.eventType).toBe("ELIGIBILITY_CHAIN_SYNC_REQUESTED");
    await completeEligibilityChainSync(pool, {
      workflowId: request.workflowId,
      outboxId: chainMessages[0]!.outboxId,
      transactionHash: `0x${"42".repeat(32)}`,
      now,
    });
    const readiness = await getCustomerReadiness(pool, investorA, now);
    expect(readiness?.wallet).toBe("LINKED");
    expect(readiness?.canPlaceNewOrder).toBe(true);
  });

  it("지갑 교체를 접수하면 기존 지갑부터 동결하고 새 지갑은 검토상태로 둔다", async () => {
    await acceptCommand(pool, {
      principalId: investorA,
      role: "INVESTOR",
      idempotencyKey: "wallet-replace-test-00001",
      correlationId: randomUUID(),
      workflowType: "WALLET_REPLACEMENT",
      commandType: "WALLET_REPLACEMENT_REQUESTED",
      payload: {
        oldWallet: "0x00000000000000000000000000000000000000a1",
        newWallet: "0x00000000000000000000000000000000000000a2",
        reasonKo: "합성 교체",
      },
      now,
    });
    await processNext();
    const rows = await pool.query<{ wallet_address: string; status: string; active: boolean }>(
      "SELECT wallet_address,status,active FROM customer_wallets WHERE principal_id=$1 ORDER BY created_at",
      [investorA],
    );
    expect(rows.rows).toEqual([
      {
        wallet_address: "0x00000000000000000000000000000000000000a1",
        status: "FROZEN",
        active: false,
      },
      {
        wallet_address: "0x00000000000000000000000000000000000000a2",
        status: "REPLACEMENT_REVIEW",
        active: false,
      },
    ]);
  });

  it("민원 원문과 상태이력을 보존하고 다른 투자자에게 노출하지 않는다", async () => {
    await acceptCommand(pool, {
      principalId: investorA,
      role: "INVESTOR",
      idempotencyKey: "complaint-test-key-0000001",
      correlationId: randomUUID(),
      workflowType: "COMPLAINT",
      commandType: "COMPLAINT_SUBMIT_REQUESTED",
      payload: {
        type: "BROKERAGE_ACCOUNT",
        titleKo: "계좌 처리 확인",
        descriptionKo: "합성 계좌 처리상태를 확인해 달라.",
        disclosureVersion: CURRENT_DISCLOSURE_VERSION,
      },
      now,
    });
    await processNext();
    const own = await listComplaints(pool, investorA, "INVESTOR", now);
    const other = await listComplaints(
      pool,
      "00000000-0000-4000-8000-000000000002",
      "INVESTOR",
      now,
    );
    expect(own.items[0]).toMatchObject({ titleKo: "계좌 처리 확인", status: "SUBMITTED" });
    expect(other.items).toHaveLength(0);
    const history = await pool.query("SELECT * FROM complaint_history");
    const audit = await pool.query("SELECT * FROM audit_records WHERE action LIKE 'COMPLAINT_%'");
    expect(history.rowCount).toBe(1);
    expect(audit.rowCount).toBe(1);

    const complaintId = own.items[0]!.complaintId as string;
    const transitions = [
      {
        commandType: "COMPLAINT_ASSIGN_REQUESTED",
        payload: { complaintId, responsibleInstitutionId: BROKER_INSTITUTION_ID },
      },
      { commandType: "COMPLAINT_START_REQUESTED", payload: { complaintId } },
      {
        commandType: "COMPLAINT_RESPONSE_REQUESTED",
        payload: { complaintId, responseReferenceId: randomUUID() },
      },
      {
        commandType: "COMPLAINT_CORRECTION_REQUESTED",
        payload: { complaintId, correctionWorkflowId: randomUUID() },
      },
      {
        commandType: "COMPLAINT_CLOSE_REQUESTED",
        payload: { complaintId, closedAt: now.toISOString() },
      },
    ];
    for (const [index, transition] of transitions.entries()) {
      await acceptCommand(pool, {
        principalId: "00000000-0000-4000-8000-000000000102",
        role: "OVERSEAS_BROKER_OPERATOR",
        idempotencyKey: `complaint-transition-${index}-00001`,
        correlationId: randomUUID(),
        workflowType: "COMPLAINT",
        commandType: transition.commandType,
        payload: transition.payload,
        now,
      });
      await processNext();
    }
    const closed = await listComplaints(pool, investorA, "INVESTOR", now);
    expect(closed.items[0]).toMatchObject({ status: "CLOSED" });
    const completedHistory = await pool.query(
      "SELECT new_status FROM complaint_history WHERE complaint_id=$1 ORDER BY aggregate_version",
      [complaintId],
    );
    expect(completedHistory.rows.map((row) => row.new_status)).toEqual([
      "SUBMITTED",
      "ASSIGNED",
      "IN_PROGRESS",
      "RESPONSE_RECORDED",
      "CORRECTION_REVIEW",
      "CLOSED",
    ]);
  });
});
