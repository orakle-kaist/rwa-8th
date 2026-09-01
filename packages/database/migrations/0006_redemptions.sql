ALTER TABLE local_simulation_instruments
  ADD COLUMN IF NOT EXISTS redemption_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE customer_rights_positions
  ADD COLUMN IF NOT EXISTS redemption_locked_quantity bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS instrument_control_totals (
  security_id text PRIMARY KEY REFERENCES local_simulation_instruments(security_id),
  domestic_settled_quantity bigint NOT NULL DEFAULT 0 CHECK (domestic_settled_quantity >= 0),
  token_total_supply bigint NOT NULL DEFAULT 0 CHECK (token_total_supply >= 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS redemption_orders (
  redemption_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  acceptance_sequence bigserial UNIQUE NOT NULL,
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  wallet_address text NOT NULL,
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  requested_quantity bigint NOT NULL CHECK (requested_quantity > 0),
  allocated_quantity bigint NOT NULL DEFAULT 0 CHECK (allocated_quantity >= 0),
  released_quantity bigint NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  krw_limit_price bigint NOT NULL CHECK (krw_limit_price > 0),
  requested_trading_date date NOT NULL,
  effective_trading_date date NOT NULL,
  batch_id uuid,
  status text NOT NULL,
  domestic_sale_submitted boolean NOT NULL DEFAULT false,
  domestic_execution_confirmed boolean NOT NULL DEFAULT false,
  sale_proceeds_settled boolean NOT NULL DEFAULT false,
  rights_terminated boolean NOT NULL DEFAULT false,
  token_burned boolean NOT NULL DEFAULT false,
  usd_paid boolean NOT NULL DEFAULT false,
  cash_claim_usd_minor bigint,
  payment_evidence_hash text,
  burn_evidence_hash text,
  quarantine_reason text,
  aggregate_version integer NOT NULL DEFAULT 1,
  accepted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS redemption_batches (
  batch_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  krw_limit_price bigint NOT NULL,
  effective_trading_date date NOT NULL,
  requested_quantity bigint NOT NULL,
  filled_quantity bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  domestic_order_reference text,
  execution_evidence_hash text,
  proceeds_evidence_hash text,
  total_net_usd_minor bigint,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS redemption_batch_orders (
  batch_id uuid NOT NULL REFERENCES redemption_batches(batch_id),
  redemption_id uuid NOT NULL REFERENCES redemption_orders(redemption_id),
  allocation_rank integer NOT NULL,
  PRIMARY KEY (batch_id, redemption_id)
);

CREATE TABLE IF NOT EXISTS redemption_cash_claims (
  claim_id uuid PRIMARY KEY,
  redemption_id uuid NOT NULL UNIQUE REFERENCES redemption_orders(redemption_id),
  share_quantity bigint NOT NULL CHECK (share_quantity > 0),
  gross_usd_minor bigint NOT NULL CHECK (gross_usd_minor >= 0),
  fee_usd_minor bigint NOT NULL DEFAULT 0 CHECK (fee_usd_minor >= 0),
  net_usd_minor bigint NOT NULL CHECK (net_usd_minor >= 0),
  status text NOT NULL,
  settlement_evidence_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS redemption_state_history (
  history_id uuid PRIMARY KEY,
  redemption_id uuid NOT NULL REFERENCES redemption_orders(redemption_id),
  previous_state text,
  new_state text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  evidence_hash text,
  reason text,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS redemption_orders_owner_idx
  ON redemption_orders(principal_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS redemption_orders_batch_idx
  ON redemption_orders(security_id, krw_limit_price, effective_trading_date, status);
CREATE INDEX IF NOT EXISTS redemption_batches_status_idx
  ON redemption_batches(status, effective_trading_date, created_at);
