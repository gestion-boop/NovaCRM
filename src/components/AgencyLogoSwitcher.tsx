import React from 'react';
import type { Agency } from '@/types';
import { getAgencyLogo } from '@/lib/agency-logos';

// Demande de Sylvain (3 septembre) : « mettre les 3 logos en haut pour bien
// sélectionner les sociétés », pour le super admin et les personnes à deux
// sociétés comme Karine — le menu déroulant était trop pénible. Une rangée
// de logos, un clic = la société. Ne s'affiche que s'il y a un choix.
interface Props {
  agencies: Agency[];
  selectedId: string;
  onSelect: (agency: Agency) => void;
  size?: 'sm' | 'md';
  className?: string;
}

const AgencyLogoSwitcher: React.FC<Props> = ({ agencies, selectedId, onSelect, size = 'md', className = '' }) => {
  if (agencies.length < 2) return null;
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9 sm:w-10 sm:h-10';
  return (
    <div
      role="radiogroup"
      aria-label="Société active"
      className={`flex items-center gap-1.5 rounded-xl bg-[#0b1c1e] border border-white/10 p-1 ${className}`}
    >
      {agencies.map((agency) => {
        const active = agency.id === selectedId;
        const libelle = agency.id === 'all' ? 'Toutes les sociétés' : agency.name;
        return (
          <button
            key={agency.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={libelle}
            aria-label={libelle}
            onClick={() => onSelect(agency)}
            className={`${dim} shrink-0 rounded-lg flex items-center justify-center p-1 transition-all ${
              active
                ? 'bg-[#F7BC5F]/20 ring-2 ring-[#F7BC5F] opacity-100'
                : 'bg-white/5 opacity-50 hover:opacity-100 hover:bg-white/10'
            }`}
          >
            <img src={getAgencyLogo(agency.id === 'all' ? null : agency.name)} alt="" className="w-full h-full object-contain" draggable={false} />
          </button>
        );
      })}
    </div>
  );
};

export default AgencyLogoSwitcher;
