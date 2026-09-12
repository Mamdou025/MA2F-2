# Application readiness audit — September 12, 2026

Audited source: `81a3f2b`, committed and pushed to `origin/main` before this audit.
Remote repository: https://github.com/Mamdou025/MA2F-2.

**Verdict: NO-GO for unrestricted operational use and for the Odoo business cutover.**
The hosted application is reachable and the prepared components pass their local
tests. That is insufficient to certify reliable business transactions. Existing
Firebase operation has material persistence risks; native Odoo operation remains
uncommissioned. This audit did not change business data, permissions, flags or
deployments. GitHub main is updated; this does not establish that Replit runs an
identical source/dependency graph.

## Verification performed

| Check | Result |
| --- | --- |
| Root TypeScript (`node node_modules/typescript/bin/tsc --noEmit`) | Passed |
| UI (`node node_modules/vitest/vitest.mjs run`) | 5/5 passed, two files |
| Backend (`node --import tsx --test tests/*.test.mjs`) | 71/71 passed |
| Migration scripts (`python -m unittest discover -s scripts -p 'test_*.py'`) | 27/27 passed |
| Odoo deployment unit checks (same discovery in `deployment/odoo-core`) | 24/24 passed |
| Pilot gateway (same discovery in `pilot/gateway`) | 32/32 passed on rerun; first run had one Windows socket-abort error |
| Replit Vite production build and esbuild server bundle | Passed |
| Built Express process, temporary port, disabled native flags | Root/health 200, native auth/orders 503, anonymous Clerk verification 401; process stopped |
| Public browser | Login form rendered at `https://aquasachets.replit.app/`; no authenticated session in the audit tab |
| Dependency audit | 16 high, 36 moderate, 7 low, 0 critical reported by pnpm production audit |
| Firebase function codebases | Verification incomplete: dependencies absent locally; direct TypeScript attempts failed with missing Firebase/ExcelJS modules and downstream type errors |

159 automated tests passed across the five suites on their final runs. These do
not constitute a signed-in end-to-end business acceptance test. Root TypeScript
does not include the two Firebase function codebases. No database integration,
live Odoo addon acceptance, Firestore emulator, backup restore, or load suite was
rerun. Earlier deployment/restore evidence remains historical evidence only.

Public HTTP checks, approximately 20:46 UTC:

| URL path | Result |
| --- | --- |
| Aquasachets `/` | 200 HTML |
| `/api/healthz` | 200, `dependenciesChecked:false` |
| `/api/odoo-health` | 200, `connected:true` |
| `/api/odoo-orders/probe` | 503, `orders_not_enabled` |
| `/api/local-auth/get-session` | 200, null anonymously |
| `/api/local-auth/profile` | 401, `authentication_required` |
| Odoo `https://ma2f-odoo-mamdou025.replit.app/web/login` | 200 HTML |

The Odoo health probe checks login-page reachability, not transaction permissions,
stock, tax mappings or a completed order. Native commissioning being available
does not mean the main business login has migrated.

## Prioritized findings

### P1 — Failed saves can be reported as successful and skipped by later retries

Evidence: `client/src/contexts/AppContext.tsx:829`, `:849`, `:943`, `:989`,
`:1040`; `client/src/components/sections/CommandesSection.tsx:358`;
`client/src/components/sections/VentesSection.tsx:368`.

Screens call `saveDB(updated)` without awaiting it, then show success and close.
`saveToFirestore` catches errors and returns false, while `saveDB` ignores that
result and updates the sync timestamp. Entity and metadata comparison baselines
are advanced before writes are acknowledged. If a write fails, a subsequent
entity diff can regard the unsaved value as already synchronized and omit it.
The red sync badge provides some warning but does not make the success message
or retry semantics reliable.

Release requirement: expose an explicit acknowledged/pending/failed save result,
await it in transaction forms, advance baselines only after successful writes,
and retain replayable failed work. Verify denied writes, lost connections,
refresh/restart and retry without losing or duplicating a transaction.

### P1 — Concurrent shared metadata writes can overwrite orders and edits

Evidence: `client/src/contexts/AppContext.tsx:885` through `:950`.

The metadata flow performs `getDoc`, merges arrays in the browser, then calls
`setDoc(..., {merge:true})` without a transaction or revision precondition.
Two operators can read the same original array, independently append orders,
then overwrite one another's resulting array. Also, the merge overlays every
local item, including unchanged stale items, over a freshly read remote item;
that can undo someone else's edit. Firestore field merging does not reconcile
array entries. The fallback after a failed read uses an older local baseline.

Release requirement: use per-record writes or transactional conflict handling
that applies actual local changes. Demonstrate two simultaneous creates, edits,
and delete-versus-edit conflicts on isolated data.

