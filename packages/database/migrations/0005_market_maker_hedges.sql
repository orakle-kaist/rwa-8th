ALTER TABLE local_simulation_instruments
  ADD COLUMN IF NOT EXISTS hedge_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE customer_rights_positions
  ADD COLUMN IF NOT EXISTS hedge_locked_quantity bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS burn_pending_quantity bigint NOT NULL DEFAULT 0;

ALTER TABLE market_maker_positions
  ADD COLUMN IF NOT EXISTS next_session_starting_quantity bigint,
  ADD COLUMN IF NOT EXISTS risk_reducing_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_direction_blocked text,
  ADD COLUMN IF NOT EXISTS hedge_hold_reason text;

UPDATE market_maker_positions
SET next_session_starting_quantity = starting_settled_quantity
WHERE next_session_starting_quantity IS NULL;

ALTER TABLE market_maker_positions
  ALTER COLUMN next_session_starting_quantity SET NOT NULL;

ALTER TABLE secondary_market_state
  ADD COLUMN IF NOT EXISTS domestic_total_quantity bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_total_supply bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS foreign_limit_status text NOT NULL DEFAULT 'ALLOWED',
  ADD COLUMN IF NOT EXISTS krx_status text NOT NULL DEFAULT 'OPEN';

CREATE TABLE IF NOT EXISTS market_maker_hedges (
  hedge_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  direction text NOT NULL CHECK (direction IN ('BUY','SELL')),
  requested_quantity bigint NOT NULL CHECK (requested_quantity >= 0),
  filled_quantity bigint NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  remaining_quantity bigint NOT NULL CHECK (remaining_quantity >= 0),
  net_position_snapshot bigint NOT NULL,
  krw_limit_price bigint NOT NULL CHECK (krw_limit_price > 0),
  target_trading_date date NOT NULL,
  status text NOT NULL,
  risk_violation_reducing boolean NOT NULL DEFAULT false,
  position_utilization_bps integer NOT NULL,
  foreign_limit_status text NOT NULL,
  krx_status text NOT NULL,
  market_maker_confirmed boolean NOT NULL DEFAULT false,
  broker_risk_approved boolean NOT NULL DEFAULT false,
  signed_intent jsonb,
  market_maker_evidence_hash text,
  risk_evidence_hash text,
  domestic_order_reference text,
  execution_evidence_hash text,
  domestic_settlement_confirmed boolean NOT NULL DEFAULT false,
  custody_quantity_confirmed boolean NOT NULL DEFAULT false,
  usd_payment_confirmed boolean NOT NULL DEFAULT false,
  rights_terminated boolean NOT NULL DEFAULT false,
  cash_claim_usd_minor bigint,
  token_transaction_hash text,
  hold_reason text,
  aggregate_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS market_maker_hedge_sources (
  hedge_id uuid NOT NULL REFERENCES market_maker_hedges(hedge_id),
  secondary_order_id uuid NOT NULL REFERENCES secondary_orders(order_id),
  signed_position_delta bigint NOT NULL,
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (hedge_id, secondary_order_id),
  UNIQUE (secondary_order_id)
);

CREATE TABLE IF NOT EXISTS market_maker_hedge_history (
  history_id uuid PRIMARY KEY,
  hedge_id uuid NOT NULL REFERENCES market_maker_hedges(hedge_id),
  previous_state text,
  new_state text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  evidence_hash text,
  reason text,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS market_maker_hedge_queue_idx
  ON market_maker_hedges
    (risk_violation_reducing DESC, position_utilization_bps DESC, created_at, security_id)
  WHERE status <> 'HEDGE_INVENTORY_ADJUSTED';

CREATE INDEX IF NOT EXISTS market_maker_hedge_status_idx
  ON market_maker_hedges (status, target_trading_date, created_at);
