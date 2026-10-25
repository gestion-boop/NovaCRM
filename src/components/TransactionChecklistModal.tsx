import React, { useEffect, useState, useCallback } from 'react';
import { X, Loader2, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
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
    stageId: '5798510d-9536-4566-91fb-40a3d9081375',
    checklistType: 'saisie_bien_netty',
    title: 'Checklist — Saisie bien Netty',
    subtitle: "Cochez chaque étape réalisée pour la mise en ligne de l'annonce.",
    progressLabel: 'étapes validées',
    items: [
      { key: 'pieces_justificatives', label: "Insérer les pièces justificatives dans le fichier de l'espace de stockage (renommées en amont sur votre ordinateur)", required: true },
      { key: 'annonce_faite', label: "Faire l'annonce", required: true },
      { key: 'dpe_effectue', label: 'DPE effectué', required: true, help: "Obligatoire pour mettre en ligne l'annonce" },
    ],
  },
  'Tracfin vendeur': {
    stageName: 'Tracfin vendeur',
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
    stageId: '44090289-7ba0-4c8e-b395-2a2453b100b5',
    checklistType: 'mandat',
    title: 'Checklist — Mandat',
    subtitle: 'Cochez chaque étape réalisée pour le mandat.',
    progressLabel: 'étapes validées',
    items: [
      { key: 'info_precontractuelle', label: "Renseigner l'information précontractuelle obligatoires", required: true },
      { key: 'delai_retractation', label: 'Insérer le délai de rétractation (en répondant oui), sauf si SCI ou professionnel achetant pour sa société', required: true },
    ],
  },
  'Prise de vues': {
    stageName: 'Prise de vues',
    stageId: '72abacab-8f23-405a-abb2-51bbbc66b707',
    checklistType: 'prise_de_vues',
    title: 'Checklist — Prises de vues',
    subtitle: 'Cochez chaque étape réalisée pour les prises de vues.',
    progressLabel: 'étapes validées',
    items: [
      { key: 'verif_creneau', label: "Vérifier la disponibilité du créneau avant réservation dans l'agenda", required: true },
      { key: 'reserver_camera', label: 'Réserver la caméra sur l’agenda CRM (onglet Caméra)', required: true },
      { key: 'recharger_camera', label: 'Recharger la caméra', required: true },
      { key: 'vider_carte', label: 'Après les prises de vues, vider la carte dans le Drive Google Immosphera partagé (dossier Novavisio)', required: true },
    ],
  },
  'Mise en ligne': {
    stageName: 'Mise en ligne',
    stageId: '75e36ed8-032b-4f1e-9ec7-d2e83e784876',
    checklistType: 'mise_en_ligne',
    title: 'Checklist — Mise en ligne',
    subtitle: "Cochez chaque étape réalisée pour la mise en ligne de l'annonce.",
    progressLabel: 'étapes validées',
    items: [
      { key: 'coordonnees_visite_virtuelle', label: 'Bien mettre vos coordonnées dans la visite virtuelle. Aller sur girafe dans la fiche du bien, et sur infos propriété, informations de contact', required: true },
      { key: 'mise_en_ligne_passerelles', label: 'Mise en ligne sur vos passerelles', required: true },
      { key: 'verif_conformite_passerelles', label: 'Vérifier sur les passerelles la bonne conformité des annonces', required: true },
    ],
  },
  "Offre d'achat": {
    stageName: "Offre d'achat",
    stageId: '81db9db7-0c37-467f-ae1e-9f22de1bf736',
    checklistType: 'offre_achat',
    title: "Checklist — Offre d'achat",
    subtitle: "Cochez chaque étape réalisée à la réception d'une offre d'achat.",
    hasSellerTypeToggle: true,
    sellerTypeLabel: 'Type de acquéreur',
    hasCoproprieteToggle: true,
    progressLabel: 'documents récupérés',
    items: [
      { key: 'tracfin_acquereurs', label: 'Si offre reçue, faire le Tracfin acquéreurs', required: true },
      { key: 'carte_identite', label: 'Carte d’identité ou passeport', required: true },
      { key: 'diagnostic', label: 'Diagnostic', required: true },
      { key: 'financement_valide', label: 'Financement à valider obligatoirement par un Courtier ou Banque avec un document à l’appui', required: true },
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

// Retourne TOUTES les checklists des étapes précédant `stageName` dans le pipeline,
// afin que tout document ou élément obligatoire oublié à une étape antérieure soit
// systématiquement reporté sur l'étape suivante (et les suivantes tant qu'il n'est pas coché).
export function getPreviousChecklistConfigs(stageName: string | undefined | null): StageChecklistConfig[] {
  if (!stageName) return [];
  const normTarget = normalizeStageKey(stageName);
  const idx = TRANSACTIONS_V2_STAGE_ORDER.findIndex((s) => normalizeStageKey(s) === normTarget);
  if (idx === 0) return [];
  // Si l'étape est dans TRANSACTIONS_V2_STAGE_ORDER (idx > 0), on prend toutes les étapes 0 .. idx-1.
  // Si c'est une étape ajoutée en fin de pipeline (ex. Conciergerie, Location validée...), on reporte
  // les oublis de toutes les étapes précédentes configurées.
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

// Cache léger des UUID réels de `pipeline_stages` pour éviter de violer
// `lead_checklists_stage_id_fkey` lorsque les colonnes du pipeline ont été
// recréées ou modifiées en base (les stageId codés en dur à l'origine ne
// correspondent alors plus aux UUID présents dans `pipeline_stages`).
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
  // Fusionne avec la définition actuelle au cas où des items auraient été ajoutés
  const sellerType: 'personne_physique' | 'personne_morale' =
    found.seller_type === 'personne_morale' ? 'personne_morale' : 'personne_physique';
  const effective = getEffectiveItems(config, sellerType);
  const rawItems = (found.items || {}) as Record<string, ChecklistItemState>;
  const mergedItems: Record<string, ChecklistItemState> = {};
  effective.forEach((it) => {
    const existing = rawItems[it.key];
    mergedItems[it.key] = existing
      ? {
          label: existing.label || it.label,
          checked: Boolean(existing.checked),
          required: it.required,
          checked_at: existing.checked_at || null,
          checked_by: existing.checked_by || null,
          help: existing.help ?? it.help,
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

// Nombre total de documents/étapes obligatoires manquants sur TOUTES les
// étapes précédentes (reportés d'étape en étape tant qu'ils ne sont pas cochés).
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
    // Si un document (même clé, ex: `carte_identite` ou `diagnostic`) a été coché
    // sur une étape ultérieure ou antérieure, on le considère comme régularisé.
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

// X / Y de la checklist de l'étape ACTUELLE.
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
  // Garde en mémoire les items qui étaient manquants à l'ouverture de la modale
  // afin qu'ils restent visibles (avec une coche verte) quand l'utilisateur les
  // coche dans la section "Reportés", au lieu de disparaître brutalement sous son clic.
  const [initialMissingKeys, setInitialMissingKeys] = useState<Set<string>>(new Set());
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

        // Détecte les items obligatoires non cochés des étapes précédentes
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
        // Vérifie si une ligne existe déjà en base pour ce lead + checklist_type
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
        // Filet de sécurité : si `validStageId` viole malgré tout la FK `lead_checklists_stage_id_fkey`,
        // on réessaie immédiatement avec `stage_id: null`.
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

    // Si le même document existe aussi dans l'étape courante (ex: `carte_identite` ou `diagnostic`),
    // on synchronise son état pour éviter d'avoir à le cocher deux fois.
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

  // Regroupe tous les documents/étapes reportés des étapes précédentes :
  // - ceux qui sont encore non cochés, OU
  // - ceux qui étaient non cochés à l'ouverture de la modale (pour qu'ils restent affichés avec une coche verte quand on les valide).
  const carriedOverGroups = prevConfigs
    .map((prevCfg) => {
      const r = rowsByType[prevCfg.checklistType];
      if (!r) return null;
      const entries = Object.entries(r.items).filter(
        ([key, it]) =>
          it.required && (!it.checked || initialMissingKeys.has(`${prevCfg.checklistType}:${key}`))
      );
      if (entries.length === 0) return null;
      const stillMissingCount = entries.filter(([, it]) => !it.checked).length;
      return {
        config: prevCfg,
        row: r,
        entries,
        stillMissingCount,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  const totalStillMissing = carriedOverGroups.reduce((acc, g) => acc + g.stillMissingCount, 0);

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg sm:max-w-2xl lg:max-w-3xl bg-[#07191b] border border-[#144447] rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto custom-scrollbar"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[#144447]">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-white">
              {config ? config.title : `Checklist — ${stageName}`}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {config
                ? config.subtitle
                : 'Documents et étapes reportés des étapes précédentes.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs flex-wrap gap-2">
              {config && (
                <span className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 font-semibold">
                  {doneCount} / {total} {config.progressLabel}
                </span>
              )}
              {justSaved && (
                <span className="text-emerald-400 font-semibold flex items-center gap-1 animate-fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Enregistré à l'instant
                </span>
              )}
            </div>

            {carriedOverGroups.length > 0 && (
              <div
                className={`rounded-xl border p-3 space-y-2.5 transition-colors ${
                  totalStillMissing > 0
                    ? 'border-rose-500/40 bg-rose-500/10'
                    : 'border-emerald-500/40 bg-emerald-500/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p
                    className={`text-xs font-bold flex items-center gap-1.5 ${
                      totalStillMissing > 0 ? 'text-rose-300' : 'text-emerald-300'
                    }`}
                  >
                    {totalStillMissing > 0 ? (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {totalStillMissing} document{totalStillMissing > 1 ? 's' : ''} / étape{totalStillMissing > 1 ? 's' : ''} reporté{totalStillMissing > 1 ? 's' : ''}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        Tous les éléments reportés ont été validés
                      </>
                    )}
                  </p>
                  <p className={`text-[10px] ${totalStillMissing > 0 ? 'text-rose-300/80' : 'text-emerald-300/80'}`}>
                    Cochez directement ici sans revenir à l'étape précédente.
                  </p>
                </div>

                <div className="space-y-2">
                  {carriedOverGroups.map((group) => (
                    <div key={group.config.checklistType} className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300/80">
                        Reporté de : {group.config.title.replace('Checklist — ', '')}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {group.entries.map(([key, it]) => (
                          <button
                            key={`${group.config.checklistType}:${key}`}
                            type="button"
                            onClick={() => toggleStageItem(group.config, key)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left cursor-pointer ${
                              it.checked
                                ? 'bg-emerald-950/40 hover:bg-emerald-950/60 border-emerald-500/40 text-emerald-100'
                                : 'bg-rose-950/30 hover:bg-rose-950/50 border-rose-500/30 text-rose-100'
                            }`}
                          >
                            {it.checked ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <Circle className="w-4 h-4 text-rose-400 shrink-0" />
                            )}
                            <span className="text-xs font-semibold flex-1">{it.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {config && currentRow && (
              <>
                {config.hasSellerTypeToggle && (
                  <div>
                    <p className="text-xs font-bold text-slate-300 mb-1.5">{config.sellerTypeLabel || 'Type de vendeur'}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['personne_physique', 'personne_morale'] as const).map((v) => (
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
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                            currentRow.seller_type === v
                              ? 'border-[#F7BC5F] bg-[#F7BC5F]/10 text-[#F7BC5F]'
                              : 'border-[#144447] text-slate-300 hover:border-[#256064]'
                          }`}
                        >
                          {currentRow.seller_type === v ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4 text-slate-600" />}
                          {v === 'personne_physique' ? 'Personne physique' : 'Personne morale'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {config.hasCoproprieteToggle && (
                  <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/5 border border-[#144447]">
                    <div>
                      <p className="text-xs font-bold text-white">Bien en copropriété</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Active les documents complémentaires (règlement, PV d'AG, plan pluriannuel).</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void persistChecklistRow(config, { ...currentRow, is_copropriete: !currentRow.is_copropriete })}
                      className={`w-11 h-6 rounded-full shrink-0 transition-colors relative ${currentRow.is_copropriete ? 'bg-[#F7BC5F]' : 'bg-white/10'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${currentRow.is_copropriete ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {itemsList.map(([key, it]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleStageItem(config, key)}
                      className="w-full flex items-start gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-[#144447] transition-colors text-left cursor-pointer"
                    >
                      {it.checked ? <CheckCircle2 className="w-4 h-4 text-[#F7BC5F] shrink-0 mt-0.5" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />}
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white">{it.label}</span>
                          {it.required && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500 shrink-0">Obligatoire</span>
                          )}
                        </span>
                        {it.help && <span className="block text-[11px] text-slate-400 mt-0.5">{it.help}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs"
              >
                Fermer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionChecklistModal;
