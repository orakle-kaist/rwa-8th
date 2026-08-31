CREATE TABLE IF NOT EXISTS workflows (
  workflow_id uuid PRIMARY KEY,
  workflow_type text NOT NULL,
  status text NOT NULL,
  principal_id text NOT NULL,
  correlation_id uuid NOT NULL,
  simulation boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  principal_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS outbox_messages (
  outbox_id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  claimed_at timestamptz,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS outbox_ready_idx
  ON outbox_messages (available_at, occurred_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS inbox_messages (
  source_id text NOT NULL,
  event_id uuid NOT NULL,
  source_sequence bigint NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  PRIMARY KEY (source_id, event_id),
  UNIQUE (source_id, source_sequence)
);

CREATE TABLE IF NOT EXISTS evidence_records (
  evidence_id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  evidence_type text NOT NULL,
  source_organization text NOT NULL,
  source_record_id text NOT NULL,
  evidence_hash text NOT NULL,
  effective_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  simulation boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS audit_records (
  audit_id uuid PRIMARY KEY,
  workflow_id uuid,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  reason text,
  evidence_hash text,
  occurred_at timestamptz NOT NULL,
  simulation boolean NOT NULL DEFAULT true
);
