import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Contact } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { toValidUuidOrNull, getAssignedUserIdAsUuid } from '@/data/teamMembers';

const CONSEILS_FINANCES_ID = '30f96ea9-41da-41c2-a95e-f5e7898f8d8e';
const NOVAVISIO_ID = '0cd9362c-316e-4b57-af0b-b6cea092961b';
const IMMOSPHERA_ID = '15157da9-71ea-4760-ae1c-3bc99d9caa20';

// Ticket #119 : `leads.temperature` est un enum Postgres strict qui n'accepte
// QUE 'chaud' | 'tiede' | 'froid' (minuscules, sans accent) — n'importe
// quelle autre valeur (dont 'Nouveau', le statut par défaut envoyé par le
// formulaire "Nouveau lead", ou même 'Froid'/'Chaud' avec majuscule/accent)
// fait échouer l'insertion entière, sans aucun message d'erreur visible
// pour l'utilisateur (cf. ticket #3 déjà rencontré côté Nova IA — même
// classe de bug, ici côté formulaire manuel). On normalise systématiquement
// ici, quelle que soit la valeur envoyée par l'appelant.
const VALID_TEMPERATURES = ['chaud', 'tiede', 'froid'] as const;
type LeadTemperature = (typeof VALID_TEMPERATURES)[number];

