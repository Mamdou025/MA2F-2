# MA2F : couverture Odoo Community et décisions de remplacement

Audit du 10 septembre 2026 UTC. Périmètre : eau en sachets uniquement, les 37 rubriques de `client/src/components/AppSidebar.tsx`. Cette carte actualise l'audit du 7 septembre avec les décisions utilisateur et les résultats documentés dans `FIREBASE-EXIT.md` et `ODOO-DRAFT-ORDER-CONNECTION.md`. L'état déployé ci-dessous est le dernier état vérifié dans ces documents, pas une nouvelle interrogation de production.

## Décision

Odoo Community doit posséder les documents commerciaux, stocks, fabrication et écritures financières. MA2F garde son interface adaptée au terrain, ses simulations et les raccordements nécessaires. Configurer le standard avant de développer ; essayer les extensions libres compatibles avant d'écrire une règle manquante. Une interface personnalisée n'a pas besoin d'un deuxième moteur de stock ou de comptabilité.

Nous conservons deux projets Replit : Aquasachets pour MA2F et son backend, MA2F-Odoo-Core pour Odoo et ses addons séparés. Les comptes et sessions MA2F restent hébergés dans notre backend conformément au choix explicite ; un seul humain désigné ouvre directement Odoo. Les comptes techniques ont des droits limités. L'hébergement et les bases restent facturés indépendamment de la licence du logiciel.

## Disponible, préparé et réellement actif

| État | Constat et portée |
|---|---|
| Disponible dans le code public | Odoo 19 fournit les modules cités ci-dessous. Cela ne signifie pas que chaque procédure est installée ou configurée dans MA2F. |
| Dernier état Odoo vérifié | Socle ventes, achats, stock, fabrication, facturation et localisation Sénégal installé ; 255 contacts. Base encore neutralisée. Aucun ordre de vente, facture, paiement, mouvement/quantité de stock ou ordre de fabrication natif au dernier contrôle de navigation. |
| Historique visible | 1 048 ventes, 15 339 780 FCFA et 25 489 packs dans `x_ma2f_sale_history`, modèle d'archive en lecture seule. Ce ne sont pas des commandes ni des factures natives. Les rapports réels d'historique existent ; les exemples de tableaux de bord ont été masqués. |
| Préparé et testé localement | Connecteur de production et création de commande brouillon via méthodes Odoo natives. Le test de commande vérifie montant TTC, droits, répétition sans doublon et absence d'effets stock/facture. Il ne réserve pas de stock et n'est pas branché à l'écran live. |
| Encore actif côté MA2F | Chemin métier Firebase ; authentification native préparée mais mise en service incomplète. Firebase et Clerk ne sont pas encore supprimés. |
| Décisions à conserver | 30 sachets par pack ; production saisie nette vendable. Montants source intacts, taxe incluse mais taux inconnu. Le rendement de 17 packs/kg du pilote reste une estimation à confirmer, pas une recette physique validée. |

## Carte des 37 rubriques

« Remplacer » vise le moteur et les écritures derrière l'écran ; l'interface MA2F peut rester. Les modèles mentionnés sont la cible, pas une affirmation de synchronisation actuelle. Les limites sont des besoins à vérifier ou compléter, pas une invitation à coder immédiatement.

