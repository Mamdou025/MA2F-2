import { loadMapScript } from "@/components/Map";
import { addMinutes, type TourneeCalculee } from "./dispatching";
import type { LatLng } from "./dakarGeo";

// Nombre max d'arrêts soumis à l'API Directions en une seule requête —
// limite pratique du service (25 lieux au total en comptant origine +
// destination), on se garde une marge plutôt que de tomber sur une erreur
// MAX_WAYPOINTS_EXCEEDED en plein calcul.
const MAX_ARRETS_ITINERAIRE_REEL = 23;

export interface RaffinageTournee {
  tournee: TourneeCalculee;
  // true si les distances/ETA de `tournee` viennent d'un vrai calcul
  // routier ; false si le repli sur l'estimation à vol d'oiseau (déjà
  // présente dans `tournee`, calculée par dispatching.ts) a été conservé.
  itineraireReel: boolean;
  // Raison du repli, à afficher à l'utilisateur (toast) — absent si
  // itineraireReel est true ou s'il n'y avait simplement rien à calculer
  // (tournée vide).
  avertissement?: string;
}

let directionsServicePromise: Promise<google.maps.DirectionsService> | null = null;

// Charge le script Google Maps (si besoin) puis instancie un
// DirectionsService partagé — un seul chargement/instanciation même si
// plusieurs tournées sont raffinées en parallèle (voir
// raffinerDispatchingAvecItineraireReel ci-dessous).
function getDirectionsService(): Promise<google.maps.DirectionsService> {
  if (!directionsServicePromise) {
    directionsServicePromise = loadMapScript().then(() => {
      if (!window.google?.maps?.DirectionsService) {
        throw new Error("DirectionsService indisponible (bibliothèque \"routes\" non chargée, ou Directions API non activée sur la clé)");
      }
      return new window.google.maps.DirectionsService();
    });
    // En cas d'échec, on ne garde pas la promesse rejetée en cache — un
    // prochain appel (ex: clé corrigée, reconnexion) doit pouvoir réessayer.
    directionsServicePromise.catch(() => {
      directionsServicePromise = null;
    });
  }
  return directionsServicePromise;
}

