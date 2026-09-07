import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  getDocs,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  increment,
  runTransaction,
} from "firebase/firestore";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, ref, uploadString, getBytes, deleteObject } from "firebase/storage";

// Configuration Firebase
// En production, définissez ces variables dans Settings → Secrets pour éviter d'exposer les clés
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDnjGP48QgUVfgAaGiLCW4x6OREdj1wPlo",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ma2f-aquasachet.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ma2f-aquasachet",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ma2f-aquasachet.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "581289157163",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:581289157163:web:04fadcc683257839ca806e",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use the default Firestore database
export const db = getFirestore(app);

// Firestore collections séparées pour éviter la limite 1 Mo
export const FIRESTORE_COLLECTIONS = {
  ventes: "ventes",
  clients: "clients",
  production: "production",
  depenses: "depenses",
  recouvrements: "recouvrements",
  // Collections séparées de meta pour éviter le dépassement 1 Mo
  mouvementsStock: "mouvements_stock",
  journal: "journal",
  history: "history",
  reconciliations: "reconciliations",
  meta: "meta", // users, params, commerciaux, livreurs, vehicules, etc. (données légères)
} as const;

// Legacy path (pour migration)
export const FIRESTORE_COLLECTION = "business";
export const FIRESTORE_DOCUMENT = "data";

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  getDocs,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  increment,
  runTransaction,
};

// Firebase Functions
export const functions = getFunctions(app);
export { httpsCallable };

// Firebase Storage — utilisé pour les sauvegardes JSON restaurables (voir
// BackupsSection.tsx) depuis le correctif du 2026-09-04 : le JSON complet ne
// tient plus dans le document Firestore une fois la base assez grosse
// (limite de 1 Mo/document), donc il est stocké ici et seul un pointeur léger
// reste dans Firestore.
export const storage = getStorage(app);
export { ref, uploadString, getBytes, deleteObject };

export type { User };
