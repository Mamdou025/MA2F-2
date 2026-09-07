/**
 * GOOGLE MAPS FRONTEND INTEGRATION - ESSENTIAL GUIDE
 *
 * USAGE FROM PARENT COMPONENT:
 * ======
 *
 * const mapRef = useRef<google.maps.Map | null>(null);
 *
 * <MapView
 *   initialCenter={{ lat: 40.7128, lng: -74.0060 }}
 *   initialZoom={15}
 *   onMapReady={(map) => {
 *     mapRef.current = map; // Store to control map from parent anytime, google map itself is in charge of the re-rendering, not react state.
 * </MapView>
 *
 * ======
 * Available Libraries and Core Features:
 * -------------------------------
 * 📍 MARKER (from `marker` library)
 * - Attaches to map using { map, position }
 * new google.maps.marker.AdvancedMarkerElement({
 *   map,
 *   position: { lat: 37.7749, lng: -122.4194 },
 *   title: "San Francisco",
 * });
 *
 * -------------------------------
 * 🏢 PLACES (from `places` library)
 * - Does not attach directly to map; use data with your map manually.
 * const place = new google.maps.places.Place({ id: PLACE_ID });
 * await place.fetchFields({ fields: ["displayName", "location"] });
 * map.setCenter(place.location);
 * new google.maps.marker.AdvancedMarkerElement({ map, position: place.location });
 *
 * -------------------------------
 * 🧭 GEOCODER (from `geocoding` library)
 * - Standalone service; manually apply results to map.
 * const geocoder = new google.maps.Geocoder();
 * geocoder.geocode({ address: "New York" }, (results, status) => {
 *   if (status === "OK" && results[0]) {
 *     map.setCenter(results[0].geometry.location);
 *     new google.maps.marker.AdvancedMarkerElement({
 *       map,
 *       position: results[0].geometry.location,
 *     });
 *   }
 * });
 *
 * -------------------------------
 * 📐 GEOMETRY (from `geometry` library)
 * - Pure utility functions; not attached to map.
 * const dist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
 *
 * -------------------------------
 * 🛣️ ROUTES (from `routes` library)
 * - Combines DirectionsService (standalone) + DirectionsRenderer (map-attached)
 * const directionsService = new google.maps.DirectionsService();
 * const directionsRenderer = new google.maps.DirectionsRenderer({ map });
 * directionsService.route(
 *   { origin, destination, travelMode: "DRIVING" },
 *   (res, status) => status === "OK" && directionsRenderer.setDirections(res)
 * );
 *
 * -------------------------------
 * 🌦️ MAP LAYERS (attach directly to map)
 * - new google.maps.TrafficLayer().setMap(map);
 * - new google.maps.TransitLayer().setMap(map);
 * - new google.maps.BicyclingLayer().setMap(map);
 *
 * -------------------------------
 * ✅ SUMMARY
 * - “map-attached” → AdvancedMarkerElement, DirectionsRenderer, Layers.
 * - “standalone” → Geocoder, DirectionsService, DistanceMatrixService, ElevationService.
 * - “data-only” → Place, Geometry utilities.
 */

/// <reference types="@types/google.maps" />

import { useEffect, useRef, useState } from "react";
import { usePersistFn } from "@/hooks/usePersistFn";
import { cn } from "@/lib/utils";
import { AlertTriangle, Maximize2, Minimize2 } from "lucide-react";

declare global {
  interface Window {
    google?: typeof google;
  }
}

