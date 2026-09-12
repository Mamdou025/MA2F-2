import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Status = "checking" | "connected" | "unreachable" | "unknown";

const ConnectionContext = createContext<{ status: Status; busy: boolean; checkedAt?: string; check: () => Promise<void> } | null>(null);

export default function OdooConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string>();
  const active = useRef<AbortController | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const check = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("/api/odoo-health", { signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      const age = Date.now() - Date.parse(data.checkedAt);
      if (typeof data.connected !== "boolean" || !Number.isFinite(age) || age < -30_000 || age > 60_000 ||
          response.status !== (data.connected ? 200 : 503)) throw new Error("Invalid health response");
      if (active.current === controller) {
        setStatus(data.connected ? "connected" : "unreachable");
        setCheckedAt(data.checkedAt);
      }
    } catch {
      if (active.current === controller) { setStatus("unknown"); setCheckedAt(undefined); }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }, []);

  useEffect(() => {
    const refresh = () => { if (!document.hidden) { setStatus("checking"); void check(); } };
    const offline = () => { active.current?.abort(); active.current = null; setBusy(false); setStatus("unknown"); setCheckedAt(undefined); };
    void check();
    const timer = window.setInterval(() => { if (!document.hidden) void check(); }, 30_000);
    window.addEventListener("offline", offline);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer); active.current?.abort(); active.current = null;
      window.removeEventListener("offline", offline); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [check]);

  const failed = status === "unreachable" || status === "unknown";

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--odoo-status-height", `${bar.current?.offsetHeight || 0}px`);
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--odoo-status-height", `${bar.current?.offsetHeight || 0}px`);
    });
    if (bar.current) observer.observe(bar.current);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--odoo-status-height"); };
  }, [failed]);

  return (
    <ConnectionContext.Provider value={{ status, busy, checkedAt, check }}>
      {failed && <div ref={bar} role="alert" className="fixed inset-x-0 top-0 z-[100] border-b border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
        {status === "unreachable" ? "Le serveur Odoo ne répond pas correctement. Sa disponibilité sera vérifiée automatiquement." : "Impossible de vérifier la connexion à Odoo. Vérifiez votre connexion Internet ou réessayez."}
      </div>}
      {children}
    </ConnectionContext.Provider>
  );
}

export function OdooConnectionButton() {
  const connection = useContext(ConnectionContext);
  if (!connection) return null;
  const { status, busy, checkedAt, check } = connection;
  const failed = status === "unreachable" || status === "unknown";
  const label = status === "connected" ? "Serveur Odoo disponible" : failed ? "Serveur Odoo indisponible" : "Vérification Odoo…";
  return (
    <button type="button" onClick={() => void check()} disabled={busy}
      aria-label={`${label} — vérifier la connexion`} aria-busy={busy}
      title={checkedAt ? `Serveur vérifié à ${new Date(checkedAt).toLocaleTimeString()}. Cliquer pour vérifier. Ne vérifie pas la synchronisation métier.` : "Vérifier la disponibilité du serveur Odoo"}
      className="mt-1.5 flex w-full items-center gap-2 rounded-md bg-white/[0.04] px-2.5 py-2 text-left text-[11px] text-sidebar-foreground/70 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-wait">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${status === "connected" ? "bg-emerald-400" : failed ? "bg-red-400" : "bg-amber-400"}`} />
      <span role="status" aria-live="polite" className="flex-1">{label}</span>
      <span aria-hidden="true" className={busy ? "animate-spin" : ""}>↻</span>
    </button>
  );
}
