import React, { useEffect, useRef, useState } from 'react';
import { Home, Mic, Plus, Search, Settings } from 'lucide-react';
import NovaMascotte from './NovaMascotte';

interface MobileBottomNavProps {
  currentNav: string;
  onNavigate: (nav: string) => void;
  onOpenMobileMenu?: () => void;
  onOpenNouveauLead?: () => void;
  onOpenSearch?: () => void;
  // Éléments « ouverts » (recherche, +, Nova) : icône jaune tant qu'ils le sont.
  actifs?: Partial<Record<'plus' | 'nova' | 'search', boolean>>;
  onOpenNotifications: () => void;
  // Ouvre le tiroir de saisie rapide (MobileNovaSheet) au lieu de naviguer
  // directement — plus rapide sur mobile, pas de changement d'écran complet
  // avant même d'avoir tapé/dicté une demande.
  onOpenNova: () => void;
  onOpenDictation?: () => void;
  onOpenClientDictation?: () => void;
  unreadMessagesCount?: number;
  unreadNotificationsCount?: number;
  unreadRemindersCount?: number;
}

// Barre du bas : Accueil, +, Nova, Recherche, Paramètres, et un bouton
// micro rouge discret placé juste au-dessus du logo central Nova pour la dictée vocale directe.
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentNav,
  onNavigate,
  onOpenNouveauLead,
  onOpenSearch,
  actifs = {},
  onOpenNova,
  onOpenDictation,
  onOpenClientDictation,
}) => {
  const handleDictation = onOpenDictation || onOpenClientDictation;
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
        visible ? 'translate-y-0' : 'translate-y-[calc(100%+2.5rem+env(safe-area-inset-bottom,0px))]'
      }`}
    >
      <div className="relative mx-auto max-w-[360px] flex flex-col items-center">
        {/* Micro dictée vocale directe Nova — placé au-dessus du logo central en rouge discret */}
        {handleDictation && (
          <button
            type="button"
            onClick={handleDictation}
            title="Dictée vocale directe Nova"
            aria-label="Dictée vocale directe Nova"
            className="pointer-events-auto mb-1.5 w-9 h-9 rounded-full bg-gradient-to-b from-[#2a0e14]/90 via-[#20090d]/90 to-[#160609]/90 border border-rose-500/40 hover:border-rose-400/70 text-rose-300 hover:text-white flex items-center justify-center shadow-[0_2px_12px_rgba(244,63,94,0.35)] backdrop-blur-xl active:scale-90 transition-all cursor-pointer group"
          >
            <Mic className="w-4 h-4 text-rose-400 group-hover:text-rose-200 transition-colors" />
          </button>
        )}

        {/* Barre façon Instagram (demande du 2 novembre) : Accueil · + lead ·
            Nova · Recherche · Paramètres, icônes seules. */}
        <div className="pointer-events-auto w-full rounded-full bg-gradient-to-b from-[#16262b]/95 via-[#0d181c]/95 to-[#070e11]/95 backdrop-blur-2xl border border-[#F7BC5F]/45 shadow-[0_14px_30px_-6px_rgba(0,0,0,0.95),0_3px_0_0_rgba(247,188,95,0.12),inset_0_2px_3px_rgba(255,255,255,0.22),inset_0_-3px_5px_rgba(0,0,0,0.55),0_0_10px_rgba(247,188,95,0.1)] px-2 py-1.5 flex items-center justify-between">
          <button
            onClick={() => onNavigate('accueil')}
            title="Accueil"
            aria-label="Accueil"
            className={`flex items-center justify-center h-12 w-14 rounded-full transition-all cursor-pointer active:scale-95 ${
              currentNav === 'accueil' ? 'bg-white/15 text-[#F7BC5F] shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_2px_4px_rgba(0,0,0,0.5)]' : 'text-slate-300 hover:text-[#F7BC5F]'
            }`}
          >
            <Home className="w-7 h-7" strokeWidth={currentNav === 'accueil' ? 2.6 : 2} />
          </button>

          <button
            onClick={onOpenNouveauLead}
            title="Créer un lead"
            aria-label="Créer un lead"
            className={`flex items-center justify-center h-12 w-14 rounded-full transition-all cursor-pointer active:scale-95 ${actifs.plus ? 'bg-white/15 text-[#F7BC5F] shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_2px_4px_rgba(0,0,0,0.5)]' : 'text-slate-300 hover:text-[#F7BC5F]'}`}
          >
            <Plus className="w-7 h-7" strokeWidth={2.4} />
          </button>

          <button
            onClick={onOpenNova}
            title="Nova"
            aria-label="Nova"
            className={`relative flex items-center justify-center h-12 w-14 rounded-full active:scale-90 transition-transform group cursor-pointer ${actifs.nova ? 'bg-[#F7BC5F]/30' : ''}`}
          >
            <NovaMascotte taille={42} fixe />
          </button>

          <button
            onClick={onOpenSearch}
            title="Rechercher"
            aria-label="Rechercher"
            className={`flex items-center justify-center h-12 w-14 rounded-full transition-all cursor-pointer active:scale-95 ${actifs.search ? 'bg-white/15 text-[#F7BC5F] shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_2px_4px_rgba(0,0,0,0.5)]' : 'text-slate-300 hover:text-[#F7BC5F]'}`}
          >
            <Search className="w-7 h-7" strokeWidth={2} />
          </button>

          <button
            onClick={() => onNavigate('parametres')}
            title="Paramètres"
            aria-label="Paramètres"
            className={`flex items-center justify-center h-12 w-14 rounded-full transition-all cursor-pointer active:scale-95 ${
              currentNav === 'parametres' ? 'bg-white/15 text-[#F7BC5F] shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_2px_4px_rgba(0,0,0,0.5)]' : 'text-slate-300 hover:text-[#F7BC5F]'
            }`}
          >
            <Settings className="w-7 h-7" strokeWidth={currentNav === 'parametres' ? 2.6 : 2} />
          </button>
        </div>
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
