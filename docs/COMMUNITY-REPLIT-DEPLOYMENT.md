# Community extension deployment

Target: Replit `MA2F-Odoo-Core`, Odoo 19 Community. This release adds the
previously tested OCA negative-stock protection, audit logging, financial reports
and quality inspections, with their date-range and XLSX dependencies.

## Reproducible source

`deployment/odoo-core/community-release.json` pins repository commits, downloaded
archive hashes and extracted module hashes. `community_sources.py` installs only
the selected modules and verifies their contents at production startup. This
verification survives Replit's removal of nested Git metadata.

The existing Odoo source revision, restricted database role, designated accounts,
database-backed attachments and disabled cron/email configuration are preserved.
The development startup repairs made directly in Replit must not be overwritten
by an older local `start.py` or `start.sh`.

## Maintenance procedure

1. Run `community_maintenance.py backup` with the existing runtime connection at
   its hidden prompt. Never put the connection string in a command or source file.
2. Restore the custom-format archive into a separate, unpublished database and
   compare counts and digests. Do not restore over a live database for this test.
3. Publish the source and addon path. Leave Replit's development-to-production
   database copy option unchecked. Verify the **current** build ID and timestamp;
   the production card's log button may open the previous successful build.
4. Run `community_maintenance.py install`, then `verify`. Installation refuses
   changed business records, identities or integration settings since the backup.
5. Verify the published runtime loads the installed modules, and check the real
   historical sales view. Installing modules alone does not configure audit rules
   or connect automatic quality checks to MA2F commands.

Private backup archives and maintenance logs stay under `.local/` in Replit.
They contain business data and must not be committed or served as public assets.

## Verified recovery checkpoint, 2026-09-10

The pre-install archive is 13,769,019 bytes, SHA-256
`0c3c12b0d7bbda37b3a74dd06d1dd3dbd30e5d4c9a4fbed862a4838c54d3edc9`.
An isolated restore into `ma2f_community_restore_20260910` completed successfully;
all captured counts and digests matched. The database was not exposed through Odoo.
The temporary restore database was removed after verification; the private backup
and its verification evidence were retained.

At this checkpoint there are 1,048 historical sales and 262 contact records.
Native sales orders, invoices/journal entries, payments, stock movements, stock
quants and manufacturing orders each contain zero records. Those are separate
from the imported historical archive.

Local deployment tests: 24 passed. Remote Python compilation and shell syntax
checks passed. Live release verification is recorded below when complete.

Production module installation completed at 04:36 UTC: all six selected modules
report `installed`. Odoo loaded 83 modules and signaled its registry change.
Post-install verification confirmed unchanged business records, historical-row
digest, contact digest, user identities and integration configuration. No native
orders, invoices or stock entries were created by the deployment.

Build `35019ebc-f93f-4c7a-b391-52e0e65d95b7` published the verified sources.
A fresh request to `/odoo` reached the login page after the server restart;
existing browser sessions require login again. Final release
`4e59b1a6-80f7-423a-bf02-338caa39d74e` completed successfully at 04:40:23 UTC.
An independent public HTTP request after completion returned 200 and confirmed
the login form and password field. The published runtime logs for the preceding
release also confirmed the Community addon path, restricted production preflight
and successful loading of all 83 modules. The Reserved VM remains 0.5 vCPU / 2 GiB.

Browser checks after restarting reached the login page; authenticated inspection
of the new menus still requires the administrator to log in again. This is not a
claim that the new MA2F-to-Odoo order workflow or accounting cutover is complete.

## Remaining commissioning boundaries

Firebase remains authoritative until the account, authorization, final data-delta
and frontend cutover checks pass. The local-account choice replaces Clerk, with
private one-time setup/reset links delivered by an administrator.

The actual included tax rate remains unconfirmed. No rate, tax split, historical
invoice posting or live order synchronization is inferred from the test fixtures.
Production quantities remain net saleable packs of 30 sachets.
