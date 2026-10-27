import React, { useMemo, useRef, useState } from 'react';

import {
  Bell,
  Calendar,
  CornerDownLeft,
  FileText,
  Folder,
  HelpCircle,
  Home,
  Layers,
  Loader2,
  Maximize,
  Menu as MenuIcon,
  MessageSquare,
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
  demanderOuvrirDossierAccueil, type Resultat, type TypeResultat,
} from '@/lib/rechercheGlobale';

import {
  useAuth,
} from '@/context/AuthContext';
import AgencyLogoSwitcher from './AgencyLogoSwitcher';
import { agencesDisponibles } from '@/lib/agency-logos';
import { AGENCIES } from '@/types';

import { supabase } from '@/lib/supabase';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { UpdateStatusBadge } from './UpdateStatusBadge';

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

const getResultIcon = (type: TypeResultat) => {
  switch (type) {
    case 'client':
      return <Users className="w-4 h-4 text-emerald-400" />;
    case 'pipeline':
      return <Layers className="w-4 h-4 text-amber-400" />;
    case 'message':
      return <MessageSquare className="w-4 h-4 text-sky-400" />;
    case 'rdv':
      return <Calendar className="w-4 h-4 text-rose-400" />;
    case 'rappel':
      return <Bell className="w-4 h-4 text-orange-400" />;
    case 'dossier':
      return <Folder className="w-4 h-4 text-purple-400" />;
    case 'document':
      return <FileText className="w-4 h-4 text-teal-400" />;
    case 'note':
      return <FileText className="w-4 h-4 text-yellow-400" />;
    default:
      return <Search className="w-4 h-4 text-[#F7BC5F]" />;
  }
};

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
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const modalInputRef = useRef<HTMLInputElement>(null);

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

  const flatResults = useMemo(() => {
    return groupes.flatMap((g) => g.items);
  }, [groupes]);

  React.useEffect(() => {
    if (isSearchModalOpen) {
      setActiveResultIndex(0);
      const timer = window.setTimeout(() => {
        modalInputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [isSearchModalOpen]);

  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // ⌘K (Mac) ou Ctrl+K (Windows/Linux) pour ouvrir/fermer la recherche
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchModalOpen((open) => !open);
      } else if (e.key === 'Escape' && isSearchModalOpen) {
        setIsSearchModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isSearchModalOpen]);

  const handleModalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsSearchModalOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatResults.length > 0) {
        setActiveResultIndex((prev) => (prev + 1) % flatResults.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatResults.length > 0) {
        setActiveResultIndex((prev) => (prev - 1 + flatResults.length) % flatResults.length);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults[activeResultIndex]) {
        ouvrirResultat(flatResults[activeResultIndex]);
      } else if (flatResults.length > 0) {
        ouvrirResultat(flatResults[0]);
      }
    }
  };

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
    setIsSearchModalOpen(false);
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
      {/* ACCUEIL, MENU & SÉLECTEUR DE SOCIÉTÉ TOUT À GAUCHE */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Icône "Accueil" (la maison) tout à gauche */}
        <button
          type="button"
          onClick={() => onNavigate?.('accueil')}
          title="Retour à l'accueil"
          className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center rounded-xl bg-[#0b1c1e] hover:bg-[#102a2d] border border-white/10 text-gray-300 hover:text-[#F7BC5F] transition-colors cursor-pointer"
        >
          <Home className="w-4 h-4" />
        </button>

        {/* Bouton "Menu" */}
        <button
          data-tour="header-menu"
          type="button"
          onClick={onToggleMobileMenu}
          aria-expanded={menuOpen}
          aria-controls="novasphere-nav-menu"
          className="flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3 rounded-xl bg-[#0b1c1e] hover:bg-[#102a2d] border border-[#F7BC5F]/25 text-gray-200 hover:text-white transition-colors shrink-0 cursor-pointer"
        >
          <MenuIcon className="w-4 h-4 text-[#F7BC5F]" />
          <span className="hidden sm:inline text-xs font-semibold">Menu</span>
        </button>

        {/* Sélecteur de société par logos : 100% interactif, nom et logo complets sans doublon */}
        <AgencyLogoSwitcher
          agencies={societesAccessibles}
          selectedId={selectedAgencyId || activeAgency.id}
          onSelect={setActiveAgency}
          className="shrink-0"
        />

        <div className="hidden xl:flex items-center gap-1 shrink-0">
          <span className="text-[10px] sm:text-xs bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/40 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 shadow-sm shrink-0">
            <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>{contacts.length}</span>
          </span>
        </div>
      </div>

      {/* RECHERCHE - BOUTON D'ACCÈS RAPIDE QUI OUVRE LA GRANDE BARRE SPOTLIGHT */}
      <div data-tour="header-search" className="hidden md:flex items-center flex-1 max-w-xs xl:max-w-md mx-3 relative shrink min-w-[42px]">
        <button
          type="button"
          onClick={() => {
            setIsSearchModalOpen(true);
          }}
          className="w-full flex items-center justify-between gap-2.5 h-9 sm:h-10 px-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-[#F7BC5F]/50 text-gray-400 hover:text-white transition-all shadow-inner group cursor-pointer"
          title="Ouvrir la recherche globale (⌘K ou Ctrl+K)"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Search className="w-4 h-4 text-gray-400 group-hover:text-[#F7BC5F] transition-colors shrink-0" />
            <span className="hidden sm:inline text-xs text-gray-300 group-hover:text-white truncate">
              Rechercher partout dans NovaCRM…
            </span>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/50 border border-white/10 text-[10px] font-mono font-bold text-gray-400 group-hover:text-[#F7BC5F] shrink-0 shadow-sm">
            <span>⌘</span>K
          </kbd>
        </button>
      </div>

      {/* OUTILS HEADER */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        <button
          data-tour="header-nouveau-lead"
          onClick={onOpenNouveauLead}
          title="Nouveau lead"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-r from-[#c68e36] to-[#a36f20] hover:from-[#d49b3f] hover:to-[#b07b27] text-slate-950 font-black flex items-center justify-center shadow-md border border-[#F7BC5F]/30 active:scale-95 transition-all shrink-0 cursor-pointer"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
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

        {/* Voyant Mise à jour : discret, s'affiche en orange uniquement si une mise à jour est en attente */}
        <UpdateStatusBadge onlyWhenPending className="inline-flex" />

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

      {/* GRANDE BARRE DE RECHERCHE SPOTLIGHT (PLEINE LARGEUR, MODALE CENTRÉE) */}
      {isSearchModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-start justify-center pt-[8vh] sm:pt-[12vh] px-3 sm:px-4 animate-in fade-in duration-150"
          onClick={() => setIsSearchModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl nv-card-hero rounded-2xl shadow-2xl border border-[#F7BC5F]/40 overflow-hidden relative flex flex-col max-h-[78vh] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Liseré supérieur lumineux doré */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] bg-gradient-to-r from-transparent via-[#F7BC5F] to-transparent opacity-95" />

            {/* Barre de recherche grand format */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-white/10 bg-black/40">
              <Search className="w-5 h-5 text-[#F7BC5F] shrink-0" />
              <input
                ref={modalInputRef}
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveResultIndex(0);
                }}
                onKeyDown={handleModalKeyDown}
                placeholder="Rechercher un client, pipeline, message, note, agenda..."
                className="flex-1 bg-transparent text-sm sm:text-base text-white placeholder-gray-400 outline-none font-medium"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Effacer la saisie"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsSearchModalOpen(false)}
                className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-gray-400 hover:text-white text-xs font-mono font-semibold transition-colors"
                title="Fermer (Échap)"
              >
                Échap
              </button>
            </div>

            {/* Corps des résultats / suggestions */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
              {searchQuery.trim().length === 0 ? (
                <div className="py-8 px-4 text-center space-y-2">
                  <p className="text-xs sm:text-sm text-gray-300 font-medium">
                    Tapez un nom, prénom, numéro, dossier, message ou événement...
                  </p>
                  <p className="text-xs text-gray-500">
                    Recherche instantanée dans l'ensemble des données de <span className="text-[#F7BC5F] font-semibold">{activeAgencyLabel}</span>.
                  </p>
                </div>
              ) : (
                <>
                  {rechercheEnCours && (
                    <div className="px-4 py-2 text-xs text-gray-400 flex items-center gap-2 bg-white/[0.02] rounded-xl border border-white/5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F7BC5F]" />
                      Recherche dans les affaires, messages et l'agenda…
                    </div>
                  )}

                  {!rechercheEnCours && flatResults.length === 0 && (
                    <div className="py-10 text-center text-sm text-gray-400">
                      {searchQuery.trim().length < 2
                        ? 'Tapez au moins deux lettres pour lancer la recherche.'
                        : `Aucun résultat trouvé pour « ${searchQuery.trim()} ».`}
                    </div>
                  )}

                  {groupes.map((g) => (
                    <div key={g.type} className="space-y-1">
                      <div className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#F7BC5F]/80 flex items-center justify-between">
                        <span>{g.libelle}</span>
                        <span className="text-[10px] text-gray-500 font-normal">{g.items.length} résultat{g.items.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-1">
                        {g.items.map((r) => {
                          const itemIndex = flatResults.indexOf(r);
                          const isSelected = itemIndex === activeResultIndex;
                          return (
                            <button
                              key={r.cle}
                              type="button"
                              onMouseEnter={() => setActiveResultIndex(itemIndex)}
                              onClick={() => ouvrirResultat(r)}
                              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/40 shadow-sm'
                                  : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                                  isSelected ? 'bg-[#F7BC5F]/20 border-[#F7BC5F]/40 shadow-sm' : 'bg-black/40 border-white/10'
                                }`}>
                                  {getResultIcon(r.type)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-white truncate flex items-center gap-2">
                                    <span>{r.titre}</span>
                                  </div>
                                  {r.sousTitre && (
                                    <div className="text-xs text-gray-400 truncate mt-0.5">{r.sousTitre}</div>
                                  )}
                                </div>
                              </div>
                              <CornerDownLeft className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-opacity ${isSelected ? 'opacity-100 text-[#F7BC5F]' : 'opacity-0'}`} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Pied de page avec raccourcis clavier */}
            <div className="px-4 py-2.5 border-t border-white/10 bg-black/50 flex items-center justify-between text-[11px] text-gray-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-gray-300">↑</kbd>
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-gray-300">↓</kbd>
                  Naviguer
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-gray-300">↵</kbd>
                  Ouvrir
                </span>
              </div>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-gray-300">Échap</kbd>
                Fermer
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;