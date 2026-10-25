import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, CheckCircle2, Circle, AlertTriangle, ClipboardCheck, ChevronDown, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

export interface ChecklistItemDef {
  key: string;
  label: string;
  required: boolean;
  help?: string;
}

export interface StageChecklistConfig {
  stageName: string;
  shortLabel: string;
  stageId: string;
  checklistType: string;
  title: string;
  subtitle: string;
  hasSellerTypeToggle?: boolean;
  sellerTypeLabel?: string;
  hasCoproprieteToggle?: boolean;
  progressLabel: string;
  items: ChecklistItemDef[];
  moraleExtraItems?: ChecklistItemDef[];
}

export const IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID = '8f79d05c-d191-43bb-8323-bedbd722f9f2';
export const IMMOSPHERA_AGENCY_ID = '15157da9-71ea-4760-ae1c-3bc99d9caa20';

export const TRANSACTIONS_V2_STAGE_ORDER = [
  'Récolte docs',
  'Saisie bien netty',
  'Tracfin vendeur',
  'Mandat',
  'Prise de vues',
  'Mise en ligne',
  "Offre d'achat",
  'Signature compromis',
  'signature acte authentique',
];

const MORALE_EXTRA_ITEMS: ChecklistItemDef[] = [
  { key: 'carte_identite_associes', label: 'Carte d’identité de chaque associé', required: true },
  { key: 'extrait_kbis', label: 'Extrait Kbis de moins de 3 mois', required: true, help: 'Source : annuaire-des-entreprises.data.gouv.fr ou pappers.fr' },
  { key: 'statuts_a_jour', label: 'Statuts à jour', required: true },
  { key: 'registre_beneficiaires', label: 'Registre des bénéficiaires effectifs', required: true, help: 'Source : à demander au client ou aller sur Pappers si à jour' },
];

