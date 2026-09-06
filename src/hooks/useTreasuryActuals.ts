import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

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
  creditConfirme: boolean;
  debitConfirme: boolean;
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
    creditConfirme: Boolean(row.credit_confirme),
    debitConfirme: Boolean(row.debit_confirme),
  };
}

function moisDepuisDate(dateIso: string): string {
  const d = new Date(dateIso);
  return String(d.getMonth() + 1).padStart(2, '0');
}

function dernierJourDuMois(annee: number, moisIndexZero: number): number {
  // moisIndexZero : 0 = janvier ... 11 = décembre
  return new Date(annee, moisIndexZero + 1, 0).getDate();
}

export function useTreasuryActuals(agencyId: string) {
  const queryClient = useQueryClient();

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['treasury-actuals', agencyId] });

  const creerActual = useMutation({
    mutationFn: async (ligne: {
      date: string;
      label: string;
      description: string;
      credit: number;
      debit: number;
      monthSheet?: string;
    }) => {
      const { error: sbError } = await supabase.from('treasury_actuals' as any).insert({
        agency_id: agencyId,
        tx_date: ligne.date,
        label: ligne.label,
        description: ligne.description || null,
        credit: ligne.credit || 0,
        debit: ligne.debit || 0,
        month_sheet: ligne.monthSheet || moisDepuisDate(ligne.date),
      } as any);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Ligne ajoutée au grand livre'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const modifierActual = useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      date?: string;
      label?: string;
      description?: string;
      credit?: number;
      debit?: number;
      creditConfirme?: boolean;
      debitConfirme?: boolean;
    }) => {
      const update: Record<string, unknown> = {};
      if (patch.date !== undefined) {
        update.tx_date = patch.date;
        update.month_sheet = moisDepuisDate(patch.date);
      }
      if (patch.label !== undefined) update.label = patch.label;
      if (patch.description !== undefined) update.description = patch.description || null;
      if (patch.credit !== undefined) update.credit = patch.credit;
      if (patch.debit !== undefined) update.debit = patch.debit;
      if (patch.creditConfirme !== undefined) update.credit_confirme = patch.creditConfirme;
      if (patch.debitConfirme !== undefined) update.debit_confirme = patch.debitConfirme;
      const { error: sbError } = await supabase.from('treasury_actuals' as any).update(update as any).eq('id', id);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  });

  const supprimerActual = useMutation({
    mutationFn: async (id: string) => {
      const { error: sbError } = await supabase.from('treasury_actuals' as any).delete().eq('id', id);
      if (sbError) throw new Error(sbError.message);
    },
    onSuccess: () => { invalidate(); toast.success('Ligne supprimée'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const dupliquerJusquaDecembre = useMutation({
    mutationFn: async (actual: TreasuryActual) => {
      const dateOrigine = new Date(actual.date);
      const annee = dateOrigine.getFullYear();
      const jourOrigine = dateOrigine.getDate();
      const moisDepart = dateOrigine.getMonth(); // 0-indexé

      const moisCibles: { moisIndex: number; monthSheet: string; date: string }[] = [];
      for (let m = moisDepart + 1; m <= 11; m++) {
        const jour = Math.min(jourOrigine, dernierJourDuMois(annee, m));
        const date = `${annee}-${String(m + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
        moisCibles.push({ moisIndex: m, monthSheet: String(m + 1).padStart(2, '0'), date });
      }
      if (moisCibles.length === 0) return 0;

      // Évite de re-dupliquer si déjà fait : on vérifie l'existence d'une
      // ligne avec le même libellé sur les mêmes mois cibles.
      const { data: existantes, error: sbErrorSelect } = await supabase
        .from('treasury_actuals' as any)
        .select('tx_date, month_sheet')
        .eq('agency_id', agencyId)
        .eq('label', actual.label)
        .in('month_sheet', moisCibles.map((c) => c.monthSheet));
      if (sbErrorSelect) throw new Error(sbErrorSelect.message);
      const datesExistantes = new Set(((existantes || []) as { tx_date: string }[]).map((r) => r.tx_date));

      let ajoutees = 0;
      for (const cible of moisCibles) {
        if (datesExistantes.has(cible.date)) continue;
        const { error: sbErrorInsert } = await supabase.from('treasury_actuals' as any).insert({
          agency_id: agencyId,
          tx_date: cible.date,
          label: actual.label,
          description: actual.description || null,
          credit: actual.credit,
          debit: actual.debit,
          credit_confirme: false,
          debit_confirme: false,
          month_sheet: cible.monthSheet,
        } as any);
        if (sbErrorInsert) throw new Error(sbErrorInsert.message);
        ajoutees++;
      }
      return ajoutees;
    },
    onSuccess: (ajoutees: number) => {
      invalidate();
      toast.success(ajoutees > 0 ? `${ajoutees} ligne${ajoutees > 1 ? 's' : ''} dupliquée${ajoutees > 1 ? 's' : ''} jusqu'à décembre` : "Déjà dupliqué jusqu'à décembre");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return { actuals, isLoading, creerActual, modifierActual, supprimerActual, dupliquerJusquaDecembre };
}
