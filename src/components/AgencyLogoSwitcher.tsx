import React from 'react';
import type { Agency } from '@/types';
import { getAgencyLogo } from '@/lib/agency-logos';

// Demande de Sylvain (3 septembre) : « mettre les 3 logos en haut pour bien
// sélectionner les sociétés », pour le super admin et les personnes à deux
// sociétés comme Karine — le menu déroulant était trop pénible. Une rangée
// de logos bien éclairés (retour de Sylvain : « trop sombre avant la
// sélection »), le logo actif cerclé d'or ; un clic = la société.
// Ne s'affiche que s'il y a un choix.
interface Props {
  agencies: Agency[];
  selectedId: string;
  onSelect: (agency: Agency) => void;
  // 'lg' : la rangée du menu (5 septembre, « augmente les icônes en haut »).
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const AgencyLogoSwitcher: React.FC<Props> = ({ agencies, selectedId, onSelect, size = 'md', className = '' }) => {
  // Demandé le 6 septembre : « enlève le logo de NovaSphere sur mobile et
  // desktop, il ne sert à rien pour l'instant » — masqué, pas supprimé : on
  // pourrait en avoir besoin plus tard. Le logo NovaSphere est celui de la
  // pseudo-agence « Toutes les sociétés » (id 'all'), un temps ajoutée à la
  // liste ; elle disparaît juste de cette rangée, la fonctionnalité reste
  // intacte pour qui y accède autrement (ex. sélecteur du menu).
  const agenciesAffichees = agencies.filter((a) => a.id !== 'all');
  if (agenciesAffichees.length < 2) return null;
  const dim = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : 'w-9 h-9 sm:w-10 sm:h-10';
  const espace = size === 'lg' ? 'gap-2 p-1.5' : 'gap-1.5 p-1';
  return (
    <div
      role="radiogroup"
      aria-label="Société active"
      className={`flex items-center rounded-xl bg-[#0b1c1e] border border-white/10 ${espace} ${className}`}
    >
      {agenciesAffichees.map((agency) => {
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
                ? 'bg-[#F7BC5F]/25 ring-2 ring-[#F7BC5F] opacity-100'
                : 'bg-white/15 opacity-95 hover:opacity-100 hover:bg-white/25'
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
