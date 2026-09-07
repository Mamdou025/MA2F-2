# Cloud Functions Firebase — MA2F AquaSachet

> ⚠️ **Non déployé actuellement.** `firebase.json` (à la racine du projet) ne référence
> que le dossier `functions/` (sauvegarde Google Drive). Les fonctions listées ici
> (custom claims, validation serveur, audit log) sont inactives tant qu'un déploiement
> dédié n'est pas fait depuis ce dossier — voir la section Déploiement plus bas.
> La fonction `dailyBackup` (sauvegarde Firestore→Firestore, doublon de
> `dailyBackupToGoogleDrive`) a été retirée du code pour éviter toute confusion —
> voir `src/index.ts`.

## Objectif

Ces Cloud Functions assurent la **validation côté serveur** de toutes les opérations critiques. Elles rendent les règles Firestore opérantes en attribuant les custom claims (rôles) aux utilisateurs.

## Prérequis

- Node.js 18+
- Firebase CLI (`npm install -g firebase-tools`)
- Projet Firebase configuré (`firebase login && firebase use ma2f-aquasachet`)

## Déploiement

```bash
cd cloud-functions
npm install
npm run build
firebase deploy --only functions
```

## Structure

```
cloud-functions/
├── README.md           ← Ce fichier
├── package.json        ← Dépendances Firebase Functions
├── tsconfig.json       ← Configuration TypeScript
└── src/
    └── index.ts        ← Toutes les fonctions (13 au total)
```

## Fonctions disponibles

| # | Fonction | Type | Rôle requis | Description |
|---|----------|------|-------------|-------------|
| 1 | `createUserWithRole` | Callable | admin | Crée un utilisateur Firebase Auth avec custom claims |
| 2 | `setUserClaims` | Callable | admin | Met à jour les rôles d'un utilisateur existant |
| 3 | `toggleUserStatus` | Callable | admin | Active/désactive un utilisateur |
| 4 | `onUserCreate` | Trigger Auth | - | Attribue le rôle par défaut au premier login |
| 5 | `validateAndCreateVente` | Callable | admin, caissier, commercial | Valide une vente côté serveur |
| 6 | `enregistrerPaiement` | Callable | admin, caissier, commercial | Valide un recouvrement |
| 7 | `cloturerCaisse` | Callable | admin | Clôture officielle avec validation écart |
| 8 | `validateDepense` | Callable | admin, caissier | Valide une dépense |
| 9 | `validateProduction` | Callable | admin, caissier | Valide une production |
| 10 | `annulerCloture` | Callable | admin | Annule une clôture (motif obligatoire min 10 car.) |
| 11 | `logAuditAction` | Callable | authentifié | Enregistre une action dans l'audit log immuable |
| 12 | ~~`dailyBackup`~~ | ~~Scheduled~~ | - | Retirée (doublon de `dailyBackupToGoogleDrive` dans `functions/`) |
| 13 | `verifierIntegrite` | Callable | admin | Vérifie l'intégrité des données (montants, créances) |

## Initialisation des claims pour les utilisateurs existants

Après le premier déploiement, les utilisateurs existants n'ont pas de custom claims. Pour les initialiser :

```bash
# Dans la console Firebase ou via un script admin
firebase functions:shell
> setUserClaims({uid: "UID_DE_LADMIN", role: "admin", roles: ["admin"]})
```

Le trigger `onUserCreate` attribue automatiquement le rôle `lecteur` (ou `admin` pour ziza220@gmail.com) à chaque nouvel utilisateur.

## Collections Firestore créées par les fonctions

- `users/` — Profils utilisateurs (séparé de meta)
- `audit_log/` — Journal d'audit immuable côté serveur
- `backups_auto/` — Sauvegardes quotidiennes (rétention 90 jours)

## Sécurité

- Toutes les fonctions vérifient l'authentification et le rôle via custom claims
- Les validations sont strictes : types, bornes, cohérence
- L'audit log est immuable (pas de update/delete côté client)
- La sauvegarde quotidienne est indépendante du navigateur
- L'annulation de clôture exige un motif de minimum 10 caractères
