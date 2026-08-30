import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  Settings, HardDrive, UserCog, Users, Megaphone, Bell, Mail, Sparkles, Download,
  KeyRound, ListChecks, LayoutGrid, ContactRound, Palette, ChevronDown, ChevronUp,
  GripVertical, Save, Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, Camera,
  Image as ImageIcon, Code2, Volume2, Smartphone, CalendarClock, LogOut, CheckCircle2,
  Loader2, Building2, RefreshCw, X, Eye, EyeOff, Copy, ExternalLink, Link, Check,
  Sliders, Upload, Layers, Send, Power, PowerOff, Clock, Ban, UserPlus, MailCheck, Zap, Mic, Search
} from 'lucide-react';
import { AGENCIES, Agency } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { getAgencyLogo, sortByAgencyOrder } from '@/lib/agency-logos';
import { requestWorkspaceAccessToken, getCachedAccessToken, reconnectGoogleWorkspace } from '@/lib/workspace';
import { updateCssAccentVars, updateCssCalendarAccentVars } from '@/utils/theme';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '@/hooks/use-mobile';
import { NAV_ITEMS } from './Sidebar';

interface ParametresViewProps {
  selectedAgency: Agency;
  onSelectAgency: (agency: Agency) => void;
}

// Ticket "Paramètres/Nova/Utilisateurs/Annonces" (10/16) : 'users' retiré —
// la gestion des utilisateurs est désormais centralisée dans Équipe (onglet
// "Gestion des utilisateurs", EquipeView.tsx), suite logique du ticket #153
// qui avait déjà retiré les boutons de création d'ici.
type SectionId = 'drive' | 'profile' | 'announcements' | 'notifications' | 'mail' | 'export' | 'event-titles' | 'sidebar-order' | 'contact-types' | 'appearance' | 'home-tiles' | 'automations' | 'pipeline-automations';
type SectionConfig = { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean };

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  agency_ids: string[];
  is_active?: boolean;
  is_validated?: boolean;
};

// Ticket #8 (nouvelle base) : ordre aligné sur celui de la barre latérale
// (Accueil → Rappels → Mail → ... ) pour les sections qui s'y rattachent,
// suivi des réglages d'interface puis des sections réservées aux admins.
const DEFAULT_SECTIONS: SectionConfig[] = [
  { id: 'profile', label: 'Mon profil', icon: UserCog },
  { id: 'home-tiles', label: 'Raccourcis masqués (Accueil)', icon: EyeOff },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'automations', label: 'Automatisations', icon: Zap },
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : distinct de
  // "Automatisations" ci-dessus (rappels personnels) — configuration, PAR
  // SOCIÉTÉ, des e-mails proposés automatiquement quand un client change
  // d'étape de pipeline.
  { id: 'pipeline-automations', label: 'Automatisations pipeline', icon: Zap, adminOnly: true },
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'appearance', label: 'Apparence', icon: Palette },
  { id: 'sidebar-order', label: 'Ordre des onglets', icon: LayoutGrid },
  { id: 'contact-types', label: 'Types de contact', icon: ContactRound },
  { id: 'event-titles', label: 'Titres des tâches et rendez-vous', icon: ListChecks },
  { id: 'export', label: 'Exporter mes données', icon: Download },
  { id: 'drive', label: 'Stockage Google Drive par agence', icon: HardDrive, adminOnly: true },
  { id: 'announcements', label: 'Annonces', icon: Megaphone, adminOnly: true },
];

// Exportés pour que TaskModal (création/édition de tâche) utilise exactement
// les mêmes valeurs par défaut et la même source que cette page Paramètres.
export const DEFAULT_TASK_TITLES = ['Appeler le client','A faire','Att retour caution','Att retour client','Att retour banque','Att documents client','Att retour Back-office','Att retour assurance','Att accord banque','Att offre de prêt','Att décompte','Att date de signature','Envoi ODP notaire'];
export const DEFAULT_APPOINTMENT_TITLES = ['Rendez-vous client','Visite','Signature','Appel découverte','Réunion équipe'];
const DEFAULT_CONTACT_TYPES = ['Particulier','Professionnel','Téléphone','Email','Rendez-vous','Salon / Événement','Recommandation','Site web','Autre'];
const DEFAULT_TABS: Array<[string, string]> = [
  ['Accueil', 'accueil'],
  ['Tableau de bord', 'tableau-de-bord'],
  ['Clients', 'clients'],
  ['Pipeline', 'pipeline'],
  ['Projets internes', 'projets-internes'],
  ['Agenda', 'agenda'],
  ['Rappels', 'rappels'],
  ['Chat', 'chat'],
  ['Mail', 'mail'],
  ['Équipe', 'equipe'],
  ['Documents', 'documents'],
  ['Notes', 'notes'],
  ['Support', 'support'],
  ['Paramètres', 'parametres'],
  ['Nova', 'assistant-ia'],
  ['Réserver caméra', 'reserver-camera'],
  // Onglet manquant (signalé) : présent dans la barre latérale (Sidebar.tsx)
  // mais absent de cette liste, donc invisible dans "Ordre des onglets".
  ['Immosphera360', 'immosphera360'],
  ['Carte', 'carte-novavisio'],
];

// Ticket #8 (nouvelle base, correctif) : le premier essai figeait un ordre
// codé en dur, mais l'ordre des sections Paramètres était déjà mis en cache
// par utilisateur (clé localStorage) — donc invisible pour qui avait déjà
// ouvert Paramètres avant. On calcule maintenant l'ordre par défaut à partir
// de l'ordre RÉEL et actuel de la barre latérale (novasphere_sidebar_order,
// que l'utilisateur ait pu la personnaliser ou non) pour les sections qui
// correspondent à une page de la barre latérale, et on change la clé de
// stockage (v3 → v4) pour que ce nouvel ordre par défaut s'applique même
// chez ceux qui avaient déjà un ordre enregistré.
const SECTION_TO_SIDEBAR_ID: Partial<Record<SectionId, string>> = {
  'home-tiles': 'accueil',
  'notifications': 'rappels',
  'mail': 'mail',
};