// Deux sources possibles pour Google Maps, utilisées dans cet ordre :
// 1) Clé Google Maps perso (Maps JavaScript API + Geocoding API activées sur
//    Google Cloud Console), définie dans un .env LOCAL :
//    VITE_GOOGLE_MAPS_API_KEY=xxxx
//    → utilisée en développement local, où le proxy Manus n'est pas injecté.
// 2) Proxy Manus intégré (VITE_FRONTEND_FORGE_API_KEY), injecté automatiquement
//    au build/déploiement sur Manus, sans configuration ni clé à fournir.
//    → utilisée en production sur Manus si aucune clé perso n'est définie,
//    pour éviter l'upgrade payant nécessaire pour ajouter un Secret custom.
const OWN_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSyCysHhZ1OKw3YA-uetq7bKzZVDdXrSDaY4";
const FORGE_API_KEY = import.meta.env.VITE_FRONTEND_FORGE_API_KEY;
const FORGE_BASE_URL =
  import.meta.env.VITE_FRONTEND_FORGE_API_URL || "https://forge.butterfly-effect.dev";

// "routes" ajoutée (2026-08-15) pour DirectionsService/DirectionsRenderer —
// utilisée par client/src/lib/routing.ts pour le calcul d'itinéraire réel du
// dispatching (voir CommandesSection.tsx). Nécessite que la "Directions API"
// soit activée sur le projet Google Cloud de la clé (en plus de Maps
// JavaScript API / Geocoding API déjà requises pour le reste de l'app) —
// sinon DirectionsService répond REQUEST_DENIED et routing.ts se replie
// silencieusement sur l'estimation à vol d'oiseau existante.
// "v=quarterly" (au lieu de "v=weekly", 2026-09-05) : le canal "weekly" sert
// la toute dernière build de Google, non testée pour la prod (Google le
// déconseille explicitement pour cette raison).
//
// PAS de "loading=async" (retiré le 2026-09-05 après l'avoir ajouté puis
// diagnostiqué comme régression — voir la note détaillée plus bas dans ce
// fichier, sur MapView/init(), sur la course entre script.onload et la
// disponibilité réelle de google.maps.Map en mode "loading=async"). Le
// console warning de Google ("...loaded directly without loading=async...")
// n'est qu'une suggestion de performance, pas une exigence fonctionnelle —
// le garder désactivé est le choix le plus sûr tant que ce fichier utilise
// le pattern classique script.onload plutôt que google.maps.importLibrary().
function getMapScriptUrl(): string | null {
  if (OWN_API_KEY) {
    return `https://maps.googleapis.com/maps/api/js?key=${OWN_API_KEY}&v=quarterly&language=fr&libraries=marker,places,geocoding,geometry,routes`;
  }
  if (FORGE_API_KEY) {
    return `${FORGE_BASE_URL}/v1/maps/proxy/maps/api/js?key=${FORGE_API_KEY}&v=quarterly&language=fr&libraries=marker,places,geocoding,geometry,routes`;
  }
  return null;
}

let scriptLoadPromise: Promise<void> | null = null;

// Identifiant stable posé sur la balise <script> pour repérer un chargement
// déjà en cours ou déjà présent dans le DOM, indépendamment de la variable de
// module `scriptLoadPromise` ci-dessus : elle peut être réinitialisée (Vite
// HMR qui réévalue ce module, ou un unmount/remount de <MapView>) sans que la
// vraie balise <script> déjà injectée dans <head> disparaisse pour autant.
// Sans cette vérification DOM en plus de la variable, un nouvel appel à
// loadMapScript() dans cet état pouvait injecter une DEUXIÈME (ou une
// troisième, etc.) balise <script src="maps.googleapis.com/...">. Google Maps
// déclenche alors sporadiquement l'erreur générique "Oops! Something went
// wrong. This page didn't load Google Maps correctly." — le bandeau rouge vu
// dans le formulaire "Modifier le client" — à ne pas confondre avec une clé
// API invalide ou non autorisée. Constaté en pratique le 2026-09-05 : jusqu'à
// 5 balises <script> googleapis.com identiques accumulées dans le DOM d'un
// même onglet, avec la même clé API valide à chaque fois.
const MAPS_SCRIPT_ID = "ma2f-google-maps-script";

