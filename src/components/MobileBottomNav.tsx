import React from 'react';
import { Home, Menu, Plus } from 'lucide-react';
import NovaMascotte from './NovaMascotte';

interface MobileBottomNavProps {
  currentNav: string;
  onNavigate: (nav: string) => void;
  onOpenMobileMenu: () => void;
  onOpenNotifications: () => void;
  // Ouvre le tiroir de saisie rapide (MobileNovaSheet) au lieu de naviguer
  // directement — plus rapide sur mobile, pas de changement d'écran complet
  // avant même d'avoir tapé/dicté une demande.
  onOpenNova: () => void;
  unreadMessagesCount?: number;
  unreadNotificationsCount?: number;
  unreadRemindersCount?: number;
}

// Barre du bas : trois éléments seulement (Accueil, Nova, Menu). Le « + »
// est remonté en haut de l'écran. La capsule est volontairement basse pour
// ne plus couvrir la flèche « Réduire » des tuiles.
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentNav,
  onNavigate,
  onOpenMobileMenu,
  onOpenNova,
}) => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 px-4 pt-0 pb-[calc(0.35rem+env(safe-area-inset-bottom,0px))] select-none pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-sm rounded-full bg-[#081318]/80 backdrop-blur-xl border border-white/15 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)] px-5 py-1 flex items-center justify-between">
      <button
        onClick={() => onNavigate('accueil')}
        className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all cursor-pointer ${
          currentNav === 'accueil' ? 'text-[#F7BC5F] font-bold bg-white/10' : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Home className="w-5 h-5" />
        <span className="text-[11px] font-semibold mt-0.5">Accueil</span>
      </button>

      <button
        onClick={onOpenNova}
        title="Nova"
        aria-label="Nova"
        className="flex items-center justify-center h-10 w-12 active:scale-95 transition-transform"
      >
        <NovaMascotte taille={44} fixe />
      </button>

      <button
        onClick={onOpenMobileMenu}
        className="flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all cursor-pointer text-gray-400 hover:text-gray-200"
      >
        <Menu className="w-5 h-5" />
        <span className="text-[11px] font-semibold mt-0.5">Menu</span>
      </button>
      </div>
    </nav>
  );
};

// Le « + » (lead, message ou rendez-vous selon l'écran) reste atteignable
// sans rallonger la barre du bas. Sur l'accueil il est dans l'en-tête, pas ici.
export const MobileTopPlus: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className="md:hidden fixed z-40 top-[calc(0.55rem+env(safe-area-inset-top,0px))] right-3 w-10 h-10 rounded-full bg-[#F7BC5F] text-[#061719] flex items-center justify-center shadow-md active:scale-95"
  >
    <Plus className="w-5 h-5" strokeWidth={3} />
  </button>
);

export default MobileBottomNav;
