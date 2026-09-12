# État de vérification — 7 septembre 2026

Suivi Community du 10 septembre : [installation et recette des extensions libres](../docs/COMMUNITY-PILOT-RESULTS.md)
dans une nouvelle base isolée, avec commits épinglés et lanceurs reproductibles.
Les paragraphes ci-dessous conservent les résultats historiques du premier pilote.

## Exécution réelle réussie

Docker Desktop reste défaillant, mais le blocage du pilote est levé : Docker Engine 29.1.3 et Compose 2.40.3 sont installés dans Ubuntu 24.04 sous WSL. Utiliser `powershell -NoProfile -File pilot/manage-wsl.ps1 <action>`. Le contexte Docker Windows n'a pas été remplacé. Les anciens répertoires de sockets sauvegardés restent conservés.

Odoo Community 19, PostgreSQL et les addons sont installés dans les images épinglées. Le pilote est accessible depuis Windows sur `http://127.0.0.1:18069/odoo`. Les écritures sont **désactivées** à la fin de la recette.

| Vérification exécutée | Résultat observé |
|---|---|
| `check` | Articles et stocks lus dans Odoo via HTTP / JSON-2 ; appel anonyme refusé. |
| `scenario` | Réception 10 kg, fabrication 300 unités / 0,5 kg, sortie 100, retour 10 ; +210 unités et +9,5 kg ; lecteur sans écriture. Rollback. |
| `commands-test` | 11 contrôles natifs : droits, activation, quantités, identité non falsifiable, stock insuffisant, consommation réelle, répétition sans doublon, conflit et annulation après panne. Rollback. |
| `business-test` | Achat 2 kg, facture fournisseur 2 000 XOF, fabrication, chargement camion 120 unités, vente/livraison 100, facture 1 000 XOF, paiement 600, retour invendus 20 et client 10, avoir explicite 100 et paiement final 300. Stock final relatif : +210 unités / +1,5 kg ; créance finale nulle. Rollback. |
| `lots-test` | Lot plastique lié au lot fabriqué ; expiration fictive 90 jours ; rebut de 10 unités identifié par lot ; 290 unités disponibles. Rollback. |
| `live-test` | Six appels HTTP simultanés avec le même UUID créent un seul ordre. Reprise après résultat ignoré sans doublon. Quantités modifiées refusées. Deux appels distincts concurrents face à un stock insuffisant : une réussite, un refus. Vérification native du stock et du registre ; écritures refermées. |
| `backup-test` | Archive native Odoo SQL + filestore, SHA-256, restauration dans une nouvelle base neutralisée ; comparaison des comptes de 7 modèles et du contenu d'une pièce jointe. Base d'origine préservée et services redémarrés. |
| Tests locaux | 20 tests unitaires HTTP/contrat réussis ; Odoo simulé pour ces tests uniquement. |

Les erreurs de sérialisation présentes dans les journaux du test concurrent sont attendues : le gestionnaire de transactions Odoo effectue la reprise, puis les réponses finales et les quantités sont contrôlées. Ce test local ne constitue pas une mesure de capacité en production.

## Défauts corrigés par la recette réelle

- Les mouvements de produits finis ne sont plus marqués produits avant clôture : Odoo calcule ces quantités lui-même depuis `qty_producing`. L'ancienne séquence aboutissait à un ordre annulé.
- Le contrat partagé est monté dans `/opt/contract` ; un montage de fichier sous `/app` déjà en lecture seule empêchait le démarrage.
- Nginx fournit les ports locaux via un réseau d'entrée distinct. Odoo, passerelle et PostgreSQL restent sur le réseau interne ; seul Nginx possède aussi le réseau d'entrée.
- Les API Odoo génériques et le gestionnaire de bases ne sont pas accessibles via le port administrateur Nginx. Le connecteur contacte JSON-2 sur le réseau interne.
- Syntaxe `--without-demo=True` adaptée à Odoo 19 ; scénario achats adapté au champ `tax_ids`.
- Le lanceur Windows conserve une session WSL discrète pendant l'usage du pilote ; `stop` arrête aussi cette session appartenant au pilote.

