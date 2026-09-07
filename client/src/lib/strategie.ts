/**
 * Moteur d'analyse stratégique — MA2F AquaSachet
 *
 * Génère des recommandations (croissance, vente, promotion, risque,
 * orientation développement) calculées directement depuis les données déjà
 * enregistrées dans l'app (ventes, clients, zones, commerciaux). Aucune
 * dépendance externe (pas d'IA, pas d'API) : tout est déterministe et
 * fonctionne hors ligne.
 */

import type { Database, Vente } from "./types";
import { fmt } from "./helpers";

export type ConseilCategorie = "croissance" | "vente" | "promotion" | "risque" | "orientation";
export type ConseilPriorite = "haute" | "moyenne" | "info";

export interface Conseil {
  id: string;
  categorie: ConseilCategorie;
  priorite: ConseilPriorite;
  titre: string;
  description: string;
  metrique?: string;
}

export interface ZonePerf {
  zone: string;
  ca: number;
  nbClients: number;
  caParClient: number;
}

export interface TypePerf {
  type: string;
  ca: number;
  nbClients: number;
  part: number;
}

export interface ClientRisque {
  client: string;
  joursDepuisAchat: number;
  caHistorique: number;
}

export interface StrategieSnapshot {
  conseils: Conseil[];
  caMoisCourant: number;
  caMoisPrecedent: number;
  croissanceMoisPct: number | null;
  historiqueMensuel: { mois: string; ca: number }[];
  parZone: ZonePerf[];
  parType: TypePerf[];
  clientsARisque: ClientRisque[];
  concentrationTopClient: number;
  concentrationTop5: number;
}

const MS_JOUR = 86400000;
const PRIORITE_ORDRE: Record<ConseilPriorite, number> = { haute: 0, moyenne: 1, info: 2 };

