import { useState, useMemo, useRef, useEffect } from "react";
import { useApp } from "@/contexts/AppContext";
import { Input } from "@/components/ui/input";
import { Search, User, Users, Phone, X } from "lucide-react";

interface SearchResult {
  type: "client" | "utilisateur" | "commercial" | "livreur";
  nom: string;
  tel: string;
  extra?: string;
}

export function GlobalSearch() {
  const { DB } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fermer le dropdown quand on clique en dehors
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const matches: SearchResult[] = [];

    // Recherche dans les clients
    DB.clients.forEach((c) => {
      if (
        c.nom.toLowerCase().includes(q) ||
        (c.tel && c.tel.includes(q))
      ) {
        matches.push({ type: "client", nom: c.nom, tel: c.tel || "", extra: c.zone || c.type || "" });
      }
    });

    // Recherche dans les utilisateurs
    DB.users.forEach((u) => {
      if (
        u.nom.toLowerCase().includes(q) ||
        (u.tel && u.tel.includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
      ) {
        matches.push({ type: "utilisateur", nom: u.nom, tel: u.tel || "", extra: u.email || "" });
      }
    });

    // Recherche dans les commerciaux
    DB.commerciaux.forEach((c) => {
      if (
        c.nom.toLowerCase().includes(q) ||
        (c.tel && c.tel.includes(q))
      ) {
        matches.push({ type: "commercial", nom: c.nom, tel: c.tel || "", extra: "" });
      }
    });

    // Recherche dans les livreurs
    if (DB.livreurs) {
      DB.livreurs.forEach((l) => {
        if (
          l.nom.toLowerCase().includes(q) ||
          (l.tel && l.tel.includes(q))
        ) {
          matches.push({ type: "livreur", nom: l.nom, tel: l.tel || "", extra: "" });
        }
      });
    }

    return matches.slice(0, 10);
  }, [query, DB]);

  const typeLabel = (type: string) => {
    switch (type) {
      case "client": return "Client";
      case "utilisateur": return "Utilisateur";
      case "commercial": return "Commercial";
      case "livreur": return "Livreur";
      default: return type;
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case "client": return "bg-blue-100 text-blue-700";
      case "utilisateur": return "bg-purple-100 text-purple-700";
      case "commercial": return "bg-green-100 text-green-700";
      case "livreur": return "bg-orange-100 text-orange-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  const TypeIcon = ({ type }: { type: string }) => {
    switch (type) {
      case "client": return <User className="w-4 h-4" />;
      case "utilisateur": return <Users className="w-4 h-4" />;
      case "commercial": return <Users className="w-4 h-4" />;
      case "livreur": return <Users className="w-4 h-4" />;
      default: return <User className="w-4 h-4" />;
    }
  };

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Rechercher par nom ou téléphone..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="pl-9 pr-8 bg-white border-gray-200 focus:border-[#1B4B6B] h-9 text-sm"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
          {results.length > 0 ? (
            <div className="py-1">
              <p className="px-3 py-1.5 text-xs text-gray-500 font-medium border-b">
                {results.length} résultat{results.length > 1 ? "s" : ""}
              </p>
              {results.map((r, i) => (
                <div
                  key={`${r.type}-${r.nom}-${i}`}
                  className="px-3 py-2.5 hover:bg-gray-50 flex items-center gap-3 cursor-default border-b border-gray-50 last:border-0"
                >
                  <div className={`p-1.5 rounded-md ${typeColor(r.type)}`}>
                    <TypeIcon type={r.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.nom}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {r.tel && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {r.tel.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, "$1 $2 $3 $4")}
                        </span>
                      )}
                      {r.extra && <span>• {r.extra}</span>}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(r.type)}`}>
                    {typeLabel(r.type)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              Aucun résultat pour "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
