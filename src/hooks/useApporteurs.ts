import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// Conciergerie ImmoSphera (6 septembre) : « on va calculer le classement en
// fonction de l'apporteur d'affaires » — l'agent immobilier qui envoie un
// client. Liste GÉRÉE de référents (pas de texte libre sur chaque fiche,
// pour éviter les doublons/fautes de frappe et permettre un classement
// propre), stockée dans `real_estate_referrers`, scopée par agence.

export interface Apporteur {
  id: string;
  agencyId: string;
  name: string;
  agencyName?: string;
  phone?: string;
  active: boolean;
  notes?: string;
}

function ligneVersApporteur(row: Record<string, unknown>): Apporteur {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    name: (row.name as string) || '',
    agencyName: (row.agency_name as string) || undefined,
    phone: (row.phone as string) || undefined,
    active: row.active !== false,
    notes: (row.notes as string) || undefined,
  };
}

export function useApporteurs(agencyId: string) {
  const queryClient = useQueryClient();

  const { data: apporteurs = [], isLoading } = useQuery({
    queryKey: ['apporteurs', agencyId],
    enabled: Boolean(agencyId) && agencyId !== 'all',
    queryFn: async () => {
      const { data, error: sbError } = await supabase
        .from('real_estate_referrers' as any)
        .select('*')
        .eq('agency_id', agencyId)
        .order('name', { ascending: true });
      if (sbError) throw new Error(sbError.message);
      return ((data || []) as Record<string, unknown>[]).map(ligneVersApporteur);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['apporteurs', agencyId] });

  const creerApporteur = useMutation({
    mutationFn: async (apporteur: Omit<Apporteur, 'id' | 'agencyId' | 'active'> & { active?: boolean }) => {
      const { data, error: sbError } = await supabase
        .from('real_estate_referrers' as any)
        .insert({
          agency_id: agencyId,
          name: apporteur.name,
          agency_name: apporteur.agencyName || null,
          phone: apporteur.phone || null,
          active: apporteur.active !== false,
          notes: apporteur.notes || null,
        } as any)
        .select()
        .single();
      if (sbError) throw new Error(sbError.message);
      return ligneVersApporteur(data as Record<string, unknown>);
    },
    onSuccess: () => { invalidate(); toast.success('Apporteur ajouté'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const modifierApporteur = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Apporteur> & { id: string }) => {
      const update: Record<string, unknown> = {};
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.agencyName !== undefined) update.agency_name = patch.agencyName || null;
      if (patch.phone !== undefined) update.phone = patch.phone || null;
      if (patch.active !== undefined) update.active = patch.active;
      if (patch.notes !== undefined) update.notes = patch.notes || null;
      update.updated_at = new Date().toISOString();
      const { error: sbError } = await supabase.from('real_estate_referrers' as any).update(update as any).eq('id', id);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Apporteur modifié'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const supprimerApporteur = useMutation({
    mutationFn: async (id: string) => {
      const { error: sbError } = await supabase.from('real_estate_referrers' as any).delete().eq('id', id);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Apporteur supprimé'); },
    onError: (err: Error) => toast.error(err.message),
  });

  return { apporteurs, isLoading, creerApporteur, modifierApporteur, supprimerApporteur };
}
