import React from 'react';
import { useAppUpdateStatus } from '@/lib/updateStatus';
import { useModaleOuverte } from '@/hooks/useModaleOuverte';
import { Bell, Home, Menu, Plus, Search, Settings } from 'lucide-react';

interface DesktopBottomDockProps {
  currentNav: string;
  onNavigate: (nav: string) => void;
  onToggleMenu: () => void;
  onOpenNouveauLead: () => void;
  onOpenSearch: () => void;
  onOpenNova: () => void;
  onOpenNotifications: () => void;
  unreadCount: number;
  actifs?: Partial<Record<'menu' | 'plus' | 'nova' | 'search' | 'bell', boolean>>;
}

// Test (branche test uniquement) : barre du bas tablette/ordinateur, même
// style que la barre mobile. Sur les fenêtres de travail (Pipeline...), elle
// remplace la barre du haut pour libérer la place en hauteur.
const btn = 'relative flex items-center justify-center h-12 w-14 rounded-full text-slate-300 hover:text-[#F7BC5F] transition-all cursor-pointer active:scale-95';
const actif = 'bg-white/15 !text-[#F7BC5F] shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_2px_4px_rgba(0,0,0,0.5)]';

export const DesktopBottomDock: React.FC<DesktopBottomDockProps> = ({
  currentNav, onNavigate, onToggleMenu, onOpenNouveauLead, onOpenSearch, onOpenNova, onOpenNotifications, unreadCount, actifs = {},
}) => {
  const { isUpdatePending } = useAppUpdateStatus();
  const modaleOuverte = useModaleOuverte();
  const rouge = isUpdatePending || unreadCount > 0;
  return (
  <nav data-barre-bas className={`hidden md:flex fixed bottom-3 left-0 right-0 z-40 justify-center pointer-events-none select-none transition-all duration-200 ${modaleOuverte ? 'opacity-0 translate-y-6 invisible' : ''}`}>
    <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-gradient-to-b from-[#16262b]/95 via-[#0d181c]/95 to-[#070e11]/95 backdrop-blur-2xl border border-[#F7BC5F]/45 shadow-[0_14px_30px_-6px_rgba(0,0,0,0.95),0_3px_0_0_rgba(247,188,95,0.12),inset_0_2px_3px_rgba(255,255,255,0.22),inset_0_-3px_5px_rgba(0,0,0,0.55),0_0_10px_rgba(247,188,95,0.1)] px-2 py-1.5">
      <button onClick={() => onNavigate('accueil')} title="Accueil" aria-label="Accueil" className={`${btn} ${currentNav === 'accueil' ? actif : ''}`}>
        <Home className="w-7 h-7" strokeWidth={currentNav === 'accueil' ? 2.6 : 2} />
      </button>
      <button onClick={onToggleMenu} title="Menu" aria-label="Menu" className={`${btn} ${actifs.menu ? actif : ''}`}>
        <Menu className="w-7 h-7" strokeWidth={2} />
      </button>
      <button onClick={onOpenNouveauLead} title="Créer un lead" aria-label="Créer un lead" className={`${btn} ${actifs.plus ? actif : ''}`}>
        <Plus className="w-7 h-7" strokeWidth={2.4} />
      </button>
      <button onClick={onOpenNova} title="Nova" aria-label="Nova" className="relative flex items-center justify-center h-14 w-16 active:scale-90 transition-transform cursor-pointer group">
        <span className={`flex items-center justify-center w-13 h-13 rounded-full bg-[#0a2528]/95 border-2 border-[#F7BC5F] ring-2 ring-[#F7BC5F]/30 shadow-[0_0_14px_rgba(247,188,95,0.4)] group-hover:scale-105 transition-transform ${actifs.nova ? 'bg-[#F7BC5F]/35' : ''}`} style={{ width: 52, height: 52 }}>
          <img src="/nova-mascotte.png" alt="" className="w-10 h-10 object-contain" />
        </span>
      </button>
      <button onClick={onOpenSearch} title="Rechercher" aria-label="Rechercher" className={`${btn} ${actifs.search ? actif : ''}`}>
        <Search className="w-7 h-7" strokeWidth={2} />
      </button>
      <button onClick={onOpenNotifications} title="Notifications" aria-label="Notifications" className={`${btn} ${actifs.bell ? actif : ''}`}>
        <Bell className={`w-7 h-7 ${rouge ? 'text-rose-400 animate-pulse' : 'text-emerald-400'} hover:text-[#F7BC5F]`} strokeWidth={2} />
        {rouge && (
          <span className="absolute top-1 right-2 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : '!'}
          </span>
        )}
      </button>
      <button onClick={() => onNavigate('parametres')} title="Paramètres" aria-label="Paramètres" className={`${btn} ${currentNav === 'parametres' ? actif : ''}`}>
        <Settings className="w-7 h-7" strokeWidth={currentNav === 'parametres' ? 2.6 : 2} />
      </button>
    </div>
  </nav>
  );
};

export default DesktopBottomDock;
