import { useMemo, useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { fmt, fmtNumber } from "@/lib/helpers";
import { analyserStrategie, type Conseil, type ConseilCategorie, type ConseilPriorite } from "@/lib/strategie";
import {
  ALERTE_SECTORIELLE,
  PRATIQUES_PAR_THEME,
  THEME_INFO,
  type Pratique,
  type ThemePratique,
} from "@/lib/conseilsGeneriques";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Target,
  Megaphone,
  AlertTriangle,
  Compass,
  Users,
  DollarSign,
  MapPin,
  ShieldCheck,
  Settings2,
  CheckCircle2,
} from "lucide-react";

const CATEGORIE_INFO: Record<ConseilCategorie, { label: string; icon: React.ReactNode; color: string }> = {
  croissance: { label: "Croissance", icon: <TrendingUp className="w-3.5 h-3.5" />, color: "bg-blue-100 text-blue-800" },
  vente: { label: "Vente", icon: <Target className="w-3.5 h-3.5" />, color: "bg-purple-100 text-purple-800" },
  promotion: { label: "Promotion", icon: <Megaphone className="w-3.5 h-3.5" />, color: "bg-pink-100 text-pink-800" },
  risque: { label: "Risque", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "bg-red-100 text-red-800" },
  orientation: { label: "Orientation & développement", icon: <Compass className="w-3.5 h-3.5" />, color: "bg-teal-100 text-teal-800" },
};

const PRIORITE_STYLE: Record<ConseilPriorite, { border: string; badge: string; label: string }> = {
  haute: { border: "border-l-red-500", badge: "bg-red-100 text-red-800", label: "Priorité haute" },
  moyenne: { border: "border-l-amber-500", badge: "bg-amber-100 text-amber-800", label: "Priorité moyenne" },
  info: { border: "border-l-blue-400", badge: "bg-blue-100 text-blue-800", label: "Information" },
};

const THEME_ICONS: Record<ThemePratique, React.ReactNode> = {
  expansion: <MapPin className="w-4 h-4" />,
  qualite: <ShieldCheck className="w-4 h-4" />,
  gestion: <Settings2 className="w-4 h-4" />,
};

function PratiqueCard({ pratique }: { pratique: Pratique }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h4 className="font-semibold text-gray-900 mb-1.5">{pratique.titre}</h4>
        <p className="text-sm text-gray-600 leading-relaxed mb-3">{pratique.resume}</p>
        <ul className="space-y-1.5 mb-2">
          {pratique.actions.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#1B4B6B] mt-0.5 shrink-0" />
              <span>{a}</span>
            </li>
          ))}
        </ul>
        {pratique.source && <p className="text-xs text-gray-400 mt-2">Source : {pratique.source}</p>}
      </CardContent>
    </Card>
  );
}

