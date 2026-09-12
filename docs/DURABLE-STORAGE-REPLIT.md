# Stockage durable MA2F : état vérifié

## Sauvegarde du pilote hors du workspace

Bucket Replit App Storage créé dans Aquasachets : `ma2f-odoo-pilot-backups`, identifiant `replit-objstore-f0467e02-6ff7-4a22-b988-316017beff35`.

Le SDK officiel Python `replit-object-storage==1.0.2` est installé dans `pilot/.local/storage-venv`, séparément de l'environnement Odoo. Un fichier fictif a permis de vérifier l'écriture/relecture et le refus HTTP 403 d'une requête Google Cloud Storage sans authentification. Le même refus a été vérifié sur l'archive de sauvegarde elle-même. Aucune permission publique ni route publique de téléchargement n'a été créée.

`pilot/export_backup_replit.py` transfère exclusivement la sauvegarde fictive déjà validée `806f64067bcc`. Il vérifie le dump et chaque fichier du filestore, refuse les liens symboliques, archive uniquement le dump, les manifestes, le résultat de recette et les fichiers attendus. Les fichiers de configuration et mots de passe en clair du pilote ne sont pas inclus. Le dump contient néanmoins des données internes Odoo, dont des hachages d'authentification : il doit rester privé.

Objet envoyé : `ma2f-pilot/806f64067bcc/6e81a361d32a95ef9749bc1f3a288610838fdf4e74a5dd4adf3a772754225f5a.tar.gz`.

- Taille : 2 900 516 octets.
- SHA-256 du paquet : `6e81a361d32a95ef9749bc1f3a288610838fdf4e74a5dd4adf3a772754225f5a`.
- Téléchargement dans un nouveau dossier privé, vérification de l'archive et de ses 886 fichiers : réussite.
- Extraction limitée aux noms attendus et aux fichiers ordinaires avec le filtre de sécurité Python `data`.
- Reçu distant `.verified.json`, relu et comparé ; rapport privé `pilot/.local/native/object-storage-backup-result.json`.

La restauration native a été testée à l'étape précédente depuis les mêmes octets du dump et du filestore. Cette étape vérifie leur transfert et leur récupération hors du workspace ; elle ne constitue pas un nouveau redéploiement ni une sauvegarde réelle MA2F. Le bucket reste chez Replit : ce n'est pas une copie chez un fournisseur indépendant. Aucun calendrier de sauvegarde, verrouillage de rétention ou purge automatique n'est encore activé.

## Base de fonctionnement et fichiers Odoo

La connexion de développement actuelle utilise `helium`, PostgreSQL 16.10, avec droits de superutilisateur/création de bases et extensions unaccent/pg_trgm disponibles. Cette observation ne prouve pas les capacités de la base publiée. Le panneau Replit montre distinctement une base Development et une base Production, cette dernière active avec récupération à un instant donné sur sept jours. Ses données et identifiants n'ont pas été modifiés.

Le cluster natif du pilote demeure local et arrêté. Il ne doit pas être lancé en publication comme s'il s'agissait d'un PostgreSQL durable. Avant de publier Odoo, provisionner et tester une base de production dédiée avec son rôle restreint, puis une conservation durable des pièces jointes compatible avec Odoo. Le bucket de sauvegardes n'est pas un filestore Odoo actif et ne rend pas les écritures locales durables.

Restent : isolation et provisionnement de la base Odoo publiée, stratégie native ou addon maintenu pour les pièces jointes, restauration depuis la sauvegarde dans cet environnement, essai de redéploiement, puis raccordement des API et autorisations. Aucune bascule Firebase ni republication réalisée.

## Complément : stockage natif SQL et projet séparé

Le test distant `pilot/native_db_storage_test.py` a réussi : conversion des pièces
jointes fictives vers `ir_attachment.location=db` avec la méthode native
`force_storage()`, puis restauration SQL seule dans `ma2f_dbfiles_44ac07c86394`.
Les 518 pièces jointes ont conservé leur SHA-256 dans un data-dir neuf, sans filestore
copié. La base restaurée a été neutralisée. Le cluster pilote a ensuite été arrêté.
Dump SHA-256 : `10319d0747ef998579d4f2c4d0922148b5cf5980b9172daf6e0b24f1d1251e9a`.
Rapport privé distant : `pilot/.local/native/db-storage-result.json`.
Le script reste à rapatrier/réconcilier dans le dépôt local ; aucune donnée réelle
ni publication n'a été concernée. Ce nouveau dump n'a pas encore été exporté au bucket.

Le projet Replit **MA2F-Odoo-Core** a été créé séparément, sans Agent :
https://replit.com/@Mamdou025/SlipperyWhirlwindDeletions.
Sa base de développement affiche zéro table publique et les extensions nécessaires
disponibles. Sa base de production reste à provisionner et à tester. Voir
`deployment/odoo-core/README.md` pour l'état exact et les conditions de mise en service.

## Sources

- [SDK Python Replit App Storage](https://docs.replit.com/features/sdks/object-storage-python-sdk).
- [Limites de persistance du système de fichiers publié](https://docs.replit.com/build/troubleshooting).
- [Présentation d'Object Storage et accès depuis les déploiements](https://replit.com/blog/object-storage).
