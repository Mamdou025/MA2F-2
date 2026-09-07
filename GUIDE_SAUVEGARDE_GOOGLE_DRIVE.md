# Guide d'installation - Sauvegarde automatique vers Google Drive

## Résumé

Ce système sauvegarde automatiquement **toutes les données** de MA2F AquaSachet en fichier Excel dans un dossier **"MA2F SAVE"** sur Google Drive, chaque jour à **23h00** (heure de Dakar).

---

## Prérequis

- Accès à la [Console Firebase](https://console.firebase.google.com/project/ma2f-aquasachet)
- Accès à la [Console Google Cloud](https://console.cloud.google.com/apis/dashboard?project=ma2f-aquasachet)
- Node.js 18+ installé sur votre ordinateur
- Firebase CLI installé (`npm install -g firebase-tools`)

---

## Étapes d'installation

### Étape 1 : Activer l'API Google Drive

1. Allez sur https://console.cloud.google.com/apis/library?project=ma2f-aquasachet
2. Cherchez **"Google Drive API"**
3. Cliquez dessus puis cliquez **"Activer"**

### Étape 2 : Configurer le compte de service

Le projet Firebase a déjà un compte de service par défaut. Il faut lui donner accès à Google Drive.

1. Allez sur https://console.cloud.google.com/iam-admin/serviceaccounts?project=ma2f-aquasachet
2. Notez l'email du compte de service (format : `ma2f-aquasachet@appspot.gserviceaccount.com`)
3. Ouvrez **Google Drive** dans votre navigateur
4. Créez un dossier nommé **"MA2F SAVE"**
5. Faites un clic droit sur le dossier → **Partager**
6. Ajoutez l'email du compte de service avec le rôle **"Éditeur"**
7. Cliquez **"Envoyer"**

### Étape 3 : Activer Cloud Scheduler

1. Allez sur https://console.cloud.google.com/cloudscheduler?project=ma2f-aquasachet
2. Si demandé, cliquez **"Activer l'API"**

### Étape 4 : Déployer les Cloud Functions

Ouvrez un terminal sur votre ordinateur :

```bash
# 1. Se connecter à Firebase
firebase login

# 2. Aller dans le dossier du projet
cd ma2f-aquasachet

# 3. Installer les dépendances des fonctions
cd functions
npm install

# 4. Compiler le TypeScript
npm run build

# 5. Déployer les fonctions
cd ..
firebase deploy --only functions
```

### Étape 5 : Vérifier le déploiement

1. Allez sur https://console.firebase.google.com/project/ma2f-aquasachet/functions
2. Vous devriez voir deux fonctions :
   - `dailyBackupToGoogleDrive` (planifiée à 23h)
   - `manualBackup` (déclenchable manuellement)

---

## Utilisation

### Sauvegarde automatique
- Se déclenche **chaque jour à 23h00** (heure de Dakar)
- Le fichier Excel est créé dans le dossier **"MA2F SAVE"** de Google Drive
- Nom du fichier : `MA2F_Sauvegarde_2026-07-24.xlsx`

### Sauvegarde manuelle (depuis l'app)
- Le bouton **"Sauvegarde Excel"** dans l'application télécharge le fichier directement
- Le bouton **"Export Excel"** fait la même chose

### Vérifier les logs de sauvegarde
- Console Firebase → Firestore → Collection `backup_logs`
- Chaque sauvegarde (réussie ou échouée) est enregistrée

---

## Contenu du fichier Excel

Chaque sauvegarde contient **14 feuilles** :

| Feuille | Contenu |
|---------|---------|
| VENTES | Toutes les ventes avec BL, client, montant, statut |
| PRODUCTION | Historique de production |
| DEPENSES | Toutes les dépenses par catégorie |
| CLIENTS | Liste des clients avec prix et zone |
| RECOUVREMENTS | Encaissements et recouvrements |
| VERSEMENTS | Versements banque et personnes |
| LIVRAISONS | Réceptions de matière première |
| EMBALLAGES | Achats de cartons d'emballage |
| MAINTENANCE | Interventions de maintenance |
| VEHICULES | Parc véhicules |
| VEHICULE_OPS | Opérations véhicules (carburant, etc.) |
| COMMERCIAUX | Liste des commerciaux |
| LIVREURS | Liste des livreurs |
| PARAMETRES | Configuration de l'application |

---

## Dépannage

### La sauvegarde ne se déclenche pas
- Vérifiez que Cloud Scheduler est activé
- Consultez les logs : Firebase Console → Functions → Logs

### Erreur "Permission denied" sur Google Drive
- Vérifiez que le dossier "MA2F SAVE" est bien partagé avec le compte de service
- L'email doit avoir le rôle "Éditeur"

### Erreur "API not enabled"
- Activez l'API Google Drive : https://console.cloud.google.com/apis/library/drive.googleapis.com?project=ma2f-aquasachet

---

## Coûts estimés

- Cloud Functions : ~0.01$/jour (très faible)
- Cloud Scheduler : Gratuit (3 jobs gratuits/mois)
- Google Drive : Stockage inclus dans votre espace Drive

---

## Fichier firebase.json

Ajoutez cette section à votre `firebase.json` si elle n'existe pas :

```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs18"
  }
}
```
