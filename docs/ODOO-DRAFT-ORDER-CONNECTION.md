# Draft-order connection — prepared, not live

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

- Install the addon with durable production addon paths.
- Provision the runtime queue database, activate verified native accounts with
  preserved permissions, and finish native customer-ID mapping.
- Configure a company-owned XOF `ma2f.integration.sale_pricelist_id`.
- Commission the separate command credential and gated order flags. There is no
  `MA2F_ODOO_SALE_TAX_ID` or `ma2f.integration.sale_tax_id` requirement.
- Connect the frontend and verify an authenticated end-to-end request and retry.
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
