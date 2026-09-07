import type { Commande } from "./types";
import { getZoneCoords, distanceKm, DEPOT_DEFAUT, type LatLng } from "./dakarGeo";

export interface CamionDispo {
  livreurId: string;
  nom: string;
  // undefined = pas de limite de capacité pour ce camion.
  capacitePacks?: number;
}

export interface ArretTournee {
  commande: Commande;
  // Position utilisée pour ce calcul (zone approximative ou point précis du
  // client, voir getZoneCoords/dakarGeo.ts) — conservée sur l'arrêt (pas
  // seulement en variable interne) pour que routing.ts puisse construire les
  // waypoints de l'API Directions sans tout recalculer.
  pos: LatLng;
  distanceDepuisPrecedent: number; // km
  distanceCumulee: number; // km
  etaMin: number; // minutes écoulées depuis l'heure de départ
  heureEta: string; // HH:mm
}

export interface TourneeCalculee {
  livreurId: string;
  nom: string;
  arrets: ArretTournee[];
  totalPacks: number;
  capacitePacks?: number;
  distanceTotaleKm: number;
  dureeTotaleMin: number;
  // true une fois que routing.ts a remplacé l'ordre/les distances/ETA
  // ci-dessous par un vrai calcul d'itinéraire routier (Google Directions) —
  // absent/false = estimation à vol d'oiseau (calcul de ce fichier, hors-ligne).
  itineraireReel?: boolean;
}

export interface ResultatDispatching {
  tournees: TourneeCalculee[];
  // Commandes non prises en compte : zone non reconnue (pas de position GPS
  // disponible) — à assigner manuellement plutôt que de deviner leur place.
  nonLocalisees: Commande[];
}

export interface DispatchOptions {
  depot?: LatLng;
  heureDepart?: string; // HH:mm, défaut "08:00"
  vitesseKmH?: number; // vitesse moyenne estimée (trafic Dakar inclus), défaut 22
  minutesParArret?: number; // temps de déchargement/remise par arrêt, défaut 8
}

