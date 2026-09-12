# MA2F : reprise fidèle des sources

Décision utilisateur du 8 septembre 2026 : respecter les données sources et poursuivre les étapes techniques sans attendre la résolution métier des anomalies.

## Règles de reprise

- Conserver identifiants, références, valeurs, dates et champs absents dans la copie historique. Ne pas inventer de numéro, mode de paiement, emplacement ou lien client/vente.
- Ne pas rapprocher automatiquement des opérations par ressemblance de nom, montant ou date. Les propositions éventuelles restent distinctes et non appliquées.
- Ne pas recalculer rétroactivement les données historiques avec une nouvelle règle métier. Les comparaisons avec les fonctions historiques servent à contrôler la conversion, pas à certifier les soldes.
- Conserver les différents paramètres de source lorsqu'ils divergent. Le scénario à ouverture de 297 023 FCFA n'efface pas l'ancienne valeur zéro.
- Une anomalie ne bloque pas la conservation de l'historique ni les travaux d'hébergement, d'identité et de raccordement technique.
- Si une écriture native Odoo exige une information absente, conserver l'opération historique séparément et noter pourquoi elle n'a pas été comptabilisée. Ne pas fabriquer cette information pour contourner une contrainte Odoo.
- Distinguer explicitement historique conservé, candidats convertis, opérations natives Odoo et système actuellement actif. Ne pas annoncer une bascule sur la seule réussite d'un import de préparation.

## Application actuelle

Les copies privées et tables de préparation restent inchangées. Aucun classement arbitraire des 383 dépenses sans mode, des 29 recouvrements sans vente ou des 83 mouvements de stock incomplets. Le solde reproduit de 314 537 FCFA reste un résultat historique provisoire, pas une ouverture Odoo approuvée.

La suite technique porte sur le pilote Odoo isolé dans Replit, ses frontières d'accès, la persistance et la restauration. Les comptes fictifs et ratios de test du pilote ne sont pas les paramètres réels de MA2F. La règle réelle déjà confirmée reste 30 sachets par pack, production nette vendable.
