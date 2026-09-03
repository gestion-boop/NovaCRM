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
  // Action d'écriture propre à l'écran Mail (demande explicite : « en bas,
  // la barre pour l'accueil tout à gauche, nova et peut être un + pour créer
  // un mail »). Absente ailleurs : la barre reprend alors ses trois boutons.
  onCompose?: () => void;
  // Libellé du « + » : « Écrire » sur la messagerie, « Ajouter » sur l'agenda.
  composeLabel?: string;
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
  onCompose,
  composeLabel = 'Écrire',
}) => {
  return (
    // Demandé le 1er septembre, capture d'Instagram à l'appui : une barre
    // flottante en capsule, détachée du bord, fond translucide avec flou,
    // contour fin, et une pastille sombre derrière l'élément actif.
    //
    // Consigne explicite qui va avec : « les mêmes icônes, on ne change
    // rien ». Seule la FORME change donc — mêmes boutons, mêmes tailles,
    // mêmes libellés, même ordre, même « + » doré. Et la hauteur totale est
    // conservée au pixel près (le rembourrage extérieur reprend ce que la
    // capsule ajoute), pour ne pas rouvrir les tickets #13 et #18 où le
    // dernier message et le composeur passaient dessous.
    //
    // `pointer-events-none` sur le cadre, `auto` sur la capsule : les coins
    // laissés libres de chaque côté ne doivent pas avaler les touchers
    // destinés au contenu de la page.
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 px-3 pt-1 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] select-none pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md rounded-[2rem] bg-[#081318]/80 backdrop-blur-xl border border-white/15 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.8)] px-4 py-1.5 flex items-center justify-between">
      <button
        onClick={() => onNavigate('accueil')}
        className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all cursor-pointer ${
          currentNav === 'accueil' ? 'text-[#F7BC5F] font-bold bg-white/10' : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Home className="w-8 h-8" />
        <span className="text-sm font-semibold mt-1">Accueil</span>
      </button>

      {onCompose && (
        <button
          onClick={onCompose}
          title={composeLabel}
          className="flex flex-col items-center justify-center py-1.5 px-2 rounded-xl transition-all cursor-pointer text-[#F7BC5F] active:scale-95"
        >
          <span className="w-8 h-8 rounded-full bg-[#F7BC5F] text-[#061719] flex items-center justify-center">
            <Plus className="w-6 h-6" strokeWidth={3} />
          </span>
          <span className="text-sm font-semibold mt-1">{composeLabel}</span>
        </button>
      )}

      {/* Demande (3 septembre) : logo Nova fixe, puis « grossis-le sur le
          mobile » — 84 px, il déborde un peu au-dessus de la barre sans la
          rehausser (hauteur du bouton inchangée). */}
      <button
        onClick={onOpenNova}
        title="Nova"
        className="flex items-center justify-center h-[60px] w-[84px] -mt-3 active:scale-95 transition-transform"
      >
        <NovaMascotte taille={84} fixe />
      </button>

      <button
        onClick={onOpenMobileMenu}
        className="flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all cursor-pointer text-gray-400 hover:text-gray-200"
      >
        <Menu className="w-8 h-8" />
        <span className="text-sm font-semibold mt-1">Menu</span>
      </button>
      </div>
    </nav>
  );
};

export default MobileBottomNav;
