/**
 * Bonnes pratiques génériques — MA2F AquaSachet (Dakar, Sénégal)
 *
 * Contrairement aux conseils de strategie.ts (calculés automatiquement à
 * partir des données réelles de l'app : ventes, clients, zones), ce fichier
 * contient une base de recommandations curée manuellement, organisée en 3
 * thèmes : développement commercial (Dakar et hors Dakar), qualité produit,
 * et pilotage/gestion de l'entreprise. Contenu statique — à revoir
 * manuellement si le contexte réglementaire ou le marché évolue.
 *
 * Sources citées quand la recommandation s'appuie sur un fait précis
 * (réglementation, étude) plutôt que sur une bonne pratique générale :
 * - Étude UCAD sur la qualité microbiologique de l'eau en sachet (juin 2026)
 * - Déclarations de la Dcsc / ministère du Commerce (Le Soleil, 12/07/2026)
 * - Loi n°2020-04 du 8 janvier 2020 sur la réduction des plastiques à usage unique
 */

export type ThemePratique = "expansion" | "qualite" | "gestion";

export interface Pratique {
  id: string;
  titre: string;
  resume: string;
  actions: string[];
  source?: string;
}

export const THEME_INFO: Record<ThemePratique, { label: string; description: string }> = {
  expansion: {
    label: "Développement commercial (Dakar & hors Dakar)",
    description: "Étendre et consolider les ventes à Dakar et dans les autres régions.",
  },
  qualite: {
    label: "Qualité",
    description: "Fiabiliser la qualité du produit et la conformité réglementaire.",
  },
  gestion: {
    label: "Gestion & pilotage",
    description: "Renforcer le système de gestion et le contrôle interne de l'entreprise.",
  },
};

export const ALERTE_SECTORIELLE: Pratique = {
  id: "alerte-autorisation",
  titre: "Point d'attention majeur : l'autorisation de fabrication est un actif rare à protéger",
  resume:
    "Depuis avril 2020, le Sénégal ne délivre plus aucune nouvelle autorisation de fabrication d'eau en sachet plastique (loi n°2020-04 sur la réduction des plastiques à usage unique). Si MA2F dispose déjà d'une autorisation en règle, c'est un avantage concurrentiel rare — cela bloque l'arrivée de nouveaux concurrents formels. Mais cet avantage est fragile : une étude de l'UCAD (juin 2026, 100 échantillons de 50 marques à Dakar et Mbour) a trouvé 82% des sachets d'eau contaminés (matières fécales), et la Dcsc (ministère du Commerce) a annoncé en juillet 2026 un renforcement des contrôles inopinés avec, en cas de non-conformité, retrait immédiat, saisie, voire fermeture de l'unité de production.",
  actions: [
    "Vérifier que l'autorisation de fabrication est à jour, complète, et immédiatement présentable en cas de contrôle inopiné.",
    "Traiter toute non-conformité qualité comme une priorité absolue : c'est le motif principal de retrait d'autorisation, pas seulement un risque sanitaire ou d'image.",
    "Utiliser cette rareté réglementaire comme argument commercial : une entreprise en règle et traçable peut se différencier clairement des vendeurs informels dans un secteur en crise de confiance.",
  ],
  source: "Le Soleil, 12/07/2026 (Dcsc) ; étude UCAD relayée par Socialnetlink, 27/06/2026",
};

