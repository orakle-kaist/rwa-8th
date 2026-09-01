import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { OutboxMessage } from "./outbox.js";
import {
  BROKER_INSTITUTION_ID,
  CURRENT_DISCLOSURE_VERSION,
  PLATFORM_INSTITUTION_ID,
} from "./seed-protection.js";
import { getWorkflowStateAxes } from "./runtime-state.js";

export interface ProjectionMetadata {
  projectionAsOf: string;
  lastEventSequence: number;
  projectionStatus: "CURRENT";
}

function projection(now: Date): ProjectionMetadata {
  return { projectionAsOf: now.toISOString(), lastEventSequence: 0, projectionStatus: "CURRENT" };
}

function requiredPayload(payload: Record<string, string>, key: string): string {
  const value = payload[key];
  if (!value) throw new Error(`필수 업무값이 없다: ${key}`);
  return value;
}

export function commandHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function getCustomerReadiness(pool: Pool, principalId: string, now: Date) {
  const profileResult = await pool.query<{
    eligibility_status: string;
    protection_status: string;
    valid_until: Date | null;
    policy_version: string;
    responsible_institution_id: string;
  }>("SELECT * FROM synthetic_customer_profiles WHERE principal_id = $1", [principalId]);
  const profile = profileResult.rows[0];
  if (!profile) return undefined;
  const walletResult = await pool.query<{
    wallet_address: string;
    status: string;
    chain_sync_status: string;
  }>(
    `SELECT wallet_address, status, chain_sync_status FROM customer_wallets
     WHERE principal_id = $1 ORDER BY active DESC, updated_at DESC LIMIT 1`,
    [principalId],
  );
  const consentResult = await pool.query<{ valid_until: Date }>(
    `SELECT consent.valid_until FROM disclosure_consents consent
     JOIN disclosures disclosure ON disclosure.disclosure_id = consent.disclosure_id
     WHERE consent.principal_id = $1 AND disclosure.version = $2`,
    [principalId, CURRENT_DISCLOSURE_VERSION],
  );
  const wallet = walletResult.rows[0];
  const consentValid = Boolean(consentResult.rows[0] && consentResult.rows[0].valid_until >= now);
  const eligibility =
    profile.valid_until && profile.valid_until < now ? "EXPIRED" : profile.eligibility_status;
  const protection =
    profile.valid_until && profile.valid_until < now ? "EXPIRED" : profile.protection_status;
  const walletStatus =
    wallet?.status === "LINKED" && wallet.chain_sync_status === "CONFIRMED"
      ? "LINKED"
      : (wallet?.status ?? "UNLINKED");
  const reasons: Array<{
    code: string;
    messageKo: string;
    responsibleInstitutionId: string;
    nextActionKo: string;
  }> = [];
  if (eligibility !== "ELIGIBLE")
    reasons.push({
      code: "CUSTOMER_NOT_ELIGIBLE",
      messageKo: "유효한 판매 가능 판정이 없다.",
      responsibleInstitutionId: profile.responsible_institution_id,
      nextActionKo: "인가 해외 증권사의 재판정을 확인한다.",
    });
  if (protection !== "PASSED")
    reasons.push({
      code: "INVESTOR_PROTECTION_NOT_PASSED",
      messageKo: "필요한 투자자 보호 판정이 유효하지 않다.",
      responsibleInstitutionId: profile.responsible_institution_id,
      nextActionKo: "보호판정 갱신 결과를 확인한다.",
    });
  if (!consentValid)
    reasons.push({
      code: "DISCLOSURE_CONSENT_REQUIRED",
      messageKo: "현재 위험공시에 유효하게 동의해야 한다.",
      responsibleInstitutionId: profile.responsible_institution_id,
      nextActionKo: "현재 공시를 읽고 전자 동의한다.",
    });
  if (walletStatus !== "LINKED")
    reasons.push({
      code: "WALLET_NOT_LINKED",
      messageKo: "승인된 전용 지갑이 없다.",
      responsibleInstitutionId: profile.responsible_institution_id,
      nextActionKo: "지갑 연결 또는 교체 검토를 완료한다.",
    });
  const ready = reasons.length === 0;
  return {
    eligibility,
    investorProtection: protection,
    wallet: walletStatus,
    ...(wallet?.wallet_address ? { activeWallet: wallet.wallet_address } : {}),
    ...(profile.valid_until ? { validUntil: profile.valid_until.toISOString() } : {}),
    policyVersion: profile.policy_version,
    canPlaceNewOrder: ready,
    canReceiveRights: ready,
    blockingReasons: reasons,
  };
}

