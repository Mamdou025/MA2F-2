/**
 * Hooks pour la gestion des entités Firestore
 * 
 * - usePagination : pagination côté Firestore avec curseurs
 * - useOptimisticLock : verrouillage optimiste pour les modifications
 * - useAtomicTransaction : transactions atomiques multi-collections
 */

import { useState, useCallback, useRef } from "react";
import {
  createEntity,
  updateEntity,
  deleteEntity,
  executeBatch,
  getPaginatedEntities,
  ENTITY_COLLECTIONS,
  type FirestoreEntity,
  type BatchOperation,
  type PaginatedResult,
  type DocumentSnapshot,
  type QueryConstraint,
} from "@/lib/firestoreService";
import { useApp } from "@/contexts/AppContext";

// ─── usePagination ────────────────────────────────────────────────────────────

interface UsePaginationOptions {
  collectionName: string;
  pageSize?: number;
  constraints?: QueryConstraint[];
}

interface UsePaginationReturn<T> {
  items: T[];
  isLoading: boolean;
  hasMore: boolean;
  currentPage: number;
  totalLoaded: number;
  loadMore: () => Promise<void>;
  reset: () => void;
  refresh: () => Promise<void>;
}

export function usePagination<T extends FirestoreEntity>(
  options: UsePaginationOptions
): UsePaginationReturn<T> {
  const { collectionName, pageSize = 50, constraints = [] } = options;
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const lastDocRef = useRef<DocumentSnapshot | null>(null);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);

    try {
      const result: PaginatedResult<T> = await getPaginatedEntities<T>(
        collectionName,
        pageSize,
        lastDocRef.current || undefined,
        constraints
      );

      setItems((prev) => [...prev, ...result.items]);
      lastDocRef.current = result.lastDoc;
      setHasMore(result.hasMore);
      setCurrentPage((prev) => prev + 1);
    } catch (error) {
      console.error(`Erreur pagination ${collectionName}:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [collectionName, pageSize, isLoading, hasMore, constraints]);

  const reset = useCallback(() => {
    setItems([]);
    setHasMore(true);
    setCurrentPage(0);
    lastDocRef.current = null;
  }, []);

  const refresh = useCallback(async () => {
    reset();
    setIsLoading(true);
    try {
      const result: PaginatedResult<T> = await getPaginatedEntities<T>(
        collectionName,
        pageSize,
        undefined,
        constraints
      );
      setItems(result.items);
      lastDocRef.current = result.lastDoc;
      setHasMore(result.hasMore);
      setCurrentPage(1);
    } catch (error) {
      console.error(`Erreur refresh ${collectionName}:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [collectionName, pageSize, constraints]);

  return {
    items,
    isLoading,
    hasMore,
    currentPage,
    totalLoaded: items.length,
    loadMore,
    reset,
    refresh,
  };
}

// ─── useOptimisticLock ────────────────────────────────────────────────────────

interface UseOptimisticLockReturn {
  updateWithLock: (
    collectionName: string,
    id: string,
    updates: Record<string, any>,
    currentVersion: number
  ) => Promise<{ success: boolean; error?: string }>;
  isUpdating: boolean;
  lastError: string | null;
}

export function useOptimisticLock(): UseOptimisticLockReturn {
  const { currentUser } = useApp();
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const updateWithLock = useCallback(
    async (
      collectionName: string,
      id: string,
      updates: Record<string, any>,
      currentVersion: number
    ) => {
      if (!currentUser) {
        return { success: false, error: "Non authentifié" };
      }

      setIsUpdating(true);
      setLastError(null);

      try {
        const result = await updateEntity(
          collectionName,
          id,
          updates,
          currentUser.nom,
          currentVersion
        );

        if (!result.success) {
          setLastError(result.error || "Erreur inconnue");
        }

        return result;
      } catch (error: any) {
        const errorMsg = error.message || "Erreur de mise à jour";
        setLastError(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        setIsUpdating(false);
      }
    },
    [currentUser]
  );

  return { updateWithLock, isUpdating, lastError };
}

// ─── useAtomicTransaction ─────────────────────────────────────────────────────

interface UseAtomicTransactionReturn {
  executeTransaction: (
    operations: BatchOperation[]
  ) => Promise<{ success: boolean; error?: string }>;
  isExecuting: boolean;
  lastError: string | null;
}

export function useAtomicTransaction(): UseAtomicTransactionReturn {
  const { currentUser } = useApp();
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const executeTransaction = useCallback(
    async (operations: BatchOperation[]) => {
      if (!currentUser) {
        return { success: false, error: "Non authentifié" };
      }

      setIsExecuting(true);
      setLastError(null);

      try {
        const result = await executeBatch(operations, currentUser.nom);

        if (!result.success) {
          setLastError(result.error || "Erreur transaction");
        }

        return result;
      } catch (error: any) {
        const errorMsg = error.message || "Erreur de transaction";
        setLastError(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        setIsExecuting(false);
      }
    },
    [currentUser]
  );

  return { executeTransaction, isExecuting, lastError };
}

// ─── useEntityCRUD ────────────────────────────────────────────────────────────

interface UseEntityCRUDReturn {
  create: (collectionName: string, entity: FirestoreEntity) => Promise<void>;
  update: (
    collectionName: string,
    id: string,
    updates: Record<string, any>,
    version?: number
  ) => Promise<{ success: boolean; error?: string }>;
  remove: (collectionName: string, id: string) => Promise<void>;
  isProcessing: boolean;
}

export function useEntityCRUD(): UseEntityCRUDReturn {
  const { currentUser } = useApp();
  const [isProcessing, setIsProcessing] = useState(false);

  const create = useCallback(
    async (collectionName: string, entity: FirestoreEntity) => {
      setIsProcessing(true);
      try {
        await createEntity(collectionName, entity, currentUser?.nom || "Système");
      } finally {
        setIsProcessing(false);
      }
    },
    [currentUser]
  );

  const update = useCallback(
    async (
      collectionName: string,
      id: string,
      updates: Record<string, any>,
      version?: number
    ) => {
      setIsProcessing(true);
      try {
        return await updateEntity(
          collectionName,
          id,
          updates,
          currentUser?.nom || "Système",
          version
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [currentUser]
  );

  const remove = useCallback(
    async (collectionName: string, id: string) => {
      setIsProcessing(true);
      try {
        await deleteEntity(collectionName, id);
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  return { create, update, remove, isProcessing };
}
