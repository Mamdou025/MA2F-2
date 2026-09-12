import express, { type RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { createLocalAuth, type LocalAuthRuntime } from './localAuth';
import { loadLocalProfile, type LocalProfile } from './localProfile';
import { createIntegrationReader, IntegrationError } from './odooIntegration';

// Read-only commissioning diagnostic. Business activation is deliberately separate.
export function integrationDiagnosticHandler(deps: {
  profile: (req: Parameters<RequestHandler>[0]) => Promise<LocalProfile | null>;
  inspect: ReturnType<typeof createIntegrationReader>;
}): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const profile = await deps.profile(req);
      if (!profile) { res.status(401).json({ error: 'authentication_required' }); return; }
      if (!profile.mapped || !profile.accountEligible || !profile.roles.includes('admin')) {
        res.status(403).json({ error: 'verified_administrator_required' }); return;
      }
      res.json(await deps.inspect());
    } catch (error) {
      res.status(error instanceof IntegrationError ? error.status : 503).json({
        error: error instanceof IntegrationError ? error.code : 'identity_or_integration_unavailable',
        businessWritesEnabled: false,
      });
    }
  };
}

export function odooIntegrationRouter(env: NodeJS.ProcessEnv = process.env, runtime?: LocalAuthRuntime) {
  const router = express.Router();
  if (env.MA2F_LOCAL_AUTH_ENABLED !== 'true') {
    router.use((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'local_auth_not_enabled', businessWritesEnabled: false });
    });
    return router;
  }
  const local = runtime || createLocalAuth(env);
  router.get('/connection', integrationDiagnosticHandler({
    profile: async req => {
      const session = await local.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      return session ? loadLocalProfile(local.pool, session.user) : null;
    },
    inspect: createIntegrationReader(undefined, env),
  }));
  router.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'integration_operation_not_enabled', businessWritesEnabled: false });
  });
  return router;
}
