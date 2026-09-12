# Firebase exit and Odoo commissioning

Decision confirmed September 9, 2026: accounts and sessions must run in the MA2F
Replit backend and PostgreSQL. The prepared Clerk integration is superseded as the
target, but remains in the transitional code until its replacement is commissioned.

Password delivery decision: administrators supply private, one-time setup/recovery
links, with no email service. See [the administrator procedure](LOCAL-ACCOUNT-SETUP.md).

## Current execution update

Draft-order backend increment is LOCAL and tested, not deployed. See
`docs/ODOO-DRAFT-ORDER-CONNECTION.md`. Native `record_order` creates exact-total
draft `sale.order` records using an explicitly configured included tax and XOF
pricelist. Express `/api/odoo-orders` uses native sessions and a durable queue;
the worker verifies receipts and rechecks permissions. Eight HTTP/worker tests,
TypeScript checking, native order rollback tests and existing native production
regression tests passed. No production orders were created. The Firebase frontend
still does not call the new API; live accounts/database/mapping/tax/commissioning
remain required. Draft creation does not reserve stock or post invoices.

Real-data navigation is applied using `deployment/odoo-core/setup_real_data_navigation.py`.
Native rollback preview and apply passed: 34 inherited views disable synthetic sample
rows; four built-in spreadsheet dashboards are unpublished (retained, not deleted).
Sales opens history action 542; Rapports MA2F opens native history pivot/graph action
544. Names state that these are the September 9 imported records, not live orders.
The total remains 15,339,780 FCFA across 1,048 sales. Native business record counts
remain unchanged (zero orders, invoices, payments, stock moves/quants and manufacturing
orders at this checkpoint). Previous navigation settings are saved in PostgreSQL
`ir.config_parameter` keys prefixed `ma2f_navigation.before.`. This UI configuration
does not commission an order writer and does not recreate historical native orders.
Live browser verification passed for report action 544: July 6,603,150 FCFA / 10,993
packs; August 6,646,930 / 11,019; September 2,089,700 / 3,477; total 15,339,780 /
25,489. Standard `/odoo/sales` now renders an empty table without synthetic records
or the default owner filter, and explicitly explains that live order synchronization
is not yet active. Its navigation exposes both the imported sales and real report.

Sales visibility (September 10 UTC): the user requested imported sales in Odoo
before tax-rate confirmation. `deployment/odoo-core/import_sales_history.py`
creates a persisted manual Odoo model `x_ma2f_sale_history` and a read-only Sales
menu, `Historique des ventes MA2F`. Native preview and committed import verified
1,048 records totaling 15,339,780 FCFA from the preserved September 9 snapshot.
An independent repeat preview reused all 1,048 records and created zero duplicates.
Original sale payloads and linked receipts are retained on each record. Date,
reference and customer are searchable; the list defaults to newest date first.
Administrator read access and denied create/write/delete were verified natively.
This history is not `sale.order` or `account.move`: no invoice, payment or inventory
posting occurs, and it does not enable live synchronization. Tax-inclusive totals
remain unchanged; the included rate is explicitly pending. Action ID: 542.
After manual model creation, the maintenance script must signal the Odoo registry
following commit so the running web service loads the model without redeployment.

Latest user tax decision: recorded sales amounts include tax, and all totals must
remain exactly unchanged. The included rate is not yet confirmed. Historical
invoice posting is explicitly deferred until the correct rate is available; do
not infer zero tax or add tax on top. This does not block other migration work.

Production worker continuation:

- `server/productionWorker.ts` provides an internal, one-job production dispatcher.
  It uses a separate `ODOO_COMMAND_API_KEY`, an explicit writes flag, a fixed native
  method and database/company guards. The read-only diagnostic key is not reused.
- Actor authorization is rechecked before dispatch. Disabled workers do not claim
  jobs; revoked actors/unsupported operations enter manual review. Unknown outcomes
  retry the same durable request ID. Completion requires a matching native receipt.
- Three new tests passed: fixed RPC/receipt checks, a simulated lost response after
  commit followed by idempotent retry, and disabled/revoked access. These are worker
  contract tests, not proof of live network concurrency or production deployment.
