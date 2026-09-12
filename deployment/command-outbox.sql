-- Provision explicitly; never execute schema changes during request handling.
-- No runtime permissions are granted by this template.
CREATE TABLE command_outbox (
  request_id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('order','production','receipt','delivery','transfer','return')),
  payload jsonb NOT NULL,
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','completed','needs_review')),
  outcome_unknown boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state='leased') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (state<>'completed' OR result IS NOT NULL)
);
CREATE INDEX command_outbox_pending ON command_outbox(available_at,created_at) WHERE state IN ('queued','leased');
