import { useState, useMemo, useCallback, useRef } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, cashAtSale, resteVente, bonusVente, calculerBonusVente, todayLocal } from "@/lib/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, Upload } from "lucide-react";
import { toast } from "sonner";
import { usePagination } from "@/hooks/usePagination";
import { Pagination } from "@/components/Pagination";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import TableFilters, { type FilterValues, defaultFilterValues } from "@/components/TableFilters";
import { useTableFilters } from "@/hooks/useTableFilters";
import type { Livreur, Vente } from "@/lib/types";
import { validateVente } from "@/lib/validation";
import { checkCloture } from "@/lib/cloture";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { creerMouvementVente } from "@/lib/stock";
import { cfValidateVente, checkCloudFunctionsAvailability } from "@/lib/cloudFunctions";
import { db, doc, runTransaction } from "@/lib/firebase";

// Extrait le suffixe numérique d'un numéro de BL au format "BL-XXX" ; renvoie
// 0 pour tout ce qui ne suit pas ce format (numéro importé/saisi à la main
// dans un format différent, par exemple).
function numeroVenteValeur(numero: string): number {
  const m = /^BL-(\d+)$/.exec(numero || "");
  return m ? parseInt(m[1], 10) : 0;
}

// Alloue de façon atomique le prochain numéro de BL, via une transaction
// Firestore sur un compteur partagé (meta/compteurs, champ ventesNumero).
//
// Remplace l'ancien calcul `"BL-" + (DB.ventes.length + 1)`, purement local à
// chaque navigateur/appareil : quand deux commerciaux ouvraient "Nouvelle
// vente" à peu près au même moment sur deux appareils différents, chacun
// voyait sa propre copie de DB.ventes (pas forcément encore synchronisée
// avec la vente que l'autre venait de créer) et calculait donc le même
// numéro — deux ventes bien réelles et différentes se retrouvaient avec le
// même N° BL (voir CLAUDE.md, correctif du 2026-09-04, 9 collisions
// détectées sur un export du 04/09). Une transaction Firestore lit et
// incrémente le compteur de façon atomique, donc deux appels concurrents ne
// peuvent jamais recevoir la même valeur, même déclenchés à la même
// milliseconde depuis deux appareils.
//
// `currentMax` (le plus grand suffixe numérique déjà vu dans DB.ventes,
// calculé côté appelant) sert d'amorçage/rattrapage : la toute première fois
// que ce compteur est utilisé, ou si un numéro a été saisi/importé à la main
// au-delà de la valeur du compteur, on repart au moins de ce maximum connu
// pour ne jamais réattribuer un numéro déjà utilisé.
async function allouerProchainNumeroVente(currentMax: number): Promise<string> {
  const counterRef = doc(db, "meta", "compteurs");
  const next = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const existant = snap.exists() ? Number((snap.data() as any)?.ventesNumero) || 0 : 0;
    const valeur = Math.max(existant, currentMax) + 1;
    transaction.set(counterRef, { ventesNumero: valeur }, { merge: true });
    return valeur;
  });
  return "BL-" + String(next).padStart(3, "0");
}

