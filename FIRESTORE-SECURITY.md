# Guide de déploiement des règles de sécurité Firestore

## Prérequis

1. Installer Firebase CLI : `npm install -g firebase-tools`
2. Se connecter : `firebase login`
3. Initialiser le projet : `firebase init firestore`

## Déploiement des règles

### Option 1 : Via Firebase CLI

```bash
firebase deploy --only firestore:rules
```

### Option 2 : Via la console Firebase

1. Allez sur [console.firebase.google.com](https://console.firebase.google.com)
2. Sélectionnez votre projet **ma2f-aquasachet**
3. Menu gauche → **Firestore Database** → onglet **Règles**
4. Copiez-collez le contenu du fichier `firestore.rules`
5. Cliquez sur **Publier**

## Configuration des Custom Claims (rôles)

Les règles utilisent `request.auth.token.role` pour vérifier les rôles.
Vous devez configurer les custom claims via Firebase Admin SDK.

### Script de configuration (à exécuter une seule fois par utilisateur)

Créez un fichier `set-claims.mjs` :

```javascript
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialiser avec votre clé de service
const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Attribuer un rôle à un utilisateur
async function setRole(email, role) {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { role });
  console.log(`Rôle "${role}" attribué à ${email}`);
}

// Exemples :
await setRole('ziza220@gmail.com', 'admin');
await setRole('mouyana.ma2f@gmail.com', 'caissier');
```

Exécuter : `node set-claims.mjs`

## Structure des collections

| Collection | Contenu | Accès écriture |
|---|---|---|
| `ventes` | Toutes les ventes | admin, caissier, commercial |
| `clients` | Base clients | admin, caissier, commercial |
| `production` | Productions journalières | admin, caissier (suppression: admin seul) |
| `depenses` | Dépenses | admin, caissier |
| `recouvrements` | Encaissements | admin, caissier, commercial (suppression interdite) |
| `meta` | Users, params, commerciaux, livreurs, véhicules, journal | admin, caissier |

## Vérification

Après déploiement, testez en vous connectant avec différents comptes :
- Un admin doit pouvoir tout faire
- Un caissier ne doit pas pouvoir supprimer une production
- Un commercial ne doit pas pouvoir modifier les dépenses
- Un lecteur ne doit pouvoir que consulter

## Rollback

En cas de problème, remettez les règles permissives temporairement :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Puis corrigez et redéployez les règles strictes.
