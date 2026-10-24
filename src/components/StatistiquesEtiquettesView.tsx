import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID, IMMOSPHERA_AGENCY_ID } from './TransactionChecklistModal';

// Demandé le 6 septembre : « chaque utilisateur pourra voir son propre
// chiffre d'affaires mais pas celui des autres [...] verrouiller les
// montants pour éviter des tensions inutiles dans l'agence ». La direction
// (super admin / admin) garde la vue complète, comme pour Conseils
// Finances ; un agent simple ne voit plus que sa propre ligne, son propre
// classement d'étape et ses propres dossiers dans les listes de détail.

// Demande explicite (28/08/2026) : "tuile statistique" façon "tableau à
// l'ancienne" — panneau d'étiquettes en cuivre/laiton (référence photo
// fournie : casier à étiquettes vintage), une rangée par agent ImmoSphera,
// une étiquette-compteur par étape ("Offre d'achat" / "Signature compromis"
// / "signature acte authentique" du pipeline "Transactions V2"), un "Total"
// par agent tout à droite. Données réelles du pipeline (jamais saisies à la
// main), rafraîchies à chaque ouverture. Personnalisation demandée : couleur
// de chaque étiquette au choix, et étiquettes/rangées déplaçables — ici,
// réordonnancement des rangées agent par glisser-déposer (dnd-kit, même
// librairie que AccueilGrid/Pipeline), mémorisé par utilisateur en
// localStorage. Modifier les DONNÉES du pipeline depuis ce tableau n'a pas
// été demandé et casserait la fiabilité des statistiques — uniquement
// l'ORDRE d'affichage et la couleur sont personnalisables.
//
// Retouche demandée ensuite : pas de montant en euros (retiré), design plus
// soigné pour les étiquettes Offre/Compromis/Signature (mini-libellé sous le
// nombre), l'agent identifié par un cachet rond avec la seule initiale de
// son NOM DE FAMILLE (plus de nom en toutes lettres), et le "Total agence"
// recentré au milieu du panneau plutôt qu'en pleine largeur comme les
// rangées agent.


const LABEL_COLORS = [
  { name: 'Ivoire (défaut)', value: '#F3EAD3' },
  { name: 'Vert bouteille', value: '#DCEEDD' },
  { name: 'Bleu poudré', value: '#DCE6F3' },
  { name: 'Corail', value: '#F5D9CE' },
  { name: 'Lavande', value: '#E6DCF3' },
  { name: 'Or pâle', value: '#F3EAC0' },
];

// « Location » vient en tête : l'ordre demandé est location, offre d'achat,
// compromis, acte authentique.
// Demandé le 2 septembre : « on va rajouter une colonne Conciergerie » —
// après Locations, Offre, Compromis et Signature acte authentique. Elle est
// alimentée par l'étape du pipeline dont le nom contient « concierg » : tant
// que cette colonne n'existe pas dans Transactions V2, la statistique affiche
// simplement 0, sans casser le reste du tableau.
type StageKey = 'location' | 'offre' | 'compromis' | 'signature' | 'conciergerie';

interface StageLead {
  id: string;
  name: string;
  agentId: string;
  stage: StageKey;
  honoraires: number;
  ville: string;
  mandat: string;
  referrerId: string | null;
}

// Classement par apporteur d'affaires (6 septembre) : « l'agent immobilier
// nous envoie un client » — combien de dossiers Conciergerie chaque
// référent a apportés, et le chiffre d'affaires correspondant. Une
// information de pilotage d'agence, pas un revenu personnel d'un
// collègue : elle n'est PAS soumise au verrouillage « mes stats
// uniquement » (estDirection/monAgentId) qui protège le classement par
// conseiller.
interface ReferrerRow {
  referrerId: string | null;
  name: string;
  agencyName?: string;
  count: number;
  ca: number;
}

interface AgentRow {
  agentId: string;
  agentDisplay: string;
  agentFullName: string;
  location: number;
  offre: number;
  compromis: number;
  signature: number;
  conciergerie: number;
  total: number;
  // Demandé : le chiffre d'affaires de chaque conseiller sur chacune des
  // trois étapes. Source : le champ « Honoraires (€) » de la fiche client
  // (colonne `estimated_value`), c'est-à-dire ce que l'agence encaisse —
  // et non le budget, qui est le prix du bien.
  caLocation: number;
  caOffre: number;
  caCompromis: number;
  caSignature: number;
  caConciergerie: number;
}

// Demande explicite : "mets le prénom par exemple Isabelle G, c'est comme ça
// que cela doit se mettre" — prénom entier + initiale du nom de famille
// (convention du reste du CRM : "Prénom Nom").
const firstNamePlusInitial = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fullName || 'Agent';
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = (parts[parts.length - 1].charAt(0) || '').toUpperCase();
  return lastInitial ? `${first} ${lastInitial}` : first;
};

