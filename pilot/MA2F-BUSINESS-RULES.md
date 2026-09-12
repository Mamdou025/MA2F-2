# Règles MA2F confirmées

Confirmées par l'utilisateur le 7 septembre 2026 :

- Un pack contient **30 sachets**.
- La production saisie correspond aux **packs prêts à vendre**, après retrait des sachets défectueux.
- L'identité du seul utilisateur ayant accès directement à Odoo sera décidée plus tard.

## Stock et défauts de fabrication

Confirmation du 9 septembre 2026 : conserver pour le moment l'estimation actuelle de consommation plastique (packs divisés par le paramètre de rendement existant). Ne pas imposer une saisie de kilogrammes mesurés par lot. Cette estimation reste distincte d'une consommation réellement mesurée ; toute évolution sera décidée ultérieurement.

100 packs saisis donnent **3 000 sachets vendables**. Avec, par exemple, 12 sachets défectueux suivis séparément, la fabrication brute représente 3 012 sachets, dont 3 000 vendables et 12 rejetés. Il ne faut jamais retirer ces 12 sachets une seconde fois des 3 000 vendables.

Le calcul de référence partagé est dans `addons/ma2f_pilot_commands/pack_quantities.py` (réexporté par `ma2f_quantities.py`), avec tests de conversion et de non-double-déduction. Aucun rendement plastique n'est déduit du seul nombre de packs : les ratios et durées de conservation du pilote restent fictifs.

Pour le futur raccordement Odoo avec rebuts, la fabrication brute suivie d'une mise au rebut native doit laisser exactement la quantité nette vendable. Un dommage survenant **après** l'entrée en stock vendable est un événement de perte distinct qui réduit ce stock.

## Limites du raccordement actuel

Le backend est maintenant raccordé : `POST /v1/ma2f/production` prend les packs nets, les sachets rejetés et la consommation totale de plastique. Odoo fabrique la quantité brute puis effectue une mise au rebut native dans la même transaction. `GET /v1/ma2f/stock` renvoie le stock usine réel et réservé, en sachets et en packs complets. Le client backend `ma2f_client.py` et la commande locale `ma2f.py` utilisent ces routes. Les écrans Firebase restent séparés ; aucun jeton pilote n'est embarqué dans le navigateur. L'ancienne route de test en unités reste compatible.

Les données historiques ne sont pas converties automatiquement : l'ancienne interface mélange des libellés de sachets et des mouvements en packs. La règle confirmée définit la cible ; elle ne prouve pas l'unité réellement utilisée pour chaque ancienne saisie.
