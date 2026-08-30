import React, { useEffect, useMemo, useState } from 'react';
import { DndContext, DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Loader2, Palette } from 'lucide-react';
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

const ORDER_KEY = 'novasphere:stats-etiquettes-order';
const COLOR_KEY = 'novasphere:stats-etiquettes-colors';

const LABEL_COLORS = [
  { name: 'Ivoire (défaut)', value: '#F3EAD3' },
  { name: 'Vert bouteille', value: '#DCEEDD' },
  { name: 'Bleu poudré', value: '#DCE6F3' },
  { name: 'Corail', value: '#F5D9CE' },
  { name: 'Lavande', value: '#E6DCF3' },
  { name: 'Or pâle', value: '#F3EAC0' },
];

interface AgentRow {
  agentId: string;
  agentDisplay: string;
  agentFullName: string;
  offre: number;
  compromis: number;
  signature: number;
  total: number;
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

const SortableAgentRow: React.FC<{
  row: AgentRow;
  color: string;
  onPickColor: () => void;
}> = ({ row, color, onPickColor }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.agentId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative flex items-center gap-3 sm:gap-5 rounded-xl border border-[#3a2f1a] bg-[#1b1712]/80 px-3 sm:px-4 py-3"
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 text-[#9C7A2E] hover:text-[#D4AF37] cursor-grab active:cursor-grabbing touch-none"
        title="Glisser pour réordonner"
      >
        <GripVertical size={18} />
      </button>

      <AgentSeal display={row.agentDisplay} fullName={row.agentFullName} color={color} />

      {/* Demande explicite : "centre-les par rapport au rectangle en
          dessous" — centrer par rapport à l'ESPACE RESTANT (entre le cachet
          agent et le total) ne donnait pas le même centre que le médaillon
          "Total agence" plus bas (lui centré sur toute la largeur du
          panneau), car le bloc agent et le bloc total/couleur n'ont pas la
          même largeur. Position absolue au centre EXACT de la rangée — donc
          de la même largeur que le panneau — pour que les deux s'alignent
          verticalement, quelle que soit la longueur du nom de l'agent. */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 sm:gap-4">
        <BrassLabel count={row.offre} color={color} caption="Offre" />
        <BrassLabel count={row.compromis} color={color} caption="Compromis" />
        <BrassLabel count={row.signature} color={color} caption="Signature" />
      </div>

      <div className="ml-auto flex items-center gap-3 sm:gap-4 shrink-0">
        <div className="rounded-lg border-2 border-[#D4AF37] bg-[#2A2211] px-3 py-1.5 text-center min-w-[2.5rem]">
          <span className="text-base sm:text-lg font-bold text-[#D4AF37] tabular-nums">{row.total}</span>
        </div>
        <button
          onClick={onPickColor}
          className="shrink-0 w-7 h-7 rounded-full border border-[#6B5220] flex items-center justify-center hover:brightness-110"
          style={{ background: color }}
          title="Couleur des étiquettes de cet agent"
        >
          <Palette size={12} className="text-[#3A2E12]" />
        </button>
      </div>
    </div>
  );
};

const StatistiquesEtiquettesView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [order, setOrder] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [colors, setColors] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLOR_KEY) || '{}');
    } catch {
      return {};
    }
  });
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

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
        .select('id, stage_id, assigned_to, created_by, archived_at')
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
          };
        }
        if (l.stage_id === offreStageId) byAgent[id].offre += 1;
        if (l.stage_id === compromisStageId) byAgent[id].compromis += 1;
        if (l.stage_id === signatureStageId) byAgent[id].signature += 1;
        byAgent[id].total += 1;
      });

      if (!cancelled) {
        setRows(Object.values(byAgent));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const orderedRows = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.agentId, r]));
    const known = order.map((id) => byId.get(id)).filter(Boolean) as AgentRow[];
    const rest = rows.filter((r) => !order.includes(r.agentId)).sort((a, b) => b.total - a.total);
    return [...known, ...rest];
  }, [rows, order]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedRows.map((r) => r.agentId);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    setOrder(next);
    localStorage.setItem(ORDER_KEY, JSON.stringify(next));
  };

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

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#C9B67B]">
            <Loader2 className="animate-spin mr-2" size={18} /> Chargement des statistiques…
          </div>
        ) : orderedRows.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#C9B67B]">
            Aucun dossier en Offre, Compromis ou Signature pour le moment.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedRows.map((r) => r.agentId)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {orderedRows.map((row) => (
                  <SortableAgentRow
                    key={row.agentId}
                    row={row}
                    color={colors[row.agentId] || LABEL_COLORS[0].value}
                    onPickColor={() => setColorPickerFor(row.agentId)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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

      {colorPickerFor && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setColorPickerFor(null)}
        >
          <div
            className="bg-[#1b1712] border border-[#3a2f1a] rounded-2xl p-4 sm:p-5 w-full max-w-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[#F3EAD3] mb-3">Couleur des étiquettes</h3>
            <div className="grid grid-cols-3 gap-3">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => {
                    const next = { ...colors, [colorPickerFor]: c.value };
                    setColors(next);
                    localStorage.setItem(COLOR_KEY, JSON.stringify(next));
                    setColorPickerFor(null);
                  }}
                  className="flex flex-col items-center gap-1.5 group"
                  title={c.name}
                >
                  <span
                    className="w-10 h-10 rounded-lg border-2 border-[#9C7A2E] group-hover:scale-105 transition-transform"
                    style={{ background: c.value }}
                  />
                  <span className="text-[10px] text-[#C9B67B] text-center leading-tight">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatistiquesEtiquettesView;