// Seuls les conseillers commerciaux qui réalisent des ventes figurent au tableau.
// La direction (Sylvain, Mélanie), la communication (Sarah) et les membres sans
// ventes en sont exclus (demande explicite : « supprime les 4 car ils ne vendent pas »).
const NON_VENDEURS_IDS = new Set([
  '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29', // Sylvain Grazia
  '15bcec53-de3e-40b8-8b7e-bb6874836f29', // Mélanie Grazia
  '3fd7bce8-cdd5-471c-96df-67c10a55d4b6', // Sarah Combres
]);

const estNonVendeur = (fullName: string, id: string): boolean => {
  if (NON_VENDEURS_IDS.has(id)) return true;
  const nom = (fullName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (
    nom.includes('sylvain') ||
    nom.includes('melanie') ||
    nom.includes('sarah') ||
    nom.includes('muriel') ||
    nom.includes('adrien')
  );
};

// Une "étiquette" laiton — reprend le style de la photo de référence :
// cadre doré à rivets, plaquette arrondie, petite languette débordante en
// bas, et désormais un mini-libellé sous le nombre pour identifier l'étape
// d'un coup d'œil sans remonter à l'en-tête. `count` de 0 s'affiche grisée
// (agent sans dossier sur cette étape, mais on ne le masque pas — il reste
// visible dans le tableau).
const STAGE_CHIP_STYLES: Record<string, { active: string; text: string; bg: string; border: string }> = {
  location: {
    active: 'text-sky-200 bg-sky-500/20 border-sky-400/50 shadow-[0_0_15px_rgba(14,165,233,0.3)]',
    text: 'text-sky-300',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/25',
  },
  offre: {
    active: 'text-amber-200 bg-amber-500/20 border-amber-400/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]',
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/25',
  },
  compromis: {
    active: 'text-emerald-200 bg-emerald-500/20 border-emerald-400/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/25',
  },
  signature: {
    active: 'text-[#FAD592] bg-gradient-to-r from-amber-500/25 to-[#F7BC5F]/30 border-[#F7BC5F]/60 shadow-[0_0_18px_rgba(247,188,95,0.35)] ring-1 ring-[#F7BC5F]/40',
    text: 'text-[#F7BC5F]',
    bg: 'bg-[#F7BC5F]/10',
    border: 'border-[#F7BC5F]/30',
  },
  conciergerie: {
    active: 'text-purple-200 bg-purple-500/20 border-purple-400/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]',
    text: 'text-purple-300',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/25',
  },
};

const StatChip: React.FC<{
  count: number;
  stageKey: string;
  caption: string;
  onClick?: () => void;
}> = ({ count, stageKey, caption, onClick }) => {
  const isPositive = count > 0;
  const style = STAGE_CHIP_STYLES[stageKey] || STAGE_CHIP_STYLES.location;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || count === 0}
      title={count > 0 ? `Voir les dossiers concernés (${count})` : undefined}
      className={`rounded-2xl border px-3 sm:px-4 py-2 text-center min-w-[4.6rem] sm:min-w-[5.2rem] transition-all duration-200 ${
        isPositive
          ? `${style.active} hover:scale-105 cursor-pointer shadow-md`
          : 'border-white/5 bg-white/[0.02] text-slate-500 opacity-60 cursor-default'
      }`}
    >
      <div className={`text-base sm:text-lg font-black tabular-nums leading-none ${isPositive ? 'text-white' : 'text-slate-500'}`}>
        {count}
      </div>
      <div className={`text-[9px] uppercase font-bold tracking-wider mt-1.5 ${isPositive ? style.text : 'text-slate-600'}`}>
        {caption}
      </div>
    </button>
  );
};

const AgentSeal: React.FC<{ display: string; fullName: string }> = ({ display, fullName }) => {
  const initials = display.slice(0, 2).toUpperCase();
  return (
    <div
      className="relative shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-white/[0.04] border border-white/10 shadow-sm min-w-[7rem] sm:min-w-[8.5rem]"
      title={fullName}
    >
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#F7BC5F]/30 to-[#F7BC5F]/10 border border-[#F7BC5F]/40 text-[#FAD592] text-xs font-black flex items-center justify-center shrink-0 shadow-inner">
        {initials}
      </div>
      <span className="text-xs sm:text-sm font-bold text-white truncate">{display}</span>
    </div>
  );
};

