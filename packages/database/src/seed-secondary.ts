import type { Pool } from "pg";

import {
  LOCAL_SECONDARY_DEPLOYMENT_KEY,
  LOCAL_SECONDARY_NAME,
  LOCAL_SECONDARY_NORMAL_ASK_USD_MINOR,
  LOCAL_SECONDARY_POLICY,
  LOCAL_SECONDARY_REFERENCE_KRW,
  LOCAL_SECONDARY_REFERENCE_SECURITY_ID,
  LOCAL_SECONDARY_REFERENCE_USD_MINOR,
  LOCAL_SECONDARY_SECURITY_ID,
  LOCAL_SECONDARY_SYMBOL,
  MARKET_MAKER_START_PENDING,
  MARKET_MAKER_START_SETTLED,
} from "@rwa/domain";

export const MARKET_MAKER_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000103";
export const MARKET_MAKER_WALLET = "0x78D4042237C9b22Bc1830524fd74960e549b5dE8";

export async function seedSecondaryData(pool: Pool, now = new Date("2026-08-31T12:00:00Z")) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO synthetic_customer_profiles
        (principal_id,display_name,eligibility_status,protection_status,valid_until,policy_version,
         rights_account_reference,responsible_institution_id)
       VALUES ($1,'지정 시장조성자','ELIGIBLE','PASSED','2027-08-31T00:00:00Z',$2,
               'RIGHTS-MM-103','00000000-0000-4000-8000-000000000202')
       ON CONFLICT (principal_id) DO UPDATE SET eligibility_status='ELIGIBLE',valid_until=EXCLUDED.valid_until`,
      [MARKET_MAKER_PRINCIPAL_ID, LOCAL_SECONDARY_POLICY],
    );
    await client.query(
      `INSERT INTO customer_wallets
        (wallet_id,principal_id,wallet_address,status,active,chain_sync_status,created_at,updated_at)
       VALUES ('00000000-0000-4000-8000-000000000513',$1,$2,'LINKED',true,'CONFIRMED',$3,$3)
       ON CONFLICT (wallet_address) DO NOTHING`,
      [MARKET_MAKER_PRINCIPAL_ID, MARKET_MAKER_WALLET, now],
    );
    await client.query(
      `INSERT INTO local_simulation_instruments
        (security_id,display_name,token_symbol,synthetic_deployment_key,reference_security_id,
         reference_limit_krw,primary_enabled,secondary_enabled,hedge_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,false,true,true)
       ON CONFLICT (security_id) DO UPDATE SET display_name=EXCLUDED.display_name,
         token_symbol=EXCLUDED.token_symbol,synthetic_deployment_key=EXCLUDED.synthetic_deployment_key,
         reference_limit_krw=EXCLUDED.reference_limit_krw,secondary_enabled=true,hedge_enabled=true`,
      [
        LOCAL_SECONDARY_SECURITY_ID,
        LOCAL_SECONDARY_NAME,
        LOCAL_SECONDARY_SYMBOL,
        LOCAL_SECONDARY_DEPLOYMENT_KEY,
        LOCAL_SECONDARY_REFERENCE_SECURITY_ID,
        LOCAL_SECONDARY_REFERENCE_KRW.toString(),
      ],
    );
    await client.query(
      `INSERT INTO customer_cash_accounts
        (principal_id,usd_available_minor,usdc_available_minor,updated_at)
       VALUES ($1,25000000,250000000000,$2)
       ON CONFLICT (principal_id) DO UPDATE SET usd_available_minor=EXCLUDED.usd_available_minor,
         usdc_available_minor=EXCLUDED.usdc_available_minor,updated_at=EXCLUDED.updated_at`,
      [MARKET_MAKER_PRINCIPAL_ID, now],
    );
    await client.query(
      `INSERT INTO customer_rights_positions
        (principal_id,security_id,pending_quantity,settled_quantity,updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (principal_id,security_id) DO UPDATE SET pending_quantity=EXCLUDED.pending_quantity,
         settled_quantity=EXCLUDED.settled_quantity,updated_at=EXCLUDED.updated_at`,
      [
        MARKET_MAKER_PRINCIPAL_ID,
        LOCAL_SECONDARY_SECURITY_ID,
        MARKET_MAKER_START_PENDING.toString(),
        MARKET_MAKER_START_SETTLED.toString(),
        now,
      ],
    );
    await client.query(
      `INSERT INTO market_maker_positions
        (principal_id,security_id,starting_settled_quantity,pending_quantity,net_position,
         next_session_starting_quantity,updated_at)
       VALUES ($1,$2,$3,$4,0,$3,$5)
       ON CONFLICT (principal_id,security_id) DO UPDATE SET
         starting_settled_quantity=EXCLUDED.starting_settled_quantity,
         pending_quantity=EXCLUDED.pending_quantity,updated_at=EXCLUDED.updated_at`,
      [
        MARKET_MAKER_PRINCIPAL_ID,
        LOCAL_SECONDARY_SECURITY_ID,
        MARKET_MAKER_START_SETTLED.toString(),
        MARKET_MAKER_START_PENDING.toString(),
        now,
      ],
    );
    await client.query(
      `INSERT INTO secondary_market_state
        (security_id,reference_usd_minor,information_effective_at,usdc_usd_ppm,half_spread_bps,
         security_loss_bps,portfolio_loss_bps,domestic_total_quantity,token_total_supply,
         foreign_limit_status,krx_status,updated_at)
       VALUES ($1,$2,$3,1000000,50,0,0,$4,$4,'ALLOWED','OPEN',$3)
       ON CONFLICT (security_id) DO UPDATE SET reference_usd_minor=EXCLUDED.reference_usd_minor,
         information_effective_at=EXCLUDED.information_effective_at,updated_at=EXCLUDED.updated_at`,
      [
        LOCAL_SECONDARY_SECURITY_ID,
        LOCAL_SECONDARY_REFERENCE_USD_MINOR.toString(),
        now,
        (MARKET_MAKER_START_SETTLED + MARKET_MAKER_START_PENDING).toString(),
      ],
    );
    // Ensure the displayed deterministic normal ask remains tied to the approved fixture.
    if (LOCAL_SECONDARY_NORMAL_ASK_USD_MINOR !== 120_355n)
      throw new Error("승인된 합성 매도호가가 바뀌었다.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