- Worker startup, production addon installation, native user commissioning and
  atomic application projection remain pending. No live stock writer was enabled.

September 10 UTC historical-import and runtime preparation (not a cutover):

- User explicitly requested historical transactions in Odoo too. Do not replace
  that requirement with opening balances only. Tax treatment is still awaiting
  user input; no historical invoices or payments have been posted.
- Verified source projection contains 1,048 sales. Twenty reference 18 customer
  names absent from the current registry. Exact-name matching reflects the MA2F
  source model; case variants must not be silently merged.
- There are 28 intentionally unallocated receipts and one receipt with a nonempty,
  unresolved sale reference. The 28 free receipts are not broken-reference anomalies.
- Contact plan contains 218 current customers and 37 additional names from historical
  sales/receipts (255 total), with stable markers and original provenance. Input is
  staged privately in the Odoo workspace. Native production import committed all
  255 contacts after rollback preview; independent repeat preview reused 255 and
  created zero. Source names, phones and original provenance matched. No financial
  or stock postings. An initial sequential preview timed out and rolled back;
  batching native ORM creation fixed it without relaxing validation.
- New runtime state repository passed real development PostgreSQL tests for concurrent
  writes, idempotent replay, revision/hash conflicts, transaction rollback and persistence.
  The temporary test schema was removed. Production runtime schema is not provisioned.
- Native-session client routes and strict source-preserving validation are prepared,
  not mounted in the live application. Nine targeted tests and TypeScript check passed.
- `deployment/odoo-core/addons/ma2f_core` is a new, locally tested native production
  command addon. In isolated Odoo/PostgreSQL, 17 net packs consume 1 estimated kg;
  replay, input/configuration guards, insufficient stock and native failure rollback
  passed. It is not installed in production, and HTTP concurrency remains to be tested.
- Firebase is still the live application backend. Full feature API replacement,
  command worker integration, historical postings, final source delta/freeze,
  native administrator sign-in and cutover remain outstanding.


September 10 UTC verified follow-up:

- Odoo production master data committed using native ORM after a rollback preview:
  company 1 is MA2F/XOF, film product 3, saleable pack product 4 (30 sachets),
  internal material location 17, finished location 18, BOM 2 (17 packs per kg,
  explicitly an estimate). No historical orders, opening balances or stock were posted.
  Tax configuration still requires verification; no tax rate was invented.
- Read-only integration identity 11 is active. Its base role is `base.group_portal`,
  with a dedicated read group. Native internal-user membership inherited write ACLs
  for `stock.move.line` and `stock.reference`, so that approach was rejected by the
  startup validator and rolled back. The dedicated group permits a 30-day API key;
  current expiry is 2026-10-10 00:18:36 UTC. Rotation is required before expiry.
- Startup policy explicitly includes the integration login even with a restricted
  portal base role, retaining provenance and effective ACL write checks. Odoo build
  `48f6887a-2a26-46d5-b6ee-67de48ef0558` published before activating identity 11.
  MA2F build `5f2b7607-4e6f-4b55-b3ed-e47b3b338cb5` published with server-only
  Odoo connection secrets and native-session diagnostics.
- Live Odoo JSON-2 verification passed for company 1, products 3/4 and locations 17/18.
  All 18 create/write/unlink permission checks across stock.quant, stock.move,
  stock.move.line, stock.reference, mrp.production and product.product returned 403.
  These were access checks, not attempted business mutations. Zero business writes.
  Temporary plaintext credential output was removed after storing the production secret.
- `/api/odoo-integration/connection` now uses native server sessions and PostgreSQL
  profiles instead of Clerk. A preserved active verified administrator may use this
  read-only commissioning diagnostic before business activation. Public anonymous
  requests return JSON 401. An authenticated administrator request through MA2F is
  still pending real password setup/sign-in; direct live Odoo API verification above
  does not establish that end-to-end user result.