function mapProduct(row: Record<string, unknown>, now: Date) {
  return {
    securityId: row.security_id,
    nameKo: row.name_ko,
    referenceVersion: row.reference_version,
    ...(row.isin ? { isin: row.isin } : {}),
    ...(row.token_address ? { tokenAddress: row.token_address } : {}),
    candidateStatus: row.candidate_status,
    representative: row.representative,
    availability: {
      primary: row.primary_availability,
      secondary: row.secondary_availability,
      redemption: row.redemption_availability,
    },
    blockingReasons: row.blocking_reasons,
    notices: row.notices,
    simulation: true,
    projection: projection(now),
  };
}

export async function listProducts(
  pool: Pool,
  limit: number,
  offset: number,
  now: Date,
  scope: "candidates" | "demo" = "candidates",
) {
  const source =
    scope === "demo"
      ? `(SELECT security_id,display_name AS name_ko,'LOCAL-DEMO-V1' AS reference_version,
                 NULL::text AS isin,token_address,'REVIEWED' AS candidate_status,
                 true AS representative,
                 CASE WHEN primary_enabled THEN 'ENABLED' ELSE 'DISABLED' END AS primary_availability,
                 CASE WHEN secondary_enabled THEN 'ENABLED' ELSE 'DISABLED' END AS secondary_availability,
                 CASE WHEN redemption_enabled THEN 'ENABLED' ELSE 'DISABLED' END AS redemption_availability,
                 '[]'::jsonb AS blocking_reasons,
                 jsonb_build_object(
                   'rightsNatureKo','인가 해외 증권사의 고객별 수탁권리 원장에 기록되는 모의 권리다.',
                   'custodyRiskKo','국내 통합 보유분과 해외 증권사의 자산분리·도산위험을 별도로 확인해야 한다.',
                   'transferRestrictionKo','적격 투자자와 지정 시장조성자 사이의 승인된 거래만 허용한다.',
                   'settlementKo','체결 뒤 발행하지만 T+2 국내 결제완료 전에는 거래할 수 없다.',
                   'dividendKo','기준일 고객 권리 스냅샷으로 모의 USD 배당을 배분한다.',
                   'votingKo','고객지시를 해외 증권사가 승인한 뒤 상임대리인 모의 결과로 연결한다.',
                   'redemptionKo','국내 매도대금 결제 뒤 권리종료·USD 지급·토큰 소각을 각각 확인한다.') AS notices
          FROM local_simulation_instruments WHERE security_id='990001') product_source`
      : "products product_source";
  const result = await pool.query(
    `SELECT * FROM ${source} ORDER BY representative DESC, security_id LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${source}`);
  const nextOffset = offset + result.rows.length;
  return {
    items: result.rows.map((row) => mapProduct(row, now)),
    ...(nextOffset < Number(count.rows[0]?.count ?? 0) ? { nextCursor: String(nextOffset) } : {}),
    projection: projection(now),
  };
}

