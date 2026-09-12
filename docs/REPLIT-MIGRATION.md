# MA2F — préparation de la migration Replit

## État au 7 septembre 2026

La cible demandée est un hébergement Replit, en parallèle du raccordement métier Odoo. Le remplacement total de Firebase est confirmé : conserver les mêmes comptes métier et autorisations dans la nouvelle architecture. Destination fournie : https://replit.com/@Mamdou025/Aquasachets. La source à transférer est la NOUVELLE version locale avec Odoo, pas l’ancienne version Replit. Le navigateur actuel affiche une page d’accès introuvable puis demande une connexion ; aucun contenu privé du projet n’a pu être inspecté. Aucune base, aucun compte ni secret distant n’a été créé ou supprimé.

La configuration `.replit` démarre et construit le serveur web MA2F actuel. Elle ne démarre pas Odoo et ne remplace pas Firebase. Le profil Vite Replit utilise les plugins React/Tailwind seulement, sans runtime, collecte de logs ou proxy de stockage Manus. Les scripts historiques restent disponibles pendant la transition.

## Architecture cible à mettre en place

| Composant | Destination envisagée | Séparation à conserver |
|---|---|---|
| Interface MA2F de gestion et backend métier | Application Replit stable | Déploiement et identifiants indépendants des fonctions libres. |
| Fonctions libres MA2F | Autre application Replit | Base PostgreSQL applicative propre ; aucun accès SQL à Odoo. |
| Odoo Community et addons MA2F | Service Replit dédié, sous réserve de recette de compatibilité | Base Odoo distincte ; accès humain direct limité au compte désigné ultérieurement. |
| Données libres actuellement dans Firestore | PostgreSQL applicatif | Pas de copie concurrente faisant autorité pour les stocks/ventes transférés à Odoo. |
| Identité des utilisateurs | Authentification intégrée au projet Replit, fournisseur éprouvé à provisionner | Identités et rôles applicatifs conservés lors de la migration ; pas d'authentification maison. |
| Fichiers et sauvegardes | Stockage persistant vérifié | Aucun fichier métier conservé seulement sur le disque de l'application publiée. |

L'utilisateur peut disposer d'une seule expérience MA2F, avec plusieurs déploiements derrière. Héberger plusieurs applications chez Replit conserve la séparation voulue ; réunir Odoo et les expérimentations dans un seul processus la détruirait.

## Réglages préparés dans le dépôt

- `.replit` : Node 22 ; démarrage `corepack pnpm dev:replit`, installation figée puis `build:replit`, lancement de production `corepack pnpm start`, port 3000 vers 80.
- `vite.replit.config.ts` : aperçu Replit, hôtes `.replit.dev` / `.replit.app`, écoute sur `0.0.0.0`, port fixe.
- Serveur Express : port configurable, écoute réseau explicite et `/healthz`. Ce point indique uniquement que le serveur web répond ; il ne prouve pas la disponibilité de Firebase/Odoo.
- `deployment/replit/.env.example` : variables actuellement consommées et distinction des valeurs publiques frontend/secrets backend.
- `replit.md` : consignes d'architecture pour continuer dans Replit sans mélanger le pilote local et la production.

Le profil racine convient à un nouveau projet. Dans Aquasachets, le profil `deployment/replit/existing-project.replit` utilise le sous-dossier `ma2f-next` et le port principal existant 5000. Le type Autoscale déjà présent est conservé pour le web. Odoo, s'il passe les vérifications ci-dessous, nécessiterait un service toujours actif tel que Reserved VM. Aucun tarif ni achat n'est engagé.

## Dépendances Firebase à remplacer

L'inventaire statique trouve 24 fichiers dépendants dans les sources client et les deux backends Functions. Le détail des imports est dans `REPLIT-FIREBASE-INVENTORY.txt`.

