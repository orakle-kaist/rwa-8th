ALTER TABLE local_simulation_instruments
  ADD COLUMN IF NOT EXISTS secondary_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE customer_cash_accounts
  ADD COLUMN IF NOT EXISTS usdc_reserved_minor bigint NOT NULL DEFAULT 0;

ALTER TABLE customer_rights_positions
  ADD COLUMN IF NOT EXISTS secondary_reserved_quantity bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS secondary_market_state (
  security_id text PRIMARY KEY REFERENCES local_simulation_instruments(security_id),
  reference_usd_minor bigint NOT NULL,
  information_effective_at timestamptz NOT NULL,
  usdc_usd_ppm bigint NOT NULL,
  half_spread_bps integer NOT NULL,
  security_loss_bps integer NOT NULL DEFAULT 0,
  portfolio_loss_bps integer NOT NULL DEFAULT 0,
  secondary_paused boolean NOT NULL DEFAULT false,
  usdc_paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS market_maker_positions (
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  starting_settled_quantity bigint NOT NULL,
  pending_quantity bigint NOT NULL,
  net_position bigint NOT NULL DEFAULT 0,
  reserved_sell_quantity bigint NOT NULL DEFAULT 0,
  reserved_buy_usd_minor bigint NOT NULL DEFAULT 0,
  reserved_buy_usdc_minor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, security_id)
);

CREATE TABLE IF NOT EXISTS market_maker_quotes (
  quote_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  wallet_address text NOT NULL,
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  market_maker_side text NOT NULL CHECK (market_maker_side IN ('BUY','SELL')),
  funding_mode text NOT NULL CHECK (funding_mode IN ('USD_LEDGER','USDC_ONCHAIN')),
  payment_asset_id text NOT NULL,
  share_quantity bigint NOT NULL CHECK (share_quantity > 0),
  remaining_quantity bigint NOT NULL CHECK (remaining_quantity >= 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  half_spread_bps integer NOT NULL,
  status text NOT NULL,
  policy_version text NOT NULL,
  nonce bigint NOT NULL,
  signed_quote jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (wallet_address, nonce)
);

CREATE TABLE IF NOT EXISTS secondary_orders (
  order_id uuid PRIMARY KEY REFERENCES workflows(workflow_id),
  principal_id text NOT NULL REFERENCES synthetic_customer_profiles(principal_id),
  investor_wallet text NOT NULL,
  quote_id uuid NOT NULL REFERENCES market_maker_quotes(quote_id),
  security_id text NOT NULL REFERENCES local_simulation_instruments(security_id),
  investor_side text NOT NULL CHECK (investor_side IN ('BUY','SELL')),
  funding_mode text NOT NULL CHECK (funding_mode IN ('USD_LEDGER','USDC_ONCHAIN')),
  payment_asset_id text NOT NULL,
  requested_quantity bigint NOT NULL CHECK (requested_quantity > 0),
  fill_quantity bigint NOT NULL CHECK (fill_quantity > 0),
  cancelled_quantity bigint NOT NULL CHECK (cancelled_quantity >= 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  payment_amount_minor bigint NOT NULL CHECK (payment_amount_minor > 0),
  rights_reserved_quantity bigint NOT NULL DEFAULT 0,
  rights_reservation_released_quantity bigint NOT NULL DEFAULT 0,
  funds_reserved_minor bigint NOT NULL DEFAULT 0,
  funds_reservation_released_minor bigint NOT NULL DEFAULT 0,
  rights_finalized boolean NOT NULL DEFAULT false,
  funds_finalized boolean NOT NULL DEFAULT false,
  chain_finalized boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  signed_intent jsonb NOT NULL,
  signed_broker_approval jsonb,
  chain_transaction_hash text,
  quarantine_reason text,
  aggregate_version integer NOT NULL DEFAULT 1,
  accepted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE secondary_orders
  ADD COLUMN IF NOT EXISTS rights_reservation_released_quantity bigint NOT NULL DEFAULT 0;
ALTER TABLE secondary_orders
  ADD COLUMN IF NOT EXISTS funds_reservation_released_minor bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS secondary_state_history (
  history_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES secondary_orders(order_id),
  previous_state text,
  new_state text NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  evidence_hash text,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS secondary_settlement_attempts (
  attempt_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES secondary_orders(order_id),
  attempt_number integer NOT NULL,
  stage text NOT NULL,
  outcome text NOT NULL,
  chain_transaction_hash text,
  error_code text,
  evidence_hash text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (order_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS active_quote_idx
  ON market_maker_quotes (security_id, market_maker_side, funding_mode, expires_at)
  WHERE status IN ('ACTIVE','PARTIALLY_CONSUMED');
CREATE INDEX IF NOT EXISTS secondary_order_owner_idx
  ON secondary_orders (principal_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS secondary_order_status_idx
  ON secondary_orders (status, accepted_at);
CREATE UNIQUE INDEX IF NOT EXISTS secondary_order_wallet_nonce_idx
  ON secondary_orders (investor_wallet, ((signed_intent->'message'->>'nonce')::bigint));
