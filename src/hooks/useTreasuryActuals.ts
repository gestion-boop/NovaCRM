import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Grand livre réel (historique importé depuis Excel) : chaque ligne bancaire
// effective de l'agence, scopée par mois (`month_sheet` = '01'..'12'), pour
// calculer le solde bancaire théorique cumulé (« Comptabilité » Conseils Finances).

export interface TreasuryActual {
  id: string;
  agencyId: string;
  date: string;
  label: string;
  description: string;
  credit: number;
  debit: number;
  monthSheet: string;
}

function ligneVersActual(row: Record<string, unknown>): TreasuryActual {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    date: (row.tx_date as string) || '',
    label: (row.label as string) || '',
    description: (row.description as string) || '',
    credit: Number(row.credit) || 0,
    debit: Number(row.debit) || 0,
    monthSheet: (row.month_sheet as string) || '',
  };
}

export function useTreasuryActuals(agencyId: string) {
  const { data: actuals = [], isLoading } = useQuery({
    queryKey: ['treasury-actuals', agencyId],
    enabled: Boolean(agencyId) && agencyId !== 'all',
    queryFn: async () => {
      const { data, error: sbError } = await supabase
        .from('treasury_actuals' as any)
        .select('*')
        .eq('agency_id', agencyId)
        .order('tx_date', { ascending: true })
        .order('id', { ascending: true });
      if (sbError) throw new Error(sbError.message);
      return ((data || []) as Record<string, unknown>[]).map(ligneVersActual);
    },
  });

  return { actuals, isLoading };
}
