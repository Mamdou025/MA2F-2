# Draft-order connection — production commissioning

## September 12–13 commissioning work

The French `/api/odoo-orders/workspace` screen is linked from Commandes. It
requires native MA2F authentication and preserved order permission. Its customer
selector uses imported native Odoo contact IDs. A submitted request is retained
per account in browser storage; recovery reuses the same UUID. This screen does
not also create a Firebase order or confirm/reserve/deliver/invoice the Odoo draft.

The addon installed successfully in the isolated database and passed the native
rollback tests, including customer selection, exact no-tax totals and replay.
Replit MA2F passed six focused tests, TypeScript and its production build; Odoo
passed its deployment/access tests. Production addon installation preserved all
existing business and identity records. The separate queue role passed actual
SELECT/INSERT/UPDATE checks, denied DELETE, and rolled back its test row.

Production backup: 14,581,565 bytes, SHA-256
`fc6282904662bdb4015b80f4f0ad59190b0260db7600ac45b2c0fb80cd2620ed`.
It contained 262 contacts and 1,048 imported history rows, with zero native sales,
invoices, payments, stock movements/quants or manufacturing orders.

Gateway identity 12 (`ma2f.orders`) is active with a separate key expiring
October 13, 2026; rotate before expiry. No generic sale/account/stock/MRP write
ACL is granted. The orders flag is enabled; stock/production remain disabled.
Odoo publication `07482efe-e26b-4217-9249-980f8ef85ed5` and MA2F publication
`21adab9e-c267-4a83-b56d-cd30a1358600` completed. Existing deployment sizing and
databases were preserved; development database copying stayed unchecked.

Live checks around September 13, 03:47 UTC: Odoo `/web/health` passes, MA2F
`/api/healthz` reports alive, `/api/odoo-health` reports connected, the French
workspace returns 200, and anonymous customer access returns 401. The dedicated
gateway's native customer RPC returned 200 and 255 eligible customers with TLS
verification enabled (Python requests needed the system CA bundle).

The preserved human account still has no native password and remains inactive.
A private setup page is open for the owner; no password may be chosen for them.
After setup, apply `scripts/activate_order_profile.mjs` to that preserved account,
have the owner sign in, and verify a draft request and retry. No live quotation
has been created yet. These deployment checks are not end-to-end acceptance.

## Owner decision, September 12, 2026

Taxes are calculated outside Odoo. Do not configure a tax rate or sales-tax
parameter for this integration. This supersedes earlier included-tax assumptions.

The Express API accepts `{requestId, customerId, packs, unitPriceFCFA}` at
`POST /api/odoo-orders`. Amounts are plain FCFA; native totals must equal packs
 times unit price. The worker and native addon accept no tax ID. Native order
lines explicitly clear inherited taxes and must have zero tax. The receipt
reports `totalFCFA`. Old tax-bearing queue payloads require review; they are never
silently converted or repriced. Deploy both sides before enabling the gateway.

The verified native session supplies actor identity and preserved commandes/create
permission. Stable request UUIDs provide retry protection. Foreign origins, extra
fields, invalid quantities and mismatched receipts are rejected. POST 202 means
queued, not confirmed; the owner polls GET /api/odoo-orders/:requestId.

The bounded native RPC requires its dedicated gateway group, validates native
company/customer/product/currency/pricelist, serializes requests, and creates only
a draft in a savepoint. The gateway has no generic order/stock/invoice creation
ACL. Drafts do not reserve stock or post invoices/payments.

## Commissioning still required

- Complete the owner's password setup and activate only the preserved account.
- Verify an authenticated end-to-end request, exact no-tax total and retry.
  The current main business UI remains on Firebase.
- Obtain physical factory/truck counts before stock cutover. Draft-order tests
  do not establish inventory readiness.

## Verification

Local native Odoo/PostgreSQL rollback tests passed: 4,200 FCFA with no tax even
when the test product has an inherited fictional tax,
same-ID replay, conflicting replay rejection, invalid input, customer/gateway
restrictions, creation-failure rollback and no stock/invoice effects. Focused
HTTP/worker tests and TypeScript checks passed. These validate source, not live
end-to-end order activation. Replit MA2F source was updated with the four reviewed
connector/test files; five focused tests, TypeScript and build passed remotely.
It has not been republished, and the production Odoo addon remains uncommissioned.

French is installed and active for the human Odoo account; standard invoice,
sales, inventory, manufacturing and settings screens were verified in French.
