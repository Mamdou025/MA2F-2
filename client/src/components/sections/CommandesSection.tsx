import { useState, useMemo, useRef } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtDate, todayLocal, calculerBonusVente, calculerRetardLivraisonMinutes } from "@/lib/helpers";
import { NOMS_ZONES_DAKAR } from "@/lib/communesDakar";
import { calculerDispatching, type CamionDispo, type ResultatDispatching } from "@/lib/dispatching";
import { createHistoryEntry, updateHistoryEntry, deleteHistoryEntry, addHistoryEntry, FIELD_LABELS } from "@/lib/history";
import { validateVente } from "@/lib/validation";
import { checkCloture } from "@/lib/cloture";
import { creerMouvementVente } from "@/lib/stock";
import { cfValidateVente, checkCloudFunctionsAvailability } from "@/lib/cloudFunctions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, PhoneCall, Truck, MapPin, Clock, CheckCircle2, XCircle, PackageCheck, ShoppingCart, Route, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Commande } from "@/lib/types";

const STATUTS: { value: Commande["statut"]; label: string; badge: string }[] = [
  { value: "en_attente", label: "En attente", badge: "bg-amber-100 text-amber-700" },
  { value: "assignee", label: "Assignée", badge: "bg-blue-100 text-blue-700" },
  { value: "en_livraison", label: "En livraison", badge: "bg-purple-100 text-purple-700" },
  { value: "livree", label: "Livrée", badge: "bg-green-100 text-green-700" },
  { value: "annulee", label: "Annulée", badge: "bg-gray-200 text-gray-600" },
];

// Capacité par défaut d'un camion de livraison (packs), utilisée par le
// dispatching automatique quand le livreur n'a pas de capacité renseignée sur
// sa fiche (Livreur.capacitePacks) — pré-remplie mais reste modifiable pour
// chaque calcul de dispatching (ex: un camion plus petit ce jour-là).
const CAPACITE_CAMION_DEFAUT = 110;

function statutInfo(s: Commande["statut"]) {
  return STATUTS.find((x) => x.value === s) || STATUTS[0];
}