export const STAGE_CHECKLISTS: Record<string, StageChecklistConfig> = {
  'Récolte docs': {
    stageName: 'Récolte docs',
    shortLabel: 'Récolte docs',
    stageId: '134a1667-9531-4a01-bd40-fb07c513c764',
    checklistType: 'recolte_docs',
    title: 'Checklist — Récolte documents',
    subtitle: 'Cochez les documents déjà récupérés pour ce client.',
    hasSellerTypeToggle: true,
    hasCoproprieteToggle: true,
    progressLabel: 'documents récupérés',
    items: [
      { key: 'carte_identite', label: 'Carte d’identité ou passeport', required: true },
      { key: 'titre_propriete', label: 'Titre de propriété', required: true },
      { key: 'taxe_fonciere', label: 'Taxe foncière', required: true },
      { key: 'diagnostic', label: 'Diagnostic', required: true },
      { key: 'facture_travaux', label: 'Facture des travaux', required: false },
    ],
    moraleExtraItems: MORALE_EXTRA_ITEMS,
  },
  'Saisie bien netty': {
    stageName: 'Saisie bien netty',
    shortLabel: 'Saisie Netty',
    stageId: '5798510d-9536-4566-91fb-40a3d9081375',
    checklistType: 'saisie_bien_netty',
    title: 'Checklist — Saisie bien Netty',
    subtitle: "Cochez chaque étape réalisée pour la mise en ligne de l'annonce.",
    progressLabel: 'étapes validées',
    items: [
      { key: 'pieces_justificatives', label: "Insérer les pièces justificatives dans l'espace de stockage (renommées en amont)", required: true },
      { key: 'annonce_faite', label: "Faire l'annonce", required: true },
      { key: 'dpe_effectue', label: 'DPE effectué', required: true, help: "Obligatoire pour mettre en ligne l'annonce" },
    ],
  },
  'Tracfin vendeur': {
    stageName: 'Tracfin vendeur',
    shortLabel: 'Tracfin',
    stageId: '0759ed76-d8db-49ad-b7e9-5b8af883c1ad',
    checklistType: 'tracfin_vendeur',
    title: 'Checklist — Tracfin vendeur',
    subtitle: 'Cochez chaque étape réalisée pour le Tracfin vendeur.',
    progressLabel: 'étapes validées',
    items: [
      { key: 'tracfin_vendeur_renseigne', label: 'Renseigner le Tracfin vendeur', required: true },
    ],
  },
  'Mandat': {
    stageName: 'Mandat',
    shortLabel: 'Mandat',
    stageId: '44090289-7ba0-4c8e-b395-2a2453b100b5',
    checklistType: 'mandat',
    title: 'Checklist — Mandat',
    subtitle: 'Cochez chaque étape réalisée pour le mandat.',
    progressLabel: 'étapes validées',
    items: [
      { key: 'info_precontractuelle', label: "Renseigner l'information précontractuelle obligatoire", required: true },
      { key: 'delai_retractation', label: 'Insérer le délai de rétractation (oui), sauf SCI ou société pro', required: true },
    ],
  },
  'Prise de vues': {
    stageName: 'Prise de vues',
    shortLabel: 'Prise de vues',
    stageId: '72abacab-8f23-405a-abb2-51bbbc66b707',
    checklistType: 'prise_de_vues',
    title: 'Checklist — Prises de vues',
    subtitle: 'Cochez chaque étape réalisée pour les prises de vues.',
    progressLabel: 'étapes validées',
    items: [
      { key: 'verif_creneau', label: "Vérifier la disponibilité du créneau avant réservation dans l'agenda", required: true },
      { key: 'reserver_camera', label: 'Réserver la caméra sur l’agenda CRM (onglet Caméra)', required: true },
      { key: 'recharger_camera', label: 'Recharger la caméra', required: true },
      { key: 'vider_carte', label: 'Après les prises de vues, vider la carte dans le Drive Immosphera (dossier Novavisio)', required: true },
    ],
  },
  'Mise en ligne': {
    stageName: 'Mise en ligne',
    shortLabel: 'Mise en ligne',
    stageId: '75e36ed8-032b-4f1e-9ec7-d2e83e784876',
    checklistType: 'mise_en_ligne',
    title: 'Checklist — Mise en ligne',
    subtitle: "Cochez chaque étape réalisée pour la mise en ligne de l'annonce.",
    progressLabel: 'étapes validées',
    items: [
      { key: 'coordonnees_visite_virtuelle', label: 'Mettre vos coordonnées dans la visite virtuelle (Girafe → Infos propriété → Contact)', required: true },
      { key: 'mise_en_ligne_passerelles', label: 'Mise en ligne sur vos passerelles', required: true },
      { key: 'verif_conformite_passerelles', label: 'Vérifier sur les passerelles la bonne conformité des annonces', required: true },
    ],
  },
  "Offre d'achat": {
    stageName: "Offre d'achat",
    shortLabel: "Offre d'achat",
    stageId: '81db9db7-0c37-467f-ae1e-9f22de1bf736',
    checklistType: 'offre_achat',
    title: "Checklist — Offre d'achat",
    subtitle: "Cochez chaque étape réalisée à la réception d'une offre d'achat.",
    hasSellerTypeToggle: true,
    sellerTypeLabel: "Type d'acquéreur",
    hasCoproprieteToggle: true,
    progressLabel: 'documents récupérés',
    items: [
      { key: 'tracfin_acquereurs', label: 'Si offre reçue, faire le Tracfin acquéreurs', required: true },
      { key: 'carte_identite', label: 'Carte d’identité ou passeport', required: true },
      { key: 'diagnostic', label: 'Diagnostic', required: true },
      { key: 'financement_valide', label: 'Financement validé par un Courtier ou une Banque (document à l’appui)', required: true },
      { key: 'facture_travaux', label: 'Facture des travaux', required: false },
    ],
    moraleExtraItems: MORALE_EXTRA_ITEMS,
  },
};