// Exportée pour que routing.ts puisse s'assurer que le script Google Maps est
// chargé avant d'utiliser DirectionsService, sans dépendre du montage d'un
// <MapView> quelque part dans l'arbre React (le calcul de dispatching peut
// être lancé depuis un dialog qui n'affiche pas encore de carte).
export function loadMapScript(): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  // Une balise <script> existe déjà dans le DOM (chargement lancé par un appel
  // précédent, potentiellement depuis un état de module différent après un
  // HMR) : on s'y raccroche au lieu d'en injecter une nouvelle en double.
  const existing = document.getElementById(MAPS_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          scriptLoadPromise = null;
          reject(new Error("Échec du chargement du script Google Maps"));
        },
        { once: true },
      );
    });
    return scriptLoadPromise;
  }

  const src = getMapScriptUrl();
  if (!src) return Promise.reject(new Error("NO_KEY"));

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = MAPS_SCRIPT_ID;
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoadPromise = null; // Permettre de réessayer plus tard
      script.remove(); // Éviter d'accumuler des balises <script> mortes (voir commentaire ci-dessus)
      reject(new Error("Échec du chargement du script Google Maps"));
    };
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

interface MapViewProps {
  className?: string;
  initialCenter?: google.maps.LatLngLiteral;
  initialZoom?: number;
  onMapReady?: (map: google.maps.Map) => void;
}

