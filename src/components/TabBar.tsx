import React from 'react';
import { Plus, X } from 'lucide-react';

// Onglets internes à l'application installée (desktop) — demandé le 7
// octobre : « dans le menu burger, il faut ouvrir l'élément dans un nouvel
// onglet [...] pour pouvoir travailler par exemple sur le même client une
// tâche et une autre interface une note où travailler sur deux clients
// séparées ». L'app installée tourne en `display: standalone` (voir
// useIsStandalone.ts) : ce mode n'a pas de vraie barre d'onglets navigateur
// à exploiter, contrairement à la version Web — cette barre la remplace,
// entièrement maison.
//
// Version 1 (confirmée explicitement) : chaque onglet retient quel écran et
// quel client sont ouverts, mais se recharge à chaque fois qu'on y revient —
// pas de mémoire de défilement ni de brouillon entre deux changements
// d'onglet. Couvre l'usage demandé (deux dossiers ouverts en parallèle) sans
// reconstruire toute la zone de rendu de App.tsx, qui ne monte aujourd'hui
// qu'une seule vue à la fois.
export interface AppTabSummary {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: AppTabSummary[];
  activeTabId: string;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
}

const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, onSwitch, onClose, onNewTab }) => {
  const canClose = tabs.length > 1;
  return (
    <div className="shrink-0 flex items-stretch gap-1 px-2 pt-2 bg-[#050c0f] border-b border-white/10 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSwitch(tab.id); } }}
            className={`group flex items-center gap-2 pl-3 pr-2 py-2 rounded-t-lg text-xs font-medium cursor-pointer max-w-[200px] shrink-0 transition-colors ${
              active
                ? 'bg-[#0E1A20] text-white border border-b-0 border-white/10'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
            title={tab.label}
          >
            <span className="truncate">{tab.label}</span>
            {canClose && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="shrink-0 p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                title="Fermer l'onglet"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onNewTab}
        className="shrink-0 px-2.5 py-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-t-lg transition-colors"
        title="Nouvel onglet"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default TabBar;
