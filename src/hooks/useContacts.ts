import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, query, getDocs, setDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { Contact } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { INITIAL_CONTACTS } from '@/data/initialData';
import { getImportedStorage, saveImportedStorage } from '@/utils/importedDataManager';

export function matchesAgency(contactAgencyId: string | undefined, targetAgencyId: string): boolean {
  if (targetAgencyId === 'all') return true;

  if (!contactAgencyId || contactAgencyId.trim() === '') {
    // Unassigned contacts only appear when viewing all structures
    return false;
  }

  const CONSEILS_FINANCES_ID = '30f96ea9-41da-41c2-a95e-f5e7898f8d8e';
  const NOVAVISIO_ID = '0cd9362c-316e-4b57-af0b-b6cea092961b';
  const IMMOSPHERA_ID = '15157da9-71ea-4760-ae1c-3bc99d9caa20';

  const raw = contactAgencyId.toLowerCase().trim();

  if (targetAgencyId === CONSEILS_FINANCES_ID) {
    return (
      contactAgencyId === CONSEILS_FINANCES_ID ||
      ['conseils finances', 'cf', 'agency-1', 'conseils-finances'].includes(raw)
    );
  }

  if (targetAgencyId === NOVAVISIO_ID) {
    return (
      contactAgencyId === NOVAVISIO_ID ||
      ['novavisio', 'agency-2', 'novavisio-id'].includes(raw)
    );
  }

  if (targetAgencyId === IMMOSPHERA_ID) {
    return (
      contactAgencyId === IMMOSPHERA_ID ||
      ['immosphera', 'agency-3', 'immosphera-id'].includes(raw)
    );
  }

  return contactAgencyId === targetAgencyId;
}

export const useContacts = () => {
  const { activeAgency } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleStorageChange = () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    };
    window.addEventListener('crm_imported_data_changed', handleStorageChange);
    return () => window.removeEventListener('crm_imported_data_changed', handleStorageChange);
  }, [queryClient]);

  const { data: allContacts = [], isLoading } = useQuery({
    queryKey: ['contacts_all'],
    queryFn: async () => {
      const imported = getImportedStorage().contacts;
      const combined = [...INITIAL_CONTACTS, ...imported];

      // Deduplicate by ID
      const map = new Map<string, Contact>();
      combined.forEach(c => map.set(c.id, c));

      // Fetch all from Firestore to avoid missing documents due to index limitations or name variances
      try {
        const q = query(collection(db, 'contacts'));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(docSnap => {
          map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() } as Contact);
        });
      } catch (error) {
        console.warn("Firestore contacts fetch error, returning local contacts:", error);
      }

      return Array.from(map.values());
    },
  });

  // Filter contacts by active agency
  const contacts = allContacts.filter(c => matchesAgency(c.agencyId, activeAgency.id));

  const addContact = useMutation({
    mutationFn: async (newContact: Omit<Contact, 'id' | 'createdAt'>) => {
      const createdContact: Contact = {
        ...newContact,
        agencyId: newContact.agencyId || (activeAgency.id === 'all' ? '30f96ea9-41da-41c2-a95e-f5e7898f8d8e' : activeAgency.id),
        id: `contact-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: new Date().toISOString()
      };

      // Save locally first for instant availability
      const currentImported = getImportedStorage().contacts;
      saveImportedStorage({ contacts: [...currentImported, createdContact] });

      // Try Firestore using setDoc with matching ID
      try {
        await setDoc(doc(db, 'contacts', createdContact.id), {
          ...newContact,
          agencyId: createdContact.agencyId,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        console.warn("Firestore save fallback:", e);
      }
      return createdContact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts_all'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.CREATE, 'contacts')
  });

  const updateContact = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Contact> }) => {
      // Update local storage
      const currentImported = getImportedStorage().contacts;
      const exists = currentImported.some(c => c.id === id);
      const updatedList = exists
        ? currentImported.map(c => c.id === id ? { ...c, ...updates } : c)
        : [...currentImported, { id, ...updates } as Contact];

      saveImportedStorage({ contacts: updatedList });

      try {
        await updateDoc(doc(db, 'contacts', id), updates);
      } catch (e) {
        console.warn("Firestore update fallback:", e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts_all'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.UPDATE, 'contacts')
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const currentImported = getImportedStorage().contacts;
      const updatedList = currentImported.filter(c => c.id !== id);
      saveImportedStorage({ contacts: updatedList });

      try {
        await deleteDoc(doc(db, 'contacts', id));
      } catch (e) {
        console.warn("Firestore delete fallback:", e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts_all'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.DELETE, 'contacts')
  });

  return { contacts, allContacts, isLoading, addContact, updateContact, deleteContact };
};