| Fonction actuelle | Travail de migration |
|---|---|
| Firebase Auth et custom claims | Importer/rapprocher les utilisateurs, préserver les IDs historiques et permissions ; tester connexion, révocation et réinitialisation. |
| Firestore : collections individuelles + `meta/data` + paramètres | Extraire, contrôler et répartir les données entre Odoo et PostgreSQL applicatif. Remplacer abonnements, écritures, imports, corbeille et synchronisation hors ligne. |
| Firebase Storage | Copier les pièces jointes avec leurs droits ; vérifier contenu et liens après migration. |
| Fonctions de ventes, paiements et clôtures | Raccorder les contrats au backend stable/Odoo, en fermant tout fallback d'écriture Firebase après bascule. |
| Création/utilisation des comptes et gestion des rôles | Remplacer les Functions correspondantes par le fournisseur d'identité et le contrôle serveur retenus. |
| Sessions et webhook Wave | Déplacer URL, signature, secret et anti-doublon ; recette avant de modifier la destination du webhook réel. |
| Sauvegardes planifiées/manuelles | Préparer tâches, stockage distant et restauration ; les tâches Firebase restent actives jusqu'à leur remplacement vérifié. |

## Recette indispensable pour Odoo sur Replit

1. Vérifier sur le projet réel comment installer et exécuter Odoo 19 et ses bibliothèques système. Le fonctionnement de Docker Compose dans Ubuntu local ne prouve pas sa disponibilité dans Replit Publishing.
2. Vérifier la base PostgreSQL dédiée : extensions nécessaires, permissions, connexions et transactions, capacité et sauvegardes. Ne pas réutiliser la base des fonctions libres.
3. Choisir une conservation durable des pièces jointes compatible avec les mécanismes natifs ou un addon maintenu, puis vérifier un fichier après redéploiement. Le filestore local du pilote ne convient pas tel quel.
4. Remplacer fichiers secrets locaux, requêtes en attente et résultats du client pilote par Secrets et stockage transactionnel durable. Un UUID stocké seulement sur disque pourrait disparaître au redéploiement.
5. Mettre en place l'identité réelle et les limites d'accès ; aucun jeton fictif dans les écrans.
6. Rejouer sur Replit les tests natifs, concurrence, redémarrage, redéploiement, pièces jointes et restauration avant d'y déplacer des données réelles.

## Ordre des travaux

Préparer l'hébergement en même temps que les contrats métier. Le raccordement production/stock en packs nets est déjà testé localement. Les prochains raccordements peuvent utiliser le même contrat sans dépendance à Firebase ; la migration des utilisateurs et du stockage doit avancer avant le branchement des écrans. Importer le dépôt dans Replit ne copie ni les secrets ni les données existantes.

Conserver une seule source faisant autorité par opération : après une bascule vérifiée, fermer les écritures correspondantes dans Firebase, y compris imports, webhooks et synchronisation hors ligne. Ne pas supprimer les données anciennes lors de la simple préparation de Replit.

## Sources officielles consultées

