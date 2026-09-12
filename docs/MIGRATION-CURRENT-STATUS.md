# MA2F migration — current checkpoint

## Current release checklist — September 12, 2026

This section supersedes the historical notes below. User authorization remains
in the conversation; old checklist wording must not be used to ask again for
already-authorized work.

- Odoo Community and the six selected OCA modules: deployed and verified on
  September 10, release `4e59b1a6`. Backup restoration and preservation checks
  passed. See `COMMUNITY-REPLIT-DEPLOYMENT.md`.
- The designated direct Odoo administrator exists. Browser session renewal is
  needed to inspect the current native menus. Do not confuse this with activation
  of MA2F backend accounts.
- Aquasachets active source is `ma2f-next/`; the old root Expo app is retired.
  September 12 comparison covered 210 existing local source/config/test files:
  182 matched, 15 differed, 13 were absent remotely. This is not an inventory of
  every asset/script or proof of identical dependency graphs.
- Replit's newer branding/mobile navigation and their tests were preserved and
  brought into the local checkout. The pending Replit task #5 was not applied.
- Thirteen reviewed connector/queue/test/status files were synced to Replit with
  hash guards and source backups. The shared role defaults were compared and are
  identical. No permissions or activation flags changed.
- Replit TypeScript checks, its five UI tests, selected order/production/client
  tests and production build passed after the merge. Local TypeScript, five UI
  tests, fourteen focused order/production/client tests and production build passed.
- Aquasachets release `fe6e2129-465d-4664-bea3-e59af0e480ba` was published on
  September 12 (started 18:56 UTC; live verification about 19:05 UTC).
  Existing Autoscale sizing was preserved and development-to-production database
  copying remained unchecked. No secrets, permissions or activation flags changed.
- Public verification: `/` and `/api/healthz` return 200; `/api/odoo-health`
  returns 200 with `connected:true`; `/api/odoo-orders/probe` returns 503 JSON
  `orders_not_enabled` (before release it incorrectly fell through to HTML).
  Native account commissioning is already enabled in production: get-session
  returns 200/null anonymously and profile returns 401. This is not activation
  of the main business login. Development flags were all false; they must not
  be used as evidence of production settings. No real transaction was submitted.
- Keep environment-specific lockfiles and runtime dependency pins until their
  graphs are reconciled deliberately. Replit has added UI test tooling; local
  tooling was merged using the project's pnpm 10.4.1. Existing peer warnings
  remain; these are not proof of runtime failure or resolved compatibility.

Remaining gates, in order:

1. Renew the Odoo browser session and verify authenticated native navigation.
   The reconciled Aquasachets release and public checks are complete; an actual
   signed-in MA2F browser walkthrough remains separate from the five UI tests.
2. Configure real product/customer/location/BOM/opening-stock mappings, audit
   rules and quality workflow integration. Preserve 30-sachet packs and net output.
3. Commission backend accounts with preserved rights and private one-time links;
   test enrolment, recovery, expiry, revocation and restart persistence.
4. Test the native order → confirmation → reservation → delivery round trip,
   including retries/concurrency, before enabling real commands. The prepared
   order endpoint creates drafts only. Actual tax configuration is still missing.
5. Reconcile final source deltas/history and migrate remaining Firebase services.
   Prove the app works with Firebase unavailable before removing its dependencies.
6. Verify intended scheduled tasks, backup retention, restore and load capacity.

## Historical session notes (not the current pending-work list)

## Latest verification — September 9, 2026

**Odoo hosting is online and verified as of 14:29 UTC.** Deployment
`5461e6d0-49a0-407b-a7a6-412a88b9df28` passed publication and external checks:
login HTTP 200; all three normal assets and three freshly generated debug assets
HTTP 200; signup hidden; default admin/admin rejected. Production startup verified
the restricted database role and loaded all 77 modules. Local evidence:
`deployment/odoo-core/.local/public-readiness-result.json`.
This completes initial locked hosting, not business cutover. Direct Odoo administrator
activation, the real MA2F integration, and any MA2F account grants remain separate.

Session history:

The public Odoo URL still returned HTTP 502 at the start of this session. Replit
still reported the old `31fe94bd` deployment; runtime logs confirmed the original
production-blocking launcher. The prior retry did not become a live deployment.

The `ma2f_odoo` database and production launcher are preserved. The previously
submitted runtime secret was not saved by Replit and the temporary /tmp test
configuration expired. The unpublished runtime credential was renewed with the
same permissions. A fresh production-database smoke test passed: login HTTP 200,
signup hidden, admin/admin rejected, temporary server stopped. The private mode-0600
`.local/production-runtime-password` was retained until publication saved the secret,
then removed. It must not be committed or logged.
The provisioning administrator's role membership was rechecked successfully.