const CHECKLIST_UPDATED_EVENT = 'novasphere:checklist-updated';
function notifyChecklistUpdated(leadId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHECKLIST_UPDATED_EVENT, { detail: { leadId } }));
  }
}

function normalizeStageKey(name: string | undefined | null): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, "'")
    .toLowerCase()
    .trim();
}

export function getStageChecklistConfig(stageName: string | undefined | null): StageChecklistConfig | undefined {
  if (!stageName) return undefined;
  if (STAGE_CHECKLISTS[stageName]) return STAGE_CHECKLISTS[stageName];
  const norm = normalizeStageKey(stageName);
  return Object.values(STAGE_CHECKLISTS).find((cfg) => normalizeStageKey(cfg.stageName) === norm);
}

export function getPreviousChecklistConfigs(stageName: string | undefined | null): StageChecklistConfig[] {
  if (!stageName) return [];
  const normTarget = normalizeStageKey(stageName);
  const idx = TRANSACTIONS_V2_STAGE_ORDER.findIndex((s) => normalizeStageKey(s) === normTarget);
  if (idx === 0) return [];
  const limit = idx > 0 ? idx : TRANSACTIONS_V2_STAGE_ORDER.length;
  const result: StageChecklistConfig[] = [];
  for (let i = 0; i < limit; i++) {
    const cfg = getStageChecklistConfig(TRANSACTIONS_V2_STAGE_ORDER[i]);
    if (cfg) result.push(cfg);
  }
  return result;
}

export function getPreviousChecklistConfig(stageName: string): StageChecklistConfig | null {
  const list = getPreviousChecklistConfigs(stageName);
  return list.length > 0 ? list[list.length - 1] : null;
}

interface ChecklistItemState {
  label: string;
  checked: boolean;
  required: boolean;
  checked_at: string | null;
  checked_by: string | null;
  help?: string;
}

interface ChecklistRow {
  id?: string;
  lead_id: string;
  agency_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  checklist_type: string;
  seller_type: 'personne_physique' | 'personne_morale';
  is_copropriete: boolean;
  items: Record<string, ChecklistItemState>;
}

function getEffectiveItems(config: StageChecklistConfig, sellerType: 'personne_physique' | 'personne_morale'): ChecklistItemDef[] {
  if (sellerType === 'personne_morale' && config.moraleExtraItems) {
    return [...config.items, ...config.moraleExtraItems];
  }
  return config.items;
}

const liveStageIdsCache = new Map<string, Record<string, string>>();

async function resolveLiveStageIds(pipelineId: string): Promise<Record<string, string>> {
  const cached = liveStageIdsCache.get(pipelineId);
  if (cached) return cached;
  const { data } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', pipelineId);
  const map: Record<string, string> = {};
  (data || []).forEach((s: any) => {
    if (s?.name && s?.id) {
      map[normalizeStageKey(s.name)] = s.id as string;
    }
  });
  liveStageIdsCache.set(pipelineId, map);
  return map;
}

function findMatchingChecklistRow(
  rows: any[],
  config: StageChecklistConfig,
  liveStageId?: string | null
): ChecklistRow | null {
  const found = rows.find(
    (r) =>
      r.checklist_type === config.checklistType ||
      r.stage_id === config.stageId ||
      (liveStageId && r.stage_id === liveStageId)
  );
  if (!found) return null;
  const sellerType: 'personne_physique' | 'personne_morale' =
    found.seller_type === 'personne_morale' ? 'personne_morale' : 'personne_physique';
  const effective = getEffectiveItems(config, sellerType);
  const rawItems = (found.items || {}) as Record<string, ChecklistItemState>;
  const mergedItems: Record<string, ChecklistItemState> = {};
  effective.forEach((it) => {
    const existing = rawItems[it.key];
    mergedItems[it.key] = existing
      ? {
          label: it.label,
          checked: Boolean(existing.checked),
          required: it.required,
          checked_at: existing.checked_at || null,
          checked_by: existing.checked_by || null,
          help: it.help,
        }
      : {
          label: it.label,
          checked: false,
          required: it.required,
          checked_at: null,
          checked_by: null,
          help: it.help,
        };
  });
  return {
    id: found.id,
    lead_id: found.lead_id,
    agency_id: found.agency_id || IMMOSPHERA_AGENCY_ID,
    pipeline_id: found.pipeline_id || IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID,
    stage_id: liveStageId ?? null,
    checklist_type: config.checklistType,
    seller_type: sellerType,
    is_copropriete: Boolean(found.is_copropriete),
    items: mergedItems,
  };
}

