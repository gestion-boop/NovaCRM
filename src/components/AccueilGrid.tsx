import React, { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSwipeBack } from '@/hooks/useSwipeBack';
// Signalé (14 octobre) : « les tuiles sont encore différentes, ça bouge à
// chaque fois ». Cause trouvée : le shim ci-dessous (@/contexts/AuthContext,
// PLURIEL — fait pour le module ImmoSphera 360, voir ce fichier) ne
// renvoyait jamais `currentUser` (seulement `user`, une forme différente) ;
// la déstructuration plus bas le lisait quand même via un `as any`, qui a
// masqué l'erreur de type. `currentUser` valait donc TOUJOURS `undefined`
// dans tout ce composant — ce qui désactivait silencieusement, depuis
// toujours : la synchronisation serveur de la disposition (HOME_TILES_KEY
// ne formait jamais que des clés "_anon_", jamais par utilisateur réel),
// et par ricochet l'ancrage des tuiles flottantes posé le 9 octobre
// (homeSyncReadyAgencies ne se remplit que dans cette synchronisation). Les
// dossiers verrouillés sans case enregistrée flottaient donc réellement «
// dans la première case vide », recalculée à chaque rendu, pour toujours —
// pas seulement avant un correctif, EN PERMANENCE. Corrigé à la source,
// dans le shim lui-même (il expose maintenant aussi `currentUser`) plutôt
// qu'ici : un autre composant (NovaSearchBar.tsx) avait exactement le même
// bug avec ce même shim.
import { useAuth } from '@/contexts/AuthContext';
// Récidive du dossier Immosphera dans Conseils Finances (21 octobre) : le
// shim ci-dessus substitue SILENCIEUSEMENT `activeAgency` par
// AGENCIES[0] (= Conseils Finances) dès que la sélection réelle est
// "Toutes les agences" (voir @/contexts/AuthContext, `resolvedAgency`) —
// un super admin sur "Toutes les agences" qui verrouille/modifie un
// dossier d'une AUTRE agence (ex. Immosphera) voit alors ce composant
// écrire sans le savoir dans le registre de Conseils Finances. Ce second
// hook, sur le contexte natif (jamais substitué), ne sert qu'à connaître
// la VRAIE sélection globale pour bloquer ce cas précis avant écriture
// (voir enregistrerVerrous) — le reste du composant continue d'utiliser
// `useAuth()` (le shim) comme avant, pour ne rien changer d'autre.
import { useAuth as useAgenceReelle } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { estDossierReserveConseilsFinances, estAgenceConseilsFinances } from '@/lib/dossiersConseilsFinances';
import { estAgenceImmosphera, estDossierImmosphera, retirerDoublonsNotes } from '@/lib/tuilesAccueilVisibles';
import { assemblerDictee } from '@/lib/dictee';
import {
  lireDispositionAgence, ecrireDispositionAgence, lireHorodatageLocal, ecrireHorodatageLocal,
} from '@/lib/dispositionAccueil';
import { EVENEMENT_OUVRIR_DOSSIER_ACCUEIL, consommerOuvrirDossierAccueil } from '@/lib/rechercheGlobale';
import agencyImmosphera from '@/assets/agency-immosphera.png';
import { chargerMasqueesDepuisServeur, masquerTuile, lireMasquees, reafficherTuile } from '@/lib/tuilesMasquees';
import NovaMascotte from './NovaMascotte';
import { NAV_ITEMS } from './Sidebar';
import { getCachedAccessToken, requestWorkspaceAccessToken, fetchGoogleCalendarEvents } from '@/lib/workspace';
import { prochainRendezVous, texteProchainGeste, type RendezVousProchain } from '@/lib/prochainGeste';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent, DragOverlay,
  PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, rectSwappingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  Bell, MessageSquare, Calendar, Mail, Users, Headphones, 
  GitFork, FileText, FileEdit, UserPlus, BarChart2, Zap, 
  Home as HomeIcon, Camera, Settings, Plus, GripVertical, 
  Palette, Folder, FolderPlus, ArrowLeft, Check, Trash2, Edit3, X, ChevronRight, LayoutGrid,
  Globe, ExternalLink, Bookmark, Target, Shield, Award, Sparkles, Image as ImageIcon, Eye, EyeOff, Lock, Unlock, MoreVertical,
  CheckSquare, MapPin, Mic, Megaphone, Star
} from 'lucide-react';

// Signalé ("gros problème : les tuiles déplacées ne se sauvegardent jamais
// à la même place") : la synchronisation serveur de la grille d'accueil
// (plus bas, "homeSyncLoadedAgenciesRef") ne se déclenchait qu'"une seule
// fois" via un `useRef` — mais un `useRef` est réinitialisé à CHAQUE
// (RE)MONTAGE du composant, or AccueilGrid est démonté/remonté à chaque
// fois qu'on quitte l'onglet Accueil puis qu'on y revient (rendu
// conditionnel dans App.tsx). Résultat : revenir sur Accueil relançait
// systématiquement la lecture serveur et écrasait la grille locale par la
// dernière version enregistrée côté serveur — souvent légèrement en retard
// (l'écriture précédente, elle, est asynchrone) — donnant l'impression
// qu'une tuile déplacée "revenait" toujours à son ancienne place. Module-
// level (déclaré ici, hors du composant) pour survivre aux remontages et ne
// se déclencher qu'une fois par onglet navigateur ouvert, comme prévu à
// l'origine — une vraie actualisation de page réinitialise normalement ce
// module, ce qui reste voulu.
const homeSyncLoadedAgencies = new Set<string>();
// Agences dont la lecture serveur est TERMINÉE (succès ou échec).
// `homeSyncLoadedAgencies` est rempli AVANT l'appel, pour ne pas le lancer
// deux fois ; celui-ci l'est APRÈS, et sert de feu vert à l'écriture.
//
// Sans ce garde-fou, sur un appareil neuf : le composant monte avec la grille
// par défaut, l'effet de sauvegarde part aussitôt et écrit CETTE grille par
// défaut sur le serveur — écrasant la vraie disposition — puis la lecture
// serveur revient et n'a plus rien d'utile à appliquer. C'est le scénario
// exact d'un téléphone ou d'une tablette qui se connecte pour la première
// fois : les dossiers créés sur l'ordinateur étaient effacés, pas seulement
// absents.
const homeSyncReadyAgencies = new Set<string>();
// Tuiles masquées réunies avec le compte (voir chargerMasqueesDepuisServeur).
// Tant que ce drapeau est absent, on n'injecte aucune tuile « manquante » :
// la liste locale est souvent vide au premier rendu, et Annonce / Bloc-notes
// — déjà retirées de la grille — se peignaient une frame avant d'être
// retirées. Le temps du fondu (menu, retour accueil, ouverture d'un dossier)
// ça faisait exactement le flash signalé.
const masquesPretsAgences = new Set<string>();
const masquesAuditeurs = new Set<() => void>();
const marquerMasquesPrets = (clef: string) => {
  if (masquesPretsAgences.has(clef)) return;
  masquesPretsAgences.add(clef);
  masquesAuditeurs.forEach((fn) => fn());
};

interface AccueilGridProps {
  onNavigate: (navId: string) => void;
  unreadRemindersCount: number;
  unreadNotificationsCount: number;
  unreadMessagesCount: number;
  unreadMailCount?: number;
  openSupportTicketsCount?: number;
  // Envoie une question à l'Agent IA (réutilise sa logique existante — pas
  // de second appel IA depuis ce composant) et navigue vers 'assistant-ia'.
  onAskNovaAI?: (prompt: string) => void;
  // Demande explicite : cliquer sur le logo Nova ouvre directement l'écran
  // Nova IA complet (au lieu du petit tiroir de saisie), comme sur mobile.
  onOpenNova?: () => void;
  // Signalé : la superposition Nova IA garde l'accueil monté en dessous —
  // sans ce signal, le bouton flottant Nova de CE composant (position
  // fixed, indépendante du z-index de la superposition) restait visible et
  // débordait par-dessus/en bas de l'écran Nova IA une fois ouvert.
  novaOpen?: boolean;
}

// Résout le vrai compteur d'une tuile à partir des stats live de l'app.
// Les tuiles custom créées par l'utilisateur gardent leur badgeCount statique.
const resolveTileCount = (
  tile: TileItemNode,
  stats: { rappels: number; chat: number; notifications: number; mail: number; support: number }
): number => {
  switch (tile.id) {
    case 'rappels':
      return stats.rappels;
    case 'chat':
      return stats.chat;
    case 'notifications':
      return stats.notifications;
    case 'mail':
      return stats.mail;
    case 'support':
      return stats.support;
    default:
      if (tile.title === 'Rappels & Alertes') return stats.rappels;
      return tile.badgeCount;
  }
};

// Compte total d'une tuile, en sommant récursivement ses enfants si c'est un
// dossier — pour que le badge d'un dossier reflète toujours son contenu réel.
const resolveTotalCount = (
  tile: TileItemNode,
  stats: { rappels: number; chat: number; notifications: number; mail: number; support: number }
): number => {
  if (tile.isFolder) {
    return (tile.children || []).reduce((sum, child) => sum + resolveTotalCount(child, stats), 0);
  }
  return resolveTileCount(tile, stats);
};

export interface TileItemNode {
  id: string;
  title: string;
  iconName: string;
  gradient: string;
  badgeCount: number;
  navTarget: string;
  isFolder?: boolean;
  children?: TileItemNode[];
  externalUrl?: string;
  imageUrl?: string;
  // Verrouillée par le super admin (couleur/texte/logo/lien imposés à tous
  // les membres de l'agence, non modifiables/déplaçables/supprimables par
  // eux) — valeur calculée à l'affichage à partir de agency_ui_settings,
  // jamais stockée dans novasphere_home_tiles_v3 (localStorage).
  locked?: boolean;
  // Demandé le 2 septembre : « pouvoir mettre une épingle pour afficher en
  // haut de la liste, ou une étoile de favoris avec un onglet favori pour
  // les retrouver plus facilement ». Une étoile : la tuile ne bouge pas de
  // sa place, elle apparaît EN PLUS dans le bandeau « Favoris » tout en haut
  // de l'accueil — y compris quand elle est rangée dans un dossier, ce qui
  // est justement le cas où on la cherche.
  favorite?: boolean;
  // 3 septembre : « ils pourront simplement changer la couleur ». Sur une
  // tuile verrouillée, la couleur est la seule chose que le verrou laisse à
  // chacun. Ce drapeau dit que l'utilisateur a choisi la sienne : le verrou
  // n'impose alors plus sa couleur à cette tuile-là (voir applyLocks).
  couleurPerso?: boolean;
}

// Ce qu'un verrou du super admin retient d'une tuile (agency_ui_settings
// .home_layout.lockedTiles) : son apparence, son contenu, et — audit du
// 2 septembre — la liste des cartes qu'il a RETIRÉES du dossier depuis, pour
// qu'elles disparaissent aussi chez les membres qui les avaient déjà.
// 3 septembre (Sylvain : « je crée un dossier ImmoSphera, j'y ajoute des
// dossiers, je verrouille : il faut que ce dossier apparaisse pour tous les
// utilisateurs de cette agence… ensuite ils sortent du dossier ou changent
// de place ») : le verrou retient aussi la CASE du dossier sur la grille du
// super admin (`slot`), pour qu'il arrive au même endroit chez chacun, et sa
// date (`maj`), pour départager d'anciens verrous du même nom.
type Verrou = Partial<TileItemNode> & { retires?: string[]; slot?: number; maj?: number };

export const PRESET_GRADIENTS = [
  { name: 'Rubis Impérial', value: 'from-[#8B1E3F] via-[#63142A] to-[#3B0A18]' },
  { name: 'Saphir Océan', value: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]' },
  { name: 'Émeraude Forest', value: 'from-[#059669] via-[#047857] to-[#064E3B]' },
  { name: 'Améthyste Royale', value: 'from-[#6B21A8] via-[#581C87] to-[#3B0764]' },
  { name: 'Ambre Doré', value: 'from-[#F7BC5F] via-[#C9992B] to-[#78540F]' },
  { name: 'Cuivre Sunset', value: 'from-[#EA580C] via-[#C2410C] to-[#7C2D12]' },
  { name: 'Obsidienne Pur', value: 'from-[#1E293B] via-[#0F172A] to-[#020617]' },
  { name: 'Quartz Rose', value: 'from-[#BE185D] via-[#9D174D] to-[#500724]' },
  { name: 'Cyan Lagon', value: 'from-[#0891B2] via-[#0E7490] to-[#164E63]' },
  { name: 'Vert Jade', value: 'from-[#047857] via-[#065F46] to-[#022C22]' },
  { name: 'Néon Cyber', value: 'from-[#4F46E5] via-[#3730A3] to-[#1E1B4B]' },
  { name: 'Bronze Élégant', value: 'from-[#B45309] via-[#78350F] to-[#451A03]' },
  /* 12 Nouvelles Couleurs Lumineuses avec effets 3D */
  { name: 'Or Lux 3D', value: 'from-[#FFE066] via-[#F5A623] to-[#D07000]' },
  { name: 'Plasma Magenta 3D', value: 'from-[#FF2A85] via-[#FF0075] to-[#800040]' },
  { name: 'Lagon Électrique 3D', value: 'from-[#00F0FF] via-[#00A8FF] to-[#0040DD]' },
  { name: 'Laser Vert 3D', value: 'from-[#ADFF2F] via-[#32CD32] to-[#008000]' },
  { name: 'Soleil Solaire 3D', value: 'from-[#FF9900] via-[#FF5500] to-[#B30000]' },
  { name: 'Aurore Boréale 3D', value: 'from-[#00FFC6] via-[#00B8D9] to-[#6A00FF]' },
  { name: 'Rose Diamant 3D', value: 'from-[#FF75C3] via-[#FFA647] to-[#FF2E63]' },
  { name: 'Bleu Cobalt 3D', value: 'from-[#38BDF8] via-[#2563EB] to-[#1E1B4B]' },
  { name: 'Topaze Lumineux 3D', value: 'from-[#FDE047] via-[#EAB308] to-[#854D0E]' },
  { name: 'Hyper Violet 3D', value: 'from-[#D8B4FE] via-[#A855F7] to-[#581C87]' },
  { name: 'Corail Vivant 3D', value: 'from-[#FF6B6B] via-[#FF4757] to-[#2ED573]' },
  { name: 'Perle Blanche 3D', value: 'from-[#FFFFFF] via-[#CBD5E1] to-[#475569]' },
];

const ICON_MAP: Record<string, React.ElementType> = {
  Bell, MessageSquare, Calendar, Mail, Users, Headphones,
  GitFork, FileText, FileEdit, UserPlus, BarChart2, Zap,
  HomeIcon, Camera, Settings, Folder, LayoutGrid, Globe, ExternalLink,
  Bookmark, Target, Shield, Award, Sparkles, CheckSquare, ImageIcon, MapPin, Megaphone
};

const ICON_PICKER_OPTIONS = [
  { name: 'Calendar', icon: Calendar, label: 'Agenda' },
  { name: 'Users', icon: Users, label: 'Clients' },
  { name: 'Target', icon: Target, label: 'Objectif' },
  { name: 'Mail', icon: Mail, label: 'Mail' },
  { name: 'Folder', icon: Folder, label: 'Dossier' },
  { name: 'Settings', icon: Settings, label: 'Réglages' },
  { name: 'BarChart2', icon: BarChart2, label: 'Stats' },
  { name: 'FileText', icon: FileText, label: 'Doc' },
  { name: 'HomeIcon', icon: HomeIcon, label: 'Accueil' },
  { name: 'CheckSquare', icon: CheckSquare, label: 'Tâches' },
  { name: 'Globe', icon: Globe, label: 'Web' },
  { name: 'ExternalLink', icon: ExternalLink, label: 'Lien' },
  { name: 'MessageSquare', icon: MessageSquare, label: 'Chat' },
  { name: 'Bell', icon: Bell, label: 'Alerte' },
  { name: 'Camera', icon: Camera, label: 'Visite' },
  { name: 'Zap', icon: Zap, label: 'Flash' },
  { name: 'Sparkles', icon: Sparkles, label: 'IA' },
  { name: 'Bookmark', icon: Bookmark, label: 'Favori' },
  { name: 'Shield', icon: Shield, label: 'Sécurité' },
  { name: 'Award', icon: Award, label: 'Premium' },
];

const normalizeTile = (tile: TileItemNode): TileItemNode => {
  const normalizedTitle = (tile.title || '').trim();
  const isLegacyNotificationTile =
    tile.id === 'notifications' ||
    normalizedTitle.toLowerCase() === 'notifications' ||
    normalizedTitle.toLowerCase() === 'notification';

  // Les compteurs des tuiles "Tableau de bord" et "Pipelines Prêts" étaient
  // des valeurs factices (toujours 2 / 3, jamais reliées à un vrai
  // indicateur) — on les force à 0 même pour les configurations déjà
  // enregistrées en localStorage chez les utilisateurs (sinon changer
  // seulement INITIAL_TILES n'a aucun effet pour qui a déjà
  // personnalisé/sauvegardé sa grille d'accueil).
  const hasFakeBadge = tile.id === 'tableau-de-bord' || tile.id === 'pipeline';

  // Renommage "Support Clients" → "Support", forcé ici aussi pour les
  // grilles déjà personnalisées/enregistrées.
  const isSupportTile = tile.id === 'support';

  // Demandé le 2 septembre : « je veux que cela s'appelle Projets internes ».
  // Même principe : la tuile s'appelait "Pipeline interne" dans les grilles
  // déjà enregistrées, et changer INITIAL_TILES ne les touche pas.
  const isProjetsInternesTile = tile.id === 'projets-internes';

  // Logo mascotte Nova sur la tuile Assistant NovaAI (au lieu de l'icône
  // éclair générique) — forcé ici aussi pour les grilles déjà
  // personnalisées/enregistrées en localStorage, sinon changer seulement
  // INITIAL_TILES n'a aucun effet pour qui a déjà sa grille sauvegardée.
  const isAssistantIaTile = tile.id === 'assistant-ia';

  const baseTile = {
    ...tile,
    id: isLegacyNotificationTile ? 'rappels' : tile.id,
    title: isLegacyNotificationTile
      ? 'Rappels & Alertes'
      : isSupportTile
        ? 'Support'
        : isProjetsInternesTile
          ? 'Projets internes'
          : tile.title,
    navTarget: tile.navTarget === 'notifications' || isLegacyNotificationTile ? 'rappels' : tile.navTarget,
    badgeCount: isLegacyNotificationTile || hasFakeBadge ? 0 : tile.badgeCount,
    imageUrl: isAssistantIaTile ? '/nova-mascotte.png' : tile.imageUrl,
  };

  if (!baseTile.children) return baseTile;

  return {
    ...baseTile,
    children: baseTile.children.map((child) => normalizeTile(child)),
  };
};

// Signalé ("je n'ai plus mes tuiles Pipeline et Tableau de bord") : la
// réconciliation des tuiles manquantes (plus bas, missingNavTiles) cherchait
// leur définition avec INITIAL_TILES.find(...) — une recherche NON
// récursive, qui ne regarde jamais dans les `children` des dossiers. Or
// "pipeline" et "tableau-de-bord" (comme "chat"/"mail"/"support") vivent
// justement à l'intérieur d'un dossier par défaut ("Stratégie & Ventes" /
// "Communication & Mails") — jamais trouvées, donc jamais réintégrées, quel
// que soit le contenu de la corbeille. Recherche récursive dédiée ici.
const findInitialTile = (id: string, items: TileItemNode[] = INITIAL_TILES): TileItemNode | null => {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findInitialTile(id, item.children);
      if (found) return found;
    }
  }
  return null;
};

// Ticket #221 : lien du fichier Google Sheets partagé "ImmoSphera Pool"
// (partage des biens entre agents). Laissé vide tant que le lien n'a pas
// été fourni — remplir cette seule constante suffit, aucune autre
// modification n'est nécessaire pour activer la tuile.
const IMMOSPHERA_POOL_SHEET_URL = '';

const INITIAL_TILES: TileItemNode[] = [
  {
    id: 'rappels',
    title: 'Rappels & Alertes',
    iconName: 'Bell',
    gradient: 'from-[#8B1E3F] via-[#63142A] to-[#3B0A18]',
    badgeCount: 0,
    navTarget: 'rappels',
  },
  // Chat Équipe et Mail : comme "rappels" ci-dessus, jamais affichées dans
  // la grille elle-même (retirées par removeQuickBarDuplicates, voir
  // QUICK_BAR_DUPLICATE_IDS plus bas) — seul le bandeau "Ma journée /
  // Priorités" (ORDRE_BARRE_HAUT) les affiche, en lisant ici leur icône/
  // couleur/titre. Les avoir supprimées d'ici avec le dossier Communication
  // (23 septembre, voir commentaire sur "support" plus bas) avait fait
  // disparaître leur icône de ce bandeau par la même occasion — signalé le
  // lendemain (« je n'ai plus le logo chat sur la barre du haut »).
  // Remises en tuiles autonomes, hors de tout dossier, sans les rendre
  // visibles dans la grille pour autant (elles y étaient déjà invisibles
  // avant le 23 septembre).
  {
    id: 'chat',
    title: 'Chat Équipe',
    iconName: 'MessageSquare',
    gradient: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]',
    badgeCount: 2,
    navTarget: 'chat',
  },
  {
    id: 'mail',
    title: 'Mail',
    iconName: 'Mail',
    gradient: 'from-[#1E3A8A] via-[#1E293B] to-[#0F172A]',
    badgeCount: 1,
    navTarget: 'mail',
  },
  // Demande explicite (23 septembre) : « le dossier Communication ne sert à
  // rien, supprime-le sur tous les profils, mets la tuile [Support] à
  // l'extérieur ». Ce dossier ne contenait plus grand-chose d'utile : Chat
  // Équipe et Mail sont filtrés hors des dossiers par removeQuickBarDuplicates
  // (déjà dans le bandeau "Ma journée" du haut, voir ci-dessus), ne laissant
  // que Support dedans — un dossier à une seule carte. Signalé plusieurs
  // fois comme bug récurrent (9 septembre notamment : « le dossier
  // Communication se recrée chez des utilisateurs ») avant même d'être
  // supprimé pour de bon : la tuile "Support" vit maintenant directement à
  // la racine, plus de dossier à faire revenir. Migration forcée des
  // grilles déjà enregistrées avec l'ancien dossier : voir
  // retirerDossierCommunication plus bas.
  {
    id: 'support',
    title: 'Support',
    iconName: 'Headphones',
    gradient: 'from-[#334155] via-[#1E293B] to-[#0F172A]',
    badgeCount: 0,
    navTarget: 'support',
  },
  {
    id: 'agenda',
    title: 'Agenda & RDV',
    iconName: 'Calendar',
    gradient: 'from-[#059669] via-[#047857] to-[#064E3B]',
    badgeCount: 0,
    navTarget: 'agenda',
  },
  {
    id: 'clients',
    title: 'Clients & Leads',
    iconName: 'Users',
    gradient: 'from-[#A8421E] via-[#7C2D12] to-[#451A03]',
    badgeCount: 0,
    navTarget: 'clients',
  },
  {
    id: 'projets-internes',
    title: 'Projets internes',
    iconName: 'CheckSquare',
    gradient: 'from-[#7C3AED] via-[#5B21B6] to-[#2E1065]',
    badgeCount: 0,
    navTarget: 'projets-internes',
  },
  {
    id: 'folder-business',
    title: 'Stratégie & Ventes',
    iconName: 'Folder',
    gradient: 'from-[#6B21A8] via-[#3B0764] to-[#1E1B4B]',
    badgeCount: 5,
    navTarget: '',
    isFolder: true,
    children: [
      {
        id: 'pipeline',
        title: 'Pipelines Prêts',
        iconName: 'GitFork',
        gradient: 'from-[#1F2937] via-[#111827] to-[#030712]',
        badgeCount: 0,
        navTarget: 'pipeline',
      },
      {
        id: 'tableau-de-bord',
        title: 'Tableau de bord',
        iconName: 'BarChart2',
        gradient: 'from-[#0D9488] via-[#0F766E] to-[#042F2E]',
        badgeCount: 0,
        navTarget: 'tableau-de-bord',
      },
      // Demande explicite (30/08/2026) : "supprime la tuile assistant nova
      // qui ne servira jamais" — tuile retirée d'ici (elle vivait dans ce
      // dossier "Stratégie & Ventes"). Nova reste accessible normalement via
      // le menu latéral (Sidebar.tsx, NAV_ITEMS 'assistant-ia' inchangé) —
      // seul le raccourci depuis l'accueil disparaît. Retrait forcé aussi
      // pour les grilles déjà personnalisées/enregistrées un peu plus bas
      // (voir removeSpacer/removeAssistantIaTile dans loadTilesForKey), même
      // principe que pour "nova-lock-spacer".
      // Demande explicite (28/08/2026) : tuile "tableau à l'ancienne" en
      // étiquettes laiton, données réelles du pipeline Transactions V2 par
      // agent (Compromis / Signature / Total) — voir
      // StatistiquesEtiquettesView.tsx.
      {
        id: 'statistiques-etiquettes',
        title: 'Statistiques',
        iconName: 'BarChart2',
        gradient: 'from-[#B8923F] via-[#78350F] to-[#2A2211]',
        badgeCount: 0,
        navTarget: 'statistiques-etiquettes',
      }
    ]
  },
  {
    id: 'documents',
    title: 'Coffre Documents',
    iconName: 'FileText',
    gradient: 'from-[#B45309] via-[#78350F] to-[#451A03]',
    badgeCount: 0,
    navTarget: 'documents',
  },
  {
    id: 'notes',
    title: 'Bloc-notes',
    iconName: 'FileEdit',
    gradient: 'from-[#6B21A8] via-[#581C87] to-[#3B0764]',
    badgeCount: 0,
    navTarget: 'notes',
  },
  {
    id: 'equipe',
    title: 'Membres Équipe',
    iconName: 'UserPlus',
    gradient: 'from-[#1E1B4B] via-[#1E293B] to-[#0F172A]',
    badgeCount: 0,
    navTarget: 'equipe',
  },
  {
    id: 'reserver-camera',
    title: 'Réserver caméra',
    iconName: 'Camera',
    gradient: 'from-[#D97706] via-[#B45309] to-[#78350F]',
    badgeCount: 0,
    navTarget: 'reserver-camera',
  },
  {
    id: 'parametres',
    title: 'Paramètres',
    iconName: 'Settings',
    gradient: 'from-[#334155] via-[#1E293B] to-[#0F172A]',
    badgeCount: 0,
    navTarget: 'parametres',
  },
  {
    // Ticket #255 : accès rapide à la création d'annonce depuis l'accueil,
    // réservé aux administrateurs — filtré par `canSeeAnnonceTile` plus bas
    // (même règle que `isAdmin` dans ParametresView.tsx : role === 'super_admin').
    id: 'annonce',
    title: 'Annonce',
    iconName: 'Megaphone',
    gradient: 'from-[#F7BC5F] via-[#B45309] to-[#78350F]',
    badgeCount: 0,
    navTarget: 'parametres',
  },
  {
    id: 'immosphera360',
    title: 'Immosphera 360',
    iconName: 'HomeIcon',
    imageUrl: agencyImmosphera,
    // Fond jaune demandé par Sylvain pour cette tuile (couleurs de l'agence
    // Immosphera), avec le logo Immosphera dessus au lieu d'une icône
    // générique.
    gradient: 'from-[#F7BC5F] via-[#E8A83F] to-[#C9862A]',
    badgeCount: 0,
    navTarget: 'immosphera360',
  },
  // Tuiles réservées aux membres de l'agence Immosphera + super admin (voir
  // IMMOSPHERA_EXTRA_TILE_IDS / canSeeImmospheraExtras plus bas) — demande
  // explicite. Icônes/couleurs par défaut, à personnaliser ensuite via la
  // palette (logos propres à intégrer plus tard par l'utilisateur).
  {
    id: 'conseils-aura',
    title: 'Aura',
    iconName: 'Sparkles',
    gradient: 'from-[#7C5CFF] via-[#5B3FD6] to-[#3B268F]',
    badgeCount: 0,
    navTarget: '',
    externalUrl: 'https://conseils-finances.aura-ai.fr/',
  },
  {
    id: 'immosphera-site',
    title: 'Site internet',
    iconName: 'Globe',
    gradient: 'from-[#F7BC5F] via-[#E8A83F] to-[#C9862A]',
    badgeCount: 0,
    navTarget: '',
    externalUrl: 'https://www.immosphera.fr',
  },
  {
    id: 'immosphera-partenaires',
    title: 'Partenaires',
    iconName: 'Users',
    gradient: 'from-[#F7BC5F] via-[#E8A83F] to-[#C9862A]',
    badgeCount: 0,
    // Cas spécial géré dans App.tsx : ouvre Immosphera360 directement sur
    // l'onglet Partenaires au lieu de la page Biens par défaut.
    navTarget: 'immosphera-partenaires',
  },
  {
    id: 'immosphera-netty',
    title: 'Netty',
    iconName: 'ExternalLink',
    gradient: 'from-[#334155] via-[#1E293B] to-[#0F172A]',
    badgeCount: 0,
    navTarget: '',
    externalUrl: 'https://app.netty.fr/~company41621gcq/admin/login.php',
  },
  {
    id: 'folder-passerelle',
    title: 'Passerelle',
    iconName: 'Folder',
    gradient: 'from-[#0D9488] via-[#0F766E] to-[#042F2E]',
    badgeCount: 0,
    navTarget: '',
    isFolder: true,
    // Ticket #279 : "tuile obligatoire" — dossier imposé par l'agence. La
    // couleur et les cartes déjà présentes ne peuvent plus être changées ni
    // retirées (canModify plus bas), mais le dossier reste déplaçable, et
    // chacun peut toujours y ajouter ses propres raccourcis en plus.
    locked: true,
    children: [
      {
        id: 'immosphera-leboncoin',
        title: 'Leboncoin',
        iconName: 'Bookmark',
        gradient: 'from-[#EA580C] via-[#C2410C] to-[#7C2D12]',
        badgeCount: 0,
        navTarget: '',
        externalUrl: 'https://www.leboncoin.fr',
      },
      {
        id: 'immosphera-bienici',
        title: 'Bien Ici',
        iconName: 'HomeIcon',
        gradient: 'from-[#0083B0] via-[#005C8A] to-[#0F172A]',
        badgeCount: 0,
        navTarget: '',
        externalUrl: 'https://www.bienici.com',
      },
      {
        id: 'immosphera-figaro',
        title: 'Le Figaro',
        iconName: 'FileText',
        gradient: 'from-[#1F2937] via-[#111827] to-[#030712]',
        badgeCount: 0,
        navTarget: '',
        externalUrl: 'https://immobilier.lefigaro.fr',
      },
    ],
  },
  // Demandé le 2 septembre : « je voudrais une tuile Académy ImmoSphera, on
  // regroupera dedans toutes les procédures en PDF et voir vidéos ».
  {
    id: 'immosphera-academy',
    title: 'Académy',
    iconName: 'Award',
    // Demandé le 2 septembre : « je veux la tuile en bleue ». Bleu Saphir,
    // celui de la palette de l'application (voir PRESET_GRADIENTS).
    gradient: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]',
    badgeCount: 0,
    navTarget: 'academy',
  },
  {
    id: 'immosphera-amanda',
    title: 'Amanda',
    iconName: 'Shield',
    gradient: 'from-[#6B21A8] via-[#3B0764] to-[#1E1B4B]',
    badgeCount: 0,
    navTarget: '',
    externalUrl: 'https://narbonne-et-environs.amepi.fr/Account/Login?ReturnUrl=%2F',
  },
  // Ticket #221 : partage des biens entre agents Immosphera, hébergé sur
  // Google Sheets (aucun droit supplémentaire créé côté CRM — respecte les
  // permissions Google déjà en place sur ce fichier). Le lien se règle en
  // un seul endroit (IMMOSPHERA_POOL_SHEET_URL ci-dessous) sans toucher au
  // composant ; tant qu'il est vide, la tuile prévient au clic au lieu
  // d'ouvrir un onglet vide/cassé (voir onActivate plus bas).
  {
    id: 'immosphera-pool',
    title: 'ImmoSphera Pool',
    iconName: 'HomeIcon',
    gradient: 'from-[#F7BC5F] via-[#E8A83F] to-[#C9862A]',
    badgeCount: 0,
    navTarget: '',
    externalUrl: IMMOSPHERA_POOL_SHEET_URL,
  },
  // Tuile "Carte" — prospection Novavisio (voir canSeeNovavisio plus bas),
  // remise en place à l'identique du backup : "mets pour novavisio la carte
  // comme c'est sur le backup" / "l'onglet carte avec la tuile, qui
  // correspond a la prospection de Natacha".
  {
    id: 'carte-novavisio',
    title: 'Carte',
    iconName: 'MapPin',
    gradient: 'from-[#10b981] via-[#059669] to-[#065f46]',
    badgeCount: 0,
    navTarget: 'carte-novavisio',
  },
  // Tuile "Paramètres Système" retirée : l'accès se fait désormais par la
  // roue crantée du header, à côté de la clochette.
];

