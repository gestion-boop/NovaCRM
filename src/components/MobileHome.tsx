import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  DndContext, DragOverEvent, DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudSun,
  Bell, MessageSquare, Users, GitFork, FileText, Mail, BarChart2,
  Headphones, Calendar, FileEdit, UserPlus, Folder, Plus, X,
  ChevronDown, ChevronUp, ChevronRight, Megaphone, Camera, Lock, Zap, Home as HomeIcon, Globe,
  ExternalLink, Bookmark, Target, Shield, Award, Sparkles, CheckSquare, Image as ImageIcon, MapPin, Settings, Mic,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { estDossierReserveConseilsFinances, estAgenceConseilsFinances } from '@/lib/dossiersConseilsFinances';
import { estAgenceImmosphera, estBlocNotes, estDossierImmosphera } from '@/lib/tuilesAccueilVisibles';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { getCachedAccessToken, requestWorkspaceAccessToken, fetchGoogleCalendarEvents } from '@/lib/workspace';
import { prochainRendezVous, texteProchainGeste, type RendezVousProchain } from '@/lib/prochainGeste';
import { lireDispositionAgence, lireHorodatageLocal } from '@/lib/dispositionAccueil';
import {
  choisirVersion,
  cleArrangementTelephone,
  cleCasesBureau,
  cleCasesBureauAnonyme,
  cleTuilesBureau,
  cleTuilesBureauAnonyme,
  deplacerSurTelephone,
  etendreGrilleEdition,
  lireArrangement,
  lireCases,
  lireCasesValeur,
  lireTuiles,
  lireTuilesValeur,
  masquerSurTelephone,
  ordonnerCommeLeBureau,
  presenterTelephone,
  reafficherSurTelephone,
  teteEcranTelephone,
  tuilesPourTelephone,
  type ArrangementTelephone,
  type TuilePartagee,
  type VisibiliteTuiles,
} from '@/lib/tuilesPartagees';
import { lireMasquees } from '@/lib/tuilesMasquees';
import { supabase } from '@/lib/supabase';
import { useSwipeBack } from '@/hooks/useSwipeBack';

// Même table de correspondance nom → icône que AccueilGrid.tsx (ICON_MAP) —
// nécessaire pour rendre correctement une tuile verrouillée par le super
// admin, dont l'icône est choisie sur desktop et stockée par son nom
// (`iconName`, une chaîne), jamais vue jusqu'ici côté mobile.
const LOCKED_ICON_MAP: Record<string, React.ElementType> = {
  Bell, MessageSquare, Calendar, Mail, Users, Headphones,
  GitFork, FileText, FileEdit, UserPlus, BarChart2, Zap,
  HomeIcon, Camera, Settings, Folder, Globe, ExternalLink,
  Bookmark, Target, Shield, Award, Sparkles, CheckSquare, ImageIcon, MapPin, Megaphone,
};

interface MobileHomeProps {
  onNavigate: (nav: string) => void;
  unreadRemindersCount: number;
  unreadMessagesCount: number;
  unreadMailCount: number;
  // La clochette de notifications, remontée ici depuis l'ancienne barre de
  // navigation du bas (simplifiée à Accueil/Nova/Menu) — demande explicite.
  unreadNotificationsCount?: number;
  onOpenNotifications?: () => void;
  // Le « + » crée un lead. Il vit dans l'en-tête, plus dans la barre du bas.
  onOpenNouveauLead?: () => void;
  onOpenClientDictation?: () => void;
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
  // Raccourci imposé par un verrou super admin (agency_ui_settings
  // .home_layout.lockedTiles, même mécanisme que AccueilGrid côté desktop) :
  // ne peut pas être retiré de la grille par un utilisateur normal.
  locked?: boolean;
  // Tuile pointant vers un lien externe (site, extranet...) plutôt qu'un
  // écran de l'appli — même champ que TileItemNode.externalUrl côté desktop.
  externalUrl?: string;
  // Dossier verrouillé (façon dossier iPhone) : s'ouvre en plein écran sur
  // ses cartes au lieu de naviguer directement — voir lockedMobileSpaces.
  isFolder?: boolean;
  children?: SpaceDef[];
}

function versEspacePartage(tuile: TuilePartagee): SpaceDef | null {
  const enfants = (tuile.children || [])
    .map(versEspacePartage)
    .filter((espace): espace is SpaceDef => !!espace);
  const dossier = !!(tuile.isFolder || enfants.length > 0);
  if (!dossier && !tuile.navTarget && !tuile.externalUrl) return null;
  return {
    id: tuile.id,
    label: tuile.title || tuile.id,
    icon: (tuile.iconName && LOCKED_ICON_MAP[tuile.iconName]) || Folder,
    nav: tuile.navTarget || '',
    externalUrl: tuile.externalUrl || undefined,
    gradient: tuile.gradient || 'from-[#334155] to-[#1e293b]',
    locked: !!tuile.locked,
    isFolder: dossier || undefined,
    children: dossier ? enfants : undefined,
  };
}

// Forme minimale d'un verrou tel qu'enregistré par AccueilGrid.tsx (type
// `Verrou` là-bas) — on ne relit ici que ce dont mobile a besoin.
interface VerrouMobile {
  id?: string;
  title?: string;
  iconName?: string;
  gradient?: string;
  navTarget?: string;
  // Non fiable en pratique : AccueilGrid n'enregistre PAS ce champ sur les
  // verrous existants (vérifié en base le 8 septembre — tous à `null` alors
  // que `children` est bien rempli). On détecte donc un dossier verrouillé à
  // la présence de `children`, jamais à `isFolder` seul.
  isFolder?: boolean;
  children?: VerrouMobile[];
  externalUrl?: string;
}

// « mail » retiré d'ici le 5 septembre (voir plus bas, ALL_SPACES) : la
// tuile Mails du dock du haut suffit, plus besoin de la doubler ici.
const DEFAULT_VISIBLE = ['clients', 'pipeline', 'documents', 'tableau-de-bord', 'support'];
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
  'relative flex flex-col items-center justify-start gap-2 pt-2.5 pb-2 select-none';
const SPACE_LABEL_CLASS =
  'text-xs font-bold text-center leading-tight line-clamp-2 min-h-[2rem] w-full px-1';

