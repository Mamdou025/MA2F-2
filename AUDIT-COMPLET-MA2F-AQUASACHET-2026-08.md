# Audit Complet — MA2F AquaSachet (mise à jour)

**Date :** 3 août 2026
**Auteur :** Claude (Cowork)
**Version auditée :** `6c40188` (branche `main`, synchronisée avec `dev`)
**Déploiement production :** Vercel — `ma2f-aquasachet.vercel.app` (build `READY`, commit `4ad2598` au moment du contrôle)
**Projet Firebase :** `ma2f-aquasachet` (compte `ziza220@gmail.com`)
**Document précédent :** `AUDIT-COMPLET-MA2F-AQUASACHET.md` (4 juillet 2026) — ce document ne le remplace pas mais le met à jour ; l'ancien reste comme référence historique.

---

## Résumé exécutif

Depuis l'audit du 4 juillet, l'application a nettement progressé sur les points qui avaient été classés **critiques** : l'incohérence des noms de champs dans les règles Firestore, la double écriture des ventes, et l'absence de figeage du taux de commission/bonus ont tous été corrigés. L'app a aussi migré de Manus vers Vercel pour l'hébergement, gagné une refonte visuelle complète, un mode sombre, une gestion mensuelle pour Commerciaux/Livreurs/Producteurs, et l'édition des clients (qui manquait).

En contrepartie, cet audit identifie deux catégories de constats que le précédent n'avait pas couvertes : la **santé des dépendances** (64 vulnérabilités remontées par `pnpm audit`, dont 16 en sévérité haute, en grande partie évitables) et une **classe de bugs de robustesse** illustrée par le plantage récent de la page Stock (accès à un champ optionnel sans filet de sécurité) — un signal que d'autres sections pourraient contenir des points faibles similaires non encore révélés.

**Note globale estimée : 7,5 / 10** (contre 6,5/10 en juillet) — l'écart entre l'architecture cible et l'implémentation réelle s'est réduit sur les points financiers critiques, mais les chantiers de fond (tests automatisés, dépendances, monolithe AppContext, pagination serveur) restent ouverts et pèsent de plus en plus lourd à mesure que le projet grossit (~30 400 lignes contre ~23 400 en juillet).

---

## 1. Ce qui a changé depuis le 4 juillet

