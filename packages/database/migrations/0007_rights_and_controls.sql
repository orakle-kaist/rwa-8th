ALTER TABLE customer_rights_positions
  ADD COLUMN IF NOT EXISTS administrative_frozen_quantity bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS dividend_events (
  event_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  record_date date NOT NULL,
  ex_date date NOT NULL,
  gross_per_share_usd_minor bigint NOT NULL CHECK (gross_per_share_usd_minor > 0),
  domestic_total_usd_minor bigint NOT NULL DEFAULT 0 CHECK (domestic_total_usd_minor >= 0),
  status text NOT NULL,
  source_evidence_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS dividend_payments (
  payment_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES dividend_events(event_id),
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  eligible_quantity bigint NOT NULL CHECK (eligible_quantity >= 0),
  gross_usd_minor bigint NOT NULL CHECK (gross_usd_minor >= 0),
  tax_usd_minor bigint NOT NULL DEFAULT 0 CHECK (tax_usd_minor >= 0),
  fee_usd_minor bigint NOT NULL DEFAULT 0 CHECK (fee_usd_minor >= 0),
  net_usd_minor bigint NOT NULL CHECK (net_usd_minor >= 0),
  status text NOT NULL,
  usd_paid_at timestamptz,
  payment_evidence_hash text,
  quote_id uuid UNIQUE,
  quote_expires_at timestamptz,
  conversion_status text,
  usd_reserved_minor bigint NOT NULL DEFAULT 0,
  usdc_paid_minor bigint NOT NULL DEFAULT 0,
  conversion_evidence_hash text,
  updated_at timestamptz NOT NULL,
  UNIQUE (event_id, principal_id)
);

CREATE TABLE IF NOT EXISTS voting_meetings (
  meeting_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  record_date date NOT NULL,
  instruction_deadline timestamptz NOT NULL,
  status text NOT NULL,
  source_evidence_hash text NOT NULL,
  aggregate_result jsonb,
  standing_proxy_result_evidence_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS voting_agendas (
  agenda_id uuid PRIMARY KEY,
  meeting_id uuid NOT NULL REFERENCES voting_meetings(meeting_id),
  title_ko text NOT NULL
);

CREATE TABLE IF NOT EXISTS voting_snapshots (
  meeting_id uuid NOT NULL REFERENCES voting_meetings(meeting_id),
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  eligible_quantity bigint NOT NULL CHECK (eligible_quantity >= 0),
  PRIMARY KEY (meeting_id, principal_id)
);

CREATE TABLE IF NOT EXISTS voting_instructions (
  instruction_id uuid PRIMARY KEY,
  meeting_id uuid NOT NULL REFERENCES voting_meetings(meeting_id),
  agenda_id uuid NOT NULL REFERENCES voting_agendas(agenda_id),
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  instruction text NOT NULL CHECK (instruction IN ('FOR','AGAINST','ABSTAIN')),
  corrects_instruction_id uuid REFERENCES voting_instructions(instruction_id),
  active boolean NOT NULL DEFAULT true,
  submitted_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS voting_instruction_active_idx
  ON voting_instructions(meeting_id,agenda_id,principal_id) WHERE active;

CREATE TABLE IF NOT EXISTS regulatory_reports (
  report_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  reporting_month text NOT NULL UNIQUE,
  period_closed_at timestamptz NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL,
  record_count integer NOT NULL,
  snapshot_evidence_hash text,
  submission_evidence_hash text,
  receipt_reference text,
  retention_until date NOT NULL,
  corrects_report_id uuid REFERENCES regulatory_reports(report_id),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_recoveries (
  workflow_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  old_wallet text NOT NULL,
  new_wallet text NOT NULL,
  rights_approved boolean NOT NULL DEFAULT false,
  compliance_approved boolean NOT NULL DEFAULT false,
  chain_executed boolean NOT NULL DEFAULT false,
  rights_ledger_updated boolean NOT NULL DEFAULT false,
  reconciled boolean NOT NULL DEFAULT false,
  transaction_hash text,
  status text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS corporate_actions (
  action_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  action_type text NOT NULL,
  numerator bigint NOT NULL CHECK (numerator > 0),
  denominator bigint NOT NULL CHECK (denominator > 0),
  expected_supply bigint NOT NULL CHECK (expected_supply > 0),
  rights_approved boolean NOT NULL DEFAULT false,
  audit_approved boolean NOT NULL DEFAULT false,
  domestic_applied boolean NOT NULL DEFAULT false,
  token_applied boolean NOT NULL DEFAULT false,
  reconciled boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  source_evidence_hash text NOT NULL,
  transaction_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  reconciliation_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  security_id text,
  scope text NOT NULL,
  as_of timestamptz NOT NULL,
  status text NOT NULL,
  rights_total bigint NOT NULL DEFAULT 0,
  token_supply bigint NOT NULL DEFAULT 0,
  burn_pending bigint NOT NULL DEFAULT 0,
  domestic_settled bigint NOT NULL DEFAULT 0,
  settled_rights bigint NOT NULL DEFAULT 0,
  mismatch_reason text,
  evidence_hash text,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS operational_holds (
  hold_id uuid PRIMARY KEY,
  source_workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  security_id text,
  scope text NOT NULL,
  reason_code text NOT NULL,
  status text NOT NULL,
  correction_evidence_hash text,
  full_reconciliation_id uuid REFERENCES reconciliation_runs(reconciliation_id),
  independent_approval boolean NOT NULL DEFAULT false,
  release_scheduled_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rights_state_history (
  history_id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  previous_state text,
  new_state text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  evidence_hash text,
  corrects_history_id uuid REFERENCES rights_state_history(history_id),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rights_work_queue_idx ON workflows(workflow_type,status,created_at);
CREATE INDEX IF NOT EXISTS operational_holds_active_idx ON operational_holds(status,security_id);