// Ticket #121 : seules les tuiles/dossiers créés par l'utilisateur peuvent
// être supprimés définitivement — les tuiles par défaut (celles ci-dessus,
// fournies avec le CRM) ne peuvent être que masquées (récupérables dans
// Paramètres), jamais effacées pour de bon. Calculé une fois en aplatissant
// INITIAL_TILES (racine + enfants des dossiers par défaut).
function flattenTileIds(items: TileItemNode[]): string[] {
  return items.flatMap((t) => [t.id, ...(t.children ? flattenTileIds(t.children) : [])]);
}
const DEFAULT_TILE_IDS = new Set(flattenTileIds(INITIAL_TILES));

// Demandé (5 septembre) : « supprime les tuiles de rappels, chat, mail et
// agenda vu qu'elles sont sur la barre du haut », puis (capture d'une grille
// SYNCHRONISÉE depuis le serveur, où elles étaient toujours là) : « pour les
// tuiles que je te donne [Agenda & RDV, Rappels & Alertes, Tableau de bord],
// supprime-les définitivement, on a les raccourcis en haut ». Ces tuiles sont
// déjà dans le bandeau "Ma journée / Priorités" (ORDRE_BARRE_HAUT), qui les
// lit dans INITIAL_TILES indépendamment de cette grille : les retirer d'ici
// ne retire rien à ce bandeau, ni au menu latéral qui garde ses propres
// entrées Chat/Mail/Agenda/Rappels.
// Fonction hissée au niveau module (au lieu de rester interne à
// `reconcilierGrille`, dans le composant) : une grille reçue du SERVEUR
// (voir le chargement multi-appareils plus bas) ne repasse JAMAIS par
// `reconcilierGrille` — un choix volontaire du 2 septembre, pour ne pas faire
// ressortir les cartes des dossiers verrouillés — donc un retrait qui ne
// vivait que dans `reconcilierGrille` n'avait aucun effet sur une grille
// synchronisée depuis un autre appareil, exactement le cas ici. Ce filtre-ci,
// lui, ne touche qu'une poignée d'identifiants précis (jamais le contenu des
// dossiers verrouillés) : sûr à appliquer aussi à une grille venue du
// serveur.
const QUICK_BAR_DUPLICATE_IDS = new Set(['rappels', 'chat', 'mail', 'agenda', 'tableau-de-bord']);
function removeQuickBarDuplicates(items: TileItemNode[]): TileItemNode[] {
  return items
    .filter((t) => !QUICK_BAR_DUPLICATE_IDS.has(t.id))
    .map((t) => (t.children ? { ...t, children: removeQuickBarDuplicates(t.children) } : t));
}

// Id de la tuile "Carte" ci-dessus, réservée à Novavisio + super admin
// (voir canSeeNovavisio plus bas) — même principe que
// IMMOSPHERA_EXTRA_TILE_IDS/canSeeImmospheraExtras.
const NOVAVISIO_EXTRA_TILE_IDS = ['carte-novavisio'];

// Ids des tuiles ci-dessus réservées à Immosphera + super admin — utilisé à
// la fois pour l'auto-ajout aux grilles déjà personnalisées et pour le
// filtre de visibilité (voir canSeeImmospheraExtras).
// Tuile Aura — obligatoire pour tous les membres de Conseils Finances
// (demande du 31/08/2026). Même mécanique que les tuiles Immosphera :
// injectée dans toute grille qui ne l'a pas encore, puis filtrée à
// l'affichage par canSeeConseilsFinances.
//
// `externalUrl` et non un cadre intégré : conseils-finances.aura-ai.fr répond
// `x-frame-options: SAMEORIGIN`, ce qui interdit au navigateur de l'afficher
// dans une fenêtre du CRM. Le jour où Aura autorisera
// `frame-ancestors https://app.nova360.space`, il suffira de remplacer
// `externalUrl` par `embedUrl` sur cette tuile — le reste est déjà en place.
const CONSEILS_EXTRA_TILE_IDS = ['conseils-aura'];

const IMMOSPHERA_EXTRA_TILE_IDS = [
  'immosphera-academy',
  'immosphera-site',
  'immosphera-partenaires',
  'immosphera-netty',
  'folder-passerelle',
  'immosphera-amanda',
  'immosphera-pool',
  // Demande explicite (28/08/2026) : "le dossier statistique doit être
  // uniquement dans l'agence Immosphera" — réutilise directement ce même
  // filtre de visibilité (canSeeImmospheraExtras) ; l'ajout à une grille
  // déjà personnalisée, lui, reste géré par son propre bloc dédié plus bas
  // (findInitialTile RÉCURSIF, nécessaire car cette tuile vit dans un
  // dossier — le mécanisme générique ci-dessus ne cherche qu'au premier
  // niveau et ne l'aurait jamais trouvée).
  'statistiques-etiquettes',
];

// Tuile de la grille principale, rendue déplaçable via @dnd-kit/sortable
// (hook useSortable — doit être un composant à part pour respecter les
// règles des Hooks puisqu'on en instancie un par tuile dans une liste).
interface SortableTileProps {
  tile: TileItemNode;
  count: number;
  isDragTarget: boolean;
  onActivate: () => void;
  onOpenPalette: () => void;
  onEdit?: () => void;
  // Verrouillage par le super admin (voir toggleTileLock/applyLocks plus
  // haut) — demande explicite.
  isSuperAdmin?: boolean;
  onToggleLock?: () => void;
  // "+" centré en bas des dossiers, pour ajouter une tuile directement
  // dedans sans avoir à l'ouvrir d'abord.
  onQuickAdd?: () => void;
  // Menu consolidé (Renommer / Ajouter à un dossier / Masquer / Supprimer
  // définitivement) — demande explicite, remplace l'icône poubelle seule.
  onOpenActionsMenu?: (e: React.MouseEvent) => void;
}

