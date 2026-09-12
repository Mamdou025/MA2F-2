-- Separate operational projection. The immutable ma2f_source archive is never mutated.
CREATE TABLE app_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
  source_read_time timestamptz NOT NULL,
  state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
  provenance jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE state_changes (
  request_id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  fingerprint text NOT NULL,
  revision bigint NOT NULL UNIQUE,
  changes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Runtime grants must be provisioned explicitly; no DDL during request handling.
