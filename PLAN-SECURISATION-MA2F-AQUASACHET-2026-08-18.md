# Plan de sécurisation — MA2F AquaSachet

**Date :** 18 août 2026
**Objectif :** proposer une solution de protection de l'application et de ses données ancrée dans des standards reconnus, adaptée à la taille réelle du projet (PME, équipe restreinte) plutôt qu'à un référentiel d'entreprise disproportionné.

**Standards de référence retenus :**
- **OWASP ASVS 5.0** (mai 2025) — référentiel de vérification de la sécurité des applications, structuré en niveaux 1 (basique), 2 (standard) et 3 (critique), et en chapitres (authentification, autorisation, cryptographie, configuration, protection des données, etc.). C'est le standard technique le plus adapté ici car il est conçu pour être appliqué de façon proportionnée plutôt que tout-ou-rien.
- **OWASP Top 10** — pour prioriser les catégories de risque les plus fréquentes (contrôle d'accès défaillant, échecs cryptographiques, mauvaise configuration, échecs d'authentification, journalisation insuffisante).
- **Bonnes pratiques officielles Firebase/Google Cloud** (Firestore Security Rules, App Check, gestion des secrets) — le standard le plus directement applicable puisque c'est l'infrastructure réelle du projet.
- **Loi sénégalaise n° 2008-12 du 25 janvier 2008** sur la protection des données à caractère personnel, et les exigences de la **Commission de Protection des Données Personnelles (CDP)** — cadre légal applicable de plein droit puisque l'application traite des données de clients identifiables (nom, téléphone, zone/adresse, parfois position GPS) sur le territoire sénégalais.

Principe directeur unique qui résume tout ce qui suit : **ne jamais faire confiance au client** (navigateur) pour une décision qui a une conséquence financière ou touche des données personnelles — chaque contrôle ci-dessous est une déclinaison de ce principe à une couche particulière du système.

---

## Vue d'ensemble — défense en profondeur

```
Utilisateur → Navigateur (React/Vite) → Vercel (statique)
                                            │
                                            ▼
                         Firebase Auth (identité) + custom claims (rôle)
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                                ▼
        Cloud Functions (validation serveur)              Firestore Security Rules
        seule voie autorisée pour les opérations           (filet de sécurité, pas
        financières sensibles                               la seule ligne de défense)
                    │                                                │
                    └───────────────────────┬───────────────────────┘
                                            ▼
                                      Firestore (données)
                                      chiffré au repos par Google
```

Aucune de ces couches ne doit être la seule protection. C'est exactement le principe ASVS : plusieurs contrôles indépendants qui se recouvrent, pour qu'une seule faille (ex. une règle Firestore mal écrite) ne suffise pas à compromettre les données.

---

## 1. Identité et contrôle d'accès (ASVS chapitres Authentification/Autorisation)

C'est la catégorie n°1 de l'OWASP Top 10 (« Broken Access Control ») et celle où l'audit du 18 août a trouvé le plus de marge de progression.

**1.1 Remplacer la 2FA maison par le MFA natif de Firebase Auth.** L'implémentation actuelle (`twoFactor.ts`) est un TOTP techniquement correct mais entièrement vérifié côté navigateur, avec le secret lisible dans Firestore — un accès en lecture à la base suffit à le contourner. Firebase Auth propose un **Multi-Factor Authentication natif** (SMS ou TOTP) où la vérification a lieu côté serveur Google, pas dans le code de l'app. C'est un changement à isoler dans une session dédiée (impact sur le flux de connexion), mais c'est la correction qui ferme le plus grand écart entre ce que l'app affiche (« 2FA activée ») et ce qu'elle protège réellement.

