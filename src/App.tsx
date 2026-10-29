import React, { useState, useEffect, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, Maximize2, ChevronLeft, Bell } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useContacts } from '@/hooks/useContacts';
import { useTasks } from '@/hooks/useTasks';
import { countTodayAndOverdueTasks } from '@/lib/taskUtils';
import { updateCssAccentVars, updateCssCalendarAccentVars } from '@/utils/theme';
import { cibleDepuisLien } from '@/lib/lienNotification';

// Components
import Auth from './components/Auth';
import ClientAuth from './components/ClientAuth';
import Header from './components/Header';
import Sidebar, { NAV_ITEMS } from './components/Sidebar';
import TabBar from './components/TabBar';
import AccueilGrid from './components/AccueilGrid';
const Dashboard = lazy(() => import('./components/Dashboard'));
const Contacts = lazy(() => import('./components/Contacts'));
const Clients = lazy(() => import('./components/leads/Clients'));
const Pipeline = lazy(() => import('./components/Pipeline'));
const ComptabiliteView = lazy(() => import('./components/ComptabiliteView'));
import NouveauLeadModal from './components/NouveauLeadModal';
import QuickClientDictationModal from './components/QuickClientDictationModal';
import TutorialModal from './components/TutorialModal';
import ProductTour, { TourStep } from './components/ProductTour';
import SqlImportModal from './components/SqlImportModal';
import CameraReservationModal from './components/CameraReservationModal';
import AnnouncementBanner from './components/AnnouncementBanner';

// Subview components
const ProjetsInternes = lazy(() => import('./components/ProjetsInternes'));
import StagiaireShell from './components/StagiaireShell';
import ClientGuestShell from './components/ClientGuestShell';
const AgendaView = lazy(() => import('./components/AgendaView'));
const StatistiquesEtiquettesView = lazy(() => import('./components/StatistiquesEtiquettesView'));
const RappelsView = lazy(() => import('./components/RappelsView'));
import ChatView from './components/ChatViewSupabase';
const MailView = lazy(() => import('./components/MailView'));
const EquipeView = lazy(() => import('./components/EquipeView'));
const DocumentsView = lazy(() => import('./components/DocumentsView'));
const CarteProspectionView = lazy(() => import('./components/CarteProspectionView'));
const AcademyView = lazy(() => import('./components/AcademyView'));
const NotesView = lazy(() => import('./components/NotesView'));
const SupportView = lazy(() => import('./components/SupportView'));
const ParametresView = lazy(() => import('./components/ParametresView'));
const AssistantIAView = lazy(() => import('./components/AssistantIAView'));
const ReserverCameraView = lazy(() => import('./components/ReserverCameraView'));
const ClientProfileView = lazy(() => import('./components/ClientProfileView'));
import NotificationsView from './components/NotificationsView';
import MobileBottomNav, { MobileTopPlus } from './components/MobileBottomNav';
import MobileHeader from './components/MobileHeader';
import PublicQuestionnaire from './components/PublicQuestionnaire';
import PublicConsentement from './components/PublicConsentement';
import PublicVisiteImmosphera from './immosphera/pages/TourView';
import { EVENEMENT_COMPOSER_MAIL } from './lib/composerMail';
import { EcranErrorBoundary } from './components/EcranErrorBoundary';
import UpdateBanner from './components/UpdateBanner';
import { applyUpdateOnNavigation } from './lib/updateStatus';
import GoogleWorkspaceStatus from './components/GoogleWorkspaceStatus';
import AutoEnablePush from './components/AutoEnablePush';
import EnablePushPrompt from './components/EnablePushPrompt';
import MobileHome from './components/MobileHome';
import { useIsMobile, useIsCoarsePointer } from '@/hooks/use-mobile';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
const Immosphera = lazy(() => import('./immosphera/Immosphera'));
import { SidebarProvider as ImmoSidebarProvider } from './contexts/SidebarContext';

export // Affiché le temps qu'un écran se télécharge. Volontairement discret : sur
// une bonne connexion il n'apparaît qu'une fraction de seconde.
const ChargementEcran = () => (
  <div className="flex items-center justify-center py-24">
    <div className="w-8 h-8 rounded-full border-2 border-[#F7BC5F] border-t-transparent animate-spin" />
  </div>
);

