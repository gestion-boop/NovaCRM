import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  DndContext, DragOverEvent, DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudSun,
  ChevronRight, Bell, MessageSquare, Users, GitFork, FileText, Mail, BarChart2,
  Headphones, Calendar, FileEdit, UserPlus, Folder, Plus, X, UserPlus2,
  ChevronDown, ChevronUp, Megaphone,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { getCachedAccessToken, requestWorkspaceAccessToken, fetchGoogleCalendarEvents } from '@/lib/workspace';

interface MobileHomeProps {
  onNavigate: (nav: string) => void;
  onOpenNouveauLead: () => void;
  unreadRemindersCount: number;
  unreadMessagesCount: number;
  unreadMailCount: number;
  // La clochette de notifications, remontée ici depuis l'ancienne barre de
  // navigation du bas (simplifiée à Accueil/Nova/Menu) — demande explicite.
  unreadNotificationsCount?: number;
  onOpenNotifications?: () => void;
}

const AGENCY_LOGO_BY_NAME: Record<string, string> = {
  'conseils finances': '/Logo%20ConseilsFinances.png',
  'novavisio': '/Logo%20NovaVisio.png',
  'immosphera': '/Logo%20Immosphera.png',
  'novasphere': '/nova-mascotte.png',
  'toutes les sociétés': '/nova-mascotte.png',
};