export const MobileHome: React.FC<MobileHomeProps> = ({
  onNavigate,
  unreadRemindersCount,
  unreadMessagesCount,
  unreadMailCount,
  unreadNotificationsCount = 0,
  onOpenNotifications,
  onOpenNouveauLead,
  onOpenClientDictation,
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
  const [prochainRdv, setProchainRdv] = useState<RendezVousProchain | null>(null);
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
        if (!cancelled) {
          setTodaysEvents(count);
          setProchainRdv(prochainRendezVous(events, new Date()));
        }
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

  // ── Dossiers/tuiles verrouillés par le super admin (port du mécanisme
  // desktop d'AccueilGrid.tsx sur "Mes espaces" mobile) ───────────────────
  // Demandé le 8 septembre : « les dossiers verrouillés avec les raccourcis
  // sur le téléphone portable ». Même lecture Supabase qu'AccueilGrid
  // (agency_ui_settings.home_layout.lockedTiles), avec synchro en direct.
  // Nom de canal Realtime UNIQUE par instance (crypto.randomUUID) — leçon du
  // crash de production de useCameraReservations.ts cette même session :
  // réutiliser un nom fixe entre plusieurs instances montées casse
  // `.subscribe()`.
  const [lockedTiles, setLockedTiles] = useState<Record<string, VerrouMobile>>({});
  useEffect(() => {
    if (!activeAgency?.id) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('agency_ui_settings')
        .select('home_layout')
        .eq('agency_id', activeAgency.id)
        .maybeSingle();
      if (!active) return;
      if (error) { console.warn('Erreur chargement tuiles verrouillées (mobile) :', error); return; }
      const locked = (data?.home_layout as any)?.lockedTiles;
      if (locked && typeof locked === 'object') setLockedTiles(locked);
    })();
    const channelName = `agency_ui_settings_home_layout_mobile_${activeAgency.id}_${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agency_ui_settings', filter: `agency_id=eq.${activeAgency.id}` },
        (payload) => {
          const locked = (payload.new as any)?.home_layout?.lockedTiles;
          setLockedTiles(locked && typeof locked === 'object' ? locked : {});
        }
      )
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [activeAgency?.id]);

  // Grille de l'ordinateur, lue seulement. Le téléphone ne l'enregistre pas.
  const [grilleBureau, setGrilleBureau] = useState<TuilePartagee[] | null>(null);
  const [casesBureau, setCasesBureau] = useState<(string | null)[] | null>(null);
  const [idsMasques, setIdsMasques] = useState<Set<string>>(() => new Set(lireMasquees().map((tuile) => tuile.id)));
  useEffect(() => {
    const uid = currentUser?.uid;
    const agencyId = activeAgency?.id;
    let actif = true;
    const cleTuiles = cleTuilesBureau(uid, agencyId);
    const cleCases = cleCasesBureau(uid, agencyId);
    const locale = lireTuiles(localStorage.getItem(cleTuiles))
      || lireTuiles(localStorage.getItem(cleTuilesBureauAnonyme(agencyId)));
    const casesLocales = lireCases(localStorage.getItem(cleCases))
      || lireCases(localStorage.getItem(cleCasesBureauAnonyme(agencyId)));
    setGrilleBureau(locale);
    setCasesBureau(casesLocales);
    setIdsMasques(new Set(lireMasquees().map((tuile) => tuile.id)));
    if (!uid || !agencyId) return () => { actif = false; };
    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_ui_settings')
          .select('home_tiles, home_root_slots, hidden_tiles')
          .eq('user_id', uid)
          .maybeSingle();
        if (!actif || error || !data) return;
        const lectureTuiles = lireDispositionAgence((data as { home_tiles?: unknown }).home_tiles, agencyId);
        const lectureCases = lireDispositionAgence((data as { home_root_slots?: unknown }).home_root_slots, agencyId);
        const localeFraiche = lireTuiles(localStorage.getItem(cleTuiles))
          || lireTuiles(localStorage.getItem(cleTuilesBureauAnonyme(agencyId)));
        const casesFraiches = lireCases(localStorage.getItem(cleCases))
          || lireCases(localStorage.getItem(cleCasesBureauAnonyme(agencyId)));
        setGrilleBureau(choisirVersion(
          { items: localeFraiche, maj: lireHorodatageLocal(cleTuiles) },
          { items: lireTuilesValeur(lectureTuiles.items), maj: lectureTuiles.maj },
        ));
        setCasesBureau(choisirVersion(
          { items: casesFraiches, maj: lireHorodatageLocal(cleCases) },
          { items: lireCasesValeur(lectureCases.items), maj: lectureCases.maj },
        ));
        const serveur = (data as { hidden_tiles?: { id?: string }[] }).hidden_tiles;
        const ids = new Set(lireMasquees().map((tuile) => tuile.id));
        if (Array.isArray(serveur)) {
          for (const tuile of serveur) if (tuile?.id) ids.add(tuile.id);
        }
        setIdsMasques(ids);
      } catch {
        // Le navigateur reste la source si le compte ne répond pas.
      }
    })();
    const relire = () => {
      if (!actif) return;
      const prochaine = lireTuiles(localStorage.getItem(cleTuiles))
        || lireTuiles(localStorage.getItem(cleTuilesBureauAnonyme(agencyId)));
      const prochainesCases = lireCases(localStorage.getItem(cleCases))
        || lireCases(localStorage.getItem(cleCasesBureauAnonyme(agencyId)));
      if (prochaine) setGrilleBureau(prochaine);
      if (prochainesCases) setCasesBureau(prochainesCases);
    };
    window.addEventListener('novasphere:home-tiles-changed', relire);
    window.addEventListener('storage', relire);
    return () => {
      actif = false;
      window.removeEventListener('novasphere:home-tiles-changed', relire);
      window.removeEventListener('storage', relire);
    };
  }, [currentUser?.uid, activeAgency?.id]);

  // Convertit les verrous du super admin en raccourcis mobiles — VRAIS
  // dossiers (façon dossier iPhone), pas des tuiles éclatées à plat : « je
  // veux que ça soit la même chose comme les produits iPhone ». Un dossier
  // verrouillé devient UNE tuile-dossier sur la grille ; il s'ouvre en
  // plein écran sur ses cartes au toucher, exactement comme sur l'accueil
  // desktop. Résout l'icône via LOCKED_ICON_MAP (même logique que ICON_MAP
  // côté desktop), repli sur Folder si inconnue.
  const toSpaceDef = (v: VerrouMobile, fallbackId: string): SpaceDef | null => {
    const id = v.id || fallbackId;
    // Une tuile verrouillée pointe soit vers un écran de l'appli
    // (navTarget), soit vers un lien externe (externalUrl, ex. Giraffe360,
    // Netty...) — les deux comptent comme un raccourci exploitable côté
    // mobile ; seule une entrée totalement vide (ni l'un ni l'autre) est
    // ignorée.
    if (!id || (!v.navTarget && !v.externalUrl)) return null;
    return {
      id,
      label: v.title || id,
      icon: (v.iconName && LOCKED_ICON_MAP[v.iconName]) || Folder,
      nav: v.navTarget || '',
      externalUrl: v.externalUrl || undefined,
      gradient: v.gradient || 'from-[#334155] to-[#1e293b]',
      locked: true,
    };
  };
  const lockedMobileSpaces: SpaceDef[] = useMemo(() => {
    const out: SpaceDef[] = [];
    Object.entries(lockedTiles).forEach(([lockId, lock]) => {
      // Dossiers « Banques » / « Assurances » : Conseils Finances uniquement.
      if (estDossierReserveConseilsFinances(lock.title) && !estAgenceConseilsFinances(activeAgency)) return;
      // Dossier « Immosphera » recopié dans les autres sociétés.
      if (estDossierImmosphera(lock.title) && !estAgenceImmosphera(activeAgency)) return;
      // `isFolder` n'est en pratique jamais renseigné par AccueilGrid sur un
      // verrou (vérifié en base) : on détecte un dossier verrouillé à la
      // seule présence de `children`, pas à ce champ.
      if (Array.isArray(lock.children) && lock.children.length) {
        const children = lock.children
          .map((child, i) => toSpaceDef(child, `${lockId}-${i}`))
          .filter((s): s is SpaceDef => !!s);
        if (children.length === 0) return;
        out.push({
          id: lock.id || lockId,
          label: lock.title || lockId,
          icon: (lock.iconName && LOCKED_ICON_MAP[lock.iconName]) || Folder,
          nav: '',
          gradient: lock.gradient || 'from-[#334155] to-[#1e293b]',
          locked: true,
          isFolder: true,
          children,
        });
      } else {
        const space = toSpaceDef(lock, lockId);
        if (space) out.push(space);
      }
    });
    const notes = out.filter((s) => estBlocNotes({ id: s.id, title: s.label, navTarget: s.nav }));
    if (notes.length <= 1) return out;
    const score = (s: SpaceDef) =>
      (s.isFolder && (s.children?.length || 0) > 0 ? 100 + (s.children?.length || 0) : s.id === 'notes' ? 10 : 1)
      + (s.locked ? 50 : 0);
    const garde = [...notes].sort((a, b) => score(b) - score(a))[0];
    return out.filter((s) => !estBlocNotes({ id: s.id, title: s.label, navTarget: s.nav }) || s.id === garde.id);
  }, [lockedTiles, activeAgency]);
  const lockedSpaceIds = useMemo(() => new Set(lockedMobileSpaces.map((s) => s.id)), [lockedMobileSpaces]);
  const visibiliteBureau: VisibiliteTuiles = useMemo(() => ({
    immosphera: estAgenceImmosphera(activeAgency),
    novavisio: /novavisio/i.test(activeAgency?.name ?? '') || /novavisio/i.test((activeAgency as { slug?: string } | null)?.slug ?? ''),
    conseilsFinances: estAgenceConseilsFinances(activeAgency),
    banquesAssurances: estAgenceConseilsFinances(activeAgency),
    dossierImmosphera: estAgenceImmosphera(activeAgency),
    annonce: userProfile?.role === 'super_admin' || currentUser?.uid === '3c6797de-456a-4988-8358-7e3d813e9474',
    masquees: idsMasques,
  }), [activeAgency, userProfile?.role, currentUser?.uid, idsMasques]);
  const espacesPartages = useMemo(() => {
    if (!grilleBureau) return null;
    const prepares = ordonnerCommeLeBureau(tuilesPourTelephone(grilleBureau, visibiliteBureau), casesBureau);
    const convertis = prepares
      .map(versEspacePartage)
      .filter((espace): espace is SpaceDef => !!espace);
    const dejaLa = new Set(convertis.map((espace) => espace.id));
    if (!estAgenceConseilsFinances(activeAgency) && !dejaLa.has('reserver-camera')) {
      const cameraSpace: SpaceDef = {
        id: 'reserver-camera',
        label: 'Réserver caméra',
        icon: Camera,
        nav: 'reserver-camera',
        gradient: 'from-[#9333ea] to-[#581c87]',
      };
      convertis.push(cameraSpace);
      dejaLa.add('reserver-camera');
    }
    const notesVerrouille = lockedMobileSpaces.find((espace) =>
      estBlocNotes({ id: espace.id, title: espace.label, navTarget: espace.nav }));
    const remplaces = convertis
      .filter((espace) => !notesVerrouille || !estBlocNotes({ id: espace.id, title: espace.label, navTarget: espace.nav }) || espace.id === notesVerrouille.id)
      .map((espace) => lockedMobileSpaces.find((verrou) => verrou.id === espace.id) || espace);
    const manquants = lockedMobileSpaces.filter((verrou) => !dejaLa.has(verrou.id));
    return [...remplaces, ...manquants];
  }, [grilleBureau, casesBureau, visibiliteBureau, lockedMobileSpaces]);
  const grillePartagee = !!espacesPartages && espacesPartages.length > 0;
  // Ordre et tuiles masquées du téléphone uniquement. Jamais écrit dans la
  // grille de l'ordinateur : cette écriture relançait la synchro.
  const [arrangement, setArrangement] = useState<ArrangementTelephone | null>(null);
  useEffect(() => {
    setArrangement(lireArrangement(localStorage.getItem(cleArrangementTelephone(currentUser?.uid, activeAgency?.id))));
  }, [currentUser?.uid, activeAgency?.id]);

  useEffect(() => {
    if (!estAgenceConseilsFinances(activeAgency) && arrangement?.masquees?.includes('reserver-camera')) {
      const nextArrangement = {
        ...arrangement,
        masquees: arrangement.masquees.filter((id) => id !== 'reserver-camera'),
      };
      memoriserArrangement(nextArrangement);
    }
  }, [activeAgency, arrangement]);
  const memoriserArrangement = (next: ArrangementTelephone) => {
    setArrangement(next);
    try {
      localStorage.setItem(
        cleArrangementTelephone(currentUser?.uid, activeAgency?.id),
        JSON.stringify(next),
      );
    } catch {
      // Le geste reste visible le temps de la page.
    }
  };
  const estVerrouTelephone = (id: string) =>
    lockedSpaceIds.has(id) || !!espacesPartages?.some((espace) => espace.id === id && espace.locked);
  // Dossier verrouillé actuellement ouvert en plein écran (façon dossier
  // iPhone) — null quand aucun n'est ouvert.
  const [openLockedFolder, setOpenLockedFolder] = useState<SpaceDef | null>(null);
  // Swipe depuis le bord gauche pour refermer le dossier verrouillé plein
  // écran (voir useSwipeBack) — `enabled` doit changer en même temps que le
  // bloc <div fixed inset-0 ...> apparaît/disparaît pour que l'effet du hook
  // retrouve le bon nœud DOM.
  const swipeBackRef = useSwipeBack<HTMLDivElement>(() => setOpenLockedFolder(null), !!openLockedFolder);

  // ── Mes espaces : catalogue complet + config visible/ordre persistée ──
  const ALL_SPACES: SpaceDef[] = useMemo(() => [
    { id: 'clients', label: 'Clients', icon: Users, nav: 'clients', gradient: 'from-[#a8421e] to-[#451a03]' },
    { id: 'pipeline', label: 'Pipeline', icon: GitFork, nav: 'pipeline', gradient: 'from-[#6b21a8] to-[#3b0764]' },
    { id: 'documents', label: 'Documents', icon: FileText, nav: 'documents', gradient: 'from-[#b45309] to-[#78350f]' },
    // Ticket #32 (nouvelle base) : la tuile Mail ouvrait toujours la boîte
    // de réception complète, jamais "Non lus" (contrairement à la tuile
    // équivalente sur desktop) — même cible que AccueilGrid.
    { id: 'tableau-de-bord', label: 'Tableau de bord', icon: BarChart2, nav: 'tableau-de-bord', gradient: 'from-[#0d9488] to-[#065f46]' },
    { id: 'support', label: 'Support', icon: Headphones, nav: 'support', gradient: 'from-[#4338ca] to-[#312e81]' },
    { id: 'agenda', label: 'Agenda', icon: Calendar, nav: 'agenda', gradient: 'from-[#0f766e] to-[#134e4a]' },
    // Le dossier « Blocs - Notes » verrouillé remplace le raccourci, sinon
    // les deux s'affichent côte à côte.
    ...(lockedMobileSpaces.some((s) => estBlocNotes({ id: s.id, title: s.label, navTarget: s.nav }))
      ? []
      : [{ id: 'notes', label: 'Notes', icon: FileEdit, nav: 'notes', gradient: 'from-[#7c3aed] to-[#4c1d95]' }]),
    { id: 'equipe', label: 'Équipe', icon: UserPlus, nav: 'equipe', gradient: 'from-[#334155] to-[#1e293b]' },
    { id: 'projets-internes', label: 'Projets internes', icon: Folder, nav: 'projets-internes', gradient: 'from-[#92400e] to-[#451a03]' },
    { id: 'chat', label: 'Chat', icon: MessageSquare, nav: 'chat', gradient: 'from-[#0891b2] to-[#155e75]', badge: unreadMessagesCount },
    { id: 'rappels', label: 'Rappels', icon: Bell, nav: 'rappels', gradient: 'from-[#9f1239] to-[#4c0519]', badge: unreadRemindersCount },
    // Signalé (8 septembre) : absente du catalogue mobile — sur téléphone,
    // impossible d'ajouter cette tuile à "Mes espaces" faute d'exister ici,
    // alors qu'elle est disponible depuis toujours sur AccueilGrid (desktop).
    // Masquée pour Conseils Finances, visible sur Immosphera et Novavisio.
    ...(!estAgenceConseilsFinances(activeAgency)
      ? [{ id: 'reserver-camera', label: 'Réserver caméra', icon: Camera, nav: 'reserver-camera', gradient: 'from-[#9333ea] to-[#581c87]' }]
      : []),
    // Ticket #255 : accès rapide à la création d'annonce, réservé aux
    // administrateurs (même règle que ParametresView.tsx : role === 'super_admin').
    ...(userProfile?.role === 'super_admin'
      ? [{ id: 'annonce', label: 'Annonce', icon: Megaphone, nav: 'parametres', gradient: 'from-[#F7BC5F] to-[#78350F]' }]
      : []),
    // Raccourcis imposés par un verrou super admin (voir lockedMobileSpaces
    // ci-dessus) — fusionnés ici pour profiter tel quel du mécanisme
    // `fillMissing` existant, qui les place automatiquement dans une case
    // vide chez tout le monde sans déplacer les tuiles déjà en place.
    ...lockedMobileSpaces,
  ], [unreadMessagesCount, unreadRemindersCount, userProfile?.role, lockedMobileSpaces, activeAgency]);

  // Grille à positions libres (façon écran d'accueil iPhone) : chaque case
  // contient soit un id de tuile, soit `null` (case vide) — contrairement à
  // une simple liste réordonnée, une case vide reste vide (ex: une tuile en
  // bas à gauche, une autre tout à droite, avec du vide entre les deux) au
  // lieu d'être toujours comblée automatiquement.
  // Ticket #43 : plafond relevé (15 → 24) pour ne jamais bloquer l'ajout de
  // nouveaux raccourcis une fois le catalogue presque entièrement affiché.
  const GRID_SLOTS = 24;
  const CELL_STORAGE_KEY = 'novasphere_mobile_spaces_grid_v1';

  const ALL_SPACE_IDS = useMemo(() => ALL_SPACES.map((s) => s.id), [ALL_SPACES]);

  const [cellIds, setCellIds] = useState<(string | null)[]>(() => {
    // Ajoute après les tuiles existantes les tuiles du catalogue qui manqueraient
    // encore à une grille déjà enregistrée — sans toucher à l'ordre/l'emplacement des tuiles
    // déjà placées par l'utilisateur ni écraser ses espaces vides.
    const fillMissing = (grid: (string | null)[]) => {
      const present = new Set(grid.filter(Boolean));
      const missing = ALL_SPACE_IDS.filter((id) => !present.has(id));
      const lastPlaced = grid.reduce((last, id, idx) => (id ? idx : last), -1);
      let i = Math.max(0, lastPlaced + 1);
      for (const id of missing) {
        while (i < grid.length && grid[i] !== null) i++;
        if (i >= grid.length) break;
        grid[i] = id;
        i++;
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

  // Bug trouvé (8 septembre) : les dossiers verrouillés n'apparaissaient
  // jamais sur mobile malgré l'ajout à ALL_SPACES — `fillMissing` (ci-dessus)
  // ne s'exécute qu'UNE fois, à l'initialisation de `cellIds`, avant que le
  // chargement Supabase de `lockedTiles` (async) n'ait eu le temps de
  // résoudre. Une grille déjà enregistrée (cas de tout le monde ici) ne
  // revoit donc plus jamais passer les verrous chargés après coup. On rejoue
  // le même comblement des cases vides à chaque fois que la liste des
  // raccourcis verrouillés change.
  //
  // Bug trouvé le 8 septembre (suite) : « je n'ai pas le dossier Immosphera,
  // banques, assurances » — les comptes concernés avaient déjà, dans leur
  // grille enregistrée, les CARTES individuelles de ces dossiers ajoutées
  // par la toute première version buguée de cette fonctionnalité (celle qui
  // aplatissait au lieu de créer un vrai dossier — ids comme
  // "immosphera-partenaires", "immosphera-netty"...). Ces ids ne
  // correspondent plus à rien dans ALL_SPACES (le dossier remplaçant, lui,
  // porte l'id du VERROU, pas de ses enfants) : ils restaient comptés comme
  // « case occupée » sans jamais s'afficher, ce qui privait la nouvelle
  // tuile-dossier de toute case libre où se placer. On purge donc aussi les
  // ids devenus orphelins (absents d'ALL_SPACES) avant de combler.
  useEffect(() => {
    setCellIds((cur) => {
      const validIds = new Set(ALL_SPACE_IDS);
      const cleaned = cur.map((id) => (id && !validIds.has(id) ? null : id));
      const present = new Set(cleaned.filter(Boolean));
      const missing = lockedMobileSpaces.map((s) => s.id).filter((id) => !present.has(id));
      const changed = missing.length > 0 || cleaned.some((id, i) => id !== cur[i]);
      if (!changed) return cur;
      const next = [...cleaned];
      const lastPlaced = next.reduce((last, id, idx) => (id ? idx : last), -1);
      let i = Math.max(0, lastPlaced + 1);
      for (const id of missing) {
        while (i < next.length && next[i] !== null) i++;
        if (i >= next.length) { next.push(id); i = next.length; continue; }
        next[i] = id;
        i++;
      }
      return next;
    });
  }, [lockedMobileSpaces, ALL_SPACE_IDS]);

  const visibleIds = cellIds.filter((id): id is string => !!id);
  const visibleSpaces = visibleIds
    .map((id) => ALL_SPACES.find((s) => s.id === id))
    .filter(Boolean) as SpaceDef[];
  const hiddenSpaces = ALL_SPACES.filter((s) => !visibleIds.includes(s.id));
  const espacesAjoutables = grillePartagee && espacesPartages
    ? espacesPartages.filter((espace) => {
        const visibles = new Set(
          presenterTelephone(espacesPartages.map((item) => item.id), arrangement, estVerrouTelephone)
            .filter((id): id is string => !!id),
        );
        return !visibles.has(espace.id) && !estVerrouTelephone(espace.id);
      })
    : hiddenSpaces;

  const [editMode, setEditMode] = useState(false);
  // Ids "slots" utilisés par le contexte triable de dnd-kit : un id réel
  // pour une case occupée, un id synthétique stable pour une case vide.
  const cellulesAffichees = grillePartagee && espacesPartages
    ? etendreGrilleEdition(
        presenterTelephone(espacesPartages.map((espace) => espace.id), arrangement, estVerrouTelephone),
        editMode,
      )
    : cellIds;
  const espaceAffiche = (id: string) =>
    espacesPartages?.find((espace) => espace.id === id) || ALL_SPACES.find((espace) => espace.id === id);
  const cellSlotIds = cellulesAffichees.map((id, i) => id || `empty-${i}`);

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
  // Une tuile imposée par un verrou super admin ne peut pas être retirée par
  // un utilisateur normal — même règle que sur AccueilGrid (desktop).
  const hideSpace = (id: string) => {
    if (estVerrouTelephone(id)) return;
    if (grillePartagee && espacesPartages) {
      memoriserArrangement(masquerSurTelephone(
        espacesPartages.map((espace) => espace.id),
        arrangement,
        id,
        estVerrouTelephone,
      ));
      return;
    }
    setCellIds((cur) => cur.map((x) => (x === id ? null : x)));
  };
  const addSpace = (id: string) => {
    if (grillePartagee && espacesPartages) {
      memoriserArrangement(reafficherSurTelephone(
        espacesPartages.map((espace) => espace.id),
        arrangement,
        id,
      ));
      setShowAddSheet(false);
      return;
    }
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
    if (grillePartagee && espacesPartages) {
      if (!over || active.id === over.id) return;
      const source = espacesPartages.map((espace) => espace.id);
      const cle = cleArrangementTelephone(currentUser?.uid, activeAgency?.id);
      setArrangement((courant) => {
        const next = deplacerSurTelephone(source, courant, String(active.id), String(over.id), estVerrouTelephone);
        try { localStorage.setItem(cle, JSON.stringify(next)); } catch { /* geste visible le temps de la page */ }
        return next;
      });
      return;
    }
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
    // Signalé (5 septembre) : « Messagerie » et « Mail » étaient deux tuiles
    // distinctes (celle-ci, et une seconde dans ALL_SPACES ci-dessus) menant
    // pourtant au même endroit — renommées « Mails » les deux, puis, sur
    // remarque suivante (« comme les deux tuiles font la même chose, il ne
    // doit en rester qu'une seule »), la seconde a été retirée d'ALL_SPACES.
    // Celle-ci, toujours visible en haut de l'accueil mobile, est désormais
    // le seul accès à la messagerie depuis cet écran.
    { id: 'mail', label: 'Mails', count: unreadMailCount, icon: Mail, nav: 'mail-unread', gradient: 'from-[#1E3A8A] via-[#1E293B] to-[#0F172A]' },
    { id: 'agenda', label: 'Agenda', count: todaysEvents || 0, icon: Calendar, nav: 'agenda', gradient: 'from-[#059669] via-[#047857] to-[#064E3B]' },
  ];
  const gesteDuMoment = texteProchainGeste({
    maintenant: now,
    rendezVous: prochainRdv,
    messagesNonLus: unreadMessagesCount || 0,
    mailsNonLus: unreadMailCount || 0,
    rappelsDuJour: unreadRemindersCount || 0,
  });

  // pt-4 simple : le safe-area-inset-top est déjà appliqué une fois par
  // <main> dans App.tsx. La place de la barre du bas est aussi réservée
  // là-bas ; ici un petit pb-6 suffit maintenant que le bouton flottant
  // « Créer un lead » a rejoint le « + » de cette barre.
  return (
    <div className="min-h-full p-4 sm:p-6 pb-6 pt-4 flex flex-col gap-4">
      {/* En-tête */}
      <div className="flex items-center justify-between pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <img src={agencyLogo} alt={activeAgency?.name || 'Nova CRM'} className="w-4 h-4 rounded-full object-contain shrink-0" />
            <p className="text-[11px] font-black tracking-[0.22em] text-[#F7BC5F] uppercase truncate">
              {visibiliteBureau.novavisio
                ? 'NovaVisio'
                : visibiliteBureau.immosphera
                  ? 'ImmoSphera'
                  : visibiliteBureau.conseilsFinances
                    ? 'Conseils Finances'
                    : activeAgency?.name || 'Nova CRM'}
            </p>
          </div>
          <h1 className="text-2xl font-extrabold text-white truncate">
            {greeting} <span className="text-[#F7BC5F]">{firstName}</span>
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-slate-400 capitalize whitespace-nowrap">{dateLabel}</p>
            {weather && (
              <span
                title={weatherMeta(weather.code).label}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-teal-200 font-semibold shadow-xs whitespace-nowrap shrink-0"
              >
                <WeatherIcon className="w-3 h-3 text-[#F7BC5F]" />
                <span>{weather.temp}°C</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onOpenClientDictation && (
            <button
              type="button"
              onClick={onOpenClientDictation}
              title="Dicter une note vocale dans une fiche client"
              aria-label="Dicter dans une fiche client"
              className="w-11 h-11 rounded-full bg-[#081e22]/90 border border-[#F7BC5F]/40 text-[#FAD592] hover:bg-[#F7BC5F]/15 flex items-center justify-center shadow-xs active:scale-95 transition-all cursor-pointer"
            >
              <Mic className="w-5 h-5 text-[#F7BC5F]" />
            </button>
          )}
          {onOpenNouveauLead && (
            <button
              type="button"
              onClick={onOpenNouveauLead}
              title="Créer un lead"
              aria-label="Créer un lead"
              className="w-11 h-11 rounded-full bg-gradient-to-br from-[#F7BC5F] to-[#E5A642] text-slate-950 flex items-center justify-center shadow-[0_0_15px_rgba(247,188,95,0.35)] active:scale-95 transition-all cursor-pointer"
            >
              <Plus className="w-5 h-5 stroke-[3]" />
            </button>
          )}
          {/* Loupe retirée (demande explicite) ; clochette agrandie à la
              même taille que la photo de profil (48px) juste à côté. */}
          {onOpenNotifications && (
            <button
              onClick={onOpenNotifications}
              title="Notifications"
              className="relative w-11 h-11 rounded-full bg-[#081e22]/90 border border-teal-500/25 flex items-center justify-center text-slate-300 hover:text-white hover:bg-teal-500/10 active:scale-95 transition-all cursor-pointer shadow-xs"
            >
              <Bell className="w-5 h-5" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-rose-500 rounded-full ring-2 ring-[#050d0f] shadow-xs" />
              )}
            </button>
          )}
          <button
            onClick={() => onNavigate('parametres')}
            className="relative w-11 h-11 rounded-full overflow-hidden border-2 border-teal-500/40 hover:border-[#F7BC5F]/70 shrink-0 bg-black/40 shadow-sm active:scale-95 transition-all cursor-pointer"
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
              className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border border-[#071015] bg-[#071015] object-contain shadow-xs"
            />
          </button>
        </div>
      </div>

      {/* Dock façon accueil desktop */}
      <div className="relative rounded-3xl bg-gradient-to-b from-[#081e22]/95 via-[#061719]/95 to-[#041214]/98 backdrop-blur-2xl border border-teal-500/25 p-3.5 sm:p-4 shadow-[0_15px_35px_-10px_rgba(0,0,0,0.8),0_0_25px_rgba(247,188,95,0.06)] overflow-hidden">
        {/* Liseré supérieur doré */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F]/70 to-transparent pointer-events-none" />

        <div className="grid grid-cols-4 gap-2">
          {dockItems.map((item) => (
            <motion.button
              key={item.id}
              onClick={() => onNavigate(item.nav)}
              whileTap={{ scale: 0.92 }}
              className="flex flex-col items-center gap-1.5 cursor-pointer group"
            >
              {/* La pastille est posée HORS de la boîte de l'icône : celle-ci
                  a un overflow-hidden (reflet) qui coupait le chiffre. */}
              <div className="relative">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center relative shadow-[0_6px_16px_-4px_rgba(0,0,0,0.5)] border border-white/10 group-hover:border-white/20 transition-all overflow-hidden`}>
                  <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
                  <item.icon className="w-5 h-5 text-white drop-shadow-sm" />
                </div>
                {item.count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 z-10 bg-rose-500 text-white text-[10px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center ring-2 ring-[#071317] shadow-xs">
                    {item.count > 9 ? '9+' : item.count}
                  </span>
                )}
              </div>
              <span className="nv-texte-icone text-[11px] font-bold text-slate-200 text-center whitespace-nowrap w-full group-hover:text-white transition-colors">{item.label}</span>
            </motion.button>
          ))}
        </div>
        {/* Bandeau « 3 mails non lus · Ouvrir » retiré (demande explicite) :
            il doublait les pastilles du dock et son texte était coupé. */}
      </div>

      {/* Mes espaces */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[11px] font-black uppercase tracking-wider text-teal-300/70">Mes espaces</h2>
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
                className="w-7 h-7 rounded-full bg-[#F7BC5F]/20 text-[#F7BC5F] flex items-center justify-center hover:bg-[#F7BC5F]/30 active:scale-95 transition-all"
                title="Ajouter un espace"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
              </button>
              <button
                onClick={() => setEditMode(false)}
                className="text-xs font-black text-[#F7BC5F] px-3 py-1 rounded-full bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 active:scale-95 transition-all"
              >
                Terminé
              </button>
            </div>
          )}
        </div>

        <div className="relative rounded-3xl bg-gradient-to-b from-[#081e22]/95 via-[#061719]/95 to-[#041214]/98 backdrop-blur-2xl border border-teal-500/25 p-3 sm:p-4 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.85)] overflow-hidden">
          {/* Liseré supérieur doré discret */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F]/70 to-transparent pointer-events-none" />

          {cellulesAffichees.filter(Boolean).length === 0 && !editMode ? (
            // Filet de sécurité : si tous les espaces ont été masqués, il n'y
            // a plus aucune tuile sur laquelle faire un appui long pour
            // revenir en édition — ce bouton reste toujours accessible.
            <button
              onClick={() => { setEditMode(true); setShowAddSheet(true); }}
              className="w-full flex flex-col items-center gap-2 py-8 text-slate-400 hover:text-white transition-colors"
            >
              <Plus className="w-6 h-6 text-[#F7BC5F]" />
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
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                {(() => {
                  // Grille à positions libres : on affiche toutes les cases
                  // jusqu'à la dernière occupée (arrondi à la ligne
                  // complète), +1 ligne vide en mode édition pour avoir de
                  // la place où glisser une tuile — jamais moins de 2
                  // lignes (6 cases) pour garder une grille stable.
                  const lastFilled = cellulesAffichees.reduce((last, id, i) => (id ? i : last), -1);
                  const filledCount = lastFilled + 1;
                  const rowsNeeded = Math.ceil(filledCount / 3) + (editMode ? 1 : 0);
                  const slotCount = Math.min(GRID_SLOTS, Math.max(6, rowsNeeded * 3));

                  // Repliée (hors édition) : 5 premiers raccourcis réels +
                  // une tuile flèche pour déplier le reste, au lieu de tout
                  // étaler sur plusieurs pages sans jamais revoir le bouton
                  // "Ajouter".
                  const collapsed = !editMode && !showAllSpaces && filledCount > 6;
                  const estVerrou = (id: string | null) =>
                    !!id && (lockedSpaceIds.has(id) || !!espacesPartages?.some((espace) => espace.id === id && espace.locked));
                  // Cinq tuiles, puis la flèche sur la deuxième ligne.
                  // Un dossier verrouillé placé plus loin remonte dans ces
                  // cinq cases : il reste visible sans repousser la flèche
                  // tout en bas de l'écran.
                  const tete = collapsed
                    ? teteEcranTelephone(cellulesAffichees, true, estVerrou)
                    : cellulesAffichees.slice(0, slotCount);
                  const reste = Math.max(0, cellulesAffichees.filter(Boolean).length - tete.filter(Boolean).length);

                  const tiles = tete.map((id, i) => {
                    const space = id ? espaceAffiche(id) : undefined;
                    if (space) {
                      return (
                        <SpaceTile
                          key={space.id}
                          space={space}
                          index={i}
                          editMode={editMode}
                          onActivate={() => {
                            if (editMode) return;
                            // Dossier verrouillé (façon dossier iPhone) : s'ouvre
                            // en plein écran sur ses cartes, ne navigue pas.
                            if (space.isFolder) {
                              setOpenLockedFolder(space);
                              return;
                            }
                            // Raccourci verrouillé pointant vers un lien externe
                            // (ex. Giraffe360, Netty...) plutôt qu'un écran de
                            // l'appli — même distinction que sur AccueilGrid.
                            if (space.externalUrl) {
                              window.open(space.externalUrl, '_blank', 'noopener,noreferrer');
                              return;
                            }
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
                        className={`${SPACE_TILE_CLASS} text-[#F9C977] hover:text-white active:scale-95 transition-all`}
                      >
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#122e33] to-[#0a1c1f] border border-[#F7BC5F]/35 flex items-center justify-center shrink-0 shadow-[0_6px_16px_-4px_rgba(0,0,0,0.5)] relative overflow-hidden">
                          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />
                          <ChevronDown className="w-6 h-6 text-[#F7BC5F]" />
                        </div>
                        <span className={`${SPACE_LABEL_CLASS} text-[#F7BC5F] font-bold`}>+{reste}</span>
                      </button>
                    );
                  }

                  return tiles;
                })()}
                {showAllSpaces && !editMode && (
                  <button
                    type="button"
                    onClick={() => setShowAllSpaces(false)}
                    className={`${SPACE_TILE_CLASS} text-slate-400 hover:text-white active:scale-95 transition-all`}
                  >
                    <div className="w-16 h-16 rounded-2xl bg-[#0b2125] border border-teal-500/25 flex items-center justify-center shrink-0 relative overflow-hidden shadow-[0_6px_16px_-4px_rgba(0,0,0,0.5)]">
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
                      <ChevronUp className="w-6 h-6 text-slate-300" />
                    </div>
                    <span className={SPACE_LABEL_CLASS}>Réduire</span>
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
                    className={`${SPACE_TILE_CLASS} text-teal-300 hover:text-white col-start-3 active:scale-95 transition-all`}
                  >
                    <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-teal-500/40 bg-teal-500/5 flex items-center justify-center shrink-0">
                      <Plus className="w-6 h-6 text-teal-300" />
                    </div>
                    <span className={SPACE_LABEL_CLASS}>Ajouter</span>
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
        {/* La barre du bas est fixe. Sans cette marge, la dernière tuile
            (Ajouter en édition, Réduire quand tout est déplié) reste sous
            la barre et le toucher part sur Accueil ou Menu. */}
        {(editMode || showAllSpaces) && <div className="h-16" aria-hidden="true" />}
      </div>

      {/* Dossier verrouillé ouvert (façon dossier iPhone) : ses cartes sont
          affichées en plein écran, chacune tapable directement — imposées
          par le super admin, elles ne sont ni déplaçables ni supprimables
          d'ici (pas de mode édition dans cette vue). */}
      {openLockedFolder && (
        <div
          ref={swipeBackRef}
          className="fixed inset-0 z-[75] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 safe-area-top safe-area-bottom"
          onClick={() => setOpenLockedFolder(null)}
        >
          <div
            className="w-full max-w-md bg-gradient-to-b from-[#081e22] via-[#061719] to-[#041214] border border-teal-500/30 rounded-3xl p-6 max-h-[75vh] flex flex-col shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] animate-drawer-up-center relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F]/70 to-transparent pointer-events-none" />
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-white font-extrabold text-lg flex items-center gap-2">
                {openLockedFolder.locked && <Lock className="w-4 h-4 text-[#F7BC5F]" />}
                {openLockedFolder.label}
              </h3>
              <button onClick={() => setOpenLockedFolder(null)} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 active:scale-95 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto -mx-1 px-1">
              <div className="grid grid-cols-3 gap-3 pb-1">
                {(openLockedFolder.children || []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      if (c.isFolder) {
                        setOpenLockedFolder(c);
                        return;
                      }
                      setOpenLockedFolder(null);
                      if (c.externalUrl) {
                        window.open(c.externalUrl, '_blank', 'noopener,noreferrer');
                      } else {
                        onNavigate(c.nav);
                      }
                    }}
                    className="flex flex-col items-center justify-start gap-2 py-3 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all cursor-pointer group"
                  >
                    <div className={`w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-br ${c.gradient} flex items-center justify-center shadow-md relative overflow-hidden border border-white/10 group-hover:border-white/20 transition-all`}>
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
                      <c.icon className="w-5 h-5 text-white drop-shadow-sm" />
                    </div>
                    <span className="text-xs font-bold text-slate-200 text-center leading-tight line-clamp-2 min-h-[2rem] w-full px-1 group-hover:text-white transition-colors">{c.label}</span>
                  </button>
                ))}
              </div>
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
      {editMode && <div className="w-16 h-16 rounded-2xl border border-dashed border-teal-500/30 bg-white/[0.02]" />}
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
      role="button"
      tabIndex={0}
      {...(editMode ? attributes : {})}
      {...(editMode ? listeners : {})}
      onPointerDown={editMode ? undefined : onStartPress}
      onPointerUp={editMode ? undefined : onCancelPress}
      onPointerLeave={editMode ? undefined : onCancelPress}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      style={{
        transform: isDragging
          ? `${CSS.Transform.toString(transform)} scale(1.12)`
          : CSS.Transform.toString(transform),
        transition,
        animationDelay: `${(index % 5) * 40}ms`,
      }}
      className={`${SPACE_TILE_CLASS} cursor-pointer active:scale-95 rounded-2xl touch-manipulation ${
        editMode && !isDragging ? 'animate-jiggle' : ''
      } ${
        isDragging
          ? 'opacity-95 z-30 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.7)] ring-2 ring-[#F7BC5F] bg-[#0f2a2d]'
          : 'hover:bg-white/[0.04] transition-all'
      }`}
    >
      {editMode && !isDragging && (
        space.locked ? (
          // Imposée par un verrou super admin (voir lockedMobileSpaces) :
          // pas de croix de suppression, juste un indicateur — même règle
          // que sur AccueilGrid où une tuile verrouillée ne peut pas être
          // retirée par un utilisateur normal.
          <span
            className="absolute top-1 left-1 w-6 h-6 rounded-full bg-slate-700/90 text-white flex items-center justify-center shadow-md z-10 border border-white/10"
            title="Imposée par l'administrateur"
          >
            <Lock className="w-3 h-3 text-[#F7BC5F]" />
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onHide(); }}
            className="absolute top-1 left-1 w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center text-sm font-black shadow-md z-10 active:scale-90 transition-transform"
            title="Masquer"
          >
            −
          </button>
        )
      )}
      <div className={`w-16 h-16 shrink-0 rounded-2xl bg-gradient-to-br ${space.gradient} flex items-center justify-center relative shadow-[0_8px_20px_-6px_rgba(0,0,0,0.6)] border border-white/10 overflow-hidden`}>
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
        {space.isFolder && space.children?.length ? (
          // Aperçu façon dossier iPhone : mini-grille des 4 premières icônes
          // du dossier plutôt qu'une seule icône générique de dossier.
          <div className="grid grid-cols-2 gap-1.5 p-2.5">
            {space.children.slice(0, 4).map((c, ci) => {
              const ChildIcon = c.icon;
              return <ChildIcon key={ci} className="w-3.5 h-3.5 text-white/90 drop-shadow-sm" />;
            })}
          </div>
        ) : (
          <Icon className="w-7 h-7 text-white drop-shadow-sm" />
        )}
        {!!space.badge && space.badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center ring-2 ring-[#071317] shadow-xs">
            {space.badge > 9 ? '9+' : space.badge}
          </span>
        )}
      </div>
      <span className={`${SPACE_LABEL_CLASS} text-slate-200 group-hover:text-white transition-colors`}>{space.label}</span>
    </div>
  );
};

export default MobileHome;