export async function getProduct(pool: Pool, securityId: string, now: Date) {
  const result = await pool.query("SELECT * FROM products WHERE security_id = $1", [securityId]);
  if (result.rows[0]) return mapProduct(result.rows[0], now);
  const demo = await pool.query(
    `SELECT security_id,display_name AS name_ko,'LOCAL-DEMO-V1' AS reference_version,
            NULL::text AS isin,token_address,'REVIEWED' AS candidate_status,
            true AS representative,
            CASE WHEN primary_enabled THEN 'ENABLED' ELSE 'DISABLED' END AS primary_availability,
            CASE WHEN secondary_enabled THEN 'ENABLED' ELSE 'DISABLED' END AS secondary_availability,
            CASE WHEN redemption_enabled THEN 'ENABLED' ELSE 'DISABLED' END AS redemption_availability,
            '[]'::jsonb AS blocking_reasons,
            jsonb_build_object(
              'rightsNatureKo','인가 해외 증권사의 고객별 수탁권리 원장에 기록되는 모의 권리다.',
              'custodyRiskKo','국내 통합 보유분과 해외 증권사의 자산분리·도산위험을 별도로 확인해야 한다.',
              'transferRestrictionKo','적격 투자자와 지정 시장조성자 사이의 승인된 거래만 허용한다.',
              'settlementKo','체결 뒤 발행하지만 T+2 국내 결제완료 전에는 거래할 수 없다.',
              'dividendKo','기준일 고객 권리 스냅샷으로 모의 USD 배당을 배분한다.',
              'votingKo','고객지시를 해외 증권사가 승인한 뒤 상임대리인 모의 결과로 연결한다.',
              'redemptionKo','국내 매도대금 결제 뒤 권리종료·USD 지급·토큰 소각을 각각 확인한다.') AS notices
     FROM local_simulation_instruments WHERE security_id=$1 AND security_id='990001'`,
    [securityId],
  );
  return demo.rows[0] ? mapProduct(demo.rows[0], now) : undefined;
}

export async function getCurrentDisclosure(pool: Pool) {
  const result = await pool.query<Record<string, unknown>>(
    "SELECT * FROM disclosures WHERE version = $1",
    [CURRENT_DISCLOSURE_VERSION],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    disclosureId: row.disclosure_id,
    version: row.version,
    titleKo: row.title_ko,
    sections: row.sections,
    effectiveFrom: (row.effective_from as Date).toISOString(),
    validUntil: (row.valid_until as Date).toISOString(),
    responsibleInstitutionId: row.responsible_institution_id,
    contentEvidenceId: row.content_evidence_id,
    simulation: true,
  };
}

export async function getCurrentConsent(pool: Pool, principalId: string, now: Date) {
  const disclosure = await getCurrentDisclosure(pool);
  if (!disclosure) return undefined;
  const result = await pool.query<{ consented_at: Date; valid_until: Date }>(
    "SELECT consented_at, valid_until FROM disclosure_consents WHERE principal_id = $1 AND disclosure_id = $2",
    [principalId, disclosure.disclosureId],
  );
  const row = result.rows[0];
  return {
    disclosureId: disclosure.disclosureId,
    version: disclosure.version,
    status: !row ? "MISSING" : row.valid_until < now ? "EXPIRED" : "VALID",
    ...(row
      ? { consentedAt: row.consented_at.toISOString(), validUntil: row.valid_until.toISOString() }
      : {}),
    simulation: true,
  };
}

