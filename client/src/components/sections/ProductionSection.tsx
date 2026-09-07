import { useState, useMemo, useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmtDate, fmtNumber, getMoisCourant, todayLocal } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, ChevronDown, ChevronUp, AlertTriangle, Users } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { usePagination } from "@/hooks/usePagination";
import { Pagination } from "@/components/Pagination";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import TableFilters from "@/components/TableFilters";
import { useTableFilters } from "@/hooks/useTableFilters";
import type { Production } from "@/lib/types";
import { validateProduction } from "@/lib/validation";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { creerMouvementProduction, creerMouvementConsommation, creerMouvementCasse } from "@/lib/stock";
import { uid as stockUid } from "@/lib/helpers";

export default function ProductionSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [packs, setPacks] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [livraisonIds, setLivraisonIds] = useState<string[]>([]);
  const [rebuts, setRebuts] = useState("");
  const [rebutsNotes, setRebutsNotes] = useState("");
  const [machine, setMachine] = useState("");
  // Répartition optionnelle du lot entre plusieurs producteurs (voir
  // Production.producteurs dans types.ts). "packs" (le total du lot) reste
  // la valeur de référence saisie/mesurée pour le lot entier — la
  // répartition n'est qu'une attribution PARTIELLE ou complète de ce total
  // à des producteurs identifiés ; sa somme ne doit jamais le dépasser (elle
  // peut être inférieure, si une partie du lot n'est pas attribuée à un
  // producteur précis). Voir la validation dans handleSave.
  const [lotProducteurs, setLotProducteurs] = useState<{ producteurId: string; packs: string }[]>([]);

  const sommeLotProducteurs = lotProducteurs.reduce((s, r) => s + (Number(r.packs) || 0), 0);

  // Noms de machine/ligne déjà utilisés (production + équipements de
  // maintenance), pour l'autocomplete — garde une nomenclature cohérente.
  const machineNames = useMemo(() => {
    const set = new Set<string>();
    DB.production.forEach((p) => { if (p.machine?.trim()) set.add(p.machine.trim()); });
    DB.maintenance.forEach((m) => { if (m.equipement?.trim()) set.add(m.equipement.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [DB.production, DB.maintenance]);

  const isAdmin = currentUser?.role === "admin" || currentUser?.roles?.includes("admin");
  const mois = getMoisCourant();

  // Objectif de production mensuel (paramètre global, configurable dans Paramètres)
  const objectifMensuel = Number(DB.params.objectifProductionMensuel) || 0;
  const produitCeMois = useMemo(
    () => DB.production.filter((p) => (p.date || "").startsWith(mois)).reduce((s, p) => s + p.packs, 0),
    [DB.production, mois]
  );
  const pctObjectif = objectifMensuel > 0 ? Math.round((produitCeMois / objectifMensuel) * 100) : 0;

  // ─── Tableau de bord : taux de rebut, historique mensuel, par machine ────────
  const rebutsStats = useMemo(() => {
    const totalPacks = DB.production.reduce((s, p) => s + p.packs, 0);
    const totalRebuts = DB.production.reduce((s, p) => s + (p.rebuts || 0), 0);
    const tauxRebutGlobal = totalPacks + totalRebuts > 0 ? (totalRebuts / (totalPacks + totalRebuts)) * 100 : 0;
    const packsCeMois = DB.production.filter((p) => (p.date || "").startsWith(mois)).reduce((s, p) => s + p.packs, 0);
    const rebutsCeMois = DB.production.filter((p) => (p.date || "").startsWith(mois)).reduce((s, p) => s + (p.rebuts || 0), 0);
    const tauxRebutMois = packsCeMois + rebutsCeMois > 0 ? (rebutsCeMois / (packsCeMois + rebutsCeMois)) * 100 : 0;
    return { totalPacks, totalRebuts, tauxRebutGlobal, rebutsCeMois, tauxRebutMois };
  }, [DB.production, mois]);

  const historiqueMensuel = useMemo(() => {
    const now = new Date();
    const months: { label: string; mois: string; packs: number; rebuts: number; tauxRebut: number; pertesPannes: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const moisKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const noms = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
      const prodMois = DB.production.filter((p) => (p.date || "").startsWith(moisKey));
      const packs = prodMois.reduce((s, p) => s + p.packs, 0);
      const rebuts = prodMois.reduce((s, p) => s + (p.rebuts || 0), 0);
      const tauxRebut = packs + rebuts > 0 ? (rebuts / (packs + rebuts)) * 100 : 0;
      const pertesPannes = DB.maintenance.filter((m) => (m.date || "").startsWith(moisKey)).reduce((s, m) => s + (m.packsPerdusEstimes || 0), 0);
      months.push({ label: `${noms[d.getMonth()]} ${d.getFullYear()}`, mois: moisKey, packs, rebuts, tauxRebut, pertesPannes });
    }
    return months;
  }, [DB.production, DB.maintenance]);

  const machineStats = useMemo(() => {
    const map = new Map<string, { machine: string; nbLots: number; packs: number; rebuts: number }>();
    DB.production.forEach((p) => {
      const key = p.machine?.trim() || "Non renseignée";
      const entry = map.get(key) || { machine: key, nbLots: 0, packs: 0, rebuts: 0 };
      entry.nbLots += 1;
      entry.packs += p.packs;
      entry.rebuts += p.rebuts || 0;
      map.set(key, entry);
    });
    return Array.from(map.values())
      .map((e) => ({ ...e, tauxRebut: e.packs + e.rebuts > 0 ? (e.rebuts / (e.packs + e.rebuts)) * 100 : 0 }))
      .sort((a, b) => b.packs - a.packs);
  }, [DB.production]);
  const machinesRenseignees = machineStats.filter((m) => m.machine !== "Non renseignée").length;

  // Livraisons récentes disponibles pour la traçabilité (les 30 plus récentes,
  // avec recherche par fournisseur pour les retrouver facilement)
  const [livraisonSearch, setLivraisonSearch] = useState("");
  const livraisonsDisponibles = useMemo(() => {
    const q = livraisonSearch.toLowerCase().trim();
    return [...DB.livraisons]
      .filter((l) => !q || l.fournisseur.toLowerCase().includes(q) || l.numero.toLowerCase().includes(q))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 30);
  }, [DB.livraisons, livraisonSearch]);

  // Données triées
  const sortedProduction = useMemo(() =>
    [...DB.production].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [DB.production]
  );

  // Filtres avancés
  const getDate = useCallback((p: Production) => p.date, []);
  const getSearchText = useCallback((p: Production) => `${p.numero} ${p.packs} ${p.machine || ""}`, []);

  const { filters, setFilters, filteredData, totalCount, resultCount } = useTableFilters({
    data: sortedProduction,
    getDate,
    getSearchText,
  });

  const pagination = usePagination(filteredData, { pageSize: 20 });

  // Total packs filtré
  const totalPacks = filteredData.reduce((s, p) => s + p.packs, 0);

  const handleOpen = () => {
    setEditId(null);
    const next = "L-" + String(DB.production.length + 1).padStart(3, "0");
    setNumero(next);
    setDate(todayLocal());
    setPacks("");
    setMachine("");
    setLivraisonIds([]);
    setRebuts("");
    setRebutsNotes("");
    setLotProducteurs([]);
    setShowAdvanced(false);
    setOpen(true);
  };

  const handleEdit = (id: string) => {
    if (!isAdmin) {
      toast.error("Seul l'administrateur peut modifier une production");
      return;
    }
    const item = DB.production.find((p) => p.id === id);
    if (!item) return;
    setEditId(id);
    setNumero(item.numero);
    setDate(item.date);
    setPacks(String(item.packs));
    setMachine(item.machine || "");
    setLivraisonIds(item.livraisonIds || []);
    setRebuts(item.rebuts != null ? String(item.rebuts) : "");
    setRebutsNotes(item.rebutsNotes || "");
    setLotProducteurs((item.producteurs || []).map((r) => ({ producteurId: r.producteurId, packs: String(r.packs) })));
    setShowAdvanced(!!(item.livraisonIds?.length || item.rebuts));
    setOpen(true);
  };

  const handleSave = () => {
    // Vérifier la clôture
    const clotureMsg = checkCloture(date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    // Validation métier
    const validation = validateProduction({ packs: Number(packs), date }, DB);
    if (!validation.valid) { validation.errors.forEach((e) => toast.error(e)); return; }

    // Validation de la répartition par producteur (si renseignée) : chaque
    // ligne doit avoir un producteur choisi et un nombre de packs > 0, et un
    // même producteur ne peut pas apparaître deux fois sur le même lot.
    if (lotProducteurs.length > 0) {
      if (lotProducteurs.some((r) => !r.producteurId)) { toast.error("Choisissez un producteur pour chaque ligne (ou supprimez la ligne)"); return; }
      if (lotProducteurs.some((r) => !Number(r.packs) || Number(r.packs) <= 0)) { toast.error("Chaque producteur doit avoir un nombre de packs valide"); return; }
      const ids = lotProducteurs.map((r) => r.producteurId);
      if (new Set(ids).size !== ids.length) { toast.error("Un producteur ne peut apparaître qu'une seule fois par lot"); return; }
      // La répartition doit couvrir EXACTEMENT le total du lot (ni plus, ni
      // moins) : "packs" représente ce qui a réellement été produit, donc
      // toute la production doit être attribuée à un producteur.
      const sommeProducteurs = lotProducteurs.reduce((s, r) => s + (Number(r.packs) || 0), 0);
      if (sommeProducteurs !== Number(packs)) {
        toast.error(`La somme des packs par producteur (${sommeProducteurs}) doit être égale au total du lot (${Number(packs)})`);
        return;
      }
    }

    const extraFields = {
      machine: machine.trim() ? machine.trim() : undefined,
      livraisonIds: livraisonIds.length > 0 ? livraisonIds : undefined,
      rebuts: rebuts ? Number(rebuts) : undefined,
      rebutsNotes: rebuts && rebutsNotes.trim() ? rebutsNotes.trim() : undefined,
      producteurs: lotProducteurs.length > 0
        ? lotProducteurs.map((r) => ({ producteurId: r.producteurId, packs: Number(r.packs) }))
        : undefined,
    };
    const rebutsQty = Number(rebuts) || 0;

    if (editId) {
      const oldItem = DB.production.find((p) => p.id === editId);
      const newItem = { ...oldItem!, numero, date, packs: Number(packs), ...extraFields };
      let updated = { ...DB, production: DB.production.map((p) => p.id === editId ? newItem : p) };

      // Synchroniser les mouvements de stock liés (production + consommation MP)
      const kgConsomme = Number(packs) / (DB.params.tauxSachetsParKg || 17);
      updated = {
        ...updated,
        mouvementsStock: (updated.mouvementsStock || []).map((m: any) => {
          if (m.reference !== editId) return m;
          if (m.type === "production" && m.produit === "sachet_plein") {
            return { ...m, date, quantite: Number(packs), referenceLabel: `Production ${numero}` };
          }
          if (m.type === "consommation" && m.produit === "rouleau_plastique") {
            return { ...m, date, quantite: Math.round(kgConsomme * 100) / 100, referenceLabel: `Production ${numero}` };
          }
          if (m.type === "casse" && m.produit === "sachet_plein") {
            return { ...m, date, quantite: rebutsQty, notes: rebutsNotes.trim() };
          }
          return m;
        }),
      };
      // Le mouvement de rebut n'existait pas encore et rebuts > 0 : le créer.
      const hasCasseMvt = (updated.mouvementsStock || []).some((m: any) => m.reference === editId && m.type === "casse" && m.produit === "sachet_plein");
      if (rebutsQty > 0 && !hasCasseMvt) {
        const mvtRebut = creerMouvementCasse(stockUid(), date, rebutsQty, "sachet_plein", "usine", currentUser?.nom || "", rebutsNotes.trim(), undefined);
        updated = { ...updated, mouvementsStock: [...(updated.mouvementsStock || []), { ...mvtRebut, reference: editId, referenceLabel: `Rebut production ${numero}` }] };
      }
      // Rebuts remis à 0 : retirer le mouvement de rebut existant.
      if (rebutsQty === 0 && hasCasseMvt) {
        updated = { ...updated, mouvementsStock: (updated.mouvementsStock || []).filter((m: any) => !(m.reference === editId && m.type === "casse" && m.produit === "sachet_plein")) };
      }

      const histEntry = updateHistoryEntry("Production", editId, numero, oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      if (histEntry) updated = addHistoryEntry(updated, histEntry);
      setDB(updated); saveDB(updated);
      logActivity("update", "Production", `Modification ${numero} - ${packs} packs`);
      toast.success("Production modifiée");
    } else {
      const item = { id: uid(), numero, date, packs: Number(packs), ...extraFields };
      // Mouvement stock: entrée produit fini à l'usine
      const mvtProd = creerMouvementProduction(stockUid(), date, Number(packs), currentUser?.nom || "", item.id, `Production ${numero}`);
      // Mouvement stock: consommation matière première (packs / taux conversion)
      const kgConsomme = Number(packs) / (DB.params.tauxSachetsParKg || 17);
      const mvtConso = creerMouvementConsommation(stockUid(), date, Math.round(kgConsomme * 100) / 100, currentUser?.nom || "", item.id, `Production ${numero}`);
      const mouvements = [mvtProd, mvtConso];
      // Mouvement de rebut (casse), si des sachets ont été rejetés pendant la fabrication
      if (rebutsQty > 0) {
        const mvtRebut = creerMouvementCasse(stockUid(), date, rebutsQty, "sachet_plein", "usine", currentUser?.nom || "", rebutsNotes.trim(), undefined);
        mouvements.push({ ...mvtRebut, reference: item.id, referenceLabel: `Rebut production ${numero}` });
      }
      let updated = { ...DB, production: [...DB.production, item], mouvementsStock: [...(DB.mouvementsStock || []), ...mouvements] };
      const histEntry = createHistoryEntry("Production", item.id, numero, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      updated = addHistoryEntry(updated, histEntry);
      setDB(updated); saveDB(updated);
      logActivity("create", "Production", `${numero} - ${packs} packs${rebutsQty > 0 ? ` (${rebutsQty} rebuts)` : ""}`);
      toast.success("Lot de production enregistré");
    }
    setOpen(false);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    if (!isAdmin) {
      toast.error("Seul l'administrateur peut supprimer une production");
      setDeleteId(null);
      return;
    }
    const item = DB.production.find((p) => p.id === deleteId);
    if (!item) return;
    // Vérifier la clôture
    const clotureMsg = checkCloture(item.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); setDeleteId(null); return; }
    // Mouvements de stock liés (production + consommation MP + éventuel rebut), à retirer et conserver pour restauration éventuelle
    const mvtLies = (DB.mouvementsStock || []).filter((m: any) => m.reference === deleteId && (m.type === "production" || m.type === "consommation" || m.type === "casse"));
    const corbeille = [...DB.corbeille, { id: uid(), originalType: "production", moduleName: "Production", desc: item.numero, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "Utilisateur", data: item, relatedMouvements: mvtLies }];
    let updated = {
      ...DB,
      production: DB.production.filter((p) => p.id !== deleteId),
      mouvementsStock: (DB.mouvementsStock || []).filter((m: any) => !(m.reference === deleteId && (m.type === "production" || m.type === "consommation" || m.type === "casse"))),
      corbeille,
    };
    const histEntry = deleteHistoryEntry("Production", deleteId, item.numero, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("delete", "Production", `Suppression ${item.numero}`);
    toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Production</h2>
          <p className="text-sm text-gray-500">
            {DB.production.length} lot(s)
            {(filters.dateFrom || filters.dateTo || filters.search) && (
              <span className="ml-2">| Filtré : <span className="font-bold">{totalPacks} packs</span></span>
            )}
          </p>
        </div>
        <Button onClick={handleOpen} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
          <Plus className="w-4 h-4 mr-2" /> Nouveau lot
        </Button>
      </div>

      {/* Objectif de production mensuel (configurable dans Paramètres) */}
      {objectifMensuel > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-500">Objectif de production — {mois}</p>
              <p className="text-sm font-bold">{fmtNumber(produitCeMois)} / {fmtNumber(objectifMensuel)} packs</p>
            </div>
            <div className="flex items-center gap-2">
              <Progress value={Math.min(pctObjectif, 100)} className="flex-1 h-2" />
              <span className={`text-xs font-bold ${pctObjectif >= 100 ? "text-green-600" : pctObjectif >= 75 ? "text-blue-600" : "text-orange-600"}`}>{pctObjectif}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tableau de bord : taux de rebut, évolution mensuelle, machines */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Taux de rebut — {mois}</p>
            <p className={`text-2xl font-bold ${rebutsStats.tauxRebutMois >= 3 ? "text-red-600" : "text-gray-900"}`}>{rebutsStats.tauxRebutMois.toFixed(1)}%</p>
            <p className="text-xs text-gray-400">{fmtNumber(rebutsStats.rebutsCeMois)} sachets rejetés ce mois</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Taux de rebut — global</p>
            <p className={`text-2xl font-bold ${rebutsStats.tauxRebutGlobal >= 3 ? "text-red-600" : "text-gray-900"}`}>{rebutsStats.tauxRebutGlobal.toFixed(1)}%</p>
            <p className="text-xs text-gray-400">{fmtNumber(rebutsStats.totalRebuts)} sachets rejetés au total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Machines suivies</p>
            <p className="text-2xl font-bold text-gray-900">{machinesRenseignees}</p>
            <p className="text-xs text-gray-400">{machinesRenseignees > 0 ? "Renseignez la machine sur chaque lot pour comparer" : "Aucun lot n'indique de machine"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Historique mensuel */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b"><h3 className="font-semibold text-gray-700 text-sm">Évolution mensuelle (6 derniers mois)</h3></div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Mois</TableHead>
                <TableHead className="text-right">Packs produits</TableHead>
                <TableHead className="text-right">Rebuts</TableHead>
                <TableHead className="text-right">Taux rebut</TableHead>
                <TableHead className="text-right">Pertes pannes (est.)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {historiqueMensuel.map((m) => (
                  <TableRow key={m.mois}>
                    <TableCell className="font-medium">{m.label}</TableCell>
                    <TableCell className="text-right">{fmtNumber(m.packs)}</TableCell>
                    <TableCell className="text-right">{m.rebuts > 0 ? fmtNumber(m.rebuts) : "-"}</TableCell>
                    <TableCell className={`text-right ${m.tauxRebut >= 3 ? "text-red-600 font-medium" : ""}`}>{m.packs + m.rebuts > 0 ? `${m.tauxRebut.toFixed(1)}%` : "-"}</TableCell>
                    <TableCell className="text-right text-orange-600">{m.pertesPannes > 0 ? fmtNumber(m.pertesPannes) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Répartition par machine */}
      {machinesRenseignees > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b"><h3 className="font-semibold text-gray-700 text-sm">Répartition par machine / ligne</h3></div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead className="text-right">Lots</TableHead>
                  <TableHead className="text-right">Packs produits</TableHead>
                  <TableHead className="text-right">Rebuts</TableHead>
                  <TableHead className="text-right">Taux rebut</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {machineStats.map((m) => (
                    <TableRow key={m.machine}>
                      <TableCell className={m.machine === "Non renseignée" ? "italic text-gray-400" : "font-medium"}>{m.machine}</TableCell>
                      <TableCell className="text-right">{m.nbLots}</TableCell>
                      <TableCell className="text-right">{fmtNumber(m.packs)}</TableCell>
                      <TableCell className="text-right">{m.rebuts > 0 ? fmtNumber(m.rebuts) : "-"}</TableCell>
                      <TableCell className={`text-right ${m.tauxRebut >= 3 ? "text-red-600 font-medium" : ""}`}>{m.packs + m.rebuts > 0 ? `${m.tauxRebut.toFixed(1)}%` : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filtres avancés */}
      <TableFilters
        config={{
          dateRange: true,
          search: true,
          searchPlaceholder: "Rechercher par N° lot...",
        }}
        values={filters}
        onChange={setFilters}
        resultCount={resultCount}
        totalCount={totalCount}
      />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">N° Lot</TableHead>
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">Machine</TableHead>
                  <TableHead className="text-white font-semibold text-right">Packs</TableHead>
                  <TableHead className="text-white font-semibold text-right">Sachets</TableHead>
                  <TableHead className="text-white font-semibold text-right">Kg</TableHead>
                  <TableHead className="text-white font-semibold">Matière première</TableHead>
                  {isAdmin && <TableHead className="text-white font-semibold">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.paginatedItems.length > 0 ? (
                  pagination.paginatedItems.map((p) => {
                    const fournisseursLies = (p.livraisonIds || [])
                      .map((lid) => DB.livraisons.find((l) => l.id === lid)?.fournisseur)
                      .filter(Boolean);
                    return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono">{p.numero}</TableCell>
                      <TableCell>{fmtDate(p.date)}</TableCell>
                      <TableCell className="text-sm">{p.machine || <span className="text-gray-300">-</span>}</TableCell>
                      <TableCell className="text-right font-medium">
                        {p.packs}
                        {!!p.producteurs?.length && (
                          <p className="text-xs font-normal text-gray-400 mt-0.5">
                            {p.producteurs.map((r) => `${DB.producteurs.find((prod) => prod.id === r.producteurId)?.nom || "?"}: ${r.packs}`).join(", ")}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{p.packs * 30}</TableCell>
                      <TableCell className="text-right">{(p.packs / (DB.params.tauxSachetsParKg || 17)).toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {fournisseursLies.length > 0 ? fournisseursLies.join(", ") : <span className="text-gray-300">-</span>}
                        {!!p.rebuts && p.rebuts > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700" title={p.rebutsNotes || "Rebuts de fabrication"}>
                            <AlertTriangle className="w-3 h-3" /> {p.rebuts} rebut{p.rebuts > 1 ? "s" : ""}
                          </span>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="text-blue-600 hover:bg-blue-50" onClick={() => handleEdit(p.id)} aria-label={`Modifier ${p.numero}`}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(p.id)} aria-label={`Supprimer ${p.numero}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 8 : 7} className="text-center text-gray-400 py-8">
                      {filters.search || filters.dateFrom || filters.dateTo ? "Aucun résultat avec ces filtres" : "Aucun lot de production"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pagination {...pagination} />
        </CardContent>
      </Card>

      {/* Dialog Nouveau/Modifier lot */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier le lot" : "Nouveau lot de production"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>N° Lot</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div>
              <Label>Packs produits</Label>
              <Input type="number" value={packs} onChange={(e) => setPacks(e.target.value)} placeholder="Ex: 100" />
            </div>
            <div>
              <Label>Machine / ligne (optionnel)</Label>
              <Input value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="Ex: Machine 1" list="machine-list" />
              <datalist id="machine-list">{machineNames.map((n) => <option key={n} value={n} />)}</datalist>
            </div>

            <div className="space-y-2 p-3 bg-gray-50 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Répartition par producteur (optionnel)</Label>
              </div>
              {lotProducteurs.length === 0 ? (
                <p className="text-xs text-gray-500">Ce lot est saisi par un seul opérateur (pas de répartition). Ajoutez des producteurs si plusieurs personnes ont travaillé sur ce lot.</p>
              ) : (
                <div className="space-y-2">
                  {lotProducteurs.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select
                        value={row.producteurId}
                        onValueChange={(v) => {
                          const next = [...lotProducteurs];
                          next[i] = { ...next[i], producteurId: v };
                          setLotProducteurs(next);
                        }}
                      >
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Producteur..." /></SelectTrigger>
                        <SelectContent>
                          {DB.producteurs.map((prod) => (
                            <SelectItem key={prod.id} value={prod.id}>{prod.nom}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        className="w-24"
                        placeholder="Packs"
                        value={row.packs}
                        onChange={(e) => {
                          const next = [...lotProducteurs];
                          next[i] = { ...next[i], packs: e.target.value };
                          setLotProducteurs(next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => setLotProducteurs(lotProducteurs.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <p className={`text-xs ${sommeLotProducteurs !== (Number(packs) || 0) ? "text-red-600 font-medium" : "text-green-600 font-medium"}`}>
                    Total réparti : {sommeLotProducteurs} / {Number(packs) || 0} packs
                    {sommeLotProducteurs > (Number(packs) || 0) && " — dépasse le total du lot !"}
                    {sommeLotProducteurs < (Number(packs) || 0) && " — il manque des packs non attribués"}
                    {sommeLotProducteurs === (Number(packs) || 0) && Number(packs) > 0 && " ✓"}
                  </p>
                </div>
              )}
              {DB.producteurs.length === 0 ? (
                <p className="text-xs text-amber-600">Aucun producteur enregistré — ajoutez-en dans la rubrique Producteurs pour utiliser la répartition.</p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLotProducteurs([...lotProducteurs, { producteurId: "", packs: "" }])}
                >
                  <Plus className="w-3 h-3 mr-1" /> Ajouter un producteur
                </Button>
              )}
            </div>

            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-sm text-[#1B4B6B] font-medium">
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Traçabilité &amp; rebuts (optionnel)
            </button>
            {showAdvanced && (
              <div className="space-y-4 p-3 bg-gray-50 rounded-lg border">
                <div>
                  <Label>Livraison(s) de rouleaux consommée(s)</Label>
                  <p className="text-xs text-gray-500 mb-2">Pour remonter jusqu'au fournisseur en cas de problème qualité.</p>
                  <Input value={livraisonSearch} onChange={(e) => setLivraisonSearch(e.target.value)} placeholder="Rechercher par fournisseur ou n°..." className="mb-2 h-8 text-sm" />
                  <div className="max-h-36 overflow-y-auto border rounded-md bg-white divide-y">
                    {livraisonsDisponibles.length > 0 ? livraisonsDisponibles.map((l) => (
                      <label key={l.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={livraisonIds.includes(l.id)}
                          onChange={(e) => setLivraisonIds(e.target.checked ? [...livraisonIds, l.id] : livraisonIds.filter((id) => id !== l.id))}
                        />
                        <span className="flex-1">{l.numero} — {l.fournisseur} ({fmtDate(l.date)})</span>
                      </label>
                    )) : <p className="text-xs text-gray-400 p-2">Aucune livraison trouvée</p>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Rebuts (sachets rejetés)</Label><Input type="number" value={rebuts} onChange={(e) => setRebuts(e.target.value)} placeholder="Optionnel" /></div>
                </div>
                {rebuts && Number(rebuts) > 0 && (
                  <div><Label>Notes rebuts</Label><Textarea value={rebutsNotes} onChange={(e) => setRebutsNotes(e.target.value)} placeholder="Ex: défaut de soudure, machine mal réglée..." rows={2} /></div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">
                {editId ? "Modifier" : "Enregistrer"}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Supprimer ce lot ?"
        description="Le lot sera déplacé dans la corbeille."
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