function buildDefaultChecklistRow(
  leadId: string,
  pipelineId: string,
  config: StageChecklistConfig,
  liveStageId?: string | null
): ChecklistRow {
  const items: Record<string, ChecklistItemState> = {};
  config.items.forEach((it) => {
    items[it.key] = {
      label: it.label,
      checked: false,
      required: it.required,
      checked_at: null,
      checked_by: null,
      help: it.help,
    };
  });
  return {
    lead_id: leadId,
    agency_id: IMMOSPHERA_AGENCY_ID,
    pipeline_id: pipelineId || IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID,
    stage_id: liveStageId ?? null,
    checklist_type: config.checklistType,
    seller_type: 'personne_physique',
    is_copropriete: false,
    items,
  };
}

export function usePreviousStageMissingCount(leadId: string, currentStageName: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  const prevConfigs = getPreviousChecklistConfigs(currentStageName);
  const prevKey = prevConfigs.map((c) => c.checklistType).join(',');

  const refresh = useCallback(async () => {
    if (!leadId || prevConfigs.length === 0) {
      setCount(null);
      return;
    }
    const [liveMap, { data }] = await Promise.all([
      resolveLiveStageIds(IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID),
      supabase.from('lead_checklists' as any).select('*').eq('lead_id', leadId),
    ]);
    const rows = (data || []) as any[];
    const checkedKeysGlobal = new Set<string>();
    rows.forEach((r) => {
      const items = (r?.items || {}) as Record<string, ChecklistItemState>;
      Object.entries(items).forEach(([k, v]) => {
        if (v?.checked) checkedKeysGlobal.add(k);
      });
    });

    const missingKeys = new Set<string>();
    prevConfigs.forEach((cfg) => {
      const liveStageId = liveMap[normalizeStageKey(cfg.stageName)] || null;
      const matched = findMatchingChecklistRow(rows, cfg, liveStageId);
      const items = matched
        ? matched.items
        : buildDefaultChecklistRow(leadId, IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID, cfg, liveStageId).items;
      Object.entries(items).forEach(([key, it]) => {
        if (it.required && !it.checked && !checkedKeysGlobal.has(key)) {
          missingKeys.add(`${cfg.checklistType}:${key}`);
        }
      });
    });
    setCount(missingKeys.size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, prevKey]);

  useEffect(() => {
    void refresh();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ leadId?: string }>).detail;
      if (!detail?.leadId || detail.leadId === leadId) {
        void refresh();
      }
    };
    window.addEventListener(CHECKLIST_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CHECKLIST_UPDATED_EVENT, handler);
  }, [refresh, leadId]);

  return count;
}