const AgentRow: React.FC<{ row: AgentRow; color: string; onOpen?: (stage: StageKey) => void }> = ({ row, onOpen }) => (
  <div className="flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] via-white/[0.01] to-black/30 p-3 sm:p-4 backdrop-blur-md hover:border-white/20 transition-all shadow-sm">
    <div className="w-full md:w-auto flex items-center justify-between md:justify-start gap-3">
      <AgentSeal display={row.agentDisplay} fullName={row.agentFullName} />
      <div className="md:hidden">
        <div className="rounded-xl border border-[#F7BC5F]/30 bg-[#F7BC5F]/15 px-3 py-1.5 text-center">
          <span className="text-sm font-black text-[#FAD592] tabular-nums">{row.total}</span>
        </div>
      </div>
    </div>

    <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto max-w-full pb-1 md:pb-0 custom-scrollbar justify-center flex-1">
      <StatChip count={row.location} stageKey="location" caption="Location" onClick={onOpen && (() => onOpen('location'))} />
      <StatChip count={row.offre} stageKey="offre" caption="Offre" onClick={onOpen && (() => onOpen('offre'))} />
      <StatChip count={row.compromis} stageKey="compromis" caption="Compromis" onClick={onOpen && (() => onOpen('compromis'))} />
      <StatChip count={row.signature} stageKey="signature" caption="Signature" onClick={onOpen && (() => onOpen('signature'))} />
      <StatChip count={row.conciergerie} stageKey="conciergerie" caption="Conciergerie" onClick={onOpen && (() => onOpen('conciergerie'))} />
    </div>

    <div className="hidden md:flex items-center gap-3 shrink-0">
      <div className="rounded-2xl border border-[#F7BC5F]/40 bg-gradient-to-br from-[#F7BC5F]/20 to-[#F7BC5F]/5 px-4 py-2 text-center min-w-[3rem] shadow-[0_0_15px_rgba(247,188,95,0.2)]">
        <span className="text-sm sm:text-base font-black text-[#FAD592] tabular-nums">{row.total}</span>
      </div>
    </div>
  </div>
);

