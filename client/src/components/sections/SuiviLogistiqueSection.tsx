import { useState, useMemo, useRef, useEffect } from "react";
import { useApp } from "@/contexts/AppContext";
import { todayLocal, fmtDate, calculerRetardLivraisonMinutes } from "@/lib/helpers";
import { getZoneCoords, type LatLng } from "@/lib/dakarGeo";
import { MapView } from "@/components/Map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gauge, Clock, AlertTriangle, MapPin, Truck, Satellite } from "lucide-react";
import type { Commande, PositionVehicule } from "@/lib/types";
import { db, onSnapshot, collection } from "@/lib/firebase";

// Palette cyclique pour distinguer les livreurs sur la carte/légende — mêmes
// couleurs quel que soit le nombre de livreurs actifs (répète au-delà de 8).
const PALETTE_LIVREURS = ["#1B4B6B", "#0d9488", "#c2410c", "#7c3aed", "#db2777", "#65a30d", "#0891b2", "#b45309"];

// Centre par défaut de la carte : Dakar, Sénégal (même valeur que ClientsSection).
const CENTRE_DAKAR = { lat: 14.7167, lng: -17.4677 };

// Au-delà de ce délai sans nouvelle position reçue (minutes), un camion est
// affiché comme "signal perdu" (grisé) plutôt que masqué — un boîtier qui ne
// remonte plus rien depuis longtemps est une information utile en soi (panne,
// coupure secteur, camion débranché), pas une absence à cacher silencieusement.
const POSITION_PERIMEE_APRES_MIN = 30;

