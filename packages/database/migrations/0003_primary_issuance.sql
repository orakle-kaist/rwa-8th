CREATE TABLE IF NOT EXISTS local_simulation_instruments (
  security_id text PRIMARY KEY,
  display_name text NOT NULL,
  token_symbol text NOT NULL,
  synthetic_deployment_key text NOT NULL,
  reference_security_id text NOT NULL,
  reference_limit_krw bigint NOT NULL,
  token_address text,
  primary_enabled boolean NOT NULL DEFAULT true,
  simulation boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS customer_cash_accounts (
  principal_id text PRIMARY KEY REFERENCES synthetic_customer_profiles(principal_id),
  usd_available_minor bigint NOT NULL DEFAULT 0,
  usd_reserved_minor bigint NOT NULL DEFAULT 0,
  usdc_available_minor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS primary_orders (
  order_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  acceptance_sequence bigserial UNIQUE NOT NULL,
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  wallet_address text NOT NULL,
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  share_quantity bigint NOT NULL CHECK (share_quantity > 0),
  krw_limit_price bigint NOT NULL CHECK (krw_limit_price > 0),
  requested_trading_date date NOT NULL,
  effective_trading_date date NOT NULL,
  funding_mode text NOT NULL,
  requested_usd_minor bigint NOT NULL,
  converted_usdc_minor bigint NOT NULL DEFAULT 0,
  reserved_usd_minor bigint NOT NULL DEFAULT 0,
  used_usd_minor bigint NOT NULL DEFAULT 0,
  released_usd_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  filled_quantity bigint NOT NULL DEFAULT 0,
  allocated_quantity bigint NOT NULL DEFAULT 0,
  cancelled_pending_quantity bigint NOT NULL DEFAULT 0,
  rights_status text NOT NULL DEFAULT 'EXECUTED_NOT_ISSUED',
  token_status text NOT NULL DEFAULT 'TOKEN_UNMINTED',
  settlement_status text NOT NULL DEFAULT 'SETTLEMENT_AND_CUSTODY_PENDING',
  batch_id uuid,
  token_transaction_hash text,
  release_transaction_hash text,
  quarantine_reason text,
  default_resolution text,
  cash_compensation_usd_minor bigint,
  default_resolution_evidence_hash text,
  aggregate_version integer NOT NULL DEFAULT 1,
  accepted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS primary_batches (
  batch_id uuid PRIMARY KEY,
  security_id text NOT NULL,
  krw_limit_price bigint NOT NULL,
  effective_trading_date date NOT NULL,
  requested_quantity bigint NOT NULL,
  filled_quantity bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  domestic_order_reference text,
  execution_evidence_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS primary_batch_orders (
  batch_id uuid NOT NULL REFERENCES primary_batches(batch_id),
  order_id uuid NOT NULL REFERENCES primary_orders(order_id),
  allocation_rank integer NOT NULL,
  PRIMARY KEY (batch_id, order_id)
);

CREATE TABLE IF NOT EXISTS primary_approval_facts (
  order_id uuid PRIMARY KEY REFERENCES primary_orders(order_id),
  execution_allocation_confirmed boolean NOT NULL DEFAULT false,
  risk_approved boolean NOT NULL DEFAULT false,
  rights_entry_approved boolean NOT NULL DEFAULT false,
  rights_recorded boolean NOT NULL DEFAULT false,
  domestic_settlement_confirmed boolean NOT NULL DEFAULT false,
  custody_quantity_confirmed boolean NOT NULL DEFAULT false,
  execution_evidence_hash text,
  allocation_evidence_hash text,
  risk_evidence_hash text,
  rights_approval_evidence_hash text,
  rights_recorded_evidence_hash text,
  settlement_evidence_hash text,
  custody_evidence_hash text,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_rights_positions (
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  security_id text NOT NULL,
  pending_quantity bigint NOT NULL DEFAULT 0,
  settled_quantity bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, security_id)
);

CREATE TABLE IF NOT EXISTS t2_risk_limits (
  security_id text PRIMARY KEY,
  limit_quantity bigint NOT NULL,
  used_quantity bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS primary_corrections (
  correction_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES primary_orders(order_id),
  quantity bigint NOT NULL,
  status text NOT NULL,
  approval_evidence_hash text,
  recorded_evidence_hash text,
  transaction_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS primary_default_resolutions (
  resolution_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES primary_orders(order_id),
  resolution_type text NOT NULL CHECK (resolution_type IN ('REPLACEMENT_SHARES', 'CASH_COMPENSATION')),
  cash_compensation_usd_minor bigint,
  institution_reason text NOT NULL,
  evidence_hash text NOT NULL,
  status text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS primary_state_history (
  history_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES primary_orders(order_id),
  state_axis text NOT NULL,
  previous_state text,
  new_state text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  evidence_hash text,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS primary_orders_owner_idx ON primary_orders(principal_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS primary_orders_batch_idx ON primary_orders(security_id, krw_limit_price, effective_trading_date, status);