## Données et preuves

Les rapports et sauvegardes sont dans `.local/`, ignorés par Git. `live-test` conserve volontairement ses réceptions et fabrications fictives pour contrôler les transactions réellement validées. `backup-test` conserve son archive, une pièce jointe fictive et une base restaurée distincte. Ces commandes ne sont donc pas des tests sans écriture ; elles ne touchent que le pilote. Les autres scénarios métier annulent leurs opérations par rollback.

La restauration vérifie les enregistrements présents, pas toutes les formes de pièces jointes ou de données possibles. La sauvegarde reste locale ; copie distante, rétention, chiffrement et exercices sur un serveur de production restent à préparer.

## Reste avant une migration réelle

- Pack de 30 sachets et production nette vendable confirmés : voir `MA2F-BUSINESS-RULES.md`. Conversion préparée, 4 tests supplémentaires réussis (24 tests locaux au total). Raccorder cette règle à la commande avec rebuts ; préciser les emplacements et les règles de trésorerie. Le choix de l’administrateur est reporté par l’utilisateur.
- Raccorder l'identité Firebase et les permissions des salariés au connecteur ; remplacer les jetons fictifs, journaliser l'acteur humain, activer MFA et restriction d'accès administrateur.
- Implémenter les contrats MA2F achats/livraisons/ventes/facturation/paiements/retours et la production avec lots/rebuts. Les scénarios prouvent les fonctions **natives Odoo**, pas leur raccordement aux écrans MA2F.
- Traiter commissions, primes, clôtures, approbations et reprises Wave ; nettoyer puis migrer les données historiques avec rapprochement.
- Créer les deux interfaces et leurs pipelines indépendants après le backend, conformément au choix de l'utilisateur.
- Choisir/configurer l'hébergement, sauvegardes distantes et supervision ; recette utilisateurs puis bascule explicite avec fermeture des anciennes écritures.

Aucune fonction de l'application Firebase actuelle n'a été basculée sur Odoo. Aucun déploiement de production n'a été effectué.

## Raccordement production/stock MA2F — lot packs nets

Implémenté et exécuté dans le pilote : `POST /v1/ma2f/production`, `GET /v1/ma2f/stock`, client backend `ma2f_client.py` et entrée opérateur locale `ma2f.py`. Aucun écran Firebase, webhook ni donnée de production n'est modifié. Le compte humain Odoo réel reste à désigner plus tard.

- **32 tests locaux** réussis : nouveaux contrats, champs interdits, limites, droits HTTP, résultat réseau inconnu et conservation de l'UUID, en plus des tests précédents.
- **15 contrôles natifs** réussis dans `commands-test`, dont 100 packs nets + 12 rejets = 3 012 fabriqués, 12 mis au rebut et 3 000 ajoutés au stock vendable. Échec injecté à la mise au rebut : annulation de la fabrication déjà clôturée, des consommations, du rebut et du registre. La lecture respecte une réservation de 45 sachets et restitue les packs complets + sachets restants. Ces opérations sont annulées par rollback.
- **`packs-live-test` réussi** via le vrai client backend MA2F, HTTP, passerelle, JSON-2, Odoo et PostgreSQL : 6 appels simultanés, un ordre et un rebut, +100 packs nets, refus du lecteur et conflit si les rejets changent avec le même UUID. Les données fictives de ce test restent dans le pilote. Écritures désactivées en fin de test.
- La route historique en unités reste compatible ; les empreintes distinguent les contrats pour éviter de réutiliser un UUID avec un autre sens.

Ce lot couvre le stock de l'emplacement usine du pilote et des articles sans suivi par lot. Le raccordement de la traçabilité par lots, des producteurs, dates métier et machines, puis de l'identité réelle et des écrans, reste à réaliser. Le scénario natif avec lots précédemment réussi ne signifie pas que cette nouvelle commande accepte des lots.
