import React, { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

// Demande explicite (28/08/2026) : "dans Immosphera, dans le Pipeline
// Transactions V2, je voudrais que à chaque étape de la pipeline il y ait
// une checklist" — construit étape par étape, une à la fois, sur demande de
// l'utilisateur. Réutilise TEL QUEL le schéma de la table `lead_checklists`
// déjà présente en base (héritée de l'ancienne version de l'app, jamais
// reconstruite côté interface dans cette V2) : mêmes clés d'item, mêmes
// `checklist_type`, pour rester compatible avec les quelques checklists
// déjà remplies qui existaient avant cette réintégration.
//
// Une checklist par (lead, étape) : `stage_id` fait partie de la clé, donc
// une fiche qui repasse par une étape déjà validée retrouve son état.

export interface ChecklistItemDef {
  key: string;
  label: string;
  required: boolean;
  help?: string;
}

export interface StageChecklistConfig {
  // `deal.stage` (Pipeline.tsx) n'expose que le NOM de l'étape, jamais son
  // UUID (résolu une seule fois côté hook useDeals) — on indexe donc cette
  // config par nom d'étape (unique au sein de CE pipeline, la seule
  // garantie dont on a besoin ici), et on garde l'UUID réel à part pour
  // l'écrire dans `lead_checklists.stage_id`.
  stageId: string;
  checklistType: string;
  title: string;
  subtitle: string;
  hasSellerTypeToggle?: boolean;
  // "Type de vendeur" par défaut, mais "Type de acquéreur" sur l'étape
  // "Offre d'achat" (capture d'écran de référence) — même toggle, libellé
  // différent selon le contexte de l'étape.
  sellerTypeLabel?: string;
  hasCoproprieteToggle?: boolean;
  // Libellé du compteur "X / Y ..." — varie selon l'étape ("documents
  // récupérés", "étapes validées"...), demande explicite.
  progressLabel: string;
  items: ChecklistItemDef[];
  // Documents complémentaires demandés UNIQUEMENT si "Personne morale" est
  // sélectionné (capture d'écran de référence : 5 items en "physique", 9 en
  // "morale") — ajoutés à `items` au moment de la construction/affichage,
  // jamais stockés séparément.
  moraleExtraItems?: ChecklistItemDef[];
}

// Un seul type de vendeur pour l'instant (personne physique) — les items
// complémentaires copropriété seront ajoutés quand l'utilisateur les
// précisera (toggle déjà prévu dans l'UI, juste pas encore d'items dédiés).
export const IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID = '8f79d05c-d191-43bb-8323-bedbd722f9f2';
export const IMMOSPHERA_AGENCY_ID = '15157da9-71ea-4760-ae1c-3bc99d9caa20';

// Ordre réel des étapes de "Pipeline Transactions V2" (pour retrouver
// l'étape PRÉCÉDENTE d'une carte donnée, et savoir si des documents y
// manquent encore — badge rouge demandé explicitement).
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

// Documents complémentaires "Personne morale" (société) — identiques sur
// "Récolte docs" et "Offre d'achat" (captures d'écran de référence), donc
// factorisés ici pour ne pas les dupliquer.
const MORALE_EXTRA_ITEMS: ChecklistItemDef[] = [
  { key: 'carte_identite_associes', label: 'Carte d’identité de chaque associé', required: true },
  { key: 'extrait_kbis', label: 'Extrait Kbis de moins de 3 mois', required: true, help: 'Source : annuaire-des-entreprises.data.gouv.fr ou pappers.fr' },
  { key: 'statuts_a_jour', label: 'Statuts à jour', required: true },
  { key: 'registre_beneficiaires', label: 'Registre des bénéficiaires effectifs', required: true, help: 'Source : à demander au client ou aller sur Pappers si à jour' },
];

// Étapes de "Pipeline Transactions V2", données une par une par
// l'utilisateur pour avancer tranquillement — il ne manque plus que
// "Signature compromis" et "signature acte authentique".
export const STAGE_CHECKLISTS: Record<string, StageChecklistConfig> = {
  'Récolte docs': {
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

// Étape précédente (dans l'ordre réel du pipeline) qui a une checklist
// configurée — `null` s'il n'y en a pas (ex: "Récolte docs" est la
// première, ou l'étape juste avant n'a pas encore de checklist définie).
export function getPreviousChecklistConfig(stageName: string): StageChecklistConfig | null {
  const idx = TRANSACTIONS_V2_STAGE_ORDER.indexOf(stageName);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const cfg = STAGE_CHECKLISTS[TRANSACTIONS_V2_STAGE_ORDER[i]];
    if (cfg) return cfg;
  }
  return null;
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
  pipeline_id: string;
  stage_id: string;
  checklist_type: string;
  seller_type: 'personne_physique' | 'personne_morale';
  is_copropriete: boolean;
  items: Record<string, ChecklistItemState>;
}

// Liste d'items effective pour une config + un type de vendeur/acquéreur
// donné — inclut les 4 documents "Personne morale" en plus de la base
// uniquement quand pertinent (voir `moraleExtraItems`).
function getEffectiveItems(config: StageChecklistConfig, sellerType: 'personne_physique' | 'personne_morale'): ChecklistItemDef[] {
  if (sellerType === 'personne_morale' && config.moraleExtraItems) {
    return [...config.items, ...config.moraleExtraItems];
  }
  return config.items;
}

// Nombre de documents obligatoires manquants sur la checklist de l'étape
// PRÉCÉDENTE (badge rouge sur la carte de l'étape actuelle) — `null` si pas
// pertinent ici (pas la bonne pipeline, ou aucune checklist configurée sur
// l'étape d'avant).
export function usePreviousStageMissingCount(leadId: string, currentStageName: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  const prevConfig = currentStageName ? getPreviousChecklistConfig(currentStageName) : null;
  useEffect(() => {
    if (!prevConfig) { setCount(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('lead_checklists' as any)
        .select('items')
        .eq('lead_id', leadId)
        .eq('stage_id', prevConfig.stageId)
        .maybeSingle();
      if (cancelled) return;
      const items = (data as any)?.items as Record<string, ChecklistItemState> | undefined;
      if (!items) { setCount(prevConfig.items.filter((it) => it.required).length); return; }
      const missing = Object.values(items).filter((it) => it.required && !it.checked).length;
      setCount(missing);
    })();
    return () => { cancelled = true; };
  }, [leadId, prevConfig?.stageId]);
  return count;
}

// X / Y de la checklist de l'étape ACTUELLE (affiché sur le bouton de la
// carte, pas seulement dans la modale).
export function useCurrentStageChecklistCount(leadId: string, currentStageName: string | undefined): { done: number; total: number } | null {
  const config = currentStageName ? STAGE_CHECKLISTS[currentStageName] : undefined;
  const [state, setState] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (!config) { setState(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('lead_checklists' as any)
        .select('items')
        .eq('lead_id', leadId)
        .eq('stage_id', config.stageId)
        .maybeSingle();
      if (cancelled) return;
      const items = (data as any)?.items as Record<string, ChecklistItemState> | undefined;
      const total = config.items.length;
      const done = items ? Object.values(items).filter((it) => it.checked).length : 0;
      setState({ done, total });
    })();
    return () => { cancelled = true; };
  }, [leadId, config?.stageId]);
  return state;
}

