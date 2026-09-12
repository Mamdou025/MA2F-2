# MA2F-Odoo-Core — hébergement du service séparé

Projet Replit : https://replit.com/@Mamdou025/MA2F-Odoo-Core
Nom affiché : MA2F-Odoo-Core. Le lien canonique renommé a été observé dans Replit.

Ce dossier contient les scripts d'installation et de vérification du service Odoo séparé.
Aquasachets conserve la partie personnalisable et ses accès métier actuels.

## État vérifié le 9 septembre 2026

**Hébergement public opérationnel, vérifié à 14 h 29 UTC.** Publication
`5461e6d0-49a0-407b-a7a6-412a88b9df28` : connexion HTTP 200, trois ressources
CSS/JavaScript normales et trois ressources de débogage nouvellement générées
HTTP 200, inscription masquée, admin/admin refusé. Preuve locale :
`.local/public-readiness-result.json`. Cela valide l'hébergement verrouillé ;
l'administrateur désigné et l'intégration métier réelle restent à configurer.

Le service public `https://ma2f-odoo-mamdou025.replit.app` a démarré avec la publication
`9ef141f4` après ajout des dépendances Python dans `replit.nix`. La page de connexion
répond HTTP 200 et admin/admin est refusé. Une dépendance manquante de libsass
(`libstdc++.so.6`) empêchait toutefois le chargement CSS. Elle est maintenant déclarée
dans les deux environnements Nix et chargée par `start.sh` depuis le chemin enregistré
à l'installation. Le test temporaire valide les trois ressources CSS/JavaScript.
Ce dernier correctif est publié et sa vérification publique a réussi.

L'utilisateur a accepté la VM réservée 0,5 vCPU / 2 Gio à 15 $/mois, plus les frais
de base de données et d'usage. La condition initiale de plafond total est remplacée.
Aucun accès administrateur MA2F ou Odoo n'a été activé.

Le lanceur `start.sh` → `start_production.py` a passé un nouveau test contre la vraie
base `ma2f_odoo` : connexion HTTP 200, inscription masquée, admin/admin refusé,
serveur temporaire arrêté. Neuf modules requis installés, comptes internes inactifs,
aucun mouvement métier importé. Le rôle `odoo_core_prod` reste sans superutilisateur,
création de bases/rôles, réplication ou contournement RLS. Connexion TLS vérifiée.

Replit n'a pas conservé le secret d'une publication inachevée. L'identifiant d'exécution
a été renouvelé avec les mêmes droits ; sa copie temporaire a été supprimée après confirmation du stockage du secret dans Replit.
Ne pas la journaliser, l'exporter ou la committer. Les identifiants temporaires du
provisionneur ont été supprimés après réparation. Le secret de publication attendu
reste `ODOO_PRODUCTION_RUNTIME_URL`, dirigé exclusivement vers `ma2f_odoo`.

### Réparation de la base gérée par Replit

Le générateur de migrations Replit tentait de créer une table Odoo avant sa séquence
partagée `ir_actions_id_seq`. Une réparation native PostgreSQL a donc aligné la base
par défaut inutilisée `neondb` avec le modèle Odoo vérifié. La base d'exécution
`ma2f_odoo` n'a pas été modifiée par cette réparation.

Les anciens objets Odoo sont conservés dans `ma2f_initial_setup_archive_20260909`,
avec un dump préalable privé dont le SHA-256 est
`d093f4e0d845fdcfcaa0f561e9273d5e3e837e3f0a2cf1ceff2ed6c3fbcd6c14`.
Les extensions gérées par Replit sont restées en place. La restauration native a
validé 549 tables publiques, zéro compte interne actif et zéro transaction métier.
Le modèle restauré porte le SHA-256
`78eb496314d964a13d23a3154f0c17b24f96e38b769ecc7244e99c0d1fa5b8c5`.
Les colonnes correspondent à Development ; les chaînes SQL décompilées des contraintes
et index ne sont pas strictement identiques. Les exemples observés d'index diffèrent
par la présentation des conversions de types ; ne pas prétendre à une égalité textuelle.

`repair_managed_schema.py` et `finish_managed_schema.py` sont des scripts de réparation
ponctuelle déjà exécutés. Ne pas les relancer après succès ; conserver leurs gardes.
Aucun bootstrap, import ni correctif de données ne doit s'exécuter au démarrage.
Preuves privées : `managed-schema-repair-result.json`, `managed-schema-parity.json`,
`production-http-result.json`, sous `.local/`.

