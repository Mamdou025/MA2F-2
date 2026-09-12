-- Migration candidates only; no application access or Odoo writes enabled.
-- Execute within the import transaction.
CREATE SCHEMA IF NOT EXISTS ma2f_next;
REVOKE ALL ON SCHEMA ma2f_next FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ma2f_next.clients (
 snapshot_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
 id text NOT NULL, name text NOT NULL, customer_type text NOT NULL,
 zone text NOT NULL, phone text NOT NULL, price numeric NOT NULL CHECK(price>=0),
 source_path text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(snapshot_sha256,id)
);
CREATE TABLE IF NOT EXISTS ma2f_next.orders (
 snapshot_sha256 text NOT NULL REFERENCES ma2f_migration.source_runs(archive_sha256),
 id text NOT NULL, number text NOT NULL, order_date date NOT NULL,
 customer_id text, source_customer_id text, customer_link_state text NOT NULL,
 customer_name text NOT NULL, phone text NOT NULL, zone text NOT NULL,
 packs numeric NOT NULL CHECK(packs>0 AND packs=trunc(packs)),
 status text NOT NULL CHECK(status IN ('en_attente','assignee','en_livraison','livree','annulee')),
 source_path text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(snapshot_sha256,id),
 FOREIGN KEY(snapshot_sha256,customer_id) REFERENCES ma2f_next.clients(snapshot_sha256,id),
 CHECK(customer_link_state IN ('resolved','missing','unlinked')),
 CHECK((customer_link_state='resolved')=(customer_id IS NOT NULL)),
 CHECK(customer_id IS NULL OR customer_id=source_customer_id)
);
CREATE TABLE IF NOT EXISTS ma2f_next.customer_order_reviews (
 snapshot_sha256 text PRIMARY KEY REFERENCES ma2f_migration.source_runs(archive_sha256),
 review jsonb NOT NULL, summary jsonb NOT NULL,
 activation_allowed boolean NOT NULL DEFAULT false CHECK(activation_allowed=false)
);
REVOKE ALL ON ALL TABLES IN SCHEMA ma2f_next FROM PUBLIC;
