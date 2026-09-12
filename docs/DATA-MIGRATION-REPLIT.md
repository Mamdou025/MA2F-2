# Copie de migration MA2F vers PostgreSQL

État : copie source chargée et vérifiée dans la base de développement Replit. L'application reste sur Firebase ; aucune bascule opérationnelle ni import Odoo n'est effectué.

## Source et périmètre

Projet Firebase `ma2f-aquasachet`, lecture cohérente au `2026-09-08T03:29:06.380188Z`. Inventaire : 24 collections racines. Export : **11 178 documents dans 20 collections**, avec les valeurs Firestore typées, chemins et dates source conservés.

Archive privée `business-source-20260908.json.gz` : 1 259 551 octets, 10 953 896 octets décompressés. SHA-256 : `82afd0419934a23a5d48ccd31615347ac5c1655ff93063ef6b19ff7b440cb548`.

| Collection | Documents |
|---|---:|
| ventes | 1 017 |
| clients | 218 |
| commandes | 213 |
| depenses | 388 |
| production | 48 |
| recouvrements | 148 |
| mouvements_stock | 628 |
| apports / versements | 11 / 11 |
| livraisons / emballages | 5 / 5 |
| audit_log / history / journal | 695 / 3 412 / 3 916 |
| corbeille | 453 |
| reconciliations / stock_controles | 3 / 3 |
| business / meta / params | 1 / 2 / 1 |

Les collections racines `users`, `backups`, `backups_auto` et `backup_logs` ne font pas partie de cet export opérationnel : identités suivies séparément et archives/liens de sauvegarde exclus. Les documents historiques `business/data` et `meta/data` conservent néanmoins leurs champs imbriqués, dont des listes utilisateurs ; ils doivent rester privés et ne sont pas une source d'autorisation. Les sous-collections et les fichiers Cloud Storage ne sont pas encore inventoriés. Ne pas qualifier cette copie de sauvegarde exhaustive du projet Firebase.

## Destination et contrôles

La base Replit existante comportait 11 tables `public` de l'ancienne application. Le nouveau schéma `ma2f_migration` contient seulement `source_runs` et `source_documents` ; aucune table historique n'est remplacée. Les privilèges PUBLIC sur ce schéma et ses tables sont retirés. Ce schéma est une zone de préparation, pas la base Odoo ni le modèle métier final.

`deployment/migration-staging.sql` crée la structure. `scripts/import_business_source.mjs` est volontairement lié à cette archive et au runtime Replit existant. Sans `--apply`, il vérifie l'archive, les chemins, les doublons et les compteurs. Avec `--apply`, il charge par lots dans une transaction sous verrou, relit chaque document et compare son contenu intégral avant validation. Une erreur annule la transaction.

Résultats réels : premier import 11 178 documents vérifiés ; seconde exécution 11 178 documents retrouvés (`reused: true`), sans doublons. Le statut SQL est `verified`. L'archive et les rapports résident dans `ma2f-next/migration-private`, ignoré par Git ; une copie source reste dans le Cloud Shell privé. Le récepteur HTTPS temporaire, limité à cette empreinte et cette taille, a été retiré après transfert ; la configuration Vite précédente a été restaurée puis renforcée pour refuser `**/migration-private/**`.

## Conversions restant à faire avant utilisation

Contrôles HTTP complémentaires : accès à l'archive privée et au dossier de profils refusé avec 403 ; page d'accueil à 200. La compilation TypeScript sur Replit passe après le renforcement de Vite.

- Comparer les 3 clients de `business/data` aux 218 documents clients ; ne pas fusionner ou écarter silencieusement ces sources.
- Reprendre les registres imbriqués de `meta/data` : 5 employés, 3 livreurs, 2 producteurs, 2 actionnaires, 3 véhicules, 4 commerciaux, 1 maintenance et 2 156 entrées de chaîne d'audit.
- Les 213 commandes sont dans leur collection ; le tableau historique `meta/data.commandes` est vide. Le modèle cible doit tenir compte de cette migration déjà réalisée.
- Définir les tables métier, contraintes et références ; rapprocher stocks, unités, soldes et paiements. Ne pas convertir les historiques de production en supposant qu'ils utilisent tous la règle actuelle des packs nets de 30 sachets.
- Appliquer les autorisations Clerk aux vrais endpoints métier, migrer les pièces jointes nécessaires et préparer une reprise des modifications intervenues après l'instantané.
- Tester les parcours, sauvegarde/restauration et bascule avant retrait de Firebase. Aucune donnée réelle n'a encore été injectée dans le pilote Odoo.