// Exportée pour routing.ts (recalcule les ETA par arrêt à partir des durées
// réelles de l'API Directions, avec la même convention HH:mm).
export function addMinutes(heureDepart: string, minutes: number): string {
  const [h, m] = heureDepart.split(":").map((x) => Number(x) || 0);
  const total = (((h * 60 + m + Math.round(minutes)) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Calcule un dispatching des commandes fournies sur les camions disponibles.
//
// Approche (sans API de cartographie externe, entièrement hors-ligne) :
// 1. Balayage angulaire (heuristique "sweep", Gillett & Miller) : chaque
//    commande est positionnée par l'angle qu'elle forme avec le dépôt, puis
//    les commandes sont réparties dans cet ordre entre les camions en
//    respectant leur capacité. Ça produit naturellement des tournées
//    géographiquement compactes (un camion = un secteur de Dakar) plutôt que
//    des trajets qui se chevauchent aux quatre coins de la ville.
// 2. Plus-proche-voisin (glouton) à l'intérieur de chaque tournée pour
//    ordonner les arrêts et approcher un trajet court depuis le dépôt.
// 3. ETA estimée à vitesse moyenne constante + temps fixe par arrêt — une
//    approximation pour prioriser/planifier, pas une promesse d'heure exacte
//    (pas de données de trafic en temps réel).
//
// Les distances sont à vol d'oiseau (pas de vrai réseau routier) : une
// approximation délibérée et documentée (voir dakarGeo.ts) plutôt qu'une
// dépendance à une API cartographique payante.
export function calculerDispatching(
  commandes: Commande[],
  camions: CamionDispo[],
  options: DispatchOptions = {}
): ResultatDispatching {
  const depot = options.depot || DEPOT_DEFAUT;
  const heureDepart = options.heureDepart || "08:00";
  const vitesseKmH = options.vitesseKmH || 22;
  const minutesParArret = options.minutesParArret ?? 8;

  const nonLocalisees: Commande[] = [];
  const localisees: { commande: Commande; pos: LatLng; angle: number; dist: number }[] = [];

  for (const c of commandes) {
    const pos = getZoneCoords(c.zone);
    if (!pos) {
      nonLocalisees.push(c);
      continue;
    }
    const angle = Math.atan2(pos.lat - depot.lat, pos.lng - depot.lng);
    const dist = distanceKm(depot, pos);
    localisees.push({ commande: c, pos, angle, dist });
  }

  if (camions.length === 0) {
    return { tournees: [], nonLocalisees: [...nonLocalisees, ...localisees.map((l) => l.commande)] };
  }

  // Tri par angle (balayage), en repartant du point le plus proche du dépôt
  // pour que la répartition démarre logiquement du secteur le plus proche.
  localisees.sort((a, b) => a.angle - b.angle);
  const startIdx = localisees.length
    ? localisees.reduce((best, cur, i) => (cur.dist < localisees[best].dist ? i : best), 0)
    : 0;
  const balaye = [...localisees.slice(startIdx), ...localisees.slice(0, startIdx)];

  // Répartition gloutonne dans l'ordre du balayage : on remplit le camion
  // courant tant qu'il reste de la capacité déclarée, sinon on essaie le
  // suivant (cyclique) pour ne pas laisser un camion vide si un autre
  // déborde en premier.
  const buckets: (typeof localisees)[] = camions.map(() => []);
  let camionIdx = 0;
  for (const item of balaye) {
    let placed = false;
    for (let tentative = 0; tentative < camions.length; tentative++) {
      const idx = (camionIdx + tentative) % camions.length;
      const cap = camions[idx].capacitePacks;
      const chargeActuelle = buckets[idx].reduce((s, x) => s + (x.commande.packs || 0), 0);
      if (!cap || chargeActuelle + (item.commande.packs || 0) <= cap) {
        buckets[idx].push(item);
        camionIdx = idx;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Aucun camion n'a assez de capacité restante pour cet arrêt : on le
      // place quand même sur le moins chargé (le dépassement de capacité
      // reste visible côté UI via totalPacks > capacitePacks) plutôt que de
      // le perdre silencieusement du dispatching.
      let minIdx = 0;
      let minCharge = Infinity;
      buckets.forEach((b, i) => {
        const charge = b.reduce((s, x) => s + (x.commande.packs || 0), 0);
        if (charge < minCharge) {
          minCharge = charge;
          minIdx = i;
        }
      });
      buckets[minIdx].push(item);
    }
  }

  const tournees: TourneeCalculee[] = camions.map((camion, i) => {
    const restant = [...buckets[i]];
    const ordre: typeof restant = [];
    let position = depot;
    while (restant.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      restant.forEach((it, idx) => {
        const d = distanceKm(position, it.pos);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      });
      const [chosen] = restant.splice(bestIdx, 1);
      ordre.push(chosen);
      position = chosen.pos;
    }

    let cumule = 0;
    let cursor = depot;
    let minutesCumulees = 0;
    const arrets: ArretTournee[] = ordre.map((it) => {
      const d = distanceKm(cursor, it.pos);
      cumule += d;
      minutesCumulees += (d / vitesseKmH) * 60 + minutesParArret;
      cursor = it.pos;
      return {
        commande: it.commande,
        pos: it.pos,
        distanceDepuisPrecedent: Math.round(d * 10) / 10,
        distanceCumulee: Math.round(cumule * 10) / 10,
        etaMin: Math.round(minutesCumulees),
        heureEta: addMinutes(heureDepart, minutesCumulees),
      };
    });

    return {
      livreurId: camion.livreurId,
      nom: camion.nom,
      arrets,
      totalPacks: arrets.reduce((s, a) => s + (a.commande.packs || 0), 0),
      capacitePacks: camion.capacitePacks,
      distanceTotaleKm: Math.round(cumule * 10) / 10,
      dureeTotaleMin: Math.round(minutesCumulees),
    };
  });

  return { tournees, nonLocalisees };
}
