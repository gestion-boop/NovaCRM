import React, { useState, useEffect, useMemo } from 'react';
import BuildStamp from './BuildStamp';
import {
  Home, LayoutDashboard, Users, GitFork, FolderKanban, Calendar,
  Bell, MessageSquare, Mail, UserPlus, FileText, FileEdit,
  LifeBuoy, Settings, ChevronDown, ChevronLeft, ChevronRight, LogOut,
  Building2, Calculator,
  GraduationCap, Sparkles, Camera as CameraIcon, X, Map as MapIcon, Sun, Moon
} from 'lucide-react';
import { AGENCIES, Agency } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { getAgencyLogo, agencesDisponibles } from '@/lib/agency-logos';
import AgencyLogoSwitcher from './AgencyLogoSwitcher';

export interface SidebarProps {
  currentNav: string;
  onSelectNav: (nav: string) => void;
  selectedAgency: Agency;
  onSelectAgency: (agency: Agency) => void;
  onSignOut: () => void;
  userEmail?: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  unreadRemindersCount?: number;
  unreadNotificationsCount?: number;
  unreadMessagesCount?: number;
  unreadMailCount?: number;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
}

export const NAV_ITEMS = [
  { id: 'accueil', label: 'Accueil', icon: Home },
  { id: 'tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'pipeline', label: 'Pipeline', icon: GitFork },
  { id: 'projets-internes', label: 'Projets internes', icon: FolderKanban },
  { id: 'agenda', label: 'Agenda', icon: Calendar },
  { id: 'rappels', label: 'Rappels', icon: Bell },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'equipe', label: 'Équipe', icon: UserPlus },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'notes', label: 'Notes', icon: FileEdit },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'parametres', label: 'Paramètres', icon: Settings },
  { id: 'assistant-ia', label: 'Nova', icon: Sparkles },
  { id: 'reserver-camera', label: 'Réserver caméra', icon: CameraIcon },
  { id: 'immosphera360', label: 'Immosphera360', icon: Building2 },
  // Académy : bibliothèque de procédures de l'agence. Réservée à ImmoSphera
  // (filtrée juste en dessous, comme la carte Novavisio). Elle figure dans le
  // menu ET dans les tuiles : une entrée de menu se trouve toujours, une
  // tuile dépend de la grille enregistrée de chacun.
  { id: 'academy', label: 'Académy', icon: GraduationCap },
  // Carte de prospection Novavisio (accès aussi filtré côté composant, voir
  // CarteProspectionView.tsx) — même principe que Immosphera360 ci-dessus.
  { id: 'carte-novavisio', label: 'Carte', icon: MapIcon },
  // Comptabilité (6 septembre, Conseils Finances) : prévisionnel de
  // trésorerie sur 12 mois. « Que par les super admins, Mélanie et Sylvain,
  // c'est tout » — filtrée juste en dessous comme carte-novavisio/academy,
  // et re-vérifiée côté contenu dans ComptabiliteView.tsx.
  { id: 'comptabilite', label: 'Comptabilité', icon: Calculator },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentNav,
  onSelectNav,
  selectedAgency,
  onSelectAgency,
  onSignOut,
  userEmail,
  collapsed,
  onToggleCollapse,
  unreadRemindersCount = 0,
  unreadNotificationsCount = 0,
  unreadMessagesCount = 0,
  unreadMailCount = 0,
  mobileOpen = false,
  onCloseMobile,
  isDarkMode,
  onToggleTheme,
}) => {
  const { userProfile, currentUser, activeAgency } = useAuth();
  const [showAgencyMenu, setShowAgencyMenu] = useState(false);

  // Demande explicite (28/08/2026) : "supprime carte pour immosphera dans
  // paramètre et pour conseils finances aussi" — l'onglet "Carte" (carte de
  // prospection Novavisio) était déjà bloqué CÔTÉ CONTENU pour les autres
  // agences (voir CarteProspectionView.tsx, "Cette carte est réservée aux
  // membres de l'agence Novavisio"), mais l'entrée restait visible dans le
  // menu quelle que soit l'agence active, y compris ImmoSphera et Conseils
  // Finances — même principe que canSeeNovavisio dans AccueilGrid.tsx.
  const isNovavisioActive = /novavisio/i.test(activeAgency?.name ?? '');
  const isImmospheraActive = /immosphera/i.test(activeAgency?.name ?? '');
  // 3 septembre : « Réserver caméra pour Conseils Finances ne doit jamais
  // apparaître » — même règle que la tuile (AccueilGrid, tuileVisible).
  const isConseilsFinancesActive = /conseil|finance/i.test(activeAgency?.name ?? '');
  // Comptabilité (6 septembre) : « que par les super admins, Mélanie et
  // Sylvain » — même identification que estDirectionCF dans Dashboard.tsx
  // (nom/email plutôt que le rôle, Mélanie n'étant pas super admin).
  const identiteUtilisateur = `${userProfile?.displayName || currentUser?.displayName || ''} ${userProfile?.email || currentUser?.email || ''}`;
  const estDirectionCF = /grazia|melanie|gestion@immosphera\.fr/i.test(identiteUtilisateur);
  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) =>
          (item.id !== 'carte-novavisio' || isNovavisioActive) &&
          (item.id !== 'academy' || isImmospheraActive) &&
          (item.id !== 'reserver-camera' || !isConseilsFinancesActive) &&
          (item.id !== 'comptabilite' || (isConseilsFinancesActive && estDirectionCF))
      ),
    [isNovavisioActive, isImmospheraActive, isConseilsFinancesActive, estDirectionCF]
  );

  // Filter available agencies according to user rights/profile
  // Règle partagée avec la rangée de logos de l'en-tête (ordre du ticket #228).
  const availableAgencies = useMemo(() => agencesDisponibles(AGENCIES, userProfile), [userProfile]);

  // Read sidebar order & visibility from localStorage
  const [navOrder, setNavOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('novasphere_sidebar_order');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((id: string) => id === 'messagerie' ? 'chat' : id === 'immosphera' ? 'assistant-ia' : id);
        }
      }
    } catch (err) {
      console.warn('Erreur lecture ordre sidebar:', err);
    }
    return NAV_ITEMS.map((item) => item.id);
  });

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const saved = localStorage.getItem('novasphere_sidebar_order');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setNavOrder(parsed.map((id: string) => id === 'messagerie' ? 'chat' : id === 'immosphera' ? 'assistant-ia' : id));
          }
        }
      } catch (err) {
        console.warn('Erreur stockage sidebar:', err);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('novasphere_sidebar_order_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('novasphere_sidebar_order_changed', handleStorageChange);
    };
  }, []);

  // L'ordre des onglets est désormais sauvegardé côté serveur (page
  // Paramètres). On le récupère ici aussi, au démarrage, pour que l'ordre
  // suive l'utilisateur d'un appareil/navigateur à l'autre — même s'il n'a
  // jamais ouvert Paramètres sur cet appareil-là (le localStorage seul ne
  // suffisait pas, il ne persistait que dans le navigateur courant).
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/settings/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const order = data?.ui?.sidebar_order;
        if (Array.isArray(order) && order.length) {
          const normalized = order.map((id: string) => (id === 'messagerie' ? 'chat' : id === 'immosphera' ? 'assistant-ia' : id));
          localStorage.setItem('novasphere_sidebar_order', JSON.stringify(normalized));
          if (!cancelled) setNavOrder(normalized);
        }
      } catch (err) {
        console.warn('Erreur synchronisation ordre sidebar depuis le serveur :', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  const orderedNavItems = useMemo(() => {
    const navMap = new Map(visibleNavItems.map((item) => [item.id, item]));
    const result: typeof NAV_ITEMS = [];

    navOrder.forEach((id) => {
      const found = navMap.get(id);
      if (found) {
        result.push(found);
        navMap.delete(id);
      }
    });

    // append any missing items
    navMap.forEach((item) => result.push(item));
    return result;
  }, [navOrder, visibleNavItems]);

  const handleNavClick = (navId: string) => {
    onSelectNav(navId);
    if (onCloseMobile) onCloseMobile();
  };

  const displayName = userProfile?.displayName || currentUser?.displayName || 'Utilisateur';
  const displayEmail = userProfile?.email || currentUser?.email || userEmail || '';
  const initial = displayName.charAt(0).toUpperCase();

  const sidebarContent = (isMobile: boolean = false) => (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[#081318]">
      {/* Top Header & Agency Picker */}
      <div className="shrink-0">
        {isMobile && (
          <div className="flex justify-end p-4 pb-2">
            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="Fermer le menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Agency Switcher */}
        {(!collapsed || isMobile) && (
          <div className="p-3 relative space-y-2">
            {/* Rangée de logos : un clic = la société, sans ouvrir le menu.
                Demandé le 5 septembre : « supprime le sélecteur vertical des
                agences, augmente les icônes en haut pour améliorer le
                visuel ». Dès qu'il y a un choix, la rangée seule, en grand ;
                le menu déroulant qui la doublait juste en dessous disparaît.
                Une personne à une seule société n'a pas de rangée (rien à
                choisir) : elle garde la ligne qui nomme sa société, comme
                avant. */}
            <AgencyLogoSwitcher
              agencies={availableAgencies}
              selectedId={selectedAgency.id}
              size="lg"
              className="justify-center"
              onSelect={(agency) => {
                onSelectAgency(agency);
                setShowAgencyMenu(false);
              }}
            />
            {availableAgencies.length < 2 && (
            <div className="relative">
            <button
              onClick={() => setShowAgencyMenu(!showAgencyMenu)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5 overflow-hidden w-full">
                {/* Ticket #228 : logo de la société active (logos déjà
                    présents dans le projet, jamais de nouveaux logos). */}
                <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 overflow-hidden p-1">
                  <img src={getAgencyLogo(selectedAgency.name)} alt="" className="w-full h-full object-contain" />
                </div>
                <div className="truncate flex-1">
                  <p className="text-xs font-semibold text-white truncate">{selectedAgency.name}</p>
                  <p className="text-[10px] text-[#F9C977] font-medium">Agence active</p>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
            </button>

            {/* Dropdown Menu for Agencies */}
            {showAgencyMenu && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#0E1A20] border border-white/10 rounded-xl shadow-2xl z-50 p-1 space-y-1 max-h-52 overflow-y-auto custom-scrollbar">
                {availableAgencies.map((agency) => (
                  <button
                    key={agency.id}
                    onClick={() => {
                      onSelectAgency(agency);
                      setShowAgencyMenu(false);
                      if (isMobile && onCloseMobile) onCloseMobile();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                      selectedAgency.id === agency.id
                        ? 'bg-[#F7BC5F]/20 text-[#F7BC5F] font-semibold'
                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded bg-white/10 flex items-center justify-center shrink-0 overflow-hidden p-0.5">
                        <img src={getAgencyLogo(agency.name)} alt="" className="w-full h-full object-contain" />
                      </span>
                      <span className="truncate">{agency.name}</span>
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-1">{agency.city}</span>
                  </button>
                ))}
              </div>
            )}
            </div>
            )}
          </div>
        )}

        {/* Signalé : "je ne vois pas le mode jour et nuit sur le téléphone"
            — le réglage existait déjà (Paramètres > Apparence, 3 choix),
            mais fallait aller le chercher dans un sous-menu. Bouton rapide
            ajouté ici, direct dans le menu mobile, à côté de l'équivalent
            desktop déjà présent dans l'en-tête (masquée sur mobile). */}
        {isMobile && onToggleTheme && (
          <div className="px-3 pb-1">
            <button
              onClick={onToggleTheme}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
            >
              <span className="flex items-center gap-2.5 text-xs font-semibold text-white">
                {isDarkMode ? <Moon className="w-4 h-4 text-[#F7BC5F]" /> : <Sun className="w-4 h-4 text-[#F7BC5F]" />}
                Mode {isDarkMode ? 'sombre' : 'clair'}
              </span>
              <span className="text-[10px] text-gray-400">Changer</span>
            </button>
          </div>
        )}
      </div>

      {/* Navigation list - Scrollable container filling available space */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1 custom-scrollbar -webkit-overflow-scrolling-touch">
        {(!collapsed || isMobile) && (
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 select-none">
            NAVIGATION
          </p>
        )}

        {orderedNavItems.map((item, itemIndex) => {
          const Icon = item.icon;
          const isActive = currentNav === item.id;
          const badgeCount =
            item.id === 'notifications'
              ? unreadNotificationsCount
              : item.id === 'rappels'
              ? unreadRemindersCount
              : item.id === 'chat'
              ? unreadMessagesCount
              : item.id === 'mail'
              ? unreadMailCount
              : 0;
          const showBadge = badgeCount > 0;

          return (
            <React.Fragment key={item.id}>
              {/* Ticket (nouvelle base, signalé) : séparateurs entre les
                  entrées + texte/icônes agrandis sur mobile, pour une
                  lecture plus confortable dans le menu plein écran. */}
              {isMobile && itemIndex > 0 && <div className="h-px bg-white/10 mx-2" />}
              <button
                data-tour={`nav-${item.id}`}
                onClick={() => handleNavClick(item.id)}
                title={collapsed && !isMobile ? `${item.label}${showBadge ? ` (${badgeCount})` : ''}` : undefined}
                className={`w-full flex items-center justify-between transition-all duration-150 cursor-pointer ${
                  isMobile ? 'px-4 py-4 rounded-2xl text-base font-semibold' : 'px-3 py-2.5 rounded-xl text-xs font-medium'
                } ${
                  isActive
                    ? 'bg-[#282112]/90 text-[#F7BC5F] border border-[#F7BC5F]/80 shadow-sm font-semibold'
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                } ${collapsed && !isMobile ? 'justify-center px-0' : ''}`}
              >
                <div className={`flex items-center min-w-0 ${isMobile ? 'gap-4' : 'gap-3'}`}>
                  <Icon className={`shrink-0 ${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isActive ? 'text-[#F7BC5F]' : 'text-gray-400'}`} />
                  {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
                </div>
              {(!collapsed || isMobile) && showBadge && (
                <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-red-500 text-white shadow-sm shrink-0">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
              {collapsed && !isMobile && showBadge && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#081318]" />
              )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* User Profile Footer */}
      <div className="shrink-0 p-3 border-t border-white/5 bg-[#081318]">
        {(!collapsed || isMobile) ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-white/5 p-2 rounded-xl border border-white/5">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-[#F7BC5F] text-black font-bold flex items-center justify-center text-sm shrink-0">
                  {initial}
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-white truncate">{displayName}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {displayEmail}
                  </p>
                </div>
              </div>
              <button
                onClick={onSignOut}
                title="Déconnexion"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 text-center select-none">
              © 2026 Nova CRM
            </p>
          </div>
        ) : (
          <button
            onClick={onSignOut}
            title="Déconnexion"
            className="w-full py-2 flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  // Fermeture au clavier (Échap) — la navigation complète au clavier à
  // l'intérieur du panneau vient gratuitement des <button> natifs.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      {/* Panneau de navigation "Menu" — coulisse depuis la gauche, sur mobile
          ET sur desktop (avant : colonne fixe en permanence sur desktop ;
          maintenant : ouvert à la demande via le bouton "Menu" du header,
          ne redimensionne jamais le contenu principal puisqu'il est en
          position fixed/overlay, pas dans le flux du layout).
          Toujours monté (comme le tiroir des notifications) et animé
          uniquement via les classes — sans ça, la fermeture se faisait par
          démontage instantané du composant, donc sans aucune transition. */}
      <div
        id="novasphere-nav-menu"
        className={`fixed inset-0 z-50 flex items-stretch p-3 sm:p-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ transition: 'opacity 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navigation"
      >
        {/* Voile */}
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onCloseMobile}
        />
        {/* Panneau coulissant — flottant, coins arrondis partout, liseré doré.
            Durée/courbe posées en style inline (pas en classe Tailwind
            arbitraire) pour éliminer tout doute sur une classe non générée
            correctement au build — l'animation était perçue comme abrupte
            malgré plusieurs hausses de durée en classes utilitaires. */}
        {/* Ticket (nouvelle base, signalé) : le tiroir mobile restait un
            panneau étroit à 85vw — texte serré, peu lisible. Il prend
            désormais tout l'écran sur mobile (grand écrit, séparateurs
            entre chaque entrée), et garde sa largeur fixe sur desktop. */}
        <div
          className={`relative w-full md:w-[270px] md:max-w-[270px] bg-[#081318] border border-[#F7BC5F]/50 rounded-3xl md:rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ transition: 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        >
          {sidebarContent(true)}
          {/* Identité du build, tout en bas du menu : la réponse immédiate à
              « est-ce que ma mise à jour est bien arrivée ? ». */}
          <BuildStamp />
        </div>
      </div>
    </>
  );
};

export default Sidebar;