// ── Météo (Open-Meteo, sans clé API) ────────────────────────────────────────
function weatherMeta(code: number): { Icon: React.ElementType; label: string } {
  if (code === 0) return { Icon: Sun, label: 'Ciel dégagé' };
  if ([1, 2, 3].includes(code)) return { Icon: CloudSun, label: 'Partiellement nuageux' };
  if ([45, 48].includes(code)) return { Icon: CloudFog, label: 'Brouillard' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { Icon: CloudRain, label: 'Pluie' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { Icon: CloudSnow, label: 'Neige' };
  if ([95, 96, 99].includes(code)) return { Icon: CloudLightning, label: 'Orage' };
  return { Icon: Cloud, label: 'Nuageux' };
}

// Siège Conseils Finances (Narbonne) — utilisé si la géolocalisation est
// refusée/indisponible, pour toujours afficher une météo pertinente.
const FALLBACK_COORDS = { lat: 43.1839, lon: 3.0064 };

interface SpaceDef {
  id: string;
  label: string;
  icon: React.ElementType;
  nav: string;
  gradient: string;
  badge?: number;
}

const DEFAULT_VISIBLE = ['clients', 'pipeline', 'documents', 'mail', 'tableau-de-bord', 'support'];
const STORAGE_KEY = 'novasphere_mobile_spaces_v1';

// Ticket #18/#21 : ordre des 6 premières tuiles identique au desktop tant
// que l'utilisateur n'a pas personnalisé sa grille mobile. La grille
// desktop range certaines tuiles dans des dossiers (Communication,
// Business...) : on l'aplatit dans l'ordre pour retrouver un classement
// linéaire équivalent, en ne gardant que les ids qui existent aussi côté
// mobile (le catalogue des deux écrans n'est pas identique).
const getDesktopTileOrder = (): string[] => {
  try {
    const raw = localStorage.getItem('novasphere_home_tiles_v3');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const flat: string[] = [];
    const walk = (items: any[]) => {
      for (const it of items) {
        if (it?.id) flat.push(it.id);
        if (Array.isArray(it?.children)) walk(it.children);
      }
    };
    walk(parsed);
    return flat;
  } catch {
    return [];
  }
};

const SPACE_TILE_CLASS =
  'relative flex flex-col items-center justify-center gap-2 py-5 select-none';

export const MobileHome: React.FC<MobileHomeProps> = ({
  onNavigate,
  onOpenNouveauLead,
  unreadRemindersCount,
  unreadMessagesCount,
  unreadMailCount,
  unreadNotificationsCount = 0,
  onOpenNotifications,
}) => {
  const { currentUser, userProfile, activeAgency } = useAuth();

  // ── Horloge & salutation ──────────────────────────────────────────────
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const firstName = (userProfile?.displayName || currentUser?.displayName || '').split(' ')[0] || '';
  const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeLabel = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ── Météo ─────────────────────────────────────────────────────────────
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async (lat: number, lon: number) => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
        );
        const data = await res.json();
        if (!cancelled && data?.current) {
          setWeather({ temp: Math.round(data.current.temperature_2m), code: data.current.weather_code });
        }
      } catch {
        // Météo indisponible : la carte reste utilisable sans température.
      }
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => load(pos.coords.latitude, pos.coords.longitude),
        () => load(FALLBACK_COORDS.lat, FALLBACK_COORDS.lon),
        { timeout: 5000 }
      );
    } else {
      load(FALLBACK_COORDS.lat, FALLBACK_COORDS.lon);
    }
    return () => { cancelled = true; };
  }, []);
  const { Icon: WeatherIcon } = weather ? weatherMeta(weather.code) : { Icon: Sun };

  // ── Rendez-vous du jour (Google Calendar) ────────────────────────────
  const [todaysEvents, setTodaysEvents] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let token = getCachedAccessToken();
        if (!token) token = await requestWorkspaceAccessToken().catch(() => null);
        if (!token) return;
        const events = await fetchGoogleCalendarEvents(token);
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);
        const count = events.filter((e) => {
          const raw = e.start?.dateTime || e.start?.date;
          if (!raw) return false;
          const d = new Date(raw);
          return d >= startOfDay && d < endOfDay;
        }).length;
        if (!cancelled) setTodaysEvents(count);
      } catch {
        // Pas grave : compte simplement masqué si Workspace n'est pas connecté.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Avatar & agence ───────────────────────────────────────────────────
  // Recherche par ADRESSE E-MAIL et non par `id` : les identifiants de
  // teamMembers.ts ont été resynchronisés le 31/08/2026, mais l'e-mail reste
  // le seul repère stable entre ce fichier d'habillage et les vrais comptes.
  // C'est ce qui privait Natacha de sa photo de profil.
  const teamMember = TEAM_MEMBERS.find(
    (m) => m.email.toLowerCase() === (currentUser?.email || '').toLowerCase(),
  ) || TEAM_MEMBERS.find((m) => m.id === currentUser?.uid);
  const avatarUrl = teamMember?.avatarUrl || currentUser?.photoURL || null;
  const initials = (firstName || 'U').charAt(0).toUpperCase();
  const normalizeAgencyName = (v?: string) => (v || '').trim().toLowerCase();
  const agencyLogo = AGENCY_LOGO_BY_NAME[normalizeAgencyName(activeAgency?.name)] || AGENCY_LOGO_BY_NAME['novasphere'];

  // ── Mes espaces : catalogue complet + config visible/ordre persistée ──
  const ALL_SPACES: SpaceDef[] = useMemo(() => [
    { id: 'clients', label: 'Clients', icon: Users, nav: 'clients', gradient: 'from-[#a8421e] to-[#451a03]' },
    { id: 'pipeline', label: 'Pipeline', icon: GitFork, nav: 'pipeline', gradient: 'from-[#6b21a8] to-[#3b0764]' },
    { id: 'documents', label: 'Documents', icon: FileText, nav: 'documents', gradient: 'from-[#b45309] to-[#78350f]' },
    // Ticket #32 (nouvelle base) : la tuile Mail ouvrait toujours la boîte
    // de réception complète, jamais "Non lus" (contrairement à la tuile
    // équivalente sur desktop) — même cible que AccueilGrid.
    { id: 'mail', label: 'Messagerie', icon: Mail, nav: 'mail-unread', gradient: 'from-[#0369a1] to-[#075985]', badge: unreadMailCount },
    { id: 'tableau-de-bord', label: 'Tableau de bord', icon: BarChart2, nav: 'tableau-de-bord', gradient: 'from-[#0d9488] to-[#065f46]' },
    { id: 'support', label: 'Support', icon: Headphones, nav: 'support', gradient: 'from-[#4338ca] to-[#312e81]' },
    { id: 'agenda', label: 'Agenda', icon: Calendar, nav: 'agenda', gradient: 'from-[#0f766e] to-[#134e4a]' },
    { id: 'notes', label: 'Notes', icon: FileEdit, nav: 'notes', gradient: 'from-[#7c3aed] to-[#4c1d95]' },
    { id: 'equipe', label: 'Équipe', icon: UserPlus, nav: 'equipe', gradient: 'from-[#334155] to-[#1e293b]' },
    { id: 'projets-internes', label: 'Pipeline interne', icon: Folder, nav: 'projets-internes', gradient: 'from-[#92400e] to-[#451a03]' },
    { id: 'chat', label: 'Chat', icon: MessageSquare, nav: 'chat', gradient: 'from-[#0891b2] to-[#155e75]', badge: unreadMessagesCount },
    { id: 'rappels', label: 'Rappels', icon: Bell, nav: 'rappels', gradient: 'from-[#9f1239] to-[#4c0519]', badge: unreadRemindersCount },
    // Ticket #255 : accès rapide à la création d'annonce, réservé aux
    // administrateurs (même règle que ParametresView.tsx : role === 'super_admin').
    ...(userProfile?.role === 'super_admin'
      ? [{ id: 'annonce', label: 'Annonce', icon: Megaphone, nav: 'parametres', gradient: 'from-[#F7BC5F] to-[#78350F]' }]
      : []),
  ], [unreadMailCount, unreadMessagesCount, unreadRemindersCount, userProfile?.role]);

  // Grille à positions libres (façon écran d'accueil iPhone) : chaque case
  // contient soit un id de tuile, soit `null` (case vide) — contrairement à
  // une simple liste réordonnée, une case vide reste vide (ex: une tuile en
  // bas à gauche, une autre tout à droite, avec du vide entre les deux) au
  // lieu d'être toujours comblée automatiquement.
  // Ticket #43 : plafond relevé (15 → 24) pour ne jamais bloquer l'ajout de
  // nouveaux raccourcis une fois le catalogue presque entièrement affiché.
  const GRID_SLOTS = 24;
  const CELL_STORAGE_KEY = 'novasphere_mobile_spaces_grid_v1';

  const ALL_SPACE_IDS = ALL_SPACES.map((s) => s.id);

  const [cellIds, setCellIds] = useState<(string | null)[]>(() => {
    // Ajoute dans les cases vides les tuiles du catalogue qui manqueraient
    // encore à une grille déjà enregistrée (demande explicite : "ajoute les
    // tuiles manquantes") — sans toucher à l'ordre/l'emplacement des tuiles
    // déjà placées par l'utilisateur.
    const fillMissing = (grid: (string | null)[]) => {
      const present = new Set(grid.filter(Boolean));
      const missing = ALL_SPACE_IDS.filter((id) => !present.has(id));
      let i = 0;
      for (const id of missing) {
        while (i < grid.length && grid[i] !== null) i++;
        if (i >= grid.length) break;
        grid[i] = id;
      }
      return grid;
    };

    try {
      const raw = localStorage.getItem(CELL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          const grid = [...parsed];
          while (grid.length < GRID_SLOTS) grid.push(null);
          return fillMissing(grid.slice(0, GRID_SLOTS));
        }
      }
    } catch {
      // ignore
    }

    // Pas de grille enregistrée : on migre l'ancienne liste compacte si elle
    // existe, sinon on reprend l'ordre du desktop, puis on complète avec
    // TOUT le reste du catalogue (avant : plafonné à 6, laissant des tuiles
    // "manquantes" accessibles seulement via le "+").
    let initialIds: string[] = [];
    try {
      const rawOld = localStorage.getItem(STORAGE_KEY);
      const parsedOld = rawOld ? JSON.parse(rawOld) : null;
      if (Array.isArray(parsedOld) && parsedOld.length) initialIds = parsedOld;
    } catch {
      // ignore
    }
    if (initialIds.length === 0) {
      const mobileAppIds = new Set(ALL_SPACE_IDS);
      const fromDesktop = getDesktopTileOrder().filter((id) => mobileAppIds.has(id));
      initialIds = fromDesktop.length ? [...fromDesktop] : [];
    }
    for (const id of ALL_SPACE_IDS) {
      if (!initialIds.includes(id)) initialIds.push(id);
    }
    const grid: (string | null)[] = Array(GRID_SLOTS).fill(null);
    initialIds.slice(0, GRID_SLOTS).forEach((id, i) => { grid[i] = id; });
    return grid;
  });

  useEffect(() => {
    localStorage.setItem(CELL_STORAGE_KEY, JSON.stringify(cellIds));
  }, [cellIds]);

  const visibleIds = cellIds.filter((id): id is string => !!id);
  const visibleSpaces = visibleIds
    .map((id) => ALL_SPACES.find((s) => s.id === id))
    .filter(Boolean) as SpaceDef[];
  const hiddenSpaces = ALL_SPACES.filter((s) => !visibleIds.includes(s.id));

  // Ids "slots" utilisés par le contexte triable de dnd-kit : un id réel
  // pour une case occupée, un id synthétique stable pour une case vide.
  const cellSlotIds = cellIds.map((id, i) => id || `empty-${i}`);

  const [editMode, setEditMode] = useState(false);
  // Ticket #43 (nouvelle base) : au-delà d'un certain nombre de raccourcis
  // ajoutés, la grille s'étalait sur plusieurs pages sans jamais donner
  // accès au bouton "Ajouter" (poussé hors champ). On limite l'affichage
  // aux 5 premiers + une tuile flèche pour déplier le reste, plutôt que de
  // tout montrer d'un coup.
  const [showAllSpaces, setShowAllSpaces] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => setEditMode(true), 480);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Masquer une tuile vide simplement sa case (elle ne comble plus
  // automatiquement le trou, contrairement à l'ancienne liste compacte).
  const hideSpace = (id: string) => setCellIds((cur) => cur.map((x) => (x === id ? null : x)));
  const addSpace = (id: string) => {
    setCellIds((cur) => {
      const firstEmpty = cur.indexOf(null);
      if (firstEmpty !== -1) {
        const next = [...cur];
        next[firstEmpty] = id;
        return next;
      }
      return [...cur, id];
    });
    setShowAddSheet(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  // La tuile qu'on déplace se soulève (échelle + ombre + halo doré). Le
  // réordonnancement, lui, se fait en DIRECT pendant le survol (onDragOver)
  // et pas seulement au relâchement — c'est ce qui fait "glisser" les
  // autres tuiles au fur et à mesure, comme les colonnes du Pipeline,
  // plutôt qu'un simple échange brutal à la fin.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => setActiveDragId(String(event.active.id));

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCellIds((cur) => {
      const slotIds = cur.map((id, i) => id || `empty-${i}`);
      const oldIndex = slotIds.indexOf(String(active.id));
      const newIndex = slotIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return cur;
      // Échange les deux cases (au lieu d'un décalage type arrayMove) : ça
      // préserve exactement les autres positions et les cases vides —
      // c'est ce qui permet de mettre une tuile en bas à gauche et une
      // autre tout à droite sans que tout le reste bouge.
      const next = [...cur];
      [next[oldIndex], next[newIndex]] = [next[newIndex], next[oldIndex]];
      return next;
    });
  };

  const handleDragEnd = () => {
    setActiveDragId(null);
  };

  // Dock façon accueil desktop (fond gris/transparent + icônes), demandé
  // explicitement pour remplacer le rectangle "Agenda du jour" + le
  // rectangle jaune "Priorités" sur mobile.
  // Signalé : demande de reprendre le style "tuile" colorée (dégradé) des
  // vraies tuiles de l'accueil au lieu de simples icônes plates dans des
  // cases grises — mêmes couleurs que les tuiles Rappels/Chat/Mail/Agenda
  // (AccueilGrid) pour rester cohérent entre ordinateur et mobile.
  const dockItems = [
    { id: 'rappels', label: 'Rappels', count: unreadRemindersCount, icon: Bell, nav: 'rappels', gradient: 'from-[#8B1E3F] via-[#63142A] to-[#3B0A18]' },
    { id: 'chat', label: 'Chat', count: unreadMessagesCount, icon: MessageSquare, nav: 'chat', gradient: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]' },
    { id: 'mail', label: 'Mail', count: unreadMailCount, icon: Mail, nav: 'mail-unread', gradient: 'from-[#1E3A8A] via-[#1E293B] to-[#0F172A]' },
    { id: 'agenda', label: 'Rendez-vous', count: todaysEvents || 0, icon: Calendar, nav: 'agenda', gradient: 'from-[#059669] via-[#047857] to-[#064E3B]' },
  ];

  // pt-4 simple : le safe-area-inset-top est déjà appliqué une fois par
  // <main> dans App.tsx — l'ajouter une deuxième fois ici cumulait les deux
  // et poussait tout le contenu (jusqu'au bouton "Créer un lead") largement
  // hors de l'écran sur les appareils à encoche / îlot dynamique.
  return (
    <div className="min-h-full p-4 sm:p-6 pb-4 pt-4 flex flex-col gap-4">
      {/* En-tête */}
      <div className="flex items-center justify-between pt-1">
        <div className="min-w-0">
          <p className="text-[11px] font-black tracking-[0.25em] text-[#F7BC5F] uppercase">Nova CRM</p>
          <h1 className="text-2xl font-extrabold text-white truncate">
            {greeting} <span className="text-[#F7BC5F]">{firstName}</span>
          </h1>
          <p className="text-sm text-slate-400 capitalize">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Loupe retirée (demande explicite) ; clochette agrandie à la
              même taille que la photo de profil (48px) juste à côté. */}
          {onOpenNotifications && (
            <button
              onClick={onOpenNotifications}
              title="Notifications"
              className="relative w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-[#050d0f]" />
              )}
            </button>
          )}
          <button
            onClick={() => onNavigate('parametres')}
            className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-white/20 shrink-0 bg-black/30"
            title="Mon profil"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white font-bold">{initials}</div>
            )}
            <img
              src={agencyLogo}
              alt=""
              className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border border-[#071015] bg-[#071015] object-contain"
            />
          </button>
        </div>
      </div>

      {/* Dock façon accueil desktop : même cadre qu'avant (fond gris/
          transparent). Signalé : les tuiles réelles de "Mes espaces"
          juste en dessous sont plates (pas de relief 3D/reflet verre) —
          les 4 cases reprennent maintenant EXACTEMENT ce style-là (mêmes
          classes que SpaceTile plus bas dans ce fichier : carré dégradé
          simple, ombre douce, badge rond dans le coin), pas celui, plus
          travaillé, des tuiles de l'accueil ordinateur. */}
      <div className="rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 px-3 py-3">
        <div className="grid grid-cols-4 gap-2">
          {dockItems.map((item) => (
            <motion.button
              key={item.id}
              onClick={() => onNavigate(item.nav)}
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center gap-1.5"
            >
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center relative shadow-md`}>
                <item.icon className="w-5 h-5 text-white" />
                {item.count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center ring-2 ring-[#0b1c1e]">
                    {item.count > 9 ? '9+' : item.count}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold text-slate-200 text-center truncate w-full">{item.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Mes espaces */}
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          {editMode && (
            <div className="flex items-center gap-2">
              {/* Ticket #48 (suivi #43) : la tuile "Ajouter" en bas de la
                  grille était coincée parmi les tuiles glissables — un
                  swipe pour scroller jusqu'à elle démarre souvent sur une
                  tuile en cours d'édition et se fait happer par le capteur
                  tactile du drag-and-drop, empêchant d'atteindre le bas.
                  On duplique donc l'action ici, à côté de "Terminé",
                  toujours visible sans avoir à scroller ni traverser la
                  grille. */}
              <button
                onClick={() => setShowAddSheet(true)}
                className="w-7 h-7 rounded-full bg-[#F7BC5F]/10 text-[#F7BC5F] flex items-center justify-center hover:bg-[#F7BC5F]/20"
                title="Ajouter un espace"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditMode(false)}
                className="text-xs font-black text-[#F7BC5F] px-3 py-1 rounded-full bg-[#F7BC5F]/10"
              >
                Terminé
              </button>
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-[#0b1c1e] border border-[#143c3f]/80 overflow-hidden">
          {visibleSpaces.length === 0 && !editMode ? (
            // Filet de sécurité : si tous les espaces ont été masqués, il n'y
            // a plus aucune tuile sur laquelle faire un appui long pour
            // revenir en édition — ce bouton reste toujours accessible.
            <button
              onClick={() => { setEditMode(true); setShowAddSheet(true); }}
              className="w-full flex flex-col items-center gap-2 py-8 text-slate-400 hover:text-white transition-colors"
            >
              <Plus className="w-6 h-6" />
              <span className="text-sm font-semibold">Ajouter un espace</span>
            </button>
          ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            autoScroll={false}
          >
            <SortableContext items={cellSlotIds} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 divide-x divide-y divide-[#143c3f]/60">
                {(() => {
                  // Grille à positions libres : on affiche toutes les cases
                  // jusqu'à la dernière occupée (arrondi à la ligne
                  // complète), +1 ligne vide en mode édition pour avoir de
                  // la place où glisser une tuile — jamais moins de 2
                  // lignes (6 cases) pour garder une grille stable.
                  const lastFilled = cellIds.reduce((last, id, i) => (id ? i : last), -1);
                  const filledCount = lastFilled + 1;
                  const rowsNeeded = Math.ceil(filledCount / 3) + (editMode ? 1 : 0);
                  const slotCount = Math.min(GRID_SLOTS, Math.max(6, rowsNeeded * 3));

                  // Repliée (hors édition) : 5 premiers raccourcis réels +
                  // une tuile flèche pour déplier le reste, au lieu de tout
                  // étaler sur plusieurs pages sans jamais revoir le bouton
                  // "Ajouter".
                  const collapsed = !editMode && !showAllSpaces && filledCount > 6;
                  const visibleCount = collapsed ? 5 : slotCount;

                  const tiles = cellIds.slice(0, visibleCount).map((id, i) => {
                    const space = id ? ALL_SPACES.find((s) => s.id === id) : undefined;
                    if (space) {
                      return (
                        <SpaceTile
                          key={space.id}
                          space={space}
                          index={i}
                          editMode={editMode}
                          onActivate={() => {
                            if (editMode) return;
                            // Ticket #255 : la tuile "Annonce" ouvre directement
                            // Paramètres → Annonces (même mécanisme que sur desktop).
                            if (space.id === 'annonce') {
                              try { sessionStorage.setItem('novaOpenParametresSection', 'announcements'); } catch { /* stockage indisponible, tant pis */ }
                            }
                            onNavigate(space.nav);
                          }}
                          onStartPress={startLongPress}
                          onCancelPress={cancelLongPress}
                          onHide={() => hideSpace(space.id)}
                        />
                      );
                    }
                    return <EmptyGridCell key={cellSlotIds[i]} slotId={cellSlotIds[i]} editMode={editMode} />;
                  });

                  if (collapsed) {
                    tiles.push(
                      <button
                        key="deploy-more"
                        type="button"
                        onClick={() => setShowAllSpaces(true)}
                        className={`${SPACE_TILE_CLASS} text-[#F9C977] hover:text-white`}
                      >
                        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                          <ChevronDown className="w-6 h-6" />
                        </div>
                        <span className="text-xs font-semibold">+{filledCount - 5}</span>
                      </button>
                    );
                  }

                  return tiles;
                })()}
                {showAllSpaces && !editMode && (
                  <button
                    type="button"
                    onClick={() => setShowAllSpaces(false)}
                    className={`${SPACE_TILE_CLASS} text-slate-400 hover:text-white`}
                  >
                    <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <ChevronUp className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold">Réduire</span>
                  </button>
                )}
                {editMode && (
                  <button
                    onClick={() => setShowAddSheet(true)}
                    // Demande explicite : toujours tout à droite, en bas —
                    // `col-start-3` (grille à 3 colonnes) force la 3ᵉ
                    // colonne quelle que soit la position naturelle dans le
                    // flux, ce qui la pousse aussi automatiquement sur la
                    // ligne suivante (donc tout en bas) si la ligne en
                    // cours n'a pas encore atteint cette colonne.
                    className={`${SPACE_TILE_CLASS} text-slate-400 hover:text-white col-start-3`}
                  >
                    <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-white/20 flex items-center justify-center">
                      <Plus className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold">Ajouter</span>
                  </button>
                )}
              </div>
            </SortableContext>
          </DndContext>
          )}
        </div>
        {editMode && (
          <p className="text-[11px] text-slate-500 text-center px-4">
            Glissez une tuile pour la déplacer, ou touchez le − pour la masquer.
          </p>
        )}
        {/* Ticket #48 : en édition, la tuile "Ajouter" tout en bas de la
            grille doit toujours rester atteignable par un simple scroll —
            une marge généreuse ici garantit qu'elle ne finit jamais collée
            (ou masquée) contre la barre de navigation fixe du bas. */}
        {editMode && <div className="h-24" aria-hidden="true" />}
      </div>

      {/* Réserve la place du bouton "Créer un lead", désormais fixé tout en
          bas de l'écran (voir plus bas) — sinon le contenu défilant passerait
          en dessous. Signalé : une fois les tuiles dépliées, la tuile
          "Réduire" tout en bas de la grille se retrouvait cachée derrière le
          bouton "Créer un lead" — cette réserve (4.75rem) était plus courte
          que l'empreinte réelle du bouton (décalé de 6.5rem + sa propre
          hauteur), donc la fin du contenu défilant passait quand même
          dessous. Portée à la même hauteur que cette empreinte. */}
      <div className="h-[10.5rem]" aria-hidden="true" />

      {/* Sélecteur d'espace à ré-ajouter — tiroir qui part du bas et remonte
          jusqu'au centre de l'écran (au lieu de rester collé en bas, où les
          icônes du bas pouvaient se retrouver masquées par la barre système
          du téléphone). */}
      {/* Créer un lead — fixé tout en bas de l'écran, juste au-dessus de la
          barre de navigation (même style "panneau gris" que le dock du
          haut, écriture jaune, comme demandé). */}
      <button
        onClick={onOpenNouveauLead}
        className="fixed left-4 right-4 z-30 px-5 py-4 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 text-[#F7BC5F] font-black flex items-center justify-between gap-3 active:scale-[0.98] transition-all"
        style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <span className="flex items-center gap-2.5">
          <UserPlus2 className="w-5 h-5" />
          Créer un lead
        </span>
        <ChevronRight className="w-5 h-5" />
      </button>

      {showAddSheet && (
        <div
          className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 safe-area-top safe-area-bottom"
          onClick={() => setShowAddSheet(false)}
        >
          <div
            className="w-full max-w-md bg-[#0a1e20] border border-[#144447]/60 rounded-3xl p-6 max-h-[75vh] flex flex-col animate-drawer-up-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-white font-bold text-lg">Ajouter un espace</h3>
              <button onClick={() => setShowAddSheet(false)} className="p-2 rounded-xl bg-white/5 text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto -mx-1 px-1">
              {hiddenSpaces.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Tous les espaces sont déjà affichés.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 pb-1">
                  {hiddenSpaces.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => addSpace(s.id)}
                      className="flex flex-col items-center gap-2 py-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center`}>
                        <s.icon className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-200 text-center">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface SpaceTileProps {
  space: SpaceDef;
  index: number;
  editMode: boolean;
  onActivate: () => void;
  onStartPress: () => void;
  onCancelPress: () => void;
  onHide: () => void;
}

// Case vide de la grille libre : ne fait rien au clic et ne se saisit pas
// (pas de `listeners`/`attributes`), mais reste une cible valide pour
// qu'une tuile glissée dessus vienne s'y placer.
const EmptyGridCell: React.FC<{ slotId: string; editMode: boolean }> = ({ slotId, editMode }) => {
  const { setNodeRef } = useSortable({ id: slotId });
  return (
    <div ref={setNodeRef} className={SPACE_TILE_CLASS}>
      {editMode && <div className="w-16 h-16 rounded-2xl border border-dashed border-white/10" />}
    </div>
  );
};

const SpaceTile: React.FC<SpaceTileProps> = ({ space, index, editMode, onActivate, onStartPress, onCancelPress, onHide }) => {
  // `transition` de dnd-kit anime déjà le déplacement de CHAQUE tuile vers
  // sa nouvelle position dès que `visibleIds` change (réordonné en direct
  // dans onDragOver) — c'est ce qui produit l'effet "glisse pour laisser la
  // place" façon colonnes de Pipeline, sans rien coder de plus ici.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: space.id });
  const Icon = space.icon;

  return (
    <div
      ref={setNodeRef}
      {...(editMode ? attributes : {})}
      {...(editMode ? listeners : {})}
      onPointerDown={onStartPress}
      onPointerUp={onCancelPress}
      onPointerLeave={onCancelPress}
      onClick={onActivate}
      style={{
        transform: isDragging
          ? `${CSS.Transform.toString(transform)} scale(1.12)`
          : CSS.Transform.toString(transform),
        transition,
        animationDelay: `${(index % 5) * 40}ms`,
      }}
      className={`${SPACE_TILE_CLASS} cursor-pointer active:scale-95 rounded-2xl ${
        editMode && !isDragging ? 'animate-jiggle' : ''
      } ${
        isDragging
          ? 'opacity-95 z-30 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.7)] ring-2 ring-[#F7BC5F] bg-[#0f2a2d]'
          : 'transition-transform'
      }`}
    >
      {editMode && !isDragging && (
        <button
          onClick={(e) => { e.stopPropagation(); onHide(); }}
          className="absolute top-1 left-1 w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center text-sm font-black shadow-md z-10"
          title="Masquer"
        >
          −
        </button>
      )}
      <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${space.gradient} flex items-center justify-center relative shadow-md`}>
        <Icon className="w-7 h-7 text-white" />
        {!!space.badge && space.badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center ring-2 ring-[#0b1c1e]">
            {space.badge > 9 ? '9+' : space.badge}
          </span>
        )}
      </div>
      <span className="text-xs font-semibold text-slate-200 text-center px-1">{space.label}</span>
    </div>
  );
};

export default MobileHome;
