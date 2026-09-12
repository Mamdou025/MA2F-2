# Reprise des comptes MA2F

## État réel

Le contrôle hors ligne `scripts/identity_migration.py` est prêt. Il ne se connecte à aucun service, ne crée aucun compte, ne modifie aucun droit et n'envoie aucun e-mail. L'interface continue d'utiliser Firebase. Aucun utilisateur réel n'a encore été exporté ou migré.

## Constats dans le code

- `AppUser` contient un identifiant métier distinct de l'UID Firebase. Aucun rapprochement automatique par email n'est sûr pour attribuer les droits.
- Les fiches comportent `role` et `roles`, tandis que les règles Firestore et les fonctions utilisent le rôle principal des custom claims. Une divergence doit être résolue avant import.
- `UtilisateursSection.tsx` stocke aussi `permissions`, une matrice par rubrique et par action (`read`, `create`, `edit`, `delete`), absente du type `AppUser`. Elle doit être conservée dans l'export.
- Cette matrice est enregistrée par l'écran mais n'est pas utilisée par les règles Firebase ni les contrôles serveur examinés. Sa traduction en contrôles serveur reste à concevoir et valider opération par opération ; le contrôle de migration bloque les comptes concernés pour revue.
- Dans `AppContext.tsx`, `allowedSections: []` rétablit les rubriques du rôle car le code exige une longueur positive. Une liste vide n'est donc pas équivalente à un champ absent dans la cible : le contrôle la conserve telle quelle et bloque la migration pour arbitrage.
- `twoFactor.ts` prévoit la double vérification pour les rôles admin et caissier, et `TwoFactorChallenge.tsx` vérifie actuellement le TOTP côté navigateur. Il faut une authentification éprouvée avec contrôle serveur pour remplacer ce mécanisme, et non copier la cryptographie maison.

## Limite du fournisseur intégré

