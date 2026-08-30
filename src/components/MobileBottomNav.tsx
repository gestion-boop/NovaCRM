import React from 'react';
import { Home, Menu } from 'lucide-react';
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

// Barre de navigation mobile simplifiée (demande explicite) : Accueil tout
// à gauche, logo Nova IA au centre, Menu tout à droite — Chat et Alertes ne
// sont plus ici (Chat est accessible depuis le dock de l'accueil, Alertes
// via la clochette remontée dans l'en-tête mobile). Moins d'éléments ici =
// plus d'espace pour les tuiles au centre de l'écran.
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentNav,
  onNavigate,
  onOpenMobileMenu,
  onOpenNova,
}) => {
  return (
    // Logo Nova redimensionné pour tenir dans la hauteur de la barre,
    // centré verticalement entre le haut et le bas (trop gros/débordant
    // avant, avec un -mt-24 qui le sortait complètement de la case).
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#081318]/95 backdrop-blur-md border-t border-white/10 px-6 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex items-center justify-between select-none shadow-2xl">
      <button
        onClick={() => onNavigate('accueil')}
        className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl transition-all cursor-pointer ${
          currentNav === 'accueil' ? 'text-[#F7BC5F] font-bold scale-105' : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Home className="w-8 h-8" />
        <span className="text-sm font-semibold mt-1">Accueil</span>
      </button>

      <button
        onClick={onOpenNova}
        title="Nova"
        className="flex items-center justify-center active:scale-95 transition-transform"
      >
        <NovaMascotte taille={56} />
      </button>

      <button
        onClick={onOpenMobileMenu}
        className="flex flex-col items-center justify-center py-1.5 px-3 rounded-xl transition-all cursor-pointer text-gray-400 hover:text-gray-200"
      >
        <Menu className="w-8 h-8" />
        <span className="text-sm font-semibold mt-1">Menu</span>
      </button>
    </nav>
  );
};

export default MobileBottomNav;