- Public `/api/healthz` now returns JSON 200 with `service=ma2f-web` and
  `dependenciesChecked=false`. Native `/api/local-auth/profile` returns JSON 401
  anonymously. This liveness result does not assert database or Odoo health.
- Validation: 25 targeted local tests, 16 remote targeted tests, TypeScript checks,
  remote production build, and 13 startup account-policy tests passed. Actual user
  password setup/sign-in and the full Firebase-free business workflow remain unverified.

- Native authentication published in Replit deployment
  `fe6e2129-465d-4664-bea3-e59af0e480ba`. The five missing production settings were
  added and `MA2F_LOCAL_AUTH_ENABLED` enabled for commissioning. The main app still
  uses Firebase. No business profile was activated.
- Public `/api/local-auth/login` serves the standalone native login page;
  `/profile` returns JSON 401 anonymously. Public signup and reset-link issuance
  return JSON 404. The setup page was opened privately for the existing administrator
  `ziza220@gmail.com`; actual password setup/sign-in remains pending user action.
- Profiles now load from PostgreSQL on every native profile request. Shared role
  defaults, custom section/action restrictions and revocation are tested. The new
  `requireLocalAction` middleware is available for business routes, which still need
  implementation and wiring. Two preserved source identities have unverified emails;
  their status was not changed.
- The runtime source projection passed against the full archived snapshot. It retains
  1,048 sales, 218 clients, 51 production entries and 666 stock movements. Metadata
  orders remain explicitly empty. The metadata has three user records whereas the
  reviewed identity contract has five accounts; both sources remain preserved.
  `clotures` and `budgetsDepenses` differ between metadata and global settings. The
  projection records these differences and applies global settings after metadata,
  matching the intended global-parameters reader. No source record was rewritten.
- The durable command outbox passed real development PostgreSQL tests for duplicate
  requests, conflicts, independent connections, concurrent claims, expired-worker
  fencing, unknown outcomes and retry exhaustion. Test schema removed. It is staged,
  not provisioned in production or connected to an Odoo writer. Its lost-response
  test uses a simulated Odoo receipt, not a real production Odoo transaction.
- Public `/healthz` previously returned an infrastructure HTML 404. The deployed
  `/api/healthz` alias is now verified as described above.

The sections below retain the earlier preparation evidence. This update supersedes
their statements that the authentication code has not been published.

## Target ownership

| Component | Final owner |
| --- | --- |
| Password verification, sessions | Better Auth 1.7.3 in MA2F backend; PostgreSQL `ma2f_auth` schema |
| Business identities and permissions | MA2F server, preserved from source, enforced on every business request |
| Orders, reservations, stock movements, manufacturing | Separate Odoo Community project and database |
| Custom business data, immutable source archive, durable request log | MA2F PostgreSQL, separate from Odoo |
| Uploaded files and backup archives | Replit App Storage; restore checks required |
| Code | Version-controlled codebase, deployed separately to the two Replit projects |

Codex is a development tool, not a running service required by the application.
Replit-managed PostgreSQL may use a database infrastructure provider underneath;
the user manages the service through Replit. Removing Firebase/Clerk does not remove
optional external maps, payment or message-delivery providers.

## Implemented locally in this step

- Better Auth and pg pinned, server-side auth factory, schema-only migration entry
  point, Express and Vite commissioning routes under `/api/local-auth`.
- Exact HTTPS origin, verified PostgreSQL TLS, explicitly named non-Odoo database,
  dedicated schema, secure HTTP-only cookies, database sessions/rate limits,
  no session cookie cache and no public registration.
- Disabled by default. `/profile` never grants business access or Odoo access.
  The setup page and password redemption route are implemented behind this disabled
  commissioning gate. Only the administrator CLI can issue links; public issuance
  and registration remain closed. No real password or setup link has been issued.
- Native library tests with its memory adapter verify hashing, wrong-password and
  foreign-origin rejection, successful login, session storage and logout revocation.
  They do not prove PostgreSQL persistence or production proxy/IP configuration.
