# Raccordement backend MA2F — production et stock

Ce parcours fonctionne contre le pilote Odoo local. Les jetons sont réservés au backend local ; ce n'est pas encore une API publique authentifiée par les comptes Firebase.

## Production

`POST /v1/ma2f/production`, avec le jeton production du pilote :

```json
{
  "request_id": "0466b1a4-0c85-4bce-b158-4f3d64c4c729",
  "saleable_packs": 100,
  "rejected_sachets": 12,
  "consumed_kg": "0.60"
}
```

Les nombres sont illustratifs ; `consumed_kg` doit être la consommation totale réelle, déchets compris, et non un rendement inventé. Les packs nets sont des entiers strictement positifs ; les rejets sont un entier positif ou nul. La quantité brute est limitée à 100 000 sachets dans ce pilote. Le poids est une chaîne décimale positive, avec deux décimales au maximum, limitée à 1 000 kg.

Odoo crée une fabrication de 3 012 sachets et une mise au rebut native de 12 sachets liée à cette fabrication. Le stock vendable augmente de 3 000 sachets, soit 100 packs. La matière est consommée une seule fois. Fabrication, rebut et résultat sont dans la même transaction ; si le rebut échoue, tout est annulé.

La réponse contient les identifiants Odoo de fabrication et de rebut, les quantités nettes/brutes/rejetées et `replayed`. Une reprise doit conserver **le même UUID et les mêmes valeurs**. Un changement du nombre de rejets avec le même UUID donne un conflit. Les UUID sont aussi protégés contre une réutilisation entre l'ancienne commande en unités et la nouvelle commande en packs.

Un résultat HTTP 503 ou une coupure réseau peut survenir après validation : état **inconnu**, jamais de nouvel UUID automatique ni d'écriture de secours dans Firebase. Voir aussi `PRODUCTION-API.md` pour les erreurs et les deux drapeaux d'activation.

## Stock

`GET /v1/ma2f/stock`, avec le jeton lecture :

- emplacement **usine** fixe du pilote ; pas une consolidation des camions ;
- quantités de sachets présentes, réservées et disponibles ;
- packs complets disponibles et sachets restants, sans arrondir à la hausse ;
- plastique présent, réservé et disponible en kg.

Les totaux viennent d'une agrégation PostgreSQL dans Odoo, sans troncature à une page de 100 lignes. Un stock indisponible donne une erreur explicite ; aucune valeur Firebase de secours n'est présentée comme un stock Odoo.

## Utilisation locale sans modifier les écrans

Depuis la racine du dépôt, avec le pilote démarré :

```powershell
powershell -NoProfile -File pilot/manage-wsl.ps1 up
python pilot/ma2f.py stock
python pilot/ma2f.py prepare-production --packs 100 --rejects 12 --kg 0.60
```

La dernière commande ne produit rien : elle enregistre la demande et son UUID dans `.local/production-requests/`. Pour un essai fictif, après la recette native et avec un stock de plastique suffisant :

```powershell
powershell -NoProfile -File pilot/manage-wsl.ps1 commands-test
powershell -NoProfile -File pilot/manage-wsl.ps1 enable-production
python pilot/ma2f.py submit-production UUID_RETOURNE_PAR_PREPARE
powershell -NoProfile -File pilot/manage-wsl.ps1 disable-production
```

Pour reprendre une demande interrompue, relancer **submit-production avec son UUID existant**, pas `prepare-production`. Le résultat est enregistré séparément ; la demande initiale est conservée. Ces opérations écrivent dans le pilote uniquement.

La recette automatique `powershell -NoProfile -File pilot/manage-wsl.ps1 packs-live-test` fournit son stock fictif, teste les appels concurrents, vérifie stock/registre natifs puis désactive les écritures. Ses enregistrements fictifs restent conservés.

## Périmètre restant

La commande couvre les articles fictifs **sans lots** ; elle refuse une configuration de production incompatible. Elle ne saisit pas encore date métier, machine ou attribution aux producteurs. Les lots, les comptes réels et le raccordement aux écrans seront des extensions explicites. La base actuelle Firebase reste l'application en service jusqu'à une bascule coordonnée ; aucun double enregistrement n'a été introduit.
