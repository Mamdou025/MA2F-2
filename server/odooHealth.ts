import type { IncomingMessage, ServerResponse } from "node:http";

export type OdooHealth = { connected: boolean; checkedAt: string };

// This checks the database-backed login page, not business API permissions.
export function createOdooProbe(fetcher: typeof fetch = fetch, now = Date.now) {
  let cached: OdooHealth | undefined;
  let pending: Promise<OdooHealth> | undefined;
  return function probe(): Promise<OdooHealth> {
    if (cached && now() - Date.parse(cached.checkedAt) < 15_000) return Promise.resolve(cached);
    if (pending) return pending;
    pending = (async () => {
      let connected = false;
      try {
        const base = new URL(process.env.ODOO_BASE_URL || "https://ma2f-odoo-mamdou025.replit.app");
        if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid Odoo origin");
        const response = await fetcher(new URL("/web/login", base), {
          signal: AbortSignal.timeout(6000), redirect: "error",
          headers: { Accept: "text/html" },
        });
        const html = await response.text();
        connected = response.ok && /name=["']login["']/.test(html) && /name=["']password["']/.test(html);
      } catch { /* Return a sanitized availability result; never expose connection details. */ }
      cached = { connected, checkedAt: new Date(now()).toISOString() };
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

const probe = createOdooProbe();
export async function odooHealthHandler(_req: IncomingMessage, res: ServerResponse) {
  const result = await probe();
  res.writeHead(result.connected ? 200 : 503, {
    "Content-Type": "application/json", "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(result));
}
