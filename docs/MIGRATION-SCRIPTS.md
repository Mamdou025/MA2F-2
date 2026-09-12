# Migration script checkpoint

The scripts are operational tools for the existing inactive migration candidates, not
application endpoints or authorization to activate the replacement system.

## Recovered source

On 2026-09-08, thirteen files were retrieved from the new Replit source directory
`/home/runner/workspace/ma2f-next`. The code-only compressed envelope SHA-256 was
`397ae6fe73e152671b192f33724332ccfcced306606bd75637cbc73f8fc1de5a`.
An exact original copy is retained privately under `pilot/.local/reconcile/`.

| Files | Purpose and limits |
| --- | --- |
| `scripts/prepare_customers_orders.py`, `scripts/test_prepare_customers_orders.py` | Prepare inactive customers/orders, preserve missing links and duplicates; proposals never auto-approved. |
| `scripts/prepare_finance_stock.py`, `tests/financeStockParity.mjs` | Prepare legacy finance/stock review and compare existing helper calculations. |
| `scripts/prepare_cash.py`, `tests/cashParity.mjs` | Preserve cash events and compare opening-balance scenarios without certifying balances. |
| `scripts/import_customers_orders.mjs`, `scripts/import_finance_stock.mjs`, `scripts/import_cash.mjs` | Transactional candidate inserts and readback validation, requiring `--apply`; no activation. |
| `scripts/import_clerk_development.mjs` | Reviewed identity import into the development tenant only; no business or direct Odoo access. Not rerun. |
| `tests/clerkHttp.mjs` | Check unauthenticated/invalid sessions on development port 5000 and a temporary built production server on 5099. Requires a free 5099 and an existing build. |
| `pilot/native_backup_test.py`, `pilot/native_db_storage_test.py` | Historical fictitious native-cluster recovery drills, not production backup jobs. |

The database import scripts deliberately depend on the existing Replit root project's
`pg` installation and private staging reports. They are not portable database migration
commands yet. Run from `ma2f-next` only after review of the source and target; do not
rerun imports merely to test syntax. Preparers write private review files; some refuse
to overwrite them. The cash preparer can replace its private report.

## Safeguards added after recovery

- Finance preparation now verifies the actual compressed archive against the pinned
  source SHA before reading its contents. A mismatched file is rejected even under
  Python optimization. Calculations are unchanged.
- All three candidate import scripts stop without `--apply` before loading reports or
  connecting to PostgreSQL. This flag authorizes only inactive candidate insertion.
- `scripts/test_migration_preflight.py` exercises those entry points with no business
  records or credentials. Existing source discrepancies and reports were not corrected.

## Verification

Locally: 24 migration tests, 32 gateway tests and 14 profile tests passed; syntax checks
passed for all thirteen recovered files. Gateway tests use mocks and temporary local
HTTP servers; they do not prove a production Odoo integration.

On Replit: 24 migration tests passed. Read-only parity checks passed for 1,017 sales,
five nonzero stock positions and 410 cash events. Legacy cash scenarios still differ
by source; they remain review results, not certified balances. Development and temporary
production HTTP checks returned 401 for absent/invalid authentication and 200 for the
legacy page. These HTTP checks do not verify production identity login/revocation.

No real-data imports, account grants, paid provisioning, publication or recovery drills
were performed in this step. The temporary HTTP process was stopped by its test.

## Recovery drill limitations

The filestore drill expects disk attachments. The native pilot has since been converted
to SQL attachment storage, so that older drill is retained as historical source and must
not be run unchanged against the current pilot. The SQL-only drill commits a fictitious
attachment, creates a fresh restore database, and verifies attachment hashes without a
filestore. Both are tied to the isolated native test cluster; neither provisions production
or provides scheduled backup retention. Production restore/redeployment remains pending.
