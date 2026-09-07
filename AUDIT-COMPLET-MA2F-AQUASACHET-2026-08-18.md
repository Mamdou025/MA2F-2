# Audit Complet — MA2F AquaSachet (mise à jour)

**Date :** 18 août 2026
**Auteur :** Claude (Cowork)
**Version auditée :** `7ee1084` (branche `main`, 1 commit local en avance sur `origin/main` au moment du contrôle)
**Projet Firebase :** `ma2f-aquasachet` (compte `ziza220@gmail.com`)
**Hébergement frontend :** Vercel (`ma2f-aquasachet.vercel.app`), build automatique à chaque push sur `main`
**Documents précédents :** `AUDIT-COMPLET-MA2F-AQUASACHET.md` (4 juillet 2026) et `AUDIT-COMPLET-MA2F-AQUASACHET-2026-08.md` (3 août 2026) — ce document les met à jour, il ne les remplace pas.

---

## Résumé exécutif

Depuis l'audit du 3 août, le projet a continué d'avancer vite (~40 commits, code passé de ~30 400 à **~36 200 lignes** TypeScript/React) avec l'ajout de modules significatifs : Commandes (intake téléphonique), dispatching automatique de tournées, Suivi logistique, Objectifs & primes, et un module de paiement mobile money **Wave** entièrement nouveau (deux Cloud Functions, `createWaveCheckoutSession` et `waveWebhook`, non mentionnées dans `CLAUDE.md`). En parallèle, trois bugs de fiabilité des données réellement sérieux ont été trouvés et corrigés le jour même de cet audit (perte silencieuse de `clients`/`livraisons` sans trace dans le Journal, sauvegarde cloud quasi vide depuis des mois, création silencieusement perdue avant le premier snapshot Firestore) — un bon signe de réactivité, mais aussi un rappel que ce type de bug peut exister ailleurs et rester invisible longtemps, précisément parce que les échecs de synchronisation sont **silencieux par conception** (`saveToFirestore`, voir §7).

Deux constats nouveaux, non couverts par les audits précédents, ressortent de ce contrôle :

1. **Un jeton d'accès GitHub (Personal Access Token) est stocké en clair dans la configuration git locale** (`git remote -v` l'affiche intégralement). Ce n'est pas un problème de code source — le jeton n'est pas commité — mais c'est une exposition d'identifiant réelle sur cette machine, à corriger immédiatement (voir §3.4, priorité **critique**).
2. **Le dépôt contient 98 fichiers parasites commités** (verrous git `.lock`, fichiers temporaires `_tmp_*`) issus d'incidents git antérieurs, en plus d'un dossier `_to_delete/` non commité de 20 fichiers similaires. Impact technique faible (7,2 Mo de `.git`) mais nuit à la lisibilité de l'historique (voir §8).

Sur le fond métier, les correctifs livrés depuis le 3 août sont solides : l'immutabilité des recouvrements, autrefois seulement documentée mais pas appliquée, l'est désormais réellement dans `firestore.rules` ; `audit_log` n'est plus inscriptible par un client ; la suppression de `clients`/`livraisons` est désormais réservée aux admins. En revanche, **deux correctifs Cloud Functions critiques (perte de données à la sync, sauvegarde quasi vide) sont compilés localement mais leur déploiement effectif sur Firebase n'a pas pu être vérifié depuis cet environnement** — c'est le point le plus urgent à confirmer.

**Note globale estimée : 7,5 / 10** (stable par rapport au 3 août) — les fondamentaux financiers restent solides et les bugs découverts sont corrigés rapidement, mais la dette de fond (aucun test automatisé, `AppContext.tsx` à 1 099 lignes, `StockSection.tsx` à 1 529 lignes, pas de couche service) continue de croître au même rythme que les fonctionnalités, et deux angles morts opérationnels (jeton exposé, correctifs non confirmés déployés) viennent s'ajouter.

---

## 1. Ce qui a changé depuis le 3 août

