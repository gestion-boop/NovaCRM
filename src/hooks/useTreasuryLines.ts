import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { TreasuryLine } from '@/types';
import { toast } from 'sonner';

// Onglet Comptabilité (6 septembre, Conseils Finances) : « un vrai logiciel
// de comptabilité pour piloter ce qui va rentrer aussi, et avoir une vue sur
// le long terme ». Chaque ligne (recette ou dépense, ponctuelle ou
// récurrente) est stockée dans `treasury_lines`, scopée par agence.

function ligneVersTreasury(row: Record<string, unknown>): TreasuryLine {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    label: (row.label as string) || '',
    category: (row.category as string) || 'Autre',
    kind: (row.kind as 'recurrent' | 'ponctuel') || 'ponctuel',
    amount: Number(row.amount) || 0,
    month: (row.month as string) || '',
    endMonth: (row.end_month as string | null) || null,
    notes: (row.notes as string) || undefined,
    createdBy: (row.created_by as string) || undefined,
    createdAt: (row.created_at as string) || undefined,
    updatedAt: (row.updated_at as string) || undefined,
  };
}

export function useTreasuryLines(agencyId: string) {
  const queryClient = useQueryClient();

  const { data: lines = [], isLoading, error } = useQuery({
    queryKey: ['treasury-lines', agencyId],
    enabled: Boolean(agencyId) && agencyId !== 'all',
    queryFn: async () => {
      const { data, error: sbError } = await supabase
        .from('treasury_lines' as any)
        .select('*')
        .eq('agency_id', agencyId)
        .order('category', { ascending: true })
        .order('month', { ascending: true });
      if (sbError) throw new Error(sbError.message);
      return ((data || []) as Record<string, unknown>[]).map(ligneVersTreasury);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['treasury-lines', agencyId] });

  const creerLigne = useMutation({
    mutationFn: async (ligne: Omit<TreasuryLine, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>) => {
      const { error: sbError } = await supabase.from('treasury_lines' as any).insert({
        agency_id: agencyId,
        label: ligne.label,
        category: ligne.category,
        kind: ligne.kind,
        amount: ligne.amount,
        month: ligne.month,
        end_month: ligne.endMonth || null,
        notes: ligne.notes || null,
      } as any);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Ligne ajoutée'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const modifierLigne = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<TreasuryLine> & { id: string }) => {
      const update: Record<string, unknown> = {};
      if (patch.label !== undefined) update.label = patch.label;
      if (patch.category !== undefined) update.category = patch.category;
      if (patch.kind !== undefined) update.kind = patch.kind;
      if (patch.amount !== undefined) update.amount = patch.amount;
      if (patch.month !== undefined) update.month = patch.month;
      if (patch.endMonth !== undefined) update.end_month = patch.endMonth || null;
      if (patch.notes !== undefined) update.notes = patch.notes || null;
      update.updated_at = new Date().toISOString();
      const { error: sbError } = await supabase.from('treasury_lines' as any).update(update as any).eq('id', id);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  const supprimerLigne = useMutation({
    mutationFn: async (id: string) => {
      const { error: sbError } = await supabase.from('treasury_lines' as any).delete().eq('id', id);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Ligne supprimée'); },
    onError: (err: Error) => toast.error(err.message),
  });

  return { lines, isLoading, error, creerLigne, modifierLigne, supprimerLigne };
}
