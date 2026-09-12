# Draft-order connection — prepared, not live

The current Firebase screen remains authoritative and does not submit to this API.
Nothing in this increment migrates historical sales into native orders.

The built Express backend now mounts `POST /api/odoo-orders` and
`GET /api/odoo-orders/:requestId`. A verified native account with preserved
`commandes/create` permission submits `{requestId, customerId, packs,
unitPriceIncludedFCFA}`. `customerId` is a validated native Odoo contact ID; source
name matching must not be guessed. The request ID is a stable UUID retained for
retries. Actor identity comes from the native session, and tax ID comes from server
configuration. Foreign origins, extra fields and invalid quantities are rejected.

POST returns 202 for a durably queued request. This is NOT order confirmation.
The owner can poll GET; only a validated native receipt completes the queue entry.
Unconfirmed outcomes retry the identical UUID. Operation-filtered claims keep the
production worker from consuming order jobs and vice versa. Authorization is
rechecked before dispatch. Repeated failures enter the existing review state.

Odoo's bounded `ma2f.core.operation.record_order` requires the dedicated gateway
group. The identity has no generic order/stock/invoice creation ACL. The method
serializes requests, verifies native customer/product/company/currency/tax/pricelist
configuration, and creates a draft in a savepoint. Native calculated gross total
must equal quantity times recorded gross unit price. No confirmation, delivery,
stock reservation, payment or invoice posting is performed.

## Configuration still required for commissioning

- Install the tested addon in the production runtime with durable addon paths;
  production currently does not load it.
- Finish native-account activation, runtime database provisioning and customer-ID
  mapping before connecting the MA2F order form. The main UI still uses Firebase.
- Confirm the real tax treatment. Configure `ma2f.integration.sale_tax_id` with an
  active, positive, price-included sales tax for MA2F, and
  `ma2f.integration.sale_pricelist_id` with an active company-owned XOF pricelist.
  No rate is inferred, including zero. The test's 18% is fictional.
- Set native `ma2f.integration.orders_enabled=true` only after commissioning checks.
  MA2F needs `MA2F_LOCAL_AUTH_ENABLED`, `MA2F_RUNTIME_ENABLED` and
  `MA2F_ODOO_ORDERS_ENABLED` enabled, a separate `ODOO_COMMAND_API_KEY`, and
  `MA2F_ODOO_SALE_TAX_ID`. Defaults keep the endpoint closed.
- Connect the frontend to server-owned mapping and status, remove its Firebase order
  write path at cutover, and test an actual authenticated end-to-end request/retry.
- Add native confirmation and stock reservation as a separate command before
  claiming that accepted drafts guarantee available inventory.

## Verification

Native Odoo/PostgreSQL rollback tests passed on `ma2f_core_test`: exact 4,200 FCFA
gross total with an included tax, same-ID replay, conflicting replay rejection,
invalid quantities, missing/exclusive tax rejection, inactive customer, disabled
gateway, public-user denial, native creation failure rollback and no stock/invoice
side effects. The first test exposed dependence on the default pricelist currency;
the command now requires an explicit company-owned XOF pricelist.

Eight HTTP/worker tests passed, including native-session/role/origin boundaries,
server-selected tax, receipt mismatch/size checks, simulated lost-response recovery,
and revoked-user rejection. The PostgreSQL queue script was extended for operation
filtering; that additional development-database test has not been run in this increment.