- [Configuration Replit](https://docs.replit.com/features/project-setup/configuration) : commandes, modules et ports.
- [Types de publication](https://docs.replit.com/features/publishing/deployment-types) : Autoscale, Reserved VM et Scheduled.
- [Persistance du disque publié](https://docs.replit.com/build/troubleshooting) : le système de fichiers peut être réinitialisé au redéploiement.
- [Base SQL Replit](https://docs.replit.com/features/data-and-storage/sql-database) : PostgreSQL intégré.
- [Options d'authentification](https://docs.replit.com/learn/projects-and-artifacts/auth) : Replit Auth nécessite des comptes Replit, Clerk Auth permet des comptes propres à l'application. Pour des comptes salariés propres à MA2F, Clerk intégré à Replit est la piste proposée ; ce service reste un fournisseur géré, pas un moteur de mots de passe maison. Aucun remplacement n’est encore effectué.

## Reprise exacte des comptes et autorisations

Conserver les champs `AppUser.id`, `nom`, `login`, `email`, `tel`, `role`, `roles`, `actif` et `allowedSections`. Distinguer un `allowedSections` absent d'une liste explicitement vide. L'identifiant applicatif historique n'est pas supposé égal à l'UID Firebase : établir une correspondance contrôlée entre ID métier, UID Firebase et nouvel identifiant d'authentification.

Ne pas associer automatiquement un nouveau compte privilégié sur la seule base d'un e-mail saisi. Rapprocher l'export de l'authentification, les comptes métier et les permissions serveur. Les divergences bloquent l'attribution des droits jusqu'à résolution ; ne pas promouvoir un rôle par défaut. Les comptes désactivés restent désactivés. La migration des mots de passe dépend des formats supportés par le fournisseur ; elle n'est pas garantie par une copie des fiches utilisateurs.

Recette : comparer les rubriques autorisées et les opérations serveur pour chaque rôle, vérifier restrictions individuelles, refus d'accès croisé, comptes désactivés et révocation. L'accès direct à Odoo est un droit distinct à attribuer ultérieurement, conformément à la demande utilisateur.

## Vérification locale du profil Replit

`pnpm install --frozen-lockfile`, `pnpm build:replit` et `pnpm check` réussis. Cela prouve la compilation locale du nouveau profil, pas le provisionnement de Node, Secrets, Auth ou PostgreSQL dans Replit. Le pilote Odoo local demeure séparé et ses écritures restent désactivées.

## Installation dans Aquasachets — 8 septembre 2026 UTC

La nouvelle source locale a été transférée dans `/home/runner/workspace/ma2f-next`, après vérification SHA-256 de l'archive et des 227 fichiers du premier transfert. L'ancien code racine et son historique Git sont conservés. La configuration Replit précédente est sauvegardée dans `.migration-backups/20260908-before-ma2f-next/replit.original.toml`.

Le bouton Run utilise désormais le workflow « MA2F nouvelle version » : `cd ma2f-next && pnpm dev:replit --port 5000`. Replit maintient ses anciennes correspondances de ports ; le port 5000 est celui relié au port externe 80. Les commandes de publication ciblent également `ma2f-next`, mais aucune republication n'a été lancée.

L'installation initiale a rencontré deux refus HTTP 403 du registre Replit : `tar@7.5.1` puis `vitest@2.1.9`. Le premier a été remplacé par `tar@7.5.22` via override ; le second, inutilisé dans ce projet, a été retiré. Le pare-feu et le registre Replit n'ont pas été contournés. Les corrections sont reprises dans les sources locales.

Sur Replit : installation, `pnpm check`, `pnpm build:replit` et les 32 tests Python sous `pilot/gateway` réussis. Le navigateur affiche bien le nouvel écran « MA2F — Gestion AquaSachet », avec email, mot de passe et récupération de mot de passe. Aucune connexion métier ni écriture de données n'a été effectuée. Les tests Python de contrats ne constituent pas une recette du serveur Odoo dans Replit.

Firebase est encore utilisé par cette interface. Les comptes, les données et les fichiers ne sont pas encore migrés ; Odoo n'est pas encore provisionné dans Replit. L'application publiée précédente reste en place jusqu'à la recette de migration.

## Essai du pilote Docker dans Replit — 8 septembre 2026

La conservation fidèle de la source est désormais la règle demandée par l'utilisateur : voir `docs/SOURCE-PRESERVATION.md`. Les anomalies métier ne bloquent pas les travaux techniques et ne sont pas corrigées implicitement.

Vérifications dans l'espace de développement Aquasachets : Python 3.12.12, Docker Engine 27.5.1 et Compose 2.36.0 répondent. Odoo et ses bibliothèques Python ne sont pas installés dans le runtime hôte inspecté ; ni ODOO_DATABASE_URL ni ODOO_URL n'y sont configurés. Cela n'est pas un inventaire des secrets de publication.

`python3 pilot/manage.py init` a téléchargé l'image PostgreSQL épinglée, créé le réseau interne et le volume `ma2f-odoo-pilot_postgres-data`, puis démarré PostgreSQL 16.15. Le journal PostgreSQL confirme la disponibilité du serveur. En revanche, tous les contrôles de santé du conteneur échouent au niveau du runtime : `OCI runtime exec failed ... error executing setns process: exit status 1`. Compose reste en attente ; Odoo n'a pas été initialisé. La présence de Docker et le démarrage d'un conteneur ne prouvent donc pas la compatibilité du pilote.

L'initialisation a été interrompue, puis `docker compose -f pilot/compose.yaml stop` a arrêté le conteneur. Aucun volume supprimé, aucune donnée réelle importée, aucun port Odoo publié. Les paramètres fictifs du pilote restent dans `pilot/.local`, exclus de Git. Les bases existantes de l'application n'ont pas été modifiées.

Les 32 tests Python de contrats passent dans Replit après cet essai. Ce sont des tests avec service Odoo simulé, pas une recette native Odoo. La prochaine investigation est le lancement direct d'Odoo dans un environnement Python isolé, avec PostgreSQL dédié et stockage durable à vérifier. La compatibilité Replit Publishing reste à établir séparément. Ne pas relancer Compose en supposant le moteur pleinement compatible et ne pas supprimer le contrôle de santé pour masquer cet échec.
