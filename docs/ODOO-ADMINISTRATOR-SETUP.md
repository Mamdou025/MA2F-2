# Direct Odoo administrator setup

The user confirmed `fallmamadou151@gmail.com` as the sole direct human Odoo administrator on September 9, 2026. This does not grant a new MA2F/Firebase/Clerk role or activate the business integration.

The production Odoo account is ID 6, tracked by `ma2f_access.designated_admin`. It was prepared inactive using the native ORM, with a random unknown password and no invitation email. Creating it directly inactive triggered Odoo's linked-contact archive check; that transaction rolled back. The successful preparation creates and deactivates the user in one transaction, exposing no active account before commit.

`integration_access.py` permits this administrator only when `ODOO_ADMIN_USER_ID=6`, the exact confirmed login and marker match, and the administration group is present. It continues to reject unexpected active internal users. The optional read-only integration user remains a separate identity. Twenty-one deployment policy tests passed locally. The administrator policy was also checked against the real production schema by temporarily activating ID 6 inside a transaction and rolling it back.

`setup_designated_admin.py prepare` is guarded and reuses the marked account. `activate` must run only after the matching startup policy and ID setting are published and verified. It enables the designated user and prepares a native reset link in a private temporary file, without emailing or printing it. The user sets their own password on Odoo's published HTTPS page. Reset links, runtime URIs and passwords must never be committed or included in reports.

During provisioning, an initial shell-input mistake echoed the old runtime URI. The database role password was rotated; the replacement connection passed and the old credential was rejected. The replacement was staged in Replit's production secrets for the next publication. Temporary runtime credentials must be removed after the account setup completes.

Deployment `b2b4a44d` served the production login successfully after publication. The saved production setting `ODOO_ADMIN_USER_ID=6` was verified. Native activation completed for account 6, and the production startup preflight passed again against the active account. Business data was not changed.

The native password reset form was opened on the published HTTPS host for the user to choose and confirm their password. Successful sign-in remains pending user action. The page currently identifies the database as neutralized (outbound email remains disabled); account access does not complete business integration or email configuration.

The replacement runtime credential is deployed; its predecessor is revoked. Temporary setup credential and reset-link files were removed after opening the form.
