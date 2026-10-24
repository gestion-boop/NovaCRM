import React from 'react';
import { 
  Check, Info, AlertCircle, Flame, CheckCircle2, 
  Eye, MessageSquare, PenTool, Award 
} from 'lucide-react';
import { getAgencyLogo, sortByAgencyOrder } from '@/lib/agency-logos';
import { agenceUniqueAnnonce, agencesReelles } from '@/lib/agencesAnnonce';

export const NIVEAUX_ANNONCE = [
  ['info', 'Info', 'Information', Info, 'border-[#F7BC5F] bg-[#F7BC5F]/20 text-[#FAD592] shadow-[0_0_15px_rgba(247,188,95,0.35)] ring-1 ring-[#F7BC5F]/60'],
  ['a_verifier', 'À vérifier', 'À vérifier', AlertCircle, 'border-amber-500 bg-amber-500/20 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.35)] ring-1 ring-amber-500/60'],
  ['important', 'Important', 'Important', Flame, 'border-rose-500 bg-gradient-to-r from-rose-500/30 to-red-600/40 text-rose-100 shadow-[0_0_16px_rgba(244,63,94,0.45)] ring-1 ring-rose-500/70'],
  ['succes', "Offre d'achat validée", "Offre d'achat validée", CheckCircle2, 'border-emerald-500 bg-gradient-to-r from-emerald-500/30 to-teal-600/40 text-emerald-100 shadow-[0_0_16px_rgba(16,185,129,0.45)] ring-1 ring-emerald-500/70'],
  ['veille', 'Veille', 'Veille', Eye, 'border-sky-500 bg-sky-500/20 text-sky-200 shadow-[0_0_15px_rgba(14,165,233,0.35)] ring-1 ring-sky-500/60'],
  ['reponse_demandee', 'Réponse', 'Réponse demandée SVP', MessageSquare, 'border-pink-500 bg-pink-500/20 text-pink-200 shadow-[0_0_15px_rgba(236,72,153,0.35)] ring-1 ring-pink-500/60'],
  ['signature_compromis', 'Signature compromis', 'Signature compromis', PenTool, 'border-amber-400 bg-gradient-to-r from-amber-500/30 to-yellow-600/35 text-[#FAD592] shadow-[0_0_16px_rgba(245,158,11,0.4)] ring-1 ring-amber-400/70'],
  ['signature_acte', 'Signature acte authentique', 'Signature acte authentique', Award, 'border-[#F7BC5F] bg-gradient-to-r from-amber-500/35 to-yellow-500/40 text-white shadow-[0_0_20px_rgba(247,188,95,0.5)] ring-1 ring-[#F7BC5F]'],
] as const;

export type NiveauAnnonce = (typeof NIVEAUX_ANNONCE)[number][0];

export function NiveauxAnnonce({
  value,
  onChange,
}: {
  value: NiveauAnnonce;
  onChange: (niveau: NiveauAnnonce) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <span>Priorité & Catégorie</span>
          <span className="text-slate-600">·</span>
          <span className="text-[11px] text-[#F7BC5F] font-normal normal-case">Choisissez le badge d'alerte</span>
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1.5 custom-scrollbar">
        {NIVEAUX_ANNONCE.map(([niveau, court, complet, Icon, activeCls]) => {
          const isSelected = value === niveau;
          return (
            <button
              key={niveau}
              type="button"
              title={complet}
              aria-pressed={isSelected}
              onClick={() => onChange(niveau)}
              className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 cursor-pointer ${
                isSelected
                  ? `${activeCls} scale-[1.03]`
                  : 'border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.08] hover:border-white/20'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'animate-pulse' : 'opacity-70'}`} />
              <span>{court}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AgencesAnnonce({
  agencyId,
  selectedIds,
  onToggle,
}: {
  agencyId: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const unique = agenceUniqueAnnonce(agencyId);
  if (unique) {
    return (
      <div className="inline-flex items-center gap-2.5 rounded-2xl border border-[#F7BC5F]/60 bg-gradient-to-r from-[#F7BC5F]/20 via-white/[0.05] to-transparent pl-1.5 pr-4 py-1.5 shadow-[0_0_18px_rgba(247,188,95,0.25)]">
        <span className="w-7 h-7 rounded-full bg-white/10 border border-white/20 flex items-center justify-center overflow-hidden p-0.5 shadow-inner">
          <img src={getAgencyLogo(unique.name)} alt="" className="w-full h-full object-contain" />
        </span>
        <span className="text-xs font-bold text-white tracking-wide">{unique.name}</span>
        <span className="text-[10px] text-[#F9C977] font-semibold bg-[#F7BC5F]/20 px-2 py-0.5 rounded-full border border-[#F7BC5F]/30 ml-1">Destinataire</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {sortByAgencyOrder(agencesReelles()).map((agence) => {
        const cochee = selectedIds.includes(agence.id);
        return (
          <button
            key={agence.id}
            type="button"
            aria-pressed={cochee}
            onClick={() => onToggle(agence.id)}
            className={`inline-flex items-center gap-2 rounded-2xl border pl-1.5 pr-3 py-1.5 transition-all cursor-pointer ${
              cochee
                ? 'border-[#F7BC5F] bg-[#F7BC5F]/20 text-white shadow-[0_0_15px_rgba(247,188,95,0.3)] ring-1 ring-[#F7BC5F]/50 scale-[1.02]'
                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center overflow-hidden p-0.5 shadow-sm">
              <img src={getAgencyLogo(agence.name)} alt="" className="w-full h-full object-contain" />
            </span>
            <span className="text-xs font-semibold">{agence.name}</span>
            <span className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${cochee ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-white/30'}`}>
              {cochee && <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