export default function CommandesSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  const commandes: Commande[] = (DB as { commandes?: Commande[] }).commandes || [];

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  // Vrai lorsqu'on modifie une commande déjà liée à une vente (c.venteId
  // défini) — verrouille dans le dialog les champs qui ont déjà été figés
  // dans la vente au moment de sa création (client, packs, commercial,
  // livreur, statut) pour éviter que la commande et la vente affichent des
  // informations différentes pour le même événement. Les champs purement
  // informatifs (notes, adresse, téléphone, zone, dates/heures) restent
  // modifiables. Voir aussi confirmDelete : la suppression est bloquée dans
  // ce même cas — annuler la vente liée est le bon circuit si une commande
  // livrée doit être défaite.
  const [editLocked, setEditLocked] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState<string>("toutes");
  // Vue du tableau : "liste" (ordre chronologique), "zone" (regroupe par
  // zone de livraison, pour préparer des tournées géographiquement
  // cohérentes) ou "livreur" (regroupe par livreur assigné, pour voir d'un
  // coup d'œil la charge de chaque tournée en cours).
  const [vueTableau, setVueTableau] = useState<"liste" | "zone" | "livreur">("liste");

  // ─── Dispatching automatique par camion ────────────────────────────────
  // Répartit les commandes "en attente" entre les camions disponibles
  // aujourd'hui, en fonction de la position (approximative) de leur zone de
  // livraison, pour produire une tournée compacte et un ETA par arrêt et par
  // livreur (voir lib/dispatching.ts). Sélection manuelle des camions
  // disponibles à chaque dispatching, avec capacité (packs) pré-remplie
  // depuis la fiche Livreur mais modifiable pour ce calcul.
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchSelection, setDispatchSelection] = useState<Record<string, { dispo: boolean; capacite: string }>>({});
  const [dispatchHeureDepart, setDispatchHeureDepart] = useState("08:00");
  const [dispatchVitesse, setDispatchVitesse] = useState("22");
  const [dispatchMinutesArret, setDispatchMinutesArret] = useState("8");
  const [dispatchDate, setDispatchDate] = useState(todayLocal());
  const [dispatchResultat, setDispatchResultat] = useState<ResultatDispatching | null>(null);
  const [dispatchApplying, setDispatchApplying] = useState(false);
  // "Automatique" (algorithme par zone/capacité ci-dessus) ou "Manuel" (le
  // caissier/admin choisit lui-même le chauffeur et les commandes, ex: pour
  // respecter une contrainte que l'algorithme ne connaît pas — client VIP à
  // livrer par un chauffeur précis, tournée déjà décidée par téléphone...).
  const [dispatchMode, setDispatchMode] = useState<"auto" | "manuel">("auto");
  const [manuelLivreurId, setManuelLivreurId] = useState<string>("none");
  const [manuelSelection, setManuelSelection] = useState<Record<string, boolean>>({});
  const [manuelDate, setManuelDate] = useState(todayLocal());
  const [manuelHeure, setManuelHeure] = useState("");
  const [manuelApplying, setManuelApplying] = useState(false);

  // ─── Assigner un livreur depuis le bouton "Assigner" du tableau ──────────
  // Avant : le bouton "Assigner" changeait juste le statut en "assignee" et
  // échouait (toast d'erreur) si aucun livreur n'était déjà renseigné via le
  // dialog "Modifier". Désormais il ouvre directement ce petit dialog pour
  // choisir le livreur (et éventuellement la date/heure prévue) en un clic.
  const [assignerOpen, setAssignerOpen] = useState(false);
  const [assignerCommandeId, setAssignerCommandeId] = useState<string | null>(null);
  const [assignerLivreurId, setAssignerLivreurId] = useState<string>("");
  const [assignerDate, setAssignerDate] = useState("");
  const [assignerHeure, setAssignerHeure] = useState("");

  // Champs du formulaire
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [heureAppel, setHeureAppel] = useState("");
  const [clientId, setClientId] = useState<string>("none");
  const [client, setClient] = useState("");
  const [tel, setTel] = useState("");
  const [zone, setZone] = useState("");
  const [adresseDetail, setAdresseDetail] = useState("");
  const [packs, setPacks] = useState("");
  const [commercial, setCommercial] = useState("");
  const [livreurId, setLivreurId] = useState<string>("none");
  const [dateLivraisonPrevue, setDateLivraisonPrevue] = useState("");
  const [heureLivraisonPrevue, setHeureLivraisonPrevue] = useState("");
  const [notes, setNotes] = useState("");
  const [statut, setStatut] = useState<Commande["statut"]>("en_attente");

  const heureActuelle = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // KPI rapides pour la gestion du jour
  const kpis = useMemo(() => {
    const today = todayLocal();
    const aujourdhui = commandes.filter((c) => c.date === today || c.dateLivraisonPrevue === today);
    return {
      enAttente: commandes.filter((c) => c.statut === "en_attente").length,
      assignees: commandes.filter((c) => c.statut === "assignee").length,
      enLivraison: commandes.filter((c) => c.statut === "en_livraison").length,
      aLivrerAujourdhui: aujourdhui.filter((c) => c.statut !== "livree" && c.statut !== "annulee").length,
    };
  }, [commandes]);

  // Ordre d'avancement de la livraison — celles qui demandent une action
  // (non assignées, puis assignées, puis en livraison) remontent en premier,
  // les livrées (plus rien à faire dessus) et les annulées en dernier, pour
  // que le tableau mette en avant ce qui reste à traiter. STATUTS est déjà
  // dans cet ordre, on s'appuie dessus plutôt que de dupliquer la liste.
  const statutOrdre = (s: Commande["statut"]) => STATUTS.findIndex((x) => x.value === s);

  const commandesFiltrees = useMemo(() => {
    const liste = filtreStatut === "toutes" ? commandes : commandes.filter((c) => c.statut === filtreStatut);
    return [...liste].sort((a, b) => {
      const ordreA = statutOrdre(a.statut);
      const ordreB = statutOrdre(b.statut);
      if (ordreA !== ordreB) return ordreA - ordreB;
      return (b.date + (b.heureAppel || "")).localeCompare(a.date + (a.heureAppel || ""));
    });
  }, [commandes, filtreStatut]);

  // Regroupement par zone (vue "Par zone") : une entrée par zone présente
  // dans commandesFiltrees, triée par nombre de commandes à traiter en
  // priorité (celles ni livrées ni annulées) décroissant — les zones qui ont
  // le plus de tournées en attente remontent en premier — puis par ordre
  // alphabétique à égalité. À l'intérieur d'une zone, on garde l'ordre de
  // commandesFiltrees (les commandes les plus récentes en premier), sauf
  // qu'une commande avec une heure de livraison prévue passe avant celles qui
  // n'en ont pas, pour faciliter la lecture d'une tournée dans l'ordre.
  const commandesParZone = useMemo(() => {
    const groupes = new Map<string, Commande[]>();
    commandesFiltrees.forEach((c) => {
      const key = c.zone?.trim() || "Zone non renseignée";
      if (!groupes.has(key)) groupes.set(key, []);
      groupes.get(key)!.push(c);
    });
    return Array.from(groupes.entries())
      .map(([zone, liste]) => ({
        zone,
        commandes: [...liste].sort((a, b) => {
          const heureA = a.heureLivraisonPrevue || "99:99";
          const heureB = b.heureLivraisonPrevue || "99:99";
          if (heureA !== heureB) return heureA.localeCompare(heureB);
          return (b.date + (b.heureAppel || "")).localeCompare(a.date + (a.heureAppel || ""));
        }),
        totalPacks: liste.reduce((s, c) => s + (c.packs || 0), 0),
        aTraiter: liste.filter((c) => c.statut !== "livree" && c.statut !== "annulee").length,
      }))
      .sort((a, b) => b.aTraiter - a.aTraiter || a.zone.localeCompare(b.zone, "fr"));
  }, [commandesFiltrees]);

  // Regroupement par livreur (vue "Par livreur") : une entrée par livreur
  // assigné aux commandes de commandesFiltrees, plus un groupe "Non assigné"
  // pour celles sans livreurId (toujours en tête, ce sont elles qui ont le
  // plus besoin d'attention). Les livreurs assignés sont ensuite triés par
  // nombre de commandes à traiter décroissant, comme la vue "Par zone", pour
  // voir en un coup d'œil quelle tournée est la plus chargée.
  const commandesParLivreur = useMemo(() => {
    const groupes = new Map<string, Commande[]>();
    commandesFiltrees.forEach((c) => {
      const key = c.livreurId || "__non_assigne__";
      if (!groupes.has(key)) groupes.set(key, []);
      groupes.get(key)!.push(c);
    });
    return Array.from(groupes.entries())
      .map(([livreurId, liste]) => ({
        livreurId,
        nom: livreurId === "__non_assigne__" ? "Non assigné" : DB.livreurs.find((l) => l.id === livreurId)?.nom || "Livreur inconnu",
        commandes: [...liste].sort((a, b) => {
          const heureA = a.heureLivraisonPrevue || "99:99";
          const heureB = b.heureLivraisonPrevue || "99:99";
          if (heureA !== heureB) return heureA.localeCompare(heureB);
          return (b.date + (b.heureAppel || "")).localeCompare(a.date + (a.heureAppel || ""));
        }),
        totalPacks: liste.reduce((s, c) => s + (c.packs || 0), 0),
        aTraiter: liste.filter((c) => c.statut !== "livree" && c.statut !== "annulee").length,
      }))
      .sort((a, b) => {
        if (a.livreurId === "__non_assigne__") return -1;
        if (b.livreurId === "__non_assigne__") return 1;
        return b.aTraiter - a.aTraiter || a.nom.localeCompare(b.nom, "fr");
      });
  }, [commandesFiltrees, DB.livreurs]);

  const resetForm = () => {
    setEditId(null);
    setNumero("CMD-" + String(commandes.length + 1).padStart(3, "0"));
    setDate(todayLocal());
    setHeureAppel(heureActuelle());
    setClientId("none");
    setClient("");
    setTel("");
    setZone("");
    setAdresseDetail("");
    setPacks("");
    setCommercial(currentUser?.nom || "");
    setLivreurId("none");
    setDateLivraisonPrevue("");
    setHeureLivraisonPrevue("");
    setNotes("");
    setStatut("en_attente");
  };

  const handleOpen = (c?: Commande) => {
    if (c) {
      setEditId(c.id);
      setEditLocked(!!c.venteId);
      setNumero(c.numero);
      setDate(c.date);
      setHeureAppel(c.heureAppel || "");
      setClientId(c.clientId || "none");
      setClient(c.client);
      setTel(c.tel || "");
      setZone(c.zone || "");
      setAdresseDetail(c.adresseDetail || "");
      setPacks(String(c.packs || ""));
      setCommercial(c.commercial || "");
      setLivreurId(c.livreurId || "none");
      setDateLivraisonPrevue(c.dateLivraisonPrevue || "");
      setHeureLivraisonPrevue(c.heureLivraisonPrevue || "");
      setNotes(c.notes || "");
      setStatut(c.statut);
    } else {
      setEditLocked(false);
      resetForm();
    }
    setOpen(true);
  };

  // Champ "Client" en texte libre avec autocomplétion (datalist, comme dans
  // VentesSection.tsx) : si le nom saisi correspond exactement à un client
  // existant, on relie automatiquement la commande à sa fiche (clientId) et
  // on pré-remplit téléphone/zone — sans écraser des valeurs déjà modifiées
  // par l'utilisateur. Un nom qui ne correspond à aucun client reste un appel
  // ponctuel (clientId vide), sans bloquer la saisie.
  const handleClientChange = (value: string) => {
    setClient(value);
    const match = DB.clients.find((x) => x.nom.trim().toLowerCase() === value.trim().toLowerCase());
    if (match) {
      setClientId(match.id);
      if (!tel.trim()) setTel(match.tel || "");
      if (!zone.trim()) setZone(match.zone || "");
    } else {
      setClientId("none");
    }
  };

  const handleSave = () => {
    if (!client.trim()) { toast.error("Nom du client requis"); return; }
    if (!tel.trim()) { toast.error("Numéro de téléphone requis"); return; }
    if (!heureAppel) { toast.error("Heure de saisie manquante"); return; }
    if (!zone.trim()) { toast.error("Zone/quartier de livraison requis"); return; }
    if (!packs || Number(packs) <= 0) { toast.error("Quantité de packs invalide"); return; }

    // date + heureAppel = date/heure de saisie, verrouillées : pour une
    // nouvelle commande on fige la date et l'heure système exactes au moment
    // du clic "Enregistrer" (plus fiable que l'instant d'ouverture du
    // formulaire, si celui-ci est resté ouvert un moment, ou qu'un chevauche­
    // ment de minuit entre l'ouverture et l'enregistrement) ; en modification,
    // les valeurs d'origine ne changent plus (les deux champs sont désactivés
    // dans le formulaire, ceci est une seconde barrière — même principe que
    // champsProteges plus bas).
    const base = {
      numero,
      date: editId ? date : todayLocal(),
      heureAppel: editId ? heureAppel : heureActuelle(),
      clientId: clientId === "none" ? undefined : clientId,
      client: client.trim(),
      tel: tel.trim(),
      zone: zone.trim(),
      adresseDetail: adresseDetail.trim() || undefined,
      packs: Number(packs),
      commercial: commercial.trim() || undefined,
      livreurId: livreurId === "none" ? undefined : livreurId,
      dateLivraisonPrevue: dateLivraisonPrevue || undefined,
      heureLivraisonPrevue: heureLivraisonPrevue || undefined,
      notes: notes.trim() || undefined,
      statut,
    };

    if (editId) {
      const oldItem = commandes.find((c) => c.id === editId);
      if (!oldItem) { toast.error("Commande introuvable"); return; }
      // Garde-fou : la date de saisie (date + heureAppel, cette dernière
      // verrouillée mais "date" reste modifiable ci-dessus) ne peut pas être
      // postérieure à un horodatage de départ/livraison déjà enregistré pour
      // CETTE commande (enLivraisonLe/livreeLe, capturés automatiquement par
      // handleChangeStatut) — on ne peut pas être parti/avoir livré avant
      // même d'avoir saisi la commande. Repéré par l'utilisateur le
      // 2026-08-22 sur une commande où "Date" avait été modifiée après coup,
      // rendant la saisie apparemment postérieure à son propre départ.
      const saisieMs = new Date(`${date}T${heureAppel}:00`).getTime();
      if (!Number.isNaN(saisieMs)) {
        if (oldItem.enLivraisonLe && saisieMs > new Date(oldItem.enLivraisonLe).getTime()) {
          toast.error("La date de saisie ne peut pas être postérieure à l'heure de départ déjà enregistrée pour cette commande.");
          return;
        }
        if (oldItem.livreeLe && saisieMs > new Date(oldItem.livreeLe).getTime()) {
          toast.error("La date de saisie ne peut pas être postérieure à l'heure de livraison déjà enregistrée pour cette commande.");
          return;
        }
      }
      // Une commande déjà liée à une vente (venteId) garde figés les champs
      // qui ont déjà été copiés dans cette vente à sa création — la vente ne
      // se met pas à jour rétroactivement, donc les laisser divergent créerait
      // une incohérence entre la commande et la vente qu'elle a générée. Les
      // champs sont normalement déjà désactivés dans le formulaire (voir
      // editLocked/handleOpen) ; ce filtre est une seconde barrière.
      const champsProteges = oldItem.venteId
        ? { client: oldItem.client, clientId: oldItem.clientId, packs: oldItem.packs, commercial: oldItem.commercial, livreurId: oldItem.livreurId, statut: oldItem.statut }
        : {};
      const newItem: Commande = { ...oldItem, ...base, ...champsProteges };
      const updated = { ...DB, commandes: commandes.map((c) => (c.id === editId ? newItem : c)) };
      const histEntry = updateHistoryEntry("Commande", editId, `${newItem.numero} - ${newItem.client}`, oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      const withHist = histEntry ? addHistoryEntry(updated, histEntry) : updated;
      setDB(withHist); saveDB(withHist);
      logActivity("update", "Commande", `${newItem.numero} - ${newItem.client}`);
      toast.success("Commande modifiée");
      setOpen(false); setEditId(null);
      return;
    }

    const item: Commande = { id: uid(), ...base };
    let updated = { ...DB, commandes: [...commandes, item] };
    const histEntry = createHistoryEntry("Commande", item.id, `${item.numero} - ${item.client}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histEntry);
    setDB(updated); saveDB(updated);
    logActivity("create", "Commande", `${item.numero} - ${item.client} - ${item.packs} packs - ${item.zone}`);
    toast.success("Commande enregistrée");
    setOpen(false);
  };

  // Changement rapide de statut depuis le tableau (sans ouvrir le dialog complet)
  const handleChangeStatut = (id: string, nouveauStatut: Commande["statut"]) => {
    const item = commandes.find((c) => c.id === id);
    if (!item) return;
    if (nouveauStatut === "assignee" && !item.livreurId) {
      toast.error("Assignez d'abord un livreur à cette commande (bouton Modifier).");
      return;
    }
    // Horodatage exact du passage à "livree" — sert uniquement au suivi
    // retard/à-l'heure (voir SuiviLogistiqueSection.tsx), comparé à
    // dateLivraisonPrevue/heureLivraisonPrevue quand elles existent. Même
    // principe pour "en_livraison" : capture l'heure de départ effective du
    // livreur (enLivraisonLe), affichée dans le tableau ci-dessous.
    const newItem = {
      ...item,
      statut: nouveauStatut,
      livreeLe: nouveauStatut === "livree" ? new Date().toISOString() : item.livreeLe,
      enLivraisonLe: nouveauStatut === "en_livraison" ? new Date().toISOString() : item.enLivraisonLe,
    };
    const updated = { ...DB, commandes: commandes.map((c) => (c.id === id ? newItem : c)) };
    const histEntry = updateHistoryEntry("Commande", id, `${item.numero} - ${item.client}`, item as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    const withHist = histEntry ? addHistoryEntry(updated, histEntry) : updated;
    setDB(withHist); saveDB(withHist);
    logActivity("update", "Commande", `${item.numero} - statut : ${statutInfo(nouveauStatut).label}`);
    toast.success(`Statut mis à jour : ${statutInfo(nouveauStatut).label}`);
    // Marquer "Livrée" propose directement de créer la vente correspondante
    // (voir handleOpenCreerVente ci-dessous), sauf si une vente est déjà liée.
    if (nouveauStatut === "livree" && !item.venteId) {
      handleOpenCreerVente(newItem);
    }
  };

  // Ouvre le dialog de choix du livreur (bouton "Assigner" du tableau) —
  // pré-rempli avec le livreur/date/heure déjà présents le cas échéant, pour
  // permettre aussi de corriger une assignation existante.
  const handleOpenAssigner = (c: Commande) => {
    setAssignerCommandeId(c.id);
    setAssignerLivreurId(c.livreurId || "");
    setAssignerDate(c.dateLivraisonPrevue || "");
    setAssignerHeure(c.heureLivraisonPrevue || "");
    setAssignerOpen(true);
  };

  const handleConfirmerAssigner = () => {
    if (!assignerCommandeId) return;
    if (!assignerLivreurId) {
      toast.error("Sélectionnez un livreur.");
      return;
    }
    const item = commandes.find((c) => c.id === assignerCommandeId);
    if (!item) return;
    const newItem = {
      ...item,
      livreurId: assignerLivreurId,
      dateLivraisonPrevue: assignerDate || item.dateLivraisonPrevue,
      heureLivraisonPrevue: assignerHeure || item.heureLivraisonPrevue,
      statut: "assignee" as const,
    };
    const updated = { ...DB, commandes: commandes.map((c) => (c.id === assignerCommandeId ? newItem : c)) };
    const histEntry = updateHistoryEntry("Commande", assignerCommandeId, `${item.numero} - ${item.client}`, item as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    const withHist = histEntry ? addHistoryEntry(updated, histEntry) : updated;
    setDB(withHist); saveDB(withHist);
    const livreurNomChoisi = DB.livreurs.find((l) => l.id === assignerLivreurId)?.nom || "";
    logActivity("update", "Commande", `${item.numero} - assignée à ${livreurNomChoisi}`);
    toast.success(`Commande assignée à ${livreurNomChoisi}`);
    setAssignerOpen(false);
    setAssignerCommandeId(null);
  };

  // ─── Créer la vente correspondante à une commande livrée ──────────────────
  // Relie une Commande à la Vente qui en résulte, en reprenant ses éléments
  // (client, packs, livreur, commercial) comme pré-remplissage. Reproduit
  // volontairement la même logique que VentesSection.tsx (validation métier,
  // bonus, mouvement de stock camion/usine, tentative de validation Cloud
  // Function, historique) au lieu d'une version simplifiée, pour qu'une vente
  // créée depuis une commande soit un enregistrement identique en tout point
  // à une vente créée directement dans Ventes — même stock, même commission,
  // même comportement de synchronisation serveur.
  const [venteOpen, setVenteOpen] = useState(false);
  const [venteCommandeId, setVenteCommandeId] = useState<string | null>(null);
  const [venteNumero, setVenteNumero] = useState("");
  const [venteDate, setVenteDate] = useState(todayLocal());
  const [venteClient, setVenteClient] = useState("");
  const [venteCommercial, setVenteCommercial] = useState("none");
  const [ventePacks, setVentePacks] = useState("");
  const [ventePrix, setVentePrix] = useState("");
  const [venteLivreur, setVenteLivreur] = useState("none");
  const [venteAvance, setVenteAvance] = useState("");
  const [venteModePaiement, setVenteModePaiement] = useState("Espèces");
  const [venteSaving, setVenteSaving] = useState(false);
  const venteSavingRef = useRef(false);

  const handleOpenCreerVente = (c: Commande) => {
    const clientObj = c.clientId ? DB.clients.find((x) => x.id === c.clientId) : DB.clients.find((x) => x.nom === c.client);
    const prixDefault = clientObj?.prix || DB.params.prixPack || 600;
    const livreurNom = c.livreurId ? DB.livreurs.find((l) => l.id === c.livreurId)?.nom : undefined;
    const commercialVal = c.commercial && DB.commerciaux.some((co) => co.nom === c.commercial) ? c.commercial : "none";
    setVenteCommandeId(c.id);
    setVenteNumero("BL-" + String(DB.ventes.length + 1).padStart(3, "0"));
    setVenteDate(c.dateLivraisonPrevue || todayLocal());
    setVenteClient(c.client);
    setVenteCommercial(commercialVal);
    setVentePacks(String(c.packs));
    setVentePrix(String(prixDefault));
    setVenteLivreur(livreurNom || "none");
    setVenteAvance("");
    setVenteModePaiement("Espèces");
    setVenteOpen(true);
  };

  const handleCreerVente = async () => {
    if (venteSavingRef.current || !venteCommandeId) return;
    const commandeObj = commandes.find((c) => c.id === venteCommandeId);
    if (!commandeObj) { toast.error("Commande introuvable"); return; }

    venteSavingRef.current = true;
    setVenteSaving(true);

    const montant = Number(ventePacks) * Number(ventePrix);
    const av = venteAvance !== "" ? Number(venteAvance) : montant;
    const mode = av >= montant ? ("Payé" as const) : ("Crédit" as const);
    const bonus = calculerBonusVente(Number(ventePacks), venteClient, DB);
    const livreurVal = venteLivreur === "none" ? "" : venteLivreur;
    const commercialVal = venteCommercial === "none" ? "" : venteCommercial;

    const clotureMsg = checkCloture(venteDate, DB, currentUser?.role || "lecteur");
    if (clotureMsg) { toast.error(clotureMsg); venteSavingRef.current = false; setVenteSaving(false); return; }

    const validation = validateVente(
      { client: venteClient, packs: Number(ventePacks), prix: Number(ventePrix), mode, avance: av, livreur: livreurVal, commercial: commercialVal },
      DB, false
    );
    if (!validation.valid) { validation.errors.forEach((e) => toast.error(e)); venteSavingRef.current = false; setVenteSaving(false); return; }
    if (validation.warnings.length > 0) { validation.warnings.forEach((w) => toast.warning(w)); }

    // Tentative de validation serveur (Cloud Functions), même logique que
    // VentesSection.tsx : si elle réussit, on réutilise son id plutôt que
    // d'en générer un second pour éviter une vente en double.
    const cfAvailable = await checkCloudFunctionsAvailability();
    let cfVenteId: string | null = null;
    if (cfAvailable) {
      try {
        const cfResult = await cfValidateVente({
          clientId: venteClient,
          clientNom: venteClient,
          packs: Number(ventePacks),
          prix: Number(ventePrix),
          mode: mode.normalize("NFC"),
          avance: av < montant ? av : undefined,
          commercial: commercialVal || undefined,
          date: venteDate,
        });
        if (cfResult.success && cfResult.data?.venteId) {
          cfVenteId = cfResult.data.venteId;
        } else {
          console.warn("[CF] Validation serveur échouée:", cfResult.error);
        }
      } catch (cfError) {
        console.warn("[CF] Erreur appel Cloud Function:", cfError);
      }
    }

    const item = {
      id: cfVenteId || uid(),
      numero: venteNumero,
      date: venteDate,
      client: venteClient,
      commercial: commercialVal,
      packs: Number(ventePacks),
      prix: Number(ventePrix),
      livreur: livreurVal,
      avance: av,
      modePaiement: venteModePaiement,
      mode,
      bonus,
      tauxCommission: Number(DB.params.taux) || 25,
    };
    // Mouvement de stock : même résolution camion/usine que VentesSection.tsx
    // (via Livreur.vehiculeId, pas Livreur.id — voir CLAUDE.md "Bug stock camions").
    const livreurObj = DB.livreurs.find((l) => l.nom === item.livreur);
    const source = livreurObj?.vehiculeId ? `camion_${livreurObj.vehiculeId}` : "usine";
    const mvtVente = creerMouvementVente(uid(), venteDate, Number(ventePacks) + bonus, currentUser?.nom || "", item.id, `${venteNumero} - ${venteClient}`, source as any, livreurObj?.id);

    const newCommande: Commande = { ...commandeObj, statut: "livree", venteId: item.id };

    let updated = {
      ...DB,
      ventes: [...DB.ventes, item],
      mouvementsStock: [...(DB.mouvementsStock || []), mvtVente],
      commandes: commandes.map((c) => (c.id === venteCommandeId ? newCommande : c)),
    };
    const histVente = createHistoryEntry("Ventes", item.id, `${venteNumero} - ${venteClient}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    updated = addHistoryEntry(updated, histVente);
    const histCommande = updateHistoryEntry("Commande", venteCommandeId, `${commandeObj.numero} - ${commandeObj.client}`, commandeObj as any, newCommande as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    if (histCommande) updated = addHistoryEntry(updated, histCommande);

    setDB(updated); saveDB(updated);
    logActivity("create", "Vente", `${venteNumero} - ${venteClient} - ${ventePacks} packs (depuis commande ${commandeObj.numero})`);
    logActivity("update", "Commande", `${commandeObj.numero} liée à la vente ${venteNumero}`);
    toast.success(cfVenteId ? "Vente validée et liée à la commande" : "Vente créée et liée à la commande");

    venteSavingRef.current = false;
    setVenteSaving(false);
    setVenteOpen(false);
    setVenteCommandeId(null);
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteTarget = deleteId ? commandes.find((c) => c.id === deleteId) || null : null;

  const confirmDelete = () => {
    const item = deleteTarget; if (!item) return;
    // Le bouton Supprimer est déjà masqué pour ces lignes (voir renderRow) —
    // ce contrôle est une seconde barrière si deleteId était fixé autrement.
    // Supprimer une commande liée à une vente laisserait la vente (vraie
    // transaction : stock, commission, caisse) orpheline, sans plus aucune
    // trace de l'appel/la commande qui l'a produite. Pour défaire une
    // livraison déjà facturée, annuler la vente correspondante (Ventes ou
    // Créances) est le bon circuit.
    if (item.venteId) {
      toast.error("Impossible de supprimer : cette commande est liée à une vente. Annulez d'abord la vente correspondante (rubrique Ventes).");
      setDeleteId(null);
      return;
    }
    const updated = {
      ...DB,
      commandes: commandes.filter((c) => c.id !== item.id),
      corbeille: [...DB.corbeille, { id: uid(), originalType: "commandes", moduleName: "Commande", desc: `${item.numero} - ${item.client}`, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }],
    };
    const histEntry = deleteHistoryEntry("Commande", item.id, `${item.numero} - ${item.client}`, item as any, currentUser?.nom || "", undefined, FIELD_LABELS);
    const withHist = addHistoryEntry(updated, histEntry);
    setDB(withHist); saveDB(withHist);
    logActivity("delete", "Commande", `${item.numero} - ${item.client}`);
    toast.success("Mise à la corbeille");
    setDeleteId(null);
  };

  // Ouvre le dialog de dispatching : pré-coche aucun camion par défaut (choix
  // explicite des camions disponibles ce jour), avec la capacité de chaque
  // livreur pré-remplie depuis sa fiche (modifiable pour ce calcul).
  const handleOpenDispatch = () => {
    const selection: Record<string, { dispo: boolean; capacite: string }> = {};
    DB.livreurs.forEach((l) => {
      selection[l.id] = { dispo: false, capacite: String(l.capacitePacks || CAPACITE_CAMION_DEFAUT) };
    });
    setDispatchSelection(selection);
    setDispatchDate(todayLocal());
    setDispatchResultat(null);
    setDispatchMode("auto");
    setManuelLivreurId("none");
    setManuelSelection({});
    setManuelDate(todayLocal());
    setManuelHeure("");
    setDispatchOpen(true);
  };

  const toggleDispatchDispo = (livreurId: string) => {
    setDispatchSelection((prev) => ({
      ...prev,
      [livreurId]: { ...prev[livreurId], dispo: !prev[livreurId]?.dispo },
    }));
  };

  const setDispatchCapacite = (livreurId: string, capacite: string) => {
    setDispatchSelection((prev) => ({ ...prev, [livreurId]: { ...prev[livreurId], capacite } }));
  };

  // Calcule le dispatching sur les commandes en attente (celles ni assignées,
  // ni déjà en cours/livrées/annulées) à partir des camions cochés comme
  // disponibles ci-dessus.
  const handleCalculerDispatch = () => {
    const camions: CamionDispo[] = DB.livreurs
      .filter((l) => dispatchSelection[l.id]?.dispo)
      .map((l) => ({
        livreurId: l.id,
        nom: l.nom,
        capacitePacks: dispatchSelection[l.id]?.capacite ? Number(dispatchSelection[l.id].capacite) || undefined : undefined,
      }));
    if (camions.length === 0) {
      toast.error("Sélectionnez au moins un camion/livreur disponible");
      return;
    }
    const commandesEnAttente = commandes.filter((c) => c.statut === "en_attente");
    if (commandesEnAttente.length === 0) {
      toast.error("Aucune commande en attente à dispatcher");
      return;
    }
    const resultat = calculerDispatching(commandesEnAttente, camions, {
      heureDepart: dispatchHeureDepart,
      vitesseKmH: Number(dispatchVitesse) || 22,
      minutesParArret: Number(dispatchMinutesArret) ?? 8,
    });
    setDispatchResultat(resultat);
    if (resultat.nonLocalisees.length > 0) {
      toast.warning(`${resultat.nonLocalisees.length} commande(s) ont une zone non reconnue et ne sont pas dispatchées automatiquement.`);
    }
  };

  // Applique le dispatching calculé : assigne chaque commande à son livreur,
  // passe son statut en "assignee" (sauf si déjà plus avancé, ce qui ne
  // devrait pas arriver puisqu'on ne dispatche que les commandes en attente),
  // et reprend l'heure/distance estimée comme heure de livraison prévue —
  // modifiable ensuite au cas par cas comme n'importe quelle commande.
  const handleAppliquerDispatch = () => {
    if (!dispatchResultat) return;
    setDispatchApplying(true);
    let updated = { ...DB };
    for (const tournee of dispatchResultat.tournees) {
      for (const arret of tournee.arrets) {
        const oldItem = commandes.find((c) => c.id === arret.commande.id);
        if (!oldItem) continue;
        const newItem: Commande = {
          ...oldItem,
          livreurId: tournee.livreurId,
          statut: "assignee",
          dateLivraisonPrevue: dispatchDate,
          heureLivraisonPrevue: arret.heureEta,
        };
        updated = { ...updated, commandes: updated.commandes.map((c) => (c.id === oldItem.id ? newItem : c)) };
        const histEntry = updateHistoryEntry("Commande", oldItem.id, `${newItem.numero} - ${newItem.client}`, oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
        if (histEntry) updated = addHistoryEntry(updated, histEntry);
      }
    }
    setDB(updated); saveDB(updated);
    const nbCommandes = dispatchResultat.tournees.reduce((s, t) => s + t.arrets.length, 0);
    logActivity("update", "Commande", `Dispatching appliqué : ${nbCommandes} commande(s) sur ${dispatchResultat.tournees.length} camion(s)`);
    toast.success(`Dispatching appliqué : ${nbCommandes} commande(s) assignée(s)`);
    setDispatchApplying(false);
    setDispatchOpen(false);
    setDispatchResultat(null);
  };

  const toggleManuelCommande = (id: string) => {
    setManuelSelection((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Dispatching manuel : le caissier/admin choisit lui-même un livreur et les
  // commandes à lui assigner (sans passer par l'algorithme de zone/capacité
  // ci-dessus) — utile pour une contrainte que l'algorithme ne connaît pas
  // (client à livrer par un chauffeur précis, tournée déjà convenue par
  // téléphone...). Même effet final que le dispatching automatique : livreur
  // assigné, statut "assignee", date/heure de livraison prévue si renseignées.
  const handleAssignerManuel = () => {
    if (manuelLivreurId === "none") { toast.error("Choisissez un livreur"); return; }
    const idsSelectionnes = Object.entries(manuelSelection).filter(([, v]) => v).map(([id]) => id);
    if (idsSelectionnes.length === 0) { toast.error("Sélectionnez au moins une commande"); return; }
    const livreurNom = DB.livreurs.find((l) => l.id === manuelLivreurId)?.nom || "";
    setManuelApplying(true);
    let updated = { ...DB };
    for (const id of idsSelectionnes) {
      const oldItem = commandes.find((c) => c.id === id);
      if (!oldItem) continue;
      const newItem: Commande = {
        ...oldItem,
        livreurId: manuelLivreurId,
        statut: "assignee",
        dateLivraisonPrevue: manuelDate || oldItem.dateLivraisonPrevue,
        heureLivraisonPrevue: manuelHeure || oldItem.heureLivraisonPrevue,
      };
      updated = { ...updated, commandes: updated.commandes.map((c) => (c.id === oldItem.id ? newItem : c)) };
      const histEntry = updateHistoryEntry("Commande", oldItem.id, `${newItem.numero} - ${newItem.client}`, oldItem as any, newItem as any, currentUser?.nom || "", undefined, FIELD_LABELS);
      if (histEntry) updated = addHistoryEntry(updated, histEntry);
    }
    setDB(updated); saveDB(updated);
    logActivity("update", "Commande", `Dispatching manuel : ${idsSelectionnes.length} commande(s) assignée(s) à ${livreurNom}`);
    toast.success(`${idsSelectionnes.length} commande(s) assignée(s) à ${livreurNom}`);
    setManuelApplying(false);
    setManuelSelection({});
    setDispatchOpen(false);
  };

  // Rendu d'une ligne de commande — factorisé pour être identique dans la vue
  // "Liste" à plat et dans la vue "Par zone" (une TableBody par zone), sans
  // dupliquer les boutons d'action et badges de statut à deux endroits.
  const renderCommandeRow = (c: Commande) => {
    const info = statutInfo(c.statut);
    const livreurNom = c.livreurId ? DB.livreurs.find((l) => l.id === c.livreurId)?.nom : undefined;
    const retardMin = calculerRetardLivraisonMinutes(c);
    return (
      <TableRow key={c.id}>
        <TableCell className="font-mono">{c.numero}</TableCell>
        <TableCell>
          <div>{fmtDate(c.date)}</div>
          <div className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {c.heureAppel || "-"}</div>
        </TableCell>
        <TableCell className="font-medium max-w-[160px] truncate" title={c.client}>{c.client}</TableCell>
        <TableCell className="whitespace-nowrap">{c.tel || "-"}</TableCell>
        <TableCell className="max-w-[160px]">
          <div className="flex items-center gap-1 text-sm truncate" title={c.zone}><MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" /> <span className="truncate">{c.zone}</span></div>
          {c.adresseDetail && <div className="text-xs text-gray-400 truncate" title={c.adresseDetail}>{c.adresseDetail}</div>}
          {(c.dateLivraisonPrevue || c.heureLivraisonPrevue) && (
            <div className="text-xs text-blue-600 whitespace-nowrap">
              Prévu : {c.dateLivraisonPrevue ? fmtDate(c.dateLivraisonPrevue) : ""} {c.heureLivraisonPrevue || ""}
            </div>
          )}
        </TableCell>
        <TableCell className="text-right font-bold">{c.packs}</TableCell>
        <TableCell>
          {livreurNom ? (
            <span className="inline-flex items-center gap-1 text-xs"><Truck className="w-3 h-3 text-purple-600" /> {livreurNom}</span>
          ) : (
            <span className="text-xs text-amber-600">Non assigné</span>
          )}
        </TableCell>
        <TableCell>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${info.badge}`}>{info.label}</span>
          {c.enLivraisonLe && c.statut !== "livree" && (
            <div className="text-xs text-purple-700 mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Départ {new Date(c.enLivraisonLe).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
          {c.livreeLe && (
            <div className="text-xs text-green-700 mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Arrivée {new Date(c.livreeLe).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
          {retardMin !== null && (
            <div className={`text-xs mt-1 ${retardMin > 5 ? "text-red-600" : retardMin < -5 ? "text-teal-600" : "text-gray-500"}`}>
              {retardMin > 5 ? `+${retardMin} min de retard` : retardMin < -5 ? `${-retardMin} min d'avance` : "à l'heure"}
            </div>
          )}
          {c.venteId && (
            <div className="text-xs text-green-700 mt-1 flex items-center gap-1">
              <ShoppingCart className="w-3 h-3" /> {DB.ventes.find((v) => v.id === c.venteId)?.numero || "Vente liée"}
            </div>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <div className="flex flex-nowrap gap-1">
            {c.statut === "en_attente" && (
              <Button variant="outline" size="sm" className="text-blue-600 hover:bg-blue-50 text-xs" onClick={() => handleOpenAssigner(c)}>Assigner</Button>
            )}
            {c.statut === "assignee" && (
              <Button variant="outline" size="sm" className="text-purple-600 hover:bg-purple-50 text-xs" onClick={() => handleChangeStatut(c.id, "en_livraison")}>En livraison</Button>
            )}
            {c.statut === "en_livraison" && (
              <Button variant="outline" size="sm" className="text-green-600 hover:bg-green-50 text-xs" onClick={() => handleChangeStatut(c.id, "livree")}>
                <PackageCheck className="w-3 h-3 mr-1" /> Livrée
              </Button>
            )}
            {c.statut === "livree" && !c.venteId && (
              <Button variant="outline" size="sm" className="text-teal-700 border-teal-300 hover:bg-teal-50 text-xs" onClick={() => handleOpenCreerVente(c)}>
                <ShoppingCart className="w-3 h-3 mr-1" /> Créer la vente
              </Button>
            )}
            {c.statut !== "livree" && c.statut !== "annulee" && (
              <Button variant="outline" size="sm" className="text-gray-500 hover:bg-gray-50 text-xs" onClick={() => handleChangeStatut(c.id, "annulee")}>
                <XCircle className="w-3 h-3" />
              </Button>
            )}
            {c.statut === "livree" && c.venteId && <CheckCircle2 className="w-4 h-4 text-green-600 mt-1" />}
            <Button variant="outline" size="sm" onClick={() => handleOpen(c)} aria-label={`Modifier ${c.numero}`}>
              <Pencil className="w-3 h-3" />
            </Button>
            {/* Une commande liée à une vente ne peut plus être supprimée —
                voir confirmDelete. Le bouton est masqué plutôt que désactivé
                pour éviter un clic qui ouvre une boîte de confirmation vouée
                à échouer. */}
            {!c.venteId && (
              <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(c.id)} aria-label={`Supprimer ${c.numero}`}>
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <PhoneCall className="w-6 h-6 text-[#1B4B6B]" /> Commandes
          </h2>
          <p className="text-sm text-gray-500">{commandes.length} commande(s) enregistrée(s)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleOpenDispatch} className="border-[#1B4B6B] text-[#1B4B6B] hover:bg-[#1B4B6B]/5">
            <Route className="w-4 h-4 mr-2" /> Dispatching
          </Button>
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]">
            <Plus className="w-4 h-4 mr-2" /> Nouvelle commande
          </Button>
        </div>
      </div>

      {/* KPI rapides */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-amber-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">En attente</p>
            <p className="text-2xl font-bold text-amber-600">{kpis.enAttente}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Assignées</p>
            <p className="text-2xl font-bold text-blue-600">{kpis.assignees}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">En livraison</p>
            <p className="text-2xl font-bold text-purple-600">{kpis.enLivraison}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-teal-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">À livrer aujourd'hui</p>
            <p className="text-2xl font-bold text-teal-600">{kpis.aLivrerAujourdhui}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtres par statut + bascule de vue */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={filtreStatut === "toutes" ? "default" : "outline"} className={filtreStatut === "toutes" ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""} onClick={() => setFiltreStatut("toutes")}>
            Toutes ({commandes.length})
          </Button>
          {STATUTS.map((s) => (
            <Button key={s.value} size="sm" variant={filtreStatut === s.value ? "default" : "outline"} className={filtreStatut === s.value ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""} onClick={() => setFiltreStatut(s.value)}>
              {s.label} ({commandes.filter((c) => c.statut === s.value).length})
            </Button>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <Button size="sm" variant={vueTableau === "liste" ? "default" : "ghost"} className={vueTableau === "liste" ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""} onClick={() => setVueTableau("liste")}>
            Liste
          </Button>
          <Button size="sm" variant={vueTableau === "zone" ? "default" : "ghost"} className={vueTableau === "zone" ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""} onClick={() => setVueTableau("zone")}>
            <MapPin className="w-3 h-3 mr-1" /> Par zone
          </Button>
          <Button size="sm" variant={vueTableau === "livreur" ? "default" : "ghost"} className={vueTableau === "livreur" ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""} onClick={() => setVueTableau("livreur")}>
            <Truck className="w-3 h-3 mr-1" /> Par livreur
          </Button>
        </div>
      </div>

      {/* Tableau des commandes — vue "Liste" (ordre chronologique), "Par
          zone" (une section par zone, pour préparer les tournées) ou "Par
          livreur" (une section par livreur assigné, pour voir la charge de
          chaque tournée). Les trois vues partagent la même en-tête et le
          même rendu de ligne (renderCommandeRow) pour rester strictement
          cohérentes. */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#1B4B6B] hover:bg-[#1B4B6B]">
                  <TableHead className="text-white font-semibold">N°</TableHead>
                  <TableHead className="text-white font-semibold">Date / Saisie</TableHead>
                  <TableHead className="text-white font-semibold">Client</TableHead>
                  <TableHead className="text-white font-semibold">Téléphone</TableHead>
                  <TableHead className="text-white font-semibold">Livraison</TableHead>
                  <TableHead className="text-white font-semibold text-right">Packs</TableHead>
                  <TableHead className="text-white font-semibold">Livreur</TableHead>
                  <TableHead className="text-white font-semibold">Statut</TableHead>
                  <TableHead className="text-white font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              {vueTableau === "liste" ? (
                <TableBody>
                  {commandesFiltrees.length > 0 ? commandesFiltrees.map(renderCommandeRow) : (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-400 py-8">Aucune commande</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              ) : vueTableau === "zone" ? (
                commandesParZone.length > 0 ? commandesParZone.map((groupe) => (
                  <TableBody key={groupe.zone}>
                    <TableRow className="bg-gray-100 hover:bg-gray-100">
                      <TableCell colSpan={9} className="py-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-800 flex items-center gap-1">
                            <MapPin className="w-4 h-4 text-[#1B4B6B]" /> {groupe.zone}
                          </span>
                          <span className="text-xs text-gray-500">
                            {groupe.commandes.length} commande(s) · {groupe.totalPacks} pack(s)
                            {groupe.aTraiter > 0 && <span className="ml-2 text-amber-600 font-medium">{groupe.aTraiter} à traiter</span>}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {groupe.commandes.map(renderCommandeRow)}
                  </TableBody>
                )) : (
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-400 py-8">Aucune commande</TableCell>
                    </TableRow>
                  </TableBody>
                )
              ) : commandesParLivreur.length > 0 ? (
                commandesParLivreur.map((groupe) => (
                  <TableBody key={groupe.livreurId}>
                    <TableRow className={groupe.livreurId === "__non_assigne__" ? "bg-amber-50 hover:bg-amber-50" : "bg-gray-100 hover:bg-gray-100"}>
                      <TableCell colSpan={9} className="py-2">
                        <div className="flex items-center justify-between">
                          <span className={`font-semibold flex items-center gap-1 ${groupe.livreurId === "__non_assigne__" ? "text-amber-700" : "text-gray-800"}`}>
                            <Truck className={`w-4 h-4 ${groupe.livreurId === "__non_assigne__" ? "text-amber-600" : "text-[#1B4B6B]"}`} /> {groupe.nom}
                          </span>
                          <span className="text-xs text-gray-500">
                            {groupe.commandes.length} commande(s) · {groupe.totalPacks} pack(s)
                            {groupe.aTraiter > 0 && <span className="ml-2 text-amber-600 font-medium">{groupe.aTraiter} à traiter</span>}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {groupe.commandes.map(renderCommandeRow)}
                  </TableBody>
                ))
              ) : (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-gray-400 py-8">Aucune commande</TableCell>
                  </TableRow>
                </TableBody>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Nouvelle / Modifier commande */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier la commande" : "Nouvelle commande"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            {editLocked && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                Cette commande est déjà liée à une vente. Le client, la quantité, le commercial, le livreur et le statut ne sont plus modifiables ici (ils ne changeraient pas la vente déjà enregistrée) — corrigez-les directement dans Ventes si nécessaire. Les autres champs restent modifiables.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date de saisie</Label>
                <Input type="date" value={date} disabled />
                <p className="text-[11px] text-gray-400 mt-1">Automatique — non modifiable.</p>
              </div>
              <div>
                <Label>Heure de saisie</Label>
                <Input type="time" value={heureAppel} disabled />
                <p className="text-[11px] text-gray-400 mt-1">Automatique — non modifiable.</p>
              </div>
            </div>

            <div>
              <Label>Client</Label>
              <Input value={client} onChange={(e) => handleClientChange(e.target.value)} placeholder="Ex: Boutique Ndiaye" list="commande-client-list" disabled={editLocked} />
              <datalist id="commande-client-list">{DB.clients.map((c) => <option key={c.id} value={c.nom} />)}</datalist>
              {clientId !== "none" && (
                <p className="text-xs text-teal-600 mt-1">Client existant reconnu — téléphone/zone pré-remplis (modifiables).</p>
              )}
            </div>
            <div><Label>Téléphone</Label><Input type="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="77 123 45 67" /></div>

            <div>
              <Label>Zone / quartier de livraison</Label>
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger><SelectValue placeholder="Sélectionner une commune ou un quartier" /></SelectTrigger>
                <SelectContent>{NOMS_ZONES_DAKAR.map((z: string) => (<SelectItem key={z} value={z}>{z}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <div><Label>Précision d'adresse (optionnel)</Label><Textarea value={adresseDetail} onChange={(e) => setAdresseDetail(e.target.value)} placeholder="Repère, numéro de porte, étage..." rows={2} /></div>

            <div><Label>Quantité (packs)</Label><Input type="number" value={packs} onChange={(e) => setPacks(e.target.value)} placeholder="Ex: 10" disabled={editLocked} /></div>

            <div>
              <Label>Pris par (commercial)</Label>
              <Input value={commercial} onChange={(e) => setCommercial(e.target.value)} placeholder="Qui a pris l'appel" list="commercial-list" disabled={editLocked} />
              <datalist id="commercial-list">{DB.commerciaux.map((c) => <option key={c.id} value={c.nom} />)}</datalist>
            </div>

            <div>
              <Label>Livreur assigné</Label>
              <Select value={livreurId} onValueChange={setLivreurId} disabled={editLocked}>
                <SelectTrigger><SelectValue placeholder="Aucun livreur assigné" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun livreur assigné</SelectItem>
                  {DB.livreurs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date livraison prévue</Label><Input type="date" value={dateLivraisonPrevue} onChange={(e) => setDateLivraisonPrevue(e.target.value)} /></div>
              <div><Label>Heure prévue</Label><Input type="time" value={heureLivraisonPrevue} onChange={(e) => setHeureLivraisonPrevue(e.target.value)} /></div>
            </div>

            <div>
              <Label>Statut</Label>
              <Select value={statut} onValueChange={(v) => setStatut(v as Commande["statut"])} disabled={editLocked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUTS.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div><Label>Notes (optionnel)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instructions particulières..." rows={2} /></div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">{editId ? "Enregistrer les modifications" : "Enregistrer"}</Button>
              <Button variant="outline" onClick={() => { setOpen(false); setEditId(null); }}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Assigner un livreur — ouvert depuis le bouton "Assigner" du
          tableau, pour choisir le livreur en un clic sans passer par le
          dialog complet "Modifier". */}
      <Dialog open={assignerOpen} onOpenChange={(o) => { setAssignerOpen(o); if (!o) setAssignerCommandeId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assigner un livreur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Livreur</Label>
              <Select value={assignerLivreurId} onValueChange={setAssignerLivreurId}>
                <SelectTrigger><SelectValue placeholder="Choisir un livreur" /></SelectTrigger>
                <SelectContent>
                  {DB.livreurs.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date livraison prévue</Label><Input type="date" value={assignerDate} onChange={(e) => setAssignerDate(e.target.value)} /></div>
              <div><Label>Heure prévue</Label><Input type="time" value={assignerHeure} onChange={(e) => setAssignerHeure(e.target.value)} /></div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleConfirmerAssigner} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">Assigner</Button>
              <Button variant="outline" onClick={() => setAssignerOpen(false)}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Créer la vente correspondante — pré-rempli depuis la commande,
          reste modifiable avant confirmation (ex: ajuster le prix, l'avance). */}
      <Dialog open={venteOpen} onOpenChange={(o) => { setVenteOpen(o); if (!o) setVenteCommandeId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Créer la vente correspondante</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-xs text-gray-500">Vérifiez les éléments repris de la commande avant de valider — ils resteront modifiables sur la vente créée.</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>N° BL</Label><Input value={venteNumero} onChange={(e) => setVenteNumero(e.target.value)} /></div>
              <div><Label>Date</Label><Input type="date" value={venteDate} onChange={(e) => setVenteDate(e.target.value)} /></div>
            </div>
            <div><Label>Client</Label><Input value={venteClient} onChange={(e) => setVenteClient(e.target.value)} list="vente-cl-list" /><datalist id="vente-cl-list">{DB.clients.map((c) => <option key={c.id} value={c.nom} />)}</datalist></div>
            <div>
              <Label>Commercial</Label>
              <Select value={venteCommercial} onValueChange={setVenteCommercial}>
                <SelectTrigger><SelectValue placeholder="-- Aucun --" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- Aucun --</SelectItem>
                  {DB.commerciaux.map((c) => <SelectItem key={c.id} value={c.nom}>{c.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Packs</Label><Input type="number" value={ventePacks} onChange={(e) => setVentePacks(e.target.value)} /></div>
              <div><Label>Prix/pack (F)</Label><Input type="number" value={ventePrix} onChange={(e) => setVentePrix(e.target.value)} /></div>
            </div>
            {Number(ventePacks) > 0 && (
              <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 text-center">
                Montant : {fmt(Number(ventePacks) * Number(ventePrix || 0))} — Bonus : {calculerBonusVente(Number(ventePacks), venteClient, DB)} pack(s) offert(s)
              </div>
            )}
            <div>
              <Label>Livreur</Label>
              <Select value={venteLivreur} onValueChange={setVenteLivreur}>
                <SelectTrigger><SelectValue placeholder="-- Aucun --" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- Aucun --</SelectItem>
                  {DB.livreurs.map((l) => <SelectItem key={l.id} value={l.nom}>{l.nom}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Avance (F)</Label><Input type="number" value={venteAvance} onChange={(e) => setVenteAvance(e.target.value)} placeholder="Vide = payé intégralement" /></div>
              <div>
                <Label>Mode paiement</Label>
                <Select value={venteModePaiement} onValueChange={setVenteModePaiement}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Espèces", "Wave", "Orange Money", "Mobile Money", "Chèque", "Virement"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleCreerVente} disabled={venteSaving} className="flex-1 bg-teal-700 hover:bg-teal-800 disabled:opacity-60">
                {venteSaving ? "Création..." : "Créer la vente"}
              </Button>
              <Button variant="outline" onClick={() => { setVenteOpen(false); setVenteCommandeId(null); }} disabled={venteSaving}>Annuler</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Dispatching automatique par camion */}
      <Dialog open={dispatchOpen} onOpenChange={(o) => { setDispatchOpen(o); if (!o) setDispatchResultat(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Route className="w-5 h-5 text-[#1B4B6B]" /> Dispatching</DialogTitle>
          </DialogHeader>

          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            <Button size="sm" variant={dispatchMode === "auto" ? "default" : "ghost"} className={dispatchMode === "auto" ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""} onClick={() => { setDispatchMode("auto"); setDispatchResultat(null); }}>
              Automatique
            </Button>
            <Button size="sm" variant={dispatchMode === "manuel" ? "default" : "ghost"} className={dispatchMode === "manuel" ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""} onClick={() => setDispatchMode("manuel")}>
              Manuel
            </Button>
          </div>

          {dispatchMode === "manuel" ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-500">
                Choisissez un livreur et les commandes à lui assigner directement, sans passer par le calcul automatique — utile pour une contrainte particulière (client à livrer par un chauffeur précis, tournée déjà convenue par téléphone...).
              </p>

              <div>
                <Label>Livreur</Label>
                <Select value={manuelLivreurId} onValueChange={setManuelLivreurId}>
                  <SelectTrigger><SelectValue placeholder="Choisir un livreur" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- Choisir --</SelectItem>
                    {DB.livreurs.map((l) => (<SelectItem key={l.id} value={l.id}>{l.nom}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date de livraison (optionnel)</Label><Input type="date" value={manuelDate} onChange={(e) => setManuelDate(e.target.value)} /></div>
                <div><Label>Heure prévue (optionnel)</Label><Input type="time" value={manuelHeure} onChange={(e) => setManuelHeure(e.target.value)} /></div>
              </div>

              <div>
                <Label>Commandes en attente ({commandes.filter((c) => c.statut === "en_attente").length})</Label>
                <div className="space-y-1 mt-2 max-h-64 overflow-y-auto">
                  {commandes.filter((c) => c.statut === "en_attente").length > 0 ? commandes.filter((c) => c.statut === "en_attente").map((c) => (
                    <div key={c.id} className={`flex items-center gap-3 p-2 rounded-lg border text-sm ${manuelSelection[c.id] ? "border-[#1B4B6B] bg-[#1B4B6B]/5" : "border-gray-200"}`}>
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={!!manuelSelection[c.id]}
                        onChange={() => toggleManuelCommande(c.id)}
                        id={`manuel-cmd-${c.id}`}
                      />
                      <label htmlFor={`manuel-cmd-${c.id}`} className="flex-1 cursor-pointer">
                        <span className="font-medium">{c.numero} — {c.client}</span>
                        <span className="text-gray-500"> · {c.zone} · {c.packs} pack(s)</span>
                      </label>
                    </div>
                  )) : (
                    <p className="text-sm text-gray-400 py-4 text-center">Aucune commande en attente</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleAssignerManuel} disabled={manuelApplying} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85] disabled:opacity-60">
                  {manuelApplying ? "Application..." : "Assigner"}
                </Button>
                <Button variant="outline" onClick={() => setDispatchOpen(false)}>Fermer</Button>
              </div>
            </div>
          ) : !dispatchResultat ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-gray-500">
                Répartit les {commandes.filter((c) => c.statut === "en_attente").length} commande(s) en attente entre les camions cochés ci-dessous, en fonction de la zone de livraison de chaque commande (position approximative par quartier) — puis calcule un ordre de tournée et une heure d'arrivée estimée par arrêt.
              </p>

              <div>
                <Label>Camions / livreurs disponibles aujourd'hui</Label>
                <div className="space-y-2 mt-2">
                  {DB.livreurs.length > 0 ? DB.livreurs.map((l) => (
                    <div key={l.id} className={`flex items-center gap-3 p-2 rounded-lg border ${dispatchSelection[l.id]?.dispo ? "border-[#1B4B6B] bg-[#1B4B6B]/5" : "border-gray-200"}`}>
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={!!dispatchSelection[l.id]?.dispo}
                        onChange={() => toggleDispatchDispo(l.id)}
                        id={`dispatch-livreur-${l.id}`}
                      />
                      <label htmlFor={`dispatch-livreur-${l.id}`} className="flex-1 text-sm font-medium cursor-pointer flex items-center gap-1">
                        <Truck className="w-3 h-3 text-purple-600" /> {l.nom}
                      </label>
                      <div className="w-32">
                        <Input
                          type="number"
                          placeholder="Capacité (packs)"
                          value={dispatchSelection[l.id]?.capacite || ""}
                          onChange={(e) => setDispatchCapacite(l.id, e.target.value)}
                          disabled={!dispatchSelection[l.id]?.dispo}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-gray-400">Aucun livreur enregistré — ajoutez-en dans la rubrique Livreurs.</p>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">Capacité vide = pas de limite pour ce camion.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div><Label>Date de livraison</Label><Input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} /></div>
                <div><Label>Heure de départ</Label><Input type="time" value={dispatchHeureDepart} onChange={(e) => setDispatchHeureDepart(e.target.value)} /></div>
                <div><Label>Vitesse moy. (km/h)</Label><Input type="number" value={dispatchVitesse} onChange={(e) => setDispatchVitesse(e.target.value)} /></div>
              </div>
              <div>
                <Label>Temps par arrêt (min)</Label>
                <Input type="number" value={dispatchMinutesArret} onChange={(e) => setDispatchMinutesArret(e.target.value)} className="w-32" />
                <p className="text-xs text-gray-400 mt-1">
                  Estimation à vol d'oiseau et vitesse moyenne constante — pas un vrai calcul d'itinéraire routier. À ajuster/valider sur le terrain.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleCalculerDispatch} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">
                  <Route className="w-4 h-4 mr-2" /> Calculer le dispatching
                </Button>
                <Button variant="outline" onClick={() => setDispatchOpen(false)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {dispatchResultat.nonLocalisees.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">{dispatchResultat.nonLocalisees.length} commande(s) non dispatchée(s) — zone non reconnue :</p>
                    <p className="text-xs mt-1">{dispatchResultat.nonLocalisees.map((c) => `${c.numero} (${c.zone || "zone vide"})`).join(", ")}</p>
                    <p className="text-xs mt-1">À assigner manuellement (bouton Modifier sur la commande).</p>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {dispatchResultat.tournees.map((t) => {
                  const depassement = t.capacitePacks && t.totalPacks > t.capacitePacks;
                  return (
                    <Card key={t.livreurId} className={depassement ? "border-red-300" : ""}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-semibold text-gray-900 flex items-center gap-2">
                            <Truck className="w-4 h-4 text-purple-600" /> {t.nom}
                          </span>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>{t.arrets.length} arrêt(s)</span>
                            <span className={depassement ? "text-red-600 font-medium" : ""}>
                              {t.totalPacks} pack(s){t.capacitePacks ? ` / ${t.capacitePacks}` : ""}
                            </span>
                            <span>{t.distanceTotaleKm} km</span>
                            <span>~{Math.round(t.dureeTotaleMin / 60 * 10) / 10} h</span>
                          </div>
                        </div>
                        {depassement && (
                          <p className="text-xs text-red-600">Capacité dépassée pour ce camion — envisagez d'augmenter la capacité, d'ajouter un camion ou de retirer des commandes.</p>
                        )}
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">#</TableHead>
                                <TableHead className="text-xs">Client</TableHead>
                                <TableHead className="text-xs">Zone</TableHead>
                                <TableHead className="text-xs text-right">Packs</TableHead>
                                <TableHead className="text-xs text-right">Dist. cumulée</TableHead>
                                <TableHead className="text-xs text-right">ETA</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {t.arrets.map((a, idx) => (
                                <TableRow key={a.commande.id}>
                                  <TableCell className="text-xs">{idx + 1}</TableCell>
                                  <TableCell className="text-xs font-medium">{a.commande.client}</TableCell>
                                  <TableCell className="text-xs">{a.commande.zone}</TableCell>
                                  <TableCell className="text-xs text-right">{a.commande.packs}</TableCell>
                                  <TableCell className="text-xs text-right">{a.distanceCumulee} km</TableCell>
                                  <TableCell className="text-xs text-right font-medium">{a.heureEta}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleAppliquerDispatch} disabled={dispatchApplying} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85] disabled:opacity-60">
                  {dispatchApplying ? "Application..." : "Appliquer ce dispatching"}
                </Button>
                <Button variant="outline" onClick={() => setDispatchResultat(null)}>Recalculer</Button>
                <Button variant="outline" onClick={() => setDispatchOpen(false)}>Fermer</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Supprimer cette commande ?"
        description={deleteTarget ? `${deleteTarget.numero} - ${deleteTarget.client} - ${deleteTarget.packs} packs. Cette entrée sera déplacée vers la corbeille.` : ""}
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
