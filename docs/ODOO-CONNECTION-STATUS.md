# Odoo availability indicator

The Odoo status button sits below Sync in the sidebar. A shared provider outside the application router polls once and displays a global warning only on failure, including on login and Clerk verification screens. The healthy state no longer occupies a top bar. A green dot means the Odoo login page responds successfully and contains its login/password form. This does not verify business API credentials, synchronization, or business permissions.

The browser checks GET /api/odoo-health every 30 seconds while visible, on returning to the page, and on reconnecting to the internet. The Verify button also requests a check. An unavailable or unverifiable connection displays a persistent red warning, which clears automatically after recovery.

When the mobile sidebar is closed, the same status control appears as a compact floating button at the bottom left, above the device safe area. Opening the sidebar hides that floating control; the status remains below Sync. Both use the same provider and polling loop. Desktop keeps the status inside its visible sidebar.

The server probes /web/login with a six-second timeout, caches results for 15 seconds, and shares concurrent probes. Optional server variable ODOO_BASE_URL overrides the default https://ma2f-odoo-mamdou025.replit.app. Use an HTTPS origin without credentials. No Odoo credentials are exposed to the browser.

Both the Vite development middleware and Express production server implement the endpoint. Rebuild and republish Aquasachets to make source changes available on its published URL; preview updates alone do not update production.

Validation: TypeScript check, build:replit, and node --import tsx --test tests/odooHealth.test.mjs. Tests cover cache expiry, concurrent checks, failure/recovery, network errors, and HTTP 200 maintenance pages.
