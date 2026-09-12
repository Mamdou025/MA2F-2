# MA2F — premier pilote Odoo Community

Ce dossier prépare un environnement local indépendant de l'application Firebase existante. Le backend de production en packs et lecture du stock est raccordé au pilote. Aucun écran existant n’est encore raccordé et aucune donnée réelle n’est importée. Voir `MA2F-PRODUCTION-STOCK.md`.

## Démarrage

Prérequis : Python 3.11+, Docker Engine Linux et Docker Compose. Sur ce poste, utiliser le moteur Ubuntu WSL indépendant de Docker Desktop via `powershell -NoProfile -File pilot/manage-wsl.ps1 <action>`. Le lanceur garde WSL actif avec un processus discret dédié, terminé par `stop`. Les images sont épinglées par digest. Le téléchargement initial nécessite Internet. Ports locaux requis : 18069 et 18080.

Depuis la racine du dépôt :

```powershell
python pilot/manage.py prepare
python pilot/manage.py init
python pilot/manage.py check
python pilot/manage.py scenario
python pilot/manage.py commands-test
python pilot/manage.py business-test
python pilot/manage.py lots-test
python pilot/manage.py live-test
python pilot/manage.py backup-test
```

`init` installe les modules et remplace le compte administrateur initial avant d'exposer Odoo. Si le pilote est déjà initialisé, utiliser `python pilot/manage.py up`. Après ajout/modification d'un addon, `python pilot/manage.py upgrade` arrête Odoo et le connecteur, applique les modules, actualise les identités techniques et redémarre avec les écritures désactivées. Commandes supplémentaires : `status` et `stop`. L'arrêt conserve les volumes ; ne pas employer `docker compose down -v`, qui effacerait le pilote.

Les identifiants générés se trouvent dans [ACCESS.txt](C:/Users/Mamad/Downloads/ma2f-aquasachet-main/ma2f/pilot/.local/ACCESS.txt), exclu de Git. Le compte humain fictif est `pilote.admin`, sans présumer l'identité du futur administrateur de production. L'interface sera accessible sur [Odoo local](http://127.0.0.1:18069/odoo) après initialisation réussie.

## Données et modules

- Société fictive MA2F, Sénégal, XOF, localisation Sénégal/SYSCOHADA chargée. Ceci ne vaut pas validation comptable.
- Articles plastique en kg et sachet à l'unité. Conditionnement confirmé : 30 sachets par pack et production saisie nette vendable. La commande de production en packs nets, avec rebuts séparés, est raccordée au pilote Odoo (voir `MA2F-BUSINESS-RULES.md`).
- Nomenclature de test : 300 sachets pour 0,5 kg. **Ratio inventé pour les tests, jamais un rendement réel MA2F.**
- Modules stock, achats, ventes/livraisons, fabrication, dates, facturation/valorisation, localisation et leurs dépendances.
- Un compte humain administrateur ; identités techniques lecture et production séparées, sans mot de passe configuré. Le lecteur n'a pas les droits de production. Le compte production possède les droits natifs nécessaires ; sa clé doit rester privée côté serveur.
- Clé API technique valable 30 jours ; rotation administrée à prévoir avant un usage durable.

Le scénario exécute une réception de 10 kg, une fabrication de 300 sachets consommant 0,5 kg, une sortie de 100 sachets et un retour de 10 sachets. Attendu : variation de +210 sachets et +9,5 kg. **Les changements métier sont annulés par rollback**, sur succès comme sur échec ; les compteurs de séquence peuvent avancer. Résultat de succès : `.local/scenario-result.json`. Ce scénario ne modifie donc pas les quantités préexistantes.

Les recettes `business-test` et `lots-test` couvrent aussi les fonctions natives d'achat, facture, encaissement, avoir, lots, expiration et rebuts, avec rollback. `live-test` conserve ses données fictives pour vérifier les transactions HTTP concurrentes. `backup-test` suspend les services, archive SQL + filestore et restaure dans une nouvelle base neutralisée ; il conserve archive et base restaurée. Les sauvegardes contiennent aussi les identifiants internes : elles restent privées dans `.local/backups/`. Voir `VERIFICATION.md` pour les résultats et limites.

## Connecteur local : lectures et production désactivée par défaut

| Route | Comportement |
|---|---|
| `GET /health` | Disponibilité du processus ; ne prétend pas qu'Odoo est disponible. |
| `GET /v1/pilot/products` | Jeton requis ; articles fictifs du pilote ; maximum 100 lignes. |
| `GET /v1/pilot/stock` | Jeton requis ; stock interne des articles du pilote ; maximum 100 lignes. |
| `GET /v1/ma2f/stock` | Stock usine Odoo, réservations, packs complets disponibles et sachets restants ; jeton lecture requis. |
| `POST /v1/ma2f/production` | Packs nets de 30 sachets, rebuts à l’unité, kg réellement consommés ; transaction native et jeton production. |
| `POST /v1/pilot/production` | Clé de production distincte et activation explicite requises ; recette native préalable obligatoire. |
| Autres POST, PUT/PATCH/DELETE | Refusés. |
| Autre route ou paramètre | Refusé ; aucun accès générique aux modèles Odoo. |

Les clés client pilote et Odoo sont distinctes. La clé Odoo reste côté serveur. PostgreSQL n'expose aucun port. Nginx publie Odoo et le connecteur sur `127.0.0.1` uniquement. Les trois services métier restent sur le réseau Docker interne ; seul Nginx rejoint aussi le réseau d’entrée. Les API génériques Odoo restent internes et le gestionnaire de bases est bloqué sur le port administrateur. Le connecteur s'exécute sans privilèges, avec système de fichiers en lecture seule. Aucune configuration Firebase ou Wave n'est utilisée.

Le jeton statique local est réservé aux vérifications et ne doit jamais être embarqué dans un frontend public. Le serveur HTTP Python standard est réservé au pilote local. Vérification d'identité Firebase, droits par salarié, proxy/MFA administrateur, suivi des acteurs et limites de charge font partie des lots suivants.

## Vérifications et prochaine étape

```powershell
python -m unittest discover -s pilot/gateway -p "test_*.py" -v
docker compose -f pilot/compose.yaml config --quiet
python pilot/manage.py check
python pilot/manage.py scenario
```

Les tests unitaires utilisent un faux service Odoo et vérifient les frontières HTTP. `check` et `scenario` demandent un vrai pilote initialisé.

Les fichiers sont sur une branche dédiée. La séparation de services existe dans Compose ; les dépôts et pipelines indépendants de la cible ne sont pas encore créés. Aucun workflow ne déploie ce pilote lors d'un changement du frontend.

Un second lot ajoute une commande de production transactionnelle désactivée par défaut. Son contrat, les permissions, les reprises et l'activation après tests sont décrits dans [PRODUCTION-API.md](C:/Users/Mamad/Downloads/ma2f-aquasachet-main/ma2f/pilot/PRODUCTION-API.md). La validation native et concurrente est réussie dans le pilote WSL ; elle ne vaut pas mise en production.

Après recette du socle : confirmer les paramètres métier et raccorder les contrats MA2F aux fonctions natives éprouvées. L'interface sera traitée après les changements backend, conformément au choix de l'utilisateur.