| Rubrique / identifiant | Ce que nous prenons d'Odoo | Ce que cela change et ce qui reste spécifique |
|---|---|---|
| Tableau de bord `dashboard` | Rapports natifs, agrégations autorisées des pièces réelles. | Remplacer les totaux officiels calculés depuis la DB navigateur. Garder la présentation, les filtres et la fraîcheur ; jamais afficher des exemples comme du réel. |
| Production `production` | `mrp.production`, `mrp.bom`, consommations et produits finis dans `stock`. | Une déclaration crée/termine une fabrication native. 100 packs saisis = 100 vendables ; ne pas retirer à nouveau les défauts. Conserver consommations réelles, lots et attribution collective des producteurs. |
| Ventes `ventes` | `sale.order`, livraison `stock.picking`, facture `account.move`, paiement `account.payment`. | Remplacer la ligne locale qui produit ses propres effets stock/caisse par des documents liés. Bonus physiques inclus dans la livraison ; prix et TTC préservés. Une vente livrée n'est pas automatiquement payée. |
| Commandes `commandes` | Devis/commandes et workflow `sale_management` / `sale_stock`. | Même commande officielle depuis MA2F et Odoo. Garder les informations d'appel et de tournée. Brouillon, confirmation, réservation et livraison doivent être des états distincts. |
| Clients `clients` | `res.partner`, tarifs et conditions de paiement. | Identifiants stables, pas de rapprochement aveugle par nom. Garder zone/GPS et ergonomie. Tester le blocage de crédit demandé : un avertissement standard n'est pas une interdiction. |
| Commerciaux `commerciaux` | Contacts, équipes commerciales et attribution des ventes. | Lire les ventes natives ; ne pas donner un accès back-office à tous les commerciaux. Commission MA2F par pack et paiement de commission restent à couvrir après étude des addons. |
| Livreurs `livreurs` | `fleet`, conducteurs, transferts et livraisons ; `stock_fleet`. | Réutiliser véhicules et affectation logistique. Historiser conducteur/tournée ; la remise d'espèces nécessite encore un rapprochement propre à MA2F. |
| Producteurs `producteurs` | Référentiel employé `hr.employee`, fabrication native. | Saisie rapide et écran Production appellent le même service. Attribution à plusieurs producteurs à compléter sans doubler la production. |
| Employés `employes` | `hr`, employés et départements. | Remplacer le référentiel parallèle. Le salaire informatif ne devient pas une paie ; aucune paie sénégalaise complète n'est promise. |
| Objectifs & primes `objectifs` | Données de ventes et indicateurs natifs ; examiner les objectifs standard avant extension. | Garder scénarios et présentation. Formaliser règles de primes, paliers, période et distinction acquis/versé ; couverture exacte non confirmée. |
| Dépenses `depenses` | Factures fournisseurs, paiements ; `hr_expense` pour notes de frais. | Classer les dépenses au lieu de tout traiter comme une sortie de caisse. Réutiliser l'approbation native des frais ; budgets spécifiques à examiner séparément. |
| Caisse `caisse` | Journaux, comptes, paiements et écritures `account`. | Remplacer les additions et déductions de tableaux MA2F. Séparer caisse, banque, mobile money et fonds chez le livreur ; transfert entre détenteurs sans nouvelle recette. |
| Créances `creances` | Soldes résiduels des factures, échéances et rapprochements. | Arrêter le calcul parallèle vente moins recouvrements. Reprendre les anciennes créances avec leurs preuves, sans inventer d'affectation. |
| Recouvrement `recouvrement` | Enregistrement de paiements et affectation aux factures. | Paiements partiels, trop-perçus et non-affectés explicites. Adapter Wave avec référence unique ; un callback répété ne crée pas un second paiement. |
| Réception rouleaux `livraisons` | `purchase`, `purchase_stock`, lots et réception en kg. | Cette rubrique concerne les fournisseurs, pas les livraisons clients. Séparer achat, réception, facture et paiement. Qualité : évaluer OCA avant développement bloquant. |
| Stock `stock` | Emplacements, lots, transferts, inventaires, retours et rebuts `stock`. | Supprimer le moteur de mouvements local comme autorité. Un « nouveau départ » devient un inventaire justifié. Tester `stock_no_negative` OCA avant écrire un blocage équivalent. |
| Réconciliation `reconciliation` | Pièces natives de transfert/livraison et paiements. | Garder une procédure de tournée reliant ces pièces : départ + rechargement − livré − pertes − retours = restant. Rapprocher séparément argent encaissé et remis. Ne pas recréer les mouvements. |
| Suivi logistique `suiviLogistique` | État des livraisons, lots de transferts et véhicules. | Garder carte et télémétrie hors du moteur critique. Une affectation réelle passe au serveur ; GPS/optimisation n'ont pas de couverture gratuite garantie. |
| Maintenance `maintenance` | `maintenance.equipment`, `maintenance.request`. | Remplacer les fiches d'intervention ; relier une seule pièce de dépense. Conserver pertes estimées et analyses comme hypothèses. |
| Versements `versements` | Paiement ou transfert comptable selon la nature. | Les données actuelles sont des sorties vers bénéficiaire : ne pas les convertir toutes en remises livreurs. Classifier avant reprise. |
| Apports de fonds `apports` | Écriture de financement et journal d'encaissement. | Contrepartie à qualifier ; aucune vente artificielle, aucun double encaissement avec le registre des actionnaires. |
| Actionnaires `actionnaires` | Contacts si utile ; écritures seulement sur décision financière explicite. | Garder le registre informatif restreint. Importer un mouvement informatif ne doit pas affecter la caisse. |
| Coût de revient `analytique` | `analytic`, valorisation stock et coûts de fabrication/comptabilité. | Remplacer le réalisé reconstruit depuis listes ; garder simulations. Méthode de valorisation et répartition à valider, consommation historique indépendante du rendement courant. |
| Véhicules `vehicules` | `fleet.vehicle`, entretien, coûts et affectations. | Remplacer le référentiel parallèle ; relier factures/dépenses pour éviter leur double comptage. GPS reste une extension. |
| Corbeille `corbeille` | Archivage, annulation, retour et avoir selon le document. | Retirer suppression/restauration brute des pièces validées. Les données libres peuvent conserver une corbeille classique. |
| Rapport `rapport` | Listes, pivots, graphiques et exports de données natives. | Garder les formats utiles ; tous les chiffres officiels viennent des pièces, avec période et filtres. Archive historique distincte jusqu'à reprise native rapprochée. |
| Stratégie & conseils `strategie` | Lecture autorisée des résultats réels. | Garder dans la partie libre. Aucune suggestion ne change automatiquement prix, stock ou comptabilité. Pas de service IA payant nécessaire à la gestion. |
| Journal `journal` | Chatter/activité natifs, références des documents. | Ajouter seulement la trace d'intégration : acteur MA2F vérifié, demande et résultat. Ne pas présenter un journal navigateur comme preuve d'exécution. |
| Paramètres `parametres` | Produits, unités, nomenclatures, taxes, tarifs et journaux. | Déplacer les paramètres officiels dans Odoo ; garder préférences d'affichage. Les règles financières spécifiques restent versionnées et protégées. |
| Clôture `cloture` | Comptes/journaux et verrouillage comptable. | Le comptage quotidien et la réouverture autorisée ne sont pas équivalents à une date de verrouillage. Évaluer une procédure libre existante ; pas de caisse POS imposée pour résoudre une tournée. |
| Historique modifs `historique` | Chatter pour champs suivis ; candidat OCA `auditlog`. | Remplacer les diffs client comme audit officiel. Définir modèles suivis, rétention, accès et attribution de l'acteur MA2F ; chatter seul non exhaustif. |
| Approbations `approbations` | Workflows propres aux achats/frais et droits natifs. | Réutiliser ces approbations avant un moteur générique. Si approbation spéciale, revalider montant, contenu, période et auteur à l'exécution. Extension OCA 19 générique non confirmée. |
| Comptabilité `comptabilite` | `account`, `l10n_sn`, `l10n_syscohada` ; rapports OCA candidats. | Retirer le grand livre TypeScript comme comptabilité officielle. Valider les états attendus avec le comptable ; localisation installée ne prouve pas conformité de toutes les pièces. |
| Monitoring `monitoring` | Diagnostic Odoo complété par surveillance des deux services et de la file. | Garder indicateur visible même sidebar fermée et erreur globale. Distinguer serveur joignable, identité valide, écritures actives et demandes en échec. |
| Sécurité `securite` | ACL, règles d'enregistrement, comptes techniques Odoo ; modules d'authentification natifs pour Odoo. | Garder contrôle serveur MA2F et accès humain Odoo unique. Pas de clé technique dans le navigateur. MFA différée selon décision ; aucun abonnement requis pour simplement conserver ces contrôles. |
| Sauvegardes `backups` | Sauvegarde PostgreSQL, pièces jointes et configuration Odoo. | Exploitation à conserver hors des règles métier. Sauvegarder aussi MA2F et la file ; tester restauration cohérente. Excel n'est pas une sauvegarde complète. Inclure filestore si utilisé ; vérifier les pièces stockées en DB dans ce déploiement. |
| Utilisateurs `utilisateurs` | Droits métier Odoo derrière l'intégration. | Conserver la décision comptes/sessions MA2F dans notre backend avec bibliothèque établie et liens privés à usage unique. Ne pas réintroduire Firebase/Clerk. Mutualiser avec l'identité Odoo serait un changement de conception à étudier, pas une migration implicite. |

