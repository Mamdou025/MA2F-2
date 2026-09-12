# Odoo business connection — commissioning checkpoint

Latest identity decision: self-hosted Better Auth/PostgreSQL replaces Clerk as the
target MA2F identity provider. See `FIREBASE-EXIT.md`. Existing Clerk commissioning
routes remain transitional and are not a business authorization path. The designated
human Odoo administrator is now active (see `ODOO-ADMINISTRATOR-SETUP.md`); the
technical integration identity and live business writes remain unactivated.

## Implemented on September 9, 2026

GET `/api/odoo-integration/connection` is a read-only API diagnostic behind Clerk authentication. It re-fetches the user's current server profile and requires a verified, mapped MA2F administrator. It does not activate business access or designate a direct Odoo administrator. The public availability dot remains separate.

Server configuration: `ODOO_BASE_URL` (HTTPS origin), `ODOO_DATABASE`, `ODOO_COMPANY_ID`, `ODOO_API_KEY`. None may be exposed as VITE variables. The fixed JSON-2 company read verifies the API credential and its company access. It does not prove stock permissions or product mappings; the response explicitly keeps `stockMappingVerified` and `businessWritesEnabled` false. Requests cannot choose a model, method, company or context. Unknown operations and writes are refused. Timeouts, permission failures and oversized/malformed responses are sanitized.

The endpoint is installed in the Express production server and both Vite configurations. Unit/HTTP tests cover authentication, revoked accounts, client-role injection, company mismatch, invalid credentials, malformed responses and configuration. These checks do not constitute a live Odoo workflow test.

## Discovered prerequisites

1. The published Odoo launcher requires **zero active internal accounts**. A replacement policy is now prepared in `deployment/odoo-core/integration_access.py` and the Odoo Replit source, with seven new policy tests (15 total deployment tests). The default still permits no active internal accounts. Opt-in `ODOO_INTEGRATION_USER_ID` permits only the matching `ma2f.integration` account, with a trusted `ma2f_integration.reader_user` record, no administrator groups, and no stock/MRP write ACLs. This source change is not published or activated. Before activation, verify it against the real Odoo schema and update the standalone production preflight report to reflect the new policy. Provision the technical user inactive, then publish with its explicit ID before activating it. Direct human administrator access and production write access need separate policies.
2. The existing production addon deliberately runs only against `ma2f_pilot`, with fictional product references and a test actor. Do not remove that database guard or reuse those references for production. A separately configured production service and audited identity propagation are still required.
3. `ProductionSection.tsx` computes plastic consumption as packs divided by `DB.params.tauxSachetsParKg` (fallback 17). That is estimated consumption, not measured batch consumption. Preserve the source value and establish the intended future rule before creating real manufacturing movements.
4. Product/location mappings, lots, durable pending commands, end-to-end authorization, duplicate-safe retries and cutover of Firebase writers remain unactivated. The API diagnostic alone does not complete these tasks.

## Next sequence

Verify and publish the prepared technical-account startup policy and provision the dedicated integration account; store its API key in MA2F server secrets; run the authenticated diagnostic. Configure verified products/locations and the production consumption rule, then exercise receipt → 100 net packs (3,000 saleable sachets) → delivery in an isolated test database. Check timeouts after commit and exact UUID replay before any real-data cutover. Do not alter source discrepancies or infer missing defect counts.

Replit verification this turn: TypeScript and production build passed; 32 existing pilot gateway tests passed. A temporary Express listener using the real new router returned 401 for unauthenticated diagnostics and 405 for production/unknown operations, all with no-store. It was stopped afterward. MA2F workspace configuration lacks ODOO_API_KEY, ODOO_DATABASE and ODOO_COMPANY_ID; the reader returns integration_not_configured. This is not a successful live authenticated Odoo connection. The new 11 diagnostic tests and seven account-policy tests are retained locally; remote source transfer used guarded replacements preserving existing files. No live stock records or account grants changed.

Protocol reference: [Odoo 19 JSON-2 API](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html). The project hosts Odoo Community itself on Replit.
