import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { Task } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { toValidUuidOrNull, getAssignedUserIdAsUuid } from '@/data/teamMembers';

const CONSEILS_FINANCES_ID = '30f96ea9-41da-41c2-a95e-f5e7898f8d8e';

const capitalizePriority = (raw: unknown): Task['priority'] => {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'urgent') return 'Urgent';
  if (value === 'haute') return 'Haute';
  if (value === 'basse') return 'Basse';
  return 'Moyenne';
};

// Sens inverse : l'enum Postgres `reminder_priority` n'accepte que
// low/normal/urgent — un `.toLowerCase()` naïf sur "Moyenne"/"Haute"/"Basse"
// (les libellés français utilisés côté UI) violait l'enum et faisait
// échouer silencieusement toute création de tâche avec une priorité autre
// que "Urgent" (cf. ticket #4 — Nova qui ne parvenait jamais à créer de
// tâche).
const toDbPriority = (raw: unknown): 'low' | 'normal' | 'urgent' => {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'urgent' || value === 'urgente') return 'urgent';
  if (value === 'basse' || value === 'low' || value === 'faible') return 'low';
  return 'normal';
};

// La vraie table des rappels/tâches liées aux clients est `reminders`
// (pas `internal_tasks`, qui sert au tableau Kanban "Projets internes").
function supabaseTaskToTask(item: Record<string, unknown>): Task {
  return {
    id: (item.id as string) || '',
    title: (item.title as string) || (item.label as string) || '',
    completed: Boolean(item.is_done),
    dueDate: (item.due_at as string) || '',
    agencyId: (item.agency_id as string) || '',
    createdAt: (item.created_at as string) || new Date().toISOString(),
    priority: capitalizePriority(item.priority),
    type: 'Tâche',
    contactId: (item.lead_id as string) || undefined,
    createdBy: (item.user_id as string) || undefined,
    assignedTo: (item.assigned_to as string) || undefined,
    // Signalé (17/09/2026) : colonne déjà en base et déjà remontée par le
    // `select('*')` ci-dessous, mais perdue ici faute d'être reprise dans
    // l'objet Task — la liste des tâches n'affichait donc jamais ce qui y
    // était noté.
    description: (item.description as string) || undefined,
  };
}

export const useTasks = () => {
  const { activeAgency, currentUser } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: tasks = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['tasks', activeAgency.id],
    enabled: Boolean(currentUser),
    queryFn: async () => {
      let q = supabase.from('reminders').select('*');
      if (activeAgency.id !== 'all') {
        const validAgency = toValidUuidOrNull(activeAgency.id);
        if (validAgency) {
          q = q.eq('agency_id', validAgency);
        }
      }
      const { data, error: sbError } = await q.order('due_at', { ascending: true });
      if (sbError) {
        console.error('Erreur Supabase lors du chargement des rappels :', sbError);
        throw new Error(sbError.message);
      }
      return ((data || []) as Record<string, unknown>[]).map(supabaseTaskToTask);
    },
  });

  const addTask = useMutation({
    mutationFn: async (
      newTask: Omit<Task, 'id' | 'createdAt' | 'agencyId'> & { agencyId?: string }
    ) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      const rawAgencyId = newTask.agencyId || activeAgency.id;
      const agencyId =
        toValidUuidOrNull(rawAgencyId) ||
        (activeAgency.id === 'all' ? CONSEILS_FINANCES_ID : toValidUuidOrNull(activeAgency.id) || CONSEILS_FINANCES_ID);

      const userUuid =
        toValidUuidOrNull(currentUser.uid) ||
        getAssignedUserIdAsUuid(currentUser.email) ||
        null;

      const now = new Date().toISOString();

      const payload: Record<string, unknown> = {
        agency_id: agencyId,
        lead_id: toValidUuidOrNull(newTask.contactId || '') || null,
        title: newTask.title?.trim() || 'Nouveau rappel',
        label: newTask.title?.trim() || 'Nouveau rappel',
        priority: toDbPriority(newTask.priority),
        due_at: newTask.dueDate || null,
        created_at: now,
        user_id: userUuid,
        assigned_to: toValidUuidOrNull(newTask.assignedTo || '') || null,
        is_done: newTask.completed || false,
      };

      const { data, error: sbError } = await supabase
        .from('reminders')
        .insert(payload)
        .select()
        .single();

      if (sbError) {
        console.error('Erreur Supabase lors de la création du rappel :', sbError);
        throw new Error(sbError.message);
      }

      return supabaseTaskToTask(data as Record<string, unknown>);
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error) => {
      console.error('Impossible de créer le rappel :', error);
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Task> }) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      if (!id) {
        throw new Error('Identifiant du rappel manquant.');
      }

      const patch: Record<string, unknown> = {};
      if (updates.title !== undefined) {
        patch.title = updates.title.trim();
        patch.label = updates.title.trim();
      }
      if (updates.priority !== undefined) patch.priority = toDbPriority(updates.priority);
      if (updates.dueDate !== undefined) patch.due_at = updates.dueDate || null;
      if (updates.contactId !== undefined) patch.lead_id = toValidUuidOrNull(updates.contactId) || null;
      if (updates.assignedTo !== undefined) patch.assigned_to = toValidUuidOrNull(updates.assignedTo) || null;
      if (updates.completed !== undefined) {
        patch.is_done = updates.completed;
      }

      const { data, error: sbError } = await supabase
        .from('reminders')
        .update(patch)
        .eq('id', id)
        .select()
        .single();

      if (sbError) {
        console.error('Erreur Supabase lors de la mise à jour du rappel :', sbError);
        throw new Error(sbError.message);
      }

      return { id, updates, data };
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error) => {
      console.error('Impossible de modifier le rappel :', error);
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      if (!id) {
        throw new Error('Identifiant du rappel manquant.');
      }

      const { error: sbError } = await supabase
        .from('reminders')
        .delete()
        .eq('id', id);

      if (sbError) {
        console.error('Erreur Supabase lors de la suppression du rappel :', sbError);
        throw new Error(sbError.message);
      }

      return id;
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error) => {
      console.error('Impossible de supprimer le rappel :', error);
    },
  });

  return {
    tasks,
    isLoading,
    error,
    addTask,
    updateTask,
    deleteTask,
  };
};