export async function acceptCommand(
  pool: Pool,
  input: {
    principalId: string;
    role: string;
    idempotencyKey: string;
    correlationId: string;
    workflowType: string;
    commandType: string;
    payload: unknown;
    now: Date;
  },
) {
  const hash = commandHash(input.payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ request_hash: string; workflow_id: string }>(
      "SELECT request_hash, workflow_id FROM idempotency_records WHERE principal_id = $1 AND idempotency_key = $2",
      [input.principalId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== hash) {
        await client.query("ROLLBACK");
        return { conflict: true as const };
      }
      await client.query("COMMIT");
      return { conflict: false as const, workflowId: existing.rows[0].workflow_id, repeated: true };
    }
    const workflowId = randomUUID();
    await client.query(
      `INSERT INTO workflows (workflow_id, workflow_type, status, principal_id, correlation_id, request_payload, created_at, updated_at)
       VALUES ($1, $2, 'ACCEPTED', $3, $4, $5::jsonb, $6, $6)`,
      [
        workflowId,
        input.workflowType,
        input.principalId,
        input.correlationId,
        JSON.stringify({
          commandType: input.commandType,
          payload: input.payload,
          actorRole: input.role,
        }),
        input.now,
      ],
    );
    await client.query(
      "INSERT INTO idempotency_records (principal_id, idempotency_key, request_hash, workflow_id, created_at) VALUES ($1,$2,$3,$4,$5)",
      [input.principalId, input.idempotencyKey, hash, workflowId, input.now],
    );
    await client.query(
      `INSERT INTO outbox_messages (outbox_id, workflow_id, event_type, payload, occurred_at, available_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$5)`,
      [
        randomUUID(),
        workflowId,
        input.commandType,
        JSON.stringify({
          ...((input.payload ?? {}) as object),
          actorId: input.principalId,
          actorRole: input.role,
        }),
        input.now,
      ],
    );
    await client.query("COMMIT");
    return { conflict: false as const, workflowId, repeated: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordComplaintHistory(
  client: PoolClient,
  input: {
    complaintId: string;
    previousStatus: string | null;
    newStatus: string;
    actorId: string;
    actorRole: string;
    reasonKo?: string;
    evidenceId?: string;
    now: Date;
    version: number;
  },
) {
  await client.query(
    `INSERT INTO complaint_history (history_id, complaint_id, previous_status, new_status, actor_id, actor_role, reason_ko, evidence_reference_id, occurred_at, aggregate_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      input.complaintId,
      input.previousStatus,
      input.newStatus,
      input.actorId,
      input.actorRole,
      input.reasonKo ?? null,
      input.evidenceId ?? null,
      input.now,
      input.version,
    ],
  );
}

export async function processProtectionMessage(
  pool: Pool,
  message: OutboxMessage,
  now: Date,
): Promise<void> {
  const payload = message.payload as Record<string, string>;
  const actorId = requiredPayload(payload, "actorId");
  const actorRole = requiredPayload(payload, "actorRole");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let resultReferenceId: string | null = null;
    let workflowStatus = "COMPLETED";
    if (message.eventType === "DISCLOSURE_CONSENT_REQUESTED") {
      const disclosure = await client.query<{ disclosure_id: string; valid_until: Date }>(
        "SELECT disclosure_id, valid_until FROM disclosures WHERE version = $1 AND disclosure_id = $2",
        [payload.version, payload.disclosureId],
      );
      if (!disclosure.rows[0]) throw new Error("현재 위험공시와 일치하지 않는다.");
      await client.query(
        `INSERT INTO disclosure_consents (principal_id, disclosure_id, version, consented_at, valid_until, workflow_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (principal_id, disclosure_id) DO UPDATE SET version=EXCLUDED.version, consented_at=EXCLUDED.consented_at, valid_until=EXCLUDED.valid_until, workflow_id=EXCLUDED.workflow_id`,
        [
          actorId,
          requiredPayload(payload, "disclosureId"),
          requiredPayload(payload, "version"),
          requiredPayload(payload, "consentedAt"),
          disclosure.rows[0].valid_until,
          message.workflowId,
        ],
      );
    } else if (message.eventType === "WALLET_LINK_REQUESTED") {
      const wallet = requiredPayload(payload, "wallet").toLowerCase();
      const existing = await client.query(
        "SELECT 1 FROM customer_wallets WHERE wallet_address = $1",
        [wallet],
      );
      if (existing.rows.length) throw new Error("이미 사용 중인 지갑이다.");
      await client.query(
        `INSERT INTO customer_wallets (wallet_id, principal_id, wallet_address, status, workflow_id, created_at, updated_at)
         VALUES ($1,$2,$3,'APPROVAL_PENDING',$4,$5,$5)`,
        [randomUUID(), actorId, wallet, message.workflowId, now],
      );
      workflowStatus = "PENDING_APPROVAL";
    } else if (message.eventType === "WALLET_REPLACEMENT_REQUESTED") {
      const oldWallet = requiredPayload(payload, "oldWallet").toLowerCase();
      const newWallet = requiredPayload(payload, "newWallet").toLowerCase();
      const current = await client.query(
        "SELECT 1 FROM customer_wallets WHERE principal_id=$1 AND wallet_address=$2 AND active",
        [actorId, oldWallet],
      );
      if (!current.rows.length) throw new Error("현재 활성 지갑과 일치하지 않는다.");
      const used = await client.query("SELECT 1 FROM customer_wallets WHERE wallet_address=$1", [
        newWallet,
      ]);
      if (used.rows.length) throw new Error("새 지갑이 이미 사용 중이다.");
      await client.query(
        "UPDATE customer_wallets SET status='FROZEN', active=false, updated_at=$2 WHERE principal_id=$1 AND active",
        [actorId, now],
      );
      await client.query(
        `INSERT INTO customer_wallets (wallet_id, principal_id, wallet_address, status, workflow_id, created_at, updated_at)
         VALUES ($1,$2,$3,'REPLACEMENT_REVIEW',$4,$5,$5)`,
        [randomUUID(), actorId, newWallet, message.workflowId, now],
      );
      await client.query(
        `INSERT INTO wallet_recoveries
          (workflow_id,principal_id,old_wallet,new_wallet,status,updated_at)
         VALUES ($1,$2,$3,$4,'RECOVERY_APPROVAL_PENDING',$5)
         ON CONFLICT (workflow_id) DO NOTHING`,
        [message.workflowId, actorId, oldWallet, newWallet, now],
      );
      workflowStatus = "PENDING_APPROVAL";
    } else if (message.eventType === "INSTITUTION_DECISION_REQUESTED") {
      const target = await client.query<{ workflow_type: string; principal_id: string }>(
        "SELECT workflow_type, principal_id FROM workflows WHERE workflow_id=$1",
        [payload.taskId],
      );
      if (!target.rows[0]) throw new Error("대상 업무가 없다.");
      if (target.rows[0].workflow_type === "WALLET_LINKAGE" && payload.decision === "APPROVE") {
        const wallet = await client.query<{
          wallet_address: string;
          valid_until: Date;
        }>(
          `SELECT wallet.wallet_address, profile.valid_until
           FROM customer_wallets wallet
           JOIN synthetic_customer_profiles profile ON profile.principal_id=wallet.principal_id
           WHERE wallet.workflow_id=$1 AND wallet.status='APPROVAL_PENDING'`,
          [payload.taskId],
        );
        if (!wallet.rows[0]?.valid_until) throw new Error("유효한 고객 판정 만료시각이 없다.");
        await client.query(
          "UPDATE customer_wallets SET status='CHAIN_SYNC_PENDING', active=false, chain_sync_status='PENDING', updated_at=$2 WHERE workflow_id=$1 AND status='APPROVAL_PENDING'",
          [payload.taskId, now],
        );
        await client.query(
          "UPDATE workflows SET status='PENDING_CHAIN_SYNC', updated_at=$2 WHERE workflow_id=$1",
          [payload.taskId, now],
        );
        await client.query(
          `INSERT INTO outbox_messages
            (outbox_id, workflow_id, event_type, payload, occurred_at, available_at)
           VALUES ($1,$2,'ELIGIBILITY_CHAIN_SYNC_REQUESTED',$3::jsonb,$4,$4)`,
          [
            randomUUID(),
            payload.taskId,
            JSON.stringify({
              wallet: wallet.rows[0].wallet_address,
              validUntil: wallet.rows[0].valid_until.toISOString(),
              actorId,
              actorRole,
            }),
            now,
          ],
        );
      } else if (
        target.rows[0].workflow_type === "WALLET_REPLACEMENT" &&
        payload.decision === "APPROVE"
      ) {
        await client.query(
          "UPDATE workflows SET status='AWAITING_TOKEN_RECOVERY', updated_at=$2 WHERE workflow_id=$1",
          [payload.taskId, now],
        );
      } else {
        await client.query(
          "UPDATE workflows SET status='REJECTED', updated_at=$2 WHERE workflow_id=$1",
          [payload.taskId, now],
        );
      }
    } else if (message.eventType === "COMPLAINT_SUBMIT_REQUESTED") {
      resultReferenceId = randomUUID();
      await client.query(
        `INSERT INTO complaints (complaint_id, principal_id, complaint_type, title_ko, description_ko, status, submitted_at, related_workflow_id, related_order_id, disclosure_version)
         VALUES ($1,$2,$3,$4,$5,'SUBMITTED',$6,$7,$8,$9)`,
        [
          resultReferenceId,
          actorId,
          payload.type,
          payload.titleKo,
          payload.descriptionKo,
          now,
          payload.relatedWorkflowId ?? null,
          payload.relatedOrderId ?? null,
          payload.disclosureVersion,
        ],
      );
      await recordComplaintHistory(client, {
        complaintId: resultReferenceId,
        previousStatus: null,
        newStatus: "SUBMITTED",
        actorId,
        actorRole,
        now,
        version: 1,
      });
    } else if (message.eventType.startsWith("COMPLAINT_")) {
      const result = await client.query<{
        status: string;
        aggregate_version: number;
        complaint_type: string;
        responsible_institution_id: string | null;
      }>(
        "SELECT status, aggregate_version, complaint_type, responsible_institution_id FROM complaints WHERE complaint_id=$1 FOR UPDATE",
        [requiredPayload(payload, "complaintId")],
      );
      const complaint = result.rows[0];
      if (!complaint) throw new Error("민원이 없다.");
      if (
        message.eventType !== "COMPLAINT_ASSIGN_REQUESTED" &&
        actorRole !== "COMPLIANCE_AUDITOR" &&
        ((complaint.responsible_institution_id === PLATFORM_INSTITUTION_ID &&
          actorRole !== "PLATFORM_OPERATOR") ||
          (complaint.responsible_institution_id === BROKER_INSTITUTION_ID &&
            actorRole !== "OVERSEAS_BROKER_OPERATOR"))
      ) {
        throw new Error("민원 책임기관의 담당 역할이 아니다.");
      }
      let nextStatus: string;
      if (message.eventType === "COMPLAINT_ASSIGN_REQUESTED" && complaint.status === "SUBMITTED") {
        const expectedInstitution =
          complaint.complaint_type === "PLATFORM_TECHNICAL"
            ? PLATFORM_INSTITUTION_ID
            : BROKER_INSTITUTION_ID;
        if (payload.responsibleInstitutionId !== expectedInstitution)
          throw new Error("민원 유형과 책임기관이 일치하지 않는다.");
        nextStatus = "ASSIGNED";
        await client.query(
          "UPDATE complaints SET responsible_institution_id=$2 WHERE complaint_id=$1",
          [payload.complaintId, payload.responsibleInstitutionId],
        );
      } else if (
        message.eventType === "COMPLAINT_START_REQUESTED" &&
        complaint.status === "ASSIGNED"
      )
        nextStatus = "IN_PROGRESS";
      else if (
        message.eventType === "COMPLAINT_RESPONSE_REQUESTED" &&
        complaint.status === "IN_PROGRESS"
      ) {
        nextStatus = "RESPONSE_RECORDED";
        await client.query("UPDATE complaints SET response_reference_id=$2 WHERE complaint_id=$1", [
          payload.complaintId,
          payload.responseReferenceId,
        ]);
      } else if (
        message.eventType === "COMPLAINT_CORRECTION_REQUESTED" &&
        complaint.status === "RESPONSE_RECORDED"
      ) {
        nextStatus = "CORRECTION_REVIEW";
        await client.query(
          "UPDATE complaints SET correction_workflow_id=$2 WHERE complaint_id=$1",
          [payload.complaintId, payload.correctionWorkflowId],
        );
      } else if (
        message.eventType === "COMPLAINT_CLOSE_REQUESTED" &&
        ["RESPONSE_RECORDED", "CORRECTION_REVIEW"].includes(complaint.status)
      ) {
        nextStatus = "CLOSED";
        await client.query("UPDATE complaints SET closed_at=$2 WHERE complaint_id=$1", [
          payload.complaintId,
          payload.closedAt,
        ]);
      } else throw new Error("허용되지 않은 민원 상태전환이다.");
      const version = complaint.aggregate_version + 1;
      await client.query(
        "UPDATE complaints SET status=$2, aggregate_version=$3 WHERE complaint_id=$1",
        [payload.complaintId, nextStatus, version],
      );
      await recordComplaintHistory(client, {
        complaintId: requiredPayload(payload, "complaintId"),
        previousStatus: complaint.status,
        newStatus: nextStatus,
        actorId,
        actorRole,
        ...(payload.reasonKo ? { reasonKo: payload.reasonKo } : {}),
        ...(payload.evidenceId ? { evidenceId: payload.evidenceId } : {}),
        now,
        version,
      });
    } else throw new Error(`지원하지 않는 보호업무 명령: ${message.eventType}`);

    await client.query(
      "UPDATE workflows SET status=$2, result_reference_id=COALESCE($3,result_reference_id), updated_at=$4 WHERE workflow_id=$1",
      [message.workflowId, workflowStatus, resultReferenceId, now],
    );
    await client.query("UPDATE outbox_messages SET delivered_at=$2 WHERE outbox_id=$1", [
      message.outboxId,
      now,
    ]);
    await client.query(
      "INSERT INTO audit_records (audit_id, workflow_id, actor_id, actor_role, action, occurred_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [randomUUID(), message.workflowId, actorId, actorRole, message.eventType, now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query(
      "UPDATE workflows SET status='QUARANTINED', updated_at=$2 WHERE workflow_id=$1",
      [message.workflowId, now],
    );
    throw error;
  } finally {
    client.release();
  }
}

function mapComplaint(row: Record<string, unknown>, now: Date) {
  return {
    complaintId: row.complaint_id,
    type: row.complaint_type,
    titleKo: row.title_ko,
    descriptionKo: row.description_ko,
    status: row.status,
    submittedAt: (row.submitted_at as Date).toISOString(),
    ...(row.responsible_institution_id
      ? { responsibleInstitutionId: row.responsible_institution_id }
      : {}),
    ...(row.related_workflow_id ? { relatedWorkflowId: row.related_workflow_id } : {}),
    ...(row.related_order_id ? { relatedOrderId: row.related_order_id } : {}),
    disclosureVersion: row.disclosure_version,
    ...(row.response_reference_id ? { responseReferenceId: row.response_reference_id } : {}),
    ...(row.correction_workflow_id ? { correctionWorkflowId: row.correction_workflow_id } : {}),
    ...(row.closed_at ? { closedAt: (row.closed_at as Date).toISOString() } : {}),
    simulation: true,
    projection: projection(now),
  };
}

export async function listComplaints(pool: Pool, principalId: string, role: string, now: Date) {
  const result =
    role === "INVESTOR"
      ? await pool.query(
          "SELECT * FROM complaints WHERE principal_id=$1 ORDER BY submitted_at DESC",
          [principalId],
        )
      : await pool.query("SELECT * FROM complaints ORDER BY submitted_at DESC");
  return { items: result.rows.map((row) => mapComplaint(row, now)), projection: projection(now) };
}

export async function getComplaint(
  pool: Pool,
  complaintId: string,
  principalId: string,
  role: string,
  now: Date,
) {
  const result =
    role === "INVESTOR"
      ? await pool.query("SELECT * FROM complaints WHERE complaint_id=$1 AND principal_id=$2", [
          complaintId,
          principalId,
        ])
      : await pool.query("SELECT * FROM complaints WHERE complaint_id=$1", [complaintId]);
  return result.rows[0] ? mapComplaint(result.rows[0], now) : undefined;
}

export async function getWorkflowView(
  pool: Pool,
  workflowId: string,
  principalId: string,
  role: string,
  now: Date,
) {
  const result =
    role === "INVESTOR"
      ? await pool.query<Record<string, unknown>>(
          "SELECT * FROM workflows WHERE workflow_id=$1 AND principal_id=$2",
          [workflowId, principalId],
        )
      : await pool.query<Record<string, unknown>>("SELECT * FROM workflows WHERE workflow_id=$1", [
          workflowId,
        ]);
  const row = result.rows[0];
  if (!row) return undefined;
  const stateAxes = await getWorkflowStateAxes(pool, workflowId);
  return {
    workflowId: row.workflow_id,
    workflowType: row.workflow_type,
    states:
      stateAxes.length > 0
        ? stateAxes
        : [
            {
              axis: row.workflow_type === "COMPLAINT" ? "COMPLAINT" : "WALLET_LINKAGE",
              code: row.status,
              labelKo: String(row.status),
            },
          ],
    projection: projection(now),
  };
}

export async function listInstitutionTasks(pool: Pool, now: Date) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT workflow_id, workflow_type, status, principal_id, request_payload, created_at
     FROM workflows
     WHERE status IN (
       'PENDING_APPROVAL','PENDING_CHAIN_SYNC','AWAITING_TOKEN_RECOVERY','QUARANTINED',
       'AWAITING_KRX_EXECUTION','T2_RISK_APPROVAL_PENDING','RIGHTS_ENTRY_APPROVAL_PENDING',
       'RIGHTS_RECORDING_PENDING','SETTLEMENT_AND_CUSTODY_PENDING'
       ,'SETTLEMENT_APPROVAL_PENDING','CHAIN_EXECUTION_PENDING','RIGHTS_LEDGER_CONFIRMATION_PENDING',
       'LEDGER_RETRY_PENDING','SALE_PROCEEDS_SETTLEMENT_PENDING','RIGHTS_TERMINATION_PENDING',
       'PAYMENT_AND_BURN_PENDING'
       ,'DIVIDEND_SNAPSHOT_REVIEW','VOTE_INSTRUCTION_COLLECTION','REPORT_GENERATED',
       'REPORT_CORRECTION_REVIEW','RECOVERY_APPROVAL_PENDING','CORPORATE_ACTION_PLAN_REVIEW',
       'MISMATCH_SUSPECTED','WORK_HALTED','RELEASE_SCHEDULED'
     )
     ORDER BY created_at, workflow_id`,
  );
  return {
    items: result.rows.map((row) => ({
      workflowId: row.workflow_id,
      workflowType: row.workflow_type,
      states: [
        {
          axis:
            row.workflow_type === "SECONDARY_TRADE"
              ? "SECONDARY_TRADE"
              : String(row.workflow_type).startsWith("REDEMPTION")
                ? "REDEMPTION"
                : String(row.workflow_type).startsWith("PRIMARY_")
                  ? "PRIMARY_ISSUANCE"
                  : row.workflow_type === "COMPLAINT"
                    ? "COMPLAINT"
                    : row.workflow_type === "DIVIDEND"
                      ? "DIVIDEND"
                      : row.workflow_type === "VOTING"
                        ? "VOTING"
                        : row.workflow_type === "REGULATORY_REPORT"
                          ? "REGULATORY_REPORT"
                          : row.workflow_type === "CORPORATE_ACTION"
                            ? "CORPORATE_ACTION"
                            : row.workflow_type === "RECONCILIATION"
                              ? "RECONCILIATION"
                              : "WALLET_LINKAGE",
          code: row.status,
          labelKo: String(row.status),
        },
      ],
      projection: projection(now),
    })),
    projection: projection(now),
  };
}

export async function completeEligibilityChainSync(
  pool: Pool,
  input: { workflowId: string; outboxId: string; transactionHash: string; now: Date },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE customer_wallets
       SET status='LINKED', active=true, chain_sync_status='CONFIRMED', updated_at=$2
       WHERE workflow_id=$1 AND status='CHAIN_SYNC_PENDING'
       RETURNING wallet_id`,
      [input.workflowId, input.now],
    );
    if (updated.rowCount !== 1) throw new Error("체인 반영 대기 지갑을 찾을 수 없다.");
    await client.query(
      "UPDATE workflows SET status='COMPLETED', result_reference_id=NULL, updated_at=$2 WHERE workflow_id=$1",
      [input.workflowId, input.now],
    );
    await client.query(
      "UPDATE outbox_messages SET delivered_at=$2, last_error=NULL WHERE outbox_id=$1",
      [input.outboxId, input.now],
    );
    await client.query(
      `INSERT INTO audit_records
        (audit_id, workflow_id, actor_id, actor_role, action, evidence_hash, occurred_at)
       VALUES ($1,$2,'eligibility-chain-worker','PLATFORM_OPERATOR','ELIGIBILITY_CHAIN_SYNC_CONFIRMED',$3,$4)`,
      [randomUUID(), input.workflowId, input.transactionHash, input.now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordEligibilityChainSyncFailure(
  pool: Pool,
  input: { workflowId: string; outboxId: string; reason: string; now: Date },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE workflows SET status='QUARANTINED', updated_at=$2 WHERE workflow_id=$1",
      [input.workflowId, input.now],
    );
    await client.query(
      "UPDATE outbox_messages SET delivered_at=$2, last_error=$3 WHERE outbox_id=$1",
      [input.outboxId, input.now, input.reason],
    );
    await client.query(
      "UPDATE customer_wallets SET status='CHAIN_SYNC_FAILED', chain_sync_status='FAILED', updated_at=$2 WHERE workflow_id=$1",
      [input.workflowId, input.now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export { BROKER_INSTITUTION_ID, PLATFORM_INSTITUTION_ID };
