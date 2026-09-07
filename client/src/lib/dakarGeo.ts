import { normalizeZoneKey, ALIAS_QUARTIERS_DAKAR } from "./communesDakar";

export interface LatLng {
  lat: number;
  lng: number;
}

// Coordonnées GPS approximatives (centre du quartier) des 53 communes de la
// région de Dakar, utilisées pour le dispatching automatique des commandes
// (voir dispatching.ts). Approximation volontaire, à l'échelle du quartier :
// suffisante pour ordonner/regrouper des tournées de livraison (distances et
// angles relatifs entre zones), mais ce n'est PAS une géolocalisation précise
// à l'adresse — ne pas s'en servir pour de la navigation fine. À ajuster ici
// si une zone s'avère mal placée en pratique (retours terrain des livreurs).
const COMMUNE_COORDS_RAW: Record<string, LatLng> = {
  // Dakar-Plateau
  "Plateau": { lat: 14.6937, lng: -17.4441 },
  "Médina": { lat: 14.6825, lng: -17.4467 },
  "Fann-Point E-Amitié": { lat: 14.6890, lng: -17.4650 },
  "Gueule Tapée-Fass-Colobane": { lat: 14.6900, lng: -17.4520 },
  "Gorée": { lat: 14.6674, lng: -17.3986 },
  // Grand-Dakar
  "Grand Dakar": { lat: 14.7050, lng: -17.4520 },
  "Biscuiterie": { lat: 14.7080, lng: -17.4480 },
  "Dieuppeul-Derklé": { lat: 14.7130, lng: -17.4550 },
  "HLM": { lat: 14.7060, lng: -17.4470 },
  "Hann Bel-Air": { lat: 14.7150, lng: -17.4300 },
  "Sicap-Liberté": { lat: 14.7150, lng: -17.4600 },
  // Almadies
  "Ngor": { lat: 14.7500, lng: -17.5150 },
  "Ouakam": { lat: 14.7250, lng: -17.4900 },
  "Yoff": { lat: 14.7450, lng: -17.4700 },
  "Mermoz-Sacré-Cœur": { lat: 14.7100, lng: -17.4750 },
  // Parcelles Assainies
  "Grand Yoff": { lat: 14.7280, lng: -17.4450 },
  "Patte d'Oie": { lat: 14.7250, lng: -17.4350 },
  "Parcelles Assainies": { lat: 14.7600, lng: -17.4200 },
  "Camberène": { lat: 14.7550, lng: -17.4350 },
  // Pikine Dagoudane
  "Pikine Ouest": { lat: 14.7550, lng: -17.4000 },
  "Pikine Est": { lat: 14.7600, lng: -17.3900 },
  "Pikine Sud": { lat: 14.7500, lng: -17.3950 },
  "Dalifort": { lat: 14.7350, lng: -17.4100 },
  "Djidah Thiaroye Kaw": { lat: 14.7650, lng: -17.3800 },
  "Guinaw Rail Nord": { lat: 14.7500, lng: -17.4050 },
  "Guinaw Rail Sud": { lat: 14.7450, lng: -17.4050 },
  // Thiaroye
  "Thiaroye-sur-Mer": { lat: 14.7550, lng: -17.3650 },
  "Diack Sao": { lat: 14.7600, lng: -17.3600 },
  "Diamaguène Sicap Mbao": { lat: 14.7500, lng: -17.3550 },
  "Thiaroye-Gare": { lat: 14.7600, lng: -17.3700 },
  "Mbao": { lat: 14.7350, lng: -17.3450 },
  // Guédiawaye — Sam Notaire
  "Golf Sud": { lat: 14.7700, lng: -17.4100 },
  "Sam Notaire": { lat: 14.7750, lng: -17.4000 },
  // Guédiawaye — Wakhinane Nimzatt
  "Ndiarème Limamoulaye": { lat: 14.7800, lng: -17.3950 },
  "Wakhinane Nimzatt": { lat: 14.7850, lng: -17.3900 },
  "Médina Gounass": { lat: 14.7780, lng: -17.4050 },
  // Keur Massar — Yeumbeul Nord
  "Yeumbeul Nord": { lat: 14.7750, lng: -17.3700 },
  "Yeumbeul Sud": { lat: 14.7700, lng: -17.3750 },
  // Keur Massar — Malika
  "Malika": { lat: 14.7950, lng: -17.3300 },
  "Keur Massar Nord": { lat: 14.7850, lng: -17.3200 },
  // Keur Massar — Jaxaay
  "Jaxaay-Parcelles": { lat: 14.7900, lng: -17.3000 },
  "Keur Massar Sud": { lat: 14.7800, lng: -17.3150 },
  // Rufisque Est
  "Rufisque Nord": { lat: 14.7250, lng: -17.2700 },
  "Rufisque Est": { lat: 14.7200, lng: -17.2600 },
  "Rufisque Ouest": { lat: 14.7150, lng: -17.2750 },
  // Rufisque — rattachement direct
  "Bargny": { lat: 14.7000, lng: -17.2300 },
  "Sendou": { lat: 14.6900, lng: -17.2100 },
  // Rufisque — Diamniadio
  "Yène": { lat: 14.6700, lng: -17.1600 },
  "Diamniadio": { lat: 14.7200, lng: -17.1850 },
  "Sébikotane": { lat: 14.7450, lng: -17.1350 },
  // Rufisque — Sangalkam
  "Bambylor": { lat: 14.8000, lng: -17.2200 },
  "Tivaouane Peulh-Niaga": { lat: 14.8100, lng: -17.2000 },
  "Sangalkam": { lat: 14.7800, lng: -17.2300 },
};

