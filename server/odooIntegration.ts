/** Server-only, read-only commissioning checks. Never a generic Odoo proxy. */
export class IntegrationError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}

type Config = { origin: string; database: string; key: string; companyId: number };
export function integrationConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { ODOO_API_KEY: key, ODOO_DATABASE: database, ODOO_COMPANY_ID: company } = env;
  if (!key || !database || !company) throw new IntegrationError("integration_not_configured");
  let url: URL;
  try { url = new URL(env.ODOO_BASE_URL || "https://ma2f-odoo-mamdou025.replit.app"); }
  catch { throw new IntegrationError("integration_configuration_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || !/^[a-zA-Z0-9_-]+$/.test(database) ||
      !/^[1-9][0-9]*$/.test(company) || !Number.isSafeInteger(Number(company))) {
    throw new IntegrationError("integration_configuration_invalid");
  }
  return { origin: url.origin, database, key, companyId: Number(company) };
}

export function createIntegrationReader(fetcher: typeof fetch = fetch, env = process.env) {
  return async function inspect() {
    const config = integrationConfig(env);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // Fixed model, method, fields and company; callers supply no RPC parameters.
      const response = await fetcher(`${config.origin}/json/2/res.company/search_read`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${config.key}`, "X-Odoo-Database": config.database,
          "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ domain: [["id", "=", config.companyId]], fields: ["id", "name"],
          limit: 1, context: { allowed_company_ids: [config.companyId] } }),
      });
      if ([401, 403].includes(response.status)) throw new IntegrationError("odoo_credentials_or_permissions_rejected");
      if (!response.ok) throw new IntegrationError("odoo_api_unavailable");
      // Bound upstream data and never forward its error messages/tracebacks.
      const reader = response.body?.getReader();
      if (!reader) throw new IntegrationError("odoo_response_invalid");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16_384) { await reader.cancel(); throw new IntegrationError("odoo_response_invalid"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(result) || result.length !== 1 || result[0]?.id !== config.companyId ||
          typeof result[0]?.name !== "string" || !result[0].name.trim()) {
        throw new IntegrationError("odoo_company_not_accessible");
      }
      return { apiAuthenticated: true, companyVerified: true, checkedAt: new Date().toISOString(),
        businessWritesEnabled: false, stockMappingVerified: false };
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError("odoo_api_unavailable");
    } finally { clearTimeout(timer); }
  };
}