// Charge/enregistre une ligne de checklist pour un (lead, config) donné —
// factorisé pour être utilisé à la fois sur la checklist de l'étape
// courante ET sur celle de l'étape précédente (boîte rouge "documents
// manquants", cochable directement sans y retourner).
function useChecklistRow(leadId: string, pipelineId: string, config: StageChecklistConfig | null) {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<ChecklistRow | null>(null);

  useEffect(() => {
    if (!config) { setLoading(false); setRow(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('lead_checklists' as any)
        .select('*')
        .eq('lead_id', leadId)
        .eq('stage_id', config.stageId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Erreur chargement checklist :', error);
        setLoading(false);
        return;
      }
      if (data) {
        setRow(data as unknown as ChecklistRow);
      } else {
        const items: Record<string, ChecklistItemState> = {};
        config.items.forEach((it) => {
          items[it.key] = { label: it.label, checked: false, required: it.required, checked_at: null, checked_by: null, help: it.help };
        });
        setRow({
          lead_id: leadId,
          agency_id: IMMOSPHERA_AGENCY_ID,
          pipeline_id: pipelineId,
          stage_id: config.stageId,
          checklist_type: config.checklistType,
          seller_type: 'personne_physique',
          is_copropriete: false,
          items,
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, config?.stageId]);

  const persist = async (next: ChecklistRow, onSaved?: () => void) => {
    setRow(next);
    try {
      const payload = {
        lead_id: next.lead_id,
        agency_id: next.agency_id,
        pipeline_id: next.pipeline_id,
        stage_id: next.stage_id,
        checklist_type: next.checklist_type,
        seller_type: next.seller_type,
        is_copropriete: next.is_copropriete,
        items: next.items,
        updated_by: currentUser?.uid || null,
        updated_at: new Date().toISOString(),
      };
      // Pas d'`upsert` (onConflict) ici — la contrainte d'unicité exacte de
      // `lead_checklists` n'est pas connue avec certitude côté code (table
      // héritée de l'ancienne version de l'app, sans migration locale la
      // décrivant) : update explicite par id si la ligne existe déjà,
      // insert sinon, plutôt que de risquer une erreur Postgres "no unique
      // or exclusion constraint matching ON CONFLICT".
      if (next.id) {
        const { error } = await supabase.from('lead_checklists' as any).update(payload).eq('id', next.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('lead_checklists' as any)
          .insert({ ...payload, created_by: currentUser?.uid || null })
          .select('id')
          .single();
        if (error) throw error;
        if (data) setRow((r) => (r ? { ...r, id: (data as any).id } : r));
      }
      onSaved?.();
    } catch (err: any) {
      console.error('Erreur enregistrement checklist :', err);
      toast.error(err?.message || 'Erreur d’enregistrement de la checklist.');
    }
  };

  const toggleItem = (key: string, onSaved?: () => void) => {
    if (!row) return;
    const current = row.items[key];
    const nextChecked = !current.checked;
    void persist({
      ...row,
      items: {
        ...row.items,
        [key]: {
          ...current,
          checked: nextChecked,
          checked_at: nextChecked ? new Date().toISOString() : null,
          checked_by: nextChecked ? currentUser?.uid || null : null,
        },
      },
    }, onSaved);
  };

  return { loading, row, persist, toggleItem };
}

// "Enregistré à l'instant" — confirmation qui apparaît brièvement après
// chaque sauvegarde puis s'efface, plutôt qu'un badge statique.
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
  const config = STAGE_CHECKLISTS[stageName];
  const prevConfig = getPreviousChecklistConfig(stageName);

  const { loading, row, persist, toggleItem } = useChecklistRow(leadId, pipelineId, config || null);
  const { loading: prevLoading, row: prevRow, toggleItem: togglePrevItem } = useChecklistRow(leadId, pipelineId, prevConfig);
  const [justSaved, flashSaved] = useSavedFlash();

  if (!config) return null;

  const itemsList = row ? Object.entries(row.items) : [];
  const doneCount = itemsList.filter(([, it]) => it.checked).length;
  const total = itemsList.length;

  // Items obligatoires non cochés de l'étape précédente — boîte rouge,
  // demande explicite : "si le dossier passe à l'étape d'après et qu'il
  // manque des documents... pas bloquant, mais important de le mentionner",
  // avec possibilité de les cocher directement ici (capture d'écran de
  // référence) sans revenir en arrière.
  const prevMissing = prevRow ? Object.entries(prevRow.items).filter(([, it]) => it.required && !it.checked) : [];

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        // Demande explicite : tenir sur un écran desktop sans avoir à
        // scroller — modale élargie (plus de place pour une grille à 2
        // colonnes) + espacements resserrés, `max-h`/`overflow-y-auto`
        // gardés uniquement comme filet de sécurité si le contenu déborde
        // quand même (mobile, très grand nombre d'items...).
        className="w-full max-w-lg sm:max-w-2xl lg:max-w-3xl bg-[#07191b] border border-[#144447] rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto custom-scrollbar"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[#144447]">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-white">{config.title}</h3>
            <p className="text-xs text-slate-400 mt-1">{config.subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading || !row ? (
          <div className="p-8 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 font-semibold">
                {doneCount} / {total} {config.progressLabel}
              </span>
              {justSaved && (
                <span className="text-emerald-400 font-semibold flex items-center gap-1 animate-fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Enregistré à l'instant
                </span>
              )}
            </div>

            {!prevLoading && prevMissing.length > 0 && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {prevMissing.length} manquant{prevMissing.length > 1 ? 's' : ''} — {prevConfig?.title.replace('Checklist — ', '')}
                  </p>
                  <p className="text-[9px] text-rose-400/70">Cochez ici sans revenir en arrière.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {prevMissing.map(([key, it]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => togglePrevItem(key, flashSaved)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/20 transition-colors text-left"
                    >
                      <Circle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span className="text-xs font-semibold text-rose-100">{it.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {config.hasSellerTypeToggle && (
              <div>
                <p className="text-xs font-bold text-slate-300 mb-1.5">{config.sellerTypeLabel || 'Type de vendeur'}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['personne_physique', 'personne_morale'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        // En passant à "Personne morale", ajoute les 4
                        // documents complémentaires (jamais cochés au
                        // départ) ; en repassant à "Personne physique", les
                        // retire — sans jamais perdre l'état des cases déjà
                        // cochées parmi celles qui restent.
                        const effective = getEffectiveItems(config, v);
                        const nextItems: Record<string, ChecklistItemState> = {};
                        effective.forEach((it) => {
                          nextItems[it.key] = row.items[it.key] || { label: it.label, checked: false, required: it.required, checked_at: null, checked_by: null, help: it.help };
                        });
                        void persist({ ...row, seller_type: v, items: nextItems }, flashSaved);
                      }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                        row.seller_type === v
                          ? 'border-[#F7BC5F] bg-[#F7BC5F]/10 text-[#F7BC5F]'
                          : 'border-[#144447] text-slate-300 hover:border-[#256064]'
                      }`}
                    >
                      {row.seller_type === v ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4 text-slate-600" />}
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
                  onClick={() => void persist({ ...row, is_copropriete: !row.is_copropriete }, flashSaved)}
                  className={`w-11 h-6 rounded-full shrink-0 transition-colors relative ${row.is_copropriete ? 'bg-[#F7BC5F]' : 'bg-white/10'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${row.is_copropriete ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {itemsList.map(([key, it]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleItem(key, flashSaved)}
                  className="w-full flex items-start gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-[#144447] transition-colors text-left"
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