export const PRATIQUES_EXPANSION: Pratique[] = [
  {
    id: "exp-1",
    titre: "Cartographier la couverture réelle par quartier de Dakar",
    resume:
      "Utiliser la carte déjà intégrée à l'app pour visualiser la densité de clients par quartier (Plateau, Médina, Grand Yoff, Parcelles Assainies, Pikine, Guédiawaye, Yeumbeul, Rufisque, Bargny...) et repérer les zones peu couvertes.",
    actions: [
      "Renseigner systématiquement la zone et la position GPS pour chaque nouveau client dans la section Clients.",
      "Croiser chaque mois avec « Performance par zone » (ci-dessous) pour repérer les zones à CA/client faible malgré un nombre de clients suffisant.",
      "Prioriser la prospection sur 2-3 zones sous-couvertes plutôt que de disperser l'effort commercial.",
    ],
  },
  {
    id: "exp-2",
    titre: "Distinguer la stratégie Dakar dense et la stratégie régions",
    resume:
      "Dakar (forte densité, marge unitaire faible, fréquence élevée) et les villes secondaires (Thiès, Mbour, Kaolack, Touba, Saint-Louis, Diourbel) demandent des modèles logistiques différents.",
    actions: [
      "À Dakar : tournées fréquentes, petits volumes, livraison directe boutique/ménage.",
      "Hors Dakar : privilégier des grossistes/dépositaires relais plutôt que la livraison directe, avec remise sur volume et paiement partiellement à l'avance.",
      "Tester une seule zone régionale à la fois avant d'étendre, pour maîtriser la logistique avant de multiplier les fronts.",
    ],
  },
  {
    id: "exp-3",
    titre: "Un dépôt relais dans une zone périphérique rentable mais éloignée",
    resume:
      "Un point de stockage secondaire près d'une zone à forte demande mais éloignée du site de production réduit le coût et le délai de livraison.",
    actions: [
      "Identifier la zone la plus éloignée mais la plus rentable via « Performance par zone ».",
      "Négocier un espace de stockage chez un client de confiance (boutique/grossiste) en échange d'une remise, plutôt qu'un investissement en dur.",
    ],
  },
  {
    id: "exp-4",
    titre: "Tournées de livraison fixes et prévisibles",
    resume:
      "Attribuer des zones fixes aux livreurs avec un jour de passage récurrent fidélise les points de vente, qui savent quand recommander, et réduit les trajets à vide.",
    actions: [
      "Définir un planning hebdomadaire par livreur/zone dans la section Livreurs.",
      "Communiquer ce planning aux boutiques clientes (ex : passage tous les lundis et jeudis).",
    ],
  },
  {
    id: "exp-5",
    titre: "Fidélisation par paliers de bonus",
    resume:
      "Le système de bonus existant (packs offerts au-delà d'un seuil) peut être structuré en paliers progressifs pour récompenser davantage les plus gros clients réguliers.",
    actions: [
      "Définir 2-3 paliers de bonus (seuil actuel, puis palier supérieur avec bonus renforcé).",
      "Réserver le palier le plus avantageux aux clients avec un historique d'achat continu sur plusieurs mois.",
    ],
  },
  {
    id: "exp-6",
    titre: "Faire de la reconquête des clients à risque une routine, pas une alerte passive",
    resume:
      "Cette page détecte déjà les clients réguliers inactifs depuis 45 jours ou plus (voir « Clients réguliers à risque » ci-dessus). Cette information doit se traduire en action commerciale systématique.",
    actions: [
      "Chaque début de mois, assigner la liste des clients à risque à un commercial nommé pour relance téléphonique.",
      "Consigner le motif de l'arrêt (prix, qualité perçue, rupture de stock...) pour identifier des causes récurrentes.",
    ],
  },
  {
    id: "exp-7",
    titre: "Faire de la conformité un argument de vente",
    resume:
      "Le secteur de l'eau en sachet au Sénégal traverse une crise de confiance (voir le point d'attention ci-dessus). Une entreprise en règle et traçable peut transformer cela en avantage commercial concret.",
    actions: [
      "Afficher visiblement le numéro d'autorisation et la date de production sur l'emballage.",
      "Utiliser cet argument face aux boutiques/grossistes, y compris pour justifier un prix légèrement supérieur à des sachets non déclarés.",
    ],
  },
];

export const PRATIQUES_QUALITE: Pratique[] = [
  {
    id: "qual-1",
    titre: "Contrôle qualité à chaque étape, avec traçabilité par lot",
    resume:
      "Instaurer un contrôle systématique à la source, après filtration/traitement, et au remplissage, avec un identifiant de lot lié à la date et à l'équipe de production.",
    actions: [
      "Attribuer un numéro de lot par journée/équipe de production dans le suivi Production.",
      "Conserver un échantillon témoin par lot pendant quelques jours en cas de réclamation ou de contrôle.",
    ],
  },
  {
    id: "qual-2",
    titre: "Analyses microbiologiques régulières en laboratoire agréé",
    resume:
      "Des analyses périodiques indépendantes (recherche de coliformes fécaux notamment — le problème identifié par l'étude UCAD de juin 2026) donnent une preuve objective de conformité à la norme NS 05-033 (eaux conditionnées, Association Sénégalaise de Normalisation).",
    actions: [
      "Planifier une analyse labo au minimum trimestrielle, et systématiquement après tout changement de source ou de matériel de filtration.",
      "Conserver les rapports d'analyse comme preuve immédiate en cas de contrôle Dcsc.",
    ],
    source: "Association Sénégalaise de Normalisation (norme NS 05-033) ; étude UCAD, juin 2026",
  },
  {
    id: "qual-3",
    titre: "Hygiène de production formalisée",
    resume:
      "La contamination fécale pointée par l'étude UCAD est typiquement liée à l'hygiène du personnel, du matériel de scellage et de l'eau de rinçage des sachets — pas uniquement à la source d'eau.",
    actions: [
      "Rédiger une procédure courte (une page) : lavage des mains, tenue, nettoyage de la machine de conditionnement avant chaque série.",
      "Contrôle visuel systématique de l'étanchéité et de la propreté des sachets en sortie de chaîne.",
    ],
  },
  {
    id: "qual-4",
    titre: "Relier la maintenance préventive au plan qualité",
    resume:
      "Le module Maintenance existant peut servir de vrai plan de maintenance préventive du système de traitement (filtres, UV/ozone) — un filtre changé en retard est une cause fréquente de non-conformité.",
    actions: [
      "Ajouter dans Maintenance un calendrier récurrent (ex : changement de filtre tous les X mois) plutôt que d'attendre une panne.",
      "Historiser les dates de changement de filtre pour pouvoir les présenter en cas de contrôle.",
    ],
  },
  {
    id: "qual-5",
    titre: "Croiser les clients inactifs avec un signal qualité",
    resume:
      "Un client régulier qui n'achète plus (déjà détecté par « clients à risque ») peut être un signal de problème qualité autant que commercial.",
    actions: [
      "Lors des relances de clients inactifs, poser systématiquement la question du motif d'arrêt.",
      "Distinguer explicitement les motifs liés à la qualité perçue des motifs purement commerciaux (prix, concurrence).",
    ],
  },
  {
    id: "qual-6",
    titre: "Se tenir prêt pour un contrôle inopiné",
    resume:
      "La Dcsc a annoncé en juillet 2026 l'intensification des contrôles inopinés et du nombre de prélèvements, en réaction directe à l'étude UCAD.",
    actions: [
      "Vérifier dès maintenant que tous les documents (autorisation, derniers rapports d'analyse) sont réunis et accessibles, sans attendre une annonce de contrôle.",
      "Sensibiliser le personnel de production à accueillir un contrôle sans le percevoir comme exceptionnel.",
    ],
    source: "Le Soleil, 12/07/2026 (Dcsc, ministère du Commerce)",
  },
];

