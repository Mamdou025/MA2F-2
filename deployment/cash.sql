-- Inactive migration candidates; no operational accounting entries.
CREATE TABLE IF NOT EXISTS ma2f_next.cash_events (
 snapshot_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
 kind text NOT NULL CHECK(kind IN ('depenses','apports','versements')),
 id text NOT NULL, event_date date NOT NULL, amount numeric NOT NULL CHECK(amount>=0),
 direction smallint NOT NULL, mode text, payload jsonb NOT NULL,
 PRIMARY KEY(snapshot_sha256,kind,id),
 CHECK((kind='apports' AND direction=1) OR (kind IN ('depenses','versements') AND direction=-1))
);
CREATE TABLE IF NOT EXISTS ma2f_next.cash_reviews (
 snapshot_sha256 text PRIMARY KEY REFERENCES ma2f_migration.source_runs(archive_sha256),
 report jsonb NOT NULL, activation_allowed boolean NOT NULL DEFAULT false CHECK(activation_allowed=false)
);
REVOKE ALL ON ma2f_next.cash_events,ma2f_next.cash_reviews FROM PUBLIC;
