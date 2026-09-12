# Private account setup and recovery

User decision: administrators provide private one-time links. No email service.

## Current state

The setup page, CLI and native authentication flow are published in Replit for
commissioning. Replit TypeScript and production build passed. The first private
administrator setup link was delivered through the browser; real sign-in remains
pending user action. No business profile is activated. The existing Firebase login remains active until the
business API, preserved permissions and final cutover are verified.

A replacement private setup link was opened in the browser September 10 at about
00:43 UTC (15-minute lifetime). No successful password setup or real native sign-in
has been confirmed. Do not interpret delivery as successful enrolment; issue another
link when the administrator is ready if the previous link has expired.

## Administrator procedure after commissioning

1. Verify the recipient's identity against the preserved MA2F account. Do not use
   an Odoo account or an email address alone to assign MA2F permissions.
2. In the MA2F Replit Shell, from `ma2f-next`, run:

   ```sh
   node --import tsx scripts/issue_local_setup_link.mjs --issue 'USER_EMAIL' /tmp/ma2f-setup-UNIQUE_NAME.json
   ```

   Replace the placeholders. Replit Secrets supply the database credentials and
   canonical HTTPS application origin. The tool refuses disabled, inactive,
   unverified or missing source identities. It never creates or activates a user.

3. Retrieve the URL from the private output file and give it directly to the
   verified recipient through a private channel. The file is created with mode
   `0600` and cannot overwrite an existing file. Do not paste the link into public
   tickets, screenshots, shared terminals or repository files. Delete that exact
   temporary file after private delivery.
4. The recipient opens the link and chooses a password of 12–128 characters.
   Links expire after 15 minutes and reject reuse. The token is carried in the
   URL fragment, removed from the address bar immediately, and submitted only to
   the same-origin password endpoint. Refreshing the page requires reopening the
   original unused link.
5. For forgotten passwords, repeat the same administrator procedure. A successful
   reset revokes existing native MA2F sessions. Initial setup or reset does not
   activate business access, change roles or grant direct Odoo access.

Public registration and public reset-link issuance remain closed. This procedure
depends on an administrator being available; users cannot recover access by email.

## Checks completed

- Issuance tests: preserved identity checks, exclusive private file, fragment URL,
  no token in status output, failure if delivery did not happen, no access changes.
- Native HTTP flow with a fictional memory-backed user: administrator issuance,
  password setup, replay rejection, login, commissioning profile, logout/revocation.
- Native recovery tests: expiry, password replacement and session revocation.
- Page checks: no-store, no-referrer, nonce-based CSP, no Firebase/Clerk dependency.
- Actual local browser with a disposable fictional user: token removed from the
  address bar, mismatched confirmation rejected, matching password saved successfully.

These tests do not establish a production browser login. The browser fixture uses
only disposable in-memory data and a localhost-only HTTP configuration. Production settings,
proxy rate limiting, secure delivery and role enforcement still require verification
before account activation and replacement of the existing login.
