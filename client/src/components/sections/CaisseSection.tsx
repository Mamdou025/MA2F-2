import { useApp } from "@/contexts/AppContext";
import { fmt, fmtDate, getMoisCourant, cashAtSale, todayLocal, toLocalDateStr, computeSoldeCaisseAuDate } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

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

// Dernier jour du mois "YYYY-MM" donné, au format YYYY-MM-DD — sert à borner
// le solde "fin de période" pour mois-precedent.
function getDernierJourMois(moisISO: string): string {
  const [y, m] = moisISO.split("-").map(Number);
  return toLocalDateStr(new Date(y, m, 0)); // day 0 du mois suivant = dernier jour de moisISO
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

export default function CaisseSection() {
  const { DB } = useApp();
  const [periode, setPeriode] = useState<Periode>("mois");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");

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

  // Entrées de la période — mouvement net uniquement. Le solde d'ouverture
  // n'est PAS ajouté ici : c'est une constante historique (posée une seule
  // fois, au démarrage de l'activité), pas une entrée qui se reproduit
  // chaque mois/semaine. L'ajouter ici la ferait apparaître en double dans
  // chaque période sélectionnée. Elle n'intervient que dans le calcul du
  // "Solde de caisse actuel" plus bas (non filtré par période).
  const encaissVentes = DB.ventes.filter((v) => isInPeriod(v.date || "")).reduce((s, v) => s + cashAtSale(v, DB), 0);
  const encaissRecouv = DB.recouvrements.filter((r) => isInPeriod(r.date || "")).reduce((s, r) => s + r.montant, 0);
  const apports = ((DB as any).apports || []) as { date: string; montant: number; type: string; source: string }[];
  const apportsPeriode = apports.filter((a) => isInPeriod(a.date || ""));
  const totalApports = apportsPeriode.reduce((s, a) => s + a.montant, 0);
  const totalEntrees = encaissVentes + encaissRecouv + totalApports;

  // Sorties - dépenses directes
  const depensesPeriode = DB.depenses.filter((d) => isInPeriod(d.date || ""));
  const totalDepenses = depensesPeriode.reduce((s, d) => s + d.montant, 0);

  // Sorties - opérations véhicules (carburant + maintenance camion) non déjà comptées dans dépenses
  const vehiculeOpsPeriode = DB.vehiculeOps.filter((op) => isInPeriod(op.date || ""));
  const vehiculeOpsNonComptees = useMemo(() => {
    return vehiculeOpsPeriode.filter((op) => {
      const categorie = op.type === "Carburant" ? "Carburant véhicule" : "Maintenance véhicule";
      const existe = depensesPeriode.some(
        (d) => d.date === op.date && d.montant === op.montant && d.categorie === categorie
      );
      return !existe;
    });
  }, [vehiculeOpsPeriode, depensesPeriode]);
  const totalVehiculeOpsNonComptees = vehiculeOpsNonComptees.reduce((s, op) => s + op.montant, 0);

  // Sorties - maintenance machine non déjà comptée dans dépenses
  const maintenancePeriode = DB.maintenance.filter((m) => isInPeriod(m.date || "") && m.cout > 0);
  const maintenanceNonComptee = useMemo(() => {
    return maintenancePeriode.filter((m) => {
      const existe = depensesPeriode.some(
        (d) => d.date === m.date && d.montant === m.cout && d.categorie === "Maintenance machine"
      );
      return !existe;
    });
  }, [maintenancePeriode, depensesPeriode]);
  const totalMaintenanceNonComptee = maintenanceNonComptee.reduce((s, m) => s + m.cout, 0);

  // Versements
  const totalVersements = DB.versements.filter((v) => isInPeriod(v.date || "")).reduce((s, v) => s + v.montant, 0);

  const totalSorties = totalDepenses + totalVehiculeOpsNonComptees + totalMaintenanceNonComptee + totalVersements;
  const solde = totalEntrees - totalSorties; // mouvement net de la période sélectionnée (pas un solde de caisse)

  // Solde de caisse actuel (aujourd'hui) — indépendant de la période
  // sélectionnée. Calcul canonique partagé (voir client/src/lib/helpers.ts) :
  // c'est ici, et seulement ici, que le solde d'ouverture doit être ajouté,
  // sur la totalité de l'historique — jamais réinjecté dans un total filtré
  // par période. Même implémentation que Dashboard.tsx et tests-calculs.ts.
  const soldeCaisseActuel = useMemo(() => computeSoldeCaisseAuDate(DB), [DB]);

  // Solde de caisse "photo" à la fin de la période sélectionnée — distinct du
  // solde actuel ci-dessus : pour "mois précédent" par exemple, c'est le
  // solde tel qu'il était le dernier jour de ce mois-là (toutes les
  // transactions depuis le début jusqu'à cette date, pas seulement celles du
  // mois), pas le solde d'aujourd'hui. Pour une période en cours
  // (aujourd'hui/semaine/mois), la fin de période est aujourd'hui, donc ce
  // chiffre rejoint alors soldeCaisseActuel.
  const dateFinPeriode = useMemo(() => {
    switch (periode) {
      case "mois-precedent": return getDernierJourMois(moisPrecedent);
      case "personnalise": return dateFin || today;
      default: return today;
    }
  }, [periode, moisPrecedent, dateFin, today]);
  const soldeFinPeriode = useMemo(() => computeSoldeCaisseAuDate(DB, dateFinPeriode), [DB, dateFinPeriode]);
  const periodeEnCours = periode === "aujourd'hui" || periode === "semaine" || periode === "mois";

  // Mouvements détaillés
  const mouvements = useMemo(() => {
    const items = [
      ...DB.ventes.filter((v) => isInPeriod(v.date || "") && cashAtSale(v, DB) > 0).map((v) => ({
        date: v.date, type: "Vente", desc: `${v.numero} - ${v.client}`, entree: cashAtSale(v, DB), sortie: 0
      })),
      ...DB.recouvrements.filter((r) => isInPeriod(r.date || "")).map((r) => ({
        date: r.date, type: "Recouvrement", desc: `${r.numeroBL} - ${r.client}`, entree: r.montant, sortie: 0
      })),
      ...apportsPeriode.map((a) => ({
        date: a.date, type: "Apport", desc: `${a.type} - ${a.source}`, entree: a.montant, sortie: 0
      })),
      ...depensesPeriode.map((d) => ({
        date: d.date, type: "Dépense", desc: d.libelle || d.categorie, entree: 0, sortie: d.montant
      })),
      ...vehiculeOpsNonComptees.map((op) => {
        const camion = DB.vehicules.find((v) => v.id === op.vehiculeId);
        return {
          date: op.date,
          type: op.type === "Carburant" ? "Carburant" : "Maint. véhicule",
          desc: `${camion?.nom || "Camion"} - ${op.description || op.type}`,
          entree: 0,
          sortie: op.montant,
        };
      }),
      ...maintenanceNonComptee.map((m) => ({
        date: m.date,
        type: "Maint. machine",
        desc: `${m.type} - ${m.equipement}`,
        entree: 0,
        sortie: m.cout,
      })),
      ...DB.versements.filter((v) => isInPeriod(v.date || "")).map((v) => ({
        date: v.date, type: "Versement", desc: `${v.type} - ${v.beneficiaire}`, entree: 0, sortie: v.montant
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DB, periode, dateDebut, dateFin]);

  const periodeLabel = getPeriodeLabel(periode);

  const periodes: { key: Periode; label: string }[] = [
    { key: "aujourd'hui", label: "Aujourd'hui" },
    { key: "semaine", label: "Cette semaine" },
    { key: "mois", label: "Ce mois" },
    { key: "mois-precedent", label: "Mois précédent" },
    { key: "personnalise", label: "Personnalisé" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">💰 Caisse</h2>

      {/* Filtre par période */}
      <div className="flex flex-wrap items-center gap-2">
        {periodes.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriode(p.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              periode === p.key
                ? "bg-[#1B4B6B] text-white shadow-sm"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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

      {/* Solde de caisse actuel (aujourd'hui) — toujours depuis le début, indépendant du filtre de période ci-dessus */}
      <div className={`grid grid-cols-1 ${periodeEnCours ? "" : "sm:grid-cols-2"} gap-4`}>
        <Card className="border-l-4 border-l-blue-600 bg-blue-50/40">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Solde de caisse actuel (aujourd'hui, toutes périodes confondues)</p>
            <p className={`text-2xl font-bold ${soldeCaisseActuel >= 0 ? "text-blue-700" : "text-red-700"}`}>{fmt(soldeCaisseActuel)}</p>
            <p className="text-xs text-gray-400 mt-1">Solde ouverture + tous les mouvements historiques jusqu'à aujourd'hui — ne change pas selon le filtre ci-dessus</p>
          </CardContent>
        </Card>
        {!periodeEnCours && (
          <Card className="border-l-4 border-l-indigo-500 bg-indigo-50/40">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">Solde de caisse au {fmtDate(dateFinPeriode)} (fin de {periodeLabel})</p>
              <p className={`text-2xl font-bold ${soldeFinPeriode >= 0 ? "text-indigo-700" : "text-red-700"}`}>{fmt(soldeFinPeriode)}</p>
              <p className="text-xs text-gray-400 mt-1">Photo historique : solde tel qu'il était à cette date, pas le solde d'aujourd'hui</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* KPI de la période sélectionnée */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Entrées — {periodeLabel}</p>
            <p className="text-xl font-bold text-green-700">{fmt(totalEntrees)}</p>
            <p className="text-xs text-gray-400 mt-1">Ventes cash + Recouvrements + Apports (période uniquement)</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Sorties — {periodeLabel}</p>
            <p className="text-xl font-bold text-red-700">{fmt(totalSorties)}</p>
            <p className="text-xs text-gray-400 mt-1">Dépenses + Véhicules + Maintenance + Versements</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-indigo-500">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Mouvement net — {periodeLabel}</p>
            <p className={`text-xl font-bold ${solde >= 0 ? "text-indigo-700" : "text-red-700"}`}>{fmt(solde)}</p>
            <p className="text-xs text-gray-400 mt-1">Entrées - Sorties de la période (hors solde d'ouverture)</p>
          </CardContent>
        </Card>
      </div>

      {/* Détail des entrées */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Ventes cash</p>
            <p className="text-lg font-bold text-green-600">{fmt(encaissVentes)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Recouvrements</p>
            <p className="text-lg font-bold text-green-600">{fmt(encaissRecouv)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Apports de fonds</p>
            <p className="text-lg font-bold text-green-600">{fmt(totalApports)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Solde ouverture (constante, hors période)</p>
            <p className="text-lg font-bold text-green-600">{fmt(DB.params.soldeOuverture || 297023)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Détail des sorties */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Dépenses</p>
            <p className="text-lg font-bold text-red-600">{fmt(totalDepenses)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Véhicules</p>
            <p className="text-lg font-bold text-orange-600">{fmt(totalVehiculeOpsNonComptees + vehiculeOpsPeriode.filter(op => {
              const cat = op.type === "Carburant" ? "Carburant véhicule" : "Maintenance véhicule";
              return depensesPeriode.some(d => d.date === op.date && d.montant === op.montant && d.categorie === cat);
            }).reduce((s, op) => s + op.montant, 0))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Maintenance</p>
            <p className="text-lg font-bold text-orange-600">{fmt(totalMaintenanceNonComptee + maintenancePeriode.filter(m => {
              return depensesPeriode.some(d => d.date === m.date && d.montant === m.cout && d.categorie === "Maintenance machine");
            }).reduce((s, m) => s + m.cout, 0))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-gray-500">Versements</p>
            <p className="text-lg font-bold text-purple-600">{fmt(totalVersements)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tableau des mouvements */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Mouvements — {periodeLabel} ({mouvements.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">Type</TableHead>
                  <TableHead className="text-white font-semibold">Description</TableHead>
                  <TableHead className="text-white font-semibold text-right">Entrée</TableHead>
                  <TableHead className="text-white font-semibold text-right">Sortie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mouvements.length > 0 ? mouvements.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell>{fmtDate(m.date)}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        m.type === "Vente" ? "bg-green-100 text-green-800" :
                        m.type === "Recouvrement" ? "bg-blue-100 text-blue-800" :
                        m.type === "Apport" ? "bg-emerald-100 text-emerald-800" :
                        m.type === "Versement" ? "bg-purple-100 text-purple-800" :
                        "bg-red-100 text-red-800"
                      }`}>
                        {m.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{m.desc}</TableCell>
                    <TableCell className="text-right text-green-600 font-semibold">{m.entree > 0 ? fmt(m.entree) : ""}</TableCell>
                    <TableCell className="text-right text-red-600 font-semibold">{m.sortie > 0 ? fmt(m.sortie) : ""}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-400 py-8">Aucun mouvement pour cette période</TableCell>
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