- `server/productionPlan.ts` accepts a UUID and net packs, rejects client-provided
  identity/company/yield/defect adjustments, and retains exact estimated consumption
  against a source settings SHA. It creates no business movement. The source rate
  must be supplied by the trusted server; no silent default of 17.
- Availability button wording now says the server is available, avoiding the
  implication that business synchronization is running. This is a local UI change.

## Production preparation verified on 2026-09-09

- Prepared Better Auth tables in the MA2F production PostgreSQL database, isolated
  in `ma2f_auth`. The runtime role cannot read or write unrelated application tables.
- Real PostgreSQL tests passed for wrong passwords, foreign origins, secure cookies,
  session persistence in a new Node process, logout and revocation. The fictitious
  test account and its sessions were removed.
- Imported five reviewed source profiles without passwords or activation. Exact
  profile/permission JSON and one quarantined record were preserved. A repeated
  import passed without duplicate records or permission changes.
- Five server-only auth settings are saved in Replit project Secrets and were
  compared with the prepared configuration in a fresh shell. Auth remains disabled.
  Existing published deployment settings still require separate verification.
- Replit TypeScript and build passed after adding the pinned authentication
  dependencies. Existing remote interface improvements were preserved.
- Native library recovery tests also pass for first password setup, one-time and
  expired tokens, old-password rejection and session revocation. These are tests;
  no production invitation or recovery delivery mechanism has been enabled.
- Private link issuance and the actual native HTTP setup/login/logout flow pass
  with fictional identities. The issuer checks the preserved source account and
  writes an exclusive private file; no role or activation is changed. The setup
  page removes its fragment token from browser history and loads no cloud auth SDK.
- The setup page, issuer and disabled route mounts are staged in Replit without
  replacing remote interface changes. Replit TypeScript and production build pass.
  A disposable local browser fixture verified confirmation mismatch and successful
  password setup. No real-user link was issued and no deployment was republished.
- Replit built-server smoke test passed: homepage/health 200; setup and reset-link
  issuance return 503 while commissioning is disabled. The test server was stopped
  and terminal accessibility was returned to its original disabled setting.
- Full fixed-read-time Firestore export completed: 13,975 documents, 25 collections,
  no nested collections or missing parents found. The complete archive and every
  typed source record were imported to production `ma2f_source` and read back exactly.
  Read time: `2026-09-09T22:26:33.433006Z`; compressed archive SHA-256:
  `f6a1f35312dd1550e9015800b8396ae16ca6efd3d28e223b197608ddb9c27fdb`.
- Storage preservation completed for 114 object versions totaling 165,043,806 bytes
  in two buckets, including project storage objects beyond customer uploads. All
  source MD5 checks and local SHA-256 readbacks passed. The 36,166,446-byte storage
  archive was preserved in production PostgreSQL and restored through a new connection.
  Archive SHA-256: `4bd4040736b82121b065a3c106383ff63930b906589d2529cef68fd24650e20b`.
- Temporary transfer access/checksum tests passed. Original Vite configuration was
  restored; HTTP checks confirmed homepage 200, private archive 403 and removed
  transfer endpoint 404. These archives do not replace a final cutover delta because
  Firebase remains writable.
- Temporary provisioning/runtime credential files and the transfer credentials were
  removed after verification. Complete private archives remain; verified transfer
  fragments were removed. Replit's original terminal accessibility preference was restored.
- Repeating the full Firestore import reused the existing archive and all 13,975
  records without duplicates. The restricted auth role still could not read or
  write these newly created source tables; its tests passed using saved Replit
  Secrets rather than temporary configuration files.
- Fresh source comparison detected 185 root orders and one sale absent from the
  previous snapshot, plus new/changed transactions and trash entries. Both snapshots
  are retained. Earlier candidate tables must not be activated without refreshing
  their source mapping. No missing record was restored or corrected.
- Source plastic yield is explicitly 17 in both `meta/data.params` and `params/global`.
  Order source mapping needs further verification: the live code lists `commandes`
  among metadata fields, while the fresh archive has 32 root order documents and
  an explicitly present empty metadata orders array. Remote AppContext confirms
  orders are a metadata field, not an entity collection. Preserve the empty array;
  do not silently restore the 32 archived root orders into it.
