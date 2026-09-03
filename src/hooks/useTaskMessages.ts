import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Ticket "Refonte fiche tâche" (6/6) : chat par tâche — réutilise la table
// `messages` déjà existante (conversations directes + canaux d'équipe),
// avec une nouvelle colonne task_id (voir migration
// 20260826160000_internal_task_messages.sql), plutôt qu'un système séparé.
// Même mécanique d'envoi que les conversations directes (ChatViewSupabase.tsx
// insertConvMessage) : pièces jointes en data URL, pas d'upload Storage
// séparé à gérer.

export interface TaskMessage {
  id: string;
  taskId: string;
  userId: string;
  kind: 'text' | 'image' | 'voice' | 'file';
  body: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  attachmentDuration: number | null;
  createdAt: string;
}

function rowToMessage(row: Record<string, unknown>): TaskMessage {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    userId: row.user_id as string,
    kind: (row.kind as TaskMessage['kind']) || 'text',
    body: (row.body as string) || null,
    attachmentUrl: (row.attachment_url as string) || null,
    attachmentMime: (row.attachment_mime as string) || null,
    attachmentDuration: (row.attachment_duration as number) ?? null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export const useTaskMessages = (taskId: string | null) => {
  const queryClient = useQueryClient();
  const queryKey = ['internal-task-messages', taskId];

  const { data: messages = [], isLoading } = useQuery({
    queryKey,
    enabled: Boolean(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('task_id', taskId as string)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) || []).map(rowToMessage);
    },
  });

  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`internal_task_messages:${taskId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `task_id=eq.${taskId}` },
        () => queryClient.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, queryClient]);

  const send = useMutation({
    mutationFn: async (payload: { userId: string; kind: TaskMessage['kind']; body?: string; attachmentUrl?: string; attachmentMime?: string; attachmentDuration?: number }) => {
      if (!taskId) throw new Error('Aucune tâche sélectionnée.');
      const { data: inserted, error } = await supabase
        .from('messages')
        .insert({
          task_id: taskId,
          user_id: payload.userId,
          kind: payload.kind,
          body: payload.body || null,
          attachment_url: payload.attachmentUrl || null,
          attachment_mime: payload.attachmentMime || null,
          attachment_duration: payload.attachmentDuration ?? null,
        } as any)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      const messageId = (inserted as { id?: string } | null)?.id || null;

      // Bug nº 6 (consigne du 1er septembre) : un message posté sur une tâche
      // de projet interne ne prévenait personne. On passe par la notification
      // déjà en place partout ailleurs (RPC `create_notification`, qui gère
      // aussi le push) — pas de second système.
      //
      // Signalé le 3 septembre (« très important ») : « la personne ne reçoit
      // pas la notification sur son téléphone ». Deux causes dans ce code :
      //
      // 1. La notification portait l'identifiant de la TÂCHE, le même pour
      //    tous les messages de la carte. Or `create_notification` n'accepte
      //    qu'une notification par (personne, type, entité) : le deuxième
      //    message ne fait que réécrire la première, et une fois celle-ci
      //    retirée par la personne (dismissed_at), plus rien ne passe — ni
      //    clochette, ni push — pour tous les messages suivants de la carte.
      //    Chaque message porte maintenant SON identifiant, comme les
      //    conversations directes : une notification par message, toujours.
      //
      // 2. Seuls le responsable et les personnes assignées étaient prévenus.
      //    Quelqu'un qui a déjà écrit dans le chat de la carte sans y être
      //    assigné ne recevait jamais les réponses. Les auteurs des messages
      //    précédents sont ajoutés aux destinataires (l'auteur exclu).
      try {
        const [{ data: tache }, { data: auteurs }] = await Promise.all([
          supabase
            .from('internal_project_tasks')
            .select('title, agency_id, created_by, collaborator_ids')
            .eq('id', taskId)
            .single(),
          supabase.from('messages').select('user_id').eq('task_id', taskId),
        ]);

        if (tache) {
          const t = tache as unknown as {
            title: string;
            agency_id: string;
            created_by: string | null;
            collaborator_ids: string[] | null;
          };
          const destinataires = Array.from(
            new Set(
              [
                t.created_by,
                ...(t.collaborator_ids || []),
                ...(((auteurs as { user_id: string | null }[] | null) || []).map((m) => m.user_id)),
              ].filter((id): id is string => Boolean(id) && id !== payload.userId)
            )
          );
          const apercu =
            payload.kind === 'voice' ? 'Message vocal'
            : payload.kind === 'image' ? 'Photo'
            : payload.kind === 'file' ? 'Fichier'
            : (payload.body || '').slice(0, 120);

          await Promise.all(
            destinataires.map((userId) =>
              supabase.rpc('create_notification', {
                _user_id: userId,
                _type: 'internal_task_message',
                _title: `💬 ${t.title}`,
                _message: apercu || 'Nouveau message sur cette carte',
                // L'entité est le MESSAGE (voir le point 1 ci-dessus) ; la
                // carte reste connue par les métadonnées.
                _entity_type: messageId ? 'internal_task_message' : 'internal_task',
                _entity_id: messageId || taskId,
                _agency_id: t.agency_id,
                _metadata: { url: '/projets-internes', task_id: taskId },
              })
            )
          );
        }
      } catch (e) {
        // Une notification qui échoue ne doit jamais faire échouer l'envoi.
        console.warn('Notification de message de tâche impossible :', e);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { messages, isLoading, send };
};

// Pour le badge "nombre de messages" sur les cartes du tableau — une seule
// requête pour toutes les tâches visibles plutôt qu'un hook par carte
// (même principe que useChecklistCounts).
export const useTaskMessageCounts = (taskIds: string[]) => {
  const queryClient = useQueryClient();
  const idsKey = [...taskIds].sort().join(',');
  const queryKey = ['internal-task-message-counts', idsKey];

  const { data: counts = {} } = useQuery({
    queryKey,
    enabled: taskIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('messages').select('task_id').in('task_id', taskIds);
      if (error) throw new Error(error.message);
      const map: Record<string, number> = {};
      for (const row of (data as { task_id: string }[]) || []) {
        map[row.task_id] = (map[row.task_id] || 0) + 1;
      }
      return map;
    },
  });

  useEffect(() => {
    if (taskIds.length === 0) return;
    const channel = supabase
      .channel(`internal_task_message_counts:${idsKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => queryClient.invalidateQueries({ queryKey }))
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, queryClient]);

  return counts;
};
