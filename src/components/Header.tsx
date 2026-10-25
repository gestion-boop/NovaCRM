import React, { useMemo, useRef, useState } from 'react';

import {
  Bell,
  HelpCircle,
  Home,
  Loader2,
  Maximize,
  Menu as MenuIcon,
  Mic,
  Minimize,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';

import {
  useContacts,
} from '@/hooks/useContacts';
import {
  chercherClients, chercherAccueil, chercherADistance, grouper, demanderAgendaAllerA,
  demanderOuvrirDossierAccueil, type Resultat,
} from '@/lib/rechercheGlobale';

import {
  useAuth,
} from '@/context/AuthContext';
import AgencyLogoSwitcher from './AgencyLogoSwitcher';
import { agencesDisponibles } from '@/lib/agency-logos';
import { AGENCIES } from '@/types';

import { supabase } from '@/lib/supabase';
import { TEAM_MEMBERS } from '@/data/teamMembers';

interface HeaderProps {
  onOpenNouveauLead: () => void;
  onOpenClientDictation?: () => void;
  onOpenSqlImport?: () => void;
  onOpenTutorial: () => void;
  onOpenCameraReservation?: () => void;

  unreadCount?: number;

  isDarkMode: boolean;
  onToggleTheme: () => void;

  selectedAgencyName: string;
  selectedAgencyId?: string;

  onNavigate?: (
    nav: string
  ) => void;

  onSelectContact?: (
    contactId: string
  ) => void;

  onOpenMessage?: (messageId: string) => void;

  onToggleMobileMenu?: () => void;
  onToggleNotifications?: () => void;
  // État du panneau "Menu" (partagé avec le tiroir mobile existant) — sert
  // uniquement à l'accessibilité (aria-expanded) du bouton "Menu" du header.
  menuOpen?: boolean;
}

export const Header: React.FC<
  HeaderProps
> = ({
  onOpenNouveauLead,
  onOpenClientDictation,
  onOpenSqlImport,
  onOpenTutorial,
  onOpenCameraReservation,

  unreadCount = 0,

  isDarkMode,
  onToggleTheme,

  selectedAgencyName,
  selectedAgencyId,

  onNavigate,
  onSelectContact,
  onOpenMessage,

  onToggleMobileMenu,
  onToggleNotifications,
  menuOpen = false,
}) => {
  const {
    activeAgency,
    userProfile,
    currentUser,
    setActiveAgency,
  } = useAuth();

  // Sociétés accessibles, pour la rangée de logos (super admin, ou personne
  // rattachée à plusieurs sociétés comme Karine).
  const societesAccessibles = useMemo(() => agencesDisponibles(AGENCIES, userProfile), [userProfile]);


  const agencyLogoByName: Record<string, string> = {
    'conseils finances': '/Logo%20ConseilsFinances.png',
    'novavisio': '/Logo%20NovaVisio.png',
    'immosphera': '/Logo%20Immosphera.png',
    'novasphere': '/nova-mascotte.png',
    'toutes les sociétés': '/nova-mascotte.png',
  };

  const normalizeAgencyName = (value?: string) => (value || '').trim().toLowerCase();
  const rawAgencyName = selectedAgencyName || activeAgency?.name || '';
  const activeAgencyLabel = /novavisio/i.test(rawAgencyName)
    ? 'NovaVisio'
    : /immosphera/i.test(rawAgencyName)
      ? 'ImmoSphera'
      : /conseil/i.test(rawAgencyName)
        ? 'Conseils Finances'
        : 'NovaCRM';
  const currentAgencyLogo = agencyLogoByName[normalizeAgencyName(selectedAgencyName || activeAgency?.name)] || agencyLogoByName[normalizeAgencyName(activeAgency?.name)] || '/nova-mascotte.png';

  const {
    contacts = [],
  } = useContacts();


  const handleNotificationsClick = () => {
    onToggleNotifications?.();
  };

  // ── Recherche client/dossier — filtre la vraie liste de contacts déjà
  // chargée (useContacts, plus haut) et ouvre la fiche via le même chemin
  // que partout ailleurs dans l'app (onSelectContact → setSelectedClientProfileId).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Plein écran navigateur (Fullscreen API) — équivalent desktop de
  // l'affichage "app installée" sans barre du navigateur qu'on a sur
  // mobile. `fullscreenchange` couvre aussi une sortie via Échap.
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== 'undefined' && !!document.fullscreenElement
  );
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };
  // Recherche globale (3 septembre : « le maximum de mots du CRM : prénoms,
  // rendez-vous, noms des dossiers… »). Les sources locales (clients déjà
  // chargés, tuiles et dossiers de l'accueil, écrans) répondent à la frappe ;
  // les sources distantes (agenda, rappels, documents, projets, notes,
  // équipe) sont interrogées 250 ms après la dernière touche.
  const resultatsLocaux = useMemo<Resultat[]>(() => {
    const q = searchQuery.trim();
    if (!q) return [];
    return [...chercherClients(contacts as any, q), ...chercherAccueil(activeAgency?.id, q, activeAgency)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, contacts, activeAgency?.id]);
  const [resultatsDistants, setResultatsDistants] = useState<Resultat[]>([]);
  const [rechercheEnCours, setRechercheEnCours] = useState(false);
  React.useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setResultatsDistants([]); setRechercheEnCours(false); return; }
    let annule = false;
    setRechercheEnCours(true);
    const minuteur = window.setTimeout(() => {
      chercherADistance(activeAgency?.id, q)
        .then((r) => { if (!annule) setResultatsDistants(r); })
        .finally(() => { if (!annule) setRechercheEnCours(false); });
    }, 250);
    return () => { annule = true; window.clearTimeout(minuteur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, activeAgency?.id]);
  const groupes = useMemo(() => grouper([...resultatsLocaux, ...resultatsDistants]), [resultatsLocaux, resultatsDistants]);
  const ouvrirResultat = (r: Resultat) => {
    const a = r.action;
    if (a.genre === 'client') onSelectContact?.(a.contactId);
    else if (a.genre === 'nav') onNavigate?.(a.nav);
    else if (a.genre === 'dossier-accueil') { onNavigate?.('accueil'); demanderOuvrirDossierAccueil(a.dossierId); }
    else if (a.genre === 'agenda') { onNavigate?.('agenda'); demanderAgendaAllerA(a.date); }
    else if (a.genre === 'lien') window.open(a.url, '_blank', 'noopener,noreferrer');
    else if (a.genre === 'message') onOpenMessage?.(a.messageId);
    setSearchQuery('');
    setSearchFocused(false);
  };

  const displayName = userProfile?.displayName || currentUser?.displayName || currentUser?.email || 'Utilisateur';
  const avatarPhotoUrl =
    userProfile?.photoURL ||
    currentUser?.photoURL ||
    TEAM_MEMBERS.find((m) => m.email.toLowerCase() === (currentUser?.email || '').toLowerCase())?.avatarUrl ||
    null;
  const avatarInitials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join('') || 'U';

  return (
    // Barre du haut masquée en mobile : la navigation du bas (Accueil / Chat
    // / IA / Alertes / Menu) couvre déjà tous ces accès sur petit écran.
    <header className="hidden md:flex bg-[#081318] border-b border-white/5 px-2.5 sm:px-6 items-center justify-between z-40 shrink-0 select-none pt-[env(safe-area-inset-top,0px)] min-h-[3.5rem] sm:min-h-[4rem] pb-1.5 sm:pb-0">
      {/* BRAND + MENU */}
      <div className="flex items-center gap-1.5 sm:gap-3 overflow-hidden">
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <img
            data-tour="header-logo"
            src={currentAgencyLogo}
            alt={activeAgencyLabel}
            className="w-7 h-7 sm:w-9 sm:h-9 rounded-full object-contain border border-[#F7BC5F]/40 shadow-md shrink-0 bg-[#0a2528]"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.currentTarget;
              target.onerror = null;
              target.src = "/icon-192.png";
            }}
          />

          <span className="text-white font-bold text-sm sm:text-xl tracking-tight hidden sm:inline-block whitespace-nowrap">
            {activeAgencyLabel}
          </span>
        </div>

        {/* Icône "Accueil" — toujours visible, ramène directement à l'accueil
            depuis n'importe quelle tuile/page, comme un bouton retour
            universel (aucune des pages ouvertes depuis une tuile n'a de
            bouton retour propre). */}
        <button
          type="button"
          onClick={() => onNavigate?.('accueil')}
          title="Retour à l'accueil"
          className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center rounded-lg bg-[#0b1c1e] hover:bg-[#102a2d] border border-white/10 text-gray-300 hover:text-[#F7BC5F] transition-colors"
        >
          <Home className="w-4 h-4" />
        </button>

        {/* Bouton "Menu" — ouvre le panneau de navigation coulissant (Sidebar
            en mode overlay, réutilisé tel quel : mêmes routes, permissions,
            badges et ordre personnalisable qu'avant). */}
        <button
          data-tour="header-menu"
          type="button"
          onClick={onToggleMobileMenu}
          aria-expanded={menuOpen}
          aria-controls="novasphere-nav-menu"
          className="flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3 rounded-lg bg-[#0b1c1e] hover:bg-[#102a2d] border border-[#F7BC5F]/25 text-gray-200 hover:text-white transition-colors shrink-0"
        >
          <MenuIcon className="w-4 h-4 text-[#F7BC5F]" />
          <span className="hidden sm:inline text-xs font-semibold">Menu</span>
        </button>

        {/* Sélecteur de société par logos : un clic, sans menu déroulant. */}
        <AgencyLogoSwitcher
          agencies={societesAccessibles}
          selectedId={selectedAgencyId || activeAgency.id}
          onSelect={setActiveAgency}
          className="shrink-0"
        />

        <div className="hidden lg:flex items-center gap-1 sm:gap-2 overflow-hidden">
          <span className="text-[10px] sm:text-xs bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/40 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-bold flex items-center gap-1 shadow-sm shrink-0">
            <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>{contacts.length}</span>
          </span>
        </div>
      </div>

      {/* RECHERCHE */}
      <div data-tour="header-search" className="hidden md:block flex-1 max-w-md mx-4 relative">
        <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setSearchQuery(''); (e.currentTarget as HTMLInputElement).blur(); }
            if (e.key === 'Enter' && groupes.length > 0) ouvrirResultat(groupes[0].items[0]);
          }}
          placeholder="Rechercher : client, pipeline, message…"
          className="w-full bg-[#0b1c1e] border border-white/10 focus:border-[#F7BC5F]/50 rounded-xl pl-10 pr-9 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-500 hover:text-white hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {searchFocused && searchQuery.trim() && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-[#0E1A20] border border-white/10 rounded-xl shadow-2xl z-50 py-1.5 max-h-[70vh] overflow-y-auto custom-scrollbar">
            {groupes.map((g) => (
              <div key={g.type} className="py-1">
                <div className="px-3.5 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[#F7BC5F]/80">{g.libelle}</div>
                {g.items.map((r) => (
                  <button
                    key={r.cle}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => ouvrirResultat(r)}
                    className="w-full text-left px-3.5 py-1.5 hover:bg-white/5 transition-colors"
                  >
                    <div className="text-sm text-gray-100 truncate">{r.titre}</div>
                    {r.sousTitre && <div className="text-[11px] text-gray-500 truncate">{r.sousTitre}</div>}
                  </button>
                ))}
              </div>
            ))}
            {rechercheEnCours && (
              <div className="px-3.5 py-2 text-[11px] text-gray-500 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Recherche dans le pipeline, les messages, l'agenda…
              </div>
            )}
            {!rechercheEnCours && groupes.length === 0 && (
              <div className="px-3.5 py-2 text-xs text-gray-500">
                {searchQuery.trim().length < 2 ? 'Tape au moins deux lettres.' : `Aucun résultat pour « ${searchQuery.trim()} ».`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* OUTILS HEADER */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {onOpenClientDictation && (
          <button
            onClick={onOpenClientDictation}
            title="Dicter une note vocale directement dans une fiche client"
            className="bg-white/5 hover:bg-white/10 border border-[#F7BC5F]/35 text-[#FAD592] hover:text-white font-semibold text-xs px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-95 shrink-0 cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5 text-[#F7BC5F]" />
            <span className="hidden lg:inline">Dictée client</span>
          </button>
        )}

        <button
          data-tour="header-nouveau-lead"
          onClick={onOpenNouveauLead}
          className="bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-xs px-2.5 sm:px-3.5 py-1.5 rounded-lg flex items-center gap-1 shadow-md hover:shadow-gold/20 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span className="hidden sm:inline">Nouveau lead</span>
          <span className="sm:hidden text-[11px] font-bold">Lead</span>
        </button>

        <button
          data-tour="header-theme"
          onClick={onToggleTheme}
          title="Changer de thème"
          className="p-1.5 sm:p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5 shrink-0"
        >
          {isDarkMode ? (
            <Sun className="w-4 h-4 text-[#F9C977]" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>

        <button
          data-tour="header-fullscreen"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Quitter le plein écran' : 'Passer en plein écran (comme sur mobile)'}
          className="hidden md:flex p-1.5 sm:p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5 shrink-0"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>

        <button
          data-tour="header-tutoriel"
          onClick={onOpenTutorial}
          className="hidden md:flex items-center gap-1.5 text-xs text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
        >
          <HelpCircle className="w-4 h-4 text-[#F7BC5F]" />
          <span>Tutoriel</span>
        </button>

        {/* Bouton "Réserver caméra" retiré du header (la tuile "Réserver
            caméra" dans "Mes espaces" reste le seul accès désormais). */}

        {/* AVATAR — ticket #17 (nouvelle base) : l'avatar tout à droite du
            header restait toujours en initiales, jamais la vraie photo,
            même quand le profil (ou l'annuaire équipe) en a une. */}
        <button
          data-tour="header-avatar"
          onClick={() => onNavigate?.('parametres')}
          title={displayName}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#F7BC5F]/15 border border-[#F7BC5F]/40 text-[#F7BC5F] font-bold text-xs sm:text-sm flex items-center justify-center shrink-0 hover:bg-[#F7BC5F]/25 transition-colors overflow-hidden"
        >
          {avatarPhotoUrl ? (
            <img src={avatarPhotoUrl} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            avatarInitials
          )}
        </button>

        {/* ROUE PARAMÈTRES — remplace l'ancienne tuile "Paramètres Système"
            de l'accueil, placée juste à côté de la clochette. */}
        <button
          data-tour="header-settings"
          onClick={() => onNavigate?.('parametres')}
          title="Paramètres"
          className="p-1.5 sm:p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5 shrink-0"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* CLOCHETTE : CENTRE NOTIFICATIONS — tout à droite du header
            (après l'avatar), demandé pour rester visible en dernier sur
            desktop. */}
        <button
          data-tour="header-bell"
          onClick={handleNotificationsClick}
          className="p-1.5 sm:p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5 relative shrink-0"
          title="Ouvrir le centre de notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white font-bold text-[9px] min-w-3.5 h-3.5 px-1 rounded-full flex items-center justify-center shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

      </div>
    </header>
  );
};

export default Header;