La [documentation Clerk Auth de Replit](https://docs.replit.com/features/auth-and-identity/clerk-auth) consultée le 8 septembre 2026 indique que MFA n'est pas disponible dans l'offre intégrée. L'utilisateur a explicitement choisi Clerk intégré à Replit et reporté la double authentification. La configuration du fournisseur est autorisée sans MFA pour cette étape. Le champ `requiresMfa` du rapport conserve les exigences historiques pour leur rétablissement ultérieur ; il ne prouve pas qu'une vérification MFA est active dans Clerk. La connexion Firebase existante reste en service tant que la bascule n'est pas validée.

## Contrat d'entrée (version 1)

Préparer un JSON contenant exactement `version`, `users`, `identities`, `links` :

```json
{
  "version": 1,
  "users": [{"id":"business-1","nom":"Compte fictif","login":"test","email":"test@example.invalid","role":"lecteur","roles":["lecteur"],"actif":true}],
  "identities": [{"uid":"firebase-9","email":"test@example.invalid","disabled":false,"claims":{"role":"lecteur","roles":["lecteur"]},"mfaEnrolled":false}],
  "links": [{"appUserId":"business-1","firebaseUid":"firebase-9","reviewed":true}]
}
```

Ce format n'est pas l'export brut de Firebase CLI. Il faut rapprocher les fiches métier de l'export Auth, décoder les custom claims et retenir uniquement les champs demandés. `mfaEnrolled` représente l'inscription MFA connue ; les exigences des rôles sensibles sont également conservées par le plan même si Firebase ne connaît pas le TOTP applicatif. Ne pas inclure mots de passe, hachages, clés TOTP, codes de récupération ou jetons. Les champs inconnus bloquent le contrôle : les examiner, ne pas les supprimer pour forcer un résultat favorable.

Les liens doivent être explicitement vérifiés à partir des sources ; `reviewed: true` est une attestation de préparation, pas une preuve technique d'identité. Le rapport n'est pas un jeton d'autorisation et ne doit jamais être accepté directement depuis un navigateur pour activer un compte.

Conserver `tel`, `allowedSections` et `permissions` quand ils existent. Ne pas créer ces champs quand ils sont absents. Tous les comptes désactivés restent désactivés. Le contrôle bloque doublons, identités orphelines, rôles inconnus, divergences de claims ou d'état et liens non vérifiés.

## Exécution

Placer les exports et rapports dans `migration-private/`, ignoré par Git et exclu de l'export de sources vers Replit. Créer ce dossier avant utilisation.

```text
python scripts/identity_migration.py migration-private/accounts.json --output migration-private/report-001.json
python -m unittest discover -s scripts -p test_identity_migration.py -v
```

Le terminal affiche uniquement des compteurs et un statut. Le fichier de sortie contient des données personnelles et doit rester privé. Un rapport existant n'est jamais écrasé. Codes de sortie : 0 rapprochement réussi, 2 incohérences à traiter, 1 entrée ou sortie invalide.

Même un rapport `reconciled` conserve `readyForCutover: false`, `activationAllowed: false`, `targetIdentity: null` et `directOdooAccess: false`. L'import réel, les permissions serveur, la connexion avec le fournisseur choisi, la révocation et la recette de bascule sont des travaux distincts. L'email du seul administrateur Odoo reste différé.

## Export réel et rapprochement du 8 septembre 2026

L'export en lecture seule de Firebase a récupéré 6 identités Auth, 5 documents `users` et 3 profils historiques dans `meta/data.users`. Les fichiers contenant les données personnelles restent dans le répertoire privé `~/ma2f-migration-private` du Cloud Shell du propriétaire, hors dépôt. Aucun mot de passe, hachage, secret TOTP ou jeton n'est exporté.

Le rapport privé `reconciliation-evidence-20260908.json` conserve l'empreinte SHA-256 de l'export et les preuves de rapprochement. Il ne constitue pas encore le contrat d'import version 1 :

- Deux profils caisse/commercial possèdent un lien UID explicite vers leur identifiant métier historique. Leurs listes de rubriques diffèrent et doivent être préservées séparément.
- Trois identités ayant un document utilisateur n'ont pas de lien UID explicite vers un identifiant métier historique. Le profil historique administrateur existe mais ne contient pas d'UID ; les deux lecteurs n'ont pas de profil dans la liste historique. Résoudre ces liens sans inventer d'ancien identifiant ni attribuer de privilèges sur simple correspondance d'email.
- Une identité n'a ni document utilisateur ni rôle serveur. Son attribution de droits reste suspendue à la réponse de l'utilisateur.
- Aucun conflit de rôles ou d'état actif n'a été détecté dans les rapprochements vérifiables ; aucun document utilisateur ne référence une identité absente.

Aucun compte réel n'a encore été importé dans Clerk et aucun email n'a été envoyé. Firebase reste le fournisseur actif. Clerk de développement et Clerk de production sont deux environnements distincts : une recette dans le premier ne vaut pas migration dans le second. Les changements Clerk réalisés directement dans Replit doivent être rapatriés et conciliés avec ce dépôt avant tout nouvel envoi complet des sources locales.

### Étape 1 : préparation des profils

Le fichier privé Cloud Shell `step1-prepared-pending-confirmation.json` contient cinq profils candidats, leur contrat version 1 et leur provenance, ainsi que la sixième identité isolée sans autorisation d'activation. Les assertions de préparation ont confirmé l'unicité des liens, la couverture des six identités et la cohérence des rôles/états des cinq profils persistants.

Les trois identifiants métier historiques sont conservés dans les candidats. Pour les deux lecteurs absents de `meta/data.users`, un **nouvel** identifiant de migration `firebase:ma2f-aquasachet:<UID>` et un login égal à l'email source sont préparés. Ces identifiants ne sont pas présentés comme d'anciens identifiants retrouvés. Les UID Firebase et l'état de vérification des emails sont conservés séparément ; un email non vérifié ne doit pas devenir vérifié lors de l'import Clerk.

Le lien candidat du profil administrateur reste `reviewed: false`, en attente de confirmation explicite du propriétaire. Le choix pour le compte sans rôle est également en attente ; son isolement dans le dossier de migration ne modifie pas son compte Firebase. Le contrat de cinq profils ne couvre pas à lui seul les six comptes : conserver le registre d'isolement et les compteurs de couverture dans les contrôles d'import. Ne pas annoncer l'étape entièrement validée avant résolution de ces décisions et passage du validateur sur le contrat final.

### Confirmation ultérieure du profil administrateur

L'utilisateur a confirmé le maintien du rôle administrateur MA2F (« oui il confirme son role »). Le nouveau dossier privé `step1-admin-confirmed.json` enregistre cette confirmation et le lien administrateur revu, sans remplacer le dossier précédent. Cinq profils ont maintenant un lien revu. Les contrôles exécutés dans Cloud Shell ont vérifié l'empreinte de l'export, l'unicité des identifiants/emails, les rôles et états, la conservation exacte des champs historiques et la couverture des six identités (cinq profils plus une identité en attente). Le validateur du dépôt n'a pas encore été exécuté sur ce dossier ; son résultat n'est pas présumé.

Cette réponse confirme seulement le profil administrateur : elle n'attribue aucun rôle au sixième compte et ne désigne pas l'administrateur Odoo. Aucun compte Clerk créé, aucune modification des comptes Firebase, aucune bascule.

## Étape 2 réalisée : import Clerk de développement

Les cinq comptes revus ont ensuite été créés dans le tenant Clerk **de développement** de Replit et relus via le SDK officiel pour contrôler leurs identifiants, états, emails et profils. Le validateur du dépôt a été exécuté dans Replit : cinq liens, zéro incohérence. Ses 16 tests passent. Un second contrôle sans écriture retrouve les cinq comptes existants.

Le script `scripts/import_clerk_development.mjs` a été créé directement dans le dossier Replit `ma2f-next` et doit être rapatrié lors de la conciliation des sources ; il n'est pas encore présent dans cette copie locale. Il refuse les clés de production, les liens non revus et les collisions d'email avec d'autres identités. Les UID Firebase deviennent des `externalId` uniques ; les profils métier sont conservés dans `privateMetadata.ma2fMigration`, sans autorisation active. Les métadonnées publiques sont vides. Les trois emails vérifiés restent vérifiés, les deux non vérifiés sont créés avec le statut réservé.

Le dossier reçu a été contrôlé par SHA-256 et reste dans `migration-private/`, ignoré par Git. Reçu privé Replit : `clerk-development-receipt-1788835876017.json`. Le sixième compte n'est pas importé. Aucun mot de passe/hachage/MFA copié, aucune invitation ni demande d'email de réinitialisation envoyée. La connexion effective et l'établissement des moyens de connexion restent à tester. Firebase reste actif, l'accès métier Clerk reste désactivé, aucun import en production ni publication effectué à cette étape.

## Reconnaissance serveur du profil et recette de connexion

Le serveur Replit résout désormais le profil depuis l'identifiant canonique de la session Clerk (`getAuth(req).userId`), puis relit l'utilisateur via le SDK Clerk. `server/clerkProfile.ts` vérifie le lien UID/externalId, le profil privé importé, le compte actif, l'email principal vérifié et les rôles connus. Ni les métadonnées publiques/client ni une correspondance d'email seule ne peuvent fournir ce lien. Une indisponibilité de lecture Clerk renvoie 503 sans droits ; les sessions absentes/invalides restent à 401.

La réponse expose `mapped` et, si reconnu, un aperçu `profile` avec les rôles/rubriques conservés. **Cet aperçu n'est pas une autorisation opérationnelle** : `businessAccess` et `directOdooAccess` restent faux, les rôles actifs restent vides. Aucun endpoint métier Firebase ou Odoo n'est basculé. La page de vérification affiche maintenant le résultat réel du rapprochement.

Vérifications effectuées dans Replit : TypeScript et build réussis, 14 tests du résolveur réussis, matrice HTTP Vite/Express réussie (401 absent/invalide, no-store, pas de CORS réfléchi, ancienne page à 200). Une vraie session de navigateur est authentifiée mais non rapprochée, donc correctement refusée. Le tenant contient maintenant six comptes Clerk, dont un sans métadonnées de migration ; les cinq imports précédents sont toujours présents. Le résolveur reconnaît les trois imports à email vérifié et refuse les deux à email non vérifié. Ne pas confondre ce nouveau compte Clerk non rapproché avec le sixième compte Firebase resté en attente.

La recette positive dans le navigateur avec le compte administrateur attend la connexion de l'utilisateur avec Google et son compte MA2F confirmé. Ne pas annoncer cette recette positive terminée. Le module pur et ses tests sont présents localement ; les raccordements Clerk et la page modifiée restent dans Replit jusqu'à conciliation des sources.

Un incident de configuration Replit a également été corrigé : le fichier racine `.replit` contenait deux copies strictement identiques de la configuration entière. Sauvegarde conservée dans `.migration-backups/duplicate-config-*`, suppression de la seconde copie et validation TOML ; la prévisualisation redémarre. Aucune restauration de l'ancienne application effectuée.

### Recette administrateur terminée

Après la connexion effectuée par l'utilisateur, la page a affiché « Profil MA2F reconnu : ziza220@gmail.com — rôles conservés : admin ». Cette réponse est issue de la session et de la lecture Clerk vérifiées côté serveur. La recette positive réelle est donc maintenant réussie ; elle remplace l'état d'attente ci-dessus. L'accès métier et l'accès direct Odoo restent explicitement désactivés, conformément au report de la bascule des données.

### Rapatriement du raccordement Clerk

Le raccordement serveur, le proxy Clerk, la page, le point d'entrée client et le profil
Vite Replit sont maintenant présents localement. Les dépendances directes sont fixées
aux versions observées dans Replit. TypeScript, build, 14 tests du résolveur et six
contrôles HTTP du serveur construit réussissent. Aucun compte ni rôle n'a été modifié.
Les scripts d'import distants restent à réconcilier séparément ; voir
`MIGRATION-CURRENT-STATUS.md` pour les limites et étapes encore ouvertes.
