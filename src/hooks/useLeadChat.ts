import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Ticket "Clients invités" (8/13) : chat relié à la fiche client — réutilise
// la table `messages` déjà existante (même principe que useTaskMessages
// pour le chat des Projets internes), scopé par lead_id. Utilisé à la fois
// côté client invité (ClientGuestShell) et côté conseiller (fiche client,
// section "Espace client / Conversation").
//
// Demande explicite (chat "digne des plus grands logiciels") : modifier/
// supprimer ses propres messages, accusé de réception/lecture — voir
// migration 20260826206000 (deleted_at, read_at, fonction mark_message_read).

export interface LeadMessage {
  id: string;
  leadId: string;
  userId: string;
  kind: 'text' | 'image' | 'voice' | 'file';
  body: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  attachmentDuration: number | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  readAt: string | null;
}

function rowToMessage(row: Record<string, unknown>): LeadMessage {
  return {
    id: row.id as string,
    leadId: row.lead_id as string,
    userId: row.user_id as string,
    kind: (row.kind as LeadMessage['kind']) || 'text',
    body: (row.body as string) || null,
    attachmentUrl: (row.attachment_url as string) || null,
    attachmentMime: (row.attachment_mime as string) || null,
    attachmentDuration: (row.attachment_duration as number) ?? null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    editedAt: (row.edited_at as string) || null,
    deletedAt: (row.deleted_at as string) || null,
    readAt: (row.read_at as string) || null,
  };
}

// Signalé (13 octobre) : « les messages tardent à arriver » en ouvrant la
// conversation d'une fiche depuis une notification — cette requête n'avait
// ni `.limit()` ni pagination : TOUT l'historique du lead était retéléchargé
// ET re-rendu sans fenêtrage, à l'ouverture ET à chaque événement temps réel
// (y compris ses propres messages et l'accusé de lecture, voir plus bas —
// chacun invalide la requête). Même correctif déjà posé le 10 septembre pour
// le chat des tâches de Projets internes (useTaskMessages.ts,
// RECENT_TASK_MESSAGES_PAGE) et pour la messagerie d'équipe
// (ChatViewSupabase.tsx, RECENT_MESSAGES_PAGE) : on ne charge plus que les
// messages les plus récents.
const RECENT_LEAD_MESSAGES_PAGE = 60;

export const useLeadChat = (leadId: string | null) => {
  const queryClient = useQueryClient();
  const queryKey = ['lead-chat', leadId];

  const { data: messages = [], isLoading } = useQuery({
    queryKey,
    enabled: Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('lead_id', leadId as string)
        .order('created_at', { ascending: false })
        .limit(RECENT_LEAD_MESSAGES_PAGE);
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) || []).map(rowToMessage).reverse();
    },
  });

  useEffect(() => {
    if (!leadId) return;
    const channel = supabase
      .channel(`lead_chat:${leadId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `lead_id=eq.${leadId}` },
        () => queryClient.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, queryClient]);

  const send = useMutation({
    mutationFn: async (payload: { userId: string; kind: LeadMessage['kind']; body?: string; attachmentUrl?: string; attachmentMime?: string; attachmentDuration?: number }) => {
      if (!leadId) throw new Error('Aucune fiche sélectionnée.');
      const { error } = await supabase.from('messages').insert({
        lead_id: leadId,
        user_id: payload.userId,
        kind: payload.kind,
        body: payload.body || null,
        attachment_url: payload.attachmentUrl || null,
        attachment_mime: payload.attachmentMime || null,
        attachment_duration: payload.attachmentDuration ?? null,
      } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { error } = await supabase.from('messages').update({ body, edited_at: new Date().toISOString() } as any).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // Suppression douce (garde "Message supprimé" affiché) — jamais un
      // DELETE physique, pour ne pas perdre la trace dans la conversation.
      const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString(), body: null, attachment_url: null } as any).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_message_read' as any, { p_message_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { messages, isLoading, send, update, remove, markRead };
};
