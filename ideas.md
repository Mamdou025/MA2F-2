# MA2F - Gestion AquaSachet : Brainstorm Design

## Contexte
Application de gestion d'entreprise pour la production et vente d'eau en sachets. L'utilisateur fournit un fichier HTML existant qui sert de référence fonctionnelle. L'objectif est de reproduire fidèlement toutes les fonctionnalités en les intégrant dans une interface web responsive moderne, compatible Windows, Android et iPhone.

## Approche 1 : Industrial Blue Dashboard
- **Intro** : Interface professionnelle épurée avec une palette bleue industrielle, inspirée des outils de gestion modernes comme Notion/Linear.
- **Probabilité** : 0.04

## Approche 2 : Aqua Gradient Flow
- **Intro** : Design fluide inspiré par l'eau avec des dégradés bleus dynamiques, des formes organiques et des micro-animations rappelant le mouvement de l'eau.
- **Probabilité** : 0.07

## Approche 3 : Clean Corporate Utility
- **Intro** : Interface utilitaire minimaliste axée sur la densité d'information et l'efficacité, avec un système de couleurs fonctionnel et une typographie claire.
- **Probabilité** : 0.03

---

## Approche choisie : Industrial Blue Dashboard

### Design Movement
Néo-brutalisme fonctionnel mêlé au design système industriel (inspiré par Linear, Raycast, et les dashboards financiers Bloomberg).

### Core Principles
1. **Densité informationnelle** : Maximiser les données visibles sans surcharger visuellement
2. **Hiérarchie par contraste** : Utiliser le poids typographique et les couleurs d'accent pour guider l'œil
3. **Navigation latérale persistante** : Sidebar fixe pour un accès rapide à tous les modules
4. **Feedback immédiat** : Chaque action produit un retour visuel instantané

### Color Philosophy
- **Couleur signature** : Bleu profond `#185FA5` (confiance, professionnalisme, eau)
- **Accent secondaire** : Bleu clair `#378ADD` (énergie, action)
- **Succès** : Vert émeraude `#10b981` (encaissements, bénéfices)
- **Alerte** : Orange ambre `#f59e0b` (créances, attention)
- **Danger** : Rouge corail `#ef4444` (dépenses, suppressions)
- **Fond** : Gris très clair `#f8fafc` avec cartes blanches
- **Texte** : Gris ardoise `#1e293b` pour le contenu principal

### Layout Paradigm
- Sidebar fixe à gauche (collapsible sur mobile → bottom navigation)
- Zone de contenu principale avec grille adaptative
- Header contextuel par section
- Modales pour les formulaires de saisie

### Signature Elements
1. **Indicateurs KPI** avec bordures colorées à gauche et micro-sparklines
2. **Navigation par icônes** avec labels au survol et badges de notification
3. **Tableaux à lignes alternées** avec actions au survol (reveal on hover)

### Interaction Philosophy
- Transitions rapides (150-200ms) pour les changements d'état
- Feedback haptique visuel sur les boutons (scale 0.97 au clic)
- Toasts pour les confirmations d'actions
- Modales avec overlay flou pour la saisie de données

### Animation
- Entrée des cartes KPI en cascade (stagger 50ms)
- Transitions de page par fondu (opacity + translateY léger)
- Sidebar collapse/expand avec transition fluide
- Hover sur les lignes de tableau : élévation subtile

### Typography System
- **Titres** : Inter (700) ou système sans-serif bold
- **Corps** : Inter (400/500) pour la lisibilité des données
- **Données numériques** : Font-variant tabular-nums pour l'alignement
- **Hiérarchie** : 3xl pour titres de section, xl pour sous-titres, sm pour labels

### Brand Essence
MA2F est un outil de pilotage opérationnel pour les PME de production d'eau en sachets au Sénégal — fiable, rapide, et accessible depuis n'importe quel appareil.
- Personnalité : **Fiable**, **Efficace**, **Accessible**

### Brand Voice
- Headlines : directs, informatifs, sans jargon. Ex : "Votre activité en un coup d'œil" / "12 BL émis aujourd'hui"
- CTAs : actionnables et spécifiques. Ex : "Enregistrer la vente" / "Voir le détail"

### Wordmark & Logo
Symbole de goutte d'eau stylisée intégrée dans un cercle bleu — représente la pureté et la production.

### Signature Brand Color
Bleu profond `#185FA5` — couleur de l'eau pure, de la confiance et du professionnalisme.