function getRestoredNavigation(): { nav: string; clientId: string | null; tab?: 'espace-client' } | null {
  try {
    const raw = sessionStorage.getItem('novasphere:restore-nav');
    if (raw) {
      sessionStorage.removeItem('novasphere:restore-nav');
      const data = JSON.parse(raw);
      if (data && (!data.timestamp || Date.now() - data.timestamp < 10 * 60 * 1000)) {
        return data;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function App() {
  const [restoredNav] = useState(() => getRestoredNavigation());
  const { currentUser, userProfile, activeAgency, setActiveAgency, authLoading, internGateMessage, logout } = useAuth();
  const { unreadNotificationsCount, unreadMobileNotificationsCount, unreadMessagesCount, unreadMailCount, openSupportTicketsCount, refreshUnreadNotifications, refreshUnreadMail } = useDashboardStats();
  const { addContact, contacts } = useContacts();
  const { tasks = [] } = useTasks();
  const isMobile = useIsMobile();
  const isCoarsePointer = useIsCoarsePointer();
  // Onglets (7 octobre, « ouvrir dans un nouvel onglet [...] dans
  // l'application »). Essayé d'abord réservé à l'app installée (PWA
  // standalone) : la détection (display-mode: standalone) s'est avérée peu
  // fiable en pratique — l'app de l'utilisateur passe par un outil tiers qui
  // transforme le site en appli Mac sans toujours déclarer ce mode
  // correctement, et perdait même l'état en plein écran. Demandé ensuite
  // (toujours le 7 octobre) : « mets ce système en place aussi en version
  // web mais pas mobile » — la distinction web/app installée n'a donc plus
  // lieu d'être, seule la largeur d'écran compte désormais (comme déjà pour
  // la plupart des choix d'interface mobile/desktop de cette application).
  const canUseTabs = !isMobile;
  // Agence active = Immosphera ? Sert au cloisonnement des écrans réservés à
  // cette agence (voir la vue Statistiques plus bas).
  const estAgenceImmosphera = /immosphera/i.test(activeAgency?.name ?? '');
  const estAgenceNovavisio =
    /novavisio/i.test(activeAgency?.name ?? '') ||
    activeAgency?.id === '0cd9362c-316e-4b57-af0b-b6cea092961b';

  const unreadRemindersCount = countTodayAndOverdueTasks(tasks);

  // Agency & Layout state
  // Ouverture directe sur la messagerie quand l'app est chargée depuis le
  // lien d'une notification push (?highlight=<messageId> sur /messagerie) —
  // sinon le clic sur la notification rouvrait toujours l'accueil.
  const cibleMessagerieInitiale = (() => {
    try {
      if (window.location.pathname.startsWith('/messagerie')) {
        return cibleDepuisLien(window.location.pathname + window.location.search);
      }
    } catch { /* noop */ }
    return {};
  })();
  const initialHighlightMessageId = cibleMessagerieInitiale.messageId || null;
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (1/16) : la sélection
  // jaune du menu ne dépendait d'aucune route réelle — juste de cet état
  // React remis à "accueil" à chaque montage, donc perdue après une
  // actualisation (F5 sur "Équipe" retombait sur Accueil, avec le menu qui
  // ne correspondait plus à l'écran affiché). On dérive maintenant l'état
  // initial du chemin d'URL, et on le resynchronise à chaque navigation
  // (cf. useEffect plus bas) — un refresh garde donc le bon écran ET le
  // bon surlignage, quel que soit l'onglet.
  const initialNavFromUrl = (() => {
    try {
      const path = window.location.pathname.replace(/^\/+/, '');
      if (!path) return null;
      if (NAV_ITEMS.some((item) => item.id === path)) return path;
    } catch { /* noop */ }
    return null;
  })();
  // CORRECTIF (31/08/2026) — « React error #426 : a component suspended while
  // responding to synchronous input ».
  //
  // Depuis que les écrans sont chargés à la demande, changer d'onglet peut
  // suspendre le rendu le temps que le fichier arrive. React refuse qu'une
  // mise à jour SYNCHRONE (un clic) provoque une suspension : il remplace
  // alors brutalement l'interface par le rond de chargement, et lève cette
  // erreur. `startTransition` lui dit que cette mise à jour peut attendre —
  // l'écran courant reste affiché pendant le téléchargement du suivant.
  //
  // Enveloppé ici, au niveau du setter, plutôt qu'aux 20 endroits qui
  // l'appellent : impossible d'en oublier un.
  const [currentNav, setCurrentNavImmediat] = useState(
    restoredNav?.nav ||
    ((initialHighlightMessageId || cibleMessagerieInitiale.conversationId || cibleMessagerieInitiale.channelId)
      ? 'chat'
      : initialNavFromUrl || 'accueil')
  );
  const currentNavRef = React.useRef(currentNav);
  currentNavRef.current = currentNav;
  const selectedClientIdRef = React.useRef<string | null>(restoredNav?.clientId || null);

  const setCurrentNav = React.useCallback((valeur: React.SetStateAction<string>) => {
    const nextNav = typeof valeur === 'function' ? (valeur as any)(currentNavRef.current) : valeur;
    if (nextNav !== currentNavRef.current) {
      if (applyUpdateOnNavigation({ nav: nextNav, clientId: selectedClientIdRef.current })) {
        return;
      }
    }
    React.startTransition(() => setCurrentNavImmediat(valeur));
  }, []);
  // Demande explicite (30/08/2026) : Chat reste monté en permanence une
  // fois ouvert (voir plus bas, `hasOpenedChat && <div className={... ?
  // '' : 'hidden'}><ChatView/></div>`) — mais on ne veut pas non plus payer
  // son coût de montage pour un utilisateur qui n'ouvre jamais Chat de la
  // session : on ne le monte donc qu'à partir de la première fois où
  // currentNav vaut 'chat' (y compris dès le premier rendu si l'app
  // s'ouvre directement dessus, ex. clic sur une notification de message).
  // Conversation à ouvrir au clic sur une notification (01/09/2026) — voir
  // applyFromLocation et le message NOTIFICATION_NAVIGATE du service worker.
  const [targetConversationId, setTargetConversationId] = useState<string | null>(cibleMessagerieInitiale.conversationId || null);
  const [targetChannelId, setTargetChannelId] = useState<string | null>(cibleMessagerieInitiale.channelId || null);
  const [hasOpenedChat, setHasOpenedChat] = useState(() => currentNav === 'chat');
  useEffect(() => {
    if (currentNav === 'chat') setHasOpenedChat(true);
  }, [currentNav]);

  // Resynchronise l'URL à chaque changement d'onglet (menu ou navigation
  // interne) — remplace plutôt que d'empiler l'historique, pour ne pas
  // gêner le bouton "Précédent" du navigateur avec chaque clic de menu.
  // Ignore les routes spéciales gérées ailleurs par leur propre chemin
  // (lien de notification, questionnaire public, consentement, espace
  // client) : jamais réécrites par cette synchronisation générique.
  useEffect(() => {
    try {
      const path = window.location.pathname;
      if (/^\/(questionnaire|consentement|messagerie|espace-client|immosphera\/visite)/.test(path)) return;
      const target = currentNav === 'accueil' ? '/' : `/${currentNav}`;
      if (path !== target) window.history.replaceState(null, '', target);
    } catch { /* noop */ }
  }, [currentNav]);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(initialHighlightMessageId);
  // Même principe qu'au-dessus, côté projets internes (voir
  // NotificationsView.tsx, onOpenInternalTask) : ouvre directement le
  // projet + la carte visée au lieu de la liste générique.
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  // Signalé (16 septembre, Novavisio/Diane) : « en cliquant sur la
  // notification cela ne nous emmène pas à son message » — le message
  // précis à surligner/faire défiler dans la carte une fois ouverte.
  const [highlightTaskMessageId, setHighlightTaskMessageId] = useState<string | null>(null);
  const [novaAIPrompt, setNovaAIPrompt] = useState<string | null>(null);
  // Nova IA s'affiche désormais en superposition de l'interface principale
  // (quelle qu'elle soit, généralement l'accueil) au lieu de la remplacer
  // via `currentNav` — on reste toujours sur la même interface derrière,
  // que ce soit via le clic sur "Assistant IA" ou une commande tapée dans
  // la barre NovaAI de l'accueil.
  // Même raison que setCurrentNav : ouvrir Nova charge AssistantIAView à la
  // demande, donc suspend. Sans startTransition, React lève #426 et remplace
  // l'écran par le rond de chargement au lieu de patienter.
  const [novaOpen, setNovaOpenImmediat] = useState(false);
  const setNovaOpen = React.useCallback((valeur: React.SetStateAction<boolean>) => {
    React.startTransition(() => setNovaOpenImmediat(valeur));
  }, []);
  // Demande explicite : "mets Nova dans Pipeline" — pré-remplit le champ de
  // saisie de Nova (jamais envoyé automatiquement) avec le nom du dossier
  // cliqué, pour ne pas avoir à le retaper/redicter.
  const [novaPrefillPrompt, setNovaPrefillPrompt] = useState<string | null>(null);
  // Demande explicite : "en dehors de l'interface principale, cliquer sur
  // le logo de Nova [devrait] afficher une fenêtre... avec derrière le fond
  // un peu opaque (20-30%)... la même interface principale mais en beaucoup
  // plus petit... en gardant l'historique si on réouvre." Une mini-popup
  // (pas le plein écran `novaOpen`) pour tous les accès Nova CONTEXTUELS
  // rencontrés ailleurs dans le CRM (fiche client, Pipeline...) — même
  // composant AssistantIAView réutilisé tel quel (son historique est déjà
  // persisté en base, donc partagé entre popup et plein écran sans rien de
  // plus à faire), juste affiché dans un cadre plus petit.
  // Idem pour la mini-fenêtre Nova.
  const [novaPopupOpen, setNovaPopupOpenImmediat] = useState(false);
  const setNovaPopupOpen = React.useCallback((valeur: React.SetStateAction<boolean>) => {
    React.startTransition(() => setNovaPopupOpenImmediat(valeur));
  }, []);
  // Signalé : "quand on met la fenêtre en grand, on n'a pas la possibilité
  // de la remettre en petit... on doit avoir un bouton retour pour basculer
  // sur la fiche client" — mémorise qu'on vient d'agrandir DEPUIS la
  // mini-popup, pour proposer un vrai retour vers elle (donc vers la fiche
  // client sous-jacente) plutôt qu'une fermeture complète vers l'accueil.
  const [novaExpandedFromPopup, setNovaExpandedFromPopup] = useState(false);
  // Tout accès "normal" (tuile Accueil, onglet mobile...) ouvre le plein
  // écran sans venir de la popup — réinitialise systématiquement le drapeau
  // ci-dessus, pour ne jamais laisser un "retour" fantôme vers une popup
  // qu'on n'a pas ouverte cette fois-ci.
  const openNovaFullscreen = () => {
    setNovaExpandedFromPopup(false);
    mainRef.current?.scrollTo({ top: 0 });
    setNovaOpen(true);
  };
  // Demande explicite : "mode Commercial / mode Bureau" — un commercial qui
  // sort d'un rendez-vous tape sur l'icône Nova en mobile et retombe
  // DIRECTEMENT dans un échange vocal (le mode vocal/nébuleuse déjà
  // construit), sans repasser par le chat texte. Mémorisé (dernier mode
  // utilisé), "Commercial" par défaut la toute première fois. Un bouton
  // dans Nova (voir AssistantIAView.tsx) permet de basculer et met ce
  // stockage à jour pour la prochaine ouverture.
  const [novaAutoVoice, setNovaAutoVoice] = useState(false);
  const [novaAutoDictation, setNovaAutoDictation] = useState(false);
  const openNovaMobile = () => {
    setNovaExpandedFromPopup(false);
    // Demande explicite (8 septembre) : « désactive le système vocal de
    // Nova pour l'instant, on garde que le système bureau » — ce mode
    // (mémorisé par appareil, "Commercial" = vocal par défaut la toute
    // première fois) ouvrait directement en mode vocal. Forcé sur Bureau
    // tant que le vocal est désactivé (voir VOICE_FEATURES_ENABLED dans
    // AssistantIAView.tsx), quelle que soit la préférence déjà enregistrée.
    setNovaAutoVoice(false);
    setNovaAutoDictation(false);
    setNovaOpen(true);
  };
  const openNovaMobileWithDictation = () => {
    setNovaExpandedFromPopup(false);
    setNovaAutoVoice(false);
    setNovaAutoDictation(true);
    setNovaOpen(true);
  };
  const openNovaForDeal = (dealTitle: string) => {
    setNovaPrefillPrompt(`Concernant le dossier "${dealTitle}" : `);
    setNovaPopupOpen(true);
  };
  const openNovaPopup = (options?: { prefill?: string; initialPrompt?: string }) => {
    if (options?.prefill !== undefined) setNovaPrefillPrompt(options.prefill);
    if (options?.initialPrompt !== undefined) setNovaAIPrompt(options.initialPrompt);
    setNovaPopupOpen(true);
  };
  // Demande explicite : une recherche immobilière depuis Nova IA (accueil ou
  // ailleurs) ouvre directement Immosphera360 avec les biens trouvés,
  // au lieu de rester dans le chat. Ces ids sont transmis en "graine" au
  // module au montage — voir <Immosphera initialAiResultIds .../>.
  const [immoSeedResultIds, setImmoSeedResultIds] = useState<string[] | null>(null);
  const [immoSeedQueryText, setImmoSeedQueryText] = useState('');
  // Tuile "Partenaires" de l'accueil : ouvre Immosphera360 directement sur
  // cet onglet au lieu de la page Biens par défaut.
  const [immoInitialSection, setImmoInitialSection] = useState<string | null>(null);
  const [mailInitialFolder, setMailInitialFolder] = useState<'INBOX' | 'UNREAD' | 'SENT' | 'SPAM' | 'TRASH' | 'STARRED' | 'DRAFT' | null>(null);
  // Ticket #105 : clic sur une colonne du tableau de bord -> pipeline direct
  // sur l'étape correspondante.
  const [pipelineInitialStage, setPipelineInitialStage] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  // Signalé : "pense à mettre le mode jour sur le téléphone portable" — en
  // creusant, deux mécanismes de thème coexistaient sans être synchronisés :
  // ce booléen ici (jamais persisté, remis à `true` à chaque rechargement,
  // relié au bouton du header Header.tsx — `hidden md:flex`, donc invisible
  // sur mobile) et le sélecteur Paramètres > Apparence > "Mode de thème"
  // (ParametresView.tsx, applyTheme) — CELUI-LÀ déjà accessible sur mobile,
  // persisté, et gérant même "Système". Plutôt que d'ajouter un troisième
  // bouton, on fait lire à isDarkMode l'état déjà posé par ce sélecteur, et
  // on se resynchronise sur son évènement "novasphere:theme-changed" —
  // mobile profite ainsi immédiatement du mode clair via ce sélecteur déjà
  // existant, et l'icône soleil/lune du header (desktop) reste juste même
  // quand le thème a été changé depuis Paramètres.
  const computeIsDarkFromTheme = () => {
    const theme = localStorage.getItem('novasphere:theme') || 'dark';
    const isLight = theme === 'light' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
    return !isLight;
  };
  const [isDarkMode, setIsDarkMode] = useState(computeIsDarkFromTheme);

  useEffect(() => {
    const handleThemeChanged = () => setIsDarkMode(computeIsDarkFromTheme());
    window.addEventListener('novasphere:theme-changed', handleThemeChanged);
    return () => window.removeEventListener('novasphere:theme-changed', handleThemeChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bascule rapide sombre/clair — utilisée par le bouton du bureau (Header,
  // masqué sur mobile) ET par le raccourci ajouté dans le menu mobile
  // (Sidebar) suite à "je ne vois pas le mode jour et nuit sur le
  // téléphone" : même mécanisme que Paramètres > Apparence (voir
  // computeIsDarkFromTheme ci-dessus) pour que les trois réglages restent
  // synchronisés, quel que soit celui utilisé.
  const handleToggleTheme = () => {
    const nextTheme = isDarkMode ? 'light' : 'dark';
    localStorage.setItem('novasphere:theme', nextTheme);
    if (nextTheme === 'light') document.documentElement.classList.add('light-mode');
    else document.documentElement.classList.remove('light-mode');
    setIsDarkMode(!isDarkMode);
    window.dispatchEvent(new CustomEvent('novasphere:theme-changed', { detail: nextTheme }));
  };

  // Resynchronise la pastille de la cloche à chaque ouverture du panneau —
  // filet de sécurité en plus du temps réel/sondage périodique du hook,
  // pour ne jamais laisser le chiffre affiché en décalage avec le contenu
  // réel du panneau qui vient d'être rechargé.
  useEffect(() => {
    if (notificationsPanelOpen) void refreshUnreadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationsPanelOpen]);

  // Custom Appearance (Background image, opacity, interface accent color)
  const [bgImage, setBgImage] = useState(() => localStorage.getItem('novasphere:bg-image') || '');
  const [bgOpacity, setBgOpacity] = useState(() => {
    const raw = localStorage.getItem('novasphere:bg-opacity');
    return raw ? Number(raw) : 30;
  });
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('novasphere:accent-color') || '#F7BC5F');
  // Ticket #117 : couleur du calendrier (Agenda), réglable indépendamment
  // de la couleur d'accent générale de l'interface.
  const [calendarAccentColor, setCalendarAccentColor] = useState(() => localStorage.getItem('novasphere:calendar-accent-color') || '#F7BC5F');

  // Le mode clair est produit en appliquant un filtre CSS (inversion +
  // rotation de teinte) par-dessus le mode sombre, pas via des couleurs
  // indépendantes. Pour le doré par défaut, ça veut dire qu'on ne peut pas
  // simplement "éclaircir" la couleur : ça changerait aussi le rendu du mode
  // clair (qui, lui, est déjà bien). Solution : appliquer une valeur plus
  // claire en mode sombre, et repasser à la valeur d'origine en mode clair
  // (une fois filtrée, elle redonne exactement le rendu actuel, inchangé).
  useEffect(() => {
    document.documentElement.classList.toggle('agency-novavisio', estAgenceNovavisio);
  }, [estAgenceNovavisio]);

  useEffect(() => {
    const isDefaultGold = accentColor === '#F7BC5F';
    const effectiveColor = isDefaultGold
      ? estAgenceNovavisio
        ? (isDarkMode ? '#22B8CF' : '#168AAD')
        : (isDarkMode ? '#F0C860' : '#F7BC5F')
      : accentColor;
    if (effectiveColor) {
      updateCssAccentVars(effectiveColor);
    }

    const handleAppearanceChanged = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail || {};
      if (detail.bgImage !== undefined) setBgImage(detail.bgImage);
      if (detail.bgOpacity !== undefined) setBgOpacity(detail.bgOpacity);
      if (detail.accentColor !== undefined) {
        setAccentColor(detail.accentColor);
        const nextIsDefault = detail.accentColor === '#F7BC5F';
        updateCssAccentVars(
          nextIsDefault
            ? estAgenceNovavisio
              ? (isDarkMode ? '#22B8CF' : '#168AAD')
              : (isDarkMode ? '#F0C860' : '#F7BC5F')
            : detail.accentColor
        );
      }
    };

    window.addEventListener('novasphere:appearance-changed', handleAppearanceChanged);
    return () => {
      window.removeEventListener('novasphere:appearance-changed', handleAppearanceChanged);
    };
  }, [accentColor, isDarkMode, estAgenceNovavisio]);

  // Ticket #117 : même mécanisme que la couleur d'accent générale, mais
  // pour la couleur du calendrier (Agenda) uniquement.
  useEffect(() => {
    const isDefaultGold = calendarAccentColor === '#F7BC5F';
    const effectiveColor = isDefaultGold ? (isDarkMode ? '#F0C860' : '#F7BC5F') : calendarAccentColor;
    if (effectiveColor) {
      updateCssCalendarAccentVars(effectiveColor);
    }

    const handleCalendarColorChanged = (e: Event) => {
      const customEvent = e as CustomEvent;
      const nextColor = customEvent.detail?.calendarAccentColor;
      if (nextColor !== undefined) {
        setCalendarAccentColor(nextColor);
        const nextIsDefault = nextColor === '#F7BC5F';
        updateCssCalendarAccentVars(nextIsDefault ? (isDarkMode ? '#F0C860' : '#F7BC5F') : nextColor);
      }
    };

    window.addEventListener('novasphere:calendar-color-changed', handleCalendarColorChanged);
    return () => {
      window.removeEventListener('novasphere:calendar-color-changed', handleCalendarColorChanged);
    };
  }, [calendarAccentColor, isDarkMode]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.remove('light-mode');
    } else {
      document.documentElement.classList.add('light-mode');
    }
  }, [isDarkMode]);

  // Ticket #12 (nouvelle base) : `initialHighlightMessageId` n'est lu qu'au
  // tout premier montage. Or quand l'app est déjà ouverte en arrière-plan
  // sur le téléphone, le service worker se contente de `client.navigate(url)`
  // + `focus()` sur l'onglet existant — l'URL change bien, mais rien ne
  // relisait `?highlight=` après coup : le clic sur la notification
  // ramenait sur l'accueil sans jamais ouvrir le message. On réagit donc
  // aussi aux changements d'URL en cours de session (popstate, et l'appli
  // elle-même déclenche cet événement via history.pushState ci-dessous).
  useEffect(() => {
    const applyFromLocation = () => {
      try {
        if (!window.location.pathname.startsWith('/messagerie')) return;
        const cible = cibleDepuisLien(window.location.pathname + window.location.search);
        if (cible.messageId) setHighlightMessageId(cible.messageId);
        if (cible.conversationId) setTargetConversationId(cible.conversationId);
        if (cible.channelId) setTargetChannelId(cible.channelId);
        if (cible.messageId || cible.conversationId || cible.channelId) {
          setHasOpenedChat(true);
          setCurrentNavImmediat('chat');
        }
      } catch { /* noop */ }
    };
    // `client.navigate(url)` déclenché par le service worker (voir
    // public/sw.js) ne déclenche PAS `popstate` — seul un retour
    // arrière/avant le ferait. Le signal fiable ici est que l'onglet
    // redevient visible/actif après la navigation forcée par le SW.
    const onVisible = () => { if (document.visibilityState === 'visible') applyFromLocation(); };
    // Filet supplémentaire : le service worker (voir public/sw.js) envoie
    // désormais AUSSI l'URL cible par postMessage au clic sur une
    // notification, car `client.navigate()` peut échouer silencieusement
    // (notamment iOS/Safari en PWA installée) — on route alors ici en JS,
    // sans dépendre d'une vraie navigation document qui n'aura pas eu lieu.
    const onSwMessage = (event: MessageEvent) => {
      const d = event.data as { type?: string; url?: string; conversationId?: string | null } | undefined;
      if (!d || d.type !== 'NOTIFICATION_NAVIGATE' || typeof d.url !== 'string') return;
      try {
        const u = new URL(d.url, window.location.origin);
        window.history.replaceState(null, '', u.pathname + u.search);
        applyFromLocation();
        // Le service worker transmet AUSSI l'identifiant de la conversation à
        // côté de l'URL. On s'en sert en dernier recours : si l'URL ne portait
        // pas le paramètre attendu, ce chemin ouvre quand même la bonne
        // conversation plutôt que la liste.
        if (d.conversationId) {
          setTargetConversationId(d.conversationId);
          setHasOpenedChat(true);
          setCurrentNavImmediat('chat');
        }
      } catch { /* noop */ }
    };
    navigator.serviceWorker?.addEventListener?.('message', onSwMessage);
    window.addEventListener('popstate', applyFromLocation);
    window.addEventListener('focus', applyFromLocation);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      navigator.serviceWorker?.removeEventListener?.('message', onSwMessage);
      window.removeEventListener('popstate', applyFromLocation);
      window.removeEventListener('focus', applyFromLocation);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Web App Badging API, Service Worker & Document Title Notification Badge
  useEffect(() => {
    const totalUnread = (unreadNotificationsCount || 0) + (unreadMessagesCount || 0) + (unreadRemindersCount || 0);

    // 1. Native Web App Badging API for installed mobile PWA / Android / iOS
    if ('setAppBadge' in navigator) {
      if (totalUnread > 0) {
        navigator.setAppBadge(totalUnread).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }

    // 2. Synchronize active Service Worker
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_BADGE',
        count: totalUnread,
      });
    }

    // 3. Document title indicator for mobile tab bar — jamais sur l'Espace
    // Client (ClientAuth/ClientGuestShell, montés comme enfants d'App plus
    // bas dans le rendu) : ils posent leur propre titre "NovaCRM Espace
    // Client", que cet effet écraserait sinon puisqu'il tourne sur TOUTE
    // route/rôle sans condition.
    if (window.location.pathname.startsWith('/espace-client')) return;
    if (totalUnread > 0) {
      document.title = `(${totalUnread}) NovaCRM`;
    } else {
      document.title = 'NovaCRM';
    }
  }, [unreadNotificationsCount, unreadMessagesCount, unreadRemindersCount]);

  // Modals state
  const [showNouveauLead, setShowNouveauLead] = useState(false);
  const [showQuickClientDictation, setShowQuickClientDictation] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  // Ticket #49 : visite guidée interactive (spotlight sur les vrais
  // éléments), lancée depuis l'onglet Guide du tutoriel.
  const [showProductTour, setShowProductTour] = useState(false);
  // Fait avancer une étape `waitForAction` (ex. "créez votre premier
  // contact") une fois l'action réellement accomplie côté appli.
  const [tourSignalNext, setTourSignalNext] = useState(0);
  // Bug remonté : une fois la modale "Nouveau lead" ouverte pendant la
  // visite, celle-ci restait figée sur l'étape "cliquez sur ce bouton" au
  // lieu de guider le champ à remplir. On avance d'une étape dès que la
  // modale s'ouvre pendant que la visite est active.
  useEffect(() => {
    if (showProductTour && showNouveauLead) setTourSignalNext((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNouveauLead]);
  const PRODUCT_TOUR_STEPS: TourStep[] = [
    {
      selector: null,
      title: 'Bienvenue sur Nova CRM 👋',
      text: "Petit tour de 3 minutes. Cliquez sur \"Suivant\" pour avancer, ou fermez à tout moment — vous pourrez toujours le relancer depuis le Guide.",
      onEnter: () => setMobileMenuOpen(false),
    },
    {
      selector: '[data-tour="header-menu"]',
      title: 'Le bouton Menu',
      text: "Tous les onglets de l'application se trouvent ici, dans un panneau qui coulisse depuis la gauche. On l'ouvre pour la suite de la visite.",
    },
    {
      selector: '[data-tour="nav-accueil"]',
      title: 'Accueil',
      text: "Votre tableau de bord : raccourcis personnalisables (\"Mes espaces\"), agenda du jour et priorités en un coup d'œil.",
      onEnter: () => setMobileMenuOpen(true),
    },
    {
      selector: '[data-tour="nav-clients"]',
      title: 'Clients',
      text: "Tous vos contacts et leads. Chaque fiche centralise rendez-vous, notes, documents et e-mails échangés.",
      onEnter: () => setMobileMenuOpen(true),
    },
    {
      selector: '[data-tour="nav-agenda"]',
      title: 'Agenda',
      text: 'Vos rendez-vous, synchronisés avec Google Agenda.',
      onEnter: () => setMobileMenuOpen(true),
    },
    {
      selector: '[data-tour="nav-chat"]',
      title: 'Chat',
      text: 'Messagerie interne : conversations directes et canaux de projet avec vos collègues.',
      onEnter: () => setMobileMenuOpen(true),
    },
    {
      selector: '[data-tour="nav-assistant-ia"]',
      title: 'Nova',
      text: 'Votre assistant : créez des contacts, des tâches, des notes ou posez-lui une question, à la voix ou au texte.',
      onEnter: () => setMobileMenuOpen(true),
    },
    {
      selector: '[data-tour="nav-parametres"]',
      title: 'Paramètres',
      text: "Votre profil, vos préférences, et — si vous êtes administrateur — la gestion de l'équipe.",
      onEnter: () => setMobileMenuOpen(true),
    },
    {
      selector: '[data-tour="header-search"]',
      title: 'Recherche rapide',
      text: 'Retrouvez un client par son nom sans quitter votre écran.',
      // Bug remonté : le panneau "Menu" restait ouvert (par-dessus toute la
      // barre du haut, en z-index supérieur) pendant les étapes suivantes —
      // les icônes de la barre du haut étaient donc invisibles, cachées
      // derrière le panneau. On le referme avant de continuer.
      onEnter: () => setMobileMenuOpen(false),
    },
    {
      selector: '[data-tour="header-theme"]',
      title: 'Mode jour / nuit',
      text: "Basculez l'interface entre thème sombre et clair.",
    },
    {
      selector: '[data-tour="header-fullscreen"]',
      title: 'Plein écran',
      text: 'Masque les barres du navigateur pour plus de confort.',
    },
    {
      selector: '[data-tour="header-tutoriel"]',
      title: 'Tutoriel',
      text: 'Rouvre ce guide et son quiz à tout moment.',
    },
    {
      selector: '[data-tour="header-avatar"]',
      title: 'Votre profil',
      text: 'Accès direct à votre fiche personnelle dans les Paramètres.',
    },
    {
      selector: '[data-tour="header-settings"]',
      title: 'Paramètres',
      text: 'Préférences, équipe, notifications, automatisations...',
    },
    {
      selector: '[data-tour="header-bell"]',
      title: 'Notifications',
      text: 'La clochette centralise tout : messages, rappels, réservations, annonces.',
    },
    {
      selector: '[data-tour="header-nouveau-lead"]',
      title: 'À vous de jouer',
      text: "Créez votre tout premier contact : cliquez sur ce bouton pour ouvrir le formulaire.",
      onEnter: () => setMobileMenuOpen(false),
      waitForAction: true,
    },
    {
      // Bug remonté : une fois la modale "Nouveau lead" ouverte, la visite
      // restait muette. On guide maintenant chaque champ un par un — avec
      // un "Suivant" normal entre chacun (rien n'oblige à taper quoi que ce
      // soit pour avancer), et seule la validation finale attend une vraie
      // action de l'utilisateur.
      selector: '[data-tour="lead-firstname-field"]',
      title: 'Prénom',
      text: "Commencez par le prénom, ex : Jean-Pierre.",
    },
    {
      selector: '[data-tour="lead-name-field"]',
      title: 'Nom',
      text: "Puis le nom de famille — c'est le seul champ obligatoire.",
    },
    {
      selector: '[data-tour="lead-email-field"]',
      title: 'Email',
      text: "Pour cet essai, vous pouvez mettre nova@crm.fr.",
    },
    {
      selector: '[data-tour="lead-phone-field"]',
      title: 'Téléphone',
      text: "Et pour le téléphone, par exemple 0601020304.",
    },
    {
      selector: '[data-tour="lead-submit-button"]',
      title: 'Validez',
      text: 'Cliquez ici pour enregistrer votre premier contact.',
      waitForAction: true,
    },
    {
      selector: '[data-tour="client-tabs"]',
      title: 'La fiche client',
      text: "Bravo ! Voici la fiche de votre nouveau contact : rendez-vous, notes, e-mails et documents, tout est centralisé ici. C'est tout pour la visite, bon travail !",
    },
  ];
  const [showSqlImport, setShowSqlImport] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  
  // Client Profile Full View state
  // Même raison que setCurrentNav ci-dessus : ouvrir une fiche client charge
  // ClientProfileView à la demande, donc suspend.
  const [selectedClientProfileId, setSelectedClientProfileIdImmediat] = useState<string | null>(
    restoredNav?.clientId || null
  );
  selectedClientIdRef.current = selectedClientProfileId;

  const setSelectedClientProfileId = React.useCallback((valeur: React.SetStateAction<string | null>) => {
    const nextId = typeof valeur === 'function' ? (valeur as any)(selectedClientIdRef.current) : valeur;
    if (nextId !== selectedClientIdRef.current) {
      if (applyUpdateOnNavigation({ nav: currentNavRef.current, clientId: nextId })) {
        return;
      }
    }
    React.startTransition(() => setSelectedClientProfileIdImmediat(valeur));
  }, []);

  const [selectedClientProfileTab, setSelectedClientProfileTab] = useState<'espace-client' | undefined>(
    restoredNav?.tab
  );

  const openClientProfile = (contactId: string | null, tab?: 'espace-client') => {
    if (contactId !== selectedClientIdRef.current || tab !== selectedClientProfileTab) {
      if (applyUpdateOnNavigation({ nav: currentNavRef.current, clientId: contactId, tab })) {
        return;
      }
    }
    setSelectedClientProfileId(contactId);
    setSelectedClientProfileTab(contactId ? tab : undefined);
  };

  // Onglets internes (7 octobre, app installée) : chaque onglet retient
  // l'écran et la fiche client ouverts, pour pouvoir par exemple garder un
  // client ouvert dans un onglet et travailler sur un autre dossier (ou le
  // même, sur un autre sous-onglet) dans un second. Version 1 confirmée
  // explicitement avec l'utilisateur : changer d'onglet recharge la vue —
  // pas de mémoire de défilement/brouillon entre deux changements — pour
  // éviter de reconstruire toute la zone de rendu ci-dessous (aujourd'hui,
  // une seule vue à la fois y est montée, voir le commentaire sur `key=`
  // plus bas), partagée par toute l'application et déjà très sensible.
  interface AppTab {
    id: string;
    nav: string;
    selectedClientProfileId: string | null;
    selectedClientProfileTab: 'espace-client' | undefined;
    title: string;
  }
  const [tabs, setTabs] = useState<AppTab[]>(() => [{
    id: 'tab-initial',
    nav: currentNav,
    selectedClientProfileId: restoredNav?.clientId || null,
    selectedClientProfileTab: undefined,
    title: NAV_ITEMS.find((i) => i.id === currentNav)?.label || 'Accueil',
  }]);
  const [activeTabId, setActiveTabId] = useState('tab-initial');

  const titreOnglet = React.useCallback((nav: string, clientId: string | null): string => {
    if (clientId) {
      const c = contacts.find((contact) => contact.id === clientId);
      if (c?.name) return c.name;
    }
    return NAV_ITEMS.find((i) => i.id === nav)?.label || nav;
  }, [contacts]);

  // Ouvre un NOUVEL onglet sur `nav` (et une fiche client déjà identifiée,
  // le cas échéant — ex. depuis une carte contact). Capture d'abord l'état
  // courant dans l'onglet qu'on quitte, pour le retrouver intact à son
  // prochain tour (voir switchToTab/closeTab, même principe).
  const openInNewTab = React.useCallback((nav: string, clientId: string | null = null, clientTab?: 'espace-client') => {
    const newId = crypto.randomUUID();
    const tabsAJour = tabs.map((t) =>
      t.id === activeTabId
        ? { ...t, nav: currentNav, selectedClientProfileId, selectedClientProfileTab, title: titreOnglet(currentNav, selectedClientProfileId) }
        : t
    );
    setTabs([
      ...tabsAJour,
      { id: newId, nav, selectedClientProfileId: clientId, selectedClientProfileTab: clientTab, title: titreOnglet(nav, clientId) },
    ]);
    setNovaOpen(false);
    setCurrentNav(nav);
    setSelectedClientProfileId(clientId);
    setSelectedClientProfileTab(clientId ? clientTab : undefined);
    setActiveTabId(newId);
  }, [tabs, activeTabId, currentNav, selectedClientProfileId, selectedClientProfileTab, titreOnglet]);

  const switchToTab = React.useCallback((tabId: string) => {
    if (tabId === activeTabId) return;
    const tabsAJour = tabs.map((t) =>
      t.id === activeTabId
        ? { ...t, nav: currentNav, selectedClientProfileId, selectedClientProfileTab, title: titreOnglet(currentNav, selectedClientProfileId) }
        : t
    );
    const cible = tabsAJour.find((t) => t.id === tabId);
    if (!cible) return;
    if (applyUpdateOnNavigation({ nav: cible.nav, clientId: cible.selectedClientProfileId, tab: cible.selectedClientProfileTab })) {
      return;
    }
    setTabs(tabsAJour);
    setNovaOpen(false);
    setCurrentNav(cible.nav);
    setSelectedClientProfileId(cible.selectedClientProfileId);
    setSelectedClientProfileTab(cible.selectedClientProfileTab);
    setActiveTabId(tabId);
  }, [tabs, activeTabId, currentNav, selectedClientProfileId, selectedClientProfileTab, titreOnglet]);

  const closeTab = React.useCallback((tabId: string) => {
    if (tabs.length <= 1) return; // toujours garder au moins un onglet ouvert
    const idx = tabs.findIndex((t) => t.id === tabId);
    const restants = tabs.filter((t) => t.id !== tabId);
    setTabs(restants);
    if (tabId === activeTabId) {
      const suivant = restants[Math.max(0, idx - 1)] || restants[0];
      setNovaOpen(false);
      setCurrentNav(suivant.nav);
      setSelectedClientProfileId(suivant.selectedClientProfileId);
      setSelectedClientProfileTab(suivant.selectedClientProfileTab);
      setActiveTabId(suivant.id);
    }
  }, [tabs, activeTabId]);
  // Signalé (9 septembre, capture à l'appui) : ouvrir une fiche client ne
  // remontait pas en haut — le pipeline/les onglets (Tâches, Notes...)
  // restaient hors champ tant qu'on n'avait pas fait défiler soi-même.
  // Cause : ClientProfileView ne gère plus son propre défilement (retiré
  // lors d'un correctif mobile antérieur, voir son commentaire) — c'est
  // <main> ci-dessous qui défile pour toute l'appli, et rien ne remettait
  // sa position à zéro à l'ouverture d'une fiche. `selectedClientProfileId`
  // est LE seul état commun à tous les points d'entrée (recherche, liste de
  // contacts, notif...), donc le bon endroit où réagir une fois pour tous.
  const mainRef = React.useRef<HTMLElement | null>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [currentNav, selectedClientProfileId]);
  useEffect(() => {
    if (novaOpen) mainRef.current?.scrollTo({ top: 0 });
  }, [novaOpen]);
  const [highlightPulse, setHighlightPulse] = useState(0);
  const [mailFullScreen, setMailFullScreen] = useState(false);
  const [mailComposeTo, setMailComposeTo] = useState<string | null>(null);
  // Clic sur une adresse e-mail n'importe où dans le CRM : ouvre Mail du
  // CRM avec le destinataire, jamais l'application mail du poste.
  useEffect(() => {
    const ouvrir = (e: Event) => {
      const email = (e as CustomEvent<{ email?: string }>).detail?.email;
      if (!email) return;
      setMailComposeTo(email);
      setSelectedClientProfileId(null);
      setSelectedClientProfileTab(undefined);
      setNovaOpen(false);
      setCurrentNav('mail');
    };
    window.addEventListener(EVENEMENT_COMPOSER_MAIL, ouvrir);
    return () => window.removeEventListener(EVENEMENT_COMPOSER_MAIL, ouvrir);
  }, []);
  // Incrémenté par le « + » de la barre du bas (mobile) : ouvre un nouveau
  // message vide dans MailView. Un compteur plutôt qu'un booléen, pour que
  // deux demandes successives se distinguent l'une de l'autre.
  const [mailComposeSignal, setMailComposeSignal] = useState(0);
  // Vrai quand un message est ouvert en lecture sur téléphone : la barre du
  // bas retire alors son « + Écrire », l'écran de lecture ayant ses propres
  // boutons Répondre / Transférer.
  const [mailReading, setMailReading] = useState(false);
  // Même mécanisme que la messagerie, pour le « + » de l'écran Agenda.
  const [agendaCreateSignal, setAgendaCreateSignal] = useState(0);
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : brouillon
  // pré-rempli par une automatisation de pipeline (jamais d'envoi silencieux).
  const [mailComposeSubject, setMailComposeSubject] = useState<string | null>(null);
  const [mailComposeBody, setMailComposeBody] = useState<string | null>(null);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
    logout();
  };

  // Page publique (sans authentification) : lien sécurisé envoyé au client par email
  const questionnaireMatch = window.location.pathname.match(/^\/questionnaire\/([a-zA-Z0-9]+)/);
  if (questionnaireMatch) {
    return <PublicQuestionnaire token={questionnaireMatch[1]} />;
  }

  const consentementMatch = window.location.pathname.match(/^\/consentement\/([a-zA-Z0-9]+)/);
  if (consentementMatch) {
    return <PublicConsentement token={consentementMatch[1]} />;
  }

  // Lien de visite temporaire ImmoSphera360 : le client n'a pas de compte,
  // la page doit s'ouvrir sans passer par l'écran de connexion Google.
  const visiteMatch = window.location.pathname.match(/^\/immosphera\/visite\/([a-zA-Z0-9_-]+)/);
  if (visiteMatch) {
    return <PublicVisiteImmosphera token={visiteMatch[1]} />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#071015] flex flex-col items-center justify-center text-white p-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#F7BC5F] border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide">Chargement de Nova CRM...</p>
      </div>
    );
  }

  if (!currentUser) {
    // Ticket "Rôle Stagiaire" (phase 2) : sans ce cas, un stagiaire hors de
    // sa fenêtre de dates était simplement redéconnecté et renvoyé sur
    // l'écran de connexion classique, sans jamais comprendre pourquoi.
    if (internGateMessage) {
      return (
        <div className="min-h-screen bg-[#071015] flex flex-col items-center justify-center text-white p-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 flex items-center justify-center mb-4">
            <Clock className="w-7 h-7 text-[#F7BC5F]" />
          </div>
          <p className="text-base font-bold max-w-sm">{internGateMessage}</p>
        </div>
      );
    }
    // Espace client : écran de connexion dédié, jamais celui de l'équipe
    // (Google Workspace + toutes ses portées Drive/Gmail/Agenda n'ont aucun
    // sens pour un client, qui n'a pas forcément de compte Google).
    if (window.location.pathname.startsWith('/espace-client')) {
      return <ClientAuth />;
    }
    return <Auth />;
  }

  // Ticket "Rôle Stagiaire" (phase 2) : interface entièrement séparée,
  // avant même d'atteindre le Sidebar/la navigation générale — un stagiaire
  // ne doit "surtout pas avoir accès à l'intégralité du CRM" (consigne
  // explicite), pas seulement voir des boutons masqués.
  if (userProfile?.role === 'intern') {
    return <StagiaireShell />;
  }

  // Ticket "Clients invités" (7/13) : un client invité ne doit JAMAIS voir
  // l'interface complète de NovaSphere (mêmes raisons que le stagiaire
  // ci-dessus) — interface mobile dédiée, isolée du reste du CRM.
  if (userProfile?.role === 'client_guest') {
    return <ClientGuestShell />;
  }

  return (
    // `h-[100dvh]` et non `h-screen` (100vh) : sur Android, 100vh vaut la
    // hauteur SANS la barre d'outils du navigateur, donc le bas de
    // l'application passe hors écran alors que la racine est en
    // overflow-hidden. `dvh` suit la hauteur réellement visible.
    <div className="h-[100dvh] bg-[#071015] text-gray-100 flex flex-col font-sans overflow-hidden select-none">
      <Toaster />
      <UpdateBanner currentNav={currentNav} selectedClientProfileId={selectedClientProfileId} />
      <GoogleWorkspaceStatus />
      <AutoEnablePush />
      <EnablePushPrompt />
      <AnnouncementBanner />
      {/* Top Header Bar - collée tout en haut de l'écran */}
      <Header
        onOpenNouveauLead={() => setShowNouveauLead(true)}
        onOpenClientDictation={() => setShowQuickClientDictation(true)}
        onOpenSqlImport={() => setShowSqlImport(true)}
        onOpenTutorial={() => setShowTutorial(true)}
        onOpenCameraReservation={() => setShowCameraModal(true)}
        unreadCount={unreadNotificationsCount}
        isDarkMode={isDarkMode}
        onToggleTheme={handleToggleTheme}
        selectedAgencyName={activeAgency.name}
        selectedAgencyId={activeAgency.id}
        onNavigate={(nav) => {
          setNovaOpen(false);
          setCurrentNav(nav);
          setSelectedClientProfileId(null);
          if (nav === 'reserver-camera') {
            setShowCameraModal(true);
          }
        }}
        onSelectContact={(contactId) => openClientProfile(contactId)}
        onOpenMessage={(messageId) => {
          setNovaOpen(false);
          setSelectedClientProfileId(null);
          setHighlightMessageId(messageId);
          setCurrentNav('chat');
        }}
        onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
        onToggleNotifications={() => setNotificationsPanelOpen((open) => !open)}
        menuOpen={mobileMenuOpen}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar — masquée en mode plein écran Mail */}
        {!mailFullScreen && <Sidebar
          currentNav={currentNav}
          onSelectNav={(nav) => {
            if (nav === 'assistant-ia') {
              setNovaOpen((open) => !open);
              return;
            }
            setNovaOpen(false);
            setCurrentNav(nav);
            setSelectedClientProfileId(null);
            if (nav === 'reserver-camera') {
              setShowCameraModal(true);
            }
          }}
          selectedAgency={activeAgency}
          onSelectAgency={setActiveAgency}
          onSignOut={handleSignOut}
          userEmail={currentUser?.email || 's.grazia@conseilfinances.fr'}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          isDarkMode={isDarkMode}
          onToggleTheme={handleToggleTheme}
          unreadRemindersCount={unreadRemindersCount}
          unreadNotificationsCount={unreadNotificationsCount}
          unreadMessagesCount={unreadMessagesCount}
          unreadMailCount={unreadMailCount}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onOpenInNewTab={canUseTabs ? (nav) => openInNewTab(nav) : undefined}
        />}

        {/* Main View Display */}
        {/* Signalé : "en bureau la fenêtre de Nova n'est pas figée, avec la
            souris je peux la monter en haut" — l'écran Nova plein écran est
            en `absolute inset-0` À L'INTÉRIEUR de <main>, qui reste
            lui-même défilable : la molette fait donc défiler <main>, et
            l'écran Nova (calé dessus) suit ce défilement au lieu de rester
            fixe. Le défilement de <main> est désormais coupé tant que Nova
            est ouvert en plein écran (desktop) — la vue du dessous reste
            gelée telle quelle, et le défilement interne de la conversation
            Nova (indépendant, à l'intérieur d'AssistantIAView) n'est pas
            affecté. */}
        {/* Bug racine (30/08/2026, "on ne voit pas les textes tout en haut" —
            plusieurs pages, mode jour) : la photo de fond (voir plus bas,
            portail `position:fixed` injecté directement dans <body>) est
            TOUJOURS peinte AU-DESSUS de ce fond <main> (bg-[#071015]/97 ou
            85 sur Accueil), quel que soit le thème — <main> n'avait que
            `relative` sans z-index, donc pas de contexte d'empilement propre
            face au portail `fixed` (qui, lui, en crée toujours un). Le
            fond de <main> n'a donc JAMAIS réellement recouvert la photo
            dans aucun thème ; ça passait presque inaperçu en mode sombre
            (fonds de secours suffisamment sombres par coïncidence) mais
            devenait illisible en mode jour (texte anthracite posé
            directement sur la photo, sans aucun fond réel derrière).
            `z-[1]` donne à <main> son propre contexte d'empilement,
            au-dessus du z-0 du portail photo — son fond redevient enfin
            effectif, dans les deux thèmes. */}
        {/* Signalé (31/08/2026) : sur un Honor Magic V3 déplié, plus rien ne
            défilait dans la fiche client. Ce pliable mesure environ 800 px CSS
            de large une fois ouvert : il dépasse le seuil de 768 px et
            l'application le prend pour un ordinateur de bureau. Le verrou
            ci-dessous — voulu pour que la molette ne fasse pas défiler la page
            derrière le panneau Nova — s'appliquait donc à un écran tactile,
            où il n'existe aucune molette et aucun moyen de s'en sortir. La
            fiche client n'ayant pas de défilement propre (elle s'appuie sur
            celui de <main>), elle devenait totalement figée.
            On conditionne désormais au pointeur fin, la seule situation où ce
            verrou a un sens. */}
        <main className={`flex-1 relative z-[1] custom-scrollbar ${
          novaOpen && !isMobile && !isCoarsePointer ? 'overflow-hidden' : 'overflow-y-auto'
        } ${
          isMobile && (currentNav === 'chat' || currentNav === 'mail')
            ? 'pt-0'
            : isMobile && currentNav !== 'accueil' && !selectedClientProfileId
              ? 'pt-[calc(3.5rem+env(safe-area-inset-top,0px))] md:pt-0'
              : 'pt-[env(safe-area-inset-top,0px)] md:pt-0'
        } ${
          isMobile && (currentNav === 'chat' || currentNav === 'mail') ? 'pb-0' : 'pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0'
        } ${
          // Signalé (30/08/2026, plusieurs captures) : "en haut ce n'est pas
          // top" — la photo de fond restait visible en bande dans tous les
          // espaces entre les blocs de contenu (haut de page, entre les
          // cartes...), sur toutes les pages. Gardé tel quel UNIQUEMENT sur
          // Accueil (conçu pour laisser deviner la photo entre les tuiles) ;
          // plus opaque partout ailleurs, où l'info dense a besoin d'un fond
          // net.
          // Revu (30/08/2026, suite — "plus aucune photo ne fonctionne en
          // fond d'écran" / "l'opacité de l'image de fond ne fonctionne
          // plus") : une fois ce voile réellement peint AU-DESSUS de la
          // photo (voir z-[1] + le correctif index.css juste au-dessus,
          // même date — avant ça il n'avait jamais eu d'effet, dans AUCUN
          // thème), /97 ne laissait plus passer que 3% de la photo — le
          // curseur d'opacité (Paramètres) devenait quasi sans effet visible
          // quel que soit son réglage. /85 et /97 ramenés à /35 et /55 :
          // teinte toujours plus marquée hors Accueil, mais le curseur
          // redevient réellement perceptible partout.
          bgImage ? (currentNav === 'accueil' ? 'bg-[#071015]/35' : 'bg-[#071015]/55') : 'bg-[#071015]'
        }`} ref={mainRef}>
          {/* Ticket #17 : ce fond n'apparaissait pas sur mobile — un ancêtre
              du layout applique une transformation CSS (animations de page,
              barres iOS) qui transforme un `position:fixed` imbriqué en
              simple `absolute` relatif à cet ancêtre au lieu du viewport.
              Rendu via portail direct dans <body> pour garantir qu'il
              couvre bien tout l'écran, desktop et mobile. */}
          {bgImage && createPortal(
            <div
              // `nv-wallpaper` : cible dédiée pour la reprise de contraste
              // appliquée à la photo en mode jour (voir index.css) — le voile
              // clair posé par <main> la délave davantage qu'un voile sombre.
              className="nv-wallpaper fixed inset-0 pointer-events-none z-0 transition-opacity duration-300 bg-cover bg-center bg-no-repeat no-invert"
              style={{
                backgroundImage: `url(${bgImage})`,
                opacity: bgOpacity / 100,
              }}
            />,
            document.body
          )}
          {/* Frontière de chargement des écrans (31/08/2026).

              Tous les écrans étaient importés au démarrage : le navigateur
              téléchargeait Mail, Agenda, Immosphera360, Nova, la carte
              Leaflet et les graphiques Recharts avant même d'afficher
              l'accueil — 3,5 Mo d'un bloc, sur mobile en 4G. Ils sont
              maintenant chargés à la demande (React.lazy), et cette unique
              frontière couvre la zone de vues, le panneau Nova et
              Immosphera360, qui vivent tous à l'intérieur de <main>. */}
          <Suspense fallback={<ChargementEcran />}>
          {/* h-full : nécessaire pour que les vues qui remplissent tout
              l'espace disponible (ex. Mail) puissent résoudre leur propre
              h-full jusqu'à la hauteur réelle de <main>. Neutre pour les
              autres onglets (page classique qui défile) : ce div n'impose
              aucun overflow, leur contenu continue de dépasser normalement
              et de faire défiler <main> comme avant. */}
          {/* Signalé (31/08/2026) : impossible de faire défiler la fiche client
              sur un téléphone pliable. `h-full` cale ce conteneur sur la
              hauteur exacte de <main>. C'est indispensable à l'écran Mail, qui
              résout sa propre hauteur au travers ; la fiche client, elle, n'en
              a aucun besoin — elle dépasse et laisse <main> défiler. Or selon
              les navigateurs mobiles, une hauteur fixe combinée au défilement
              du parent se comporte mal et fige le contenu. On retire donc la
              contrainte là où elle ne sert à rien. */}
          <EcranErrorBoundary resetKey={selectedClientProfileId ? `fiche:${selectedClientProfileId}` : currentNav}>
          <div
            key={selectedClientProfileId ? 'client-profile' : currentNav}
            className={`relative z-10 ${selectedClientProfileId ? '' : (currentNav === 'mail' || currentNav === 'carte-novavisio' ? 'h-full' : 'min-h-full')}`}
          >
          {selectedClientProfileId ? (
            <ClientProfileView
              clientId={selectedClientProfileId}
              onBack={() => { setSelectedClientProfileId(null); setSelectedClientProfileTab(undefined); }}
              highlightPulse={highlightPulse}
              initialTab={selectedClientProfileTab}
              onComposeMail={(email) => {
                setMailComposeTo(email);
                setSelectedClientProfileId(null);
                setSelectedClientProfileTab(undefined);
                setCurrentNav('mail');
              }}
              // Demande explicite : "intégrer Nova dans la fiche du client,
              // un logo quelque part, on lui dit ce qu'on veut (note, tâche,
              // etc.) directement dans la fiche" — `currentClientId` était
              // déjà transmis à AssistantIAView (deux montages plus bas,
              // desktop/mobile) à chaque fois que Nova s'ouvre pendant
              // qu'une fiche est affichée, donc Nova résout déjà
              // silencieusement le bon contactId — il ne manquait qu'un
              // accès direct et visible DEPUIS la fiche elle-même.
              onOpenNova={openNovaPopup}
              // Lien Vendeur ↔ Acquéreur (7 septembre) : navigue vers la
              // fiche liée sans quitter le composant.
              onSelectContact={(contactId) => openClientProfile(contactId)}
            />
          ) : (
            <>
              {currentNav === 'accueil' && (
                isMobile ? (
                  <MobileHome
                    onNavigate={(nav) => {
                      if (nav === 'mail-unread') {
                        setMailInitialFolder('UNREAD');
                        setCurrentNav('mail');
                      } else if (nav === 'assistant-ia') {
                        openNovaFullscreen();
                      } else {
                        setCurrentNav(nav);
                      }
                    }}
                    unreadRemindersCount={unreadRemindersCount}
                    unreadMessagesCount={unreadMessagesCount}
                    unreadMailCount={unreadMailCount}
                    unreadNotificationsCount={unreadMobileNotificationsCount}
                    onOpenNotifications={() => setNotificationsPanelOpen((open) => !open)}
                    onOpenNouveauLead={() => setShowNouveauLead(true)}
                    onOpenClientDictation={() => setShowQuickClientDictation(true)}
                  />
                ) : (
                  <AccueilGrid
                    onNavigate={(nav) => {
                      if (nav === 'mail-unread') {
                        setMailInitialFolder('UNREAD');
                        setCurrentNav('mail');
                      } else if (nav === 'assistant-ia') {
                        openNovaFullscreen();
                      } else if (nav === 'immosphera-partenaires') {
                        setImmoInitialSection('partenaires');
                        setCurrentNav('immosphera360');
                      } else {
                        setCurrentNav(nav);
                      }
                    }}
                    unreadRemindersCount={unreadRemindersCount}
                    unreadNotificationsCount={unreadNotificationsCount}
                    unreadMessagesCount={unreadMessagesCount}
                    unreadMailCount={unreadMailCount}
                    openSupportTicketsCount={openSupportTicketsCount}
                    onAskNovaAI={(prompt) => {
                      setNovaAIPrompt(prompt);
                      openNovaFullscreen();
                    }}
                    onOpenNova={() => openNovaFullscreen()}
                    novaOpen={novaOpen}
                  />
                )
              )}

          {currentNav === 'tableau-de-bord' && (
            <div className="px-3 sm:px-6 pt-1 sm:pt-2 pb-6">
              <Dashboard
                onNavigate={setCurrentNav}
                onNavigateToStage={(stage) => {
                  setPipelineInitialStage(stage);
                  setCurrentNav('pipeline');
                }}
                onOpenContact={(contactId) => openClientProfile(contactId)}
              />
            </div>
          )}

          {currentNav === 'clients' && (
            <Clients
              onSelectContact={(contactId) => openClientProfile(contactId)}
            />
          )}

          {/* Comptabilité (6 septembre, Conseils Finances) — la garde
              menu/agence/rôle est aussi vérifiée côté contenu dans le
              composant lui-même (même principe que CarteProspectionView). */}
          {currentNav === 'comptabilite' && (
            <div className="px-3 sm:px-6 pt-1 sm:pt-2 pb-6">
              <ComptabiliteView />
            </div>
          )}

          {currentNav === 'pipeline' && (
            <div className="px-3 sm:px-6 pt-1 sm:pt-2 pb-6">
              <Pipeline
                onSelectContact={(contactId) => openClientProfile(contactId)}
                initialStage={pipelineInitialStage}
                onInitialStageHandled={() => setPipelineInitialStage(null)}
                onOpenMailDraft={(to, subject, body) => {
                  setMailComposeTo(to || '');
                  setMailComposeSubject(subject);
                  setMailComposeBody(body);
                  setCurrentNav('mail');
                }}
                onOpenNova={openNovaForDeal}
              />
            </div>
          )}

          {currentNav === 'projets-internes' && (
            <ProjetsInternes
              agencyId={activeAgency.id}
              initialOpenTaskId={highlightTaskId}
              onOpenTaskConsumed={() => setHighlightTaskId(null)}
              initialHighlightMessageId={highlightTaskMessageId}
              onHighlightMessageConsumed={() => setHighlightTaskMessageId(null)}
            />
          )}

          {currentNav === 'agenda' && <AgendaView createSignal={agendaCreateSignal} />}

          {/* Cloisonnement (31/08/2026) : « les statistiques ne doivent
              apparaître que dans Immosphera ». La TUILE était déjà filtrée par
              l'agence active, mais l'écran lui-même ne l'était pas : on y
              arrivait encore par un lien, une navigation mémorisée ou un
              onglet rouvert au même endroit. Le filtre d'une tuile est un
              confort d'affichage, pas une barrière. */}
          {currentNav === 'statistiques-etiquettes' && (
            estAgenceImmosphera ? (
              <StatistiquesEtiquettesView onSelectContact={setSelectedClientProfileId} />
            ) : (
              <div className="p-12 text-center text-gray-400 bg-white/5 border border-dashed border-white/10 rounded-2xl">
                <p className="text-sm font-semibold text-white mb-1">Statistiques Immosphera</p>
                <p className="text-xs">
                  Cet écran n'est disponible que depuis l'agence Immosphera.
                  Changez d'agence active pour y accéder.
                </p>
              </div>
            )
          )}

          {currentNav === 'rappels' && (
            <RappelsView
              onSelectContact={setSelectedClientProfileId}
              onBack={() => setCurrentNav('accueil')}
            />
          )}


          {currentNav === 'mail' && (
            <MailView
              fullScreen={mailFullScreen}
              onToggleFullScreen={() => setMailFullScreen((v) => !v)}
              onUnreadCountChanged={refreshUnreadMail}
              unreadMailCount={unreadMailCount}
              initialComposeTo={mailComposeTo}
              initialComposeSubject={mailComposeSubject}
              initialComposeBody={mailComposeBody}
              onInitialComposeConsumed={() => { setMailComposeTo(null); setMailComposeSubject(null); setMailComposeBody(null); }}
              initialFolder={mailInitialFolder ?? undefined}
              onInitialFolderConsumed={() => setMailInitialFolder(null)}
              composeSignal={mailComposeSignal}
              onReadingChange={setMailReading}
            />
          )}

          {currentNav === 'equipe' && (
            <EquipeView
              onNavigate={setCurrentNav}
              onComposeMail={(email) => {
                setMailComposeTo(email);
                setCurrentNav('mail');
              }}
              onOpenContact={(contactId) => openClientProfile(contactId)}
            />
          )}

          {currentNav === 'carte-novavisio' && (
            <CarteProspectionView onSelectContact={(contactId) => openClientProfile(contactId)} />
          )}

          {/* Académy : bibliothèque de procédures de l'agence (demandé le
              2 septembre pour ImmoSphera). La tuile qui y mène n'est proposée
              qu'à ImmoSphera, mais l'écran lui-même marche pour n'importe
              quelle société — il lit les ressources de l'agence active. */}
          {currentNav === 'academy' && <AcademyView />}

          {currentNav === 'documents' && <DocumentsView />}

          {currentNav === 'notes' && <NotesView />}

          {currentNav === 'support' && <SupportView />}

          {currentNav === 'parametres' && (
            <ParametresView
              selectedAgency={activeAgency}
              onSelectAgency={setActiveAgency}
              onClose={() => setCurrentNav('accueil')}
              onNavigate={setCurrentNav}
            />
          )}

          {currentNav === 'reserver-camera' && (
            <ReserverCameraView onOpenModal={() => setShowCameraModal(true)} />
          )}

          {currentNav === 'immosphera360' && (
            <div className="h-full overflow-y-auto">
              <MemoryRouter initialEntries={['/immosphera']}>
                <ImmoSidebarProvider>
                  <Routes>
                    <Route
                      path="/immosphera/*"
                      element={
                        <Immosphera
                          initialAiResultIds={immoSeedResultIds}
                          initialAiQueryText={immoSeedQueryText}
                          onSeedConsumed={() => setImmoSeedResultIds(null)}
                          initialSection={immoInitialSection}
                          onInitialSectionConsumed={() => setImmoInitialSection(null)}
                          onExitToCrm={() => setCurrentNav('accueil')}
                        />
                      }
                    />
                  </Routes>
                </ImmoSidebarProvider>
              </MemoryRouter>
            </div>
          )}
            </>
          )}
          </div>

          {/* Demande explicite (30/08/2026) : "à chaque fois je pense que
              c'est long ou ça recharge la page" — Chat était démonté puis
              reconstruit intégralement à chaque fois qu'on le quittait puis
              y revenait, donc TOUT se rechargeait depuis zéro (conversations,
              canaux) à chaque visite. Placé ICI, en dehors du <div
              key={currentNav}> ci-dessus (fermé juste au-dessus) : ce key
              force React à tout redémonter à chaque changement de page —
              y placer Chat aurait rendu ce correctif inopérant (essayé,
              constaté : le montage semblait persister mais l'onglet interne
              Projets/Conversations revenait pourtant systématiquement à sa
              valeur par défaut, signe d'un démontage silencieux). Ici, en
              frère de ce conteneur, Chat reste monté en permanence une fois
              ouvert une première fois (`hasOpenedChat`) — seul son affichage
              bascule via CSS. Suite ("on peut le laisser tourner en fond mais
              très léger, maîtriser la consommation") : `isActive` (voir
              ChatViewSupabase.tsx) coupe le sondage 4s des messages tant que
              ce module n'est pas réellement affiché, pour ne pas continuer à
              interroger la base pour rien pendant qu'on est ailleurs dans le
              CRM — seul le temps réel (poussé, quasi gratuit) reste actif en
              arrière-plan.
              Bug constaté puis corrigé (même passage) : `relative` + flux
              normal plaçait ce bloc APRÈS le <div key={currentNav}> ci-dessus
              dans le document — qui, même VIDE (aucune de ses conditions
              internes ne correspond à 'chat'), réserve quand même sa propre
              hauteur À CAUSE de sa classe `h-full` (hauteur explicite,
              indépendante du contenu). Résultat : Chat était poussé
              entièrement sous la ligne de flottaison, invisible bien que
              présent dans le DOM. `absolute inset-0` superpose maintenant ce
              bloc au conteneur vide au lieu de s'empiler après lui. */}
          {hasOpenedChat && (
            <div className={currentNav === 'chat' ? 'absolute inset-0 z-10 h-full' : 'hidden'}>
              <ChatView
                initialHighlightMessageId={highlightMessageId}
                initialConversationId={targetConversationId}
                initialChannelId={targetChannelId}
                onConversationTargetConsumed={() => setTargetConversationId(null)}
                onChannelTargetConsumed={() => setTargetChannelId(null)}
                onHighlightConsumed={() => setHighlightMessageId(null)}
                onExitMobile={() => setCurrentNav('accueil')}
                isActive={currentNav === 'chat'}
              />
            </div>
          )}
          </EcranErrorBoundary>

          {/* Demande explicite : "en dehors de l'interface principale...
              clique sur le logo de Nova... une fenêtre avec derrière le
              fond un peu opaque (20-30%)... la même interface principale
              mais en beaucoup plus petit... en gardant l'historique si on
              réouvre." Mini-popup, distincte du plein écran `novaOpen`
              ci-dessous — mêmes accès contextuels (fiche client, Pipeline).
              AssistantIAView repose sur `relative`/`h-full` en interne (pas
              de `fixed inset-0` dans son propre rendu), donc son affichage
              s'adapte naturellement à ce cadre plus petit sans rien changer
              dans ce composant lui-même. Historique déjà partagé avec le
              plein écran (même thread persisté en base, voir
              AssistantIAView.tsx) — fermer puis rouvrir (popup ou plein
              écran) retrouve la même conversation. */}
          {/* Mini-popup Nova contextuelle (depuis une fiche client / le
              Pipeline) : fenêtre flottante sur l'écran en cours, avec bouton
              pour basculer en plein écran si la demande s'allonge. Partage
              le même fil persisté en base que le plein écran (voir
              AssistantIAView.tsx) — fermer puis rouvrir (popup ou plein
              écran) retrouve la même conversation. Rendue via createPortal
              dans document.body pour ne jamais être coupée par le Header. */}
          {createPortal(
            <AnimatePresence>
              {novaPopupOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
                  onClick={() => setNovaPopupOpen(false)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 12 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="nova-popup-window relative w-full max-w-xl h-[min(82vh,640px)] rounded-3xl overflow-hidden shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] border border-white/15 bg-[#050d0f]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className="absolute top-3 left-3 z-30 flex items-center gap-1.5 p-1 rounded-full bg-white/85 hover:bg-white backdrop-blur-md border border-white/90 shadow-md transition-all"
                    >
                      <button
                        type="button"
                        onClick={() => setNovaPopupOpen(false)}
                        title="Fermer"
                        className="w-7 h-7 rounded-full bg-black/5 hover:bg-rose-500/20 text-[#1a1230] hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setNovaPopupOpen(false); setNovaExpandedFromPopup(true); setNovaOpen(true); }}
                        title="Agrandir en plein écran"
                        className="w-7 h-7 rounded-full bg-black/5 hover:bg-black/10 text-[#1a1230] flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <EcranErrorBoundary resetKey="nova-popup" plein>
                      <Suspense fallback={<ChargementEcran />}>
                        <AssistantIAView
                          isPopup
                          currentClientId={selectedClientProfileId}
                          initialPrompt={novaAIPrompt}
                          onInitialPromptConsumed={() => setNovaAIPrompt(null)}
                          prefillPrompt={novaPrefillPrompt}
                          onPrefillPromptConsumed={() => setNovaPrefillPrompt(null)}
                          onOpenContact={(contactId) => {
                            openClientProfile(contactId);
                            setNovaPopupOpen(false);
                          }}
                        />
                      </Suspense>
                    </EcranErrorBoundary>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}

          {/* Nova IA en superposition de l'interface principale (ticket #1:
              rester sur la même interface, que ce soit via le clic sur
              "Assistant IA" ou une commande tapée dans la barre NovaAI de
              l'accueil) — l'accueil (ou toute autre vue en cours) reste
              monté et intact en dessous, on ne change plus `currentNav`. */}
          {/* Signalé : l'écran Nova IA apparaissait d'un coup ("flash") —
              un fondu enchaîné doux (léger zoom + fondu) le rend beaucoup
              plus agréable à l'ouverture comme à la fermeture. */}
          <AnimatePresence>
            {novaOpen && !isMobile && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 z-40 bg-[#050d0f] flex flex-col overflow-hidden"
              >
                {novaExpandedFromPopup && (
                  <button
                    type="button"
                    onClick={() => { setNovaOpen(false); setNovaExpandedFromPopup(false); setNovaPopupOpen(true); }}
                    title="Revenir à la fenêtre réduite"
                    className="absolute z-30 pl-2.5 pr-3.5 py-2 rounded-full bg-white/70 hover:bg-white/90 border border-white/80 shadow-sm text-[#1a1230] text-xs font-semibold flex items-center gap-1 transition-colors"
                    style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))', left: '1rem' }}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Retour
                  </button>
                )}
                <EcranErrorBoundary resetKey="nova" plein>
                <AssistantIAView
                  initialPrompt={novaAIPrompt}
                  onInitialPromptConsumed={() => setNovaAIPrompt(null)}
                  currentClientId={selectedClientProfileId}
                  prefillPrompt={novaPrefillPrompt}
                  onPrefillPromptConsumed={() => setNovaPrefillPrompt(null)}
                  startFresh={!novaExpandedFromPopup}
                  onClose={() => {
                    setNovaOpen(false);
                    setNovaExpandedFromPopup(false);
                  }}
                  onFoundProperties={(ids, queryText) => {
                    setImmoSeedResultIds(ids);
                    setImmoSeedQueryText(queryText);
                    setNovaOpen(false);
                    setNovaExpandedFromPopup(false);
                    setCurrentNav('immosphera360');
                  }}
                  onOpenContact={(contactId) => {
                    openClientProfile(contactId);
                    setNovaOpen(false);
                    setNovaExpandedFromPopup(false);
                  }}
                />
                </EcranErrorBoundary>
              </motion.div>
            )}
          </AnimatePresence>
          </Suspense>
        </main>

        {/* Signalé : "l'écran déborde", puis contour arc-en-ciel asymétrique
            (couleur quasi absente en haut) — cause réelle : rendu imbriqué
            dans la hiérarchie normale de l'app, ce calque héritait d'un
            ancêtre qui modifie le contexte de positionnement (déjà rencontré
            ailleurs dans ce code, voir ticket #17), faussant à la fois le
            calcul de hauteur et le centrage du contour tournant. Rendu ici
            via un portail direct dans <body>, comme la solution déjà
            éprouvée sur l'ancien tiroir de saisie rapide : ancré au vrai
            viewport, sans hériter de rien. */}
        {createPortal(
          <AnimatePresence>
            {novaOpen && isMobile && (
              // z-30, sous la barre de nav du bas (z-40, elle-même hors de ce
              // portail) : elle doit rester visible et cliquable par-dessus —
              // c'est l'unique moyen de sortir de cet écran sur mobile.
              // Fondu enchaîné doux à l'ouverture/fermeture (au lieu d'un
              // "flash" instantané).
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="fixed inset-0 z-30 overflow-hidden"
              >
                <div
                  className="absolute top-1/2 left-1/2 pointer-events-none"
                  style={{
                    width: '200vmax',
                    height: '200vmax',
                    marginTop: '-100vmax',
                    marginLeft: '-100vmax',
                    background:
                      'conic-gradient(from 0deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #af52de, #ff2d78, #ff3b30)',
                    animation: 'novaRainbowSpin 7s linear infinite',
                    opacity: 0.8,
                  }}
                />
                <div className="absolute inset-[3px] bg-[#050d0f] overflow-hidden rounded-[22px]">
                  {/* CORRECTIF (31/08/2026) — signalé : « Nova ne s'ouvre pas
                      sur le téléphone », le bouton du bas ne faisait rien.

                      Ce panneau vit dans un portail, DEHORS de <main> et donc
                      hors de la frontière de chargement posée cet après-midi
                      avec le découpage du paquet. Les deux montages de Nova
                      côté ordinateur, eux, sont à l'intérieur. Depuis que
                      l'écran est chargé à la demande, il se suspend le temps
                      de son téléchargement — et un composant qui se suspend
                      sans frontière pour l'accueillir ne rend RIEN. D'où le
                      bouton sans effet, sur mobile uniquement.

                      Sa propre frontière, donc. */}
                  <EcranErrorBoundary resetKey="nova-mobile" plein>
                  <Suspense fallback={<ChargementEcran />}>
                  <AssistantIAView
                    initialPrompt={novaAIPrompt}
                    onInitialPromptConsumed={() => setNovaAIPrompt(null)}
                    onClose={() => {
                      setNovaOpen(false);
                      setNovaAutoDictation(false);
                      // Même retour contextuel que sur desktop (voir plus
                      // haut) si on vient d'agrandir depuis la mini-popup.
                      if (novaExpandedFromPopup) { setNovaExpandedFromPopup(false); setNovaPopupOpen(true); }
                    }}
                    currentClientId={selectedClientProfileId}
                    prefillPrompt={novaPrefillPrompt}
                    onPrefillPromptConsumed={() => setNovaPrefillPrompt(null)}
                    autoVoiceMode={novaAutoVoice}
                    onAutoVoiceModeConsumed={() => setNovaAutoVoice(false)}
                    autoDictation={novaAutoDictation}
                    onAutoDictationConsumed={() => setNovaAutoDictation(false)}
                    // Voir commentaire équivalent côté bureau plus haut.
                    startFresh={!novaExpandedFromPopup}
                    onFoundProperties={(ids, queryText) => {
                      setImmoSeedResultIds(ids);
                      setImmoSeedQueryText(queryText);
                      setNovaOpen(false);
                      setNovaExpandedFromPopup(false);
                      setCurrentNav('immosphera360');
                    }}
                    onOpenContact={(contactId) => {
                      openClientProfile(contactId);
                      setNovaOpen(false);
                      setNovaExpandedFromPopup(false);
                    }}
                  />
                  </Suspense>
                  </EcranErrorBoundary>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>

      {/* Panneau latéral droit des notifications — effet tiroir fluide avec AnimatePresence et createPortal */}
      {createPortal(
        <AnimatePresence>
          {notificationsPanelOpen && (
            <>
              <motion.div
                key="notifications-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: 'easeInOut' }}
                onClick={() => setNotificationsPanelOpen(false)}
                className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm cursor-default"
                aria-label="Fermer les notifications"
              />
              <motion.aside
                key="notifications-drawer"
                initial={{ x: '100%', opacity: 0.3 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0.3 }}
                transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                className="fixed right-3 sm:right-4 top-3 sm:top-4 bottom-3 sm:bottom-4 z-[80] w-[calc(100%-1.5rem)] sm:w-[440px] lg:w-[480px] bg-[#071317]/95 backdrop-blur-2xl border border-teal-500/25 rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85),0_0_30px_rgba(247,188,95,0.1)] flex flex-col overflow-hidden will-change-transform"
                style={{
                  top: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
                  bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
                }}
              >
            {/* Liseré supérieur or lumineux */}
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F]/60 to-transparent pointer-events-none" />

            <div className="min-h-14 shrink-0 px-4.5 sm:px-5 flex items-center justify-between border-b border-teal-500/15 bg-gradient-to-r from-[#081b1e]/95 via-[#0b2427]/95 to-[#081b1e]/95 pt-[env(safe-area-inset-top,0px)]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#F7BC5F]/25 to-amber-600/30 border border-[#F7BC5F]/40 flex items-center justify-center text-[#FAD592] shadow-[0_0_12px_rgba(247,188,95,0.25)] shrink-0">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white tracking-wide truncate">Rappels &amp; Alertes</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNotificationsPanelOpen(false)}
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors shrink-0"
                title="Fermer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              <NotificationsView
                ouverte={notificationsPanelOpen}
                onNavigate={(nav) => {
                  setNotificationsPanelOpen(false);
                  setCurrentNav(nav);
                  openClientProfile(null);
                  if (nav === 'reserver-camera') {
                    setShowCameraModal(true);
                  }
                }}
                onOpenContact={(contactId, tab) => {
                  setNotificationsPanelOpen(false);
                  openClientProfile(contactId, tab);
                  setHighlightPulse(Date.now());
                }}
                onOpenMessage={(cible) => {
                  setNotificationsPanelOpen(false);
                  openClientProfile(null);
                  if (cible.messageId) setHighlightMessageId(cible.messageId);
                  if (cible.conversationId) setTargetConversationId(cible.conversationId);
                  if (cible.channelId) setTargetChannelId(cible.channelId);
                  setHasOpenedChat(true);
                  setCurrentNavImmediat('chat');
                }}
                onOpenInternalTask={(taskId, messageId) => {
                  setNotificationsPanelOpen(false);
                  openClientProfile(null);
                  setHighlightTaskId(taskId);
                  setHighlightTaskMessageId(messageId || null);
                  setCurrentNav('projets-internes');
                }}
              />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  )}

      {/* Nouveau Lead Modal */}
      <NouveauLeadModal
        isOpen={showNouveauLead}
        onClose={() => setShowNouveauLead(false)}
        onSubmit={async (data) => {
          const created = await addContact.mutateAsync(data);
          // Demande explicite (14 octobre) : une fois le contact enregistré,
          // ouvrir directement sa fiche — plus seulement pendant la visite
          // guidée (qui, elle, enchaîne en plus sur l'étape suivante du
          // tour). La modale se ferme déjà toute seule juste après (voir
          // NouveauLeadModal.tsx, onClose() après onSubmit réussi).
          openClientProfile(created.id);
          if (showProductTour) {
            setTourSignalNext((n) => n + 1);
          }
          return created;
        }}
        selectedAgencyId={activeAgency.id}
      />

      {/* Tutorial Modal */}
      <TutorialModal
        isOpen={showTutorial}
        onClose={() => setShowTutorial(false)}
        onStartTour={() => setShowProductTour(true)}
        onNavigateAction={(target) => {
          if (target === 'nouveau-lead') {
            setShowNouveauLead(true);
          } else if (target === 'assistant-ia') {
            openNovaFullscreen();
          } else if (target === 'camera') {
            setShowCameraModal(true);
          } else {
            setNovaOpen(false);
            openClientProfile(null);
            setCurrentNav(target);
          }
        }}
      />

      {/* Ticket #49 : visite guidée interactive */}
      <ProductTour
        steps={PRODUCT_TOUR_STEPS}
        open={showProductTour}
        onClose={() => setShowProductTour(false)}
        signalNext={tourSignalNext}
      />

      {/* SQL Import Modal */}
      <SqlImportModal
        isOpen={showSqlImport}
        onClose={() => setShowSqlImport(false)}
      />

      {/* Camera Reservation Modal */}
      <CameraReservationModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
      />

      {/* Dictée vocale rapide vers une fiche client depuis l'interface principale */}
      <QuickClientDictationModal
        isOpen={showQuickClientDictation}
        onClose={() => setShowQuickClientDictation(false)}
        initialClientId={selectedClientProfileId}
        onOpenClientProfile={(clientId) => openClientProfile(clientId)}
      />

      {/* Mobile Bottom Navigation Bar — masquée sur mobile pendant le chat et
          pendant Nova IA (demande explicite) pour leur laisser tout l'écran ;
          chacun a son propre bouton retour intégré pour en ressortir. */}
      {!(isMobile && (currentNav === 'chat' || novaOpen || novaPopupOpen)) && (
        <MobileBottomNav
          currentNav={currentNav}
          onNavigate={(nav) => {
            if (nav === 'assistant-ia') {
              setNovaOpen((open) => !open);
              return;
            }
            setNovaOpen(false);
            setCurrentNav(nav);
            setSelectedClientProfileId(null);
          }}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenNotifications={() => setNotificationsPanelOpen((open) => !open)}
          // Signalé : le petit tiroir de saisie rapide (fenêtre noire) était
          // une étape en trop avant d'atteindre la vraie conversation —
          // retiré, on ouvre directement l'écran Nova IA complet. Demande
          // ensuite : "mode Commercial/Bureau" — openNovaMobile respecte le
          // dernier mode choisi (voir plus haut).
          onOpenNova={() => openNovaMobile()}
          onOpenDictation={() => openNovaMobileWithDictation()}
          unreadMessagesCount={unreadMessagesCount}
          unreadNotificationsCount={unreadMobileNotificationsCount}
          unreadRemindersCount={unreadRemindersCount}
        />
      )}
      {/* En-tête mobile unifié pour les sous-vues (titre, retour accueil, action contextuelle) */}
      {isMobile && currentNav !== 'accueil' && !selectedClientProfileId && !(currentNav === 'chat' || currentNav === 'mail' || novaOpen) && (
        <MobileHeader
          currentNav={currentNav}
          onBack={() => setCurrentNav('accueil')}
          onOpenAction={
            currentNav === 'agenda'
              ? () => setAgendaCreateSignal((n) => n + 1)
              : (currentNav === 'clients' || currentNav === 'pipeline')
                ? () => setShowNouveauLead(true)
                : currentNav === 'rappels'
                  ? () => window.dispatchEvent(new CustomEvent('nova-open-new-task'))
                  : currentNav === 'notes'
                    ? () => window.dispatchEvent(new CustomEvent('nova-open-new-note'))
                    : currentNav === 'documents'
                      ? () => window.dispatchEvent(new CustomEvent('nova-open-new-document'))
                      : currentNav === 'reserver-camera'
                        ? () => window.dispatchEvent(new CustomEvent('nova-open-camera-reservation'))
                        : undefined
          }
          activeAgency={activeAgency}
          unreadRemindersCount={unreadRemindersCount}
        />
      )}
      {/* Bouton « + » pour composer un e-mail sur mobile */}
      {isMobile && currentNav === 'mail' && !mailReading && !selectedClientProfileId && !(novaOpen) && (
        <MobileTopPlus onClick={() => setMailComposeSignal((n) => n + 1)} label="Écrire un message" />
      )}
    </div>
  );
}

export default App;