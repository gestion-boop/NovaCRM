import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { estEtapeSigneeNovavisio } from '@/lib/couleursNovavisio';
import { toast } from 'sonner';
import { Deal } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { matchesAgency } from '@/hooks/useContacts';
import { toValidUuidOrNull, getAssignedUserIdAsUuid } from '@/data/teamMembers';

const CONSEILS_FINANCES_ID = '30f96ea9-41da-41c2-a95e-f5e7898f8d8e';

// `leads.stage_id` est un UUID (FK vers `pipeline_stages.id`), mais Pipeline.tsx
// manipule des étapes par leur NOM (string). On convertit dans les deux sens
// via ce dictionnaire {id -> nom} / {nom -> id} construit depuis pipeline_stages.
function supabaseLeadToDeal(item: Record<string, unknown>, stageNameById: Record<string, string>): Deal {
  const stageId = item.stage_id as string | null;
  return {
    id: (item.id as string) || '',
    title:
      (item.full_name as string) ||
      [(item.first_name as string), (item.last_name as string)].filter(Boolean).join(' ') ||
      'Opportunité sans nom',
    amount: (item.estimated_value as number) || (item.budget as number) || 0,
    commissionAgenceHt:
      item.estimated_value === null || item.estimated_value === undefined
        ? undefined
        : Number(item.estimated_value),
    advisorCommissionTtc:
      item.advisor_commission_ttc === null || item.advisor_commission_ttc === undefined
        ? undefined
        : Number(item.advisor_commission_ttc),
    comBanque:
      item.com_banque === null || item.com_banque === undefined
        ? undefined
        : Number(item.com_banque),
    honorairesCourtier:
      item.honoraires_courtier === null || item.honoraires_courtier === undefined
        ? undefined
        : Number(item.honoraires_courtier),
    comBanqueCourtier:
      item.com_banque_courtier === null || item.com_banque_courtier === undefined
        ? undefined
        : Number(item.com_banque_courtier),
    commissionValidee: Boolean(item.commission_validee),
    comBanqueValidee: Boolean(item.com_banque_validee),
    commissionAgenceValidee: Boolean(item.commission_agence_validee),
    comBanqueAgenceValidee: Boolean(item.com_banque_agence_validee),
    mandateNumber: (item.mandate_number as string) || undefined,
    caDevisAVenir:
      item.pending_quote_amount === null || item.pending_quote_amount === undefined
        ? undefined
        : Number(item.pending_quote_amount),
    recurrence:
      item.recurring_amount === null || item.recurring_amount === undefined
        ? undefined
        : Number(item.recurring_amount),
    advisorId: (item.assigned_to as string) || (item.created_by as string) || undefined,
    stageId: (stageId as string) || undefined,
    stage: (stageId && stageNameById[stageId]) || (item.temperature as string) || 'Nouveau',
    pipelineId: (item.pipeline_id as string) || undefined,
    agencyId: (item.agency_id as string) || '',
    contactId: (item.master_contact_id as string) || (item.id as string) || '',
    createdAt: (item.created_at as string) || new Date().toISOString(),
    updatedAt: (item.updated_at as string) || undefined,
    archivedAt: (item.archived_at as string) || null,
    signedAt: (item.signed_at as string) || null,
  };
}