| Constat du 3 août | Statut aujourd'hui |
|---|---|
| Immutabilité des recouvrements non appliquée au niveau des règles (seulement documentée) | **Résolu** — `firestore.rules` sépare désormais `allow create: if canWrite()` de `allow update, delete: if isAdmin()` pour `recouvrements` |
| `audit_log` inscriptible par tout utilisateur authentifié | **Résolu** — passé à `allow write: if false` (seul le SDK Admin des Cloud Functions y écrit) |
| Déploiement des correctifs de claims (`setUserClaims`/`createUserWithRole`) non confirmé | Le correctif `onUserCreate` (ne plus écraser un rôle déjà attribué) est présent dans `cloud-functions/src/index.ts` et son build compilé (`cloud-functions/lib/`) est postérieur au commit source — **cohérent avec un déploiement effectué**, mais non vérifiable avec certitude sans accès à la console Firebase |
| `axios` dépendance morte apportant la majorité des CVE hautes | **Toujours présent** dans `package.json` (`^1.12.0`) — confirmé une nouvelle fois : aucune occurrence dans `client/src`, `server`, `functions/src` ou `cloud-functions/src` (les seules occurrences trouvées sont dans le code interne de dépendances tierces sans rapport, ex. `gaxios`) |
| — | **Nouveau, non documenté dans `CLAUDE.md`** : module de paiement mobile money **Wave** (`cfCreateWaveCheckoutSession` côté client, `createWaveCheckoutSession`/`waveWebhook` côté Cloud Functions), avec un choix de conception correct — pas de repli client pour cette fonction car la clé API Wave ne doit jamais atteindre le navigateur |
| — | **Nouveau** : suppression de `clients`/`livraisons` restreinte aux admins dans `firestore.rules` (dernier commit local, non encore poussé vers `origin/main` au moment du contrôle) |
| — | **Nouveau** : trois bugs de perte de données silencieuse corrigés le 18 août (voir §7) — dont deux correctifs Cloud Functions dont le déploiement effectif reste à confirmer |

---

## 2. Architecture

Toujours d'actualité : dualité de persistance (`meta/data` document unique vs collections par entité, pilotée par le booléen mutable `useNewArchitecture`), absence de couche service, logique métier dispersée dans les composants de section.

**La dette continue de croître au même rythme que les fonctionnalités.** `AppContext.tsx` est passé de 938 à **1 099 lignes** depuis le 3 août (garde-fous `collectionsLoadedRef` par collection pour le bug de sync découvert le 18 août). `StockSection.tsx`, déjà le plus gros fichier en août (1 135 lignes), atteint désormais **1 529 lignes**. Un nouveau fichier volumineux est apparu : `CommandesSection.tsx` avec **1 316 lignes**, qui concentre à lui seul l'intake téléphonique, le dispatching automatique/manuel, la vue par zone et la conversion Commande→Vente — un candidat naturel pour une extraction en sous-modules ou hooks dédiés avant qu'il ne devienne aussi difficile à maintenir que `StockSection.tsx`.

