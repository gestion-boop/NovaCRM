import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, query, where, getDocs, setDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { Deal } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { INITIAL_DEALS } from '@/data/initialData';
import { getImportedStorage, saveImportedStorage } from '@/utils/importedDataManager';

export const useDeals = () => {
  const { activeAgency } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleStorageChange = () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    };
    window.addEventListener('crm_imported_data_changed', handleStorageChange);
    return () => window.removeEventListener('crm_imported_data_changed', handleStorageChange);
  }, [queryClient]);

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ['deals', activeAgency.id],
    queryFn: async () => {
      const imported = getImportedStorage().deals;
      const combined = [...INITIAL_DEALS, ...imported];

      const map = new Map<string, Deal>();
      combined.forEach(d => map.set(d.id, d));

      try {
        const q = activeAgency.id === 'all'
          ? query(collection(db, 'deals'))
          : query(collection(db, 'deals'), where('agencyId', '==', activeAgency.id));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(doc => {
          map.set(doc.id, { id: doc.id, ...doc.data() } as Deal);
        });
      } catch (error) {
        console.warn("Firestore deals fetch error, returning local deals:", error);
      }

      const allList = Array.from(map.values());
      return allList.filter(d => {
        if (activeAgency.id === 'all') return true;
        if (d.agencyId) return d.agencyId === activeAgency.id;
        return true;
      });
    },
  });

  const addDeal = useMutation({
    mutationFn: async (newDeal: Omit<Deal, 'id' | 'createdAt' | 'agencyId'>) => {
      const createdDeal: Deal = {
        ...newDeal,
        id: `deal-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        agencyId: activeAgency.id,
        createdAt: new Date().toISOString()
      };

      const currentImported = getImportedStorage().deals;
      saveImportedStorage({ deals: [...currentImported, createdDeal] });

      try {
        await setDoc(doc(db, 'deals', createdDeal.id), {
          ...newDeal,
          agencyId: activeAgency.id,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        console.warn("Firestore save fallback:", e);
      }
      return createdDeal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.CREATE, 'deals')
  });

  const updateDeal = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Deal> }) => {
      const currentImported = getImportedStorage().deals;
      const exists = currentImported.some(d => d.id === id);
      const updatedList = exists
        ? currentImported.map(d => d.id === id ? { ...d, ...updates } : d)
        : [...currentImported, { id, ...updates } as Deal];

      saveImportedStorage({ deals: updatedList });

      try {
        await updateDoc(doc(db, 'deals', id), updates);
      } catch (e) {
        console.warn("Firestore update fallback:", e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.UPDATE, 'deals')
  });

  const deleteDeal = useMutation({
    mutationFn: async (id: string) => {
      const currentImported = getImportedStorage().deals;
      const updatedList = currentImported.filter(d => d.id !== id);
      saveImportedStorage({ deals: updatedList });

      try {
        await deleteDoc(doc(db, 'deals', id));
      } catch (e) {
        console.warn("Firestore delete fallback:", e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.DELETE, 'deals')
  });

  return { deals, isLoading, addDeal, updateDeal, deleteDeal };
};
