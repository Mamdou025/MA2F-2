import { useState, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, fmtNumber, todayLocal, computeStockMatierePremiere, SEUIL_ALERTE_STOCK_ROULEAU_KG } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Package, Undo2, Pencil, ChevronDown, ChevronUp, AlertTriangle, TrendingUp, Truck } from "lucide-react";
import { toast } from "sonner";
import { validateLivraison } from "@/lib/validation";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { creerMouvementReception } from "@/lib/stock";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// Distance de Levenshtein simplifiée — sert uniquement à repérer des noms de
// fournisseur qui se ressemblent (probable faute de frappe/variante) sans
// bloquer la saisie, puisque le fournisseur reste un champ texte libre (pas
// d'entité dédiée comme Client/Livreur/Commercial).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

export default function LivraisonsSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [fournisseur, setFournisseur] = useState("");
  const [kg, setKg] = useState("");
  const [prix, setPrix] = useState("");
  const [modePaiement, setModePaiement] = useState<"cash" | "credit">("cash");
  const prixKg = DB.params.prixRouleau || 3650;
  // Détails avancés (optionnels) : commande vs réception + contrôle qualité
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [kgCommande, setKgCommande] = useState("");
  const [prixKgCommande, setPrixKgCommande] = useState("");
  const [qualiteNonConforme, setQualiteNonConforme] = useState(false);
  const [quantiteRejetee, setQuantiteRejetee] = useState("");
  const [qualiteNotes, setQualiteNotes] = useState("");

  // Emballage (cartons)
  const [openEmb, setOpenEmb] = useState(false);
  const [editEmbId, setEditEmbId] = useState<string | null>(null);
  const [embDate, setEmbDate] = useState(todayLocal());
  const [embNbCartons, setEmbNbCartons] = useState("");
  const [embPrixCarton, setEmbPrixCarton] = useState(String(DB.params.prixCarton || 3000));
  const [embModePaiement, setEmbModePaiement] = useState<"cash" | "credit">("cash");
  const emballages = (DB as any).emballages || [];

  // Calcul du stock disponible — délègue à computeStockMatierePremiere
  // (client/src/lib/helpers.ts), le calcul canonique partagé avec le
  // Dashboard, pour éviter d'avoir deux formules indépendantes qui
  // pourraient un jour diverger (voir "Balance vs flux" dans CLAUDE.md).
  const stockData = useMemo(() => {
    const tauxKgParPack = 1 / (DB.params.tauxSachetsParKg || 17);
    const stockKg = Math.max(0, computeStockMatierePremiere(DB));
    const autonomiePacks = Math.floor(stockKg / tauxKgParPack);
    
    // Valeur stock = stock kg * prix moyen au kg + valeur emballages
    const prixMoyenKg = DB.livraisons.length > 0
      ? DB.livraisons.reduce((s, l) => s + l.prix, 0) / DB.livraisons.reduce((s, l) => s + l.kg, 0)
      : (DB.params.prixRouleau || 3650);
    const valeurRouleaux = stockKg * prixMoyenKg;
    
    // Valeur emballages (total des cartons achetés)
    const valeurEmballages = ((DB as any).emballages || []).reduce((s: number, e: any) => s + (e.total || 0), 0);
    const valeurStock = valeurRouleaux + valeurEmballages;

    return { stockKg, autonomiePacks, valeurStock, valeurRouleaux, valeurEmballages };
  }, [DB]);

  // Liste des noms de fournisseurs distincts déjà utilisés (pour autocomplete
  // + détection de quasi-doublons), en conservant la première casse rencontrée.
  const fournisseurNames = useMemo(() => {
    const seen = new Map<string, string>();
    DB.livraisons.forEach((l) => {
      const key = l.fournisseur.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, l.fournisseur.trim());
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "fr"));
  }, [DB.livraisons]);

  // Statistiques par fournisseur : nb livraisons, kg total, montant total,
  // prix moyen/kg, dernière livraison — pour repérer les gros fournisseurs
  // et détecter un prix anormal par rapport à l'historique de CE fournisseur.
  const fournisseurStats = useMemo(() => {
    const map = new Map<string, { nom: string; nb: number; kg: number; montant: number; derniere: string; prixKgList: number[] }>();
    [...DB.livraisons].sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach((l) => {
      const key = l.fournisseur.trim().toLowerCase();
      if (!key) return;
      const entry = map.get(key) || { nom: l.fournisseur.trim(), nb: 0, kg: 0, montant: 0, derniere: "", prixKgList: [] };
      entry.nb += 1;
      entry.kg += l.kg;
      entry.montant += l.prix;
      if (!entry.derniere || (l.date || "") > entry.derniere) entry.derniere = l.date || "";
      if (l.kg > 0) entry.prixKgList.push(l.prix / l.kg);
      map.set(key, entry);
    });
    return Array.from(map.values()).map((e) => {
      const prixMoyenKg = e.prixKgList.length > 0 ? e.prixKgList.reduce((s, p) => s + p, 0) / e.prixKgList.length : 0;
      const dernierPrix = e.prixKgList[e.prixKgList.length - 1] || 0;
      const moyenneSansDernier = e.prixKgList.length > 1
        ? e.prixKgList.slice(0, -1).reduce((s, p) => s + p, 0) / (e.prixKgList.length - 1)
        : 0;
      const ecartPct = moyenneSansDernier > 0 ? Math.round(((dernierPrix - moyenneSansDernier) / moyenneSansDernier) * 100) : 0;
      return { ...e, prixMoyenKg, ecartDernierPct: e.prixKgList.length > 1 ? ecartPct : 0 };
    }).sort((a, b) => b.montant - a.montant);
  }, [DB.livraisons]);

  // Alerte de prix pour le fournisseur actuellement sélectionné dans le
  // formulaire, calculée en direct pendant la saisie (hors édition en cours).
  const prixAlerteFournisseur = useMemo(() => {
    const key = fournisseur.trim().toLowerCase();
    if (!key || !kg || Number(kg) <= 0) return null;
    const stat = fournisseurStats.find((s) => s.nom.toLowerCase() === key);
    if (!stat || stat.prixKgList.length < 2) return null;
    const baseline = editId
      ? stat.prixKgList.length > 1 ? stat.prixMoyenKg : 0
      : stat.prixMoyenKg;
    if (!baseline) return null;
    const prixSaisiKg = (Number(prix) || 0) / Number(kg);
    const ecart = Math.round(((prixSaisiKg - baseline) / baseline) * 100);
    if (Math.abs(ecart) < 15) return null;
    return { ecart, baseline };
  }, [fournisseur, kg, prix, fournisseurStats, editId]);

  // Nom de fournisseur similaire déjà utilisé (probable variante/faute de
  // frappe) — n'affiche rien si le nom correspond exactement à un existant.
  const fournisseurSimilaire = useMemo(() => {
    const trimmed = fournisseur.trim();
    if (trimmed.length < 4) return null;
    const key = trimmed.toLowerCase();
    if (fournisseurNames.some((n) => n.toLowerCase() === key)) return null;
    const candidate = fournisseurNames.find((n) => levenshtein(n.toLowerCase(), key) <= 2);
    return candidate || null;
  }, [fournisseur, fournisseurNames]);

  // Alerte juste après une réception si le stock retombe à un niveau
  // critique — réutilise le calcul et le seuil canoniques importés de
  // helpers.ts (computeStockMatierePremiere / SEUIL_ALERTE_STOCK_ROULEAU_KG).
  const alerterSiStockRouleauBas = (db: typeof DB) => {
    const stockKg = Math.max(0, computeStockMatierePremiere(db));
    if (stockKg <= SEUIL_ALERTE_STOCK_ROULEAU_KG) {
      toast.warning(`Stock de rouleaux plastique bas : ${fmtNumber(Math.round(stockKg * 100) / 100)} kg disponibles (seuil d'alerte : ${SEUIL_ALERTE_STOCK_ROULEAU_KG} kg) — pensez à commander.`);
    }
  };

  const handleSave = () => {
    // Vérifier la clôture
    const clotureMsg = checkCloture(date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    // Validation métier
    const validation = validateLivraison({ fournisseur, kg: Number(kg), prix: Number(prix) || 0, date }, DB);
    if (!validation.valid) { validation.errors.forEach((e) => toast.error(e)); return; }
    if (validation.warnings.length > 0) { validation.warnings.forEach((w) => toast.warning(w)); }

    // Alertes non bloquantes : nom de fournisseur qui ressemble à un existant,
    // et prix inhabituel par rapport à l'historique de ce fournisseur.
    if (fournisseurSimilaire) {
      toast.warning(`"${fournisseur.trim()}" ressemble à "${fournisseurSimilaire}" déjà utilisé — vérifiez qu'il ne s'agit pas du même fournisseur.`);
    }
    if (prixAlerteFournisseur) {
      toast.warning(`Prix inhabituel pour ce fournisseur : ${prixAlerteFournisseur.ecart > 0 ? "+" : ""}${prixAlerteFournisseur.ecart}% vs sa moyenne habituelle (${fmtNumber(Math.round(prixAlerteFournisseur.baseline))} F/kg).`);
    }

    const extraFields = {
      kgCommande: kgCommande ? Number(kgCommande) : undefined,
      prixKgCommande: prixKgCommande ? Number(prixKgCommande) : undefined,
      qualiteConforme: qualiteNonConforme ? false : undefined,
      quantiteRejetee: qualiteNonConforme && quantiteRejetee ? Number(quantiteRejetee) : undefined,
      qualiteNotes: qualiteNonConforme && qualiteNotes.trim() ? qualiteNotes.trim() : undefined,
    };

    if (editId) {
      const oldItem = DB.livraisons.find((l) => l.id === editId);
      if (!oldItem) { toast.error("Réception introuvable"); return; }
      const newItem = { ...oldItem, numero: numero || oldItem.numero, date, fournisseur: fournisseur.trim(), kg: Number(kg), prix: Number(prix) || 0, modePaiement, ...extraFields };

      let updated = { ...DB, livraisons: DB.livraisons.map((l) => l.id === editId ? newItem : l) };

      // Synchroniser le mouvement de stock lié (quantité, libellé)
      updated = {
        ...updated,
        mouvementsStock: (updated.mouvementsStock || []).map((m: any) =>
          m.type === "reception" && m.produit === "rouleau_plastique" && m.reference === editId
            ? { ...m, date, quantite: Number(kg), referenceLabel: `Réception ${fournisseur.trim()}` }
            : m
        ),
      };

      // Synchroniser la dépense auto-générée liée à cette réception, s'il y en a une
      const depenseNote = `Généré automatiquement - ${oldItem.numero}`;
      const existingDepense = updated.depenses.find((d) => d.notes === depenseNote && d.categorie === "Matière première");

      if (oldItem.modePaiement === "cash" && modePaiement === "credit") {
        // On repasse en crédit : supprimer la dépense cash générée à tort
        if (existingDepense) {
          updated = { ...updated, depenses: updated.depenses.filter((d) => d.id !== existingDepense.id) };
        }
      } else if (oldItem.modePaiement === "credit" && modePaiement === "cash") {
        if (oldItem.datePaiement) {
          toast.error("Ce crédit a déjà été marqué comme payé — annulez d'abord ce paiement avant de repasser en cash.");
          return;
        }
        const depenseCash = {
          id: uid(),
          date,
          categorie: "Matière première",
          libelle: `Achat rouleaux ${newItem.numero} - ${fournisseur.trim()} (${kg} kg)`,
          fournisseur: fournisseur.trim(),
          montant: Number(prix) || 0,
          mode: "Espèces",
          notes: `Généré automatiquement - ${newItem.numero}`,
        };
        updated = { ...updated, depenses: [...updated.depenses, depenseCash] };
      } else if (modePaiement === "cash" && existingDepense) {
        // Reste en cash : synchroniser montant/libellé/date si modifiés
        updated = {
          ...updated,
          depenses: updated.depenses.map((d) =>
            d.id === existingDepense.id
              ? { ...d, date, montant: Number(prix) || 0, fournisseur: fournisseur.trim(), libelle: `Achat rouleaux ${newItem.numero} - ${fournisseur.trim()} (${kg} kg)` }
              : d
          ),
        };
      }

      // Historique
      const histEntry = updateHistoryEntry("Réception rouleaux", editId, `${newItem.numero} - ${fournisseur}`, oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      if (histEntry) updated = addHistoryEntry(updated, histEntry);

      setDB(updated); saveDB(updated);
      logActivity("update", "Réception rouleaux", `${newItem.numero} - ${fournisseur} - ${kg}kg (${modePaiement === "cash" ? "cash" : "crédit"})`);
      toast.success("Réception modifiée");
      alerterSiStockRouleauBas(updated);
      setOpen(false); setEditId(null);
      return;
    }

    const item = { id: uid(), numero: numero || "LIV-" + String(DB.livraisons.length + 1).padStart(3, "0"), date, fournisseur: fournisseur.trim(), kg: Number(kg), prix: Number(prix) || 0, modePaiement, ...extraFields };
    // Mouvement stock: entrée matière première à l'usine
    const mvtReception = creerMouvementReception(uid(), date, Number(kg), currentUser?.nom || "", item.id, fournisseur.trim());
    let updated = { ...DB, livraisons: [...DB.livraisons, item], mouvementsStock: [...(DB.mouvementsStock || []), mvtReception] };
    // Si cash, créer immédiatement une dépense
    if (modePaiement === "cash") {
      const depenseCash = {
        id: uid(),
        date,
        categorie: "Matière première",
        libelle: `Achat rouleaux ${item.numero} - ${fournisseur.trim()} (${kg} kg)`,
        fournisseur: fournisseur.trim(),
        montant: Number(prix) || 0,
        mode: "Espèces",
        notes: `Généré automatiquement - ${item.numero}`,
      };
      updated = { ...updated, depenses: [...updated.depenses, depenseCash] };
    }
    // Historique
    const histEntry = createHistoryEntry("Réception rouleaux", item.id, `${item.numero} - ${fournisseur}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("create", "Réception rouleaux", `${item.numero} - ${fournisseur} - ${kg}kg${modePaiement === "cash" ? " (ajouté aux dépenses)" : " (à crédit)"}`);
    toast.success(modePaiement === "cash" ? `Réception enregistrée - ${fmt(Number(prix) || 0)} ajouté aux dépenses` : "Réception enregistrée (à crédit)");
    alerterSiStockRouleauBas(updated);
    setOpen(false);
  };

  const handleEdit = (l: typeof DB.livraisons[number]) => {
    setEditId(l.id);
    setNumero(l.numero);
    setDate(l.date);
    setFournisseur(l.fournisseur);
    setKg(String(l.kg));
    setPrix(String(l.prix));
    setModePaiement(l.modePaiement || "cash");
    setKgCommande(l.kgCommande != null ? String(l.kgCommande) : "");
    setPrixKgCommande(l.prixKgCommande != null ? String(l.prixKgCommande) : "");
    setQualiteNonConforme(l.qualiteConforme === false);
    setQuantiteRejetee(l.quantiteRejetee != null ? String(l.quantiteRejetee) : "");
    setQualiteNotes(l.qualiteNotes || "");
    setShowAdvanced(l.kgCommande != null || l.prixKgCommande != null || l.qualiteConforme === false);
    setOpen(true);
  };

  // Emballage
  const handleSaveEmballage = () => {
    const nb = Number(embNbCartons);
    const prixC = Number(embPrixCarton);
    if (!nb || nb <= 0) { toast.error("Nombre de cartons invalide"); return; }
    if (!prixC || prixC <= 0) { toast.error("Prix par carton invalide"); return; }
    const total = nb * prixC;

    if (editEmbId) {
      const oldItem = emballages.find((e: any) => e.id === editEmbId);
      if (!oldItem) { toast.error("Emballage introuvable"); return; }
      const newItem = { ...oldItem, date: embDate, nombreCartons: nb, prixParCarton: prixC, total, modePaiement: embModePaiement };

      let updated = { ...DB, emballages: emballages.map((e: any) => e.id === editEmbId ? newItem : e) };

      const depenseNote = `Généré automatiquement - ${oldItem.numeroLot}`;
      const existingDepense = updated.depenses.find((d) => d.notes === depenseNote && d.categorie === "Emballage");

      if (oldItem.modePaiement === "cash" && embModePaiement === "credit") {
        if (existingDepense) {
          updated = { ...updated, depenses: updated.depenses.filter((d) => d.id !== existingDepense.id) };
        }
      } else if (oldItem.modePaiement === "credit" && embModePaiement === "cash") {
        if (oldItem.datePaiement) {
          toast.error("Ce crédit a déjà été marqué comme payé — annulez d'abord ce paiement avant de repasser en cash.");
          return;
        }
        const depenseEmballage = {
          id: uid(),
          date: embDate,
          categorie: "Emballage",
          libelle: `Achat cartons ${oldItem.numeroLot} (${nb} cartons x ${prixC} F)`,
          fournisseur: "",
          montant: total,
          mode: "Espèces",
          notes: `Généré automatiquement - ${oldItem.numeroLot}`,
        };
        updated = { ...updated, depenses: [...updated.depenses, depenseEmballage] };
      } else if (embModePaiement === "cash" && existingDepense) {
        updated = {
          ...updated,
          depenses: updated.depenses.map((d) =>
            d.id === existingDepense.id
              ? { ...d, date: embDate, montant: total, libelle: `Achat cartons ${oldItem.numeroLot} (${nb} cartons x ${prixC} F)` }
              : d
          ),
        };
      }

      setDB(updated); saveDB(updated);
      logActivity("update", "Emballage carton", `${oldItem.numeroLot} - ${nb} cartons - ${total} F (${embModePaiement === "cash" ? "cash" : "crédit"})`);
      toast.success("Emballage modifié");
      setOpenEmb(false); setEditEmbId(null);
      return;
    }

    const lotNum = "EMB-" + String(emballages.length + 1).padStart(3, "0");
    const item = { id: uid(), numeroLot: lotNum, date: embDate, nombreCartons: nb, prixParCarton: prixC, total, modePaiement: embModePaiement };
    let updated = {
      ...DB,
      emballages: [...emballages, item],
    };
    // Si cash, créer immédiatement une dépense
    if (embModePaiement === "cash") {
      const depenseEmballage = {
        id: uid(),
        date: embDate,
        categorie: "Emballage",
        libelle: `Achat cartons ${lotNum} (${nb} cartons x ${prixC} F)`,
        fournisseur: "",
        montant: total,
        mode: "Espèces",
        notes: `Généré automatiquement - ${lotNum}`,
      };
      updated = { ...updated, depenses: [...updated.depenses, depenseEmballage] };
    }
    setDB(updated); saveDB(updated);
    logActivity("create", "Emballage carton", `${lotNum} - ${nb} cartons - ${total} F${embModePaiement === "cash" ? " (ajouté aux dépenses)" : " (à crédit)"}`);
    toast.success(embModePaiement === "cash" ? `Emballage enregistré et ${fmt(total)} ajouté aux dépenses` : `Emballage enregistré (à crédit)`);
    setOpenEmb(false);
  };

  const handleEditEmballage = (e: any) => {
    setEditEmbId(e.id);
    setEmbDate(e.date);
    setEmbNbCartons(String(e.nombreCartons));
    setEmbPrixCarton(String(e.prixParCarton));
    setEmbModePaiement(e.modePaiement || "cash");
    setOpenEmb(true);
  };

  const [deleteEmbId, setDeleteEmbId] = useState<string | null>(null);
  const deleteEmbTarget = deleteEmbId ? emballages.find((e: any) => e.id === deleteEmbId) || null : null;

  const confirmDeleteEmballage = () => {
    const item = deleteEmbTarget; if (!item) return;
    const updated = { ...DB, emballages: emballages.filter((e: any) => e.id !== item.id), corbeille: [...DB.corbeille, { id: uid(), originalType: "emballages", moduleName: "Emballage", desc: item.numeroLot, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }] };
    setDB(updated); saveDB(updated);
    logActivity("delete", "Emballage carton", item.numeroLot); toast.success("Mis \u00e0 la corbeille");
    setDeleteEmbId(null);
  };

  const handlePayLivraison = (id: string) => {
    const today = todayLocal();
    const item = DB.livraisons.find((l) => l.id === id);
    if (!item) return;
    // Créer une dépense pour le paiement du crédit fournisseur
    const depensePaiement = {
      id: uid(),
      date: today,
      categorie: "Matière première",
      libelle: `Paiement crédit réception ${item.numero} - ${item.fournisseur} (${item.kg} kg)`,
      fournisseur: item.fournisseur,
      montant: item.prix,
      mode: "Espèces",
      notes: `Paiement crédit fournisseur - ${item.numero}`,
    };
    const updated = {
      ...DB,
      livraisons: DB.livraisons.map((l) => l.id === id ? { ...l, datePaiement: today } : l),
      depenses: [...DB.depenses, depensePaiement],
    };
    setDB(updated); saveDB(updated);
    logActivity("update", "Réception rouleaux", `Paiement déclaré pour ${item.numero} - ${fmt(item.prix)} ajouté aux dépenses`);
    toast.success(`Paiement déclaré - ${fmt(item.prix)} ajouté aux dépenses`);
  };

  const handlePayEmballage = (id: string) => {
    const today = todayLocal();
    const item = emballages.find((e: any) => e.id === id);
    if (!item) return;
    // Créer une dépense pour le paiement du crédit emballage
    const depensePaiement = {
      id: uid(),
      date: today,
      categorie: "Emballage",
      libelle: `Paiement crédit emballage ${item.numeroLot} (${item.nombreCartons} cartons)`,
      fournisseur: "",
      montant: item.total,
      mode: "Espèces",
      notes: `Paiement crédit emballage - ${item.numeroLot}`,
    };
    const updated = {
      ...DB,
      emballages: emballages.map((e: any) => e.id === id ? { ...e, datePaiement: today } : e),
      depenses: [...DB.depenses, depensePaiement],
    };
    setDB(updated); saveDB(updated);
    logActivity("update", "Emballage carton", `Paiement déclaré pour ${item.numeroLot} - ${fmt(item.total)} ajouté aux dépenses`);
    toast.success(`Paiement déclaré - ${fmt(item.total)} ajouté aux dépenses`);
  };

  const [cancelPayLivraisonId, setCancelPayLivraisonId] = useState<string | null>(null);
  const cancelPayLivraisonTarget = cancelPayLivraisonId ? DB.livraisons.find((l) => l.id === cancelPayLivraisonId) || null : null;

  const handleCancelPayLivraison = (id: string) => setCancelPayLivraisonId(id);

  const confirmCancelPayLivraison = () => {
    const item = cancelPayLivraisonTarget; if (!item) return;
    const updated = { ...DB, livraisons: DB.livraisons.map((l) => l.id === item.id ? { ...l, datePaiement: undefined } : l) };
    setDB(updated); saveDB(updated);
    logActivity("update", "Réception rouleaux", `Paiement annulé pour ${item.numero}`);
    toast.success("Paiement annulé");
    setCancelPayLivraisonId(null);
  };

  const [cancelPayEmbId, setCancelPayEmbId] = useState<string | null>(null);
  const cancelPayEmbTarget = cancelPayEmbId ? emballages.find((e: any) => e.id === cancelPayEmbId) || null : null;

  const handleCancelPayEmballage = (id: string) => setCancelPayEmbId(id);

  const confirmCancelPayEmballage = () => {
    const item = cancelPayEmbTarget; if (!item) return;
    const updated = { ...DB, emballages: emballages.map((e: any) => e.id === item.id ? { ...e, datePaiement: undefined } : e) };
    setDB(updated); saveDB(updated);
    logActivity("update", "Emballage carton", `Paiement annulé pour ${item.numeroLot}`);
    toast.success("Paiement annulé");
    setCancelPayEmbId(null);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? DB.livraisons.find((l) => l.id === deleteId) || null : null;

  const handleDelete = (id: string) => {
    const item = DB.livraisons.find((l) => l.id === id); if (!item) return;
    // Vérifier la clôture
    const clotureMsg = checkCloture(item.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); return; }
    setDeleteId(id);
  };

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    // Mouvement(s) de stock lié(s) à cette réception, à retirer et conserver pour restauration éventuelle
    const mvtLies = (DB.mouvementsStock || []).filter((m: any) => m.type === "reception" && m.produit === "rouleau_plastique" && m.reference === item.id);
    // Dépense auto-générée liée à cette réception (créée quand modePaiement === "cash"),
    // à supprimer en cascade pour ne pas laisser une dépense orpheline.
    const depenseNote = `Généré automatiquement - ${item.numero}`;
    const depenseLiee = DB.depenses.find((d) => d.notes === depenseNote && d.categorie === "Matière première");
    let updated = {
      ...DB,
      livraisons: DB.livraisons.filter((l) => l.id !== item.id),
      // Retirer le mouvement de stock lié (sinon le stock usine reste gonflé après suppression)
      mouvementsStock: (DB.mouvementsStock || []).filter((m: any) => !(m.type === "reception" && m.produit === "rouleau_plastique" && m.reference === item.id)),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "livraisons", moduleName: "Livraison", desc: item.numero, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item, relatedMouvements: mvtLies }],
    };
    if (depenseLiee) {
      updated = {
        ...updated,
        depenses: updated.depenses.filter((d) => d.id !== depenseLiee.id),
        corbeille: [...updated.corbeille, { id: uid(), originalType: "depenses", moduleName: "Dépense", desc: `${depenseLiee.libelle} - ${fmt(depenseLiee.montant)}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: depenseLiee }],
      };
    }
    // Historique
    const histEntry = deleteHistoryEntry("Réception rouleaux", item.id, item.numero, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("delete", "Réception rouleaux", item.numero + (depenseLiee ? " (+ dépense associée)" : ""));
    toast.success(depenseLiee ? "Réception et dépense associée mises à la corbeille" : "Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span>🚚</span> Réception rouleaux
        </h2>
        <div className="flex gap-2">
          <Button onClick={() => { setEditId(null); setNumero("LIV-" + String(DB.livraisons.length + 1).padStart(3, "0")); setDate(todayLocal()); setFournisseur(""); setKg(""); setPrix(""); setModePaiement("cash"); setKgCommande(""); setPrixKgCommande(""); setQualiteNonConforme(false); setQuantiteRejetee(""); setQualiteNotes(""); setShowAdvanced(false); setOpen(true); }} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
            <Plus className="w-4 h-4 mr-2" /> Nouvelle réception
          </Button>
          <Button onClick={() => { setEditEmbId(null); setEmbDate(todayLocal()); setEmbNbCartons(""); setEmbPrixCarton(String(DB.params.prixCarton || 3000)); setEmbModePaiement("cash"); setOpenEmb(true); }} variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">
            <Package className="w-4 h-4 mr-2" /> Ajouter emballage
          </Button>
        </div>
      </div>

      {/* Alerte : stock de rouleaux plastique au seuil critique ou en dessous.
          Bannière persistante (visible dès l'ouverture de la page), à la
          différence du toast déclenché uniquement lors de l'enregistrement
          d'une réception — les deux coexistent pour couvrir le cas où le
          stock est déjà bas sans qu'aucune réception ne vienne d'être saisie
          (ex: consommé par la production depuis la dernière visite). */}
      {stockData.stockKg <= SEUIL_ALERTE_STOCK_ROULEAU_KG && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">Stock de rouleaux plastique bas</p>
              <p className="text-xs text-red-800 mt-0.5">
                {fmtNumber(Math.round(stockData.stockKg * 100) / 100)} kg disponibles — en dessous du seuil d'alerte de {SEUIL_ALERTE_STOCK_ROULEAU_KG} kg. Pensez à commander une nouvelle réception.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI - Stock disponible, Autonomie, Valeur stock */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Stock disponible</p>
            <p className="text-2xl font-bold text-green-600">{fmtNumber(Math.round(stockData.stockKg * 100) / 100)} kg</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Autonomie estimée</p>
            <p className="text-2xl font-bold text-orange-500">{fmtNumber(stockData.autonomiePacks)} packs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Valeur stock</p>
            <p className="text-2xl font-bold text-blue-600">{fmt(stockData.valeurStock)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Fournisseurs — vue agrégée pour suivre le volume et la stabilité des prix */}
      {fournisseurStats.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4 text-[#1B4B6B]" /> Fournisseurs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Fournisseur</TableHead>
                  <TableHead className="text-right">Livraisons</TableHead>
                  <TableHead className="text-right">Kg total</TableHead>
                  <TableHead className="text-right">Montant total</TableHead>
                  <TableHead className="text-right">Prix moyen/kg</TableHead>
                  <TableHead>Dernière livraison</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {fournisseurStats.map((f) => (
                    <TableRow key={f.nom}>
                      <TableCell className="font-medium">{f.nom}</TableCell>
                      <TableCell className="text-right">{f.nb}</TableCell>
                      <TableCell className="text-right">{fmtNumber(Math.round(f.kg * 100) / 100)} kg</TableCell>
                      <TableCell className="text-right font-medium">{fmt(f.montant)}</TableCell>
                      <TableCell className="text-right">{fmtNumber(Math.round(f.prixMoyenKg))} F/kg</TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {f.derniere ? fmtDate(f.derniere) : "-"}
                        {Math.abs(f.ecartDernierPct) >= 15 && (
                          <span className={`ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${f.ecartDernierPct > 0 ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                            <TrendingUp className="w-3 h-3" /> {f.ecartDernierPct > 0 ? "+" : ""}{f.ecartDernierPct}%
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tableau des livraisons */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">N° Livraison</TableHead>
                  <TableHead className="text-white font-semibold">Date</TableHead>
                  <TableHead className="text-white font-semibold">Fournisseur</TableHead>
                  <TableHead className="text-white font-semibold">Kg</TableHead>
                  <TableHead className="text-white font-semibold">Nb Packs</TableHead>
                  <TableHead className="text-white font-semibold">Prix/kg</TableHead>
                  <TableHead className="text-white font-semibold">Total</TableHead>
                  <TableHead className="text-white font-semibold">Paiement</TableHead>
                  <TableHead className="text-white font-semibold">Action</TableHead>
                  <TableHead className="text-white font-semibold">Suppr.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DB.livraisons.length > 0 ? [...DB.livraisons].reverse().map((l) => {
                  const ecartKg = l.kgCommande != null ? l.kg - l.kgCommande : null;
                  const nonConforme = l.qualiteConforme === false;
                  return (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">{l.numero}</TableCell>
                    <TableCell>{fmtDate(l.date)}</TableCell>
                    <TableCell className="font-medium">
                      {l.fournisseur}
                      {nonConforme && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700" title={l.qualiteNotes || "Problème qualité signalé"}>
                          <AlertTriangle className="w-3 h-3" /> Qualité
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.kg} kg
                      {ecartKg != null && Math.abs(ecartKg) > 0.01 && (
                        <span className={`block text-xs ${ecartKg < 0 ? "text-red-600" : "text-blue-600"}`}>
                          {ecartKg > 0 ? "+" : ""}{fmtNumber(Math.round(ecartKg * 100) / 100)} kg vs commande
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-blue-700">{fmtNumber(Math.round(l.kg * (DB.params.tauxSachetsParKg || 17)))}</TableCell>
                    <TableCell>{l.kg > 0 ? fmtNumber(Math.round(l.prix / l.kg)) + " F/kg" : "-"}</TableCell>
                    <TableCell className="font-bold">{fmt(l.prix)}</TableCell>
                    <TableCell>
                      {l.modePaiement === "credit" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Crédit</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Cash</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.modePaiement === "credit" && !l.datePaiement ? (
                        <Button variant="outline" size="sm" className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs" onClick={() => handlePayLivraison(l.id)}>
                          À payer
                        </Button>
                      ) : l.datePaiement ? (
                        <div className="flex items-center gap-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Payé {fmtDate(l.datePaiement)}</span>
                          {currentUser?.role === "admin" && (
                            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-red-600 h-5 w-5 p-0" onClick={() => handleCancelPayLivraison(l.id)} title="Annuler le paiement">
                              <Undo2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" className="text-blue-600 hover:bg-blue-50" onClick={() => handleEdit(l)} aria-label={`Modifier ${l.numero}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => handleDelete(l.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                }) : (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-gray-400 py-8">Aucune réception</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Tableau Emballages/Cartons */}
      {emballages.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b bg-orange-50">
              <h3 className="font-semibold text-orange-700 flex items-center gap-2"><Package className="w-4 h-4" /> Emballages / Cartons</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-orange-500 hover:bg-orange-500">
                    <TableHead className="text-white font-semibold">N\u00b0 Lot</TableHead>
                    <TableHead className="text-white font-semibold">Date</TableHead>
                    <TableHead className="text-white font-semibold">Nb Cartons</TableHead>
                    <TableHead className="text-white font-semibold">Prix/Carton</TableHead>
                    <TableHead className="text-white font-semibold">Total</TableHead>
                    <TableHead className="text-white font-semibold">Paiement</TableHead>
                    <TableHead className="text-white font-semibold">Action</TableHead>
                    <TableHead className="text-white font-semibold">Suppr.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...emballages].reverse().map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono">{e.numeroLot}</TableCell>
                      <TableCell>{fmtDate(e.date)}</TableCell>
                      <TableCell className="font-bold">{fmtNumber(e.nombreCartons)}</TableCell>
                      <TableCell>{fmt(e.prixParCarton)}</TableCell>
                      <TableCell className="font-bold text-orange-700">{fmt(e.total)}</TableCell>
                      <TableCell>
                        {e.modePaiement === "credit" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Crédit</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Cash</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {e.modePaiement === "credit" && !e.datePaiement ? (
                          <Button variant="outline" size="sm" className="text-blue-600 border-blue-300 hover:bg-blue-50 text-xs" onClick={() => handlePayEmballage(e.id)}>
                            À payer
                          </Button>
                        ) : e.datePaiement ? (
                          <div className="flex items-center gap-1">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Payé {fmtDate(e.datePaiement)}</span>
                            {currentUser?.role === "admin" && (
                              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-red-600 h-5 w-5 p-0" onClick={() => handleCancelPayEmballage(e.id)} title="Annuler le paiement">
                                <Undo2 className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="text-blue-600 hover:bg-blue-50" onClick={() => handleEditEmballage(e)} aria-label={`Modifier ${e.numeroLot}`}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteEmbId(e.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog Emballage */}
      <Dialog open={openEmb} onOpenChange={(o) => { setOpenEmb(o); if (!o) setEditEmbId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editEmbId ? "Modifier l'emballage" : "Ajouter emballage / carton"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>N\u00b0 Lot</Label><Input value={editEmbId ? (emballages.find((e: any) => e.id === editEmbId)?.numeroLot || "") : "EMB-" + String(emballages.length + 1).padStart(3, "0")} disabled className="bg-gray-50 font-mono" /></div>
            <div><Label>Date</Label><Input type="date" value={embDate} onChange={(e) => setEmbDate(e.target.value)} /></div>
            <div><Label>Nombre de cartons</Label><Input type="number" value={embNbCartons} onChange={(e) => setEmbNbCartons(e.target.value)} placeholder="Ex: 5" /></div>
            <div><Label>Prix par carton</Label><Input type="number" value={embPrixCarton} onChange={(e) => setEmbPrixCarton(e.target.value)} /><p className="text-xs text-gray-400 mt-1">Par d\u00e9faut : {fmtNumber(DB.params.prixCarton || 3000)} F (configurable dans Param\u00e8tres)</p></div>
            <div><Label>Total</Label><Input value={fmt(Number(embNbCartons || 0) * Number(embPrixCarton || 0))} disabled className="bg-gray-50 font-bold text-orange-700" /></div>
            <div>
              <Label>Mode de paiement</Label>
              <Select value={embModePaiement} onValueChange={(v) => setEmbModePaiement(v as "cash" | "credit")}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash (payé)</SelectItem>
                  <SelectItem value="credit">À crédit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveEmballage} className="flex-1 bg-orange-500 hover:bg-orange-600">{editEmbId ? "Enregistrer les modifications" : "Enregistrer"}</Button>
              <Button variant="outline" onClick={() => { setOpenEmb(false); setEditEmbId(null); }}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Nouvelle livraison */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier la réception" : "Nouvelle réception rouleaux"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div><Label>N° Livraison</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} /></div>
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div>
              <Label>Fournisseur</Label>
              <Input value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} placeholder="Ex: LEYE, SIPLAST..." list="fournisseur-list" />
              <datalist id="fournisseur-list">{fournisseurNames.map((n) => <option key={n} value={n} />)}</datalist>
              {fournisseurSimilaire && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Ressemble à "{fournisseurSimilaire}" déjà utilisé — même fournisseur ?</p>
              )}
            </div>
            <div><Label>Quantité (Kg)</Label><Input type="number" value={kg} onChange={(e) => { setKg(e.target.value); setPrix(String(Number(e.target.value) * prixKg)); }} placeholder="500" /></div>
            <div><Label>Prix/kg (F)</Label><Input type="number" value={String(prixKg)} disabled className="bg-gray-50" /><p className="text-xs text-gray-400 mt-1">Configurable dans Paramètres</p></div>
            <div>
              <Label>Prix total (F)</Label><Input type="number" value={prix} onChange={(e) => setPrix(e.target.value)} className="font-bold text-green-700" /><p className="text-xs text-gray-400 mt-1">Calculé automatiquement ({kg || 0} kg × {fmtNumber(prixKg)} F = {fmt(Number(kg || 0) * prixKg)})</p></div>
            {prixAlerteFournisseur && (
              <p className="text-xs text-amber-600 -mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {prixAlerteFournisseur.ecart > 0 ? "+" : ""}{prixAlerteFournisseur.ecart}% vs la moyenne habituelle de ce fournisseur ({fmtNumber(Math.round(prixAlerteFournisseur.baseline))} F/kg)</p>
            )}
            <div>
              <Label>Mode de paiement</Label>
              <Select value={modePaiement} onValueChange={(v) => setModePaiement(v as "cash" | "credit")}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash (payé)</SelectItem>
                  <SelectItem value="credit">À crédit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-sm text-[#1B4B6B] font-medium">
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Commande &amp; qualité (optionnel)
            </button>
            {showAdvanced && (
              <div className="space-y-4 p-3 bg-gray-50 rounded-lg border">
                <p className="text-xs text-gray-500">À renseigner si un accord (quantité/prix) avait été convenu avant réception, pour voir l'écart avec ce qui est réellement arrivé.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Quantité commandée (kg)</Label><Input type="number" value={kgCommande} onChange={(e) => setKgCommande(e.target.value)} placeholder="Optionnel" /></div>
                  <div><Label>Prix convenu (F/kg)</Label><Input type="number" value={prixKgCommande} onChange={(e) => setPrixKgCommande(e.target.value)} placeholder="Optionnel" /></div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="qualite-non-conforme" checked={qualiteNonConforme} onChange={(e) => setQualiteNonConforme(e.target.checked)} className="w-4 h-4" />
                  <Label htmlFor="qualite-non-conforme" className="cursor-pointer">Problème qualité signalé sur cette réception</Label>
                </div>
                {qualiteNonConforme && (
                  <>
                    <div><Label>Quantité rejetée (kg)</Label><Input type="number" value={quantiteRejetee} onChange={(e) => setQuantiteRejetee(e.target.value)} placeholder="Optionnel" /></div>
                    <div><Label>Notes qualité</Label><Textarea value={qualiteNotes} onChange={(e) => setQualiteNotes(e.target.value)} placeholder="Ex: rouleaux humides, épaisseur non conforme..." rows={2} /></div>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">{editId ? "Enregistrer les modifications" : "Enregistrer"}</Button>
              <Button variant="outline" onClick={() => { setOpen(false); setEditId(null); }}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer cette réception ?"
        description={deleteTarget ? `${deleteTarget.numero} - ${deleteTarget.fournisseur} - ${deleteTarget.kg} kg. Cette entrée${DB.depenses.some((d) => d.notes === `Généré automatiquement - ${deleteTarget.numero}` && d.categorie === "Matière première") ? ", son mouvement de stock lié et la dépense associée seront déplacés" : " et son mouvement de stock lié seront déplacés"} vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={!!deleteEmbId}
        onOpenChange={(o) => !o && setDeleteEmbId(null)}
        title="Supprimer cet emballage ?"
        description={deleteEmbTarget ? `${deleteEmbTarget.numeroLot} - ${deleteEmbTarget.nombreCartons} cartons. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDeleteEmballage}
      />

      <ConfirmDialog
        open={!!cancelPayLivraisonId}
        onOpenChange={(o) => !o && setCancelPayLivraisonId(null)}
        title="Annuler ce paiement ?"
        description={cancelPayLivraisonTarget ? `${cancelPayLivraisonTarget.numero} - ${fmt(cancelPayLivraisonTarget.prix)} repassera en crédit non payé.` : ""}
        confirmLabel="Annuler le paiement"
        variant="warning"
        onConfirm={confirmCancelPayLivraison}
      />

      <ConfirmDialog
        open={!!cancelPayEmbId}
        onOpenChange={(o) => !o && setCancelPayEmbId(null)}
        title="Annuler ce paiement ?"
        description={cancelPayEmbTarget ? `${cancelPayEmbTarget.numeroLot} - ${fmt(cancelPayEmbTarget.total)} repassera en crédit non payé.` : ""}
        confirmLabel="Annuler le paiement"
        variant="warning"
        onConfirm={confirmCancelPayEmballage}
      />
    </div>
  );
}