That publication failed validation because Replit generated a table before its
shared Odoo sequence (`ir_actions_id_seq`). It was cancelled without applying the
invalid migration. The unused default `neondb` was aligned using native PostgreSQL
tools: its existing Odoo objects are preserved in `ma2f_initial_setup_archive_20260909`,
and a complete pre-repair dump is retained (SHA-256
`d093f4e0d845fdcfcaa0f561e9273d5e3e837e3f0a2cf1ceff2ed6c3fbcd6c14`).
Replit-managed extension objects stayed in public. The native template restore
passed with 549 public tables and zero active internal users/business transactions.
The initial extension move was rolled back; a final search-path correction allowed
post-data constraints and checks to commit successfully. Do not rerun either repair
entry point against this completed state. `ma2f_odoo` was not modified by the repair.
Column parity was verified; decompiled constraint/index text differs (observed index
examples use equivalent cast notation). Publication proceeded successfully afterward.
No MA2F data or user access changed.

## Publication and runtime packaging

Native schema alignment unblocked Replit provisioning. Build
`2361ee9f-764d-4d24-b47b-e491d2070161` was published after its security/build/bundle
checks passed, but public HTTP remained 500. Production logs identified the cause:
`start.sh` could not execute the virtual environment's Python because its Nix runtime
was absent from the server image (exit 127).

A root `replit.nix` now declares the same pinned Python 3.12.8 and native dependency
closure used by the successful smoke test. Nix evaluation succeeded; the declared
Python path exactly matches the virtual environment interpreter. Publication
`9ef141f4-bc52-4290-99fa-400f99561c51` included the Nix layer. Earlier exit-127 errors
remained in the transition log, but the new server started at 14:00 UTC, loaded all
77 modules, and served the login page at 14:01 UTC. External login HTTP 200 and
default-admin rejection were verified. No additional Python interpreter fix was needed.

An external CSS check exposed `ImportError: libstdc++.so.6` in libsass. The complete
traceback was reproduced using a temporary server against the same database.
The pinned C++ runtime is now declared in both Nix environments; install records its
store path and start.sh exports its library directory. The enhanced smoke test passed
login, three CSS/JavaScript assets, signup hiding and default-admin denial, then stopped
its temporary server. Eight launcher/preflight unit tests also passed.
The corrected asset runtime was published as `5461e6d0` and passed external normal
and debug asset verification. Temporary smoke ports/configuration files were removed.

The production runtime secret is now confirmed saved in Replit. Temporary workspace
and test-config copies of its credential have been removed. No account permission or
business data changes accompany this packaging fix.

The final external checker initially rejected Replit's injected external script URL;
the check was scoped to Odoo's own `/web/assets/` resources. All six passed. This was
a verification-script scope correction, not another server failure.

## Earlier hosting observation (before the September 9 fixes)

The user subsequently published MA2F-Odoo-Core at
`https://ma2f-odoo-mamdou025.replit.app`. Replit shows a Reserved VM (0.5 vCPU / 2 GiB)
and a connected production database. A read-only request to `/web/login` returned
HTTP 500. Visible deployment logs show repeated restarts and the explicit
`Production startup is blocked` message from the development-only launcher.
This is a provisioned deployment, not a functioning production Odoo service.
Do not report that there are no paid resources; current charges have not been audited.

The user has now explicitly accepted the USD 15/month VM plus database and usage
charges. The original total-budget condition is superseded; no repeat approval needed
for the agreed server and associated database/usage costs.
During that initial inspection no writes were performed. Following explicit cost
approval, production provisioning has started; Development Run remains separate.
A dedicated restricted runtime role and fresh `ma2f_odoo` database have been created.
The verified empty development template has been restored there successfully. The initial partial
`neondb` bootstrap was stopped and is not the runtime target. No business data or
account grants are included. The corrected pinned Odoo build passes. The production-database smoke test passed:
login HTTP 200, signup hidden, default admin denied, temporary server stopped.
Temporary provisioning credential files were removed. Republication was submitted
with the dedicated runtime secret and without copying development over production;
public availability is not verified yet.

Local preparation: `deployment/odoo-core/production_preflight.py` validates a dedicated
`ODOO_PRODUCTION_RUNTIME_URL` using `odoo_core_prod`, verified TLS and read-only SQL.
It checks database-role privileges, installed modules, SQL attachment storage and
signup configuration, without printing credentials. Five local tests passed. With
no dedicated runtime URL supplied it fails closed, as expected. It has not been run
against the production database, uploaded to Replit or wired into the launcher.
Its successful database report deliberately does not authorize publication.

## Completed and verified

- Aquasachets runs the new source in `ma2f-next`; its Firebase business login remains active.
- The blank preview caused by a broad hidden-directory rule was repaired. Vite's
  pnpm runtime loads; private migration data, native Odoo configuration and root Git
  configuration remain inaccessible through the development web server.
- Clerk development identities have been imported without business authorization.
  A real administrator session was recognized by the server in the earlier verification.
