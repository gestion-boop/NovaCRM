import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { InternalTask } from '@/types';
import { useAuth } from '@/context/AuthContext';

// Ticket "Projets internes" (phase 1) : cartes kanban d'un projet interne —
// table `internal_project_tasks`, séparée de `task_boards` (le projet lui-
// même, jamais modifié ici). Un seul hook, filtré par `boardId` côté appelant
// (comme useDeals filtre par pipeline), pour rester cohérent avec le reste
// du CRM plutôt que d'inventer un mécanisme différent.

function rowToTask(row: Record<string, unknown>): InternalTask {
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    agencyId: row.agency_id as string,
    title: (row.title as string) || 'Tâche sans titre',
    description: (row.description as string) || undefined,
    priority: (row.priority as InternalTask['priority']) || 'normale',
    status: (row.status as InternalTask['status']) || 'a_faire',
    dueDate: (row.due_date as string) || null,
    position: (row.position as number) ?? 0,
    collaboratorIds: (row.collaborator_ids as string[]) || [],
    createdBy: (row.created_by as string) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

// Ticket "Rôle Stagiaire" (phase 2, section 10) : "ne pas devenir un
// deuxième système de gestion de projets" — un stagiaire voit "son
// pipeline de travail" (ses tâches à lui, tous projets confondus), alors
// qu'un responsable ouvre "le" tableau d'UN projet précis. Même hook, deux
// façons de le filtrer, au lieu d'un mécanisme parallèle.
export type InternalTasksScope = { type: 'board'; boardId: string } | { type: 'mine' };

export const useInternalProjectTasks = (scope: InternalTasksScope | null) => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();

  const scopeKey = scope ? (scope.type === 'board' ? `board:${scope.boardId}` : 'mine') : null;
  const queryKey = ['internal-project-tasks', scopeKey];

  // Signalé : "ça saccade encore, va-et-vient" persistant même après le
  // correctif de détection de collision — cause réelle, plus profonde :
  // l'abonnement temps réel ci-dessous réagit à TOUT changement sur la
  // table, y compris celui que CE client vient lui-même de provoquer via
  // le glisser-déposer. Comme Supabase Realtime notifie souvent plus vite
  // que la réponse HTTP de la mutation elle-même, ce second chemin pouvait
  // déclencher un refetch qui court-circuitait la mise à jour optimiste
  // (`onMutate`) avec une lecture pas encore garantie cohérente, avant que
  // le `onSuccess` de la mutation ne revienne confirmer le bon état —
  // d'où la carte qui semblait "repartir en arrière" un instant avant de
  // se re-stabiliser. On ignore donc les événements temps réel qui suivent
  // de très près une mutation locale : `onMutate`/`onSuccess` s'en
  // chargent déjà de façon fiable ; le temps réel ne sert plus qu'à
  // synchroniser les changements faits par UN AUTRE onglet/utilisateur.
  const recentLocalMutationAtRef = useRef(0);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey,
    enabled: Boolean(currentUser) && Boolean(scope),
    queryFn: async () => {
      let query = supabase.from('internal_project_tasks').select('*').order('position', { ascending: true });
      if (scope?.type === 'board') {
        query = query.eq('board_id', scope.boardId);
      } else if (scope?.type === 'mine' && currentUser) {
        query = query.contains('collaborator_ids', [currentUser.uid]);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) || []).map(rowToTask);
    },
  });

  // Temps réel : synchro immédiate multi-appareils (ticket explicite —
  // "après actualisation ou depuis un autre appareil, la position doit
  // être conservée"). La table est déjà dans supabase_realtime (migration).
  // En mode "mine", pas de filtre serveur simple sur un tableau (les tâches
  // viennent de plusieurs projets) — on réagit à tout changement de la
  // table et on laisse la policy RLS ne renvoyer que ce qui concerne
  // l'utilisateur au moment de l'invalidation.
  useEffect(() => {
    if (!currentUser || !scope) return;
    const channelId = scope.type === 'board' ? `internal_project_tasks:${scope.boardId}` : `internal_project_tasks:mine:${currentUser.uid}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        scope.type === 'board'
          ? { event: '*', schema: 'public', table: 'internal_project_tasks', filter: `board_id=eq.${scope.boardId}` }
          : { event: '*', schema: 'public', table: 'internal_project_tasks' },
        () => {
          if (Date.now() - recentLocalMutationAtRef.current < 2000) return;
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, scopeKey, queryClient]);

  const addTask = useMutation({
    mutationFn: async (newTask: {
      boardId: string;
      agencyId: string;
      title: string;
      description?: string;
      priority?: InternalTask['priority'];
      dueDate?: string | null;
      collaboratorIds?: string[];
    }) => {
      if (!currentUser) throw new Error('Utilisateur non authentifié.');
      recentLocalMutationAtRef.current = Date.now();
      const maxPosition = tasks.filter((t) => t.status === 'a_faire').length;
      const { data, error } = await supabase
        .from('internal_project_tasks')
        .insert({
          board_id: newTask.boardId,
          agency_id: newTask.agencyId,
          title: newTask.title.trim(),
          description: newTask.description?.trim() || null,
          priority: newTask.priority || 'normale',
          status: 'a_faire',
          due_date: newTask.dueDate || null,
          position: maxPosition,
          collaborator_ids: newTask.collaboratorIds || [],
          created_by: currentUser.uid,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return rowToTask(data as Record<string, unknown>);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<InternalTask> }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.title !== undefined) patch.title = updates.title;
      if (updates.description !== undefined) patch.description = updates.description;
      if (updates.priority !== undefined) patch.priority = updates.priority;
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.dueDate !== undefined) patch.due_date = updates.dueDate;
      if (updates.position !== undefined) patch.position = updates.position;
      if (updates.collaboratorIds !== undefined) patch.collaborator_ids = updates.collaboratorIds;

      const { error } = await supabase.from('internal_project_tasks').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
      return { id, updates };
    },
    // Optimiste : évite l'aller-retour visible pendant un glisser-déposer
    // (même correctif que le pipeline CRM — cf. useDeals).
    onMutate: async ({ id, updates }) => {
      recentLocalMutationAtRef.current = Date.now();
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<InternalTask[]>(queryKey);
      if (previous) {
        queryClient.setQueryData<InternalTask[]>(queryKey, (old) =>
          (old || []).map((t) => (t.id === id ? { ...t, ...updates } : t))
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      recentLocalMutationAtRef.current = Date.now();
      const { error } = await supabase.from('internal_project_tasks').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Signalé : "léger flash quand je déplace la carte" — cause résiduelle :
  // la mise à jour optimiste passe par `onMutate`, qui commence par un
  // `await queryClient.cancelQueries(...)` — donc jamais synchrone avec
  // l'événement de lâcher lui-même. Entre le moment où dnd-kit termine le
  // glisser (rendant la vraie carte visible, encore dans son ANCIENNE
  // colonne) et celui où l'état optimiste s'applique enfin, il s'écoule
  // un ou deux instants de rendu — d'où ce flash. Cette fonction fait la
  // même chose que `onMutate`, mais de façon strictement synchrone,
  // pensée pour être appelée dans le MÊME tick que la fin du glisser.
  const setTaskStatusOptimistic = (id: string, status: InternalTask['status']) => {
    queryClient.setQueryData<InternalTask[]>(queryKey, (old) =>
      (old || []).map((t) => (t.id === id ? { ...t, status } : t))
    );
  };

  return { tasks, isLoading, addTask, updateTask, deleteTask, setTaskStatusOptimistic };
};