function toValidTemperature(value: string | undefined | null): LeadTemperature {
  const normalized = (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // retire les accents (tiède -> tiede)
  const match = VALID_TEMPERATURES.find((t) => normalized === t || normalized.startsWith(t));
  return match || 'froid';
}

export function matchesAgency(
  contactAgencyId: string | undefined,
  targetAgencyId: string
): boolean {
  if (targetAgencyId === 'all') return true;
  if (!contactAgencyId || contactAgencyId.trim() === '') {
    return targetAgencyId === CONSEILS_FINANCES_ID;
  }

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

export function supabaseLeadToContact(item: Record<string, unknown>): Contact {
  const fullName =
    (item.full_name as string) ||
    [(item.first_name as string), (item.last_name as string)].filter(Boolean).join(' ') ||
    'Sans nom';

  const secondaryStr =
    typeof item.secondary_contact === 'string'
      ? item.secondary_contact
      : item.secondary_contact
      ? JSON.stringify(item.secondary_contact)
      : undefined;

  return {
    id: item.id as string,
    name: fullName,
    email: (item.email as string) || '',
    phone: (item.phone as string) || '',
    agencyId: (item.agency_id as string) || '',
    status: ((item.temperature as string) || 'Nouveau') as Contact['status'],
    statutLead: (item.temperature as string) || undefined,
    createdAt: (item.created_at as string) || new Date().toISOString(),
    archivedAt: (item.archived_at as string) || null,
    ownerUserId: (item.created_by as string) || undefined,
    ownerEmail: undefined,
    sharedWithUserIds: [],
    revenus: (item.budget as number) || undefined,
    budgetMax: (item.budget as number) || undefined,
    apport: undefined,
    credits: undefined,
    contractType: undefined,
    projectType: (item.property_type as string) || undefined,
    comments: (item.comments as string) || (item.notes as string) || '',
    notes: (item.notes as string) || '',
    assignedTo: (item.assigned_to as string) || undefined,
    advisorCommissionTtc: item.advisor_commission_ttc === null || item.advisor_commission_ttc === undefined
      ? undefined
      : Number(item.advisor_commission_ttc),
    mandateNumber: (item.mandate_number as string) || undefined,
    contactType: (item.contact_type as string) || undefined,
    clientType: (item.lead_type as string) || undefined,
    type: (item.lead_type as string) || (item.contact_type as string) || undefined,
    pipeline: (item.pipeline_id as string) || undefined,
    secteur: (item.sector as string) || undefined,
    typeBien: (item.property_type as string) || undefined,
    honoraires: (item.estimated_value as number) || undefined,
    coBorrower: secondaryStr,
  };
}

export const useContacts = () => {
  const { activeAgency, currentUser } = useAuth();
  const queryClient = useQueryClient();

  // Unique realtime channel per hook instance to prevent reusing already-subscribed channel
  useEffect(() => {
    if (!currentUser) return;

    const channelId = `leads_realtime_${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['contacts_all'] });
          queryClient.invalidateQueries({ queryKey: ['deals'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, queryClient]);

  const {
    data: allContacts = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['contacts_all'],
    enabled: Boolean(currentUser),
    queryFn: async () => {
      const { data, error: sbError } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (sbError) {
        console.error('Erreur Supabase contacts :', sbError);
        throw new Error(sbError.message);
      }
      return ((data || []) as Record<string, unknown>[]).map(supabaseLeadToContact);
    },
  });

  const contacts = allContacts.filter((contact) =>
    matchesAgency(contact.agencyId, activeAgency.id)
  );

  const addContact = useMutation({
    mutationFn: async (newContact: Omit<Contact, 'id' | 'createdAt'>) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      const rawAgencyId =
        newContact.agencyId ||
        (activeAgency.id === 'all' ? CONSEILS_FINANCES_ID : activeAgency.id);

      const agencyId = toValidUuidOrNull(rawAgencyId) || CONSEILS_FINANCES_ID;
      const assignedToUuid = getAssignedUserIdAsUuid(newContact.assignedTo);
      const createdByUuid =
        toValidUuidOrNull(currentUser.uid) ||
        getAssignedUserIdAsUuid(currentUser.email) ||
        null;
      const pipelineUuid = toValidUuidOrNull(newContact.pipeline);

      const now = new Date().toISOString();

      const nameTrimmed = (newContact.name || '').trim() || 'Nouveau Prospect';
      const parts = nameTrimmed.split(/\s+/);
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

      const payload: Record<string, unknown> = {
        full_name: nameTrimmed,
        first_name: firstName || null,
        last_name: lastName || null,
        email: newContact.email?.trim() || null,
        phone: newContact.phone?.trim() || null,
        agency_id: agencyId,
        temperature: toValidTemperature(newContact.statutLead || newContact.status),
        created_at: now,
        updated_at: now,
        created_by: createdByUuid,
        assigned_to: assignedToUuid,
        comments: newContact.comments?.trim() || null,
        notes: newContact.notes?.trim() || null,
        contact_type: newContact.contactType || null,
        lead_type: newContact.clientType || newContact.type || null,
        budget: newContact.budgetMax || newContact.revenus || null,
        estimated_value: newContact.honoraires || null,
        sector: newContact.secteur?.trim() || null,
        property_type: newContact.typeBien?.trim() || newContact.projectType?.trim() || null,
        pipeline_id: pipelineUuid,
        advisor_commission_ttc: newContact.advisorCommissionTtc ?? null,
        mandate_number: newContact.mandateNumber?.trim() || null,
        secondary_contact: newContact.coBorrower?.trim() || null,
      };

      const { data, error: sbError } = await supabase
        .from('leads')
        .insert(payload)
        .select()
        .single();

      if (sbError) {
        console.error('Erreur Supabase lors de la création du contact :', sbError);
        throw new Error(sbError.message);
      }

      return supabaseLeadToContact(data as Record<string, unknown>);
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts_all'] }),
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error) => {
      console.error('Impossible de créer le contact :', error);
    },
  });

  const updateContact = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Contact>;
    }) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      if (!id) {
        throw new Error('Identifiant du contact manquant.');
      }

      const patch: Record<string, unknown> = {};

      if (updates.name !== undefined) {
        const nameTrimmed = updates.name.trim();
        patch.full_name = nameTrimmed;
        const parts = nameTrimmed.split(/\s+/);
        patch.first_name = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
        patch.last_name = parts.length > 1 ? parts[parts.length - 1] : '';
      }

      if (updates.email !== undefined) {
        patch.email = updates.email?.trim() || null;
      }

      if (updates.phone !== undefined) {
        patch.phone = updates.phone?.trim() || null;
      }

      if (updates.agencyId !== undefined) {
        const validAgency = toValidUuidOrNull(updates.agencyId);
        if (validAgency) patch.agency_id = validAgency;
      }

      // Ticket #119 (suivi) : même normalisation qu'à la création — évite
      // qu'un futur appelant fasse échouer silencieusement une mise à jour
      // en envoyant une valeur qui ne correspond pas exactement à l'enum.
      if (updates.status !== undefined) {
        patch.temperature = toValidTemperature(updates.status);
      }

      if (updates.statutLead !== undefined) {
        patch.temperature = toValidTemperature(updates.statutLead);
      }

      if (updates.comments !== undefined) {
        patch.comments = updates.comments;
      }

      if (updates.notes !== undefined) {
        patch.notes = updates.notes;
      }

      if (updates.contactType !== undefined) {
        patch.contact_type = updates.contactType;
      }

      if (updates.clientType !== undefined) {
        patch.lead_type = updates.clientType;
      }

      if (updates.type !== undefined) {
        patch.lead_type = updates.type;
      }

      if (updates.assignedTo !== undefined) {
        patch.assigned_to = getAssignedUserIdAsUuid(updates.assignedTo);
      }

      if (updates.budgetMax !== undefined) {
        patch.budget = updates.budgetMax;
      }

      if (updates.revenus !== undefined) {
        patch.budget = updates.revenus;
      }

      if (updates.honoraires !== undefined) {
        patch.estimated_value = updates.honoraires;
      }

      if (updates.advisorCommissionTtc !== undefined) {
        patch.advisor_commission_ttc = updates.advisorCommissionTtc;
      }

      if (updates.mandateNumber !== undefined) {
        patch.mandate_number = updates.mandateNumber?.trim() || null;
      }

      if (updates.secteur !== undefined) {
        patch.sector = updates.secteur;
      }

      if (updates.typeBien !== undefined) {
        patch.property_type = updates.typeBien;
      }

      if (updates.projectType !== undefined) {
        patch.property_type = updates.projectType;
      }

      if (updates.pipeline !== undefined) {
        patch.pipeline_id = toValidUuidOrNull(updates.pipeline);
      }

      if (updates.coBorrower !== undefined) {
        patch.secondary_contact = updates.coBorrower;
      }

      patch.updated_at = new Date().toISOString();

      const { data, error: sbError } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', id)
        .select()
        .single();

      if (sbError) {
        console.error('Erreur Supabase lors de la modification :', sbError);
        throw new Error(sbError.message);
      }

      return { id, updates, data };
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts_all'] }),
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error) => {
      console.error('Impossible de modifier le contact :', error);
    },
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      if (!id) {
        throw new Error('Identifiant du contact manquant.');
      }

      const { error: sbError } = await supabase.from('leads').delete().eq('id', id);

      if (sbError) {
        console.error('Erreur Supabase lors de la suppression :', sbError);
        throw new Error(sbError.message);
      }

      return id;
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts_all'] }),
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error) => {
      console.error('Impossible de supprimer le contact :', error);
    },
  });

  return {
    contacts,
    allContacts,
    isLoading,
    error,
    addContact,
    updateContact,
    deleteContact,
  };
};