| Fichier | Lignes (août) | Lignes (aujourd'hui) |
|---|---|---|
| `StockSection.tsx` | 1 135 | 1 529 |
| `AppContext.tsx` | 938 | 1 099 |
| `CommandesSection.tsx` | — (n'existait pas) | 1 316 |
| `UtilisateursSection.tsx` | — | 998 |
| `LivraisonsSection.tsx` | — | 933 |

Le projet est passé d'environ 30 400 à **~36 200 lignes** de code TypeScript/React (hors `node_modules`), soit +19 % en deux semaines — un rythme d'ajout de fonctionnalités élevé qui, combiné à l'absence persistante de tests automatisés, augmente mécaniquement le risque de régression à chaque changement touchant un fichier partagé (`AppContext.tsx`, `helpers.ts`, `stock.ts`).

**Deux formats de Cloud Functions coexistent toujours** (`functions/` codebase `default`, 3 fonctions ; `cloud-functions/` codebase `roles-validation`, 14 fonctions actives), correctement déclarés dans `firebase.json` — le risque de suppression accidentelle rencontré début août reste évité par cette déclaration explicite.

---

## 3. Sécurité

### 3.1 Règles Firestore (`firestore.rules`) — relu intégralement

- **Progrès net depuis août** : `recouvrements` (`create` vs `update`/`delete` séparés), `clients` et `livraisons` (suppression réservée à l'admin), `audit_log` (`write: if false`) sont désormais alignés avec ce que la documentation prétendait déjà en juillet. C'est le résultat le plus positif de ce contrôle.
- **Documentation interne obsolète dans le fichier lui-même** : l'en-tête de `firestore.rules` (lignes 3-26) décrit encore l'« ARCHITECTURE COLLECTIONS (format document unique) » avec des chemins `ventes/data`, `clients/data`, etc. — l'architecture réellement en vigueur dans le corps du fichier (vérifié ligne par ligne) est bien le format un-document-par-entité (`match /ventes/{docId}`, pas `match /ventes/data`). Un futur lecteur pressé de ce fichier pourrait être induit en erreur par ce commentaire ; à corriger en même temps qu'une prochaine modification des règles.
- **Nouvelle collection non documentée dans `CLAUDE.md`** : `mobileMoneyIntents` — lecture authentifiée, écriture bloquée côté client (`allow write: if false`), cohérent avec le choix de conception « Wave » ci-dessus (seules les Cloud Functions y écrivent via le SDK Admin).
- `backups`, `backups_auto`, `backup_logs` : toujours cohérents (lecture admin uniquement, écriture bloquée côté client pour les deux derniers).

### 3.2 Exposition d'identifiant — **critique, à corriger immédiatement**

`git remote -v` sur le dépôt local affiche l'URL suivante pour `origin` :

```
https://x-access-token:github_pat_11CKCO...@github.com/ziza110/ma2f-aquasachet.git
```

Un **jeton d'accès personnel GitHub complet est stocké en clair** dans la configuration git locale (`.git/config`), avec apparemment des droits de push sur le dépôt. Ce n'est pas un problème de code applicatif — ce jeton n'est commité dans aucun fichier suivi par git — mais c'est une exposition réelle : quiconque a accès à ce dossier (ou à une sauvegarde de la machine) peut pousser du code en votre nom sur le dépôt GitHub. **Recommandation immédiate :**
1. Révoquer/régénérer ce jeton dans GitHub → Settings → Developer settings → Personal access tokens dès que possible (il a été affiché dans les sorties de cet audit).
2. Reconfigurer `origin` sans jeton en clair dans l'URL — soit via SSH (clé dédiée), soit via le gestionnaire d'identifiants natif de macOS (`git credential-osxkeychain`), qui ne stocke jamais le secret dans un fichier texte lisible.

### 3.3 Cloud Functions et claims

Le correctif `onUserCreate` (ne plus écraser un rôle déjà attribué à la création d'un compte) est bien présent dans `cloud-functions/src/index.ts` (fonction `admin.auth().getUser(user.uid)` suivie d'un retour anticipé si un rôle existe déjà), et le build compilé (`cloud-functions/lib/index.js`, 5 août) est postérieur au commit source concerné (4 août) — signal cohérent avec un déploiement réalisé peu après. **Ceci reste néanmoins une déduction indirecte (comparaison de dates de fichiers), pas une confirmation via la console Firebase** — à vérifier manuellement dans Firebase Console → Functions que `onUserCreate` et `setUserClaims` sont bien à jour, et que les comptes utilisateurs créés avant le correctif ont un rôle Firebase (claim) cohérent avec leur rôle affiché dans Utilisateurs.

### 3.4 Deux correctifs critiques compilés mais déploiement non confirmé

D'après `CLAUDE.md`, deux correctifs dans `functions/src/index.ts` (perte silencieuse de `clients`/`livraisons` à la synchronisation, sauvegarde cloud quasi vide depuis des mois faute de lire les bonnes collections) ont été écrits **le jour même de cet audit (18 août)**. Vérification technique : `functions/lib/index.js` (build compilé) contient bien le code corrigé (`db.collection(col).get()` au lieu de `.doc("data")`) et son horodatage (19:25) est postérieur à la dernière modification du fichier source (19:21) — le build local est donc à jour. **Mais un build local à jour ne veut pas dire que `firebase deploy --only functions` a été exécuté** : tant que ce déploiement n'est pas fait, la sauvegarde quotidienne de 23h continue de produire un fichier Excel quasi vide malgré un badge « à jour » trompeur dans le Dashboard. **Action recommandée en priorité 1** : exécuter `cd functions && npm run deploy` (ou `firebase deploy --only functions`) et vérifier dans Firebase Console → Functions → Logs que la prochaine exécution planifiée de `dailyBackupToGoogleDrive` produit un fichier avec des lignes dans les onglets Ventes/Production/Clients/etc.

### 3.5 Toujours ouverts (inchangés depuis juillet/août)

- **2FA entièrement côté client** (secret TOTP dans Firestore, vérification par HMAC-SHA1 dans le navigateur, `client/src/lib/twoFactor.ts`) — implémentation techniquement correcte pour du TOTP standard, mais reste une barrière cosmétique : un accès en lecture à Firestore suffit à récupérer le secret et générer des codes valides.
- **Clé API Firebase en dur** dans `firebase.ts` en plus du repli par variable d'environnement — risque faible par construction (clé publique par design chez Firebase), mais empêche une rotation propre.
- **Clé API Google Maps réelle committée dans `.env.example`** (pas un placeholder) et dupliquée en dur dans `Map.tsx`. Le commentaire du fichier précise qu'elle est restreinte par référent HTTP à `localhost` et à l'ancien domaine Manus — **à vérifier que les restrictions incluent bien le domaine Vercel actuel** (`ma2f-aquasachet.vercel.app`), sans quoi soit la carte est cassée en production, soit (pire) les restrictions ont été élargies au-delà du nécessaire pour compenser.
- **Mode fallback client direct** quand les Cloud Functions sont indisponibles — choix assumé et documenté plutôt qu'oublié, mais le risque théorique (contournement de la validation serveur en simulant l'indisponibilité) reste réel sur les opérations sensibles.
- Stockage local chiffré AES-GCM (`secureStorage.ts`) : implémentation saine — clé non extractible générée dans IndexedDB, jamais exposée en clair, migration automatique depuis l'ancien stockage non chiffré.

---

## 4. Dépendances et supply chain

- **`axios` reste une dépendance directe inutilisée** (`package.json`, `^1.12.0`) — confirmé à nouveau par recherche exhaustive dans tout le code applicatif (aucune occurrence hors `node_modules` de dépendances tierces sans rapport). C'est toujours le geste correctif le plus rentable disponible : suppression immédiate, risque nul, gain de sécurité direct sur la majorité des CVE hautes remontées en août par `pnpm audit`.
- **`xlsx` (SheetJS, `^0.18.5`)** — utilisé activement pour l'export/import Excel, vulnérabilités connues non corrigées sur le registre npm public (les mainteneurs recommandent leur propre CDN). Aucun changement depuis août — toujours à planifier.
- Un nouvel audit `pnpm audit` n'a pas pu être relancé depuis cet environnement (pas d'accès réseau pour ce contrôle) — se fier au dernier chiffre connu (64 vulnérabilités, 16 hautes, dont la majorité imputable à `axios`) jusqu'à nouvelle vérification, et relancer `pnpm audit --prod` après suppression d'`axios` pour confirmer la baisse.

---

## 5. Qualité du code

| Métrique | Août 2026 | Aujourd'hui |
|---|---|---|
| Lignes de code | ~30 400 | ~36 200 |
| Fichiers de test automatisés | 0 | 0 (inchangé) |
| Erreurs `tsc --noEmit` | 2 (préexistantes, `VehiculesSection.tsx`) | **2, identiques** — vérifié directement dans cet audit |
| `console.log`/`console.warn` | 8 | 4 (amélioration) |
| `TODO`/`FIXME` | 0 | 0 |
| Plus gros fichier | `StockSection.tsx` (1 135 lignes) | `StockSection.tsx` (1 529 lignes) |

**Toujours aucun test automatisé** — sur un projet à 36 000+ lignes gérant des calculs financiers (commissions, clôtures, comptabilité SYSCOHADA, dispatching de tournées), c'est le risque de fond n°1 après la vérification des déploiements.

**Les deux erreurs TypeScript de `VehiculesSection.tsx` (ligne 113) sont exactement les mêmes qu'en août** : un objet littéral passé à `setDB`/`setState` avec un tableau `vehicules` dont les éléments n'ont pas le champ `chauffeur` requis par le type `Vehicule`. Correction typiquement rapide (ajouter le champ manquant ou élargir le type) — laissée de côté depuis au moins deux semaines sans impact fonctionnel apparent, mais signale un point du code où le typage divergent du modèle réel.

**`tsc --noEmit` exécuté directement dans cet audit** confirme qu'aucune nouvelle erreur de typage n'a été introduite par les ~40 commits depuis le 3 août — bon signe de discipline malgré le volume de changement.

---

## 6. Hygiène du dépôt *(nouveau — non couvert par les audits précédents)*

- **98 fichiers parasites commités dans l'historique git** : des verrous git (`HEAD.lock.cleared.*`, `index.lock.cleared.*`) et des fichiers temporaires (`_tmp_21_*`, `_tmp_6_*`, `_tmp_7_*`) issus d'incidents git antérieurs (probablement des sessions d'agent IA interrompues en écriture concurrente) ont été commités par erreur. Impact réel faible (le `.git` local pèse 7,2 Mo, rien d'alarmant), mais ces fichiers polluent `git ls-files` et la racine du dépôt sans aucune utilité.
- **Un dossier `_to_delete/` de 20 fichiers similaires existe en local, non suivi par git** (`??` dans `git status`) — cohérent avec le nom, il attend une suppression manuelle.
- **1 commit local non poussé vers `origin/main`** au moment du contrôle (`7ee1084`, restriction de suppression clients/livraisons aux admins) — sans conséquence immédiate puisque ce commit ne touche que `firestore.rules` (jamais déployé via Vercel/push de toute façon, mais via `firebase deploy --only firestore:rules`), mais à pousser pour ne pas perdre la trace de ce changement de sécurité si la machine locale était perdue.

**Recommandation** : un nettoyage ponctuel (`git rm` des fichiers `.lock`/`_tmp_*` suivis, suppression du dossier `_to_delete/`, ajout d'un motif `*.lock`, `_tmp_*`, `_to_delete/` au `.gitignore` pour empêcher la récidive) prendrait moins d'une heure et clarifierait durablement l'historique.

---

## 7. Fiabilité métier et intégrité des données

Trois bugs de perte de données silencieuse ont été découverts et corrigés le 18 août (détail complet dans `CLAUDE.md`, résumé ici pour la vue d'ensemble) :

1. **Perte silencieuse de collections entières (`clients`, `livraisons`) à la synchronisation** — un défaut de garde (`collectionsLoadedRef`) permettait à une sauvegarde de confondre « aucun instantané Firestore encore reçu pour ce champ » avec « l'utilisateur a supprimé ces documents », déclenchant de vrais `deleteDoc()` sans jamais passer par le Journal, l'Historique ou la Corbeille — donc **sans aucune trace exploitable après coup**. Corrigé côté client (`AppContext.tsx`), déjà commité et donc actif dès le prochain déploiement Vercel (automatique au push).
2. **Correctif de suivi — création également perdue, pas seulement suppression** : le premier correctif bloquait aussi à tort les créations de documents avant le premier instantané réel, découvert via un import CSV de 203 clients qui n'en a persisté que 151, sans aucune entrée Journal pour l'expliquer. Également corrigé et commité.
3. **Sauvegarde cloud quasi vide depuis des mois** — `readAllData()` (Cloud Function) lisait un format Firestore obsolète (document unique `data`) pour la plupart des collections, donnant un fichier Excel « réussi » mais vide de Ventes/Production/Clients/etc. depuis la migration vers le format un-document-par-entité. Corrigé dans le code source et compilé localement, **déploiement non confirmé** (voir §3.4 — priorité 1 de cet audit).

**Points positifs confirmés** :
- La séparation balance/flux (`computeSoldeCaisseActuel`, `computeStockRestant` dans `helpers.ts`) reste le point d'entrée unique pour ces calculs, réutilisée cohéremment dans `CaisseSection.tsx`, `Dashboard.tsx`, `tests-calculs.ts` et maintenant `ExportExcel.tsx` — bonne discipline anti-duplication malgré l'absence de couche service générale.
- Le bug historique de stock camion (mauvais espace d'ID entre `Livreur` et `Vehicule`) reste corrigé, avec un outil de réparation admin toujours en place pour les données historiques affectées.
- **Stock non transactionnel** (mouvements concurrents non garantis atomiques) : toujours ouvert, inchangé depuis juillet — risque réel mais mesuré, le volume de ventes simultanées restant probablement faible pour une PME.

---

## 8. Nouvelle fonctionnalité non documentée : paiement mobile money Wave

`client/src/lib/cloudFunctions.ts` expose `cfCreateWaveCheckoutSession`, et `cloud-functions/src/index.ts` définit les fonctions serveur `createWaveCheckoutSession` et `waveWebhook`. Le choix de conception est le bon réflexe de sécurité : **aucun repli client** n'existe pour cette fonction (contrairement aux autres opérations sensibles), précisément parce que la clé API Wave ne doit jamais atteindre le navigateur — si les Cloud Functions sont indisponibles, le paiement mobile money n'est simplement pas proposé, l'encaissement manuel restant disponible en repli fonctionnel. La collection Firestore associée (`mobileMoneyIntents`) est protégée correctement (lecture authentifiée, écriture bloquée côté client).

**Ce module n'apparaît nulle part dans `CLAUDE.md`**, alors que le fichier lui-même impose explicitement de documenter tout changement touchant l'architecture ou le modèle de données. À ajouter à `CLAUDE.md` lors d'une prochaine session touchant ce fichier — au minimum : quelles sections l'utilisent (`RecouvrementSection.tsx`, `CreancesSection.tsx`, `VentesSection.tsx`, `CommandesSection.tsx`), le flux (génération du lien → webhook de confirmation → quel effet sur l'état de la vente/créance), et si un mode test/sandbox Wave est utilisé en développement.

---

## 9. Performance et scalabilité

Le build local (`vite build`) n'a de nouveau **pas pu être exécuté dans cet environnement d'audit** (même limitation qu'en août : binaire natif Rollup absent pour l'architecture du bac à sable — `@rollup/rollup-linux-arm64-gnu` manquant). Les métriques précises de taille de bundle restent donc à vérifier via un accès build complet ou directement sur le tableau de bord Vercel (l'historique de build y indique la taille des chunks).

Ce qui reste vrai indépendamment de la mesure exacte : le SDK Firebase complet, Radix UI et `xlsx` continuent de peser sur le bundle principal ; **aucune pagination serveur** n'a été ajoutée (`onSnapshot` sans `limit()` sur les grandes collections) — avec l'ajout de Commandes, Suivi logistique et Wave, le nombre de documents à synchroniser en temps réel continue de croître, ce qui rapproche mécaniquement le projet du seuil de dégradation identifié en juillet (~5 000-20 000 ventes).

---

## 10. Déploiement

- **Vercel** : migration terminée et stable depuis août, déploiement automatique à chaque push sur `main`. Non re-vérifié ce tour-ci (accès à l'API Vercel non disponible depuis cet environnement) — à confirmer que le dernier build reflète bien le commit `7ee1084` une fois poussé.
- **Cloud Functions** : deux codebases correctement déclarées dans `firebase.json` (`default` : 3 fonctions ; `roles-validation` : 14 fonctions actives, dont les 2 nouvelles fonctions Wave). **Le déploiement effectif des deux correctifs de fiabilité des données du 18 août (§3.4) est le point le plus urgent à confirmer manuellement.**
- **Règles Firestore** : le dernier changement de sécurité (suppression clients/livraisons réservée aux admins) est commité localement mais pas encore poussé — et de toute façon, `git push` ne déploie pas les règles : seul `firebase deploy --only firestore:rules` le fait. À vérifier que ce déploiement de règles a bien été exécuté après ce changement, indépendamment du push git.

---

## 11. Synthèse des risques par priorité

### Critique — à traiter immédiatement
| # | Risque | Impact | Effort |
|---|---|---|---|
| 1 | Jeton d'accès GitHub exposé en clair dans la config git locale | Un tiers ayant accès à cette machine pourrait pousser du code en votre nom | Très faible (révoquer + reconfigurer l'auth git) |
| 2 | Correctifs Cloud Functions du 18 août (perte de données à la sync, sauvegarde quasi vide) compilés mais déploiement non confirmé | La sauvegarde quotidienne peut continuer à produire des fichiers vides malgré un badge « à jour » trompeur | Faible (juste exécuter le déploiement et vérifier) |

### Élevé — à planifier sous 1-2 semaines
| # | Risque | Impact | Effort |
|---|---|---|---|
| 3 | `axios` toujours présent, dépendance morte apportant la majorité des CVE hautes | Surface d'attaque inutile | Très faible (suppression directe) |
| 4 | `xlsx` (SheetJS) : vulnérabilités connues sur une fonctionnalité active | Fichiers Excel générés/importés potentiellement exploitables | Faible-moyen |
| 5 | Clé Google Maps : restrictions de référent HTTP potentiellement non à jour pour le domaine Vercel | Carte cassée en prod, ou clé sur-exposée si les restrictions ont été élargies | Faible (vérifier dans Google Cloud Console) |
| 6 | Module Wave non documenté dans `CLAUDE.md` | Risque de divergence/oubli lors d'une future modification | Très faible (documentation) |

### Moyen — à adresser dans le mois
| # | Risque | Impact | Effort |
|---|---|---|---|
| 7 | 98 fichiers parasites commités (verrous git, temporaires) | Historique bruité, pas de risque fonctionnel | Faible |
| 8 | Commit local non poussé (`7ee1084`) | Changement de sécurité non sauvegardé hors machine locale | Très faible |
| 9 | En-tête de `firestore.rules` décrivant une architecture obsolète | Confusion pour un futur lecteur du fichier | Très faible |
| 10 | `AppContext.tsx` (1 099 lignes) et `StockSection.tsx` (1 529 lignes) continuent de grossir | Risque de régression croissant à chaque modification | Élevé (refactoring) |

### Toujours ouverts (inchangés depuis juillet/août)
- Absence totale de tests automatisés
- 2FA client-side sans protection serveur
- Pas de pagination serveur
- Stock non transactionnel
- Navigation non URL-based
- Fallback client direct sur opérations sensibles (risque documenté, assumé)
- 2 erreurs TypeScript résiduelles dans `VehiculesSection.tsx`

---

## 12. Feuille de route recommandée

**Immédiat (aujourd'hui/cette semaine)**
- Révoquer et régénérer le jeton GitHub exposé ; reconfigurer `origin` sans jeton en clair dans l'URL.
- Confirmer dans Firebase Console que les correctifs `functions/src/index.ts` du 18 août sont bien déployés ; relancer une sauvegarde manuelle et vérifier que le fichier Excel contient des lignes dans tous les onglets.
- Pousser le commit local `7ee1084` et vérifier que les règles Firestore correspondantes sont déployées.
- Supprimer `axios` de `package.json`, relancer `pnpm audit --prod`.

**Court terme (1-2 semaines)**
- Vérifier/mettre à jour les restrictions de référent HTTP de la clé Google Maps pour le domaine Vercel actuel.
- Documenter le module Wave dans `CLAUDE.md`.
- Nettoyer les fichiers parasites du dépôt (`.lock`, `_tmp_*`, `_to_delete/`) et compléter `.gitignore` en conséquence.
- Corriger l'en-tête obsolète de `firestore.rules`.
- Corriger les 2 erreurs `tsc` de `VehiculesSection.tsx`.
- Migrer l'export Excel vers la version corrigée de `xlsx`.

**Moyen terme (1-2 mois)**
- Ajouter des tests automatisés sur les calculs financiers (commission, bonus, clôture) et la validation des ventes — priorité d'autant plus grande que le projet a grossi de 19 % en deux semaines sans aucun filet de sécurité automatisé.
- Extraire `CommandesSection.tsx` (1 316 lignes, dispatching + intake + conversion en vente) en modules plus petits, avant qu'il ne devienne aussi difficile à maintenir que `StockSection.tsx`.
- Poursuivre l'extraction de logique métier hors d'`AppContext.tsx` vers des services dédiés.
- Migrer la 2FA vers un challenge serveur.
- Implémenter la pagination serveur sur les grandes collections.

---

## Conclusion

Le projet continue de progresser sur deux fronts en parallèle : une couverture fonctionnelle qui s'élargit rapidement (Commandes, dispatching, Suivi logistique, paiement Wave) et une réactivité réelle face aux bugs de fiabilité des données découverts en cours de route — trois bugs de perte silencieuse trouvés et corrigés le jour même de cet audit en est la preuve. Les correctifs de sécurité Firestore promis en août (immutabilité des recouvrements, `audit_log`) sont désormais effectivement en place, ce qui referme un écart documentation/réalité identifié à deux reprises.

Le risque a de nouveau changé de nature plutôt que de disparaître : ce n'est plus la cohérence des règles Firestore qui inquiète, mais la vérification opérationnelle que les correctifs écrits sont réellement déployés (deux fonctions critiques dans ce cas), et l'hygiène des identifiants sur la machine de développement (jeton GitHub exposé). Le rythme d'ajout de fonctionnalités (+19 % de code en deux semaines) sans tests automatisés reste, comme en août, le risque de fond qui s'accumule le plus silencieusement — chaque nouvelle section (Commandes à 1 316 lignes en est l'exemple le plus net) ajoute une surface que seule une relecture manuelle protège aujourd'hui.

Le prochain audit devrait vérifier en priorité : la confirmation du déploiement des deux correctifs Cloud Functions du 18 août, la rotation effective du jeton GitHub, et un premier socle de tests automatisés sur au moins les calculs financiers les plus critiques (commission, bonus, clôture de caisse).
