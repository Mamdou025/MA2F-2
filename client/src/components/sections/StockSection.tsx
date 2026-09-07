import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmtNumber, fmtDate, todayLocal, toLocalDateStr } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Package, ArrowDown, ArrowUp, RotateCcw, AlertTriangle, Truck, Factory, Warehouse,
  Plus, Search, Calendar, TrendingUp, TrendingDown, Filter, Download, Eye, X, ClipboardCheck, Wrench, RefreshCw, ShieldAlert,
} from "lucide-react";
import type { MouvementStock, ProduitType, Emplacement } from "@/lib/stock";
import {
  calculerStockParEmplacement, getProduitLabel, getProduitUnite,
  creerMouvementCasse, creerMouvementDonPolice, creerMouvementAjustement, creerMouvementChargement, creerMouvementRetourCamion,
  creerMouvementOuverture,
} from "@/lib/stock";
import type { StockControle } from "@/lib/types";
import { createHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";

// Helpers de dates
const todayStr = () => todayLocal();
const startOfWeek = () => {
  const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1);
  return toLocalDateStr(d);
};
const startOfMonth = () => {
  const d = new Date(); d.setDate(1);
  return toLocalDateStr(d);
};

type PeriodFilter = "today" | "week" | "month" | "all" | "custom";

export default function StockSection() {
  const { DB, setDB, saveDB, currentUser, logActivity } = useApp();
  const [tab, setTab] = useState<"stock" | "mouvements" | "chargement" | "controle">("stock");
  const [openAjust, setOpenAjust] = useState(false);
  const [openChargement, setOpenChargement] = useState(false);
  const [openControle, setOpenControle] = useState(false);
  const [openDetail, setOpenDetail] = useState<MouvementStock | null>(null);

  // Formulaire contrôle stock usine (comptage physique)
  const [controleProduit, setControleProduit] = useState<"sachet_plein" | "rouleau_plastique">("sachet_plein");
  const [controleDate, setControleDate] = useState(todayStr());
  const [controleStockCompte, setControleStockCompte] = useState("");
  const [controleExplication, setControleExplication] = useState("");
  const [controleAjuster, setControleAjuster] = useState(true);

  // Filtres avancés
  const [filterProduit, setFilterProduit] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterEmplacement, setFilterEmplacement] = useState<string>("all");
  const [filterPeriod, setFilterPeriod] = useState<PeriodFilter>("month");
  const [filterDateStart, setFilterDateStart] = useState(startOfMonth());
  const [filterDateEnd, setFilterDateEnd] = useState(todayStr());
  const [searchQuery, setSearchQuery] = useState("");

  // Formulaire ajustement/casse/don police
  const [ajustType, setAjustType] = useState<"ajustement" | "casse" | "don_police">("ajustement");
  const [ajustProduit, setAjustProduit] = useState<ProduitType>("sachet_plein");
  const [ajustEmplacement, setAjustEmplacement] = useState<string>("usine");
  const [ajustQuantite, setAjustQuantite] = useState("");
  const [ajustSens, setAjustSens] = useState<"entree" | "sortie">("entree");
  const [ajustNotes, setAjustNotes] = useState("");
  const [ajustLivreurId, setAjustLivreurId] = useState<string>("");

  // Formulaire chargement
  const [chargVehicule, setChargVehicule] = useState("");
  const [chargLivreur, setChargLivreur] = useState("");
  const [chargQuantite, setChargQuantite] = useState("");
  const [chargDirection, setChargDirection] = useState<"chargement" | "retour">("chargement");

  const mouvements: MouvementStock[] = (DB.mouvementsStock || []) as MouvementStock[];
  const stockActuel = useMemo(() => calculerStockParEmplacement(mouvements), [mouvements]);
  // Rouleau plastique (kg) volontairement exclu de l'affichage "Stock actuel" — retiré à la demande de l'utilisateur.
  const stockActuelAffiche = useMemo(() => stockActuel.filter(s => s.produit !== "rouleau_plastique"), [stockActuel]);

  const isAdmin = currentUser?.role === "admin" || currentUser?.roles?.includes("admin");
  // Le caissier a accès à la rubrique Stock (pour la consulter) mais ne doit
  // pouvoir y modifier qu'une seule chose : ajouter un don de packs à la
  // police (Ajustement/Casse/Don police → onglet "Don police" uniquement).
  // Comptage physique, Chargement/Retour, Ajustement, Casse/Perte et Nouveau
  // départ restent réservés à l'admin (voir isAdmin) — un admin qui a aussi
  // le rôle caissier garde l'accès complet.
  const isCaissierRestreint = !isAdmin && (currentUser?.role === "caissier" || currentUser?.roles?.includes("caissier"));

  // getEmplacementLabel() (lib/stock.ts) ne connaît pas les véhicules — pour un
  // emplacement "camion_<id>" elle renvoie toujours l'identifiant technique brut
  // (ex: "Camion c7-xs0ZnrX"), jamais le nom lisible du camion (ex: "VEC-1").
  // Ça avait fini par faire croire à un camion "fantôme"/supprimé alors qu'il
  // s'agissait simplement de VEC-1 affiché sous son id brut. On résout ici le
  // nom du véhicule quand c'est possible, avec repli sur le libellé brut sinon
  // (camion réellement supprimé, dépôt, usine...).
  const emplacementLabel = (emplacement: string, fallback: string) => {
    if (emplacement.startsWith("camion_")) {
      const vehiculeId = emplacement.replace("camion_", "");
      const v = DB.vehicules.find((v) => v.id === vehiculeId);
      if (v) return `Camion ${v.nom}`;
    }
    return fallback;
  };

  // Chargements du jour : une fois qu'un camion a retrouvé un solde à 0, il
  // disparaît de "Stock actuel" (qui masque les emplacements à solde nul) —
  // sans ça, rien ne montre plus qu'un camion est parti chargé aujourd'hui.
  // On liste ici tous les mouvements de type "chargement" datés d'aujourd'hui,
  // qui restent la preuve permanente qu'un camion a bien reçu son chargement,
  // indépendamment de son solde actuel.
  const chargementsAujourdhui = useMemo(
    () =>
      mouvements
        .filter((m) => m.type === "chargement" && m.date === todayStr())
        .map((m) => ({
          ...m,
          camionNom: DB.vehicules.find((v) => v.id === m.vehiculeId)?.nom || m.vehiculeId || "Camion inconnu",
          livreurNom: DB.livreurs.find((l) => l.id === m.livreurId)?.nom || "—",
          heure: m.timestamp ? new Date(m.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "",
        }))
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")),
    [mouvements, DB.vehicules, DB.livreurs]
  );

  // Alerte camions à solde négatif : un solde camion négatif signifie presque
  // toujours qu'un Chargement n'a pas été saisi (ou saisi pour une quantité
  // insuffisante) avant que les ventes de ce camion ne soient enregistrées.
  // Sans cette alerte visible en permanence en haut de la page, l'écart ne se
  // voit qu'en ouvrant l'onglet "Stock actuel" — il peut donc s'accumuler
  // plusieurs jours avant d'être remarqué (cas vécu sur VEC-1/VEC-2).
  const camionsSoldeNegatif = useMemo(
    () =>
      stockActuel
        .filter((s) => s.type === "camion" && s.produit === "sachet_plein" && s.quantite < 0)
        .map((s) => ({ ...s, label: emplacementLabel(s.emplacement, s.label) }))
        .sort((a, b) => a.quantite - b.quantite),
    [stockActuel, DB.vehicules]
  );

  // ─── Réparation : mouvements de stock avec un emplacement "camion_<id>"
  // qui référence en réalité un ID de LIVREUR (et non de véhicule). Bug
  // historique de VentesSection.tsx (corrigé le 2026-08-03, voir CLAUDE.md
  // "Bug stock camions") : les ventes livrées créaient un emplacement
  // fictif "camion_<id du livreur>" jamais approvisionné par les
  // chargements (qui créditent "camion_<id du VEHICULE>"), rendant les
  // soldes camions négatifs et le stock usine surévalué. Cet outil détecte
  // ces mouvements mal orientés et propose de les rattacher au bon
  // emplacement : le camion assigné au livreur si renseigné, sinon l'usine.
  const [openRepair, setOpenRepair] = useState(false);
  const vehiculeIds = useMemo(() => new Set(DB.vehicules.map(v => v.id)), [DB.vehicules]);
  const livreurById = useMemo(() => new Map(DB.livreurs.map(l => [l.id, l] as const)), [DB.livreurs]);

  interface RepairItem { mouvementId: string; field: "emplacementSource" | "emplacementDest"; oldValue: string; newValue: string; livreurNom: string; date: string; type: string; quantite: number; unite: string }
  const repairPlan: RepairItem[] = useMemo(() => {
    const plan: RepairItem[] = [];
    for (const m of mouvements) {
      (["emplacementSource", "emplacementDest"] as const).forEach((field) => {
        const val = m[field];
        if (!val || !val.startsWith("camion_")) return;
        const idPart = val.replace("camion_", "");
        if (vehiculeIds.has(idPart)) return; // déjà un vrai emplacement véhicule, rien à faire
        const livreur = livreurById.get(idPart);
        if (!livreur) return; // ID inconnu (ni véhicule ni livreur) : à examiner manuellement, on ne touche pas
        const newValue = livreur.vehiculeId ? `camion_${livreur.vehiculeId}` : "usine";
        if (newValue === val) return;
        plan.push({ mouvementId: m.id, field, oldValue: val, newValue, livreurNom: livreur.nom, date: m.date, type: m.type, quantite: m.quantite, unite: m.unite });
      });
    }
    return plan;
  }, [mouvements, vehiculeIds, livreurById]);
  const repairMouvementCount = new Set(repairPlan.map(p => p.mouvementId)).size;

  const handleRepair = () => {
    if (repairPlan.length === 0) return;
    const changesByMvt = new Map<string, Partial<Record<"emplacementSource" | "emplacementDest", string>>>();
    for (const p of repairPlan) {
      const existing = changesByMvt.get(p.mouvementId) || {};
      existing[p.field] = p.newValue;
      changesByMvt.set(p.mouvementId, existing);
    }
    const updatedMouvements = mouvements.map(m => {
      const changes = changesByMvt.get(m.id);
      return changes ? { ...m, ...changes } : m;
    });
    const updated = { ...DB, mouvementsStock: updatedMouvements };
    setDB(updated); saveDB(updated);
    logActivity("update", "Stock", `Réparation stock : ${repairMouvementCount} mouvement(s) réaffecté(s) d'un emplacement "camion_<id livreur>" incorrect vers le bon emplacement`);
    toast.success(`${repairMouvementCount} mouvement(s) corrigé(s)`);
    setOpenRepair(false);
  };

  // ─── Nouveau départ (réinitialisation du stock) ─────────────────────────
  // Demandé quand l'historique de mouvements devient illisible/incohérent
  // (ex: après le bug camions ci-dessus) : au lieu de continuer à rejouer un
  // journal qui ne correspond plus à la réalité, on archive tout ce qui
  // existe (conservé pour consultation, exclu du calcul du stock) et on pose
  // un nouveau solde d'ouverture, daté d'aujourd'hui, à partir d'un
  // comptage physique réel saisi par l'admin. Tout ce qui se passera ensuite
  // (production, ventes, chargements...) continue de s'accumuler normalement
  // par-dessus ce nouveau départ.
  const [openReset, setOpenReset] = useState(false);
  const [resetConfirme, setResetConfirme] = useState(false);
  interface ResetRow { key: string; emplacement: string; produit: ProduitType; label: string; valeur: string }
  const [resetRows, setResetRows] = useState<ResetRow[]>([]);
  const [includeArchive, setIncludeArchive] = useState(false);
  const mouvementsArchive: MouvementStock[] = (DB.mouvementsStockArchive || []) as MouvementStock[];

  const buildResetRows = (): ResetRow[] => {
    const rows: ResetRow[] = [];
    const seen = new Set<string>();
    const push = (emplacement: string, produit: ProduitType, label: string) => {
      const key = `${emplacement}|${produit}`;
      if (seen.has(key)) return;
      seen.add(key);
      const current = stockActuel.find(s => s.emplacement === emplacement && s.produit === produit);
      rows.push({ key, emplacement, produit, label, valeur: current ? String(current.quantite) : "0" });
    };
    push("usine", "sachet_plein", "Usine — Sachets pleins (packs)");
    push("depot", "sachet_plein", "Dépôt — Sachets pleins (packs)");
    DB.vehicules.forEach(v => push(`camion_${v.id}`, "sachet_plein", `Camion ${v.nom} — Sachets pleins (packs)`));
    // Tout autre emplacement/produit avec un solde actuel non couvert ci-dessus (ex: casiers, emplacements client).
    // Rouleau plastique (kg) volontairement exclu : non suivi dans Gestion du Stock (retiré à la demande de l'utilisateur).
    stockActuel.filter(s => s.produit !== "rouleau_plastique").forEach(s => push(s.emplacement, s.produit, `${s.label} — ${getProduitLabel(s.produit)}`));
    return rows;
  };

  const handleOpenReset = () => {
    setResetRows(buildResetRows());
    setResetConfirme(false);
    setOpenReset(true);
  };

  const handleReset = () => {
    if (!resetConfirme) { toast.error("Confirme avoir vérifié physiquement ces quantités"); return; }
    const today = todayStr();
    const nouveauxMouvements = resetRows
      .filter(r => Number(r.valeur) !== 0 && !isNaN(Number(r.valeur)))
      .map(r => creerMouvementOuverture(uid(), today, Number(r.valeur), r.produit, r.emplacement as Emplacement, currentUser?.nom || "", "Nouveau départ — réinitialisation du stock"));

    const archivedCount = mouvements.length;
    const updated = {
      ...DB,
      mouvementsStockArchive: [...mouvementsArchive, ...mouvements],
      mouvementsStock: nouveauxMouvements,
    };
    setDB(updated); saveDB(updated);
    logActivity("update", "Stock", `Nouveau départ : ${archivedCount} mouvement(s) archivé(s), nouveau solde d'ouverture posé le ${today} sur ${nouveauxMouvements.length} emplacement(s)`);
    toast.success(`Stock réinitialisé — ${archivedCount} ancien(s) mouvement(s) archivé(s)`);
    setOpenReset(false);
  };

  // ─── Contrôle stock usine (comptage physique vs théorique) ─────────────
  const stockControles: StockControle[] = (DB.stockControles || []) as StockControle[];
  const historiqueControles = useMemo(
    () => [...stockControles].sort((a, b) => (b.compteLe || b.date).localeCompare(a.compteLe || a.date)),
    [stockControles]
  );
  const stockTheoriqueUsine = (produit: "sachet_plein" | "rouleau_plastique") =>
    stockActuel.filter(s => s.type === "usine" && s.produit === produit).reduce((a, s) => a + s.quantite, 0);
  const controleTheorique = useMemo(() => stockTheoriqueUsine(controleProduit), [stockActuel, controleProduit]);
  const controleEcart = (Number(controleStockCompte) || 0) - controleTheorique;

  const dernierControlePar = (produit: "sachet_plein" | "rouleau_plastique"): StockControle | null =>
    historiqueControles.find(c => c.produit === produit) || null;

  const joursDepuisControle = (produit: "sachet_plein" | "rouleau_plastique"): number | null => {
    const dernier = dernierControlePar(produit);
    if (!dernier) return null;
    const diff = Date.now() - new Date(dernier.compteLe || dernier.date).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const SEUIL_ALERTE_CONTROLE_JOURS = 7;
  const produitsSansControleRecent = useMemo(() => {
    // Rouleau plastique (kg) volontairement exclu du suivi de Gestion du Stock (retiré à la demande de l'utilisateur).
    const produits: ("sachet_plein" | "rouleau_plastique")[] = ["sachet_plein"];
    return produits
      .map(p => ({ produit: p, jours: joursDepuisControle(p) }))
      .filter(x => x.jours === null || x.jours > SEUIL_ALERTE_CONTROLE_JOURS);
  }, [historiqueControles]);

  // Calcul des dates de filtre
  const dateRange = useMemo(() => {
    switch (filterPeriod) {
      case "today": return { start: todayStr(), end: todayStr() };
      case "week": return { start: startOfWeek(), end: todayStr() };
      case "month": return { start: startOfMonth(), end: todayStr() };
      case "custom": return { start: filterDateStart, end: filterDateEnd };
      default: return { start: "", end: "" };
    }
  }, [filterPeriod, filterDateStart, filterDateEnd]);

  const filteredMouvements = useMemo(() => {
    // (a.timestamp || a.date || "") : certains mouvements anciens/importés
    // peuvent ne pas avoir de timestamp — sans ce filet, un seul enregistrement
    // sans timestamp fait planter tout l'onglet Stock (localeCompare sur undefined).
    // Note: les mouvements archivés (includeArchive) sont purement consultatifs
    // ici — ils ne participent jamais au calcul du stock actuel (stockActuel).
    const base = includeArchive ? [...mouvements, ...mouvementsArchive.map(m => ({ ...m, __archive: true }))] : mouvements;
    let list = [...base].sort((a, b) => (b.timestamp || b.date || "").localeCompare(a.timestamp || a.date || ""));

    // Filtre par période
    if (filterPeriod !== "all" && dateRange.start) {
      list = list.filter(m => m.date >= dateRange.start && m.date <= dateRange.end);
    }

    // Filtre par produit
    if (filterProduit !== "all") list = list.filter(m => m.produit === filterProduit);

    // Filtre par type
    if (filterType !== "all") list = list.filter(m => m.type === filterType);

    // Filtre par emplacement
    if (filterEmplacement !== "all") {
      list = list.filter(m =>
        m.emplacementSource === filterEmplacement || m.emplacementDest === filterEmplacement
      );
    }

    // Recherche textuelle
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(m =>
        (m.referenceLabel || "").toLowerCase().includes(q) ||
        (m.userName || "").toLowerCase().includes(q) ||
        (m.notes || "").toLowerCase().includes(q) ||
        (m.emplacementSource || "").toLowerCase().includes(q) ||
        (m.emplacementDest || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [mouvements, mouvementsArchive, includeArchive, filterProduit, filterType, filterEmplacement, filterPeriod, dateRange, searchQuery]);

  // Totaux par unité (packs, kg, unités) — évite de mélanger des quantités
  // exprimées dans des unités différentes dans une seule somme
  const sumByUnite = (list: MouvementStock[]): Record<string, number> =>
    list.reduce((acc, m) => {
      acc[m.unite] = (acc[m.unite] || 0) + m.quantite;
      return acc;
    }, {} as Record<string, number>);

  const formatUniteTotals = (totals: Record<string, number>): string => {
    const parts = Object.entries(totals).filter(([, v]) => v !== 0).map(([unite, v]) => `${fmtNumber(v)} ${unite}`);
    return parts.length > 0 ? parts.join(" + ") : "0";
  };

  // Statistiques sur la période filtrée
  const stats = useMemo(() => {
    const entrees = filteredMouvements.filter(m => m.emplacementDest && !m.emplacementSource);
    const sorties = filteredMouvements.filter(m => m.emplacementSource && !m.emplacementDest);
    const transferts = filteredMouvements.filter(m => m.emplacementSource && m.emplacementDest);
    const casses = filteredMouvements.filter(m => m.type === "casse");
    const donsPolice = filteredMouvements.filter(m => m.type === "don_police");
    return {
      total: filteredMouvements.length,
      entrees: sumByUnite(entrees),
      sorties: sumByUnite(sorties),
      transferts: transferts.length,
      casses: sumByUnite(casses),
      donsPolice: sumByUnite(donsPolice),
    };
  }, [filteredMouvements]);

  const handleAjustement = () => {
    // Filet de sécurité : même si l'UI masque les onglets Ajustement/Casse
    // pour un caissier restreint, on bloque aussi ici toute tentative
    // d'enregistrer autre chose qu'un don police (état manipulé autrement,
    // ancien onglet resté ouvert, etc.).
    if (isCaissierRestreint && ajustType !== "don_police") {
      toast.error("Seul un don police peut être enregistré depuis ce compte.");
      return;
    }
    const qty = Number(ajustQuantite);
    if (!qty || qty <= 0) { toast.error("Quantité invalide"); return; }
    if (!ajustNotes.trim() && (ajustType === "ajustement" || ajustType === "don_police")) { toast.error("Motif obligatoire"); return; }

    const today = todayStr();
    let mvt: MouvementStock;
    const livreurPourEmplacement = ajustEmplacement.startsWith("camion_") ? (ajustLivreurId || undefined) : undefined;

    if (ajustType === "casse") {
      mvt = creerMouvementCasse(uid(), today, qty, ajustProduit, ajustEmplacement as Emplacement, currentUser?.nom || "", ajustNotes, livreurPourEmplacement);
    } else if (ajustType === "don_police") {
      mvt = creerMouvementDonPolice(uid(), today, qty, ajustEmplacement as Emplacement, currentUser?.nom || "", ajustNotes, livreurPourEmplacement);
    } else {
      mvt = creerMouvementAjustement(uid(), today, qty, ajustProduit, ajustEmplacement as Emplacement, ajustSens, currentUser?.nom || "", ajustNotes);
    }

    const updated = { ...DB, mouvementsStock: [...DB.mouvementsStock, mvt] };
    setDB(updated); saveDB(updated);
    const labelAction = ajustType === "casse" ? "Casse" : ajustType === "don_police" ? "Don police" : "Ajustement";
    logActivity("create", "Stock", `${labelAction}: ${qty} ${getProduitUnite(ajustProduit)} (${ajustEmplacement})`);
    toast.success(ajustType === "casse" ? "Casse enregistrée" : ajustType === "don_police" ? "Don aux policiers enregistré" : "Ajustement enregistré");
    setOpenAjust(false);
    setAjustQuantite(""); setAjustNotes(""); setAjustLivreurId("");
  };

  const handleChargement = () => {
    if (isCaissierRestreint) { toast.error("Action réservée à l'admin."); return; }
    const qty = Number(chargQuantite);
    if (!qty || qty <= 0) { toast.error("Quantité invalide"); return; }
    if (!chargVehicule) { toast.error("Véhicule requis"); return; }
    if (!chargLivreur) { toast.error("Livreur requis"); return; }

    const today = todayStr();
    let mvt: MouvementStock;

    if (chargDirection === "chargement") {
      mvt = creerMouvementChargement(uid(), today, qty, currentUser?.nom || "", chargVehicule, chargLivreur);
    } else {
      mvt = creerMouvementRetourCamion(uid(), today, qty, currentUser?.nom || "", chargVehicule, chargLivreur);
    }

    const updated = { ...DB, mouvementsStock: [...DB.mouvementsStock, mvt] };
    setDB(updated); saveDB(updated);
    logActivity("create", "Stock", `${chargDirection === "chargement" ? "Chargement" : "Retour"} camion: ${qty} packs`);
    toast.success(chargDirection === "chargement" ? "Chargement enregistré" : "Retour enregistré");
    setOpenChargement(false);
    setChargQuantite("");
  };

  const handleControle = () => {
    if (controleStockCompte === "" || isNaN(Number(controleStockCompte)) || Number(controleStockCompte) < 0) {
      toast.error("Quantité comptée invalide");
      return;
    }
    const theorique = stockTheoriqueUsine(controleProduit);
    const compte = Number(controleStockCompte);
    const ecart = compte - theorique;
    if (ecart !== 0 && !controleExplication.trim()) {
      toast.error("Explication requise en cas d'écart entre le stock compté et le stock théorique");
      return;
    }

    const record: StockControle = {
      id: uid(),
      date: controleDate,
      produit: controleProduit,
      emplacement: "usine",
      stockTheorique: theorique,
      stockCompte: compte,
      unite: getProduitUnite(controleProduit) as "packs" | "kg",
      ecart,
      comptePar: currentUser?.nom || "",
      compteLe: new Date().toISOString(),
      ...(ecart !== 0 && { explicationEcart: controleExplication.trim() }),
    };

    let updated = { ...DB, stockControles: [...DB.stockControles, record] };

    // Aligner le stock théorique sur le comptage physique (optionnel)
    if (ecart !== 0 && controleAjuster) {
      const mvt = creerMouvementAjustement(
        uid(), controleDate, Math.abs(ecart), controleProduit, "usine",
        ecart > 0 ? "entree" : "sortie", currentUser?.nom || "",
        `Ajustement suite contrôle physique du ${controleDate}${controleExplication ? " — " + controleExplication.trim() : ""}`
      );
      updated = { ...updated, mouvementsStock: [...updated.mouvementsStock, mvt] };
    }

    const histEntry = createHistoryEntry(
      "Stock (contrôle usine)", record.id,
      `Contrôle ${getProduitLabel(controleProduit)} du ${controleDate}`,
      record, currentUser?.nom || "", undefined, FIELD_LABELS
    );
    updated = addHistoryEntry(updated, histEntry);

    setDB(updated); saveDB(updated);
    logActivity("create", "Stock", `Contrôle physique ${getProduitLabel(controleProduit)}: théorique ${theorique}, compté ${compte}${ecart !== 0 ? `, écart ${ecart}` : ""}`);
    toast.success(ecart === 0 ? "Contrôle enregistré — aucun écart" : "Contrôle enregistré avec écart" + (controleAjuster ? " (stock ajusté)" : ""));
    setOpenControle(false);
    setControleStockCompte(""); setControleExplication(""); setControleAjuster(true);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "production": return <ArrowDown className="w-4 h-4 text-green-600" />;
      case "reception": return <ArrowDown className="w-4 h-4 text-teal-600" />;
      case "vente": return <ArrowUp className="w-4 h-4 text-red-600" />;
      case "retour": case "retour_camion": return <RotateCcw className="w-4 h-4 text-blue-600" />;
      case "casse": return <AlertTriangle className="w-4 h-4 text-orange-600" />;
      case "don_police": return <ShieldAlert className="w-4 h-4 text-rose-600" />;
      case "chargement": return <Truck className="w-4 h-4 text-purple-600" />;
      case "ajustement": return <Package className="w-4 h-4 text-amber-600" />;
      case "ouverture": return <RefreshCw className="w-4 h-4 text-cyan-600" />;
      default: return <Package className="w-4 h-4 text-gray-600" />;
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      production: "Production", reception: "Réception MP", vente: "Vente", retour: "Retour client",
      casse: "Casse/Perte", don_police: "Don police", ajustement: "Ajustement", chargement: "Chargement camion",
      retour_camion: "Retour camion", transfert: "Transfert", consommation: "Consommation MP",
      ouverture: "Solde d'ouverture",
    };
    return labels[type] || type;
  };

  const getTypeBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      production: "bg-green-100 text-green-800 border-green-200",
      vente: "bg-red-100 text-red-800 border-red-200",
      retour: "bg-blue-100 text-blue-800 border-blue-200",
      retour_camion: "bg-blue-100 text-blue-800 border-blue-200",
      casse: "bg-orange-100 text-orange-800 border-orange-200",
      don_police: "bg-rose-100 text-rose-800 border-rose-200",
      ajustement: "bg-amber-100 text-amber-800 border-amber-200",
      chargement: "bg-purple-100 text-purple-800 border-purple-200",
      consommation: "bg-gray-100 text-gray-800 border-gray-200",
      transfert: "bg-indigo-100 text-indigo-800 border-indigo-200",
      ouverture: "bg-cyan-100 text-cyan-800 border-cyan-200",
    };
    return colors[type] || "bg-gray-100 text-gray-800 border-gray-200";
  };

  const getEmplacementIcon = (type: string) => {
    if (type.startsWith("camion")) return <Truck className="w-5 h-5 text-purple-600" />;
    switch (type) {
      case "usine": return <Factory className="w-5 h-5 text-blue-600" />;
      case "depot": return <Warehouse className="w-5 h-5 text-green-600" />;
      default: return <Package className="w-5 h-5 text-gray-600" />;
    }
  };

  const resetFilters = () => {
    setFilterProduit("all");
    setFilterType("all");
    setFilterEmplacement("all");
    setFilterPeriod("month");
    setSearchQuery("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gestion du Stock</h2>
          <p className="text-sm text-gray-500">Journal de mouvements, stock par emplacement, suivi des camions</p>
        </div>
        <div className="flex gap-2">
          {!isCaissierRestreint && (
            <>
              <Button onClick={() => { setControleProduit("sachet_plein"); setControleDate(todayStr()); setControleStockCompte(""); setControleExplication(""); setControleAjuster(true); setOpenControle(true); }} variant="outline" className="gap-2">
                <ClipboardCheck className="w-4 h-4" /> Comptage physique
              </Button>
              <Button onClick={() => setOpenChargement(true)} variant="outline" className="gap-2">
                <Truck className="w-4 h-4" /> Chargement
              </Button>
            </>
          )}
          <Button
            onClick={() => {
              if (isCaissierRestreint) { setAjustType("don_police"); setAjustProduit("sachet_plein"); }
              setOpenAjust(true);
            }}
            className="gap-2 bg-[#1B4B6B] hover:bg-[#134a84]"
          >
            <Plus className="w-4 h-4" /> {isCaissierRestreint ? "Don police" : "Ajustement / Casse"}
          </Button>
          {isAdmin && (
            <Button onClick={handleOpenReset} variant="outline" className="gap-2 border-cyan-400 text-cyan-800 hover:bg-cyan-50">
              <RefreshCw className="w-4 h-4" /> Nouveau départ
            </Button>
          )}
        </div>
      </div>

      {/* Alerte : mouvements de stock mal orientés vers un emplacement "camion_<id livreur>" au lieu de "camion_<id véhicule>" */}
      {isAdmin && repairMouvementCount > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 flex items-start gap-3">
            <Wrench className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">Mouvements de stock mal orientés détectés</p>
              <p className="text-xs text-red-800 mt-0.5">
                {repairMouvementCount} mouvement(s) référencent un emplacement camion incorrect (bug corrigé le 2026-08-03 — les ventes livrées créaient un emplacement fictif au lieu de créditer/débiter le vrai camion). Cela explique des soldes camions négatifs et un stock usine surévalué.
              </p>
            </div>
            <Button size="sm" variant="outline" className="border-red-400 text-red-900 hover:bg-red-100 shrink-0" onClick={() => setOpenRepair(true)}>
              Voir et corriger
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Chargements du jour — voir commentaire sur chargementsAujourdhui */}
      {chargementsAujourdhui.length > 0 && (
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="py-3">
            <div className="flex items-center gap-2 mb-2">
              <Truck className="w-4 h-4 text-purple-700" />
              <p className="text-sm font-medium text-purple-900">
                {chargementsAujourdhui.length === 1 ? "1 camion chargé aujourd'hui" : `${chargementsAujourdhui.length} camions chargés aujourd'hui`}
              </p>
            </div>
            <div className="space-y-1">
              {chargementsAujourdhui.map((c) => (
                <p key={c.id} className="text-xs text-purple-800">
                  <span className="font-medium">{c.camionNom}</span> — {c.livreurNom} — {fmtNumber(c.quantite)} packs {c.heure && `à ${c.heure}`}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerte : camion(s) à solde négatif — voir commentaire sur camionsSoldeNegatif */}
      {camionsSoldeNegatif.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">
                {camionsSoldeNegatif.length === 1 ? "Un camion a un solde négatif" : `${camionsSoldeNegatif.length} camions ont un solde négatif`}
              </p>
              <p className="text-xs text-red-800 mt-0.5">
                {camionsSoldeNegatif.map((s) => `${s.label} : ${fmtNumber(s.quantite)} packs`).join(" · ")}
                {" — probablement un Chargement non saisi (ou insuffisant) avant des ventes sur ce camion."}
              </p>
            </div>
            <Button size="sm" variant="outline" className="border-red-400 text-red-900 hover:bg-red-100 shrink-0" onClick={() => setOpenChargement(true)}>
              Saisir un chargement
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Alerte : contrôle physique manquant ou ancien */}
      {produitsSansControleRecent.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900">Contrôle physique du stock usine en retard</p>
              <p className="text-xs text-amber-800 mt-0.5">
                {produitsSansControleRecent.map(x => {
                  const label = getProduitLabel(x.produit);
                  return x.jours === null
                    ? `${label} : jamais contrôlé`
                    : `${label} : dernier contrôle il y a ${x.jours} jour(s)`;
                }).join(" • ")}
                {" "}— un comptage physique régulier (au moins hebdomadaire) permet de détecter vols et erreurs de saisie tôt.
              </p>
            </div>
            <Button size="sm" variant="outline" className="border-amber-400 text-amber-900 hover:bg-amber-100 shrink-0" onClick={() => { setControleDate(todayStr()); setOpenControle(true); }}>
              Faire un contrôle
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {[
          { id: "stock" as const, label: "Stock actuel", icon: <Package className="w-4 h-4" /> },
          { id: "mouvements" as const, label: "Journal mouvements", icon: <Calendar className="w-4 h-4" /> },
          { id: "chargement" as const, label: "Camions", icon: <Truck className="w-4 h-4" /> },
          { id: "controle" as const, label: "Contrôle physique", icon: <ClipboardCheck className="w-4 h-4" /> },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === t.id ? "bg-white shadow-sm text-[#1B4B6B]" : "text-gray-600 hover:text-gray-900"}`}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ========== Tab: Stock actuel ========== */}
      {tab === "stock" && (
        <div className="space-y-4">
          {/* Résumé global */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Factory className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {stockActuel.filter(s => s.type === "usine" && s.produit === "sachet_plein").reduce((a, s) => a + s.quantite, 0)}
                    </p>
                    <p className="text-xs text-gray-500">Packs en usine</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-100">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Truck className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {stockActuel.filter(s => s.type === "camion" && s.produit === "sachet_plein").reduce((a, s) => a + s.quantite, 0)}
                    </p>
                    <p className="text-xs text-gray-500">Packs en camions</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-100">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <Package className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {stockActuel.filter(s => s.produit === "sachet_plein").reduce((a, s) => a + s.quantite, 0)}
                    </p>
                    <p className="text-xs text-gray-500">Stock total packs</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Détail par emplacement */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stockActuelAffiche.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="py-12 text-center text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">Aucun mouvement de stock enregistré</p>
                  <p className="text-sm mt-1">Le stock se construit automatiquement à partir des productions, ventes, chargements et retours.</p>
                </CardContent>
              </Card>
            ) : (
              stockActuelAffiche.map((s, i) => (
                <Card key={i} className="border-l-4 hover:shadow-md transition-shadow" style={{ borderLeftColor: s.type === "usine" ? "#1B4B6B" : s.type === "camion" ? "#7c3aed" : "#16a34a" }}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getEmplacementIcon(s.emplacement)}
                        <CardTitle className="text-base">{emplacementLabel(s.emplacement, s.label)}</CardTitle>
                      </div>
                      <Badge variant={s.quantite > 0 ? "default" : "secondary"} className="text-xs">
                        {s.quantite > 0 ? "En stock" : "Vide"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-gray-900">{fmtNumber(s.quantite)}</span>
                      <span className="text-sm text-gray-500">{s.unite}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{getProduitLabel(s.produit)}</p>
                    {s.quantite < 0 && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                        <AlertTriangle className="w-3 h-3" />
                        Stock négatif — vérifier les mouvements
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========== Tab: Journal mouvements ========== */}
      {tab === "mouvements" && (
        <div className="space-y-4">
          {/* Barre de filtres */}
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="space-y-3">
                {/* Ligne 1 : Période + Recherche */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {([
                      { id: "today", label: "Aujourd'hui" },
                      { id: "week", label: "Semaine" },
                      { id: "month", label: "Mois" },
                      { id: "all", label: "Tout" },
                      { id: "custom", label: "Personnalisé" },
                    ] as { id: PeriodFilter; label: string }[]).map(p => (
                      <button key={p.id} onClick={() => setFilterPeriod(p.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${filterPeriod === p.id ? "bg-white shadow-sm text-[#1B4B6B]" : "text-gray-600 hover:text-gray-900"}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Rechercher (référence, utilisateur, notes...)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                {/* Dates personnalisées */}
                {filterPeriod === "custom" && (
                  <div className="flex gap-3 items-center">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <Input type="date" value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} className="w-40" />
                    <span className="text-gray-400">→</span>
                    <Input type="date" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} className="w-40" />
                  </div>
                )}

                {/* Ligne 2 : Filtres détaillés */}
                <div className="flex flex-wrap gap-3 items-center">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <Select value={filterProduit} onValueChange={setFilterProduit}>
                    <SelectTrigger className="w-44 h-9 text-xs"><SelectValue placeholder="Tous produits" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous produits</SelectItem>
                      <SelectItem value="sachet_plein">Sachets pleins</SelectItem>
                      <SelectItem value="casier">Casiers</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-44 h-9 text-xs"><SelectValue placeholder="Tous types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous types</SelectItem>
                      <SelectItem value="production">Production</SelectItem>
                      <SelectItem value="reception">Réception MP</SelectItem>
                      <SelectItem value="vente">Vente</SelectItem>
                      <SelectItem value="chargement">Chargement</SelectItem>
                      <SelectItem value="retour_camion">Retour camion</SelectItem>
                      <SelectItem value="casse">Casse</SelectItem>
                      <SelectItem value="don_police">Don police</SelectItem>
                      <SelectItem value="ajustement">Ajustement</SelectItem>
                      <SelectItem value="consommation">Consommation MP</SelectItem>
                      <SelectItem value="ouverture">Solde d'ouverture</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterEmplacement} onValueChange={setFilterEmplacement}>
                    <SelectTrigger className="w-44 h-9 text-xs"><SelectValue placeholder="Tous emplacements" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous emplacements</SelectItem>
                      <SelectItem value="usine">Usine</SelectItem>
                      <SelectItem value="depot">Dépôt</SelectItem>
                      {DB.vehicules.map(v => (
                        <SelectItem key={v.id} value={`camion_${v.id}`}>Camion: {v.nom}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(filterProduit !== "all" || filterType !== "all" || filterEmplacement !== "all" || searchQuery) && (
                    <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs text-gray-500 gap-1">
                      <X className="w-3 h-3" /> Réinitialiser
                    </Button>
                  )}
                  {mouvementsArchive.length > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 ml-auto cursor-pointer">
                      <input type="checkbox" checked={includeArchive} onChange={e => setIncludeArchive(e.target.checked)} className="w-3.5 h-3.5" />
                      Inclure l'historique archivé ({mouvementsArchive.length}) — consultation uniquement, hors calcul du stock
                    </label>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Statistiques de la période */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-xs text-gray-500">Mouvements</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <p className="text-lg font-bold text-green-700">{formatUniteTotals(stats.entrees)}</p>
                </div>
                <p className="text-xs text-gray-500">Entrées</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <TrendingDown className="w-4 h-4 text-red-600" />
                  <p className="text-lg font-bold text-red-700">{formatUniteTotals(stats.sorties)}</p>
                </div>
                <p className="text-xs text-gray-500">Sorties</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xl font-bold text-purple-700">{stats.transferts}</p>
                <p className="text-xs text-gray-500">Transferts</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  <p className="text-lg font-bold text-orange-700">{formatUniteTotals(stats.casses)}</p>
                </div>
                <p className="text-xs text-gray-500">Casses/Pertes</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <p className="text-lg font-bold text-rose-700">{formatUniteTotals(stats.donsPolice)}</p>
                </div>
                <p className="text-xs text-gray-500">Dons police</p>
              </CardContent>
            </Card>
          </div>

          {/* Tableau des mouvements */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Mouvements ({filteredMouvements.length})
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredMouvements.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                  <p>Aucun mouvement pour cette période</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Produit</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Quantité</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Destination</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Référence</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Par</th>
                        <th className="px-4 py-3 text-center font-medium text-gray-600">Détail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredMouvements.slice(0, 100).map(m => (
                        <tr key={m.id} className={`hover:bg-gray-50 transition-colors ${(m as any).__archive ? "opacity-50" : ""}`}>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{fmtDate(m.date)}</td>
                          <td className="px-4 py-3">
                            <Badge className={`${getTypeBadgeColor(m.type)} gap-1 text-xs`}>
                              {getTypeIcon(m.type)}
                              {getTypeLabel(m.type)}
                            </Badge>
                            {(m as any).__archive && <Badge variant="secondary" className="ml-1 text-xs">Archivé</Badge>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-gray-600">{getProduitLabel(m.produit)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-mono font-semibold ${
                              m.emplacementDest && !m.emplacementSource ? "text-green-700" :
                              m.emplacementSource && !m.emplacementDest ? "text-red-700" : "text-gray-700"
                            }`}>
                              {m.emplacementDest && !m.emplacementSource ? "+" : m.emplacementSource && !m.emplacementDest ? "-" : "↔"}
                              {m.quantite} {m.unite}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">{m.emplacementSource ? emplacementLabel(m.emplacementSource, m.emplacementSource) : "—"}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs">{m.emplacementDest ? emplacementLabel(m.emplacementDest, m.emplacementDest) : "—"}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs max-w-[150px] truncate">{m.referenceLabel || "—"}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{m.userName}</td>
                          <td className="px-4 py-3 text-center">
                            <Button variant="ghost" size="sm" onClick={() => setOpenDetail(m)} className="h-7 w-7 p-0">
                              <Eye className="w-4 h-4 text-gray-400" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredMouvements.length > 100 && (
                    <div className="p-3 text-center text-xs text-gray-500 border-t bg-gray-50">
                      Affichage limité aux 100 premiers résultats sur {filteredMouvements.length}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========== Tab: Camions ========== */}
      {tab === "chargement" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DB.vehicules.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center text-gray-500">
                <Truck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">Aucun véhicule configuré</p>
                <p className="text-sm mt-1">Ajoutez des véhicules dans la section Véhicules.</p>
              </CardContent>
            </Card>
          ) : (
            DB.vehicules.map(v => {
              const stockCamion = stockActuel.find(s => s.emplacement === `camion_${v.id}` && s.produit === "sachet_plein");
              const mvtCamion = mouvements.filter(m => m.vehiculeId === v.id).sort((a, b) => (b.timestamp || b.date || "").localeCompare(a.timestamp || a.date || "")).slice(0, 5);
              // Le chauffeur affiché ici doit venir du lien "Camion conduit" posé côté
              // Livreurs (Livreur.vehiculeId) — c'est cette info-là, et uniquement
              // elle, qui détermine de quel camion le stock est déduit à la vente
              // (voir creerMouvementVente / LivreursSection.tsx). Le champ texte libre
              // Vehicule.chauffeur est une info descriptive séparée, saisie côté
              // Véhicules, qui ne reflète pas forcément cette affectation réelle — sans
              // ce lookup, un utilisateur pouvait assigner un camion à un livreur et
              // voir cet écran continuer d'afficher "Non assigné" indéfiniment. On
              // retombe sur v.chauffeur seulement si aucun livreur n'a ce camion.
              const livreurAssigne = DB.livreurs.find(l => l.vehiculeId === v.id);
              return (
                <Card key={v.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <Truck className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{v.nom}</CardTitle>
                          <p className="text-xs text-gray-500">Chauffeur: {livreurAssigne?.nom || v.chauffeur || "Non assigné"}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-gray-900">{stockCamion?.quantite || 0}</p>
                        <p className="text-xs text-gray-500">packs</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {mvtCamion.length > 0 ? (
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium text-gray-600">Derniers mouvements :</p>
                        {mvtCamion.map(m => (
                          <div key={m.id} className="flex items-center justify-between text-xs py-1">
                            <div className="flex items-center gap-2">
                              {getTypeIcon(m.type)}
                              <span className="text-gray-600">{fmtDate(m.date)} — {getTypeLabel(m.type)}</span>
                            </div>
                            <span className={`font-mono font-medium ${m.type === "chargement" ? "text-green-700" : "text-red-700"}`}>
                              {m.type === "chargement" ? "+" : "-"}{m.quantite} packs
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 pt-3 border-t">Aucun mouvement récent</p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ========== Tab: Contrôle physique ========== */}
      {tab === "controle" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["sachet_plein"] as const).map(produit => {
              const dernier = dernierControlePar(produit);
              const jours = joursDepuisControle(produit);
              return (
                <Card key={produit}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ClipboardCheck className="w-4 h-4 text-[#1B4B6B]" />
                      {getProduitLabel(produit)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dernier ? (
                      <div className="space-y-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold text-gray-900">{fmtNumber(dernier.stockCompte)}</span>
                          <span className="text-sm text-gray-500">{dernier.unite} comptés le {fmtDate(dernier.date)}</span>
                        </div>
                        <p className="text-xs text-gray-500">Théorique à ce moment : {fmtNumber(dernier.stockTheorique)} {dernier.unite}</p>
                        {dernier.ecart !== 0 ? (
                          <Badge className="bg-orange-100 text-orange-800 border-orange-200">Écart {dernier.ecart > 0 ? "+" : ""}{fmtNumber(dernier.ecart)} {dernier.unite}</Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-800 border-green-200">Aucun écart</Badge>
                        )}
                        <p className="text-xs text-gray-400">Par {dernier.comptePar} — il y a {jours} jour(s)</p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">Aucun contrôle physique enregistré</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Historique des contrôles ({historiqueControles.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {historiqueControles.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <ClipboardCheck className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                  <p>Aucun contrôle physique enregistré</p>
                  <p className="text-sm mt-1">Comparez régulièrement le stock théorique (calculé) au stock réellement compté en usine.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Produit</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Théorique</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Compté</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-600">Écart</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Explication</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Par</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {historiqueControles.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">{fmtDate(c.date)}</td>
                          <td className="px-4 py-3 text-xs text-gray-600">{getProduitLabel(c.produit)}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtNumber(c.stockTheorique)}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtNumber(c.stockCompte)}</td>
                          <td className="px-4 py-3 text-right">
                            {c.ecart !== 0 ? (
                              <span className="font-mono font-semibold text-orange-700">{c.ecart > 0 ? "+" : ""}{fmtNumber(c.ecart)}</span>
                            ) : (
                              <span className="font-mono text-green-700">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs max-w-[220px] truncate" title={c.explicationEcart}>{c.explicationEcart || "—"}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{c.comptePar}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========== Dialog Détail Mouvement ========== */}
      <Dialog open={!!openDetail} onOpenChange={() => setOpenDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-[#1B4B6B]" />
              Détail du mouvement
            </DialogTitle>
          </DialogHeader>
          {openDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Date</p>
                  <p className="font-medium">{fmtDate(openDetail.date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Heure</p>
                  <p className="font-medium">
                    {new Date(openDetail.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Type</p>
                  <Badge className={`${getTypeBadgeColor(openDetail.type)} gap-1`}>
                    {getTypeIcon(openDetail.type)}
                    {getTypeLabel(openDetail.type)}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Produit</p>
                  <p className="font-medium">{getProduitLabel(openDetail.produit)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Quantité</p>
                  <p className="text-xl font-bold">{openDetail.quantite} {openDetail.unite}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Enregistré par</p>
                  <p className="font-medium">{openDetail.userName}</p>
                </div>
              </div>
              <div className="border-t pt-3 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Source</p>
                  <p className="font-medium">{openDetail.emplacementSource || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Destination</p>
                  <p className="font-medium">{openDetail.emplacementDest || "—"}</p>
                </div>
              </div>
              {openDetail.referenceLabel && (
                <div className="border-t pt-3">
                  <p className="text-xs text-gray-500">Référence</p>
                  <p className="font-medium">{openDetail.referenceLabel}</p>
                </div>
              )}
              {openDetail.notes && (
                <div className="border-t pt-3">
                  <p className="text-xs text-gray-500">Notes / Motif</p>
                  <p className="text-sm bg-amber-50 p-2 rounded">{openDetail.notes}</p>
                </div>
              )}
              <div className="border-t pt-3">
                <p className="text-xs text-gray-500">ID Mouvement</p>
                <p className="text-xs font-mono text-gray-400">{openDetail.id}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDetail(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== Dialog Ajustement/Casse ========== */}
      <Dialog open={openAjust} onOpenChange={setOpenAjust}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustement / Casse / Don police</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {!isCaissierRestreint && (
                <>
                  <Button variant={ajustType === "ajustement" ? "default" : "outline"} size="sm" onClick={() => setAjustType("ajustement")}>Ajustement</Button>
                  <Button variant={ajustType === "casse" ? "default" : "outline"} size="sm" onClick={() => setAjustType("casse")}>Casse / Perte</Button>
                </>
              )}
              <Button variant={ajustType === "don_police" ? "default" : "outline"} size="sm" onClick={() => { setAjustType("don_police"); setAjustProduit("sachet_plein"); }}>Don police</Button>
            </div>
            {ajustType !== "don_police" && (
              <div>
                <label className="text-sm font-medium">Produit</label>
                <Select value={ajustProduit} onValueChange={(v) => setAjustProduit(v as ProduitType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sachet_plein">Sachets pleins (packs)</SelectItem>
                    <SelectItem value="casier">Casiers</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Emplacement</label>
              <Select
                value={ajustEmplacement}
                onValueChange={(v) => {
                  setAjustEmplacement(v);
                  // Même règle que dans Chargement/Retour : le livreur associé à
                  // un camion pour la réconciliation ne doit pas être une saisie
                  // libre indépendante, mais découler de Livreur.vehiculeId — sinon
                  // on peut associer une casse/un don sur VEC-1 à un livreur qui ne
                  // conduit pas VEC-1, ce qui fausse sa réconciliation à lui.
                  setAjustLivreurId(v.startsWith("camion_") ? (DB.livreurs.find((l) => l.vehiculeId === v.replace("camion_", ""))?.id || "") : "");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="usine">Usine</SelectItem>
                  <SelectItem value="depot">Dépôt</SelectItem>
                  {DB.vehicules.map(v => (
                    <SelectItem key={v.id} value={`camion_${v.id}`}>Camion: {v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(ajustType === "casse" || ajustType === "don_police") && ajustEmplacement.startsWith("camion_") && (
              <div>
                <label className="text-sm font-medium">Livreur (pour la réconciliation)</label>
                <p className="text-sm text-gray-700 border rounded-md px-3 py-2 bg-gray-50">
                  {DB.livreurs.find((l) => l.id === ajustLivreurId)?.nom || "Aucun livreur assigné à ce camion"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {ajustType === "don_police"
                    ? "Sans livreur associé, ce don n'apparaîtra pas dans la réconciliation du camion."
                    : "Sans livreur associé, cette casse n'apparaîtra pas dans la réconciliation du camion."}
                </p>
              </div>
            )}
            {ajustType === "ajustement" && (
              <div>
                <label className="text-sm font-medium">Sens</label>
                <Select value={ajustSens} onValueChange={(v) => setAjustSens(v as "entree" | "sortie")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entree">Entrée (stock trouvé en plus)</SelectItem>
                    <SelectItem value="sortie">Sortie (stock manquant)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Quantité</label>
              <Input type="number" value={ajustQuantite} onChange={e => setAjustQuantite(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-sm font-medium">Motif / Notes {ajustType !== "casse" ? "*" : ""}</label>
              <Input
                value={ajustNotes}
                onChange={e => setAjustNotes(e.target.value)}
                placeholder={ajustType === "don_police" ? "Ex: contrôle routier, lieu, agent..." : "Raison de l'ajustement..."}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenAjust(false)}>Annuler</Button>
            <Button onClick={handleAjustement} className="bg-[#1B4B6B]">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== Dialog Chargement ========== */}
      <Dialog open={openChargement} onOpenChange={setOpenChargement}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chargement / Retour camion</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={chargDirection === "chargement" ? "default" : "outline"} size="sm" onClick={() => setChargDirection("chargement")}>Chargement</Button>
              <Button variant={chargDirection === "retour" ? "default" : "outline"} size="sm" onClick={() => setChargDirection("retour")}>Retour</Button>
            </div>
            <div>
              <label className="text-sm font-medium">Véhicule</label>
              <Select
                value={chargVehicule}
                onValueChange={(v) => {
                  setChargVehicule(v);
                  // Le livreur d'un chargement/retour doit être celui réellement
                  // assigné à ce véhicule (Livreur.vehiculeId), pas une saisie
                  // libre indépendante — même règle que partout ailleurs dans
                  // l'app (voir Véhicules et Livreurs). On le déduit ici plutôt
                  // que de laisser une deuxième source de vérité désynchronisable.
                  setChargLivreur(DB.livreurs.find((l) => l.vehiculeId === v)?.id || "");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {DB.vehicules.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Livreur</label>
              <p className="text-sm text-gray-700 border rounded-md px-3 py-2 bg-gray-50">
                {!chargVehicule
                  ? "—"
                  : DB.livreurs.find((l) => l.id === chargLivreur)?.nom
                    || "Aucun livreur assigné à ce camion (à configurer dans Livreurs → \"Camion conduit\")"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Quantité (packs)</label>
              <Input type="number" value={chargQuantite} onChange={e => setChargQuantite(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenChargement(false)}>Annuler</Button>
            <Button onClick={handleChargement} className="bg-[#1B4B6B]">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== Dialog Comptage physique (contrôle usine) ========== */}
      <Dialog open={openControle} onOpenChange={setOpenControle}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-[#1B4B6B]" />
              Comptage physique — Stock usine
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Date du comptage</label>
              <Input type="date" value={controleDate} onChange={e => setControleDate(e.target.value)} />
            </div>
            <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-gray-600">Stock théorique (calculé)</span>
              <span className="font-mono font-semibold text-gray-900">{fmtNumber(controleTheorique)} {getProduitUnite(controleProduit)}</span>
            </div>
            <div>
              <label className="text-sm font-medium">Quantité réellement comptée</label>
              <Input type="number" value={controleStockCompte} onChange={e => setControleStockCompte(e.target.value)} placeholder="0" />
            </div>
            {controleStockCompte !== "" && !isNaN(Number(controleStockCompte)) && (
              <div className={`rounded-lg p-3 flex items-center justify-between ${controleEcart === 0 ? "bg-green-50" : "bg-orange-50"}`}>
                <span className={`text-sm font-medium ${controleEcart === 0 ? "text-green-700" : "text-orange-700"}`}>Écart</span>
                <span className={`font-mono font-bold ${controleEcart === 0 ? "text-green-700" : "text-orange-700"}`}>
                  {controleEcart > 0 ? "+" : ""}{fmtNumber(controleEcart)} {getProduitUnite(controleProduit)}
                </span>
              </div>
            )}
            {controleEcart !== 0 && controleStockCompte !== "" && (
              <>
                <div>
                  <label className="text-sm font-medium">Explication de l'écart *</label>
                  <Input value={controleExplication} onChange={e => setControleExplication(e.target.value)} placeholder="Ex: erreur de comptage précédente, casse non enregistrée, vol suspecté..." />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="controle-ajuster" checked={controleAjuster} onChange={e => setControleAjuster(e.target.checked)} className="w-4 h-4" />
                  <label htmlFor="controle-ajuster" className="text-sm cursor-pointer">Aligner le stock théorique sur ce comptage (crée un ajustement)</label>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenControle(false)}>Annuler</Button>
            <Button onClick={handleControle} className="bg-[#1B4B6B]">Enregistrer le contrôle</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== Dialog Réparation stock camions ========== */}
      <Dialog open={openRepair} onOpenChange={setOpenRepair}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-red-600" />
              Réparer les mouvements de stock mal orientés
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Ces mouvements référencent un emplacement "camion_&lt;id&gt;" qui correspond en réalité à l'ID d'un <strong>livreur</strong>, pas d'un véhicule — conséquence d'un bug dans l'enregistrement des ventes livrées (corrigé le 2026-08-03). Ils seront réaffectés au camion actuellement assigné au livreur concerné, ou à l'usine si aucun camion n'est assigné.
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">
              Astuce : pour un résultat plus précis, assignez d'abord le bon camion à chaque livreur listé ci-dessous (section Livreurs) avant de lancer la réparation — sinon leurs mouvements seront réaffectés à l'usine par défaut.
            </p>
            <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
              {Object.entries(
                repairPlan.reduce((acc, p) => {
                  acc[p.livreurNom] = (acc[p.livreurNom] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([nom, count]) => {
                const livreur = DB.livreurs.find(l => l.nom === nom);
                const cible = livreur?.vehiculeId ? (DB.vehicules.find(v => v.id === livreur.vehiculeId)?.nom || "camion assigné") : "Usine (aucun camion assigné)";
                return (
                  <div key={nom} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{nom}</p>
                      <p className="text-xs text-gray-500">→ sera réaffecté à : {cible}</p>
                    </div>
                    <Badge variant="secondary">{count} mouvement(s)</Badge>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenRepair(false)}>Annuler</Button>
            <Button onClick={handleRepair} className="bg-red-600 hover:bg-red-700">
              Corriger {repairMouvementCount} mouvement(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== Dialog Nouveau départ (réinitialisation du stock) ========== */}
      <Dialog open={openReset} onOpenChange={setOpenReset}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-cyan-700" />
              Nouveau départ — réinitialiser le stock
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Tout l'historique actuel de mouvements ({mouvements.length}) sera archivé (consultable via "Inclure l'historique archivé" dans l'onglet Journal, mais exclu du calcul du stock). Un nouveau solde d'ouverture, daté d'aujourd'hui, sera posé à partir des quantités que tu saisis ci-dessous. Tout ce qui se passera ensuite (production, ventes, chargements...) continuera de s'accumuler normalement à partir de ce nouveau départ.
            </p>
            <p className="text-xs text-red-700 bg-red-50 rounded p-2">
              Vérifie physiquement chaque quantité avant de valider — cette action ne peut pas être annulée automatiquement (l'ancien historique reste consultable, mais ne sera plus utilisé pour calculer le stock).
            </p>
            <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
              {resetRows.map((row, idx) => (
                <div key={row.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm text-gray-700 flex-1">{row.label}</span>
                  <Input
                    type="number"
                    value={row.valeur}
                    onChange={(e) => {
                      const v = e.target.value;
                      setResetRows(rows => rows.map((r, i) => i === idx ? { ...r, valeur: v } : r));
                    }}
                    className="w-32 h-8 text-right"
                  />
                </div>
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer bg-gray-50 rounded p-2">
              <input type="checkbox" checked={resetConfirme} onChange={e => setResetConfirme(e.target.checked)} className="w-4 h-4 mt-0.5" />
              Je certifie que ces quantités ont été vérifiées physiquement aujourd'hui.
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenReset(false)}>Annuler</Button>
            <Button onClick={handleReset} disabled={!resetConfirme} className="bg-cyan-700 hover:bg-cyan-800">
              Réinitialiser le stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