- Seven authentication source/package files were retrieved from Replit in a verified
  code-only transfer (SHA-256 of base64 envelope:
  `6e490becc872eea5d737ebd7e9d904a41dcfab8ce788094076dd201035923dc9`).
  Six runtime source files were reconciled locally; package changes were merged.
  The logo and Clerk CSS additions were also brought back. The existing local profile
  resolver was compared to the remote one; differences are presentation only.
- Local direct Clerk/proxy dependencies are pinned to the versions observed in Replit.
  The local lockfile was regenerated with project pnpm 10.4.1, not copied wholesale
  from Replit; this does not claim identical transitive dependency graphs.
- TypeScript, the Replit production build and all 14 profile permission tests pass locally.
  The built server passes six HTTP checks: health, legacy page and Clerk verification
  page return 200; absent/invalid sessions return 401 with no-store and without reflected
  CORS; invalid Clerk credentials do not break the legacy page. Temporary server stopped.
- Source export now includes test files and Nix/shell installation scripts while keeping
  runtime data excluded. No complete source upload, push, publication or account change
  was performed during this reconciliation.
- Thirteen remaining migration/import/parity/backup source files were recovered from Replit
  in a checksum-verified code-only transfer (`397ae6fe73e152671b192f33724332ccfcced306606bd75637cbc73f8fc1de5a`).
  The finance preparer now checks the pinned archive checksum before decompression.
  All three candidate import entry points now reject calls without `--apply` before
  loading private data or PostgreSQL. These four fixes match locally and on Replit.
- Current verification: 24 local migration tests, 32 local gateway tests and 14 local
  profile tests passed. Replit's 24 migration tests, read-only parity checks for 1,017
  sales, five nonzero stock positions and 410 cash events, and development/temporary
  production HTTP isolation checks passed. All 13 recovered files pass syntax checks.
  No business imports or backup drills were rerun; existing reports/data remain intact.
  See `MIGRATION-SCRIPTS.md` for environment and execution limitations.
- Odoo Community 19 is installed and verified in the separate MA2F-Odoo-Core development
  project. SQL role restricted, internal accounts inactive, native attachment storage in SQL.
  The originally empty Replit startup configuration is now set to `bash start.sh`.
  Odoo's development Run action serves `/web/login` on port 5000 (HTTP 200).
  The launcher refuses production execution until production database/access setup
  is implemented and verified. No publication or paid activation was performed.
- Immutable source data and inactive PostgreSQL migration candidates are preserved.
  Fictitious Odoo business, SQL-only attachment restoration and private backup transfer
  tests have passed. They do not constitute a real-data production cutover.

## Still required

1. Finish production database restoration, verify the locked Odoo runtime and redeploy.
   The user has explicitly approved the USD 15/month VM plus database and usage charges.
   The former total-budget condition no longer blocks this work. Do not change unrelated
   account-wide billing controls.
2. Reconcile remaining operational notes and other source/configuration differences.
   Migration/import/backup scripts are now recovered. Do not replace the whole Replit
   source with this local tree yet; dependency graphs still differ.
3. Address the existing Clerk/React peer warning: both environments currently use React
   19.2.1, while these Clerk packages declare later supported patch ranges. Existing
   build warnings also include optional analytics placeholders and bundle size.
4. Complete inventory of source subcollections/files, production identity login and
   revocation tests, durable command persistence and API integration/authorization tests.
5. Test production restore/redeployment, then plan per-operation cutover and disable old
   Firebase writers only after that operation's replacement is verified.
6. Return to the requested MA2F administrator access for fallmamadou151@gmail.com.
   The user explicitly deferred this action to finish other work first. No role changed.
   This is distinct from designating the single direct Odoo administrator, also deferred.

Business rules remain: sachets only, 30 sachets per pack, production measured as net
saleable packs. Preserve source discrepancies; do not silently invent missing business data.

Publication validation initially failed in the default managed `neondb` database: Replit could not alter `orm_signaling_registry`, owned by the restricted runtime role. The failed deployment was cancelled. The provisioning administrator was granted membership in `odoo_core_prod` so it can manage runtime-owned objects; the runtime role itself still has no superuser, database/role creation, replication or RLS bypass privilege. No business records or application account permissions were changed. The actual Odoo runtime target remains `ma2f_odoo`. Retry publication after this repair.
# September 12 update: French and external taxes

The owner confirmed that taxes are handled outside Odoo. Prior tax-rate gates
in historical notes are superseded: do not configure tax parameters. The revised
draft connector uses plain FCFA amounts and explicitly clears native line taxes.
Local native rollback tests passed, including an inherited product tax fixture.
French is installed and active for the human Odoo account. Live sales and purchase
tax defaults were cleared, saved and verified blank. Existing product-specific
tax assignments still need inspection. Source changes are not yet deployed;
native order activation, current-data reconciliation and physical stock counts
remain outstanding. See `ODOO-DRAFT-ORDER-CONNECTION.md`.
