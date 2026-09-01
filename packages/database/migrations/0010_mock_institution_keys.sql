CREATE TABLE IF NOT EXISTS mock_institution_keys (
  source_institution_id uuid NOT NULL,
  key_id text NOT NULL,
  public_key_pem text NOT NULL,
  registered_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (source_institution_id, key_id)
);