Aquasachets conserve son authentification et ses données métier actuelles. Les rôles
utilisateurs, l'administrateur direct Odoo, l'intégration réelle et la bascule des
opérations restent des étapes distinctes après validation de l'hébergement.

## Historique du développement (avant publication)

- Projet créé vide, sans exécution de l'Agent et sans publication.
- Base Development heliumdb initialisée avec Odoo, sans données réelles MA2F.
- Rôle d'exécution odoo_core_dev : sans superutilisateur, création de bases ou de rôles.
  Le rôle Replit postgres a uniquement servi au provisionnement.
- Extensions unaccent et pg_trgm installées.
- Aucune base Production affichée ; aucune capacité de production encore vérifiée.
- Odoo Community 19.0 installé à la révision indiquée ci-dessous avec Python 3.12.
- Les neuf modules demandés sont installés : stock, purchase, sale_management, mrp,
  account, l10n_sn, product_expiry, mrp_product_expiry, mrp_account (77 modules avec dépendances).
  Le module Sénégal installé ne signifie pas que les paramètres comptables réels sont validés.
- Tous les comptes internes sont inactifs ; mots de passe initiaux remplacés.
  Base neutralisée, cron d'exécution désactivé, aucun administrateur métier désigné.
- Pièces jointes en SQL natif, y compris après le test HTTP local.
- HTTP local testé sur 127.0.0.1:18069 : formulaire de connexion 200 et identifiants
  par défaut admin/admin refusés par Odoo. Processus arrêté à la fin du test.
- Aucun mouvement de stock, pièce comptable ou ordre de fabrication réel importé.
- Publication en brouillon : mode Invite only, Reserved VM 0,5 vCPU / 2 Gio,
  affichée à 15 $/mois. Aucun serveur payant activé.

## Accord budgétaire actualisé

**Décision actuelle :** l'utilisateur accepte explicitement le serveur à 15 USD/mois
ainsi que les frais supplémentaires de base de données et d'usage. L'ancien plafond
total ci-dessous est historique et ne bloque plus le provisionnement convenu.

L'utilisateur a accepté 15 $/mois à condition que le total s'arrête à ce montant.
Le panneau Usage du compte affiche aussi le calcul PostgreSQL de production à
0,16 $/heure, ainsi que des lignes séparées pour stockage et trafic. Le tarif serveur
ne garantit donc pas le budget total. Les crédits sont partagés avec d'autres projets.
Le contrôle de budget observé porte sur le compte et suspend les services à son seuil ;
aucun plafond propre à Odoo n'a été trouvé. Aucun réglage de facturation n'a été modifié.
L'utilisateur a ensuite explicitement accepté les frais de base de données et d'usage
en plus de la VM à 15 $/mois. Cet accord remplace la condition initiale de plafond total
et autorise la préparation et la publication en cours, sans nouvelle demande de budget.

## Préparation de production après accord sur les frais

Le rôle `odoo_core_prod` est dédié à l'exécution, sans superutilisateur, création de
bases/rôles, réplication ni contournement RLS. La connexion exige un certificat TLS
vérifié. Le secret `ODOO_PRODUCTION_RUNTIME_URL` est propre à la publication.

Une initialisation directe de la base initiale `neondb` s'est révélée trop lente et
a été interrompue. Ne pas relancer `initialize_production.py` sur cette base partielle.
`restore_production_template.py` crée la base distincte `ma2f_odoo` à partir de la
base de développement vérifiée vide de mouvements métier et de comptes internes actifs.
La première restauration transactionnelle a été arrêtée et annulée. Après vérification
de zéro table, `resume_production_restore.py` reprend avec quatre jobs, sans transaction
globale. Ce script refuse une base contenant déjà des tables ; ne pas le relancer sur
un état partiel. Son rapport privé est écrit uniquement après succès et contrôles.
Les scripts de provisionnement ne doivent jamais être exécutés par Run ou au démarrage.