Sources natives par domaine : [ventes](https://github.com/odoo/odoo/blob/19.0/addons/sale_management/__manifest__.py), [stock](https://github.com/odoo/odoo/blob/19.0/addons/stock/__manifest__.py), [achats](https://github.com/odoo/odoo/blob/19.0/addons/purchase_stock/__manifest__.py), [fabrication](https://github.com/odoo/odoo/blob/19.0/addons/mrp/__manifest__.py), [facturation](https://github.com/odoo/odoo/blob/19.0/addons/account/__manifest__.py), [localisation Sénégal](https://github.com/odoo/odoo/blob/19.0/addons/l10n_sn/__manifest__.py), [notes de frais](https://github.com/odoo/odoo/blob/19.0/addons/hr_expense/__manifest__.py), [maintenance](https://github.com/odoo/odoo/blob/19.0/addons/maintenance/__manifest__.py), [transport](https://github.com/odoo/odoo/blob/19.0/addons/stock_fleet/__manifest__.py), [catalogue Community](https://github.com/odoo/odoo/tree/19.0/addons). Les décisions MA2F dans la dernière colonne sont notre analyse des besoins, pas des promesses des éditeurs.

## Extensions libres : présélection vérifiée, pas installation

Suivi ultérieur : les candidats ont maintenant été installés et soumis à une recette
isolée. Voir [les résultats du pilote](COMMUNITY-PILOT-RESULTS.md) pour distinguer
ces résultats de l'état initial de cet audit et de la production inchangée.

| Candidat | Vérification du manifeste 19.0 | Décision |
|---|---|---|
| [stock_no_negative](https://github.com/OCA/stock-logistics-workflow/blob/19.0/stock_no_negative/__manifest__.py) | 19.0.1.0.0, AGPL-3, dépend de `stock`, installable. | Essayer blocage de stock négatif sur ventes simultanées, production, retours et inventaires ; configurer exceptions explicitement. |
| [auditlog](https://github.com/OCA/server-tools/blob/19.0/auditlog/__manifest__.py) | 19.0.2.0.0, AGPL-3, dépend de `base`, installable. | Essayer sur modèles critiques avant développer un audit équivalent ; vérifier volumétrie et absence de secrets dans les traces. |
| [account_financial_report](https://github.com/OCA/account-financial-reporting/blob/19.0/account_financial_report/__manifest__.py) | 19.0.0.0.21, AGPL-3, dépend de `account`, `date_range`, `report_xlsx`. | Candidat grand livre, balance, écritures ouvertes et balance âgée. Vérifier dépendances et résultats locaux avant adoption ; ne garantit pas tous les états réglementaires. |
| [quality_control_oca](https://github.com/OCA/manufacture/blob/19.0/quality_control_oca/__manifest__.py) | 19.0.1.0.0, AGPL-3, dépend de `product`, installable. | Socle de tests qualité. Ne prouve pas qu'une réception ou fabrication sera bloquée : raccordement et recette nécessaires. |
| Commissions et approbation générique | Les chemins testés `OCA/commission/19.0/sale_commission` et `OCA/server-ux/19.0/base_tier_validation` n'ont pas retourné de manifeste. | Compatibilité non établie pour ces candidats précis. Ce résultat ne prouve pas absence de toute alternative ; poursuivre la recherche avant développer ou changer de version Odoo. |

La disponibilité d'un manifeste ne valide ni la maintenance future, ni l'installation dans notre version épinglée, ni toutes les dépendances. Avant adoption : épingler un commit, lire licence et dépendances, examiner tests/activité de maintenance, puis essayer installation, mise à jour et désinstallation/restauration en pilote. Aucun addon OCA installé par cet audit.

## Code à conserver, remplacer et retirer

| Élément actuel | Traitement |
|---|---|
| `client/src/contexts/AppContext.tsx`, calculs stock/caisse dans `lib/helpers.ts` et `lib/stock.ts` | Remplacer les écritures et calculs officiels par des résultats Odoo. Conserver seulement cache de lecture et présentation nécessaires. |
| `client/src/lib/exportComptable.ts` | Retirer comme générateur du grand livre officiel après rapprochement ; exporter les écritures Odoo. |
| `server/orderRoutes.ts`, `orderWorker.ts`, `productionWorker.ts`, `commandOutbox.ts` | Conserver la frontière d'authentification, commandes limitées et reprises sans doublon. Aucun moteur parallèle de taxe ou de stock ; déléguer aux workflows Odoo. |
| `deployment/odoo-core/addons/ma2f_core` | Garder un addon petit, revu et testé pour les lacunes réelles. Réexaminer chaque règle face au standard/OCA avant mise en production. |
| `x_ma2f_sale_history` et scripts d'import | Conserver la provenance en archive. Après reprise native vérifiée, faire des menus et rapports natifs l'accès principal ; ne jamais additionner archive et ventes recréées. |
| Authentification backend préparée | Terminer comptes, rôles, sessions et liens privés ; réutiliser la bibliothèque existante, pas écrire une cryptographie ou gestion de mots de passe artisanale. |
| Firebase SDK, Cloud Functions, règles, sauvegardes et Clerk transitoire | Retirer après remplacement de tous les chemins, dernier delta et preuve qu'un ancien client ne peut plus écrire. Ne pas supprimer la source avant validation de la reprise. |
| Cartes, stratégie, présentation, indicateur Odoo | Garder dans MA2F avec accès limité ; expérimentation sans écriture directe dans la base Odoo. |

## Parcours cible et ce que verra l'utilisateur

Une commande MA2F passe par notre backend authentifié, une demande durable identifiée, puis le workflow Odoo. MA2F affiche « en attente » jusqu'au résultat vérifié. La confirmation appelle les règles natives et réserve selon les règles configurées ; livraison, facturation et paiement restent des opérations liées distinctes. En cas de timeout, la même demande retrouve son résultat. Un refus Odoo ne déclenche jamais une validation locale de secours.

Les nouvelles commandes doivent apparaître dans les écrans natifs de commandes Odoo et dans MA2F avec le même identifiant. Aujourd'hui, ce branchement n'est pas en service. L'archive historique reste clairement nommée tant que les anciennes ventes ne sont pas recréées dans les modèles natifs. Leur reconstruction ne doit pas ressortir une deuxième fois le stock ni doubler les soldes d'ouverture.

Pour ajouter du stock : réception fournisseur pour les rouleaux ; fabrication pour les packs produits ; ajustement d'inventaire pour une correction physique justifiée. MA2F pourra proposer ces formulaires simplifiés, tous exécutés par Odoo. Pas de bouton qui change directement un total isolé.

## Ordre d'exécution et critères de fin

1. **Recette standard et extensions en pilote.** Configurer emplacements, packs, nomenclature/consommation, utilisateurs techniques, journaux et flux de tournée. Tester les candidats OCA utiles avant développer leurs équivalents. Passage : achat → réception → fabrication nette → livraison partielle/retour, sans doublons ni stock incohérent.
2. **Identité native MA2F.** Activer les profils revus, conserver la quarantaine des correspondances ambiguës, tester création/récupération par lien privé, expiration, révocation et droits serveur. Passage : chaque rôle réussit seulement ses actions autorisées ; un administrateur MA2F n'obtient pas implicitement le back-office Odoo.
3. **Parcours commercial complet.** Terminer confirmation/réservation/livraison en réutilisant les méthodes natives. Le connecteur brouillon actuel exige une taxe TTC explicite : il reste fermé tant que le vrai paramétrage n'est pas connu. Tester montant exact, répétition simultanée, timeout, stock insuffisant, retour et permissions révoquées.
4. **Reprise historique et financière.** Obtenir le taux et les qualifications nécessaires ; préserver tous les TTC source. Produire une reprise à blanc avec correspondances et exceptions, puis rapprochement par période, quantité, montant et document. Aucune correction d'anomalie sans contexte. Passage : aucune double facture, aucun double mouvement avec les ouvertures ; origine retrouvable.
5. **Bascule Firebase.** Capturer le dernier delta, arrêter les écritures source au point convenu, importer et vérifier les totaux, basculer les formulaires et callbacks. Passage : ancien navigateur rejeté, lecture/écriture native testée, absence de chemin métier Firebase/Clerk restant et archive source conservée.
6. **Exploitation.** Vérifier les deux déploiements, files et sauvegardes ; tester restauration et panne Odoo avec message global. Lever la neutralisation uniquement après inventaire des automatismes et configuration prête. Passage : aucune confirmation fictive pendant panne, reprise sans doublon et restauration documentée.

## Absence de dépendance commerciale imposée

Le socle [Odoo Community est publié sous LGPL-3](https://github.com/odoo/odoo/blob/19.0/LICENSE) ; les candidats OCA ci-dessus déclarent AGPL-3. Aucun abonnement Enterprise, Studio ou module propriétaire n'est sélectionné ici. Respecter les obligations des licences lors de modification et distribution ; la licence libre ne signifie pas absence d'obligations.

Éviter les options qui dépendent d'un service facturé : OCR externe, enrichissement de contacts, SMS/WhatsApp, connecteurs bancaires, géocodage ou optimisation hébergée, paiements en ligne. Leur code d'intégration peut être public tout en consommant un service payant. La saisie manuelle et les workflows essentiels doivent fonctionner sans ces services. Les frais déjà autorisés de Replit/base/usage restent distincts.

Pour conserver la possibilité de changer d'hébergeur : code et versions épinglées dans le dépôt, sauvegardes exportables PostgreSQL et pièces jointes, configuration documentée, secrets séparés. Garder nos extensions hors du cœur amont. La clôture de cet audit ne prétend ni supprimer tous les écarts fonctionnels ni terminer la migration : elle fixe précisément ce qui doit être repris avant chaque développement.
