import type { Pool } from "pg";

export async function registerMockInstitutionKey(
  pool: Pool,
  input: { sourceInstitutionId: string; keyId: string; publicKeyPem: string; now: Date },
) {
  if (!input.publicKeyPem.includes("BEGIN PUBLIC KEY")) throw new Error("Ed25519 공개키 PEM이 필요하다.");
  await pool.query(
    `INSERT INTO mock_institution_keys(source_institution_id,key_id,public_key_pem,registered_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (source_institution_id,key_id) DO UPDATE SET
       public_key_pem=EXCLUDED.public_key_pem,registered_at=EXCLUDED.registered_at,revoked_at=NULL`,
    [input.sourceInstitutionId, input.keyId, input.publicKeyPem, input.now],
  );
}

export async function getMockInstitutionKey(pool: Pool, sourceInstitutionId: string, keyId: string) {
  const result = await pool.query<{ public_key_pem: string }>(
    `SELECT public_key_pem FROM mock_institution_keys
     WHERE source_institution_id=$1 AND key_id=$2 AND revoked_at IS NULL`,
    [sourceInstitutionId, keyId],
  );
  return result.rows[0]?.public_key_pem;
}
