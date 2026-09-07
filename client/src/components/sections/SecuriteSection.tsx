import ParametresSection from "./ParametresSection";

// Cette page éditait indépendamment les mêmes champs que ParametresSection
// (taux commission, solde d'ouverture, prix rouleau, seuil bonus) dans son
// propre état React, sans jamais se resynchroniser avec les données
// Firestore après le montage. Résultat: un enregistrement fait depuis cet
// écran pouvait écraser silencieusement des valeurs à jour par des valeurs
// obsolètes (c'est ce qui a mis "Solde d'ouverture" à 0 début août 2026).
//
// Pour supprimer ce risque de désynchronisation définitivement, "Sécurité"
// réutilise directement ParametresSection comme unique source de vérité —
// il n'existe plus qu'une seule copie de cet état, avec sa synchronisation
// et ses confirmations de sécurité.
export default function SecuriteSection() {
  return <ParametresSection />;
}
