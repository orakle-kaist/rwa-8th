CREATE TABLE IF NOT EXISTS chain_execution_steps (
  execution_id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  stage text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','SUBMITTED','CONFIRMED','FAILED','UNCERTAIN')),
  contract_address text NOT NULL,
  function_name text NOT NULL,
  transaction_hash text,
  transaction_nonce bigint,
  receipt jsonb,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL,
  UNIQUE (workflow_id, stage)
);

CREATE INDEX IF NOT EXISTS chain_execution_retry_idx
  ON chain_execution_steps (status, updated_at)
  WHERE status IN ('PENDING','FAILED','UNCERTAIN');

CREATE TABLE IF NOT EXISTS local_chain_deployments (
  chain_id integer PRIMARY KEY,
  manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL,
  deployed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL
);
