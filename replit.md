# MA2F migration context

Read `CLAUDE.md`, `docs/REPLIT-MIGRATION.md`, and the Odoo audit in `docs/` before changing architecture.

The user wants MA2F (water sachets only) on Replit while retaining a protected Odoo Community management service and an independently changeable free-feature service. One saleable pack contains 30 sachets. Entered production is net saleable output AFTER manufacturing rejects are removed. Do not deduct rejects twice.

The root `.replit` is a transitional web-app configuration: Node 22, pnpm, `dev:replit`, `build:replit`, and `start`. The Replit Vite configuration omits Manus runtime/debug/storage-proxy plugins. The current React app STILL uses Firebase Auth, Firestore, Storage and Functions. Importing or publishing this repository does not migrate data or users. Do not remove Firebase until the replacement pathways and migration have been verified.

The Python/Odoo code in `pilot/` is a LOCAL fictitious test environment, not a Replit production deployment. It has native and live HTTP acceptance tests. Never upload `pilot/.local/`, its keys, database archives or restore fixtures. Never expose its static gateway tokens to a browser. Do not run Docker Compose from the root Replit deployment.

Keep Odoo and free features in separate deployments and separate databases/credentials. Do not give the free-feature app direct SQL access to Odoo. Replit publishing filesystem persistence must be addressed before hosting Odoo attachments. Odoo runtime, PostgreSQL compatibility and restore tests must pass on Replit itself before claiming that all services are hosted there.

The user has postponed selecting the only human administrator allowed direct Odoo access. Do not infer that every MA2F administrator should receive direct Odoo access. Full Firebase replacement is explicitly requested while preserving the same business accounts, roles, active/disabled state and per-section restrictions. Use the NEW local version as the source, not the old Aquasachets Replit version. Identity-provider provisioning remains pending, not an invitation to implement passwords or cryptographic token validation from scratch.