### P1 — A lost Firebase sale response can create a second sale

Evidence: `cloud-functions/src/index.ts:319` (validateVente), especially the
generated sale ID and batch; `client/src/lib/cloudFunctions.ts:121`;
`client/src/components/sections/VentesSection.tsx:319` through `:370`.

The callable generates its own sale ID. If its batch commits but its response is
lost, the wrapper returns failure and the UI proceeds with a new local `uid()`.
There is no client request ID connecting that fallback to the committed sale.
Thus the same user action can persist two sales. Even the normal successful path
creates a server stock movement and a separate client movement with different
schemas; their accounting interpretation needs reconciliation, rather than
assuming that two records necessarily mean two debits in every screen.

Release requirement: one idempotent server-owned sale/stock operation, with a
stable request ID and status reconciliation after an ambiguous response. Verify
commit-then-timeout, retries, exactly one sale, and consistent stock effects.
The new native command queue has retry protections, but the active Firebase UI
does not use it.

### P1 — Odoo business cutover is incomplete

Evidence: `server/index.ts:26`, `server/orderRoutes.ts:13`,
`deployment/odoo-core/addons/ma2f_core/models/orders.py:1`,
`client/src/pages/LoginPage.tsx:12`, `client/src/contexts/AppContext.tsx`,
and current public HTTP results.

The main application still uses Firebase authentication and persistence.
Native orders are disabled publicly and the prepared operation creates drafts
only. The native client router is not mounted by the production entry point;
the main frontend is not wired to the native business APIs. A reachable Odoo
login page cannot establish that MA2F orders, production, delivery and payments
flow through Odoo.

Release requirement: finish mapped accounts/rights, product/customer/location/BOM
and opening-stock setup, confirmed included-tax mapping, and the native
order-confirmation-reservation-delivery/payment flow. Complete history/delta
reconciliation and prove the replacement works with Firebase unavailable.
See `MIGRATION-CURRENT-STATUS.md` and `FIREBASE-EXIT.md`; their outstanding
commissioning items are not closed by today's unit tests.

### P2 — Dependency and build reproducibility require triage

The local pnpm audit reported 59 findings including 16 high-severity findings.
These are registry findings, not 59 demonstrated exploitable application bugs.
Its graph includes build tooling; production reachability must be assessed.
The local graph must also be compared with Replit's separately preserved graph.

`xlsx@0.18.5` has high-severity prototype-pollution and ReDoS advisories:
[GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and
[GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9).
The reviewed client uses XLSX for export; the prototype-pollution advisory
explicitly excludes export-only workflows. Do not present that advisory alone
as proof of a reachable import exploit. Other flagged packages include Vite,
Rollup, path-to-regexp, DOMPurify, lodash-es, PostCSS, Mermaid and nanoid.

The audit ran with the installed pnpm entry point (10.18.1; project manifest
declares 10.4.1). No dependency installation, lockfile update or automatic fix
was performed. The shell's generic pnpm is 11.19.0 and warns that it ignores the
manifest's overrides/patch settings; use the project-pinned manager for builds.
No fresh frozen-lockfile installation was verified in this audit.

Build warnings include unresolved analytics placeholders and a main JavaScript
chunk of approximately 1.32 MB / 355 KB gzip. Test initial load on the actual
phones and connection quality used by staff. The repository has no `.github`
workflow directory, so these tests are not currently enforced by repository
GitHub Actions configuration.

### P2 — Operational acceptance evidence is still missing

No signed-in operator walkthrough was available in the audit browser. Account
enrolment/recovery/revocation/restart persistence, deployed Firebase rules and
functions, real tax/master-data configuration, backup schedules/retention and
restoration, alerting and capacity are not certified by this run. Native auth
library tests also warn about unresolved client IPs falling back to a shared
rate-limit bucket; verify trusted proxy/IP handling in the deployed environment.

## Release gates

1. Resolve the three persistence/idempotency findings; demonstrate failure and
   concurrent-use cases on isolated data with the real persistence layer.
2. Install and check both Firebase function codebases using their lockfiles while
   Firebase remains active; verify deployed rules/functions and role denials.
3. Triage reachable dependency advisories and reconcile pinned build graphs.
4. Complete native commissioning and the full business round trip, preserving
   30-sachet packs, net output, original amounts and existing access rights.
5. Perform signed-in acceptance for administrator, cashier, commercial and reader,
   covering orders, production, delivery, stock, sales, collections, closure,
   export, logout/recovery and rejected actions.
6. Prove final data parity, restart recovery, backup restoration, monitoring and
   intended load capacity before approving cutover.

Until these gates pass, the evidence supports availability and further controlled
testing, not production-readiness approval.