// Remplace l'ordre/les distances/les ETA "à vol d'oiseau" d'une tournée déjà
// calculée (voir calculerDispatching dans dispatching.ts) par un vrai calcul
// d'itinéraire routier via l'API Google Directions, avec optimisation de
// l'ordre des arrêts (optimizeWaypoints: true — un TSP approché, meilleur que
// le plus-proche-voisin hors-ligne utilisé en repli).
//
// Ne touche PAS à l'affectation camion ↔ commandes : celle-ci reste décidée
// par le balayage angulaire de calculerDispatching (pas besoin d'API pour
// répartir géographiquement les commandes par secteur). Cette fonction
// affine seulement l'ORDRE et les DISTANCES/ETA à l'intérieur d'une tournée
// déjà assignée à un camion.
//
// Repli automatique et documenté sur l'estimation à vol d'oiseau existante
// dès que l'API échoue ou n'est pas disponible (clé sans Directions API
// activée, quota dépassé, aucune route trouvée, trop d'arrêts, pas de
// réseau) — le dispatching reste utilisable même sans cette étape, juste
// moins précis sur les distances/heures.
export async function raffinerTourneeAvecItineraireReel(
  depot: LatLng,
  tournee: TourneeCalculee,
  heureDepart: string
): Promise<RaffinageTournee> {
  if (tournee.arrets.length === 0) return { tournee, itineraireReel: false };

  if (tournee.arrets.length > MAX_ARRETS_ITINERAIRE_REEL) {
    return {
      tournee,
      itineraireReel: false,
      avertissement: `${tournee.nom} : ${tournee.arrets.length} arrêts dépassent la limite de l'itinéraire réel (${MAX_ARRETS_ITINERAIRE_REEL}) — estimation à vol d'oiseau conservée pour ce camion.`,
    };
  }

  let service: google.maps.DirectionsService;
  try {
    service = await getDirectionsService();
  } catch (e) {
    return {
      tournee,
      itineraireReel: false,
      avertissement: `${tournee.nom} : itinéraire réel indisponible (${e instanceof Error ? e.message : "erreur inconnue"}) — estimation à vol d'oiseau conservée.`,
    };
  }

  const waypoints = tournee.arrets.map((a) => ({ location: a.pos, stopover: true }));

  try {
    const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
      service.route(
        {
          origin: depot,
          destination: depot, // boucle retour dépôt — le dernier leg (retour) est ignoré ci-dessous.
          waypoints,
          optimizeWaypoints: true,
          travelMode: window.google!.maps.TravelMode.DRIVING,
        },
        (res, status) => {
          if (status === "OK" && res) resolve(res);
          else reject(new Error(`Directions API : ${status}`));
        }
      );
    });

    const route = result.routes[0];
    if (!route || !route.legs || route.legs.length === 0) throw new Error("Aucun itinéraire retourné");

    // route.waypoint_order donne l'ordre optimisé des arrêts, en indices dans
    // le tableau `waypoints` ci-dessus (donc dans tournee.arrets). Les legs
    // suivent ce même ordre optimisé : leg[0] = dépôt → 1er arrêt visité,
    // leg[i] = arrêt (i-1) → arrêt i. Comme destination=dépôt, il y a un leg
    // de plus (retour au dépôt) qu'on n'utilise PAS ici : on ne veut que le
    // temps/distance jusqu'à CHAQUE livraison, pas le trajet retour — même
    // convention que le calcul à vol d'oiseau qu'on remplace (distanceTotaleKm/
    // dureeTotaleMin s'arrêtent au dernier arrêt, pas au retour dépôt).
    const ordre: number[] =
      route.waypoint_order && route.waypoint_order.length === tournee.arrets.length
        ? route.waypoint_order
        : tournee.arrets.map((_, i) => i);

    let cumuleKm = 0;
    let cumuleMin = 0;
    const arrets = ordre.map((origIdx, i) => {
      const leg = route.legs[i];
      const distKm = (leg?.distance?.value ?? 0) / 1000;
      const dureeMin = (leg?.duration?.value ?? 0) / 60;
      cumuleKm += distKm;
      cumuleMin += dureeMin;
      const arretOriginal = tournee.arrets[origIdx];
      return {
        ...arretOriginal,
        distanceDepuisPrecedent: Math.round(distKm * 10) / 10,
        distanceCumulee: Math.round(cumuleKm * 10) / 10,
        etaMin: Math.round(cumuleMin),
        heureEta: addMinutes(heureDepart, cumuleMin),
      };
    });

    return {
      tournee: {
        ...tournee,
        arrets,
        distanceTotaleKm: Math.round(cumuleKm * 10) / 10,
        dureeTotaleMin: Math.round(cumuleMin),
        itineraireReel: true,
      },
      itineraireReel: true,
    };
  } catch (e) {
    return {
      tournee,
      itineraireReel: false,
      avertissement: `${tournee.nom} : itinéraire réel indisponible (${e instanceof Error ? e.message : "erreur inconnue"}) — estimation à vol d'oiseau conservée.`,
    };
  }
}

// Raffine toutes les tournées d'un dispatching, en parallèle — une requête
// Directions par camion, ce qui reste un nombre raisonnable d'appels pour le
// parc d'une PME (quelques camions, pas des centaines). Renvoie les tournées
// mises à jour (mélange de tournées "réelles" et de replis à vol d'oiseau
// selon ce qui a marché) + la liste des avertissements de repli à afficher.
export async function raffinerDispatchingAvecItineraireReel(
  depot: LatLng,
  tournees: TourneeCalculee[],
  heureDepart: string
): Promise<{ tournees: TourneeCalculee[]; avertissements: string[] }> {
  const resultats = await Promise.all(tournees.map((t) => raffinerTourneeAvecItineraireReel(depot, t, heureDepart)));
  return {
    tournees: resultats.map((r) => r.tournee),
    avertissements: resultats.filter((r) => r.avertissement).map((r) => r.avertissement!),
  };
}