function ConseilCard({ conseil }: { conseil: Conseil }) {
  const cat = CATEGORIE_INFO[conseil.categorie];
  const pri = PRIORITE_STYLE[conseil.priorite];
  return (
    <Card className={`border-l-4 ${pri.border}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cat.color}`}>
                {cat.icon} {cat.label}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${pri.badge}`}>{pri.label}</span>
            </div>
            <h4 className="font-semibold text-gray-900 mb-1">{conseil.titre}</h4>
            <p className="text-sm text-gray-600 leading-relaxed">{conseil.description}</p>
          </div>
          {conseil.metrique && (
            <div className="text-xl font-bold text-gray-800 whitespace-nowrap">{conseil.metrique}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const THEMES: ThemePratique[] = ["expansion", "qualite", "gestion"];

export default function StrategieSection() {
  const { DB } = useApp();
  const [theme, setTheme] = useState<ThemePratique>("expansion");

  const snapshot = useMemo(() => analyserStrategie(DB), [DB]);
  const {
    conseils,
    caMoisCourant,
    croissanceMoisPct,
    historiqueMensuel,
    parZone,
    parType,
    clientsARisque,
    concentrationTop5,
  } = snapshot;

  const maxCaMensuel = Math.max(1, ...historiqueMensuel.map((m) => m.ca));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Lightbulb className="w-6 h-6 text-amber-500" /> Stratégie &amp; conseils
        </h2>
        <p className="text-sm text-gray-500">
          Recommandations calculées automatiquement depuis vos données (ventes, clients, zones, commerciaux).
        </p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">CA du mois en cours</p>
                <p className="text-xl font-bold mt-1 text-blue-700">{fmt(caMoisCourant)}</p>
              </div>
              <DollarSign className="w-5 h-5 text-blue-500 opacity-60" />
            </div>
          </CardContent>
        </Card>
        <Card className={`border-l-4 ${croissanceMoisPct != null && croissanceMoisPct < 0 ? "border-l-red-500" : "border-l-green-500"}`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Évolution vs mois précédent</p>
                <p className={`text-xl font-bold mt-1 ${croissanceMoisPct == null ? "text-gray-400" : croissanceMoisPct < 0 ? "text-red-600" : "text-green-700"}`}>
                  {croissanceMoisPct == null ? "-" : `${croissanceMoisPct >= 0 ? "+" : ""}${croissanceMoisPct.toFixed(0)}%`}
                </p>
              </div>
              {croissanceMoisPct != null && croissanceMoisPct < 0 ? (
                <TrendingDown className="w-5 h-5 text-red-500 opacity-60" />
              ) : (
                <TrendingUp className="w-5 h-5 text-green-500 opacity-60" />
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Clients réguliers à risque</p>
                <p className="text-xl font-bold mt-1 text-red-700">{clientsARisque.length}</p>
              </div>
              <Users className="w-5 h-5 text-red-500 opacity-60" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">CA concentré sur le top 5 clients</p>
                <p className="text-xl font-bold mt-1 text-amber-700">{concentrationTop5.toFixed(0)}%</p>
              </div>
              <AlertTriangle className="w-5 h-5 text-amber-500 opacity-60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Conseils */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>💡</span> Recommandations ({conseils.length})
        </h3>
        {conseils.length > 0 ? (
          <div className="space-y-3">
            {conseils.map((c) => <ConseilCard key={c.id} conseil={c} />)}
          </div>
        ) : (
          <Card><CardContent className="p-8 text-center text-gray-400">Aucune recommandation particulière pour le moment — la situation semble stable.</CardContent></Card>
        )}
      </div>

      {/* Bonnes pratiques du secteur — développement, qualité, gestion */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>📘</span> Bonnes pratiques du secteur — Dakar &amp; Sénégal
        </h3>
        <Card className="border-l-4 border-l-red-500 mb-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-800">Point d'attention majeur</span>
            </div>
            <h4 className="font-semibold text-gray-900 mb-1">{ALERTE_SECTORIELLE.titre}</h4>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">{ALERTE_SECTORIELLE.resume}</p>
            <ul className="space-y-1.5">
              {ALERTE_SECTORIELLE.actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <CheckCircle2 className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
            {ALERTE_SECTORIELLE.source && <p className="text-xs text-gray-400 mt-2">Source : {ALERTE_SECTORIELLE.source}</p>}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2 mb-4">
          {THEMES.map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border transition-colors ${
                theme === t
                  ? "bg-[#1B4B6B] text-white border-[#1B4B6B]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-[#1B4B6B]"
              }`}
            >
              {THEME_ICONS[t]} {THEME_INFO[t].label}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500 mb-3">{THEME_INFO[theme].description}</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {PRATIQUES_PAR_THEME[theme].map((p) => (
            <PratiqueCard key={p.id} pratique={p} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Répartition par zone */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><Compass className="w-4 h-4 text-[#1B4B6B]" /> Performance par zone</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zone</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">CA</TableHead>
                    <TableHead className="text-right">CA/client</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parZone.length > 0 ? parZone.slice(0, 8).map((z) => (
                    <TableRow key={z.zone}>
                      <TableCell className="font-medium">{z.zone}</TableCell>
                      <TableCell className="text-right">{z.nbClients}</TableCell>
                      <TableCell className="text-right">{fmt(z.ca)}</TableCell>
                      <TableCell className="text-right text-gray-500">{fmt(z.caParClient)}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={4} className="text-center text-gray-400 py-6">Aucune donnée</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Répartition par segment */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><Target className="w-4 h-4 text-[#1B4B6B]" /> Performance par segment</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">CA</TableHead>
                    <TableHead className="text-right">Part</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parType.length > 0 ? parType.slice(0, 8).map((t) => (
                    <TableRow key={t.type}>
                      <TableCell className="font-medium">{t.type}</TableCell>
                      <TableCell className="text-right">{t.nbClients}</TableCell>
                      <TableCell className="text-right">{fmt(t.ca)}</TableCell>
                      <TableCell className="text-right text-gray-500">{t.part.toFixed(0)}%</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={4} className="text-center text-gray-400 py-6">Aucune donnée</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tendance mensuelle */}
      {historiqueMensuel.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[#1B4B6B]" /> Évolution du CA mensuel</h3>
            <div className="space-y-2">
              {historiqueMensuel.map((m) => {
                const pct = maxCaMensuel > 0 ? Math.max(2, Math.round((m.ca / maxCaMensuel) * 100)) : 0;
                return (
                  <div key={m.mois} className="flex items-center gap-3">
                    <span className="w-16 text-xs font-medium text-gray-500">{m.mois}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#1B4B6B]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-24 text-right text-sm font-medium">{fmtNumber(Math.round(m.ca))} F</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