function ajouterJours(dateStr: string, jours: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

export default function SuiviLogistiqueSection() {
  const { DB } = useApp();
  const commandes: Commande[] = (DB as { commandes?: Commande[] }).commandes || [];

  // ─── Suivi GPS temps réel des camions (boîtier physique) ────────────────
  // Écoute directe de positionsVehicules plutôt que de passer par AppContext
  // (déjà volumineux) — même choix que RecouvrementSection.tsx pour
  // mobileMoneyIntents, un autre cas de collection écrite uniquement côté
  // serveur (ici : recevoirPositionVehicule dans cloud-functions/src/index.ts,
  // voir CLAUDE.md "Suivi GPS temps réel des camions"). Un document par
  // véhicule, écrasé à chaque nouvelle position — pas un historique.
  const [positionsVehicules, setPositionsVehicules] = useState<Record<string, PositionVehicule & { _receivedAt?: { seconds: number } }>>({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "positionsVehicules"), (snap) => {
      const next: Record<string, PositionVehicule & { _receivedAt?: { seconds: number } }> = {};
      snap.docs.forEach((d) => { next[d.id] = { id: d.id, ...d.data() } as PositionVehicule & { _receivedAt?: { seconds: number } }; });
      setPositionsVehicules(next);
    });
    return () => unsub();
  }, []);

  // Période d'analyse pour les KPI/tableaux (par défaut les 7 derniers jours,
  // bornes incluses) — indépendante de la carte du jour ci-dessous, qui reste
  // volontairement figée sur aujourd'hui (une carte n'a de sens que pour une
  // tournée en cours, pas agrégée sur plusieurs jours).
  const [dateDebut, setDateDebut] = useState(ajouterJours(todayLocal(), -6));
  const [dateFin, setDateFin] = useState(todayLocal());

  const commandesPeriode = useMemo(
    () => commandes.filter((c) => c.date >= dateDebut && c.date <= dateFin),
    [commandes, dateDebut, dateFin]
  );

  const commandesLivreesPeriode = useMemo(
    () => commandesPeriode.filter((c) => c.statut === "livree" && c.livreeLe),
    [commandesPeriode]
  );

  // ─── KPI 1 : délai moyen saisie → livraison ────────────────────────────
  // heureAppel est désormais l'heure de saisie de la commande, verrouillée
  // et fixée automatiquement à la création (voir le commentaire sur
  // Commande.heureAppel dans types.ts, correctif 2026-08-22) — ce KPI mesure
  // donc le délai entre l'enregistrement de la commande et sa livraison,
  // et n'est plus faussé par une heure d'appel saisie manuellement (parfois
  // incohérente/future avant ce correctif).
  const delaiMoyenMin = useMemo(() => {
    const delais = commandesLivreesPeriode
      .filter((c) => c.heureAppel)
      .map((c) => {
        const appelMs = new Date(`${c.date}T${c.heureAppel}:00`).getTime();
        const livreeMs = new Date(c.livreeLe!).getTime();
        if (Number.isNaN(appelMs) || Number.isNaN(livreeMs)) return null;
        return (livreeMs - appelMs) / 60000;
      })
      .filter((v): v is number => v !== null && v >= 0);
    if (delais.length === 0) return null;
    return Math.round(delais.reduce((s, v) => s + v, 0) / delais.length);
  }, [commandesLivreesPeriode]);

  // ─── KPI 2 : taux de retard (parmi les commandes où le retard est calculable) ──
  const statsRetard = useMemo(() => {
    const evaluables = commandesLivreesPeriode
      .map((c) => ({ c, retard: calculerRetardLivraisonMinutes(c) }))
      .filter((x): x is { c: Commande; retard: number } => x.retard !== null);
    const enRetard = evaluables.filter((x) => x.retard > 5).length;
    return {
      total: evaluables.length,
      enRetard,
      taux: evaluables.length > 0 ? Math.round((enRetard / evaluables.length) * 100) : null,
    };
  }, [commandesLivreesPeriode]);

  // ─── KPI 3 : livraisons par livreur sur la période ─────────────────────
  const parLivreur = useMemo(() => {
    const jours = new Set(commandesLivreesPeriode.map((c) => c.date)).size || 1;
    const groupes = new Map<string, Commande[]>();
    commandesLivreesPeriode.forEach((c) => {
      const key = c.livreurId || "__non_assigne__";
      if (!groupes.has(key)) groupes.set(key, []);
      groupes.get(key)!.push(c);
    });
    return Array.from(groupes.entries())
      .map(([livreurId, liste]) => {
        const retardsCalculables = liste.map((c) => calculerRetardLivraisonMinutes(c)).filter((v): v is number => v !== null);
        const enRetard = retardsCalculables.filter((v) => v > 5).length;
        return {
          livreurId,
          nom: livreurId === "__non_assigne__" ? "Non assigné" : DB.livreurs.find((l) => l.id === livreurId)?.nom || "Livreur inconnu",
          nbLivraisons: liste.length,
          totalPacks: liste.reduce((s, c) => s + (c.packs || 0), 0),
          moyenneParJour: Math.round((liste.length / jours) * 10) / 10,
          tauxRetard: retardsCalculables.length > 0 ? Math.round((enRetard / retardsCalculables.length) * 100) : null,
        };
      })
      .sort((a, b) => b.nbLivraisons - a.nbLivraisons);
  }, [commandesLivreesPeriode, DB.livreurs]);

  // ─── KPI 4 : charge par zone sur la période (toutes commandes, pas
  // seulement livrées — reflète la demande, pas juste ce qui a été traité) ──
  const parZone = useMemo(() => {
    const groupes = new Map<string, Commande[]>();
    commandesPeriode.forEach((c) => {
      const key = c.zone?.trim() || "Zone non renseignée";
      if (!groupes.has(key)) groupes.set(key, []);
      groupes.get(key)!.push(c);
    });
    return Array.from(groupes.entries())
      .map(([zone, liste]) => ({
        zone,
        nbCommandes: liste.length,
        totalPacks: liste.reduce((s, c) => s + (c.packs || 0), 0),
      }))
      .sort((a, b) => b.nbCommandes - a.nbCommandes)
      .slice(0, 12);
  }, [commandesPeriode]);

  // ─── Carte d'une journée ────────────────────────────────────────────────
  // Volontairement figée sur UNE SEULE date à la fois (pas la période
  // ci-dessus) : une carte n'a de sens que pour visualiser une tournée
  // donnée, pas un agrégat de plusieurs jours qui se superposeraient sans
  // qu'on puisse les distinguer. Par défaut aujourd'hui, mais modifiable —
  // sinon la carte semble "ne rien afficher" tôt le matin (avant que les
  // commandes du jour soient saisies) ou un jour sans activité, alors qu'il
  // suffit de choisir une date qui a des commandes. Coordonnées approximatives
  // par quartier (dakarGeo.ts) — pas une géolocalisation précise à l'adresse,
  // et pas de tuiles cartographiques externes (aucune dépendance/API payante).
  const [carteDate, setCarteDate] = useState(todayLocal());
  const commandesJour = useMemo(
    () => commandes.filter((c) => (c.dateLivraisonPrevue || c.date) === carteDate && c.statut !== "annulee"),
    [commandes, carteDate]
  );
  const livreursDuJour = useMemo(() => {
    const ids = Array.from(new Set(commandesJour.map((c) => c.livreurId).filter((x): x is string => !!x)));
    return ids.map((id, i) => ({ id, nom: DB.livreurs.find((l) => l.id === id)?.nom || "Livreur inconnu", couleur: PALETTE_LIVREURS[i % PALETTE_LIVREURS.length] }));
  }, [commandesJour, DB.livreurs]);
  const couleurLivreur = (livreurId?: string) => livreursDuJour.find((l) => l.id === livreurId)?.couleur || "#9ca3af";

  // Position de chaque commande du jour : priorité à la position précise du
  // client (géocodée/placée à la main dans la fiche Client, voir ClientsSection),
  // sinon repli sur la position approximative du quartier (dakarGeo.ts).
  const pointsCarte = useMemo(() => {
    return commandesJour
      .map((c) => {
        const client = c.clientId ? DB.clients.find((cl) => cl.id === c.clientId) : undefined;
        const pos: LatLng | null =
          client?.lat != null && client?.lng != null ? { lat: client.lat, lng: client.lng } : getZoneCoords(c.zone);
        if (!pos) return null;
        return { commande: c, pos };
      })
      .filter((p): p is { commande: Commande; pos: LatLng } => p !== null);
  }, [commandesJour, DB.clients]);
  const commandesNonLocalisees = useMemo(
    () => commandesJour.filter((c) => {
      const client = c.clientId ? DB.clients.find((cl) => cl.id === c.clientId) : undefined;
      return !(client?.lat != null && client?.lng != null) && !getZoneCoords(c.zone);
    }),
    [commandesJour, DB.clients]
  );

  // Camions à afficher en direct sur la carte (boîtier GPS physique — voir
  // "Suivi GPS temps réel des camions" dans CLAUDE.md). Uniquement quand la
  // carte affiche AUJOURD'HUI : la position d'un camion en ce moment n'a pas
  // de sens à côté des commandes d'un autre jour (passé ou futur). Couleur
  // alignée sur celle du livreur qui conduit ce camion (Livreur.vehiculeId),
  // via la même palette que les commandes — un livreur reste identifiable
  // par la même couleur qu'il conduise ou que sa commande soit affichée.
  const camionsLocalises = useMemo(() => {
    if (carteDate !== todayLocal()) return [];
    return DB.vehicules
      .map((v) => {
        const position = positionsVehicules[v.id];
        if (!position) return null;
        const receivedAtSec = position._receivedAt?.seconds;
        const minutesDepuis = receivedAtSec != null ? Math.round((Date.now() / 1000 - receivedAtSec) / 60) : null;
        const perime = minutesDepuis !== null && minutesDepuis > POSITION_PERIMEE_APRES_MIN;
        const livreurNom = DB.livreurs.find((l) => l.vehiculeId === v.id)?.nom || null;
        const livreurId = DB.livreurs.find((l) => l.vehiculeId === v.id)?.id;
        return {
          vehiculeId: v.id,
          nom: v.nom,
          livreurNom,
          pos: { lat: position.lat, lng: position.lng } as LatLng,
          couleur: couleurLivreur(livreurId),
          vitesseKmH: position.vitesseKmH ?? null,
          minutesDepuis,
          perime,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }, [DB.vehicules, DB.livreurs, positionsVehicules, carteDate, couleurLivreur]);

  // ─── Marqueurs Google Maps (vraie carte, mêmes clés que ClientsSection) ───
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<any[]>([]);
  const truckMarkersRef = useRef<any[]>([]);

  const renderMarkers = () => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps?.marker?.AdvancedMarkerElement) return;
    markersRef.current.forEach((m) => { m.map = null; });
    markersRef.current = [];
    pointsCarte.forEach(({ commande: c, pos }) => {
      const livreurNom = c.livreurId ? DB.livreurs.find((l) => l.id === c.livreurId)?.nom || "Livreur inconnu" : "Non assigné";
      const el = document.createElement("div");
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.borderRadius = "50%";
      el.style.backgroundColor = couleurLivreur(c.livreurId);
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 0 3px rgba(0,0,0,0.5)";
      el.title = `${c.numero} — ${c.client}\n${c.zone}\n${c.packs} pack(s)\nLivreur : ${livreurNom}\nStatut : ${c.statut}`;
      const marker = new window.google!.maps.marker.AdvancedMarkerElement({ map, position: pos, content: el });
      markersRef.current.push(marker);
    });
  };

  // Marqueurs distincts pour les camions localisés en direct (GPS physique) —
  // plus gros que les points de commande, avec une icône 🚛, pour ne pas les
  // confondre avec les arrêts de tournée sur la même carte.
  const renderTruckMarkers = () => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps?.marker?.AdvancedMarkerElement) return;
    truckMarkersRef.current.forEach((m) => { m.map = null; });
    truckMarkersRef.current = [];
    camionsLocalises.forEach((c) => {
      const el = document.createElement("div");
      el.style.width = "28px";
      el.style.height = "28px";
      el.style.borderRadius = "50%";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.fontSize = "14px";
      el.style.backgroundColor = c.perime ? "#9ca3af" : c.couleur;
      el.style.opacity = c.perime ? "0.6" : "1";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 0 4px rgba(0,0,0,0.6)";
      el.textContent = "🚛";
      const fraicheur = c.minutesDepuis === null ? "heure inconnue" : c.minutesDepuis < 1 ? "à l'instant" : c.minutesDepuis < 60 ? `il y a ${c.minutesDepuis} min` : `il y a ${Math.round(c.minutesDepuis / 60)} h`;
      el.title = `${c.nom}${c.livreurNom ? ` — ${c.livreurNom}` : ""}\nPosition ${fraicheur}${c.vitesseKmH != null ? `\n${Math.round(c.vitesseKmH)} km/h` : ""}${c.perime ? "\n⚠️ Signal GPS non renouvelé depuis plus de " + POSITION_PERIMEE_APRES_MIN + " min" : ""}`;
      const marker = new window.google!.maps.marker.AdvancedMarkerElement({ map, position: c.pos, content: el, zIndex: 999 });
      truckMarkersRef.current.push(marker);
    });
  };

  const handleMapReady = (map: google.maps.Map) => {
    mapInstanceRef.current = map;
    renderMarkers();
    renderTruckMarkers();
  };

  // Redessine les marqueurs quand les commandes du jour (ou leur position) changent.
  useEffect(() => {
    renderMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsCarte]);

  // Redessine les camions quand une nouvelle position GPS arrive (ou que la
  // date affichée change — voir camionsLocalises, vide si carteDate n'est
  // pas aujourd'hui).
  useEffect(() => {
    renderTruckMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camionsLocalises]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Gauge className="w-6 h-6 text-[#1B4B6B]" /> Suivi logistique
        </h2>
        <p className="text-sm text-gray-500">Contrôle du trajet, des délais de livraison et de la charge par livreur/zone.</p>
      </div>

      {/* ─── Carte d'une journée ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#1B4B6B]" /> Carte des tournées — {fmtDate(carteDate)}
            {camionsLocalises.length > 0 && (
              <span className="text-[10px] font-normal bg-green-100 text-green-700 rounded-full px-2 py-0.5 flex items-center gap-1">
                <Satellite className="w-3 h-3" /> {camionsLocalises.length} camion(s) en direct
              </span>
            )}
          </CardTitle>
          <Input type="date" value={carteDate} onChange={(e) => setCarteDate(e.target.value)} className="w-40 h-8" />
        </CardHeader>
        <CardContent>
          {commandesJour.length > 0 || camionsLocalises.length > 0 ? (
            <div className="space-y-3">
              {/* Vraie carte Google Maps (rues, quartiers) — mêmes clés/proxy que
                  la carte de la fiche Client. Les marqueurs se redessinent à
                  chaque changement de date/commandes via renderMarkers(), et les
                  camions en direct via renderTruckMarkers() (positionsVehicules). */}
              <div className="overflow-hidden border rounded-lg">
                <MapView initialCenter={CENTRE_DAKAR} initialZoom={12} onMapReady={handleMapReady} className="h-[420px]" />
              </div>
              {(pointsCarte.length > 0 || camionsLocalises.length > 0) && (
                <div className="flex flex-wrap gap-3 text-xs">
                  {livreursDuJour.map((l) => (
                    <span key={l.id} className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: l.couleur }} />
                      {l.nom}
                    </span>
                  ))}
                  {commandesJour.some((c) => !c.livreurId) && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full inline-block bg-gray-400" />
                      Non assigné
                    </span>
                  )}
                  {camionsLocalises.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-gray-500">🚛 = position GPS en direct (camion)</span>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400">Points de commande : positions approximatives par quartier (pas l'adresse exacte) — taille proportionnelle au nombre de packs. Camions 🚛 : position GPS réelle du boîtier installé (grisé = signal non renouvelé depuis plus de {POSITION_PERIMEE_APRES_MIN} min). Survolez un point/camion pour le détail.</p>
              {commandesNonLocalisees.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-2">
                  {commandesNonLocalisees.length} commande(s) non affichée(s) sur la carte (zone non reconnue) : {commandesNonLocalisees.map((c) => `${c.numero} (${c.zone || "zone vide"})`).join(", ")}
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">Aucune commande active prévue aujourd'hui{carteDate === todayLocal() ? " et aucun camion localisé en direct" : ""}.</p>
          )}
        </CardContent>
      </Card>

      {/* ─── Période d'analyse ─── */}
      <div className="flex flex-wrap items-end gap-3">
        <div><Label>Du</Label><Input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className="w-40" /></div>
        <div><Label>Au</Label><Input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="w-40" /></div>
      </div>

      {/* ─── KPI ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Délai moyen saisie → livraison</p>
            <p className="text-2xl font-bold text-blue-700">{delaiMoyenMin !== null ? `${Math.floor(delaiMoyenMin / 60)}h${String(delaiMoyenMin % 60).padStart(2, "0")}` : "—"}</p>
            {delaiMoyenMin === null && <p className="text-xs text-gray-400 mt-1">Pas de commande livrée avec heure de saisie sur la période.</p>}
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Taux de retard</p>
            <p className="text-2xl font-bold text-red-700">{statsRetard.taux !== null ? `${statsRetard.taux}%` : "—"}</p>
            <p className="text-xs text-gray-400 mt-1">{statsRetard.enRetard}/{statsRetard.total} livraison(s) évaluable(s) (heure prévue renseignée)</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-teal-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Livraisons sur la période</p>
            <p className="text-2xl font-bold text-teal-700">{commandesLivreesPeriode.length}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-400">
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Commandes reçues</p>
            <p className="text-2xl font-bold text-purple-700">{commandesPeriode.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Livraisons par livreur ─── */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4 text-[#1B4B6B]" /> Livraisons par livreur — {fmtDate(dateDebut)} au {fmtDate(dateFin)}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Livreur</TableHead>
                  <TableHead className="text-right">Livraisons</TableHead>
                  <TableHead className="text-right">Packs livrés</TableHead>
                  <TableHead className="text-right">Moy./jour actif</TableHead>
                  <TableHead className="text-right">Taux de retard</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parLivreur.length > 0 ? parLivreur.map((l) => (
                  <TableRow key={l.livreurId}>
                    <TableCell className={l.livreurId === "__non_assigne__" ? "text-amber-700 font-medium" : "font-medium"}>{l.nom}</TableCell>
                    <TableCell className="text-right">{l.nbLivraisons}</TableCell>
                    <TableCell className="text-right">{l.totalPacks}</TableCell>
                    <TableCell className="text-right">{l.moyenneParJour}</TableCell>
                    <TableCell className="text-right">{l.tauxRetard !== null ? `${l.tauxRetard}%` : "—"}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={5} className="text-center text-gray-400 py-8">Aucune livraison sur cette période</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Charge par zone ─── */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4 text-[#1B4B6B]" /> Charge par zone — {fmtDate(dateDebut)} au {fmtDate(dateFin)} (top 12)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zone</TableHead>
                  <TableHead className="text-right">Commandes</TableHead>
                  <TableHead className="text-right">Packs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parZone.length > 0 ? parZone.map((z) => (
                  <TableRow key={z.zone}>
                    <TableCell className="font-medium">{z.zone}</TableCell>
                    <TableCell className="text-right">{z.nbCommandes}</TableCell>
                    <TableCell className="text-right">{z.totalPacks}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={3} className="text-center text-gray-400 py-8">Aucune commande sur cette période</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
