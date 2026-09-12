import express from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createLocalAuth, type LocalAuthRuntime } from "./localAuth";
import { localAccountPage } from './localAccountPage';
import { loadLocalProfile, localSections } from './localProfile';
import { localLoginPage } from './localLoginPage';

/** Commissioning only: authenticating here does not authorize legacy or Odoo writes. */
export function localAuthRouter(env: NodeJS.ProcessEnv = process.env, runtime?: LocalAuthRuntime) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  if (env.MA2F_LOCAL_AUTH_ENABLED !== "true") {
    router.use((_req, res) => { res.status(503).json({ error: "local_auth_not_enabled" }); });
    return router;
  }
  const { auth, pool } = runtime || createLocalAuth(env);
  router.get('/setup', localAccountPage);
  router.get('/login', localLoginPage);
  router.get("/profile", async (req, res) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) { res.status(401).json({ error: "authentication_required" }); return; }
      const profile = await loadLocalProfile(pool, session.user);
      res.json({ authenticated: true, user: { id: session.user.id, email: session.user.email, name: session.user.name },
        ...profile, sections: localSections(profile) });
    } catch { res.status(503).json({ error: "local_auth_unavailable" }); }
  });
  // Only the administrator CLI issues setup tokens; public issuance stays closed.
  const allowed = new Set(["GET /ok", "GET /get-session", "POST /sign-in/email", "POST /sign-out", "POST /reset-password"]);
  const handler = toNodeHandler(auth);
  router.use((req, res, next) => {
    if (!allowed.has(`${req.method} ${req.path}`)) {
      res.status(404).json({ error: "local_auth_operation_not_enabled" }); return;
    }
    Promise.resolve(handler(req, res)).catch(next);
  });
  router.use(((error, req, res, next) => {
    if (res.headersSent) { next(error); return; }
    res.status(503).json({ error: "local_auth_unavailable" });
  }) as express.ErrorRequestHandler);
  return router;
}
