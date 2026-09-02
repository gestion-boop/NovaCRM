import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { AGENCIES } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Users, Coins, Briefcase, CheckCircle2, ArrowRight, Building, Sparkles, Pencil, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useContacts, matchesAgency } from '@/hooks/useContacts';
import { useDeals } from '@/hooks/useDeals';
import { useTasks } from '@/hooks/useTasks';

// Recharts applique ces réglages en style INLINE sur l'info-bulle : aucune
// règle CSS de thème ne peut les atteindre. Elles restaient donc noires, avec
// du texte noir dessus, une fois l'appli passée en mode jour. Les variables
// CSS, elles, sont résolues normalement dans un style inline — l'info-bulle
// suit ainsi le thème comme le reste (voir --nv-chart-* dans index.css).
interface LigneCa {
  id: string;
  nom: string;
  mandat: string;
  montant: number;
  etape: string;
  archive: boolean;
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--nv-chart-tooltip-bg)',
  borderColor: 'var(--nv-chart-tooltip-border)',
  borderRadius: '12px',
  color: 'var(--ink-1)',
} as const;

export default function Dashboard({
  onNavigate,
  onNavigateToStage,
}: {
  onNavigate: (tab: string) => void;
  // Ticket #105 : clic sur une colonne du graphique -> pipeline, direct
  // sur l'étape correspondante (au lieu de rester à choisir soi-même).
  onNavigateToStage?: (stage: string) => void;
}) {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const { contacts = [] } = useContacts();
  const { deals = [], allDeals = [] } = useDeals();
  const { tasks = [] } = useTasks();
  // 1. Calculate general statistics
  const totalContacts = contacts.length;

  // "Dossiers actifs" porte sur TOUTES les opportunités actuellement
  // visibles dans le Pipeline pour cette agence — sans filtre sur un nom
  // d'étape ("Perdu", "Dossier facture"...), car ces noms sont
  // personnalisables par agence/pipeline et ne correspondent déjà plus aux
  // étapes réellement configurées. Ainsi, ce chiffre correspond toujours
  // exactement à ce que montre le Pipeline, quelle que soit la façon dont
  // les étapes ont été renommées.
  const activeDeals = deals.length;

  // Position (ordre) réelle de chaque étape, par pipeline — nécessaire pour
  // déterminer ce qui se trouve "à partir de la colonne Accord banque".
  const { data: stagesWithPosition = [] } = useQuery({
    queryKey: ['pipeline-stages-positions'],
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('id, pipeline_id, name, position');
      return (data as { id: string; pipeline_id: string; name: string; position: number }[]) || [];
    },
  });

  // "Volume financier" = somme des opportunités arrivées à l'étape "Accord
  // banque" (ou équivalent, ex. "Accord banque / Rendez-vous") ou au-delà,
  // dans l'ordre réel des étapes de LEUR pipeline (chaque pipeline peut
  // avoir un ordre/nommage différent). Les opportunités dont le pipeline ne
  // comporte aucune étape "Accord banque" ne sont pas comptabilisées ici :
  // cet indicateur est spécifique au processus de financement.
  const totalDealValue = useMemo(() => {
    const accordBanquePositionByPipeline = new Map<string, number>();
    stagesWithPosition.forEach((s) => {
      if (/accord\s*banque/i.test(s.name)) {
        const current = accordBanquePositionByPipeline.get(s.pipeline_id);
        if (current === undefined || s.position < current) {
          accordBanquePositionByPipeline.set(s.pipeline_id, s.position);
        }
      }
    });

    const positionByPipelineAndStage = new Map<string, number>();
    stagesWithPosition.forEach((s) => {
      positionByPipelineAndStage.set(`${s.pipeline_id}::${s.name}`, s.position);
    });

    return deals.reduce((sum, d) => {
      if (!d.pipelineId) return sum;
      const threshold = accordBanquePositionByPipeline.get(d.pipelineId);
      if (threshold === undefined) return sum; // pipeline sans étape "Accord banque"
      const dealPosition = positionByPipelineAndStage.get(`${d.pipelineId}::${d.stage}`);
      if (dealPosition === undefined || dealPosition < threshold) return sum;
      return sum + d.amount;
    }, 0);
  }, [deals, stagesWithPosition]);

  const completedTasks = tasks.filter(t => t.completed).length;
  const pendingTasks = tasks.length - completedTasks;

  // 2. Prepare chart data: Stages Distribution — reflète les colonnes (et
  // l'ordre) du pipeline PAR DÉFAUT de chaque agence concernée, avec les
  // vrais titres d'étapes configurés (au lieu d'une liste figée ou d'un
  // mélange de noms venant de plusieurs pipelines / du champ "température").
  const { data: pipelinesData = [] } = useQuery({
    queryKey: ['dashboard-pipelines'],
    queryFn: async () => {
      const { data } = await supabase.from('pipelines').select('id, name, agency_id, is_default');
      return (data as { id: string; name: string; agency_id: string; is_default: boolean }[]) || [];
    },
  });

  // Ticket #34 : « toute affaire deposee dans la colonne Facture du pipeline
  // Transaction B2 doit etre comptabilisee dans le chiffre d'affaires de
  // l'agence, visible des seuls super admins ». Le montant retenu est le hors
  // taxes : `estimated_value` (ici `amount`) porte deja la commission agence
  // en HT, rien a convertir. Une affaire sans HT ne compte pas, mais on la
  // compte a part pour pouvoir le dire.
  //
  // Le pipeline et l'etape sont crees dans l'application, pas dans le code :
  // on vise donc le NOM, pas un identifiant fige, et de façon tolerante —
  // « Transaction B2 » comme « Transactions B2 », « Facture » comme
  // « Facture » ou « Dossier facture ». Meme principe que « Accord banque »
  // juste au-dessus.
  const sansAccents = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const chiffreAffairesAgence = useMemo(() => {
    const pipelinesVises = new Set(
      pipelinesData
        .filter((p) => {
          const nom = sansAccents(p.name);
          return nom.includes('transaction') && nom.includes('v2');
        })
        .map((p) => p.id)
    );
    if (pipelinesVises.size === 0) {
      return {
        total: 0, comptees: 0, aVenir: 0, comptessAVenir: 0, sansMontant: 0,
        pipelineTrouve: false, dansLePipeline: 0, horsEtape: 0,
        repartitionAVenir: [] as { name: string; value: number }[],
        horsPipelineMontant: 0, horsPipelineNb: 0,
        lignes: [] as LigneCa[],
        // On montre les noms réellement trouvés : si la règle ne reconnaît
        // pas le pipeline, autant voir tout de suite comment il s'appelle
        // plutôt que de chercher à l'aveugle.
        nomsConnus: pipelinesData.map((p) => p.name).slice(0, 6),
      };
    }

    // « Si on archive, on garde les montants dans le tableau de bord » : on
    // part donc de `allDeals`, qui contient les affaires archivees, au lieu
    // de `deals`, d'ou elles sont retirees pour le pipeline. Le filtre par
    // agence, lui, reste — chaque agence a son chiffre.
    // `matchesAgency` et non un `===` : la colonne agency_id porte encore,
    // sur beaucoup de fiches, un identifiant hérité (« immosphera »,
    // « agency-2 »...) au lieu de l'UUID. Toute l'application passe par cette
    // fonction ; ma comparaison brute écartait donc en silence les fiches
    // ImmoSphera les plus anciennes — c'est ce qui a fait disparaître les
    // 53 000 € signalés le 1er septembre.
    const perimetreAgence = allDeals.filter((d) => matchesAgency(d.agencyId, activeAgency.id));
    // « Le HT doit être en haut de la colonne, visible par Mélanie et Sylvain.
    // Le hors taxe des conseillers pourra être vu par seulement chaque
    // conseiller personnellement. » Le cercle « CA à venir » est visible par
    // tout le monde : un conseiller n'y voit donc que ses propres affaires.
    // (La tuile dorée, elle, n'est affichée qu'aux super admins.)
    const perimetre = isSuperAdmin
      ? perimetreAgence
      : perimetreAgence.filter((d) => d.advisorId && d.advisorId === currentUser?.uid);

    // Le pipeline d'une affaire se lit d'abord sur SON ÉTAPE, et seulement
    // ensuite sur la colonne pipeline_id du dossier.
    //
    // Signalé le 1er septembre : « j'ai facturé toute la colonne, plus de
    // 53 000 €, et ça ne remonte pas ». Le Pipeline affiche une affaire sans
    // pipeline_id dans le pipeline OUVERT (Pipeline.tsx : `deal.pipelineId ||
    // activePipeline.id`) : à l'écran elle est bien dans « Facturé », mais en
    // base elle n'a aucun pipeline. Le calcul, lui, écartait tout dossier
    // sans pipeline_id — et perdait donc exactement ces dossiers-là.
    // L'étape, elle, sait toujours à quel pipeline elle appartient.
    const pipelineParEtape = new Map<string, string>();
    stagesWithPosition.forEach((s) => { pipelineParEtape.set(s.id, s.pipeline_id); });

    // Demandé le 1er septembre : « mets le chiffre facturé, et tout ce qui
    // n'est pas encore facturé — donc archivé avec un prix confirmé — sera en
    // à venir ». Deux réalités comptables distinctes, deux chiffres :
    //   FACTURÉ  : la facture est émise (étape « Facturé »).
    //   À VENIR  : c'est gagné mais pas encore facturé — étape « À facturer »,
    //              ou dossier archivé avec un montant confirmé.
    // Les additionner donnerait un chiffre qui mélange le réalisé et le prévu.
    let total = 0;
    let aVenir = 0;
    let comptees = 0;
    let comptessAVenir = 0;
    let sansMontant = 0;
    let dansLePipeline = 0;
    let horsEtape = 0;
    // Répartition du « CA à venir » par colonne du pipeline, pour le cercle.
    const parEtapeAVenir = new Map<string, number>();
    // Diagnostic : un dossier archivé, avec un montant confirmé, mais qui
    // n'est rattaché à aucune étape de Transaction V2 (ni à ce pipeline)
    // ne peut pas entrer dans le chiffre d'affaires. Plutôt que de le perdre
    // en silence — ce qui a coûté plusieurs allers-retours — on l'affiche.
    let horsPipelineMontant = 0;
    let horsPipelineNb = 0;
    // Demandé le 2 septembre : « quand je clique dans la colonne chiffre
    // d'affaires d'agence, je voudrais un tableau avec le nom et prénom des
    // clients, le numéro de mandat et le chiffre, et pouvoir modifier le
    // chiffre de chaque ligne ». On garde donc le détail de ce qui a été
    // compté, ligne à ligne.
    const lignes: LigneCa[] = [];
    perimetre.forEach((d) => {
      const montant = Number(d.amount) || 0;
      const pipelineReel = (d.stageId && pipelineParEtape.get(d.stageId)) || d.pipelineId;
      if (!pipelineReel || !pipelinesVises.has(pipelineReel)) {
        if (d.archivedAt && montant > 0) { horsPipelineMontant += montant; horsPipelineNb += 1; }
        return;
      }
      dansLePipeline += 1;
      if (montant <= 0) {
        sansMontant += 1;
        lignes.push({
          id: d.id,
          nom: d.title,
          mandat: d.mandateNumber || '',
          montant: 0,
          etape: d.stage || '',
          archive: Boolean(d.archivedAt),
        });
        return;
      }

      // « Quand c'est archivé et confirmé sur la somme, cela ira dans le
      // chiffre d'affaires de l'agence » : l'archivage est donc le seul
      // passage entre les deux. Tant que le dossier vit dans le pipeline,
      // avec sa commission agence en HT, il est en « CA à venir ».
      lignes.push({
        id: d.id,
        nom: d.title,
        mandat: d.mandateNumber || '',
        montant,
        etape: d.stage || '',
        archive: Boolean(d.archivedAt),
      });
      if (d.archivedAt) { total += montant; comptees += 1; }
      else {
        aVenir += montant;
        comptessAVenir += 1;
        const etape = d.stage || 'Sans étape';
        parEtapeAVenir.set(etape, (parEtapeAVenir.get(etape) || 0) + montant);
      }
    });
    const repartitionAVenir = Array.from(parEtapeAVenir.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return {
      total, comptees, aVenir, comptessAVenir, sansMontant,
      pipelineTrouve: true, dansLePipeline, horsEtape, nomsConnus: [],
      repartitionAVenir, horsPipelineMontant, horsPipelineNb,
      // Archivés d'abord — c'est ce qui est déjà compté — puis par montant.
      lignes: lignes.sort(
        (a, b) => Number(b.archive) - Number(a.archive) || b.montant - a.montant || a.nom.localeCompare(b.nom, 'fr')
      ),
    };
  }, [allDeals, activeAgency.id, pipelinesData, stagesWithPosition, isSuperAdmin, currentUser?.uid]);


  // On ne considère que les agences réellement affichées (l'agence active,
  // ou toutes celles présentes dans les dossiers si "Toutes les agences" est
  // sélectionné) — sinon les pipelines par défaut d'autres sociétés (NovaVisio,
  // ImmoSphera...) viennent polluer les intitulés de colonnes affichés ici.
  const agencyIdsInScope = useMemo(() => {
    if (activeAgency.id !== 'all') return [activeAgency.id];
    return Array.from(new Set(deals.map((d) => d.agencyId)));
  }, [activeAgency.id, deals]);

  // Même règle que dans Pipeline.tsx : le pipeline par défaut est celui
  // choisi par l'utilisateur (bouton "Définir par défaut", stocké en
  // localStorage), sinon celui marqué is_default en base, sinon le premier.
  const defaultPipelineIdByAgency = useMemo(() => {
    const map = new Map<string, string>();
    agencyIdsInScope.forEach((agencyId) => {
      const agencyPipelines = pipelinesData.filter((p) => p.agency_id === agencyId);
      if (agencyPipelines.length === 0) return;
      const storedId = currentUser
        ? localStorage.getItem(`novasphere_default_pipeline_${currentUser.uid}_${agencyId}`)
        : null;
      const preferred =
        (storedId && agencyPipelines.find((p) => p.id === storedId)) ||
        agencyPipelines.find((p) => p.is_default) ||
        agencyPipelines[0];
      if (preferred) map.set(agencyId, preferred.id);
    });
    return map;
  }, [pipelinesData, currentUser, agencyIdsInScope]);

  const stageData = useMemo(() => {
    const defaultPipelineIds = new Set(defaultPipelineIdByAgency.values());

    const orderedStageDefs = stagesWithPosition
      .filter((s) => defaultPipelineIds.has(s.pipeline_id))
      .sort((a, b) => a.position - b.position);

    const amountByName = new Map<string, number>();
    orderedStageDefs.forEach((s) => {
      if (!amountByName.has(s.name)) amountByName.set(s.name, 0);
    });

    deals.forEach((d) => {
      // On ne compte que les dossiers réellement rattachés à une étape du
      // pipeline par défaut (les dossiers non assignés à une étape — repérés
      // seulement par leur "température" chaud/froid/tiède — ne sont pas de
      // vraies colonnes du pipeline et ne doivent pas y apparaître).
      if (!d.pipelineId || !defaultPipelineIds.has(d.pipelineId)) return;
      if (!amountByName.has(d.stage)) return;
      amountByName.set(d.stage, (amountByName.get(d.stage) || 0) + d.amount);
    });

    const seen = new Set<string>();
    const uniqueOrderedStages = orderedStageDefs.filter((s) => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });

    // Le graphique démarre à la colonne "Montage bancaire" (les étapes
    // amont type "Prise de contact" ne sont pas affichées ici) — le reste de
    // l'ordre du pipeline par défaut est conservé tel quel.
    const startIndex = uniqueOrderedStages.findIndex((s) => /montage\s*bancaire/i.test(s.name));
    const visibleStages = startIndex >= 0 ? uniqueOrderedStages.slice(startIndex) : uniqueOrderedStages;

    return visibleStages.map((s) => ({ name: s.name, value: amountByName.get(s.name) || 0 }));
  }, [deals, stagesWithPosition, defaultPipelineIdByAgency]);

  // 30/08/2026, "tout en bas c'est vert aussi, il faudrait tourner entre
  // gris, jaune noir et blanc" : l'ancienne palette (vert/orange/bleu/
  // indigo/rose) tranchait avec la charte gris anthracite/doré du reste de
  // l'appli — remplacée par un cycle gris / doré (#F7BC5F, même doré que
  // partout ailleurs) / anthracite ("noir") / gris très clair ("blanc",
  // légèrement décalé du blanc pur pour rester visible sur fond clair).
  const COLORS = ['#9aa1ab', '#F7BC5F', '#3d3d3d', '#e8e8e8'];

  const recentContacts = [...contacts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // ── Objectif du mois + montant facturé (demande explicite, 30/08/2026) ──
  // Table `monthly_goals` déjà présente en base (reprise de l'ancien CRM)
  // mais jamais reliée à aucune interface — remplace le badge "Objectif
  // trimestriel" figé (texte codé en dur à 78%, sans aucun lien avec de
  // vraies données) par un objectif MENSUEL réellement saisi et enregistré.
  const queryClient = useQueryClient();

  // Demandé le 2 septembre : « avec ça j'aurai une vue globale de ce qui a
  // été validé, pour pallier aux éventuelles erreurs ». Le détail du chiffre
  // d'affaires s'ouvre au clic sur la tuile, et chaque montant s'y corrige :
  // c'est la même colonne (leads.estimated_value) que partout ailleurs, donc
  // la correction se répercute immédiatement sur le Tableau de bord.
  // Demandé le 2 septembre : « sépare le tableau — le chiffre déjà réalisé
  // d'un côté, le CA à venir de l'autre, pour ne pas tout avoir en même temps
  // sur le même tableau ». Une seule fenêtre, deux contenus : la tuile dorée
  // ouvre le réalisé, le cercle ouvre l'à-venir.
  const [detailCa, setDetailCa] = useState<'realise' | 'avenir' | null>(null);
  const [montantsSaisis, setMontantsSaisis] = useState<Record<string, string>>({});
  const [ligneEnCours, setLigneEnCours] = useState<string | null>(null);

  const enregistrerMontantLigne = async (ligne: LigneCa) => {
    const brut = montantsSaisis[ligne.id];
    if (brut === undefined) return;
    const saisi = brut.trim().replace(',', '.');
    if (saisi === '') { setMontantsSaisis((v) => { const c = { ...v }; delete c[ligne.id]; return c; }); return; }
    const montant = Number(saisi);
    if (!Number.isFinite(montant) || montant < 0) {
      toast.error("Ce montant n'est pas un nombre valide.");
      return;
    }
    if (montant === ligne.montant) { setMontantsSaisis((v) => { const c = { ...v }; delete c[ligne.id]; return c; }); return; }
    setLigneEnCours(ligne.id);
    const { error } = await supabase
      .from('leads')
      .update({ estimated_value: montant } as any)
      .eq('id', ligne.id);
    setLigneEnCours(null);
    if (error) { toast.error(error.message); return; }
    setMontantsSaisis((v) => { const c = { ...v }; delete c[ligne.id]; return c; });
    queryClient.invalidateQueries({ queryKey: ['deals'] });
    queryClient.invalidateQueries({ queryKey: ['contacts_all'] });
    toast.success(`Montant mis à jour : ${formatCurrency(montant)}`);
  };
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const prevMonthDate = new Date(currentYear, now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.getMonth() + 1;
  const prevYear = prevMonthDate.getFullYear();
  // Un objectif est propre à UNE agence — pas de valeur unique cohérente
  // quand "Toutes les agences" est sélectionné.
  const goalAgencyId = activeAgency.id !== 'all' ? activeAgency.id : null;

  const { data: monthlyGoal } = useQuery({
    queryKey: ['monthly-goal', goalAgencyId, currentMonth, currentYear],
    enabled: !!goalAgencyId,
    queryFn: async () => {
      const { data } = await supabase
        .from('monthly_goals' as any)
        .select('id, target_amount')
        .eq('agency_id', goalAgencyId as string)
        .eq('month', currentMonth)
        .eq('year', currentYear)
        .maybeSingle();
      return data as { id: string; target_amount: number } | null;
    },
  });

  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  const saveGoal = async () => {
    const amount = parseFloat(goalInput.replace(/\s/g, '').replace(',', '.'));
    if (!goalAgencyId || Number.isNaN(amount) || amount < 0) return;
    setSavingGoal(true);
    try {
      await supabase.from('monthly_goals' as any).upsert(
        { agency_id: goalAgencyId, month: currentMonth, year: currentYear, target_amount: amount },
        { onConflict: 'agency_id,month,year' }
      );
      await queryClient.invalidateQueries({ queryKey: ['monthly-goal', goalAgencyId, currentMonth, currentYear] });
      setEditingGoal(false);
    } finally {
      setSavingGoal(false);
    }
  };

  // "Dossier signé" = étape dont le nom contient "signat" (couvre toutes
  // les variantes observées selon l'agence/pipeline : SIGNATURE, SIGNATURE
  // ACTE, Signature compromis, Signature de l'acte, SIGNATURE NOTAIRE...).
  // Faute d'un horodatage dédié "date de signature" en base, `updatedAt`
  // (dernière modification du dossier) sert de meilleure approximation
  // disponible du mois de signature — à affiner si une vraie date de
  // signature est ajoutée un jour.
  const billedForMonth = (month: number, year: number) =>
    deals.reduce((sum, d) => {
      if (!/signat/i.test(d.stage) || !d.updatedAt) return sum;
      const dt = new Date(d.updatedAt);
      if (dt.getMonth() + 1 !== month || dt.getFullYear() !== year) return sum;
      return sum + d.amount;
    }, 0);

  const billedThisMonth = useMemo(() => billedForMonth(currentMonth, currentYear), [deals, currentMonth, currentYear]);
  const billedPrevMonth = useMemo(() => billedForMonth(prevMonth, prevYear), [deals, prevMonth, prevYear]);
  const billedDelta = billedThisMonth - billedPrevMonth;
  const goalPercent = monthlyGoal && monthlyGoal.target_amount > 0
    ? Math.round((billedThisMonth / monthlyGoal.target_amount) * 100)
    : null;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header section (30/08/2026, demande explicite : "supprime le
          panneau tableau de bord et centre les objectifs à la place, avec
          un fond gris classique") — le panneau titre "Tableau de bord"
          retiré, l'objectif du mois centré à sa place.
          Revu (30/08/2026, "mets ce gris que tu as dans le panneau des
          priorités accueil dans le tableau de bord") : bg-slate-700 (essai
          initial) remplacé par le même gris anthracite à 80% + liseré noir
          fin que le panneau Priorités de l'accueil (voir AccueilGrid.tsx),
          pour une teinte cohérente entre les deux écrans. */}
      <div className="flex justify-center">
        <div className="bg-[#2b2b2b]/80 border border-black/60 px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-[#F9C977]">
          <Sparkles className="w-4 h-4 text-[#F7BC5F] shrink-0" />
          {editingGoal ? (
            <>
              <span className="text-slate-300">Objectif du mois :</span>
              <input
                type="number"
                min="0"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Montant en €"
                autoFocus
                className="w-28 px-2 py-1 rounded-lg bg-[#07191b] border border-[#1b4b4e] text-white text-xs focus:outline-none focus:border-[#F7BC5F]"
                onKeyDown={(e) => { if (e.key === 'Enter') void saveGoal(); if (e.key === 'Escape') setEditingGoal(false); }}
              />
              <button
                onClick={() => void saveGoal()}
                disabled={savingGoal}
                className="px-2.5 py-1 rounded-lg bg-[#F7BC5F] text-slate-950 font-bold disabled:opacity-60"
              >
                {savingGoal ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button onClick={() => setEditingGoal(false)} className="text-slate-400 hover:text-white">Annuler</button>
            </>
          ) : (
            <>
              <span>
                Objectif du mois : <b>{monthlyGoal ? formatCurrency(monthlyGoal.target_amount) : 'non défini'}</b>
                {' · '}Facturé : <b>{formatCurrency(billedThisMonth)}</b>
                {goalPercent !== null && ` (${goalPercent}%)`}
              </span>
              <span className={`flex items-center gap-1 font-semibold ${billedDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {billedDelta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {billedDelta >= 0 ? '+' : ''}{formatCurrency(billedDelta)} vs mois dernier
              </span>
              {goalAgencyId ? (
                <button
                  onClick={() => { setGoalInput(monthlyGoal ? String(monthlyGoal.target_amount) : ''); setEditingGoal(true); }}
                  className="flex items-center gap-1 text-slate-400 hover:text-white"
                  title="Définir l'objectif du mois"
                >
                  <Pencil className="w-3 h-3" /> Modifier
                </button>
              ) : (
                <span className="text-slate-500">(sélectionnez une agence pour définir un objectif)</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 - Prospects (Deep Teal theme) */}
        <div className="dash-card p-6 rounded-2xl border border-teal-500/25 hover:border-teal-500/40 shadow-lg hover:shadow-teal-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Prospects & Clients</span>
            <div className="text-3xl font-black text-white tracking-tight">{totalContacts}</div>
            <button 
              onClick={() => onNavigate('clients')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Gérer les contacts <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-400 group-hover:scale-105 transition-transform">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 2 - Dossiers Actifs (Deep Amber theme) */}
        <div className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/25 hover:border-[#F7BC5F]/40 shadow-lg hover:shadow-[#F7BC5F]/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Dossiers actifs</span>
            <div className="text-3xl font-black text-white tracking-tight">{activeDeals}</div>
            <button 
              onClick={() => onNavigate('pipeline')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Voir le pipeline <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977] group-hover:scale-105 transition-transform">
            <Briefcase className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 3 - Volume Financier (Deep Emerald theme) */}
        <div className="dash-card p-6 rounded-2xl border border-emerald-500/25 hover:border-emerald-500/40 shadow-lg hover:shadow-emerald-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Volume financier</span>
            <div className="text-2xl font-black text-emerald-400 tracking-tight">{formatCurrency(totalDealValue)}</div>
            <span className="text-[11px] text-emerald-400/90 font-semibold tracking-wide block">Encours total sécurisé</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
            <Coins className="w-6 h-6" />
          </div>
        </div>

        {/* Ticket #34 — Chiffre d'affaires de l'agence, super admins seulement.
            Pipeline « Transaction V2 », montants HT (commission agence).
            Y entrent les dossiers ARCHIVÉS dont le montant a été confirmé au
            moment de l'archivage : « quand c'est archivé et confirmé sur la
            somme, cela ira dans le chiffre d'affaires de l'agence ». */}
        {isSuperAdmin && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('realise')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('realise'); } }}
            title="Voir le détail des affaires comptabilisées, ligne par ligne"
            className="dash-card p-6 rounded-2xl border border-[#F7BC5F]/30 hover:border-[#F7BC5F]/50 shadow-lg transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group cursor-pointer text-left">
            <div className="space-y-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">Chiffre d'affaires de l'agence</span>
              <div className="text-2xl font-black text-[#F9C977] tracking-tight">
                {formatCurrency(chiffreAffairesAgence.total)}
              </div>
              {/* Une tuile qui affiche zéro sans dire pourquoi fait perdre une
                  soirée. Elle explique donc ce qu'elle a trouvé, et où ça
                  bloque : le pipeline, l'étape, ou le montant. */}
              <span className="text-[11px] text-slate-400 font-semibold tracking-wide block">
                {!chiffreAffairesAgence.pipelineTrouve ? (
                  <span className="text-amber-400/90">
                    Aucun pipeline dont le nom contient « transaction » et « v2 »
                    {chiffreAffairesAgence.nomsConnus.length > 0 && (
                      <span className="text-slate-500 font-normal block mt-0.5">
                        Trouvés : {chiffreAffairesAgence.nomsConnus.join(', ')}
                      </span>
                    )}
                  </span>
                ) : (
                  <>
                    {chiffreAffairesAgence.comptees} affaire{chiffreAffairesAgence.comptees > 1 ? 's' : ''} archivée{chiffreAffairesAgence.comptees > 1 ? 's' : ''} et confirmée{chiffreAffairesAgence.comptees > 1 ? 's' : ''}
                    {chiffreAffairesAgence.sansMontant > 0 && (
                      <span className="text-amber-400/90">
                        {' '}· {chiffreAffairesAgence.sansMontant} sans HT
                      </span>
                    )}
                    {/* La ligne ne s'affichait qu'à zéro. Signalé le 1er
                        septembre : « 6 500 €, 3 affaires — mais où sont tous
                        les dossiers que j'ai archivés ? ». Le compte rendu est
                        donc permanent : on voit d'un coup d'œil combien de
                        dossiers sont dans le pipeline, et pourquoi les autres
                        ne comptent pas. */}
                    <span className="text-slate-500 font-normal block mt-0.5">
                      {chiffreAffairesAgence.dansLePipeline === 0
                        ? 'Aucune affaire dans ce pipeline'
                        : `sur ${chiffreAffairesAgence.dansLePipeline} dans Transaction V2`}
                      {chiffreAffairesAgence.sansMontant > 0 && ` · ${chiffreAffairesAgence.sansMontant} sans montant HT`}
                    </span>
                    {/* Dossier archivé, montant confirmé, mais rattaché à
                        aucune étape de Transaction V2 : il ne peut pas entrer
                        dans le chiffre d'affaires. On le dit, au lieu de le
                        perdre en silence. */}
                    {chiffreAffairesAgence.horsPipelineNb > 0 && (
                      <span className="text-amber-400/90 font-normal block mt-0.5">
                        {chiffreAffairesAgence.horsPipelineNb} archivée{chiffreAffairesAgence.horsPipelineNb > 1 ? 's' : ''} hors Transaction V2 : {formatCurrency(chiffreAffairesAgence.horsPipelineMontant)}
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 flex items-center justify-center text-[#F9C977] group-hover:scale-105 transition-transform">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* Metric 4 - Tâches en Attente (Deep Slate-Indigo theme) */}
        <div className="dash-card p-6 rounded-2xl border border-indigo-500/25 hover:border-indigo-500/40 shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Tâches en attente</span>
            <div className="text-3xl font-black text-white tracking-tight">{pendingTasks}</div>
            <button 
              onClick={() => onNavigate('rappels')} 
              className="text-[11px] text-[#F9C977] font-bold hover:text-[#FAD592] inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Traiter les tâches <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Visualizer charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stages Chart */}
        <div className="dash-card lg:col-span-2 p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="font-bold text-sm text-white">Répartition du Volume par Étape (€)</h3>
            <p className="text-xs text-slate-400">Total des opportunités financières valorisées dans le pipeline.</p>
          </div>
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageData}>
                <XAxis
                  dataKey="name"
                  stroke="var(--nv-chart-axis)"
                  tickLine={false}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                  tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                />
                <YAxis stroke="var(--nv-chart-axis)" tickLine={false} width={45} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip
                  formatter={(value: unknown) => [formatCurrency(Number(value) || 0), 'Volume']}
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--ink-2)' }}
                  itemStyle={{ color: 'var(--ink-1)' }}
                  cursor={{ fill: 'var(--nv-wash)' }}
                />
                <Bar
                  dataKey="value"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                  cursor={onNavigateToStage ? 'pointer' : undefined}
                  onClick={(entry: { name?: string }) => {
                    if (entry?.name && onNavigateToStage) {
                      onNavigateToStage(entry.name);
                    } else {
                      onNavigate('pipeline');
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Demandé le 1er septembre : « le cercle doit être CA à venir — tout
            ce qui est en HT commission agence doit être là, avant le à
            facturer ; quand c'est archivé et confirmé sur la somme, cela ira
            dans le chiffre d'affaires de l'agence ». Le cercle montre donc
            l'argent encore dans Transaction V2 (non archivé), réparti par
            colonne ; la tuile dorée, elle, montre le réalisé. */}
        <div className="dash-card p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-sm text-white">CA à venir</h3>
            <p className="text-xs text-slate-400">Commission agence HT encore dans Transaction V2, par colonne.</p>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailCa('avenir')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCa('avenir'); } }}
            title="Voir le détail des affaires à venir, ligne par ligne"
            className="h-48 w-full flex items-center justify-center relative cursor-pointer"
          >
            {chiffreAffairesAgence.repartitionAVenir.length === 0 ? (
              <span className="text-xs text-slate-500 text-center px-4">
                Aucun montant HT en attente dans Transaction V2
              </span>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chiffreAffairesAgence.repartitionAVenir}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {chiffreAffairesAgence.repartitionAVenir.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(127,127,127,0.4)" strokeWidth={1} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: unknown) => [formatCurrency(Number(value) || 0), '']}
                    contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: '11px' }}
                    labelStyle={{ color: 'var(--ink-2)' }}
                    itemStyle={{ color: 'var(--ink-1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {chiffreAffairesAgence.repartitionAVenir.length > 0 && (
              <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">À venir</span>
                <span className="text-sm font-black text-white">{formatCurrency(chiffreAffairesAgence.aVenir)}</span>
                <span className="text-[10px] text-slate-500">
                  {chiffreAffairesAgence.comptessAVenir} affaire{chiffreAffairesAgence.comptessAVenir > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-1 text-[11px]">
            {chiffreAffairesAgence.repartitionAVenir.map((entry, idx) => (
              <div key={entry.name} className="flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                  <span>{entry.name}</span>
                </div>
                <span className="font-semibold text-white">{formatCurrency(entry.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recents list and Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Contacts List */}
        <div className="dash-card lg:col-span-2 p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 space-y-4">
          <div>
            <h3 className="font-bold text-sm text-white">Prospects Récemment Enregistrés</h3>
            <p className="text-xs text-slate-400">Derniers dossiers ajoutés pour attribution ou qualification.</p>
          </div>
          {recentContacts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-[#144447]/40 rounded-xl">
              Aucun prospect enregistré. Cliquez sur "Clients & Leads" pour ajouter votre premier dossier.
            </div>
          ) : (
            <div className="divide-y divide-[#144447]/30">
              {recentContacts.map(c => {
                const agency = AGENCIES.find(a => a.id === c.agencyId);
                return (
                  <div key={c.id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 font-bold text-xs uppercase">
                        {c.name.substring(0, 2)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{c.name}</div>
                        <div className="text-[10px] text-slate-400">{c.email} • {c.phone}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-black/40 border border-[#144447]/60 text-[9px] font-semibold text-slate-300">
                        {agency?.name || 'Inconnue'}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase ${
                        c.status === 'Converti' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' :
                        c.status === 'Nouveau' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25' :
                        'bg-[#F7BC5F]/10 text-[#F9C977] border border-[#F7BC5F]/25'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="dash-card p-6 rounded-2xl border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#F9C977] font-bold text-xs uppercase tracking-wider mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Actualités Immobilières</span>
            </div>
            <h3 className="font-extrabold text-base text-white">Taux d'Intérêt du Moment</h3>
            <p className="text-xs text-slate-400 leading-relaxed mt-1">
              Les taux d'intérêt moyens sur 20 ans se stabilisent à <strong>3.65%</strong> en ce mois d'août 2026. Profitez-en pour relancer vos prospects "Proposition" et revoir leurs capacités de financement.
            </p>
          </div>

          <div className="pt-4 border-t border-[#144447]/40 text-xs text-slate-300 space-y-2">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-[#F7BC5F]" />
              <span>Capacité moyenne : 240,000 €</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#F7BC5F]" />
              <span>Délai d'accord : 14 jours ouvrés</span>
            </div>
          </div>
        </div>
      </div>

      {/* Demandé le 2 septembre : « quand je clique dans la colonne chiffre
          d'affaires d'agence, je voudrais un tableau avec le nom et prénom
          des clients, s'il faut le numéro de mandat, et le chiffre — et que
          je puisse modifier le chiffre de chaque ligne, ce qui aura
          l'incidence en positif ou négatif sur le tableau de bord ». Le
          montant modifié ici est écrit dans la même colonne que partout
          ailleurs (leads.estimated_value) : le total se recalcule aussitôt. */}
      {detailCa && (() => {
        const realise = detailCa === 'realise';
        const lignesVisibles = chiffreAffairesAgence.lignes.filter((l) => l.archive === realise);
        const totalVisible = lignesVisibles.reduce((somme, l) => somme + l.montant, 0);
        return (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDetailCa(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl bg-[#07191b] border border-[#1b4e52] shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 p-5 border-b border-[#144447]/60">
              <div>
                <h3 className="text-base font-bold text-white">
                  {realise ? "Chiffre d'affaires réalisé" : 'CA à venir'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Transaction V2 · {lignesVisibles.length} dossier{lignesVisibles.length > 1 ? 's' : ''} ·{' '}
                  {formatCurrency(totalVisible)}
                  {realise ? ' comptabilisés' : ' en attente de facturation'}
                </p>
              </div>
              <button
                onClick={() => setDetailCa(null)}
                className="text-slate-500 hover:text-white text-xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-3 px-5 py-2 text-[10px] uppercase tracking-widest text-slate-500 border-b border-[#144447]/40">
              <span className="flex-1">Client</span>
              <span className="w-28 hidden sm:block">Mandat</span>
              <span className="w-32 text-right">Montant</span>
            </div>

            <div className="overflow-y-auto custom-scrollbar divide-y divide-[#144447]/40">
              {lignesVisibles.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">
                  {realise
                    ? 'Aucun dossier archivé avec un montant confirmé pour le moment.'
                    : 'Aucun dossier en attente dans Transaction V2.'}
                </p>
              ) : (
                lignesVisibles.map((ligne) => (
                  <div key={ligne.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-semibold truncate">{ligne.nom}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {ligne.etape || 'Sans étape'}
                        {ligne.mandat && <span className="sm:hidden"> · Mandat {ligne.mandat}</span>}
                      </div>
                    </div>
                    <span className="w-28 hidden sm:block text-xs text-slate-400 truncate">
                      {ligne.mandat || '—'}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={montantsSaisis[ligne.id] ?? (ligne.montant ? String(ligne.montant) : '')}
                      onChange={(e) => setMontantsSaisis((v) => ({ ...v, [ligne.id]: e.target.value }))}
                      onBlur={() => void enregistrerMontantLigne(ligne)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      disabled={ligneEnCours === ligne.id}
                      placeholder="0"
                      className={`w-32 px-2 py-1.5 rounded-lg bg-[#0a1e20] border text-right text-sm tabular-nums focus:outline-none focus:border-[#F7BC5F]/60 disabled:opacity-50 ${
                        montantsSaisis[ligne.id] !== undefined
                          ? 'border-[#F7BC5F]/60 text-[#F9C977]'
                          : 'border-[#144447]/60 text-white'
                      }`}
                    />
                  </div>
                ))
              )}
            </div>

            <p className="px-5 py-3 text-[11px] text-slate-500 border-t border-[#144447]/60 leading-relaxed">
              Le montant se corrige directement dans la ligne : il est enregistré en quittant le
              champ (ou avec la touche Entrée), et le chiffre se met à jour aussitôt.
              {realise
                ? " Ces dossiers sont archivés, montant confirmé : ils comptent dans le chiffre d'affaires de l'agence."
                : " Ces dossiers sont encore dans le pipeline : ils basculeront dans le chiffre d'affaires une fois archivés et le montant confirmé."}
            </p>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