function moisOffset(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function caVentes(ventes: Vente[]): number {
  return ventes.reduce((s, v) => s + v.packs * v.prix, 0);
}

export function analyserStrategie(DB: Database): StrategieSnapshot {
  const conseils: Conseil[] = [];
  let idCounter = 0;
  const addConseil = (c: Omit<Conseil, "id">) => conseils.push({ id: `c${idCounter++}`, ...c });

  // ─── Historique mensuel (jusqu'à 12 derniers mois avec des ventes) ────────
  const moisSet = new Set<string>();
  DB.ventes.forEach((v) => { if (v.date) moisSet.add(v.date.slice(0, 7)); });
  const moisTries = Array.from(moisSet).sort();
  const historiqueMensuel = moisTries.slice(-12).map((mois) => ({
    mois,
    ca: caVentes(DB.ventes.filter((v) => (v.date || "").startsWith(mois))),
  }));

  // ─── Tendance mois courant vs mois précédent ──────────────────────────────
  const moisCourant = moisOffset(0);
  const moisPrecedent = moisOffset(1);
  const ventesMoisCourant = DB.ventes.filter((v) => (v.date || "").startsWith(moisCourant));
  const ventesMoisPrecedent = DB.ventes.filter((v) => (v.date || "").startsWith(moisPrecedent));
  const caMoisCourant = caVentes(ventesMoisCourant);
  const caMoisPrecedent = caVentes(ventesMoisPrecedent);
  let croissanceMoisPct: number | null = null;

  if (caMoisPrecedent > 0) {
    croissanceMoisPct = ((caMoisCourant - caMoisPrecedent) / caMoisPrecedent) * 100;
    if (croissanceMoisPct <= -15) {
      addConseil({
        categorie: "croissance", priorite: "haute",
        titre: "Baisse significative du chiffre d'affaires ce mois-ci",
        description: `Le CA recule de ${Math.abs(croissanceMoisPct).toFixed(0)}% par rapport au mois précédent (${fmt(caMoisPrecedent)} → ${fmt(caMoisCourant)}). Vérifiez s'il s'agit d'un effet saisonnier, d'un client important perdu, ou d'un ralentissement de la force de vente avant que la tendance ne s'installe.`,
        metrique: `${croissanceMoisPct.toFixed(0)}%`,
      });
    } else if (croissanceMoisPct >= 15) {
      addConseil({
        categorie: "croissance", priorite: "info",
        titre: "Forte croissance du chiffre d'affaires ce mois-ci",
        description: `Le CA progresse de ${croissanceMoisPct.toFixed(0)}% par rapport au mois précédent. Assurez-vous que la production et le stock de rouleaux/cartons suivent le rythme pour ne pas perdre de ventes par rupture.`,
        metrique: `+${croissanceMoisPct.toFixed(0)}%`,
      });
    }
  }

  // ─── Performance par zone ──────────────────────────────────────────────────
  const zoneMap = new Map<string, { ca: number; clients: Set<string> }>();
  DB.clients.forEach((c) => {
    const zoneKey = c.zone?.trim() || "Zone non renseignée";
    if (!zoneMap.has(zoneKey)) zoneMap.set(zoneKey, { ca: 0, clients: new Set() });
    zoneMap.get(zoneKey)!.clients.add(c.nom);
  });
  DB.ventes.forEach((v) => {
    const client = DB.clients.find((c) => c.nom === v.client);
    const zoneKey = client?.zone?.trim() || "Zone non renseignée";
    if (!zoneMap.has(zoneKey)) zoneMap.set(zoneKey, { ca: 0, clients: new Set() });
    zoneMap.get(zoneKey)!.ca += v.packs * v.prix;
  });
  const parZone: ZonePerf[] = Array.from(zoneMap.entries())
    .map(([zone, d]) => ({ zone, ca: d.ca, nbClients: d.clients.size, caParClient: d.clients.size > 0 ? d.ca / d.clients.size : 0 }))
    .sort((a, b) => b.ca - a.ca);

  const caTotalGlobal = caVentes(DB.ventes);
  const caParClientGlobal = DB.clients.length > 0 ? caTotalGlobal / DB.clients.length : 0;

  if (parZone.length >= 2 && caParClientGlobal > 0) {
    const zonesSousExploitees = parZone.filter(
      (z) => z.zone !== "Zone non renseignée" && z.nbClients >= 2 && z.caParClient < caParClientGlobal * 0.5
    );
    if (zonesSousExploitees.length > 0) {
      const top = zonesSousExploitees[0];
      addConseil({
        categorie: "orientation", priorite: "moyenne",
        titre: `Zone sous-exploitée : ${top.zone}`,
        description: `${top.zone} compte ${top.nbClients} client(s) mais un CA moyen par client bien inférieur à la moyenne (${fmt(top.caParClient)} contre ${fmt(caParClientGlobal)} en moyenne globale). Une relance commerciale ciblée ou une tournée de livraison dédiée pourrait débloquer du potentiel dans cette zone.`,
      });
    }
    const meilleureZone = parZone.find((z) => z.zone !== "Zone non renseignée" && z.ca > 0);
    if (meilleureZone) {
      addConseil({
        categorie: "croissance", priorite: "info",
        titre: `Zone la plus performante : ${meilleureZone.zone}`,
        description: `${meilleureZone.zone} génère le CA le plus élevé (${fmt(meilleureZone.ca)}) avec ${meilleureZone.nbClients} client(s). Prospecter des établissements similaires dans cette même zone (ou des zones comparables) est le moyen le plus rapide de dupliquer ce succès.`,
      });
    }
  }

  // ─── Segments (type de client) ─────────────────────────────────────────────
  const typeMap = new Map<string, { ca: number; nbClients: number }>();
  DB.clients.forEach((c) => {
    const t = c.type?.trim() || "Type non renseigné";
    if (!typeMap.has(t)) typeMap.set(t, { ca: 0, nbClients: 0 });
    typeMap.get(t)!.nbClients++;
  });
  DB.ventes.forEach((v) => {
    const client = DB.clients.find((c) => c.nom === v.client);
    const t = client?.type?.trim() || "Type non renseigné";
    if (!typeMap.has(t)) typeMap.set(t, { ca: 0, nbClients: 0 });
    typeMap.get(t)!.ca += v.packs * v.prix;
  });
  const parType: TypePerf[] = Array.from(typeMap.entries())
    .map(([type, d]) => ({ type, ca: d.ca, nbClients: d.nbClients, part: caTotalGlobal > 0 ? (d.ca / caTotalGlobal) * 100 : 0 }))
    .sort((a, b) => b.ca - a.ca);

  if (parType.length >= 2 && caTotalGlobal > 0) {
    const meilleurSegment = parType[0];
    if (meilleurSegment.type !== "Type non renseigné" && meilleurSegment.part >= 30) {
      addConseil({
        categorie: "orientation", priorite: "moyenne",
        titre: `Prioriser le segment "${meilleurSegment.type}" pour le développement`,
        description: `Le segment "${meilleurSegment.type}" représente à lui seul ${meilleurSegment.part.toFixed(0)}% du CA total (${meilleurSegment.nbClients} client(s)). Orientez la prospection commerciale et d'éventuels développements (formats, conditionnement, volumes) en priorité vers ce type de clientèle, qui a déjà démontré son potentiel.`,
      });
    }
  }

  // ─── Clients réguliers à risque de churn (45+ jours sans achat) ──────────
  const clientsHistorique = new Map<string, { nbAchats: number; dernierAchat: string; caHistorique: number }>();
  DB.ventes.forEach((v) => {
    const entry = clientsHistorique.get(v.client) || { nbAchats: 0, dernierAchat: "", caHistorique: 0 };
    entry.nbAchats++;
    entry.caHistorique += v.packs * v.prix;
    if (!entry.dernierAchat || v.date > entry.dernierAchat) entry.dernierAchat = v.date;
    clientsHistorique.set(v.client, entry);
  });
  const clientsARisque: ClientRisque[] = Array.from(clientsHistorique.entries())
    .filter(([, d]) => d.nbAchats >= 3 && d.dernierAchat)
    .map(([client, d]) => ({
      client,
      joursDepuisAchat: Math.floor((Date.now() - new Date(d.dernierAchat).getTime()) / MS_JOUR),
      caHistorique: d.caHistorique,
    }))
    .filter((c) => c.joursDepuisAchat > 45)
    .sort((a, b) => b.caHistorique - a.caHistorique);

  if (clientsARisque.length > 0) {
    const top3 = clientsARisque.slice(0, 3).map((c) => c.client).join(", ");
    addConseil({
      categorie: "risque", priorite: clientsARisque.length >= 3 ? "haute" : "moyenne",
      titre: `${clientsARisque.length} client(s) régulier(s) sans achat depuis 45 jours ou plus`,
      description: `Ces clients achetaient régulièrement (3 achats ou plus dans l'historique) mais semblent inactifs : ${top3}${clientsARisque.length > 3 ? "…" : ""}. Une relance personnalisée (appel ou passage du commercial/livreur) peut éviter une perte définitive.`,
      metrique: `${clientsARisque.length}`,
    });
  }

  // ─── Concentration du risque client ────────────────────────────────────────
  const clientsParCA = Array.from(clientsHistorique.entries())
    .map(([client, d]) => ({ client, ca: d.caHistorique }))
    .sort((a, b) => b.ca - a.ca);
  const concentrationTopClient = caTotalGlobal > 0 && clientsParCA.length > 0 ? (clientsParCA[0].ca / caTotalGlobal) * 100 : 0;
  const concentrationTop5 = caTotalGlobal > 0 ? (clientsParCA.slice(0, 5).reduce((s, c) => s + c.ca, 0) / caTotalGlobal) * 100 : 0;

  if (concentrationTopClient >= 25 && clientsParCA.length > 1) {
    addConseil({
      categorie: "risque", priorite: "moyenne",
      titre: "Dépendance forte à un seul client",
      description: `${clientsParCA[0].client} représente à lui seul ${concentrationTopClient.toFixed(0)}% du CA total historique. Diversifier la clientèle réduirait le risque en cas de baisse ou d'arrêt des achats de ce client.`,
      metrique: `${concentrationTopClient.toFixed(0)}%`,
    });
  }

  // ─── Saisonnalité / opportunités de promotion ──────────────────────────────
  if (historiqueMensuel.length >= 4) {
    const moyenne = historiqueMensuel.reduce((s, m) => s + m.ca, 0) / historiqueMensuel.length;
    const moisFaibles = historiqueMensuel.filter((m) => m.ca > 0 && m.ca < moyenne * 0.6);
    if (moisFaibles.length > 0 && moyenne > 0) {
      addConseil({
        categorie: "promotion", priorite: "info",
        titre: "Des mois nettement plus creux que la moyenne",
        description: `${moisFaibles.map((m) => m.mois).join(", ")} ${moisFaibles.length > 1 ? "ont été" : "a été"} nettement en dessous de la moyenne mensuelle (${fmt(moyenne)}). Envisagez une promotion ou une offre bonus ciblée à l'approche de ces périodes pour lisser l'activité sur l'année.`,
      });
    }
  }

  // ─── Commerciaux nettement sous objectif ce mois-ci ────────────────────────
  if (DB.commerciaux && DB.commerciaux.length > 0) {
    const caParCommercial = new Map<string, number>();
    ventesMoisCourant.forEach((v) => {
      if (!v.commercial) return;
      caParCommercial.set(v.commercial, (caParCommercial.get(v.commercial) || 0) + v.packs * v.prix);
    });
    const sousObjectif = DB.commerciaux.filter(
      (c) => c.objectif && c.objectif > 0 && (caParCommercial.get(c.nom) || 0) < c.objectif * 0.7
    );
    if (sousObjectif.length > 0) {
      addConseil({
        categorie: "vente", priorite: "moyenne",
        titre: `${sousObjectif.length} commercial(aux) nettement sous objectif ce mois-ci`,
        description: `${sousObjectif.map((c) => c.nom).join(", ")} ${sousObjectif.length > 1 ? "sont" : "est"} en dessous de 70% de leur objectif mensuel. Un accompagnement terrain, une réattribution de zones/clients, ou un ajustement des objectifs peut aider.`,
      });
    }
  }

  // ─── Pas assez de données ───────────────────────────────────────────────────
  if (DB.ventes.length === 0) {
    addConseil({
      categorie: "croissance", priorite: "info",
      titre: "Pas encore assez de données",
      description: "Enregistrez vos premières ventes pour commencer à recevoir des recommandations stratégiques calculées sur vos données réelles (tendances, zones, segments, clients à risque).",
    });
  } else if (moisTries.length < 2) {
    addConseil({
      categorie: "croissance", priorite: "info",
      titre: "Historique encore limité",
      description: "Certaines analyses (tendance mensuelle, saisonnalité) deviendront plus fiables avec au moins 2 à 3 mois de ventes enregistrées.",
    });
  }

  conseils.sort((a, b) => PRIORITE_ORDRE[a.priorite] - PRIORITE_ORDRE[b.priorite]);

  return {
    conseils,
    caMoisCourant,
    caMoisPrecedent,
    croissanceMoisPct,
    historiqueMensuel,
    parZone,
    parType,
    clientsARisque,
    concentrationTopClient,
    concentrationTop5,
  };
}