- `server/localProfile.ts` is prepared locally with tests for preserved permissions,
  inactive/unverified identities, client-role injection and immediate profile reload.
  It is not yet wired into the live business routes. Commissioning remains disabled.

These checks do not establish that the application has switched away from Firebase.
Its business login, readers and writers still need replacement and end-to-end testing.

## Removal gates, in execution order

1. Provision auth schema using a restricted MA2F database role; validate schema and
   persistence after restart, proxy IP handling/rate limiting, enrolment, login,
   logout, recovery and revocation. Preserve source users and action/section rights;
   do not reuse unknown Firebase password hashes as Better Auth credentials.
2. Provision the separate Odoo integration identity. Verify API, product/unit/location
   mappings and source yield. Do not reuse the pilot database, its actor or fixture BOM.
3. Persist commands before dispatch and deduplicate inside the Odoo transaction.
   Exercise receipt, production, order, reservation and delivery, including competing
   stock requests and a timeout after commit. Display actual results in MA2F.
4. Reconcile source snapshot and the final migration delta; preserve discrepancies
   as source facts. Opening inventory and replayed historical stock movements must
   not both post the same stock. Switch one verified operation's writer and reader
   together. Never fall back to Firebase after an uncertain Odoo write.
5. Move remaining data, realtime updates, uploads, backups and Cloud Functions.
   Replace business login and enforce all preserved roles on the server. Validate
   complete source subcollections/files and restoration, not just candidate counts.
6. Block Firebase writes, import/reconcile the final delta, and run the complete app
   with Firebase endpoints unavailable. No legacy writer or Cloud Function fallback
   may remain. Remove Firebase/Clerk SDKs and configuration after this passes.
   Retain a private verified archive; deleting the old cloud project is a separate
   irreversible cleanup, not necessary to remove Firebase from the running app.

Firebase is still live today. No production switch or publication was performed in
this step. A date for removal would be speculative until gates 1–5 pass. Successful
Odoo hosting or a green availability dot is not evidence that these gates passed.

Local validation: TypeScript and `build:replit` passed; 22 targeted auth, production
contract and existing Odoo diagnostic tests passed. Existing analytics placeholders,
bundle size and Clerk/React peer warnings remain. The native library test reports
shared rate limiting when no trusted client IP is supplied; Replit proxy handling
must be verified before enabling this service for real users.

## Odoo Community deployment checkpoint (2026-09-10)

The selected free OCA extensions are installed in production and published in
Replit release `4e59b1a6`. Backup restoration, source integrity, unchanged business
and account/configuration digests, and the public login response were verified.
See `COMMUNITY-REPLIT-DEPLOYMENT.md`. This release changes Odoo Core only:
Firebase remains authoritative, local MA2F account activation and the live business
gateway remain pending, and no unconfirmed tax rate was assigned.

## Commands and deployment inputs

Server-only: `MA2F_AUTH_ORIGIN`, `MA2F_AUTH_SECRET` (random, at least 32 characters),
`MA2F_AUTH_DATABASE_URL` (verified TLS), `MA2F_AUTH_DATABASE_NAME`.
Never prefix these with `VITE_`. `MA2F_LOCAL_AUTH_ENABLED` remains false.

With the reviewed database target and role, schema preparation is explicit:

```
node --import tsx scripts/migrate_local_auth.mjs --apply
node --import tsx scripts/migrate_local_auth.mjs --plan
```

The script uses Better Auth's own migration implementation, not hand-maintained
password/session tables. It does not migrate users, supply a mail transport, enable
auth, change the existing MA2F login page or activate business access.

References: https://better-auth.com/docs/integrations/express,
https://better-auth.com/docs/concepts/database,
https://better-auth.com/docs/reference/security.
# September 12 owner decision

Taxes are managed outside Odoo; all earlier tax-rate commissioning requirements
below are superseded. The current draft connector takes plain FCFA amounts and
no tax parameter. See `ODOO-DRAFT-ORDER-CONNECTION.md` for current status.