export const PRATIQUES_GESTION: Pratique[] = [
  {
    id: "gest-1",
    titre: "Rituel hebdomadaire de lecture des indicateurs clés",
    resume:
      "Au-delà des KPI déjà présents dans l'app, fixer un rituel hebdomadaire (ex : chaque lundi matin) de lecture de quelques indicateurs : CA de la semaine, taux de recouvrement, stock de rouleaux/sachets restant, solde de caisse.",
    actions: [
      "Consulter Dashboard et Stratégie chaque lundi avant de démarrer la semaine commerciale.",
      "Noter les écarts significatifs pour suivi dans le temps.",
    ],
  },
  {
    id: "gest-2",
    titre: "Clôture de caisse quotidienne stricte",
    resume:
      "Le module Clôture existe déjà — en faire une règle non négociable tous les soirs, y compris les jours de faible activité, pour détecter tout écart rapidement plutôt qu'en fin de mois.",
    actions: [
      "Ne jamais reporter une clôture au lendemain.",
      "Documenter systématiquement tout écart de caisse (montant + explication), même faible.",
    ],
  },
  {
    id: "gest-3",
    titre: "Politique de crédit client formalisée",
    resume:
      "Fixer par écrit une limite d'encours par client et un délai de paiement maximal, appliqués uniformément, réduit le risque de créances impayées qui pèsent sur la trésorerie.",
    actions: [
      "Définir un plafond de créance par type de client (boutique, grossiste, ménage).",
      "Suspendre le crédit à un client qui dépasse son plafond ou son délai, avant relance via le module Recouvrement.",
    ],
  },
  {
    id: "gest-4",
    titre: "Trésorerie prévisionnelle mensuelle",
    resume:
      "Anticiper les sorties prévisibles (salaires, achats de rouleaux/cartons, entretien véhicules) face aux entrées attendues (ventes + recouvrements prévus) pour éviter les tensions de trésorerie en fin de mois.",
    actions: [
      "Construire un prévisionnel simple mensuel (recettes attendues − dépenses connues) à partir des données déjà présentes dans Ventes/Créances/Dépenses.",
      "Revoir ce prévisionnel chaque semaine avec les chiffres réels.",
    ],
  },
  {
    id: "gest-5",
    titre: "Séparation des rôles et double contrôle",
    resume:
      "Les rôles admin/caissier/commercial existent déjà dans l'app — s'assurer qu'ils sont réellement respectés en pratique et ajouter un second regard sur les opérations sensibles.",
    actions: [
      "Interdire le partage d'identifiants entre employés (un compte = une personne).",
      "Exiger une validation admin pour toute annulation de vente ou correction de caisse a posteriori.",
    ],
  },
  {
    id: "gest-6",
    titre: "Audit interne périodique",
    resume:
      "Un contrôle mensuel/trimestriel croisant stock physique vs système, caisse réelle vs système, et créances déclarées vs relances effectives permet de détecter les écarts avant qu'ils ne deviennent significatifs.",
    actions: [
      "Planifier un inventaire physique mensuel du stock de rouleaux/sachets/cartons, comparé au module Stock.",
      "Comparer trimestriellement les soldes de créances du système avec les confirmations clients.",
    ],
  },
  {
    id: "gest-7",
    titre: "Rigueur de saisie : la fiabilité des analyses en dépend",
    resume:
      "La valeur de cette page Stratégie (et du reste de l'app) dépend directement de la rigueur de saisie — dates, zones, modes de paiement. Une saisie approximative fausse toutes les analyses en aval.",
    actions: [
      "Session courte de rappel des bonnes pratiques de saisie tous les 2-3 mois avec les commerciaux/caissiers.",
      "Vérifier en particulier le renseignement systématique de la zone client, indispensable à « Performance par zone ».",
    ],
  },
];

export const PRATIQUES_PAR_THEME: Record<ThemePratique, Pratique[]> = {
  expansion: PRATIQUES_EXPANSION,
  qualite: PRATIQUES_QUALITE,
  gestion: PRATIQUES_GESTION,
};
