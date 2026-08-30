import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID, IMMOSPHERA_AGENCY_ID } from './TransactionChecklistModal';

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

type StageKey = 'offre' | 'compromis' | 'signature';

interface StageLead {
  id: string;
  name: string;
  agentId: string;
  stage: StageKey;
  honoraires: number;
}

interface AgentRow {
  agentId: string;
  agentDisplay: string;
  agentFullName: string;
  offre: number;
  compromis: number;
  signature: number;
  total: number;
  // Demandé : le chiffre d'affaires de chaque conseiller sur chacune des
  // trois étapes. Source : le champ « Honoraires (€) » de la fiche client
  // (colonne `estimated_value`), c'est-à-dire ce que l'agence encaisse —
  // et non le budget, qui est le prix du bien.
  caOffre: number;
  caCompromis: number;
  caSignature: number;
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

// Une "étiquette" laiton — reprend le style de la photo de référence :
// cadre doré à rivets, plaquette arrondie, petite languette débordante en
// bas, et désormais un mini-libellé sous le nombre pour identifier l'étape
// d'un coup d'œil sans remonter à l'en-tête. `count` de 0 s'affiche grisée
// (agent sans dossier sur cette étape, mais on ne le masque pas — il reste
// visible dans le tableau).
const BrassLabel: React.FC<{ count: number; color: string; caption: string }> = ({ count, color, caption }) => (
  <div className="relative w-20 sm:w-24 shrink-0" style={{ opacity: count === 0 ? 0.35 : 1 }}>
    <div
      className="rounded-lg border-[3px] px-2 pt-2 pb-1.5 text-center shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
      style={{ borderColor: '#9C7A2E', background: `linear-gradient(180deg, ${color} 0%, ${color} 100%)` }}
    >
      <span className="block text-lg sm:text-xl font-bold text-[#3A2E12] tabular-nums leading-none">{count}</span>
      <span className="block text-[8px] sm:text-[9px] font-semibold uppercase tracking-wider text-[#6B5220] mt-1 whitespace-nowrap">{caption}</span>
    </div>
    {/* petits rivets, coin haut-gauche/droit, comme sur le casier photographié */}
    <div className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-[#B8923F] border border-[#6B5220]" />
    <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#B8923F] border border-[#6B5220]" />
    {/* languette arrondie en bas, effet étiquette suspendue */}
    <div
      className="mx-auto -mt-1 w-6 h-2 rounded-b-full border-x-[3px] border-b-[3px]"
      style={{ borderColor: '#9C7A2E', background: color }}
    />
  </div>
);

// Plaquette ovale façon porte-nom, avec "Prénom N." (demande explicite :
// "Isabelle G", pas juste l'initiale) — remplace le cachet à une seule
// lettre.
const AgentSeal: React.FC<{ display: string; fullName: string; color: string }> = ({ display, fullName, color }) => (
  <div
    className="relative shrink-0 rounded-full border-[3px] flex items-center justify-center px-3 py-1.5 min-w-[6rem] sm:min-w-[7rem] shadow-[0_2px_5px_rgba(0,0,0,0.45)]"
    style={{ borderColor: '#9C7A2E', background: color }}
    title={fullName}
  >
    <span className="text-sm sm:text-base font-bold text-[#3A2E12] truncate">{display}</span>
    <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-black/10" />
  </div>
);

// Demandé : « ne fais pas un drag and drop, cela sera soumis uniquement aux
// résultats des conseillers » — le classement se calcule, il ne se range plus
// à la main. Le sélecteur de couleur d'étiquette est retiré de même.
const AgentRow: React.FC<{ row: AgentRow; color: string }> = ({ row, color }) => (
  <div className="relative flex items-center gap-3 sm:gap-5 rounded-xl border border-[#3a2f1a] bg-[#1b1712]/80 px-3 sm:px-4 py-3">
    <AgentSeal display={row.agentDisplay} fullName={row.agentFullName} color={color} />

    <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 sm:gap-4">
      <BrassLabel count={row.offre} color={color} caption="Offre" />
      <BrassLabel count={row.compromis} color={color} caption="Compromis" />
      <BrassLabel count={row.signature} color={color} caption="Signature" />
    </div>

    <div className="ml-auto flex items-center gap-3 sm:gap-4 shrink-0">
      <div className="rounded-lg border-2 border-[#D4AF37] bg-[#2A2211] px-3 py-1.5 text-center min-w-[2.5rem]">
        <span className="text-base sm:text-lg font-bold text-[#D4AF37] tabular-nums">{row.total}</span>
      </div>
    </div>
  </div>
);

const StatistiquesEtiquettesView: React.FC<{ onSelectContact?: (contactId: string) => void }> = ({ onSelectContact }) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgentRow[]>([]);
  // Demandé : « savoir qui est présent dans cette case ». On garde le détail
  // des dossiers (nom + conseiller + étape) pour pouvoir les lister au clic
  // sur un chiffre, et ouvrir la fiche depuis la liste.
  const [details, setDetails] = useState<StageLead[]>([]);
  const [detailFor, setDetailFor] = useState<{ stage: StageKey; agentId: string | null; title: string } | null>(null);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Étapes du pipeline "Transactions V2" retenues pour ce tableau.
      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .eq('pipeline_id', IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID);

      const offreStageId = (stages || []).find((s: any) => s.name === "Offre d'achat")?.id;
      const compromisStageId = (stages || []).find((s: any) => s.name === 'Signature compromis')?.id;
      const signatureStageId = (stages || []).find((s: any) => s.name === 'signature acte authentique')?.id;

      const { data: leads } = await supabase
        .from('leads')
        .select('id, stage_id, assigned_to, created_by, archived_at, estimated_value, full_name, first_name, last_name')
        .eq('pipeline_id', IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID)
        .eq('agency_id', IMMOSPHERA_AGENCY_ID);

      // Signalé : "statistique n'est pas relié à pipeline transaction V2 car
      // j'ai un dossier dans offre et je n'ai rien dans statistique" —
      // `leads.assigned_to` (agent assigné) est vide sur TOUS les dossiers
      // actuels de ce pipeline, alors que `created_by` (agent qui a créé le
      // dossier) est, lui, toujours renseigné. On utilise donc `assigned_to`
      // en priorité quand il existe, sinon `created_by` comme agent de
      // référence de la carte.
      const relevant = (leads || []).filter(
        (l: any) =>
          !l.archived_at &&
          (l.assigned_to || l.created_by) &&
          (l.stage_id === offreStageId || l.stage_id === compromisStageId || l.stage_id === signatureStageId)
      );

      const assignedIds = Array.from(new Set(relevant.map((l: any) => l.assigned_to || l.created_by)));
      const { data: profiles } = assignedIds.length
        ? await supabase.from('profiles').select('id, full_name').in('id', assignedIds)
        : { data: [] as any[] };
      const nameById: Record<string, string> = {};
      (profiles || []).forEach((p: any) => { nameById[p.id] = p.full_name || 'Agent'; });

      const byAgent: Record<string, AgentRow> = {};
      relevant.forEach((l: any) => {
        const id = (l.assigned_to || l.created_by) as string;
        if (!byAgent[id]) {
          const fullName = nameById[id] || 'Agent';
          byAgent[id] = {
            agentId: id,
            agentFullName: fullName,
            agentDisplay: firstNamePlusInitial(fullName),
            offre: 0,
            compromis: 0,
            signature: 0,
            total: 0,
            caOffre: 0,
            caCompromis: 0,
            caSignature: 0,
          };
        }
        const honoraires = Number(l.estimated_value) || 0;
        if (l.stage_id === offreStageId) { byAgent[id].offre += 1; byAgent[id].caOffre += honoraires; }
        if (l.stage_id === compromisStageId) { byAgent[id].compromis += 1; byAgent[id].caCompromis += honoraires; }
        if (l.stage_id === signatureStageId) { byAgent[id].signature += 1; byAgent[id].caSignature += honoraires; }
        byAgent[id].total += 1;
      });

      const stageOf = (stageId: string): StageKey | null =>
        stageId === offreStageId ? 'offre' : stageId === compromisStageId ? 'compromis' : stageId === signatureStageId ? 'signature' : null;

      const detailRows: StageLead[] = relevant.map((l: any) => ({
        id: l.id,
        name: (l.full_name || [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Sans nom').trim(),
        agentId: (l.assigned_to || l.created_by) as string,
        stage: stageOf(l.stage_id) as StageKey,
        honoraires: Number(l.estimated_value) || 0,
      })).filter((d) => d.stage);

      if (!cancelled) {
        setRows(Object.values(byAgent));
        setDetails(detailRows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Classement par résultats : le conseiller le plus performant en tête.
  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => b.total - a.total || a.agentFullName.localeCompare(b.agentFullName, 'fr')),
    [rows]
  );


  // Trois onglets séparés, un par étape, plus la vue d'ensemble existante
  // (conservée telle quelle : elle avait été réglée avec vous).
  const [tab, setTab] = useState<'apercu' | 'offre' | 'compromis' | 'signature'>('apercu');
  // Demandé : deux classements — un sur le nombre de ventes, un sur le
  // chiffre d'affaires rentré dans l'agence. Le podium suit le critère choisi.
  const [rankBy, setRankBy] = useState<'ca' | 'ventes'>('ca');

  const TABS = [
    { key: 'apercu' as const, label: "Vue d'ensemble" },
    { key: 'offre' as const, label: "Offres d'achat" },
    { key: 'compromis' as const, label: 'Compromis' },
    { key: 'signature' as const, label: 'Actes authentiques' },
  ];

  const formatEuros = (value: number) =>
    value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

  // Classement du conseiller le plus au moins performant sur l'étape choisie.
  const stageRows = useMemo(() => {
    if (tab === 'apercu') return [];
    const pick = (r: AgentRow) =>
      tab === 'offre'
        ? { count: r.offre, ca: r.caOffre }
        : tab === 'compromis'
          ? { count: r.compromis, ca: r.caCompromis }
          : { count: r.signature, ca: r.caSignature };
    return orderedRows
      .map((r) => ({ ...r, ...pick(r) }))
      .filter((r) => r.count > 0 || r.ca > 0)
      .sort((a, b) => (rankBy === 'ca' ? b.ca - a.ca || b.count - a.count : b.count - a.count || b.ca - a.ca));
  }, [orderedRows, tab, rankBy]);

  const stageTotal = useMemo(
    () => stageRows.reduce((acc, r) => ({ count: acc.count + r.count, ca: acc.ca + r.ca }), { count: 0, ca: 0 }),
    [stageRows]
  );

  const totals = useMemo(
    () =>
      orderedRows.reduce(
        (acc, r) => ({
          offre: acc.offre + r.offre,
          compromis: acc.compromis + r.compromis,
          signature: acc.signature + r.signature,
          total: acc.total + r.total,
        }),
        { offre: 0, compromis: 0, signature: 0, total: 0 }
      ),
    [orderedRows]
  );

  const detailLeads = useMemo(() => {
    if (!detailFor) return [];
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
    offre: "Offres d'achat",
    compromis: 'Compromis',
    signature: 'Actes authentiques',
  };

  return (
    <div className="p-3 sm:p-6">
      <div
        className="rounded-2xl border-[6px] p-4 sm:p-6 relative"
        style={{
          borderColor: '#8a6a2a',
          background: 'linear-gradient(160deg, #14110c 0%, #100d09 100%)',
          boxShadow: 'inset 0 0 0 2px #3a2f1a, 0 8px 30px rgba(0,0,0,0.5)',
        }}
      >
        {/* rivets aux 4 coins du cadre, comme sur le casier photographié */}
        {[
          'top-3 left-3', 'top-3 right-3', 'bottom-3 left-3', 'bottom-3 right-3',
        ].map((pos) => (
          <div key={pos} className={`absolute ${pos} w-3 h-3 rounded-full bg-[#B8923F] border border-[#6B5220] shadow-inner`} />
        ))}

        <div className="mb-4 sm:mb-5">
          <h2 className="text-lg sm:text-2xl font-bold text-[#F3EAD3] tracking-wide">Statistiques — Offres, Compromis &amp; Signatures</h2>
          <p className="text-xs sm:text-sm text-[#C9B67B] mt-1">
            Répartition en direct par agent ImmoSphera sur le pipeline Transactions V2.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4 sm:mb-5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold tracking-wide transition-colors border ${
                tab === t.key
                  ? 'bg-[#D4AF37] text-[#1b1712] border-[#D4AF37]'
                  : 'bg-[#2A2211] text-[#C9B67B] border-[#6B5220] hover:text-[#F3EAD3]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'apercu' && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] uppercase tracking-widest text-[#C9B67B]">Classer par</span>
            {([
              { key: 'ca' as const, label: "Chiffre d'affaires" },
              { key: 'ventes' as const, label: 'Nombre de ventes' },
            ]).map((opt) => (
              <button
                key={opt.key}
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
                  <span className="w-32 text-right text-sm font-bold text-[#D4AF37] tabular-nums">{formatEuros(r.ca)}</span>
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
            </div>
          )
        ) : orderedRows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#C9B67B]">
            Aucun dossier en Offre, Compromis ou Signature pour le moment.
          </div>
        ) : (
          <div className="space-y-2">
            {orderedRows.map((row) => (
              <AgentRow key={row.agentId} row={row} color={LABEL_COLORS[0].value} />
            ))}
          </div>
        )}

        {/* Total agence — recentré au milieu du panneau, en médaillon, plutôt
            qu'en pleine largeur comme les rangées agent. */}
        {!loading && orderedRows.length > 0 && (
          <div className="mt-5 flex justify-center">
            <div className="flex items-center gap-4 sm:gap-6 rounded-2xl border-2 border-[#D4AF37] bg-[#2A2211] px-5 sm:px-7 py-3 sm:py-4 shadow-[0_4px_14px_rgba(0,0,0,0.4)]">
              <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-[#D4AF37]">Total agence</span>
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="text-center">
                  <div className="text-base sm:text-lg font-bold text-[#F3EAD3] tabular-nums leading-none">{totals.offre}</div>
                  <div className="text-[9px] uppercase tracking-wider text-[#C9B67B] mt-1">Offre</div>
                </div>
                <div className="text-center">
                  <div className="text-base sm:text-lg font-bold text-[#F3EAD3] tabular-nums leading-none">{totals.compromis}</div>
                  <div className="text-[9px] uppercase tracking-wider text-[#C9B67B] mt-1">Compromis</div>
                </div>
                <div className="text-center">
                  <div className="text-base sm:text-lg font-bold text-[#F3EAD3] tabular-nums leading-none">{totals.signature}</div>
                  <div className="text-[9px] uppercase tracking-wider text-[#C9B67B] mt-1">Signature</div>
                </div>
                <div className="w-px h-8 bg-[#D4AF37]/40" />
                <div className="text-center">
                  <div className="text-xl sm:text-2xl font-bold text-[#D4AF37] tabular-nums leading-none">{totals.total}</div>
                  <div className="text-[9px] uppercase tracking-wider text-[#C9B67B] mt-1">Total</div>
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
                    <span className="text-sm text-[#F3EAD3] truncate">{lead.name}</span>
                    <span className="text-xs font-bold text-[#D4AF37] tabular-nums shrink-0">{formatEuros(lead.honoraires)}</span>
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
