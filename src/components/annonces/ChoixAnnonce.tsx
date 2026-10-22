import { Check } from 'lucide-react';
import { getAgencyLogo, sortByAgencyOrder } from '@/lib/agency-logos';
import { agenceUniqueAnnonce, agencesReelles } from '@/lib/agencesAnnonce';

export const NIVEAUX_ANNONCE = [
  ['info', 'Info', 'Information', 'border-[#F7BC5F]/50 text-[#F9C977]'],
  ['a_verifier', 'À vérifier', 'À vérifier', 'border-amber-500/40 text-amber-300'],
  ['important', 'Important', 'Important', 'border-rose-500/50 text-rose-300'],
  ['succes', "Offre d'achat validée", "Offre d'achat validée", 'border-emerald-500/40 text-emerald-300'],
  ['veille', 'Veille', 'Veille', 'border-sky-500/40 text-sky-300'],
  ['reponse_demandee', 'Réponse', 'Réponse demandée SVP', 'border-rose-500/50 text-rose-300'],
  ['signature_compromis', 'Signature compromis', 'Signature compromis', 'border-[#F7BC5F]/50 text-[#F9C977]'],
  ['signature_acte', 'Signature acte authentique', 'Signature acte authentique', 'border-[#F7BC5F]/50 text-[#F9C977]'],
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
    <div className="space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Niveau</span>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {NIVEAUX_ANNONCE.map(([niveau, court, complet, cls]) => (
          <button
            key={niveau}
            type="button"
            title={complet}
            aria-pressed={value === niveau}
            onClick={() => onChange(niveau)}
            className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors ${cls} ${
              value === niveau ? 'bg-white/10' : 'bg-[#071f21] hover:bg-white/5'
            }`}
          >
            {court}
          </button>
        ))}
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
      <div className="inline-flex items-center gap-2 rounded-full border border-[#F7BC5F] bg-[#F7BC5F]/10 pl-1 pr-3 py-1">
        <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center overflow-hidden p-0.5">
          <img src={getAgencyLogo(unique.name)} alt="" className="w-full h-full object-contain" />
        </span>
        <span className="text-xs font-semibold text-white">{unique.name}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sortByAgencyOrder(agencesReelles()).map((agence) => {
        const cochee = selectedIds.includes(agence.id);
        return (
          <button
            key={agence.id}
            type="button"
            aria-pressed={cochee}
            onClick={() => onToggle(agence.id)}
            className={`inline-flex items-center gap-2 rounded-full border pl-1 pr-2.5 py-1 transition-colors ${
              cochee ? 'border-[#F7BC5F] bg-[#F7BC5F]/10' : 'border-[#1c4448] bg-[#071f21] hover:border-white/20'
            }`}
          >
            <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center overflow-hidden p-0.5">
              <img src={getAgencyLogo(agence.name)} alt="" className="w-full h-full object-contain" />
            </span>
            <span className="text-xs font-semibold text-white">{agence.name}</span>
            <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${cochee ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-white/25'}`}>
              {cochee && <Check className="w-2.5 h-2.5 text-slate-950" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
