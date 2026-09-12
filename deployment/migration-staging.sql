-- Private source preservation only. These are not the operational MA2F/Odoo tables.
BEGIN;
CREATE SCHEMA IF NOT EXISTS ma2f_migration;
REVOKE ALL ON SCHEMA ma2f_migration FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ma2f_migration.source_runs (
  archive_sha256 text PRIMARY KEY CHECK (archive_sha256 ~ '^[a-f0-9]{64}$'),
  project text NOT NULL CHECK (project = 'ma2f-aquasachet'),
  read_time timestamptz NOT NULL,
  expected_documents integer NOT NULL CHECK (expected_documents >= 0),
  manifest jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('importing', 'verified')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ma2f_migration.source_documents (
  archive_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
  document_path text NOT NULL,
  collection_id text NOT NULL,
  source_document jsonb NOT NULL CHECK (jsonb_typeof(source_document) = 'object'),
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (archive_sha256, document_path),
  CHECK (document_path LIKE 'projects/ma2f-aquasachet/databases/(default)/documents/%')
);
REVOKE ALL ON ALL TABLES IN SCHEMA ma2f_migration FROM PUBLIC;
COMMIT;