export function MapView({
  className,
  initialCenter = { lat: 37.7749, lng: -122.4194 },
  initialZoom = 12,
  onMapReady,
}: MapViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Incrémenté par le bouton "Réessayer" de l'état d'erreur pour redéclencher
  // l'effet d'init ci-dessous (voir handleRetry) — nécessaire car le
  // conteneur <div> de la carte n'existe pas dans le DOM tant que `error` est
  // défini (voir le rendu conditionnel plus bas), donc mapContainer.current
  // resterait `null` si on rappelait simplement init() sans repasser par un
  // nouveau rendu.
  const [retryToken, setRetryToken] = useState(0);

  const init = usePersistFn(async () => {
    try {
      await loadMapScript();
    } catch (e) {
      if (e instanceof Error && e.message === "NO_KEY") {
        setError("Carte non disponible : définissez VITE_GOOGLE_MAPS_API_KEY dans .env (local) ou déployez via Manus (proxy intégré).");
      } else {
        setError("Impossible de charger Google Maps. Vérifiez la clé API et sa configuration (restrictions, facturation).");
      }
      console.error(e);
      return;
    }
    if (!mapContainer.current) {
      console.error("Map container not found");
      return;
    }
    try {
      map.current = new window.google!.maps.Map(mapContainer.current, {
        zoom: initialZoom,
        center: initialCenter,
        mapTypeControl: true,
        fullscreenControl: true,
        zoomControl: true,
        streetViewControl: true,
        mapId: "DEMO_MAP_ID",
      });
    } catch (e) {
      console.error(e);
      setError("Impossible d'afficher la carte (incident Google Maps). Réessayez.");
      return;
    }
    // Historique (2026-09-05) : même sans "loading=async", le script Google
    // Maps pouvait se charger "avec succès" (script.onload déclenché) tout en
    // échouant ensuite à afficher la carte elle-même — deux causes réelles
    // trouvées et corrigées à la source ce jour-là :
    // (1) un <script src="%VITE_ANALYTICS_ENDPOINT%/umami"> resté avec ses
    //     placeholders Vite non substitués dans client/index.html (les deux
    //     variables n'étant définies ni en local ni sur Vercel) laissait un
    //     "%" invalide dans une URL de script sur la page ; Google Maps
    //     semble scanner document.scripts au démarrage et levait alors une
    //     exception interne ("Uncaught (in promise) URIError: URI
    //     malformed") qui interrompait son initialisation — corrigé dans
    //     index.html (le script ne s'injecte plus que si les variables sont
    //     réellement définies) ;
    // (2) avec "loading=async" (retiré, voir plus haut), script.onload
    //     pouvait se déclencher avant que google.maps.Map ne soit réellement
    //     disponible (mode de chargement différé propre à "loading=async",
    //     pensé pour google.maps.importLibrary() plutôt que pour ce pattern
    //     script.onload classique).
    // Un filet "watchdog" (setTimeout 8s + listener "tilesloaded") avait été
    // ajouté ici par précaution en plus de ces deux corrections, mais s'est
    // révélé être lui-même une source de bug : sur certains clients il se
    // déclenchait en faux positif (la carte finissait par s'afficher juste
    // après le délai), et le bouton "Réessayer" qu'il affichait alors
    // provoquait un démontage/remontage du conteneur de la carte pendant que
    // l'initialisation interne asynchrone de Google Maps (IntersectionObserver
    // posé sur ce conteneur, pour les cartes vectorielles) était encore en
    // cours — d'où un second crash ("Failed to execute 'observe' on
    // 'IntersectionObserver': parameter 1 is not of type 'Element'"). Retiré
    // le 2026-09-05 : les deux causes réelles ci-dessus étant corrigées à la
    // source, ce filet ajoutait plus de risque qu'il n'en retirait. Le
    // try/catch ci-dessus (qui capture les vraies erreurs synchrones du
    // constructeur) et le bouton "Réessayer" associé restent en place pour ce
    // cas précis.
    if (onMapReady) {
      onMapReady(map.current);
    }
  });

  useEffect(() => {
    init();
  }, [init, retryToken]);

  const handleRetry = usePersistFn(() => {
    setError(null);
    setRetryToken((t) => t + 1);
  });

  // Bouton plein écran custom : plus visible/fiable que le petit contrôle natif de
  // Google Maps, surtout sur les cartes réduites (h-48/h-64) utilisées dans les
  // formulaires client. S'appuie sur la Fullscreen API du navigateur ; au retour
  // (touche Échap ou re-clic), on redéclenche un "resize" pour que Google Maps
  // reprenne bien les nouvelles dimensions (sinon la carte reste figée à sa taille
  // d'origine, un piège classique avec l'API Maps dans un conteneur redimensionné).
  const toggleFullscreen = usePersistFn(() => {
    if (!wrapperRef.current) return;
    if (!document.fullscreenElement) {
      wrapperRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === wrapperRef.current;
      setIsFullscreen(active);
      if (map.current && window.google?.maps) {
        // Laisser le DOM se redimensionner avant de prévenir Google Maps
        setTimeout(() => {
          window.google!.maps.event.trigger(map.current!, "resize");
          if (active) map.current!.setCenter(map.current!.getCenter()!);
        }, 50);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  if (error) {
    return (
      <div className={cn("w-full h-[500px] flex flex-col items-center justify-center gap-2 bg-gray-50 border border-dashed rounded-lg text-center p-4", className)}>
        <AlertTriangle className="w-6 h-6 text-amber-500" />
        <p className="text-sm text-gray-500 max-w-xs">{error}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-700 underline"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={cn("relative", isFullscreen && "bg-black")}>
      <div ref={mapContainer} className={cn("w-full h-[500px]", !isFullscreen && className, isFullscreen && "h-screen")} />
      {/* Coin haut-gauche plutôt que bas-droit : à droite se trouve déjà le cluster
          de contrôles natifs de Google Maps (zoom, pan, plein écran natif), où un
          bouton de plus passe facilement inaperçu. */}
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Quitter le plein écran" : "Voir la carte en plein écran"}
        title={isFullscreen ? "Quitter le plein écran" : "Voir la carte en plein écran"}
        className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 rounded-md shadow-md px-2 py-1.5 text-gray-700 text-xs font-medium"
      >
        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        {isFullscreen ? "Réduire" : "Plein écran"}
      </button>
    </div>
  );
}
