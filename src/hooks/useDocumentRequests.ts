import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Ticket "Clients invités" (12/13) : demandes de documents par le
// conseiller — statuts demande → consulte → recu → valide/refuse. Utilisé
// côté conseiller (ClientProfileView, création + validation) et côté
// client (ClientGuestShell, consultation + réponse via upload).

// Catégories partagées entre le client (envoi libre, ClientGuestShell) et le
// conseiller (demande ciblée, ClientProfileView) — pas de colonne dédiée en
// base (cf. commentaire dans ClientGuestShell), la catégorie est préfixée
// au nom du fichier côté upload-client-document.
export const DOC_CATEGORIES = [
  "Pièce d'identité",
  'Justificatif de domicile',
  'Relevé bancaire',
  'Bulletin de salaire',
  "Avis d'imposition",
  'Compromis',
  'Document bancaire',
  'Autre',
];

export type DocRequestStatus = 'demande' | 'consulte' | 'recu' | 'valide' | 'refuse';

export interface DocumentRequest {
  id: string;
  leadId: string;
  agencyId: string;
  requestedBy: string | null;
  docType: string;
  deadline: string | null;
  message: string | null;
  status: DocRequestStatus;
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToRequest(row: Record<string, unknown>): DocumentRequest {
  return {
    id: row.id as string,
    leadId: row.lead_id as string,
    agencyId: row.agency_id as string,
    requestedBy: (row.requested_by as string) || null,
    docType: row.doc_type as string,
    deadline: (row.deadline as string) || null,
    message: (row.message as string) || null,
    status: (row.status as DocRequestStatus) || 'demande',
    documentId: (row.document_id as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const DOC_REQUEST_STATUS_LABELS: Record<DocRequestStatus, string> = {
  demande: 'Demandé',
  consulte: 'Consulté',
  recu: 'Reçu',
  valide: 'Validé',
  refuse: 'Refusé',
};

export const useDocumentRequests = (leadId: string | null) => {
  const queryClient = useQueryClient();
  const queryKey = ['document-requests', leadId];

  const { data: requests = [], isLoading } = useQuery({
    queryKey,
    enabled: Boolean(leadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests' as any)
        .select('*')
        .eq('lead_id', leadId as string)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data as Record<string, unknown>[]) || []).map(rowToRequest);
    },
  });

  useEffect(() => {
    if (!leadId) return;
    const channel = supabase
      .channel(`document_requests:${leadId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'document_requests', filter: `lead_id=eq.${leadId}` },
        () => queryClient.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, queryClient]);

  const create = useMutation({
    mutationFn: async (payload: { agencyId: string; requestedBy: string; docType: string; deadline?: string | null; message?: string | null }) => {
      if (!leadId) throw new Error('Aucune fiche sélectionnée.');
      const { error } = await supabase.from('document_requests' as any).insert({
        lead_id: leadId,
        agency_id: payload.agencyId,
        requested_by: payload.requestedBy,
        doc_type: payload.docType,
        deadline: payload.deadline || null,
        message: payload.message || null,
      } as any);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const markConsulted = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.from('document_requests' as any).update({ status: 'consulte', updated_at: new Date().toISOString() } as any).eq('id', requestId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const setDecision = useMutation({
    mutationFn: async ({ requestId, status }: { requestId: string; status: 'valide' | 'refuse' }) => {
      const { error } = await supabase.from('document_requests' as any).update({ status, updated_at: new Date().toISOString() } as any).eq('id', requestId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { requests, isLoading, create, markConsulted, setDecision };
};
