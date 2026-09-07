# Vérifier que la sauvegarde quotidienne Google Drive fonctionne réellement

Cette checklist confirme que `dailyBackupToGoogleDrive` (dans `functions/`) tourne bien chaque jour à 23h (Afrique de l'Ouest) et dépose un fichier Excel dans Google Drive. À faire une fois, puis à re-vérifier après tout changement de configuration Firebase/Google.

## 1. Déployer les règles Firestore mises à jour

Les nouvelles règles (`backups`, `corbeille`, `backup_logs`) ne prennent effet qu'après déploiement :

```bash
firebase deploy --only firestore:rules
```

Sans cette étape, la rubrique Sauvegardes de l'app ne pourra pas lire `backup_logs` (le badge de statut restera sur "inconnu").

## 2. Confirmer que la fonction est bien déployée

```bash
firebase deploy --only functions
```

Puis dans la [console Firebase](https://console.firebase.google.com) → **Functions**, vérifier la présence de :
- `dailyBackupToGoogleDrive` (Scheduled)
- `manualBackup` (Callable)

Si elles n'apparaissent pas, le déploiement n'a jamais été fait — c'est la cause la plus probable si aucune sauvegarde n'existe.

## 3. Vérifier la planification (Cloud Scheduler)

Dans [Google Cloud Console](https://console.cloud.google.com) (même projet) → **Cloud Scheduler**, chercher le job associé à `dailyBackupToGoogleDrive`. Il doit être **Activé (Enabled)** avec la fréquence `every day 23:00` et le fuseau `Africa/Dakar`. Un job en pause ou absent = pas de sauvegarde automatique, même si la fonction est déployée.

## 4. Vérifier l'accès Google Drive du compte de service

C'est la cause d'échec la plus fréquente pour ce type de fonction :
1. Dans Google Cloud Console → **APIs & Services**, confirmer que l'**API Google Drive** est activée pour le projet.
2. Identifier l'email du compte de service utilisé par la fonction (Cloud Console → IAM → comptes de service, généralement `xxx@appspot.gserviceaccount.com` ou un compte dédié).
3. Sur [Google Drive](https://drive.google.com), ouvrir (ou créer) le dossier **"MA2F SAVE"** et vérifier qu'il est bien **partagé avec cet email** en accès **Éditeur**. Sans ce partage, chaque tentative d'upload échoue silencieusement côté Drive.

## 5. Regarder les logs d'exécution

Console Firebase → **Functions** → `dailyBackupToGoogleDrive` → **Logs**. Chercher les lignes `✅ Sauvegarde uploadée` (succès) ou `❌ Erreur sauvegarde` (échec, avec le message d'erreur). C'est la source la plus fiable pour diagnostiquer un problème précis.

## 6. Vérifier le journal `backup_logs` dans Firestore

Console Firebase → **Firestore Database** → collection `backup_logs`. Chaque exécution (automatique ou manuelle) y ajoute un document avec `status: "success"` ou `"error"`, une date, et pour les succès le nombre de ventes/clients/etc. sauvegardés. C'est aussi ce que la rubrique **Sauvegardes** de l'app affiche désormais automatiquement (badge vert/orange/rouge) — un moyen rapide de vérifier sans sortir de l'app une fois les règles déployées (étape 1).

## 7. Vérifier le fichier réel sur Drive

Ouvrir le dossier **"MA2F SAVE"** sur Google Drive et confirmer la présence d'un fichier `MA2F_Sauvegarde_AAAA-MM-JJ.xlsx` daté d'aujourd'hui (ou d'hier si avant 23h). Ouvrir le fichier pour vérifier qu'il contient bien les 14 feuilles (VENTES, PRODUCTION, CLIENTS, etc.) avec des données à jour.

## 8. Test immédiat (sans attendre 23h)

Dans la console Firebase → **Functions** → `manualBackup` → onglet **Testing**, exécuter la fonction manuellement (nécessite d'être authentifié). Vérifier ensuite les étapes 5 à 7 pour ce test.

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| Fonction absente de la console | Jamais déployée → étape 2 |
| Fonction déployée, aucun log | Cloud Scheduler en pause/absent → étape 3 |
| Log `❌ Erreur sauvegarde` avec erreur Drive/permission | Dossier non partagé avec le compte de service → étape 4 |
| Tout semble correct mais rien sur Drive | API Drive non activée → étape 4 |
| Badge "inconnu" dans l'app | Règles Firestore pas déployées → étape 1 |

Une fois ces points confirmés, la sauvegarde peut être considérée comme fiable : automatique, quotidienne, et hors de l'appareil/projet Firebase (sur Drive).
