import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, query, where, getDocs, setDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { Task } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { INITIAL_TASKS } from '@/data/initialData';
import { getImportedStorage, saveImportedStorage } from '@/utils/importedDataManager';

export const useTasks = () => {
  const { activeAgency } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleStorageChange = () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    };
    window.addEventListener('crm_imported_data_changed', handleStorageChange);
    return () => window.removeEventListener('crm_imported_data_changed', handleStorageChange);
  }, [queryClient]);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', activeAgency.id],
    queryFn: async () => {
      const imported = getImportedStorage().tasks;
      const combined = [...INITIAL_TASKS, ...imported];

      const map = new Map<string, Task>();
      combined.forEach(t => map.set(t.id, t));

      try {
        const q = activeAgency.id === 'all'
          ? query(collection(db, 'tasks'))
          : query(collection(db, 'tasks'), where('agencyId', '==', activeAgency.id));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(doc => {
          map.set(doc.id, { id: doc.id, ...doc.data() } as Task);
        });
      } catch (error) {
        console.warn("Firestore tasks fetch error, returning local tasks:", error);
      }

      const allList = Array.from(map.values());
      return allList.filter(t => {
        if (activeAgency.id === 'all') return true;
        if (t.agencyId) return t.agencyId === activeAgency.id;
        return true;
      });
    },
  });

  const addTask = useMutation({
    mutationFn: async (newTask: Omit<Task, 'id' | 'createdAt' | 'agencyId'>) => {
      const createdTask: Task = {
        ...newTask,
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        agencyId: activeAgency.id,
        createdAt: new Date().toISOString()
      };

      const currentImported = getImportedStorage().tasks;
      saveImportedStorage({ tasks: [...currentImported, createdTask] });

      try {
        await setDoc(doc(db, 'tasks', createdTask.id), {
          ...newTask,
          agencyId: activeAgency.id,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        console.warn("Firestore save fallback:", e);
      }
      return createdTask;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.CREATE, 'tasks')
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Task> }) => {
      const currentImported = getImportedStorage().tasks;
      const exists = currentImported.some(t => t.id === id);
      const updatedList = exists
        ? currentImported.map(t => t.id === id ? { ...t, ...updates } : t)
        : [...currentImported, { id, ...updates } as Task];

      saveImportedStorage({ tasks: updatedList });

      try {
        await updateDoc(doc(db, 'tasks', id), updates);
      } catch (e) {
        console.warn("Firestore update fallback:", e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.UPDATE, 'tasks')
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const currentImported = getImportedStorage().tasks;
      const updatedList = currentImported.filter(t => t.id !== id);
      saveImportedStorage({ tasks: updatedList });

      try {
        await deleteDoc(doc(db, 'tasks', id));
      } catch (e) {
        console.warn("Firestore delete fallback:", e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => handleFirestoreError(error, OperationType.DELETE, 'tasks')
  });

  return { tasks, isLoading, addTask, updateTask, deleteTask };
};
