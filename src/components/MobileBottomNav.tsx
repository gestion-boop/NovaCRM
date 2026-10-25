import React, { useEffect, useRef, useState } from 'react';
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
  // Demande explicite (24 octobre) : « quand on scroll vers le bas, la
  // barre du bas disparaît et dès qu'on scroll vers le haut elle
  // réapparaît de suite ». Le défilement de toute l'appli se fait dans
  // <main> (voir le commentaire au-dessus de <main> dans App.tsx), jamais
  // sur `window` — d'où un écouteur posé directement sur cet élément
  // plutôt que sur `window`, qui ne verrait jamais défiler quoi que ce
  // soit. Petit seuil (6px) avant de réagir : sans lui, le léger rebond
  // élastique iOS en haut/bas de liste faisait clignoter la barre pour
  // rien ; toujours visible tant qu'on est près du tout-haut (24px).
  const [visible, setVisible] = useState(true);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    setVisible(true);
  }, [currentNav]);

  useEffect(() => {
    if (currentNav === 'accueil') {
      setVisible(true);
      return;
    }
    const scrollEl = document.querySelector('main');
    if (!scrollEl) return;
    lastScrollTopRef.current = scrollEl.scrollTop;
    let autoShowTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      const top = scrollEl.scrollTop;
      const delta = top - lastScrollTopRef.current;
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      const isNearBottom = maxScroll - top < 80;

      // Signalé en revue (25 octobre) : `lastScrollTopRef` était réassigné à
      // CHAQUE événement scroll, même quand aucun des seuils n'était
      // franchi — un défilement lent (un événement par image, donc par ex.
      // ~2-3px à 60Hz) ne faisait alors jamais franchir le seuil, les petits
      // écarts ne s'additionnant jamais. On ne déplace maintenant l'ancre
      // que lorsqu'un seuil est vraiment franchi (ou tout en haut/bas), pour
      // que les écarts dans le même sens se cumulent entre deux mises à jour.
      if (top <= 32 || isNearBottom) {
        setVisible(true);
        lastScrollTopRef.current = top;
      } else if (delta > 15) {
        setVisible(false);
        lastScrollTopRef.current = top;
      } else if (delta < -8) {
        setVisible(true);
        lastScrollTopRef.current = top;
      }

      if (autoShowTimer) clearTimeout(autoShowTimer);
      autoShowTimer = setTimeout(() => {
        setVisible(true);
      }, 1400);
    };
    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      if (autoShowTimer) clearTimeout(autoShowTimer);
    };
  }, [currentNav]);

  return (
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-40 px-4 pt-0 pb-[calc(0.45rem+env(safe-area-inset-bottom,0px))] select-none pointer-events-none transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'translate-y-[calc(100%+1rem+env(safe-area-inset-bottom,0px))]'
      }`}
    >
      <div className="pointer-events-auto mx-auto max-w-[280px] sm:max-w-xs rounded-full bg-gradient-to-r from-[#081f23]/95 via-[#0a272c]/95 to-[#081f23]/95 backdrop-blur-2xl border border-teal-500/30 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.9),0_0_20px_rgba(247,188,95,0.1)] px-4 py-1.5 flex items-center justify-between relative overflow-hidden">
        {/* Liseré supérieur doré */}
        <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#F7BC5F]/70 to-transparent pointer-events-none" />

        <button
          onClick={() => onNavigate('accueil')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all cursor-pointer active:scale-95 ${
            currentNav === 'accueil' ? 'text-[#F7BC5F] font-black' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="w-5 h-5 stroke-[2.2]" />
          <span className="text-[10px] font-bold mt-0.5 tracking-tight">Accueil</span>
        </button>

        <button
          onClick={onOpenNova}
          title="Nova"
          aria-label="Nova"
          className="relative flex items-center justify-center h-10 w-12 active:scale-90 transition-transform group cursor-pointer"
        >
          <div className="absolute inset-0 rounded-full bg-[#F7BC5F]/20 blur-md group-hover:bg-[#F7BC5F]/35 transition-colors" />
          <NovaMascotte taille={42} fixe />
        </button>

        <button
          onClick={onOpenMobileMenu}
          className="flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition-all cursor-pointer text-slate-400 hover:text-slate-200 active:scale-95"
        >
          <Menu className="w-5 h-5 stroke-[2.2]" />
          <span className="text-[10px] font-bold mt-0.5 tracking-tight">Menu</span>
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
