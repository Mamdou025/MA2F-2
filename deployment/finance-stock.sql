-- Inactive migration candidates, not accounting entries or Odoo stock postings.
-- Execute within the import transaction, after migration-staging/customers-orders.
CREATE TABLE IF NOT EXISTS ma2f_next.sales (
 snapshot_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
 id text NOT NULL, number text, sale_date date NOT NULL, customer_name text NOT NULL,
 packs numeric NOT NULL, unit_price numeric NOT NULL, mode text NOT NULL,
 initial_cash_legacy numeric NOT NULL, linked_recoveries numeric NOT NULL, balance_legacy numeric NOT NULL,
 payload jsonb NOT NULL, PRIMARY KEY(snapshot_sha256,id)
);
CREATE TABLE IF NOT EXISTS ma2f_next.recoveries (
 snapshot_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
 id text NOT NULL, payment_date date NOT NULL, amount numeric NOT NULL,
 sale_id text, source_sale_id text, link_state text NOT NULL CHECK(link_state IN ('resolved','unresolved')),
 payload jsonb NOT NULL, PRIMARY KEY(snapshot_sha256,id),
 FOREIGN KEY(snapshot_sha256,sale_id) REFERENCES ma2f_next.sales(snapshot_sha256,id),
 CHECK((link_state='resolved')=(sale_id IS NOT NULL)), CHECK(sale_id IS NULL OR sale_id=source_sale_id)
);
CREATE TABLE IF NOT EXISTS ma2f_next.stock_movements (
 snapshot_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
 id text NOT NULL, movement_date date NOT NULL, movement_type text NOT NULL,
 product text, quantity numeric NOT NULL, unit text, source_place text, destination_place text,
 review_required boolean NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(snapshot_sha256,id)
);
CREATE TABLE IF NOT EXISTS ma2f_next.production_batches (
 snapshot_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
 id text NOT NULL, production_date date NOT NULL, packs numeric NOT NULL,
 payload jsonb NOT NULL, PRIMARY KEY(snapshot_sha256,id)
);
CREATE TABLE IF NOT EXISTS ma2f_next.finance_stock_reviews (
 snapshot_sha256 text PRIMARY KEY REFERENCES ma2f_migration.source_runs(archive_sha256),
 report jsonb NOT NULL, activation_allowed boolean NOT NULL DEFAULT false CHECK(activation_allowed=false)
);
REVOKE ALL ON ALL TABLES IN SCHEMA ma2f_next FROM PUBLIC;
