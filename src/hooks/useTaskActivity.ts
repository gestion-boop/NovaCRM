import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Ticket "Refonte fiche tâche" (5/6) : journal d'activité — alimenté
// automatiquement par un trigger Postgres (voir migration
// 20260826150000_internal_task_activity.sql), donc rien à écrire ici côté
// mutations : juste la lecture + le temps réel.

export interface TaskActivityEntry {
  id: string;
  taskId: string;
  actorId: string | null;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

function rowToEntry(row: Record<string, unknown>): TaskActivityEntry {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    actorId: (row.actor_id as string) || null,
    action: row.action as string,
    fromValue: (row.from_value as string) || null,
    toValue: (row.to_value as string) || null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export const useTaskActivity = (taskId: string | null) => {
  const queryClient = useQueryClient();
  const queryKey = ['internal-task-activity', taskId];

  const { data: entries = [], isLoading } = useQuery({
    queryKey,
    enabled: Boolean(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('internal_project_task_activity')
        .select('*')
        .eq('task_id', taskId as string)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) || []).map(rowToEntry);
    },
  });

  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`internal_task_activity:${taskId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'internal_project_task_activity', filter: `task_id=eq.${taskId}` },
        () => queryClient.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, queryClient]);

  return { entries, isLoading };
};
