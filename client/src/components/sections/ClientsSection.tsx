import { useState, useMemo, useRef } from "react";
import { useApp } from "@/contexts/AppContext";
import { uid, fmt, fmtNumber, fmtDate, resteVente, normaliserTexte } from "@/lib/helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, Search, Upload, Eye, ArrowUpDown, Users, DollarSign, AlertTriangle, MapPin, LocateFixed, UserX, Printer, MessageCircle, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { Client } from "@/lib/types";
import { MapView } from "@/components/Map";
import { NOMS_ZONES_DAKAR, getArrondissement } from "@/lib/communesDakar";
// Centre par défaut de la carte : Dakar, Sénégal (zone d'activité de MA2F).
const CENTRE_DAKAR = { lat: 14.7167, lng: -17.4677 };

type SortKey = "nom" | "zone" | "type" | "ca" | "packs" | "nbVentes" | "solde" | "derniere";

export default function ClientsSection() {
  const { DB, setDB, saveDB, logActivity, currentUser } = useApp();
  // Import CSV : action d'écriture (crée/écrase des clients), donc réservée
  // aux rôles qui peuvent effectivement écrire côté Firestore (voir
  // `canWrite()` dans firestore.rules) — admin/caissier/commercial. Avant ce
  // correctif, le bouton n'avait aucune garde ici : il était visible pour
  // n'importe quel rôle ayant accès à la section Clients, y compris
  // `lecteur` (lecture seule), pour qui l'import échouait silencieusement
  // côté sync. Même liste de rôles que canExportExcel dans App.tsx (Export
  // Excel / Sauvegarde Excel) pour rester cohérent.
  const canImportClients = (currentUser?.roles || []).some((r) => ["admin", "caissier", "commercial"].includes(r));
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [ficheClientId, setFicheClientId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sansAchatOnly, setSansAchatOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("ca");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [nom, setNom] = useState("");
  const [type, setType] = useState("Boutique");
  const [zone, setZone] = useState("");
  const [tel, setTel] = useState("");
  const [prix, setPrix] = useState("650");
  const [plafondCredit, setPlafondCredit] = useState("");
  // Bonus exceptionnel (optionnel) : règle propre à ce client qui remplace
  // le seuil de bonus global (Paramètres > bonusSeuil). Vide = pas de règle
  // exceptionnelle, le client suit le bonus standard. Voir calculerBonusVente()
  // dans lib/helpers.ts.
  const [bonusSeuilClient, setBonusSeuilClient] = useState("");
  const [bonusPacksClient, setBonusPacksClient] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<any>(null);

  const ZONE_VIDE = "Zone non renseignée";
  const TYPE_VIDE = "Type non renseigné";

  // Agrégats par client : CA total, packs achetés, nb de ventes, solde dû,
  // date de dernière vente. Le rattachement se fait par c.nom (voir note
  // sur la fragilité de ce lien plus bas, section handleSave).
  const clientStats = useMemo(() => {
    const map = new Map<string, { ca: number; packs: number; nbVentes: number; solde: number; derniere: string }>();
    DB.ventes.forEach((v) => {
      const entry = map.get(v.client) || { ca: 0, packs: 0, nbVentes: 0, solde: 0, derniere: "" };
      entry.ca += v.packs * v.prix;
      entry.packs += v.packs;
      entry.nbVentes += 1;
      entry.solde += Math.max(0, resteVente(v, DB));
      if (!entry.derniere || (v.date || "") > entry.derniere) entry.derniere = v.date || "";
      map.set(v.client, entry);
    });
    return map;
  }, [DB.ventes, DB]);

  const enrichedClients = useMemo(() => {
    return DB.clients.map((c) => {
      const s = clientStats.get(c.nom) || { ca: 0, packs: 0, nbVentes: 0, solde: 0, derniere: "" };
      return { ...c, ca: s.ca, packsAchetes: s.packs, nbVentes: s.nbVentes, solde: s.solde, derniere: s.derniere };
    });
  }, [DB.clients, clientStats]);

  const filteredClients = useMemo(() => {
    // Recherche tolérante : insensible aux accents (Ndèye/Ndeye, Moussa/Moûssa),
    // à la casse, aux espaces superflus, et à l'ordre des mots (chaque mot tapé
    // doit se retrouver quelque part dans nom/zone/type/téléphone). Avant, une
    // recherche par substring strict (accent/casse exacts) faisait "disparaître"
    // des clients pourtant présents dès qu'on tapait le nom un peu différemment.
    const mots = normaliserTexte(search).split(/\s+/).filter(Boolean);
    const list = enrichedClients
      .filter((c) => {
        if (mots.length === 0) return true;
        const haystack = normaliserTexte([c.nom, c.zone, c.type, c.tel].filter(Boolean).join(" "));
        return mots.every((m) => haystack.includes(m));
      })
      .filter((c) => !sansAchatOnly || !c.nbVentes);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "nom": return dir * a.nom.localeCompare(b.nom, "fr");
        case "zone": return dir * (a.zone || "").localeCompare(b.zone || "", "fr");
        case "type": return dir * (a.type || "").localeCompare(b.type || "", "fr");
        case "ca": return dir * (a.ca - b.ca);
        case "packs": return dir * (a.packsAchetes - b.packsAchetes);
        case "nbVentes": return dir * (a.nbVentes - b.nbVentes);
        case "solde": return dir * (a.solde - b.solde);
        case "derniere": return dir * (a.derniere || "").localeCompare(b.derniere || "");
        default: return 0;
      }
    });
  }, [enrichedClients, search, sansAchatOnly, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  // ─── Partage de la liste filtrée (impression, WhatsApp, copier) ───────────
  // Réutilise exactement `filteredClients` (recherche + toggle "sans achat"
  // combinés) : ce qui est partagé correspond toujours à ce qui est affiché.
  const buildListeTexte = () => {
    const titre = sansAchatOnly ? "Clients sans achat" : "Liste des clients";
    const lignes = filteredClients.map((c, i) => `${i + 1}. ${c.nom} — ${c.tel || "pas de numéro"}`);
    return `${titre} (${filteredClients.length}) — MA2F AquaSachet\n\n${lignes.join("\n")}`;
  };

  const handlePrintClients = () => {
    if (filteredClients.length === 0) { toast.error("Aucun client à imprimer avec ces filtres"); return; }
    window.print();
  };

  const handleShareWhatsapp = () => {
    if (filteredClients.length === 0) { toast.error("Aucun client à envoyer avec ces filtres"); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(buildListeTexte())}`, "_blank");
  };

  const handleCopyListe = async () => {
    if (filteredClients.length === 0) { toast.error("Aucun client à copier avec ces filtres"); return; }
    try {
      await navigator.clipboard.writeText(buildListeTexte());
      toast.success("Liste copiée — collez-la dans SMS, Email, etc.");
    } catch {
      toast.error("Impossible de copier automatiquement. Utilisez WhatsApp ou l'impression.");
    }
  };

  // Web Share API : ouvre le sélecteur natif (WhatsApp, Mail, SMS, Notes...)
  // quand le navigateur le supporte (mobile principalement, et Chrome desktop
  // récent) ; sinon on retombe sur la copie presse-papiers.
  const handleShareAutre = async () => {
    if (filteredClients.length === 0) { toast.error("Aucun client à partager avec ces filtres"); return; }
    const texte = buildListeTexte();
    if (navigator.share) {
      try { await navigator.share({ title: "Liste clients MA2F", text: texte }); }
      catch { /* annulé par l'utilisateur, ne rien faire */ }
    } else {
      handleCopyListe();
    }
  };

  // ─── KPI globaux ────────────────────────────────────────────────────────────
  const caTotalTousClients = useMemo(() => enrichedClients.reduce((s, c) => s + c.ca, 0), [enrichedClients]);
  const clientsAvecSolde = useMemo(() => enrichedClients.filter((c) => c.solde > 0).length, [enrichedClients]);
  const zonesCouvertes = useMemo(() => new Set(DB.clients.map((c) => c.zone?.trim() || ZONE_VIDE)).size, [DB.clients]);
  const clientsLocalises = useMemo(() => DB.clients.filter((c) => c.lat != null && c.lng != null).length, [DB.clients]);

  // ─── Répartition par zone et par type ──────────────────────────────────────
  const repartitionZone = useMemo(() => {
    const map = new Map<string, { ca: number; packs: number; nbClients: number }>();
    enrichedClients.forEach((c) => {
      const zoneKey = c.zone?.trim() || ZONE_VIDE;
      const entry = map.get(zoneKey) || { ca: 0, packs: 0, nbClients: 0 };
      entry.ca += c.ca; entry.packs += c.packsAchetes; entry.nbClients += 1;
      map.set(zoneKey, entry);
    });
    return Array.from(map.entries()).map(([zone, d]) => ({ zone, ...d })).sort((a, b) => b.ca - a.ca);
  }, [enrichedClients]);

  const repartitionType = useMemo(() => {
    const map = new Map<string, { ca: number; packs: number; nbClients: number }>();
    enrichedClients.forEach((c) => {
      const typeKey = c.type?.trim() || TYPE_VIDE;
      const entry = map.get(typeKey) || { ca: 0, packs: 0, nbClients: 0 };
      entry.ca += c.ca; entry.packs += c.packsAchetes; entry.nbClients += 1;
      map.set(typeKey, entry);
    });
    return Array.from(map.entries()).map(([type, d]) => ({ type, ...d })).sort((a, b) => b.ca - a.ca);
  }, [enrichedClients]);

  const topClients = useMemo(() => [...enrichedClients].sort((a, b) => b.ca - a.ca).slice(0, 5), [enrichedClients]);

  const [saving, setSaving] = useState(false);

  const handleOpen = (id?: string) => {
    markerRef.current = null;
    mapInstanceRef.current = null;
    if (id) {
      const c = DB.clients.find((x) => x.id === id);
      if (!c) return;
      setEditId(id); setNom(c.nom); setType(c.type || "Boutique"); setZone(c.zone || ""); setTel(c.tel || ""); setPrix(String(c.prix || 650));
      setPlafondCredit(c.plafondCredit ? String(c.plafondCredit) : "");
      setBonusSeuilClient(c.bonusExceptionnel ? String(c.bonusExceptionnel.seuil) : "");
      setBonusPacksClient(c.bonusExceptionnel ? String(c.bonusExceptionnel.packsBonus) : "");
      setLat(c.lat ?? null); setLng(c.lng ?? null);
    } else {
      setEditId(null); setNom(""); setType("Boutique"); setZone(""); setTel(""); setPrix("650");
      setPlafondCredit("");
      setBonusSeuilClient(""); setBonusPacksClient("");
      setLat(null); setLng(null);
    }
    setOpen(true);
  };

  // Place (ou replace) le marqueur de position du client sur la carte.
  const placeMarker = (map: google.maps.Map, position: google.maps.LatLngLiteral) => {
    if (markerRef.current) markerRef.current.map = null;
    if (window.google?.maps?.marker?.AdvancedMarkerElement) {
      markerRef.current = new window.google.maps.marker.AdvancedMarkerElement({ map, position });
    }
  };

  const handleMapReady = (map: google.maps.Map) => {
    mapInstanceRef.current = map;
    if (lat != null && lng != null) placeMarker(map, { lat, lng });
    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const newLat = e.latLng.lat();
      const newLng = e.latLng.lng();
      setLat(newLat);
      setLng(newLng);
      placeMarker(map, { lat: newLat, lng: newLng });
    });
  };

  // Géocodage : estime une position à partir du texte de la zone (ex: "Pikine" ->
  // coordonnées approximatives du quartier). L'utilisateur peut ensuite affiner en
  // cliquant sur la carte. `zoneOverride` permet de géocoder immédiatement la valeur
  // tout juste sélectionnée dans le menu déroulant, sans attendre le prochain rendu
  // (le state `zone` n'est pas encore à jour au moment de l'appel dans onValueChange).
  const handleGeocodeZone = (zoneOverride?: string) => {
    const z = (zoneOverride ?? zone).trim();
    if (!z) { toast.error("Renseignez d'abord une zone"); return; }
    if (!window.google?.maps?.Geocoder) { toast.error("Carte pas encore chargée, réessayez dans un instant"); return; }
    setGeocoding(true);
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: `${z}, Dakar, Sénégal` }, (results, status) => {
      setGeocoding(false);
      if (status === "OK" && results && results[0]) {
        const loc = results[0].geometry.location;
        const newLat = loc.lat();
        const newLng = loc.lng();
        setLat(newLat);
        setLng(newLng);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter({ lat: newLat, lng: newLng });
          mapInstanceRef.current.setZoom(15);
          placeMarker(mapInstanceRef.current, { lat: newLat, lng: newLng });
        }
        toast.success("Position estimée depuis la zone. Ajustez-la en cliquant sur la carte si besoin.");
      } else {
        toast.error("Zone introuvable. Placez le point manuellement sur la carte.");
      }
    });
  };

  const handleSave = () => {
    if (saving) return;
    if (!nom.trim()) { toast.error("Nom requis"); return; }
    if (tel && tel.length !== 9) { toast.error("Le numéro de téléphone doit contenir exactement 9 chiffres"); return; }
    // Vérifier les doublons : même nom (insensible à la casse) = doublon.
    // Comme pour les livreurs et commerciaux, les ventes rattachent un client
    // par son NOM (pas par un ID) : deux clients de même nom se feraient
    // mélanger leur historique d'achats et leur solde dû. Le téléphone ne
    // suffit pas à les différencier ailleurs dans l'app, donc on interdit
    // tout doublon de nom, même avec des téléphones différents.
    const nomNorm = nom.trim().toLowerCase();
    const duplicate = DB.clients.find((c) =>
      c.id !== editId &&
      c.nom.trim().toLowerCase() === nomNorm
    );
    if (duplicate) {
      toast.error("Un client avec ce nom existe déjà. Utilisez un nom distinct (ex: ajoutez un quartier ou une initiale) pour éviter toute confusion dans les ventes et le solde dû.");
      return;
    }
    if (bonusSeuilClient.trim() && (!bonusPacksClient.trim() || Number(bonusSeuilClient) <= 0 || Number(bonusPacksClient) <= 0)) {
      toast.error("Bonus exceptionnel: seuil et packs offerts doivent être renseignés et positifs");
      return;
    }
    setSaving(true);
    const nomTrimmed = nom.trim();
    const bonusExceptionnel = bonusSeuilClient.trim()
      ? { seuil: Number(bonusSeuilClient), packsBonus: Number(bonusPacksClient) }
      : undefined;
    if (editId) {
      const oldItem = DB.clients.find((c) => c.id === editId);
      let updated = { ...DB, clients: DB.clients.map((c) => c.id === editId ? { ...c, nom: nomTrimmed, type, zone, tel, prix: Number(prix) || 650, plafondCredit: plafondCredit.trim() ? Number(plafondCredit) : undefined, bonusExceptionnel, lat: lat ?? undefined, lng: lng ?? undefined } : c) };
      // Cascade : si le nom change, mettre à jour les ventes existantes pour
      // ne pas perdre leur rattachement (historique, solde dû) à ce client.
      if (oldItem && oldItem.nom !== nomTrimmed) {
        updated = { ...updated, ventes: updated.ventes.map((v) => v.client === oldItem.nom ? { ...v, client: nomTrimmed } : v) };
      }
      setDB(updated); saveDB(updated);
      logActivity("update", "Client", `${nomTrimmed} (${type})`);
      toast.success("Client modifié");
    } else {
      const item: Client = { id: uid(), nom: nomTrimmed, type, zone, tel, prix: Number(prix) || 650, plafondCredit: plafondCredit.trim() ? Number(plafondCredit) : undefined, bonusExceptionnel, lat: lat ?? undefined, lng: lng ?? undefined };
      const updated = { ...DB, clients: [...DB.clients, item] };
      setDB(updated); saveDB(updated);
      logActivity("create", "Client", `${nomTrimmed} (${type})`);
      toast.success("Client ajouté");
    }
    setOpen(false);
    setSaving(false);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) { toast.error("Fichier vide ou invalide"); return; }

        // Détecter le séparateur (virgule ou point-virgule)
        const header = lines[0];
        const sep = header.includes(";") ? ";" : ",";
        const cols = header.replace(/^﻿/, "").split(sep).map((c) => c.trim().toLowerCase());

        // Mapper les colonnes
        const iNom = cols.findIndex((c) => c.includes("nom"));
        const iType = cols.findIndex((c) => c.includes("type"));
        const iZone = cols.findIndex((c) => c.includes("zone"));
        const iTel = cols.findIndex((c) => c.includes("tel") || c.includes("téléphone") || c.includes("telephone"));
        const iPrix = cols.findIndex((c) => c.includes("prix"));

        if (iNom === -1) { toast.error("Colonne 'Nom' introuvable dans le CSV"); return; }

        const newClients: typeof DB.clients = [];
        let doublons = 0;

        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map((v) => v.trim());
          const clientNom = vals[iNom]?.trim();
          if (!clientNom) continue;

          const clientTel = iTel !== -1 ? vals[iTel]?.replace(/[^0-9]/g, "") || "" : "";
          const clientType = iType !== -1 ? vals[iType]?.trim() || "Boutique" : "Boutique";
          const clientZone = iZone !== -1 ? vals[iZone]?.trim() || "" : "";
          const clientPrix = iPrix !== -1 ? Number(vals[iPrix]) || 650 : 650;

          // Vérifier doublon par nom uniquement (voir note dans handleSave)
          const nomNorm = clientNom.toLowerCase();
          const existsInDB = DB.clients.some((c) => c.nom.trim().toLowerCase() === nomNorm);
          const existsInNew = newClients.some((c) => c.nom.trim().toLowerCase() === nomNorm);

          if (existsInDB || existsInNew) {
            doublons++;
            continue;
          }

          newClients.push({
            id: uid(),
            nom: clientNom,
            type: clientType,
            zone: clientZone,
            tel: clientTel,
            prix: clientPrix,
          });
        }

        if (newClients.length === 0) {
          toast.error(`Aucun nouveau client à importer (${doublons} doublon(s) ignoré(s))`);
          return;
        }

        const updated = { ...DB, clients: [...DB.clients, ...newClients] };
        setDB(updated); saveDB(updated);
        logActivity("create", "Client", `Import CSV: ${newClients.length} clients`);
        toast.success(`${newClients.length} client(s) importé(s)${doublons > 0 ? ` (${doublons} doublon(s) ignoré(s))` : ""}`);
      } catch (err) {
        toast.error("Erreur lors de la lecture du fichier CSV");
        console.error(err);
      }
    };
    reader.readAsText(file, "UTF-8");
    // Reset input pour permettre de réimporter le même fichier
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = (id: string) => {
    const item = DB.clients.find((c) => c.id === id);
    if (!item) return;
    const updated = { ...DB, clients: DB.clients.filter((c) => c.id !== id), corbeille: [...DB.corbeille, { id: uid(), originalType: "clients", moduleName: "Client", desc: item.nom, deletedAt: new Date().toISOString(), deletedBy: currentUser?.nom || "", data: item }] };
    setDB(updated); saveDB(updated);
    logActivity("delete", "Client", item.nom); toast.success("Mis à la corbeille");
  };

  const ficheClient = ficheClientId ? enrichedClients.find((c) => c.id === ficheClientId) : null;
  const ficheVentes = useMemo(() => {
    if (!ficheClient) return [];
    return DB.ventes.filter((v) => v.client === ficheClient.nom).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 20);
  }, [DB.ventes, ficheClient]);

  const SortHeader = ({ label, k, align }: { label: string; k: SortKey; align?: "right" }) => (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button className={`inline-flex items-center gap-1 hover:text-[#1B4B6B] ${align === "right" ? "flex-row-reverse" : ""}`} onClick={() => toggleSort(k)}>
        {label} <ArrowUpDown className="w-3 h-3 opacity-50" />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-gray-900">Clients</h2><p className="text-sm text-gray-500">{DB.clients.length} client(s)</p></div>
        <div className="flex gap-2">
          {canImportClients && (
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="border-[#1B4B6B] text-[#1B4B6B] hover:bg-blue-50"><Upload className="w-4 h-4 mr-2" /> Importer CSV</Button>
          )}
          <Button onClick={() => handleOpen()} className="bg-[#1B4B6B] hover:bg-[#0d4a85]"><Plus className="w-4 h-4 mr-2" /> Nouveau client</Button>
        </div>
        {canImportClients && (
          <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImportCSV} />
        )}
      </div>

      {/* KPI globaux */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="border-l-4 border-l-blue-500"><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs text-gray-500 font-medium">Clients enregistrés</p><p className="text-xl font-bold mt-1 text-blue-700">{DB.clients.length}</p></div><Users className="w-5 h-5 text-blue-500 opacity-60" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-green-500"><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs text-gray-500 font-medium">CA total (tous clients)</p><p className="text-xl font-bold mt-1 text-green-700">{fmt(caTotalTousClients)}</p></div><DollarSign className="w-5 h-5 text-green-500 opacity-60" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-red-500"><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs text-gray-500 font-medium">Clients avec solde dû</p><p className="text-xl font-bold mt-1 text-red-700">{clientsAvecSolde}</p></div><AlertTriangle className="w-5 h-5 text-red-500 opacity-60" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-teal-500"><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs text-gray-500 font-medium">Zones couvertes</p><p className="text-xl font-bold mt-1 text-teal-700">{zonesCouvertes}</p></div><MapPin className="w-5 h-5 text-teal-500 opacity-60" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-purple-500"><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-xs text-gray-500 font-medium">Clients localisés (GPS)</p><p className="text-xl font-bold mt-1 text-purple-700">{clientsLocalises}/{DB.clients.length}</p></div><LocateFixed className="w-5 h-5 text-purple-500 opacity-60" /></div></CardContent></Card>
      </div>

      {/* Top clients */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">Top 5 clients (par CA)</CardTitle></CardHeader>
        <CardContent>
          {topClients.length > 0 && topClients[0].ca > 0 ? (
            <div className="space-y-2">
              {topClients.filter((c) => c.ca > 0).map((c, i) => {
                const pct = caTotalTousClients > 0 ? Math.round((c.ca / caTotalTousClients) * 100) : 0;
                return (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="w-5 text-xs font-bold text-gray-400">#{i + 1}</span>
                    <span className="w-40 truncate font-medium text-sm">{c.nom}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#1B4B6B]" style={{ width: `${pct}%` }} /></div>
                    <span className="w-24 text-right text-sm font-bold">{fmt(c.ca)}</span>
                    <span className="w-10 text-right text-xs text-gray-400">{pct}%</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-gray-400 text-center py-4">Aucune vente enregistrée</p>}
        </CardContent>
      </Card>

      {/* Répartition par zone et par type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4 text-[#1B4B6B]" /> Ventes par zone</CardTitle></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow><TableHead>Zone</TableHead><TableHead className="text-right">Clients</TableHead><TableHead className="text-right">Packs</TableHead><TableHead className="text-right">CA</TableHead></TableRow></TableHeader><TableBody>
              {repartitionZone.length > 0 ? repartitionZone.map((z) => (
                <TableRow key={z.zone}><TableCell className={z.zone === ZONE_VIDE ? "italic text-gray-400" : "font-medium"}>{z.zone}</TableCell><TableCell className="text-right">{z.nbClients}</TableCell><TableCell className="text-right">{fmtNumber(z.packs)}</TableCell><TableCell className="text-right font-medium">{fmt(z.ca)}</TableCell></TableRow>
              )) : <TableRow><TableCell colSpan={4} className="text-center text-gray-400 py-6">Aucune donnée</TableCell></TableRow>}
            </TableBody></Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Ventes par type de client</CardTitle></CardHeader>
          <CardContent>
            <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead className="text-right">Clients</TableHead><TableHead className="text-right">Packs</TableHead><TableHead className="text-right">CA</TableHead></TableRow></TableHeader><TableBody>
              {repartitionType.length > 0 ? repartitionType.map((t) => (
                <TableRow key={t.type}><TableCell className={t.type === TYPE_VIDE ? "italic text-gray-400" : "font-medium"}>{t.type}</TableCell><TableCell className="text-right">{t.nbClients}</TableCell><TableCell className="text-right">{fmtNumber(t.packs)}</TableCell><TableCell className="text-right font-medium">{fmt(t.ca)}</TableCell></TableRow>
              )) : <TableRow><TableCell colSpan={4} className="text-center text-gray-400 py-6">Aucune donnée</TableCell></TableRow>}
            </TableBody></Table>
          </CardContent>
        </Card>
      </div>

      {/* Impression : n'affiche que le tableau client (zone .print-area), masque
          tout le reste de l'app (sidebar, cartes KPI, boutons...). */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-2 no-print">
        <div className="relative max-w-sm flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><Input placeholder="Rechercher par nom, zone, type..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <Button
          type="button"
          variant={sansAchatOnly ? "default" : "outline"}
          size="sm"
          className={sansAchatOnly ? "bg-[#1B4B6B] hover:bg-[#0d4a85]" : ""}
          onClick={() => setSansAchatOnly((v) => !v)}
        >
          <UserX className="w-3.5 h-3.5 mr-1.5" />
          {sansAchatOnly ? `Clients sans achat (${filteredClients.length})` : "Clients sans achat"}
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={handlePrintClients} title="Imprimer la liste affichée">
          <Printer className="w-3.5 h-3.5 mr-1.5" /> Imprimer
        </Button>
        <Button type="button" variant="outline" size="sm" className="text-green-700 border-green-300 hover:bg-green-50" onClick={handleShareWhatsapp} title="Envoyer la liste par WhatsApp">
          <MessageCircle className="w-3.5 h-3.5 mr-1.5" /> WhatsApp
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleShareAutre} title="Partager (SMS, Email, autre app...)">
          <Share2 className="w-3.5 h-3.5 mr-1.5" /> Partager
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleCopyListe} title="Copier la liste dans le presse-papiers">
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>

      <Card className="print-area"><CardContent className="p-0">
        <div className="hidden print:block p-4 pb-0">
          <h2 className="text-lg font-bold">{sansAchatOnly ? "Clients sans achat" : "Liste des clients"} — MA2F AquaSachet</h2>
          <p className="text-sm text-gray-500">{filteredClients.length} client(s) — imprimé le {new Date().toLocaleDateString("fr-FR")}</p>
        </div>
        <div className="overflow-x-auto"><Table><TableHeader><TableRow>
        <SortHeader label="Nom" k="nom" />
        <SortHeader label="Type" k="type" />
        <SortHeader label="Zone" k="zone" />
        <TableHead>Téléphone</TableHead>
        <SortHeader label="Achats" k="nbVentes" align="right" />
        <SortHeader label="Packs" k="packs" align="right" />
        <SortHeader label="CA total" k="ca" align="right" />
        <SortHeader label="Dernier achat" k="derniere" />
        <SortHeader label="Solde dû" k="solde" align="right" />
        <TableHead className="no-print">Actions</TableHead>
      </TableRow></TableHeader><TableBody>
        {filteredClients.length > 0 ? filteredClients.map((c) => (
          <TableRow key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setFicheClientId(c.id)}>
            <TableCell className="font-medium">{c.nom}</TableCell>
            <TableCell>{c.type || "-"}</TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5">
                {c.zone || "-"}
                {c.lat != null && c.lng != null && <LocateFixed className="w-3 h-3 text-purple-500" aria-label="Localisé" />}
              </div>
              {getArrondissement(c.zone) && (
                <div className="text-xs text-gray-400">Arr. {getArrondissement(c.zone)!.arrondissement}</div>
              )}
            </TableCell>
            <TableCell>{c.tel || "-"}</TableCell>
            <TableCell className="text-right">{c.nbVentes || "-"}</TableCell>
            <TableCell className="text-right">{c.packsAchetes ? fmtNumber(c.packsAchetes) : "-"}</TableCell>
            <TableCell className="text-right font-medium">{c.ca ? fmt(c.ca) : "-"}</TableCell>
            <TableCell className="text-sm text-gray-600">{c.derniere ? fmtDate(c.derniere) : "-"}</TableCell>
            <TableCell className={`text-right font-bold ${c.solde > 0 ? "text-red-600" : ""}`}>{fmt(c.solde)}</TableCell>
            <TableCell className="no-print" onClick={(e) => e.stopPropagation()}>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => setFicheClientId(c.id)} aria-label={`Voir la fiche de ${c.nom}`}><Eye className="w-3 h-3" /></Button>
                <Button variant="outline" size="sm" onClick={() => handleOpen(c.id)} aria-label={`Modifier ${c.nom}`}><Pencil className="w-3 h-3" /></Button>
                <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeleteId(c.id)} aria-label={`Supprimer ${c.nom}`}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </TableCell>
          </TableRow>
        )) : <TableRow><TableCell colSpan={10} className="text-center text-gray-400 py-8">Aucun client</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card>

      {/* Créer / modifier client */}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{editId ? "Modifier le client" : "Nouveau client"}</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
          <div><Label>Nom</Label><Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex: Boutique Ndiaye" /></div>
          <div><Label>Type</Label><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Boutique","Restaurant","Hôtel","Institution","Particulier"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
<div>
            <Label>Zone</Label>
            <Select value={zone} onValueChange={(z) => { setZone(z); handleGeocodeZone(z); }}><SelectTrigger><SelectValue placeholder="Sélectionner une commune ou un quartier" /></SelectTrigger><SelectContent>{NOMS_ZONES_DAKAR.map((z: string) => (<SelectItem key={z} value={z}>{z}</SelectItem>))}</SelectContent></Select>
            {getArrondissement(zone) && (
              <p className="text-xs text-gray-500 mt-1">Arr. {getArrondissement(zone)!.arrondissement} — dépt {getArrondissement(zone)!.departement}</p>
            )}
          </div>
          
          <div>
            <div className="flex items-center justify-between">
              <Label>Position géographique</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => handleGeocodeZone()} disabled={geocoding}>
                <LocateFixed className="w-3 h-3 mr-1" /> {geocoding ? "Recherche..." : "Localiser via la zone"}
              </Button>
            </div>
            <p className="text-xs text-gray-400 mt-1 mb-2">Cliquez sur la carte pour placer ou ajuster le point exact du client.</p>
            <MapView
              key={editId || "new"}
              className="rounded-lg border h-64"
              initialCenter={lat != null && lng != null ? { lat, lng } : CENTRE_DAKAR}
              initialZoom={lat != null && lng != null ? 15 : 12}
              onMapReady={handleMapReady}
            />
            {lat != null && lng != null && (
              <p className="text-xs text-gray-500 mt-1">📍 {lat.toFixed(5)}, {lng.toFixed(5)}</p>
            )}
          </div>
          <div><Label>Téléphone (9 chiffres)</Label><Input type="tel" inputMode="numeric" maxLength={9} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^0-9]/g, ''))} placeholder="771234567" />{tel && tel.length !== 9 && <p className="text-xs text-red-500 mt-1">{tel.length}/9 chiffres</p>}</div>
          <div><Label>Prix négocié (F/pack)</Label><Input type="number" value={prix} onChange={(e) => setPrix(e.target.value)} /></div>
          <div>
            <Label>Plafond de crédit (F, optionnel)</Label>
            <Input type="number" value={plafondCredit} onChange={(e) => setPlafondCredit(e.target.value)} placeholder="Ex: 100000 (laisser vide = pas de limite)" />
            <p className="text-xs text-gray-400 mt-1">Un avertissement s'affichera à la vente si l'ardoise totale de ce client dépasse ce montant.</p>
          </div>
          <div>
            <Label>Bonus exceptionnel (optionnel)</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={bonusSeuilClient} onChange={(e) => setBonusSeuilClient(e.target.value)} placeholder="Packs achetés (ex: 20)" />
              <Input type="number" value={bonusPacksClient} onChange={(e) => setBonusPacksClient(e.target.value)} placeholder="Packs offerts (ex: 3)" />
            </div>
            <p className="text-xs text-gray-400 mt-1">Remplace le bonus standard pour ce client. Ex: 20 et 3 = 3 packs offerts par tranche de 20 packs achetés. Laisser vide = bonus standard.</p>
          </div>
          <div className="flex gap-2 pt-2"><Button onClick={handleSave} className="flex-1 bg-[#1B4B6B] hover:bg-[#0d4a85]">{editId ? "Modifier" : "Enregistrer"}</Button><Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button></div>
        </div>
      </DialogContent></Dialog>

      {/* Confirmation suppression */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Supprimer ce client ?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-500">Le client sera déplacé dans la corbeille. Vous pourrez le restaurer ultérieurement si nécessaire.</p>
          <div className="flex gap-2 pt-2">
            <Button variant="destructive" className="flex-1" onClick={() => { handleDelete(deleteId!); setDeleteId(null); }}>Supprimer</Button>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Annuler</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fiche client */}
      <Dialog open={!!ficheClientId} onOpenChange={(o) => { if (!o) setFicheClientId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {ficheClient && (
            <>
              <DialogHeader>
                <DialogTitle>{ficheClient.nom}</DialogTitle>
                <p className="text-sm text-gray-500 flex items-center gap-1.5">
                  {ficheClient.type || "-"} · {ficheClient.zone || "Zone non renseignée"}
                  {getArrondissement(ficheClient.zone) && ` (Arr. ${getArrondissement(ficheClient.zone)!.arrondissement}, dépt ${getArrondissement(ficheClient.zone)!.departement})`}
                   · {ficheClient.tel || "Pas de téléphone"}
                  {ficheClient.lat != null && ficheClient.lng != null
                    ? <span className="inline-flex items-center gap-1 text-purple-600"><LocateFixed className="w-3 h-3" /> Localisé</span>
                    : <span className="text-gray-400">· Non localisé</span>}
                </p>
              </DialogHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2">
                <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">CA total</p><p className="text-lg font-bold">{fmt(ficheClient.ca)}</p></div>
                <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Packs achetés</p><p className="text-lg font-bold">{fmtNumber(ficheClient.packsAchetes)}</p></div>
                <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Nb. achats</p><p className="text-lg font-bold">{ficheClient.nbVentes}</p></div>
                <div className={`rounded-lg p-3 ${ficheClient.plafondCredit && ficheClient.solde > ficheClient.plafondCredit ? "bg-red-50" : ficheClient.solde > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
                  <p className="text-xs text-gray-500">Solde dû{ficheClient.plafondCredit ? ` / plafond` : ""}</p>
                  <p className={`text-lg font-bold ${ficheClient.plafondCredit && ficheClient.solde > ficheClient.plafondCredit ? "text-red-600" : ficheClient.solde > 0 ? "text-amber-600" : ""}`}>
                    {fmt(ficheClient.solde)}{ficheClient.plafondCredit ? ` / ${fmt(ficheClient.plafondCredit)}` : ""}
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-400 -mt-1">Dernier achat : {ficheClient.derniere ? fmtDate(ficheClient.derniere) : "Aucun achat enregistré"}</p>

              {ficheClient.lat != null && ficheClient.lng != null ? (
                <div className="pt-2">
                  <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-purple-600" /> Position</p>
                  <MapView
                    key={`fiche-${ficheClient.id}`}
                    className="rounded-lg border h-48"
                    initialCenter={{ lat: ficheClient.lat, lng: ficheClient.lng }}
                    initialZoom={15}
                    onMapReady={(map) => {
                      if (window.google?.maps?.marker?.AdvancedMarkerElement) {
                        new window.google.maps.marker.AdvancedMarkerElement({ map, position: { lat: ficheClient.lat!, lng: ficheClient.lng! } });
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="pt-2 bg-gray-50 border border-dashed rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">
                    Position non renseignée.{" "}
                    <button type="button" className="text-[#1B4B6B] underline" onClick={() => { setFicheClientId(null); handleOpen(ficheClient.id); }}>
                      Ajouter une position
                    </button>
                  </p>
                </div>
              )}

              <div className="pt-2">
                <p className="text-sm font-semibold text-gray-700 mb-2">Historique des achats (20 derniers)</p>
                <div className="overflow-x-auto max-h-64 overflow-y-auto border rounded-lg">
                  <Table><TableHeader><TableRow><TableHead>N° BL</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Packs</TableHead><TableHead className="text-right">Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader><TableBody>
                    {ficheVentes.length > 0 ? ficheVentes.map((v) => {
                      const reste = resteVente(v, DB);
                      return (<TableRow key={v.id}><TableCell className="font-mono text-sm">{v.numero}</TableCell><TableCell>{fmtDate(v.date)}</TableCell><TableCell className="text-right">{v.packs}</TableCell><TableCell className="text-right font-medium">{fmt(v.packs * v.prix)}</TableCell><TableCell><span className={`text-xs px-2 py-0.5 rounded-full ${reste <= 0 ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{reste <= 0 ? "Payé" : "Crédit"}</span></TableCell></TableRow>);
                    }) : <TableRow><TableCell colSpan={5} className="text-center text-gray-400 py-6">Aucun achat enregistré</TableCell></TableRow>}
                  </TableBody></Table>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => { setFicheClientId(null); handleOpen(ficheClient.id); }}><Pencil className="w-4 h-4 mr-2" /> Modifier ce client</Button>
                <Button variant="outline" onClick={() => setFicheClientId(null)}>Fermer</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
