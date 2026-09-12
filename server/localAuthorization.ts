import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { LocalAuthRuntime } from './localAuth';
import { canLocalAction, loadLocalProfile } from './localProfile';

export function requireLocalAction(runtime: LocalAuthRuntime, section: string, action: string): RequestHandler {
  return async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const session = await runtime.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) { res.status(401).json({ error: 'authentication_required' }); return; }
      const profile = await loadLocalProfile(runtime.pool, session.user);
      if (!canLocalAction(profile, section, action)) { res.status(403).json({ error: 'business_permission_required' }); return; }
      res.locals.ma2f = { userId: session.user.id, profile };
      next();
    } catch { res.status(503).json({ error: 'local_authorization_unavailable' }); }
  };
}
