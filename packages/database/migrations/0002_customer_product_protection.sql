CREATE TABLE IF NOT EXISTS synthetic_customer_profiles (
  principal_id text PRIMARY KEY,
  display_name text NOT NULL,
  eligibility_status text NOT NULL,
  protection_status text NOT NULL,
  valid_until timestamptz,
  policy_version text NOT NULL,
  rights_account_reference text NOT NULL UNIQUE,
  responsible_institution_id uuid NOT NULL,
  simulation boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS customer_wallets (
  wallet_id uuid PRIMARY KEY,
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  wallet_address text NOT NULL,
  status text NOT NULL,
  workflow_id uuid REFERENCES workflows(workflow_id),
  active boolean NOT NULL DEFAULT false,
  chain_sync_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (wallet_address)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_one_active_wallet_idx
  ON customer_wallets (principal_id) WHERE active;

CREATE TABLE IF NOT EXISTS products (
  security_id text PRIMARY KEY,
  name_ko text NOT NULL,
  reference_version text NOT NULL,
  reference_date date NOT NULL,
  source_url text NOT NULL,
  source_checksum text NOT NULL,
  isin text,
  token_address text,
  candidate_status text NOT NULL,
  representative boolean NOT NULL DEFAULT false,
  primary_availability text NOT NULL,
  secondary_availability text NOT NULL,
  redemption_availability text NOT NULL,
  blocking_reasons jsonb NOT NULL,
  notices jsonb NOT NULL,
  simulation boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS disclosures (
  disclosure_id uuid PRIMARY KEY,
  version text NOT NULL UNIQUE,
  title_ko text NOT NULL,
  sections jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  responsible_institution_id uuid NOT NULL,
  content_evidence_id uuid NOT NULL,
  simulation boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS disclosure_consents (
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  disclosure_id uuid NOT NULL REFERENCES disclosures(disclosure_id),
  version text NOT NULL,
  consented_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  PRIMARY KEY (principal_id, disclosure_id)
);

CREATE TABLE IF NOT EXISTS complaints (
  complaint_id uuid PRIMARY KEY,
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  complaint_type text NOT NULL,
  title_ko text NOT NULL,
  description_ko text NOT NULL,
  status text NOT NULL,
  submitted_at timestamptz NOT NULL,
  responsible_institution_id uuid,
  related_workflow_id uuid,
  related_order_id uuid,
  disclosure_version text NOT NULL,
  response_reference_id uuid,
  correction_workflow_id uuid,
  closed_at timestamptz,
  aggregate_version integer NOT NULL DEFAULT 1,
  simulation boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS complaint_history (
  history_id uuid PRIMARY KEY,
  complaint_id uuid NOT NULL REFERENCES complaints(complaint_id),
  previous_status text,
  new_status text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  reason_ko text,
  evidence_reference_id uuid,
  occurred_at timestamptz NOT NULL,
  aggregate_version integer NOT NULL
);

CREATE INDEX IF NOT EXISTS complaint_owner_idx ON complaints (principal_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS complaint_status_idx ON complaints (status, submitted_at);

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS request_payload jsonb;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS result_reference_id uuid;