| Constat de juillet | Statut aujourd'hui |
|---|---|
| Incohérence `quantite`/`prixUnitaire` vs `packs`/`prix` dans `firestore.rules` | **Résolu** — les règles actuelles ne référencent plus de noms de champs, l'accès est géré par rôle (`canWrite()`) |
| Double écriture à la création d'une vente (CF + client) | **Résolu** — le client réutilise l'id retourné par la Cloud Function (`cfVenteId`) au lieu d'en générer un second |
| Commission/bonus calculés à la volée, non figés | **Résolu** — `tauxCommission` est désormais figé sur chaque vente (`commissionVente()` dans `helpers.ts`), avec repli sur le taux courant pour l'historique antérieur |
| Pas d'édition des clients | **Résolu** — `ClientsSection.tsx` permet la modification complète (nom, type, zone, tél, prix, plafond de crédit) |
| Sauvegarde manuelle écrasant la précédente | **Résolu** — nom de fichier horodaté à la seconde près (`getDateTimeString()`) |
| Duplication de la logique de commission (3 endroits) | **Partiellement résolu** — `CommerciauxSection.tsx`, `exportComptable.ts` et `tests-calculs.ts` utilisent désormais tous `commissionVente()` de `helpers.ts` ; la Cloud Function `validateVente` reste une 4ᵉ implémentation séparée à vérifier |
| Hébergement Manus | **Migré vers Vercel** — déploiement automatique à chaque push sur `main`, build `vite build` uniquement (le serveur Express n'est plus nécessaire en production) |
| — | **Nouveau** : gestion mensuelle (sélecteur de mois) pour Commerciaux/Livreurs/Producteurs, avec calcul de commission désormais correctement filtré par mois sélectionné |
| — | **Nouveau** : plantage de la page Stock corrigé (tri sur un champ `timestamp` potentiellement absent) |

---

## 2. Architecture et structure

Toujours d'actualité : dualité de persistance (ancien format document unique `meta/data` vs nouveau format un-document-par-entité, contrôlée par le booléen mutable `useNewArchitecture`), absence de couche service, logique métier dispersée dans les composants de section.

**Point d'attention nouveau : `AppContext.tsx` a grossi de ~520 à 938 lignes** depuis juillet (ajout du rafraîchissement périodique de token, du garde-fou anti-écho par collection `lastFieldSaveRef`, etc.). La recommandation de juillet — extraire vers des contextes/services dédiés — est donc encore plus pertinente qu'avant : chaque ajout de fonctionnalité continue d'alourdir un fichier déjà identifié comme monolithique.

Le projet est passé d'environ 23 400 à **~30 400 lignes** de code TypeScript/React (hors `node_modules`).

---

## 3. Sécurité

### 3.1 Règles Firestore (`firestore.rules`) — relu intégralement

- Les collections opérationnelles (`ventes`, `clients`, `production`, `depenses`, `recouvrements`, `livraisons`, `emballages`, `versements`, `apports`, `meta`, `params`) sont toutes protégées par `canWrite()` (rôles `admin`/`caissier`/`commercial`) en écriture et `isAuthenticated()` en lecture — cohérent et fonctionnel.
- **Correction à l'audit précédent** : celui de juillet affirmait que l'immutabilité des recouvrements était « excellente (règles Firestore) ». En relisant les règles actuelles, `match /recouvrements/{docId} { allow write: if canWrite(); }` — la règle autorise en réalité l'écriture complète (pas de restriction `update`/`delete` séparée) à tout rôle opérationnel. Si une immutabilité réelle existe, elle n'est appliquée que côté client (absence de bouton de suppression), pas au niveau des règles serveur. **À corriger si l'immutabilité des recouvrements est réellement voulue** : séparer `allow create` de `allow update, delete: if false`.
- `audit_log` reste inscriptible (`create`) par tout utilisateur authentifié, comme relevé en juillet — non corrigé.
- `backups`, `backups_auto`, `backup_logs` : accès admin uniquement en lecture, écriture bloquée côté client pour les deux derniers (cohérent avec l'écriture via le SDK Admin des Cloud Functions).

### 3.2 Cloud Functions et claims

Le correctif apporté cette session (`setUserClaims` avec repli par e-mail, `createUserWithRole` gérant le cas « compte déjà existant ») répond directement au bug de désynchronisation rôle local/claims Firebase qui causait les erreurs de permission. **Point de vigilance : le déploiement de ces deux fonctions (`functions:roles-validation:setUserClaims,functions:roles-validation:createUserWithRole`) et le resynchronisation des rôles utilisateurs existants n'ont pas été confirmés comme effectués** — à vérifier dans la rubrique Utilisateurs (chaque compte doit avoir un rôle Firebase à jour, pas seulement un rôle local).

### 3.3 Toujours ouverts (inchangés depuis juillet)

- **2FA entièrement côté client** (secret TOTP lisible dans Firestore, vérification dans le navigateur) — reste un point cosmétique plutôt qu'une vraie barrière de sécurité.
- **Clé API Firebase en dur** dans `firebase.ts` (en plus du repli par variable d'environnement) — risque faible par construction (clé publique par design chez Firebase) mais empêche une rotation propre.
- **Mode fallback client direct** quand les Cloud Functions sont indisponibles : ce point était présenté en juillet comme une faille à supprimer ; le contexte du projet (`cloudFunctions.ts`, commenté explicitement) le présente désormais comme un choix assumé de résilience plutôt qu'un oubli — un utilisateur malveillant pourrait toujours en théorie simuler l'indisponibilité des CF pour contourner la validation serveur sur les opérations sensibles (ventes, clôtures). Le compromis reste défendable pour la continuité de service, mais mérite d'être documenté comme un risque accepté plutôt que oublié.

---

## 4. Dépendances et supply chain *(nouveau — non couvert en juillet)*

Un `pnpm audit --prod` a été exécuté sur le dépôt : **64 vulnérabilités trouvées (16 hautes, 41 modérées, 7 faibles)**.

Détail des constats les plus exploitables :

- **`axios` (dépendance directe, `^1.12.0`) n'est utilisé nulle part dans le code** (ni `client/src`, ni `server`, ni les deux dossiers de Cloud Functions) — vérifié par recherche exhaustive. Il apporte à lui seul la majorité des CVE hautes remontées (fuite d'identifiants proxy, pollution de prototype, ReDoS, SSRF partielle). **Action recommandée : le supprimer purement et simplement de `package.json`** — gain de sécurité immédiat à risque nul, puisqu'aucun code n'en dépend.
- **`xlsx` (SheetJS, `^0.18.5`)** — utilisé réellement pour l'export Excel (fonctionnalité active). Cette version contient des vulnérabilités connues (pollution de prototype, ReDoS) que les mainteneurs de SheetJS ne patchent plus sur le registre npm public — ils recommandent d'installer la version corrigée directement depuis leur propre CDN (`https://cdn.sheetjs.com/...`) plutôt que via `npm install xlsx`. À planifier, car c'est la seule vulnérabilité haute liée à une dépendance réellement utilisée par l'app.
- `path-to-regexp` (ReDoS) — provient d'`express`, qui n'est utilisé que par le serveur statique local (`server/index.ts`), lui-même **non exécuté en production sur Vercel** (le build Vercel sert les fichiers statiques directement). Risque réel faible en production, mais à corriger si `pnpm start` est encore utilisé ailleurs (ex. démonstration locale).
- `lodash` (injection de code via `_.template`) — dépendance transitive, non appelée avec une entrée utilisateur non fiable dans le code du projet à notre connaissance ; risque théorique faible.
- `form-data` (injection CRLF) — également transitif.

**Recommandation générale** : lancer `pnpm audit --fix` pour les correctifs automatiques disponibles, retirer `axios`, et traiter `xlsx` en priorité étant donné qu'il est directement exposé à des fichiers potentiellement manipulés (import de données).

---

## 5. Qualité du code

| Métrique | Juillet 2026 | Août 2026 |
|---|---|---|
| Lignes de code | ~23 400 | ~30 400 |
| Fichiers de test automatisés | 0 | 0 (inchangé) |
| `console.log`/`console.warn` | 2 | 8 |
| `TODO`/`FIXME` | — | 0 |
| Plus gros fichier | `StockSection.tsx` | `StockSection.tsx` (1135 lignes, a grossi) |
| `AppContext.tsx` | ~520 lignes | 938 lignes |

**Toujours aucun test automatisé** — sur un projet qui gère désormais 30 000+ lignes et des calculs financiers (commissions, clôtures, comptabilité SYSCOHADA), c'est le risque de fond le plus important après la sécurité des dépendances.

**Nouvelle observation — classe de bugs « champ optionnel non protégé »** : le plantage de la page Stock (`b.timestamp.localeCompare(a.timestamp)` sur un mouvement sans `timestamp`) illustre un pattern qui peut exister ailleurs dans le code : tout tri/formatage qui suppose qu'un champ est toujours présent, alors que des données anciennes ou importées peuvent en être dépourvues. Une revue ciblée des `.sort()`, `.toLocaleDateString()` et accès directs à des champs sur des tableaux issus de Firestore (plutôt qu'une correction ponctuelle) réduirait le risque de plantages similaires dans d'autres sections (Historique, Journal, Livraisons notamment, qui manipulent aussi des dates/horodatages).

---

## 6. UX/UI

- **Édition des clients** : résolu (voir section 1).
- **Redesign complet + mode sombre** : livré cette session — palette bleu marine, sidebar sombre permanente, cartes KPI restylées.
- **Gestion mensuelle Commerciaux/Livreurs/Producteurs** : un sélecteur de mois est désormais disponible sur les trois rubriques, avec un minimum de mois calculé automatiquement à partir de la première donnée réelle (pas de mois vides antérieurs à juillet 2026 proposés). La commission affichée pour Commerciaux suit maintenant le mois sélectionné plutôt qu'un cumul depuis toujours.
- **Navigation non URL-based** : toujours inchangé (pas de deep-linking, pas de bouton retour navigateur).
- **Confirmations de suppression** : non revérifiées de façon exhaustive cette fois-ci ; à recontrôler section par section si cela redevient une priorité.

---

## 7. Fiabilité métier et intégrité des données

- **Double écriture des ventes** : résolue.
- **Commission/bonus figés à la vente** : résolu.
- **Stock non transactionnel** (mouvements concurrents non garantis atomiques) : toujours ouvert, inchangé depuis juillet.
- **Bug Stock (tri sur `timestamp` manquant)** : corrigé cette session — filet de sécurité ajouté (repli sur `date` si `timestamp` absent) aux deux endroits concernés du fichier.

---

## 8. Performance et scalabilité

Le build local (`vite build`) n'a pas pu être exécuté dans cet environnement d'audit (binaire natif Rollup manquant pour l'architecture du bac à sable) — les métriques précises de taille de bundle de juillet n'ont donc **pas pu être revérifiées** ce tour-ci. Le déploiement Vercel construit et sert correctement l'application (build `READY` confirmé), donc le build fonctionne en conditions réelles ; seule la mesure fine (taille en Ko par chunk) reste à refaire lors d'un prochain audit avec un accès build complet.

Ce qui reste vrai indépendamment de la mesure exacte : le SDK Firebase complet, Radix UI et `xlsx` continuent de peser sur le bundle principal ; **aucune pagination serveur** n'a été ajoutée (`onSnapshot` sans `limit()` sur les grandes collections) ; ce point reste la limite de montée en charge la plus probable au-delà de quelques milliers de ventes.

---

## 9. Déploiement

- **Migration Vercel terminée et stable** : build `READY`, déploiement automatique à chaque push sur `main`/`dev`, `vercel.json` correctement configuré (framework Vite, `outputDirectory: dist/public`, réécriture SPA).
- **À vérifier côté utilisateur** (non contrôlable depuis cet environnement, l'accès à l'API Vercel a été interrompu en cours d'audit) : que la variable d'environnement `VITE_GOOGLE_MAPS_API_KEY` et, si définies, les `VITE_FIREBASE_*` dans les réglages du projet Vercel pointent bien vers le projet Firebase `ma2f-aquasachet` — une valeur erronée ou un projet Firebase différent y serait indétectable en local puisque le code a un repli codé en dur vers le bon projet, mais toute variable Vercel réellement définie prend le pas sur ce repli.
- Deux codebases de Cloud Functions (`default`, `roles-validation`) restent correctement déclarées dans `firebase.json`, évitant le risque de suppression accidentelle rencontré début août.

---

## 10. Synthèse des risques par priorité

### Critiques (résolus depuis juillet)
- ~~Incohérence des noms de champs Firestore~~ ✅
- ~~Double écriture des ventes~~ ✅
- ~~Commission/bonus non figés~~ ✅

### Nouveaux / à traiter en priorité
| # | Risque | Impact | Effort |
|---|---|---|---|
| 1 | `axios` : dépendance morte apportant la majorité des CVE hautes | Surface d'attaque inutile | Très faible (suppression directe) |
| 2 | `xlsx` (SheetJS) : vulnérabilités connues sur une fonctionnalité active (export Excel) | Fichiers Excel générés/importés potentiellement exploitables | Faible-moyen (changer la source d'installation du paquet) |
| 3 | Règles Firestore : `recouvrements` pas réellement immuables côté serveur, contrairement à ce qui était documenté | Un rôle opérationnel pourrait modifier/supprimer un recouvrement déjà enregistré | Faible |
| 4 | Déploiement des correctifs de claims (`setUserClaims`/`createUserWithRole`) non confirmé | Le bug de permission Firestore pourrait resurgir pour des comptes non resynchronisés | Faible (juste à exécuter/vérifier) |

### Toujours ouverts (inchangés depuis juillet)
- 2FA client-side sans protection serveur
- Absence totale de tests automatisés
- Pas de pagination serveur
- `audit_log` inscriptible par tout utilisateur authentifié
- AppContext monolithique (aggravé : +80% de lignes)
- Navigation non URL-based
- Fallback client direct sur opérations sensibles (risque documenté, assumé)

---

## 11. Feuille de route recommandée (mise à jour)

**Immédiat (quelques heures)**
- Supprimer `axios` de `package.json` et relancer `pnpm audit` pour confirmer la baisse du nombre de CVE.
- Vérifier/finaliser le déploiement des Cloud Functions de claims et la resynchronisation des rôles utilisateurs existants.
- Clarifier l'intention sur l'immutabilité des recouvrements et, si elle est voulue, séparer `create` de `update/delete` dans `firestore.rules`.

**Court terme (1-2 semaines)**
- Migrer l'export Excel vers la version corrigée de `xlsx` (installation via le CDN officiel SheetJS plutôt que npm).
- Auditer les autres sections manipulant des dates/horodatages (Historique, Journal, Livraisons) pour le même type de bug que celui corrigé sur Stock.
- Restreindre l'écriture dans `audit_log` aux seules Cloud Functions.

**Moyen terme (1-2 mois)**
- Ajouter des tests automatisés sur les calculs financiers (commission, bonus, clôture) et la validation des ventes.
- Commencer l'extraction de logique métier hors d'`AppContext.tsx` (déjà passé à 938 lignes) vers des services dédiés.
- Migrer la 2FA vers un challenge serveur.
- Implémenter la pagination serveur sur les grandes collections.

---

## Conclusion

L'application a fait un vrai bond en fiabilité financière depuis juillet : les trois risques critiques identifiés alors (règles Firestore incohérentes, doublons de ventes, commissions non figées) sont résolus, et plusieurs lacunes fonctionnelles importantes (édition des clients, gestion mensuelle) ont été comblées. La migration vers Vercel s'est faite proprement.

Le risque a en partie changé de nature : il ne s'agit plus tant de bugs métier critiques que d'une dette qui continue de s'accumuler (AppContext qui grossit, toujours aucun test) et d'un angle mort nouvellement révélé — la santé des dépendances, où une suppression triviale (`axios`) réglerait à elle seule la majorité des vulnérabilités hautes remontées. Le prochain audit devrait porter en priorité sur la vérification effective du déploiement des correctifs de claims, le nettoyage des dépendances, et un premier socle de tests automatisés sur les calculs financiers.
