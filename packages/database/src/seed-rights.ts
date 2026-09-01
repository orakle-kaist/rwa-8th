import { createHash } from "node:crypto";

import {
  LOCAL_CORPORATE_ACTION_DEPLOYMENT_KEY,
  LOCAL_CORPORATE_ACTION_NAME,
  LOCAL_CORPORATE_ACTION_SECURITY_ID,
  LOCAL_CORPORATE_ACTION_SYMBOL,
  LOCAL_RIGHTS_SECURITY_ID,
  SYNTHETIC_DIVIDEND_PER_SHARE_USD_MINOR,
} from "@rwa/domain";
import type { Pool } from "pg";

export const DIVIDEND_EVENT_ID = "00000000-0000-4000-8000-000000000701";
export const VOTING_MEETING_ID = "00000000-0000-4000-8000-000000000730";
export const VOTING_AGENDA_ID = "00000000-0000-4000-8000-000000000731";
export const REGULATORY_REPORT_ID = "00000000-0000-4000-8000-000000000740";
export const CORPORATE_ACTION_ID = "00000000-0000-4000-8000-000000000750";
const investorA = "00000000-0000-4000-8000-000000000001";
const systemActor = "00000000-0000-4000-8000-000000000101";

function evidence(value: string) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

export async function seedRightsData(pool: Pool, now = new Date("2026-09-01T00:00:00Z")) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO local_simulation_instruments
        (security_id,display_name,token_symbol,synthetic_deployment_key,reference_security_id,
         reference_limit_krw,primary_enabled,secondary_enabled,redemption_enabled)
       VALUES ($1,$2,$3,$4,'006800',36150,false,false,false)
       ON CONFLICT (security_id) DO UPDATE SET display_name=EXCLUDED.display_name,
         token_symbol=EXCLUDED.token_symbol,synthetic_deployment_key=EXCLUDED.synthetic_deployment_key`,
      [
        LOCAL_CORPORATE_ACTION_SECURITY_ID,
        LOCAL_CORPORATE_ACTION_NAME,
        LOCAL_CORPORATE_ACTION_SYMBOL,
        LOCAL_CORPORATE_ACTION_DEPLOYMENT_KEY,
      ],
    );
    await client.query(
      `INSERT INTO customer_rights_positions
        (principal_id,security_id,pending_quantity,settled_quantity,redemption_locked_quantity,
         burn_pending_quantity,administrative_frozen_quantity,updated_at)
       VALUES ($1,$2,2,7,2,1,1,$3)
       ON CONFLICT (principal_id,security_id) DO NOTHING`,
      [investorA, LOCAL_CORPORATE_ACTION_SECURITY_ID, now],
    );
    await client.query(
      `INSERT INTO instrument_control_totals
        (security_id,domestic_settled_quantity,token_total_supply,updated_at)
       VALUES ($1,7,10,$2) ON CONFLICT (security_id) DO NOTHING`,
      [LOCAL_CORPORATE_ACTION_SECURITY_ID, now],
    );

    for (const [workflowId, workflowType, status] of [
      [DIVIDEND_EVENT_ID, "DIVIDEND", "DIVIDEND_SNAPSHOT_REVIEW"],
      [VOTING_MEETING_ID, "VOTING", "VOTE_INSTRUCTION_COLLECTION"],
      [REGULATORY_REPORT_ID, "REGULATORY_REPORT", "REPORT_GENERATED"],
      [CORPORATE_ACTION_ID, "CORPORATE_ACTION", "CORPORATE_ACTION_PLAN_REVIEW"],
    ]) {
      await client.query(
        `INSERT INTO workflows
          (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$1,'{}'::jsonb,$5,$5) ON CONFLICT (workflow_id) DO NOTHING`,
        [workflowId, workflowType, status, systemActor, now],
      );
    }

    await client.query(
      `INSERT INTO dividend_events
        (event_id,security_id,record_date,ex_date,gross_per_share_usd_minor,domestic_total_usd_minor,
         status,source_evidence_hash,created_at,updated_at)
       VALUES ($1,$2,'2026-08-31','2026-08-28',$3,0,'DIVIDEND_SNAPSHOT_REVIEW',$4,$5,$5)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        DIVIDEND_EVENT_ID,
        LOCAL_RIGHTS_SECURITY_ID,
        SYNTHETIC_DIVIDEND_PER_SHARE_USD_MINOR.toString(),
        evidence("synthetic-dividend-event"),
        now,
      ],
    );
    await client.query(
      `INSERT INTO voting_meetings
        (meeting_id,security_id,record_date,instruction_deadline,status,source_evidence_hash,created_at,updated_at)
       VALUES ($1,$2,'2026-08-31','2026-09-05T06:00:00Z','VOTE_INSTRUCTION_COLLECTION',$3,$4,$4)
       ON CONFLICT (meeting_id) DO NOTHING`,
      [VOTING_MEETING_ID, LOCAL_RIGHTS_SECURITY_ID, evidence("synthetic-voting-meeting"), now],
    );
    await client.query(
      `INSERT INTO voting_agendas (agenda_id,meeting_id,title_ko)
       VALUES ($1,$2,'합성 제1호 의안: 이사 선임') ON CONFLICT (agenda_id) DO NOTHING`,
      [VOTING_AGENDA_ID, VOTING_MEETING_ID],
    );
    await client.query(
      `INSERT INTO regulatory_reports
        (report_id,reporting_month,period_closed_at,due_date,status,record_count,snapshot_evidence_hash,
         retention_until,updated_at)
       VALUES ($1,'2026-08','2026-08-31T15:00:00Z','2026-09-10','REPORT_GENERATED',0,$2,
         '2036-08-31',$3) ON CONFLICT (report_id) DO NOTHING`,
      [REGULATORY_REPORT_ID, evidence("synthetic-month-end-snapshot"), now],
    );
    await client.query(
      `INSERT INTO corporate_actions
        (action_id,security_id,action_type,numerator,denominator,expected_supply,status,
         source_evidence_hash,created_at,updated_at)
       VALUES ($1,$2,'STOCK_SPLIT',2,1,19,'CORPORATE_ACTION_PLAN_REVIEW',$3,$4,$4)
       ON CONFLICT (action_id) DO NOTHING`,
      [
        CORPORATE_ACTION_ID,
        LOCAL_CORPORATE_ACTION_SECURITY_ID,
        evidence("synthetic-split-2-for-1"),
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
