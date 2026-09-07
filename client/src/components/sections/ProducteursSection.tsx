import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmtNumber, getMoisCourant, moisLabel, premierMoisAvecDonnees, toLocalDateStr, packsProducteurPeriode } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, BarChart3, Calendar, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { creerMouvementProduction, creerMouvementConsommation } from "@/lib/stock";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MonthSelector } from "@/components/MonthSelector";

// Helpers pour les dates
function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Lundi = début de semaine
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekLabel(date: Date): string {
  const start = getStartOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmtDate = (d: Date) => `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

function getMonthLabel(date: Date): string {
  const mois = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  return `${mois[date.getMonth()]} ${date.getFullYear()}`;
}

function isSameWeek(d1: Date, d2: Date): boolean {
  const s1 = getStartOfWeek(d1).getTime();
  const s2 = getStartOfWeek(d2).getTime();
  return s1 === s2;
}

function isSameMonth(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

export default function ProducteursSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const producteurs = DB.producteurs || [];
  const production = DB.production || [];
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [tel, setTel] = useState("");
  const [objectif, setObjectif] = useState("");
  const [selectedProducteur, setSelectedProducteur] = useState<string | null>(null);
  const [prodInputs, setProdInputs] = useState<Record<string, string>>({});
  const [editProdId, setEditProdId] = useState<string | null>(null);
  const [editProdPacks, setEditProdPacks] = useState("");
  const [expandedProd, setExpandedProd] = useState<string | null>(null);
  const isAdmin = currentUser?.role === "admin" || currentUser?.roles?.includes("admin");
  // Mois consulté pour l'objectif/pourcentage par producteur (colonne
  // "Objectif du mois" du tableau) — indépendant de la saisie du jour
  // ci-dessous, qui reste toujours pour aujourd'hui.
  const [moisObjectif, setMoisObjectif] = useState(getMoisCourant());
  // Pas de mois vides antérieurs à la première saisie de production.
  const minMoisObjectif = useMemo(() => premierMoisAvecDonnees(production.map((p) => p.date)), [production]);

  const today = new Date();
  const todayStr = toLocalDateStr(today);

  // Calculs de production par période
  const stats = useMemo(() => {
    const nbProducteurs = producteurs.length || 1;
    const prodJour = production
      .filter((pr) => pr.date === todayStr)
      .reduce((s, pr) => s + pr.packs, 0);

    const prodSemaine = production
      .filter((pr) => isSameWeek(new Date(pr.date), today))
      .reduce((s, pr) => s + pr.packs, 0);

    const prodMois = production
      .filter((pr) => isSameMonth(new Date(pr.date), today))
      .reduce((s, pr) => s + pr.packs, 0);

    return { prodJour, prodSemaine, prodMois, nbProducteurs };
  }, [production, producteurs.length, todayStr]);

  // Historique hebdomadaire (4 dernières semaines)
  const historiqueHebdo = useMemo(() => {
    const weeks: { label: string; total: number; parProducteur: number }[] = [];
    const nbProducteurs = producteurs.length || 1;
    for (let i = 0; i < 4; i++) {
      const weekStart = getStartOfWeek(new Date());
      weekStart.setDate(weekStart.getDate() - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const total = production
        .filter((pr) => {
          const d = new Date(pr.date);
          return d >= weekStart && d <= weekEnd;
        })
        .reduce((s, pr) => s + pr.packs, 0);
      weeks.push({
        label: i === 0 ? `${getWeekLabel(weekStart)} (en cours)` : getWeekLabel(weekStart),
        total,
        parProducteur: Math.round(total / nbProducteurs),
      });
    }
    return weeks;
  }, [production, producteurs.length]);

  // Historique mensuel (6 derniers mois)
  const historiqueMensuel = useMemo(() => {
    const months: { label: string; total: number; parProducteur: number; joursActifs: number }[] = [];
    const nbProducteurs = producteurs.length || 1;
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const total = production
        .filter((pr) => isSameMonth(new Date(pr.date), d))
        .reduce((s, pr) => s + pr.packs, 0);
      const joursActifs = new Set(
        production
          .filter((pr) => isSameMonth(new Date(pr.date), d))
          .map((pr) => pr.date)
      ).size;
      months.push({
        label: i === 0 ? `${getMonthLabel(d)} (en cours)` : getMonthLabel(d),
        total,
        parProducteur: Math.round(total / nbProducteurs),
        joursActifs,
      });
    }
    return months;
  }, [production, producteurs.length]);

  // Détail journalier pour un producteur sélectionné (7 derniers jours)
  const detailJournalier = useMemo(() => {
    const nbProducteurs = producteurs.length || 1;
    const jours: { date: string; label: string; total: number; parProducteur: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateStr(d);
      const jourNoms = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
      const total = production
        .filter((pr) => pr.date === dateStr)
        .reduce((s, pr) => s + pr.packs, 0);
      jours.push({
        date: dateStr,
        label: i === 0 ? "Aujourd'hui" : i === 1 ? "Hier" : `${jourNoms[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`,
        total,
        parProducteur: Math.round(total / nbProducteurs),
      });
    }
    return jours;
  }, [production, producteurs.length]);

  const handleOpen = (id?: string) => {
    if (id) {
      const p = producteurs.find((x) => x.id === id);
      if (!p) return;
      setEditId(id);
      setNom(p.nom);
      setTel(p.tel);
      setObjectif(String(p.objectif || ""));
    } else {
      setEditId(null);
      setNom("");
      setTel("");
      setObjectif("");
    }
    setOpen(true);
  };

  const handleSave = () => {
    if (!nom.trim()) { toast.error("Nom requis"); return; }
    if (tel && tel.length !== 9) { toast.error("Le numéro de téléphone doit contenir exactement 9 chiffres"); return; }
    const nomNorm = nom.trim().toLowerCase();
    const telNorm = tel.trim();
    const duplicate = producteurs.find((p) =>
      p.id !== editId &&
      p.nom.trim().toLowerCase() === nomNorm &&
      (p.tel || "").trim() === telNorm
    );
    if (duplicate) {
      if (!telNorm) {
        toast.error("Un producteur avec ce nom existe déjà (ajoutez un numéro de téléphone pour différencier)");
      } else {
        toast.error("Un producteur avec ce nom et ce numéro existe déjà");
      }
      return;
    }
    if (editId) {
      const updated = { ...DB, producteurs: producteurs.map((p) => p.id === editId ? { ...p, nom: nom.trim(), tel, objectif: Number(objectif) || 0 } : p) };
      setDB(updated); saveDB(updated); logActivity("update", "Producteur", nom); toast.success("Modifié");
    } else {
      const updated = { ...DB, producteurs: [...producteurs, { id: uid(), nom: nom.trim(), tel, objectif: Number(objectif) || 0 }] };
      setDB(updated); saveDB(updated); logActivity("create", "Producteur", nom); toast.success("Producteur ajouté");
    }
    setOpen(false);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? producteurs.find((p) => p.id === deleteId) || null : null;

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    const updated = {
      ...DB,
      producteurs: producteurs.filter((p) => p.id !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "producteurs", moduleName: "Producteur", desc: item.nom, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }]
    };
    setDB(updated); saveDB(updated); logActivity("delete", "Producteur", item.nom); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  // Suppression d'une saisie de production individuelle (sous-tableau)
  const [deleteProdId, setDeleteProdId] = useState<string | null>(null);
  const deleteProdTarget = deleteProdId ? production.find((pr) => pr.id === deleteProdId) || null : null;

  const confirmDeleteProd = () => {
    const pr = deleteProdTarget; if (!pr) return;
    const clotureMsg = checkCloture(pr.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); setDeleteProdId(null); return; }
    const p = producteurs.find((x) => x.id === pr.producteurId);
    const mvtLies = (DB.mouvementsStock || []).filter((m: any) => m.reference === pr.id && (m.type === "production" || m.type === "consommation"));
    let updated = {
      ...DB,
      production: production.filter((x) => x.id !== pr.id),
      mouvementsStock: (DB.mouvementsStock || []).filter((m: any) => !(m.reference === pr.id && (m.type === "production" || m.type === "consommation"))),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "production", moduleName: "Production", desc: pr.numero, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: pr, relatedMouvements: mvtLies }],
    };
    const histEntry = deleteHistoryEntry("Production", pr.id, pr.numero, pr as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("delete", "Production", `${p?.nom || ""}: ${pr.packs} packs supprimés`);
    toast.success("Mis à la corbeille");
    setDeleteProdId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Producteurs</h2>
          <p className="text-sm text-gray-500">{producteurs.length} producteur(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector value={moisObjectif} onChange={setMoisObjectif} minMois={minMoisObjectif} />
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
            <Plus className="w-4 h-4 mr-2" /> Nouveau
          </Button>
        </div>
      </div>

      {/* Cartes résumé */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Production du jour</p>
                <p className="text-xl font-bold text-gray-900">{fmtNumber(stats.prodJour)} <span className="text-sm font-normal">packs</span></p>
                <p className="text-xs text-gray-400">≈ {fmtNumber(Math.round(stats.prodJour / stats.nbProducteurs))} / producteur</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Cette semaine</p>
                <p className="text-xl font-bold text-gray-900">{fmtNumber(stats.prodSemaine)} <span className="text-sm font-normal">packs</span></p>
                <p className="text-xs text-gray-400">≈ {fmtNumber(Math.round(stats.prodSemaine / stats.nbProducteurs))} / producteur</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Ce mois</p>
                <p className="text-xl font-bold text-gray-900">{fmtNumber(stats.prodMois)} <span className="text-sm font-normal">packs</span></p>
                <p className="text-xs text-gray-400">≈ {fmtNumber(Math.round(stats.prodMois / stats.nbProducteurs))} / producteur</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tableau des producteurs */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Tél</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Aujourd'hui</TableHead>
                  <TableHead>Saisir packs du jour</TableHead>
                  <TableHead className="text-right">Objectif du mois</TableHead>
                  <TableHead className="text-right">Réalisé — {moisLabel(moisObjectif)}</TableHead>
                  <TableHead>Atteinte</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {producteurs.length > 0 ? producteurs.map((p) => {
                  // Production individuelle du producteur aujourd'hui (saisie rapide
                  // ET part de ce producteur dans un lot partagé — voir
                  // packsProducteurPeriode() dans helpers.ts)
                  const prodIndividuelle = packsProducteurPeriode(production, p.id, (d) => d === todayStr);
                  // Production individuelle du producteur sur le mois consulté
                  // (colonne "Objectif du mois" — indépendante de la saisie du jour ci-dessus)
                  const prodMoisIndividuelle = packsProducteurPeriode(production, p.id, (d) => (d || "").startsWith(moisObjectif));
                  const obj = Number(p.objectif) || 0;
                  const pct = obj > 0 ? Math.round((prodMoisIndividuelle / obj) * 100) : 0;
                  const prodsJour = production.filter((pr) => pr.date === todayStr && pr.producteurId === p.id);
                  return (
                    <>
                    <TableRow key={p.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setExpandedProd(expandedProd === p.id ? null : p.id)}>
                      <TableCell className="font-medium">{p.nom}</TableCell>
                      <TableCell>{p.tel || "-"}</TableCell>
                      <TableCell>{todayStr}</TableCell>
                      <TableCell className="text-right font-bold">{fmtNumber(prodIndividuelle)} packs {prodsJour.length > 0 && <span className="text-xs text-gray-400">({prodsJour.length} saisie{prodsJour.length > 1 ? "s" : ""})</span>}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            className="w-24 h-8"
                            placeholder="0"
                            value={prodInputs[p.id] || ""}
                            onChange={(e) => setProdInputs({ ...prodInputs, [p.id]: e.target.value })}
                          />
                          <Button
                            size="sm"
                            className="h-8 bg-[#1B4B6B] hover:bg-[#0d4a85]"
                            onClick={() => {
                              const packs = Number(prodInputs[p.id]);
                              if (!packs || packs <= 0) { toast.error("Nombre de packs invalide"); return; }
                              // Vérifier la clôture (même garde-fou que le lot machine)
                              const clotureMsg = checkCloture(todayStr, DB, currentUser?.role || "lecteur");
                              if (clotureMsg) { toast.error(clotureMsg); return; }
                              const numero = `PROD-${Date.now()}`;
                              const newProd = { id: uid(), numero, date: todayStr, packs, producteurId: p.id };
                              // Synchroniser le stock (entrée sachets + consommation matière première),
                              // exactement comme pour un lot machine — sans quoi le stock rouleaux/sachets
                              // suivi par mouvementsStock se désynchronise silencieusement de DB.production.
                              const mvtProd = creerMouvementProduction(uid(), todayStr, packs, currentUser?.nom || "", newProd.id, `Production ${p.nom} (${numero})`);
                              const kgConsomme = packs / (DB.params.tauxSachetsParKg || 17);
                              const mvtConso = creerMouvementConsommation(uid(), todayStr, Math.round(kgConsomme * 100) / 100, currentUser?.nom || "", newProd.id, `Production ${p.nom} (${numero})`);
                              let updated = { ...DB, production: [...production, newProd], mouvementsStock: [...(DB.mouvementsStock || []), mvtProd, mvtConso] };
                              const histEntry = createHistoryEntry("Production", newProd.id, numero, newProd as any, currentUser?.nom || "", undefined, FIELD_LABELS);
                              updated = addHistoryEntry(updated, histEntry);
                              setDB(updated); saveDB(updated);
                              logActivity("create", "Production", `${p.nom}: ${packs} packs`);
                              toast.success(`${packs} packs enregistrés pour ${p.nom}`);
                              setProdInputs({ ...prodInputs, [p.id]: "" });
                            }}
                          >
                            OK
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{obj > 0 ? `${obj} packs` : "-"}</TableCell>
                      <TableCell className="text-right font-medium">{fmtNumber(prodMoisIndividuelle)} packs</TableCell>
                      <TableCell>
                        {obj > 0 ? (
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(pct, 100)} className="w-16 h-2" />
                            <span className={`text-xs font-bold ${pct >= 100 ? "text-green-600" : pct >= 75 ? "text-blue-600" : "text-orange-600"}`}>{pct}%</span>
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="outline" size="sm" onClick={() => handleOpen(p.id)}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(p.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {/* Sous-tableau des productions du jour pour ce producteur */}
                    {expandedProd === p.id && prodsJour.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-gray-50 p-2">
                          <div className="pl-4">
                            <p className="text-xs font-semibold text-gray-600 mb-2">Détail des saisies du jour pour {p.nom} :</p>
                            <div className="space-y-1">
                              {prodsJour.map((pr) => (
                                <div key={pr.id} className="flex items-center gap-2 bg-white rounded px-3 py-1.5 border">
                                  {editProdId === pr.id ? (
                                    <>
                                      <Input
                                        type="number"
                                        className="w-24 h-7 text-sm"
                                        value={editProdPacks}
                                        onChange={(e) => setEditProdPacks(e.target.value)}
                                      />
                                      <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => {
                                        if (!isAdmin) { toast.error("Seul l'administrateur peut modifier une production"); return; }
                                        const newPacks = Number(editProdPacks);
                                        if (!newPacks || newPacks <= 0) { toast.error("Nombre invalide"); return; }
                                        const clotureMsg = checkCloture(pr.date, DB, currentUser?.role || "lecteur");
                                        if (clotureMsg) { toast.error(clotureMsg); return; }
                                        const newItem = { ...pr, packs: newPacks };
                                        const kgConsomme = newPacks / (DB.params.tauxSachetsParKg || 17);
                                        let updated = {
                                          ...DB,
                                          production: production.map((x) => x.id === pr.id ? newItem : x),
                                          mouvementsStock: (DB.mouvementsStock || []).map((m: any) => {
                                            if (m.reference !== pr.id) return m;
                                            if (m.type === "production" && m.produit === "sachet_plein") return { ...m, quantite: newPacks };
                                            if (m.type === "consommation" && m.produit === "rouleau_plastique") return { ...m, quantite: Math.round(kgConsomme * 100) / 100 };
                                            return m;
                                          }),
                                        };
                                        const histEntry = updateHistoryEntry("Production", pr.id, pr.numero, pr as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
                                        if (histEntry) updated = addHistoryEntry(updated, histEntry);
                                        setDB(updated); saveDB(updated);
                                        logActivity("update", "Production", `${p.nom}: ${pr.packs} → ${newPacks} packs`);
                                        toast.success("Production modifiée");
                                        setEditProdId(null);
                                      }}>OK</Button>
                                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditProdId(null)}>Annuler</Button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-sm font-medium flex-1">{pr.packs} packs</span>
                                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditProdId(pr.id); setEditProdPacks(String(pr.packs)); }}>
                                        <Pencil className="w-3 h-3" />
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 hover:bg-red-50" onClick={() => {
                                        if (!isAdmin) { toast.error("Seul l'administrateur peut supprimer une production"); return; }
                                        setDeleteProdId(pr.id);
                                      }}>
                                        <Trash2 className="w-3 h-3" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-gray-400 py-8">Aucun producteur</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Historique de production */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="w-5 h-5 text-[#1B4B6B]" />
            Historique de production
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="journalier">
            <TabsList className="mb-4">
              <TabsTrigger value="journalier">7 derniers jours</TabsTrigger>
              <TabsTrigger value="hebdo">Hebdomadaire</TabsTrigger>
              <TabsTrigger value="mensuel">Mensuel</TabsTrigger>
            </TabsList>

            <TabsContent value="journalier">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jour</TableHead>
                      <TableHead className="text-right">Production totale</TableHead>
                      <TableHead className="text-right">Par producteur</TableHead>
                      <TableHead>Barre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailJournalier.map((j) => {
                      const maxJour = Math.max(...detailJournalier.map((x) => x.total), 1);
                      const pctBar = Math.round((j.total / maxJour) * 100);
                      return (
                        <TableRow key={j.date}>
                          <TableCell className="font-medium">{j.label}</TableCell>
                          <TableCell className="text-right font-bold">{fmtNumber(j.total)} packs</TableCell>
                          <TableCell className="text-right">{fmtNumber(j.parProducteur)} packs</TableCell>
                          <TableCell className="w-40">
                            <div className="w-full bg-gray-100 rounded-full h-3">
                              <div className="bg-blue-500 h-3 rounded-full transition-all" style={{ width: `${pctBar}%` }} />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="hebdo">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Semaine</TableHead>
                      <TableHead className="text-right">Production totale</TableHead>
                      <TableHead className="text-right">Par producteur</TableHead>
                      <TableHead>Barre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historiqueHebdo.map((w, i) => {
                      const maxWeek = Math.max(...historiqueHebdo.map((x) => x.total), 1);
                      const pctBar = Math.round((w.total / maxWeek) * 100);
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{w.label}</TableCell>
                          <TableCell className="text-right font-bold">{fmtNumber(w.total)} packs</TableCell>
                          <TableCell className="text-right">{fmtNumber(w.parProducteur)} packs</TableCell>
                          <TableCell className="w-40">
                            <div className="w-full bg-gray-100 rounded-full h-3">
                              <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${pctBar}%` }} />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="mensuel">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mois</TableHead>
                      <TableHead className="text-right">Production totale</TableHead>
                      <TableHead className="text-right">Par producteur</TableHead>
                      <TableHead className="text-right">Jours actifs</TableHead>
                      <TableHead>Barre</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historiqueMensuel.map((m, i) => {
                      const maxMonth = Math.max(...historiqueMensuel.map((x) => x.total), 1);
                      const pctBar = Math.round((m.total / maxMonth) * 100);
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{m.label}</TableCell>
                          <TableCell className="text-right font-bold">{fmtNumber(m.total)} packs</TableCell>
                          <TableCell className="text-right">{fmtNumber(m.parProducteur)} packs</TableCell>
                          <TableCell className="text-right">{m.joursActifs} jour(s)</TableCell>
                          <TableCell className="w-40">
                            <div className="w-full bg-gray-100 rounded-full h-3">
                              <div className="bg-purple-500 h-3 rounded-full transition-all" style={{ width: `${pctBar}%` }} />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier" : "Nouveau producteur"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>Nom</Label><Input value={nom} onChange={(e) => setNom(e.target.value)} /></div>
            <div><Label>Téléphone (9 chiffres)</Label><Input type="tel" inputMode="numeric" maxLength={9} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, ''))} placeholder="771234567" />{tel && tel.length !== 9 && <p className="text-xs text-red-500 mt-1">{tel.length}/9 chiffres</p>}</div>
            <div>
              <Label>Objectif mensuel (packs/mois)</Label>
              <Input type="number" value={objectif} onChange={(e) => setObjectif(e.target.value)} placeholder="Ex: 2500" />
              <p className="text-xs text-gray-400 mt-1">Anciennement un objectif journalier — si ce producteur avait déjà une valeur, pensez à la remplacer par un objectif mensuel (ex: journalier × jours travaillés/mois).</p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Enregistrer</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer ce producteur ?"
        description={deleteTarget ? `${deleteTarget.nom}. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={!!deleteProdId}
        onOpenChange={(o) => !o && setDeleteProdId(null)}
        title="Supprimer cette saisie de production ?"
        description={deleteProdTarget ? `${deleteProdTarget.packs} packs (${deleteProdTarget.numero}). Cette entrée et ses mouvements de stock liés seront déplacés vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDeleteProd}
      />
    </div>
  );
}