`start_production.py` vérifie l'hôte/la base/le rôle attendus, TLS, les neuf modules,
le stockage SQL des pièces jointes, la neutralisation et l'absence de comptes internes
actifs avant de démarrer Odoo. Il n'initialise pas la base et ne crée aucun accès.
La commande Build installe la révision Odoo fixée via `install.sh`. Si les fichiers
existent sans métadonnées Git, l'installateur reconstruit l'index et vérifie leur
contenu contre la révision officielle avant de les réutiliser. Aucun checkout forcé.
Le marqueur `.local/odoo-revision` est produit par ce contrôle pour le lanceur, car
les métadonnées Git peuvent être exclues des images publiées. Le lancement de
développement reste distinct. Les huit tests locaux de prévol et de lanceur passent.

## Scripts et preuves

Dans le projet Replit, exécuter depuis sa racine : `bash install.sh`, puis uniquement
sur une base dédiée vide `.local/venv/bin/python bootstrap_development.py`.
Le bootstrap refuse une base non vide ou une configuration déjà existante : ne pas
le relancer pour une simple vérification. Il ne doit jamais servir de commande Run.
`smoke_development.py` vérifie l'accès HTTP local et arrête le serveur ensuite.
La configuration `.replit`, auparavant vide sur le projet distant, utilise maintenant
`bash start.sh` pour Run et comme commande de démarrage déclarée. `start.py` lance
l'installation existante sur le port 5000, sans bootstrap, avec cron et liste des bases
désactivés. Le bouton Run a été testé : `/web/login` répond HTTP 200 en développement.
La commande refuse explicitement `REPLIT_DEPLOYMENT=1` : le chemin de production reste
à configurer et vérifier, et la présence d'une commande ne signifie pas que le service
est prêt à publier. Aucun hébergement payant n'a été activé dans cette étape.
Les versions distantes des deux scripts Python ont une présentation plus compacte
que les copies locales, avec les mêmes gardes et assertions ; pas de publication Git.

Preuves privées distantes : `.local/bootstrap-result.json`,
`.local/http-smoke-result.json`, `.local/installed-requirements.txt`.
Les secrets, données et logs restent dans `.local/`, exclu de Git.
Le paquet Nix est fixé à `50ab793786d9de88ee30ec4e4c24fb4236fc2674` ; Bash 5 est
sélectionné explicitement pour contourner l'ancien Bash du projet Replit vide.

## Configuration à mettre en place avant publication

1. Reproduire en production l'installation Odoo Community 19.0 à la révision testée
   `8da213dc6785e097f2558dc2d648b588957786a1`, avec ses dépendances officielles.
2. Créer un rôle Odoo de production dédié, sans droits superutilisateur/création de bases/rôles.
   Garder les identifiants de provisionnement séparés des identifiants d'exécution.
3. Provisionner une base de production propre au projet et vérifier extensions,
   droits et restauration sur cette base. Le succès du développement ne le prouve pas.
4. Configurer le stockage natif `ir_attachment.location=db` avant import.
   Le pilote a vérifié 518 pièces jointes après restauration SQL seule dans un data-dir neuf.
   Dimensionner la base et les sauvegardes pour les fichiers inclus dans le SQL.
5. Préparer l'accès réservé à l'administrateur désigné et les comptes techniques
   de l'API. L'identité de l'administrateur reste à définir ; aucun accès public Odoo
   ne doit être activé avec les identifiants fictifs du pilote.
6. Tester sauvegarde, restauration, redéploiement et autorisations avant import réel
   ou bascule. Ne pas publier un serveur factice pour déclarer Odoo opérationnel.

Les sessions et autres fichiers temporaires du serveur restent distincts des pièces
jointes. Le mode SQL ne rend pas tout le disque persistant. Les sauvegardes testées
dans Aquasachets ne donnent pas automatiquement au nouveau projet accès à son bucket.

Périmètre métier : MA2F sachets uniquement ; 30 sachets par pack ; production nette
vendable. Données sources et anomalies conservées sans correction implicite.

Publication validation initially failed in the default managed `neondb` database: Replit could not alter `orm_signaling_registry`, owned by the restricted runtime role. The failed deployment was cancelled. The provisioning administrator was granted membership in `odoo_core_prod` so it can manage runtime-owned objects; the runtime role itself still has no superuser, database/role creation, replication or RLS bypass privilege. No business records or application account permissions were changed. The actual Odoo runtime target remains `ma2f_odoo`. Retry publication after this repair.

La publication `2361ee9f` a passé le Build mais échoué au démarrage : interpréteur Nix absent de l’image (exit 127). `replit.nix` déclare désormais les dépendances du runtime, avec la même révision Python que le test réussi. La nouvelle publication doit encore être vérifiée sur son URL publique.