## Conversion clients et commandes préparée

Le schéma `ma2f_next` contient désormais les tables **inactives de préparation** `clients`, `orders` et `customer_order_reviews`. 218 clients et 213 commandes ont été chargés puis intégralement relus et comparés au plan. La relance conserve les mêmes lignes. Les clés composites instantané/identifiant préservent l'historique et les liens clients résolus ont une contrainte de clé étrangère. Aucun endpoint applicatif ne lit encore ces tables ; elles ne remplacent pas le cœur fonctionnel Odoo prévu.

Résultats de rapprochement :

- 115 commandes ont un identifiant client présent dans les 218 fiches.
- 95 commandes référencent 82 identifiants clients absents. Leur identifiant source reste conservé ; la relation SQL résolue est vide et marquée `missing`.
- 3 commandes sans identifiant client restent `unlinked`, ce que le formulaire historique autorisait.
- 11 groupes de numéros de commande sont dupliqués, soit 22 commandes concernées. Les numéros restent inchangés et les identifiants distincts sont conservés.
- 76 propositions de rapprochement disposent d'une correspondance unique nom/téléphone ; elles sont stockées avec `approved: false`. Aucune proposition n'a été appliquée.
- Les 3 anciens clients de `business/data` ne correspondent ni aux identifiants actuels ni aux identifiants manquants des commandes. Ils restent dans le dossier de revue, sans être réactivés ni supprimés.

Le dossier complet et ses compteurs sont dans `ma2f_next.customer_order_reviews`, avec `activation_allowed = false`, et dans le fichier privé `migration-private/customers-orders-plan.json`. La source brute précédente reste intacte.

Sur Replit, `scripts/prepare_customers_orders.py` prépare le plan, `scripts/import_customers_orders.mjs` le charge transactionnellement et vérifie chaque ligne, et `scripts/test_prepare_customers_orders.py` comporte six tests réussis (liens exacts/manquants/absents, numéros dupliqués, packs invalides, types Firestore inconnus). Ces nouveaux scripts sont encore spécifiques au checkout Replit et doivent être rapatriés lors de la conciliation des sources. Le DDL `deployment/customers-orders.sql` est présent dans les deux copies.

La suite reste la revue des anomalies, la conversion ventes/paiements/stock/autres registres, les imports natifs Odoo et le branchement des autorisations serveur avant bascule. Les tests de cette étape ne prouvent pas que ces parcours sont déjà migrés.

## Conversion ventes, encaissements, stock et production préparée

Quatre tables supplémentaires dans `ma2f_next` : `sales` (1 017), `recoveries` (148), `stock_movements` (628), `production_batches` (48). Le chargement transactionnel compare toutes les colonnes et le payload source de chaque ligne relue. Le dossier `finance_stock_reviews` reste avec `activation_allowed = false`. Ces tables ne sont ni un moteur comptable maison actif ni des mouvements Odoo.

Anomalies conservées :

- 14 ventes sans numéro : colonne nullable, identifiant historique conservé, aucun numéro inventé. La première tentative a été entièrement annulée par la contrainte NOT NULL ; la conversion a été adaptée sans supprimer ces ventes.
- 29 encaissements sans vente correspondante dans l'instantané, total **327 250 FCFA**. Leur référence source est conservée, mais aucune clé étrangère n'est attribuée par nom ou numéro de bon. Les 119 autres encaissements ont un lien vérifiable.
- 83 mouvements de stock sans unité ni emplacements source/destination, conservés pour revue. Les autres indiquent 476 mouvements en packs et 69 en kg. Aucun kg n'a été converti automatiquement en packs et aucun mouvement n'a été rejeté silencieusement.

