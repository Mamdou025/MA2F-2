# Community-first pilot

Scope: local fictional data in `ma2f_community_test`, separate from the existing
pilot and production. No Replit deployment, source migration, real tax choice or
new subscription is part of this increment.

## Reproducible environment

- Odoo and PostgreSQL image digests remain pinned by `pilot/compose.yaml`.
- `pilot/community-addons.lock.json` pins six OCA repositories to exact commits,
  recording module versions, licences and dependencies.
- `python pilot/community_prepare.py` fetches only the selected module folders into
  ignored `pilot/.local/oca/`. Existing lock entries are reused, not advanced to
  the latest branch. Local source modifications are refused.
- Ubuntu WSL: `python3 pilot/community_test.py init`, then `test`. The pilot
  PostgreSQL service must be running. `upgrade` checks reloading the same pinned
  modules; `upstream-test` runs the selected upstream test suites in a new database
  named `ma2f_community_upstream_<random suffix>`. This avoids testing partially
  loaded module registries against an already extended database schema.
- No test HTTP port is published. Odoo runs as an ephemeral container, with source
  mounted read-only and database names restricted to the isolated pilot databases.
- The acceptance scenario rolls back its fictional business records. Installation
  metadata remains in the isolated database. Logs and detailed results are private
  local files under `pilot/.local/community-*`.

## Installation result

Installation succeeded with 100 installed native/dependency modules and no modules
left pending installation. Selected additions: `stock_no_negative`, `auditlog`,
`account_financial_report`, `quality_control_oca`, plus `date_range` and `report_xlsx`.
Native transport, fleet, maintenance and employee expenses are also installed.
No upstream Odoo or OCA source was edited to install these modules.

The selected OCA modules declare AGPL-3, except LGPL-3 `date_range`.
`report_xlsx` requires the Python packages `xlsxwriter` and `xlrd`; the pinned image
satisfied installation requirements. There is no paid integration selected here.
Upstream source and licence references are recorded in the lock file and in
`MA2F-COMMUNITY-CAPABILITY-MAP.md`.

## Executed acceptance results

All 17 checks passed against real Odoo/PostgreSQL, not mocks:

| Scenario | Observed result |
|---|---|
| Supplier receipt | 10 kg received through a confirmed native purchase order. |
| Net production | 100 saleable packs produced and 5 kg consumed using a fictional fixture recipe. No second subtraction of defects. |
| Reservation | Order for 20 packs leaves 80 available. |
| Partial delivery | 12 delivered, native backorder for 8, then 20 total delivered. |
| Customer return | 2 packs returned; stock becomes 82. |
| Negative inventory | Attempt to remove 83 from 82 rejected by OCA; quantity remains 82 after rollback. |
| Quality | In-range inspection succeeds; out-of-range inspection fails through the native OCA inspection workflow. |
| Audit | Customer modification recorded with the executing Odoo user. |
| Financial reporting | Balanced fictional journal entry of 12,345 produces +12,345/-12,345 ledger balances; actual XLSX generated with fixture amounts. |
| Module availability | Fleet dispatch field, maintenance and expenses models loaded. These are availability checks, not full operational tests for those three domains. |
| Tax boundary | No invoice posted; commercial fixture has no tax and makes no claim about actual MA2F tax treatment. |

The first ledger assertion compared the report's structured balance object to a
number. The test was corrected to inspect its `balance` member; the complete scenario
then passed. No OCA financial code was changed. A Windows/WSL line-ending difference
also required normalizing Git source checks, without suppressing actual edits.

The selected upstream regression suites finished with **94 tests, zero failures,
zero errors** on September 10, 2026 at 04:09 UTC. The execution used the fresh
`ma2f_community_upstream_test` database; subsequent runs generate a unique suffix.
Per-module timing statistics include setup/subtest counts and must not be summed
as independent tests; 94 is the final Odoo test-result count.

The first regression attempt on the already installed integration database reported
eight setup errors: base-only registries encountered accounting columns such as
`res_partner.autopost_bills`. Running installation-stage tests in a fresh database
resolved them without editing upstream code. The failed attempt is retained in
`pilot/.local/community-upstream-test.log`; the successful run is in
`pilot/.local/community-upstream-fresh.log`.

Independent SQL verification after the integrated scenario found zero orders,
manufacturing orders, stock moves, accounting moves and quality inspections.
The installation databases are retained; the pilot database container was stopped
after testing, restoring its previous state. Other applications were not stopped.

## Adoption decision

- Use `stock_no_negative` as the candidate stock safeguard instead of implementing
  an equivalent quant constraint in MA2F. Still test concurrency through our actual
  adapter and configure exceptions before production.
- Use `auditlog` for selected model changes, alongside the MA2F request/actor trail.
- Use `account_financial_report` and its dependencies for the tested reports rather
  than maintaining a separate TypeScript ledger. Actual accounting acceptance remains.
- Use `quality_control_oca` as the inspection foundation. Do not yet advertise
  automatic quality blocking: that connection remains unimplemented/unverified.
- Keep native purchase, manufacturing, sale/backorder and return workflows. No
  replacement business engines were added in this increment.

Production installation completed on 2026-09-10 after a verified backup and
isolated restore. All six modules are installed and existing business, identity
and integration invariants passed. See `COMMUNITY-REPLIT-DEPLOYMENT.md` for the
release checks. Permission mapping, audit-rule configuration, quality workflow
integration and resource checks remain part of commissioning.

## Boundaries before adoption

- Negative-stock prevention has explicit product/category/location exceptions and
  a server context bypass in upstream code. Never expose arbitrary Odoo context
  through the MA2F command API. It does not by itself guarantee stock at order entry.
- Quality control is a generic inspection system. Automatic inspection creation
  and blocking of MA2F receipts/manufacturing still need a verified integration.
- Audit records identify the executing Odoo account. Original MA2F staff attribution
  must remain on the integration request; the technical user is not the human actor.
- Financial reports must be reconciled against actual MA2F balances and the required
  Senegal accounting outputs. A test fixture is not accounting acceptance.
- Source availability and a passing pilot do not establish future maintenance,
  production resource usage or an upgrade to a different Odoo commit.
- Existing historical sales are still archive records. Firebase remains the live
  business path until the separately documented cutover. Real invoice posting stays
  deferred pending the confirmed included tax rate.
