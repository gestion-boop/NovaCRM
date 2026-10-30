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
  // Affiche uniquement les agences autorisées en excluant NovaSphere ("all")
  const agenciesAffichees = agencies.filter((a) => a.id !== 'all');
  const dim = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : 'w-9 h-9 sm:w-10 sm:h-10';
  const espace = size === 'lg' ? 'gap-2 p-1.5' : 'gap-1.5 p-1';

  // Si l'utilisateur n'a qu'une seule société affectée (cloisonnement strict) :
  // on affiche fièrement son logo et son nom, sans permettre de switcher.
  if (agenciesAffichees.length === 1) {
    const agency = agenciesAffichees[0];
    const isNovavisio = /novavisio/i.test(agency.name);
    const isImmosphera = /immosphera/i.test(agency.name);
    const nomComplet = isNovavisio
      ? 'NovaVisio'
      : isImmosphera
        ? 'ImmoSphera'
        : agency.name;
    const iconDim = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-9 h-9' : 'w-7 h-7 sm:w-8 sm:h-8';
    const activeHeight = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-12' : 'h-9 sm:h-10';

    return (
      <div
        aria-label={`Société : ${nomComplet}`}
        className={`flex items-center rounded-xl bg-[#0b1c1e] border border-white/10 ${espace} ${className}`}
      >
        <div
          title={nomComplet}
          className={`px-2.5 py-1 gap-1.5 ${activeHeight} shrink-0 rounded-lg flex items-center justify-center p-1 select-none ${
            isNovavisio
              ? 'bg-gradient-to-r from-[#1B7D8F]/45 to-[#264C8A]/55 ring-2 ring-[#38BDF8] opacity-100 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
              : 'bg-[#F7BC5F]/25 ring-2 ring-[#F7BC5F] opacity-100 shadow-[0_0_14px_rgba(247,188,95,0.25)]'
          }`}
        >
          <img
            src={getAgencyLogo(agency.id === 'all' ? null : agency.name)}
            alt={nomComplet}
            className={`${iconDim} object-contain shrink-0`}
            draggable={false}
          />
          <span
            className={`text-[11px] sm:text-xs font-extrabold tracking-tight whitespace-nowrap pr-0.5 ${
              isNovavisio
                ? 'bg-gradient-to-r from-white via-[#67E8F9] to-[#93C5FD] bg-clip-text text-transparent'
                : 'bg-gradient-to-r from-white via-[#FEF08A] to-[#F7BC5F] bg-clip-text text-transparent'
            }`}
          >
            {nomComplet}
          </span>
        </div>
      </div>
    );
  }

  if (agenciesAffichees.length === 0) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Société active"
      className={`flex items-center rounded-xl bg-[#0b1c1e] border border-white/10 ${espace} ${className}`}
    >
      {agenciesAffichees.map((agency) => {
        const active = agency.id === selectedId;
        const isNovavisio = /novavisio/i.test(agency.name);
        const isImmosphera = /immosphera/i.test(agency.name);
        const nomComplet = isNovavisio
          ? 'NovaVisio'
          : isImmosphera
            ? 'ImmoSphera'
            : agency.name;
        const libelle = agency.id === 'all' ? 'Toutes les sociétés' : nomComplet;
        const iconDim = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-9 h-9' : 'w-7 h-7 sm:w-8 sm:h-8';
        const activeHeight = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-12' : 'h-9 sm:h-10';
        return (
          <button
            key={agency.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={libelle}
            aria-label={libelle}
            onClick={() => onSelect(agency)}
            className={`${active ? `px-2.5 py-1 gap-1.5 ${activeHeight}` : dim} shrink-0 rounded-lg flex items-center justify-center p-1 transition-all cursor-pointer ${
              active
                ? isNovavisio
                  ? 'bg-gradient-to-r from-[#1B7D8F]/45 to-[#264C8A]/55 ring-2 ring-[#38BDF8] opacity-100 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
                  : 'bg-[#F7BC5F]/25 ring-2 ring-[#F7BC5F] opacity-100 shadow-[0_0_14px_rgba(247,188,95,0.25)]'
                : 'bg-white/15 opacity-95 hover:opacity-100 hover:bg-white/25'
            }`}
          >
            <img
              src={getAgencyLogo(agency.id === 'all' ? null : agency.name)}
              alt=""
              className={`${active ? iconDim : 'w-full h-full'} object-contain shrink-0`}
              draggable={false}
            />
            {active && (
              <span
                className={`text-[11px] sm:text-xs font-extrabold tracking-tight whitespace-nowrap pr-0.5 ${
                  isNovavisio
                    ? 'bg-gradient-to-r from-white via-[#67E8F9] to-[#93C5FD] bg-clip-text text-transparent'
                    : 'bg-gradient-to-r from-white via-[#FEF08A] to-[#F7BC5F] bg-clip-text text-transparent'
                }`}
              >
                {nomComplet}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default AgencyLogoSwitcher;
