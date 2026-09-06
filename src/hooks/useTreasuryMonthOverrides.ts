import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// Correction manuelle du solde de départ par mois (6 septembre, Conseils
// Finances) : « je veux pouvoir modifier chaque mois les soldes de départ
// pour corriger si besoin ». Une correction sur un mois réinitialise le
// solde cumulé du grand livre à ce point précis, et l'effet se propage
// naturellement à tous les mois suivants (même calcul cumulatif en une
// passe côté ComptabiliteView.tsx).

export interface MonthOverride {
  id: string;
  agencyId: string;
  year: number;
  month: string;
  soldeOuverture: number;
  notes?: string;
}

function ligneVersOverride(row: Record<string, unknown>): MonthOverride {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    year: Number(row.year) || 0,
    month: (row.month as string) || '',
    soldeOuverture: Number(row.solde_ouverture) || 0,
    notes: (row.notes as string) || undefined,
  };
}

export function useTreasuryMonthOverrides(agencyId: string) {
  const queryClient = useQueryClient();

  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ['treasury-month-overrides', agencyId],
    enabled: Boolean(agencyId) && agencyId !== 'all',
    queryFn: async () => {
      const { data, error: sbError } = await supabase
        .from('treasury_month_overrides' as any)
        .select('*')
        .eq('agency_id', agencyId);
      if (sbError) throw new Error(sbError.message);
      return ((data || []) as Record<string, unknown>[]).map(ligneVersOverride);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['treasury-month-overrides', agencyId] });

  const definirOverride = useMutation({
    mutationFn: async ({ year, month, soldeOuverture, notes }: { year: number; month: string; soldeOuverture: number; notes?: string }) => {
      const { error: sbError } = await supabase.from('treasury_month_overrides' as any).upsert(
        {
          agency_id: agencyId,
          year,
          month,
          solde_ouverture: soldeOuverture,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: 'agency_id,year,month' }
      );
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Solde de départ corrigé'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const supprimerOverride = useMutation({
    mutationFn: async (id: string) => {
      const { error: sbError } = await supabase.from('treasury_month_overrides' as any).delete().eq('id', id);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Correction annulée, retour au calcul automatique'); },
    onError: (err: Error) => toast.error(err.message),
  });

  return { overrides, isLoading, definirOverride, supprimerOverride };
}