export function useCurrentStageChecklistCount(
  leadId: string,
  currentStageName: string | undefined
): { done: number; total: number } | null {
  const config = getStageChecklistConfig(currentStageName);
  const [state, setState] = useState<{ done: number; total: number } | null>(null);

  const refresh = useCallback(async () => {
    if (!leadId || !config) {
      setState(null);
      return;
    }
    const [liveMap, { data }] = await Promise.all([
      resolveLiveStageIds(IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID),
      supabase.from('lead_checklists' as any).select('*').eq('lead_id', leadId),
    ]);
    const rows = (data || []) as any[];
    const liveStageId = liveMap[normalizeStageKey(config.stageName)] || null;
    const matched = findMatchingChecklistRow(rows, config, liveStageId);
    if (!matched) {
      setState({ done: 0, total: config.items.length });
      return;
    }
    const values = Object.values(matched.items);
    setState({
      done: values.filter((it) => it.checked).length,
      total: values.length,
    });
  }, [leadId, config]);

  useEffect(() => {
    void refresh();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ leadId?: string }>).detail;
      if (!detail?.leadId || detail.leadId === leadId) {
        void refresh();
      }
    };
    window.addEventListener(CHECKLIST_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CHECKLIST_UPDATED_EVENT, handler);
  }, [refresh, leadId]);

  return state;
}

function useSavedFlash(): [boolean, () => void] {
  const [visible, setVisible] = useState(false);
  const flash = () => {
    setVisible(true);
    setTimeout(() => setVisible(false), 2000);
  };
  return [visible, flash];
}

