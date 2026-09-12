# Contrat de production — pilote MA2F

Cette commande est implémentée pour la base fictive `ma2f_pilot` seulement. L'interface MA2F existante ne l'utilise pas. Les écritures sont désactivées par défaut, indépendamment des lectures. Elle ne gère pas encore les lots, rebuts ou contributions de plusieurs producteurs.

## Requête

`POST http://127.0.0.1:18080/v1/pilot/production`

En-têtes : `Content-Type: application/json`, longueur du corps, `Authorization: Bearer <jeton de production du pilote>`.

```json
{
  "request_id": "0466b1a4-0c85-4bce-b158-4f3d64c4c729",
  "produced_units": 300,
  "consumed_kg": "0.60"
}
```

- `request_id` : UUID unique pour cette opération. Conserver cet identifiant ET le contenu lors de toute reprise après timeout. En créer un nouveau seulement pour une nouvelle fabrication.
- `produced_units` : nombre entier de sachets conformes, de 1 à 100 000. Aucune conversion implicite en packs.
- `consumed_kg` : consommation réelle de plastique, chaîne décimale positive, au plus deux décimales et 1 000 kg. Ces limites sont celles du pilote, pas une cadence industrielle validée.
- Aucun autre champ n'est accepté, notamment utilisateur, société, article, emplacement, modèle ou contexte Odoo. Corps limité à 4 096 octets ; doublons de clés JSON refusés.

L'article et l'emplacement proviennent des références internes du pilote. L'acteur `pilot:operator` est fixé par le serveur et indique uniquement une identité de test. L'authentification des salariés et l'attribution nominative Firebase restent à développer avant toute donnée réelle.

## Résultats

| Réponse | Sens |
|---|---|
| 200, `data.state=done` | Fabrication validée dans Odoo, avec référence de l'ordre. |
| 200, `data.replayed=true` | La même demande avait déjà réussi ; résultat retrouvé sans nouvelle fabrication. |
| 400 / 413 / 415 | Requête invalide, trop grande ou mauvais format ; aucun appel métier transmis. |
| 401 / 403 | Identité absente, mauvais droit ou écritures désactivées. |
| 409 `MA2F_REQUEST_CONFLICT` | Identifiant déjà utilisé avec d'autres quantités ; ne pas modifier la demande pour forcer la reprise. |
| 409 `MA2F_INSUFFICIENT_STOCK` | Le plastique disponible/réservable ne permet pas cette fabrication. |
| 409 autre code métier | Configuration non prise en charge ou validation complémentaire requise ; aucune opération complète annoncée. |
| 503 `odoo_result_unknown` | Résultat inconnu : la transaction peut avoir été validée avant la coupure. Réessayer avec le même UUID et les mêmes quantités. |

Les erreurs Odoo arbitraires et traces internes ne sont pas renvoyées au client. Les journaux de la passerelle contiennent l'UUID, l'acteur de test et le résultat, sans jetons ni corps complet. Le registre Odoo conserve les opérations réussies et leur compte technique ; les refus restent des événements de passerelle, pas des écritures de stock.

## Transaction et anti-doublon

Un addon distinct fournit `ma2f.pilot.operation.record_production`. Il vérifie le groupe, la base de test, la société et l'activation avant de traiter la commande. Le registre n'est pas directement modifiable par l'identité technique.

Le serveur normalise les quantités et calcule une empreinte. Un verrou transactionnel par société repose sur la mise à jour d'une ligne dédiée, afin qu'un appel concurrent avec une ancienne vue des données rencontre une erreur de sérialisation et soit repris par le moteur RPC Odoo. Une contrainte SQL rend unique le couple société/UUID. Ce mécanisme a été éprouvé par `live-test` sur l’instance réelle : six appels identiques simultanés, puis deux commandes concurrentes en concurrence pour le stock. Voir `VERIFICATION.md` pour les résultats ; ce n’est pas une mesure de charge en production.

La fabrication, la réservation de matière, la validation et le résultat du registre sont enregistrés dans la même transaction Odoo. Un point de sauvegarde annule aussi les effets partiels si un appel interne attrape l'erreur. Aucune validation ou consommation autonome n'est écrite dans Firebase. Les mouvements natifs Odoo réservent la matière avant consommation ; la commande n'utilise pas une simple soustraction locale.

Sources de comportement Odoo : [reprises des erreurs concurrentes](https://github.com/odoo/odoo/blob/19.0/odoo/service/model.py), [fabrication](https://github.com/odoo/odoo/blob/19.0/addons/mrp/models/mrp_production.py). La présence de ce code ne remplace pas les tests de l'image épinglée.

## Installation et activation après recette

```powershell
# Nouveau pilote
python pilot/manage.py init

# Ou pilote déjà initialisé, pour ajouter/mettre à jour l'addon
python pilot/manage.py upgrade

# Recette native avec rollback des données fictives
python pilot/manage.py commands-test

# Activation locale, seulement après succès de la recette
python pilot/manage.py enable-production

# Désactivation
python pilot/manage.py disable-production
```

`commands-test` vérifie le refus sans droits, les quantités invalides, le stock insuffisant, la consommation réelle, la relance identique, la relance modifiée et l'annulation d'une fabrication interrompue. Les changements métier sont annulés à la fin. Un rapport `.local/commands-result.json` contient le résultat et l'empreinte des fichiers de l'addon.

`enable-production` exige un rapport réussi correspondant au code actuel et relance les tests locaux de la passerelle. L'activation a deux niveaux : drapeau serveur Odoo et drapeau du connecteur. Cela autorise des essais locaux seulement, pas un déploiement de production. Les tests natifs séquentiels ne constituent pas une recette de concurrence ni une vérification complète HTTP ↔ Odoo.

La commande de désactivation ferme d'abord le drapeau local, même si Docker est indisponible. Les requêtes déjà engagées peuvent encore se terminer ; il faut rapprocher leurs UUID avant de conclure qu'aucune opération n'a été traitée.

Les jetons lecture/production et les clés Odoo correspondantes sont quatre secrets distincts, sous `.local/`, exclus de Git. Ne pas les publier ou les intégrer à un navigateur. La clé technique de production détient les droits natifs de stock/fabrication : la limite à cette seule commande est imposée par la passerelle, et dépend du maintien de cette clé côté serveur.