const StatistiquesEtiquettesView: React.FC<{ onSelectContact?: (contactId: string) => void }> = ({ onSelectContact }) => {
  const { currentUser, userProfile } = useAuth();
  const estDirection = userProfile?.role === 'super_admin' || userProfile?.role === 'admin';
  const monAgentId = currentUser?.uid;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgentRow[]>([]);
  // Demandé : « savoir qui est présent dans cette case ». On garde le détail
  // des dossiers (nom + conseiller + étape) pour pouvoir les lister au clic
  // sur un chiffre, et ouvrir la fiche depuis la liste.
  const [details, setDetails] = useState<StageLead[]>([]);
  const [detailFor, setDetailFor] = useState<{ stage: StageKey; agentId: string | null; title: string } | null>(null);
  // Classement par apporteur d'affaires (Conciergerie uniquement) : id ->
  // nom/agence du référent, pour afficher le classement sans exposer les
  // uuid bruts.
  const [referrerById, setReferrerById] = useState<Record<string, { name: string; agencyName?: string }>>({});


  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Étapes du pipeline "Transactions V2" retenues pour ce tableau.
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .eq('pipeline_id', IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID);

      // Nom repéré par motif plutôt qu'à l'identique : l'étape a été créée
      // « Locations validées », et rien ne garantit la casse ni le pluriel.
      const locationStageId = (stages || []).find((s: any) => /location/i.test(s.name))?.id;
      const offreStageId = (stages || []).find((s: any) => s.name === "Offre d'achat")?.id;
      const compromisStageId = (stages || []).find((s: any) => s.name === 'Signature compromis')?.id;
      const signatureStageId = (stages || []).find((s: any) => s.name === 'signature acte authentique')?.id;
      // Repérée par motif, comme « Locations » : la colonne peut s'appeler
      // « Conciergerie », « Conciergeries »... la casse n'est pas garantie.
      const conciergerieStageId = (stages || []).find((s: any) => /concierg/i.test(s.name))?.id;
      // Les colonnes de fin de parcours (« À facturer », « Facturé ») : un
      // dossier qui y arrive a bel et bien été réalisé, il ne doit pas
      // disparaître des statistiques pour autant.
      const aFacturerStageIds = new Set(
        (stages || []).filter((st: any) => /factur/i.test(st.name)).map((st: any) => st.id as string)
      );

      const { data: leads } = await supabase
        .from('leads')
        // `*` : la corbeille (deleted_at, 3 septembre) doit être lue pour
        // être écartée des statistiques.
        .select('*')
        .eq('pipeline_id', IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID)
        .eq('agency_id', IMMOSPHERA_AGENCY_ID);

      // Signalé : "statistique n'est pas relié à pipeline transaction V2 car
      // j'ai un dossier dans offre et je n'ai rien dans statistique" —
      // `leads.assigned_to` (agent assigné) est vide sur TOUS les dossiers
      // actuels de ce pipeline, alors que `created_by` (agent qui a créé le
      // dossier) est, lui, toujours renseigné. On utilise donc `assigned_to`
      // en priorité quand il existe, sinon `created_by` comme agent de
      // référence de la carte.
      // Signalé le 2 septembre : « je n'ai plus les locations de Clémence qui
      // remontent dans les stats, ni les signatures ». Un dossier ne comptait
      // que s'il était POSÉ, à l'instant, sur l'une des étapes suivies et
      // non archivé. Or un dossier abouti part en « À facturer » puis à
      // l'archivage : il sortait donc des statistiques au moment précis où il
      // était enfin réalisé. Un dossier réalisé reste compté là où il a
      // abouti — repéré par son type (Location, Conciergerie) ou par sa
      // signature pour l'acte authentique.
      const etapeDe = (l: any): StageKey | null => {
        if (l.stage_id === locationStageId) return 'location';
        if (l.stage_id === offreStageId) return 'offre';
        if (l.stage_id === compromisStageId) return 'compromis';
        if (l.stage_id === signatureStageId) return 'signature';
        if (conciergerieStageId && l.stage_id === conciergerieStageId) return 'conciergerie';
        if (aFacturerStageIds.has(l.stage_id) || l.archived_at) {
          const type = String(l.lead_type || '').toLowerCase();
          if (/concierg/.test(type)) return 'conciergerie';
          if (/locat/.test(type)) return 'location';
          if (l.signed_at) return 'signature';
        }
        return null;
      };

      const relevant = ((leads || []) as any[]).filter((l) => !l.deleted_at).filter(
        (l: any) => (l.assigned_to || l.created_by) && etapeDe(l) !== null
      );

      // Demandé le 2 septembre : « il faudra qu'on rajoute Mélanie Grazia ».
      // Un conseiller n'apparaissait que s'il avait au moins un dossier sur
      // l'une des étapes suivies : tous les autres étaient simplement
      // absents du tableau. On part donc des MEMBRES de l'agence, et les
      // dossiers viennent remplir leurs compteurs — un conseiller sans
      // dossier reste visible, à zéro.
      // Apporteurs d'affaires (référents) de l'agence — pour le classement
      // Conciergerie par référent.
      const { data: referrers } = await supabase
        .from('real_estate_referrers' as any)
        .select('id, name, agency_name')
        .eq('agency_id', IMMOSPHERA_AGENCY_ID);
      const referrerNameById: Record<string, { name: string; agencyName?: string }> = {};
      ((referrers || []) as any[]).forEach((r) => {
        referrerNameById[r.id] = { name: r.name, agencyName: r.agency_name || undefined };
      });

      const { data: membres } = await supabase
        .from('agency_members')
        .select('user_id')
        .eq('agency_id', IMMOSPHERA_AGENCY_ID);
      const membreIds = (membres || []).map((m: any) => m.user_id as string);

      const assignedIds = Array.from(
        new Set([...relevant.map((l: any) => (l.assigned_to || l.created_by) as string), ...membreIds])
      );
      const { data: profiles } = assignedIds.length
        ? await supabase.from('profiles').select('id, full_name, is_active').in('id', assignedIds)
        : { data: [] as any[] };
      const nameById: Record<string, string> = {};
      const actifById: Record<string, boolean> = {};
      (profiles || []).forEach((p: any) => {
        nameById[p.id] = p.full_name || 'Agent';
        actifById[p.id] = p.is_active !== false;
      });

      const byAgent: Record<string, AgentRow> = {};
      const ligneVide = (id: string): AgentRow => {
        const fullName = nameById[id] || 'Agent';
        return {
          agentId: id,
          agentFullName: fullName,
          agentDisplay: firstNamePlusInitial(fullName),
          location: 0,
          offre: 0,
          compromis: 0,
          signature: 0,
          conciergerie: 0,
          total: 0,
          caLocation: 0,
          caOffre: 0,
          caCompromis: 0,
          caSignature: 0,
          caConciergerie: 0,
        };
      };
      // Un membre désactivé ou non-vendeur n'a plus à figurer au classement.
      membreIds
        .filter((id) => actifById[id] !== false && !estNonVendeur(nameById[id] || '', id))
        .forEach((id) => { byAgent[id] = ligneVide(id); });
      relevant.forEach((l: any) => {
        const id = (l.assigned_to || l.created_by) as string;
        if (estNonVendeur(nameById[id] || '', id)) return;
        if (!byAgent[id]) byAgent[id] = ligneVide(id);
        const honoraires = Number(l.estimated_value) || 0;
        const etape = etapeDe(l);
        if (etape === 'location') { byAgent[id].location += 1; byAgent[id].caLocation += honoraires; }
        if (etape === 'offre') { byAgent[id].offre += 1; byAgent[id].caOffre += honoraires; }
        if (etape === 'compromis') { byAgent[id].compromis += 1; byAgent[id].caCompromis += honoraires; }
        if (etape === 'signature') { byAgent[id].signature += 1; byAgent[id].caSignature += honoraires; }
        if (etape === 'conciergerie') { byAgent[id].conciergerie += 1; byAgent[id].caConciergerie += honoraires; }
        byAgent[id].total += 1;
      });

      const detailRows: StageLead[] = relevant.map((l: any) => ({
        id: l.id,
        name: (l.full_name || [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Sans nom').trim(),
        agentId: (l.assigned_to || l.created_by) as string,
        stage: etapeDe(l) as StageKey,
        honoraires: Number(l.estimated_value) || 0,
        ville: (l.sector || '').trim(),
        mandat: (l.mandate_number || '').trim(),
        referrerId: (l.referrer_id as string) || null,
      })).filter((d) => d.stage);

      if (!cancelled) {
        setRows(Object.values(byAgent));
        setDetails(detailRows);
        setReferrerById(referrerNameById);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Classement par résultats : le conseiller le plus performant en tête.
  // Demande explicite : « supprime les 4 car ils ne vendent pas ».
  // Ne conserve que les conseillers qui réalisent des ventes (total > 0 et non exclus).
  const orderedRowsToutesLignes = useMemo(
    () =>
      [...rows]
        .filter((r) => !estNonVendeur(r.agentFullName, r.agentId) && r.total > 0)
        .sort((a, b) => b.total - a.total || a.agentFullName.localeCompare(b.agentFullName, 'fr')),
    [rows]
  );
  // Verrouillage des montants (6 septembre) : un agent simple ne voit que sa
  // propre ligne ; la direction (super admin/admin) garde tout.
  // Reprécisé le 6 septembre : « les classements soient visibles par tous
  // [...] sauf les chiffres doivent être cloisonnés pour chacun ». On
  // n'exclut donc plus personne de la liste (tout le monde voit qui est
  // classé où, y compris le podium) — seuls les MONTANTS en euros restent
  // réservés à la direction et à son propre chiffre (voir peuxVoirMontant
  // plus bas, utilisé partout où un € est affiché).
  const orderedRows = orderedRowsToutesLignes;
  const peuxVoirMontant = (agentId: string) => estDirection || agentId === monAgentId;


  // Trois onglets séparés, un par étape, plus la vue d'ensemble existante
  // (conservée telle quelle : elle avait été réglée avec vous).
  const [tab, setTab] = useState<'apercu' | StageKey>('apercu');
  // Demandé : deux classements — un sur le nombre de ventes, un sur le
  // chiffre d'affaires rentré dans l'agence. Le podium suit le critère choisi.
  const [rankBy, setRankBy] = useState<'ca' | 'ventes'>('ca');

  const TABS = [
    { key: 'apercu' as const, label: "Vue d'ensemble" },
    { key: 'location' as const, label: 'Locations' },
    { key: 'offre' as const, label: "Offres d'achat" },
    { key: 'compromis' as const, label: 'Compromis' },
    { key: 'signature' as const, label: 'Actes authentiques' },
    { key: 'conciergerie' as const, label: 'Conciergerie' },
  ];

  const formatEuros = (value: number) =>
    value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

  // Classement du conseiller le plus au moins performant sur l'étape choisie.
  const stageRows = useMemo(() => {
    if (tab === 'apercu') return [];
    const pick = (r: AgentRow) =>
      tab === 'location'
        ? { count: r.location, ca: r.caLocation }
        : tab === 'offre'
          ? { count: r.offre, ca: r.caOffre }
          : tab === 'compromis'
            ? { count: r.compromis, ca: r.caCompromis }
            : tab === 'signature'
              ? { count: r.signature, ca: r.caSignature }
              : { count: r.conciergerie, ca: r.caConciergerie };
    return orderedRows
      .map((r) => ({ ...r, ...pick(r) }))
      .filter((r) => r.count > 0 || r.ca > 0)
      .sort((a, b) => (rankBy === 'ca' ? b.ca - a.ca || b.count - a.count : b.count - a.count || b.ca - a.ca));
  }, [orderedRows, tab, rankBy]);

  const stageTotal = useMemo(
    () => stageRows.reduce((acc, r) => ({ count: acc.count + r.count, ca: acc.ca + r.ca }), { count: 0, ca: 0 }),
    [stageRows]
  );

  // Classement par apporteur d'affaires — Conciergerie uniquement. Sciemment
  // PAS filtré par estDirection/monAgentId : ce n'est pas le revenu
  // personnel d'un conseiller, tout utilisateur ayant accès à cette vue peut
  // voir quel agent immobilier apporte le plus d'affaires.
  const referrerRows = useMemo<ReferrerRow[]>(() => {
    if (tab !== 'conciergerie') return [];
    const byReferrer: Record<string, ReferrerRow> = {};
    details.filter((d) => d.stage === 'conciergerie').forEach((d) => {
      const key = d.referrerId || '__sans_apporteur__';
      if (!byReferrer[key]) {
        const info = d.referrerId ? referrerById[d.referrerId] : undefined;
        byReferrer[key] = {
          referrerId: d.referrerId,
          name: info?.name || (d.referrerId ? 'Apporteur inconnu' : 'Sans apporteur'),
          agencyName: info?.agencyName,
          count: 0,
          ca: 0,
        };
      }
      byReferrer[key].count += 1;
      byReferrer[key].ca += d.honoraires;
    });
    const rowsArr = Object.values(byReferrer);
    // « Sans apporteur » toujours en dernier, comme demandé — sinon tri par
    // le même critère (CA ou ventes) que le classement par conseiller.
    const avecApporteur = rowsArr.filter((r) => r.referrerId !== null);
    const sansApporteur = rowsArr.filter((r) => r.referrerId === null);
    avecApporteur.sort((a, b) => (rankBy === 'ca' ? b.ca - a.ca || b.count - a.count : b.count - a.count || b.ca - a.ca));
    return [...avecApporteur, ...sansApporteur];
  }, [details, tab, rankBy, referrerById]);

  const totals = useMemo(
    () =>
      orderedRows.reduce(
        (acc, r) => ({
          location: acc.location + r.location,
          offre: acc.offre + r.offre,
          compromis: acc.compromis + r.compromis,
          signature: acc.signature + r.signature,
          conciergerie: acc.conciergerie + r.conciergerie,
          total: acc.total + r.total,
        }),
        { location: 0, offre: 0, compromis: 0, signature: 0, conciergerie: 0, total: 0 }
      ),
    [orderedRows]
  );

  const detailLeads = useMemo(() => {
    if (!detailFor) return [];
    // La liste des dossiers reste visible pour tous (qui est dans cette
    // case) ; seul le montant affiché à côté de chaque dossier est masqué
    // pour un dossier qui n'est pas le sien (voir peuxVoirMontant).
    return details
      .filter((d) => d.stage === detailFor.stage && (!detailFor.agentId || d.agentId === detailFor.agentId))
      .sort((a, b) => b.honoraires - a.honoraires || a.name.localeCompare(b.name, 'fr'));
  }, [details, detailFor]);

  // Demandé : podium sur le classement — or, argent, bronze, médaille à côté
  // du nom. Au-delà du 3e, présentation neutre.
  const PODIUM = [
    { medal: '🥇', border: '#D4AF37', bg: '#2A2211', name: '#F7BC5F' },
    { medal: '🥈', border: '#B0BEC9', bg: '#242628', name: '#DDE3E8' },
    { medal: '🥉', border: '#B8863F', bg: '#2A2018', name: '#E0A66B' },
  ];

  const STAGE_LABEL: Record<StageKey, string> = {
    location: 'Locations',
    offre: "Offres d'achat",
    compromis: 'Compromis',
    signature: 'Actes authentiques',
    conciergerie: 'Conciergerie',
  };

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <div
        className="rounded-3xl border border-white/10 bg-[#07191c]/90 backdrop-blur-2xl p-6 sm:p-8 relative shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]"
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[#F7BC5F]/50 to-transparent pointer-events-none rounded-t-3xl" />

        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/10">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              Statistiques — Locations, Offres, Compromis, Signatures &amp; Conciergerie
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Répartition en direct par agent ImmoSphera sur le pipeline Transactions V2.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-xl text-xs font-bold tracking-wide transition-all duration-200 border cursor-pointer ${
                tab === t.key
                  ? 'bg-gradient-to-r from-[#F7BC5F] to-[#E5A73E] text-slate-950 border-[#F7BC5F] shadow-[0_0_15px_rgba(247,188,95,0.35)] scale-105'
                  : 'bg-white/[0.04] text-slate-300 border-white/10 hover:bg-white/[0.08] hover:text-white hover:border-white/20'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tout le monde voit le classement complet désormais (seuls les
            montants € sont cloisonnés, pas les lignes) : le tri par CA ou
            par nombre de ventes redevient utile pour tous, sur tous les
            onglets. */}
        {tab !== 'apercu' && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] uppercase tracking-widest text-[#C9B67B]">Classer par</span>
            {([
              { key: 'ca' as const, label: "Chiffre d'affaires" },
              { key: 'ventes' as const, label: 'Nombre de ventes' },
            ]).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRankBy(opt.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                  rankBy === opt.key
                    ? 'bg-[#6B5220] text-[#F3EAD3] border-[#D4AF37]'
                    : 'bg-transparent text-[#C9B67B] border-[#3a2f1a] hover:text-[#F3EAD3]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#C9B67B]">
            <Loader2 className="animate-spin mr-2" size={18} /> Chargement des statistiques…
          </div>
        ) : tab !== 'apercu' ? (
          stageRows.length === 0 ? (
            <div className="py-16 text-center text-sm text-[#C9B67B]">
              Aucun dossier à cette étape pour le moment.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center px-4 py-2 text-[9px] uppercase tracking-widest text-[#C9B67B]">
                <span className="w-7 shrink-0" />
                <span className="flex-1">Conseiller</span>
                <span className="w-20 text-center">Dossiers</span>
                <span className="w-32 text-right">Chiffre d'affaires</span>
              </div>
              {stageRows.map((r, rank) => {
                const podium = PODIUM[rank];
                return (
                <div
                  key={r.agentId}
                  className="flex items-center rounded-xl px-4 py-3"
                  style={{
                    border: `${podium ? '2px' : '1px'} solid ${podium ? podium.border : '#6B5220'}`,
                    background: podium ? podium.bg : '#2A2211',
                  }}
                >
                  <span className="w-7 shrink-0 text-base leading-none" aria-hidden="true">{podium ? podium.medal : ''}</span>
                  <span
                    className="flex-1 text-sm font-bold truncate"
                    style={{ color: podium ? podium.name : '#F3EAD3' }}
                  >
                    {r.agentFullName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDetailFor({ stage: tab as StageKey, agentId: r.agentId, title: r.agentFullName })}
                    className="w-20 text-center text-sm text-[#C9B67B] tabular-nums hover:text-[#F3EAD3] underline decoration-dotted underline-offset-4"
                    title="Voir les clients concernés"
                  >
                    {r.count}
                  </button>
                  <span className="w-32 text-right text-sm font-bold text-[#D4AF37] tabular-nums">
                    {peuxVoirMontant(r.agentId) ? formatEuros(r.ca) : '🔒 —'}
                  </span>
                </div>
                );
              })}
              <div className="flex items-center rounded-xl border-2 border-[#D4AF37] bg-[#1b1712] px-4 py-3 mt-3">
                <span className="w-7 shrink-0" />
                <span className="flex-1 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Total agence</span>
                <button
                  type="button"
                  onClick={() => setDetailFor({ stage: tab as StageKey, agentId: null, title: 'Toute l\'agence' })}
                  className="w-20 text-center text-sm font-bold text-[#F3EAD3] tabular-nums hover:text-[#D4AF37] underline decoration-dotted underline-offset-4"
                  title="Voir tous les clients de cette étape"
                >
                  {stageTotal.count}
                </button>
                <span className="w-32 text-right text-base font-bold text-[#D4AF37] tabular-nums">{formatEuros(stageTotal.ca)}</span>
              </div>
              <p className="pt-2 text-[10px] text-[#C9B67B]">
                Chiffre d'affaires = champ « Honoraires (€) » de la fiche client. Un dossier sans
                honoraires renseignés compte pour 0 €.
              </p>

              {/* Classement par apporteur d'affaires — Conciergerie
                  uniquement (demande du 6 septembre). Visible de tous, sans
                  le verrouillage « mes stats » du classement par
                  conseiller ci-dessus. */}
              {tab === 'conciergerie' && (
                <div className="pt-5 mt-5 border-t border-[#3a2f1a] space-y-2">
                  <h3 className="text-sm font-bold text-[#D4AF37] uppercase tracking-wide mb-2">
                    Classement par apporteur d'affaires
                  </h3>
                  {referrerRows.length === 0 ? (
                    <p className="text-xs text-[#C9B67B] py-4 text-center">Aucun dossier Conciergerie pour le moment.</p>
                  ) : (
                    <>
                      <div className="flex items-center px-4 py-2 text-[9px] uppercase tracking-widest text-[#C9B67B]">
                        <span className="w-7 shrink-0" />
                        <span className="flex-1">Agent immobilier référent</span>
                        <span className="w-20 text-center">Dossiers</span>
                        <span className="w-32 text-right">Chiffre d'affaires</span>
                      </div>
                      {referrerRows.map((r, rank) => {
                        const podium = r.referrerId !== null ? PODIUM[rank] : undefined;
                        return (
                          <div
                            key={r.referrerId || '__sans_apporteur__'}
                            className="flex items-center rounded-xl px-4 py-3"
                            style={{
                              border: `${podium ? '2px' : '1px'} solid ${podium ? podium.border : '#6B5220'}`,
                              background: podium ? podium.bg : (r.referrerId === null ? '#1b1712' : '#2A2211'),
                            }}
                          >
                            <span className="w-7 shrink-0 text-base leading-none" aria-hidden="true">{podium ? podium.medal : ''}</span>
                            <span
                              className="flex-1 text-sm font-bold truncate"
                              style={{ color: podium ? podium.name : (r.referrerId === null ? '#C9B67B' : '#F3EAD3') }}
                            >
                              {r.name}{r.agencyName ? ` (${r.agencyName})` : ''}
                            </span>
                            <span className="w-20 text-center text-sm text-[#C9B67B] tabular-nums">{r.count}</span>
                            <span className="w-32 text-right text-sm font-bold text-[#D4AF37] tabular-nums">{formatEuros(r.ca)}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        ) : orderedRows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#C9B67B]">
            Aucun conseiller à afficher pour le moment.
          </div>
        ) : (
          <div className="space-y-2">
            {orderedRows.map((row) => (
              <AgentRow
                key={row.agentId}
                row={row}
                color={LABEL_COLORS[0].value}
                onOpen={(stage) => setDetailFor({ stage, agentId: row.agentId, title: row.agentFullName })}
              />
            ))}
          </div>
        )}

        {/* Total agence */}
        {!loading && orderedRows.length > 0 && (
          <div className="mt-8 flex justify-center">
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 rounded-3xl border border-[#F7BC5F]/30 bg-gradient-to-r from-[#F7BC5F]/15 via-white/[0.03] to-[#F7BC5F]/15 backdrop-blur-xl px-6 sm:px-10 py-4 sm:py-5 shadow-[0_10px_35px_-5px_rgba(0,0,0,0.5),0_0_20px_rgba(247,188,95,0.15)]">
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-[#FAD592]">
                {estDirection ? 'Total agence' : 'Mes chiffres'}
              </span>
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-black text-sky-300 tabular-nums leading-none">{totals.location}</div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-1">Location</div>
                </div>
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-black text-amber-300 tabular-nums leading-none">{totals.offre}</div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-1">Offre</div>
                </div>
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-black text-emerald-300 tabular-nums leading-none">{totals.compromis}</div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-1">Compromis</div>
                </div>
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-black text-[#FAD592] tabular-nums leading-none">{totals.signature}</div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-1">Signature</div>
                </div>
                <div className="text-center">
                  <div className="text-lg sm:text-xl font-black text-purple-300 tabular-nums leading-none">{totals.conciergerie}</div>
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mt-1">Conciergerie</div>
                </div>
                <div className="w-px h-8 bg-white/10 hidden sm:block" />
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-black text-[#F7BC5F] tabular-nums leading-none drop-shadow">{totals.total}</div>
                  <div className="text-[10px] uppercase font-black tracking-wider text-[#FAD592] mt-1">Total</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Demandé : au clic sur un chiffre, savoir QUI est dans cette case —
          et pouvoir ouvrir la fiche directement depuis la liste. */}
      {detailFor && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setDetailFor(null)}
        >
          <div
            className="bg-[#1b1712] border-2 border-[#6B5220] rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-[#3a2f1a]">
              <div>
                <h3 className="text-sm font-bold text-[#F3EAD3]">{STAGE_LABEL[detailFor.stage]}</h3>
                <p className="text-[11px] text-[#C9B67B] mt-0.5">
                  {detailFor.title} — {detailLeads.length} dossier{detailLeads.length > 1 ? 's' : ''}
                </p>
              </div>
              <button onClick={() => setDetailFor(null)} className="text-[#C9B67B] hover:text-[#F3EAD3] text-lg leading-none px-1">×</button>
            </div>

            <div className="overflow-y-auto custom-scrollbar p-3 space-y-1.5">
              {detailLeads.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#C9B67B]">Aucun dossier.</p>
              ) : (
                detailLeads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => {
                      if (!onSelectContact) return;
                      setDetailFor(null);
                      onSelectContact(lead.id);
                    }}
                    disabled={!onSelectContact}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-[#3a2f1a] bg-[#2A2211] text-left hover:border-[#D4AF37] transition-colors disabled:cursor-default"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-[#F3EAD3] truncate">{lead.name}</span>
                      <span className="block text-[11px] text-[#C9B67B] truncate">
                        Mandat : {lead.mandat || '—'}
                        {lead.ville ? ` · ${lead.ville}` : ''}
                      </span>
                    </span>
                    <span className="text-xs font-bold text-[#D4AF37] tabular-nums shrink-0">
                      {peuxVoirMontant(lead.agentId) ? formatEuros(lead.honoraires) : '🔒'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatistiquesEtiquettesView;
