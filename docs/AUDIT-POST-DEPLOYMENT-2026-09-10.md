# MA2F post-deployment audit — 2026-09-10

## Conclusion and scope

Odoo hosting is operational. The MA2F business cutover is not complete.
This audit inspected the local frontend/backend and deployment code, reconciled
the latest deployment evidence, refreshed the existing Odoo Sales tab, and ran
focused tests. It did not change production records, permissions or configuration.

The fresh public login request returned HTTP 200 with the expected login form.
Refreshing the Sales tab redirected to login: its old displayed samples were not
fresh evidence of the current database. Authenticated menus were not re-audited.
Production counts and module states below are the last deployment checkpoint,
not a new direct SQL census. The Aquasachets deployed source/settings were not
independently compared against this checkout in this audit.

## Findings, in priority order

1. **MA2F is still dependent on Firebase.** `client/src/App.tsx`,
   `contexts/AppContext.tsx` and `lib/firebase.ts` retain Firebase login/data paths;
   Firebase and Clerk remain package dependencies. Better Auth is prepared in
   `server/localAuth.ts`, but preparation is not account activation or frontend
   cutover. Keep Firebase until the replacement passes real end-to-end checks.
2. **New orders do not yet have a commissioned native Odoo lifecycle.**
   `server/orderRoutes.ts` requires three explicit enable flags. The documented
   gateway is not live. `addons/ma2f_core/models/orders.py` creates only a draft,
   explicitly returning `stockReserved: false` and `invoicePosted: false`.
   Confirmation, reservation, delivery, returns and payments need scoped native
   workflow integration; a queued response is not confirmation of available stock.
3. **History is preserved, not operationally replayed.** Last verified checkpoint:
   1,048 historical sales, 262 contacts, zero native orders, journal entries,
   payments, stock movements, quants and manufacturing orders. History does not
   automatically contribute to native Sales/accounting reports. Its recorded total
   is preserved; tax allocation/posting remains deferred pending the actual rate.
4. **Installed extensions still need commissioning.** Negative-stock protection,
   auditlog, financial reports and quality inspections are installed with two
   dependencies. Audit rules, administrator menu/role access, and automatic quality
   triggers/blocking are not established by installation alone. OCA tests from the
   isolated pilot do not establish the complete live MA2F workflow.
5. **Availability differs from synchronization.** `server/odooHealth.ts` probes
   `/web/login`. The UI correctly describes server availability, but has no evidence
   here of business API readiness, queue backlog or last successful order/stock
   synchronization. Expose those separately before staff depend on integration.
6. **Operational readiness is incomplete.** Production startup disables cron;
   scheduled Odoo tasks cannot be assumed to run. Sessions use a temporary data
   directory, consistent with restart logout. A manual backup/restore passed, but
   automated retention, recurring restore checks and sustained load capacity on
   the 0.5 vCPU / 2 GiB server have not been verified by this audit.
7. **Status records have drifted.** `MIGRATION-CURRENT-STATUS.md` has older pending
   hosting/admin items superseded by later records. Use the latest Community
   deployment and Firebase-exit checkpoints, with this audit's scope limitations.

## Next execution sequence and acceptance evidence

1. Reconcile Aquasachets deployed code/config with the local source, and consolidate
   one current release checklist. Re-login to Odoo and verify real-data navigation
   and extension access. No full-source overwrite without comparison.
2. Configure real product/customer/location mappings, packs of 30 sachets, actual
   material consumption/BOM and opening balances. Production input remains net
   saleable packs. Do not infer missing values or double-count opening stock and
   historical stock replay. Configure scoped audit rules and quality workflows.
3. Commission backend-owned accounts and preserved role/action permissions using
   private one-time links. Test enrolment, expiry, reuse rejection, login/logout,
   reset and revocation against the deployed backend, including after restart.
4. Prove one complete order-to-delivery path in an isolated test environment,
   through the MA2F interface: durable command, native Odoo draft/confirmation,
   reservation, delivery and returned status. Test duplicate submission, timeout
   after commit, competing reservations, insufficient stock and unauthorized users.
   Use confirmed tax configuration before real order/invoice activation; no test
   rate becomes the real rate. Reuse Odoo's native operations.
5. Reconcile the final source delta and historical imports, preserving amounts and
   source anomalies. Switch each operation's writer and reader together. Complete
   remaining uploads/functions/realtime/reporting dependencies, then prove the
   whole app works with Firebase unavailable before removing Firebase/Clerk SDKs.
6. Verify scheduled jobs, backup retention/recovery, monitoring and capacity before
   declaring production commissioning complete. Enable only intended jobs after
   reviewing their effects; the neutralization banner is not itself a defect.

## Checks run in this audit

- 24 deployment Python tests passed.
- 10 Node tests passed: health probe, local authorization, order HTTP boundaries,
  dispatch validation, lost-response retry, revoked users and queue filtering.
- Fresh public Odoo login returned HTTP 200 and rendered its form.
- No production test orders, stock entries or tax postings were created.