const TransactionChecklistModal: React.FC<{
  leadId: string;
  pipelineId: string;
  stageName: string;
  onClose: () => void;
}> = ({ leadId, pipelineId, stageName, onClose }) => {
  const { currentUser } = useAuth();
  const config = getStageChecklistConfig(stageName);
  const prevConfigs = getPreviousChecklistConfigs(stageName);
  const effectivePipelineId = pipelineId || IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID;

  const [loading, setLoading] = useState(true);
  const [rowsByType, setRowsByType] = useState<Record<string, ChecklistRow>>({});
  const [initialMissingKeys, setInitialMissingKeys] = useState<Set<string>>(new Set());
  const [carriedOpen, setCarriedOpen] = useState(true);
  const [justSaved, flashSaved] = useSavedFlash();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [liveMap, { data, error }] = await Promise.all([
          resolveLiveStageIds(effectivePipelineId),
          supabase.from('lead_checklists' as any).select('*').eq('lead_id', leadId),
        ]);
        if (cancelled) return;
        if (error) {
          console.error('Erreur chargement checklists :', error);
        }
        const dbRows = (data || []) as any[];
        const allConfigs = [...prevConfigs, ...(config ? [config] : [])];
        const nextMap: Record<string, ChecklistRow> = {};
        const initiallyMissing = new Set<string>();

        allConfigs.forEach((cfg) => {
          const liveStageId = liveMap[normalizeStageKey(cfg.stageName)] || null;
          const row =
            findMatchingChecklistRow(dbRows, cfg, liveStageId) ||
            buildDefaultChecklistRow(leadId, effectivePipelineId, cfg, liveStageId);
          nextMap[cfg.checklistType] = row;
        });

        prevConfigs.forEach((cfg) => {
          const r = nextMap[cfg.checklistType];
          if (!r) return;
          Object.entries(r.items).forEach(([itemKey, it]) => {
            if (it.required && !it.checked) {
              initiallyMissing.add(`${cfg.checklistType}:${itemKey}`);
            }
          });
        });

        setRowsByType(nextMap);
        setInitialMissingKeys(initiallyMissing);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, effectivePipelineId, stageName]);

  const persistChecklistRow = async (targetConfig: StageChecklistConfig, next: ChecklistRow) => {
    setRowsByType((prev) => ({ ...prev, [targetConfig.checklistType]: next }));
    try {
      const liveMap = await resolveLiveStageIds(effectivePipelineId);
      const validStageId = liveMap[normalizeStageKey(targetConfig.stageName)] ?? null;

      const buildPayload = (stageIdVal: string | null) => ({
        lead_id: next.lead_id,
        agency_id: next.agency_id || IMMOSPHERA_AGENCY_ID,
        pipeline_id: next.pipeline_id || effectivePipelineId,
        stage_id: stageIdVal,
        checklist_type: next.checklist_type,
        seller_type: next.seller_type,
        is_copropriete: next.is_copropriete,
        items: next.items,
        updated_by: currentUser?.uid || null,
        updated_at: new Date().toISOString(),
      });

      let rowId = next.id;
      if (!rowId) {
        const { data: existing } = await supabase
          .from('lead_checklists' as any)
          .select('id')
          .eq('lead_id', next.lead_id)
          .eq('checklist_type', next.checklist_type)
          .maybeSingle();
        if ((existing as any)?.id) {
          rowId = (existing as any).id as string;
        }
      }

      if (rowId) {
        let { error } = await supabase
          .from('lead_checklists' as any)
          .update(buildPayload(validStageId))
          .eq('id', rowId);
        if (error && /stage_id_fkey|foreign key/i.test(error.message || '')) {
          liveStageIdsCache.delete(effectivePipelineId);
          const retry = await supabase
            .from('lead_checklists' as any)
            .update(buildPayload(null))
            .eq('id', rowId);
          error = retry.error;
        }
        if (error) throw error;
        setRowsByType((prev) => ({
          ...prev,
          [targetConfig.checklistType]: {
            ...(prev[targetConfig.checklistType] || next),
            id: rowId,
            stage_id: validStageId,
          },
        }));
      } else {
        let { data, error } = await supabase
          .from('lead_checklists' as any)
          .insert({ ...buildPayload(validStageId), created_by: currentUser?.uid || null })
          .select('id')
          .single();
        if (error && /stage_id_fkey|foreign key/i.test(error.message || '')) {
          liveStageIdsCache.delete(effectivePipelineId);
          const retry = await supabase
            .from('lead_checklists' as any)
            .insert({ ...buildPayload(null), created_by: currentUser?.uid || null })
            .select('id')
            .single();
          data = retry.data;
          error = retry.error;
        }
        if (error) throw error;
        const createdId = (data as any)?.id as string | undefined;
        if (createdId) {
          setRowsByType((prev) => ({
            ...prev,
            [targetConfig.checklistType]: {
              ...(prev[targetConfig.checklistType] || next),
              id: createdId,
              stage_id: validStageId,
            },
          }));
        }
      }

      flashSaved();
      notifyChecklistUpdated(leadId);
    } catch (err: any) {
      console.error('Erreur enregistrement checklist :', err);
      toast.error(err?.message || 'Erreur d’enregistrement de la checklist.');
    }
  };

  const toggleStageItem = (targetConfig: StageChecklistConfig, itemKey: string) => {
    const targetRow = rowsByType[targetConfig.checklistType];
    if (!targetRow) return;
    const current = targetRow.items[itemKey];
    if (!current) return;
    const nextChecked = !current.checked;
    const nowIso = new Date().toISOString();

    const nextRow: ChecklistRow = {
      ...targetRow,
      items: {
        ...targetRow.items,
        [itemKey]: {
          ...current,
          checked: nextChecked,
          checked_at: nextChecked ? nowIso : null,
          checked_by: nextChecked ? currentUser?.uid || null : null,
        },
      },
    };
    void persistChecklistRow(targetConfig, nextRow);

    if (config && config.checklistType !== targetConfig.checklistType) {
      const currentStageRow = rowsByType[config.checklistType];
      if (currentStageRow && currentStageRow.items[itemKey]) {
        const syncedRow: ChecklistRow = {
          ...currentStageRow,
          items: {
            ...currentStageRow.items,
            [itemKey]: {
              ...currentStageRow.items[itemKey],
              checked: nextChecked,
              checked_at: nextChecked ? nowIso : null,
              checked_by: nextChecked ? currentUser?.uid || null : null,
            },
          },
        };
        void persistChecklistRow(config, syncedRow);
      }
    }
  };

  if (!config && prevConfigs.length === 0) return null;

  const currentRow = config ? rowsByType[config.checklistType] : null;
  const itemsList = currentRow ? Object.entries(currentRow.items) : [];
  const doneCount = itemsList.filter(([, it]) => it.checked).length;
  const total = itemsList.length;
  const progressPercent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // Liste plate et compacte des éléments reportés, chacun portant le badge court de son étape d'origine
  const carriedItems: {
    config: StageChecklistConfig;
    key: string;
    item: ChecklistItemState;
  }[] = [];

  prevConfigs.forEach((prevCfg) => {
    const r = rowsByType[prevCfg.checklistType];
    if (!r) return;
    Object.entries(r.items).forEach(([key, it]) => {
      if (it.required && (!it.checked || initialMissingKeys.has(`${prevCfg.checklistType}:${key}`))) {
        carriedItems.push({ config: prevCfg, key, item: it });
      }
    });
  });

  const totalStillMissing = carriedItems.filter((x) => !x.item.checked).length;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-gradient-to-b from-[#081f23] to-[#051417] border border-white/15 rounded-2xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85),0_0_30px_rgba(247,188,95,0.08)] flex flex-col max-h-[86vh] overflow-hidden"
      >
        {/* Liseré supérieur doré signature NovaSphere */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F]/80 to-transparent pointer-events-none" />

        {/* En-tête fixe */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-[#07191c]/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F7BC5F]/20 to-[#F7BC5F]/5 border border-[#F7BC5F]/40 flex items-center justify-center text-[#F7BC5F] shrink-0 shadow-sm">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-extrabold text-white truncate">
                  {config ? config.title.replace('Checklist — ', '') : stageName}
                </h3>
                {config && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#F7BC5F]/15 text-[#FAD592] border border-[#F7BC5F]/30">
                    {doneCount}/{total} {config.progressLabel}
                  </span>
                )}
                {justSaved && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 animate-fade-in">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Enregistré
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                {config ? config.subtitle : 'Documents et étapes reportés des étapes précédentes.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors shrink-0 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barre de progression fine */}
        {config && total > 0 && (
          <div className="h-1 w-full bg-white/[0.04] shrink-0">
            <div
              className="h-full bg-gradient-to-r from-[#F7BC5F] to-emerald-400 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Corps scrollable */}
        {loading ? (
          <div className="p-10 flex items-center justify-center text-slate-400 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#F7BC5F]" /> Chargement de la checklist...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-4">
            {/* 1. ÉTAPE ACTUELLE EN PREMIER (toujours accessible immédiatement) */}
            {config && currentRow && (
              <div className="space-y-3">
                {(config.hasSellerTypeToggle || config.hasCoproprieteToggle) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {config.hasSellerTypeToggle && (
                      <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                          {config.sellerTypeLabel || 'Type de vendeur'}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(['personne_physique', 'personne_morale'] as const).map((v) => {
                            const active = currentRow.seller_type === v;
                            return (
                              <button
                                key={v}
                                type="button"
                                onClick={() => {
                                  const effective = getEffectiveItems(config, v);
                                  const nextItems: Record<string, ChecklistItemState> = {};
                                  effective.forEach((it) => {
                                    nextItems[it.key] = currentRow.items[it.key] || {
                                      label: it.label,
                                      checked: false,
                                      required: it.required,
                                      checked_at: null,
                                      checked_by: null,
                                      help: it.help,
                                    };
                                  });
                                  void persistChecklistRow(config, { ...currentRow, seller_type: v, items: nextItems });
                                }}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                  active
                                    ? 'bg-[#F7BC5F] text-slate-950 shadow-sm'
                                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                                }`}
                              >
                                {v === 'personne_physique' ? 'Physique' : 'Société / SCI'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {config.hasCoproprieteToggle && (
                      <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white">Bien en copropriété</p>
                          <p className="text-[10px] text-slate-400 truncate">Règlement, PV d'AG, plan pluriannuel</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void persistChecklistRow(config, { ...currentRow, is_copropriete: !currentRow.is_copropriete })}
                          className={`w-10 h-5 rounded-full shrink-0 transition-colors relative cursor-pointer ${
                            currentRow.is_copropriete ? 'bg-[#F7BC5F]' : 'bg-white/15'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                              currentRow.is_copropriete ? 'left-[22px]' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#F7BC5F] flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" />
                      À valider à cette étape
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {itemsList.map(([key, it]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleStageItem(config, key)}
                        className={`group w-full flex items-start gap-2.5 p-3 rounded-xl border transition-all text-left cursor-pointer ${
                          it.checked
                            ? 'bg-[#F7BC5F]/10 border-[#F7BC5F]/45 shadow-[0_0_15px_rgba(247,188,95,0.08)]'
                            : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 hover:border-white/20'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                            it.checked
                              ? 'bg-[#F7BC5F] text-slate-950'
                              : 'border border-slate-500 group-hover:border-[#F7BC5F]/70'
                          }`}
                        >
                          {it.checked && <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs sm:text-[13px] font-semibold leading-snug ${it.checked ? 'text-[#FAD592]' : 'text-white'}`}>
                            {it.label}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {it.required ? (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                                Obligatoire
                              </span>
                            ) : (
                              <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-slate-500">
                                Optionnel
                              </span>
                            )}
                            {it.help && <span className="text-[10px] text-slate-400">{it.help}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2. DOCUMENTS / ÉTAPES REPORTÉS DES ÉTAPES PRÉCÉDENTES (compact, avec badge d'étape sur chaque ligne) */}
            {carriedItems.length > 0 && (
              <div
                className={`rounded-xl border transition-colors overflow-hidden ${
                  totalStillMissing > 0
                    ? 'border-amber-500/35 bg-gradient-to-b from-amber-500/[0.08] to-rose-500/[0.05]'
                    : 'border-emerald-500/35 bg-emerald-500/[0.06]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setCarriedOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {totalStillMissing > 0 ? (
                      <span className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <span className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className={`text-xs font-bold truncate ${totalStillMissing > 0 ? 'text-amber-200' : 'text-emerald-200'}`}>
                        {totalStillMissing > 0
                          ? `${totalStillMissing} élément${totalStillMissing > 1 ? 's' : ''} reporté${totalStillMissing > 1 ? 's' : ''} des étapes précédentes`
                          : 'Tous les éléments reportés ont été régularisés'}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Cochez directement ici pour régulariser sans revenir en arrière
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${carriedOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {carriedOpen && (
                  <div className="px-3.5 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {carriedItems.map(({ config: prevCfg, key, item }) => (
                      <button
                        key={`${prevCfg.checklistType}:${key}`}
                        type="button"
                        onClick={() => toggleStageItem(prevCfg, key)}
                        className={`group w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all text-left cursor-pointer ${
                          item.checked
                            ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-100'
                            : 'bg-[#07191c]/80 hover:bg-[#0b2429] border-amber-500/25 hover:border-amber-400/50 text-slate-100'
                        }`}
                      >
                        {item.checked ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-amber-400/80 group-hover:text-amber-300 shrink-0" />
                        )}
                        <span className="text-xs font-medium flex-1 min-w-0 line-clamp-2 leading-snug">
                          {item.label}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                            item.checked
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/25'
                          }`}
                        >
                          {prevCfg.shortLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Pied de modale fixe */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-[#07191c]/90 shrink-0">
          <span className="text-[11px] text-slate-400">
            {totalStillMissing > 0
              ? `${totalStillMissing} élément${totalStillMissing > 1 ? 's' : ''} en attente de régularisation`
              : 'Tout est à jour sur les étapes précédentes ✓'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] hover:brightness-110 text-slate-950 font-black text-xs shadow-md transition-all cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default TransactionChecklistModal;
