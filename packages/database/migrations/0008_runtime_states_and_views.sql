CREATE TABLE IF NOT EXISTS workflow_state_axes (
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  state_axis text NOT NULL,
  state_code text NOT NULL,
  aggregate_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workflow_id, state_axis)
);

CREATE TABLE IF NOT EXISTS workflow_state_axis_history (
  history_id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(workflow_id),
  state_axis text NOT NULL,
  previous_state text,
  new_state text NOT NULL,
  aggregate_version integer NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  evidence_hash text,
  reason text,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS workflow_state_axis_history_lookup_idx
  ON workflow_state_axis_history (workflow_id, occurred_at, history_id);