**1.2 Éliminer le repli client direct pour les opérations financières.** Aujourd'hui, quand `checkCloudFunctionsAvailability()` échoue à détecter les Cloud Functions, l'app écrit directement dans Firestore sans validation serveur (`cloudFunctions.ts`). C'est un choix assumé pour la continuité de service, mais il viole le principe ASVS d'autorité serveur pour toute opération à conséquence financière (vente, paiement, clôture de caisse). Recommandation concrète et proportionnée : garder le fallback pour les opérations à faible enjeu (lecture, filtres, export), mais **bloquer** (avec message clair à l'utilisateur, pas un échec silencieux) le fallback pour `validateVente`, `validatePaiement`, `cloturerCaisse` et le paiement Wave — ce qui est d'ailleurs déjà le choix fait pour Wave, à généraliser aux trois autres.

**1.3 Firebase App Check.** Actuellement, rien n'empêche un script externe (pas seulement un navigateur légitime) d'appeler directement les Cloud Functions ou Firestore avec des identifiants volés/rejoués. App Check (recommandation officielle Firebase) attache une attestation cryptographique à chaque requête prouvant qu'elle vient bien de l'app déployée (reCAPTCHA Enterprise ou App Check natif pour le web). C'est le complément direct des Security Rules — Google le présente explicitement comme la protection contre l'abus et l'accès non autorisé aux ressources backend. Non implémenté aujourd'hui ; effort modéré (une clé de site + un appel d'initialisation), gain élevé.

**1.4 Rate limiting réel côté serveur.** Le rate limiting actuel (60 opérations/minute) est côté client — contournable par construction. Un rate limiting utile doit vivre soit dans les Cloud Functions elles-mêmes (compteur Firestore ou Redis léger), soit via App Check + les quotas natifs de Firebase.

**1.5 Vérification périodique claims ↔ rôle affiché.** Le bug `onUserCreate` corrigé le 3 août montre que rôle Firestore et claim Firebase Auth peuvent diverger silencieusement. Recommandation : une Cloud Function planifiée hebdomadaire (`integrityCheck` existe déjà pour le stock/caisse — un équivalent pour les rôles serait cohérent) qui compare `users/{uid}.role` et le custom claim réel, et alerte l'admin en cas d'écart.

---

## 2. Protection des données et conformité légale sénégalaise (ASVS Protection des données + Loi n° 2008-12)

L'application traite des données à caractère personnel (nom, téléphone, zone/adresse, parfois coordonnées GPS de clients) sur des personnes physiques identifiables au Sénégal — la **loi n° 2008-12** s'applique de plein droit, quelle que soit la taille de l'entreprise, et la **CDP** (Commission de Protection des Données Personnelles) en est l'autorité de contrôle.

Ce que la loi exige concrètement, et où en est l'application :

| Obligation légale | État actuel |
|---|---|
| **Finalité déclarée** — ne collecter que pour un usage précis | Respecté dans l'usage (données clients utilisées pour la facturation/livraison), mais non formalisé par écrit |
| **Sécurité technique et organisationnelle appropriée** contre perte/vol/accès non autorisé | Partiellement — Firestore Rules + chiffrement Google natif au repos, mais 2FA cosmétique et jeton GitHub exposé (voir audit) affaiblissent la partie « organisationnelle » |
| **Droits des personnes** (accès, rectification, opposition) | **Absent** — aucun mécanisme, même manuel, pour qu'un client demande la suppression ou la correction de ses données |
| **Durée de conservation limitée**, suppression une fois l'objectif atteint | **Absent** — aucune politique de purge ; les données (y compris la Corbeille et l'historique) semblent conservées indéfiniment |
| **Déclaration préalable à la CDP** pour certains traitements | À vérifier — la géolocalisation de clients et le paiement mobile money (Wave) sont le type de traitement susceptible de nécessiter une déclaration ; un avis juridique local est recommandé plutôt qu'une supposition technique de ma part |

**Recommandations concrètes, par ordre d'effort croissant :**
1. Rédiger une politique de confidentialité interne d'une page (finalité, durée de conservation, qui a accès) — coût quasi nul, comble la lacune « organisationnelle » la plus visible.
2. Ajouter une durée de rétention explicite pour la Corbeille et les vieux enregistrements (ex. purge automatique après N mois pour les données non financières), avec conservation illimitée uniquement pour ce que la comptabilité SYSCOHADA/OHADA impose de garder.
3. Se renseigner auprès de la CDP (ou d'un conseil juridique local) sur l'obligation de déclaration pour la géolocalisation client et le paiement mobile money — c'est la seule partie de ce plan qui sort du champ technique et nécessite un avis professionnel local, je ne peux pas trancher cela à la place d'un juriste.
4. Documenter un processus manuel (même par e-mail à l'admin) pour qu'un client puisse demander l'accès/la suppression de ses données — répond à l'exigence « droits des personnes » sans développement lourd.

---

## 3. Configuration et gestion des secrets (ASVS Configuration, OWASP Top 10 « Security Misconfiguration »)

C'est directement lié aux constats de l'audit du 18 août :

- **Jeton GitHub exposé en clair** dans `.git/config` local — à révoquer et remplacer par une authentification via trousseau macOS ou clé SSH dédiée (déjà recommandé dans l'audit, rappelé ici car c'est une non-conformité ASVS directe : secrets jamais stockés en clair sur disque).
- **Clé API Firebase et clé Google Maps codées en dur** dans le code source (`firebase.ts`, `.env.example`, `Map.tsx`). Pour Firebase, le risque est faible par construction (clé publique par design), mais pour Google Maps, une clé avec facturation activée mérite une vraie gestion de secret : la faire vivre uniquement en variable d'environnement Vercel, retirer le repli codé en dur maintenant que l'hébergement Manus (qui imposait cette solution de contournement) a été abandonné au profit de Vercel.
- **Clé API Wave** — déjà bien traitée (jamais exposée au client, uniquement côté Cloud Function). Recommandation de renforcement : migrer son stockage vers **Google Secret Manager** plutôt qu'une variable d'environnement Cloud Functions classique, pour bénéficier de la rotation et de l'audit d'accès natifs — bonne pratique officielle Google pour tout secret de paiement.

---

## 4. Journalisation et intégrité de la piste d'audit (OWASP Top 10 « Logging & Monitoring Failures »)

Le chaînage SHA-256 de `auditChain.ts` est une bonne intention, mais construit côté client, il reste falsifiable par un utilisateur qui contrôlerait son propre navigateur/session. Pour qu'une piste d'audit soit opposable (utile en cas de litige ou de contrôle comptable OHADA), le calcul du hash de chaînage doit être fait **côté Cloud Function**, pas côté client — c'est cohérent avec les autres fonctions serveur déjà en place (`validateVente`, `cloturerCaisse`). `audit_log` étant déjà `write: if false` pour le client, c'est un renforcement naturel plutôt qu'un chantier nouveau.

---

## 5. Sauvegarde et continuité d'activité

En lien direct avec les bugs corrigés le 18 août :
1. **Confirmer le déploiement effectif** des correctifs de sauvegarde (déjà signalé en priorité 1 de l'audit).
2. **Tester une restauration réelle** au moins une fois — le fichier Excel généré n'a, à ma connaissance, jamais été testé en tant que source de restauration effective avant l'incident du 17-18 août qui a révélé qu'il était vide depuis des mois. Un test de restauration trimestriel (même manuel) est la seule façon de savoir qu'une sauvegarde fonctionne réellement.
3. **Sortir la sauvegarde du seul projet Firebase** : la sauvegarde actuelle (Cloud Storage du même projet `ma2f-aquasachet`) protège contre une erreur de manipulation, mais pas contre une compromission ou une suspension du projet Firebase lui-même — un point relevé dans le code (`cloud-functions/src/index.ts`, commentaire sur la fonction de sauvegarde intra-projet supprimée). Une copie mensuelle vers un compte Google Drive/Cloud Storage distinct du projet applicatif fermerait ce point unique de défaillance.

---

## 6. Dépendances et chaîne d'approvisionnement (OWASP Top 10 « Vulnerable Components »)

Déjà détaillé dans l'audit — resitué ici dans le standard : supprimer `axios` (inutilisé), migrer `xlsx` vers la distribution corrigée du CDN SheetJS, et surtout **automatiser** `pnpm audit --prod` plutôt que de le relancer manuellement à chaque audit ponctuel (voir §7 ci-dessous — c'est le rôle naturel d'une CI).

---

## 7. Vérification continue — le chantier structurant manquant

Tous les points ci-dessus partagent un même angle mort : **rien ne les vérifie automatiquement à chaque changement de code**. Il n'existe aujourd'hui aucune intégration continue (CI) sur ce dépôt — Vercel ne fait que construire et déployer, sans exécuter `tsc`, sans lancer les futurs tests, sans relancer `pnpm audit`. C'est la recommandation la plus structurante de ce plan, car elle rend tout le reste durable plutôt que ponctuel :

Une CI minimale (ex. GitHub Actions, gratuite pour un dépôt de cette taille) qui, à chaque push/PR, exécute :
- `pnpm check` (déjà un script existant, juste jamais automatisé)
- `pnpm audit --prod` (échoue la CI si une vulnérabilité haute apparaît)
- les futurs tests automatisés sur les calculs financiers (commission, bonus, clôture — recommandés dans l'audit)

Ce chantier ne protège aucune donnée à lui seul, mais c'est ce qui empêche chacune des régressions découvertes en août (bug Stock, perte de données à la sync, sauvegarde vide) de repasser inaperçue une seconde fois.

---

## Priorisation recommandée

**Cette semaine (déjà dans l'audit, rappelé car bloquant pour tout le reste)**
- Révoquer le jeton GitHub exposé.
- Confirmer le déploiement des correctifs Cloud Functions du 18 août.

**Ce mois-ci — le socle proportionné à un ASVS Niveau 1/2**
- Firebase App Check.
- Bloquer (au lieu de basculer silencieusement) le fallback client sur les opérations financières.
- Retirer les clés codées en dur, migrer la clé Wave vers Secret Manager.
- Politique de confidentialité d'une page + processus manuel pour les droits des personnes (obligations CDP les moins coûteuses à couvrir).
- Mettre en place une CI minimale (`tsc` + `pnpm audit`).

**Ce trimestre — pour atteindre un niveau de protection cohérent avec le volume financier traité**
- Migration de la 2FA vers le MFA natif Firebase Auth.
- Chaînage d'audit calculé côté serveur.
- Sauvegarde hors du projet Firebase + test de restauration réel.
- Premiers tests automatisés sur les calculs financiers, intégrés à la CI.
- Clarification juridique auprès de la CDP sur la déclaration des traitements (géolocalisation, paiement mobile money).

---

## Conclusion

La « meilleure » solution ici n'est pas d'ajouter une couche de sécurité générique de plus, mais de fermer méthodiquement l'écart déjà identifié entre ce que l'application *affiche* comme protection (2FA, audit trail, rate limiting) et ce qu'elle *applique réellement* côté serveur — c'est très exactement la logique de l'OWASP ASVS, qui distingue systématiquement le contrôle déclaré du contrôle vérifiable. En parallèle, le volet légal sénégalais (loi n° 2008-12/CDP) est aujourd'hui le plus en retard : techniquement l'app est raisonnablement protégée pour son échelle, mais aucune politique de conservation ni processus de droits des personnes n'existe encore, alors que ce sont des obligations qui s'appliquent indépendamment de la maturité technique du produit.

---

## Sources

- [OWASP Application Security Verification Standard (ASVS)](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP/ASVS sur GitHub](https://github.com/OWASP/ASVS)
- [Best practices for Cloud Firestore — Firebase](https://firebase.google.com/docs/firestore/best-practices)
- [Loi sur la protection des données au Sénégal : ce que la CDP exige des PME](https://sbcgrow.com/fr/blog/loi-protection-donnees-senegal-cdp)
- [Protection des données au Sénégal en 2026 : qui veille ?](https://zone-business.fr/digital/autorite-protection-donnees-senegal/)
