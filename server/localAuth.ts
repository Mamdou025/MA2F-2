import { betterAuth, type BetterAuthOptions } from "better-auth";
import { Pool } from "pg";

/** Deliberately separate from Odoo's DB and from the existing Firebase runtime. */
export function localAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.MA2F_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("MA2F auth secret is missing or too short");
  let origin: URL, database: URL;
  try {
    origin = new URL(env.MA2F_AUTH_ORIGIN || "");
    database = new URL(env.MA2F_AUTH_DATABASE_URL || "");
  } catch { throw new Error("MA2F auth origin/database configuration required"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("MA2F auth requires an exact HTTPS origin");
  }
  const name = decodeURIComponent(database.pathname.slice(1));
  if (database.protocol !== "postgresql:" || !database.hostname || !database.username || !database.password || database.hash ||
      !name || name !== env.MA2F_AUTH_DATABASE_NAME || /odoo|pilot/i.test(name) ||
      Array.from(database.searchParams).some(([k, v]) => k !== "sslmode" || v !== "verify-full")) {
    throw new Error("MA2F auth requires an explicitly named non-Odoo PostgreSQL database with verified TLS");
  }
  // pg connection-string SSL options can override the explicit TLS settings.
  database.search = "";
  return { origin: origin.origin, secret, database: database.toString() };
}

export function localAuthOptions(config: ReturnType<typeof localAuthConfig>, database: BetterAuthOptions["database"]) {
  return {
    appName: "MA2F", baseURL: config.origin, basePath: "/api/local-auth",
    secret: config.secret, database, trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12,
      maxPasswordLength: 128, autoSignIn: false, resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60,
      cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    advanced: { useSecureCookies: true, cookiePrefix: "ma2f", defaultCookieAttributes: {
      httpOnly: true, secure: true, sameSite: "lax",
    } },
    // No cloud auth provider, public registration, role field or mail transport.
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

export function createLocalAuth(env: NodeJS.ProcessEnv = process.env) {
  const config = localAuthConfig(env);
  const pool = new Pool({ connectionString: config.database, ssl: { rejectUnauthorized: true },
    options: "-c search_path=ma2f_auth", max: 5, connectionTimeoutMillis: 8000 });
  const auth = betterAuth(localAuthOptions(config, pool));
  return { auth, pool };
}

export type LocalAuthRuntime = ReturnType<typeof createLocalAuth>;