// Ticket #256 : case vide de la grille racine (desktop) — pas de contenu,
// pas cliquable, mais reste une cible de drop dnd-kit valide (id
// synthétique stable `__empty-N__`) pour pouvoir "poser une tuile où on
// veut", y compris en laissant du vide avant elle. Jamais utilisée dans un
// dossier ouvert (qui garde sa liste dense classique).
// Ticket #277 (suite) : demande explicite avec exemples à l'appui (captures
// d'un autre CRM) — en mode jour, les tuiles doivent devenir des cartes
// blanches avec une icône colorée (façon logiciels pro classiques), pas les
// dégradés vifs du mode sombre simplement éclaircis. Le mode jour de toute
// l'appli n'est qu'un filtre CSS global (voir index.css, .light-mode) —
// aucun composant ne "sait" dans quel mode il est. Ce petit hook lit l'état
// réel (classe posée sur <html> par App.tsx) pour permettre ici un rendu
// VRAIMENT différent (pas juste une couleur qui traverse le filtre), sans
// avoir à faire remonter isDarkMode depuis App.tsx à travers tous les
// composants intermédiaires.
export const useIsLightMode = () => {
  const [isLight, setIsLight] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('light-mode')
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsLight(el.classList.contains('light-mode'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isLight;
};

// Couleur "accent" représentative d'une tuile, extraite de son dégradé
// (premier arrêt, ex. "from-[#8B1E3F] via-[#63142A] to-[#3B0A18]" → "#8B1E3F")
// — utilisée en mode jour pour l'icône/le badge, à la place du dégradé
// entier posé en fond de carte.
const extractTileAccentColor = (gradient: string | undefined): string => {
  const match = gradient?.match(/from-\[(#[0-9a-fA-F]{3,8})\]/);
  return match ? match[1] : '#F7BC5F';
};

const EmptyRootCell: React.FC<{ id: string }> = ({ id }) => {
  const { setNodeRef, isOver } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      className={`h-40 sm:h-48 md:h-52 rounded-2xl sm:rounded-3xl border-2 border-dashed transition-colors ${
        isOver ? 'border-[#F7BC5F]/60 bg-[#F7BC5F]/5' : 'border-transparent'
      }`}
    />
  );
};

const SortableTile: React.FC<SortableTileProps> = ({ tile, count, isDragTarget, onActivate, onOpenPalette, onEdit, isSuperAdmin, onToggleLock, onQuickAdd, onOpenActionsMenu }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, active } = useSortable({ id: tile.id });
  // Un glisser est en cours quelque part dans la grille : les effets de
  // survol (rebond, halo) des autres tuiles sont coupés le temps du geste —
  // sinon chaque tuile survolée par le pointeur sursautait sous la tuile
  // déplacée, ce qui rendait le geste saccadé (signalé le 2 septembre).
  const dragEnCours = active !== null;
  const Icon = ICON_MAP[tile.iconName] || LayoutGrid;
  // Sur mobile, l'accueil reste un simple clic : pas de glisser-déposer, pas
  // de changement de couleur, pas de suppression — l'ordre et le contenu
  // sont ceux synchronisés depuis l'ordinateur (voir SortableSubTile idem).
  const isMobile = useIsMobile();
  // Une tuile verrouillée par le super admin reste modifiable... par le
  // super admin lui-même (pour pouvoir l'ajuster ou la déverrouiller) ;
  // tout le monde d'autre la voit figée côté édition (pas de renommage, pas
  // de couleur, pas de suppression). Ticket #113 : le déplacement (glisser
  // pour réorganiser) reste, lui, autorisé à tous même sur une tuile
  // verrouillée — seule l'édition du contenu est bloquée.
  const canModify = !tile.locked || isSuperAdmin;
  const canDrag = !isMobile;
  const isLight = useIsLightMode();
  const accentColor = extractTileAccentColor(tile.gradient);

  return (
    <div
      ref={setNodeRef}
      {...(canDrag ? attributes : {})}
      {...(canDrag ? listeners : {})}
      onClick={onActivate}
      // Demande explicite (30/08/2026) : "sur les icônes accueil et tuiles,
      // je veux un effet halo quand on sélectionne un élément" — lueur
      // colorée (couleur de la tuile elle-même, via accentColor déjà
      // calculé plus haut) au clic/appui, en plus du léger rétrécissement
      // déjà présent (active:scale-[0.97]).
      style={{
        // La tuile saisie reste dans sa case, invisible : seule la copie qui
        // suit le pointeur bouge, et elle a exactement le même aspect.
        // L'ancienne version la passait en pointillé à 30 % — le fond de
        // plage transparaissait, la tuile changeait de couleur et se
        // retrouvait coupée au bord pendant l'échange.
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? 'none' : transform ? (transition || 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)') : undefined,
        opacity: isDragging ? 0 : undefined,
        ['--tile-glow' as string]: accentColor,
      }}
      // Signalé : effet "verre 3D" (reflet + biseau + bordures multicolores)
      // retiré, au profit d'icônes plates façon écran d'accueil iPhone —
      // même taille/forme de tuile qu'avant (h-28/h-36, rectangle), juste
      // une ombre simple à la place du relief. Cohérent avec le même
      // changement déjà fait sur les tuiles mobiles ("Mes espaces").
      // Correctif annulé (mode jour) : "pas en noir et blanc, garder le
      // fond des couleurs qui existe déjà" — la tuile garde son vrai
      // dégradé dans les deux modes ; seul le filtre global (voir
      // index.css) l'éclaircit en mode jour, sans passer au blanc uni.
      // Demande explicite (30/08/2026) : "quand je sélectionne un élément
      // avec la souris, et que je survole, je veux un effet halo" — la
      // lueur (déjà présente au clic, active:shadow-[...]) s'applique
      // maintenant AUSSI au survol (hover:shadow-[...] remplace l'ancien
      // hover:shadow-lg générique, qui n'utilisait pas la couleur propre
      // à la tuile).
      className={`relative group h-40 sm:h-48 md:h-52 rounded-2xl sm:rounded-3xl bg-gradient-to-br ${tile.gradient} p-3 sm:p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 border border-t-white/35 border-l-white/20 border-r-black/30 border-b-black/50 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.65),inset_0_1px_2px_rgba(255,255,255,0.35)] select-none overflow-hidden ${
        isDragging || dragEnCours
          ? 'z-10 pointer-events-none'
          : isDragTarget
            ? 'border-[#F7BC5F] ring-4 ring-[#F7BC5F]/30 scale-105 z-40'
            : 'active:scale-[0.97] active:shadow-[0_0_0_3px_var(--tile-glow),0_0_22px_8px_var(--tile-glow)] hover:scale-[1.03] hover:-translate-y-1 hover:border-white/50 hover:shadow-[0_20px_35px_-10px_rgba(0,0,0,0.8),0_0_18px_6px_var(--tile-glow),inset_0_1px_2px_rgba(255,255,255,0.45)] z-10'
      }`}
    >
      {/* 3D Glass Specular Reflection & Relief */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 via-white/5 to-transparent rounded-t-2xl sm:rounded-t-3xl pointer-events-none z-10" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent rounded-b-2xl sm:rounded-b-3xl pointer-events-none z-10" />

      {/* Drag Handle top-left — masqué sur mobile (pas de réorganisation tactile).
          Visible même verrouillée (ticket #113) : le déplacement reste permis. */}
      {canDrag && (
        <div
          className="hidden sm:block absolute top-2 left-2 sm:top-3 sm:left-3 p-1 rounded-lg text-white/50 hover:text-white cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-20"
          title="Glisser pour déplacer"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </div>
      )}

      {/* Cadenas visible en permanence quand verrouillée (pas seulement au
          survol) — indique clairement à tout le monde que cette tuile est
          figée par le super admin. */}
      {tile.locked && (
        <div
          className="hidden sm:flex absolute top-2 left-2 sm:top-3 sm:left-3 items-center justify-center p-1 rounded-lg bg-black/60 text-[#F7BC5F] border border-[#F7BC5F]/30 shadow-md z-20"
          title="Verrouillée par le super admin"
        >
          <Lock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
        </div>
      )}

      {/* Ticket #120 : un seul bouton "+" en haut à droite (masqué sur
          mobile), au lieu des 4 icônes séparées (cadenas/modifier/couleur/
          autres actions) qui encombraient chaque tuile au survol — tout est
          désormais regroupé dans un unique panneau d'options.
          3 septembre : « les tuiles verrouillées par les admins, ils peuvent
          les déplacer où ils veulent » — le bouton reste sur une tuile
          verrouillée, mais le menu n'y propose que « Changer la couleur » ;
          le déplacement se fait en glissant (voir le menu d'actions). */}
      {onOpenActionsMenu && (
        <div className="hidden sm:flex absolute top-2 right-2 sm:top-3 sm:right-3 opacity-0 group-hover:opacity-100 transition-opacity z-20">
          <button
            onClick={(e) => { e.stopPropagation(); onOpenActionsMenu(e); }}
            className="p-1 rounded-lg bg-black/60 hover:bg-[#F7BC5F] text-white/80 hover:text-[#20170a] transition-colors border border-white/10 shadow-md cursor-pointer"
            title={canModify ? 'Options (modifier, couleur, verrouiller, déplacer, supprimer...)' : 'Changer la couleur'}
          >
            {/* Ticket #223 : "+" remplacé par les 3 petits points — ce
                bouton n'ajoute rien, il ouvre le panneau d'options
                complet (modifier/couleur/verrouiller/déplacer/supprimer),
                un "+" y prêtait à confusion avec une action d'ajout. */}
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Ticket #222 : le "+" centré en bas des dossiers a été retiré — il
          faisait doublon avec le bouton d'ajout déjà disponible (tuile
          "Ajouter dans ce dossier" une fois le dossier ouvert, et le "+"
          général de l'accueil). Le bouton Options en haut à droite de la
          tuile (juste au-dessus) reste inchangé, avec toutes ses actions. */}

      {/* iPhone Folder Rendering */}
      {tile.isFolder ? (
        <div className="flex flex-col items-center w-full px-1 z-20">
          {/* Mini 2x2 Grid Preview of contained icons */}
          <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl bg-black/35 backdrop-blur-md border border-white/15 p-1 sm:p-2 grid grid-cols-2 gap-1 sm:gap-1.5 items-center justify-center mb-2 sm:mb-3 shadow-inner group-hover:scale-105 transition-transform overflow-hidden">
            {(tile.children || []).slice(0, 4).map((subItem, i) => {
              const SubIcon = ICON_MAP[subItem.iconName] || LayoutGrid;
              return (
                <div key={i} className="w-4 h-4 sm:w-6 sm:h-6 rounded bg-white/10 flex items-center justify-center text-white p-0.5 overflow-hidden">
                  {subItem.imageUrl ? (
                    <img src={subItem.imageUrl} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <SubIcon className="w-2.5 h-2.5 sm:w-4 sm:h-4" />
                  )}
                </div>
              );
            })}
            {(!tile.children || tile.children.length === 0) && (
              <div className="col-span-2 text-[9px] text-gray-400 italic">Vide</div>
            )}
          </div>

          <div className="flex items-center justify-center gap-1.5 max-w-full mb-1 sm:mb-1.5">
            <Folder className="w-4 h-4 text-[#F7BC5F] shrink-0 drop-shadow-sm" />
            <h3 className="text-white font-bold text-sm sm:text-base md:text-lg tracking-tight truncate drop-shadow-sm">
              {tile.title}
            </h3>
          </div>

          {count > 0 && (
            <div className="bg-black/60 backdrop-blur-md border border-white/10 text-white font-bold text-[10px] sm:text-xs px-2.5 sm:px-3.5 py-0.5 rounded-full shadow-inner">
              {count}
            </div>
          )}
        </div>
      ) : (
        /* Regular Shortcut Tile Rendering */
        <div className="flex flex-col items-center w-full px-1 z-20">
          <div className="w-12 h-12 sm:w-18 sm:h-18 flex items-center justify-center mb-2 sm:mb-3 text-white transition-transform duration-300 group-hover:scale-110">
            {tile.imageUrl ? (
              <img
                src={tile.imageUrl}
                alt={tile.title}
                className="w-full h-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.65)]"
              />
            ) : (
              <Icon className="w-8 h-8 sm:w-14 sm:h-14 stroke-[1.5] drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]" />
            )}
          </div>

          <h3 className="text-white font-bold text-xs sm:text-base md:text-lg tracking-tight mb-1 sm:mb-2 drop-shadow-md line-clamp-1 max-w-full">
            {tile.title}
          </h3>

          <div className="flex flex-col items-center">
            {!tile.externalUrl && count > 0 ? (
              <div className="bg-black/60 backdrop-blur-md border border-white/10 text-white font-bold text-[10px] sm:text-xs px-2.5 sm:px-3.5 py-0.5 rounded-full shadow-inner">
                {count}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

// Variante de SortableTile pour la grille des sous-tuiles (contenu d'un
// dossier ouvert) — mêmes mécanismes @dnd-kit, gabarit plus compact.
// Calque de déplacement (dnd-kit DragOverlay) : copie identique à la tuile
// au repos (même dégradé, même bord, même ombre). Un liseré doré ou un
// agrandissement la faisait changer d'aspect pendant le passage.
const TuileFantome: React.FC<{ tile: TileItemNode; sousTuile?: boolean }> = ({ tile, sousTuile }) => {
  const Icon = ICON_MAP[tile.iconName] || LayoutGrid;
  return (
    <div
      className={`${sousTuile ? 'rounded-2xl p-4' : 'rounded-2xl sm:rounded-3xl p-3 sm:p-5'} w-full h-full bg-gradient-to-br ${tile.gradient} flex flex-col items-center justify-center text-center border border-t-white/35 border-l-white/20 border-r-black/30 border-b-black/50 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.65),inset_0_1px_2px_rgba(255,255,255,0.35)] cursor-grabbing overflow-hidden relative`}
    >
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 via-white/5 to-transparent rounded-t-2xl sm:rounded-t-3xl pointer-events-none z-10" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent rounded-b-2xl sm:rounded-b-3xl pointer-events-none z-10" />
      {tile.isFolder ? (
        <div className="flex flex-col items-center w-full px-1 z-20">
          <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl bg-black/35 border border-white/20 p-1 sm:p-2 grid grid-cols-2 gap-1 sm:gap-1.5 items-center justify-center mb-2 overflow-hidden shadow-inner">
            {(tile.children || []).slice(0, 4).map((subItem, i) => {
              const SubIcon = ICON_MAP[subItem.iconName] || LayoutGrid;
              return (
                <div key={i} className="w-4 h-4 sm:w-6 sm:h-6 rounded bg-white/10 flex items-center justify-center text-white p-0.5 overflow-hidden">
                  {subItem.imageUrl ? <img src={subItem.imageUrl} alt="" className="w-full h-full object-contain" /> : <SubIcon className="w-2.5 h-2.5 sm:w-4 sm:h-4" />}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-1.5 max-w-full">
            <Folder className="w-4 h-4 text-[#F7BC5F] shrink-0 drop-shadow-sm" />
            <h3 className="text-white font-bold text-sm sm:text-base md:text-lg tracking-tight truncate drop-shadow-sm">{tile.title}</h3>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center w-full px-1 z-20">
          <div className="w-12 h-12 sm:w-18 sm:h-18 flex items-center justify-center mb-2 text-white">
            {tile.imageUrl ? (
              <img src={tile.imageUrl} alt={tile.title} className="w-full h-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.65)]" />
            ) : (
              <Icon className="w-8 h-8 sm:w-14 sm:h-14 stroke-[1.5] drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]" />
            )}
          </div>
          <h3 className="text-white font-bold text-xs sm:text-base md:text-lg tracking-tight line-clamp-1 max-w-full drop-shadow-md">{tile.title}</h3>
        </div>
      )}
    </div>
  );
};

interface SortableSubTileProps {
  subItem: TileItemNode;
  count: number;
  isDragTarget: boolean;
  onActivate: () => void;
  // Signalé : impossible de modifier (logo/couleur) ou verrouiller une
  // tuile une fois qu'elle est dans un dossier — ce composant n'avait tout
  // simplement pas ces boutons, contrairement aux tuiles de la grille
  // principale. Alignés ici sur le même principe.
  onOpenPalette?: () => void;
  onEdit?: () => void;
  isSuperAdmin?: boolean;
  onToggleLock?: () => void;
  onOpenActionsMenu?: (e: React.MouseEvent) => void;
}

const SortableSubTile: React.FC<SortableSubTileProps> = ({ subItem, count, isDragTarget, onActivate, onOpenPalette, onEdit, isSuperAdmin, onToggleLock, onOpenActionsMenu }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, active } = useSortable({ id: subItem.id });
  const dragEnCours = active !== null;
  const SubIcon = ICON_MAP[subItem.iconName] || LayoutGrid;
  const isMobile = useIsMobile();
  // Ticket #113 : verrouillée = plus modifiable, mais toujours déplaçable.
  const canModify = !subItem.locked || isSuperAdmin;
  const canDrag = !isMobile;

  return (
    <div
      ref={setNodeRef}
      {...(canDrag ? attributes : {})}
      {...(canDrag ? listeners : {})}
      onClick={onActivate}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? 'none' : transform ? (transition || 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)') : undefined,
        opacity: isDragging ? 0 : undefined,
      }}
      className={`relative group h-40 sm:h-48 md:h-52 rounded-2xl sm:rounded-3xl bg-gradient-to-br ${subItem.gradient} p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 border border-t-white/35 border-l-white/20 border-r-black/30 border-b-black/50 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.65),inset_0_1px_2px_rgba(255,255,255,0.35)] select-none overflow-hidden ${
        isDragging || dragEnCours
          ? 'z-10 pointer-events-none'
          : isDragTarget
            ? 'border-[#F7BC5F] ring-4 ring-[#F7BC5F]/30 scale-105 z-40'
            : 'active:scale-[0.97] hover:scale-[1.03] hover:border-white/50 hover:shadow-[0_20px_35px_-10px_rgba(0,0,0,0.8),inset_0_1px_2px_rgba(255,255,255,0.45)] z-10'
      }`}
    >
      {/* 3D Glass Specular Reflection & Relief */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 via-white/5 to-transparent rounded-t-2xl sm:rounded-t-3xl pointer-events-none z-10" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent rounded-b-2xl sm:rounded-b-3xl pointer-events-none z-10" />

      {subItem.locked && (
        <div
          className="absolute top-2 left-2 flex items-center justify-center p-1 rounded-lg bg-black/60 text-[#F7BC5F] border border-[#F7BC5F]/30 shadow-md z-30"
          title="Verrouillée par le super admin"
        >
          <Lock className="w-3 h-3" />
        </div>
      )}

      {/* Ticket #120 : même simplification que la grille principale — un
          seul bouton "+" regroupant toutes les options. Présent aussi sur
          une carte verrouillée (3 septembre) : le menu s'y limite à
          « Changer la couleur », l'ordre se change en glissant. */}
      {onOpenActionsMenu && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
          <button
            onClick={(e) => { e.stopPropagation(); onOpenActionsMenu(e); }}
            className="p-1 rounded-lg bg-black/60 hover:bg-[#F7BC5F] text-white/80 hover:text-[#20170a] transition-colors border border-white/10 shadow-md cursor-pointer"
            title={canModify ? 'Options (modifier, couleur, verrouiller, déplacer, supprimer...)' : 'Changer la couleur'}
          >
            {/* Ticket #223 : "+" remplacé par les 3 petits points — ce
                bouton n'ajoute rien, il ouvre le panneau d'options
                complet (modifier/couleur/verrouiller/déplacer/supprimer),
                un "+" y prêtait à confusion avec une action d'ajout. */}
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {subItem.isFolder ? (
        <div className="flex flex-col items-center w-full px-1 z-20">
          <Folder className="w-10 h-10 sm:w-14 sm:h-14 text-[#F7BC5F] mb-2 drop-shadow-sm" />
          <span className="text-white font-bold text-sm sm:text-base md:text-lg drop-shadow-sm">{subItem.title}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center w-full px-1 z-20">
          <div className="w-12 h-12 sm:w-18 sm:h-18 flex items-center justify-center mb-1.5 sm:mb-2.5 text-white transition-transform duration-300 group-hover:scale-110">
            {subItem.imageUrl ? (
              <img src={subItem.imageUrl} alt={subItem.title} className="w-full h-full object-contain drop-shadow-md" />
            ) : (
              <SubIcon className="w-8 h-8 sm:w-14 sm:h-14 text-white stroke-[1.5] drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]" />
            )}
          </div>
          <span className="text-white font-bold text-xs sm:text-base md:text-lg drop-shadow-md">{subItem.title}</span>
          {subItem.externalUrl ? (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-[#FAD592] font-medium mt-1 bg-black/40 px-2 py-0.5 rounded-full border border-white/10">
              <ExternalLink className="w-2.5 h-2.5" /> Web
            </span>
          ) : count > 0 ? (
            <div className="mt-1 bg-black/60 backdrop-blur-md border border-white/10 text-white font-bold text-[10px] px-2.5 py-0.5 rounded-full shadow-inner">
              {count}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export const AccueilGrid: React.FC<AccueilGridProps> = ({
  onNavigate,
  unreadRemindersCount,
  unreadNotificationsCount,
  unreadMessagesCount,
  unreadMailCount,
  openSupportTicketsCount,
  onAskNovaAI,
  onOpenNova,
  novaOpen,
}) => {
  const liveStats = {
    rappels: unreadRemindersCount || 0,
    chat: unreadMessagesCount || 0,
    notifications: unreadNotificationsCount || 0,
    mail: unreadMailCount || 0,
    support: openSupportTicketsCount || 0,
  };

  // Signalé (23 septembre, téléphone tourné en paysage) : le logo Nova
  // flottant se retrouvait planté au milieu de la rangée de dossiers,
  // chevauchant deux tuiles. Cause : ce bouton n'est prévu QUE pour les
  // écrans assez larges pour lui laisser de la place en dessous de la
  // grille (`hidden sm:flex`, seuil à 640px) — un téléphone en paysage
  // dépasse allègrement ce seuil en largeur tout en restant un petit écran
  // tactile tenu à la main, sans la place qu'aurait un vrai ordinateur.
  // Ticket #116 : la règle "tuile Mail -> non lus" était dupliquée dans deux
  // endroits (tuile racine, tuile dans un dossier) et avait déjà divergé une
  // fois. Un seul point d'entrée pour TOUTE navigation déclenchée par une
  // tuile, quel que soit son niveau d'imbrication — élimine le risque que ça
  // se reproduise avec un futur niveau d'imbrication ou un autre chemin.
  const navigateToTile = (navTarget: string) => {
    const target = navTarget.trim().toLowerCase();
    if (target === 'mail') {
      onNavigate('mail-unread');
    } else {
      onNavigate(navTarget);
    }
  };

  // ── "Ma journée" — heure en direct + nombre réel de RDV du jour (Google
  // Calendar, exactement comme MobileHome — avant : comptait des tâches,
  // pas les vrais rendez-vous, d'où un chiffre qui ne correspondait pas). ──
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [todayCount, setTodayCount] = useState<number>(0);
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
          setTodayCount(count);
          setProchainRdv(prochainRendezVous(events, new Date()));
        }
      } catch {
        // Pas grave : compte simplement à 0 si Workspace n'est pas connecté.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const timeLabel = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // Ticket #53 : à l'origine personnalisable (bouton "+", localStorage
  // novasphere_priority_tiles_v1) — verrouillé depuis (30/08/2026, demande
  // explicite, voir plus bas) sur 4 tuiles fixes pour tout le monde.
  const priorityValueById: Record<string, number> = {
    rappels: liveStats.rappels,
    chat: liveStats.chat,
    agenda: todayCount,
    mail: liveStats.mail,
    support: liveStats.support,
  };
  const priorityOptions = useMemo(
    () =>
      INITIAL_TILES.flatMap((t) => (t.isFolder && t.children ? t.children : [t]))
        .filter((t) => t.navTarget)
        // `gradient` en plus (demande explicite : icône colorée dans "Priorités"
        // avec la même couleur que sa vraie tuile, pas une case grise neutre).
        .map((t) => ({ id: t.id, label: t.title, nav: t.navTarget, iconName: t.iconName, gradient: t.gradient })),
    []
  ).map((opt) => ({ ...opt, value: opt.id in priorityValueById ? priorityValueById[opt.id] : null }));
  // Demande explicite (30/08/2026, deux passages) : d'abord "les mettre par
  // défaut [pour] tous les utilisateurs, rappel chat mail et rendez-vous",
  // puis confirmé plus fermement ("il faut que rappel chat mail et agenda
  // soit ENCORE UNE FOIS prioritaire, on ne peut pas les modifier... ça
  // sera tout pour tous les utilisateurs") — la personnalisation (bouton
  // "+", cases à cocher pour masquer/afficher) est retirée : ces 4 tuiles
  // sont désormais fixes pour tout le monde, plus de choix par appareil.
  // PRIORITY_TILES_KEY (localStorage) n'est donc plus lu/écrit ici du tout.
  // Demandé le 2 septembre : « je veux simplement que la tuile de tableau de
  // bord soit sur la barre du haut ; ensuite on aura alerte, chat, agenda,
  // e-mail dans l'ordre, pour toutes les agences ». L'ordre est donc celui de
  // cette liste, et non plus celui, arbitraire, dans lequel les tuiles
  // apparaissent dans INITIAL_TILES : `filter` conservait l'ordre de la
  // source (rappels, chat, mail, agenda), pas celui demandé.
  const ORDRE_BARRE_HAUT = ['tableau-de-bord', 'rappels', 'chat', 'agenda', 'mail'];
  const visiblePriorityTiles = ORDRE_BARRE_HAUT.map((id) =>
    priorityOptions.find((o) => o.id === id)
  ).filter((o): o is (typeof priorityOptions)[number] => Boolean(o));
  // Une seule phrase sous les icônes. Les icônes elles-mêmes ne changent pas.
  const gesteDuMoment = texteProchainGeste({
    maintenant: now,
    rendezVous: prochainRdv,
    messagesNonLus: liveStats.chat,
    mailsNonLus: liveStats.mail,
    rappelsDuJour: liveStats.rappels,
  });

  // ── Barre NovaAI (texte + micro) ─────────────────────────────────────
  const [novaInput, setNovaInput] = useState('');
  const [listening, setListening] = useState(false);
  // Ticket #59 : logo Nova centré en bas, la barre de saisie n'apparaît
  // qu'au clic, avec un effet de tiroir qui se déploie vers la droite.
  const [novaBarOpen, setNovaBarOpen] = useState(false);
  const novaInputRef = useRef<HTMLInputElement>(null);
  const submitNovaPrompt = () => {
    const text = novaInput.trim();
    if (!text) return;
    onAskNovaAI?.(text);
    setNovaInput('');
  };
  const toggleVoiceInput = () => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      alert("La reconnaissance vocale n'est pas supportée par ce navigateur.");
      return;
    }
    if (listening) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    // Signalé (dictée répétée par endroits dans le CRM) : cet handler ne
    // relisait jamais que `e.results[0]`, jamais le dernier segment reconnu
    // — même défaut de fond que Nova/l'accueil, corrigé partout avec le même
    // remède. `assemblerDictee` (src/lib/dictee.ts) reconstruit correctement
    // la dictée, y compris le cas Android où plusieurs segments `isFinal` se
    // prolongent l'un l'autre.
    recognition.onresult = (e: any) => {
      setNovaInput((prev) => assemblerDictee(e.results, prev));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };
  // Remonté plus haut (était après [tiles, setTiles]) : nécessaire dès
  // l'initialisation de `tiles` pour cloisonner le stockage par agence
  // (voir HOME_TILES_KEY juste en dessous).
  const { agencies, activeAgency, isSuperAdmin, currentUser } = useAuth() as any;
  // Vraie sélection globale, jamais substituée — voir le commentaire sur
  // l'import plus haut. Ne sert qu'au garde-fou dans enregistrerVerrous.
  const { activeAgency: agenceActiveReelle } = useAgenceReelle();
  const isLight = useIsLightMode();
  // Signalé (17/09/2026) : "chaque utilisateur organise le placement comme
  // il veut, sauf que les tuiles changent de place quand on se reconnecte"
  // — les clés de cache (localStorage ci-dessous ET les deux Set
  // module-level tout en haut du fichier, qui évitent de relire le serveur
  // à chaque remontage) n'étaient indexées QUE par agence, jamais par
  // utilisateur. Sur un même onglet (poste partagé en agence, ou simple
  // reconnexion sans recharger la page), la disposition d'un compte
  // s'appliquait donc à un autre : le Set croyait la lecture serveur déjà
  // faite pour cette agence et ne la relançait pas pour le nouveau compte,
  // qui héritait de l'ordre laissé en localStorage par le compte précédent.
  // Clé composite utilisateur+agence partout où l'agence seule servait de
  // clé de synchronisation.
  const clefSyncTuiles = (agencyId: string) => `${currentUser?.uid || 'anon'}::${agencyId}`;
  // Signalé (19/09/2026, persiste après le correctif ci-dessus) : « les
  // tuiles ne gardent pas la même place, il faut se reconnecter et
  // réorganiser à chaque fois ». Reproduit même pour un SEUL utilisateur,
  // sans poste partagé : les deux Set module-level (tout en haut du
  // fichier) sont volontairement conservés au-delà d'un démontage
  // d'AccueilGrid, pour ne relire le serveur qu'une fois par onglet ouvert —
  // mais une déconnexion/reconnexion dans NovaCRM est un simple changement
  // d'état React (`supabase.auth.signOut()`), sans rechargement de page :
  // le même onglet garde donc le même module JS, et la clé
  // `${uid}::${agencyId}` de CE compte y est déjà marquée "déjà synchronisé"
  // depuis la session précédente. En se reconnectant, la lecture serveur ne
  // se relance donc plus — l'écriture repart directement de ce que le
  // navigateur avait en mémoire, potentiellement périmé si un autre
  // appareil a changé la disposition entre-temps, écrasant silencieusement
  // la version serveur plus récente. Un changement d'identité (connexion,
  // déconnexion, changement de compte) purge maintenant ces deux Set, pour
  // forcer une vraie relecture serveur à chaque fois, comme au tout premier
  // chargement de l'onglet.
  const identitePrecedenteRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const uid = currentUser?.uid ?? null;
    if (identitePrecedenteRef.current !== undefined && identitePrecedenteRef.current !== uid) {
      homeSyncLoadedAgencies.clear();
      homeSyncReadyAgencies.clear();
    }
    identitePrecedenteRef.current = uid;
  }, [currentUser?.uid]);
  // Signalé : un dossier créé en étant sur l'agence Immosphera se
  // retrouvait aussi visible en basculant sur une autre agence (Conseils
  // Finances...) — tout l'accueil personnalisé partageait la même clé de
  // stockage, sans distinction d'agence. Chaque agence a maintenant sa
  // propre clé, cloisonnée.
  const HOME_TILES_KEY = `novasphere_home_tiles_v3_${currentUser?.uid || 'anon'}_${activeAgency?.id || 'default'}`;
  // Migration (14 octobre, voir la note sur `currentUser` en haut du
  // fichier) : tant que `currentUser` valait `undefined`, cette clé était
  // TOUJOURS "_anon_", quel que soit le compte — la disposition
  // personnalisée de chacun vit donc encore là, sous une clé que son
  // compte (désormais réel) ne relira plus jamais tout seul. Repli
  // explicite, utilisé une seule fois par `loadTilesForKey` ci-dessous.
  const HOME_TILES_KEY_ANON = `novasphere_home_tiles_v3_anon_${activeAgency?.id || 'default'}`;
  // Signalé : "plusieurs fois le dossier Amanda" (et d'autres tuiles en
  // double) — cause trouvée : la ré-injection automatique des nouvelles
  // tuiles Immosphera ci-dessous ne cherchait qu'au premier niveau de la
  // grille. Si une tuile avait été déplacée DANS un dossier (via "Applications
  // existantes" ou le glisser iPhone), elle semblait "manquante" à ce
  // premier niveau à chaque rechargement, et une copie neuve était
  // réinjectée à côté — dupliquée indéfiniment. Cherche maintenant aussi
  // dans les dossiers, et déduplique par sécurité (garde la 1ère occurrence).
  const existsRecursive = (items: TileItemNode[], id: string): boolean =>
    items.some((t) => t.id === id || (t.children ? existsRecursive(t.children, id) : false));
  // Signalé (8 septembre) : « la tuile Communication qui revient, et la
  // tuile Carte (Novavisio) qui se retrouve tout en bas » — même famille de
  // bug que "plusieurs fois le dossier Amanda" ci-dessus, mais pour les
  // tuiles VERROUILLÉES : le contenu imposé par un verrou (agency_ui_settings
  // .home_layout.lockedTiles) n'est injecté qu'à l'AFFICHAGE (voir applyLocks
  // plus bas), jamais stocké dans la grille brute de l'utilisateur — la
  // réconciliation la croyait donc "manquante" à CHAQUE chargement et en
  // reposait une copie à la racine, tout en bas. `lockedTilesRef` (alimentée
  // dès que lockedTiles charge, voir plus bas) laisse reconcilierGrille
  // reconnaître ces id comme déjà couverts, sans jamais les dupliquer.
  // Signalé (8 octobre) : malgré le garde-fou ci-dessus (8 septembre), le
  // même symptôme revenait — parce qu'il arrive trop tard. `reconcilierGrille`
  // tourne de façon SYNCHRONE, dès `useState` (voir plus bas), donc avant
  // même le tout premier rendu ; `lockedTiles`, lui, n'est connu qu'après un
  // aller-retour réseau, dans un effet qui ne peut se déclencher qu'APRÈS ce
  // premier rendu. `lockedTilesRef.current` valait donc toujours `{}` au
  // moment précis où `idsCouvertsParVerrou` était consulté pour la toute
  // première fois de la session (et à chaque changement d'agence, pour la
  // même raison) : le garde-fou ajouté le 8 septembre ne protégeait donc en
  // pratique jamais personne, d'où des tuiles qui reviennent en double à la
  // racine, différentes à chaque fois selon ce qui était verrouillé ou non
  // au moment de CE chargement précis. Même remède déjà en place pour les
  // tuiles masquées (novasphere_hidden_tiles_v1, voir listerIdsMasquesAplatis
  // plus haut) : une dernière copie connue, gardée en localStorage et relue
  // ici de façon SYNCHRONE (écrite dès que la vraie réponse serveur arrive,
  // voir plus bas), donne à cette toute première réconciliation une réponse
  // même un peu ancienne plutôt que rien.
  const lockedTilesRef = useRef<Record<string, Verrou>>((() => {
    try {
      const brut = localStorage.getItem(`novasphere_locked_tiles_v1_${activeAgency?.id || 'default'}`);
      const valeur = brut ? JSON.parse(brut) : null;
      return valeur && typeof valeur === 'object' ? valeur : {};
    } catch {
      return {};
    }
  })());
  const idsCouvertsParVerrou = (id: string): boolean => {
    for (const [lockId, lock] of Object.entries(lockedTilesRef.current)) {
      if (lockId === id) return true;
      if ((lock.children || []).some((c) => c.id === id)) return true;
    }
    return false;
  };
  const dedupeRecursive = (items: TileItemNode[], seen = new Set<string>()): TileItemNode[] =>
    items
      .filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      })
      .map((t) => (t.children ? { ...t, children: dedupeRecursive(t.children, seen) } : t));

  // ── Synchronisation multi-appareils, par agence ──────────────────────────
  // Signalé (31/08/2026) : "les raccourcis dossiers qu'on crée ne sont pas
  // synchro avec le téléphone et la tablette".
  //
  // La synchronisation existait, mais `user_ui_settings.home_tiles` est UNE
  // SEULE colonne par utilisateur alors que l'accueil est cloisonné PAR
  // AGENCE. On y rangeait `{ agencyId, items }` : seule la disposition de la
  // DERNIÈRE agence enregistrée survivait côté serveur, et sur un autre
  // appareil la version serveur était ignorée dès qu'on n'était pas sur cette
  // agence-là — d'où la grille par défaut, sans les dossiers créés.
  //
  // On range maintenant un dictionnaire `{ [agencyId]: items }` : toutes les
  // agences coexistent. Les deux anciens formats restent lus (voir
  // `lireDispositionAgence`), donc rien n'est perdu à la mise à jour.
  // Lecture/écriture serveur : voir src/lib/dispositionAccueil.ts (une seule
  // écriture à la fois, dernière valeur seulement, chaque version datée).

  // Réconciliation d'une grille déjà enregistrée (localStorage OU serveur)
  // avec la définition actuelle des tuiles : ajout des modules apparus
  // depuis, retrait de ceux supprimés, réalignement des dossiers verrouillés.
  //
  // Demandé le 2 septembre : « la tuile Projets internes sur toutes les
  // agences ». Elle manquait sur les agences dont la grille vient du serveur
  // (user_ui_settings.home_tiles) : ce chemin-là n'appliquait que
  // normalizeTile, jamais cette réconciliation — une tuile ajoutée après la
  // dernière sauvegarde n'y apparaissait donc jamais.
  // Extrait de reconcilierGrille (voir son commentaire ci-dessous) pour être
  // réutilisable ailleurs — notamment sur le chemin de synchronisation
  // serveur, qui ne passe jamais par reconcilierGrille (voir "ATTENTION" plus
  // bas) mais doit quand même respecter les tuiles masquées par l'utilisateur.
  const listerIdsMasquesAplatis = (): Set<string> => {
    try {
      const hiddenRaw = localStorage.getItem('novasphere_hidden_tiles_v1');
      const flattenIds = (items: TileItemNode[]): string[] =>
        items.flatMap((t) => [t.id, ...(t.children ? flattenIds(t.children) : [])]);
      return new Set(flattenIds(hiddenRaw ? JSON.parse(hiddenRaw) : []));
    } catch {
      return new Set();
    }
  };
  const retirerTuilesMasqueesRecursif = (items: TileItemNode[], hiddenIds: Set<string>): TileItemNode[] =>
    items
      .filter((t) => !hiddenIds.has(t.id) || (t.id === 'reserver-camera' && !estAgenceConseilsFinances(activeAgency)))
      .map((t) => (t.children ? { ...t, children: retirerTuilesMasqueesRecursif(t.children, hiddenIds) } : t));

  // Signalé (23 septembre) : « Lucie et peut-être les autres courtiers n'ont
  // pas la tuile pipeline sur l'accueil ». Cause : leur grille vient du
  // SERVEUR (user_ui_settings.home_tiles) et ne passe jamais par
  // `reconcilierGrille` (voir "ATTENTION" plus bas dans cet effet) — un
  // compte dont la grille a été enregistrée avant l'existence de la tuile
  // "pipeline" à cet endroit ne la récupère donc jamais tout seul.
  //
  // On ne réactive PAS la réconciliation générale sur ce chemin (déjà
  // essayé et annulé le 2 septembre : elle sort les tuiles d'un dossier
  // VERROUILLÉ, dont le contenu n'est stocké nulle part dans la grille
  // brute, et les repose en double à la racine — voir la note "ATTENTION").
  // Ce correctif-ci reste volontairement étroit : il réinjecte 'pipeline'
  // UNIQUEMENT à l'intérieur du dossier 'folder-business' déjà présent tel
  // quel dans la grille brute (jamais à la racine, jamais si ce dossier
  // lui-même est absent), et seulement si rien ne le couvre déjà (verrou,
  // ou masquage volontaire de l'utilisateur) — donc sans le même risque de
  // doublon à la racine que la réconciliation générale.
  const reinjecterPipelineDansSonDossier = (items: TileItemNode[]): TileItemNode[] => {
    if (
      existsRecursive(items, 'pipeline') ||
      idsCouvertsParVerrou('pipeline') ||
      idsCouvertsParVerrou('folder-business') ||
      listerIdsMasquesAplatis().has('pipeline')
    ) {
      return items;
    }
    const pipelineTile = findInitialTile('pipeline');
    if (!pipelineTile) return items;
    return items.map((t) =>
      t.id === 'folder-business' ? { ...t, children: [...(t.children || []), pipelineTile] } : t
    );
  };

  // Réserve caméra (Immosphera & Novavisio) : sur un compte dont la grille
  // serveur (user_ui_settings.home_tiles) a été enregistrée sans cette tuile
  // ou l'avait masquée, la réconciliation serveur ne repasse jamais par
  // reconcilierGrille. On la réinjecte systématiquement ici pour Immosphera
  // et Novavisio si elle est absente de la grille.
  const reinjecterReserverCamera = (items: TileItemNode[]): TileItemNode[] => {
    if (estAgenceConseilsFinances(activeAgency)) return items;
    if (existsRecursive(items, 'reserver-camera') || idsCouvertsParVerrou('reserver-camera')) {
      return items;
    }
    const cameraTile = findInitialTile('reserver-camera');
    return cameraTile ? [...items, cameraTile] : items;
  };

  // Demande explicite (23 septembre) : « le dossier Communication ne sert
  // à rien, supprime-le sur tous les profils, mets la tuile [Support] à
  // l'extérieur, ça ne doit plus jamais revenir » — déjà signalé comme bug
  // récurrent (9 septembre : « le dossier Communication se recrée chez des
  // utilisateurs », voir le commentaire historique juste en dessous) avant
  // même d'être supprimé pour de bon. Retiré de INITIAL_TILES (plus haut) ;
  // migration forcée ici pour toute grille déjà enregistrée, quel que soit
  // son contenu, réutilisée aussi bien pour la réconciliation locale que
  // pour le chemin de synchronisation serveur (voir plus bas dans le
  // fichier) : le dossier disparaît, sa carte Support (la seule utile —
  // Chat/Mail sont de toute façon filtrées par removeQuickBarDuplicates)
  // rejoint la racine si elle n'y est pas déjà, en conservant la
  // personnalisation (couleur...) qu'elle avait dans le dossier plutôt que
  // de repartir du modèle par défaut.
  const retirerDossierCommunication = (items: TileItemNode[]): TileItemNode[] => {
    const dossierCommunication = items.find((t) => t.id === 'folder-comm');
    if (!dossierCommunication) return items;
    const supportDuDossier = dossierCommunication.children?.find((c) => c.id === 'support');
    const sansDossier = items.filter((t) => t.id !== 'folder-comm');
    if (existsRecursive(sansDossier, 'support')) return sansDossier;
    const supportTile = supportDuDossier || INITIAL_TILES.find((t) => t.id === 'support');
    return supportTile ? [...sansDossier, supportTile] : sansDossier;
  };

  const reconcilierGrille = (grille: TileItemNode[], ajouterManquantes = true): TileItemNode[] => {
    let base = grille;
    // Signalé (9 septembre, Sylvain) : « le dossier Communication se
    // recrée chez des utilisateurs alors qu'on a le chat tout en haut »
    // — cause trouvée : masquer TOUT le dossier (handleDeleteTile) retire
    // ses cartes AVEC lui, sans les ajouter individuellement à la liste des
    // tuiles masquées. Au chargement suivant, ses cartes qui sont aussi des
    // modules de NAV_ITEMS (ex. "Support" — pas "Chat"/"Mail", déjà
    // filtrés par removeQuickBarDuplicates) paraissent alors « manquantes »
    // comme une tuile toute neuve, et reviennent seules à la racine : ça
    // ressemble à des restes du dossier soi-disant supprimé qui repoussent.
    // (Le dossier lui-même n'existe de toute façon plus : voir
    // retirerDossierCommunication ci-dessus, correctif plus radical du 23
    // septembre — ce paragraphe reste pour le contexte historique.)
    // On calcule donc la liste des ids masqués ICI, en amont, aplatie
    // récursivement (les cartes d'un dossier masqué comptent comme
    // masquées elles aussi) et on l'intègre à `estAbsent` — plus aucun bloc
    // ci-dessous, générique ou dédié, ne peut donc réinjecter par erreur ce
    // qu'un dossier masqué emportait avec lui.
    const hiddenIds = listerIdsMasquesAplatis();
    // "Manquant" = absent de la grille brute ET pas déjà couvert par un
    // verrou (auquel cas applyLocks l'injectera tout seul, à sa vraie place,
    // sans jamais passer par ici — voir idsCouvertsParVerrou plus haut) ET
    // pas emporté par un dossier que l'utilisateur a lui-même masqué.
    const estAbsent = (id: string) =>
      !existsRecursive(base, id) && !idsCouvertsParVerrou(id) && (!hiddenIds.has(id) || (id === 'reserver-camera' && !estAgenceConseilsFinances(activeAgency)));
    // Nouvelle tuile "Immosphera 360" : l'ajouter aussi pour les grilles déjà
    // personnalisées/enregistrées qui ne l'ont pas encore, sinon changer
    // seulement INITIAL_TILES n'a aucun effet (cf. commentaire normalizeTile
    // plus haut sur ce même principe).
    if (ajouterManquantes && estAbsent('immosphera360')) {
      const immoTile = INITIAL_TILES.find((t) => t.id === 'immosphera360');
      if (immoTile) base = [...base, immoTile];
    }
    // Même principe pour les nouvelles tuiles Immosphera (Site internet,
    // Partenaires, Netty, Passerelle, Amanda) — la visibilité réelle est
    // filtrée plus loin par canSeeImmospheraExtras, ici on s'assure juste
    // qu'elles existent QUELQUE PART dans la grille sauvegardée (racine ou
    // dans un dossier).
    const missingExtras = ajouterManquantes ? IMMOSPHERA_EXTRA_TILE_IDS.filter((id) => estAbsent(id)) : [];
    if (missingExtras.length > 0) {
      const extraTiles = INITIAL_TILES.filter((t) => missingExtras.includes(t.id));
      base = [...base, ...extraTiles];
    }
    // Tuile Aura (Conseils Finances) — visibilité filtrée plus loin par
    // canSeeConseilsFinances ; ici on garantit seulement sa présence dans
    // les grilles déjà personnalisées, sans quoi ajouter la tuile à
    // INITIAL_TILES n'aurait aucun effet pour les comptes existants.
    const missingConseils = ajouterManquantes ? CONSEILS_EXTRA_TILE_IDS.filter((id) => estAbsent(id)) : [];
    if (missingConseils.length > 0) {
      const extraTiles = INITIAL_TILES.filter((t) => missingConseils.includes(t.id));
      base = [...base, ...extraTiles];
    }
    // Même principe pour la tuile "Carte" (Novavisio) — visibilité réelle
    // filtrée plus loin par canSeeNovavisio.
    const missingNovavisio = ajouterManquantes ? NOVAVISIO_EXTRA_TILE_IDS.filter((id) => estAbsent(id)) : [];
    if (missingNovavisio.length > 0) {
      const extraTiles = INITIAL_TILES.filter((t) => missingNovavisio.includes(t.id));
      base = [...base, ...extraTiles];
    }
    // Réserver caméra (Immosphera & Novavisio) — visible uniquement hors
    // Conseils Finances ; s'assurer qu'elle existe dans les grilles déjà enregistrées.
    if (!estAgenceConseilsFinances(activeAgency) && estAbsent('reserver-camera')) {
      const cameraTile = findInitialTile('reserver-camera');
      if (cameraTile) base = [...base, cameraTile];
    }
    // Nouvelle tuile "Pipeline interne" (raccourci vers Projets internes) —
    // même principe, pour les grilles déjà personnalisées/enregistrées.
    if (ajouterManquantes && estAbsent('projets-internes')) {
      const pipelineInterneTile = INITIAL_TILES.find((t) => t.id === 'projets-internes');
      if (pipelineInterneTile) base = [...base, pipelineInterneTile];
    }
    // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (3/16) : générique,
    // remplace les blocs "missingX" ci-dessus pour tout NOUVEAU module —
    // dès qu'un module de NAV_ITEMS (Sidebar.tsx, source unique de "quels
    // modules existent dans le CRM") a une tuile définie dans INITIAL_TILES,
    // elle est automatiquement ajoutée aux grilles déjà personnalisées qui
    // ne l'ont pas encore. Plus besoin d'écrire un bloc dédié à chaque
    // nouveau module : juste une entrée dans INITIAL_TILES suffit.
    const missingNavTiles = (ajouterManquantes ? NAV_ITEMS : []).filter((item) => item.id !== 'accueil' && estAbsent(item.id))
      .map((item) => findInitialTile(item.id))
      .filter((t): t is TileItemNode => Boolean(t));
    if (missingNavTiles.length > 0) {
      base = [...base, ...missingNavTiles];
    }
    // Ticket #255 : tuile "Annonce" — n'est pas un module de NAV_ITEMS (ce
    // n'est qu'un raccourci vers Paramètres → Annonces), donc pas couverte
    // par la réconciliation générique ci-dessus ; même principe manuel que
    // "projets-internes" un peu plus haut. Sa visibilité réelle (admin
    // uniquement) est filtrée plus loin, ici on s'assure juste qu'elle
    // existe dans les grilles déjà personnalisées/enregistrées.
    //
    // Une case invisible "nova-lock-spacer" avait été ajoutée ici pour
    // réserver la place du bouton flottant Nova, mais elle créait un vrai
    // trou visible dans la grille (signalé) — retirée : on nettoie aussi
    // celles déjà enregistrées dans les grilles personnalisées.
    const removeSpacer = (items: TileItemNode[]): TileItemNode[] =>
      items
        .filter((t) => t.id !== 'nova-lock-spacer')
        .map((t) => (t.children ? { ...t, children: removeSpacer(t.children) } : t));
    base = removeSpacer(base);
    // Demande explicite (30/08/2026) : "supprime la tuile assistant nova qui
    // ne servira jamais" — retirée de INITIAL_TILES (voir plus haut dans
    // 'folder-business'), mais comme pour "nova-lock-spacer" ci-dessus, ça
    // ne suffit pas pour les grilles déjà personnalisées/enregistrées en
    // localStorage : retrait forcé ici aussi, quel que soit l'endroit
    // (racine ou dossier) où elle aurait pu être placée par l'utilisateur.
    const removeAssistantIaTile = (items: TileItemNode[]): TileItemNode[] =>
      items
        .filter((t) => t.id !== 'assistant-ia')
        .map((t) => (t.children ? { ...t, children: removeAssistantIaTile(t.children) } : t));
    base = removeAssistantIaTile(base);
    base = retirerDossierCommunication(base);
    // Rappels & Alertes, Chat Équipe, Mail, Agenda & RDV, Tableau de bord :
    // déjà dans le bandeau "Ma journée / Priorités" (voir la fonction
    // `removeQuickBarDuplicates`, hissée au niveau module — même retrait
    // forcé appliqué aussi à une grille reçue du serveur, voir plus bas).
    base = removeQuickBarDuplicates(base);
    if (ajouterManquantes && estAbsent('annonce')) {
      const annonceTile = INITIAL_TILES.find((t) => t.id === 'annonce');
      if (annonceTile) base = [...base, annonceTile];
    }
    // Nouvelle tuile "Statistiques" (étiquettes) — pas un module de
    // NAV_ITEMS (ce n'est qu'un raccourci vers une vue dédiée), donc pas
    // couverte par la réconciliation générique ci-dessus. Ajout dédié ici
    // (recherche RÉCURSIVE via findInitialTile, nécessaire : elle vit dans
    // un dossier, jamais trouvée par le mécanisme générique IMMOSPHERA_EXTRA
    // _TILE_IDS ci-dessus qui ne cherche qu'au premier niveau) — sa
    // visibilité réelle, elle, est bien filtrée via ce même
    // IMMOSPHERA_EXTRA_TILE_IDS plus loin (canSeeImmospheraExtras).
    if (ajouterManquantes && estAbsent('statistiques-etiquettes')) {
      const statsTile = findInitialTile('statistiques-etiquettes');
      if (statsTile) base = [...base, statsTile];
    }
    // Signalé : une tuile masquée (poubelle, "novasphere_hidden_tiles_v1")
    // réapparaissait systématiquement au chargement suivant. Cause réelle :
    // pour cette réconciliation, une tuile masquée est indiscernable d'une
    // tuile toute NOUVELLE pas encore propagée (mêmes blocs missingX
    // ci-dessus) — jamais consultée jusqu'ici, la liste des tuiles masquées
    // ne servait qu'à l'écriture (handleDeleteTile), jamais à la lecture.
    // On la retire donc explicitement ici, après toute réconciliation, quel
    // que soit le chemin par lequel elle aurait pu être rajoutée.
    try {
      const hiddenRaw = localStorage.getItem('novasphere_hidden_tiles_v1');
      const hiddenIds = new Set<string>(
        (hiddenRaw ? JSON.parse(hiddenRaw) : []).map((t: TileItemNode) => t.id)
      );
      // Revu (28/08/2026) : la protection "les tuiles par défaut ne peuvent
      // pas être supprimées" couvrait TOUTES les tuiles par défaut (Rappels,
      // Pipeline, Tableau de bord...), ce qui empêchait un agent de masquer
      // durablement une tuile par défaut qu'il n'utilise pas — signalé
      // gênant, y compris par Sylvain lui-même sur "Rappels". Demande
      // explicite ensuite : "en production, cela ne doit pas du tout
      // toucher à l'ordre ni les conditions des tuiles de l'utilisateur mais
      // seulement les dossiers avec cadenas" — la protection est donc
      // resserrée aux seules tuiles/dossiers marqués `locked: true` dans
      // INITIAL_TILES (ex. Passerelle, voir "tuile obligatoire" plus haut) :
      // CELLES-LÀ restent impossibles à masquer durablement, partout, y
      // compris en production. Toute autre tuile par défaut, elle, reste
      // masquée si l'utilisateur l'a masquée — son ordre et ses réglages ne
      // sont plus jamais retouchés par cette réconciliation.
      if (hiddenIds.size > 0) {
        const stripHidden = (items: TileItemNode[]): TileItemNode[] =>
          items
            .filter((t) => !hiddenIds.has(t.id) || findInitialTile(t.id)?.locked === true || (t.id === 'reserver-camera' && !estAgenceConseilsFinances(activeAgency)))
            .map((t) => (t.children ? { ...t, children: stripHidden(t.children) } : t));
        base = stripHidden(base);
      }
    } catch {
      /* ignore */
    }
    // Ticket #279 : "tuile obligatoire" — un dossier marqué `locked: true`
    // dans INITIAL_TILES (ex. Passerelle) impose ses cartes ET sa couleur à
    // tout le monde : ni supprimables ni recolorables (canModify plus bas
    // gère déjà ce blocage), mais chacun garde la main pour en ajouter
    // d'autres à côté, et le dossier reste déplaçable. Ici, on réaligne la
    // grille déjà enregistrée d'un utilisateur sur la version admin
    // actuelle : les cartes/la couleur d'origine reviennent si elles ont pu
    // diverger (avant ce garde-fou, ou par un ancien contournement), sans
    // jamais toucher aux cartes que l'utilisateur a lui-même ajoutées.
    const resyncLockedFolders = (items: TileItemNode[]): TileItemNode[] =>
      items.map((item) => {
        const admin = findInitialTile(item.id);
        if (admin?.locked && admin.children) {
          const ownIds = new Set(admin.children.map((c) => c.id));
          const userExtras = (item.children || []).filter((c) => !ownIds.has(c.id));
          return { ...item, locked: true, gradient: admin.gradient, children: [...admin.children, ...userExtras] };
        }
        return item.children ? { ...item, children: resyncLockedFolders(item.children) } : item;
      });
    base = resyncLockedFolders(base);
    return dedupeRecursive(base);
  };

  const loadTilesForKey = (key: string, cleAnonRepli?: string): TileItemNode[] => {
    let saved = localStorage.getItem(key);
    // Migration (14 octobre) : rien sous la nouvelle clé par utilisateur ?
    // Reprise unique depuis l'ancienne clé "_anon_" si elle a quelque
    // chose, pour que l'affichage ne semble pas avoir disparu. Copiée
    // SANS horodatage frais — un poste partagé entre plusieurs comptes
    // écrivait tous sous cette même clé "_anon_" (currentUser valant
    // toujours undefined, voir plus haut), elle peut donc appartenir à
    // quelqu'un d'autre. Sans date, la règle déjà en place dans l'effet
    // de synchronisation plus bas s'applique : « à date inconnue, le
    // serveur reste la référence » — la vraie disposition de CE compte
    // (si elle existe déjà côté serveur, depuis un autre appareil) la
    // remplacera donc proprement dès la réponse serveur, au lieu de
    // l'écraser. Un compte qui n'a encore rien côté serveur (cas neuf)
    // garde cette reprise locale telle quelle. La clé "_anon_" est retirée
    // juste après : sur un poste partagé, un DEUXIÈME compte qui ouvrirait
    // l'accueil pour la toute première fois ne doit pas hériter à son tour
    // de la disposition du premier — il repart alors proprement de zéro.
    if (!saved && cleAnonRepli) {
      const ancien = localStorage.getItem(cleAnonRepli);
      if (ancien) {
        saved = ancien;
        try {
          localStorage.setItem(key, ancien);
          localStorage.removeItem(cleAnonRepli);
        } catch { /* ignore */ }
      }
    }
    let base = INITIAL_TILES;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          base = parsed.map((tile) => normalizeTile(tile));
        }
      } catch (e) {
        console.error('Failed to parse saved tiles:', e);
      }
    }
    return reconcilierGrille(
      base,
      // Pas d'injection tant que la liste des tuiles masquées du compte
      // n'est pas là : sinon Annonce et Bloc-notes, absentes de la grille
      // enregistrée, revenaient le temps d'un rendu.
      Boolean(activeAgency?.id && masquesPretsAgences.has(clefSyncTuiles(activeAgency.id))),
    );
  };
  const [tiles, setTiles] = useState<TileItemNode[]>(() => loadTilesForKey(HOME_TILES_KEY, HOME_TILES_KEY_ANON));

  // Ticket #256 : "positionnement libre comme sur mobile — pouvoir poser une
  // tuile où on veut, y compris seule sur une ligne à droite" (desktop
  // uniquement, mobile garde son système actuel). Contrairement à `tiles`
  // (liste dense, sans trou — reste la source de vérité du CONTENU : quelles
  // tuiles existent, dossiers, verrouillage...), `ROOT_SLOTS` ne détermine
  // QUE l'ORDRE D'AFFICHAGE de la grille racine, avec des cases vides
  // possibles entre deux tuiles — même principe que `cellIds` dans
  // MobileHome.tsx, mais appliqué UNIQUEMENT au niveau racine (jamais aux
  // dossiers ouverts, qui gardent leur grille dense classique).
  const ROOT_COLUMNS = 5;
  const ROOT_GRID_SLOTS = 30; // 5 colonnes × 6 lignes — large marge.
  const ROOT_SLOTS_KEY = `novasphere_home_slots_v5_${currentUser?.uid || 'anon'}_${activeAgency?.id || 'default'}`;
  // Même migration que HOME_TILES_KEY_ANON ci-dessus, pour les positions.
  const ROOT_SLOTS_KEY_ANON = `novasphere_home_slots_v5_anon_${activeAgency?.id || 'default'}`;
  // Ancien id sentinelle du bouton "Ajouter" quand il faisait partie de la
  // grille — conservé ici uniquement pour filtrer d'éventuelles anciennes
  // valeurs encore présentes dans le localStorage de certains utilisateurs
  // (voir plus bas) : le bouton est désormais remonté dans le bandeau du
  // haut (demande explicite), et n'est plus une tuile de la grille.
  const ADD_TILE_ID = '__add-tile__';
  const loadRootSlots = (key: string, currentTiles: TileItemNode[], cleAnonRepli?: string): (string | null)[] => {
    const realIds = currentTiles.filter((t) => t.id !== 'nova-lock-spacer').map((t) => t.id);
    let saved: (string | null)[] = [];
    try {
      let raw = localStorage.getItem(key);
      // Même migration que loadTilesForKey (voir sa note, 14 octobre) —
      // SANS horodatage frais non plus, même raison (poste partagé), et
      // même retrait de la clé "_anon_" une fois reprise.
      if (!raw && cleAnonRepli) {
        const ancien = localStorage.getItem(cleAnonRepli);
        if (ancien) {
          raw = ancien;
          localStorage.setItem(key, ancien);
          localStorage.removeItem(cleAnonRepli);
        }
      }
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) saved = parsed;
    } catch { /* ignore */ }
    const grid: (string | null)[] = Array(ROOT_GRID_SLOTS).fill(null);
    saved.slice(0, ROOT_GRID_SLOTS).forEach((id, i) => { if (typeof id === 'string' && id !== ADD_TILE_ID) grid[i] = id; });
    // "Ajoute les tuiles manquantes" — une tuile présente dans `tiles` (ex:
    // nouveau raccourci créé, ou nouvelle fonctionnalité activée) mais
    // absente de la grille de positions sauvegardée est insérée dans la
    // première case vide, sans toucher aux tuiles déjà placées.
    const present = new Set(grid.filter(Boolean));
    const missing = realIds.filter((id) => !present.has(id));
    let i = 0;
    for (const id of missing) {
      while (i < grid.length && grid[i] !== null) i++;
      if (i >= grid.length) break;
      grid[i] = id;
    }
    return grid;
  };
  // Incrémenté quand la liste des tuiles masquées change hors de ce
  // composant (synchronisation serveur, Paramètres) : `idsMasques` la relit à
  // chaque rendu, il suffit donc d'en provoquer un.
  const [versionMasquees, setVersionMasquees] = useState(0);
  // Un accueil démonté pendant la lecture des tuiles masquées (menu, fiche,
  // dossier) doit repeindre dès que la liste arrive — sinon il resterait
  // sur le rendu d'attente, ou pire sur une tuile déjà retirée.
  useEffect(() => {
    const ping = () => setVersionMasquees((v) => v + 1);
    masquesAuditeurs.add(ping);
    return () => { masquesAuditeurs.delete(ping); };
  }, []);
  // Incrémenté quand la grille serveur de l'agence est chargée : les effets
  // qui ne doivent écrire qu'après (voir plus bas) s'y accrochent.
  const [syncPrete, setSyncPrete] = useState(0);
  const [rootSlots, setRootSlots] = useState<(string | null)[]>(() => loadRootSlots(ROOT_SLOTS_KEY, tiles, ROOT_SLOTS_KEY_ANON));
  const rootSlotsKeyRef = useRef(ROOT_SLOTS_KEY);
  const rootSlotsRef = useRef(rootSlots);
  useEffect(() => { rootSlotsRef.current = rootSlots; }, [rootSlots]);
  // Remontée ici (elle vivait plus bas, juste avant l'effet qui date les
  // versions) pour que le rechargement ci-dessous, posé pendant le rendu,
  // puisse déjà s'en servir.
  const derniersSlotsRef = useRef(JSON.stringify(rootSlots));
  // 3 septembre : rechargement posé PENDANT LE RENDU, plus dans un effet —
  // signalé « en changeant de société, les tuiles/logos de l'accueil se
  // décalent, la nouvelle page n'arrive pas fluide ». Un effet s'exécute
  // après que le navigateur a déjà peint l'écran : la grille de l'ANCIENNE
  // société restait donc affichée un instant sous la nouvelle clé, avant de
  // sauter vers la bonne grille au rendu suivant — d'où le décalage visible.
  // En comparant la clé ici, un changement de société fait annuler ce rendu
  // intermédiaire par React, qui repart aussitôt avec la bonne grille sans
  // jamais peindre celle de l'ancienne société (voir la même technique
  // juste en dessous pour `tiles`/HOME_TILES_KEY).
  if (rootSlotsKeyRef.current !== ROOT_SLOTS_KEY) {
    rootSlotsKeyRef.current = ROOT_SLOTS_KEY;
    const recharges = loadRootSlots(ROOT_SLOTS_KEY, tiles, ROOT_SLOTS_KEY_ANON);
    derniersSlotsRef.current = JSON.stringify(recharges);
    setRootSlots(recharges);
  }
  // Nouvelle tuile ajoutée à `tiles` après le montage (raccourci créé,
  // dossier créé...) et absente des slots déjà en mémoire : même logique
  // de comblement que loadRootSlots, réappliquée à chaud.
  useEffect(() => {
    setRootSlots((prev) => {
      const present = new Set(prev.filter(Boolean));
      const missing = tiles.filter((t) => t.id !== 'nova-lock-spacer' && !present.has(t.id)).map((t) => t.id);
      if (missing.length === 0) return prev;
      const grid = [...prev];
      let i = 0;
      for (const id of missing) {
        while (i < grid.length && grid[i] !== null) i++;
        if (i >= grid.length) break;
        grid[i] = id;
      }
      return grid;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles]);
  // `derniersSlotsRef` (déclaré plus haut, avec le rechargement pendant le
  // rendu) : l'effet ci-dessous ne date une version que si elle a changé,
  // pas au simple (re)montage — sinon la grille du navigateur passerait
  // toujours pour plus récente que celle du serveur, et la synchronisation
  // entre appareils ne jouerait plus.
  useEffect(() => {
    const serialise = JSON.stringify(rootSlots);
    const change = serialise !== derniersSlotsRef.current;
    derniersSlotsRef.current = serialise;
    try { localStorage.setItem(ROOT_SLOTS_KEY, serialise); } catch { /* ignore */ }
    let maj = lireHorodatageLocal(ROOT_SLOTS_KEY) ?? 0;
    if (change) {
      maj = Date.now();
      ecrireHorodatageLocal(ROOT_SLOTS_KEY, maj);
    }
    // Même cloisonnement par agence que home_tiles ci-dessous (voir
    // commentaire détaillé plus bas) — même colonne serveur unique par
    // compte, donc même risque d'écrasement inter-agences sans `agencyId`.
    // Super admin : la case d'un dossier verrouillé suit ses déplacements
    // (voir Verrou.slot) — sans réécrire les verrous quand rien n'a bougé.
    if (change && isSuperAdmin && currentUser?.uid && activeAgency?.id && homeSyncReadyAgencies.has(clefSyncTuiles(activeAgency.id))) {
      const suivants: Record<string, Verrou> = { ...lockedTiles };
      let bouge = false;
      Object.entries(lockedTiles).forEach(([id, v]) => {
        const slot = rootSlots.indexOf(id);
        if (slot >= 0 && v.slot !== slot) { suivants[id] = { ...v, slot, maj: Date.now() }; bouge = true; }
      });
      if (bouge) void enregistrerVerrous(suivants, lockedTiles);
    }
    if (change && currentUser?.uid && activeAgency?.id && homeSyncReadyAgencies.has(clefSyncTuiles(activeAgency.id))) {
      ecrireDispositionAgence('home_root_slots', currentUser.uid, activeAgency.id, rootSlots, maj)
        // Signalé : "les tuiles déplacées ne se sauvegardent jamais à la
        // même place" — cette écriture serveur échouait en silence (erreur
        // avalée). Diagnostic temporaire : la journaliser au lieu de
        // l'ignorer, pour voir la vraie cause côté navigateur.
        .then((res) => {
          if (res.error) {
            console.error('[home_root_slots sync]', res.error);
            toast.error(`Sync position tuiles échouée : ${res.error.message}`);
          }
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootSlots, ROOT_SLOTS_KEY, activeAgency?.id]);
  // Signalé : "quand Isabelle met à jour son accueil, ça ne se sauvegarde
  // pas" — l'accueil n'était enregistré que dans le navigateur (localStorage),
  // donc perdu en navigation privée ou en changeant d'appareil. On
  // synchronise maintenant aussi sur le compte (table user_ui_settings,
  // déjà utilisée pour thème/signature) : au tout premier chargement, si le
  // compte a déjà une disposition enregistrée côté serveur, elle prend le
  // dessus sur celle du navigateur ; sinon le navigateur reste la source
  // (voir les deux effets juste au-dessus, inchangés) et est poussé au
  // serveur au fil des changements (voir plus bas).
  //
  // Signalé (28/08/2026) : "la version test ne retient pas quand je masque
  // des tuiles ou change l'ordre" — `user_ui_settings.home_tiles` est UNE
  // SEULE colonne par utilisateur, alors que la grille elle-même est
  // cloisonnée PAR AGENCE (HOME_TILES_KEY, ci-dessus). Pour un compte
  // multi-agences (le cas de Sylvain), ce chargement serveur remplaçait
  // sans distinction la grille de l'agence COURANTE par celle enregistrée
  // en dernier, quelle que soit l'agence active à ce moment-là — un masquage
  // ou un réordonnancement fait sur une agence pouvait donc être écrasé au
  // rechargement suivant par les données d'une AUTRE agence. On stocke donc
  // maintenant l'agence d'origine à côté des tuiles (`{ agencyId, items }`)
  // et on n'applique la synchronisation serveur que si elle correspond à
  // l'agence actuellement active ; sinon le navigateur (déjà cloisonné par
  // agence) reste seul maître. Un ancien enregistrement au format brut
  // (tableau, sans agencyId) est ignoré ici plutôt que risqué à tort.
  useEffect(() => {
    const agencyId = activeAgency?.id;
    if (!currentUser?.uid || !agencyId) return;
    const clefSync = clefSyncTuiles(agencyId);
    if (homeSyncLoadedAgencies.has(clefSync)) return;
    homeSyncLoadedAgencies.add(clefSync);
    (async () => {
      try {
        // Demandé le 2 septembre : « lors d'une mise à jour, je ne veux pas
        // que des tuiles réapparaissent ». La liste des tuiles masquées
        // suivait le navigateur, pas le compte : sur un autre poste, la
        // grille arrivait sans elle, et tout ressortait. On la réunit avec
        // celle du compte AVANT de poser la grille, puis on force un rendu
        // pour que les tuiles posées à l'affichage la respectent.
        await chargerMasqueesDepuisServeur(currentUser.uid);

        const { data } = await supabase
          .from('user_ui_settings')
          .select('home_tiles, home_root_slots')
          .eq('user_id', currentUser.uid)
          .maybeSingle();
        // 3 septembre : la version la plus RÉCENTE gagne, celle du navigateur
        // comme celle du serveur. Avant, le serveur l'emportait toujours —
        // même en retard d'une écriture (dossier créé, tuiles pas encore
        // parties), même sans date. Une grille locale datée et plus fraîche
        // est gardée et poussée au serveur ; à dates égales ou inconnues,
        // le serveur reste la référence (synchronisation entre appareils).
        // Clés du navigateur pour CETTE agence (celle du chargement), et non
        // l'agence active du moment : un super admin peut avoir changé
        // d'agence pendant la lecture.
        const cleTuiles = `novasphere_home_tiles_v3_${currentUser.uid}_${agencyId}`;
        const cleSlots = `novasphere_home_slots_v5_${currentUser.uid}_${agencyId}`;
        const toujoursActive = () => homeTilesKeyRef.current === cleTuiles;
        const lectureTuiles = lireDispositionAgence((data as any)?.home_tiles, agencyId);
        const tuilesServeur = lectureTuiles.items;
        const majLocaleTuiles = lireHorodatageLocal(cleTuiles) ?? 0;
        const localeTuilesPlusFraiche = majLocaleTuiles > (lectureTuiles.maj ?? 0);
        if (localeTuilesPlusFraiche) {
          homeSyncReadyAgencies.add(clefSync);
          const locales = toujoursActive() ? tilesRef.current : JSON.parse(localStorage.getItem(cleTuiles) || '[]');
          void ecrireDispositionAgence('home_tiles', currentUser.uid, agencyId, locales, majLocaleTuiles);
        } else if (tuilesServeur && tuilesServeur.length > 0) {
          // Signalé (capture d'une grille synchronisée depuis le serveur) :
          // Agenda & RDV / Rappels & Alertes / Tableau de bord réapparaissaient
          // malgré leur retrait de la grille (déjà dans le bandeau du haut) —
          // cette grille-ci vient du SERVEUR et ne passe jamais par
          // `reconcilierGrille` (voir la note juste en dessous), donc un
          // retrait qui n'aurait vécu que là-bas restait sans effet ici. Même
          // filtre, sûr sur une grille venue du serveur (ne touche que ces
          // identifiants précis, jamais le contenu d'un dossier verrouillé).
          //
          // Complété (19/09/2026) : cette liste fixe ne couvrait que 3 ids
          // précis (Agenda/Rappels/Tableau de bord) — une tuile MASQUÉE par
          // l'utilisateur (ex. tout un dossier "Communication", supprimé
          // localement mais dont la suppression n'avait pas encore atteint
          // le serveur au moment de cette lecture) réapparaissait donc quand
          // même dès que la version serveur, plus ancienne, l'emportait.
          // `retirerTuilesMasqueesRecursif` applique le MÊME filtre général
          // que `reconcilierGrille` (masquage utilisateur, `novasphere_
          // hidden_tiles_v1`) — sans toucher au contenu des dossiers
          // verrouillés, qui vit ailleurs (agency_ui_settings), jamais dans
          // cette liste.
          const normalisees = reinjecterReserverCamera(
            retirerTuilesMasqueesRecursif(
              retirerDossierCommunication(
                reinjecterPipelineDansSonDossier(
                  removeQuickBarDuplicates(
                    (tuilesServeur as TileItemNode[]).map((t) => normalizeTile(t))
                  )
                )
              ),
              listerIdsMasquesAplatis()
            )
          );
          try { localStorage.setItem(cleTuiles, JSON.stringify(normalisees)); } catch { /* ignore */ }
          if (lectureTuiles.maj) ecrireHorodatageLocal(cleTuiles, lectureTuiles.maj);
          if (!toujoursActive()) return;
          skipNextTilesSaveRef.current = true;
          derniersTilesRef.current = JSON.stringify(normalisees);
          // ATTENTION — ne pas repasser cette grille par reconcilierGrille.
          // Essayé le 2 septembre, pour que les nouveaux modules
          // apparaissent aussi sur les grilles synchronisées : les tuiles
          // ImmoSphera sont ressorties de leur dossier. Le contenu d'un
          // dossier VERROUILLÉ n'est pas stocké dans la grille (il est
          // imposé à l'affichage par applyLocks, à partir de
          // agency_ui_settings) : la réconciliation ne les trouve donc pas,
          // les croit disparues, et les repose à la racine. Même piège que
          // les « cinq Immosphera » du 1er septembre.
          setTiles(normalisees);
        }
        const lectureSlots = lireDispositionAgence((data as any)?.home_root_slots, agencyId);
        const slotsServeur = lectureSlots.items;
        const majLocaleSlots = lireHorodatageLocal(cleSlots) ?? 0;
        if (majLocaleSlots > (lectureSlots.maj ?? 0)) {
          homeSyncReadyAgencies.add(clefSync);
          const locaux = toujoursActive() ? rootSlotsRef.current : JSON.parse(localStorage.getItem(cleSlots) || '[]');
          void ecrireDispositionAgence('home_root_slots', currentUser.uid, agencyId, locaux, majLocaleSlots);
        } else if (slotsServeur) {
          const valeur = slotsServeur as (string | null)[];
          try { localStorage.setItem(cleSlots, JSON.stringify(valeur)); } catch { /* ignore */ }
          if (lectureSlots.maj) ecrireHorodatageLocal(cleSlots, lectureSlots.maj);
          if (!toujoursActive()) return;
          derniersSlotsRef.current = JSON.stringify(valeur);
          setRootSlots(valeur);
        }
      } catch {
        /* best-effort — le navigateur reste la source si le serveur échoue */
      } finally {
        homeSyncReadyAgencies.add(clefSync);
        marquerMasquesPrets(clefSync);
        setSyncPrete((v) => v + 1);
        setVersionMasquees((v) => v + 1);
      }
    })();
  }, [currentUser?.uid, activeAgency?.id]);
  // `activeAgency` peut n'être connu qu'après le premier rendu (chargement
  // du profil), et un super admin peut aussi changer d'agence active SANS
  // que ce composant soit démonté — dans les deux cas, on recharge alors la
  // bonne grille cloisonnée au lieu de rester bloqué sur celle lue trop tôt.
  const homeTilesKeyRef = useRef(HOME_TILES_KEY);
  // Empêche l'effet de sauvegarde juste en dessous d'écrire, l'espace d'un
  // rendu, les anciennes tuiles (encore en mémoire) sous la NOUVELLE clé —
  // ce qui écraserait la grille déjà enregistrée de l'agence qu'on vient
  // d'ouvrir avant que le rechargement ci-dessus n'ait fini de s'appliquer.
  const skipNextTilesSaveRef = useRef(false);
  // Grille courante et dernière valeur enregistrée (sérialisée), lisibles
  // depuis le chargement serveur asynchrone ci-dessus.
  const tilesRef = useRef(tiles);
  const derniersTilesRef = useRef(JSON.stringify(tiles));
  // 3 septembre : rechargement posé PENDANT LE RENDU, plus dans un effet —
  // signalé « en changeant de société, les tuiles/logos de l'accueil se
  // décalent, la nouvelle page n'arrive pas fluide ». Un effet ne s'exécute
  // qu'après que le navigateur a déjà peint l'écran : la grille de
  // l'ANCIENNE société restait donc affichée un instant sous la nouvelle
  // clé, avant de sauter vers la bonne grille au rendu suivant — exactement
  // le décalage/saccade signalés. En comparant la clé ici, React annule ce
  // rendu intermédiaire et repart aussitôt avec la bonne grille, sans
  // jamais peindre celle de l'ancienne société.
  // Le `setOpenFolderStack([])` qui vivait ici a été retiré : redondant
  // avec l'effet dédié un peu plus bas (`[activeAgency?.id]`, « je ne peux
  // pas cliquer sur les maisons »), qui couvre déjà exactement ce cas —
  // `HOME_TILES_KEY` change précisément quand `activeAgency?.id` change.
  if (homeTilesKeyRef.current !== HOME_TILES_KEY) {
    homeTilesKeyRef.current = HOME_TILES_KEY;
    skipNextTilesSaveRef.current = true;
    const rechargees = loadTilesForKey(HOME_TILES_KEY, HOME_TILES_KEY_ANON);
    derniersTilesRef.current = JSON.stringify(rechargees);
    setTiles(rechargees);
  }

  // La tuile Immosphera 360 ne doit apparaître QUE pour les utilisateurs de
  // l'agence Immosphera (tous rôles confondus, admin d'agence inclus) —
  // demande explicite : ni Conseils Finances ni Novavisio ne doivent la
  // voir, même leurs admins. Pas d'exception pour le super admin non plus :
  // il ne la voit que quand son agence active est bien Immosphera, comme
  // n'importe quel autre utilisateur — uniquement basé sur l'agence, jamais
  // sur le rôle. (agencies/activeAgency/isSuperAdmin remontés plus haut)
  // CORRECTIF (31/08/2026) — signalé : "il ne faut pas que les agences aient
  // accès aux statistiques d'Immosphera ; Natacha y a accès et Conseils
  // Finances aussi". La règle ci-dessous DEVAIT déjà se fonder sur la seule
  // agence active — c'est ce qu'annonçait son commentaire — mais elle testait
  // `Array.isArray(agencies) ? agencies : [activeAgency]`. Or `agencies` est
  // TOUJOURS un tableau : le repli sur l'agence active n'était jamais atteint,
  // et il suffisait qu'Immosphera figure quelque part dans la liste des
  // agences connues pour que tout le monde voie ses tuiles.
  const estImmosphera = (a: { name?: string | null; slug?: string | null } | null | undefined) =>
    /immosphera/i.test(a?.name ?? '') || /immosphera/i.test(a?.slug ?? '');

  const canSeeImmosphera = useMemo(
    () => estImmosphera(activeAgency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAgency?.id],
  );

  // Tuiles Immosphera "extra" (Site internet, Partenaires, Netty,
  // Passerelle, Amanda) — signalé : le super admin (Sylvain) les voyait
  // encore alors même que son agence active était "Conseils Finances", ce
  // qui n'était pas voulu. Alignées désormais sur EXACTEMENT la même règle
  // que la tuile Immosphera 360 elle-même : uniquement selon l'agence
  // active, sans exception de rôle — y compris pour le super admin, qui ne
  // les voit que lorsqu'il bascule lui-même sur l'agence Immosphera.
  const canSeeImmospheraExtras = canSeeImmosphera;

  // Tuile "Carte" (prospection Novavisio) — même principe que
  // canSeeImmosphera ci-dessus : uniquement selon l'agence active, sans
  // exception de rôle.
  // Conseils Finances — agence active uniquement, comme les deux autres.
  const canSeeConseilsFinances = useMemo(
    () => estAgenceConseilsFinances(activeAgency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAgency?.id],
  );

  // Dossiers « Banques » / « Assurances » : testés sur la VRAIE agence active
  // (contexte natif), pas sur le shim qui retombe sur Conseils Finances dès que
  // « Toutes les agences » est sélectionné.
  const canSeeBanquesAssurances = estAgenceConseilsFinances(agenceActiveReelle);
  // Le dossier « Immosphera » a été recopié dans les autres sociétés. On le
  // juge sur la vraie agence active, comme Banques / Assurances.
  const peutVoirDossierImmosphera = estAgenceImmosphera(agenceActiveReelle);

  // Même correctif que canSeeImmosphera juste au-dessus : agence active
  // uniquement, jamais la liste complète des agences.
  const canSeeNovavisio = useMemo(
    () => /novavisio/i.test(activeAgency?.name ?? '') || /novavisio/i.test((activeAgency as any)?.slug ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAgency?.id],
  );

  // Démasquage automatique de Réserver caméra sur Immosphera et Novavisio si elle
  // a été marquée masquée globalement (ex: masquée depuis Conseils Finances).
  useEffect(() => {
    if (!canSeeConseilsFinances) {
      const masques = lireMasquees();
      if (masques.some((t) => t.id === 'reserver-camera')) {
        void reafficherTuile(currentUser?.uid, 'reserver-camera').then(() => {
          setVersionMasquees((v) => v + 1);
        });
      }
    }
  }, [canSeeConseilsFinances, currentUser?.uid]);

  // Tuile "Annonce" (30/08/2026) : "que pour les super admin... Philippe,
  // Mélanie et Sylvain qui resteront toujours super admin" — déjà couvert
  // par isSuperAdmin ci-dessous. Laetitia Pioche : "on va la rajouter en
  // admin et on verra pour le droit plus tard, mais on peut déjà lui
  // mettre la tuile par défaut" — les droits (rôle super_admin) restent
  // délibérément à décider plus tard ; liste explicite ici plutôt que de
  // toucher à son rôle, pour n'accorder QUE cette tuile en attendant,
  // aucun autre accès admin.
  const ANNONCE_TILE_EXTRA_UIDS = new Set([
    '3c6797de-456a-4988-8358-7e3d813e9474', // Laetitia Pioche (voir src/data/teamMembers.ts)
  ]);
  const canSeeAnnonceTile = isSuperAdmin || (currentUser?.uid ? ANNONCE_TILE_EXTRA_UIDS.has(currentUser.uid) : false);

  // ── Verrouillage de tuiles par le super admin ────────────────────────
  // Demande explicite : le super admin doit pouvoir imposer à tous les
  // membres d'une agence (couleur/texte/logo/lien d'une tuile ou d'un
  // dossier, non modifiables/déplaçables/supprimables pour eux). Comme les
  // tuiles elles-mêmes ne sont personnalisées qu'en localStorage (propre à
  // chaque navigateur, jamais partagé), le verrouillage doit vivre côté
  // serveur pour s'appliquer à tout le monde — stocké dans la colonne JSON
  // déjà existante `agency_ui_settings.home_layout.lockedTiles`, avec
  // synchronisation en direct (même mécanisme que l'ordre des onglets dans
  // Paramètres) pour qu'un verrouillage posé par le super admin s'applique
  // immédiatement, sans recharger, chez tous les membres déjà connectés.
  const [lockedTiles, setLockedTiles] = useState<Record<string, Verrou>>(() => {
    try {
      const brut = localStorage.getItem(`novasphere_locked_tiles_v1_${activeAgency?.id || 'default'}`);
      const valeur = brut ? JSON.parse(brut) : null;
      return valeur && typeof valeur === 'object' ? valeur : {};
    } catch {
      return {};
    }
  });
  // Même principe que le rechargement des tuiles pendant le rendu : au
  // changement de société, ne pas peindre un instant les verrous de
  // l'agence précédente (ni un objet vide, qui laissait sortir les cartes
  // d'un dossier le temps du chargement).
  const lockedAgencyRef = useRef(activeAgency?.id);
  if (lockedAgencyRef.current !== activeAgency?.id) {
    lockedAgencyRef.current = activeAgency?.id;
    let suivants: Record<string, Verrou> = {};
    try {
      const brut = localStorage.getItem(`novasphere_locked_tiles_v1_${activeAgency?.id || 'default'}`);
      const valeur = brut ? JSON.parse(brut) : null;
      if (valeur && typeof valeur === 'object') suivants = valeur;
    } catch { /* ignore */ }
    lockedTilesRef.current = suivants;
    setLockedTiles(suivants);
  }
  useEffect(() => { lockedTilesRef.current = lockedTiles; }, [lockedTiles]);
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
      if (error) { console.warn('Erreur chargement tuiles verrouillées :', error); return; }
      const locked = (data?.home_layout as any)?.lockedTiles;
      if (locked && typeof locked === 'object') {
        setLockedTiles(locked);
        try { localStorage.setItem(`novasphere_locked_tiles_v1_${activeAgency.id}`, JSON.stringify(locked)); } catch { /* ignore */ }
      }
    })();
    const channel = supabase
      .channel(`agency_ui_settings_home_layout_${activeAgency.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agency_ui_settings', filter: `agency_id=eq.${activeAgency.id}` },
        (payload) => {
          const locked = (payload.new as any)?.home_layout?.lockedTiles;
          const valeur = locked && typeof locked === 'object' ? locked : {};
          setLockedTiles(valeur);
          try { localStorage.setItem(`novasphere_locked_tiles_v1_${activeAgency.id}`, JSON.stringify(valeur)); } catch { /* ignore */ }
        }
      )
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [activeAgency?.id]);

  // Applique les verrouillages du super admin par-dessus la personnalisation
  // locale — un utilisateur qui a déplacé/recoloré une tuile verrouillée
  // avant qu'elle ne le devienne verra quand même la version imposée.
  const applyLocks = (items: TileItemNode[]): TileItemNode[] =>
    items.map((item) => {
      const lock = lockedTiles[item.id];
      const withChildren = item.children ? { ...item, children: applyLocks(item.children) } : item;
      if (!lock) return { ...withChildren, locked: false };

      // Le contenu d'un dossier verrouillé est imposé lui aussi : les cartes
      // posées par le super admin reviennent chez tout le monde, même chez
      // quelqu'un qui les avait sorties. Chacun garde en revanche SON ordre
      // (demande explicite : « ils pourront changer l'ordre des dossiers à
      // l'intérieur »), et les cartes qu'il a ajoutées à côté sont laissées
      // en place — les retirer effacerait son travail sans prévenir.
      // `retires` n'est pas une propriété de tuile : on ne la propage pas.
      const { retires, children: enfantsImposes, gradient: couleurImposee, ...apparence } = lock;
      const idsRetires = new Set(retires || []);
      // 3 septembre : la couleur est à chacun dès qu'il l'a choisie
      // (couleurPerso) ; sinon celle du super admin s'applique, comme avant.
      const couleur = (u: TileItemNode | undefined, defaut: string) =>
        u?.couleurPerso && u.gradient ? { gradient: u.gradient, couleurPerso: true } : { gradient: couleurImposee ?? defaut };
      if (enfantsImposes && enfantsImposes.length > 0) {
        const idsImposes = new Set(enfantsImposes.map((c) => c.id));
        const enfantsUtilisateur = withChildren.children || [];
        const parId = new Map(enfantsUtilisateur.map((c) => [c.id, c] as [string, TileItemNode]));
        const rangDeLUtilisateur = new Map(enfantsUtilisateur.map((c, i) => [c.id, i] as [string, number]));
        // Le favori est à chacun : le verrou ne l'impose ni ne l'efface.
        const favorisUtilisateur = new Set(enfantsUtilisateur.filter((c) => c.favorite).map((c) => c.id));
        // 3 septembre : une carte imposée porte le cadenas, comme son
        // dossier. Le verrou lui laisse deux choses : sa couleur (si
        // l'utilisateur en a choisi une) et son ordre dans le dossier.
        const imposes = [...enfantsImposes]
          .sort((a, b) => (rangDeLUtilisateur.get(a.id) ?? 9999) - (rangDeLUtilisateur.get(b.id) ?? 9999))
          .map((c) => ({
            ...c,
            ...(parId.get(c.id)?.couleurPerso && parId.get(c.id)?.gradient ? { gradient: parId.get(c.id)!.gradient, couleurPerso: true } : {}),
            locked: true,
            ...(favorisUtilisateur.has(c.id) ? { favorite: true } : {}),
          }));
        // Audit du 2 septembre : une carte que le super admin a RETIRÉE du
        // dossier restait chez ceux qui l'avaient déjà, prise pour un ajout
        // personnel. Le verrou retient maintenant ces retraits.
        const ajoutsPersonnels = enfantsUtilisateur.filter((c) => !idsImposes.has(c.id) && !idsRetires.has(c.id));
        return { ...withChildren, ...apparence, ...couleur(withChildren, withChildren.gradient), children: [...imposes, ...ajoutsPersonnels], locked: true };
      }
      return { ...withChildren, ...apparence, ...couleur(withChildren, withChildren.gradient), locked: true };
    });

  // NOTE (1er septembre, au soir) : une version de ce correctif POSAIT sur
  // la grille toute tuile verrouillée absente, pour qu'un dossier verrouillé
  // existe chez tout le monde. Retiré le soir même : `lockedTiles` garde des
  // entrées d'anciens verrous dont l'id ne correspond plus à aucune tuile
  // vivante, et elles réapparaissaient toutes d'un coup — cinq « Immosphera »
  // sur le même écran. À reprendre en nettoyant d'abord la liste des verrous
  // (voir la recette). Le contenu imposé, lui, reste : il ne touche que les
  // tuiles réellement présentes.

  // Pose/retire un verrou — écrit directement dans agency_ui_settings pour
  // que ça s'applique à toute l'agence, pas seulement à ce navigateur.
  // Instantané d'une tuile tel qu'un verrou le retient : apparence et
  // contenu, sans ce qui appartient à chacun (favoris) ni les drapeaux
  // calculés à l'affichage (locked).
  const nettoyerPourVerrou = (items: TileItemNode[]): TileItemNode[] =>
    items.map((t) => {
      const { favorite, locked, couleurPerso, ...reste } = t;
      void favorite; void locked; void couleurPerso;
      return reste.children ? { ...reste, children: nettoyerPourVerrou(reste.children) } : reste;
    });
  const instantaneVerrou = (tile: Partial<TileItemNode>): Verrou => ({
    title: tile.title,
    iconName: tile.iconName,
    gradient: tile.gradient,
    imageUrl: tile.imageUrl,
    externalUrl: tile.externalUrl,
    navTarget: tile.navTarget,
    ...(tile.children ? { children: nettoyerPourVerrou(tile.children) } : {}),
  });

  // Écrit l'ensemble des verrous de l'agence — affichage optimiste, annulé
  // si l'écriture échoue.
  //
  // Signalé le 2 octobre (« j'ajoute une tuile dans le dossier verrouillé,
  // elle ne s'ajoute pas aux autres ») : un aléa réseau passager (fréquent
  // sur tablette) pendant l'un des deux aller-retours ci-dessous faisait
  // échouer l'écriture UNE fois ; le verrou repartait alors en arrière côté
  // serveur, et RIEN ne retentait — seul un toast, facile à manquer sur le
  // moment, le signalait. La tuile restait bien visible dans `tiles` (jamais
  // annulé, lui) : l'auteur de l'ajout continuait donc à la voir chez lui,
  // sans aucun signe que les autres, eux, ne l'avaient jamais reçue. Trois
  // essais, avec une courte pause entre chacun, avant d'abandonner pour de
  // bon et d'avertir.
  const enregistrerVerrous = async (next: Record<string, Verrou>, precedent: Record<string, Verrou>) => {
    if (!activeAgency?.id) return;
    // Audit stabilité (21 octobre, récidive — dossier Immosphera retrouvé
    // verrouillé jusque dans Conseils Finances) : `activeAgency` ici vient
    // du shim de compatibilité ImmoSphera (voir l'import plus haut), qui
    // substitue silencieusement Conseils Finances dès que la sélection
    // réelle est "Toutes les agences". Verrouiller/modifier un dossier
    // pendant ce temps-là écrivait alors, à l'insu de tous, dans le
    // registre de Conseils Finances — quelle que soit l'agence à qui ce
    // dossier appartient vraiment. On bloque ce cas précis ici, au point
    // d'écriture unique par lequel passent déjà toggleTileLock,
    // synchroniserVerrous et retirerVerrous.
    if (agenceActiveReelle?.id === 'all') {
      setLockedTiles(precedent);
      toast.error('Sélectionnez une agence précise (pas « Toutes les agences ») avant de verrouiller ou modifier un dossier.');
      return;
    }
    const agencyId = activeAgency.id;
    setLockedTiles(next);
    let echec: string | null = null;
    for (let tentative = 1; tentative <= 3; tentative += 1) {
      const { data: existing } = await supabase
        .from('agency_ui_settings')
        .select('home_layout')
        .eq('agency_id', agencyId)
        .maybeSingle();
      // Signalé (20 octobre, récidive du dossier Immosphera) : `next` part de
      // `lockedTiles` tel que CET appareil le connaît — un onglet resté
      // ouvert depuis avant qu'un autre super admin pose un nouveau verrou ne
      // le voit jamais, et toute action de ce côté-là réécrivait alors la
      // base sans lui, l'effaçant pour tout le monde. Un verrou que ni `next`
      // ni `precedent` ne mentionnent n'est pas un retrait voulu par CET
      // appareil : forcément posé ailleurs entretemps, il est conservé.
      const verrousServeur = ((existing?.home_layout as any)?.lockedTiles || {}) as Record<string, Verrou>;
      const aPreserver: Record<string, Verrou> = {};
      Object.keys(verrousServeur).forEach((id) => {
        if (!(id in next) && !(id in precedent)) aPreserver[id] = verrousServeur[id];
      });
      const nextFinal = Object.keys(aPreserver).length > 0 ? { ...aPreserver, ...next } : next;
      if (nextFinal !== next) setLockedTiles(nextFinal);
      const nextHomeLayout = { ...((existing?.home_layout as any) || {}), lockedTiles: nextFinal };
      // 3 septembre : un UPDATE refusé par la sécurité de la base, ou sans
      // ligne pour cette agence, ne renvoie aucune erreur — zéro ligne
      // modifiée, et le verrou revenait au rechargement suivant comme si de
      // rien n'était (« je dissous le dossier, rien ne fonctionne »). On
      // redemande la ligne écrite ; si elle manque, on la crée ; et si la
      // base refuse, on le dit au lieu de faire comme si.
      const { data: ecrites, error } = await supabase
        .from('agency_ui_settings')
        .update({ home_layout: nextHomeLayout, updated_at: new Date().toISOString() })
        .eq('agency_id', agencyId)
        .select('agency_id');
      echec = error ? error.message : null;
      if (!error && (!ecrites || ecrites.length === 0)) {
        const { error: errInsert } = await supabase
          .from('agency_ui_settings')
          .insert({ agency_id: agencyId, home_layout: nextHomeLayout, updated_at: new Date().toISOString() } as any)
          .select('agency_id');
        echec = errInsert ? `réglages de l'agence introuvables et impossibles à créer (${errInsert.message})` : null;
      }
      if (!echec) return;
      if (tentative < 3) await new Promise((resolve) => setTimeout(resolve, 600 * tentative));
    }
    console.error('Erreur verrouillage tuile :', echec);
    setLockedTiles(precedent);
    toast.error(`Verrou non enregistré : ${echec}`);
  };

  // Audit du 2 septembre : le verrou était une PHOTO prise au moment du clic
  // sur le cadenas. Une carte ajoutée ensuite par le super admin dans son
  // dossier verrouillé (glisser, « Ajouter à un dossier », « Ajouter dans ce
  // dossier »), un renommage, une couleur : rien ne partait chez les autres
  // tant qu'il ne déverrouillait pas pour reverrouiller. Après chaque
  // modification de sa grille, on réaligne donc les verrous sur ce qu'elle
  // contient — le dossier verrouillé du super admin EST la référence.
  // Appelé uniquement sur une action explicite (jamais sur un simple
  // chargement), pour qu'un appareil resté sur une vieille grille ne
  // réécrive pas un verrou plus récent.
  const synchroniserVerrous = (grille: TileItemNode[], base: Record<string, Verrou> = lockedTiles) => {
    if (!isSuperAdmin || !activeAgency?.id || !currentUser?.uid) return;
    const next: Record<string, Verrou> = { ...base };
    let change = false;
    // La grille du super admin fait foi, mais seulement une fois sa version
    // serveur chargée : un appareil resté sur une vieille grille ne doit pas
    // effacer un verrou posé ailleurs.
    const grilleFiable = homeSyncReadyAgencies.has(clefSyncTuiles(activeAgency.id));
    Object.entries(base).forEach(([id, verrou]) => {
      const tuile = findTileRecursive(grille, id);
      if (!tuile) {
        // 3 septembre : un verrou dont le dossier n'existe plus chez le super
        // admin (ni dans les tuiles fournies) est un fantôme — c'est lui qui
        // faisait réapparaître d'anciens dossiers chez les membres. On le
        // retire dès que le super admin touche à sa grille.
        if (grilleFiable && !findInitialTile(id)) { delete next[id]; change = true; }
        return;
      }
      const nouveau = instantaneVerrou(tuile);
      const ancien = instantaneVerrou(verrou);
      const slot = rootSlotsRef.current.indexOf(id);
      const slotChange = slot >= 0 && verrou.slot !== slot;

      // Audit stabilité (20 octobre, récidive du dossier Immosphera) :
      // `ancien` (issu de `base`, par défaut `lockedTiles`) est déjà tenu à
      // jour par le temps réel — l'ajout d'un raccourci par un AUTRE super
      // admin s'y reflète donc déjà correctement. Le vrai danger : `grille`
      // (l'arbre de CET appareil) peut contenir une copie figée, posée une
      // fois pour toutes (voir la repose automatique plus bas), d'un
      // dossier verrouillé que CET appareil ne maintient pas activement —
      // rien ne la rafraîchit jamais toute seule. Comparée à `ancien`, elle
      // semblait alors "différente", et N'IMPORTE QUELLE action SANS AUCUN
      // RAPPORT avec ce dossier (renommer un autre raccourci, changer une
      // couleur ailleurs...) réécrivait le verrou avec cette copie figée et
      // périmée, effaçant ce que l'autre super admin venait d'y ajouter.
      // On ne fait confiance à `nouveau` pour le CONTENU que si la copie de
      // CET appareil a elle-même changé entre l'arbre d'avant cette action
      // (tilesRef.current, pas encore mis à jour à cet instant précis de
      // l'événement) et celui d'après (grille) — seule preuve que c'est
      // bien CETTE action, sur CET appareil, qui a touché ce dossier.
      // Sinon, seule une éventuelle position différente sur la grille
      // racine est reprise ; le contenu enregistré, lui, ne bouge pas.
      const tuileAvant = findTileRecursive(tilesRef.current, id);
      const contenuToucheIci = !tuileAvant || JSON.stringify(instantaneVerrou(tuileAvant)) !== JSON.stringify(nouveau);
      const contenuAEcrire = contenuToucheIci ? nouveau : ancien;

      if (JSON.stringify(contenuAEcrire) === JSON.stringify(ancien) && !slotChange) return;
      const idsApres = new Set((contenuAEcrire.children || []).map((c) => c.id));
      const retires = new Set<string>((verrou.retires || []).filter((r) => !idsApres.has(r)));
      (ancien.children || []).forEach((c) => { if (!idsApres.has(c.id)) retires.add(c.id); });
      next[id] = {
        ...contenuAEcrire,
        ...(retires.size > 0 ? { retires: Array.from(retires) } : {}),
        ...(slot >= 0 ? { slot } : verrou.slot !== undefined ? { slot: verrou.slot } : {}),
        maj: Date.now(),
      };
      change = true;
    });
    if (change) void enregistrerVerrous(next, base);
  };

  // Audit du 2 septembre : supprimer ou dissoudre un dossier verrouillé
  // laissait son verrou en place — le dossier revenait chez tout le monde,
  // super admin compris, sans moyen de s'en défaire (c'est ainsi que les
  // anciens verrous se sont accumulés). Le verrou part avec le dossier.
  // Renvoie la nouvelle carte des verrous, pour enchaîner sans repartir de
  // l'ancienne.
  const retirerVerrous = (ids: string[]): Record<string, Verrou> => {
    if (!isSuperAdmin || !activeAgency?.id) return lockedTiles;
    const next: Record<string, Verrou> = { ...lockedTiles };
    let change = false;
    ids.forEach((id) => { if (next[id]) { delete next[id]; change = true; } });
    if (!change) return lockedTiles;
    void enregistrerVerrous(next, lockedTiles);
    toast.info('Verrou retiré : ce dossier n\'est plus imposé aux membres de l\'agence.');
    return next;
  };
  const idsDuSousArbre = (tileId: string): string[] => {
    const tuile = findTileRecursive(tiles, tileId);
    return [tileId, ...(tuile?.children ? flattenTileIds(tuile.children) : [])];
  };

  // Pose/retire un verrou — écrit directement dans agency_ui_settings pour
  // que ça s'applique à toute l'agence, pas seulement à ce navigateur.
  const toggleTileLock = async (tile: TileItemNode) => {
    if (!activeAgency?.id || !isSuperAdmin) return;
    const next = { ...lockedTiles };
    if (next[tile.id]) {
      delete next[tile.id];
    } else {
      // Demandé le 1er septembre : « du moment qu'un super admin verrouille
      // des dossiers, il faut que ce soit la même configuration pour tous
      // les autres utilisateurs ». Le verrou retient donc aussi le CONTENU
      // du dossier, pas seulement son apparence.
      const slot = rootSlotsRef.current.indexOf(tile.id);
      next[tile.id] = { ...instantaneVerrou(tile), ...(slot >= 0 ? { slot } : {}), maj: Date.now() };
    }
    await enregistrerVerrous(next, lockedTiles);
  };

  // 3 septembre (« le dossier Communication : les tuiles dedans s'enlèvent,
  // et quand on le dissout il revient au rafraîchissement ») : des verrous
  // FANTÔMES — anciens dossiers du même nom, supprimés avant que le verrou ne
  // parte avec — reposaient un dossier que le super admin venait de
  // dissoudre, et en retiraient les cartes de la racine. Un verrou dont le
  // dossier n'existe ni dans la grille de CE super admin ni parmi les
  // tuiles fournies est filtré de l'affichage local (verrousEffectifs).
  //
  // Signalé (14 octobre, voir la note sur `currentUser` en haut du fichier) :
  // l'écriture automatique qui effaçait aussi ce fantôme CÔTÉ SERVEUR, pour
  // toute l'agence, n'a jamais pu s'exécuter tant que `currentUser` valait
  // `undefined` (elle dépendait de `homeSyncReadyAgencies`, alimentée
  // uniquement par la synchronisation serveur, bloquée par le même bug).
  // Retirée plutôt que réactivée telle quelle : elle ne compare un verrou
  // qu'à la grille du SEUL super admin connecté à cet instant — un dossier
  // verrouillé par un AUTRE super admin (Mélanie), absent de la grille de
  // celui-ci, serait pris pour un fantôme et effacé pour toute l'agence.
  // Le filtrage d'affichage ci-dessous reste sans danger (local, jamais
  // écrit nulle part) ; une vraie purge partagée demande un garde-fou entre
  // super admins qui n'existe pas encore.
  //
  // 15 octobre (« les tuiles d'Immosphera sont sorties du dossier ») : ce
  // filtre local, lui aussi inactif jusqu'au 14 (même bug `currentUser`),
  // s'est mis à tourner — et il écartait le dossier verrouillé
  // « Immosphera » chez tout super admin dont la grille ne le contenait pas
  // (Mélanie). Le verrou écarté, ses cartes (Site internet, Partenaires,
  // Netty, Pool…) n'étaient plus « imposées par un dossier » et
  // réapparaissaient à la racine. Même raison que pour la purge serveur : on
  // ne peut pas juger un verrou d'après la grille d'UN super admin. Un
  // verrou qui décrit un vrai dossier (avec `children`) n'est donc plus
  // jamais traité comme fantôme ; seuls les anciens verrous sans contenu le
  // restent (ils ne reposent rien de toute façon).
  const fantomesVerrous = useMemo<string[]>(() => {
    if (!isSuperAdmin || !activeAgency?.id || !currentUser?.uid || !homeSyncReadyAgencies.has(clefSyncTuiles(activeAgency.id))) return [];
    return Object.keys(lockedTiles).filter(
      (id) => !Array.isArray(lockedTiles[id]?.children) && !existsRecursive(tiles, id) && !findInitialTile(id)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedTiles, tiles, isSuperAdmin, activeAgency?.id, currentUser?.uid, syncPrete]);
  const verrousEffectifs = useMemo<Record<string, Verrou>>(() => {
    if (fantomesVerrous.length === 0) return lockedTiles;
    const propres = { ...lockedTiles };
    fantomesVerrous.forEach((id) => { delete propres[id]; });
    return propres;
  }, [lockedTiles, fantomesVerrous]);

  // Folder Stack state for navigation inside open folders/nested folders
  const [openFolderStack, setOpenFolderStack] = useState<TileItemNode[]>([]);
  // Recherche globale (barre du haut) : « les noms des dossiers » — un
  // dossier choisi s'ouvre ici. La demande est relue au montage (l'accueil
  // n'était peut-être pas affiché au clic) et écoutée ensuite.
  useEffect(() => {
    const ouvrir = (id: string | undefined) => {
      if (!id) return;
      const dossier = findTileRecursive(tilesRef.current, id);
      if (dossier && dossier.isFolder) setOpenFolderStack([dossier]);
    };
    ouvrir(consommerOuvrirDossierAccueil());
    const onDemande = (e: Event) => ouvrir((e as CustomEvent<{ dossierId?: string }>).detail?.dossierId);
    window.addEventListener(EVENEMENT_OUVRIR_DOSSIER_ACCUEIL, onDemande);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_DOSSIER_ACCUEIL, onDemande);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Signalé (3 septembre) : « quand je suis sur cette fenêtre (dossier
  // ouvert), je ne peux pas cliquer sur les maisons » — les logos de société
  // en haut. Le clic passait, la société changeait, mais le dossier de
  // l'ancienne société restait ouvert par-dessus : rien ne semblait bouger.
  // Un changement de société referme le dossier.
  useEffect(() => {
    setOpenFolderStack([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgency?.id]);
  const activeFolder = openFolderStack.length > 0 ? openFolderStack[openFolderStack.length - 1] : null;
  const swipeBackRef = useSwipeBack<HTMLDivElement>(() => setOpenFolderStack(openFolderStack.slice(0, -1)), activeFolder !== null);

  // Selected tile for palette or options
  const [paletteTileId, setPaletteTileId] = useState<string | null>(null);
  // Menu d'actions consolidé (demande explicite) : Renommer / Ajouter à un
  // dossier / Masquer / Supprimer définitivement, regroupés derrière un
  // seul bouton au lieu d'icônes séparées qui encombraient la tuile.
  const [actionsMenuTileId, setActionsMenuTileId] = useState<string | null>(null);
  const [showFolderPickerFor, setShowFolderPickerFor] = useState<string | null>(null);
  // Ticket #50 : pouvoir masquer entièrement le bandeau "Ma journée +
  // Priorités" — un utilisateur qui n'en a pas l'usage peut ainsi
  // reprendre cet espace pour ses tuiles.
  const [showTopPanel, setShowTopPanel] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('novasphere_show_top_panel_v1');
      return saved === null ? true : JSON.parse(saved);
    } catch {
      return true;
    }
  });
  const toggleTopPanel = () => {
    setShowTopPanel((prev) => {
      const next = !prev;
      try { localStorage.setItem('novasphere_show_top_panel_v1', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  // "existing" : demande explicite — depuis un dossier, pouvoir y déplacer
  // des tuiles d'applications déjà existantes (Clients, Agenda...) au lieu
  // de devoir recréer un raccourci qui pointe vers la même page.
  const [addMode, setAddMode] = useState<'shortcut' | 'folder' | 'existing'>('shortcut');
  const [existingSelection, setExistingSelection] = useState<string[]>([]);
  // "Créer un dossier avec cette tuile" depuis le menu 3 points d'une tuile
  // — mémorise la tuile d'origine pour l'y déposer dès que le nouveau
  // dossier est créé via le même modal que la création classique.
  const [createFolderFromTileId, setCreateFolderFromTileId] = useState<string | null>(null);
  // Édition d'un raccourci déjà créé (id du raccourci en cours d'édition,
  // ou null en mode création) — réutilise le même modal que la création.
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newImageUrl, setNewImageUrl] = useState<string | null>(null);
  const [newIconName, setNewIconName] = useState('HomeIcon');
  const [newNavTarget, setNewNavTarget] = useState('');
  const [newGradient, setNewGradient] = useState(PRESET_GRADIENTS[1].value);

  // Folder rename modal
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  // Handle Image Upload for custom shortcut (PNG transparent, JPG, etc.)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Veuillez choisir un fichier image de moins de 5 Mo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setNewImageUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Open add modal reset
  const handleOpenAddModal = () => {
    setNewTitle('');
    setNewUrl('');
    setNewImageUrl(null);
    setNewIconName('HomeIcon');
    setNewGradient(PRESET_GRADIENTS[1].value);
    setNewNavTarget('');
    setAddMode('shortcut');
    setExistingSelection([]);
    setShowAddModal(true);
  };

  // Delete tile recursively
  // Supprimer une tuile ne la perd plus définitivement : elle est déplacée
  // vers une liste "masquée", consultable et réaffichable depuis Paramètres
  // (novasphere_hidden_tiles_v1) — utile en particulier pour les tuiles
  // d'origine (Support, Agenda...) qu'on ne peut pas recréer manuellement.
  const findTileRecursive = (items: TileItemNode[], id: string): TileItemNode | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const found = findTileRecursive(item.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Signalé en urgence ("je ne peux plus masquer") : bloquer purement et
  // simplement "Masquer" sur toute tuile par défaut (essayé un temps) était
  // trop large — DEFAULT_TILE_IDS couvre TOUT le contenu fourni par défaut
  // (Réserver caméra, Support, Notes...), pas seulement les modules
  // essentiels visés par la demande initiale (Tableau de bord, Pipeline).
  // Revenu au comportement normal : masquer reste possible pour tout,
  // exactement comme avant. La garantie "une tuile par défaut ne disparaît
  // jamais pour de bon" est assurée autrement (voir loadTilesForKey plus
  // haut, qui la réintègre silencieusement au chargement suivant même si
  // elle était dans la corbeille) — sans bloquer l'action elle-même.
  const handleDeleteTile = (tileId: string) => {
    // Repli sur la définition d'origine : une tuile posée à l'affichage
    // (nouveauté pas encore enregistrée dans la grille) n'est PAS dans
    // `tiles`. Sans ce repli, elle n'était jamais inscrite dans la liste des
    // tuiles masquées, et revenait donc au rendu suivant — « je ne peux pas
    // la masquer ».
    const tileToHide = findTileRecursive(tiles, tileId) || findInitialTile(tileId);

    const deleteRecursive = (items: TileItemNode[]): TileItemNode[] => {
      return items
        .filter(item => item.id !== tileId)
        .map(item => item.children ? { ...item, children: deleteRecursive(item.children) } : item);
    };

    const verrousRestants = retirerVerrous(idsDuSousArbre(tileId));
    const apresSuppression = deleteRecursive(inscrireAffichage(tiles, tileId));
    setTiles(apresSuppression);
    synchroniserVerrous(apresSuppression, verrousRestants);
    if (activeFolder) {
      setOpenFolderStack(prev => prev.map(f => f.id === activeFolder.id ? {
        ...f,
        children: f.children?.filter(c => c.id !== tileId)
      } : f));
    }

    if (tileToHide) {
      // Navigateur ET compte : masquée ici, masquée partout, mise à jour ou
      // non (voir src/lib/tuilesMasquees.ts).
      void masquerTuile(currentUser?.uid, { ...tileToHide }).then(() => setVersionMasquees((v) => v + 1));
    }
  };

  // Suppression DÉFINITIVE (demande explicite : un vrai bouton "poubelle"
  // distinct de "masquer") — même retrait que handleDeleteTile mais sans
  // passer par la liste des tuiles masquées, donc pas de "Réafficher"
  // possible ensuite.
  // Ticket #121 : réservée aux tuiles/dossiers créés par l'utilisateur — les
  // tuiles par défaut du CRM ne peuvent être que masquées, jamais effacées
  // pour de bon (même si ce garde-fou est contourné côté UI, il l'est aussi
  // ici pour ne jamais dépendre uniquement de l'affichage du bouton).
  const handlePermanentDeleteTile = (tileId: string) => {
    if (DEFAULT_TILE_IDS.has(tileId)) {
      toast.error("Cette tuile fait partie de celles fournies par défaut avec le CRM — elle ne peut être que masquée, pas supprimée définitivement.");
      return;
    }
    const deleteRecursive = (items: TileItemNode[]): TileItemNode[] =>
      items
        .filter((item) => item.id !== tileId)
        .map((item) => (item.children ? { ...item, children: deleteRecursive(item.children) } : item));

    const verrousRestants = retirerVerrous(idsDuSousArbre(tileId));
    const apresSuppression = deleteRecursive(inscrireAffichage(tiles, tileId));
    setTiles(apresSuppression);
    synchroniserVerrous(apresSuppression, verrousRestants);
    if (activeFolder) {
      setOpenFolderStack((prev) =>
        prev.map((f) => (f.id === activeFolder.id ? { ...f, children: f.children?.filter((c) => c.id !== tileId) } : f))
      );
    }
  };

  // "Ajouter à un dossier" depuis le menu d'actions — retire la tuile d'où
  // qu'elle soit actuellement (racine ou déjà dans un autre dossier) et
  // l'ajoute dans le dossier choisi.
  const handleMoveTileToFolder = (tileId: string, folderId: string) => {
    if (tileId === folderId) return;
    let moved: TileItemNode | null = null;
    const extractRecursive = (items: TileItemNode[]): TileItemNode[] =>
      items
        .filter((item) => {
          if (item.id === tileId) { moved = item; return false; }
          return true;
        })
        .map((item) => (item.children ? { ...item, children: extractRecursive(item.children) } : item));

    const withoutTile = extractRecursive(inscrireAffichage(tiles, tileId));
    // Garde-fou : jamais de dossier dans un dossier, quel que soit le
    // chemin emprunté pour y arriver.
    if (!moved || (moved as TileItemNode).isFolder) return;
    const insertRecursive = (items: TileItemNode[]): TileItemNode[] =>
      items.map((item) => {
        if (item.id === folderId) return { ...item, children: [...(item.children || []), moved as TileItemNode] };
        if (item.children) return { ...item, children: insertRecursive(item.children) };
        return item;
      });
    const apresDeplacement = insertRecursive(withoutTile);
    setTiles(apresDeplacement);
    synchroniserVerrous(apresDeplacement);
    setOpenFolderStack([]);
  };

  // "Sortir du dossier" (demande explicite, à côté de "Dissoudre" qui vide
  // tout le dossier d'un coup) — ne retire QUE cette tuile-là, la remet à
  // la racine de l'accueil, laisse le reste du dossier intact.
  const handleExtractTileFromFolder = (tileId: string) => {
    let moved: TileItemNode | null = null;
    const extractRecursive = (items: TileItemNode[]): TileItemNode[] =>
      items
        .filter((item) => {
          if (item.id === tileId) { moved = item; return false; }
          return true;
        })
        .map((item) => (item.children ? { ...item, children: extractRecursive(item.children) } : item));
    const withoutTile = extractRecursive(inscrireAffichage(tiles, tileId));
    if (!moved) return;
    const apresSortie = [...withoutTile, moved];
    setTiles(apresSortie);
    synchroniserVerrous(apresSortie);
    setOpenFolderStack((prev) => prev.map((f) => ({ ...f, children: (f.children || []).filter((c) => c.id !== tileId) })));
  };

  // Signalé : "Réafficher" depuis Paramètres ne faisait rien tant que
  // l'accueil n'était pas déjà monté (l'ancien évènement partait dans le
  // vide sinon). Paramètres écrit maintenant directement dans le stockage
  // (cloisonné par agence) et envoie ce simple signal — on se contente de
  // relire depuis localStorage, que ce composant ait été monté ou non au
  // moment du clic.
  useEffect(() => {
    const onTilesChanged = () => setTiles(loadTilesForKey(HOME_TILES_KEY));
    window.addEventListener('novasphere:home-tiles-changed', onTilesChanged);
    return () => window.removeEventListener('novasphere:home-tiles-changed', onTilesChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HOME_TILES_KEY]);

  // Drag State — piloté par @dnd-kit/sortable, qui gère nativement les
  // grilles multi-lignes (contrairement à @hello-pangea/dnd, conçu pour des
  // listes 1D, et à l'ancien drag HTML5 natif qui ne marchait pas au toucher).
  // Signalé : "arrête de faire comme les iPhones (glisser une tuile sur une
  // autre pour créer un dossier), c'est trop complexe" — retiré. Le
  // glisser-déposer ne sert plus qu'à réordonner les tuiles ; créer un
  // dossier se fait via le "+" (Dossier iPhone) ou "Ajouter à un dossier" /
  // "Applications existantes" dans le menu d'une tuile.
  const mergeIntentId: string | null = null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  // Tuile en cours de déplacement — alimente le calque (TuileFantome) qui
  // suit le pointeur, à la racine comme dans un dossier ouvert.
  const [tuileEnDeplacement, setTuileEnDeplacement] = useState<TileItemNode | null>(null);
  const handleTileDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const source = activeFolder ? (enfantsDossierOuvert || []) : currentDisplayTiles;
    setTuileEnDeplacement(source.find((t) => t.id === id) || findTileRecursive(tiles, id) || null);
  };
  const handleTileDragCancel = () => setTuileEnDeplacement(null);

  // Save to localStorage — cloisonné par agence (HOME_TILES_KEY). Poussé au
  // serveur avec l'agence d'origine (`{ agencyId, items }`, voir commentaire
  // plus haut) pour ne jamais écraser la grille d'une AUTRE agence de ce
  // même compte au prochain chargement.
  useEffect(() => {
    tilesRef.current = tiles;
    if (skipNextTilesSaveRef.current) { skipNextTilesSaveRef.current = false; return; }
    const serialise = JSON.stringify(tiles);
    // Une version n'est datée que si elle a changé (voir derniersSlotsRef).
    const change = serialise !== derniersTilesRef.current;
    derniersTilesRef.current = serialise;
    localStorage.setItem(HOME_TILES_KEY, serialise);
    let maj = lireHorodatageLocal(HOME_TILES_KEY) ?? 0;
    if (change) {
      maj = Date.now();
      ecrireHorodatageLocal(HOME_TILES_KEY, maj);
    }
    if (change && currentUser?.uid && activeAgency?.id && homeSyncReadyAgencies.has(clefSyncTuiles(activeAgency.id))) {
      ecrireDispositionAgence('home_tiles', currentUser.uid, activeAgency.id, tiles, maj)
        // Diagnostic temporaire (même raison que home_root_slots juste
        // au-dessus) : journaliser l'erreur réelle au lieu de l'avaler, et
        // la remonter en toast pour ne pas dépendre de la console navigateur.
        .then((res) => {
          if (res.error) {
            console.error('[home_tiles sync]', res.error);
            toast.error(`Sync tuiles échouée : ${res.error.message}`);
          }
        });
    }
  }, [tiles, HOME_TILES_KEY, activeAgency?.id]);

  // Le glisser-déposer ne sert plus qu'à réordonner (voir plus haut) — plus
  // besoin de suivre un survol de fusion.
  const handleTileDragOver = () => {};

  // Fin du drag : réordonnancement dense dans un dossier ouvert, positions
  // libres (échange simple, cases vides possibles) à la racine — ticket
  // #256.
  const handleTileDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setTuileEnDeplacement(null);
    if (!over || active.id === over.id) return;

    if (activeFolder) {
      // Comportement inchangé : liste dense, jamais de trou.
      const currentList = activeFolder.children || [];
      const sourceItem = currentList.find((t) => t.id === active.id);
      const targetItem = currentList.find((t) => t.id === over.id);
      if (!sourceItem || !targetItem) return;
      const oldIndex = currentList.findIndex((t) => t.id === active.id);
      const newIndex = currentList.findIndex((t) => t.id === over.id);
      updateActiveFolderChildren(arrayMove(currentList, oldIndex, newIndex));
      return;
    }

    // Racine : positionnement libre — simple échange des deux positions
    // dans rootSlots (contrairement à arrayMove, ne comble jamais
    // automatiquement les trous : une tuile peut être posée seule sur sa
    // ligne, avec du vide autour). `over.id` peut être soit une vraie tuile,
    // soit une case vide (id synthétique `__empty-N__`, N = son index dans
    // rootSlots).
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith('__empty-')) return; // une case vide ne se déplace jamais elle-même
    // Tuile posée à l'affichage (absente de la grille et des cases) : on
    // l'inscrit d'abord, sinon le glisser retombait sans rien faire — c'est
    // ce qui empêchait de déplacer « Banques » et « Assurances ».
    if (!findTileRecursive(tiles, activeId)) {
      setTiles((prev) => inscrireAffichage(prev, activeId));
    }
    // 9 octobre (« les tuiles une fois en place reviennent souvent à leur
    // position d'origine, voire se mettent en aléatoire ») : les index
    // étaient calculés dans `rootSlots`, alors que l'écran affiche
    // `rootDisplaySlots`. Les deux divergent dès qu'une tuile est posée à
    // l'affichage sans case enregistrée (nouveauté, dossier verrouillé
    // reposé) : elle flottait dans « la première case vide » — donc changeait
    // de place à chaque déplacement d'une autre tuile — et lâcher une tuile
    // SUR elle ne trouvait aucun index (-1) : retour à la case de départ.
    // On part désormais de ce que l'utilisateur VOIT, on l'inscrit tel quel
    // dans `rootSlots`, puis on échange les deux cases.
    const affichage = rootDisplaySlots.map((t) => (t ? t.id : null));
    const fromIndex = affichage.indexOf(activeId);
    const toIndex = overId.startsWith('__empty-')
      ? Number(overId.slice('__empty-'.length, -2))
      : affichage.indexOf(overId);
    if (fromIndex === -1 || toIndex === -1 || Number.isNaN(toIndex) || toIndex >= ROOT_GRID_SLOTS) return;
    setRootSlots((prev) => {
      const next: (string | null)[] = Array.from({ length: ROOT_GRID_SLOTS }, (_, i) => prev[i] ?? null);
      const visibles = new Set(affichage.filter((id): id is string => Boolean(id)));
      // Les tuiles visibles quittent leur ancienne case enregistrée...
      for (let i = 0; i < next.length; i++) {
        if (next[i] && visibles.has(next[i] as string)) next[i] = null;
      }
      // ...et sont reposées exactement là où elles s'affichent. Une case
      // tenue par une tuile masquée/invisible est simplement libérée (elle
      // retrouvera la première case libre si elle redevient visible).
      affichage.forEach((id, i) => { if (id && i < next.length) next[i] = id; });
      const tmp = next[fromIndex];
      next[fromIndex] = next[toIndex];
      next[toIndex] = tmp;
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  };

  const updateActiveFolderChildren = (newChildren: TileItemNode[]) => {
    if (!activeFolder) return;
    const folderId = activeFolder.id;

    // Helper to recursively update folder in tiles tree
    const recursiveUpdate = (items: TileItemNode[]): TileItemNode[] => {
      return items.map(item => {
        if (item.id === folderId) {
          return { ...item, children: newChildren };
        }
        if (item.children) {
          return { ...item, children: recursiveUpdate(item.children) };
        }
        return item;
      });
    };

    const apresMiseAJour = recursiveUpdate(tiles);
    setTiles(apresMiseAJour);
    synchroniserVerrous(apresMiseAJour);
    setOpenFolderStack(prev => prev.map(f => f.id === folderId ? { ...f, children: newChildren } : f));
  };

  // Déplace des tuiles d'applications existantes (top niveau) dans le
  // dossier actuellement ouvert — demande explicite : pouvoir choisir des
  // apps déjà présentes plutôt que de recréer un raccourci en double.
  const moveExistingIntoFolder = (ids: string[]) => {
    if (!activeFolder || ids.length === 0) return;
    const folderId = activeFolder.id;
    const moved: TileItemNode[] = [];
    const remaining = tiles.filter((t) => {
      if (ids.includes(t.id)) { moved.push(t); return false; }
      return true;
    });
    const updated = remaining.map((t) =>
      t.id === folderId ? { ...t, children: [...(t.children || []), ...moved] } : t
    );
    setTiles(updated);
    synchroniserVerrous(updated);
    setOpenFolderStack((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, children: [...(f.children || []), ...moved] } : f))
    );
  };

  // Find tile by ID helper for palette modal
  const findTileById = (items: TileItemNode[], id: string): TileItemNode | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const found = findTileById(item.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Change tile color gradient
  //
  // Signalé : "quand dans test on change la couleur d'une tuile il faut
  // faire un refresh pour que la couleur soit prise en compte" — reproduit
  // pour une tuile À L'INTÉRIEUR d'un dossier ouvert : `tiles` (la source de
  // vérité, correctement enregistrée) était bien mis à jour, mais l'affichage
  // du dossier ouvert lit `openFolderStack` (un instantané pris au moment de
  // l'ouverture du dossier, voir plus haut), jamais synchronisé ici — d'où
  // l'ancienne couleur affichée jusqu'au prochain rechargement, qui reconstruit
  // tout depuis `tiles`. Même correctif que handleDeleteTile un peu plus bas
  // (qui, lui, synchronisait déjà openFolderStack).
  // Favoris (voir TileItemNode.favorite) : l'étoile ne déplace rien, elle
  // ajoute simplement la tuile au bandeau du haut. Le drapeau voyage avec la
  // grille, donc il est enregistré et synchronisé comme le reste.
  const toggleTileFavorite = (tileId: string) => {
    const basculer = (items: TileItemNode[]): TileItemNode[] =>
      items.map((item) => {
        if (item.id === tileId) return { ...item, favorite: !item.favorite };
        if (item.children) return { ...item, children: basculer(item.children) };
        return item;
      });
    setTiles(basculer(inscrireAffichage(tiles, tileId)));
    setOpenFolderStack((prev) => prev.map((f) => ({ ...f, children: basculer(f.children || []) })));
  };

  // Ouverture d'une tuile — un seul point d'entrée, partagé par la grille et
  // par le bandeau « Favoris » (sans quoi les deux divergeraient, comme cela
  // s'était déjà produit pour la règle « Mail → non lus », cf. ticket #116).
  const activerTuile = (tile: TileItemNode) => {
    if (tile.isFolder) {
      setOpenFolderStack([...openFolderStack, tile]);
    } else if (tile.id === 'immosphera-pool' && !tile.externalUrl) {
      // Ticket #221 : lien Google Sheets pas encore renseigné
      // (IMMOSPHERA_POOL_SHEET_URL) — message clair plutôt
      // qu'un onglet vide ou une navigation silencieuse.
      toast.error("Le lien du fichier partagé ImmoSphera Pool n'a pas encore été configuré.");
    } else if (tile.id === 'annonce') {
      // Ticket #255 : ouvre directement Paramètres → Annonces
      // (au lieu de l'écran Paramètres générique) — flag lu
      // une seule fois par ParametresView à son montage.
      try { sessionStorage.setItem('novaOpenParametresSection', 'announcements'); } catch { /* stockage indisponible, tant pis */ }
      navigateToTile('parametres');
    } else if (tile.externalUrl) {
      let url = tile.externalUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } else if (tile.navTarget) {
      navigateToTile(tile.navTarget);
    }
  };

  const handleUpdateColor = (tileId: string, gradientValue: string) => {
    // 3 septembre : sur une tuile verrouillée, la couleur est la seule
    // liberté laissée aux membres. Leur choix est marqué (couleurPerso)
    // pour que le verrou ne le recouvre plus à l'affichage. Le super admin,
    // lui, change la couleur du verrou pour tout le monde (synchroniserVerrous).
    const dansDossierVerrouille =
      !!activeFolder && ((lockedTiles[activeFolder.id]?.children || []) as TileItemNode[]).some((c) => c.id === tileId);
    const couleurPerso = !isSuperAdmin && (!!lockedTiles[tileId] || dansDossierVerrouille);
    const updateGradientRecursive = (items: TileItemNode[]): TileItemNode[] => {
      return items.map(item => {
        if (item.id === tileId) {
          return { ...item, gradient: gradientValue, ...(couleurPerso ? { couleurPerso: true } : {}) };
        }
        if (item.children) {
          return { ...item, children: updateGradientRecursive(item.children) };
        }
        return item;
      });
    };

    // Une tuile posée à l'affichage (carte imposée après coup, nouveauté…)
    // n'est peut-être pas encore dans la grille : voir inscrireAffichage.
    const apresCouleur = updateGradientRecursive(inscrireAffichage(tiles, tileId));
    setTiles(apresCouleur);
    synchroniserVerrous(apresCouleur);
    setOpenFolderStack((prev) => prev.map((f) => ({ ...f, children: updateGradientRecursive(f.children || []) })));
    setPaletteTileId(null);
  };

  // Ouvre le modal en mode édition, pré-rempli avec le raccourci existant.
  const openEditShortcut = (tile: TileItemNode) => {
    setEditingShortcutId(tile.id);
    setAddMode('shortcut');
    setNewTitle(tile.title);
    setNewUrl(tile.externalUrl || '');
    setNewImageUrl(tile.imageUrl || null);
    setNewIconName(tile.iconName || 'LayoutGrid');
    setNewNavTarget(tile.navTarget || '');
    setNewGradient(tile.gradient);
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setEditingShortcutId(null);
    setNewTitle('');
    setNewUrl('');
    setNewImageUrl(null);
    setCreateFolderFromTileId(null);
  };

  // Met à jour un raccourci existant, où qu'il soit (racine ou dans un
  // dossier), en conservant sa position et son badge.
  const updateShortcutRecursive = (items: TileItemNode[], id: string, updates: Partial<TileItemNode>): TileItemNode[] =>
    items.map((item) => {
      if (item.id === id) return { ...item, ...updates };
      if (item.children) return { ...item, children: updateShortcutRecursive(item.children, id, updates) };
      return item;
    });

  // Create new Shortcut or Folder
  const handleCreateNewItem = (e: React.FormEvent) => {
    e.preventDefault();

    if (addMode === 'existing') {
      moveExistingIntoFolder(existingSelection);
      setExistingSelection([]);
      setShowAddModal(false);
      return;
    }

    if (!newTitle.trim()) return;

    if (editingShortcutId) {
      const trimmedUrl = newUrl.trim();
      const updates: Partial<TileItemNode> = {
        title: newTitle.trim(),
        iconName: newIconName || 'LayoutGrid',
        gradient: newGradient,
        navTarget: trimmedUrl ? '' : newNavTarget,
        externalUrl: trimmedUrl || undefined,
        imageUrl: newImageUrl || undefined,
      };
      if (activeFolder) {
        updateActiveFolderChildren(updateShortcutRecursive(activeFolder.children || [], editingShortcutId, updates));
      } else {
        const apresEdition = updateShortcutRecursive(tiles, editingShortcutId, updates);
        setTiles(apresEdition);
        synchroniserVerrous(apresEdition);
      }
      closeAddModal();
      return;
    }

    // Garde-fou : pas de dossier dans un dossier, même si addMode valait
    // encore 'folder' par un vieux état (le bouton est déjà masqué).
    if (addMode === 'folder' && !activeFolder) {
      // "Créer un dossier avec cette tuile" (menu 3 points) : on retire la
      // tuile d'origine (racine ou dossier existant) et on la dépose direct
      // dans le nouveau dossier, comme sur iPhone.
      let seedTile: TileItemNode | null = null;
      let baseTiles = tiles;
      if (createFolderFromTileId) {
        // Signalé (5 septembre, « j'ai créé un dossier, il a pris la place de
        // Blocs/Notes ») : quand la tuile visée par "Créer un dossier avec
        // cette tuile" est elle-même un DOSSIER, ce filtre la retirait quand
        // même de `tiles` (le test "jamais de dossier dans un dossier"
        // n'arrivait qu'APRÈS, une fois l'extraction déjà faite) — le
        // dossier d'origine disparaissait purement et simplement, avec tout
        // son contenu, sans jamais être réinséré nulle part. Le filtre
        // laisse maintenant un dossier tranquille dès ce premier passage :
        // il n'est ni retiré, ni utilisé comme graine.
        const extractRecursive = (items: TileItemNode[]): TileItemNode[] =>
          items
            .filter((item) => {
              if (item.id === createFolderFromTileId) {
                if (item.isFolder) return true; // jamais de dossier dans un dossier : on ne l'extrait même pas
                seedTile = item;
                return false;
              }
              return true;
            })
            .map((item) => (item.children ? { ...item, children: extractRecursive(item.children) } : item));
        baseTiles = extractRecursive(tiles);
      }

      const newFolder: TileItemNode = {
        id: 'folder-' + Date.now(),
        title: newTitle.trim(),
        iconName: newIconName || 'Folder',
        gradient: newGradient,
        badgeCount: 0,
        navTarget: '',
        isFolder: true,
        children: seedTile ? [seedTile] : []
      };

      // activeFolder est garanti null ici (garde-fou ci-dessus) : jamais de
      // dossier créé à l'intérieur d'un autre dossier.
      //
      // Demandé (5 septembre) : « quand je crée un dossier il se met toujours
      // en bas, je veux que le dossier se mette en haut, pas besoin de prendre
      // de l'espace pour cela ».
      //
      // Le mettre en tête de `tiles` ne suffit PAS : à la racine, l'ordre
      // affiché ne vient pas de `tiles` mais de `rootSlots`, la grille de
      // positions (une case par emplacement). Une tuile absente de cette
      // grille y est posée dans la première case VIDE — donc après toutes les
      // autres, en bas. Il faut lui réserver explicitement la première case.
      //
      // Les deux sont donc mis à jour : `tiles` pour que l'intention tienne
      // même si la grille de positions devait être reconstruite de zéro
      // (loadRootSlots repart de l'ordre de `tiles`), et `rootSlots` pour
      // l'affichage d'aujourd'hui. Aucune case n'est ajoutée à la grille :
      // le dossier prend la première, les autres décalent d'un cran.
      setTiles([newFolder, ...baseTiles]);
      setRootSlots((prev) => {
        if (prev.includes(newFolder.id)) return prev;
        // On retire la première case vide pour la récupérer en tête : ce qui
        // est avant elle décale d'un cran, ce qui est après ne bouge pas, et
        // la grille garde exactement sa taille.
        const libre = prev.indexOf(null);
        if (libre < 0) {
          // Grille entièrement pleine (36 cases) : signalé par Sylvain
          // (« le dossier est apparu beaucoup plus bas ») — cause trouvée en
          // relisant ce correctif avant de le pousser plus loin. `pop()`
          // retirait alors la DERNIÈRE case, qui est presque toujours une
          // vraie tuile (rien ne libère jamais une case ailleurs : masquer,
          // supprimer ou ranger une tuile dans un dossier laisse son
          // identifiant en place ici). Cette tuile perdait sa position
          // enregistrée sans qu'on l'ait touchée, retombait ailleurs à
          // l'affichage sans plus pouvoir être glissée nulle part, et
          // c'était écrit tel quel sur le compte. On renonce donc à imposer
          // la première case dans ce seul cas : le dossier reste posé par
          // `tiles` (déjà mis à jour ci-dessus) et se pose tout seul, à
          // l'affichage, dans la première case VISIBLE encore libre — sans
          // jamais faire disparaître la position de quiconque.
          return prev;
        }
        const next = [...prev];
        next.splice(libre, 1);
        next.unshift(newFolder.id);
        return next;
      });
      setOpenFolderStack([]);
    } else {
      const trimmedUrl = newUrl.trim();
      const newShortcut: TileItemNode = {
        id: 'custom-' + Date.now(),
        title: newTitle.trim(),
        iconName: newIconName || 'LayoutGrid',
        gradient: newGradient,
        badgeCount: 0,
        navTarget: trimmedUrl ? '' : newNavTarget,
        externalUrl: trimmedUrl || undefined,
        imageUrl: newImageUrl || undefined,
      };

      if (activeFolder) {
        updateActiveFolderChildren([...(activeFolder.children || []), newShortcut]);
      } else {
        setTiles([...tiles, newShortcut]);
      }
    }

    setNewTitle('');
    setNewUrl('');
    setNewImageUrl(null);
    setCreateFolderFromTileId(null);
    setShowAddModal(false);
  };

  // Rename folder
  const handleRenameFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingFolderId || !renameTitle.trim()) return;

    const renameRecursive = (items: TileItemNode[]): TileItemNode[] => {
      return items.map(item => {
        if (item.id === renamingFolderId) {
          return { ...item, title: renameTitle.trim() };
        }
        if (item.children) {
          return { ...item, children: renameRecursive(item.children) };
        }
        return item;
      });
    };

    const apresRenommage = renameRecursive(tiles);
    setTiles(apresRenommage);
    synchroniserVerrous(apresRenommage);
    setOpenFolderStack(prev => prev.map(f => f.id === renamingFolderId ? { ...f, title: renameTitle.trim() } : f));
    setRenamingFolderId(null);
  };

  // Dissolve folder (extract contents back to parent)
  const handleDissolveFolder = (folderId: string) => {
    let folderToDissolve: TileItemNode | null = null;

    const findFolder = (items: TileItemNode[]): TileItemNode | null => {
      for (const item of items) {
        if (item.id === folderId) return item;
        if (item.children) {
          const found = findFolder(item.children);
          if (found) return found;
        }
      }
      return null;
    };

    const baseDissolution = inscrireAffichage(tiles, folderId);
    folderToDissolve = findFolder(baseDissolution);
    if (!folderToDissolve || !folderToDissolve.children) return;

    const dissolveRecursive = (items: TileItemNode[]): TileItemNode[] => {
      const result: TileItemNode[] = [];
      for (const item of items) {
        if (item.id === folderId) {
          result.push(...(item.children || []));
        } else if (item.children) {
          result.push({ ...item, children: dissolveRecursive(item.children) });
        } else {
          result.push(item);
        }
      }
      return result;
    };

    const verrousRestants = retirerVerrous([folderId]);
    const apresDissolution = dissolveRecursive(baseDissolution);
    setTiles(apresDissolution);
    synchroniserVerrous(apresDissolution, verrousRestants);
    setOpenFolderStack(prev => prev.filter(f => f.id !== folderId));
    // 3 septembre (Conseils Finances : « je veux dissoudre le dossier, rien
    // ne fonctionne ») : un dossier FOURNI avec le CRM (Stratégie & Ventes,
    // Communication & Mails…) dissous disparaît de la grille… et la règle des
    // « nouveautés » du 2 septembre le reposait aussitôt à l'affichage, avec
    // ses cartes d'origine, puisqu'il est absent de la grille sans être
    // masqué. On le retient donc comme masqué : ses cartes restent à
    // l'accueil, lui ne revient plus, et il reste récupérable dans
    // Paramètres → Réafficher.
    if (findInitialTile(folderId)) {
      void masquerTuile(currentUser?.uid, { ...folderToDissolve, children: [] }).then(() => setVersionMasquees((v) => v + 1));
    }
  };

  // Visibilité d'une tuile selon l'agence active — appliquée RÉCURSIVEMENT
  // (voir filtrerEnProfondeur juste après).
  //
  // Signalé (31/08/2026) : « supprime la tuile Statistiques pour les autres
  // agences sauf Immosphera ». Elle était bien filtrée… mais uniquement au
  // niveau affiché. Or elle vit DANS UN DOSSIER : l'aperçu 2×2 du dossier
  // rendait `tile.children` sans le moindre filtre, et l'icône Statistiques y
  // restait visible pour toutes les agences.
  // 3 septembre : « la tuile Réserver caméra pour Conseils Finances ne doit
  // jamais apparaître, cela ne sert à rien ». Masquée pour cette agence,
  // partout (racine, dossiers, aperçus), quel que soit le rôle.
  // Dossiers « Banques » et « Assurances » : Conseils Finances uniquement
  // (agence active, tous rôles confondus).
  //
  // `versionMasquees` force la relecture de la liste masquée. Une tuile
  // retirée (Annonce, ancien Bloc-notes) ne doit pas être peinte, même si
  // la réconciliation l'a remise dans `tiles` avant d'avoir cette liste.
  void versionMasquees;
  const idsMasques = new Set<string>(lireMasquees().map((t) => t.id));
  const tuileVisible = (t: TileItemNode) =>
    (!estDossierReserveConseilsFinances(t.title) || canSeeBanquesAssurances)
    && (!estDossierImmosphera(t.title) || peutVoirDossierImmosphera)
    && (t.id !== 'reserver-camera' || !canSeeConseilsFinances)
    && (t.id !== 'immosphera360' || canSeeImmosphera)
    && (!IMMOSPHERA_EXTRA_TILE_IDS.includes(t.id) || canSeeImmospheraExtras)
    && (!NOVAVISIO_EXTRA_TILE_IDS.includes(t.id) || canSeeNovavisio)
    && (!CONSEILS_EXTRA_TILE_IDS.includes(t.id) || canSeeConseilsFinances)
    && ((t.id !== 'annonce' && t.id !== 'nova-lock-spacer') || canSeeAnnonceTile)
    && (!idsMasques.has(t.id) || findInitialTile(t.id)?.locked === true || (t.id === 'reserver-camera' && !canSeeConseilsFinances));

  const filtrerEnProfondeur = (items: TileItemNode[]): TileItemNode[] =>
    items
      .filter(tuileVisible)
      .map((t) => (t.children ? { ...t, children: filtrerEnProfondeur(t.children) } : t));

  // Un seul passage : `filtrerEnProfondeur` applique `tuileVisible` à tous les
  // niveaux, y compris au contenu des dossiers. Les filtres à plat qui se
  // trouvaient ici faisaient double emploi — et surtout ne voyaient jamais ce
  // qui était rangé dans un dossier.
  // « Ils ne pourront pas sortir des dossiers » : une carte imposée par un
  // dossier verrouillé n'a rien à faire à la racine. Certaines grilles en
  // ont gardé une copie (posée à tort par la réconciliation, cf. la note
  // dans le chargement serveur juste au-dessus) : on ne l'affiche pas deux
  // fois — elle reste visible dans son dossier, où le verrou la place.
  // Sans verrou chargé, la liste est vide et rien n'est retiré.
  const racineFiltree = filtrerEnProfondeur(tiles);

  // Signalé le 2 septembre : « les tuiles ImmoSphera sont toutes dehors, c'est
  // pénible ». Un dossier verrouillé par le super admin peut avoir disparu de
  // la grille enregistrée d'un utilisateur (grille plus ancienne que le
  // verrou, dossier supprimé avant qu'il ne soit verrouillé, réconciliation
  // malheureuse...) : ses cartes se retrouvent alors éparpillées à la racine,
  // sans moyen de les ranger. On repose donc le dossier tel que le super
  // admin l'a verrouillé.
  //
  // ⚠️ Le 1er septembre, une première version de cette idée avait fait
  // apparaître CINQ « Immosphera » d'un coup : `lockedTiles` conserve des
  // verrous d'anciens dossiers, dont l'identifiant ne correspond plus à rien
  // mais dont le TITRE, lui, se répète. D'où les deux garde-fous ici : un
  // seul dossier par titre, et uniquement les verrous qui décrivent
  // réellement un dossier (avec des cartes).
  const sansCasse = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const dossiersVerrouillesAReposer: TileItemNode[] = [];

  // 3 septembre : le garde-fou « un seul dossier par titre » comparait aussi
  // aux dossiers PERSONNELS du membre. Un membre qui avait déjà un dossier
  // « Immosphera » à lui ne recevait jamais celui du super admin — et ses
  // cartes, retenues comme « imposées », disparaissaient de la racine sans
  // dossier pour les accueillir : « les tuiles sortent du dossier ». Le
  // dédoublonnage ne se fait plus qu'ENTRE verrous du même nom (le plus
  // récent l'emporte), les fantômes étant par ailleurs purgés côté super
  // admin (synchroniserVerrous).
  const meilleurParTitre = new Map<string, string>();
  Object.entries(verrousEffectifs).forEach(([id, v]) => {
    if (!Array.isArray(v.children)) return;
    const titre = sansCasse(v.title || '');
    if (!titre) return;
    const actuel = meilleurParTitre.get(titre);
    const score = (x: Verrou) => (x.maj || 0) * 1000 + (x.children?.length || 0);
    if (!actuel || score(v) > score(verrousEffectifs[actuel])) meilleurParTitre.set(titre, id);
  });

  const idsImposesParUnDossier = new Set<string>();
  Object.entries(verrousEffectifs).forEach(([dossierId, lock]) => {
    const verrou = lock as TileItemNode;
    const enfants = verrou.children;
    // Seuls les verrous qui décrivent un dossier (même vide : verrouillé
    // avant d'être rempli) sont reposés.
    if (!Array.isArray(enfants)) return;
    // Jamais reposé hors Conseils Finances (même si un verrou d'une autre
    // agence en porte encore un).
    if (estDossierReserveConseilsFinances(verrou.title) && !canSeeBanquesAssurances) return;
    if (estDossierImmosphera(verrou.title) && !peutVoirDossierImmosphera) return;

    // Présent dans la grille mais masqué par les droits : on n'y touche pas.
    // Le reposer contournerait un filtre de visibilité voulu.
    const presentDansLaGrille = existsRecursive(tiles, dossierId);
    const visible = existsRecursive(racineFiltree, dossierId);
    if (presentDansLaGrille && !visible) return;

    if (!presentDansLaGrille) {
      const titre = sansCasse(verrou.title || '');
      if (!titre || meilleurParTitre.get(titre) !== dossierId) return;
      dossiersVerrouillesAReposer.push({
        id: dossierId,
        title: verrou.title || 'Dossier',
        iconName: verrou.iconName || 'Folder',
        gradient: verrou.gradient || 'from-[#6B21A8] via-[#3B0764] to-[#1E1B4B]',
        badgeCount: 0,
        navTarget: '',
        imageUrl: verrou.imageUrl,
        isFolder: true,
        locked: true,
        children: enfants,
      });
    }
    // Que le dossier ait toujours été là ou qu'on vienne de le reposer, ses
    // cartes n'ont plus à traîner à la racine.
    enfants.forEach((enfant) => idsImposesParUnDossier.add(enfant.id));
  });

  // Audit du 2 septembre : un dossier reposé ci-dessus n'existait qu'à
  // l'AFFICHAGE. Chez un membre dont la grille ne l'avait pas, réordonner
  // ses cartes, y ajouter les siennes ou le mettre en favori ne faisait
  // rien (la grille enregistrée ne le connaissait pas), et sa case pouvait
  // changer à chaque rendu. On l'inscrit donc une fois pour toutes dans la
  // grille du membre — uniquement après le chargement de sa grille serveur,
  // pour ne pas écrire avant de savoir ce qu'elle contient — et on le sort
  // de sa liste de tuiles masquées, sans quoi la réconciliation du prochain
  // chargement le retirerait à nouveau. Les garde-fous de la repose (un
  // seul dossier par titre, verrous décrivant un vrai dossier) restent.
  const idsDossiersAReposer = dossiersVerrouillesAReposer.map((d) => d.id).join('|');
  useEffect(() => {
    const agencyId = activeAgency?.id;
    if (activeFolder || !agencyId || !currentUser?.uid || !homeSyncReadyAgencies.has(clefSyncTuiles(agencyId))) return;
    const aPoser = dossiersVerrouillesAReposer.filter((d) => !existsRecursive(tiles, d.id));
    if (aPoser.length === 0) return;
    setTiles((prev) => [
      ...prev,
      ...aPoser
        .filter((d) => !existsRecursive(prev, d.id))
        .map((d) => { const { locked, ...reste } = d; void locked; return reste; }),
    ]);
    // 3 septembre : le dossier prend la case qu'il occupe chez le super admin
    // (Verrou.slot) si elle est libre ; sinon la première libre, comme avant.
    // Une fois posé, il ne bouge plus (la grille du membre est enregistrée).
    // 15 octobre : les cartes du dossier qui traînaient à la racine libèrent
    // leurs cases (sinon des trous restaient à leur place), et si la case du
    // super admin est prise, le dossier prend celle de sa première carte.
    setRootSlots((prev) => {
      const next = [...prev];
      let change = false;
      aPoser.forEach((d) => {
        const idsEnfants = new Set((d.children || []).map((c) => c.id));
        let caseEnfant = -1;
        next.forEach((id, i) => {
          if (id && idsEnfants.has(id)) {
            if (caseEnfant === -1) caseEnfant = i;
            next[i] = null;
            change = true;
          }
        });
        if (next.includes(d.id)) return;
        const voulu = verrousEffectifs[d.id]?.slot;
        if (typeof voulu === 'number' && voulu >= 0 && voulu < next.length && next[voulu] === null) {
          next[voulu] = d.id;
          change = true;
        } else if (caseEnfant !== -1) {
          next[caseEnfant] = d.id;
          change = true;
        }
      });
      return change ? next : prev;
    });
    aPoser.forEach((d) => { void reafficherTuile(currentUser?.uid, d.id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsDossiersAReposer, activeFolder, activeAgency?.id, syncPrete]);

  // Signalé le 2 septembre : « je ne vois pas la tuile Académy ». Les grilles
  // synchronisées depuis le serveur ne passent plus par la réconciliation qui
  // ajoute les nouveautés — je l'avais retirée le matin même, parce qu'elle
  // faisait ressortir les cartes des dossiers verrouillés (voir la note dans
  // le chargement serveur). Conséquence : une tuile ajoutée au CRM
  // n'apparaissait plus jamais chez ceux dont la grille vient du serveur.
  //
  // On la pose donc à l'AFFICHAGE, et seulement dans les cas sûrs :
  //   - la tuile est réellement absente de la grille ;
  //   - ce n'est pas une carte imposée par un dossier verrouillé — c'est
  //     exactement ce qui avait fait sortir les tuiles ImmoSphera ;
  //   - elle n'a pas été mise à la corbeille par l'utilisateur ;
  //   - elle passe les filtres de visibilité comme n'importe quelle autre.
  // Rien n'est écrit dans la grille enregistrée : l'ordre de chacun est
  // intact, et la tuile prend simplement la première case libre.
  const dejaReposes = new Set(dossiersVerrouillesAReposer.map((d) => d.id));
  // Tant que la liste masquée du compte n'est pas réunie, on n'affiche
  // aucune « nouveauté » : c'est ce passage qui faisait surgir Annonce et
  // l'ancien Bloc-notes dans la première case libre, le temps d'un fondu.
  const masquesPrets = Boolean(activeAgency?.id && masquesPretsAgences.has(clefSyncTuiles(activeAgency.id)));
  const nouveautesAPoser = masquesPrets ? filtrerEnProfondeur(
        INITIAL_TILES.filter(
          (t) =>
            !existsRecursive(tiles, t.id) &&
            !idsImposesParUnDossier.has(t.id) &&
            (!idsMasques.has(t.id) || (t.id === 'reserver-camera' && !canSeeConseilsFinances)) &&
            // Un dossier verrouillé absent est déjà reposé juste au-dessus :
            // sans ce garde-fou, il apparaîtrait deux fois.
            !dejaReposes.has(t.id) &&
            // Signalé (5 septembre) : Rappels & Alertes et Agenda & RDV
            // (racine de INITIAL_TILES, donc candidats de CE filtre — "mail"
            // et "tableau-de-bord" vivent eux dans un dossier, jamais
            // itérés ici) revenaient malgré leur retrait de `tiles` : ce
            // garde-fou "nouveauté" les reposait aussitôt à l'affichage,
            // les prenant pour un module tout juste ajouté au CRM. Exclu ici
            // au même titre qu'un dossier verrouillé déjà reposé.
            !QUICK_BAR_DUPLICATE_IDS.has(t.id)
        )
      ) : [];

  // Grille de la société, calculée même quand un dossier est ouvert. La
  // remplacer par le contenu du dossier faisait surgir une tuile sur
  // l'accueil le temps que le voile apparaisse.
  const tuilesRacine = retirerDoublonsNotes([
    ...applyLocks(racineFiltree).filter((tuile) => !idsImposesParUnDossier.has(tuile.id)),
    ...dossiersVerrouillesAReposer,
    ...applyLocks(nouveautesAPoser),
  ]);
  const enfantsDossierOuvert = activeFolder
    ? (
        // Même contenu que l'aperçu de la tuile. Lire les cartes enregistrées
        // seules vidait le dossier : une liste vide est « vraie » en
        // JavaScript, donc elle masquait les cartes que le verrou ajoute
        // seulement à l'affichage. L'aperçu montrait deux icônes, l'intérieur
        // restait vide.
        findTileRecursive(tuilesRacine, activeFolder.id)?.children
        ?? activeFolder.children
        ?? []
      )
    : null;
  const currentDisplayTiles = enfantsDossierOuvert ?? tuilesRacine;

  // 3 septembre (Conseils Finances : « je ne peux pas gérer la tuile
  // Communication, ni déplacer Banques et Assurances où je veux ») : une
  // tuile posée à l'AFFICHAGE — nouveauté jamais enregistrée, dossier
  // verrouillé reposé, carte imposée — n'est ni dans `tiles` ni dans
  // `rootSlots`. Toute action dessus (glisser, sortir du dossier, masquer,
  // supprimer, dissoudre, favori) cherchait la tuile dans la grille
  // enregistrée, ne la trouvait pas, et ne faisait rien, sans un mot. On
  // l'inscrit donc dans la grille au moment où l'on agit dessus, telle
  // qu'elle est affichée (sans le drapeau `locked`, recalculé au rendu).
  const sansVerrou = (t: TileItemNode): TileItemNode => {
    const { locked, ...reste } = t;
    void locked;
    return reste.children ? { ...reste, children: reste.children.map(sansVerrou) } : reste;
  };
  const inscrireAffichage = (base: TileItemNode[], tileId: string): TileItemNode[] => {
    if (findTileRecursive(base, tileId)) return base;
    if (activeFolder && (activeFolder.children || []).some((c) => c.id === tileId)) {
      const enfants = applyLocks(activeFolder.children || []).map(sansVerrou);
      if (findTileRecursive(base, activeFolder.id)) {
        const poser = (items: TileItemNode[]): TileItemNode[] =>
          items.map((item) =>
            item.id === activeFolder.id
              ? { ...item, children: enfants }
              : item.children ? { ...item, children: poser(item.children) } : item
          );
        return poser(base);
      }
      return [...base, sansVerrou({ ...activeFolder, children: enfants })];
    }
    const affichee = tuilesRacine.find((t) => t.id === tileId)
      || enfantsDossierOuvert?.find((t) => t.id === tileId)
      || findInitialTile(tileId);
    return affichee ? [...base, sansVerrou(affichee)] : base;
  };

  // Cap à 24 tuiles réelles visibles sur l'accueil (ticket #256 : 6 colonnes
  // fixes × 4 lignes, au lieu de 7×3 quand la grille était responsive) — au-
  // delà, le reste part dans une tuile "Voir plus", ouverte comme un dossier
  // classique, pour que la barre NovaAI reste toujours visible sans avoir à
  // scrolller, quel que soit le nombre de tuiles ajoutées.
  const MAX_VISIBLE_TILES = 24;
  let overflowTiles: TileItemNode[] = [];
  // Racine uniquement (ticket #256) : `rootSlots` détermine l'affichage
  // avec cases vides possibles — `null` = case vide, gardant sa place dans
  // la grille au lieu d'être comblée automatiquement par la tuile suivante.
  // Favoris : parcours récursif de la grille de la société, déjà filtrée
  // par les droits et les verrous — un favori ne peut donc jamais faire
  // apparaître une tuile que l'utilisateur n'a pas le droit de voir.
  const collecterFavoris = (items: TileItemNode[]): TileItemNode[] =>
    items.flatMap((item) => [
      ...(item.favorite ? [item] : []),
      ...(item.children ? collecterFavoris(item.children) : []),
    ]);
  const favoris = collecterFavoris(tuilesRacine);

  const rootDisplaySlots: (TileItemNode | null)[] = [];
  const displayById = new Map(tuilesRacine.map((t) => [t.id, t]));
  const usedIds = new Set<string>();
  let realCount = 0;
  for (const slotId of rootSlots) {
    if (slotId === ADD_TILE_ID) continue; // bouton "Ajouter" retiré de la grille (voir plus bas, remonté dans le bandeau du haut)
    if (realCount >= MAX_VISIBLE_TILES) break;
    if (slotId && displayById.has(slotId)) {
      rootDisplaySlots.push(displayById.get(slotId)!);
      usedIds.add(slotId);
      realCount++;
    } else {
      rootDisplaySlots.push(null);
    }
  }
  // Défense en profondeur : une tuile réelle présente mais absente de
  // rootSlots (désync jamais censée arriver grâce au useEffect de
  // comblement) n'est jamais perdue silencieusement — insérée dans la
  // première case vide restante, ou en overflow si le cap est atteint.
  for (const t of tuilesRacine) {
    if (usedIds.has(t.id)) continue;
    if (realCount >= MAX_VISIBLE_TILES) { overflowTiles.push(t); continue; }
    const emptyIdx = rootDisplaySlots.findIndex((s) => s === null);
    if (emptyIdx >= 0) rootDisplaySlots[emptyIdx] = t;
    else rootDisplaySlots.push(t);
    realCount++;
  }
  // Ne jamais rendre les 36 slots en entier (ça repousserait le bouton
  // "Ajouter" très loin en bas, même avec seulement quelques tuiles) —
  // uniquement jusqu'à la dernière tuile réelle, arrondi à la ligne
  // complète, +1 ligne de marge pour pouvoir glisser une tuile plus loin.
  const lastFilled = rootDisplaySlots.reduce((last, t, i) => (t ? i : last), -1);
  const rowsNeeded = Math.ceil((lastFilled + 1) / ROOT_COLUMNS) + 1;
  const visibleSlotCount = Math.min(ROOT_GRID_SLOTS, Math.max(ROOT_COLUMNS, rowsNeeded * ROOT_COLUMNS));
  // `.slice` + complément explicite en `null` plutôt que de modifier
  // `.length` directement : agrandir un array via `.length = N` crée un
  // "sparse array" (trous, pas de vraies valeurs `null`) que `.map()`
  // saute silencieusement — cassant l'alignement des clés `__empty-i__`.
  while (rootDisplaySlots.length < visibleSlotCount) rootDisplaySlots.push(null);
  if (rootDisplaySlots.length > visibleSlotCount) rootDisplaySlots.splice(visibleSlotCount);

  // 9 octobre : une tuile affichée à la racine sans case dans `rootSlots`
  // (nouveauté posée à l'affichage, dossier verrouillé reposé sans case
  // libre…) occupait « la première case vide » recalculée à chaque rendu —
  // elle sautait d'une place à l'autre dès qu'on déplaçait une autre tuile.
  // On lui attribue une case fixe, une seule fois, et seulement après le
  // chargement de la grille serveur (sinon cette écriture locale, datée de
  // maintenant, passerait pour plus récente que la grille serveur).
  const idsRacineSansCase = activeFolder
    ? ''
    : rootDisplaySlots
        .filter((t): t is TileItemNode => Boolean(t) && t!.id !== 'nova-lock-spacer' && !rootSlots.includes(t!.id))
        .map((t) => t.id)
        .join('|');
  useEffect(() => {
    const agencyId = activeAgency?.id;
    if (!idsRacineSansCase || !agencyId || !homeSyncReadyAgencies.has(clefSyncTuiles(agencyId))) return;
    const aAncrer = idsRacineSansCase.split('|');
    const positions = new Map(rootDisplaySlots.map((t, i) => [t?.id, i] as const));
    setRootSlots((prev) => {
      const next: (string | null)[] = Array.from({ length: ROOT_GRID_SLOTS }, (_, i) => prev[i] ?? null);
      let change = false;
      for (const id of aAncrer) {
        if (next.includes(id)) continue;
        // De préférence la case où elle s'affiche déjà (aucun saut visible).
        const ici = positions.get(id);
        const cible = typeof ici === 'number' && next[ici] === null ? ici : next.indexOf(null);
        if (cible === -1) continue;
        next[cible] = id;
        change = true;
      }
      return change ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsRacineSansCase, activeAgency?.id, syncPrete]);
  const moreTile: TileItemNode | null = overflowTiles.length > 0 ? {
    id: '__voir-plus__',
    title: 'Voir plus',
    iconName: 'Folder',
    gradient: 'from-[#334155] via-[#1E293B] to-[#0F172A]',
    badgeCount: overflowTiles.length,
    navTarget: '',
    isFolder: true,
    children: overflowTiles,
  } : null;

  // Calque qui suit le pointeur pendant un glisser. Rendu dans <body> : le
  // dossier ouvert est animé par framer-motion (transform), ce qui casserait
  // le positionnement fixe du calque s'il restait dedans. Il reste dans
  // l'arbre React du DndContext qui l'inclut, donc dans son contexte.
  const calqueDeplacement = createPortal(
    <DragOverlay zIndex={1000} dropAnimation={null}>
      {tuileEnDeplacement ? <TuileFantome tile={tuileEnDeplacement} sousTuile={Boolean(activeFolder)} /> : null}
    </DragOverlay>,
    document.body
  );

  return (
    // Signalé : avec peu de tuiles, "justify-between" étirait l'espace
    // libre ENTRE le bandeau du haut et la grille — les tuiles se
    // retrouvaient poussées bien plus bas que prévu (et Nova, en dessous,
    // paraissait encore plus loin), alors qu'avec 21 tuiles ce même espace
    // n'existait pas et tout semblait normal. Retiré : le contenu garde
    // maintenant un espacement fixe et cohérent depuis le haut, quel que
    // soit le nombre de tuiles — Nova reste ancré près du bas grâce à son
    // propre positionnement fixe (déjà indépendant du contenu, voir plus
    // bas), donc l'ensemble reste équilibré de 1 à 21 tuiles.
    // Signalé (5 septembre, persistant après le premier correctif "figé") :
    // le bandeau "Ma journée / Priorités" ne restait PAS réellement figé au
    // défilement. Cause : `overflow-y-auto` posé ICI, sur un conteneur qui
    // n'a qu'un `min-h-full` (un PLANCHER de hauteur, jamais un plafond) —
    // sans hauteur maximale, ce bloc grandit toujours pour loger tout son
    // contenu et ne peut donc jamais avoir besoin de défiler LUI-MÊME ; le
    // vrai défilement se produit toujours plus haut, sur <main> (App.tsx),
    // le seul ancêtre dont la hauteur est réellement bornée. Ce
    // `overflow-y-auto` mort ici comptait pourtant, aux yeux de CSS, comme
    // le plus proche ancêtre défilant du bandeau `sticky` : le bandeau se
    // figeait donc par rapport à un conteneur dont la position de défilement
    // ne bouge jamais (lui-même immobile), ce qui revenait à n'avoir aucun
    // effet visible — tout l'ensemble suivait le vrai défilement de <main>
    // comme un seul bloc rigide. Retiré : le bandeau se fige maintenant
    // correctement par rapport à <main>, qui défile réellement.
    <div className="min-h-full p-3 sm:p-5 flex flex-col gap-2 relative select-none">
      {/* Dynamic Background Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-900/10 via-transparent to-transparent pointer-events-none" />

      {/* Demandé (5 septembre) : « figer ces éléments, et quand on monte le
          tableau les tuiles peuvent disparaître quand elles sont en dessous
          de cette barre » — le bandeau du haut (priorités + fil d'Ariane/
          Ajouter/Masquer) défilait avec le reste ; il flotte maintenant en
          `sticky` au-dessus de la grille, qui défile SOUS lui plutôt qu'À
          CÔTÉ de lui. Un seul conteneur sticky pour les deux blocs, pour
          qu'ils restent groupés et scrollent (ou se figent) ensemble.
          `z-30` : au-dessus de la grille des tuiles (`z-10`, voir plus bas)
          — sans quoi, les deux étant égaux, l'ordre du document aurait fait
          gagner les tuiles, qui seraient passées PAR-DESSUS le bandeau au
          lieu de disparaître dessous. Pas de fond posé ici : la page n'a pas
          de couleur unie (le fond réel est le papier peint de l'agence,
          rendu par un ancêtre) — c'est le fond translucide flouté déjà
          présent sur chacun des deux blocs (voir plus bas) qui masque les
          tuiles défilant dessous. */}
      <div className="hidden sm:block sticky top-0 z-30">
      {/* "Ma journée" / "Priorités" — masqués sur mobile (MobileHome a sa
          propre version de ces blocs) ; uniquement pour l'accueil desktop,
          alignés sur la même hauteur, avec des données 100% dynamiques. */}
      {!openFolderStack.length && showTopPanel && (
        <div className="hidden sm:flex flex-col max-w-7xl mx-auto w-full mb-3 z-10">
          {/* Cases d'activité & priorités (format cartes individuelles comme au début) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-3 sm:gap-3.5 w-full">
            {visiblePriorityTiles.map((opt) => {
              const OptIcon = ICON_MAP[opt.iconName || ''] || LayoutGrid;
              const optAccent = extractTileAccentColor(opt.gradient);
              const hasAlert = opt.value !== null && opt.value > 0;
              const statusText = hasAlert
                ? opt.id === 'rappels'
                  ? `${opt.value} en attente`
                  : opt.id === 'chat'
                  ? `${opt.value} non lu${opt.value > 1 ? 's' : ''}`
                  : opt.id === 'agenda'
                  ? `${opt.value} aujourd'hui`
                  : opt.id === 'mail'
                  ? `${opt.value} nouveau${opt.value > 1 ? 'x' : ''}`
                  : `${opt.value} en attente`
                : opt.id === 'tableau-de-bord'
                ? "Vue d'ensemble"
                : 'À jour';

              return (
                <div
                  key={opt.id}
                  onClick={() => navigateToTile(opt.nav)}
                  style={{ ['--tile-glow' as string]: optAccent }}
                  className="group p-3 sm:p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-t-white/20 border-l-white/15 border-r-white/5 border-b-black/40 shadow-[0_8px_20px_-6px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] hover:border-[#F7BC5F]/50 hover:shadow-[0_12px_25px_-6px_rgba(0,0,0,0.6),0_0_14px_rgba(247,188,95,0.25)] transition-all duration-200 cursor-pointer flex items-center justify-between backdrop-blur-md active:scale-[0.98]"
                  title={opt.label}
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br ${opt.gradient || 'from-slate-600 to-slate-800'} border border-white/25 flex items-center justify-center text-white shrink-0 group-hover:scale-105 transition-transform shadow-md`}>
                      <OptIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white drop-shadow" />
                    </div>
                    <div className="truncate text-left min-w-0">
                      <p className="text-[10px] sm:text-xs text-gray-400 font-medium truncate">{opt.label}</p>
                      <p className="text-xs sm:text-sm font-bold text-white truncate">
                        {statusText}
                      </p>
                    </div>
                  </div>
                  {hasAlert ? (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0 ml-1.5 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-white/20 group-hover:bg-[#F7BC5F]/60 transition-colors shrink-0 ml-1.5" />
                  )}
                </div>
              );
            })}
          </div>
          {gesteDuMoment && (
            <button
              type="button"
              onClick={() => navigateToTile(gesteDuMoment.nav)}
              className="mt-2 text-center text-xs sm:text-sm font-medium text-slate-300 hover:text-[#F7BC5F] transition-colors truncate"
            >
              {gesteDuMoment.texte}
            </button>
          )}
        </div>
      )}

      {/* Top Breadcrumb & Reset Controls — masqués sur mobile : la barre du
          bas (Accueil / Chat / IA / Alertes / Menu) remplace ce repère, et
          "Réinitialiser l'accueil" n'a pas sa place sur petit écran.
          Signalé (ticket #50, KO) : « ne mets pas un fond sur la longueur
          pour les deux onglets ajouter un dossier, et masquer le bandeau »
          — le fond gris/le liseré/le padding qui habillaient toute la
          largeur de cette ligne sont retirés ; chaque bouton (Ajouter,
          Masquer le bandeau) garde son propre fond, seulement autour de
          son texte, comme demandé. */}
      <div className="hidden sm:flex max-w-7xl mx-auto w-full mb-2 items-center justify-between z-10">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          {/* Demande explicite (30/08/2026) : "supprime le texte, mon
              espace ou mes espaces, cela ne sert à rien" — retiré
              uniquement à la racine (rien à retrouver via ce repère quand
              aucun dossier n'est ouvert). À l'intérieur d'un dossier, ce
              même élément garde son rôle utile de fil d'Ariane ("Accueil"
              cliquable pour remonter), inchangé. */}
          {openFolderStack.length > 0 && (
            <span
              onClick={() => setOpenFolderStack([])}
              className="cursor-pointer font-bold hover:text-[#F7BC5F] transition-colors flex items-center gap-1.5"
            >
              <LayoutGrid className="w-4 h-4 text-[#F7BC5F]" />
              Accueil
            </span>
          )}
          {openFolderStack.map((folder, idx) => (
            <React.Fragment key={folder.id}>
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
              <span 
                onClick={() => setOpenFolderStack(openFolderStack.slice(0, idx + 1))}
                className={`cursor-pointer font-medium transition-colors ${
                  idx === openFolderStack.length - 1 ? 'text-[#F7BC5F] font-semibold' : 'text-gray-300 hover:text-white'
                }`}
              >
                {folder.title}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Demande explicite : le bouton "Ajouter" n'est plus une tuile de
              la grille racine (il gênait le repositionnement libre des
              tuiles, ticket #256) — remonté ici, dans le bandeau du haut.
              Revu (30/08/2026, "mets en évidence... qu'on ne voit pas") :
              ce bouton et celui de droite étaient trop discrets (gris pâle,
              liseré presque invisible) pour être repérés — couleur dorée de
              la marque appliquée aux deux, comme les autres actions
              importantes de l'appli.
              Revu (30/08/2026, encore, "fond plus gris... 80%... liseré
              noir très léger") : fond doré translucide remplacé par le même
              gris anthracite que le panneau juste au-dessus, texte doré
              conservé pour rester lisible/reconnaissable comme action. */}
          {!activeFolder && (
            <button
              onClick={handleOpenAddModal}
              title="Ajouter un raccourci ou un dossier"
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-black/60 transition-colors flex items-center gap-1.5 text-[#F9C977] bg-[#2b2b2b]/80 hover:bg-[#2b2b2b]"
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter
            </button>
          )}
          {/* Ticket #50 : afficher/masquer entièrement le bandeau "Ma
              journée + Priorités", pour reprendre cet espace au profit des
              tuiles si on ne s'en sert pas. */}
          <button
            onClick={toggleTopPanel}
            title={showTopPanel ? 'Masquer le bandeau Ma journée / Priorités' : 'Réafficher le bandeau Ma journée / Priorités'}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              showTopPanel
                ? 'text-[#F9C977] bg-[#2b2b2b]/80 hover:bg-[#2b2b2b] border-black/60'
                : 'bg-[#F7BC5F] text-slate-950 border-[#F7BC5F]'
            }`}
          >
            {showTopPanel ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showTopPanel ? 'Masquer le bandeau' : 'Bandeau masqué'}
          </button>
        </div>
      </div>
      </div>

      {/* Ticket #213 : "Personnaliser" et "Réinitialiser l'accueil" retirés
          (demande explicite) — le reste de la disposition (fil d'Ariane,
          bouton masquer le bandeau) est inchangé. */}

      {/* Demandé le 2 septembre : « pouvoir mettre une épingle pour afficher
          tout en haut de la liste, ou une étoile de favoris avec un onglet
          favori pour les retrouver plus facilement — à toi de voir ». Une
          étoile : la tuile garde sa place dans la grille (rien ne bouge, rien
          n'est réorganisé) et apparaît EN PLUS dans ce bandeau, tout en haut
          à gauche. Les tuiles rangées dans un dossier y remontent aussi —
          c'est justement là qu'on les cherche. Le bandeau n'existe que s'il y
          a des favoris : sans étoile, l'accueil est exactement comme avant. */}
      {!activeFolder && favoris.length > 0 && (
        <div className="max-w-7xl mx-auto w-full mb-3 z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#F7BC5F]/80 font-bold pr-1">
              <Star className="w-3.5 h-3.5 fill-[#F7BC5F] text-[#F7BC5F]" />
              Favoris
            </span>
            {favoris.map((fav) => {
              const FavIcon = ICON_MAP[fav.iconName] || LayoutGrid;
              return (
                <div
                  key={`fav-${fav.id}`}
                  className="group flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl bg-black/30 border border-[#F7BC5F]/25 hover:border-[#F7BC5F]/60 transition-colors"
                >
                  <button
                    onClick={() => activerTuile(fav)}
                    className="flex items-center gap-2 min-w-0 cursor-pointer"
                    title={fav.title}
                  >
                    <FavIcon className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <span className="text-xs font-semibold text-white truncate max-w-[9rem]">{fav.title}</span>
                  </button>
                  <button
                    onClick={() => toggleTileFavorite(fav.id)}
                    className="p-1 rounded-lg text-[#F7BC5F]/70 hover:text-[#F7BC5F] hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Retirer des favoris"
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Grid View */}
      {/* Ticket #256 : racine en positions libres (grille fixe 6 colonnes,
          cases vides possibles via rootDisplaySlots). Le dossier ouvert
          a son propre voile : cette grille ne change pas. */}
      {(() => {
        // Le dossier ouvert a son propre voile. La grille de l'accueil reste
        // celle de la société : la remplacer ici faisait surgir une tuile
        // le temps que le voile apparaisse.
        const gridItems: (TileItemNode | null)[] = rootDisplaySlots;
        const sortableIds = gridItems
          .map((t, i) => (t ? t.id : `__empty-${i}__`))
          .filter((_id, i) => gridItems[i]?.id !== 'nova-lock-spacer');
        return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleTileDragStart} onDragOver={handleTileDragOver} onDragEnd={handleTileDragEnd} onDragCancel={handleTileDragCancel}>
        {!activeFolder && calqueDeplacement}
        {/* À la racine, lâcher une tuile ÉCHANGE deux cases (handleTileDragEnd).
            L'aperçu pendant le geste doit montrer la même chose : avec la
            stratégie de tri, toutes les tuiles intermédiaires glissaient d'un
            cran pendant le geste, puis sautaient à leur vraie place au lâcher.
            Dans un dossier, la liste reste dense : stratégie de tri. */}
        <SortableContext items={sortableIds} strategy={rectSwappingStrategy}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-3.5 sm:gap-4.5 max-w-7xl mx-auto w-full z-10 pb-1">
            {gridItems.map((tile, gridIndex) => (
              !tile ? (
                <EmptyRootCell key={`__empty-${gridIndex}__`} id={`__empty-${gridIndex}__`} />
              ) : tile.id === 'nova-lock-spacer' ? (
                // Case invisible, non cliquable, non déplaçable — réserve
                // juste sa place dans la grille (cf. commentaire sur cette
                // entrée dans INITIAL_TILES plus haut).
                <div key={tile.id} className="h-40 sm:h-48 md:h-52" aria-hidden="true" />
              ) : (
              <SortableTile
                key={tile.id}
                tile={tile}
                count={resolveTotalCount(tile, liveStats)}
                isDragTarget={mergeIntentId === tile.id}
                onActivate={() => activerTuile(tile)}
                onOpenPalette={() => setPaletteTileId(tile.id)}
                // Signalé : le super admin doit pouvoir modifier le logo/nom/
                // couleur/lien de N'IMPORTE QUELLE tuile (y compris les
                // dossiers et les tuiles "d'origine"), pas seulement ses
                // propres raccourcis créés à la main (id "custom-...").
                onEdit={
                  tile.id.startsWith('custom-') || (isSuperAdmin && tile.id !== '__voir-plus__')
                    ? () => openEditShortcut(tile)
                    : undefined
                }
                isSuperAdmin={!!isSuperAdmin}
                onToggleLock={() => void toggleTileLock(tile)}
                onQuickAdd={
                  tile.isFolder
                    ? () => {
                        setOpenFolderStack([...openFolderStack, tile]);
                        handleOpenAddModal();
                      }
                    : undefined
                }
                onOpenActionsMenu={() => setActionsMenuTileId(tile.id)}
              />
              )
            ))}

            {/* Tuile "Voir plus" — regroupe tout ce qui dépasse les 24
                premières tuiles, s'ouvre comme un dossier classique. */}
            {moreTile && (
              <SortableTile
                key={moreTile.id}
                tile={moreTile}
                count={moreTile.badgeCount}
                isDragTarget={false}
                onActivate={() => setOpenFolderStack([...openFolderStack, moreTile])}
                onOpenPalette={() => {}}
              />
            )}

          </div>
        </SortableContext>
      </DndContext>
        );
      })()}

      {/* Réserve la place du bouton Nova IA, fixé tout en bas de la fenêtre
          (voir plus bas) — avec beaucoup de tuiles (jusqu'à 24), la dernière
          rangée pouvait sinon se retrouver juste sous lui, difficile à
          atteindre en scrollant. */}
      {/* Signalé (24 octobre) : « sur tablette je n'ai pas nova » — ce
          bouton était caché sur tout écran tactile (`!isCoarsePointer`), en
          partant du principe qu'un remplaçant existait ailleurs
          (MobileBottomNav). Ce composant-ci (AccueilGrid) n'est de toute
          façon JAMAIS monté sur téléphone (App.tsx bascule sur MobileHome
          dès `isMobile`, un seuil de LARGEUR) — le seul écran tactile qui
          passait encore par ici était donc la tablette, qui elle n'a PAS ce
          remplaçant (gardé lui aussi derrière `isMobile`, pas
          `isCoarsePointer` : deux seuils différents pour la même
          fonctionnalité, d'où la case vide). Condition retirée : plus de
          raison de distinguer tactile/souris ici, seulement
          mobile/non-mobile, déjà géré en amont. */}
      {/* Espace en bas pour aérer la grille et ne pas chevaucher le bouton flottant */}
      <div className="h-16 sm:h-24" aria-hidden="true" />

      {/* Bouton Flottant Assistant Nova IA — Cercle Logo avec contour jaune identique du logo */}
      {!novaOpen && (
        <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40">
          <button
            onClick={() => {
              if (onOpenNova) {
                onOpenNova();
              } else {
                onNavigate('assistant-ia');
              }
            }}
            className="group relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#0a2528]/95 hover:bg-[#0e3338] border-2 border-[#F7BC5F] hover:border-[#F9C977] ring-2 ring-[#F7BC5F]/35 hover:ring-[#F7BC5F]/60 shadow-[0_8px_30px_rgba(0,0,0,0.6),0_0_20px_rgba(247,188,95,0.45)] hover:shadow-[0_8px_35px_rgba(247,188,95,0.85)] backdrop-blur-md flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-300 cursor-pointer"
            title="Ouvrir l'Assistant Nova IA"
            aria-label="Assistant Nova IA"
          >
            <div className="relative w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center overflow-hidden shrink-0">
              <img
                src="/nova-mascotte.png"
                alt="Nova"
                className="w-9 h-9 sm:w-11 sm:h-11 object-contain drop-shadow group-hover:scale-105 transition-transform duration-300"
              />
            </div>
            {/* Indicateur de statut en ligne */}
            <span className="w-3 h-3 rounded-full bg-[#F7BC5F] animate-ping absolute top-0.5 right-0.5" />
            <span className="w-3 h-3 rounded-full bg-[#F7BC5F] border-2 border-[#0a2528] absolute top-0.5 right-0.5 shadow" />
          </button>
        </div>
      )}

      {/* iPhone Folder Open Modal Animation Effect */}
      <AnimatePresence>
        {activeFolder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Sur ordinateur, le voile s'arrête sous la barre du haut : les
            // logos de société restent visibles et cliquables pendant qu'un
            // dossier est ouvert.
            ref={swipeBackRef}
            className="fixed inset-x-0 bottom-0 top-0 md:top-[calc(4rem+env(safe-area-inset-top,0px))] bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4 sm:p-8"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-[#0E1A20]/90 border border-white/20 rounded-3xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl text-white relative overflow-hidden backdrop-blur-2xl"
            >
              {/* Top Navigation in Folder */}
              <div className="flex items-center justify-between pb-6 border-b border-white/10 mb-6">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setOpenFolderStack(openFolderStack.slice(0, -1))}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1 text-xs font-semibold"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Retour</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <Folder className="w-6 h-6 text-[#F7BC5F]" />
                    <h2 className="text-xl font-bold text-white tracking-wide">{activeFolder.title}</h2>
                    <button
                      onClick={() => {
                        setRenamingFolderId(activeFolder.id);
                        setRenameTitle(activeFolder.title);
                      }}
                      className="p-1 text-gray-400 hover:text-white transition-colors"
                      title="Renommer le dossier"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleDissolveFolder(activeFolder.id)}
                    className="px-3 py-1.5 rounded-xl bg-red-500/20 text-red-300 hover:bg-red-500/30 text-xs font-semibold border border-red-500/30 transition-colors flex items-center gap-1.5"
                    title="Extraire le contenu vers la grille principale"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Dissoudre</span>
                  </button>

                  <button
                    onClick={() => setOpenFolderStack([])}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Sub-Items Grid Inside iPhone Folder */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleTileDragStart} onDragOver={handleTileDragOver} onDragEnd={handleTileDragEnd} onDragCancel={handleTileDragCancel}>
                {calqueDeplacement}
                <SortableContext items={(enfantsDossierOuvert || []).map((t) => t.id)} strategy={rectSortingStrategy}>
              <div data-swipe-back-exclude="true" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                {(enfantsDossierOuvert || []).map((subItem) => (
                  <SortableSubTile
                    key={subItem.id}
                    subItem={subItem}
                    count={resolveTotalCount(subItem, liveStats)}
                    isDragTarget={mergeIntentId === subItem.id}
                    onActivate={() => {
                      if (subItem.isFolder) {
                        setOpenFolderStack([...openFolderStack, subItem]);
                      } else if (subItem.externalUrl) {
                        let url = subItem.externalUrl.trim();
                        if (!url.startsWith('http://') && !url.startsWith('https://')) {
                          url = 'https://' + url;
                        }
                        window.open(url, '_blank', 'noopener,noreferrer');
                      } else if (subItem.navTarget) {
                        setOpenFolderStack([]);
                        navigateToTile(subItem.navTarget);
                      }
                    }}
                    onOpenPalette={() => setPaletteTileId(subItem.id)}
                    onEdit={
                      subItem.id.startsWith('custom-') || (isSuperAdmin && !subItem.isFolder)
                        ? () => openEditShortcut(subItem)
                        : undefined
                    }
                    isSuperAdmin={!!isSuperAdmin}
                    onToggleLock={() => void toggleTileLock(subItem)}
                    onOpenActionsMenu={() => setActionsMenuTileId(subItem.id)}
                  />
                ))}

                {/* Add Item Inside Folder Tile */}
                <div
                  onClick={() => handleOpenAddModal()}
                  className="h-36 rounded-2xl border-2 border-dashed border-gray-600 bg-white/5 hover:bg-white/10 text-gray-300 flex flex-col items-center justify-center p-4 cursor-pointer transition-colors"
                >
                  <Plus className="w-6 h-6 text-[#F7BC5F] mb-1" />
                  <span className="text-xs font-semibold">Ajouter dans ce dossier</span>
                </div>
              </div>
                </SortableContext>
              </DndContext>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Shortcut / Folder Modal */}
      {showAddModal && (
        // Signalé : la fenêtre dépassait en haut de l'écran (bouton fermer
        // et début du formulaire hors champ, impossibles à atteindre/
        // cliquer) — "items-center" combiné à un contenu devenu assez long
        // (ajout des applications existantes, upload d'image...) pouvait
        // pousser le haut de la fenêtre au-dessus du viewport. Recalé en
        // haut (items-start) avec une marge de sécurité fixe, et la fenêtre
        // elle-même plafonnée en hauteur avec défilement interne — le
        // bouton fermer et l'en-tête restent donc toujours visibles et
        // cliquables, quelle que soit la longueur du contenu en dessous.
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-start justify-center p-4 pt-[calc(5.5rem+env(safe-area-inset-top,0px))] pb-8 overflow-y-auto"
          onClick={closeAddModal}
        >
          <div
            // Signalé (suivi 2x) : toujours trop haute, le titre collé/coupé
            // sous la barre du haut — la marge fixe précédente (1.5rem) ne
            // suffisait pas à passer sous le header (~4rem). Marge remontée
            // à 5.5rem pour garantir un espace visible entre le header et la
            // fenêtre, quelle que soit la hauteur du contenu en dessous.
            // Revu (30/08/2026, "améliore ce panneau pour ne pas scroller,
            // prend la place") : max-w-lg (512px) laissait énormément
            // d'espace horizontal inutilisé alors que le contenu débordait
            // en hauteur (grilles icône/couleur coupées, à faire défiler).
            // Élargi à max-w-3xl — les grilles ci-dessous passent de 4 à 6
            // colonnes pour profiter de cette largeur, tenant désormais sans
            // défilement interne dans la plupart des cas.
            className="bg-[#05191c] border border-[#17464b] rounded-3xl max-w-3xl w-full p-4 sm:p-5 shadow-2xl text-white relative max-h-[90vh] overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg sm:text-xl font-black text-white tracking-wide">
                  {editingShortcutId
                    ? 'Modifier le raccourci'
                    : addMode === 'folder'
                    ? 'Nouveau dossier'
                    : addMode === 'existing'
                    ? 'Ajouter des applications'
                    : 'Nouveau raccourci'}
                </h2>
                <p className="text-xs text-gray-300 mt-0.5">
                  {editingShortcutId
                    ? "Modifiez le nom, le lien, l'icône, l'image ou la couleur de ce raccourci."
                    : addMode === 'folder'
                    ? 'Créez un dossier pour organiser vos raccourcis et tuiles.'
                    : addMode === 'existing'
                    ? 'Choisissez des applications déjà présentes à l\'accueil pour les déplacer dans ce dossier.'
                    : 'Créez un raccourci personnalisé avec une icône, une image et une couleur.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAddModal}
                className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switcher — masqué en édition, un raccourci existant ne
                se transforme pas en dossier */}
            {!editingShortcutId && (
            <div className="flex items-center gap-2 mb-3 bg-[#031113] p-1 rounded-2xl border border-[#143d41]">
              <button
                type="button"
                onClick={() => setAddMode('shortcut')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                  addMode === 'shortcut' 
                    ? 'bg-[#F7BC5F] text-black shadow-md' 
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                Raccourci App / Lien Web
              </button>
              {/* Signalé : interdiction de créer un dossier À L'INTÉRIEUR
                  d'un autre dossier — masqué dès qu'on est déjà dans un
                  dossier ouvert (activeFolder). */}
              {!activeFolder && (
                <button
                  type="button"
                  onClick={() => {
                    // Ticket #218 : "aucun logo ne doit être ajouté
                    // automatiquement" à un dossier créé — l'icône restait
                    // pré-remplie à 'HomeIcon' (valeur par défaut à
                    // l'ouverture de la fenêtre), qu'on soit en train de
                    // créer un raccourci ou un dossier. On la vide
                    // explicitement en passant en mode dossier : sans choix
                    // manuel de l'utilisateur, `newIconName` reste vide et
                    // le dossier retombe sur son icône neutre par défaut.
                    setAddMode('folder');
                    setNewIconName('');
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                    addMode === 'folder'
                      ? 'bg-[#F7BC5F] text-black shadow-md'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Dossier iPhone
                </button>
              )}
              {/* Uniquement depuis un dossier déjà ouvert : demande
                  explicite — pouvoir y déplacer des applications déjà
                  existantes (Clients, Agenda...) au lieu de recréer un
                  raccourci qui pointerait vers la même page. */}
              {activeFolder && (
                <button
                  type="button"
                  onClick={() => setAddMode('existing')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                    addMode === 'existing'
                      ? 'bg-[#F7BC5F] text-black shadow-md'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Applications existantes
                </button>
              )}
            </div>
            )}

            {addMode === 'existing' && !editingShortcutId ? (
              <div className="space-y-4">
                <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                  {/* Signalé : interdiction de mettre un dossier dans un
                      dossier — exclut aussi les autres dossiers de cette
                      liste (pas seulement le dossier actif), pas seulement
                      les raccourcis simples. */}
                  {tiles.filter((t) => t.id !== activeFolder?.id && !t.isFolder).length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">
                      Aucune autre tuile à l'accueil pour l'instant.
                    </p>
                  ) : (
                    tiles
                      .filter((t) => t.id !== activeFolder?.id && !t.isFolder)
                      .map((t) => {
                        const TIcon = ICON_MAP[t.iconName] || LayoutGrid;
                        const checked = existingSelection.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() =>
                              setExistingSelection((prev) =>
                                checked ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                              )
                            }
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                              checked
                                ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/50'
                                : 'bg-[#021316] border-[#1b484d] hover:border-white/20'
                            }`}
                          >
                            <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-white/25'}`}>
                              {checked && <Check className="w-3.5 h-3.5 text-[#20170a]" />}
                            </span>
                            <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${t.gradient} flex items-center justify-center shrink-0`}>
                              {t.isFolder ? <Folder className="w-4 h-4 text-white" /> : <TIcon className="w-4 h-4 text-white" />}
                            </span>
                            <span className="text-sm font-semibold text-white truncate">{t.title}</span>
                          </button>
                        );
                      })
                  )}
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={closeAddModal} className="px-4 py-2.5 rounded-xl text-sm font-bold text-gray-300 hover:text-white hover:bg-white/5 transition-colors">
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={existingSelection.length === 0}
                    onClick={() => { moveExistingIntoFolder(existingSelection); setExistingSelection([]); setShowAddModal(false); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-40 disabled:cursor-default text-[#20170a] transition-colors"
                  >
                    Ajouter {existingSelection.length > 0 ? `(${existingSelection.length})` : ''} au dossier
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleCreateNewItem} className="space-y-3">
              {/* Nom + URL côte à côte (au lieu d'empilés) pour gagner de la
                  hauteur — URL n'existe qu'en mode raccourci. */}
              <div className={addMode === 'shortcut' ? 'grid grid-cols-2 gap-3' : ''}>
                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1">
                    Nom
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={addMode === 'folder' ? 'ex: Prêts, Prospection' : 'Nom du raccourci'}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F] transition-all placeholder:text-gray-500"
                  />
                </div>
                {addMode === 'shortcut' && (
                  <div>
                    <label className="block text-xs font-bold text-gray-200 mb-1">
                      URL (optionnel)
                    </label>
                    <input
                      type="url"
                      placeholder="https://exemple.com"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      className="w-full bg-[#021316] border border-[#1b484d] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F] transition-all placeholder:text-gray-500"
                    />
                  </div>
                )}
              </div>

              {/* Internal Destination fallback if no URL */}
              {addMode === 'shortcut' && !newUrl.trim() && (
                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1">
                    Destination d'application interne
                  </label>
                  <select
                    value={newNavTarget}
                    onChange={(e) => setNewNavTarget(e.target.value)}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]"
                  >
                    {/* Signalé : pas de moyen de créer une tuile "neutre",
                        sans lien ni destination — juste l'icône/le titre.
                        Choisie par défaut désormais (au lieu de "Bloc-notes"
                        assigné silencieusement). */}
                    <option value="">Aucune</option>
                    <option value="clients">Clients & Leads</option>
                    <option value="pipeline">Pipelines Prêts</option>
                    <option value="agenda">Agenda & RDV</option>
                    <option value="notes">Bloc-notes</option>
                    <option value="documents">Coffre-fort Documents</option>
                    <option value="reserver-camera">Réserver Caméra</option>
                    <option value="projets-internes">Projets internes</option>
                    <option value="chat">Chat Équipe</option>
                    <option value="mail">Mail</option>
                  </select>
                </div>
              )}

              {/* Image personnalisée PNG/JPG/WebP — condensée sur une ligne */}
              {addMode === 'shortcut' && (
                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1">
                    Image personnalisée (optionnel)
                  </label>
                  <div className="flex items-center gap-2 bg-[#021316] border border-[#1b484d] rounded-xl p-2">
                    {newImageUrl && (
                      <img src={newImageUrl} alt="Aperçu" className="w-8 h-8 object-contain rounded-lg bg-black/40 border border-white/10 shrink-0" />
                    )}
                    <label className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer border border-white/15 transition-colors shrink-0">
                      Choisir
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
                    <span className="text-xs text-gray-400 truncate flex-1">
                      {newImageUrl ? "Image chargée — remplace l'icône" : "Remplace l'icône si choisie"}
                    </span>
                    {newImageUrl && (
                      <button
                        type="button"
                        onClick={() => setNewImageUrl(null)}
                        className="text-xs text-red-400 hover:text-red-300 shrink-0 font-semibold cursor-pointer px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20"
                      >
                        Effacer
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Icône + Couleur côte à côte */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1">
                    Icône
                  </label>
                  <div className="grid grid-cols-6 gap-1.5 max-h-28 overflow-y-auto custom-scrollbar p-1.5 bg-[#021316] rounded-xl border border-[#1b484d]">
                    {ICON_PICKER_OPTIONS.map((item) => {
                      const IconComp = item.icon;
                      const isSelected = newIconName === item.name;
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => setNewIconName(item.name)}
                          className={`h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-[#F7BC5F]/20 border-[#F7BC5F] ring-2 ring-[#F7BC5F]/50 text-[#F7BC5F]'
                              : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30 hover:text-white'
                          }`}
                          title={item.label}
                        >
                          <IconComp className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-200 mb-1">
                    Couleur
                  </label>
                  <div className="grid grid-cols-6 gap-1.5 max-h-28 overflow-y-auto custom-scrollbar p-1.5 bg-[#021316] rounded-xl border border-[#1b484d]">
                    {PRESET_GRADIENTS.map((p) => {
                      const isSelected = newGradient === p.value;
                      return (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => setNewGradient(p.value)}
                          className={`h-9 rounded-lg bg-gradient-to-br ${p.value} border relative overflow-hidden transition-all shadow-md cursor-pointer ${
                            isSelected ? 'ring-2 ring-[#F7BC5F] border-white scale-105 z-10' : 'border-white/20 hover:scale-105'
                          }`}
                          title={p.name}
                        >
                          <div className="absolute inset-x-0 top-0 h-1/2 bg-white/25 pointer-events-none" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10 mt-3">
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-white/10 hover:bg-white/15 transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-black bg-[#F7BC5F] hover:bg-[#d9ab38] disabled:opacity-50 transition-colors shadow-lg cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{editingShortcutId ? 'Enregistrer les modifications' : 'Créer le raccourci'}</span>
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* Rename Folder Modal */}
      {renamingFolderId && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#0E1A20] border border-white/15 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-white">
            <h3 className="text-base font-bold mb-3 text-[#F7BC5F]">Renommer le dossier</h3>
            <form onSubmit={handleRenameFolder} className="space-y-4">
              <input
                type="text"
                required
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenamingFolderId(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 bg-white/5"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-black bg-[#F7BC5F]"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Standalone Top-Level 3D Color Palette Modal (z-[100]) */}
      {paletteTileId && (() => {
        const selectedTile = findTileById(tiles, paletteTileId);
        if (!selectedTile) return null;

        return (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
            onClick={() => setPaletteTileId(null)}
          >
            <div 
              className="bg-[#0b1c1e] border border-[#1a4a4e] rounded-3xl p-5 sm:p-6 shadow-2xl max-w-lg w-full text-white relative animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3.5 border-b border-white/10 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#F7BC5F]/20 border border-[#F7BC5F]/40 flex items-center justify-center text-[#F9C977] shrink-0">
                    <Palette className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Thème de Couleur 3D</h3>
                    <p className="text-xs text-[#F9C977] font-semibold">{selectedTile.title}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setPaletteTileId(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white transition-colors cursor-pointer"
                  title="Fermer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Live Preview of Selected Tile */}
              <div className="mb-4 flex flex-col items-center justify-center">
                <p className="text-[11px] text-gray-400 mb-2 uppercase tracking-wider font-bold">Aperçu en direct</p>
                <div className={`w-48 h-24 sm:w-56 sm:h-28 rounded-2xl bg-gradient-to-br ${selectedTile.gradient} p-3 flex flex-col items-center justify-center text-center shadow-[0_12px_28px_-6px_rgba(0,0,0,0.7),inset_0_1.5px_2px_rgba(255,255,255,0.45)] border border-t-white/30 border-l-white/20 border-b-black/50 relative overflow-hidden transition-all duration-300`}>
                  <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
                  <span className="text-white font-extrabold text-sm sm:text-base drop-shadow-md z-10">{selectedTile.title}</span>
                  <span className="text-[10px] text-white/80 font-medium mt-1 z-10 bg-black/30 px-2 py-0.5 rounded-full border border-white/10">Effet Relief 3D</span>
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300">24 Nuances Lumineuses 3D</span>
                <span className="text-[10px] text-[#F9C977] font-mono">Cliquez pour appliquer</span>
              </div>

              {/* 24 Presets Grid */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-60 overflow-y-auto custom-scrollbar p-2 bg-black/40 rounded-2xl border border-white/10">
                {PRESET_GRADIENTS.map((p) => {
                  const isSelected = selectedTile.gradient === p.value;
                  return (
                    <button
                      key={p.name}
                      onClick={() => handleUpdateColor(selectedTile.id, p.value)}
                      className={`group relative h-12 rounded-xl bg-gradient-to-br ${p.value} border transition-all duration-200 flex flex-col items-center justify-end p-1.5 cursor-pointer shadow-md hover:scale-[1.05] ${
                        isSelected ? 'ring-2 ring-[#F9C977] border-white scale-105 z-10' : 'border-white/20 hover:border-white'
                      }`}
                      title={p.name}
                    >
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-white/25 rounded-t-xl pointer-events-none" />
                      <span className="text-[10px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] truncate max-w-full z-10">
                        {p.name}
                      </span>
                      {isSelected && (
                        <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-[#F9C977] ring-2 ring-black" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setPaletteTileId(null)}
                  className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  Valider & Fermer
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Menu d'actions consolidé (demande explicite) — Renommer / Ajouter
          à un dossier / Masquer / Supprimer définitivement. */}
      {actionsMenuTileId && (() => {
        // Signalé le 2 septembre : « il y a des tuiles que je ne peux pas
        // masquer ou supprimer ». Ces tuiles-là sont posées à l'affichage
        // (nouveautés jamais enregistrées dans la grille, dossiers
        // verrouillés reposés) : `findTileById(tiles, …)` ne les trouvait
        // pas, le menu d'options renvoyait null, et aucune option
        // n'apparaissait — d'où l'impossibilité d'agir dessus.
        const menuTile =
          findTileById(tiles, actionsMenuTileId) ||
          findTileById(tuilesRacine, actionsMenuTileId) ||
          (enfantsDossierOuvert ? findTileById(enfantsDossierOuvert, actionsMenuTileId) : null) ||
          findInitialTile(actionsMenuTileId);
        if (!menuTile) return null;
        const folders = tiles.filter((t) => t.isFolder && t.id !== menuTile.id);
        // 3 septembre : « concernant les tuiles verrouillées par les admins,
        // ils peuvent les déplacer où ils veulent ». Le verrou impose
        // l'apparence et le contenu, jamais l'emplacement : sur une tuile
        // verrouillée, un membre garde les déplacements (glisser, dossier,
        // sortie de dossier) et ses favoris ; renommer, recolorer, masquer et
        // supprimer restent réservés au super admin. Seule exception, une
        // carte IMPOSÉE par un dossier verrouillé : elle ne sort pas du
        // dossier (« ils ne pourront pas sortir des dossiers »), elle s'y
        // réordonne en la glissant.
        // Précisé le même jour : « ça sert à rien de mettre le menu déroulant
        // entier. On pourrait mettre changer la couleur du dossier, et à
        // l'intérieur ils pourront simplement changer la couleur ou déplacer
        // les sous-dossiers. On s'arrête juste à ces éléments-là quand il y a
        // le cadenas. » Sur une tuile verrouillée, un membre n'a donc que
        // « Changer la couleur » ; le déplacement se fait en glissant.
        const peutModifier = !menuTile.locked || !!isSuperAdmin;
        const carteImposee =
          !isSuperAdmin
          && !!activeFolder
          && ((lockedTiles[activeFolder.id]?.children || []) as TileItemNode[]).some((c) => c.id === menuTile.id);
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
            onClick={() => { setActionsMenuTileId(null); setShowFolderPickerFor(null); }}
          >
            <div
              className="bg-[#0b1c1e] border border-[#1a4a4e] rounded-3xl p-5 shadow-2xl max-w-xs w-full text-white relative animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                <p className="text-sm font-bold text-white truncate">{menuTile.title}</p>
                <button
                  onClick={() => { setActionsMenuTileId(null); setShowFolderPickerFor(null); }}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {showFolderPickerFor === menuTile.id ? (
                <div className="space-y-1.5">
                  {folders.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">Aucun autre dossier disponible.</p>
                  ) : (
                    folders.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          handleMoveTileToFolder(menuTile.id, f.id);
                          setActionsMenuTileId(null);
                          setShowFolderPickerFor(null);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors"
                      >
                        <Folder className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                        <span className="text-sm text-white truncate">{f.title}</span>
                      </button>
                    ))
                  )}
                  <button
                    onClick={() => setShowFolderPickerFor(null)}
                    className="w-full mt-1 px-3 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    ← Retour
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {!peutModifier && (
                    <p className="flex items-start gap-2 px-3 py-2 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/30 text-xs text-[#FAD592] leading-snug">
                      <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>
                        {carteImposee
                          ? 'Carte imposée par ce dossier verrouillé : vous pouvez changer sa couleur, et la réordonner en la glissant dans le dossier.'
                          : 'Verrouillée par le super admin : vous pouvez changer sa couleur, et la placer où vous voulez en la glissant.'}
                      </span>
                    </p>
                  )}
                  {peutModifier && (
                    <button
                      onClick={() => { openEditShortcut(menuTile); setActionsMenuTileId(null); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                    >
                      <FileEdit className="w-4 h-4 text-gray-300 shrink-0" /> Renommer / modifier
                    </button>
                  )}
                  {/* Ticket #120 : regroupé ici avec le reste des options —
                      avant, un bouton palette séparé traînait sur la tuile.
                      Seule entrée qui reste sur une tuile verrouillée. */}
                  <button
                    onClick={() => { setPaletteTileId(menuTile.id); setActionsMenuTileId(null); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                  >
                    <Palette className="w-4 h-4 text-gray-300 shrink-0" /> Changer la couleur
                  </button>
                  {/* Demandé le 2 septembre : une étoile de favoris pour
                      retrouver une tuile plus facilement. */}
                  {peutModifier && (
                    <button
                      onClick={() => { toggleTileFavorite(menuTile.id); setActionsMenuTileId(null); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                    >
                      <Star className={`w-4 h-4 shrink-0 ${menuTile.favorite ? 'text-[#F7BC5F] fill-[#F7BC5F]' : 'text-gray-300'}`} />
                      {menuTile.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      onClick={() => { void toggleTileLock(menuTile); setActionsMenuTileId(null); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                    >
                      {menuTile.locked ? (
                        <><Unlock className="w-4 h-4 text-gray-300 shrink-0" /> Déverrouiller (rendre modifiable pour tous)</>
                      ) : (
                        <><Lock className="w-4 h-4 text-gray-300 shrink-0" /> Verrouiller pour tous les membres</>
                      )}
                    </button>
                  )}
                  {!menuTile.isFolder && peutModifier && (
                    <button
                      onClick={() => setShowFolderPickerFor(menuTile.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                    >
                      <Folder className="w-4 h-4 text-gray-300 shrink-0" /> Ajouter à un dossier
                    </button>
                  )}
                  {!menuTile.isFolder && peutModifier && (
                    <button
                      onClick={() => {
                        setCreateFolderFromTileId(menuTile.id);
                        setAddMode('folder');
                        setNewTitle('');
                        // Ticket #218 : même correctif que l'autre point
                        // d'entrée de création de dossier — pas d'icône
                        // pré-remplie automatiquement.
                        setNewIconName('');
                        setShowAddModal(true);
                        setActionsMenuTileId(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                    >
                      <FolderPlus className="w-4 h-4 text-gray-300 shrink-0" /> Créer un dossier avec cette tuile
                    </button>
                  )}
                  {/* "Sortir du dossier" — demande explicite, à côté de
                      "Dissoudre" (qui vide TOUT le dossier) : ne retire que
                      cette tuile-là, visible seulement si elle est bien
                      dans le dossier actuellement ouvert. */}
                  {activeFolder && peutModifier && (activeFolder.children || []).some((c) => c.id === menuTile.id) && (
                    <button
                      onClick={() => { handleExtractTileFromFolder(menuTile.id); setActionsMenuTileId(null); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                    >
                      <ExternalLink className="w-4 h-4 text-gray-300 shrink-0 rotate-180" /> Sortir du dossier
                    </button>
                  )}
                  {peutModifier && (
                    <button
                      onClick={() => { handleDeleteTile(menuTile.id); setActionsMenuTileId(null); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors text-sm text-white"
                    >
                      <EyeOff className="w-4 h-4 text-gray-300 shrink-0" /> Masquer (récupérable dans Paramètres)
                    </button>
                  )}
                  {/* Ticket #121 : réservé aux tuiles/dossiers créés par
                      l'utilisateur — les tuiles fournies par défaut avec le
                      CRM ne peuvent être que masquées (juste au-dessus),
                      jamais supprimées définitivement. */}
                  {peutModifier && !DEFAULT_TILE_IDS.has(menuTile.id) && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Supprimer définitivement "${menuTile.title}" ? Impossible à annuler.`)) {
                          handlePermanentDeleteTile(menuTile.id);
                          setActionsMenuTileId(null);
                        }
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-red-900/30 hover:bg-red-900/50 border border-red-500/30 text-left transition-colors text-sm text-red-300"
                    >
                      <Trash2 className="w-4 h-4 shrink-0" /> Supprimer définitivement
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default AccueilGrid;
