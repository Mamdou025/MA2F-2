import { useApp } from "@/contexts/AppContext";
import { fmt, fmtDate, fmtNumber, cashAtSale, resteVente, bonusVente, getMoisCourant, todayLocal, toLocalDateStr, computeSoldeCaisseAuDate, computeStockRestant, computeStockMatierePremiere, SEUIL_ALERTE_STOCK_ROULEAU_KG } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, TrendingDown, Package, DollarSign, CreditCard, AlertTriangle, Factory, Wallet, MapPin, Cloud, CloudOff } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { db, collection, query, orderBy, limit, getDocs } from "@/lib/firebase";

type Periode = "aujourd'hui" | "semaine" | "mois" | "mois-precedent" | "personnalise";

function getMonday(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return toLocalDateStr(monday);
}

function getMoisPrecedent(): string {
  const now = new Date();
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Dernier jour du mois "YYYY-MM" donné, au format YYYY-MM-DD — voir même
// helper dans CaisseSection.tsx (duplicata volontaire, ces deux pages n'ont
// pas encore de logique commune factorisée pour le filtre de période).
function getDernierJourMois(moisISO: string): string {
  const [y, m] = moisISO.split("-").map(Number);
  return toLocalDateStr(new Date(y, m, 0));
}

function getPeriodeLabel(periode: Periode): string {
  switch (periode) {
    case "aujourd'hui": return "aujourd'hui";
    case "semaine": return "cette semaine";
    case "mois": return "ce mois";
    case "mois-precedent": return "le mois précédent";
    case "personnalise": return "la période";
  }
}

export default function Dashboard() {
  const { DB, setCurrentSection, allowedSections, currentUser } = useApp();
  const [periode, setPeriode] = useState<Periode>("mois");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");

  // ─── Statut de la sauvegarde cloud automatique (23h) ─────────────────────
  // Simple rappel visuel que la sauvegarde quotidienne existe (voir bannière
  // plus bas) — même lecture best-effort de `backup_logs` que
  // BackupsSection.tsx (dupliquée ici faute de couche de service partagée,
  // voir "No service layer" dans CLAUDE.md). La collection n'est lisible que
  // par un admin (règle Firestore) : les autres rôles voient uniquement la
  // mention statique du planning, sans statut dynamique.
  const isAdmin = currentUser?.role === "admin" || currentUser?.roles?.includes("admin");
  type DriveStatus = "loading" | "ok" | "stale" | "error" | "unknown";
  const [driveStatus, setDriveStatus] = useState<DriveStatus>("loading");
  const [driveLastLog, setDriveLastLog] = useState<{ date: Date | null; status: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) { setDriveStatus("unknown"); return; }
    let cancelled = false;
    (async () => {
      try {
        const q = query(collection(db, "backup_logs"), orderBy("date", "desc"), limit(1));
        const snap = await getDocs(q);
        if (cancelled) return;
        if (snap.empty) { setDriveStatus("unknown"); return; }
        const d = snap.docs[0].data() as any;
        const date: Date | null = d.date?.toDate ? d.date.toDate() : (d.date ? new Date(d.date) : null);
        setDriveLastLog({ date, status: d.status || "?" });
        const ageMs = date ? Date.now() - date.getTime() : Infinity;
        if (d.status === "error") setDriveStatus("error");
        else if (ageMs > 48 * 3600 * 1000) setDriveStatus("stale");
        else setDriveStatus("ok");
      } catch {
        if (!cancelled) setDriveStatus("unknown");
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const today = todayLocal();
  const mois = getMoisCourant();
  const moisPrecedent = getMoisPrecedent();
  const lundi = getMonday(new Date());

  const isInPeriod = (date: string): boolean => {
    if (!date) return false;
    switch (periode) {
      case "aujourd'hui": return date === today;
      case "semaine": return date >= lundi && date <= today;
      case "mois": return date.startsWith(mois);
      case "mois-precedent": return date.startsWith(moisPrecedent);
      case "personnalise": return dateDebut && dateFin ? date >= dateDebut && date <= dateFin : false;
      default: return true;
    }
  };

  const periodeLabel = getPeriodeLabel(periode);

  // Calculs KPI
  const ventesPeriode = DB.ventes.filter((v) => isInPeriod(v.date || ""));
  const ca = ventesPeriode.reduce((s, v) => s + v.packs * v.prix, 0);
  const totalDepenses = DB.depenses
    .filter((d) => isInPeriod(d.date || ""))
    .reduce((s, d) => s + d.montant, 0);

  const encaissementsReels =
    ventesPeriode.reduce((s, v) => s + cashAtSale(v, DB), 0) +
    DB.recouvrements
      .filter((r) => isInPeriod(r.date || ""))
      .reduce((s, r) => s + r.montant, 0);

  const creancesTotal = DB.ventes.reduce(
    (s, v) => s + Math.max(0, resteVente(v, DB)),
    0
  );

  const benefice = encaissementsReels - totalDepenses;

  const totalVendu = DB.ventes.reduce((s, v) => s + (v.packs || 0), 0);
  const totalBonus = DB.ventes.reduce((s, v) => s + bonusVente(v, DB), 0);
  // Calcul canonique — voir lib/helpers.ts computeStockRestant. Rejoue le même
  // journal DB.mouvementsStock que Gestion du Stock (StockSection.tsx), donc
  // toujours identique au total qui y est affiché.
  const stockRestant = computeStockRestant(DB);
  // Stock de matière première (kg de rouleau plastique) — calcul canonique
  // partagé avec LivraisonsSection.tsx (voir lib/helpers.ts
  // computeStockMatierePremiere), utilisé ici pour le signal danger du
  // Dashboard qui renvoie vers Réception.
  const stockRouleauKg = Math.max(0, computeStockMatierePremiere(DB));
  const prodPeriode = DB.production
    .filter((p) => isInPeriod(p.date || ""))
    .reduce((s, p) => s + p.packs, 0);

  // Mouvement de stock de la période sélectionnée — flux, pas une balance
  // (voir CLAUDE.md "Balance vs flux"). Le "Stock restant" ci-dessus reste
  // toujours le niveau réel actuel (depuis le début) ; ceci montre juste
  // l'évolution pendant la période choisie, à titre indicatif.
  const packsVendusPeriode = ventesPeriode.reduce((s, v) => s + (v.packs || 0), 0);
  const bonusOffertsPeriode = ventesPeriode.reduce((s, v) => s + bonusVente(v, DB), 0);
  const mouvementStockPeriode = prodPeriode - (packsVendusPeriode + bonusOffertsPeriode);

  // Caisse : même logique que CaisseSection
  const depensesPeriode = DB.depenses.filter((d) => isInPeriod(d.date || ""));
  const vehiculeOpsPeriode = DB.vehiculeOps.filter((op) => isInPeriod(op.date || ""));
  const vehiculeOpsNonComptees = useMemo(() => {
    return vehiculeOpsPeriode.filter((op) => {
      const categorie = op.type === "Carburant" ? "Carburant véhicule" : "Maintenance véhicule";
      return !depensesPeriode.some(
        (d) => d.date === op.date && d.montant === op.montant && d.categorie === categorie
      );
    });
  }, [vehiculeOpsPeriode, depensesPeriode]);
  const maintenancePeriode = DB.maintenance.filter((m) => isInPeriod(m.date || "") && m.cout > 0);
  const maintenanceNonComptee = useMemo(() => {
    return maintenancePeriode.filter((m) => {
      return !depensesPeriode.some(
        (d) => d.date === m.date && d.montant === m.cout && d.categorie === "Maintenance machine"
      );
    });
  }, [maintenancePeriode, depensesPeriode]);
  const totalVersements = DB.versements.filter((v) => isInPeriod(v.date || "")).reduce((s, v) => s + v.montant, 0);
  const totalApports = ((DB as any).apports || []).filter((a: any) => isInPeriod(a.date || "")).reduce((s: number, a: any) => s + a.montant, 0);

  const totalSortiesCaisse = totalDepenses + vehiculeOpsNonComptees.reduce((s, op) => s + op.montant, 0) + maintenanceNonComptee.reduce((s, m) => s + m.cout, 0);

  // Solde de caisse actuel (aujourd'hui) — l'argent réellement en caisse
  // "maintenant", indépendant de la période sélectionnée dans le dashboard.
  // Calcul canonique partagé (voir lib/helpers.ts) — le solde d'ouverture n'a
  // de sens qu'ici, additionné à TOUT l'historique, jamais à une période
  // filtrée (mois/semaine) sous peine de le compter en double. Même
  // implémentation que CaisseSection.tsx et lib/tests-calculs.ts.
  const soldeCaisseActuel = computeSoldeCaisseAuDate(DB);

  // Solde de caisse "photo" à la fin de la période sélectionnée — même
  // logique que CaisseSection.tsx : pour "mois précédent", c'est le solde
  // tel qu'il était le dernier jour de ce mois-là, pas celui d'aujourd'hui.
  const dateFinPeriode = useMemo(() => {
    switch (periode) {
      case "mois-precedent": return getDernierJourMois(moisPrecedent);
      case "personnalise": return dateFin || today;
      default: return today;
    }
  }, [periode, moisPrecedent, dateFin, today]);
  const soldeFinPeriode = useMemo(() => computeSoldeCaisseAuDate(DB, dateFinPeriode), [DB, dateFinPeriode]);
  const periodeEnCours = periode === "aujourd'hui" || periode === "semaine" || periode === "mois";

  // Dernières ventes
  const recentVentes = [...DB.ventes]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8);

  // Ventes par zone géographique — le champ Client.zone est du texte libre,
  // on normalise (trim) et on regroupe les clients sans zone renseignée à part.
  const ZONE_VIDE = "Zone non renseignée";
  const clientZoneMap = useMemo(() => {
    const map = new Map<string, string>();
    DB.clients.forEach((c) => map.set(c.nom, c.zone?.trim() || ZONE_VIDE));
    return map;
  }, [DB.clients]);

  const ventesParZone = useMemo(() => {
    const map = new Map<string, { ca: number; packs: number; clients: Set<string> }>();
    ventesPeriode.forEach((v) => {
      const zone = clientZoneMap.get(v.client) || ZONE_VIDE;
      const entry = map.get(zone) || { ca: 0, packs: 0, clients: new Set<string>() };
      entry.ca += v.packs * v.prix;
      entry.packs += v.packs;
      entry.clients.add(v.client);
      map.set(zone, entry);
    });
    const caTotalZones = Array.from(map.values()).reduce((s, d) => s + d.ca, 0);
    return Array.from(map.entries())
      .map(([zone, d]) => ({
        zone,
        ca: d.ca,
        packs: d.packs,
        nbClients: d.clients.size,
        part: caTotalZones > 0 ? Math.round((d.ca / caTotalZones) * 100) : 0,
      }))
      .sort((a, b) => b.ca - a.ca);
  }, [ventesPeriode, clientZoneMap]);

  const totalZonesEnregistrees = useMemo(() => {
    const set = new Set<string>();
    DB.clients.forEach((c) => set.add(c.zone?.trim() || ZONE_VIDE));
    return set.size;
  }, [DB.clients]);

  const periodes: { key: Periode; label: string }[] = [
    { key: "aujourd'hui", label: "Aujourd'hui" },
    { key: "semaine", label: "Cette semaine" },
    { key: "mois", label: "Ce mois" },
    { key: "mois-precedent", label: "Mois précédent" },
    { key: "personnalise", label: "Personnalisé" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Tableau de bord</h2>
        <p className="text-sm text-muted-foreground mt-1">Vue d'ensemble de votre activité</p>
      </div>

      {/* Signal danger : stock de rouleau plastique au seuil critique ou en
          dessous. Cliquable — renvoie vers Réception (LivraisonsSection.tsx)
          où la même alerte est détaillée (bannière + toast). Même seuil et
          calcul canoniques que là-bas (helpers.ts). */}
      {stockRouleauKg <= SEUIL_ALERTE_STOCK_ROULEAU_KG && allowedSections.includes("livraisons") && (
        <button
          type="button"
          onClick={() => setCurrentSection("livraisons")}
          className="w-full text-left"
        >
          <Card className="border-red-300 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer">
            <CardContent className="py-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">Stock de rouleaux plastique bas</p>
                <p className="text-xs text-red-800 mt-0.5">
                  {fmtNumber(Math.round(stockRouleauKg * 100) / 100)} kg disponibles — en dessous du seuil d'alerte de {SEUIL_ALERTE_STOCK_ROULEAU_KG} kg. Cliquez pour voir la Réception.
                </p>
              </div>
            </CardContent>
          </Card>
        </button>
      )}

      {/* Sauvegarde cloud — rappel qu'une sauvegarde automatique quotidienne
          existe (tous les jours à 23h00, Cloud Function
          `dailyBackupToGoogleDrive` → Cloud Storage, voir CLAUDE.md). Pour un
          admin, le statut réel de la dernière exécution est affiché
          (best-effort, `backup_logs` n'est lisible que par un admin) ; pour
          les autres rôles, seule la mention du planning est visible. */}
      <Card className="border-[#1B4B6B]/20 bg-[#1B4B6B]/5">
        <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            {isAdmin && driveStatus === "error" ? (
              <CloudOff className="w-4 h-4 text-red-600 shrink-0" />
            ) : (
              <Cloud className="w-4 h-4 text-[#1B4B6B] shrink-0" />
            )}
            <span className="text-foreground">Sauvegarde cloud automatique — tous les jours à 23h00</span>
            {isAdmin && driveLastLog?.date && (
              <span
                className={`text-xs ${
                  driveStatus === "error" ? "text-red-700" : driveStatus === "stale" ? "text-amber-700" : "text-muted-foreground"
                }`}
              >
                · dernière le {fmtDate(driveLastLog.date.toISOString())}
                {driveStatus === "error" ? " (échec — vérifier la Cloud Function)" : driveStatus === "stale" ? " (plus de 48h, à vérifier)" : ""}
              </span>
            )}
          </div>
          {allowedSections.includes("backups") && (
            <button
              type="button"
              onClick={() => setCurrentSection("backups")}
              className="text-xs font-medium text-[#1B4B6B] hover:underline"
            >
              Voir les sauvegardes →
            </button>
          )}
        </CardContent>
      </Card>

      {/* Filtre par période */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-muted/60 rounded-lg w-fit">
        {periodes.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriode(p.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              periode === p.key
                ? "bg-card text-[#1B4B6B] shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
        {periode === "personnalise" && (
          <div className="flex items-center gap-2 ml-2">
            <Input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              className="w-36 h-8 text-sm"
            />
            <span className="text-gray-500 text-sm">→</span>
            <Input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              className="w-36 h-8 text-sm"
            />
          </div>
        )}
      </div>

      {/* KPI Finances */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Finances — {periodeLabel}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <KPICard
            label="Chiffre d'affaires"
            value={fmt(ca)}
            subtitle="Payé + Crédit"
            icon={<DollarSign className="w-5 h-5" />}
            color="blue"
          />
          <KPICard
            label="Bénéfice net réel"
            value={fmt(benefice)}
            subtitle="Encaissé − dépenses"
            icon={benefice >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            color={benefice >= 0 ? "green" : "red"}
          />
          <KPICard
            label="Solde caisse actuel"
            value={fmt(soldeCaisseActuel)}
            subtitle="Aujourd'hui — indépendant de la période"
            icon={<Wallet className="w-5 h-5" />}
            color={soldeCaisseActuel >= 0 ? "teal" : "red"}
          />
          {!periodeEnCours && (
            <KPICard
              label={`Solde caisse au ${fmtDate(dateFinPeriode)}`}
              value={fmt(soldeFinPeriode)}
              subtitle={`Photo historique — fin de ${periodeLabel}`}
              icon={<Wallet className="w-5 h-5" />}
              color={soldeFinPeriode >= 0 ? "teal" : "red"}
            />
          )}
          <KPICard
            label="Créances"
            value={fmt(creancesTotal)}
            subtitle="À recouvrer (total)"
            icon={<CreditCard className="w-5 h-5" />}
            color="red"
          />
          <KPICard
            label="Dépenses totales"
            value={fmt(totalSortiesCaisse)}
            subtitle="Dép. + Véhicules + Maintenance"
            icon={<AlertTriangle className="w-5 h-5" />}
            color="orange"
          />
          <KPICard
            label="Versements"
            value={fmt(totalVersements)}
            subtitle="Total versé (période)"
            icon={<Wallet className="w-5 h-5" />}
            color="amber"
          />
        </div>
      </div>

      {/* KPI Stock */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Stock & Production
        </h3>
        {/* Flux de la période sélectionnée — pas des balances, se remettent
            à zéro à chaque nouvelle période (voir CLAUDE.md "Balance vs flux"). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label={`Production (${periodeLabel})`}
            value={`${fmtNumber(prodPeriode)} packs`}
            subtitle="Packs produits"
            icon={<Factory className="w-5 h-5" />}
            color="blue"
          />
          <KPICard
            label={`Packs vendus (${periodeLabel})`}
            value={`${fmtNumber(packsVendusPeriode)} packs`}
            subtitle="Rubrique Vente — période sélectionnée"
            icon={<Package className="w-5 h-5" />}
            color="indigo"
          />
          <KPICard
            label={`Bonus offerts (${periodeLabel})`}
            value={`${fmtNumber(bonusOffertsPeriode)} packs`}
            subtitle="Packs offerts — période sélectionnée"
            icon={<Package className="w-5 h-5" />}
            color="green"
          />
          <KPICard
            label={`Mouvement stock net (${periodeLabel})`}
            value={`${mouvementStockPeriode >= 0 ? "+" : ""}${fmtNumber(mouvementStockPeriode)} packs`}
            subtitle="Production − (Vendus + Bonus) de la période"
            icon={<Package className="w-5 h-5" />}
            color={mouvementStockPeriode < 0 ? "red" : "teal"}
          />
        </div>

        {/* Balances — cumulatives depuis le début, indépendantes de la
            période sélectionnée ci-dessus. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          <KPICard
            label="Packs vendus (total)"
            value={`${fmtNumber(totalVendu)} packs`}
            subtitle="Total rubrique Vente"
            icon={<Package className="w-5 h-5" />}
            color="indigo"
          />
          <KPICard
            label="Bonus offerts (total)"
            value={`${fmtNumber(totalBonus)} packs`}
            subtitle="Total packs offerts"
            icon={<Package className="w-5 h-5" />}
            color="green"
          />
          <KPICard
            label="Stock restant (total)"
            value={`${fmtNumber(stockRestant)} packs`}
            subtitle="Identique à Gestion du Stock — usine + camions + dépôt"
            icon={<Package className="w-5 h-5" />}
            color={stockRestant < 0 ? "red" : "teal"}
          />
        </div>
      </div>

      {/* Ventes par zone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="w-5 h-5 text-[#1B4B6B]" /> Ventes par zone — {periodeLabel}
          </CardTitle>
          <p className="text-xs text-gray-400">
            {ventesParZone.filter((z) => z.zone !== ZONE_VIDE).length} zone(s) actives sur {totalZonesEnregistrees} zone(s) client enregistrée(s)
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Clients actifs</TableHead>
                  <TableHead className="text-right">Packs vendus</TableHead>
                  <TableHead className="text-right">Chiffre d'affaires</TableHead>
                  <TableHead className="text-right">Part du CA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventesParZone.length > 0 ? (
                  ventesParZone.map((z) => (
                    <TableRow key={z.zone}>
                      <TableCell className="font-medium">
                        {z.zone === ZONE_VIDE ? (
                          <span className="text-gray-400 italic">{z.zone}</span>
                        ) : (
                          z.zone
                        )}
                      </TableCell>
                      <TableCell className="text-right">{z.nbClients}</TableCell>
                      <TableCell className="text-right">{fmtNumber(z.packs)}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(z.ca)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-gray-500">{z.part}%</span>
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-[#1B4B6B]" style={{ width: `${z.part}%` }} />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                      Aucune vente sur cette période
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dernières ventes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Dernières ventes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° BL</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Packs</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Mode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentVentes.length > 0 ? (
                  recentVentes.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-sm">{v.numero}</TableCell>
                      <TableCell>{fmtDate(v.date)}</TableCell>
                      <TableCell className="font-medium">{v.client}</TableCell>
                      <TableCell className="text-right">{v.packs}</TableCell>
                      <TableCell className="text-right font-medium">
                        {fmt(v.packs * v.prix)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={v.mode === "Payé" ? "default" : "secondary"}
                          className={
                            v.mode === "Payé"
                              ? "bg-green-100 text-green-800 hover:bg-green-100"
                              : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                          }
                        >
                          {v.mode}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                      Aucune vente enregistrée
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KPICard({
  label,
  value,
  subtitle,
  icon,
  color,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
}) {
  const valueColorMap: Record<string, string> = {
    blue: "text-[#1B4B6B]",
    green: "text-emerald-700",
    red: "text-red-700",
    orange: "text-orange-700",
    amber: "text-amber-700",
    indigo: "text-indigo-700",
    teal: "text-teal-700",
    gray: "text-gray-700",
  };

  const badgeColorMap: Record<string, string> = {
    blue: "bg-[#1B4B6B]/10 text-[#1B4B6B]",
    green: "bg-emerald-50 text-emerald-600",
    red: "bg-red-50 text-red-600",
    orange: "bg-orange-50 text-orange-600",
    amber: "bg-amber-50 text-amber-600",
    indigo: "bg-indigo-50 text-indigo-600",
    teal: "bg-teal-50 text-teal-600",
    gray: "bg-gray-100 text-gray-500",
  };

  return (
    <Card className="border-border/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide truncate">{label}</p>
            <p className={`text-2xl font-bold mt-1.5 tracking-tight ${valueColorMap[color] || "text-gray-700"}`}>
              {value}
            </p>
            <p className="text-xs text-muted-foreground/80 mt-1 truncate">{subtitle}</p>
          </div>
          <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${badgeColorMap[color] || "bg-gray-100 text-gray-500"}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