Rapprochement de calculs sur l'instantané : montant des ventes 14 895 880 FCFA ; encaissement initial calculé selon `cashAtSale` historique 12 748 480 FCFA ; recouvrements liés 1 567 000 FCFA ; tous recouvrements 1 894 250 FCFA ; reste calculé selon `resteVente` 580 400 FCFA. **Ce reste n'est pas une créance certifiée**, notamment à cause des paiements non rapprochés. Ce calcul ne représente pas le solde global de caisse (dépenses, apports et autres flux ne sont pas déduits ici).

`tests/financeStockParity.mjs` a comparé chaque vente avec les véritables fonctions historiques `cashAtSale`/`resteVente` de Replit : les 1 017 comparaisons concordent. Les cinq positions non nulles calculables concordent avec `calculerStockParEmplacement`, sans mélanger les unités. Cela reproduit le comportement historique, qui ne peut pas affecter les 83 mouvements sans emplacements ; cela ne certifie pas le stock physique. Les calculs financiers intermédiaires utilisent Decimal et les colonnes SQL numeric.

Le rapport privé final est `migration-private/finance-stock-review-v2.json` (première version conservée). Scripts Replit : `scripts/prepare_finance_stock.py`, `scripts/import_finance_stock.mjs`, `tests/financeStockParity.mjs`. Ils doivent être rapatriés lors de la conciliation des sources ; le DDL `deployment/finance-stock.sql` est déjà présent localement. Dépenses (388), apports (11), versements (11), livraisons (5) et emballages (5) sont inventoriés et restent dans la copie source ; ils n'ont pas encore leurs tables de conversion à cette étape.

Restent les autres flux de caisse et registres, la résolution documentée des anomalies, les soldes d'ouverture/quantités validés puis les imports natifs Odoo, les fichiers et sous-collections et la bascule applicative. Firebase reste la source opérationnelle.

## Caisse : conversion préparée le 8 septembre 2026

`ma2f_next.cash_events` contient maintenant 410 candidats inactifs : 388 dépenses, 11 apports et 11 versements. Les identifiants et payloads sont conservés. `cash_reviews.activation_allowed` reste faux. Import transactionnel, relecture complète de toutes les colonnes et du rapport, puis répétition sans doublons : contrôles réussis. Aucune écriture comptable Odoo ni bascule opérationnelle.

Totaux FCFA : dépenses 10 822 216 ; apports 1 513 500 ; versements 5 316 500. Les paramètres `meta/data` et `params/global` concordent sur une ouverture de 297 023 ; l'ancien `business/data` indique 0. Le calcul historique donne respectivement 314 537 et 17 514 FCFA. Les trois scénarios sont conservés, sans choisir silencieusement une source. Ce solde reste provisoire.

`tests/cashParity.mjs` sur Replit compare ces trois scénarios à la véritable fonction `computeSoldeCaisseAuDate`, avec des cas supplémentaires de limite de date et de déduplication des frais véhicule/maintenance : tous passent. La préparation utilise Decimal et PostgreSQL numeric.

Points à rapprocher : 383 dépenses sans mode de paiement (les 5 autres en espèces), 3 versements Banque et 8 Personne à distinguer lors du mapping Odoo, couverture des paiements fournisseurs par les dépenses non vérifiée. Le calcul historique ne déduit pas directement les 5 livraisons et 5 achats d'emballages ; les déduire en plus pourrait compter deux fois une dépense. Les 29 recouvrements sans vente restent inclus comme dans l'ancienne caisse. La seule maintenance intégrée a un coût nul ; aucune opération véhicule intégrée.

Rapport privé : `migration-private/cash-review.json`. Scripts Replit : `scripts/prepare_cash.py`, `scripts/import_cash.mjs`, `tests/cashParity.mjs` restent à rapatrier lors de la conciliation des sources. Le DDL `deployment/cash.sql` est local et distant. Firebase reste actif. Prochaine étape : rapprochement des anomalies et paiements fournisseurs, validation des soldes et stocks avant import natif Odoo.
