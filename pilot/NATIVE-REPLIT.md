# Pilote Odoo natif dans Replit

Essai du 8 septembre 2026, uniquement dans l'espace de développement Aquasachets, sous `ma2f-next/pilot/.local/native`. Aucun import de données MA2F, aucun serveur HTTP Odoo lancé, aucune publication.

## Installation vérifiée

- Odoo Community 19.0, source officielle `https://github.com/odoo/odoo.git`, révision `8da213dc6785e097f2558dc2d648b588957786a1`.
- Python 3.12.12, environnement `venv` privé créé avec `uv venv`.
- Dépendances installées depuis le `requirements.txt` de cette révision, sans substitution par psycopg2-binary ni suppression de LDAP. L'installation initiale échouait sur les en-têtes LDAP puis sur pg_config. Le shell `native-shell.nix` fournit les composants nécessaires, dont l'attribut spécifique `postgresql_16.pg_config`.
- PostgreSQL natif 16.10, cluster `pgdata`, sans écoute TCP, socket `/tmp/ma2f-odoo-native-socket`, port logique 55432, authentification SCRAM.
- Base `ma2f_native_pilot`, compte `odoo_native` sans superutilisateur, création de bases ou création de rôles. Ce compte possède uniquement la base fictive dédiée.

Le fichier `odoo.conf` et les mots de passe sont privés et exclus de Git. Le compte initial Odoo est remplacé par `pilote.native.admin` avec secret aléatoire, sans invitation. La société est nommée « MA2F - PILOTE NATIF FICTIF ». Ce compte ne désigne pas l'administrateur réel.

## Isolation et vérification

Odoo 19 prend en compte les variables PGUSER, PGHOST et PGPASSWORD de l'environnement. Le premier lancement a été arrêté par son garde-fou contre l'utilisateur postgres. `native_run.py` supprime les variables PG*, ODOO_* et DATABASE_URL du seul processus enfant, vérifie la configuration de la base isolée et la révision Git, et impose `--no-http` pour init et verify. Les secrets de l'application ne sont pas modifiés.

L'initialisation des modules a réussi. `native_run.py verify` a interrogé le vrai registre Odoo : stock, purchase, sale_management, mrp, account, l10n_sn et ma2f_pilot_commands sont installés, le compte PostgreSQL n'est pas superutilisateur. Même résultat après redémarrage PostgreSQL et après renouvellement des identifiants. Le cluster est arrêté à la fin de l'essai, données conservées.

Après redémarrage explicite du cluster existant :

```sh
pg_ctl -D pilot/.local/native/pgdata -l pilot/.local/native/postgres.log -o "-h '' -k /tmp/ma2f-odoo-native-socket -p 55432" -w start
python3 pilot/native_run.py verify
pg_ctl -D pilot/.local/native/pgdata -m fast -w stop
```

Le répertoire de socket doit exister, appartenir à runner et avoir le mode 0700. Ne pas initialiser un cluster sur un autre emplacement par défaut et ne pas utiliser DATABASE_URL.

## Correction de confidentialité durant l'essai

Le contrôle HTTP a constaté que le motif Vite `**/.*` ne protégeait pas le contenu des sous-dossiers cachés : le fichier privé de configuration native était accessible via `/@fs/`. Les deux profils Vite bloquent désormais explicitement `**/.*/**`, `**/pilot/.local/**` et `**/migration-private/**`. Sur le profil Replit actif, les tests ont confirmé 403 pour les configurations native et Docker, le mot de passe natif et le rapport de caisse, tandis que l'application reste en HTTP 200. Aucun contenu secret n'a été imprimé dans les résultats de contrôle. Les quatre identifiants natifs (administrateur PostgreSQL, rôle Odoo, mot de passe maître et administrateur Odoo) ont été renouvelés après correction.

Le pilote Docker précédent reste arrêté. Ses volumes et anciens identifiants ne constituent pas un environnement approuvé à réutiliser ; revoir ses secrets avant une éventuelle reprise.

## Limites

Ce résultat démontre l'initialisation native dans le workspace, pas la capacité de Replit Publishing à héberger durablement Odoo. Le disque local et le filestore ne sont pas une stratégie de persistance de production. Restent les scénarios métier natifs sur ce runtime, les pièces jointes et la restauration, les services persistants, la publication, les accès Clerk et le raccordement des écrans. Les PDF n'ont pas été testés et wkhtmltopdf n'est pas installé. Le nixpkgs configuré et les dépendances transitives doivent être figés pour un déploiement reproductible ; un inventaire privé installé a été conservé.

Les anomalies de la source restent intactes conformément à la décision utilisateur. Firebase reste opérationnel.

## Recette métier et restauration exécutées sur Replit

`native_business_test.py` adapte le scénario existant du pilote Docker au nom de la base native et au répertoire de rapports privé. Les fixtures et le paramétrage comptable fictif font partie de la transaction annulée. Le scénario a réussi sur le véritable Odoo : achat/réception de 2 kg, facture fournisseur de 2 000 XOF, fabrication de 300 sachets consommant 0,5 kg, chargement camion, vente/livraison de 100 sachets à 1 000 XOF, encaissement de 600, retour d'invendus, retour client de 10 sachets, avoir de 100, puis encaissement des 300 restants. Ces ratios et prix servent exclusivement au test. Le contrôle des compteurs après rollback confirme l'absence de nouveaux produits, mouvements, fabrications, factures ou partenaires du scénario.

`native_backup_test.py` sur Replit a créé un partenaire et une pièce jointe explicitement fictifs, puis utilisé pg_dump au format custom et une copie du filestore. La restauration utilise une nouvelle base créée par l'administrateur du seul cluster de test ; le rôle applicatif Odoo conserve ses restrictions. Aucun écrasement de base, aucune interface HTTP et aucune suppression de volume.

Résultat final : base `ma2f_native_restore_806f64067bcc`, archive privée `pilot/.local/native/backups/806f64067bcc/database.dump`, SHA-256 `375b48f850f5b864e02237bfde6c9d7f0cd24e5a115decaf42c1ed23e520c92b`. Les 882 fichiers copiés ont été comparés par SHA-256 entre archive et copie restaurée. La pièce jointe se relit à l'identique via l'ORM Odoo et le partenaire conserve son nom. Les compteurs de sept modèles concordent. Les tables opérationnelles sont vides dans cette archive puisque le scénario métier est annulé ; cet essai ne constitue donc pas une recette de restauration des données métier réelles MA2F.

Le premier contrôle de neutralisation exigeait zéro tâche active. Le code officiel Odoo conserve volontairement `base.autovacuum_job`. Le contrôle a été corrigé pour exclure uniquement cette tâche d'entretien, puis rejoué sur la même restauration : réussite, avec le drapeau natif `database.is_neutralized=true`. La neutralisation native avait déjà réussi ; aucun défaut de restauration n'a été masqué. Le journal initial d'échec est conservé.

Le rapport final est `pilot/.local/native/native-backup-result.json`. L'archive, les empreintes, la base source et la base restaurée sont conservées dans le workspace privé. Le script de sauvegarde reste dans le checkout Replit et doit être rapatrié lors de la conciliation des sources ; l'adaptateur métier est présent dans les deux copies. Ce test n'est ni une sauvegarde hors site ni une validation de persistance après publication ou remplacement du workspace. Il reste à choisir et vérifier le stockage durable et le cycle de déploiement avant la bascule.
