import { useState, useMemo, useCallback, useRef } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, getMoisCourant, moisLabel, todayLocal, CATEGORIES_DEPENSES } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonthSelector } from "@/components/MonthSelector";
import { Plus, Trash2, Upload, Users, Pencil, AlertTriangle, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { Pagination } from "@/components/Pagination";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import TableFilters from "@/components/TableFilters";
import { useTableFilters } from "@/hooks/useTableFilters";
import type { Depense, Employe } from "@/lib/types";
import { validateDepense } from "@/lib/validation";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { requiresApproval, createApprovalRequest, DEFAULT_APPROVAL_CONFIG, type ApprovalConfig } from "@/lib/approvalWorkflow";

// Liste des catégories : voir helpers.ts CATEGORIES_DEPENSES (partagée avec
// ParametresSection.tsx pour la configuration du budget par catégorie —
// Etude-Depenses-AquaSachet.docx §4.2).
const CATEGORIES = CATEGORIES_DEPENSES;
const CATEGORIES_LOWER = CATEGORIES.map((c) => c.toLowerCase());

// ─── Reclassification "Énergie" → 3 catégories (2026-08-21) ────────────────
// Les dépenses créées avant la scission (voir helpers.ts CATEGORIES_DEPENSES)
// restent en catégorie "Énergie" tant qu'un admin ne les a pas reclassées ici
// — outil "Reclasser Énergie" plus bas. Suggestion automatique par mots-clés
// dans le libellé/fournisseur, corrigeable ligne par ligne avant de confirmer
// (jamais appliqué en silence — l'app évite déjà ce genre de bulk change
// automatique non revu, voir les autres constats de Etude-Depenses-AquaSachet.docx).
// La catégorie "eau" a été ajoutée après coup : une première version à 2
// catégories (électricité/carburant) classait par défaut "PAIEMENT SEN EAU"
// en carburant, faute de 3e case — repéré et corrigé par l'utilisateur.
const NOUVELLE_ELECTRICITE = "Facture électricité / Woyofal";
const NOUVELLE_EAU = "Facture eau (SEN EAU)";
const NOUVELLE_CARBURANT = "Carburant (groupe électrogène)";
const MOTS_ELECTRICITE = ["woyofal", "senelec", "sénélec", "électri", "electri", "kwh"];
const MOTS_EAU = ["sen eau", "seneau", "sde"];
const MOTS_CARBURANT = ["carburant", "gasoil", "gas-oil", "gas oil", "diesel", "essence", "mazout", "groupe électro", "groupe electro", "litre"];

// Par défaut (aucun mot-clé électricité/eau reconnu) : carburant — choix de
// l'utilisateur ("qu'on enlève l'électricité" du lot Énergie au départ),
// donc seules les dépenses clairement identifiables comme facture
// d'électricité/Woyofal ou d'eau (SEN EAU/SDE, ou le mot "eau" isolé — \b
// pour ne pas matcher "réseau"/"nouveau") en sont extraites, le reste
// bascule en carburant groupe électrogène par défaut (reste modifiable
// ligne par ligne dans le dialog avant confirmation).
function suggererCategorieEnergie(d: Depense): string {
  const texte = `${d.libelle} ${d.fournisseur || ""}`.toLowerCase();
  if (MOTS_ELECTRICITE.some((m) => texte.includes(m))) return NOUVELLE_ELECTRICITE;
  if (MOTS_EAU.some((m) => texte.includes(m)) || /\beau\b/.test(texte)) return NOUVELLE_EAU;
  return NOUVELLE_CARBURANT;
}

export default function DepensesSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [recapSalairesOpen, setRecapSalairesOpen] = useState(false);
  const [recapMois, setRecapMois] = useState(getMoisCourant());
  const [recapEmploye, setRecapEmploye] = useState<string>("__tous__");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reclassOpen, setReclassOpen] = useState(false);
  const [reclassChoix, setReclassChoix] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayLocal());
  const [categorie, setCategorie] = useState(CATEGORIES[0]);
  const [libelle, setLibelle] = useState("");
  const [fournisseur, setFournisseur] = useState("");
  const [employeId, setEmployeId] = useState("");
  const [montant, setMontant] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Import CSV Dépenses ───────────────────────────────────────────────────
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) { toast.error("Fichier vide ou invalide"); return; }
        const header = lines[0];
        const sep = header.includes(";") ? ";" : ",";
        const cols = header.replace(/^\uFEFF/, "").split(sep).map((c) => c.trim().toLowerCase());
        const iDate = cols.findIndex((c) => c.includes("date"));
        const iCategorie = cols.findIndex((c) => c.includes("catégori") || c.includes("categori") || c.includes("cat"));
        const iLibelle = cols.findIndex((c) => c.includes("libellé") || c.includes("libelle") || c.includes("description") || c.includes("objet"));
        const iFournisseur = cols.findIndex((c) => c.includes("fournisseur") || c.includes("fournis"));
        const iMontant = cols.findIndex((c) => c.includes("montant") || c.includes("somme") || c.includes("prix"));
        if (iMontant === -1) { toast.error("Colonne 'Montant' introuvable dans le CSV"); return; }
        const newDepenses: Depense[] = [];
        let erreurs = 0;
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map((v) => v.trim());
          const montantVal = Number(vals[iMontant]?.replace(/[^0-9.,]/g, "").replace(",", "."));
          if (!montantVal || montantVal <= 0) { erreurs++; continue; }
          const libelleVal = iLibelle !== -1 ? (vals[iLibelle]?.trim() || "Dépense importée") : "Dépense importée";
          const dateVal = iDate !== -1 ? (vals[iDate]?.trim() || todayLocal()) : todayLocal();
          let categorieVal = "Divers";
          if (iCategorie !== -1 && vals[iCategorie]) {
            const catInput = vals[iCategorie].trim().toLowerCase();
            const matchIdx = CATEGORIES_LOWER.findIndex((c) => c.includes(catInput) || catInput.includes(c));
            categorieVal = matchIdx !== -1 ? CATEGORIES[matchIdx] : vals[iCategorie].trim();
          }
          const fournisseurVal = iFournisseur !== -1 ? (vals[iFournisseur]?.trim() || "") : "";
          newDepenses.push({
            id: uid(),
            date: dateVal,
            categorie: categorieVal,
            libelle: libelleVal,
            fournisseur: fournisseurVal,
            montant: montantVal,
          });
        }
        if (newDepenses.length === 0) {
          toast.error(`Aucune dépense valide à importer${erreurs > 0 ? ` (${erreurs} ligne(s) ignorée(s))` : ""}`);
          return;
        }
        const updated = { ...DB, depenses: [...DB.depenses, ...newDepenses] };
        setDB(updated); saveDB(updated);
        logActivity("create", "Dépense", `Import CSV: ${newDepenses.length} dépenses`);
        toast.success(`${newDepenses.length} dépense(s) importée(s)${erreurs > 0 ? ` (${erreurs} ligne(s) ignorée(s))` : ""}`);
      } catch (err) {
        toast.error("Erreur lors de la lecture du fichier CSV");
        console.error(err);
      }
    };
    reader.readAsText(file, "UTF-8");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const mois = getMoisCourant();
  const totalMois = DB.depenses.filter((d) => (d.date || "").startsWith(mois)).reduce((s, d) => s + d.montant, 0);

  // ─── Suivi budgétaire par catégorie (Etude-Depenses-AquaSachet.docx §4.2) ──
  // Compare le total du MOIS EN COURS de chaque catégorie à son budget
  // configuré dans Paramètres (DB.params.budgetsDepenses) — flux, jamais
  // cumulé, pour rester dans le principe "balance vs flux" déjà appliqué
  // ailleurs dans l'app. Seules les catégories avec un budget > 0 configuré
  // apparaissent ici ; le reste n'a simplement pas d'alerte.
  //
  // `CATEGORIES.includes(cat)` exclut toute catégorie retirée de la liste
  // sélectionnable (ex: "Énergie", scindée le 2026-08-21 en "Facture
  // électricité / Woyofal" / "Facture eau (SEN EAU)" / "Carburant (groupe
  // électrogène)" — voir helpers.ts CATEGORIES_DEPENSES) mais dont le budget
  // reste configuré dans Firestore tant qu'un admin n'a pas resauvegardé
  // Paramètres (voir executeSave() dans ParametresSection.tsx, qui ne
  // reconstruit budgetsDepenses qu'à partir des catégories actuelles). Sans
  // ce filtre, une catégorie retirée continuait d'afficher sa tuile ici
  // (avec un total qui ne peut plus jamais bouger une fois les dépenses
  // reclassées) — repéré par l'utilisateur avec la tuile "Énergie" restée
  // affichée à 880 126 F / 250 000 F après la scission.
  const suiviBudgetaire = useMemo(() => {
    const budgets = DB.params.budgetsDepenses || {};
    const totauxParCategorie: Record<string, number> = {};
    DB.depenses.forEach((d) => {
      if ((d.date || "").startsWith(mois)) {
        totauxParCategorie[d.categorie] = (totauxParCategorie[d.categorie] || 0) + d.montant;
      }
    });
    return Object.entries(budgets)
      .filter(([cat, budget]) => budget > 0 && CATEGORIES.includes(cat))
      .map(([cat, budget]) => {
        const total = totauxParCategorie[cat] || 0;
        return { categorie: cat, total, budget, pct: Math.round((total / budget) * 100), depasse: total > budget };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [DB.depenses, DB.params.budgetsDepenses, mois]);

  // Dépenses encore en catégorie "Énergie" (avant la scission du 2026-08-21,
  // voir CATEGORIES_DEPENSES dans helpers.ts) — tant que cette liste n'est
  // pas vide, le bouton "Reclasser Énergie" reste visible dans l'en-tête.
  const depensesEnergie = useMemo(() =>
    DB.depenses.filter((d) => d.categorie === "Énergie").sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [DB.depenses]
  );

  const openReclass = () => {
    const initial: Record<string, string> = {};
    depensesEnergie.forEach((d) => { initial[d.id] = suggererCategorieEnergie(d); });
    setReclassChoix(initial);
    setReclassOpen(true);
  };

  const handleConfirmReclass = () => {
    let updatedDB = DB;
    let count = 0;
    for (const d of depensesEnergie) {
      const nouvelleCategorie = reclassChoix[d.id] || NOUVELLE_CARBURANT;
      if (nouvelleCategorie === d.categorie) continue;
      const newItem = { ...d, categorie: nouvelleCategorie };
      updatedDB = { ...updatedDB, depenses: updatedDB.depenses.map((x) => (x.id === d.id ? newItem : x)) };
      const histEntry = updateHistoryEntry(
        "Dépenses", d.id, `${d.libelle} - ${fmt(d.montant)}`, d as any, newItem as any,
        currentUser?.nom || "", "Reclassification \"Énergie\" → catégorie précise", FIELD_LABELS
      );
      updatedDB = histEntry ? addHistoryEntry(updatedDB, histEntry) : updatedDB;
      count++;
    }
    setDB(updatedDB); saveDB(updatedDB);
    logActivity("update", "Dépenses", `Reclassification "Énergie" : ${count} dépense(s) répartie(s) entre "${NOUVELLE_ELECTRICITE}" et "${NOUVELLE_CARBURANT}"`);
    toast.success(count > 0 ? `${count} dépense(s) reclassée(s)` : "Aucun changement à appliquer");
    setReclassOpen(false);
  };

  // Données triées
  const sortedDepenses = useMemo(() =>
    [...DB.depenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [DB.depenses]
  );

  // Catégories pour le filtre
  const categoryOptions = useMemo(() =>
    CATEGORIES.map((c) => ({ value: c, label: c })),
    []
  );

  // Filtres avancés
  const getDate = useCallback((d: Depense) => d.date, []);
  const getCategory = useCallback((d: Depense) => d.categorie, []);
  const getSearchText = useCallback((d: Depense) => `${d.libelle} ${d.categorie} ${d.fournisseur || ""}`, []);

  const { filters, setFilters, filteredData, totalCount, resultCount } = useTableFilters({
    data: sortedDepenses,
    getDate,
    getCategory,
    getSearchText,
  });

  const pagination = usePagination(filteredData, { pageSize: 20 });

  // Total filtré
  const totalFiltre = filteredData.reduce((s, d) => s + d.montant, 0);

  // ─── Récapitulatif des salaires du mois, regroupés par employé ────────────
  // Le premier mois ayant une dépense "Salaires" borne le sélecteur de mois,
  // pour ne pas proposer des mois plus anciens que le début réel de la saisie.
  const premierMoisSalaire = useMemo(() => {
    const dates = DB.depenses.filter((d) => d.categorie === "Salaires" && d.date).map((d) => d.date);
    if (dates.length === 0) return undefined;
    return dates.reduce((min, d) => (d < min ? d : min)).slice(0, 7);
  }, [DB.depenses]);

  const employesActifs = useMemo(() => (DB.employes || []).filter((e) => e.actif !== false), [DB.employes]);
  const employesById = useMemo(() => new Map((DB.employes || []).map((e) => [e.id, e] as [string, Employe])), [DB.employes]);
  // Nom (normalisé) -> id, pour rattacher automatiquement les anciennes
  // dépenses "Salaires" saisies en texte libre (Depense.fournisseur, sans
  // employeId) à un employé actif du même nom, insensible à la casse/espaces
  // — ex: fournisseur "Saliou" ou "SALIOU " se rattache à l'employé "saliou".
  // Sans ce rattachement, ces anciennes dépenses restaient invisibles dans le
  // récap de l'employé nouvellement créé (elles apparaissaient comme un
  // groupe séparé, sous leur texte brut).
  const employeIdParNom = useMemo(() => {
    const map = new Map<string, string>();
    employesActifs.forEach((e) => map.set(e.nom.trim().toLowerCase(), e.id));
    return map;
  }, [employesActifs]);

  // Recherche du nom d'un employé comme mot entier dans un texte libre (ex:
  // "AVANCE SUR SALAIRE MZ SALIOU" contient "saliou"), en comparant des
  // suites de mots plutôt qu'une sous-chaîne brute — évite qu'un nom court
  // comme "sal" corresponde par erreur à l'intérieur de "salaire". Gère
  // aussi les noms composés de plusieurs mots (ex: "Awa Diop").
  const texteContientNom = (texte: string, nomNorm: string) => {
    if (!nomNorm) return false;
    const mots = (texte || "").toLowerCase().split(/[^a-zà-öø-ÿ0-9]+/).filter(Boolean);
    const nomMots = nomNorm.split(/\s+/).filter(Boolean);
    if (nomMots.length === 0) return false;
    for (let i = 0; i <= mots.length - nomMots.length; i++) {
      if (nomMots.every((m, j) => mots[i + j] === m)) return true;
    }
    return false;
  };

  // Regroupe une dépense "Salaires" par employé : priorité à Depense.employeId
  // (rubrique Employés) ; à défaut, si l'ancien texte libre Depense.fournisseur
  // correspond (insensible à la casse) au nom d'un employé actif, rattache à
  // cet employé ; à défaut encore, si le nom apparaît dans le Libellé (le cas
  // le plus fréquent pour les dépenses "Salaires" saisies avant la rubrique
  // Employés — voir capture d'écran utilisateur : "Fournisseur" y était
  // toujours resté vide, le nom n'existant que dans des libellés comme
  // "AVANCE SUR SALAIRE MZ SALIOU" ou "CARBURANT MA SALIOU"), rattache à cet
  // employé ; sinon repli sur le texte brut du fournisseur tel quel.
  const employeKey = (d: Depense) => {
    if (d.employeId) return d.employeId;
    const fournisseurNorm = (d.fournisseur || "").trim().toLowerCase();
    if (fournisseurNorm && employeIdParNom.has(fournisseurNorm)) return employeIdParNom.get(fournisseurNorm)!;
    const matchLibelle = Array.from(employeIdParNom.entries()).find(([nomNorm]) => texteContientNom(d.libelle, nomNorm));
    if (matchLibelle) return matchLibelle[1];
    return (d.fournisseur || "").trim() || "Sans nom";
  };
  const employeLabel = (d: Depense) => {
    const key = employeKey(d);
    if (employesById.has(key)) return employesById.get(key)!.nom;
    if (d.employeId) return "(employé supprimé)";
    return (d.fournisseur || "").trim() || "Sans nom";
  };

  // Liste des employés proposés dans le menu déroulant du récap : tous les
  // employés actifs de la rubrique Employés (même sans paiement ce mois-ci),
  // plus tout nom trouvé dans l'historique "Salaires" non couvert par eux
  // (employé inactif/supprimé depuis, ou ancienne saisie en texte libre).
  const employesSalaires = useMemo(() => {
    const options = new Map<string, string>();
    employesActifs.forEach((e) => options.set(e.id, e.nom));
    DB.depenses.forEach((d) => {
      if (d.categorie === "Salaires") {
        const key = employeKey(d);
        if (!options.has(key)) options.set(key, employeLabel(d));
      }
    });
    return Array.from(options.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [DB.depenses, employesActifs, employesById, employeIdParNom]);

  const recapSalaires = useMemo(() => {
    const salaires = DB.depenses.filter((d) =>
      d.categorie === "Salaires" &&
      (d.date || "").startsWith(recapMois) &&
      (recapEmploye === "__tous__" || employeKey(d) === recapEmploye)
    );
    type Paiement = { date: string; montant: number; libelle: string };
    const parEmploye = new Map<string, { employe: string; total: number; paiements: Paiement[] }>();
    for (const d of salaires) {
      const key = employeKey(d);
      const label = employeLabel(d);
      const paiement: Paiement = { date: d.date, montant: d.montant, libelle: d.libelle };
      const existant = parEmploye.get(key);
      if (existant) {
        existant.total += d.montant;
        existant.paiements.push(paiement);
      } else {
        parEmploye.set(key, { employe: label, total: d.montant, paiements: [paiement] });
      }
    }
    const groupes = Array.from(parEmploye.values())
      .map((g) => ({ ...g, paiements: g.paiements.sort((a, b) => (a.date < b.date ? 1 : -1)) }))
      .sort((a, b) => b.total - a.total);
    const totalGeneral = salaires.reduce((s, d) => s + d.montant, 0);
    return { groupes, totalGeneral, nombrePaiements: salaires.length };
  }, [DB.depenses, recapMois, recapEmploye, employesById, employeIdParNom]);

  // Ouvre le formulaire en mode création (id absent) ou en mode édition
  // (id fourni) — pré-remplit les champs à partir de la dépense existante.
  // Une dépense mal saisie peut ainsi être corrigée directement au lieu
  // d'être supprimée puis recréée (ce qui faisait perdre l'historique de la
  // ligne d'origine — voir Etude-Depenses-AquaSachet.docx, §4.1).
  const handleOpen = (id?: string) => {
    if (id) {
      const d = DB.depenses.find((x) => x.id === id);
      if (!d) return;
      setEditId(id);
      setDate(d.date);
      setCategorie(d.categorie);
      setLibelle(d.libelle);
      setFournisseur(d.categorie === "Salaires" ? "" : (d.fournisseur || ""));
      setEmployeId(d.categorie === "Salaires" ? (d.employeId || "") : "");
      setMontant(String(d.montant));
    } else {
      setEditId(null);
      setDate(todayLocal());
      setCategorie(CATEGORIES[0]);
      setLibelle("");
      setFournisseur("");
      setEmployeId("");
      setMontant("");
    }
    setOpen(true);
  };

  const handleSave = () => {
    // Vérifier la clôture
    const clotureMsg = checkCloture(date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    // Pour "Salaires", l'employé est choisi dans la rubrique Employés plutôt
    // que saisi en texte libre — voir employesActifs/employeId ci-dessus.
    if (categorie === "Salaires" && !employeId) { toast.error("Sélectionnez un employé"); return; }
    const employeSelectionne = categorie === "Salaires" ? employesById.get(employeId) : undefined;
    const fournisseurFinal = categorie === "Salaires" ? (employeSelectionne?.nom || "") : fournisseur;
    // Validation métier
    const validation = validateDepense({ libelle, montant: Number(montant), categorie, date, fournisseur: fournisseurFinal }, DB);
    if (!validation.valid) { validation.errors.forEach((e) => toast.error(e)); return; }
    if (validation.warnings.length > 0) { validation.warnings.forEach((w) => toast.warning(w)); }

    // employeId n'est conservé que pour la catégorie "Salaires" — explicitement
    // effacé (undefined) sinon, pour ne pas laisser un lien orphelin si la
    // catégorie d'une dépense "Salaires" existante est changée lors d'une
    // modification (même convention que EmployesSection.tsx : un champ
    // optionnel s'efface en lui assignant undefined).
    const champs = {
      date, categorie, libelle: libelle.trim(), fournisseur: fournisseurFinal, montant: Number(montant),
      employeId: categorie === "Salaires" ? employeId : undefined,
    };

    // Seuil d'approbation des dépenses (Etude-Depenses-AquaSachet.docx §4.2) :
    // si un seuil est configuré (DB.params.seuilApprobationDepense) et que
    // l'utilisateur n'est pas admin, une NOUVELLE dépense au-delà du seuil
    // part en demande d'approbation (réutilise le circuit maker/checker déjà
    // en place — voir approvalWorkflow.ts/ApprobationsSection.tsx) au lieu
    // d'être enregistrée immédiatement. Ne s'applique pas à la modification
    // d'une dépense existante, et pas à l'admin (seul approbateur possible :
    // il ne pourrait jamais approuver sa propre demande).
    if (!editId && currentUser && currentUser.role !== "admin") {
      const approvalConfig: ApprovalConfig = { ...DEFAULT_APPROVAL_CONFIG, seuilDepense: DB.params.seuilApprobationDepense };
      if (requiresApproval("depense_elevee", { montant: Number(montant), config: approvalConfig })) {
        const request = createApprovalRequest({
          action: "depense_elevee",
          module: "depenses",
          description: `Dépense ${categorie} : ${libelle.trim()} — ${fmt(Number(montant))}`,
          details: champs,
          montant: Number(montant),
          initiateur: { userId: currentUser.uid, email: currentUser.email, role: currentUser.role, nom: currentUser.nom },
        });
        request.id = `apr_${uid()}`;
        const updated = { ...DB, approvals: [...(DB.approvals || []), request] };
        setDB(updated); saveDB(updated);
        logActivity("demande", "Dépenses", `Dépense au-delà du seuil (${fmt(DB.params.seuilApprobationDepense || 0)}) envoyée en approbation : ${libelle.trim()} — ${fmt(Number(montant))}`);
        toast.success(`Dépense au-delà de ${fmt(DB.params.seuilApprobationDepense || 0)} — envoyée à l'admin pour approbation`);
        setOpen(false);
        return;
      }
    }

    if (editId) {
      const oldItem = DB.depenses.find((d) => d.id === editId);
      const newItem = { ...oldItem, ...champs } as Depense;
      let updated = { ...DB, depenses: DB.depenses.map((d) => (d.id === editId ? newItem : d)) };
      const histEntry = oldItem ? updateHistoryEntry("Dépenses", editId, `${libelle} - ${fmt(Number(montant))}`, oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS) : null;
      updated = histEntry ? addHistoryEntry(updated, histEntry) : updated;
      setDB(updated); saveDB(updated);
      logActivity("update", "Dépense", `${libelle} - ${fmt(Number(montant))}`);
      toast.success("Dépense modifiée");
    } else {
      const item: Depense = { id: uid(), ...champs };
      let updated = { ...DB, depenses: [...DB.depenses, item] };
      const histEntry = createHistoryEntry("Dépenses", item.id, `${libelle} - ${fmt(Number(montant))}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      updated = addHistoryEntry(updated, histEntry);
      setDB(updated); saveDB(updated);
      logActivity("create", "Dépense", `${libelle} - ${fmt(Number(montant))}`);
      toast.success("Dépense enregistrée");
    }
    setOpen(false);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const item = DB.depenses.find((d) => d.id === deleteId);
    if (!item) return;
    // Vérifier la clôture
    const clotureMsg = checkCloture(item.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); setDeleteId(null); return; }
    let updated = { ...DB, depenses: DB.depenses.filter((d) => d.id !== deleteId), corbeille: [...DB.corbeille, { id: uid(), originalType: "depenses", moduleName: "Dépense", desc: `${item.libelle} - ${fmt(item.montant)}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }] };
    // Historique
    const histEntry = deleteHistoryEntry("Dépenses", deleteId, `${item.libelle} - ${fmt(item.montant)}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated); logActivity("delete", "Dépense", item.libelle); toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dépenses</h2>
          <p className="text-sm text-gray-500">Total mois : <span className="font-bold text-red-600">{fmt(totalMois)}</span>
            {(filters.dateFrom || filters.dateTo || filters.category || filters.search) && (
              <span className="ml-2">| Filtré : <span className="font-bold text-red-600">{fmt(totalFiltre)}</span></span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Plus className="w-4 h-4 mr-2" /> Nouvelle dépense</Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4 mr-2" /> Importer CSV</Button>
          <Button variant="outline" onClick={() => { setRecapMois(getMoisCourant()); setRecapEmploye("__tous__"); setRecapSalairesOpen(true); }}><Users className="w-4 h-4 mr-2" /> Récap salaires</Button>
          {depensesEnergie.length > 0 && (
            <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" onClick={openReclass}>
              <Shuffle className="w-4 h-4 mr-2" /> Reclasser Énergie ({depensesEnergie.length})
            </Button>
          )}
          <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImportCSV} />
        </div>
      </div>

      {/* Suivi budgétaire par catégorie — alerte visuelle si dépassement.
          Réservé à l'admin (demande utilisateur, 2026-08-21) : caissier/
          commercial ont aussi accès à la section Dépenses (ROLE_SECTIONS,
          helpers.ts) mais ne voient plus cette carte. */}
      {currentUser?.role === "admin" && suiviBudgetaire.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Budget par catégorie — {moisLabel(mois)}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {suiviBudgetaire.map((s) => (
                <div
                  key={s.categorie}
                  className={`p-3 rounded-lg border ${s.depasse ? "bg-red-50 border-red-200" : s.pct >= 80 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{s.categorie}</span>
                    {s.depasse && (
                      <Badge className="bg-red-100 text-red-700 text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Dépassé
                      </Badge>
                    )}
                  </div>
                  <p className={`text-xs ${s.depasse ? "text-red-700 font-medium" : "text-gray-500"}`}>
                    {fmt(s.total)} / {fmt(s.budget)} ({s.pct}%)
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filtres avancés */}
      <TableFilters
        config={{
          dateRange: true,
          search: true,
          searchPlaceholder: "Rechercher par libellé, catégorie, fournisseur...",
          categories: categoryOptions,
          categoryLabel: "Catégorie",
        }}
        values={filters}
        onChange={setFilters}
        resultCount={resultCount}
        totalCount={totalCount}
      />

      <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Catégorie</TableHead><TableHead>Libellé</TableHead><TableHead>Fournisseur</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
        {pagination.paginatedItems.length > 0 ? pagination.paginatedItems.map((d) => (
          <TableRow key={d.id}><TableCell>{fmtDate(d.date)}</TableCell><TableCell><span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">{d.categorie}</span></TableCell><TableCell className="font-medium">{d.libelle}</TableCell><TableCell>{d.fournisseur || "-"}</TableCell><TableCell className="text-right font-bold text-red-600">{fmt(d.montant)}</TableCell><TableCell><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => handleOpen(d.id)} aria-label={`Modifier ${d.libelle}`}><Pencil className="w-3 h-3" /></Button><Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(d.id)} aria-label={`Supprimer ${d.libelle}`}><Trash2 className="w-3 h-3" /></Button></div></TableCell></TableRow>
        )) : <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-8">{filters.search || filters.dateFrom || filters.dateTo || filters.category ? "Aucun résultat avec ces filtres" : "Aucune dépense"}</TableCell></TableRow>}
      </TableBody></Table></div>
      <Pagination {...pagination} />
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editId ? "Modifier la dépense" : "Nouvelle dépense"}</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>Catégorie</Label><Select value={categorie} onValueChange={(v) => { setCategorie(v); if (v !== "Salaires") setEmployeId(""); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Libellé</Label><Input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Ex: Achat rouleaux" /></div>
          {categorie === "Salaires" ? (
            <div>
              <Label>Employé</Label>
              {employesActifs.length > 0 ? (
                <Select value={employeId} onValueChange={setEmployeId}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner un employé" /></SelectTrigger>
                  <SelectContent>
                    {employesActifs.map((e) => <SelectItem key={e.id} value={e.id}>{e.nom}{e.poste ? ` — ${e.poste}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-amber-600 mt-1">Aucun employé actif. Ajoutez-en un dans la rubrique "Employés" pour pouvoir le sélectionner ici.</p>
              )}
            </div>
          ) : (
            <div><Label>Fournisseur</Label><Input value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} /></div>
          )}
          <div><Label>Montant (F)</Label><Input type="number" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0" /></div>
          <div className="flex gap-2 pt-2"><Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">{editId ? "Modifier" : "Enregistrer"}</Button><Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button></div>
        </div>
      </DialogContent></Dialog>

      <Dialog open={recapSalairesOpen} onOpenChange={setRecapSalairesOpen}><DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Récapitulatif mensuel des salaires par employé</DialogTitle></DialogHeader>
        <div className="pt-2 space-y-4">
          <div className="flex flex-wrap gap-2">
            <MonthSelector value={recapMois} onChange={setRecapMois} minMois={premierMoisSalaire} />
            <Select value={recapEmploye} onValueChange={setRecapEmploye}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Tous les employés" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__tous__">Tous les employés</SelectItem>
                {employesSalaires.map((opt) => <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {recapSalaires.groupes.length > 0 ? recapSalaires.groupes.map((g) => (
            <div key={g.employe} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-gray-900">{g.employe}</span>
                <span className="font-bold text-red-600">{fmt(g.total)}</span>
              </div>
              <div className="space-y-1">
                {g.paiements.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm text-gray-600 pl-2 border-l-2 border-gray-100">
                    <span className="truncate pr-2">{fmtDate(p.date)}{p.libelle ? ` — ${p.libelle}` : ""}</span>
                    <span className="whitespace-nowrap">{fmt(p.montant)}</span>
                  </div>
                ))}
              </div>
            </div>
          )) : (
            <p className="text-center text-gray-400 py-8">
              {recapEmploye === "__tous__" ? "Aucune dépense de catégorie \"Salaires\" pour ce mois" : `Aucun salaire versé à ${employesSalaires.find((o) => o.key === recapEmploye)?.label || recapEmploye} pour ce mois`}
            </p>
          )}
          <div className="flex items-center justify-between pt-4 mt-2 border-t">
            <span className="text-sm text-gray-500">{recapSalaires.nombrePaiements} paiement(s) ce mois-ci</span>
            <span className="text-lg font-bold text-red-600">Total du mois : {fmt(recapSalaires.totalGeneral)}</span>
          </div>
          <Button variant="outline" onClick={() => setRecapSalairesOpen(false)} className="w-full">Fermer</Button>
        </div>
      </DialogContent></Dialog>

      <Dialog open={reclassOpen} onOpenChange={setReclassOpen}><DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Reclasser les dépenses "Énergie"</DialogTitle></DialogHeader>
        <div className="pt-2 space-y-4">
          <p className="text-sm text-gray-500">
            "Énergie" a été scindée en trois catégories plus précises. Choisissez, pour chacune des {depensesEnergie.length} dépense(s)
            encore classée(s) "Énergie", vers laquelle la reclasser — une suggestion est déjà proposée selon le libellé/fournisseur
            (Woyofal/Senelec/électricité, SEN EAU/SDE/"eau", sinon carburant par défaut), à corriger si besoin avant de confirmer.
          </p>
          <div className="space-y-2">
            {depensesEnergie.map((d) => (
              <div key={d.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 border rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{d.libelle}</p>
                  <p className="text-xs text-gray-500">{fmtDate(d.date)} · {d.fournisseur || "-"} · {fmt(d.montant)}</p>
                </div>
                <Select
                  value={reclassChoix[d.id] || NOUVELLE_CARBURANT}
                  onValueChange={(v) => setReclassChoix((prev) => ({ ...prev, [d.id]: v }))}
                >
                  <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOUVELLE_ELECTRICITE}>{NOUVELLE_ELECTRICITE}</SelectItem>
                    <SelectItem value={NOUVELLE_EAU}>{NOUVELLE_EAU}</SelectItem>
                    <SelectItem value={NOUVELLE_CARBURANT}>{NOUVELLE_CARBURANT}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={handleConfirmReclass} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Confirmer la reclassification</Button>
            <Button variant="outline" onClick={() => setReclassOpen(false)}>Annuler</Button>
          </div>
        </div>
      </DialogContent></Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Supprimer cette dépense ?"
        description="La dépense sera déplacée dans la corbeille."
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
