import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Ticket "Refonte fiche tâche" (4/6) : sous-éléments cochables d'une tâche
// de Projets internes (onglet Checklist), même schéma de hook que
// useInternalProjectTasks (React Query + temps réel Supabase).

export interface ChecklistItem {
  id: string;
  taskId: string;
  text: string;
  isDone: boolean;
  position: number;
  createdAt: string;
}

function rowToItem(row: Record<string, unknown>): ChecklistItem {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    text: (row.text as string) || '',
    isDone: Boolean(row.is_done),
    position: (row.position as number) ?? 0,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export const useTaskChecklist = (taskId: string | null) => {
  const queryClient = useQueryClient();
  const queryKey = ['internal-task-checklist', taskId];

  const { data: items = [], isLoading } = useQuery({
    queryKey,
    enabled: Boolean(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('internal_project_task_checklist_items')
        .select('*')
        .eq('task_id', taskId as string)
        .order('position', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) || []).map(rowToItem);
    },
  });

  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`internal_task_checklist:${taskId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'internal_project_task_checklist_items', filter: `task_id=eq.${taskId}` },
        () => queryClient.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, queryClient]);

  const addItem = useMutation({
    mutationFn: async (text: string) => {
      if (!taskId) throw new Error('Aucune tâche sélectionnée.');
      const { error } = await supabase.from('internal_project_task_checklist_items').insert({
        task_id: taskId,
        text: text.trim(),
        position: items.length,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleItem = useMutation({
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      const { error } = await supabase
        .from('internal_project_task_checklist_items')
        .update({ is_done: isDone, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ id, isDone }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ChecklistItem[]>(queryKey);
      if (previous) {
        queryClient.setQueryData<ChecklistItem[]>(queryKey, (old) =>
          (old || []).map((i) => (i.id === id ? { ...i, isDone } : i))
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('internal_project_task_checklist_items').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { items, isLoading, addItem, toggleItem, deleteItem };
};

// Pour le badge de progression sur les cartes du tableau (ex. "4/5") — une
// seule requête pour toutes les tâches visibles plutôt qu'un hook par carte.
export const useChecklistCounts = (taskIds: string[]) => {
  const queryClient = useQueryClient();
  const idsKey = [...taskIds].sort().join(',');
  const queryKey = ['internal-task-checklist-counts', idsKey];

  const { data: counts = {} } = useQuery({
    queryKey,
    enabled: taskIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('internal_project_task_checklist_items')
        .select('task_id, is_done')
        .in('task_id', taskIds);
      if (error) throw new Error(error.message);
      const map: Record<string, { done: number; total: number }> = {};
      for (const row of (data as { task_id: string; is_done: boolean }[]) || []) {
        if (!map[row.task_id]) map[row.task_id] = { done: 0, total: 0 };
        map[row.task_id].total += 1;
        if (row.is_done) map[row.task_id].done += 1;
      }
      return map;
    },
  });

  useEffect(() => {
    if (taskIds.length === 0) return;
    const channel = supabase
      .channel(`internal_task_checklist_counts:${idsKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'internal_project_task_checklist_items' },
        () => queryClient.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, queryClient]);

  return counts;
};