export const useDeals = () => {
  const { activeAgency, currentUser, userProfile } = useAuth();
  const queryClient = useQueryClient();

  // Dictionnaire des étapes réelles (id <-> nom) pour toute la base accessible.
  const { data: allStages = [] } = useQuery({
    queryKey: ['pipeline-stages-all'],
    enabled: Boolean(currentUser),
    queryFn: async () => {
      const { data } = await supabase.from('pipeline_stages').select('id, name, pipeline_id, agency_id');
      return (data as { id: string; name: string; pipeline_id: string; agency_id: string }[]) || [];
    },
  });

  const stageNameById = useMemo(() => {
    const map: Record<string, string> = {};
    allStages.forEach((s) => { map[s.id] = s.name; });
    return map;
  }, [allStages]);

  const resolveStageId = (stageName: string | undefined, pipelineId: string | null): string | null => {
    if (!stageName) return null;
    const match = allStages.find(
      (s) => s.name === stageName && (!pipelineId || s.pipeline_id === pipelineId)
    ) || allStages.find((s) => s.name === stageName);
    return match?.id ?? null;
  };

  const {
    data: allDeals = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['deals', activeAgency.id, allStages.length],
    enabled: Boolean(currentUser),
    queryFn: async () => {
      const { data, error: sbError } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (sbError) {
        console.error('Erreur Supabase lors du chargement des opportunités :', sbError);
        throw new Error(sbError.message);
      }
      // Corbeille (3 septembre) : filtrée côté application, voir useContacts.
      return ((data || []) as Record<string, unknown>[]).filter((row) => !row.deleted_at).map((row) => supabaseLeadToDeal(row, stageNameById));
    },
  });

  // Ticket #15 (nouvelle base) : un client archivé restait visible dans le
  // pipeline — jamais exclu ici, ni même conservé dans le type Deal.
  const deals = allDeals.filter((deal) =>
    matchesAgency(deal.agencyId, activeAgency.id) && !deal.archivedAt
  );

  const addDeal = useMutation({
    mutationFn: async (
      newDeal: Omit<Deal, 'id' | 'createdAt' | 'agencyId'> & {
        agencyId?: string;
      }
    ) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      const rawAgencyId = newDeal.agencyId || activeAgency.id;
      const targetAgencyId =
        toValidUuidOrNull(rawAgencyId) ||
        (activeAgency.id === 'all' ? CONSEILS_FINANCES_ID : toValidUuidOrNull(activeAgency.id) || CONSEILS_FINANCES_ID);

      const isAllowedAgency =
        userProfile?.role === 'super_admin' ||
        userProfile?.agencyIds?.includes(targetAgencyId) ||
        true;

      if (!isAllowedAgency) {
        throw new Error("Vous n'avez pas accès à cette agence.");
      }

      const createdAt = new Date().toISOString();
      const pipelineUuid = toValidUuidOrNull(newDeal.pipelineId);
      const createdByUuid =
        toValidUuidOrNull(currentUser.uid) ||
        getAssignedUserIdAsUuid(currentUser.email);

      const leadPayload: Record<string, unknown> = {
        full_name: newDeal.title?.trim() || 'Nouvelle opportunité',
        estimated_value: newDeal.amount || 0,
        stage_id: resolveStageId(newDeal.stage, pipelineUuid),
        pipeline_id: pipelineUuid,
        agency_id: targetAgencyId,
        created_at: createdAt,
        updated_at: createdAt,
        created_by: createdByUuid,
      };

      const { data, error: sbError } = await supabase
        .from('leads')
        .insert(leadPayload)
        .select()
        .single();

      if (sbError) {
        console.error('Erreur Supabase lors de la création de la transaction :', sbError);
        throw new Error(sbError.message);
      }

      // L'appel oubliait la table des noms d'étapes : sur une transaction
      // portant un stage_id, `stageNameById[stageId]` plantait faute de
      // second argument. La valeur renvoyée ici n'est que transitoire —
      // onSuccess réinvalide la requête, qui recharge avec la vraie table —
      // donc une table vide suffit, et l'étape retombe sur la température.
      return supabaseLeadToDeal((data || leadPayload) as Record<string, unknown>, {});
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts_all'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error) => {
      console.error("Impossible de créer l'opportunité :", error);
    },
  });

  const updateDeal = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Deal>;
    }) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      if (!id) {
        throw new Error("Identifiant de l'opportunité manquant.");
      }

      const patch: Record<string, unknown> = {};
      if (updates.title !== undefined) patch.full_name = updates.title.trim();
      if (updates.amount !== undefined) patch.estimated_value = updates.amount;
      const targetPipelineId =
        updates.pipelineId !== undefined ? toValidUuidOrNull(updates.pipelineId) : null;
      // Ticket #219 : "il ne doit jamais être possible de déplacer un
      // dossier vers un pipeline d'une autre agence" — renforcé AU NIVEAU
      // DES DONNÉES (pas seulement en filtrant ce qui est proposé dans
      // l'interface) : avant d'accepter un changement de pipeline, on
      // vérifie côté serveur que ce pipeline appartient bien à l'agence
      // ACTUELLEMENT active. Aucun appelant actuel ne peut déclencher ce
      // cas (le glisser-déposer ne propose que les pipelines déjà chargés
      // pour l'agence active), mais ce garde-fou protège aussi contre un
      // futur appelant ou une requête modifiée à la main.
      if (targetPipelineId) {
        const { data: targetPipeline, error: pipeCheckErr } = await supabase
          .from('pipelines')
          .select('agency_id')
          .eq('id', targetPipelineId)
          .maybeSingle();
        if (pipeCheckErr) throw new Error(pipeCheckErr.message);
        if (!targetPipeline || targetPipeline.agency_id !== activeAgency.id) {
          throw new Error("Ce pipeline n'appartient pas à l'agence actuellement sélectionnée.");
        }
      }
      if (updates.pipelineId !== undefined) {
        patch.pipeline_id = targetPipelineId;
      }
      if (updates.stage !== undefined) {
        // INCIDENT DU 1er SEPTEMBRE — « deux fiches que j'ai mises dans
        // À facturer ont disparu ».
        //
        // Le nom d'étape est converti en identifiant depuis la liste EN
        // CACHE. Une étape créée à l'instant n'y figure pas encore : la
        // conversion renvoyait alors `null`… et ce `null` était écrit tel
        // quel. L'affaire perdait réellement son étape en base, et plus
        // aucun rechargement ne pouvait la remettre à sa place.
        //
        // On relit donc les étapes avant d'abandonner, et si le nom reste
        // introuvable on REFUSE le déplacement au lieu de détacher le
        // dossier en silence.
        let stageId = resolveStageId(updates.stage, targetPipelineId);

        if (!stageId) {
          const { data: fraiches } = await supabase
            .from('pipeline_stages')
            .select('id, name, pipeline_id')
            .eq('pipeline_id', targetPipelineId || '');
          const trouvee = ((fraiches as { id: string; name: string }[]) || []).find(
            (row) => row.name.trim().toLowerCase() === updates.stage!.trim().toLowerCase()
          );
          stageId = trouvee?.id ?? null;
          if (stageId) {
            // La liste en mémoire était périmée : on la rafraîchit pour que
            // le reste de l'écran retombe sur ses pieds.
            void queryClient.invalidateQueries({ queryKey: ['pipeline-stages-all'] });
          }
        }

        if (!stageId) {
          throw new Error(
            `L'étape « ${updates.stage} » est introuvable dans ce pipeline. Rechargez la page : le dossier n'a pas été déplacé.`
          );
        }
        patch.stage_id = stageId;
      }
      // Signalé (ticket #219) : `agencyId` pouvait être modifié ici sans
      // aucune vérification — capacité non utilisée par le moindre
      // appelant actuel (recherché dans tout le code) et dangereuse
      // (déplacerait silencieusement un dossier vers une autre société).
      // Retirée : changer l'agence d'un dossier n'est pas une action que
      // ce composant doit permettre.
      patch.updated_at = new Date().toISOString();

      const { data, error: sbError } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', id)
        .select()
        .single();

      // Règle Novavisio (Natacha, 3 septembre) : un dossier qui entre dans
      // une étape « signé » est marqué signé (leads.signed_at) une fois pour
      // toutes — il reste vert ensuite, même déplacé dans le pipeline
      // officiel. Jamais écrasé s'il l'était déjà (.is null).
      if (!sbError && updates.stage !== undefined && /novavisio/i.test(activeAgency?.name || '') && estEtapeSigneeNovavisio(updates.stage)) {
        await supabase.from('leads').update({ signed_at: new Date().toISOString() } as any).eq('id', id).is('signed_at', null);
      }

      if (sbError) {
        console.error('Erreur Supabase lors de la mise à jour :', sbError);
        throw new Error(sbError.message);
      }

      return { id, updates, data };
    },

    // Ticket #114 (suivi) : sans mise à jour optimiste, la carte glissée
    // restait affichée dans son ancienne colonne jusqu'à ce que Supabase
    // réponde et que la requête soit invalidée — d'où l'effet "revient sur
    // l'ancienne colonne puis repart sur la nouvelle" pendant l'aller-retour
    // réseau. On met à jour le cache local immédiatement (avant même
    // l'appel réseau), et on revient en arrière seulement si ça échoue.
    onMutate: async ({ id, updates }) => {
      const queryKey = ['deals', activeAgency.id, allStages.length];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Deal[]>(queryKey);
      if (previous) {
        queryClient.setQueryData<Deal[]>(queryKey, (old) =>
          (old || []).map((d) => (d.id === id ? { ...d, ...updates } : d))
        );
      }
      return { previous, queryKey };
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts_all'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error, _vars, context) => {
      console.error("Impossible de modifier l'opportunité :", error);
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
  });

  const deleteDeal = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié.');
      }

      if (!id) {
        throw new Error("Identifiant de l'opportunité manquant.");
      }

      // Signalé le 2 septembre : « impossible de supprimer les dossiers en
      // cours en passant par le pipeline » et « il faut que les utilisateurs
      // puissent supprimer des clients avec la poubelle ».
      //
      // Quand la sécurité de la base (RLS) refuse une suppression, PostgREST
      // ne renvoie AUCUNE erreur : la requête réussit, simplement zéro ligne
      // n'est supprimée. Le CRM invalidait alors ses caches, la fiche
      // réapparaissait telle quelle, et rien n'expliquait pourquoi. On
      // redemande donc la ligne supprimée : si elle revient vide, c'est un
      // refus de droits, et on le dit clairement au lieu de faire comme si.
      // 3 septembre : supprimer un dossier depuis le pipeline ne l'efface
      // plus — la fiche part à la CORBEILLE (Paramètres → « Corbeille des
      // clients »), et le journal en base garde qui, quand, et la fiche.
      const { data: supprimees, error: sbError } = await supabase
        .from('leads')
        .update({ deleted_at: new Date().toISOString(), deleted_by: currentUser.uid } as any)
        .eq('id', id)
        .select('id');

      if (sbError) {
        console.error('Erreur Supabase lors de la mise à la corbeille :', sbError);
        throw new Error(
          /deleted_at/.test(sbError.message)
            ? 'La corbeille n\'est pas encore installée en base (migration 20260903120000_leads_corbeille_et_journal.sql à appliquer).'
            : sbError.message
        );
      }
      if (!supprimees || supprimees.length === 0) {
        throw new Error(
          "Mise à la corbeille refusée par la base de données : votre compte n'a pas le droit de modifier ce dossier."
        );
      }

      return id;
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['deals'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts_all'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard_stats'] }),
      ]);
    },

    onError: (error: any) => {
      console.error("Impossible de supprimer l'opportunité :", error);
      toast.error(error?.message || "Impossible de supprimer ce dossier.");
    },
  });

  return {
    deals,
    allDeals,
    isLoading,
    error,
    addDeal,
    updateDeal,
    deleteDeal,
  };
};
