import type { Pool } from "pg";

import {
  LOCAL_PRIMARY_DEPLOYMENT_KEY,
  LOCAL_PRIMARY_LIMIT_KRW,
  LOCAL_PRIMARY_NAME,
  LOCAL_PRIMARY_SECURITY_ID,
  LOCAL_PRIMARY_SYMBOL,
  T2_RISK_LIMIT_SHARES,
} from "@rwa/domain";

const investorA = "00000000-0000-4000-8000-000000000001";
const investorB = "00000000-0000-4000-8000-000000000002";
const primaryDemoProfiles = [
  [
    investorA,
    "0x5c4c1f8b0d64104c09829957fa47d68570729c71",
    "00000000-0000-4000-8000-000000000501",
    "00000000-0000-4000-8000-000000000511",
  ],
  [
    investorB,
    "0xa98b91226575d5037e865d679b750353d2d40305",
    "00000000-0000-4000-8000-000000000502",
    "00000000-0000-4000-8000-000000000512",
  ],
] as const;

export async function seedPrimaryData(pool: Pool, now = new Date("2026-08-31T12:00:00Z")) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO local_simulation_instruments
        (security_id, display_name, token_symbol, synthetic_deployment_key, reference_security_id,
         reference_limit_krw, primary_enabled)
       VALUES ($1,$2,$3,$4,'005930',$5,true)
       ON CONFLICT (security_id) DO UPDATE SET
         display_name=EXCLUDED.display_name,
         token_symbol=EXCLUDED.token_symbol,
         synthetic_deployment_key=EXCLUDED.synthetic_deployment_key,
         reference_limit_krw=EXCLUDED.reference_limit_krw`,
      [
        LOCAL_PRIMARY_SECURITY_ID,
        LOCAL_PRIMARY_NAME,
        LOCAL_PRIMARY_SYMBOL,
        LOCAL_PRIMARY_DEPLOYMENT_KEY,
        LOCAL_PRIMARY_LIMIT_KRW.toString(),
      ],
    );
    for (const [principalId, usd, usdc] of [
      [investorA, "200000", "0"],
      // 두 독립 시나리오를 연속 시연해도 24시간 주문 최대금액을 사전 확인할 수 있는 합성 잔액이다.
      [investorB, "0", "20000000000"],
    ]) {
      await client.query(
        `INSERT INTO customer_cash_accounts
          (principal_id, usd_available_minor, usdc_available_minor, updated_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (principal_id) DO NOTHING`,
        [principalId, usd, usdc, now],
      );
    }
    const disclosure = await client.query<{
      disclosure_id: string;
      version: string;
      valid_until: Date;
    }>("SELECT disclosure_id,version,valid_until FROM disclosures WHERE version='SIM-RISK-2'");
    if (!disclosure.rows[0]) throw new Error("1차 시연용 위험공시가 없다.");
    for (const [principalId, wallet, consentWorkflowId, walletId] of primaryDemoProfiles) {
      await client.query(
        `INSERT INTO workflows (workflow_id,workflow_type,status,principal_id,correlation_id,request_payload,created_at,updated_at)
         VALUES ($1,'DISCLOSURE_CONSENT','COMPLETED',$2,$3,'{}'::jsonb,$4,$4)
         ON CONFLICT (workflow_id) DO NOTHING`,
        [consentWorkflowId, principalId, consentWorkflowId, now],
      );
      await client.query(
        `INSERT INTO disclosure_consents (principal_id,disclosure_id,version,consented_at,valid_until,workflow_id)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (principal_id,disclosure_id) DO NOTHING`,
        [
          principalId,
          disclosure.rows[0].disclosure_id,
          disclosure.rows[0].version,
          now,
          disclosure.rows[0].valid_until,
          consentWorkflowId,
        ],
      );
      await client.query(
        `INSERT INTO customer_wallets (wallet_id,principal_id,wallet_address,status,active,chain_sync_status,created_at,updated_at)
         SELECT $1,$2,$3,'LINKED',true,'CONFIRMED',$4,$4
         WHERE NOT EXISTS (SELECT 1 FROM customer_wallets WHERE principal_id=$2 AND active)
         ON CONFLICT (wallet_address) DO NOTHING`,
        [walletId, principalId, wallet, now],
      );
    }
    await client.query(
      `INSERT INTO t2_risk_limits (security_id, limit_quantity, used_quantity, updated_at)
       VALUES ($1,$2,0,$3)
       ON CONFLICT (security_id) DO UPDATE SET limit_quantity=EXCLUDED.limit_quantity`,
      [LOCAL_PRIMARY_SECURITY_ID, T2_RISK_LIMIT_SHARES.toString(), now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