const COMMUNE_COORDS: Map<string, LatLng> = new Map(
  Object.entries(COMMUNE_COORDS_RAW).map(([k, v]) => [normalizeZoneKey(k), v])
);

// Position de repli par défaut (Plateau, centre-ville / dépôt supposé) pour
// le point de départ des tournées quand aucun dépôt spécifique n'est fourni
// au dispatching. À ajuster si l'usine/dépôt réel est ailleurs.
export const DEPOT_DEFAUT: LatLng = { lat: 14.6937, lng: -17.4441 };

// Retrouve la position GPS approximative d'une "zone" (commune officielle ou
// quartier en texte libre, voir Commande.zone / Client.zone) — même logique
// de résolution que getArrondissement() dans communesDakar.ts : correspondance
// directe avec une des 53 communes, puis repli sur le dictionnaire d'alias de
// quartiers. Retourne null si la zone est vide ou non reconnue : le
// dispatching doit alors écarter cette commande plutôt que de deviner une
// position et fausser silencieusement le calcul des tournées.
export function getZoneCoords(zone: string | undefined | null): LatLng | null {
  if (!zone || !zone.trim()) return null;
  const key = normalizeZoneKey(zone);
  const direct = COMMUNE_COORDS.get(key);
  if (direct) return direct;
  const communeAlias = ALIAS_QUARTIERS_DAKAR[key];
  if (communeAlias) {
    const viaAlias = COMMUNE_COORDS.get(normalizeZoneKey(communeAlias));
    if (viaAlias) return viaAlias;
  }
  return null;
}

// Distance à vol d'oiseau (km) entre deux points, formule de Haversine.
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Emprise géographique couvrant l'ensemble des coordonnées de COMMUNE_COORDS_RAW
// ci-dessus (avec une marge), utilisée pour projeter des positions sur la carte
// SVG "légère" de SuiviLogistiqueSection.tsx (pas de tuiles cartographiques
// externes ni de dépendance npm — juste une projection linéaire lat/lng → x/y).
export const DAKAR_BOUNDS = { latMin: 14.65, latMax: 14.82, lngMin: -17.53, lngMax: -17.12 };

// Projette une position GPS sur un repère écran (0,0 en haut-gauche) de taille
// width×height, en utilisant DAKAR_BOUNDS. Nord en haut, Est à droite — une
// projection plate (pas de correction de courbure), largement suffisante à
// l'échelle de la région de Dakar.
export function projeterSurCarte(pos: LatLng, width: number, height: number): { x: number; y: number } {
  const x = ((pos.lng - DAKAR_BOUNDS.lngMin) / (DAKAR_BOUNDS.lngMax - DAKAR_BOUNDS.lngMin)) * width;
  const y = ((DAKAR_BOUNDS.latMax - pos.lat) / (DAKAR_BOUNDS.latMax - DAKAR_BOUNDS.latMin)) * height;
  return { x, y };
}