function computeDefaultSectionOrder(sections: SectionConfig[]): SectionId[] {
  let sidebarIds: string[] = DEFAULT_TABS.map(t => t[1]);
  try {
    const saved = localStorage.getItem('novasphere_sidebar_order');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) sidebarIds = parsed;
    }
  } catch {
    // ignore, on garde l'ordre par défaut de la barre latérale
  }

  const mapped = sections.filter(s => SECTION_TO_SIDEBAR_ID[s.id]);
  const unmapped = sections.filter(s => !SECTION_TO_SIDEBAR_ID[s.id]);

  mapped.sort((a, b) => {
    const aIndex = sidebarIds.indexOf(SECTION_TO_SIDEBAR_ID[a.id]!);
    const bIndex = sidebarIds.indexOf(SECTION_TO_SIDEBAR_ID[b.id]!);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  return [...mapped, ...unmapped].map(s => s.id);
}

export const INTERFACE_COLORS = [
  { id: 'gold', name: 'Or Élégance', hex: '#F7BC5F' },
  { id: 'sapphire', name: 'Bleu Saphir', hex: '#3B82F6' },
  { id: 'emerald', name: 'Vert Émeraude', hex: '#10B981' },
  { id: 'amethyst', name: 'Violet Améthyste', hex: '#8B5CF6' },
  { id: 'ruby', name: 'Rouge Rubis', hex: '#EF4444' },
  { id: 'cyan', name: 'Cyan Lagon', hex: '#06B6D4' },
  { id: 'rose', name: 'Rose Fuchsia', hex: '#EC4899' },
  { id: 'coral', name: 'Orange Corail', hex: '#F97316' },
  { id: 'amber', name: 'Ambre Chaud', hex: '#F59E0B' },
  { id: 'lime', name: 'Citron Lime', hex: '#84CC16' },
  { id: 'teal', name: 'Turquoise Pacifique', hex: '#14B8A6' },
  { id: 'slate', name: 'Gris Platine', hex: '#94A3B8' },
];

export const PRESET_BACKGROUNDS = [
  { id: 'none', name: 'Aucune image (Fond sombre)', url: '' },
  { id: 'space', name: 'Aurore Cosmique', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=1920&auto=format&fit=crop' },
  { id: 'stars', name: 'Nuit Étoilée', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1920&auto=format&fit=crop' },
  { id: 'mountains', name: 'Montagnes Sombres', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1920&auto=format&fit=crop' },
  { id: 'mesh', name: 'Hexagones Cyber', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920&auto=format&fit=crop' },
  { id: 'marble', name: 'Marbre Sombre', url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=1920&auto=format&fit=crop' },
  { id: 'abstract', name: 'Géométrie Néon', url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1920&auto=format&fit=crop' },
  { id: 'ocean', name: 'Vague Océan', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=1920&auto=format&fit=crop' },
];

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function readStorage<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
const writeStorage = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
const reorder = <T,>(items: T[], from: number, to: number) => { if (to < 0 || to >= items.length) return items; const next=[...items]; const [item]=next.splice(from,1); next.splice(to,0,item); return next; };
const notify = (message: string) => window.alert(message);

const inputClass = 'w-full rounded-xl bg-[#071f21] border border-[#1c4448] px-3 py-2.5 text-sm text-white outline-none focus:border-[#F7BC5F]';
const goldButton = 'px-4 py-2 rounded-xl bg-[#F7BC5F] text-[#07191b] text-xs font-bold flex items-center gap-2 hover:bg-[#f0c557] disabled:opacity-50 disabled:cursor-not-allowed';

const Toggle: React.FC<{ checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }> = ({ checked, onChange, disabled }) => (
  <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full border transition-all disabled:opacity-50 ${checked ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'bg-[#173137] border-[#28474c]'}`} aria-pressed={checked}>
    <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-[#07191b] shadow transition-all ${checked ? 'left-[21px]' : 'left-[3px]'}`} />
  </button>
);

export default function ParametresView({ selectedAgency, onSelectAgency }: ParametresViewProps) {
  const { currentUser, userProfile, logout, activeAgency } = useAuth();
  const isAdmin = userProfile?.role === 'super_admin';
  const uid = currentUser?.uid;
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const [driveOAuthError, setDriveOAuthError] = useState<string | null>(null);
  // Signalé (30/08/2026) : depuis la tuile "Annonce" de l'accueil, la barre
  // latérale des réglages (13 sections, sans rapport avec l'annonce qu'on
  // vient rédiger) s'affichait quand même avant le contenu — "il faudrait
  // l'enlever car c'est pas là qu'on gère les paramètres [dans ce
  // contexte]". Distinct de openSection : ce flag dit qu'on est arrivé via
  // un raccourci direct (pas depuis "Paramètres" dans le menu), donc que la
  // barre latérale est superflue ici — masquée dans ce cas, avec un simple
  // lien pour la faire réapparaître si besoin (voir plus bas).
  const [focusedFromTile, setFocusedFromTile] = useState(false);

  // Ticket #255 : la tuile "Annonce" de l'accueil dépose ce flag avant de
  // naviguer ici, pour ouvrir directement la section Annonces plutôt que
  // la première section générique — consommé une seule fois au montage.
  useEffect(() => {
    try {
      const target = sessionStorage.getItem('novaOpenParametresSection');
      if (target) {
        sessionStorage.removeItem('novaOpenParametresSection');
        setOpenSection(target as SectionId);
        setFocusedFromTile(true);
      }
    } catch { /* stockage indisponible, tant pis */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (openSection === 'home-tiles') refreshHiddenHomeTiles();
    if (openSection === 'announcements' && isAdmin) void loadAnnouncementsAdmin();
    if (openSection === 'automations') void loadAutomations();
    if (openSection === 'pipeline-automations' && isAdmin) void loadPipelineAutomations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSection]);

  // Retour de /api/admin/drive/callback (?parametres=drive&drive_error=...)
  // après une tentative de connexion du Drive partagé d'une agence : ouvre
  // directement la section Drive et affiche l'erreur éventuelle, plutôt que
  // de laisser l'utilisateur sur l'accueil sans aucun retour visible.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('parametres') === 'drive') {
      setOpenSection('drive');
      const err = params.get('drive_error');
      if (err) setDriveOAuthError(err);
      params.delete('parametres');
      params.delete('drive_error');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAnnouncementsAdmin = async () => {
    const [{ data: list }, { data: reads }, { data: options }, { data: votes }] = await Promise.all([
      supabase.from('announcements').select('id, message, created_at, is_poll').order('created_at', { ascending: false }).limit(20),
      supabase.from('announcement_reads').select('announcement_id, user_id'),
      supabase.from('announcement_poll_options' as any).select('id, announcement_id, label, sort_order').order('sort_order', { ascending: true }),
      supabase.from('announcement_poll_votes' as any).select('announcement_id, option_id, user_id'),
    ]);
    setPastAnnouncements((list || []) as any);
    const byAnnouncement: Record<string, string[]> = {};
    ((reads || []) as any[]).forEach((r) => {
      const name = users.find((u) => u.id === r.user_id)?.full_name || r.user_id;
      (byAnnouncement[r.announcement_id] ||= []).push(name);
    });
    setAnnouncementReaders(byAnnouncement);

    // Demande explicite : voir les résultats d'un sondage (nombre de votes
    // par choix, et qui a voté quoi) directement dans Paramètres/Annonces.
    const optionsByAnnouncement: Record<string, Array<{ id: string; label: string }>> = {};
    ((options || []) as any[]).forEach((o) => {
      (optionsByAnnouncement[o.announcement_id] ||= []).push({ id: o.id, label: o.label });
    });
    const votesByOption: Record<string, string[]> = {};
    ((votes || []) as any[]).forEach((v) => {
      const name = users.find((u) => u.id === v.user_id)?.full_name || v.user_id;
      (votesByOption[v.option_id] ||= []).push(name);
    });
    setAnnouncementPollOptions(optionsByAnnouncement);
    setAnnouncementPollVotes(votesByOption);
  };
  const isMobile = useIsMobile();
  const visibleSections = useMemo(() => DEFAULT_SECTIONS.filter(s => !s.adminOnly || isAdmin), [isAdmin]);
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(() => readStorage('novasphere:settings-order-v4', computeDefaultSectionOrder(DEFAULT_SECTIONS)));
  const [busy, setBusy] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [driveStatus, setDriveStatus] = useState<Record<string, { google_email?: string | null; updated_at?: string | null }>>({});
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const [profileName, setProfileName] = useState(userProfile?.displayName || '');
  const [profilePhone, setProfilePhone] = useState(userProfile?.phone || '');
  const [profileJob, setProfileJob] = useState(userProfile?.jobTitle || '');
  const [profileAvatar, setProfileAvatar] = useState(userProfile?.photoURL || '');
  const [userDriveConnected, setUserDriveConnected] = useState<boolean>(() => !!getCachedAccessToken());
  // Ticket #267 : kDrive (Infomaniak) — connexion personnelle par
  // utilisateur, même principe que Google Drive personnel ci-dessus.
  const [kdriveConnected, setKdriveConnected] = useState(false);
  const [kdriveDriveId, setKdriveDriveId] = useState<string | null>(null);
  const [kdriveDriveIdInput, setKdriveDriveIdInput] = useState('');
  const [mailSignature, setMailSignature] = useState('');
  const [mailSignatureImage, setMailSignatureImage] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('novasphere:theme') || 'dark');

  const [taskTitles, setTaskTitles] = useState(DEFAULT_TASK_TITLES);
  const [appointmentTitles, setAppointmentTitles] = useState(DEFAULT_APPOINTMENT_TITLES);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newAppointmentTitle, setNewAppointmentTitle] = useState('');
  const [contactTypes, setContactTypes] = useState<string[]>(() => readStorage('novasphere:contact-types', DEFAULT_CONTACT_TYPES));
  const [newContactType, setNewContactType] = useState('');
  // Raccourcis de l'accueil supprimés depuis la grille — déplacés ici au
  // lieu d'être perdus définitivement (voir AccueilGrid.handleDeleteTile).
  const [hiddenHomeTiles, setHiddenHomeTiles] = useState<Array<{ id: string; title: string; iconName: string }>>(
    () => readStorage('novasphere_hidden_tiles_v1', [])
  );
  const refreshHiddenHomeTiles = () => setHiddenHomeTiles(readStorage('novasphere_hidden_tiles_v1', []));
  // Signalé : "Réafficher" ne faisait plus rien depuis les Paramètres.
  // Cause : ça reposait entièrement sur un évènement écouté par l'accueil
  // (AccueilGrid) — qui n'est pas monté tant qu'on est sur la page
  // Paramètres, donc l'évènement partait dans le vide, silencieusement.
  // Corrigé : on manipule directement le même stockage que l'accueil
  // (cloisonné par agence désormais), ce qui fonctionne qu'il soit monté ou
  // non ; un évènement léger de "rafraîchissement" est quand même envoyé en
  // plus, pour qu'un accueil déjà ouvert dans un autre onglet se
  // resynchronise tout de suite sans attendre un rechargement.
  const restoreHomeTile = (id: string) => {
    try {
      const rawHidden = localStorage.getItem('novasphere_hidden_tiles_v1');
      const hidden: Array<{ id: string; [k: string]: unknown }> = rawHidden ? JSON.parse(rawHidden) : [];
      const tile = hidden.find((t) => t.id === id);
      if (!tile) return;
      localStorage.setItem('novasphere_hidden_tiles_v1', JSON.stringify(hidden.filter((t) => t.id !== id)));

      const agencyId = activeAgency?.id || 'default';
      const tilesKey = `novasphere_home_tiles_v3_${agencyId}`;
      const rawTiles = localStorage.getItem(tilesKey);
      const tiles: Array<{ id: string; [k: string]: unknown }> = rawTiles ? JSON.parse(rawTiles) : [];
      if (!tiles.some((t) => t.id === id)) {
        localStorage.setItem(tilesKey, JSON.stringify([...tiles, tile]));
      }

      window.dispatchEvent(new Event('novasphere:home-tiles-changed'));
    } catch (err) {
      console.warn('Erreur lors du réaffichage de la tuile :', err);
    }
    refreshHiddenHomeTiles();
  };
  // Réordonne DEFAULT_TABS selon une liste d'ids sauvegardée (localStorage ou
  // serveur), en conservant les onglets manquants/nouveaux à la fin.
  const mergeTabOrder = (ids: string[]): Array<[string, string]> => {
    const normalized = ids.map(id => id === 'messagerie' ? 'chat' : id === 'immosphera' ? 'assistant-ia' : id);
    const map = new Map(DEFAULT_TABS.map(x => [x[1], x]));
    const valid = normalized.map(id => map.get(id)).filter(Boolean) as Array<[string, string]>;
    const missing = DEFAULT_TABS.filter(x => !normalized.some(o => o === x[1]));
    return [...valid, ...missing];
  };
  const [tabs, setTabs] = useState<Array<[string,string]>>(() => {
    const old = readStorage<string[]>('novasphere_sidebar_order', []);
    return old.length ? mergeTabOrder(old) : DEFAULT_TABS;
  });

  const [notificationsEnabled, setNotificationsEnabled] = useState(() => readStorage('novasphere:notifications-enabled', true));
  const [notificationSound, setNotificationSound] = useState(() => readStorage('novasphere:notification-sound', false));
  const [pushEnabled, setPushEnabled] = useState(() => readStorage('novasphere:push-enabled', false));
  const [dailyReminder, setDailyReminder] = useState(true);

  const [announcement, setAnnouncement] = useState('');
  const [announcementAgencyIds, setAnnouncementAgencyIds] = useState<string[]>(() => AGENCIES.filter(a => a.id !== 'all').map(a => a.id));
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (16/16) : niveau (3
  // couleurs), lien vers un élément du CRM, expiration automatique, et
  // ciblage étendu à une seule personne (en plus des sociétés ci-dessus).
  // Ticket #241 : 5 niveaux (l'ancien "urgent" est retiré, remappé sur
  // "important" côté base — cf. supabase/migrations/20260827140000_announcements_5_levels.sql).
  const [announcementLevel, setAnnouncementLevel] = useState<'info' | 'a_verifier' | 'important' | 'succes' | 'veille' | 'reponse_demandee' | 'signature_acte'>('info');
  const [announcementLink, setAnnouncementLink] = useState('');
  const [announcementExpiresAt, setAnnouncementExpiresAt] = useState('');
  const [announcementTargetUserId, setAnnouncementTargetUserId] = useState('');
  // Demande explicite : "possibilité de créer un sondage avec possibilité
  // de rajouter des choix (oui/non/peut-être/intéressé/pas intéressé/
  // présent/absent...)" — options libres + quelques suggestions rapides
  // pour éviter de retaper les choix les plus courants à chaque fois.
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>([]);
  const [newPollOption, setNewPollOption] = useState('');
  const POLL_OPTION_PRESETS = ['Oui', 'Non', 'Peut-être', 'Intéressé', 'Pas intéressé', 'Présent', 'Absent'];
  const addPollOption = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || pollOptions.includes(trimmed)) return;
    setPollOptions((cur) => [...cur, trimmed]);
    setNewPollOption('');
  };
  // Ticket #22 (nouvelle base) : le super admin doit pouvoir savoir qui a
  // consulté une annonce — historique + lecteurs par annonce.
  const [pastAnnouncements, setPastAnnouncements] = useState<Array<{ id: string; message: string; created_at: string; is_poll?: boolean }>>([]);
  const [announcementReaders, setAnnouncementReaders] = useState<Record<string, string[]>>({});
  const [expandedAnnouncementId, setExpandedAnnouncementId] = useState<string | null>(null);
  // Signalé (30/08/2026) : "l'historique... ça crée un scroll" — repliée
  // par défaut plutôt que supprimée (aucune donnée perdue : qui a lu quoi
  // reste consultable en un clic, juste plus affiché par défaut).
  const [showPastAnnouncements, setShowPastAnnouncements] = useState(false);
  // Demandé (30/08/2026) : "ouvrir une fenêtre avec les icônes/profils des
  // utilisateurs pour les sélectionner... filtrer par société... petite
  // barre de recherche" — pour choisir UN destinataire ponctuel sans faire
  // défiler une longue liste plate (pensé pour beaucoup d'utilisateurs).
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [userPickerQuery, setUserPickerQuery] = useState('');
  const [userPickerAgencyFilter, setUserPickerAgencyFilter] = useState('');
  const [announcementPollOptions, setAnnouncementPollOptions] = useState<Record<string, Array<{ id: string; label: string }>>>({});
  const [announcementPollVotes, setAnnouncementPollVotes] = useState<Record<string, string[]>>({});
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null);
  const [deletingAllAnnouncements, setDeletingAllAnnouncements] = useState(false);

  // Ticket #25 (nouvelle base) : automatisations Nova IA — récap de journée
  // et récap mails à horaires fixes, exécutés côté serveur (Vercel Cron +
  // fonction Edge Supabase run-automations), donc actifs même app fermée.
  const [automations, setAutomations] = useState<Array<{ id: string; type: string; times: string[]; is_active: boolean }>>([]);
  const [loadingAutomations, setLoadingAutomations] = useState(false);
  const [newAutomationType, setNewAutomationType] = useState<'daily_brief' | 'mail_digest'>('daily_brief');
  const [newAutomationTimes, setNewAutomationTimes] = useState('09:00');

  const loadAutomations = async () => {
    if (!currentUser) return;
    setLoadingAutomations(true);
    const { data } = await supabase.from('automations').select('*').eq('user_id', currentUser.uid).order('created_at', { ascending: true });
    setAutomations((data as any) || []);
    setLoadingAutomations(false);
  };

  const addAutomation = async () => {
    if (!currentUser) return;
    const times = newAutomationTimes.split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
    if (times.length === 0) { notify('Format horaire invalide (ex: 09:00 ou 08:00,12:00,15:00,18:00).'); return; }
    await supabase.from('automations').insert({ user_id: currentUser.uid, type: newAutomationType, times, is_active: true });
    setNewAutomationTimes('09:00');
    void loadAutomations();
  };

  const toggleAutomation = async (id: string, active: boolean) => {
    await supabase.from('automations').update({ is_active: active }).eq('id', id);
    void loadAutomations();
  };

  const deleteAutomation = async (id: string) => {
    await supabase.from('automations').delete().eq('id', id);
    void loadAutomations();
  };

  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : automatisations
  // de PIPELINE (par société — table dédiée `pipeline_automations`, migration
  // 20260826211000), distinctes des automatisations personnelles ci-dessus.
  const [pipelineAutomations, setPipelineAutomations] = useState<Array<{ id: string; agency_id: string; stage_name: string; email_subject: string; email_body: string; is_active: boolean }>>([]);
  const [loadingPipelineAutomations, setLoadingPipelineAutomations] = useState(false);
  const [pipelineStagesByAgency, setPipelineStagesByAgency] = useState<Record<string, string[]>>({});
  const [newPipelineAutomation, setNewPipelineAutomation] = useState({
    agencyId: AGENCIES.find((a) => a.id !== 'all')?.id || '',
    stageName: '',
    emailSubject: '',
    emailBody: '',
  });

  const loadPipelineAutomations = async () => {
    setLoadingPipelineAutomations(true);
    const [{ data: autos }, { data: pipes }] = await Promise.all([
      supabase.from('pipeline_automations' as any).select('*').order('created_at', { ascending: true }),
      supabase.from('pipelines' as any).select('agency_id, stages'),
    ]);
    setPipelineAutomations((autos as any) || []);
    const stagesByAgency: Record<string, string[]> = {};
    ((pipes as any[]) || []).forEach((p) => {
      const list = stagesByAgency[p.agency_id] || [];
      (Array.isArray(p.stages) ? p.stages : []).forEach((s: string) => { if (!list.includes(s)) list.push(s); });
      stagesByAgency[p.agency_id] = list;
    });
    setPipelineStagesByAgency(stagesByAgency);
    setLoadingPipelineAutomations(false);
  };

  const addPipelineAutomation = async () => {
    const { agencyId, stageName, emailSubject, emailBody } = newPipelineAutomation;
    if (!agencyId || !stageName.trim() || !emailSubject.trim()) {
      notify('Société, étape et sujet sont obligatoires.');
      return;
    }
    const { error } = await supabase.from('pipeline_automations' as any).insert({
      agency_id: agencyId,
      stage_name: stageName.trim(),
      email_subject: emailSubject.trim(),
      email_body: emailBody.trim(),
      is_active: true,
      created_by: currentUser?.uid || null,
    } as any);
    if (error) { notify(`Erreur : ${error.message}`); return; }
    setNewPipelineAutomation((prev) => ({ ...prev, stageName: '', emailSubject: '', emailBody: '' }));
    void loadPipelineAutomations();
  };

  const togglePipelineAutomation = async (id: string, active: boolean) => {
    await supabase.from('pipeline_automations' as any).update({ is_active: active } as any).eq('id', id);
    void loadPipelineAutomations();
  };

  const deletePipelineAutomation = async (id: string) => {
    await supabase.from('pipeline_automations' as any).delete().eq('id', id);
    void loadPipelineAutomations();
  };

  const [dragTabIndex, setDragTabIndex] = useState<number | null>(null);
  const [dragTabOverIndex, setDragTabOverIndex] = useState<number | null>(null);

  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('novasphere:accent-color') || '#F7BC5F');
  // Ticket #117 : couleur du calendrier (Agenda), réglable indépendamment.
  const [calendarAccentColor, setCalendarAccentColor] = useState(() => localStorage.getItem('novasphere:calendar-accent-color') || '#F7BC5F');
  const [bgImage, setBgImage] = useState(() => localStorage.getItem('novasphere:bg-image') || '');
  const [bgOpacity, setBgOpacity] = useState(() => {
    const raw = localStorage.getItem('novasphere:bg-opacity');
    return raw ? Number(raw) : 30;
  });
  const [customBgInput, setCustomBgInput] = useState('');
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  // Démarre la connexion OAuth Google COMPLÈTE (refresh_token, auto-
  // renouvelée) pour le Drive PARTAGÉ d'une agence — distincte du Drive
  // personnel ci-dessus. Simple navigation de page (pas un fetch), donc le
  // jeton est passé en query, vérifié côté serveur par
  // /api/admin/drive/[agencyId].ts avant la redirection vers Google.
  const connectAgencyDrive = async (agencyId: string) => {
    if (!currentUser) return;
    const token = await currentUser.getIdToken();
    window.location.href = `/api/admin/drive/${agencyId}?token=${encodeURIComponent(token)}`;
  };

  const api = async (url: string, options: RequestInit = {}) => {
    if (!currentUser) throw new Error('Utilisateur non connecté.');
    const token = await currentUser.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  };

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });

  useEffect(() => {
    if (userProfile) {
      setProfileName(prev => prev || userProfile.displayName || '');
      setProfilePhone(prev => prev || userProfile.phone || '');
      setProfileJob(prev => prev || userProfile.jobTitle || '');
      setProfileAvatar(prev => prev || userProfile.photoURL || '');
    }
  }, [userProfile]);

  useEffect(() => {
    setSectionOrder(cur => {
      const allowed = new Set(visibleSections.map(s => s.id));
      const kept = cur.filter(id => allowed.has(id));
      return [...kept, ...visibleSections.map(s => s.id).filter(id => !kept.includes(id))];
    });
  }, [visibleSections]);

  useEffect(() => { if (currentUser) void loadBootstrap(); }, [currentUser?.uid]);

  // Ticket #267 : retour de la redirection Infomaniak après consentement
  // (/api/auth/kdrive/callback → redirige ici avec ?kdrive=connected|error)
  // — notifie une seule fois puis nettoie l'URL pour ne pas re-déclencher
  // au prochain montage/rechargement.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('kdrive');
    if (!status) return;
    if (status === 'connected') {
      notify('kDrive connecté !');
      void loadBootstrap();
    } else if (status === 'error') {
      notify(`Connexion kDrive échouée : ${params.get('kdrive_error') || 'erreur inconnue'}`);
    }
    params.delete('kdrive');
    params.delete('kdrive_error');
    const rest = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  }, []);

  // Chargement direct des titres et de l'ordre des onglets depuis Supabase
  // (voir commentaire sur saveTemplates : la route /api/settings/bootstrap
  // ne répond pas en production, donc on ne peut pas compter sur elle ici).
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const [{ data: tpl }, { data: ui }] = await Promise.all([
          supabase.from('user_event_templates').select('task_titles, rdv_titles').eq('user_id', currentUser.uid).maybeSingle(),
          supabase.from('user_ui_settings').select('sidebar_order, mail_signature_html, mail_signature_image_url').eq('user_id', currentUser.uid).maybeSingle(),
        ]);
        if (Array.isArray(tpl?.task_titles) && tpl.task_titles.length) setTaskTitles(tpl.task_titles);
        if (Array.isArray(tpl?.rdv_titles) && tpl.rdv_titles.length) setAppointmentTitles(tpl.rdv_titles);
        if (ui?.mail_signature_html) setMailSignature(ui.mail_signature_html);
        if (ui?.mail_signature_image_url) setMailSignatureImage(ui.mail_signature_image_url);
        if (Array.isArray(ui?.sidebar_order) && ui.sidebar_order.length) {
          const merged = mergeTabOrder(ui.sidebar_order);
          setTabs(merged);
          localStorage.setItem('novasphere_sidebar_order', JSON.stringify(merged.map(x => x[1])));
          window.dispatchEvent(new Event('novasphere_sidebar_order_changed'));
        }
      } catch (err) {
        console.warn('Erreur chargement titres / ordre onglets depuis Supabase :', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // Synchronisation en direct de l'ordre des onglets entre appareils —
  // demande explicite : "l'ordinateur pourra mettre l'ordre des onglets,
  // ça sera synchronisé en instantané avec la partie mobile sans faire de
  // mises à jour". Sans ça, un autre appareil ne voyait le nouvel ordre
  // qu'au prochain chargement de la page (via le useEffect ci-dessus) —
  // ici, un changement enregistré depuis l'ordinateur pousse immédiatement
  // la mise à jour sur le mobile déjà ouvert (et vice-versa), sans recharger.
  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase
      .channel(`user_ui_settings_sidebar_${currentUser.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_ui_settings', filter: `user_id=eq.${currentUser.uid}` },
        (payload) => {
          const order = (payload.new as { sidebar_order?: string[] } | null)?.sidebar_order;
          if (!Array.isArray(order) || !order.length) return;
          const merged = mergeTabOrder(order);
          setTabs(merged);
          localStorage.setItem('novasphere_sidebar_order', JSON.stringify(merged.map((x) => x[1])));
          window.dispatchEvent(new Event('novasphere_sidebar_order_changed'));
        }
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const orderedSections = sectionOrder.map(id => visibleSections.find(s => s.id === id)).filter(Boolean) as SectionConfig[];

  const handleConnectUserDrive = async () => {
    setBusy('connect-drive');
    try {
      const token = await requestWorkspaceAccessToken();
      if (token) {
        setUserDriveConnected(true);
        notify('Compte Google Drive connecté ! Vos fichiers utiliseront votre espace Drive personnel.');
      }
      setBusy(null);
    } catch (e: any) {
      // Ticket #108 (suivi) : ce bouton ne faisait que relire la session
      // Supabase existante — une fois le jeton Google expiré (~1h), il
      // échouait toujours pareil sans jamais rien "reconnecter" pour de
      // vrai. On retombe ici sur un véritable nouvel échange OAuth Google
      // (redirection, retour automatique sur cette page une fois validé —
      // `busy` reste donc affiché jusque-là, la page quitte de toute façon).
      try {
        await reconnectGoogleWorkspace();
      } catch (reconnectError: any) {
        notify(`Erreur de connexion Drive : ${reconnectError?.message || e?.message || e}`);
        setBusy(null);
      }
    }
  };

  async function loadBootstrap() {
    if (!currentUser) return;
    try {
      const data = await api('/api/settings/bootstrap');
      const ui = data.ui;
      const tpl = data.templates;
      const profile = data.profile;
      if (ui) {
        setMailSignature(ui.mail_signature_html || '');
        setMailSignatureImage(ui.mail_signature_image_url || '');
        if (ui.theme_id) setTheme(ui.theme_id);
        if (Array.isArray(ui.sidebar_order) && ui.sidebar_order.length) {
          const merged = mergeTabOrder(ui.sidebar_order);
          setTabs(merged);
          localStorage.setItem('novasphere_sidebar_order', JSON.stringify(merged.map(x => x[1])));
          window.dispatchEvent(new Event('novasphere_sidebar_order_changed'));
        }
      }
      if (tpl) {
        if (Array.isArray(tpl.task_titles) && tpl.task_titles.length) setTaskTitles(tpl.task_titles);
        if (Array.isArray(tpl.rdv_titles) && tpl.rdv_titles.length) setAppointmentTitles(tpl.rdv_titles);
      }
      if (profile) {
        setDailyReminder(profile.push_daily_reminders !== false);
        setProfileName(profile.full_name || profileName || '');
        setProfilePhone(profile.phone || '');
        setProfileJob(profile.job_title || '');
        setProfileAvatar(profile.avatar_url || '');
      }
      setUsers(Array.isArray(data.users) ? data.users : []);
      const next: Record<string, { agency_id: string; google_email?: string }> = {};
      (data.drives || []).forEach((x: { agency_id: string; google_email?: string }) => { next[x.agency_id] = x; });
      setDriveStatus(next);
      setKdriveConnected(!!data.kdrive?.connected);
      setKdriveDriveId(data.kdrive?.driveId || null);
    } catch (error) {
      const err = error as Error;
      console.error('[Paramètres] bootstrap:', error);
      notify(`Impossible de charger les paramètres Supabase : ${err.message}`);
    }
  }

  async function saveProfile() {
    if (!currentUser) return;
    setBusy('profile');
    try {
      const result = await api('/api/settings/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: profileName, phone: profilePhone, jobTitle: profileJob }),
      });
      if (result?.profile) {
        if (result.profile.full_name !== undefined) setProfileName(result.profile.full_name || '');
        if (result.profile.phone !== undefined) setProfilePhone(result.profile.phone || '');
        if (result.profile.job_title !== undefined) setProfileJob(result.profile.job_title || '');
        if (result.profile.avatar_url) setProfileAvatar(result.profile.avatar_url);
      }
      if (userProfile) {
        const updatedCache = {
          ...userProfile,
          displayName: profileName || userProfile.displayName,
          phone: profilePhone,
          jobTitle: profileJob,
          photoURL: profileAvatar || userProfile.photoURL,
        };
        localStorage.setItem('novasphere:cached-user-profile', JSON.stringify(updatedCache));
      }
      notify('Profil enregistré et synchronisé dans Supabase.');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setBusy(null); }
  }

  async function uploadAvatar(file: File) {
    if (!currentUser) return;
    setBusy('avatar');
    try {
      const dataUrl = await fileToDataUrl(file);
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const result = await api('/api/settings/avatar', { method: 'POST', body: JSON.stringify({ dataUrl, extension, contentType: file.type }) });
      setProfileAvatar(result.publicUrl || '');
      notify('Photo mise à jour.');
    } catch (e) { const err = e as Error; notify(`Erreur : ${err.message}`); } finally { setBusy(null); }
  }

  async function removeAvatar() {
    if (!currentUser) return;
    setBusy('avatar');
    try {
      await api('/api/settings/avatar', { method: 'DELETE' });
      setProfileAvatar('');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setBusy(null); }
  }

  // Bypass de la route /api/settings/ui, qui ne répond pas en production
  // (voir saveTemplates/saveTabOrder plus haut) : upsert direct dans
  // user_ui_settings, ne touche que les colonnes fournies ici.
  async function saveMail() {
    if (!currentUser) return;
    setBusy('mail');
    try {
      const { error } = await supabase
        .from('user_ui_settings')
        .upsert(
          {
            user_id: currentUser.uid,
            mail_signature_html: mailSignature,
            mail_signature_image_url: mailSignatureImage || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
      notify('Signature enregistrée.');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setBusy(null); }
  }

  // Upload direct vers Supabase Storage (bucket public "mail-signatures"),
  // même contournement que saveMail : /api/settings/signature-image ne
  // répond pas en production.
  async function uploadSignatureImage(file: File) {
    if (!currentUser) return;
    setBusy('mail-image');
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${currentUser.uid}/signature-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('mail-signatures')
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('mail-signatures').getPublicUrl(path);
      setMailSignatureImage(data.publicUrl || '');
      notify('Image de signature importée.');
    } catch (e) { const err = e as Error; notify(`Erreur : ${err.message}`); } finally { setBusy(null); }
  }

  // Écrit directement dans Supabase (user_event_templates) : l'ancienne route
  // /api/settings/templates ne répond jamais en production sur Vercel (405),
  // le serveur Express qui la porte n'y tourne pas. Le reste de l'app passe
  // déjà systématiquement par le client Supabase — on aligne ce point-là.
  async function saveTemplates() {
    if (!currentUser) return;
    setBusy('templates');
    try {
      const { error } = await supabase.from('user_event_templates').upsert(
        {
          user_id: currentUser.uid,
          task_titles: taskTitles,
          rdv_titles: appointmentTitles,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
      writeStorage('novasphere:task-titles', taskTitles);
      writeStorage('novasphere:appointment-titles', appointmentTitles);
      window.dispatchEvent(new Event('novasphere:event-templates-changed'));
    } catch (error) {
      const err = error as Error;
      notify(`Erreur de sauvegarde des titres : ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  // Sauvegarde automatique : dès que les listes changent (ajout, édition,
  // réordonnancement, suppression), on enregistre après une courte pause —
  // plus besoin de cliquer sur un bouton "Sauvegarder".
  const templatesHydrated = useRef(false);
  useEffect(() => {
    if (!currentUser) return;
    if (!templatesHydrated.current) {
      // Ignore le tout premier passage (hydratation depuis le serveur/localStorage).
      templatesHydrated.current = true;
      return;
    }
    const timeout = setTimeout(() => { void saveTemplates(); }, 900);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskTitles, appointmentTitles]);

  async function setDailyPush(value: boolean) {
    if (!currentUser) return;
    const previous = dailyReminder;
    setDailyReminder(value);
    try { await api('/api/settings/daily-reminders', { method: 'PATCH', body: JSON.stringify({ enabled: value }) }); }
    catch (error) { const err = error as Error; setDailyReminder(previous); notify(`Erreur : ${err.message}`); }
  }

  async function togglePush(value: boolean) {
    if (value && 'Notification' in window) {
      const result = await Notification.requestPermission();
      if (result !== 'granted') { setPushEnabled(false); writeStorage('novasphere:push-enabled', false); return notify("L'autorisation de notifications a été refusée par le navigateur."); }
    }
    setPushEnabled(value); writeStorage('novasphere:push-enabled', value);
  }

  async function publishAnnouncement() {
    if (!announcement.trim()) return;
    setBusy('announcement');
    try {
      await api('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({
          message: announcement.trim(),
          agencyIds: announcementTargetUserId ? [] : announcementAgencyIds,
          level: announcementLevel,
          link: announcementLink.trim() || null,
          expiresAt: announcementExpiresAt || null,
          targetUserId: announcementTargetUserId || null,
          pollOptions: pollEnabled ? pollOptions : [],
        }),
      });
      setAnnouncement('');
      setAnnouncementLink('');
      setAnnouncementExpiresAt('');
      setAnnouncementTargetUserId('');
      setAnnouncementLevel('info');
      setPollEnabled(false);
      setPollOptions([]);
      setNewPollOption('');
      notify('Annonce publiée.');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setBusy(null); }
  }

  // Demande explicite : "possibilité de supprimer les annonces aussi pour
  // ne pas accumuler" — suppression directe (déjà couverte par la policy
  // RLS existante "super_admins_manage_announcements", aucune route
  // serveur nécessaire) ; les options/votes de sondage liés partent avec
  // (contrainte on delete cascade, migration 20260827100000).
  async function deleteAnnouncement(id: string) {
    if (!confirm('Supprimer définitivement cette annonce ? Cette action est irréversible.')) return;
    setDeletingAnnouncementId(id);
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      await loadAnnouncementsAdmin();
      notify('Annonce supprimée.');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setDeletingAnnouncementId(null); }
  }

  // Demandé (30/08/2026) : "supprime les anciennes annonces... ça fait du
  // scrolling" — plutôt que de les supprimer moi-même (jamais de
  // suppression permanente de données décidée unilatéralement), ce bouton
  // permet à un super admin de le faire lui-même en un clic avec
  // confirmation, au lieu d'une par une. Supprime TOUTES les annonces (pas
  // seulement les 20 chargées à l'écran, voir la limite dans
  // loadAnnouncementsAdmin) — même mécanisme que deleteAnnouncement
  // ci-dessus (cascade sur les options/votes de sondage liés).
  async function deleteAllAnnouncements() {
    if (pastAnnouncements.length === 0) return;
    const label = pastAnnouncements.length >= 20 ? '20 dernières (ou plus)' : String(pastAnnouncements.length);
    if (!confirm(`Supprimer définitivement TOUTES les annonces passées (${label}) ? Cette action est irréversible.`)) return;
    setDeletingAllAnnouncements(true);
    try {
      const { error } = await supabase.from('announcements').delete().not('id', 'is', null);
      if (error) throw error;
      await loadAnnouncementsAdmin();
      notify('Toutes les annonces passées ont été supprimées.');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setDeletingAllAnnouncements(false); }
  }

  async function disconnectDrive(agencyId: string) {
    if (!confirm('Déconnecter Google Drive pour cette société ?')) return;
    try { await api(`/api/admin/drive/${agencyId}`, { method: 'DELETE' }); await loadBootstrap(); }
    catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
  }

  // Ticket #267 : "Connecter kDrive" — redirige vers Infomaniak, qui
  // ramènera l'utilisateur ici via /api/auth/kdrive/callback (voir
  // handleKdriveOAuthReturn ci-dessous pour la réception du retour).
  async function handleConnectKdrive() {
    setBusy('connect-kdrive');
    try {
      const { authorizeUrl } = await api('/api/settings/bootstrap?kdrive_authorize=1');
      window.location.href = authorizeUrl;
    } catch (error) {
      const err = error as Error;
      notify(`Erreur : ${err.message}`);
      setBusy(null);
    }
  }

  async function handleDisconnectKdrive() {
    if (!confirm('Déconnecter kDrive ?')) return;
    setBusy('kdrive');
    try {
      await api('/api/settings/bootstrap?kdrive_disconnect=1');
      setKdriveConnected(false);
      setKdriveDriveId(null);
      notify('kDrive déconnecté.');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setBusy(null); }
  }

  async function handleSaveKdriveDriveId() {
    const value = kdriveDriveIdInput.trim();
    if (!value) return;
    setBusy('kdrive');
    try {
      await api(`/api/settings/bootstrap?kdrive_set_drive_id=${encodeURIComponent(value)}`);
      setKdriveDriveId(value);
      setKdriveDriveIdInput('');
      notify('Identifiant kDrive enregistré.');
    } catch (error) { const err = error as Error; notify(`Erreur : ${err.message}`); }
    finally { setBusy(null); }
  }

  async function exportMyData() {
    if (!currentUser) return;
    setBusy('export');
    try {
      const payload = await api('/api/settings/export');
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;
      a.download=`novasphere-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { const err = e as Error; notify(`Export impossible : ${err.message}`); }
    finally { setBusy(null); }
  }

  // Signalé (30/08/2026, capture d'écran) : "Thème appliqué localement mais
  // synchronisation impossible : Erreur HTTP 404" à chaque changement de
  // thème sur mobile. Même cause déjà rencontrée et déjà contournée pour
  // saveMail/saveTabOrder/saveTemplates ci-dessus : la route
  // /api/settings/ui n'existe pas côté Vercel (aucune fonction sous
  // /api/settings/ui, seul server.ts — jamais déployé tel quel — la
  // définit). Même contournement ici : upsert direct dans user_ui_settings.
  async function applyTheme(next: string) {
    setTheme(next);
    localStorage.setItem('novasphere:theme', next);
    const shouldLight = next === 'light' || (next === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
    if (shouldLight) document.documentElement.classList.add('light-mode'); else document.documentElement.classList.remove('light-mode');
    try {
      if (currentUser) {
        const { error } = await supabase
          .from('user_ui_settings')
          .upsert(
            { user_id: currentUser.uid, theme_id: next, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          );
        if (error) throw error;
      }
    } catch (error) { const err = error as Error; notify(`Thème appliqué localement mais synchronisation impossible : ${err.message}`); }
    window.dispatchEvent(new CustomEvent('novasphere:theme-changed', { detail: next }));
  }

  const moveSection = (index: number, direction: -1|1) => { const next=reorder(sectionOrder,index,index+direction); setSectionOrder(next); writeStorage('novasphere:settings-order-v4',next); };
  // Signalé : le glisser-déposer natif (HTML5 draggable + translateY manuel)
  // de la sidebar Paramètres était peu fluide comparé au Kanban (pas
  // d'animation de replacement, pas de retour visuel pendant le survol) —
  // remplacé par @hello-pangea/dnd, la même bibliothèque déjà éprouvée sur
  // Pipeline interne/Tableaux (ProjetsInternes.tsx, KanbanBoardsView.tsx).
  const handleSectionDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination || destination.index === source.index) return;
    const next = reorder(sectionOrder, source.index, destination.index);
    setSectionOrder(next);
    writeStorage('novasphere:settings-order-v4', next);
  };
  const saveTabOrder = (next: Array<[string,string]>) => {
    setTabs(next);
    const ids = next.map(x => x[1]);
    localStorage.setItem('novasphere_sidebar_order', JSON.stringify(ids));
    window.dispatchEvent(new Event('novasphere_sidebar_order_changed'));
    // Persistance directe en base (voir saveTemplates) : la route
    // /api/settings/ui ne répond pas en production.
    if (!currentUser) return;
    supabase
      .from('user_ui_settings')
      .upsert({ user_id: currentUser.uid, sidebar_order: ids, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(({ error }) => {
        if (error) console.warn('Erreur sauvegarde ordre sidebar côté serveur :', error);
      });
  };
  const saveContactTypes = (next: string[]) => { setContactTypes(next); writeStorage('novasphere:contact-types', next); window.dispatchEvent(new Event('novasphere:contact-types-changed')); };

  const saveAppearance = (nextColor: string, nextBg: string, nextOpacity: number) => {
    setAccentColor(nextColor);
    setBgImage(nextBg);
    setBgOpacity(nextOpacity);

    localStorage.setItem('novasphere:accent-color', nextColor);
    localStorage.setItem('novasphere:bg-image', nextBg);
    localStorage.setItem('novasphere:bg-opacity', String(nextOpacity));

    updateCssAccentVars(nextColor);

    window.dispatchEvent(
      new CustomEvent('novasphere:appearance-changed', {
        detail: { accentColor: nextColor, bgImage: nextBg, bgOpacity: nextOpacity },
      })
    );
  };

  // Ticket #117 : couleur du calendrier — même mécanisme que saveAppearance
  // mais séparé, pour ne jamais affecter la couleur d'accent générale.
  const saveCalendarColor = (nextColor: string) => {
    setCalendarAccentColor(nextColor);
    localStorage.setItem('novasphere:calendar-accent-color', nextColor);
    updateCssCalendarAccentVars(nextColor);
    window.dispatchEvent(
      new CustomEvent('novasphere:calendar-color-changed', {
        detail: { calendarAccentColor: nextColor },
      })
    );
  };

  const handleUploadBgImage = async (file: File) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      saveAppearance(accentColor, dataUrl, bgOpacity);
      notify('Image de fond personnalisée appliquée avec succès !');
    } catch {
      notify("Erreur lors de l'importation de l'image de fond.");
    }
  };

  const dropTabAt = (toIndex: number) => {
    if (dragTabIndex === null) return;
    if (dragTabIndex !== toIndex) {
      saveTabOrder(reorder(tabs, dragTabIndex, toIndex));
    }
    setDragTabIndex(null);
    setDragTabOverIndex(null);
  };

  const sectionBody = (id: SectionId) => {
    switch (id) {
      case 'drive': return <div className="space-y-4">
        {driveOAuthError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200 flex items-start justify-between gap-3">
            <span>Connexion Google Drive échouée : {driveOAuthError}</span>
            <button onClick={() => setDriveOAuthError(null)} className="text-red-300/70 hover:text-red-200 shrink-0">✕</button>
          </div>
        )}
        <div className="rounded-xl border border-[#1c4448] bg-[#071f21] p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-[#F7BC5F]"/> Stockage Google Drive Personnel & Forfait Utilisateur
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Chaque utilisateur connecté utilise son propre espace de stockage Google Drive personnel ou son forfait Google Workspace d'entreprise.
              </p>
            </div>
            <button onClick={handleConnectUserDrive} disabled={busy === 'connect-drive'} className={goldButton}>
              {busy === 'connect-drive' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Link className="w-4 h-4"/>}
              {userDriveConnected ? 'Drive Personnel Connecté' : 'Connecter mon Google Drive'}
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Google Drive par agence / société</p>
          <div className="space-y-2">
            {/* Ticket #228 : logo de la société + ordre imposé (NovaSphere,
                Conseils Finances, ImmoSphera, NovaVisio) — "all" (NovaSphere)
                exclu ici car cette liste concerne les Drive PAR société. */}
            {sortByAgencyOrder(AGENCIES.filter(a=>a.id!=='all')).map(a => <div key={a.id} className="flex items-center gap-3 rounded-xl border border-[#1c4448] bg-[#071f21] p-4"><div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0 overflow-hidden p-1"><img src={getAgencyLogo(a.name)} alt="" className="w-full h-full object-contain" /></div><div className="flex-1"><p className="font-semibold text-white">{a.name}</p><p className="text-xs text-slate-400">{driveStatus[a.id]?.google_email ? `Connecté : ${driveStatus[a.id].google_email}` : 'Non connecté'}</p></div><button onClick={()=>onSelectAgency(a)} className="px-3 py-2 rounded-lg bg-white/5 text-xs text-white">Sélectionner</button><button onClick={()=>void connectAgencyDrive(a.id)} className={`px-3 py-2 rounded-lg text-xs font-semibold ${driveStatus[a.id] ? 'bg-white/5 text-slate-300' : 'bg-[#F7BC5F] text-[#061719]'}`}>{driveStatus[a.id] ? 'Reconnecter' : 'Connecter'}</button>{driveStatus[a.id] && <button onClick={()=>disconnectDrive(a.id)} className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">Déconnecter</button>}</div>)}
          </div>
        </div>

        {/* Ticket #267 : "serais-tu capable de chercher des documents ou
            autres dans kDrive aussi ?" — connexion personnelle kDrive
            (Infomaniak), même principe que le Drive personnel ci-dessus,
            pour que Nova IA puisse y chercher des documents. */}
        <div className="rounded-xl border border-[#1c4448] bg-[#071f21] p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-[#F7BC5F]"/> kDrive (Infomaniak)
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Connectez votre kDrive personnel pour que Nova IA puisse y rechercher des documents ("cherche le contrat Dupont dans kDrive").
              </p>
            </div>
            {kdriveConnected ? (
              <button onClick={handleDisconnectKdrive} disabled={busy === 'kdrive'} className="px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-300 flex items-center gap-2">
                {busy === 'kdrive' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Link className="w-4 h-4"/>}
                kDrive connecté — Déconnecter
              </button>
            ) : (
              <button onClick={handleConnectKdrive} disabled={busy === 'connect-kdrive'} className={goldButton}>
                {busy === 'connect-kdrive' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Link className="w-4 h-4"/>}
                Connecter kDrive
              </button>
            )}
          </div>
          {kdriveConnected && !kdriveDriveId && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <p className="text-xs text-amber-200">
                L'identifiant de votre kDrive n'a pas pu être détecté automatiquement. Trouvez-le dans l'URL de votre kDrive (le nombre après "/drive/", ex. .../drive/<b>12345</b>/files) et renseignez-le ici :
              </p>
              <div className="flex gap-2">
                <input
                  value={kdriveDriveIdInput}
                  onChange={e => setKdriveDriveIdInput(e.target.value)}
                  placeholder="Identifiant kDrive (ex: 12345)"
                  className={inputClass}
                />
                <button onClick={handleSaveKdriveDriveId} disabled={busy === 'kdrive' || !kdriveDriveIdInput.trim()} className="px-4 py-2 rounded-lg bg-[#F7BC5F] text-[#061719] text-xs font-bold shrink-0 disabled:opacity-50">
                  Enregistrer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>;

      case 'profile': return <div className="space-y-5"><input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0]; if(f) void uploadAvatar(f); e.currentTarget.value='';}}/><div className="flex flex-col sm:flex-row sm:items-center gap-5"><div className="w-16 h-16 rounded-full bg-[#F7BC5F] overflow-hidden text-[#061719] flex items-center justify-center text-xl font-black border-2 border-[#F7BC5F]/50">{profileAvatar ? <img src={profileAvatar} className="w-full h-full object-cover"/> : (profileName || userProfile?.displayName || currentUser?.email || 'U').charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="text-lg font-bold text-white">{profileName || userProfile?.displayName || 'Mon profil'}</p><p className="text-sm text-slate-400 truncate">{currentUser?.email}</p></div><div className="flex gap-2"><button onClick={()=>avatarInputRef.current?.click()} disabled={busy==='avatar'} className={goldButton}><Camera className="w-4 h-4"/>Changer la photo</button><button onClick={removeAvatar} className="px-4 py-2 rounded-xl bg-[#142f32] text-white text-xs font-semibold">Retirer</button></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label className="space-y-2"><span className="text-xs text-slate-400 font-semibold">Nom complet</span><input value={profileName} onChange={e=>setProfileName(e.target.value)} placeholder="Votre nom complet" className={inputClass}/></label><label className="space-y-2"><span className="text-xs text-slate-400 font-semibold">Poste / fonction</span><input value={profileJob} onChange={e=>setProfileJob(e.target.value)} placeholder="Ex: Conseiller en financements" className={inputClass}/></label><label className="space-y-2"><span className="text-xs text-slate-400 font-semibold">Téléphone professionnel</span><input value={profilePhone} onChange={e=>setProfilePhone(e.target.value)} placeholder="06 00 00 00 00" className={inputClass}/></label><label className="space-y-2"><span className="text-xs text-slate-400 font-semibold">Adresse e-mail (immuable)</span><input value={currentUser?.email || ''} disabled className={`${inputClass} opacity-60 cursor-not-allowed`}/></label></div><div className="flex justify-end"><button onClick={saveProfile} disabled={busy==='profile'} className={goldButton}>{busy==='profile'?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}Enregistrer le profil</button></div></div>;

      case 'announcements': return (
        // Refonte (30/08/2026, signalé "plus rectangle plus grand et moins
        // de scrolling") : compose à gauche / historique à droite sur écran
        // large plutôt qu'empilés — l'historique (potentiellement long,
        // toutes les annonces passées) n'allonge plus la page, il défile
        // dans son propre panneau borné en hauteur (voir plus bas).
        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <div className="space-y-4">
          {/* Demandé (30/08/2026) : "ne fera pas des textes sur cinq lignes,
              ça ne sert à rien d'avoir ce gros espace" — reréduite (avait été
              montée à 6 lors du passage à deux colonnes) pour remonter tout
              le bloc et gagner de la hauteur sur écran fixe (voir plus bas). */}
          <textarea rows={3} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} placeholder="Votre annonce..." className={`${inputClass} resize-y`} />
          {/* Demandé (30/08/2026) : un rappel qu'on peut dicter l'annonce
              plutôt que la taper, pour aller plus vite — le micro du
              clavier (mobile) ou la dictée du système (Mac/Windows)
              fonctionnent nativement dans ce champ, rien à coder de plus. */}
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500 -mt-2">
            <Mic className="w-3 h-3 shrink-0" />
            Astuce : dictez votre annonce (micro du clavier ou dictée du système) plutôt que de la taper — plus rapide.
          </p>

          <div className="space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Niveau</span>
            <div className="flex flex-wrap gap-2">
              {([
                ['info', 'Information', 'border-[#F7BC5F]/50 text-[#F9C977]'],
                ['a_verifier', 'À vérifier', 'border-amber-500/40 text-amber-300'],
                ['important', 'Important', 'border-rose-500/50 text-rose-300'],
                ['succes', 'Succès', 'border-emerald-500/40 text-emerald-300'],
                ['veille', 'Veille', 'border-sky-500/40 text-sky-300'],
                ['reponse_demandee', 'Réponse demandée SVP', 'border-rose-500/50 text-rose-300'],
                ['signature_acte', "Signature d'un acte", 'border-[#F7BC5F]/50 text-[#F9C977]'],
              ] as const).map(([value, label, cls]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAnnouncementLevel(value)}
                  className={`flex-1 min-w-[30%] sm:min-w-0 py-2 rounded-xl border text-xs font-bold transition-colors ${cls} ${announcementLevel === value ? 'bg-white/10' : 'bg-transparent opacity-60 hover:opacity-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Demandé (30/08/2026) : "enlève l'expiration... cette ligne ne
              sert à rien" — champ retiré. announcementExpiresAt reste déclaré
              (toujours vide désormais → expiresAt: null à la publication,
              voir publishAnnouncement) plutôt que de toucher au reste du
              circuit pour un simple retrait de champ. */}
          <label className="space-y-1.5 block">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Lien (facultatif)</span>
            <input value={announcementLink} onChange={(e) => setAnnouncementLink(e.target.value)} placeholder="https://... ou un chemin interne" className={inputClass} />
          </label>

          {/* Demandé (30/08/2026) : "ouvrir une fenêtre avec les icônes/
              profils des utilisateurs pour les sélectionner... filtrer par
              société... petite barre de recherche" — le <select> à plat
              (un <option> par utilisateur, ingérable si beaucoup
              d'utilisateurs) est remplacé par un choix à deux vitesses :
              "Toutes les sociétés" reste un bouton simple, "Une seule
              personne" ouvre la fenêtre de sélection (showUserPicker) avec
              avatars, filtre par société et recherche. */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Destinataires</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAnnouncementTargetUserId('')}
                className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                  !announcementTargetUserId ? 'border-[#F7BC5F] bg-[#F7BC5F]/10 text-[#F9C977] ring-2 ring-[#F7BC5F]/40' : 'border-[#1c4448] bg-[#071f21] text-slate-300 hover:border-white/20'
                }`}
              >
                Toutes les sociétés cochées ci-dessous
              </button>
              {(() => {
                const picked = announcementTargetUserId ? users.find((u) => u.id === announcementTargetUserId) : null;
                if (picked) {
                  return (
                    <div className="flex items-center gap-2 rounded-xl border border-[#F7BC5F] bg-[#F7BC5F]/10 ring-2 ring-[#F7BC5F]/40 pl-1.5 pr-2 py-1.5">
                      <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 shrink-0 flex items-center justify-center text-[9px] font-bold text-slate-300">
                        {picked.avatar_url ? <img src={picked.avatar_url} alt="" className="w-full h-full object-cover" /> : (picked.full_name || picked.email || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-xs font-semibold text-white">{picked.full_name || picked.email}</span>
                      <button type="button" onClick={() => setShowUserPicker(true)} className="text-[10px] text-slate-400 hover:text-[#F7BC5F] underline underline-offset-2">changer</button>
                      <button type="button" onClick={() => setAnnouncementTargetUserId('')} className="text-slate-400 hover:text-rose-300">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => setShowUserPicker(true)}
                    className="px-3 py-2 rounded-xl border border-[#1c4448] bg-[#071f21] text-xs font-semibold text-slate-300 hover:border-white/20 flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Une seule personne…
                  </button>
                );
              })()}
            </div>
          </div>

          {showUserPicker && (() => {
            const q = userPickerQuery.trim().toLowerCase();
            const filtered = users.filter((u) => {
              if (userPickerAgencyFilter && !(u.agency_ids || []).includes(userPickerAgencyFilter)) return false;
              if (!q) return true;
              return (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
            });
            return (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowUserPicker(false)}>
                <div className="bg-[#0b292b] border border-[#173d40] rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,.4)]" onClick={(e) => e.stopPropagation()}>
                  <div className="p-4 border-b border-[#173d40] space-y-3 shrink-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-white text-sm">Choisir un destinataire</h3>
                      <button type="button" onClick={() => setShowUserPicker(false)} className="text-slate-400 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        value={userPickerQuery}
                        onChange={(e) => setUserPickerQuery(e.target.value)}
                        placeholder="Rechercher un nom, un email..."
                        autoFocus
                        className="w-full bg-[#071f21] border border-[#1c4448] rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                      />
                    </div>
                    {/* Demandé (30/08/2026) : "le logo au-dessus bien centré,
                        qui se rapproche du cadre" — logo empilé au-dessus du
                        nom de société plutôt qu'à côté, dans chaque puce de
                        filtre. */}
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setUserPickerAgencyFilter('')}
                        className={`flex flex-col items-center gap-1 w-16 px-1.5 py-2 rounded-xl border text-[10px] font-semibold transition-colors ${
                          !userPickerAgencyFilter ? 'border-[#F7BC5F] bg-[#F7BC5F]/10 text-[#F9C977] ring-2 ring-[#F7BC5F]/40' : 'border-[#1c4448] text-slate-400 hover:border-white/20'
                        }`}
                      >
                        <Users className="w-6 h-6" />
                        Toutes
                      </button>
                      {sortByAgencyOrder(AGENCIES.filter((a) => a.id !== 'all')).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setUserPickerAgencyFilter(a.id)}
                          className={`flex flex-col items-center gap-1 w-16 px-1.5 py-2 rounded-xl border text-[10px] font-semibold transition-colors ${
                            userPickerAgencyFilter === a.id ? 'border-[#F7BC5F] bg-[#F7BC5F]/10 text-[#F9C977] ring-2 ring-[#F7BC5F]/40' : 'border-[#1c4448] text-slate-400 hover:border-white/20'
                          }`}
                        >
                          <img src={getAgencyLogo(a.name)} alt="" className="w-6 h-6 object-contain" />
                          <span className="truncate max-w-full">{a.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
                    {filtered.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-8">Aucun utilisateur trouvé.</p>
                    ) : (
                      filtered.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => { setAnnouncementTargetUserId(u.id); setShowUserPicker(false); setUserPickerQuery(''); }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/5 text-left transition-colors"
                        >
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 shrink-0 flex items-center justify-center text-[10px] font-bold text-slate-300">
                            {u.avatar_url ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" /> : (u.full_name || u.email || '?').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate">{u.full_name || u.email}</p>
                            {u.full_name && u.email && <p className="text-[10px] text-slate-500 truncate">{u.email}</p>}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Demandé (30/08/2026) : "mettre les logos avec la petite case à
              côté... quand on les sélectionnera, un effet carré jaune" —
              logo (getAgencyLogo, déjà utilisé plus haut dans ce fichier
              pour Google Drive) + case à cocher visuelle, toute la carte
              cliquable ; sélectionné = même liseré/fond doré que les autres
              sélecteurs de l'appli (thème, couleur...). */}
          {!announcementTargetUserId && (
            <div className="flex flex-wrap gap-2">
              {AGENCIES.filter((a) => a.id !== 'all').map((a) => {
                const checked = announcementAgencyIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAnnouncementAgencyIds((cur) => cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id])}
                    className={`flex items-center gap-2.5 rounded-xl border pl-2 pr-3 py-2 transition-colors ${
                      checked ? 'border-[#F7BC5F] bg-[#F7BC5F]/10 ring-2 ring-[#F7BC5F]/40' : 'border-[#1c4448] bg-[#071f21] hover:border-white/20'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 overflow-hidden p-1">
                      <img src={getAgencyLogo(a.name)} alt="" className="w-full h-full object-contain" />
                    </div>
                    <span className="text-xs font-semibold text-white">{a.name}</span>
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-white/25'}`}>
                      {checked && <Check className="w-3 h-3 text-slate-950" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer">
              <input type="checkbox" checked={pollEnabled} onChange={(e) => setPollEnabled(e.target.checked)} />
              Transformer en sondage (les destinataires votent au lieu de simplement fermer l'annonce)
            </label>
            {pollEnabled && (
              <div className="space-y-2 rounded-xl border border-[#1c4448] bg-[#071f21] p-3">
                {pollOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pollOptions.map((opt, i) => (
                      <span key={i} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white">
                        {opt}
                        <button type="button" onClick={() => setPollOptions((cur) => cur.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-rose-300">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={newPollOption}
                    onChange={(e) => setNewPollOption(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPollOption(newPollOption); } }}
                    placeholder="Ajouter un choix..."
                    className={inputClass}
                  />
                  <button type="button" onClick={() => addPollOption(newPollOption)} disabled={!newPollOption.trim()} className="px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white disabled:opacity-40">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-500 self-center">Suggestions :</span>
                  {POLL_OPTION_PRESETS.filter((p) => !pollOptions.includes(p)).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => addPollOption(preset)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-[#F7BC5F]/30 text-[#F9C977] hover:bg-[#F7BC5F]/10"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
                {pollOptions.length < 2 && (
                  <p className="text-[11px] text-amber-400">Ajoutez au moins 2 choix pour activer le sondage.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={publishAnnouncement} disabled={!announcement.trim() || busy === 'announcement'} className={goldButton}>
              <Megaphone className="w-4 h-4" />Publier
            </button>
          </div>
        </div>

        {/* Demande explicite : "qui a lu l'annonce" — les données
            (announcement_reads) et le chargement (loadAnnouncementsAdmin)
            existaient déjà mais n'étaient jamais affichés nulle part.
            Panneau séparé (voir commentaire plus haut) : hauteur bornée +
            défilement interne, plutôt qu'empilé sous le formulaire. */}
        <div className={`rounded-2xl border border-[#1c4448] bg-[#071f21] p-4 space-y-2 ${showPastAnnouncements ? 'xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto custom-scrollbar' : ''}`}>
            <button
              type="button"
              onClick={() => setShowPastAnnouncements((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-left"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                Annonces précédentes — qui a lu
                {pastAnnouncements.length > 0 && (
                  <span className="text-[10px] font-bold text-slate-500 normal-case">({pastAnnouncements.length})</span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${showPastAnnouncements ? 'rotate-180' : ''}`} />
            </button>
            {showPastAnnouncements && (
              <>
            {pastAnnouncements.length > 0 && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  onClick={() => void deleteAllAnnouncements()}
                  disabled={deletingAllAnnouncements}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50"
                  title="Supprimer toutes les annonces passées"
                >
                  {deletingAllAnnouncements ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Tout supprimer
                </button>
              </div>
            )}
            {pastAnnouncements.length === 0 ? (
              <p className="text-xs text-slate-500">Aucune annonce publiée pour l'instant.</p>
            ) : (
              <div className="space-y-2">
                {pastAnnouncements.map((a) => {
                  const readers = announcementReaders[a.id] || [];
                  const isOpen = expandedAnnouncementId === a.id;
                  return (
                    <div key={a.id} className="rounded-xl border border-[#1c4448] bg-[#071f21] overflow-hidden">
                      <div className="w-full flex items-center gap-2 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpandedAnnouncementId(isOpen ? null : a.id)}
                          className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white truncate">{a.message}</p>
                            <p className="text-[10px] text-slate-500">{new Date(a.created_at).toLocaleString('fr-FR')} · {readers.length} lecture{readers.length > 1 ? 's' : ''}</p>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteAnnouncement(a.id)}
                          disabled={deletingAnnouncementId === a.id}
                          title="Supprimer cette annonce"
                          className="w-8 h-8 shrink-0 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center disabled:opacity-50"
                        >
                          {deletingAnnouncementId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="px-4 pb-3 border-t border-[#1c4448]/60 pt-2 space-y-3">
                          {a.is_poll && (announcementPollOptions[a.id]?.length ?? 0) > 0 && (
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[#F9C977]">Résultats du sondage</span>
                              {announcementPollOptions[a.id].map((opt) => {
                                const voters = announcementPollVotes[opt.id] || [];
                                return (
                                  <div key={opt.id} className="text-xs">
                                    <div className="flex items-center justify-between text-slate-300">
                                      <span>{opt.label}</span>
                                      <span className="font-bold text-white">{voters.length}</span>
                                    </div>
                                    {voters.length > 0 && (
                                      <p className="text-[10px] text-slate-500 truncate">{voters.join(', ')}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">A lu</span>
                            {readers.length === 0 ? (
                              <p className="text-xs text-slate-500">Personne ne l'a encore lue.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {readers.map((name, i) => (
                                  <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">{name}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
              </>
            )}
        </div>
        </div>
      );

      case 'notifications': {
        const rows: Array<[string, string, boolean, (v: boolean) => void, React.ComponentType<{ className?: string }>]> = [['Activer les notifications','Affiche le badge sur la cloche.',notificationsEnabled,(v:boolean)=>{setNotificationsEnabled(v);writeStorage('novasphere:notifications-enabled',v);},Bell],['Son à la réception','Joue un son pour les nouvelles notifications.',notificationSound,(v:boolean)=>{setNotificationSound(v);writeStorage('novasphere:notification-sound',v);},Volume2],['Notifications push (mobile / bureau)','Demande réellement la permission au navigateur.',pushEnabled,togglePush,Smartphone],['Rappel quotidien des tâches & RDV','Synchronisé dans profiles.push_daily_reminders.',dailyReminder,setDailyPush,CalendarClock]];
        return <div className="divide-y divide-[#173d40]">{rows.map(([title,desc,checked,setter,Icon])=><div key={title} className="py-4 flex items-center gap-4"><Icon className="w-5 h-5 text-slate-400"/><div className="flex-1"><p className="text-sm font-semibold text-white">{title}</p><p className="text-xs text-slate-400 mt-0.5">{desc}</p></div><Toggle checked={checked} onChange={setter}/></div>)}</div>;
      }

      case 'automations': return (
        <div className="space-y-5">
          <div>
            <p className="font-semibold text-white">Nouvelle automatisation</p>
            <p className="text-xs text-slate-400 mt-1">
              Fonctionne même quand l'app est fermée — s'exécute côté serveur, vérifié toutes les 15 minutes.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={newAutomationType}
              onChange={(e) => setNewAutomationType(e.target.value as any)}
              className={inputClass}
            >
              <option value="daily_brief">Récap de ma journée (tâches & rappels)</option>
              <option value="mail_digest">Récap de mes mails non lus</option>
            </select>
            <input
              value={newAutomationTimes}
              onChange={(e) => setNewAutomationTimes(e.target.value)}
              placeholder="09:00 ou 08:00,12:00,15:00,18:00"
              className={inputClass}
            />
            <button onClick={addAutomation} className={goldButton}>
              <Plus className="w-4 h-4" /> Ajouter
            </button>
          </div>

          <div className="space-y-2">
            {loadingAutomations ? (
              <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement...</p>
            ) : automations.length === 0 ? (
              <p className="text-xs text-slate-500">Aucune automatisation configurée.</p>
            ) : (
              automations.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-[#071f21] border border-[#1c4448]">
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {a.type === 'daily_brief' ? 'Récap de ma journée' : 'Récap de mes mails'}
                      </p>
                      <p className="text-xs text-slate-400">{a.times.join(', ')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Toggle checked={a.is_active} onChange={(v) => void toggleAutomation(a.id, v)} />
                    <button onClick={() => void deleteAutomation(a.id)} className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {newAutomationType === 'mail_digest' && (
            <p className="text-[11px] text-slate-500">
              Nécessite d'être connecté à Google Workspace (Gmail) — sinon aucun récap ne sera envoyé pour ce créneau.
            </p>
          )}
        </div>
      );

      case 'pipeline-automations': {
        const stages = pipelineStagesByAgency[newPipelineAutomation.agencyId] || [];
        return (
          <div className="space-y-5">
            <div>
              <p className="font-semibold text-white">Nouvelle automatisation de pipeline</p>
              <p className="text-xs text-slate-400 mt-1">
                Quand un client atteint cette étape, Nova proposera de préparer cet e-mail — jamais d'envoi automatique/silencieux, toujours une confirmation puis un brouillon modifiable.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={newPipelineAutomation.agencyId}
                onChange={(e) => setNewPipelineAutomation((p) => ({ ...p, agencyId: e.target.value, stageName: '' }))}
                className={inputClass}
              >
                {AGENCIES.filter((a) => a.id !== 'all').map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <input
                list="pipeline-automation-stages"
                value={newPipelineAutomation.stageName}
                onChange={(e) => setNewPipelineAutomation((p) => ({ ...p, stageName: e.target.value }))}
                placeholder="Nom de l'étape (ex: Offre de prêt)"
                className={inputClass}
              />
              <datalist id="pipeline-automation-stages">
                {stages.map((s) => <option key={s} value={s} />)}
              </datalist>
              <input
                value={newPipelineAutomation.emailSubject}
                onChange={(e) => setNewPipelineAutomation((p) => ({ ...p, emailSubject: e.target.value }))}
                placeholder="Sujet de l'e-mail"
                className={`${inputClass} sm:col-span-2`}
              />
              <textarea
                value={newPipelineAutomation.emailBody}
                onChange={(e) => setNewPipelineAutomation((p) => ({ ...p, emailBody: e.target.value }))}
                placeholder="Corps de l'e-mail (peut contenir {{prenom}}, {{nom}}...)"
                rows={4}
                className={`${inputClass} sm:col-span-2 resize-y`}
              />
            </div>
            <div className="flex justify-end">
              <button onClick={addPipelineAutomation} className={goldButton}>
                <Plus className="w-4 h-4" /> Créer l'automatisation
              </button>
            </div>

            <div className="space-y-2 pt-2 border-t border-[#1c4448]">
              {loadingPipelineAutomations ? (
                <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement...</p>
              ) : pipelineAutomations.length === 0 ? (
                <p className="text-xs text-slate-500">Aucune automatisation de pipeline configurée.</p>
              ) : (
                pipelineAutomations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-[#071f21] border border-[#1c4448]">
                    <div className="flex items-center gap-3 min-w-0">
                      <Zap className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {AGENCIES.find((ag) => ag.id === a.agency_id)?.name || a.agency_id} — {a.stage_name}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{a.email_subject}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Toggle checked={a.is_active} onChange={(v) => void togglePipelineAutomation(a.id, v)} />
                      <button onClick={() => void deletePipelineAutomation(a.id)} className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      }

      case 'mail': return <div className="space-y-4"><input ref={signatureInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void uploadSignatureImage(f);e.currentTarget.value='';}}/><div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><label className="space-y-2"><span className="text-xs font-semibold text-white flex items-center gap-2"><Code2 className="w-4 h-4 text-[#F7BC5F]"/>Signature HTML</span><textarea value={mailSignature} onChange={e=>setMailSignature(e.target.value)} rows={7} className={`${inputClass} font-mono text-xs`}/></label><div className="space-y-2"><span className="text-xs font-semibold text-white flex items-center gap-2"><ImageIcon className="w-4 h-4 text-[#F7BC5F]"/>Image de signature</span><button onClick={()=>signatureInputRef.current?.click()} className="w-full min-h-[170px] rounded-xl border border-dashed border-[#285057] bg-[#071f21] flex flex-col items-center justify-center text-slate-400 hover:border-[#F7BC5F]/60 overflow-hidden">{mailSignatureImage?<img src={mailSignatureImage} className="max-h-40 object-contain"/>:<><ImageIcon className="w-8 h-8 mb-2"/><span className="text-sm">Importer une image PNG/JPG</span></>}</button></div></div><div className="flex justify-end"><button onClick={saveMail} disabled={busy==='mail'} className={goldButton}><Save className="w-4 h-4"/>Sauvegarder</button></div></div>;


      case 'export': return <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><p className="font-semibold text-white">Exporter mes données</p><p className="text-xs text-slate-400 mt-1">Génère réellement une archive ZIP JSON de vos données accessibles.</p></div><button onClick={exportMyData} disabled={busy==='export'} className={goldButton}><Download className="w-4 h-4"/>Exporter mes données</button></div>;

      case 'event-titles': return <div className="space-y-5"><div className="flex items-center justify-between"><div><p className="font-semibold text-white">Titres des tâches et rendez-vous</p><p className="text-xs text-slate-400 mt-1">Synchronisés sur votre compte, sauvegarde automatique.</p></div><span className="flex items-center gap-1.5 text-xs text-slate-400">{busy==='templates' ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/>Enregistrement...</> : <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400"/>Enregistré</>}</span></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{([['Tâches',taskTitles,setTaskTitles,newTaskTitle,setNewTaskTitle],['Rendez-vous',appointmentTitles,setAppointmentTitles,newAppointmentTitle,setNewAppointmentTitle]] as const).map(([label,list,setter,newValue,setNewValue])=><div key={label} className="space-y-2"><p className="text-sm font-bold text-white">{label} <span className="text-slate-500">({list.length})</span></p>{list.map((item,index)=><div key={`${item}-${index}`} className="flex items-center gap-2"><span className="text-xs text-slate-500 w-5 text-right">{index+1}</span><input value={item} onChange={e=>{const n=[...list];n[index]=e.target.value;setter(n);}} className={`${inputClass} flex-1 py-2`}/><button onClick={()=>setter(reorder(list,index,index-1))} className="p-2 text-slate-400"><ArrowUp className="w-4 h-4"/></button><button onClick={()=>setter(reorder(list,index,index+1))} className="p-2 text-slate-400"><ArrowDown className="w-4 h-4"/></button><button onClick={()=>setter(list.filter((_,i)=>i!==index))} className="p-2 text-red-500"><Trash2 className="w-4 h-4"/></button></div>)}<div className="flex gap-2 pt-2"><input value={newValue} onChange={e=>setNewValue(e.target.value)} placeholder="Ajouter un titre..." className={inputClass}/><button onClick={()=>{if(!newValue.trim())return;setter([...list,newValue.trim()]);setNewValue('');}} className={goldButton}><Plus className="w-4 h-4"/>Ajouter</button></div></div>)}</div></div>;

      case 'sidebar-order': {
        // Demande explicite (28/08/2026) : "supprime carte pour immosphera
        // dans paramètre et pour conseils finances aussi" — même filtrage
        // que Sidebar.tsx (visibleNavItems) : l'onglet "Carte" (prospection
        // Novavisio, déjà bloquée côté contenu pour les autres agences) ne
        // doit apparaître ici que pour l'agence Novavisio. Sa position
        // d'origine dans `tabs` est conservée (réinsérée telle quelle) pour
        // que réordonner les onglets visibles ne perde jamais sa place.
        const isNovavisioActive = /novavisio/i.test(activeAgency?.name ?? '');
        const carteIndexInTabs = tabs.findIndex(([, path]) => path === 'carte-novavisio');
        const carteEntry = carteIndexInTabs >= 0 ? tabs[carteIndexInTabs] : null;
        const visibleTabs = isNovavisioActive || !carteEntry
          ? tabs
          : tabs.filter(([, path]) => path !== 'carte-novavisio');
        const rebuildFullTabs = (newVisible: Array<[string, string]>): Array<[string, string]> => {
          if (isNovavisioActive || !carteEntry) return newVisible;
          const result = [...newVisible];
          result.splice(Math.min(carteIndexInTabs, result.length), 0, carteEntry);
          return result;
        };
        return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white">Ordre des onglets dans la barre latérale</p>
              <p className="text-xs text-slate-400 mt-1">
                {isMobile
                  ? "L'ordre se règle depuis la version ordinateur et se synchronise ici automatiquement, en direct — pas besoin de mise à jour."
                  : 'Glissez-déposez les onglets. En passant sur un autre onglet, celui-ci s\'écarte pour glisser dessous. L\'ordre est appliqué immédiatement, y compris sur mobile.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                saveTabOrder(DEFAULT_TABS);
                setDragTabIndex(null);
                setDragTabOverIndex(null);
              }}
              className="px-3 py-2 rounded-xl bg-[#102f32] text-white text-xs font-semibold flex items-center gap-2 hover:bg-[#184448] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Réinitialiser
            </button>
          </div>

          {/* Signalé : "le glisser-déposer dans Paramètres n'est pas fluide"
              — cette liste utilisait encore l'ancien glisser-déposer HTML5
              natif (translateY calculé à la main), remplacé ici par
              @hello-pangea/dnd, déjà utilisée juste plus bas pour les
              sections (même bibliothèque, même fluidité, cohérent dans tout
              ce fichier). */}
          <DragDropContext
            onDragEnd={(result: DropResult) => {
              const { source, destination } = result;
              if (!destination || destination.index === source.index) return;
              saveTabOrder(rebuildFullTabs(reorder(visibleTabs, source.index, destination.index)));
            }}
          >
            <Droppable droppableId="settings-tabs" isDropDisabled={isMobile}>
              {(dropProvided) => (
                <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-2 relative">
                  {visibleTabs.map(([label, path], index) => {
                    const NavIcon = NAV_ITEMS.find((n) => n.id === path)?.icon;
                    // Sur mobile, l'ordre des onglets ne se modifie que
                    // depuis la version ordinateur : glisser désactivé.
                    return (
                      <Draggable draggableId={path} index={index} key={path} isDragDisabled={isMobile}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={`flex items-center gap-3 rounded-xl border px-3 py-3.5 sm:py-2.5 select-none ${
                              dragSnapshot.isDragging
                                ? 'border-[#F7BC5F] bg-[#F7BC5F]/20 shadow-xl ring-2 ring-[#F7BC5F]/40'
                                : 'border-[#1c4448] bg-[#071f21] hover:border-slate-500 transition-colors'
                            }`}
                            style={{ ...dragProvided.draggableProps.style }}
                          >
                            {!isMobile && (
                              <span {...dragProvided.dragHandleProps} className="cursor-grab active:cursor-grabbing shrink-0">
                                <GripVertical className={`w-4 h-4 ${dragSnapshot.isDragging ? 'text-[#F7BC5F]' : 'text-slate-500'}`} />
                              </span>
                            )}
                            {/* Ticket #42 (nouvelle base) : icônes ajoutées (surtout
                                utiles sur mobile, où la liste n'était qu'une colonne
                                de texte nue) — même icône que la barre latérale. */}
                            {NavIcon && (
                              <div className="w-9 h-9 sm:w-7 sm:h-7 rounded-lg bg-white/5 text-[#F9C977] flex items-center justify-center shrink-0">
                                <NavIcon className="w-5 h-5 sm:w-4 sm:h-4" />
                              </div>
                            )}
                            <span className="font-semibold text-base sm:text-sm text-white flex-1 truncate">{label}</span>
                            {!isMobile && dragSnapshot.isDragging && (
                              <span className="text-[10px] font-bold text-[#F7BC5F] uppercase tracking-wider bg-[#F7BC5F]/20 px-2 py-0.5 rounded-full border border-[#F7BC5F]/40">
                                Déplacement...
                              </span>
                            )}
                            {/* Signalé : sur mobile, l'ordre ne se règle plus qu'depuis
                                l'ordinateur (glisser-déposer), qui se synchronise ici
                                en direct — ces flèches n'ont donc plus lieu d'être sur
                                mobile (retirées, comme demandé). */}
                            {!isMobile && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => saveTabOrder(rebuildFullTabs(reorder(visibleTabs, index, index - 1)))}
                                  className="p-1.5 text-slate-400 hover:text-[#F7BC5F] rounded-lg hover:bg-white/5 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  title="Monter"
                                >
                                  <ArrowUp className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === visibleTabs.length - 1}
                                  onClick={() => saveTabOrder(rebuildFullTabs(reorder(visibleTabs, index, index + 1)))}
                                  className="p-1.5 text-slate-400 hover:text-[#F7BC5F] rounded-lg hover:bg-white/5 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  title="Descendre"
                                >
                                  <ArrowDown className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {dropProvided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      );
      }

      case 'home-tiles': return <div className="space-y-4">
        <div>
          <p className="font-semibold text-white">Raccourcis masqués de l'accueil</p>
          <p className="text-xs text-slate-400 mt-1">Un raccourci supprimé depuis la grille d'accueil atterrit ici au lieu d'être perdu. Réaffichez-le quand vous voulez.</p>
        </div>
        {hiddenHomeTiles.length === 0 ? (
          <div className="rounded-xl bg-[#071f21] border border-[#1c4448] px-4 py-6 text-center text-sm text-slate-400">
            Aucun raccourci masqué pour le moment.
          </div>
        ) : (
          <div className="space-y-2">
            {hiddenHomeTiles.map((tile) => (
              <div key={tile.id} className="flex items-center gap-3 rounded-xl bg-[#071f21] border border-[#1c4448] px-3 py-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#F7BC5F] shrink-0">
                  <LayoutGrid className="w-4 h-4" />
                </div>
                <span className="flex-1 text-sm text-white font-semibold truncate">{tile.title}</span>
                <button onClick={() => restoreHomeTile(tile.id)} className={goldButton}>
                  <Eye className="w-4 h-4" />Réafficher
                </button>
              </div>
            ))}
          </div>
        )}
      </div>;

      case 'contact-types': return <div className="space-y-4"><div className="flex items-center justify-between"><div><p className="font-semibold text-white">Types de contact</p><p className="text-xs text-slate-400 mt-1">La liste est utilisée par la création d'un client.</p></div><button onClick={()=>saveContactTypes(DEFAULT_CONTACT_TYPES)} className="px-3 py-2 rounded-xl bg-[#102f32] text-white text-xs font-semibold flex items-center gap-2"><RotateCcw className="w-4 h-4"/>Réinitialiser</button></div><div className="space-y-2">{contactTypes.map((item,index)=><div key={`${item}-${index}`} className="flex items-center gap-2"><div className="flex-1 rounded-xl bg-[#071f21] border border-[#1c4448] px-3 py-2 text-sm text-white">{item}</div><button onClick={()=>saveContactTypes(reorder(contactTypes,index,index-1))} className="p-2 text-slate-400"><ArrowUp className="w-4 h-4"/></button><button onClick={()=>saveContactTypes(reorder(contactTypes,index,index+1))} className="p-2 text-slate-400"><ArrowDown className="w-4 h-4"/></button><button onClick={()=>saveContactTypes(contactTypes.filter((_,i)=>i!==index))} className="p-2 text-red-500"><Trash2 className="w-4 h-4"/></button></div>)}</div><div className="flex gap-2"><input value={newContactType} onChange={e=>setNewContactType(e.target.value)} placeholder="Nouveau type de contact" className={inputClass}/><button onClick={()=>{if(!newContactType.trim())return;saveContactTypes([...contactTypes,newContactType.trim()]);setNewContactType('');}} className={goldButton}><Plus className="w-4 h-4"/>Ajouter</button></div></div>;

      case 'appearance': return (
        <div className="space-y-8">
          {/* Theme mode */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Palette className="w-4 h-4 text-[#F7BC5F]" /> Mode de thème
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                ['dark', 'Sombre Nova CRM', 'Thème par défaut recommandé pour le confort visuel.'],
                ['light', 'Clair', 'Thème lumineux à fort contraste.'],
                ['system', 'Système', 'S\'adapte automatiquement aux préférences de votre appareil.'],
              ].map(([value, label, desc]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void applyTheme(value)}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    theme === value
                      ? 'border-[#F7BC5F] bg-[#F7BC5F]/10 shadow-md ring-1 ring-[#F7BC5F]/30'
                      : 'border-[#1c4448] bg-[#071f21] hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Palette className={`w-5 h-5 ${theme === value ? 'text-[#F7BC5F]' : 'text-slate-400'}`} />
                    {theme === value && (
                      <span className="w-5 h-5 rounded-full bg-[#F7BC5F] text-[#07191b] flex items-center justify-center font-bold text-xs">
                        ✓
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Interface colors */}
          <div className="space-y-3 pt-2 border-t border-[#173d40]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#F7BC5F]" /> Couleurs d'interface (12 variations)
              </label>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
                Couleur active : {INTERFACE_COLORS.find(c => c.hex.toLowerCase() === accentColor.toLowerCase())?.name || 'Or Élégance'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Personnalisez la couleur d'accentuation des boutons, boutons d'action et surbrillances de l'interface.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {INTERFACE_COLORS.map((color) => {
                const isSelected = accentColor.toLowerCase() === color.hex.toLowerCase();
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => saveAppearance(color.hex, bgImage, bgOpacity)}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col items-start gap-2 relative overflow-hidden group ${
                      isSelected
                        ? 'border-white bg-white/10 ring-2 ring-white/30 shadow-lg scale-[1.02]'
                        : 'border-[#1c4448] bg-[#071f21] hover:border-slate-500 hover:bg-[#0c2e32]'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className="w-7 h-7 rounded-full shadow-inner border border-white/30 shrink-0 transition-transform group-hover:scale-110"
                        style={{ backgroundColor: color.hex }}
                      />
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-xs shadow-md">
                          ✓
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-bold text-white truncate w-full">{color.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{color.hex}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ticket #117 : couleur du calendrier (Agenda), indépendante de
              la couleur d'accent générale ci-dessus. */}
          <div className="space-y-3 pt-2 border-t border-[#173d40]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[#F7BC5F]" /> Couleur du calendrier
              </label>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
                Couleur active : {INTERFACE_COLORS.find(c => c.hex.toLowerCase() === calendarAccentColor.toLowerCase())?.name || 'Or Élégance'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Choisissez la couleur de l'Agenda (jour en cours, rendez-vous, boutons) indépendamment du reste de l'interface.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {INTERFACE_COLORS.map((color) => {
                const isSelected = calendarAccentColor.toLowerCase() === color.hex.toLowerCase();
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => saveCalendarColor(color.hex)}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col items-start gap-2 relative overflow-hidden group ${
                      isSelected
                        ? 'border-white bg-white/10 ring-2 ring-white/30 shadow-lg scale-[1.02]'
                        : 'border-[#1c4448] bg-[#071f21] hover:border-slate-500 hover:bg-[#0c2e32]'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className="w-7 h-7 rounded-full shadow-inner border border-white/30 shrink-0 transition-transform group-hover:scale-110"
                        style={{ backgroundColor: color.hex }}
                      />
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-xs shadow-md">
                          ✓
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-bold text-white truncate w-full">{color.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{color.hex}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Background image selection */}
          <div className="space-y-4 pt-2 border-t border-[#173d40]">
            <input
              ref={bgFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUploadBgImage(file);
                e.currentTarget.value = '';
              }}
            />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-[#F7BC5F]" /> Image de fond d'écran au choix
                </label>
                <p className="text-xs text-slate-400 mt-0.5">
                  Choisissez une image prédéfinie, téléchargez une image personnelle ou collez un lien d'image.
                </p>
              </div>
              <button
                type="button"
                onClick={() => bgFileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-[#0e3034] border border-[#1f4f55] hover:border-[#F7BC5F] text-white text-xs font-bold flex items-center gap-2 shrink-0 transition-colors"
              >
                <Upload className="w-4 h-4 text-[#F7BC5F]" />
                Importer mon image
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PRESET_BACKGROUNDS.map((preset) => {
                const isSelected = bgImage === preset.url;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => saveAppearance(accentColor, preset.url, bgOpacity)}
                    className={`h-24 rounded-2xl border relative overflow-hidden text-left transition-all group ${
                      isSelected
                        ? 'border-[#F7BC5F] ring-2 ring-[#F7BC5F]/50 shadow-xl scale-[1.02]'
                        : 'border-[#1c4448] hover:border-slate-400'
                    }`}
                  >
                    {preset.url ? (
                      <img
                        src={preset.url}
                        alt={preset.name}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-[#061719] flex items-center justify-center">
                        <X className="w-6 h-6 text-slate-500" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2.5 flex flex-col justify-between">
                      <div className="flex justify-end">
                        {isSelected && (
                          <span className="w-5 h-5 rounded-full bg-[#F7BC5F] text-[#07191b] flex items-center justify-center font-bold text-xs shadow-md">
                            ✓
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-white drop-shadow-md truncate">{preset.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="url"
                value={customBgInput}
                onChange={(e) => setCustomBgInput(e.target.value)}
                placeholder="Ou coller une URL d'image (ex: https://images.unsplash.com/...)"
                className={`${inputClass} text-xs flex-1`}
              />
              <button
                type="button"
                onClick={() => {
                  if (!customBgInput.trim()) return;
                  saveAppearance(accentColor, customBgInput.trim(), bgOpacity);
                  setCustomBgInput('');
                  notify("URL d'image de fond appliquée.");
                }}
                disabled={!customBgInput.trim()}
                className={goldButton}
              >
                <Check className="w-4 h-4" /> Appliquer URL
              </button>
              {bgImage && (
                <button
                  type="button"
                  onClick={() => saveAppearance(accentColor, '', bgOpacity)}
                  className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold hover:bg-red-500/20 shrink-0"
                >
                  Effacer le fond
                </button>
              )}
            </div>
          </div>

          {/* Opacity slider */}
          <div className="space-y-3 pt-2 border-t border-[#173d40]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#F7BC5F]" /> Intensité de l'opacité de l'image de fond
              </label>
              <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-[#F7BC5F]/20 border border-[#F7BC5F]/30 text-[#F7BC5F]">
                {bgOpacity}%
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Ajustez l'intensité de l'image de fond pour maintenir une parfaite lisibilité de votre espace de travail.
            </p>

            <div className="flex items-center gap-4 bg-[#071f21] border border-[#1c4448] p-4 rounded-2xl">
              <span className="text-xs text-slate-400 font-bold shrink-0">5% (Discret)</span>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={bgOpacity}
                // La section entière est "draggable" (réorganisation des
                // blocs de Paramètres) — sans ceci, cliquer sur la réglette
                // déclenchait le drag HTML5 du bloc au lieu de déplacer le
                // curseur.
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const newOpacity = Number(e.target.value);
                  setBgOpacity(newOpacity);
                  saveAppearance(accentColor, bgImage, newOpacity);
                }}
                className="flex-1 accent-[#F7BC5F] cursor-pointer h-2 bg-[#173d40] rounded-lg"
              />
              <span className="text-xs text-slate-400 font-bold shrink-0">100% (Intense)</span>
            </div>
          </div>
        </div>
      );
      default: return null;
    }
  };

  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (9/16) : la section
  // affichée à droite est toujours celle sélectionnée dans la barre
  // latérale — si `openSection` ne correspond à aucune section visible
  // pour ce compte (ex. rôle changé en cours de session, ou état initial
  // `null`), on retombe simplement sur la première section disponible
  // plutôt que d'afficher un volet de contenu vide.
  const activeSection = (openSection && orderedSections.find((s) => s.id === openSection)) || orderedSections[0] || null;
  const ActiveIcon = activeSection?.icon;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 text-white">
      {/* Signalé (30/08/2026) : "en haut il y a du texte transparent... la
          tuile ne prend pas de suite le plein écran" — cet en-tête générique
          (titre "Paramètres" + Déconnexion) posé à même la photo de fond
          était à peine lisible et retardait l'affichage du contenu réel en
          arrivant par un raccourci direct (tuile Annonce). La carte
          "Annonces" a déjà son propre titre — en-tête générique masqué
          dans ce contexte, contenu affiché dès le haut de l'écran.
          Déconnexion reste accessible via le menu du profil, en haut à
          droite de l'appli. */}
      {/* Revu (30/08/2026, capture à l'appui) : "rajoute un fond sur les
          textes en haut" — la remarque au-dessus disait déjà "à peine
          lisible" mais n'avait été traitée qu'en le masquant dans UN
          contexte précis (tuile Annonce) ; le problème de fond restait
          entier partout ailleurs. Fond opaque ajouté pour de bon ici. */}
      {!focusedFromTile && (
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-2 bg-[#0a1e20]/95 border border-white/10 rounded-2xl p-4">
        <div className="w-11 h-11 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 text-[#F7BC5F] flex items-center justify-center">
          <Settings className="w-6 h-6"/>
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Paramètres</h1>
          <p className="text-sm text-slate-400">
            {isAdmin ? 'Gestion des utilisateurs et des agences' : 'Vos préférences personnelles'}
          </p>
        </div>
        <button onClick={logout} className="px-4 py-2 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 text-sm font-semibold flex items-center gap-2">
          <LogOut className="w-4 h-4"/>Déconnexion
        </button>
      </div>
      )}

      {/* Refonte en deux volets — barre latérale (tous les onglets, jamais
          perdus) + contenu complet à droite, sans rechargement de page.
          `overscroll-contain` : empêche l'effet "tirer pour actualiser" du
          navigateur mobile de se déclencher en bas de page (il rechargeait
          l'appli et faisait retomber sur Accueil). */}
      <div className="flex flex-col md:flex-row gap-5 md:gap-6 items-start overscroll-contain">
        {!focusedFromTile && (
        // Demande explicite (30/08/2026) : "prend pour de largeur sur
        // l'écran pour le panneau de gauche" — w-64 (256px) coupait la
        // plupart des libellés ("Raccourcis masq...", "Titres des
        // tâches...", capture à l'appui). Élargi à w-80 (320px).
        <nav className="w-full md:w-80 md:shrink-0 md:sticky md:top-4">
          {/* Mobile : menu simple tactile, défilement horizontal, pas de glisser-déposer. */}
          <div className="flex md:hidden gap-2 overflow-x-auto pb-1 -mx-1 px-1 custom-scrollbar overscroll-contain">
            {orderedSections.map((section) => {
              const Icon = section.icon;
              const active = activeSection?.id === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setOpenSection(section.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                    active ? 'bg-[#F7BC5F] text-slate-950' : 'bg-[#0b292b] text-slate-300 border border-[#173d40]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {section.label}
                </button>
              );
            })}
          </div>

          {/* Ordinateur/tablette : panneau avec fond visible, liste
              verticale réordonnable par glisser-déposer fluide (même
              bibliothèque que le Kanban) ou par les flèches. */}
          <div className="hidden md:block rounded-2xl border border-[#173d40] bg-[#0b292b]/90 shadow-[0_10px_30px_rgba(0,0,0,.12)] p-2">
            <DragDropContext onDragEnd={handleSectionDragEnd}>
              <Droppable droppableId="settings-sections">
                {(dropProvided) => (
                  <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="flex flex-col gap-1">
                    {orderedSections.map((section, index) => {
                      const Icon = section.icon;
                      const active = activeSection?.id === section.id;
                      return (
                        <Draggable draggableId={section.id} index={index} key={section.id}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              id={`settings-section-${section.id}`}
                              // Demande explicite (30/08/2026) : "sépare
                              // chaque élément par un liseret entre les
                              // onglets de gauche" — bordure fine entre
                              // chaque ligne (jamais avant la première, pour
                              // ne pas doubler le cadre du panneau).
                              className={`group/row flex items-center gap-0.5 rounded-xl ${index > 0 ? 'border-t border-white/10 pt-1' : ''} ${dragSnapshot.isDragging ? 'bg-[#0e3336] shadow-xl' : 'transition-colors'}`}
                              style={{ ...dragProvided.draggableProps.style }}
                            >
                              <span
                                {...dragProvided.dragHandleProps}
                                className="cursor-grab active:cursor-grabbing p-1.5 shrink-0 text-slate-600 opacity-0 group-hover/row:opacity-100 transition-opacity"
                              >
                                <GripVertical className="w-3.5 h-3.5 hover:text-[#F7BC5F]" />
                              </span>
                              <button
                                type="button"
                                onClick={() => setOpenSection(section.id)}
                                className={`flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-left transition-all ${
                                  active
                                    ? 'bg-[#F7BC5F] text-slate-950'
                                    : 'text-slate-300 hover:bg-white/5 hover:text-white hover:shadow-[inset_0_0_16px_2px_rgba(247,188,95,0.3)]'
                                }`}
                              >
                                <Icon className="w-4 h-4 shrink-0" />
                                <span className="flex-1 min-w-0 truncate">{section.label}</span>
                              </button>
                              <div className="flex flex-col shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity pr-0.5">
                                <button type="button" onClick={() => moveSection(index, -1)} className="p-0.5 text-slate-600 hover:text-[#F7BC5F]">
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button type="button" onClick={() => moveSection(index, 1)} className="p-0.5 text-slate-600 hover:text-[#F7BC5F]">
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {dropProvided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </nav>
        )}

        <div className="flex-1 min-w-0 w-full rounded-2xl border border-[#173d40] bg-[#0b292b]/90 shadow-[0_10px_30px_rgba(0,0,0,.12)] p-5 sm:p-6 overscroll-contain">
          {activeSection && ActiveIcon ? (
            <>
              {/* Demandé (30/08/2026) : "supprime tous les réglages, ça ne
                  sert à rien d'aller dans Paramètres... faut que ça soit
                  indépendant comme les autres [tuiles]" — le lien de secours
                  vers la barre latérale complète est retiré : ce point
                  d'entrée reste un écran autonome, comme les autres tuiles
                  de l'accueil qui ne renvoient jamais vers Paramètres. */}
              <h2 className="font-bold text-white text-lg flex items-center gap-2.5 mb-5">
                <ActiveIcon className="w-5 h-5 text-[#F7BC5F]" /> {activeSection.label}
              </h2>
              {sectionBody(activeSection.id)}
            </>
          ) : (
            <p className="text-sm text-slate-400">Aucune section disponible.</p>
          )}
        </div>
      </div>
    </div>
  );
}