export default function VentesSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState("");
  const [client, setClient] = useState("");
  const [commercial, setCommercial] = useState("");
  const [packs, setPacks] = useState("");
  const defaultPrix = String(DB.params.prixPack || 600);
  const [prix, setPrix] = useState(defaultPrix);
  const [livreur, setLivreur] = useState("");
  const [avance, setAvance] = useState("");
  const [modePaiement, setModePaiement] = useState("Espèces");

  const livreurs: Livreur[] = (DB as { livreurs?: Livreur[] }).livreurs || [];
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Import CSV Ventes ─────────────────────────────────────────────────────
  // Note : le numéro de secours généré ici (`BL-${DB.ventes.length + ...}`)
  // n'est PAS passé par allouerProchainNumeroVente (voir plus haut) — un
  // import reste une action ponctuelle côté admin, synchrone sur toutes ses
  // lignes, donc pas de risque de collision AVEC LUI-MÊME ; le risque
  // résiduel est une collision avec une vente saisie ailleurs pile pendant
  // l'import (même défaut que l'ancien calcul, jamais observé sur les
  // collisions trouvées le 2026-09-04 — celles-ci venaient toutes de
  // ventes saisies une par une, pas d'un import). À corriger si ça arrive
  // un jour en pratique (transaction par ligne, plus lent pour un gros CSV).
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
        // Colonnes attendues : numero/bl, date, client, commercial, packs/quantite, prix, livreur, avance, mode paiement
        const iNumero = cols.findIndex((c) => c.includes("num") || c.includes("bl"));
        const iDate = cols.findIndex((c) => c.includes("date"));
        const iClient = cols.findIndex((c) => c.includes("client"));
        const iCommercial = cols.findIndex((c) => c.includes("commercial"));
        const iPacks = cols.findIndex((c) => c.includes("pack") || c.includes("quantit") || c.includes("qte") || c.includes("qté"));
        const iPrix = cols.findIndex((c) => c.includes("prix"));
        const iLivreur = cols.findIndex((c) => c.includes("livreur"));
        const iAvance = cols.findIndex((c) => c.includes("avance") || c.includes("payé") || c.includes("paye"));
        const iModePaiement = cols.findIndex((c) => c.includes("mode"));
        if (iClient === -1) { toast.error("Colonne 'Client' introuvable dans le CSV"); return; }
        if (iPacks === -1) { toast.error("Colonne 'Packs' ou 'Quantité' introuvable dans le CSV"); return; }
        const newVentes: Vente[] = [];
        let erreurs = 0;
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map((v) => v.trim());
          const clientNom = vals[iClient]?.trim();
          const packsVal = Number(vals[iPacks]);
          if (!clientNom || !packsVal || packsVal <= 0) { erreurs++; continue; }
          const prixVal = iPrix !== -1 ? (Number(vals[iPrix]) || DB.params.prixPack || 600) : (DB.params.prixPack || 600);
          const avanceVal = iAvance !== -1 ? (Number(vals[iAvance]) || 0) : 0;
          const montant = packsVal * prixVal;
          const av = avanceVal > 0 ? avanceVal : montant;
          const mode: "Payé" | "Crédit" = av >= montant ? "Payé" : "Crédit";
          const bonus = calculerBonusVente(packsVal, clientNom, DB);
          const dateVal = iDate !== -1 ? (vals[iDate] || todayLocal()) : todayLocal();
          const numeroVal = iNumero !== -1 ? (vals[iNumero] || `BL-${String(DB.ventes.length + newVentes.length + 1).padStart(3, "0")}`) : `BL-${String(DB.ventes.length + newVentes.length + 1).padStart(3, "0")}`;
          newVentes.push({
            id: uid(),
            numero: numeroVal,
            date: dateVal,
            client: clientNom,
            commercial: iCommercial !== -1 ? (vals[iCommercial]?.trim() || "") : "",
            packs: packsVal,
            prix: prixVal,
            mode,
            livreur: iLivreur !== -1 ? (vals[iLivreur]?.trim() || "") : "",
            avance: av,
            modePaiement: iModePaiement !== -1 ? (vals[iModePaiement]?.trim() || "Espèces") : "Espèces",
            bonus,
          });
        }
        if (newVentes.length === 0) {
          toast.error(`Aucune vente valide à importer${erreurs > 0 ? ` (${erreurs} ligne(s) ignorée(s))` : ""}`);
          return;
        }
        const updated = { ...DB, ventes: [...DB.ventes, ...newVentes] };
        setDB(updated); saveDB(updated);
        logActivity("create", "Vente", `Import CSV: ${newVentes.length} ventes`);
        toast.success(`${newVentes.length} vente(s) importée(s)${erreurs > 0 ? ` (${erreurs} ligne(s) ignorée(s))` : ""}`);
      } catch (err) {
        toast.error("Erreur lors de la lecture du fichier CSV");
        console.error(err);
      }
    };
    reader.readAsText(file, "UTF-8");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Catégories pour les filtres
  const commercialCategories = useMemo(() => {
    const names = Array.from(new Set(DB.ventes.map((v) => v.commercial).filter(Boolean)));
    return names.map((n) => ({ value: n, label: n }));
  }, [DB.ventes]);

  const modeCategories = useMemo(() => [
    { value: "Payé", label: "Payé" },
    { value: "Crédit", label: "Crédit" },
  ], []);

  // Liste des clients ayant au moins une vente, pour le filtre client dédié
  const clientOptions = useMemo(() => {
    return Array.from(new Set(DB.ventes.map((v) => v.client).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr"));
  }, [DB.ventes]);
  const [clientFilter, setClientFilter] = useState("");

  // Filtres avancés
  const sortedVentes = useMemo(() =>
    [...DB.ventes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [DB.ventes]
  );

  const getDate = useCallback((v: Vente) => v.date, []);
  const getCategory = useCallback((v: Vente) => v.mode, []);
  const getSearchText = useCallback((v: Vente) => `${v.numero} ${v.client} ${v.commercial} ${v.livreur}`, []);

  const { filters, setFilters, filteredData, totalCount, resultCount } = useTableFilters({
    data: sortedVentes,
    getDate,
    getCategory,
    getSearchText,
  });

  // Filtre client dédié, appliqué en plus des filtres génériques (recherche
  // texte libre insuffisante quand deux clients ont des noms proches).
  const clientFilteredData = useMemo(() => {
    if (!clientFilter) return filteredData;
    return filteredData.filter((v) => v.client === clientFilter);
  }, [filteredData, clientFilter]);

  const pagination = usePagination(clientFilteredData, { pageSize: 20 });

  const handleOpen = (id?: string) => {
    if (id) {
      const v = DB.ventes.find((x) => x.id === id);
      if (!v) return;
      setEditId(id); setNumero(v.numero); setDate(v.date); setClient(v.client);
      setCommercial(v.commercial || ""); setPacks(String(v.packs)); setPrix(String(v.prix));
      setLivreur(v.livreur || ""); setAvance(v.avance != null ? String(v.avance) : "");
      setModePaiement(v.modePaiement || "Espèces");
    } else {
      setEditId(null);
      // Valeur provisoire affichée immédiatement (ancien calcul local, garde
      // le champ rempli sans attendre l'aller-retour réseau) — remplacée dès
      // que le vrai numéro, alloué de façon atomique côté Firestore, revient
      // (voir allouerProchainNumeroVente ci-dessus). Si l'utilisateur a déjà
      // modifié le champ entre-temps, on ne l'écrase pas.
      const provisoire = "BL-" + String(DB.ventes.length + 1).padStart(3, "0");
      setNumero(provisoire);
      const currentMax = DB.ventes.reduce((m, v) => Math.max(m, numeroVenteValeur(v.numero)), 0);
      allouerProchainNumeroVente(currentMax)
        .then((numeroReel) => {
          setNumero((actuel) => (actuel === provisoire ? numeroReel : actuel));
        })
        .catch((e) => {
          console.error("Erreur allocation numéro de vente:", e);
          // On garde la valeur provisoire en secours (ex: hors-ligne) — le
          // risque de collision réapparaît dans ce cas rare, mais mieux que
          // de bloquer la saisie.
        });
      setDate(todayLocal()); setClient(""); setCommercial("");
      setPacks(""); setPrix(defaultPrix); setLivreur(""); setAvance(""); setModePaiement("Espèces");
    }
    setOpen(true);
  };

  const [saving, setSaving] = useState(false);
  // Garde synchrone en plus de l'état `saving` : deux clics très rapprochés
  // peuvent tous les deux lire `saving === false` avant que le premier
  // setSaving(true) n'ait fini de re-render (React ne met pas à jour l'état
  // de façon synchrone), ce qui laissait passer un double clic — d'où le
  // "bouton semble inactif, on voit apparaître deux écritures" : le premier
  // clic semblait ne rien faire (pas de feedback visuel) donc l'utilisateur
  // cliquait une seconde fois, et les deux appels passaient la garde.
  const savingRef = useRef(false);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const montant = Number(packs) * Number(prix);
    const av = avance !== "" ? Number(avance) : montant;
    const mode = av >= montant ? "Payé" as const : "Crédit" as const;
    const bonus = calculerBonusVente(Number(packs), client, DB);

    // Vérifier la clôture
    const clotureMsg = checkCloture(date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); savingRef.current = false; setSaving(false); return; }

    // Validation métier
    const validation = validateVente(
      { client, packs: Number(packs), prix: Number(prix), mode, avance: av, livreur: livreur === "none" ? "" : livreur, commercial: commercial === "none" ? "" : commercial },
      DB, !!editId
    );
    if (!validation.valid) { validation.errors.forEach((e) => toast.error(e)); savingRef.current = false; setSaving(false); return; }
    if (validation.warnings.length > 0) { validation.warnings.forEach((w) => toast.warning(w)); }

    if (editId) {
      const oldItem = DB.ventes.find((v) => v.id === editId);
      const newItem = { ...oldItem!, numero, date, client, commercial: commercial === "none" ? "" : commercial, packs: Number(packs), prix: Number(prix), livreur: livreur === "none" ? "" : livreur, avance: av, modePaiement, mode, bonus };
      let updated = { ...DB, ventes: DB.ventes.map((v) => v.id === editId ? newItem : v) };

      // Synchroniser le mouvement de stock lié à cette vente. Sans ça, une
      // vente modifiée (packs, bonus, ou livreur/camion changé) laissait
      // l'ancienne quantité — et l'ancien emplacement camion — dans le
      // journal DB.mouvementsStock pour toujours, désynchronisant la
      // rubrique Stock (qui rejoue ce journal) du Dashboard (qui recalcule
      // en direct depuis DB.ventes). Même principe que ProductionSection.tsx.
      const livreurObjEdit = DB.livreurs.find((l) => l.nom === newItem.livreur);
      const sourceEdit = livreurObjEdit?.vehiculeId ? `camion_${livreurObjEdit.vehiculeId}` : "usine";
      updated = {
        ...updated,
        mouvementsStock: (updated.mouvementsStock || []).map((m: any) => {
          if (m.reference !== editId || m.type !== "vente" || m.produit !== "sachet_plein") return m;
          return {
            ...m,
            date,
            quantite: Number(packs) + bonus,
            emplacementSource: sourceEdit,
            livreurId: livreurObjEdit?.id,
            referenceLabel: `${numero} - ${client}`,
          };
        }),
      };

      // Historique
      const histEntry = updateHistoryEntry("Ventes", editId, `${numero} - ${client}`, oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      if (histEntry) updated = addHistoryEntry(updated, histEntry);
      setDB(updated); saveDB(updated);
      logActivity("update", "Vente", `Modification ${numero} - ${client}`);
      toast.success("Vente modifiée");
    } else {
      // Tenter la validation serveur (Cloud Functions). Important : la CF
      // validateVente crée déjà un document Firestore pour la vente (sans
      // numéro de BL, livreur, ni mode de paiement — elle ne connaît pas ces
      // champs). L'écriture locale juste en dessous ne doit donc JAMAIS créer
      // un DEUXIÈME document séparé quand la CF a réussi : elle réutilise le
      // même id (cfVenteId) pour COMPLÉTER ce document avec les champs
      // propres au formulaire, au lieu d'en générer un nouveau. Avant ce
      // correctif, un id différent était généré à chaque fois → une vente
      // créée pendant que les Cloud Functions étaient joignables produisait
      // deux lignes dans le tableau des ventes pour un seul enregistrement.
      const cfAvailable = await checkCloudFunctionsAvailability();
      let cfVenteId: string | null = null;
      if (cfAvailable) {
        try {
          const cfResult = await cfValidateVente({
            clientId: client,
            clientNom: client,
            packs: Number(packs),
            prix: Number(prix),
            mode: mode.normalize("NFC"),
            avance: av < montant ? av : undefined,
            commercial: commercial === "none" ? undefined : commercial,
            date,
          });
          if (cfResult.success && cfResult.data?.venteId) {
            cfVenteId = cfResult.data.venteId;
          } else {
            // Log l'erreur CF mais ne pas bloquer l'enregistrement local
            // La validation locale a déjà été effectuée avec succès
            console.warn("[CF] Validation serveur échouée:", cfResult.error);
          }
        } catch (cfError) {
          console.warn("[CF] Erreur appel Cloud Function:", cfError);
        }
      }

      // Enregistrement local (fallback si la CF est indisponible, ou
      // complément des champs manquants si elle a réussi — voir ci-dessus).
      // tauxCommission fige le taux actuel des Paramètres sur cette vente :
      // la commission de cette vente ne bougera plus si le taux change
      // ensuite (voir commissionVente() dans helpers.ts et CommerciauxSection).
      const item = { id: cfVenteId || uid(), numero, date, client, commercial: commercial === "none" ? "" : commercial, packs: Number(packs), prix: Number(prix), livreur: livreur === "none" ? "" : livreur, avance: av, modePaiement, mode, bonus, tauxCommission: Number(DB.params.taux) || 25 };
      // Mouvement stock: sortie de l'usine, ou du camion assigné au livreur.
      // IMPORTANT: on utilise l'id du VEHICULE (livreurObj.vehiculeId), pas
      // l'id du livreur — les chargements (StockSection "Chargement") créditent
      // l'emplacement "camion_<id du VEHICULE>", donc c'est cet emplacement qui
      // doit être débité pour que le stock camion reste cohérent. Utiliser
      // l'id du livreur ici créait un emplacement fictif jamais approvisionné,
      // qui devenait négatif à chaque vente (voir CLAUDE.md "Bug stock camions").
      // Si le livreur n'a pas de camion assigné, on retombe sur l'usine plutôt
      // que de créer un nouvel emplacement fictif.
      const livreurObj = DB.livreurs.find(l => l.nom === item.livreur);
      const source = livreurObj?.vehiculeId ? `camion_${livreurObj.vehiculeId}` : "usine";
      const mvtVente = creerMouvementVente(uid(), date, Number(packs) + bonus, currentUser?.nom || "", item.id, `${numero} - ${client}`, source as any, livreurObj?.id);
      let updated = { ...DB, ventes: [...DB.ventes, item], mouvementsStock: [...(DB.mouvementsStock || []), mvtVente] };
      // Historique
      const histEntry = createHistoryEntry("Ventes", item.id, `${numero} - ${client}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      updated = addHistoryEntry(updated, histEntry);
      setDB(updated); saveDB(updated);
      logActivity("create", "Vente", `${numero} - ${client} - ${packs} packs`);
      toast.success(cfVenteId ? "Vente validée et enregistrée" : "Vente enregistrée");
    }
    savingRef.current = false;
    setSaving(false);
    setOpen(false);
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    const item = DB.ventes.find((v) => v.id === deleteId);
    if (!item) return;
    // Vérifier la clôture
    const clotureMsg = checkCloture(item.date, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); setDeleteId(null); return; }
    // Mouvement de stock lié à cette vente, à retirer du journal (sinon il
    // reste éternellement à débiter un stock que le Dashboard ne compte
    // plus) — conservé dans la corbeille pour être restauré si la vente
    // l'est aussi (CorbeilleSection réapplique relatedMouvements).
    const mvtLies = (DB.mouvementsStock || []).filter((m: any) => m.reference === deleteId && m.type === "vente" && m.produit === "sachet_plein");
    const corbeille = [...DB.corbeille, { id: uid(), originalType: "ventes", moduleName: "Vente", desc: `${item.numero} - ${item.client}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item, relatedMouvements: mvtLies }];
    let updated = {
      ...DB,
      ventes: DB.ventes.filter((v) => v.id !== deleteId),
      mouvementsStock: (DB.mouvementsStock || []).filter((m: any) => !(m.reference === deleteId && m.type === "vente" && m.produit === "sachet_plein")),
      corbeille,
    };
    // Historique
    const histEntry = deleteHistoryEntry("Ventes", deleteId, `${item.numero} - ${item.client}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("delete", "Vente", `Suppression ${item.numero}`);
    toast.success("Mis à la corbeille");
    setDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-gray-900">Ventes</h2><p className="text-sm text-gray-500">{DB.ventes.length} vente(s)</p></div>
        <div className="flex gap-2">
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Plus className="w-4 h-4 mr-2" /> Nouvelle vente</Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4 mr-2" /> Importer CSV</Button>
          <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImportCSV} />
        </div>
      </div>

      {/* Filtres avancés */}
      <TableFilters
        config={{
          dateRange: true,
          search: true,
          searchPlaceholder: "Rechercher par N° BL, client, commercial...",
          categories: modeCategories,
          categoryLabel: "Statut",
        }}
        values={filters}
        onChange={setFilters}
        resultCount={resultCount}
        totalCount={totalCount}
      />

      {/* Filtre client dédié — permet d'isoler l'historique d'un client précis
          sans dépendre de la recherche texte libre (utile en cas de noms proches). */}
      <div className="flex items-center gap-2">
        <div className="w-full max-w-xs">
          <Select value={clientFilter || "all"} onValueChange={(v) => setClientFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Filtrer par client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les clients</SelectItem>
              {clientOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {clientFilter && (
          <>
            <span className="text-xs text-gray-500">{clientFilteredData.length} vente(s) pour {clientFilter}</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-500 hover:text-red-600" onClick={() => setClientFilter("")}>Réinitialiser</Button>
          </>
        )}
      </div>

      <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>N° BL</TableHead><TableHead>Date</TableHead><TableHead>Client</TableHead><TableHead>Commercial</TableHead><TableHead>Livreur</TableHead><TableHead className="text-right">Packs</TableHead><TableHead className="text-right">Prix</TableHead><TableHead className="text-right">Montant</TableHead><TableHead className="text-right">Payé</TableHead><TableHead className="text-right">Reste</TableHead><TableHead>Statut</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
        {pagination.paginatedItems.length > 0 ? pagination.paginatedItems.map((v) => { const montant = v.packs * v.prix; const av = cashAtSale(v, DB); const reste = resteVente(v, DB); const bonus = bonusVente(v, DB); return (
          <TableRow key={v.id}><TableCell className="font-mono text-sm">{v.numero}</TableCell><TableCell>{fmtDate(v.date)}</TableCell><TableCell className="font-medium">{v.client}</TableCell><TableCell className="text-sm text-gray-600">{v.commercial || "-"}</TableCell><TableCell className="text-sm text-gray-600">{v.livreur || "-"}</TableCell><TableCell className="text-right">{v.packs}{bonus > 0 && <span className="text-green-600 text-xs block">+{bonus}</span>}</TableCell><TableCell className="text-right">{fmt(v.prix)}</TableCell><TableCell className="text-right font-bold">{fmt(montant)}</TableCell><TableCell className="text-right text-green-600">{fmt(av)}</TableCell><TableCell className={`text-right font-bold ${reste > 0 ? "text-red-600" : "text-green-600"}`}>{fmt(reste)}</TableCell><TableCell><Badge className={reste <= 0 ? "bg-green-100 text-green-800 hover:bg-green-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>{reste <= 0 ? "Payé" : "Crédit"}</Badge></TableCell><TableCell><div className="flex gap-1"><Button variant="outline" size="sm" onClick={() => handleOpen(v.id)} aria-label="Modifier la vente"><Pencil className="w-3 h-3" /></Button><Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(v.id)} aria-label="Supprimer la vente"><Trash2 className="w-3 h-3" /></Button></div></TableCell></TableRow>
        ); }) : <TableRow><TableCell colSpan={12} className="text-center text-gray-400 py-8">{filters.search || filters.dateFrom || filters.dateTo || filters.category ? "Aucun résultat avec ces filtres" : "Aucune vente"}</TableCell></TableRow>}
      </TableBody></Table></div>
      <Pagination {...pagination} />
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editId ? "Modifier la vente" : "Nouvelle vente"}</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4"><div><Label>N° BL</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} /></div><div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
          <div><Label>Client</Label><Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Nom du client" list="cl-list" /><datalist id="cl-list">{DB.clients.map((c) => <option key={c.id} value={c.nom} />)}</datalist></div>
          <div><Label>Commercial</Label><Select value={commercial || "none"} onValueChange={setCommercial}><SelectTrigger><SelectValue placeholder="-- Aucun --" /></SelectTrigger><SelectContent><SelectItem value="none">-- Aucun --</SelectItem>{DB.commerciaux.map((c) => <SelectItem key={c.id} value={c.nom}>{c.nom}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-2 gap-4"><div><Label>Packs</Label><Input type="number" value={packs} onChange={(e) => setPacks(e.target.value)} /></div><div><Label>Prix/pack (F)</Label><Input type="number" value={prix} onChange={(e) => setPrix(e.target.value)} /></div></div>
          {Number(packs) > 0 && <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 text-center">Bonus : {calculerBonusVente(Number(packs), client, DB)} pack(s) offert(s){DB.clients.find((c) => c.nom === client)?.bonusExceptionnel ? " (règle exceptionnelle client)" : ""}</div>}
          <div><Label>Livreur</Label><Select value={livreur || "none"} onValueChange={setLivreur}><SelectTrigger><SelectValue placeholder="-- Aucun --" /></SelectTrigger><SelectContent><SelectItem value="none">-- Aucun --</SelectItem>{livreurs.map((l) => <SelectItem key={l.id} value={l.nom}>{l.nom}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-2 gap-4"><div><Label>Avance (F)</Label><Input type="number" value={avance} onChange={(e) => setAvance(e.target.value)} placeholder="0 = crédit" /></div><div><Label>Mode paiement</Label><Select value={modePaiement} onValueChange={setModePaiement}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Espèces","Wave","Orange Money","Mobile Money","Chèque","Virement"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div></div>
          <div className="flex gap-2 pt-2"><Button onClick={handleSave} disabled={saving} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85] disabled:opacity-60">{saving ? "Enregistrement..." : editId ? "Modifier" : "Enregistrer"}</Button><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Annuler</Button></div>
        </div>
      </DialogContent></Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Supprimer cette vente ?"
        description="La vente sera déplacée dans la corbeille. Vous pourrez la restaurer ultérieurement si nécessaire."
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
