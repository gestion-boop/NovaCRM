import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AGENCIES, Task } from '@/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSwipeBack } from '@/hooks/useSwipeBack';
import NovaInfoPanel from './NovaInfoPanel';
// Ticket #283 (KO, "pas des flèches, plutôt un drag and drop") — même
// mécanisme déjà utilisé pour l'accueil et le pipeline, pour un glisser
// cohérent avec le reste du CRM.
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Zap,
  Send,
  Bot,
  Sparkles,
  User,
  CheckCircle2,
  Calendar,
  UserPlus,
  CheckSquare,
  FileText,
  RefreshCw,
  Clock,
  Building2,
  Plus,
  Trash2,
  AlertCircle,
  Lightbulb,
  Check,
  ChevronRight,
  ChevronLeft,
  Mic,
  Square,
  Image as ImageIcon,
  MessageSquare,
  ExternalLink,
  Mail,
  ChevronUp,
  ChevronDown,
  X,
  Loader2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

import { supabase } from '@/lib/supabase';
import { assemblerDictee } from '@/lib/dictee';
import { creerNote } from '@/lib/novaQuickActions';
import { IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID, IMMOSPHERA_AGENCY_ID } from './TransactionChecklistModal';
import { useAuth } from '@/context/AuthContext';
import { useContacts } from '@/hooks/useContacts';
import { useTasks } from '@/hooks/useTasks';
import { useDeals } from '@/hooks/useDeals';
import { requestWorkspaceAccessToken, searchGoogleDriveFiles, GoogleDriveFileResult, fetchGoogleCalendarEvents, createGoogleCalendarEvent, sendGmailMessage, uploadImageToDriveFolder, fetchGmailSignature } from '@/lib/workspace';

// Signalé : "le mail depuis Nova ne s'envoie pas" — les outils Google
// Workspace de Nova (mail, agenda, Drive, upload image) ne lisaient QUE le
// `provider_token` brut de la session Supabase (valable ~1h, jamais
// rafraîchi), sans jamais passer par le système de renouvellement serveur
// indéfini déjà en place (ticket #117, `requestWorkspaceAccessToken`) et
// utilisé partout ailleurs dans le CRM (Drive, agenda classiques...). Dès
// que ce jeton d'1h expirait, tous les outils Google de Nova échouaient
// silencieusement, même avec un compte parfaitement reconnecté côté
// serveur. `requestWorkspaceAccessToken` retombe lui-même sur l'ancien
// mécanisme si le compte n'a jamais été relié côté serveur — donc aucune
// régression, uniquement un vrai renouvellement automatique en plus.
const resolveWorkspaceAccessToken = async (): Promise<string | null> => {
  try {
    return await requestWorkspaceAccessToken();
  } catch {
    return null;
  }
};

// Voir commentaire à l'appel : garantit qu'un contact/collaborateur cité par
// son nom dans le message reste toujours dans la liste envoyée à Nova, même
// tronquée — plutôt qu'un simple `.slice(0, limit)` qui dépend de l'ordre
// (souvent la date de création) et peut couper un client existant mais
// "trop loin" dans la liste.
function prioritizeMentioned<T extends { name?: string }>(items: T[], message: string, limit: number): T[] {
  const normalizedMessage = message.toLocaleLowerCase('fr-FR');
  const mentioned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const name = item.name?.trim();
    if (name && name.length >= 3 && normalizedMessage.includes(name.toLocaleLowerCase('fr-FR'))) {
      mentioned.push(item);
    } else {
      rest.push(item);
    }
  }
  return [...mentioned, ...rest].slice(0, limit);
}
import NovaMascotte from './NovaMascotte';

// Signalé : "quand on crée une tâche aux clients, je voudrais qu'il me
// mette un lien pour accéder directement à la fiche" — `contactId` permet
// d'afficher un lien cliquable "Voir la fiche" sur la carte de confirmation
// quand l'action porte sur un client précis (task/note liés à un contact,
// ou contact lui-même tout juste créé).
export interface ActionExecuted {
  type: 'contact' | 'task' | 'note' | 'appointment' | 'drive_search' | 'summary';
  title: string;
  details: string;
  contactId?: string;
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (13/16) : résultats de
  // recherche Google Drive — rendus en liste de liens cliquables (chacun
  // ouvre webViewLink dans un nouvel onglet) plutôt qu'en simple texte.
  driveFiles?: GoogleDriveFileResult[];
}

// Échec explicite d'une action demandée à Nova — ticket #7/#8 : distinguer
// clairement ce qui a réussi de ce qui a échoué, avec la raison précise,
// au lieu de laisser l'échec disparaître silencieusement.
export interface ActionFailed {
  label: string;
  reason: string;
}

// Ticket #251 : mêmes fonctions que MailView.tsx (non exportées de là-bas)
// pour composer un corps HTML fidèle à la signature réelle de l'utilisateur
// dans la carte de prévisualisation d'e-mail Nova.
const htmlSignatureToText = (html: string): string => {
  if (!html?.trim()) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n');
  const container = document.createElement('div');
  container.innerHTML = withBreaks;
  const text = container.textContent || '';
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const escapeHtmlForEmail = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildEmailHtmlBody = (plainBody: string, signatureHtml: string): string =>
  `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:13px;">${escapeHtmlForEmail(plainBody)}</div><br>${signatureHtml}`;

// Résultat compact d'un bien Immosphera360 renvoyé par l'outil serveur
// search_properties — affiché en vignette (photo + descriptif), plusieurs
// biens côte à côte si la recherche en remonte plusieurs.
export interface PropertyResult {
  id: string;
  title: string;
  description: string;
  address: string;
  price: number | null;
  surfaceArea: number | null;
  rooms: number | null;
  bedrooms: number | null;
  propertyType: string | null;
  listingType: string | null;
  image: string | null;
  images?: string[];
  listingUrl: string | null;
}

// Ticket "Clients invités" (13/13) : contrairement aux autres actions
// (créées immédiatement), invite_client_guest / request_client_document /
// set_client_guest_access_status touchent l'accès d'un client à son espace
// personnel — jamais exécutées sans confirmation manuelle explicite.
// Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16) : même principe
// pour les capacités étendues réservées à "nova_super_assistant" — inviter/
// désactiver un collaborateur, créer une automatisation, publier une
// annonce. `contactId` reste optionnel : ces quatre-là n'en ont pas
// (voir `args` pour leurs propres champs : userId, agencyId...).
export interface PendingClientAction {
  id: string;
  toolName:
    | 'invite_client_guest' | 'request_client_document' | 'set_client_guest_access_status'
    | 'invite_collaborator' | 'set_collaborator_active_status' | 'create_pipeline_automation' | 'create_announcement'
    | 'create_appointment' | 'create_support_ticket' | 'send_client_email';
  contactId?: string;
  args: Record<string, unknown>;
  status: 'pending' | 'busy' | 'done' | 'error' | 'cancelled';
  resultLabel?: string;
  errorMessage?: string;
}

export interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
  actionsExecuted?: ActionExecuted[];
  actionsFailed?: ActionFailed[];
  properties?: PropertyResult[];
  pendingClientActions?: PendingClientAction[];
  // Ticket #250 : image générée par Nova (generate_image), affichée avec
  // ses actions dédiées (Télécharger/Régénérer/Variante/Copier/Utiliser).
  generatedImage?: { dataUrl: string; intent: string; label: string };
  // Architecture vocale à deux niveaux (voir api/ai/agent.ts, marqueur
  // [[SPEECH: ...]] / [[NO_SPEECH]]) : version courte décidée par Claude,
  // utilisée par le mode vocal (nébuleuse) au lieu du texte complet
  // affiché ci-dessus. `shouldSpeak=false` = Claude juge qu'une lecture à
  // voix haute n'apporte rien (déjà lisible à l'écran).
  speechText?: string | null;
  shouldSpeak?: boolean;
}

const QUICK_PROMPTS = [
  {
    icon: Clock,
    label: 'Point sur ma journée',
    prompt: 'Fais-moi un point complet sur ma journée (tâches du jour, rendez-vous prévus, opportunités en cours).',
    color: 'from-[#F7BC5F]/20 to-[#D9A34E]/10 border-[#F7BC5F]/30 text-[#F9C977]'
  },
  {
    icon: Calendar,
    label: 'Prochains RDV & Tâches',
    prompt: 'Quels sont mes prochains rendez-vous et tâches prioritaires à venir dans les 7 prochains jours ?',
    color: 'from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400'
  },
  {
    icon: UserPlus,
    label: 'Créer un contact',
    // Ticket #1 (nouvelle base) : ces exemples ne doivent jamais déclencher
    // une action réelle au clic — ils servent uniquement à amorcer une
    // discussion. Le prompt demande donc une explication, pas une exécution.
    prompt: 'Explique-moi comment te demander de créer un nouveau contact client, avec un exemple de formulation.',
    color: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400'
  },
  {
    icon: CheckSquare,
    label: 'Créer une tâche',
    prompt: 'Explique-moi comment te demander de créer une tâche, avec un exemple de formulation.',
    color: 'from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-400'
  },
  {
    icon: FileText,
    label: 'Ajouter une note client',
    prompt: 'Explique-moi comment te demander d\'ajouter une note à un client, avec un exemple de formulation.',
    color: 'from-teal-500/20 to-teal-600/10 border-teal-500/30 text-teal-400'
  },
  {
    icon: Calendar,
    label: 'Fixer un rendez-vous',
    prompt: 'Explique-moi comment te demander de planifier un rendez-vous, avec un exemple de formulation.',
    color: 'from-rose-500/20 to-rose-600/10 border-rose-500/30 text-rose-400'
  }
];

// Raccourcis contextuels quand Nova est ouvert depuis une fiche client (ClientProfileView)
const getClientQuickPrompts = (clientName: string) => [
  {
    icon: FileText,
    label: 'Ajouter une note',
    prompt: `Ajoute une note sur le dossier de ${clientName} : `,
    isPrefill: true,
    color: 'bg-teal-500/15 text-teal-700 border-teal-500/30'
  },
  {
    icon: Calendar,
    label: 'Fixer un RDV',
    prompt: `Planifie un rendez-vous avec ${clientName}`,
    isPrefill: false,
    color: 'bg-[#F7BC5F]/20 text-[#B8863F] border-[#F7BC5F]/40'
  },
  {
    icon: CheckSquare,
    label: 'Créer une tâche',
    prompt: `Crée une tâche de suivi pour ${clientName} : `,
    isPrefill: true,
    color: 'bg-purple-500/15 text-purple-700 border-purple-500/30'
  },
  {
    icon: Sparkles,
    label: 'Synthèse du dossier',
    prompt: `Fais-moi une synthèse complète du dossier de ${clientName} (situation, profil, historique et points clés).`,
    isPrefill: false,
    color: 'bg-amber-500/15 text-amber-700 border-amber-500/30'
  },
  {
    icon: Mail,
    label: 'Rédiger un e-mail',
    prompt: `Rédige un projet d'e-mail professionnel et chaleureux pour ${clientName} concernant son dossier.`,
    isPrefill: false,
    color: 'bg-sky-500/15 text-sky-700 border-sky-500/30'
  },
  {
    icon: RefreshCw,
    label: 'Prochaine étape',
    prompt: `Quelle est la prochaine étape recommandée pour faire avancer le dossier de ${clientName} ?`,
    isPrefill: false,
    color: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
  }
];

// Fonds d'écran dédiés à l'écran Nova IA (images fournies par Sylvain,
// optimisées en JPEG léger + miniature). Choix stocké en local par
// navigateur, indépendant du fond d'écran général du CRM (Paramètres).
const NOVA_WALLPAPERS = Array.from({ length: 13 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    id: `nova-ia-${n}`,
    url: `/wallpapers/nova-ia/nova-ia-${n}.jpg`,
    thumb: `/wallpapers/nova-ia/thumbs/nova-ia-${n}.jpg`,
  };
});

// Demande explicite (8 septembre) : « désactive le système vocal de Nova
// pour l'instant, on garde que le système bureau » — coupe les 3 points
// d'entrée (dictée micro, mode vocal en direct "nébuleuse", lecture à voix
// haute des réponses) sans retirer le code, pour pouvoir le réactiver
// d'un coup en repassant ce drapeau à true.
const VOICE_FEATURES_ENABLED = false;

const NOVA_WALLPAPER_STORAGE_KEY = 'novasphere:novaai-wallpaper';
const NOVA_WALLPAPER_OPACITY_STORAGE_KEY = 'novasphere:novaai-wallpaper-opacity';

// Ticket #281 : les réponses "Bilan de la journée" / "Résumé des prochains
// jours" (get_daily_summary / get_upcoming_brief plus bas dans ce fichier)
// arrivent sous forme d'un unique bloc de texte (lignes jointes par \n, un
// "📋 ..."/"📅 ..." d'en-tête puis des lignes "• ..."), rendu tel quel —
// dense et peu lisible ("pas très visible", signalé). Format prévisible :
// on le reparse ici en vraies sections + listes à puces, sans toucher à la
// génération du texte (qui reste utile telle quelle pour la copie/lecture
// vocale).
// Ticket #283 (KO sur les flèches, "plutôt un drag and drop") : une carte de
// raccourci rapide déplaçable — même mécanisme dnd-kit que l'accueil et le
// pipeline pour une prise en main cohérente avec le reste du CRM.
const SortableQuickPrompt: React.FC<{
  label: string;
  Icon: React.FC<{ className?: string }>;
  onSelect: () => void;
  color?: string;
}> = ({ label, Icon, onSelect, color }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: label });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
      className={`w-full px-3 py-2.5 sm:px-4 sm:py-3 rounded-2xl bg-white/80 hover:bg-white border border-white/90 shadow-sm hover:shadow text-left flex items-center gap-2.5 sm:gap-3 text-[#1a1230] text-xs sm:text-sm font-semibold transition-all touch-none cursor-grab active:cursor-grabbing group hover:scale-[1.01] ${
        isDragging ? 'opacity-40 z-50 shadow-lg' : ''
      }`}
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${color || 'bg-[#F7BC5F]/20 text-[#B8863F] border-[#F7BC5F]/30'}`}>
        <Icon className="w-4 h-4" />
      </div>
      {/* Demande explicite (30/08/2026) : "sur desktop, avoir les textes en
          entiers" — `truncate` coupait "Prochains RDV & Tâches"/"Ajouter
          une note client" en "...". Retiré : le texte passe à la ligne au
          besoin plutôt que d'être coupé. */}
      <span className="leading-tight font-bold">{label}</span>
    </button>
  );
};

const renderSummaryItem = (item: string, index: number) => {
  // Pattern 1: Contact avec gras markdown: **Nom Contact** — Titre tâche — Date
  const contactMatch = item.match(/^\*\*([^*]+)\*\*\s*—\s*(.+?)\s*—\s*(.+)$/);
  if (contactMatch) {
    const [, contactName, taskTitle, datePart] = contactMatch;
    return (
      <div
        key={index}
        className="p-3 sm:p-3.5 rounded-xl bg-white/85 hover:bg-white border border-emerald-500/25 hover:border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs transition-all group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-[#F7BC5F]/25 text-[#88540d] border border-[#F7BC5F]/40 shrink-0 shadow-xs flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-[#B8863F]" />
            <span>{contactName}</span>
          </span>
          <span className="font-semibold text-slate-900 text-sm truncate">
            {taskTitle}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-800 text-xs font-bold shrink-0 self-start sm:self-auto border border-emerald-500/20">
          <Calendar className="w-3.5 h-3.5 text-emerald-600" />
          <span className="capitalize">{datePart}</span>
        </div>
      </div>
    );
  }

  // Pattern 2: Titre — Date / Heure
  const titleDateMatch = item.match(/^(.+?)\s*—\s*(.+)$/);
  if (titleDateMatch) {
    const [, mainTitle, dateOrDetail] = titleDateMatch;
    const cleanTitle = mainTitle.replace(/\*\*/g, '');
    const isAppointment = dateOrDetail.includes('à') || dateOrDetail.includes(':');
    return (
      <div
        key={index}
        className="p-3 sm:p-3.5 rounded-xl bg-white/85 hover:bg-white border border-emerald-500/25 hover:border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs transition-all group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black uppercase tracking-wider shrink-0 border ${
            isAppointment ? 'bg-sky-500/15 text-sky-800 border-sky-500/30' : 'bg-teal-500/15 text-teal-800 border-teal-500/30'
          }`}>
            {isAppointment ? 'RDV' : 'Action'}
          </span>
          <span className="font-semibold text-slate-900 text-sm truncate">
            {cleanTitle}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-800 text-xs font-bold shrink-0 self-start sm:self-auto border border-emerald-500/20">
          {isAppointment ? <Clock className="w-3.5 h-3.5 text-sky-600" /> : <Calendar className="w-3.5 h-3.5 text-teal-600" />}
          <span>{dateOrDetail}</span>
        </div>
      </div>
    );
  }

  // Fallback: Rendu Markdown propre sans astérisques bruts
  return (
    <div key={index} className="p-2.5 rounded-xl bg-white/70 border border-emerald-500/15 text-sm text-emerald-950 flex items-start gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 shrink-0" />
      <div className="min-w-0 flex-1 font-medium">
        <Markdown>{item}</Markdown>
      </div>
    </div>
  );
};

const SummaryDetails: React.FC<{ details: string }> = ({ details }) => {
  const sections: { header: string; items: string[] }[] = [];
  let current: { header: string; items: string[] } | null = null;
  details.split('\n').forEach((line) => {
    if (!line.trim()) {
      current = null;
      return;
    }
    if (line.startsWith('• ')) {
      current?.items.push(line.slice(2));
    } else {
      current = { header: line, items: [] };
      sections.push(current);
    }
  });
  if (sections.length === 0) {
    return <p className="mt-0.5 text-sm sm:text-base text-emerald-800/90 whitespace-pre-line leading-relaxed">{details}</p>;
  }
  return (
    <div className="mt-2.5 space-y-3">
      {sections.map((sec, si) => {
        const isTasks = sec.header.includes('📋') || sec.header.toLowerCase().includes('tâche');
        const isAppointments = sec.header.includes('📅') || sec.header.toLowerCase().includes('rendez-vous');
        const isOverdue = sec.header.includes('⚠️') || sec.header.toLowerCase().includes('retard');

        const cleanHeader = sec.header.replace(/^[📋📅⚠️✅]\s*/, '');

        return (
          <div key={si} className="rounded-2xl border border-emerald-500/25 bg-white/75 backdrop-blur-md p-3.5 sm:p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-500/15">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                  isOverdue ? 'bg-rose-500/15 text-rose-700 border-rose-500/30' :
                  isAppointments ? 'bg-sky-500/15 text-sky-700 border-sky-500/30' :
                  'bg-teal-500/15 text-teal-700 border-teal-500/30'
                }`}>
                  {isOverdue ? <AlertCircle className="w-4 h-4" /> :
                   isAppointments ? <Calendar className="w-4 h-4" /> :
                   <CheckSquare className="w-4 h-4" />}
                </div>
                <span className="text-sm font-black text-slate-900 tracking-tight">
                  {cleanHeader}
                </span>
              </div>
              {sec.items.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 text-xs font-black">
                  {sec.items.length}
                </span>
              )}
            </div>

            {sec.items.length > 0 && (
              <div className="space-y-2">
                {sec.items.map((item, ii) => renderSummaryItem(item, ii))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

interface AssistantIAViewProps {
  // Question posée depuis la barre NovaAI de l'accueil — envoyée
  // automatiquement à l'ouverture, sans dupliquer la logique d'appel IA.
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  // Demande explicite : une recherche immobilière depuis Nova IA (accueil ou
  // ailleurs) doit ouvrir directement Immosphera360 avec les biens trouvés,
  // au lieu de rester dans le chat avec des vignettes. Le parent (App.tsx)
  // reçoit les ids trouvés + la requête pour naviguer vers le module.
  onFoundProperties?: (ids: string[], queryText: string) => void;
  // Bouton retour (mobile uniquement) — la barre de navigation du bas ne
  // reste plus visible par-dessus cet écran, il faut donc un moyen d'en
  // sortir intégré à l'écran lui-même.
  onClose?: () => void;
  // Signalé : "je voudrais qu'il me mette un lien pour accéder directement
  // à la fiche du client" — ouvre la fiche (ClientProfileView, App.tsx) et
  // referme Nova, exactement comme un clic sur un contact ailleurs dans le CRM.
  onOpenContact?: (contactId: string) => void;
  // Ticket #251 : fiche client actuellement ouverte (App.tsx,
  // selectedClientProfileId) — permet à Nova de résoudre "lui"/"elle"/"ce
  // client" sans que l'utilisateur ait à répéter le nom.
  currentClientId?: string | null;
  // Demande explicite : "mets Nova dans Pipeline" — pré-remplit le champ de
  // saisie (JAMAIS envoyé automatiquement, contrairement à `initialPrompt`)
  // avec un texte de départ, ex. le nom d'un dossier cliqué, pour ne pas
  // avoir à le retaper. L'utilisateur complète et envoie lui-même.
  prefillPrompt?: string | null;
  onPrefillPromptConsumed?: () => void;
  // Demande explicite : "mode Commercial/Bureau" — ouvre directement le
  // mode vocal (nébuleuse) au montage, sans passer par le chat texte
  // (App.tsx ne l'active que depuis les points d'entrée Nova du mobile,
  // selon la préférence mémorisée — voir openNovaMobile).
  autoVoiceMode?: boolean;
  onAutoVoiceModeConsumed?: () => void;
  // Demande explicite (30/08/2026) : "quand on clique sur le bonhomme ne
  // met pas l'historique à chaque fois... sauvegarde l'historique, mais
  // crée une nouvelle interface à chaque fois qu'on clique dessus" — l'accès
  // Nova plein écran (clic sur la mascotte, Sidebar → novaOpen dans
  // App.tsx) doit rouvrir sur l'accueil vierge à chaque fois, sans
  // ré-afficher les anciens messages.
  // Étendu (24 octobre) : "quand on ouvre il faudrait qu'il y ait une
  // nouvelle discussion" — par défaut `true` désormais (plus seulement pour
  // le plein écran : aussi pour la mini-popup contextuelle fiche
  // client/Pipeline, qui gardait jusqu'ici volontairement l'historique
  // visible à la réouverture). Et une ouverture "fraîche" ne charge plus
  // non plus l'ancien historique dans `novaFullHistoryRef` : Nova ne s'en
  // souvient plus en coulisse non plus, la conversation repart vraiment de
  // zéro à chaque ouverture. L'historique reste quand même en base
  // (`assistant_messages` continue d'être écrit par persistNovaMessage plus
  // bas) — seulement plus relu au montage quand `startFresh` est vrai.
  // Passé explicitement à `false` uniquement pour l'agrandissement
  // plein écran DEPUIS une popup déjà ouverte (App.tsx,
  // `!novaExpandedFromPopup`) : ce n'est pas une nouvelle ouverture, juste
  // un changement de taille de la même conversation en cours.
  startFresh?: boolean;
}

// Mode vocal (nébuleuse, voir plus bas) : positions/tailles/couleurs des
// particules scintillantes générées UNE SEULE FOIS au chargement du module
// (jamais à chaque rendu, sinon elles sauteraient partout à chaque
// changement d'état) — dispersées tout autour du halo, quelques-unes plus
// dorées, d'autres plus pâles/blanches pour varier, comme de la vraie
// poussière stellaire.
const NEBULA_SPARKS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2 + (i % 3) * 0.4;
  const radius = 38 + ((i * 37) % 30); // 38–68 % du rayon, dispersé irrégulièrement
  return {
    top: 50 + Math.sin(angle) * radius,
    left: 50 + Math.cos(angle) * radius,
    size: 2 + (i % 4),
    color: i % 3 === 0 ? '#FFF3C4' : i % 3 === 1 ? '#FFE066' : '#F7BC5F',
    duration: 1.6 + (i % 5) * 0.35,
    delay: (i * 0.27) % 2,
  };
});

export const AssistantIAView: React.FC<AssistantIAViewProps> = ({ initialPrompt, onInitialPromptConsumed, onFoundProperties, onClose, onOpenContact, currentClientId, prefillPrompt, onPrefillPromptConsumed, autoVoiceMode, onAutoVoiceModeConsumed, startFresh = true }) => {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const { allContacts = [], addContact } = useContacts();
  const activeClient = currentClientId ? allContacts.find((c) => c.id === currentClientId) : null;
  const { tasks = [], addTask, updateTask } = useTasks();
  const { deals = [] } = useDeals();
  // Réutilisé plus bas : (1) compacter l'en-tête Nova sur mobile pour ne
  // plus recouvrir le bouton retour, (2) désactiver l'écoute-micro du
  // barge-in sur mobile (voir startBargeInListener).
  const isMobile = useIsMobile();
  const swipeBackRef = useSwipeBack<HTMLDivElement>(onClose, isMobile);

  const [calendarEvents, setCalendarEvents] = useState<Record<string, unknown>[]>([]);
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16) : liste des
  // collaborateurs (id/nom/rôle) transmise au system prompt pour
  // set_collaborator_active_status — seul un super admin peut de toute
  // façon obtenir cette liste côté serveur (/api/settings/bootstrap).
  const [collaborators, setCollaborators] = useState<{ id: string; name: string; role: string }[]>([]);
  useEffect(() => {
    if (userProfile?.role !== 'super_admin' || !currentUser) return;
    (async () => {
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/settings/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.json().catch(() => ({}));
        const list = Array.isArray(body?.users) ? body.users : [];
        setCollaborators(list.map((u: any) => ({ id: u.id, name: u.full_name || u.email || u.id, role: u.role })));
      } catch (err) {
        console.warn('Erreur chargement collaborateurs pour agent IA:', err);
      }
    })();
  }, [userProfile?.role, currentUser]);
  // Demande explicite : pouvoir réordonner les raccourcis rapides de Nova
  // ("Point sur ma journée", "Fixer un rendez-vous"...) — ordre mémorisé
  // par appareil (comme navOrder pour le menu latéral). Reconstruit à
  // partir des libellés (pas des index) pour rester robuste si de nouveaux
  // raccourcis sont ajoutés plus tard : les nouveaux arrivent à la fin,
  // sans jamais perdre l'ordre déjà personnalisé des existants.
  const QUICK_PROMPTS_ORDER_KEY = 'novasphere:nova-quick-prompts-order';
  const [quickPromptOrder, setQuickPromptOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(QUICK_PROMPTS_ORDER_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return QUICK_PROMPTS.map((p) => p.label);
  });
  const orderedQuickPrompts = (() => {
    const byLabel = new Map(QUICK_PROMPTS.map((p) => [p.label, p]));
    const ordered = quickPromptOrder.map((label) => byLabel.get(label)).filter((p): p is typeof QUICK_PROMPTS[number] => Boolean(p));
    QUICK_PROMPTS.forEach((p) => { if (!quickPromptOrder.includes(p.label)) ordered.push(p); });
    return ordered;
  })();
  const quickPromptSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );
  const handleQuickPromptDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const labels = orderedQuickPrompts.map((p) => p.label);
    const oldIndex = labels.indexOf(String(active.id));
    const newIndex = labels.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(labels, oldIndex, newIndex);
    setQuickPromptOrder(next);
    try { localStorage.setItem(QUICK_PROMPTS_ORDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-1',
      sender: 'ai',
      // Demande explicite : Nova ne doit saluer qu'avec le prénom, jamais le
      // nom de famille (déjà le cas ailleurs — MobileHome, "Comment ça va,
      // {firstName}" plus bas dans ce même fichier — oublié ici).
      text: `Bonjour **${(userProfile?.displayName || currentUser?.displayName || 'Sylvain').split(' ')[0]}** !\n\nJe suis **Nova**, votre assistant intelligent connecté en direct au CRM.\n\nJe peux vous assister pour :\n• 📊 **Faire le point sur votre journée** ou sur les prochains jours\n• 👤 **Créer directement des contacts & clients**\n• 📋 **Créer et attribuer des tâches prioritaires**\n• 📝 **Prendre des notes de suivi clients**\n• 📅 **Planifier des rendez-vous et visites dans l'agenda**\n\n_Que souhaitez-vous faire aujourd'hui ?_`,
      timestamp: format(new Date(), 'HH:mm')
    }
  ]);

  // Demande explicite : "intégrer Nova dans la fiche du client" — ouvert
  // depuis le bouton "Demander à Nova" d'une fiche (ClientProfileView),
  // `currentClientId` est déjà transmis (App.tsx) et le prompt système
  // sait déjà y résoudre les actions SANS que l'utilisateur répète le nom
  // (voir agent.ts, "Client actuellement affiché"). Ici, uniquement pour la
  // clarté visuelle : personnalise le message d'accueil avec le nom du
  // client tant que la conversation est encore vierge (n'écrase jamais un
  // historique restauré ni une conversation déjà commencée) — dépend d'un
  // effet plutôt que du useState initial car `allContacts` peut ne pas
  // encore être chargé au tout premier rendu.
  useEffect(() => {
    if (!currentClientId) return;
    const client = allContacts.find((c) => c.id === currentClientId);
    if (!client) return;
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0].id !== 'welcome-1') return prev; // conversation déjà en cours ou restaurée, on n'y touche pas
      return [
        {
          ...prev[0],
          text: `Bonjour **${(userProfile?.displayName || currentUser?.displayName || 'Sylvain').split(' ')[0]}** !\n\nJe suis **Nova**, et je regarde en ce moment la fiche de **${client.name}**.\n\nDites-moi ce que vous voulez y faire : une note, une tâche, un rendez-vous, un e-mail... je m'occupe de tout rattacher directement à ce dossier.`,
        },
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClientId, allContacts.length]);

  // Demande explicite : "mémoire de conversation" — Nova oubliait tout dès
  // que la conversation était fermée ou la page rechargée (état purement en
  // mémoire côté React, jamais persisté). Les tables `assistant_threads` /
  // `assistant_messages` existaient déjà en base (créées avant cette
  // session) mais n'étaient jamais lues ni écrites. Un seul fil CONTINU par
  // utilisateur (le plus récent, créé si besoin), pas une UI de gestion de
  // plusieurs conversations nommées — répond au besoin exprimé sans
  // reconstruire une fonctionnalité entière. Le payload envoyé à l'API
  // (`messages: messages.map(...)`, plus bas) reprend déjà tel quel le
  // contenu de `messages` : recharger l'historique dans cet état suffit à
  // ce que Nova en tienne compte dans sa prochaine réponse, sans toucher à
  // api/ai/agent.ts.
  const novaThreadIdRef = useRef<string | null>(null);
  const novaHistoryLoadedRef = useRef(false);
  // Demande explicite ensuite : "on ne peut pas faire en sorte qu'il
  // retienne TOUT ? [même si] on efface l'historique" — deux mémoires
  // distinctes : `messages` (ce qui s'affiche à l'écran, remis à zéro
  // visuellement par "Effacer l'historique") et ce ref (TOUJOURS complet,
  // jamais vidé par ce bouton — c'est lui qui part dans le payload envoyé à
  // l'API, voir plus bas). "Effacer" ne fait donc plus qu'un ménage visuel :
  // Nova continue de savoir tout ce qui a été dit, même après un effacement.
  const novaFullHistoryRef = useRef<{ sender: 'user' | 'ai'; text: string }[]>([]);
  useEffect(() => {
    if (!currentUser?.uid || novaHistoryLoadedRef.current) return;
    novaHistoryLoadedRef.current = true;
    (async () => {
      try {
        const { data: existingThread } = await supabase
          .from('assistant_threads' as any)
          .select('id')
          .eq('user_id', currentUser.uid)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let threadId = (existingThread as any)?.id as string | undefined;
        if (!threadId) {
          const { data: created } = await supabase
            .from('assistant_threads' as any)
            .insert({ user_id: currentUser.uid, title: 'Conversation avec Nova' } as any)
            .select('id')
            .single();
          threadId = (created as any)?.id;
        }
        if (!threadId) return;
        novaThreadIdRef.current = threadId;

        const { data: history } = await supabase
          .from('assistant_messages' as any)
          .select('role, content, created_at')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: true })
          .limit(200);

        const restored = ((history || []) as any[]).map((m, i) => ({
          id: `hist-${i}-${m.created_at}`,
          sender: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
          text: m.content as string,
          timestamp: format(new Date(m.created_at), 'HH:mm'),
        }));

        // Demande explicite (24 octobre) : « quand on ouvre il faudrait
        // qu'il y ait une nouvelle discussion » — contrairement à avant
        // (où une ouverture "fraîche" ne remettait à zéro que l'affichage,
        // Nova se souvenant quand même de tout en coulisse), l'historique
        // n'est désormais chargé dans la mémoire envoyée à l'IA que si on
        // N'est PAS en ouverture fraîche. L'historique reste en base
        // (assistant_messages n'est pas touché, juste pas relu ici).
        novaFullHistoryRef.current = startFresh ? [] : restored.map((m) => ({ sender: m.sender, text: m.text }));

        // Historique restauré = on remplace le message d'accueil générique
        // (déjà présent dans une session précédente, sinon ce serait un
        // doublon) ; sinon, aucun changement — la salutation par défaut reste.
        // On ne remontre que les 60 derniers à l'écran (lisibilité), même si
        // le ref ci-dessus, lui, garde tout ce qui a été chargé.
        if (restored.length > 0 && !startFresh) {
          setMessages(restored.slice(-60) as Message[]);
          // Ouverture avec un historique restauré : démarrer sur les
          // derniers échanges (pas en haut de plusieurs jours de
          // conversation) — un seul défilement, à l'ouverture, jamais
          // répété ensuite (voir "verrouille le panneau" plus haut).
          requestAnimationFrame(() => scrollToBottom());
        }
      } catch (err) {
        console.warn('Erreur chargement mémoire Nova :', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, startFresh]);

  const persistNovaMessage = (role: 'user' | 'assistant', content: string) => {
    novaFullHistoryRef.current = [...novaFullHistoryRef.current, { sender: role === 'user' ? 'user' : 'ai', text: content }];
    if (!currentUser?.uid || !novaThreadIdRef.current || !content.trim()) return;
    const threadId = novaThreadIdRef.current;
    supabase
      .from('assistant_messages' as any)
      .insert({ thread_id: threadId, user_id: currentUser.uid, role, content } as any)
      .then(() => {}, (err: any) => console.warn('Erreur sauvegarde message Nova :', err));
    supabase
      .from('assistant_threads' as any)
      .update({ last_message_at: new Date().toISOString() } as any)
      .eq('id', threadId)
      .then(() => {}, () => {});
  };

  // Demande explicite : "historique des actions de Nova" — panneau listant
  // le journal `nova_action_log` (qui existait déjà, jamais affiché nulle
  // part avant cette demande).
  const [showActionHistory, setShowActionHistory] = useState(false);
  const [actionHistory, setActionHistory] = useState<
    { id: string; toolName: string; ok: boolean; resultMessage: string | null; createdAt: string }[]
  >([]);
  const [actionHistoryLoading, setActionHistoryLoading] = useState(false);
  const openActionHistory = async () => {
    setShowActionHistory(true);
    if (!currentUser?.uid) return;
    setActionHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('nova_action_log' as any)
        .select('id, tool_name, ok, result_message, created_at')
        .eq('agent_user_id', currentUser.uid)
        .order('created_at', { ascending: false })
        .limit(50);
      setActionHistory(
        ((data || []) as any[]).map((r) => ({
          id: r.id,
          toolName: r.tool_name,
          ok: r.ok,
          resultMessage: r.result_message,
          createdAt: r.created_at,
        }))
      );
    } catch (err) {
      console.warn('Erreur chargement historique Nova :', err);
    } finally {
      setActionHistoryLoading(false);
    }
  };

  // Demande explicite : "réponse vocale... une voix d'ElevenLabs" — lecture
  // à la demande (bouton haut-parleur sur chaque réponse), pas de lecture
  // automatique systématique (coûteux en appels API, et gênant si plusieurs
  // personnes partagent le même poste/haut-parleurs).
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [loadingSpeechMessageId, setLoadingSpeechMessageId] = useState<string | null>(null);

  // Historique : "comment avoir une voix gratuite, car ElevenLabs ça va
  // coûter cher" — remplacé alors par la synthèse vocale NATIVE du
  // navigateur (`speechSynthesis`, gratuite). Puis explicitement redemandé
  // ("je n'ai pas la voix eleven... je veux la reconnecter") : ElevenLabs
  // (voix "Charlie") est donc à nouveau la voix PRINCIPALE sur ordinateur
  // (où vit la console/le panneau premium), avec repli automatique et
  // silencieux sur la voix navigateur en cas d'échec (clé absente, quota,
  // réseau...) — Nova ne doit jamais rester muette pour autant. Sur mobile,
  // la voix navigateur reste seule utilisée : y ajouter un appel réseau
  // (`await fetch`) avant la lecture réintroduirait le bug Safari iOS déjà
  // corrigé ("speak() après un await est parfois ignoré").
  const elevenLabsAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeSpeechEngineRef = useRef<'elevenlabs' | 'browser' | null>(null);
  // Contrairement à `speechSynthesis.cancel()` (déclenche onerror
  // "canceled", traité plus bas comme une résolution normale),
  // `audio.pause()` ne déclenche ni 'ended' ni 'error' — sans ce résolveur
  // explicite, une interruption manuelle (barge-in, bouton, sortie du mode
  // vocal) laisserait la promesse de speakViaElevenLabs bloquée
  // indéfiniment.
  const elevenLabsStopResolverRef = useRef<(() => void) | null>(null);
  const stopSpeaking = () => {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    const audio = elevenLabsAudioRef.current;
    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch { /* ignore */ }
      elevenLabsAudioRef.current = null;
    }
    if (elevenLabsStopResolverRef.current) {
      const resolve = elevenLabsStopResolverRef.current;
      elevenLabsStopResolverRef.current = null;
      resolve();
    }
    activeSpeechEngineRef.current = null;
  };

  // Signalé (mobile) : "je parle à Nova, je ne l'entends pas" — Safari
  // iOS/mobile est beaucoup plus strict que desktop : un `speechSynthesis
  // .speak()` appelé après un `await` (même un micro-tick, résolu tout de
  // suite) perd le rattachement au geste utilisateur et est parfois
  // silencieusement ignoré. Avant, `getFrenchVoice()` était `await`é juste
  // avant `speak()` — donc jamais réellement synchrone. Corrigé : la voix FR
  // est désormais mise en cache dès le montage du composant (ci-dessous),
  // pour que `speakText` puisse appeler `speak()` en tout premier, sans
  // aucun `await` avant.
  const cachedFrenchVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const pickFrenchVoice = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
    if (voices.length === 0) return null;
    // Préférence : une vraie voix française locale (pas "réseau", plus
    // rapide et fiable), sinon n'importe quelle voix fr-FR/fr.
    const local = voices.find((v) => v.lang?.toLowerCase().startsWith('fr') && v.localService);
    const any = voices.find((v) => v.lang?.toLowerCase().startsWith('fr'));
    return local || any || null;
  };
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const warm = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) cachedFrenchVoiceRef.current = pickFrenchVoice(voices);
    };
    warm();
    window.speechSynthesis.addEventListener('voiceschanged', warm);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', warm);
  }, []);

  // Même nettoyage markdown que côté serveur pour ElevenLabs (**gras**,
  // listes à puces, émojis...) — jamais lu tel quel à voix haute.
  const stripMarkdownForSpeech = (text: string): string =>
    text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^[•\-]\s*/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .trim();

  // Extrait du bouton "Écouter" (voir toggleSpeakMessage plus bas) pour être
  // réutilisé par le mode vocal continu (voir plus bas, "nébuleuse Nova") —
  // la promesse ne se résout qu'une fois la lecture terminée, pour pouvoir
  // enchaîner dessus (relancer l'écoute).
  // Tentative ElevenLabs (voix "Charlie", api/ai/agent.ts mode:'speak') —
  // renvoie l'audio joué avec succès, ou lève pour déclencher le repli.
  // Mémorise si ElevenLabs n'est pas configuré pour éviter de faire ramer chaque message avec un appel 500
  const elevenLabsDisabledRef = useRef(false);
  const speakViaElevenLabs = async (cleaned: string, onStart?: () => void): Promise<void> => {
    const res = await fetch('/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'speak', text: cleaned }),
    });
    if (!res.ok) {
      elevenLabsDisabledRef.current = true;
      throw new Error('elevenlabs_unavailable');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = voiceVolumeRef.current;
    audio.playbackRate = voiceRateRef.current;
    elevenLabsAudioRef.current = audio;
    activeSpeechEngineRef.current = 'elevenlabs';
    await new Promise<void>((resolve, reject) => {
      elevenLabsStopResolverRef.current = resolve;
      audio.onplay = () => onStart?.();
      audio.onended = () => { URL.revokeObjectURL(url); elevenLabsStopResolverRef.current = null; resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); elevenLabsStopResolverRef.current = null; reject(new Error('audio_playback_failed')); };
      audio.play().catch((e) => { URL.revokeObjectURL(url); elevenLabsStopResolverRef.current = null; reject(e); });
    });
  };

  const speakText = async (text: string, onStart?: () => void): Promise<void> => {
    stopSpeaking();
    const cleaned = stripMarkdownForSpeech(text);
    if (!cleaned) return;
    lastSpokenTextRef.current = cleaned;

    if (!isMobile && !elevenLabsDisabledRef.current) {
      try {
        await speakViaElevenLabs(cleaned, onStart);
        return;
      } catch (e) {
        console.warn('ElevenLabs indisponible, bascule immédiate sur la voix locale rapide :', e);
        elevenLabsDisabledRef.current = true;
        activeSpeechEngineRef.current = null;
      }
    }

    if (!('speechSynthesis' in window)) {
      throw new Error("La synthèse vocale n'est pas supportée par ce navigateur.");
    }
    activeSpeechEngineRef.current = 'browser';
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = 'fr-FR';
      // Voix déjà en cache (préchargée au montage, voir plus haut) — pas
      // d'`await` ici avant `speak()`, condition nécessaire sur Safari
      // iOS/mobile pour que la lecture ne soit pas silencieusement ignorée.
      if (cachedFrenchVoiceRef.current) utterance.voice = cachedFrenchVoiceRef.current;
      utterance.rate = voiceRateRef.current;
      utterance.volume = voiceVolumeRef.current;
      utterance.onstart = () => onStart?.();
      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        // "interrupted"/"canceled" : provoqué par nous-mêmes (stopSpeaking,
        // ou une nouvelle lecture qui coupe la précédente) — pas une vraie
        // erreur à afficher à l'utilisateur.
        if (e.error === 'interrupted' || e.error === 'canceled') resolve();
        else reject(new Error('Lecture audio impossible.'));
      };
      window.speechSynthesis.speak(utterance);
    });
  };

  // Contrôles de la console vocale — pause/reprise nativement supportée
  // par les DEUX moteurs (`HTMLAudioElement.pause()/play()` pour
  // ElevenLabs, `speechSynthesis.pause()/resume()` pour le repli
  // navigateur) : la lecture reprend exactement où elle s'est arrêtée,
  // aucun redémarrage.
  const pauseSpeaking = () => {
    if (activeSpeechEngineRef.current === 'elevenlabs' && elevenLabsAudioRef.current) {
      elevenLabsAudioRef.current.pause();
      setIsVoicePaused(true);
      return;
    }
    try { window.speechSynthesis.pause(); setIsVoicePaused(true); } catch { /* ignore */ }
  };
  const resumeSpeaking = () => {
    if (activeSpeechEngineRef.current === 'elevenlabs' && elevenLabsAudioRef.current) {
      void elevenLabsAudioRef.current.play();
      setIsVoicePaused(false);
      return;
    }
    try { window.speechSynthesis.resume(); setIsVoicePaused(false); } catch { /* ignore */ }
  };
  const replayLastSpeech = () => {
    if (!lastSpokenTextRef.current) return;
    setIsVoicePaused(false);
    setVoiceModeStatus('speaking');
    void speakText(lastSpokenTextRef.current).finally(() => {
      if (voiceModeActiveRef.current) startVoiceModeListening();
      else setVoiceModeStatus('idle');
    });
  };
  // Vitesse/volume — ElevenLabs (`<audio>`) accepte ces réglages EN DIRECT,
  // sans interrompre la lecture en cours ; le repli navigateur
  // (`speechSynthesis`) ne les applique qu'au démarrage d'une utterance,
  // donc redémarre la lecture avec le nouveau réglage (seule façon de les
  // changer "à chaud" avec cette API). Les refs (mises à jour de façon
  // synchrone, avant tout appel à speakText) évitent de lire une valeur de
  // rendu obsolète.
  const restartSpeakingWithCurrentSettings = () => {
    if (!lastSpokenTextRef.current) return;
    setVoiceModeStatus('speaking');
    void speakText(lastSpokenTextRef.current).finally(() => {
      if (voiceModeActiveRef.current) startVoiceModeListening();
      else setVoiceModeStatus('idle');
    });
  };
  const changeVoiceRate = (r: number) => {
    voiceRateRef.current = r;
    setVoiceRate(r);
    if (activeSpeechEngineRef.current === 'elevenlabs' && elevenLabsAudioRef.current) {
      elevenLabsAudioRef.current.playbackRate = r;
    } else if (voiceModeStatus === 'speaking') {
      restartSpeakingWithCurrentSettings();
    }
  };
  const changeVoiceVolume = (v: number) => {
    voiceVolumeRef.current = v;
    setVoiceVolume(v);
    if (activeSpeechEngineRef.current === 'elevenlabs' && elevenLabsAudioRef.current) {
      elevenLabsAudioRef.current.volume = v;
    } else if (voiceModeStatus === 'speaking') {
      restartSpeakingWithCurrentSettings();
    }
  };

  const toggleSpeakMessage = async (messageId: string, text: string) => {
    // Un second clic sur le message déjà en lecture l'arrête, comme un vrai
    // bouton play/pause.
    if (speakingMessageId === messageId) {
      stopSpeaking();
      setSpeakingMessageId(null);
      return;
    }
    stopSpeaking();
    setSpeakingMessageId(null);
    setLoadingSpeechMessageId(messageId);
    try {
      await speakText(text, () => {
        // Le chargement (fetch + préparation) est terminé et la lecture
        // démarre réellement : on bascule l'icône chargement → lecture.
        setLoadingSpeechMessageId((cur) => (cur === messageId ? null : cur));
        setSpeakingMessageId(messageId);
      });
    } catch (err) {
      console.warn('Erreur lecture vocale Nova :', err);
      toast.error(err instanceof Error ? err.message : 'Impossible de lire la réponse à voix haute.');
    } finally {
      setLoadingSpeechMessageId((cur) => (cur === messageId ? null : cur));
      setSpeakingMessageId((cur) => (cur === messageId ? null : cur));
    }
  };

  // Demande explicite : "comme Siri, une nébuleuse Nova qui nous parle en
  // direct" — mode vocal continu : on parle, Nova répond ET la lit à voix
  // haute automatiquement, puis se remet à écouter toute seule, en boucle,
  // jusqu'à ce qu'on quitte le mode. `voiceModeActiveRef` (miroir à jour de
  // l'état, lu dans des callbacks asynchrones différés) évite d'agir sur une
  // valeur "figée" si l'utilisateur quitte le mode pendant que Nova
  // réfléchit/parle encore.
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const voiceModeActiveRef = useRef(false);
  useEffect(() => { voiceModeActiveRef.current = voiceModeActive; }, [voiceModeActive]);
  // Demande explicite ("interface d'assistante IA premium") : deux états
  // supplémentaires, 'success' (une action CRM vient d'aboutir) et 'error'
  // (échec réel — pas une simple interruption volontaire), en plus des 4
  // déjà existants.
  const [voiceModeStatus, setVoiceModeStatus] = useState<'listening' | 'thinking' | 'speaking' | 'idle' | 'success' | 'error'>('idle');
  // Écran nébuleuse (mode vocal) : n'affiche normalement qu'un statut
  // ("Nova vous répond…"), jamais le contenu réel de la réponse — dernier
  // repère textuel affiché quand Claude juge qu'une lecture à voix haute
  // n'apporte rien (shouldSpeak=false) : sans ça, l'utilisateur n'aurait
  // alors strictement aucun moyen de savoir ce que Nova a répondu.
  const [voiceModeLastText, setVoiceModeLastText] = useState('');
  const voiceModeRecognitionRef = useRef<any>(null);

  // Panneau flottant unique de Nova (bureau) — demande explicite : "un seul
  // panneau, plus design... doit se mettre uniquement quand il y a des
  // infos [structurées] (tâches, rendez-vous, ou autre) — pas d'échanges de
  // texte entre l'utilisateur et Nova". Contrôles réels (pause/reprise/
  // vitesse/volume) branchés sur `speechSynthesis` (moteur gratuit déjà en
  // place, voir speakText plus bas) — aucune nouvelle intégration
  // ElevenLabs, aucun changement du micro/de Claude.
  const [isVoicePaused, setIsVoicePaused] = useState(false);
  const [voiceRate, setVoiceRate] = useState(1);
  const [voiceVolume, setVoiceVolume] = useState(1);
  // Miroirs toujours à jour de voiceRate/voiceVolume, lus par speakText au
  // moment de démarrer une utterance (un `setState` seul ne serait pas
  // encore visible à cet instant si on vient de changer le réglage).
  const voiceRateRef = useRef(1);
  const voiceVolumeRef = useRef(1);
  // Contenu du panneau info — null/null tant qu'il n'y a rien de structuré
  // à montrer (le panneau reste alors invisible, voir NovaInfoPanel).
  const [voiceInfoTitle, setVoiceInfoTitle] = useState<string | null>(null);
  const [voiceInfoDetails, setVoiceInfoDetails] = useState<string | null>(null);
  const showVoiceInfo = (title: string, details: string) => {
    setVoiceInfoTitle(title);
    setVoiceInfoDetails(details);
  };
  const clearVoiceInfo = () => { setVoiceInfoTitle(null); setVoiceInfoDetails(null); };
  // Texte réellement en cours/dernier lu à voix haute — nécessaire pour que
  // "Réécouter" et le changement de vitesse/volume (qui redémarrent la
  // lecture, `speechSynthesis` ne permet pas de les appliquer à chaud) sur
  // l'utterance en cours sachent quoi relire, indépendamment de React.
  const lastSpokenTextRef = useRef('');

  // Réactivité vocale ultra-rapide (détection de silence 750ms + retour visuel instantané)
  const voiceSilenceTimerRef = useRef<any>(null);
  const voiceTranscriptRef = useRef('');
  const voiceHasDispatchedRef = useRef(false);

  const startVoiceModeListening = () => {
    if (!voiceModeActiveRef.current) return;
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      toast.error("La reconnaissance vocale n'est pas supportée par ce navigateur.");
      setVoiceModeActive(false);
      return;
    }
    if (voiceSilenceTimerRef.current) {
      clearTimeout(voiceSilenceTimerRef.current);
      voiceSilenceTimerRef.current = null;
    }
    voiceTranscriptRef.current = '';
    voiceHasDispatchedRef.current = false;

    const recognition = new SpeechRecognitionCtor();
    voiceModeRecognitionRef.current = recognition;
    recognition.lang = 'fr-FR';
    // Mode continu et résultats intermédiaires : fluidité totale, l'utilisateur voit ce qu'il
    // dit en direct et Nova enchaîne après seulement 750ms de pause (au lieu de 2.5 à 3s imposées par l'OS).
    recognition.continuous = true;
    recognition.interimResults = true;

    const dispatchVoiceQuery = (text: string) => {
      const clean = text.trim();
      if (!clean || voiceHasDispatchedRef.current || !voiceModeActiveRef.current) return;
      voiceHasDispatchedRef.current = true;
      if (voiceSilenceTimerRef.current) {
        clearTimeout(voiceSilenceTimerRef.current);
        voiceSilenceTimerRef.current = null;
      }
      try { recognition.stop(); } catch {}
      setVoiceModeStatus('thinking');
      void handleSendMessage(clean);
    };

    recognition.onresult = (e: any) => {
      let currentText = '';
      let hasFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        const item = e.results[i];
        if (item[0]?.transcript) {
          currentText += item[0].transcript;
        }
        if (item.isFinal) hasFinal = true;
      }
      currentText = currentText.trim();
      if (!currentText) return;

      voiceTranscriptRef.current = currentText;
      // Retranscription en direct sous l'orbe : retour visuel instantané
      setVoiceModeLastText(currentText);

      if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current);

      // 600ms après segment final ou 800ms après pause naturelle : départ immédiat
      const silenceDelay = hasFinal ? 600 : 800;
      voiceSilenceTimerRef.current = setTimeout(() => {
        dispatchVoiceQuery(voiceTranscriptRef.current);
      }, silenceDelay);
    };

    recognition.onerror = (e: any) => {
      if (e?.error === 'no-speech' && voiceModeActiveRef.current) {
        return;
      }
      if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current);
      if (!voiceHasDispatchedRef.current) {
        setVoiceModeStatus('idle');
      }
    };

    recognition.onend = () => {
      if (voiceSilenceTimerRef.current) clearTimeout(voiceSilenceTimerRef.current);
      if (voiceTranscriptRef.current && !voiceHasDispatchedRef.current && voiceModeActiveRef.current) {
        dispatchVoiceQuery(voiceTranscriptRef.current);
      } else {
        setVoiceModeStatus((s) => (s === 'listening' ? 'idle' : s));
      }
    };

    setVoiceModeStatus('listening');
    try {
      recognition.start();
    } catch (e) {
      console.warn('Erreur démarrage recognition:', e);
    }
  };

  // Demande explicite (historique) : "peut-on lui couper la parole si
  // besoin ? ... non juste à la voix ... si on parle on lui coupe la
  // parole directe" — un second micro écoutait EN PARALLÈLE pendant que
  // Nova parlait, pour l'interrompre dès les premiers mots détectés.
  // Signalé ensuite : "quand je parle j'ai trop de coupures" — se
  // déclenchait trop facilement (souffle, écho, bruit ambiant...) et
  // coupait Nova en plein milieu d'une phrase sans que ce soit voulu.
  // DÉSACTIVÉ : Nova ne s'interrompt plus automatiquement à la voix — le
  // bouton (toujours actif pendant qu'elle parle, voir plus bas) reste
  // l'unique façon volontaire de la couper, un geste explicite qui ne se
  // déclenche jamais par erreur. Fonctions gardées en no-op (plutôt que
  // supprimées) pour pouvoir réactiver facilement si demandé un jour.
  const bargeInRecognitionRef = useRef<any>(null);
  const startBargeInListener = () => { /* désactivé, voir commentaire ci-dessus */ };
  const stopBargeInListener = () => {
    const rec = bargeInRecognitionRef.current;
    if (!rec) return;
    rec.onend = null;
    rec.onresult = null;
    try { rec.stop(); } catch { /* ignore */ }
    bargeInRecognitionRef.current = null;
  };
  useEffect(() => {
    if (voiceModeStatus === 'speaking') startBargeInListener();
    else stopBargeInListener();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceModeStatus]);

  const enterVoiceMode = () => {
    setVoiceModeActive(true);
    voiceModeActiveRef.current = true;
    startVoiceModeListening();
  };

  const exitVoiceMode = () => {
    voiceModeActiveRef.current = false;
    setVoiceModeActive(false);
    setVoiceModeStatus('idle');
    setVoiceModeLastText('');
    clearVoiceInfo();
    setIsVoicePaused(false);
    if (voiceSilenceTimerRef.current) {
      clearTimeout(voiceSilenceTimerRef.current);
      voiceSilenceTimerRef.current = null;
    }
    voiceModeRecognitionRef.current?.stop();
    stopBargeInListener();
    stopSpeaking();
  };

  // Ouvre directement en mode vocal si demandé (voir autoVoiceMode plus
  // haut) — un seul déclenchement, à l'ouverture.
  useEffect(() => {
    if (!autoVoiceMode) return;
    enterVoiceMode();
    onAutoVoiceModeConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVoiceMode]);

  // Bascule mode Commercial (vocal, direct) / mode Bureau (chat texte
  // classique) — mémorisée pour la prochaine ouverture de Nova sur mobile
  // (voir openNovaMobile, App.tsx).
  const switchToCommercialMode = () => {
    try { localStorage.setItem('novasphere:nova-mobile-mode', 'commercial'); } catch { /* ignore */ }
    enterVoiceMode();
  };
  const switchToBureauMode = () => {
    try { localStorage.setItem('novasphere:nova-mobile-mode', 'bureau'); } catch { /* ignore */ }
    exitVoiceMode();
  };

  const [promptInput, setPromptInput] = useState('');
  // Ticket #251 : sujet/corps édités par l'utilisateur avant envoi, par
  // action.id — jamais action.args directement (qui reste la proposition
  // initiale de Nova, non modifiée), pour permettre de corriger avant
  // d'envoyer sans jamais renvoyer la demande à Nova.
  const [emailDrafts, setEmailDrafts] = useState<Record<string, { subject: string; body: string }>>({});
  // Signature (HTML personnalisée avec photo, prioritaire, sinon signature
  // Gmail texte) — chargée une fois, réutilisée pour chaque aperçu d'e-mail.
  const [mailSignatureHtml, setMailSignatureHtml] = useState('');
  const [mailSignatureText, setMailSignatureText] = useState('');
  // Signalé : un message de plusieurs lignes restait coincé dans une case
  // à hauteur fixe (une seule ligne visible, le reste défilait caché) —
  // la case grandit maintenant avec le texte (jusqu'à une limite) pour que
  // toutes les lignes restent visibles pendant la saisie.
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Signalé : "la fenêtre de Nova monte quand tu fais une recherche" (mobile)
  // — laissant voir l'accueil en dessous, à travers une bande vide en bas.
  // Signalé à nouveau (23 septembre, Sylvain) : cette fois c'est la barre de
  // saisie elle-même qui finissait sous le clavier, invisible.
  //
  // Cause : sur iPhone, le clavier ne rétrécit PAS la page, il se pose
  // par-dessus. Ce panneau est en hauteur fixe (h-full, calée sur un
  // ancêtre en position fixed/100dvh — voir App.tsx) : clavier ouvert, cette
  // hauteur ne change pas, alors que la zone réellement visible (le viewport
  // VISUEL), si. La barre de saisie, dernière de la colonne, se retrouve
  // donc positionnée sous la zone visible, cachée par le clavier ; et à la
  // fermeture, le défilement de page que iOS déclenche pour garder le champ
  // visible ne revient pas toujours à zéro tout seul.
  //
  // Correctif (même principe que ChatViewSupabase.tsx, déjà éprouvé là-bas
  // sur plusieurs signalements) : caler la hauteur du panneau sur
  // `visualViewport.height` tant que le clavier est effectivement ouvert (au
  // moins un cinquième de l'écran gagné en le fermant — en dessous, ce n'est
  // qu'une variation de barre système iOS, pas un clavier). Dès qu'il se
  // ferme, on relâche la main et `h-full` reprend le dessus, qui suit
  // nativement la vraie fenêtre visible sans jamais rester figé dessus.
  const [hauteurVisible, setHauteurVisible] = useState<number | null>(null);
  const isIOSClavier = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isMobile || !isIOSClavier) {
      setHauteurVisible(null);
      return;
    }
    const appliquer = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      const ouvert = window.innerHeight - vv.height > window.innerHeight * 0.2;
      setHauteurVisible(ouvert ? Math.round(vv.height) : null);
    };
    // Rattrapage : fermer le clavier via son petit bouton dédié (plutôt
    // qu'en perdant le focus autrement) ne redéclenche pas toujours `resize`
    // sur `visualViewport` de façon fiable pendant l'animation — un
    // rattrapage différé, une fois l'animation forcément terminée, sécurise
    // la mesure finale (voir ChatViewSupabase.tsx, même correctif).
    let settle: number | null = null;
    const appliquerAvecRattrapage = () => {
      appliquer();
      if (settle) window.clearTimeout(settle);
      settle = window.setTimeout(appliquer, 350);
    };
    appliquer();
    vv.addEventListener('resize', appliquerAvecRattrapage);
    vv.addEventListener('scroll', appliquerAvecRattrapage);
    const onBlurCapture = (e: FocusEvent) => {
      if ((e.target as HTMLElement | null)?.tagName !== 'TEXTAREA') return;
      if (settle) window.clearTimeout(settle);
      settle = window.setTimeout(appliquer, 350);
    };
    document.addEventListener('focusout', onBlurCapture, true);
    return () => {
      vv.removeEventListener('resize', appliquerAvecRattrapage);
      vv.removeEventListener('scroll', appliquerAvecRattrapage);
      document.removeEventListener('focusout', onBlurCapture, true);
      if (settle) window.clearTimeout(settle);
    };
  }, [isMobile, isIOSClavier]);
  // Signalé : "je voudrais que la fenêtre du texte qu'on dicte puisse
  // grandir pour avoir le visuel complet" — 160px (quelques lignes)
  // obligeait à défiler dans une case minuscule dès une dictée vocale un
  // peu longue, sans jamais voir tout le texte en même temps. Relevé à
  // 45% de la hauteur de la fenêtre (jamais plus, pour ne pas pousser le
  // bouton "Envoyer" hors champ sur un petit écran) — voir aussi la classe
  // `max-h-[45vh]` sur le textarea, qui doit rester synchronisée avec cette
  // limite (une classe Tailwind `max-height` plus basse écraserait sinon
  // silencieusement ce calcul).
  const autoResizePrompt = () => {
    const el = promptTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cap = Math.round(window.innerHeight * 0.45);
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  };
  // Signalé (suite) : le texte reconnu pendant la dictée vocale est posé
  // directement via setPromptInput(combined) (toggleHeroVoiceInput), qui ne
  // déclenche aucun événement `onChange` du textarea — l'agrandissement
  // n'était donc JAMAIS appelé pendant la dictée, seulement en cas de
  // frappe manuelle ensuite. Cet effet réagit à `promptInput` lui-même,
  // quelle que soit sa source, pour ne plus dépendre d'un site d'appel
  // particulier.
  useEffect(() => { autoResizePrompt(); }, [promptInput]);

  // Ticket #251 : signature ajoutée automatiquement en bas de tout e-mail
  // préparé par Nova — même priorité que MailView.tsx (HTML personnalisé
  // avec photo > signature Gmail texte > rien).
  useEffect(() => {
    if (!currentUser) { setMailSignatureHtml(''); setMailSignatureText(''); return; }
    (async () => {
      try {
        const { data } = await supabase
          .from('user_ui_settings')
          .select('mail_signature_html, mail_signature_image_url')
          .eq('user_id', currentUser.uid)
          .maybeSingle();
        const html = (data?.mail_signature_html as string) || '';
        const imageUrl = (data?.mail_signature_image_url as string) || '';
        if (html || imageUrl) {
          const hasImageAlready = imageUrl && html.includes(imageUrl);
          const imageTag = imageUrl && !hasImageAlready ? `<br><img src="${imageUrl}" alt="Signature" style="max-height:120px;">` : '';
          setMailSignatureHtml(`${html}${imageTag}`);
        } else {
          setMailSignatureHtml('');
        }
      } catch { /* pas de signature personnalisée, tant pis */ }
      try {
        const token = await resolveWorkspaceAccessToken();
        if (token) setMailSignatureText(htmlSignatureToText(await fetchGmailSignature(token)));
      } catch { /* pas de signature Gmail accessible, tant pis */ }
    })();
  }, [currentUser?.uid]);
  // Ticket #44 : position réelle de l'utilisateur, pour que Nova puisse
  // répondre à des questions de proximité ("où est le McDo le plus proche
  // de moi ?", "à quelle distance est cette adresse ?") en combinant sa
  // position avec la recherche web. Demandée une seule fois par session
  // (silencieusement, sans bloquer la saisie si refusée/indisponible).
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { /* refusée ou indisponible — Nova s'en passera */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  }, []);
  // Nombre de réponses de Nova en attente. Un compteur plutôt qu'un simple
  // booléen : plusieurs messages peuvent être envoyés à la suite sans
  // attendre la réponse précédente (la saisie n'est plus bloquée pendant
  // que Nova réfléchit).
  const [pendingCount, setPendingCount] = useState(0);
  const loading = pendingCount > 0;
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  // Ticket #61 : fiche détail d'un bien Immosphera360 ouverte en interne
  // (photos, descriptif complet) avec un bouton retour, au lieu de partir
  // sur l'annonce externe au clic sur une vignette.
  const [selectedProperty, setSelectedProperty] = useState<PropertyResult | null>(null);
  const [propertyPhotoIndex, setPropertyPhotoIndex] = useState(0);

  // Ticket #250 : statut par message des actions sur une image générée
  // ("Utiliser dans le CRM" = upload Drive, "Copier" = presse-papiers) —
  // clé = id du message, jamais partagé entre deux images différentes.
  const [imageActionStatus, setImageActionStatus] = useState<Record<string, 'idle' | 'busy' | 'done' | 'error'>>({});
  const [imageActionError, setImageActionError] = useState<Record<string, string>>({});

  const [activeTab, setActiveTab] = useState<'chat' | 'wallpapers'>('chat');
  const [novaWallpaper, setNovaWallpaper] = useState<string>(
    () => localStorage.getItem(NOVA_WALLPAPER_STORAGE_KEY) || ''
  );
  // Intensité de l'image (0 = quasi invisible, 100 = pleinement visible).
  const [novaWallpaperOpacity, setNovaWallpaperOpacity] = useState<number>(() => {
    const stored = localStorage.getItem(NOVA_WALLPAPER_OPACITY_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? parsed : 65;
  });

  const selectNovaWallpaper = (url: string) => {
    setNovaWallpaper(url);
    if (url) localStorage.setItem(NOVA_WALLPAPER_STORAGE_KEY, url);
    else localStorage.removeItem(NOVA_WALLPAPER_STORAGE_KEY);
  };

  const changeNovaWallpaperOpacity = (value: number) => {
    setNovaWallpaperOpacity(value);
    localStorage.setItem(NOVA_WALLPAPER_OPACITY_STORAGE_KEY, String(value));
  };

  // Voile blanc superposé à l'image, dosé par le curseur d'opacité, pour
  // garder le texte lisible tout en laissant transparaître le fond choisi.
  const novaWallpaperVeil = 0.85 - (novaWallpaperOpacity / 100) * 0.7; // 0.85 → 0.15

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Signalé : "sur ordi, la fenêtre Nova remonte" pendant la conversation —
  // `scrollIntoView` fait défiler TOUS les ancêtres scrollables nécessaires
  // pour amener la cible en vue, pas seulement la zone de messages : ce
  // panneau est posé en `absolute inset-0` à l'intérieur du `<main>`
  // principal de l'app (toujours monté en dessous, lui-même `overflow-y-
  // auto`), et le navigateur pouvait aussi faire défiler CET ancêtre-là au
  // passage — déplaçant visuellement tout le panneau Nova vers le haut au
  // lieu de rester fixe pendant que seuls les messages défilent. Cible
  // directement le bon conteneur (celui-ci, référencé par
  // `messagesScrollRef`) et ne touche plus jamais aux ancêtres.
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // Signalé, puis reformulé plus fermement : "je ne veux plus que
  // l'interface de Nova se lève avec la souris, verrouille le panneau" — un
  // premier correctif conditionnel (ne défiler que si déjà en bas) ne
  // suffisait pas : dans le cas normal (on vient d'envoyer un message, donc
  // déjà en bas), il continuait à défiler tout seul dès que la réponse de
  // Nova arrivait, ce qui reste un mouvement "décidé par l'appli", pas par
  // la souris. Panneau maintenant verrouillé pour de bon : plus AUCUN
  // défilement automatique déclenché par un changement de `messages` ou de
  // `loading` (arrivée de la réponse, indicateur "Nova réfléchit..."...) —
  // seul un geste explicite de l'utilisateur peut faire défiler la vue :
  // sa propre molette/glisser, ou l'envoi d'un message (voir handleSendMessage,
  // qui appelle scrollToBottom() une seule fois, à cet instant précis,
  // jamais en réaction à un état qui changerait ensuite tout seul).

  useEffect(() => {
    if (!initialPrompt) return;
    void handleSendMessage(initialPrompt);
    onInitialPromptConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // Voir prefillPrompt dans AssistantIAViewProps : dépose le texte dans le
  // champ de saisie SANS l'envoyer (contrairement à initialPrompt
  // ci-dessus) — l'utilisateur complète et envoie lui-même.
  useEffect(() => {
    if (!prefillPrompt) return;
    setPromptInput(prefillPrompt);
    promptTextareaRef.current?.focus();
    onPrefillPromptConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillPrompt]);

  // Signalé (découvert en corrigeant #162) : cette lecture ciblait une
  // table `calendar_events` qui n'existe pas côté Supabase — échouait
  // silencieusement à CHAQUE chargement (erreur avalée par le catch), donc
  // Nova n'a jamais eu le moindre rendez-vous réel en contexte pour ses
  // bilans de journée. L'Agenda réel (AgendaView.tsx) n'a d'ailleurs aucune
  // table locale : Google Calendar EST la source de vérité — aligné ici sur
  // le même mécanisme (fetchGoogleCalendarEvents), pas de table fantôme.
  useEffect(() => {
    if (!currentUser) return;
    const loadEvents = async () => {
      try {
        const token = await resolveWorkspaceAccessToken();
        if (!token) return; // Google Workspace non connecté : pas d'agenda à charger, sans bloquer le reste.
        const gEvents = await fetchGoogleCalendarEvents(token);
        setCalendarEvents(gEvents as unknown as Record<string, unknown>[]);
      } catch (err) {
        console.warn('Erreur chargement agenda pour agent IA:', err);
      }
    };
    void loadEvents();
  }, [currentUser]);

  // Execute Function Calls returned by Gemini
  type ActionResult = { success: true; action: ActionExecuted } | { success: false; label: string; reason: string };

  const CLIENT_GUEST_TOOLS = new Set(['invite_client_guest', 'request_client_document', 'set_client_guest_access_status']);
  const CALENDAR_TOOLS = new Set(['create_appointment']);
  // Demande explicite : "Nova puisse créer des tickets Support" — même
  // mécanisme de confirmation manuelle que le RDV, jamais envoyé sans
  // validation explicite (voir SupportView.tsx pour le flux "manuel"
  // existant, répliqué ici côté Nova).
  const SUPPORT_TOOLS = new Set(['create_support_ticket']);
  // Ticket #251 : "envoie un mail à..." — jamais un envoi direct, la carte
  // dédiée gère elle-même la résolution du client/signature/aperçu.
  const EMAIL_TOOLS = new Set(['send_client_email']);

  // Ticket "Clients invités" (13/13) : exécute réellement l'action, mais
  // SEULEMENT après confirmation manuelle (voir renderPendingClientAction
  // plus bas) — jamais depuis executeFunctionCall.
  const runClientGuestAction = async (action: PendingClientAction): Promise<{ ok: true; label: string } | { ok: false; error: string }> => {
    if (!currentUser) return { ok: false, error: 'Non authentifié.' };
    try {
      if (action.toolName === 'invite_client_guest') {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/clients/guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'invite', leadId: action.contactId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: body?.error || `Erreur serveur (${res.status})` };
        if (body?.ok === false) return { ok: false, error: body.message || 'Action refusée.' };
        return { ok: true, label: body.emailSent ? 'Invitation envoyée par e-mail.' : "Compte créé, mais l'e-mail n'a pas pu être envoyé." };
      }

      if (action.toolName === 'request_client_document') {
        const { data: access } = await supabase.from('client_guest_access' as any).select('agency_id').eq('lead_id', action.contactId).maybeSingle();
        if (!access) return { ok: false, error: "Ce client n'est pas encore invité dans son Espace client." };
        const docType = typeof action.args.docType === 'string' ? action.args.docType : 'Autre';
        const { error } = await supabase.from('document_requests' as any).insert({
          lead_id: action.contactId,
          agency_id: (access as any).agency_id,
          requested_by: currentUser.uid,
          doc_type: docType,
          deadline: typeof action.args.deadline === 'string' && action.args.deadline ? action.args.deadline : null,
          message: typeof action.args.message === 'string' && action.args.message ? action.args.message : null,
        } as any);
        if (error) return { ok: false, error: error.message };
        return { ok: true, label: `Demande envoyée : ${docType}` };
      }

      if (action.toolName === 'set_client_guest_access_status') {
        const { data: access } = await supabase.from('client_guest_access' as any).select('id').eq('lead_id', action.contactId).maybeSingle();
        if (!access) return { ok: false, error: "Ce client n'est pas encore invité dans son Espace client." };
        const apiAction = action.args.action === 'reactivate' ? 'reactivate' : action.args.action === 'revoke' ? 'revoke' : 'suspend';
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/clients/guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: apiAction, accessId: (access as any).id }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok === false) return { ok: false, error: body?.error || 'Erreur.' };
        const labels: Record<string, string> = { suspend: 'Accès suspendu.', reactivate: 'Accès réactivé.', revoke: 'Accès révoqué.' };
        return { ok: true, label: labels[apiAction] };
      }

      // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16) : capacités
      // étendues réservées à "nova_super_assistant" — mêmes garde-fous
      // (confirmation manuelle explicite, jamais d'exécution directe).
      if (action.toolName === 'invite_collaborator') {
        const token = await currentUser.getIdToken();
        const email = typeof action.args.email === 'string' ? action.args.email : '';
        if (!email.trim()) return { ok: false, error: 'Adresse e-mail manquante.' };
        const tempPassword = 'P' + Math.random().toString(36).substring(2, 10) + '!9';
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            email,
            password: tempPassword,
            fullName: typeof action.args.fullName === 'string' ? action.args.fullName : '',
            role: typeof action.args.role === 'string' ? action.args.role : 'commercial',
            agencyIds: Array.isArray(action.args.agencyIds) ? action.args.agencyIds : [],
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: body?.error || `Erreur serveur (${res.status})` };
        return { ok: true, label: body.emailSent ? `Invitation envoyée à ${body.email || email}.` : `Compte créé pour ${body.email || email}, e-mail non envoyé.` };
      }

      if (action.toolName === 'set_collaborator_active_status') {
        const userId = typeof action.args.userId === 'string' ? action.args.userId : '';
        if (!userId) return { ok: false, error: 'Identifiant collaborateur manquant.' };
        const isActive = action.args.isActive !== false;
        const token = await currentUser.getIdToken();
        const res = await fetch(`/api/admin/users/${userId}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ isActive }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: body?.error || `Erreur serveur (${res.status})` };
        return { ok: true, label: isActive ? 'Collaborateur réactivé.' : 'Collaborateur désactivé.' };
      }

      if (action.toolName === 'create_pipeline_automation') {
        const agencyId = typeof action.args.agencyId === 'string' ? action.args.agencyId : activeAgency.id;
        const { error } = await supabase.from('pipeline_automations' as any).insert({
          agency_id: agencyId,
          stage_name: typeof action.args.stageName === 'string' ? action.args.stageName : '',
          email_subject: typeof action.args.emailSubject === 'string' ? action.args.emailSubject : '',
          email_body: typeof action.args.emailBody === 'string' ? action.args.emailBody : '',
          created_by: currentUser.uid,
        } as any);
        if (error) return { ok: false, error: error.message };
        return { ok: true, label: 'Automatisation créée.' };
      }

      if (action.toolName === 'create_announcement') {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/admin/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            message: typeof action.args.message === 'string' ? action.args.message : '',
            level: typeof action.args.level === 'string' ? action.args.level : 'info',
            agencyIds: Array.isArray(action.args.agencyIds) ? action.args.agencyIds : [],
            pollOptions: Array.isArray(action.args.pollOptions) ? action.args.pollOptions.filter((o: unknown) => typeof o === 'string') : [],
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: body?.error || `Erreur serveur (${res.status})` };
        return { ok: true, label: 'Annonce publiée.' };
      }

      if (action.toolName === 'create_support_ticket') {
        const title = typeof action.args.title === 'string' && action.args.title.trim() ? action.args.title.trim() : 'Ticket créé via Nova';
        const description = typeof action.args.description === 'string' ? action.args.description.trim() : '';
        const rawCategory = typeof action.args.category === 'string' ? action.args.category : 'autre';
        const category = (['bug', 'technique', 'fonctionnalite', 'autre'] as const).includes(rawCategory as any) ? rawCategory : 'autre';
        const rawPriority = typeof action.args.priority === 'string' ? action.args.priority : 'normale';
        const priority = (['basse', 'normale', 'urgente'] as const).includes(rawPriority as any) ? rawPriority : 'normale';
        const agencyId = activeAgency.id !== 'all' ? activeAgency.id : (AGENCIES[0]?.id || '');

        const { data: inserted, error: insErr } = await supabase
          .from('support_tickets')
          .insert({
            agency_id: agencyId,
            created_by: currentUser.uid,
            category,
            priority,
            status: 'ouvert',
            title,
            description,
            attachments: [],
          })
          .select()
          .single();
        if (insErr) return { ok: false, error: insErr.message };

        // Même notification que la création manuelle depuis SupportView —
        // tous les super admins reçoivent une notification "🎫 Nouveau
        // ticket support".
        try {
          const { data: admins } = await supabase.from('user_roles').select('user_id').eq('role', 'super_admin');
          await Promise.all(
            (admins || []).map((a: any) =>
              supabase.rpc('create_notification', {
                _user_id: a.user_id,
                _type: 'support_ticket_created',
                _title: '🎫 Nouveau ticket support',
                _message: `${userProfile?.displayName || currentUser.email} a créé un ticket via Nova : ${title}`,
                _entity_type: 'support_ticket',
                _entity_id: inserted.id,
                _agency_id: agencyId,
                _metadata: {},
              })
            )
          );
        } catch (notifErr) {
          console.warn('Notification super admin impossible :', notifErr);
        }

        return { ok: true, label: `Ticket support créé : "${title}" (priorité ${priority}).` };
      }

      // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (14/16) : RDV créé
      // UNIQUEMENT sur Google Calendar (aucune table locale n'existe — voir
      // le commentaire sur l'ancien chargement de `calendar_events` plus
      // haut) — si le compte n'est pas connecté, on le dit clairement
      // plutôt que de prétendre avoir créé un rendez-vous qui disparaîtrait
      // au premier rechargement.
      {
        const title = typeof action.args.title === 'string' ? action.args.title : 'Rendez-vous';
        const date = typeof action.args.date === 'string' ? action.args.date : format(new Date(), 'yyyy-MM-dd');
        const time = typeof action.args.time === 'string' ? action.args.time : '09:00';
        const durationMinutes = typeof action.args.durationMinutes === 'number' && action.args.durationMinutes > 0 ? action.args.durationMinutes : 30;
        const location = typeof action.args.location === 'string' ? action.args.location : '';
        const apptType = typeof action.args.type === 'string' ? action.args.type : 'Rendez-vous Banque';
        const attendees = typeof action.args.attendees === 'string' ? action.args.attendees : '';
        const contact = action.contactId ? allContacts.find((c) => c.id === action.contactId) : undefined;
        const clientName = contact?.name || (typeof action.args.clientName === 'string' ? action.args.clientName : '');

        const token = await resolveWorkspaceAccessToken();
        if (!token) {
          return { ok: false, error: 'Google Workspace non connecté — reconnectez-vous depuis le bandeau en haut du CRM pour créer un rendez-vous synchronisé.' };
        }

        const startISO = new Date(`${date}T${time}:00`).toISOString();
        const endISO = new Date(new Date(`${date}T${time}:00`).getTime() + durationMinutes * 60 * 1000).toISOString();

        const created = await createGoogleCalendarEvent(token, {
          summary: title,
          description: clientName ? `Client : ${clientName}` : undefined,
          location: location || undefined,
          startISO,
          endISO,
          attendees: attendees || undefined,
        });
        setCalendarEvents((prev) => [...prev, created as unknown as Record<string, unknown>]);

        let confirmationNote = '';
        if (action.args.sendClientConfirmation === true && contact?.email) {
          try {
            await sendGmailMessage(token, {
              to: contact.email,
              subject: `Confirmation de rendez-vous — ${title}`,
              body: `Bonjour ${clientName},\n\nVotre rendez-vous "${title}" est confirmé le ${date} à ${time}${location ? ` (${location})` : ''}.\n\nÀ bientôt.`,
            });
            confirmationNote = ' Confirmation envoyée au client par e-mail.';
          } catch (mailErr: any) {
            confirmationNote = ` (confirmation client non envoyée : ${mailErr?.message || 'erreur'})`;
          }
        }

        return { ok: true, label: `Rendez-vous "${title}" créé le ${date} à ${time}, synchronisé sur Google Agenda.${confirmationNote}` };
      }

      // Ticket #251 : "envoie un mail à..." — le sujet/corps réellement
      // envoyés viennent de emailDrafts (édités par l'utilisateur dans la
      // carte), jamais directement de action.args (la proposition initiale
      // de Nova, non retouchée).
      if (action.toolName === 'send_client_email') {
        const contact = action.contactId ? allContacts.find((c) => c.id === action.contactId) : undefined;
        const recipientEmail = contact?.email || '';
        const recipientName = contact?.name || '';
        const recipientId = contact?.id || '';
        if (!recipientId || !recipientEmail) return { ok: false, error: "Ce contact n'a pas d'adresse e-mail enregistrée." };
        const draft = emailDrafts[action.id];
        const subject = (draft?.subject ?? (typeof action.args.subject === 'string' ? action.args.subject : '')).trim();
        const body = (draft?.body ?? (typeof action.args.body === 'string' ? action.args.body : '')).trim();
        if (!subject || !body) return { ok: false, error: 'Objet ou message vide.' };

        const resolvedToken = await resolveWorkspaceAccessToken();
        if (!resolvedToken) return { ok: false, error: 'Google Workspace non connecté — reconnectez-vous depuis le bandeau en haut du CRM.' };
        const accessToken = resolvedToken!;

        const usingHtmlSignature = Boolean(mailSignatureHtml.trim());
        const fullBody = usingHtmlSignature ? body : `${body}${mailSignatureText ? `\n\n${mailSignatureText}` : ''}`;

        await sendGmailMessage(accessToken, {
          to: recipientEmail,
          subject,
          body: fullBody,
          bodyHtml: usingHtmlSignature ? buildEmailHtmlBody(body, mailSignatureHtml) : undefined,
        });

        // Trace dans l'historique de la fiche client — réutilise le
        // mécanisme déjà existant des notes (table `comments`, liée par
        // lead_id), plutôt qu'un nouveau système dédié aux e-mails.
        try {
          await supabase.from('comments').insert({
            lead_id: recipientId,
            body: `**E-mail envoyé** — Objet : ${subject}\n\n${body}`,
            user_id: currentUser?.uid,
          });
        } catch { /* la trace est secondaire, l'envoi a déjà réussi */ }

        return { ok: true, label: `E-mail envoyé à ${recipientName} (${recipientEmail}).` };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Erreur inattendue.' };
    }
  };

  const updatePendingAction = (messageId: string, actionId: string, patch: Partial<PendingClientAction>) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, pendingClientActions: m.pendingClientActions?.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) }
          : m
      )
    );
  };

  const NOVA_ADMIN_TOOLS = new Set(['invite_collaborator', 'set_collaborator_active_status', 'create_pipeline_automation', 'create_announcement']);
  // Simples lectures — jamais journalisées dans l'historique des actions
  // (voir plus bas, boucle d'exécution des function calls).
  const NOVA_READONLY_TOOLS = new Set(['get_daily_summary', 'get_upcoming_brief', 'get_overdue_tasks', 'get_pipeline_stats', 'search_drive_documents', 'search_kdrive_documents', 'search_properties', 'web_search']);

  const confirmPendingAction = async (messageId: string, action: PendingClientAction) => {
    updatePendingAction(messageId, action.id, { status: 'busy' });
    const result = await runClientGuestAction(action);
    if (result.ok) updatePendingAction(messageId, action.id, { status: 'done', resultLabel: result.label });
    else updatePendingAction(messageId, action.id, { status: 'error', errorMessage: result.error });

    // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16) : "journal des
    // actions (qui, quoi, quand, résultat)" — écrit APRÈS l'exécution réelle
    // (jamais avant), pour refléter le résultat effectif.
    //
    // Demande explicite (28/08/2026) : "historique des actions de Nova" —
    // ce journal existait déjà mais restait cantonné aux 4 outils "admin"
    // (NOVA_ADMIN_TOOLS) — rien pour l'envoi d'email, l'invitation d'un
    // client, etc. Élargi à TOUTES les actions confirmées manuellement
    // (celles qui passent par ce flux "à confirmer", donc déjà les plus
    // impactantes), pour que le panneau d'historique (voir NovaActionHistory
    // plus bas) reflète vraiment "ce que Nova a fait pour vous".
    if (currentUser) {
      await supabase.from('nova_action_log' as any).insert({
        agent_user_id: currentUser.uid,
        tool_name: action.toolName,
        args: action.args,
        ok: result.ok,
        result_message: result.ok ? result.label : result.error,
      } as any).then(() => {}, (err) => console.warn('Erreur journal Nova :', err));
    }
  };

  const ACTION_LABELS: Record<string, string> = {
    create_contact: 'Création du contact',
    create_task: 'Création de la tâche',
    update_task: "Modification d'une tâche",
    create_note: 'Création de la note',
    create_appointment: 'Création du rendez-vous',
    create_support_ticket: 'Création du ticket support',
    search_drive_documents: 'Recherche Google Drive',
    get_daily_summary: 'Bilan de la journée',
    get_upcoming_brief: 'Résumé des prochains jours',
    get_overdue_tasks: 'Tâches en retard',
    get_pipeline_stats: 'Statistiques du pipeline',
    move_lead_stage: "Changement d'étape d'un dossier",
    send_client_email: "Envoi d'un e-mail",
    invite_client_guest: "Invitation d'un client",
    request_client_document: 'Demande de document client',
    set_client_guest_access_status: "Accès client invité modifié",
    invite_collaborator: "Invitation d'un collaborateur",
    set_collaborator_active_status: "Statut d'un collaborateur modifié",
    create_pipeline_automation: "Création d'une automatisation",
    create_announcement: "Création d'une annonce",
    generate_image: "Génération d'un visuel",
    search_kdrive_documents: 'Recherche kDrive',
    search_properties: 'Recherche de biens',
    web_search: 'Recherche web',
  };

  // Signalé : "il ne faut pas qu'ils mettent... je voudrais avoir le nom du
  // client et la fonction de ce qu'il est prévu de faire avec lui" — le
  // bilan de journée/résumé des prochains jours n'affichait que le TITRE
  // brut de la tâche (`t.title`, ex. "Att documents client"), sans jamais
  // dire DE QUEL CLIENT il s'agissait — plusieurs tâches au titre identique
  // mais pour des clients différents étaient donc indiscernables. Le nom du
  // client (résolu via `t.contactId`, déjà disponible) est maintenant
  // affiché à côté du titre de la tâche.
  const taskSummaryLine = (t: Task): string => {
    const contact = t.contactId ? allContacts.find((c) => c.id === t.contactId) : undefined;
    return contact ? `**${contact.name}** — ${t.title}` : t.title;
  };

  const executeFunctionCall = async (fc: { name: string; args: Record<string, unknown> }): Promise<ActionResult> => {
    const label = ACTION_LABELS[fc.name] || `Action « ${fc.name} »`;
    try {
      const { name, args } = fc;

      if (name === 'create_contact') {
        const contactName = typeof args.name === 'string' ? args.name : 'Nouveau Contact';
        const email = typeof args.email === 'string' ? args.email : '';
        const phone = typeof args.phone === 'string' ? args.phone : '';
        // Signalé (24 octobre, même fiche que la note ci-dessous) : la
        // fiche affichait "other" au lieu d'un vrai libellé. L'outil parle
        // en anglais (buyer/seller/investor/other) mais le reste du CRM
        // (formulaire "+ Nouveau lead", filtres de la liste Clients...)
        // n'utilise que des libellés français (Acquéreur/Vendeur/
        // Investisseur) — rien ne les traduisait, "other" partait tel quel
        // dans `lead_type`. Pas d'équivalent français pour "other" dans le
        // CRM (pas de case "Autre" dans le formulaire) : on laisse alors le
        // type vide plutôt que d'inventer un libellé qui n'existe nulle
        // part ailleurs dans l'app.
        const CLIENT_TYPE_LABELS: Record<string, string> = { buyer: 'Acquéreur', seller: 'Vendeur', investor: 'Investisseur' };
        const rawClientType = typeof args.clientType === 'string' ? args.clientType : '';
        const clientType = CLIENT_TYPE_LABELS[rawClientType] || '';
        // La colonne `temperature` en base est un enum Postgres strict
        // (chaud/tiede/froid) — "Prospect", "Nouveau" etc. le font échouer
        // silencieusement (insert rejeté), d'où les contacts qui
        // n'apparaissaient jamais malgré une réponse "OK" de Nova.
        const rawStatus = typeof args.status === 'string' ? args.status.toLowerCase() : '';
        const status = (['chaud', 'tiede', 'froid'] as const).includes(rawStatus as any)
          ? (rawStatus as 'chaud' | 'tiede' | 'froid')
          : 'tiede';
        const notes = typeof args.notes === 'string' ? args.notes : '';
        const agencyId = typeof args.agencyId === 'string' ? args.agencyId : activeAgency.id;

        const createdContact = await addContact.mutateAsync({
          name: contactName,
          email,
          phone,
          clientType: clientType || undefined,
          // L'outil de Nova parle en minuscules (chaud/tiede/froid) mais la
          // fiche contact attend les libellés du CRM : sans conversion, le
          // contact créé par Nova portait un statut qui ne correspondait à
          // aucun filtre de l'écran Clients.
          status: ({ chaud: 'Chaud', tiede: 'Tiède', froid: 'Froid' } as const)[status],
          // Signalé (24 octobre) : « la note n'a pas été prise en compte » —
          // ce champ allait dans la colonne `notes`, jamais lue par la fiche
          // client (elle n'affiche que `comments`, voir useContacts.ts) ni
          // par le formulaire manuel "+ Nouveau lead" (son champ
          // "Commentaires" écrit, lui, directement dans `comments`). Nova
          // écrit maintenant au même endroit que ce formulaire.
          comments: notes,
          agencyId
        });
        return {
          success: true,
          action: {
            type: 'contact',
            title: `Contact créé : ${contactName}`,
            details: `Tél: ${phone || 'N/C'} • Email: ${email || 'N/C'} • Statut: ${status}`,
            contactId: createdContact?.id,
          }
        };
      }

      if (name === 'create_task') {
        const title = typeof args.title === 'string' ? args.title : 'Nouvelle tâche';
        const dueDate = typeof args.dueDate === 'string' ? args.dueDate : format(new Date(), 'yyyy-MM-dd');
        const priority = typeof args.priority === 'string' ? args.priority : 'Moyenne';
        const taskType = typeof args.type === 'string' ? args.type : 'Tâche';
        const contactId = typeof args.contactId === 'string' ? args.contactId : undefined;

        await addTask.mutateAsync({
          title,
          dueDate,
          completed: false,
          priority: priority as 'Basse' | 'Moyenne' | 'Haute' | 'Urgent',
          type: taskType as 'Appel' | 'Rendez-vous' | 'Relance' | 'Document' | 'Tâche',
          contactId
        });
        return {
          success: true,
          action: {
            type: 'task',
            title: `Tâche ajoutée : ${title}`,
            details: `Échéance: ${dueDate} • Priorité: ${priority}`,
            contactId,
          }
        };
      }

      // Demande explicite : Nova sait créer une tâche mais pas en modifier
      // une existante (reporter, marquer faite...). Même résolution par NOM
      // que move_lead_stage plus bas (Nova ne connaît jamais un identifiant
      // de tâche) — recherche parmi `tasks`, déjà chargées côté client.
      if (name === 'update_task') {
        const taskNameQuery = typeof args.taskName === 'string' ? args.taskName.trim() : '';
        if (!taskNameQuery) {
          return { success: false, label, reason: 'Nom de la tâche manquant.' };
        }
        const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const needle = normalize(taskNameQuery);
        const matches = tasks.filter((t) => normalize(t.title).includes(needle));
        if (matches.length === 0) {
          return { success: false, label, reason: `Aucune tâche trouvée pour "${taskNameQuery}".` };
        }
        if (matches.length > 1) {
          return {
            success: false,
            label,
            reason: `Plusieurs tâches correspondent à "${taskNameQuery}" (${matches.map((t) => t.title).join(', ')}) — précisez laquelle.`,
          };
        }
        const targetTask = matches[0];

        const updates: Partial<Task> = {};
        if (typeof args.newDueDate === 'string' && args.newDueDate) updates.dueDate = args.newDueDate;
        if (typeof args.completed === 'boolean') updates.completed = args.completed;
        if (typeof args.priority === 'string') updates.priority = args.priority as Task['priority'];
        if (typeof args.type === 'string') updates.type = args.type as Task['type'];
        if (typeof args.newTitle === 'string' && args.newTitle) updates.title = args.newTitle;
        if (Object.keys(updates).length === 0) {
          return { success: false, label, reason: "Aucune modification précisée pour cette tâche." };
        }

        await updateTask.mutateAsync({ id: targetTask.id, updates });
        const detailsParts = [
          updates.title ? `Titre : ${updates.title}` : null,
          updates.dueDate ? `Échéance : ${updates.dueDate}` : null,
          updates.completed !== undefined ? (updates.completed ? 'Marquée faite' : 'Remise à faire') : null,
          updates.priority ? `Priorité : ${updates.priority}` : null,
          updates.type ? `Type : ${updates.type}` : null,
        ].filter(Boolean);
        return {
          success: true,
          action: {
            type: 'task',
            title: `Tâche modifiée : ${updates.title || targetTask.title}`,
            details: detailsParts.join(' • '),
            contactId: targetTask.contactId,
          },
        };
      }

      if (name === 'create_note') {
        const title = typeof args.title === 'string' ? args.title : 'Note de suivi';
        const content = typeof args.content === 'string' ? args.content : '';
        const contactName = typeof args.contactName === 'string' ? args.contactName : '';
        const rawContactId = typeof args.contactId === 'string' ? args.contactId : '';
        // Ne fait confiance à l'id renvoyé par Nova que s'il correspond
        // réellement à un contact connu du CRM (jamais un id halluciné).
        const matchedContact = rawContactId ? allContacts.find((c) => c.id === rawContactId) : undefined;

        // Écriture partagée avec NovaSearchBar.tsx (Immosphera 360) — voir
        // src/lib/novaQuickActions.ts, pour que les deux se comportent
        // identiquement.
        const resultat = await creerNote({
          userId: currentUser?.uid,
          agencyId: activeAgency.id,
          title,
          content,
          matchedContactId: matchedContact?.id,
          matchedContactName: matchedContact?.name,
          contactName,
        });
        if (!resultat.success) throw new Error(resultat.error || 'Écriture refusée.');

        return {
          success: true,
          action: {
            type: 'note',
            title: resultat.title,
            details: resultat.details,
            contactId: resultat.contactId,
          }
        };
      }

      // create_appointment est désormais soumis à confirmation manuelle
      // (voir CALENDAR_TOOLS / runClientGuestAction) — jamais exécuté
      // immédiatement ici, cf. ticket "Paramètres/Nova/Utilisateurs/
      // Annonces" (14/16), "résumé avant validation".

      // Signalé : "Type d'action non reconnu" pour get_daily_summary /
      // get_upcoming_brief — ces deux outils étaient déclarés côté serveur
      // (agent.ts) mais JAMAIS gérés ici, donc systématiquement en échec
      // depuis toujours. Calcul local (tâches/agenda déjà chargés), aucun
      // aller-retour serveur nécessaire.
      if (name === 'get_daily_summary') {
        // Signalé : "je veux que Nova puisse aussi me donner que les
        // tâches de la journée... comme les rendez-vous aussi" — avant, ce
        // bilan mélangeait toujours les deux, même pour une question
        // ciblée ("quelles sont mes tâches aujourd'hui ?"). `scope`
        // (renseigné par Claude selon la question réelle, voir agent.ts)
        // permet de ne renvoyer que la partie demandée.
        const scope = (typeof args.scope === 'string' ? args.scope : 'both') as 'both' | 'tasks' | 'appointments';
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        // Signalé : "je veux que Nova réponde à la demande de donner la
        // journée de lundi en entier... ou que les tâches" — `date`
        // (calculée par Claude à partir de la date actuelle, voir
        // agent.ts) permet de cibler n'importe quel jour, pas seulement
        // aujourd'hui. Repli sur aujourd'hui si absente/invalide.
        const requestedDate = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : todayStr;
        const isToday = requestedDate === todayStr;
        const dayLabel = isToday ? "aujourd'hui" : format(new Date(requestedDate), 'EEEE d MMMM', { locale: fr });

        const dayTasks = tasks.filter((t) => !t.completed && t.dueDate === requestedDate);
        const gEvents = (calendarEvents as unknown as { summary: string; start: { dateTime?: string; date?: string } }[]) || [];
        const dayEvents = gEvents.filter((e) => {
          const d = e.start?.dateTime || e.start?.date;
          return d && d.slice(0, 10) === requestedDate;
        });
        // Signalé : bloc dense sur une seule ligne, dates ISO brutes
        // ("2026-08-27T00:00:00+00:00") — illisible. Une ligne par élément,
        // heure en clair, quelques émojis sobres (jamais plus d'un par ligne).
        const lines: string[] = [];
        if (scope !== 'appointments') {
          lines.push(dayTasks.length > 0 ? `📋 ${dayTasks.length} tâche${dayTasks.length > 1 ? 's' : ''} ${dayLabel} :` : `📋 Aucune tâche ${dayLabel}.`);
          dayTasks.slice(0, 8).forEach((t) => lines.push(`• ${taskSummaryLine(t)}`));
        }
        if (scope === 'both') lines.push('');
        if (scope !== 'tasks') {
          lines.push(dayEvents.length > 0 ? `📅 ${dayEvents.length} rendez-vous ${dayLabel} :` : `📅 Aucun rendez-vous ${dayLabel}.`);
          dayEvents.slice(0, 8).forEach((e) => {
            const d = e.start?.dateTime;
            const time = d ? format(new Date(d), 'HH:mm') : 'Toute la journée';
            lines.push(`• ${time} — ${e.summary}`);
          });
        }
        const title = scope === 'tasks' ? `Tâches ${isToday ? "d'aujourd'hui" : `du ${dayLabel}`}` : scope === 'appointments' ? `Rendez-vous ${isToday ? "d'aujourd'hui" : `du ${dayLabel}`}` : isToday ? 'Bilan de la journée' : `Bilan du ${dayLabel}`;
        return { success: true, action: { type: 'summary', title, details: lines.join('\n').trim() } };
      }

      if (name === 'get_upcoming_brief') {
        const scope = (typeof args.scope === 'string' ? args.scope : 'both') as 'both' | 'tasks' | 'appointments';
        const now = new Date();
        const in7Days = new Date(now.getTime() + 7 * 86400_000);
        const upcomingTasks = tasks.filter((t) => !t.completed && t.dueDate && new Date(t.dueDate) >= now && new Date(t.dueDate) <= in7Days);
        const gEvents = (calendarEvents as unknown as { summary: string; start: { dateTime?: string; date?: string } }[]) || [];
        const upcomingEvents = gEvents.filter((e) => {
          const d = e.start?.dateTime || e.start?.date;
          if (!d) return false;
          const dt = new Date(d);
          return dt >= now && dt <= in7Days;
        });
        const lines: string[] = [];
        if (scope !== 'appointments') {
          lines.push(upcomingTasks.length > 0 ? `📋 ${upcomingTasks.length} tâche${upcomingTasks.length > 1 ? 's' : ''} à venir :` : '📋 Aucune tâche dans les 7 prochains jours.');
          upcomingTasks.slice(0, 8).forEach((t) => lines.push(`• ${taskSummaryLine(t)} — ${format(new Date(t.dueDate), 'EEEE d MMMM', { locale: fr })}`));
        }
        if (scope === 'both') lines.push('');
        if (scope !== 'tasks') {
          lines.push(upcomingEvents.length > 0 ? `📅 ${upcomingEvents.length} rendez-vous à venir :` : '📅 Aucun rendez-vous dans les 7 prochains jours.');
          upcomingEvents.slice(0, 8).forEach((e) => {
            const d = e.start?.dateTime;
            const when = d ? format(new Date(d), "EEEE d MMMM 'à' HH:mm", { locale: fr }) : 'Date à confirmer';
            lines.push(`• ${e.summary} — ${when}`);
          });
        }
        const title = scope === 'tasks' ? 'Tâches à venir' : scope === 'appointments' ? 'Rendez-vous à venir' : 'Résumé des prochains jours';
        return { success: true, action: { type: 'summary', title, details: lines.join('\n').trim() } };
      }

      // Signalé (30/08/2026) : "il me dit qu'il n'a pas accès aux tâches...
      // quand je demande quelles sont les tâches en cours" — vrai trou :
      // get_daily_summary (un seul jour) et get_upcoming_brief (7 prochains
      // jours) ne couvrent jamais les tâches déjà en retard, quelle que
      // soit leur ancienneté. Même logique de calcul que les deux
      // précédents (tasks déjà chargées côté client, aucun aller-retour
      // serveur), triées de la plus ancienne à la plus récente échéance
      // (les plus urgentes/anciennes en premier).
      if (name === 'get_overdue_tasks') {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const overdueTasks = tasks
          .filter((t) => !t.completed && t.dueDate && t.dueDate < todayStr)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        const lines: string[] = [];
        lines.push(
          overdueTasks.length > 0
            ? `⚠️ ${overdueTasks.length} tâche${overdueTasks.length > 1 ? 's' : ''} en retard :`
            : '✅ Aucune tâche en retard.'
        );
        overdueTasks.slice(0, 15).forEach((t) => lines.push(`• ${taskSummaryLine(t)} — échéance du ${format(new Date(t.dueDate), 'EEEE d MMMM', { locale: fr })}`));
        return { success: true, action: { type: 'summary', title: 'Tâches en retard', details: lines.join('\n').trim() } };
      }

      if (name === 'move_lead_stage') {
        const leadNameQuery = typeof args.leadName === 'string' ? args.leadName.trim() : '';
        const stageNameQuery = typeof args.stageName === 'string' ? args.stageName.trim() : '';
        if (!leadNameQuery || !stageNameQuery) {
          return { success: false, label, reason: "Nom du dossier ou de l'étape manquant." };
        }
        const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const needle = normalize(leadNameQuery);
        const matches = deals.filter((d) => normalize(d.title).includes(needle));
        if (matches.length === 0) {
          return { success: false, label, reason: `Aucun dossier trouvé pour "${leadNameQuery}".` };
        }
        if (matches.length > 1) {
          return {
            success: false,
            label,
            reason: `Plusieurs dossiers correspondent à "${leadNameQuery}" (${matches.map((d) => d.title).join(', ')}) — précisez lequel.`,
          };
        }
        const targetDeal = matches[0];

        const { data: stagesForPipeline } = await supabase
          .from('pipeline_stages')
          .select('id, name')
          .eq('pipeline_id', targetDeal.pipelineId as string);
        const stageNeedle = normalize(stageNameQuery);
        const targetStage = (stagesForPipeline || []).find((s: any) => normalize(s.name).includes(stageNeedle));
        if (!targetStage) {
          const available = (stagesForPipeline || []).map((s: any) => s.name).join(', ');
          return { success: false, label, reason: `Étape "${stageNameQuery}" introuvable dans le pipeline de ce dossier. Étapes disponibles : ${available || 'aucune'}.` };
        }

        const { error: rpcError } = await supabase.rpc('change_lead_stage' as any, {
          p_lead_id: targetDeal.id,
          p_stage_id: (targetStage as any).id,
        } as any);
        if (rpcError) {
          return { success: false, label, reason: rpcError.message };
        }
        return {
          success: true,
          action: {
            type: 'summary',
            title: `Dossier déplacé : ${targetDeal.title}`,
            details: `Nouvelle étape : ${(targetStage as any).name}`,
          },
        };
      }

      if (name === 'get_pipeline_stats') {
        const agentFilter = typeof args.agentName === 'string' ? args.agentName.trim().toLowerCase() : '';

        const { data: stages } = await supabase
          .from('pipeline_stages')
          .select('id, name')
          .eq('pipeline_id', IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID);
        const offreStageId = (stages || []).find((s: any) => s.name === "Offre d'achat")?.id;
        const compromisStageId = (stages || []).find((s: any) => s.name === 'Signature compromis')?.id;
        const signatureStageId = (stages || []).find((s: any) => s.name === 'signature acte authentique')?.id;

        const { data: leadsData } = await supabase
          .from('leads')
          .select('*')
          .eq('pipeline_id', IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID)
          .eq('agency_id', IMMOSPHERA_AGENCY_ID);
        const relevant = ((leadsData || []) as any[]).filter((l) => !l.deleted_at).filter(
          (l: any) =>
            !l.archived_at &&
            (l.assigned_to || l.created_by) &&
            (l.stage_id === offreStageId || l.stage_id === compromisStageId || l.stage_id === signatureStageId)
        );

        const agentIds = Array.from(new Set(relevant.map((l: any) => l.assigned_to || l.created_by)));
        const { data: profilesData } = agentIds.length
          ? await supabase.from('profiles').select('id, full_name').in('id', agentIds)
          : { data: [] as any[] };
        const nameById: Record<string, string> = {};
        (profilesData || []).forEach((p: any) => { nameById[p.id] = p.full_name || 'Agent'; });

        const byAgent: Record<string, { name: string; offre: number; compromis: number; signature: number }> = {};
        relevant.forEach((l: any) => {
          const id = (l.assigned_to || l.created_by) as string;
          if (!byAgent[id]) byAgent[id] = { name: nameById[id] || 'Agent', offre: 0, compromis: 0, signature: 0 };
          if (l.stage_id === offreStageId) byAgent[id].offre += 1;
          if (l.stage_id === compromisStageId) byAgent[id].compromis += 1;
          if (l.stage_id === signatureStageId) byAgent[id].signature += 1;
        });

        let rows = Object.values(byAgent);
        if (agentFilter) rows = rows.filter((r) => r.name.toLowerCase().includes(agentFilter));
        rows.sort((a, b) => (b.offre + b.compromis + b.signature) - (a.offre + a.compromis + a.signature));

        const lines: string[] = [];
        if (rows.length === 0) {
          lines.push(agentFilter ? `Aucun dossier trouvé pour "${args.agentName}".` : 'Aucun dossier en cours sur ce pipeline pour le moment.');
        } else {
          rows.forEach((r) => {
            const total = r.offre + r.compromis + r.signature;
            lines.push(`👤 **${r.name}** — ${total} dossier${total > 1 ? 's' : ''} (Offre : ${r.offre}, Compromis : ${r.compromis}, Signature : ${r.signature})`);
          });
        }
        return {
          success: true,
          action: { type: 'summary', title: 'Statistiques du pipeline Transactions V2', details: lines.join('\n').trim() },
        };
      }

      if (name === 'search_drive_documents') {
        const token = await resolveWorkspaceAccessToken();
        if (!token) {
          return { success: false, label, reason: 'Google Workspace non connecté — reconnectez-vous depuis le bandeau en haut du CRM.' };
        }
        // Signalé : "il ne trouve absolument rien" sans la moindre erreur —
        // cause réelle trouvée : un jeton mis en cache AVANT l'ajout du
        // scope drive.readonly (ticket #163) ne contient toujours QUE
        // drive.file, qui ne renvoie JAMAIS d'erreur mais UNIQUEMENT les
        // fichiers créés/ouverts par cette appli — soit zéro résultat en
        // pratique, indiscernable d'une recherche vide sans vérifier le
        // scope réellement accordé. Vérification explicite ici (endpoint
        // tokeninfo Google) pour donner le bon diagnostic au lieu d'un faux
        // "aucun document trouvé".
        try {
          const scopeRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`);
          const scopeBody = await scopeRes.json().catch(() => ({}));
          const grantedScopes = String(scopeBody?.scope || '');
          if (!grantedScopes.includes('drive.readonly')) {
            return {
              success: false,
              label,
              reason: "Reconnectez Google Workspace (bandeau en haut du CRM, bouton \"Reconnecter\") pour autoriser la recherche dans Drive — ce compte n'a pas encore ce nouveau droit. Une fois reconnecté, réessayez votre recherche.",
            };
          }
        } catch {
          // Vérification indisponible (réseau...) : on tente quand même la
          // recherche plutôt que de bloquer sur un simple souci réseau.
        }
        const query = typeof args.query === 'string' ? args.query : '';
        const mimeType = typeof args.mimeType === 'string' ? args.mimeType : undefined;
        const recent = args.recent === true;
        let files: GoogleDriveFileResult[];
        try {
          files = await searchGoogleDriveFiles(token, { query, mimeType, recent });
        } catch (driveErr: any) {
          // Le scope drive.readonly est nouveau (ticket #163) — un compte
          // connecté AVANT son ajout n'a pas ce droit tant qu'il ne s'est
          // pas reconnecté, ce qui renvoie une erreur 403 explicite ici.
          const msg = String(driveErr?.message || '');
          if (msg.toLowerCase().includes('insufficient') || msg.toLowerCase().includes('permission')) {
            return { success: false, label, reason: "Reconnectez Google Workspace (bandeau en haut) pour autoriser la recherche dans Drive — nouveau droit ajouté." };
          }
          throw driveErr;
        }
        return {
          success: true,
          action: {
            type: 'drive_search',
            title: files.length > 0 ? `${files.length} document(s) trouvé(s)` : 'Aucun document trouvé',
            details: query ? `Recherche : "${query}"` : (recent ? 'Documents récents' : 'Recherche Drive'),
            driveFiles: files,
          },
        };
      }

      return { success: false, label, reason: `Type d'action non reconnu : ${fc.name}` };
    } catch (err: unknown) {
      console.error(`Erreur lors de l'exécution de la fonction ${fc.name}:`, err);
      return { success: false, label, reason: (err as Error)?.message || 'Erreur inconnue.' };
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || promptInput;
    if (!textToSend.trim()) return;

    // Signalé : le micro de dictée restait actif si on envoyait le message
    // pendant qu'on parlait encore, sans l'avoir explicitement coupé.
    if (heroListening) { heroRecognitionRef.current?.stop(); setHeroListening(false); }
    if (dicteeAgent) {
      dicteeAgentEnvoyeeRef.current = true;
      terminerDicteeAgent(false);
    }

    setErrorStatus(null);
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: textToSend.trim(),
      timestamp: format(new Date(), 'HH:mm')
    };

    setMessages((prev) => [...prev, userMsg]);
    persistNovaMessage('user', userMsg.text);
    // Seul déclencheur de défilement automatique désormais (voir le
    // commentaire détaillé plus haut, "verrouille le panneau") : geste
    // explicite de l'utilisateur (il vient d'envoyer un message), jamais un
    // changement d'état qui se reproduirait tout seul ensuite. rAF pour
    // laisser React poser le nouveau message dans le DOM avant de mesurer
    // sa hauteur de défilement.
    requestAnimationFrame(() => scrollToBottom());
    if (!customPrompt) {
      setPromptInput('');
      if (promptTextareaRef.current) promptTextareaRef.current.style.height = 'auto';
    }
    setPendingCount((c) => c + 1);

    // Ticket #9 : sans ce délai maximal, une requête qui ne répond jamais
    // (API distante bloquée, réseau qui pend) faisait tourner "Nova
    // réfléchit..." indéfiniment, sans jamais s'arrêter ni prévenir.
    // Ticket #250 : 30s était trop court pour generate_image (deux
    // allers-retours Claude + un appel Gemini image-gen) — porté à 60s.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (2/16) : le jeton
      // n'était pas transmis jusqu'ici (agent.ts ne pouvait identifier
      // personne) — nécessaire pour que le serveur puisse reconnaître un
      // compte "nova_super_assistant" (fondation, rien de visible encore).
      const novaAuthToken = currentUser ? await currentUser.getIdToken().catch(() => null) : null;
      const response = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(novaAuthToken ? { Authorization: `Bearer ${novaAuthToken}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: textToSend.trim(),
          // novaFullHistoryRef (pas `messages`, ce qui est affiché à l'écran)
          // — pour que Nova tienne compte de tout l'historique même après
          // un "Effacer l'historique" purement visuel (voir handleClearHistory).
          messages: novaFullHistoryRef.current,
          context: {
            currentDate: format(new Date(), 'yyyy-MM-dd HH:mm'),
            // Signalé : "Nova ne peut pas me donner les tâches de lundi" —
            // laisser Claude calculer lui-même la date ISO d'un jour nommé
            // ("lundi prochain") à partir de currentDate est fragile
            // (arithmétique de calendrier, modèle économique). Table toute
            // faite des 14 prochains jours (nom + ISO), calculée ici de
            // façon fiable — Claude n'a plus qu'à y chercher le bon jour
            // pour get_daily_summary(date).
            upcomingDates: Array.from({ length: 14 }, (_, i) => {
              const d = new Date();
              d.setDate(d.getDate() + i);
              return { label: i === 0 ? "aujourd'hui" : i === 1 ? 'demain' : format(d, 'EEEE', { locale: fr }), date: format(d, 'yyyy-MM-dd') };
            }),
            currentUser: {
              displayName: userProfile?.displayName || currentUser?.displayName,
              email: currentUser?.email
            },
            activeAgency: { id: activeAgency.id, name: activeAgency.name },
            // Demande explicite : "annonce à toutes les équipes de
            // Immosphera... ou à toutes les Agences" — create_announcement
            // (agencyIds) attend de VRAIS identifiants, jamais fournis
            // jusqu'ici : Nova ne pouvait donc pas cibler une agence
            // précise avec certitude. Liste complète (id + nom), comme les
            // contacts plus bas.
            // Signalé : "je ne veux pas que [Nova] donne des informations
            // sur toutes les entités, sauf pour les admin et super admin —
            // verrouillé à chaque utilisateur de sa propre agence." La
            // liste complète des 3 sociétés ne part donc au serveur QUE
            // pour un compte admin/super_admin — un agent normal ne voit
            // jamais mentionnée l'existence des autres agences par Nova
            // (create_announcement, déjà réservé aux admins par ailleurs,
            // resterait de toute façon sans agence à cibler pour lui).
            agencies:
              userProfile?.role === 'super_admin' || userProfile?.role === 'admin'
                ? AGENCIES.map((a) => ({ id: a.id, name: a.name }))
                : [],
            currentClientId: currentClientId || undefined,
            userLocation,
            stats: {
              totalContacts: allContacts.length,
              pendingTasks: tasks.filter((t) => !t.completed).length,
              totalDeals: deals.length,
              totalEvents: calendarEvents.length
            },
            // Signalé : "envoie un mail à Sylvain" ne trouvait pas le
            // contact — avec 133 contacts en base et une limite fixe de 60,
            // un client cité par son nom mais situé au-delà des 60 premiers
            // (ordre non garanti) était invisible pour Nova, qui ne pouvait
            // alors jamais lui associer d'e-mail (bouton "Envoyer" bloqué
            // silencieusement, sans erreur explicite). On fait maintenant
            // toujours passer en premier les contacts dont le nom apparaît
            // dans le message de l'utilisateur, avant de compléter avec les
            // suivants jusqu'à la limite — un client explicitement cité par
            // son nom est donc désormais TOUJOURS inclus, quelle que soit la
            // taille de la base.
            contacts: prioritizeMentioned(allContacts, textToSend, 60),
            collaborators: prioritizeMentioned(collaborators, textToSend, 60),
            tasks: tasks.slice(0, 25),
            events: calendarEvents.slice(0, 25),
            deals: deals.slice(0, 15)
          }
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Erreur serveur (${response.status})`);
      }

      const data = await response.json();
      const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = data.functionCalls || [];

      // Exécute les actions demandées, en distinguant clairement ce qui a
      // réussi de ce qui a échoué (ticket #7/#8) — plus aucun échec ne
      // disparaît silencieusement derrière une réponse optimiste de Nova.
      const executedActions: ActionExecuted[] = [];
      const failedActions: ActionFailed[] = [];
      const pendingClientActions: PendingClientAction[] = [];
      // Signalé (23 septembre) : « je crée une fiche client et lui demande
      // une tâche/note, ça n'apparaît pas dans sa fiche ». Cause : quand un
      // contact et sa tâche/note sont demandés dans le MÊME message, Nova ne
      // peut jamais fournir le contactId de la tâche/note — ce contact
      // n'existe pas encore au moment où Nova répond, il n'est donc pas dans
      // la liste "Contacts existants" du system prompt (voir agent.ts, qui
      // demande explicitement de laisser contactId vide dans ce cas). La
      // tâche/note se créait donc sans lien vers ce contact, invisible sur
      // sa fiche. On relie nous-mêmes : si create_task/create_note arrive
      // sans contactId ET qu'un contact vient d'être créé plus tôt DANS CE
      // MÊME lot d'actions, on utilise son id réel — c'est la seule cible
      // plausible (create_contact suivi de create_task/create_note dans le
      // même message ne vise jamais quelqu'un d'autre).
      let dernierContactCreeId: string | undefined;
      for (const fc of functionCalls) {
        if (CLIENT_GUEST_TOOLS.has(fc.name) || NOVA_ADMIN_TOOLS.has(fc.name) || CALENDAR_TOOLS.has(fc.name) || SUPPORT_TOOLS.has(fc.name) || EMAIL_TOOLS.has(fc.name)) {
          pendingClientActions.push({
            id: `pca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            toolName: fc.name as PendingClientAction['toolName'],
            contactId: typeof fc.args.contactId === 'string' ? fc.args.contactId : undefined,
            args: fc.args,
            status: 'pending',
          });
          continue;
        }
        const besoinDeLierAuContactCree =
          (fc.name === 'create_task' || fc.name === 'create_note') &&
          !fc.args.contactId &&
          dernierContactCreeId;
        const fcAvecContact = besoinDeLierAuContactCree
          ? { ...fc, args: { ...fc.args, contactId: dernierContactCreeId } }
          : fc;
        const result = await executeFunctionCall(fcAvecContact);
        if (result.success) {
          executedActions.push(result.action);
          if (fc.name === 'create_contact' && result.action.contactId) {
            dernierContactCreeId = result.action.contactId;
          }
        } else failedActions.push({ label: result.label, reason: result.reason });
        // Historique des actions de Nova (voir aussi confirmPendingAction) —
        // ces outils s'exécutent directement (sans confirmation manuelle),
        // mais restent des écritures dans le CRM ; on ne journalise pas les
        // simples lectures (recherches/résumés), sans intérêt pour un
        // historique d'actions.
        if (currentUser && !NOVA_READONLY_TOOLS.has(fc.name)) {
          supabase.from('nova_action_log' as any).insert({
            agent_user_id: currentUser.uid,
            tool_name: fc.name,
            args: fcAvecContact.args,
            ok: result.success,
            result_message: result.success ? result.action.title : result.label,
          } as any).then(() => {}, (err: any) => console.warn('Erreur journal Nova :', err));
        }
      }

      let replyText = data.text || '';
      if (!replyText) {
        if (executedActions.length > 0 && failedActions.length === 0) {
          replyText = "L'action demandée a été exécutée directement dans votre CRM Nova CRM.";
        } else if (failedActions.length > 0 && executedActions.length > 0) {
          replyText = 'Une partie des actions a réussi, le détail ci-dessous précise ce qui a échoué et pourquoi.';
        } else if (failedActions.length > 0) {
          replyText = "Aucune des actions demandées n'a pu être réalisée — voir le détail ci-dessous.";
        } else if (pendingClientActions.length > 0) {
          replyText = 'Confirmez ci-dessous avant que je ne passe à l\'action.';
        } else if (data.generatedImage) {
          replyText = 'Voici le visuel généré :';
        }
      }

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: replyText,
        timestamp: format(new Date(), 'HH:mm'),
        actionsExecuted: executedActions.length > 0 ? executedActions : undefined,
        actionsFailed: failedActions.length > 0 ? failedActions : undefined,
        properties: Array.isArray(data.properties) && data.properties.length > 0 ? data.properties : undefined,
        pendingClientActions: pendingClientActions.length > 0 ? pendingClientActions : undefined,
        generatedImage: data.generatedImage || undefined,
        // Architecture vocale à deux niveaux (voir api/ai/agent.ts) —
        // version courte pour le mode vocal, décidée par Claude lui-même.
        speechText: typeof data.speechText === 'string' && data.speechText.trim() ? data.speechText.trim() : null,
        shouldSpeak: data.shouldSpeak !== false,
      };

      // Recherche immobilière : on ouvre directement Immosphera360 avec les
      // biens trouvés plutôt que de rester dans le chat — "je demande une
      // maison et ensuite ça ouvre directement l'interface Immosphera360".
      if (onFoundProperties && Array.isArray(data.properties) && data.properties.length > 0) {
        onFoundProperties(data.properties.map((p: any) => p.id), textToSend.trim());
        return;
      }

      setMessages((prev) => [...prev, aiMsg]);
      persistNovaMessage('assistant', aiMsg.text);
      // Signalé (30/08/2026) : "je n'ai pas le texte qui remonte tout en
      // haut, je suis obligé de scroller" — le défilement automatique
      // n'était déclenché QUE par l'envoi du message utilisateur (voir plus
      // haut, "verrouille le panneau"), jamais par l'arrivée de la réponse
      // de Nova elle-même, souvent plus longue et donc dépassant l'écran.
      requestAnimationFrame(() => scrollToBottom());

      // Mode vocal (nébuleuse) actif : lit la réponse à voix haute, puis se
      // remet à écouter automatiquement — la boucle complète "on parle,
      // Nova répond en direct, on peut reparler tout de suite".
      //
      // Signalé : "relis le CRM à Nova pour que la voix comprenne mes
      // tâches/agenda" — les vraies données (bilan de journée, résumé des
      // prochains jours, statistiques du pipeline...) étaient déjà bien
      // reçues et calculées, mais elles vivent dans les cartes "résumé"
      // (aiMsg.actionsExecuted, affichées à l'écran), jamais dans
      // aiMsg.text lui-même — qui ne contenait alors qu'une phrase
      // générique du type "L'action demandée a été exécutée directement
      // dans votre CRM." Nova SAVAIT donc la réponse, mais ne la disait
      // jamais à voix haute. On construit ici le texte réellement lu en y
      // ajoutant le détail de chaque carte-résumé.
      if (voiceModeActiveRef.current) {
        // Toujours affiché à l'écran (voir voiceModeLastText, écran
        // nébuleuse) — même quand Claude juge qu'une lecture à voix haute
        // n'apporte rien (shouldSpeak=false), l'utilisateur garde un repère
        // visuel de ce que Nova a répondu.
        setVoiceModeLastText(aiMsg.text);

        const summaryDetails = (executedActions || [])
          .filter((a) => a.type === 'summary' && a.details)
          .map((a) => a.details)
          .join('\n\n');
        // Priorité à la version courte décidée par Claude (speechText,
        // voir api/ai/agent.ts) — sinon repli sur l'ancien comportement
        // (texte complet + détail des cartes-résumé).
        const fallbackTextToSpeak = [aiMsg.text, summaryDetails].filter((t) => t?.trim()).join('\n\n');
        const textToSpeak = aiMsg.speechText || fallbackTextToSpeak;
        const speakAllowed = aiMsg.shouldSpeak !== false;

        // Panneau flottant unique (voir NovaInfoPanel) : demande explicite
        // "doit se mettre uniquement quand il y a des infos [structurées]
        // (tâches, rendez-vous, ou autre) — pas d'échanges de texte entre
        // l'utilisateur et Nova". On ne l'affiche donc QUE s'il existe une
        // vraie carte-résumé (get_daily_summary, get_pipeline_stats...) —
        // jamais pour une réponse purement conversationnelle, qui reste
        // portée par l'orbe seul (+ le court repère sous le statut).
        const summaryActions = (executedActions || []).filter((a) => a.type === 'summary' && a.details);
        if (summaryActions.length > 0) {
          const infoTitle = summaryActions.length === 1 ? summaryActions[0].title : 'Informations';
          showVoiceInfo(infoTitle, summaryActions.map((a) => a.details).join('\n\n'));
        } else {
          clearVoiceInfo();
        }
        setIsVoicePaused(false);

        if (speakAllowed && textToSpeak.trim()) {
          setVoiceModeStatus('speaking');
          speakText(textToSpeak)
            .then(() => {
              // Petite transition "success" quand une vraie action CRM a
              // été réalisée (pas pour une simple question/réponse) — voir
              // demande "états de Nova : success".
              if (executedActions.length > 0 && voiceModeActiveRef.current) {
                setVoiceModeStatus('success');
                setTimeout(() => {
                  if (voiceModeActiveRef.current) startVoiceModeListening();
                }, 350);
              } else if (voiceModeActiveRef.current) {
                startVoiceModeListening();
              } else {
                setVoiceModeStatus('idle');
              }
            })
            .catch((err) => {
              console.warn('Erreur lecture vocale (mode vocal) :', err);
              showVoiceInfo('Erreur', (err as Error)?.message || 'La lecture audio a échoué.');
              if (voiceModeActiveRef.current) {
                setVoiceModeStatus('error');
                setTimeout(() => { if (voiceModeActiveRef.current) startVoiceModeListening(); }, 800);
              } else {
                setVoiceModeStatus('idle');
              }
            });
        } else if (voiceModeActiveRef.current) {
          // shouldSpeak=false (ou rien à dire) : pas de lecture, mais on ne
          // laisse jamais l'utilisateur dans le silence sans rien — le
          // texte reste affiché (voiceModeLastText + panneau ci-dessus), et
          // on relance directement l'écoute au lieu de faire patienter.
          startVoiceModeListening();
        }
      }
    } catch (err: unknown) {
      const isTimeout = (err as any)?.name === 'AbortError';
      const errorMessage = isTimeout
        ? "Nova n'a pas répondu à temps (délai de 60s dépassé). Réessayez."
        : (err as Error).message || "Impossible de joindre l'assistant IA.";
      console.error('Erreur Assistant IA:', err);
      setErrorStatus(errorMessage);

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          sender: 'ai',
          text: `⚠️ **Une erreur s'est produite** : ${errorMessage}`,
          timestamp: format(new Date(), 'HH:mm')
        }
      ]);
      requestAnimationFrame(() => scrollToBottom());

      // Mode vocal : jamais bloqué par une erreur (voir demande "gestion
      // des erreurs" — ne jamais empêcher Claude/le CRM de fonctionner) —
      // erreur affichée clairement dans le panneau texte, aucun appel audio
      // superflu, puis on relance l'écoute normalement.
      if (voiceModeActiveRef.current) {
        showVoiceInfo('Erreur', errorMessage);
        setVoiceModeStatus('error');
        setTimeout(() => { if (voiceModeActiveRef.current) startVoiceModeListening(); }, 2200);
      }
    } finally {
      clearTimeout(timeoutId);
      setPendingCount((c) => Math.max(0, c - 1));
    }
  };

  // Ticket #250 : "Copier" — image générée copiée dans le presse-papiers
  // (format standard pour coller directement ailleurs : mail, document...).
  const handleCopyGeneratedImage = async (messageId: string, dataUrl: string) => {
    setImageActionStatus((s) => ({ ...s, [messageId]: 'busy' }));
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setImageActionStatus((s) => ({ ...s, [messageId]: 'done' }));
      setTimeout(() => setImageActionStatus((s) => ({ ...s, [messageId]: 'idle' })), 1800);
    } catch (err) {
      setImageActionStatus((s) => ({ ...s, [messageId]: 'error' }));
      setImageActionError((s) => ({ ...s, [messageId]: "Copie impossible (non prise en charge par ce navigateur)." }));
    }
  };

  // Ticket #250 : "Utiliser dans le CRM" — dépose l'image dans le Drive du
  // compte connecté (dossier "Nova - Images générées"), même mécanisme
  // OAuth déjà utilisé pour l'agenda/les documents ailleurs dans ce fichier.
  const handleUseGeneratedImageInCrm = async (messageId: string, dataUrl: string, label: string) => {
    setImageActionStatus((s) => ({ ...s, [messageId]: 'busy' }));
    try {
      const token = await resolveWorkspaceAccessToken();
      if (!token) throw new Error('Connectez votre compte Google Workspace pour utiliser cette action (Paramètres → Google Workspace).');
      const blob = await (await fetch(dataUrl)).blob();
      const fileName = `Nova - ${label} - ${format(new Date(), 'yyyy-MM-dd HHmm')}.png`;
      await uploadImageToDriveFolder(token, blob, fileName);
      setImageActionStatus((s) => ({ ...s, [messageId]: 'done' }));
    } catch (err) {
      setImageActionStatus((s) => ({ ...s, [messageId]: 'error' }));
      setImageActionError((s) => ({ ...s, [messageId]: (err as Error).message || "Échec de l'envoi vers le Drive." }));
    }
  };

  // Demande explicite : "on ne peut pas faire en sorte qu'il retienne tout ?
  // [même si] on efface l'historique et il retient quand même ?" — "Effacer
  // l'historique" ne fait donc plus qu'un ménage VISUEL de la fenêtre de
  // discussion (pour repartir sur un affichage propre) : le fil en base et
  // novaFullHistoryRef (voir plus haut) ne sont JAMAIS touchés, donc Nova
  // continue de tenir compte de tout ce qui a été dit dans ses réponses,
  // même après ce bouton.
  const handleClearHistory = () => {
    setMessages([
      {
        id: 'welcome-reset',
        sender: 'ai',
        text: `Conversation réinitialisée à l'écran. En quoi puis-je vous aider ? (Je garde en mémoire tout ce qu'on s'est dit jusqu'ici.)`,
        timestamp: format(new Date(), 'HH:mm')
      }
    ]);
  };

  // ── Écran d'accueil façon Gemini — affiché tant qu'aucune conversation
  // n'a démarré (seul le message de bienvenue est présent). Dès le premier
  // message envoyé, on repasse sur la vue chat normale ci-dessous.
  const [heroListening, setHeroListening] = useState(false);
  const heroRecognitionRef = useRef<any>(null);
  // Signalé : "j'ai demandé une tâche et une note, Nova ne l'a pas fait" —
  // le serveur traite pourtant très bien une demande combinée dictée en
  // texte (vérifié directement). Le vrai bug : avec continuous:true, le
  // TOUT DERNIER segment parlé juste avant de cliquer "Arrêter" n'est pas
  // toujours marqué `isFinal` par le navigateur avant que `stop()` ne
  // déclenche `onend` — donc il n'était jamais ajouté au champ, et la
  // demande partait tronquée (ou vide). Corrigé en affichant en permanence
  // base + texte déjà confirmé + texte en cours de reconnaissance (même
  // non final), jamais seulement au moment où un segment devient final.
  const heroBaseTextRef = useRef('');
  const toggleHeroVoiceInput = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      alert("La reconnaissance vocale n'est pas supportée par ce navigateur.");
      return;
    }
    if (heroListening) {
      heroRecognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    heroRecognitionRef.current = recognition;
    recognition.lang = 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = true;
    heroBaseTextRef.current = promptInput.trim();
    // CORRECTIF (31/08/2026) — signalé sur le téléphone de Natacha : la dictée
    // écrivait « écris-moi une tâche écris-moi une tâche écris-moi une… » en
    // boucle. Un premier correctif a arrêté d'ACCUMULER entre deux événements
    // `onresult`, mais reconstruisait toujours la phrase en concaténant TOUS
    // les segments `isFinal` d'un même événement — or Android Chrome marque
    // souvent plusieurs segments `isFinal` qui se PROLONGENT l'un l'autre
    // ("j'ai", "j'ai vu", "j'ai vu le"...) plutôt qu'un seul par bout de
    // phrase : les concaténer tous reconstruit exactement la répétition
    // observée (signalé à nouveau le 4 septembre, Clémence). `assemblerDictee`
    // (src/lib/dictee.ts) corrige déjà ce cas précis, en production depuis le
    // 2 septembre pour la fiche client — réutilisée ici plutôt que
    // réinventée.
    recognition.onresult = (e: any) => {
      setPromptInput(assemblerDictee(e.results, heroBaseTextRef.current));
    };
    recognition.onend = () => setHeroListening(false);
    recognition.onerror = () => setHeroListening(false);
    setHeroListening(true);
    recognition.start();
  };
  // ── Dictée agentique (gros micro rouge) ─────────────────────────────────
  // Demande explicite (25 octobre) : « on place un bouton micro rouge dans
  // Nova quand il s'ouvre, on peut dicter des notes, des actions, et il
  // répond si besoin ». Choix validés : un appui = Nova écoute, l'envoi part
  // TOUT SEUL dès qu'on s'arrête de parler, Nova exécute (note, tâche, RDV,
  // mail…) puis s'arrête — un ordre à la fois. Réponse ÉCRITE uniquement
  // (aucune voix, donc aucun coût ElevenLabs) : indépendant du drapeau
  // VOICE_FEATURES_ENABLED, qui reste coupé pour le mode vocal complet.
  const [dicteeAgent, setDicteeAgent] = useState(false);
  const [dicteeAgentTexte, setDicteeAgentTexte] = useState('');
  const dicteeAgentRecoRef = useRef<any>(null);
  const dicteeAgentTexteRef = useRef('');
  const dicteeAgentBaseRef = useRef('');
  const dicteeAgentEnvoyeeRef = useRef(false);
  const dicteeAgentAnnuleeRef = useRef(false);
  const dicteeAgentSilenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // handleSendMessage change à chaque rendu : la reconnaissance (créée une
  // fois au démarrage) appelle toujours la version à jour via ce miroir.
  const envoyerDicteeRef = useRef<(t: string) => void>(() => {});
  envoyerDicteeRef.current = (t: string) => {
    setPromptInput('');
    if (promptTextareaRef.current) promptTextareaRef.current.style.height = 'auto';
    void handleSendMessage(t);
  };

  const effacerSilenceDictee = () => {
    if (dicteeAgentSilenceRef.current) { clearTimeout(dicteeAgentSilenceRef.current); dicteeAgentSilenceRef.current = null; }
  };
  const terminerDicteeAgent = (envoyer: boolean) => {
    effacerSilenceDictee();
    dicteeAgentAnnuleeRef.current = !envoyer;
    if (!envoyer) {
      setDicteeAgent(false);
      setDicteeAgentTexte('');
    }
    try { dicteeAgentRecoRef.current?.stop(); } catch { /* déjà arrêtée */ }
  };
  const demarrerDicteeAgent = () => {
    if (dicteeAgent) { terminerDicteeAgent(true); return; }
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setErrorStatus("La dictée vocale n'est pas disponible sur ce navigateur (utilisez Chrome ou Safari).");
      return;
    }
    if (heroListening) { heroRecognitionRef.current?.stop(); setHeroListening(false); }
    setErrorStatus(null);
    const recognition = new SpeechRecognitionCtor();
    dicteeAgentRecoRef.current = recognition;
    recognition.lang = 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = true;
    const baseInitiale = promptInput.trim();
    dicteeAgentBaseRef.current = baseInitiale;
    dicteeAgentTexteRef.current = baseInitiale;
    dicteeAgentEnvoyeeRef.current = false;
    dicteeAgentAnnuleeRef.current = false;
    setDicteeAgentTexte(baseInitiale);
    recognition.onresult = (e: any) => {
      const texte = assemblerDictee(e.results, dicteeAgentBaseRef.current);
      dicteeAgentTexteRef.current = texte;
      setDicteeAgentTexte(texte);
      setPromptInput(texte);
      autoResizePrompt();
      // 1,8 s de silence après la dernière parole = fin de l'ordre → envoi.
      effacerSilenceDictee();
      dicteeAgentSilenceRef.current = setTimeout(() => terminerDicteeAgent(true), 1800);
    };
    recognition.onerror = (e: any) => {
      const code = e?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setErrorStatus("Micro refusé : autorisez l'accès au microphone dans votre navigateur pour dicter à Nova.");
        setDicteeAgent(false);
      } else if (code === 'audio-capture') {
        setErrorStatus("Aucun microphone détecté sur cet appareil.");
        setDicteeAgent(false);
      } else if (code === 'network') {
        setErrorStatus("Erreur réseau du service de reconnaissance vocale du navigateur.");
        setDicteeAgent(false);
      }
    };
    recognition.onend = () => {
      effacerSilenceDictee();
      setDicteeAgent(false);
      const texte = dicteeAgentTexteRef.current.trim();
      if (texte && !dicteeAgentAnnuleeRef.current && !dicteeAgentEnvoyeeRef.current) {
        dicteeAgentEnvoyeeRef.current = true;
        envoyerDicteeRef.current(texte);
      }
      setDicteeAgentTexte('');
    };
    setDicteeAgent(true);
    try {
      recognition.start();
    } catch {
      setDicteeAgent(false);
      setErrorStatus("Impossible de démarrer le microphone. Vérifiez les permissions du navigateur.");
    }
  };
  useEffect(() => () => {
    effacerSilenceDictee();
    dicteeAgentAnnuleeRef.current = true;
    try { dicteeAgentRecoRef.current?.stop(); } catch { /* rien */ }
  }, []);

  const firstName = (userProfile?.displayName || currentUser?.displayName || '').split(' ')[0] || 'Sylvain';

  // Bascule Discussion / Fonds d'écran, affichée en overlay au-dessus des
  // deux écrans (accueil clair et chat sombre) pour rester accessible
  // quelle que soit la vue active.
  const TabSwitcher = ({ light }: { light: boolean }) => (
    <div
      className={`z-20 inline-flex items-center gap-1 rounded-full p-1 border shadow-md ${
        light ? 'bg-white/80 backdrop-blur border-white/70' : 'bg-white/5 border-white/10'
      }`}
    >
      {[
        { id: 'chat' as const, label: 'Discussion', Icon: MessageSquare },
        { id: 'wallpapers' as const, label: 'Fonds d\'écran', Icon: ImageIcon },
      ].map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setActiveTab(id)}
          title={label}
          className={`px-2 sm:px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors ${
            activeTab === id
              ? 'bg-[#F7BC5F] text-slate-950'
              : light
              ? 'text-[#1a1230]/70 hover:bg-black/5'
              : 'text-gray-300 hover:bg-white/10'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {/* Signalé : "sur mobile on ne voit pas la croix pour fermer" —
              cette pastille (avec ses libellés complets) rendait la rangée
              d'icônes en haut à droite trop large sur mobile, au point de
              déborder par-dessus le bouton retour tout à gauche. Libellé
              masqué sous "sm" (icône seule) pour rester compact. */}
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );

  // Panneau "Fonds d'écran", en overlay au-dessus de l'écran Nova IA (au lieu
  // de le remplacer) : la sélection s'applique en direct sur l'écran d'accueil
  // visible derrière/sous le panneau, pas besoin de changer de fenêtre pour
  // voir le rendu. Le clic sur "Valider" referme le panneau et revient sur
  // l'interface principale (Discussion / Fond d'écran restent accessibles).
  // Rendu via un portail direct dans <body> : sans ça, le panneau héritait
  // du défilement de la zone de contenu du CRM (un ancêtre du layout crée
  // un nouveau contexte pour "fixed") et son en-tête (avec le bouton
  // Valider) sortait du cadre visible dès qu'on faisait défiler la page.
  const wallpaperDrawer = activeTab === 'wallpapers' && createPortal(
    <div className="fixed inset-0 z-[999] flex justify-end">
      <button
        type="button"
        aria-label="Fermer le panneau fonds d'écran"
        onClick={() => setActiveTab('chat')}
        className="absolute inset-0 bg-black/10"
      />
      <div className="relative w-full sm:w-[400px] h-full bg-[#081318]/97 backdrop-blur-xl border-l border-white/10 shadow-2xl overflow-y-auto text-white animate-fade-in">
        {/* En-tête épinglé en haut du panneau : reste visible même en
            faisant défiler la galerie d'images, le bouton Valider ne
            disparaît donc plus jamais pendant le choix. Le panneau est un
            portail plein écran indépendant du reste de la mise en page (qui,
            lui, gère déjà la zone sûre iOS) : padding-top explicite ici pour
            que "Fond d'écran" / "Valider" ne se retrouvent pas sous
            l'encoche/la barre de statut sur mobile. */}
        <div className="sticky top-0 z-10 bg-[#081318]/97 backdrop-blur-xl border-b border-white/10 p-4 sm:p-5 pt-[calc(1rem+env(safe-area-inset-top,0px))] space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2 shrink-0">
              <ImageIcon className="w-4 h-4 text-[#F7BC5F]" /> Fond d'écran
            </h2>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className="px-4 py-2 rounded-xl font-bold text-xs bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 flex items-center gap-1.5 shadow-lg active:scale-95 transition-all shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              Valider
            </button>
          </div>
          <p className="text-[11px] text-gray-400">Aperçu en direct sur l'écran Nova, derrière ce panneau.</p>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => selectNovaWallpaper('')}
            className={`relative aspect-video rounded-2xl overflow-hidden border-2 flex items-center justify-center bg-gradient-to-br from-[#dfe6fb] via-[#bfe9ee] to-[#eef7ea] transition-all ${
              !novaWallpaper ? 'border-[#F7BC5F] ring-2 ring-[#F7BC5F]/50' : 'border-white/10 hover:border-white/30'
            }`}
          >
            <span className="text-[11px] font-bold text-[#1a1230]/70 bg-white/70 px-2 py-1 rounded-full">Par défaut</span>
            {!novaWallpaper && (
              <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#F7BC5F] text-slate-950 flex items-center justify-center shadow">
                <Check className="w-3 h-3" />
              </span>
            )}
          </button>

          {NOVA_WALLPAPERS.map((w) => {
            const selected = novaWallpaper === w.url;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => selectNovaWallpaper(w.url)}
                className={`relative aspect-video rounded-2xl overflow-hidden border-2 transition-all ${
                  selected ? 'border-[#F7BC5F] ring-2 ring-[#F7BC5F]/50' : 'border-white/10 hover:border-white/30'
                }`}
              >
                <img src={w.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                {selected && (
                  <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#F7BC5F] text-slate-950 flex items-center justify-center shadow">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {novaWallpaper && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Intensité du fond</span>
              <span className="text-xs font-mono text-[#F9C977]">{novaWallpaperOpacity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={novaWallpaperOpacity}
              onChange={(e) => changeNovaWallpaperOpacity(Number(e.target.value))}
              className="w-full accent-[#F7BC5F]"
            />
            <p className="text-[11px] text-gray-400">Ajuste la visibilité de l'image pour garder le texte de Nova bien lisible.</p>
          </div>
        )}
        </div>
      </div>
    </div>,
    document.body
  );

  // Interface unique, quel que soit l'état (accueil ou conversation en
  // cours) : même fond, même position de l'entête, même barre de saisie —
  // ticket #1 : on ne bascule plus jamais vers un second écran (sombre)
  // différent une fois qu'on envoie un message.
  const hasConversation = messages.length > 1;

  return (
    // Signalé : sur mobile, la barre de saisie tout en bas disparaissait —
    // "min-h-full" laissait ce panneau grandir au-delà de la hauteur de
    // l'écran dès que le contenu (messages + zone d'accueil) dépassait,
    // sans aucun défilement de page pour compenser (ce conteneur est posé en
    // `absolute inset-0` par App.tsx, sans overflow) : la barre, dernière de
    // la colonne, se retrouvait poussée sous le bord visible, invisible.
    // "h-full" (strictement borné) force la zone de messages (juste en
    // dessous, en overflow-y-auto) à défiler EN INTERNE à la place — la
    // barre de saisie reste ainsi toujours ancrée et visible en bas.
    <div
      ref={swipeBackRef}
      className="relative h-full overflow-hidden flex flex-col items-center justify-between px-3 py-6 sm:p-10 animate-novaai-bg"
      style={hauteurVisible ? { height: `${hauteurVisible}px` } : undefined}
    >
      {/* Couche du fond d'écran choisi, posée par-dessus le dégradé par
          défaut. La clé sur l'URL force un remontage à chaque changement
          d'image, ce qui rejoue le fondu .animate-fade-in : le passage
          d'une image à l'autre est ainsi fluide (crossfade) au lieu d'un
          changement brutal. */}
      {novaWallpaper && (
        <div
          key={novaWallpaper}
          className="absolute inset-0 animate-fade-in no-invert"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(255,255,255,${novaWallpaperVeil}), rgba(255,255,255,${Math.min(0.9, novaWallpaperVeil + 0.17)})), url(${novaWallpaper})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      {/* Signalé : la barre de navigation du bas (Accueil/Nova/Menu) ne doit
          plus rester visible par-dessus cet écran — mais c'était l'unique
          moyen d'en sortir sur mobile. Ce bouton retour la remplace. */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          title="Retour"
          className="absolute left-4 z-20 w-9 h-9 rounded-full bg-white/70 hover:bg-white/90 border border-white/80 shadow-sm text-[#1a1230] flex items-center justify-center transition-colors cursor-pointer"
          style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      {/* `top-4` seul plaçait ce bouton sous l'encoche/l'île dynamique sur
          mobile (Nova IA s'affiche en plein écran, sans la barre d'app qui
          gère habituellement cette zone) — padding de sécurité iOS ajouté. */}
      <div
        className="absolute right-2 sm:right-6 z-20 flex items-center gap-1 sm:gap-1.5 p-1 rounded-2xl bg-white/75 hover:bg-white/95 backdrop-blur-md border border-white/90 shadow-md transition-all"
        style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
      >
        {/* Signalé : "supprime le bouton Nova en haut car on l'a en bas" —
            ce bouton faisait doublon avec celui de la barre de saisie
            (entre micro et Envoyer, toujours visible lui, y compris sur
            mobile) ; retiré d'ici (desktop) pour ne garder qu'un seul accès
            au mode vocal. */}
        <button
          type="button"
          onClick={() => void openActionHistory()}
          title="Historique des actions de Nova"
          className="w-8 h-8 rounded-xl bg-black/5 hover:bg-black/10 text-[#1a1230] flex items-center justify-center transition-colors cursor-pointer"
        >
          <Clock className="w-4 h-4" />
        </button>
        {hasConversation && (
          <button
            type="button"
            onClick={handleClearHistory}
            title="Effacer l'historique"
            className="w-8 h-8 rounded-xl bg-black/5 hover:bg-rose-500/20 text-[#1a1230] hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        <TabSwitcher light />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Fermer Nova IA"
            aria-label="Fermer Nova IA"
            className="w-8 h-8 rounded-xl bg-black/5 hover:bg-rose-500/20 text-[#1a1230] hover:text-rose-600 flex items-center justify-center transition-all cursor-pointer ml-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Semis de points façon écran d'accueil Gemini, en surimpression du
          dégradé plein écran (voir .novaai-dots dans index.css). */}
      <div className="novaai-dots" aria-hidden="true" />

      {!hasConversation ? (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center text-center gap-5 sm:gap-6 z-10 w-full max-w-2xl px-2">
          <span className="text-xs font-black uppercase tracking-[0.3em] text-[#1a1230]/60">Nova</span>
          <NovaMascotte taille={130} />
          {activeClient ? (
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F7BC5F]/25 border border-[#F7BC5F]/40 text-slate-900 text-xs font-black shadow-sm">
                <User className="w-3.5 h-3.5 text-[#B8863F]" />
                <span>Fiche client · {activeClient.name}</span>
                {activeClient.clientType && (
                  <span className="opacity-75 font-semibold">({activeClient.clientType})</span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-[#1a1230] tracking-tight">
                Que souhaitez-vous faire sur ce dossier ?
              </h1>
              <p className="text-xs sm:text-sm text-[#1a1230]/75 max-w-md mx-auto">
                Toutes les notes, tâches, rendez-vous et actions seront automatiquement reliés à la fiche de <strong>{activeClient.name}</strong>.
              </p>
            </div>
          ) : (
            <h1 className="text-3xl sm:text-4xl font-black text-[#1a1230] tracking-tight">
              Comment ça va, {firstName} ?
            </h1>
          )}

          {activeClient ? (
            <div data-swipe-back-exclude="true" className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5 w-full">
              {getClientQuickPrompts(activeClient.name).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    if (p.isPrefill) {
                      setPromptInput(p.prompt);
                      if (promptTextareaRef.current) {
                        promptTextareaRef.current.focus();
                        autoResizePrompt();
                      }
                    } else {
                      handleSendMessage(p.prompt);
                    }
                  }}
                  className="w-full px-3 py-2.5 sm:px-4 sm:py-3 rounded-2xl bg-white/80 hover:bg-white border border-white/90 shadow-sm hover:shadow text-left flex items-center gap-2.5 sm:gap-3 text-[#1a1230] text-xs sm:text-sm font-semibold transition-all cursor-pointer group hover:scale-[1.01]"
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${p.color}`}>
                    <p.icon className="w-4 h-4" />
                  </div>
                  <span className="truncate leading-tight font-bold">{p.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <DndContext sensors={quickPromptSensors} collisionDetection={closestCenter} onDragEnd={handleQuickPromptDragEnd}>
              <SortableContext items={orderedQuickPrompts.map((p) => p.label)} strategy={rectSortingStrategy}>
                <div data-swipe-back-exclude="true" className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full">
                  {orderedQuickPrompts.map((p) => (
                    <SortableQuickPrompt key={p.label} label={p.label} Icon={p.icon} color={p.color} onSelect={() => handleSendMessage(p.prompt)} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      ) : (
        <div ref={messagesScrollRef} className="flex-1 min-h-0 z-10 w-full max-w-3xl mx-auto overflow-y-auto custom-scrollbar py-4 space-y-4">
          {messages.map((m) => {
            const isUser = m.sender === 'user';

            return (
              <div
                key={m.id}
                className={`flex gap-3 max-w-full ${isUser ? 'ml-auto flex-row-reverse' : ''}`}
              >
                {/* Avatar — logo Nova (mascotte statique) à côté de chaque
                    réponse IA, avatar utilisateur classique côté user. */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-md overflow-hidden ${
                    isUser
                      ? 'bg-[#F7BC5F] text-black font-black'
                      : 'bg-gradient-to-br from-[#F7BC5F] to-[#B8863F] text-slate-950 border border-[#FAD592]'
                  }`}
                >
                  {isUser ? (
                    <User className="w-4 h-4" />
                  ) : (
                    <img src="/nova-mascotte.png" alt="Nova" className="w-full h-full object-cover scale-125" />
                  )}
                </div>

                {/* Content Box */}
                {/* Ticket #281 : réponses avec "Actions CRM exécutées" trop
                    à l'étroit (75% sur desktop) — élargi. */}
                <div className="space-y-1.5 max-w-[92%] sm:max-w-[85%]">
                  <div
                    className={`p-4 sm:p-5 rounded-3xl text-xs sm:text-sm leading-relaxed ${
                      isUser
                        ? 'bg-gradient-to-r from-[#F7BC5F] via-[#F9C977] to-[#E5A642] text-slate-950 font-bold rounded-tr-none shadow-[0_10px_25px_-5px_rgba(247,188,95,0.35)]'
                        : 'bg-white/95 backdrop-blur-xl text-[#1a1230] border border-white/80 rounded-tl-none shadow-[0_15px_35px_-5px_rgba(0,0,0,0.12),0_0_15px_rgba(247,188,95,0.05)]'
                    }`}
                  >
                    <div className="markdown-body">
                      <Markdown>{m.text}</Markdown>
                    </div>

                    {!isUser && m.text.trim() && (() => {
                      // Même correctif que le mode vocal (voir handleSendMessage,
                      // "relis le CRM à Nova") : lit aussi le détail des cartes
                      // résumé, pas seulement la phrase générique de m.text.
                      const summaryDetails = (m.actionsExecuted || [])
                        .filter((a) => a.type === 'summary' && a.details)
                        .map((a) => a.details)
                        .join('\n\n');
                      const speakableText = [m.text, summaryDetails].filter((t) => t?.trim()).join('\n\n');
                      if (!VOICE_FEATURES_ENABLED) return null;
                      return (
                      <button
                        type="button"
                        onClick={() => void toggleSpeakMessage(m.id, speakableText)}
                        title={speakingMessageId === m.id ? 'Arrêter la lecture' : 'Écouter cette réponse'}
                        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#8B7355] hover:text-[#1a1230] transition-colors"
                      >
                        {loadingSpeechMessageId === m.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : speakingMessageId === m.id ? (
                          <VolumeX className="w-3.5 h-3.5" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                        {speakingMessageId === m.id ? 'Arrêter' : 'Écouter'}
                      </button>
                      );
                    })()}

                    {/* Actions Executed Badges — ticket #281 : "pas très
                        visible", texte agrandi et sections du bilan
                        (📋 tâches / 📅 rendez-vous) mises en forme en vraie
                        liste au lieu d'un unique bloc de texte compact. */}
                    {m.actionsExecuted && m.actionsExecuted.length > 0 && (
                      <div className="mt-4 pt-3.5 border-t border-black/10 space-y-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-900 text-xs font-black uppercase tracking-wider shadow-xs">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>Actions CRM exécutées en direct</span>
                        </div>
                        {m.actionsExecuted.map((act, i) => (
                          <div
                            key={i}
                            className="p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-white/95 to-emerald-50/70 border border-emerald-500/25 text-emerald-950 text-sm sm:text-base flex items-start gap-3.5 shadow-sm"
                          >
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                              {act.type === 'contact' && <UserPlus className="w-4 h-4" />}
                              {act.type === 'task' && <CheckSquare className="w-4 h-4" />}
                              {act.type === 'note' && <FileText className="w-4 h-4" />}
                              {act.type === 'appointment' && <Calendar className="w-4 h-4" />}
                              {act.type === 'drive_search' && <FileText className="w-4 h-4" />}
                              {act.type === 'summary' && <Sparkles className="w-4 h-4 text-[#B8863F]" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-black text-slate-900 text-base tracking-tight">{act.title}</p>
                              {act.type === 'summary' ? (
                                <SummaryDetails details={act.details} />
                              ) : (
                                <p className="mt-1 text-sm text-emerald-900/90 whitespace-pre-line leading-relaxed font-medium">{act.details}</p>
                              )}
                              {act.contactId && onOpenContact && (
                                <button
                                  type="button"
                                  onClick={() => onOpenContact(act.contactId!)}
                                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-bold text-emerald-900 transition-all cursor-pointer"
                                >
                                  <span>Voir la fiche du client</span>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {act.driveFiles && act.driveFiles.length > 0 && (
                                <div className="mt-2.5 space-y-1.5">
                                  {act.driveFiles.map((f) => (
                                    <a
                                      key={f.id}
                                      href={f.webViewLink || '#'}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-2 p-2.5 rounded-xl bg-white/85 hover:bg-white border border-emerald-500/20 text-emerald-900 text-sm truncate transition-colors shadow-xs"
                                    >
                                      {f.iconLink ? (
                                        <img src={f.iconLink} alt="" className="w-4 h-4 shrink-0" />
                                      ) : (
                                        <FileText className="w-4 h-4 shrink-0" />
                                      )}
                                      <span className="truncate font-semibold">{f.name}</span>
                                      <ExternalLink className="w-3.5 h-3.5 shrink-0 ml-auto opacity-60" />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions échouées — ticket #7/#8 : affichées clairement
                        avec la raison précise, jamais passées sous silence. */}
                    {m.actionsFailed && m.actionsFailed.length > 0 && (
                      <div className="mt-4 pt-3.5 border-t border-black/10 space-y-2.5">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-900 text-xs font-black uppercase tracking-wider shadow-xs">
                          <AlertCircle className="w-4 h-4 text-rose-600" />
                          <span>Actions non exécutées</span>
                        </div>
                        {m.actionsFailed.map((fail, i) => (
                          <div
                            key={i}
                            className="p-2.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-start gap-2"
                          >
                            <div className="w-5 h-5 rounded-lg bg-rose-500/20 text-rose-700 flex items-center justify-center shrink-0 mt-0.5">
                              <AlertCircle className="w-3 h-3" />
                            </div>
                            <div>
                              <p className="font-bold text-rose-950 text-xs">{fail.label}</p>
                              <p className="text-[11px] text-rose-800/80">{fail.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Ticket "Clients invités" (13/13) : invite/demande de
                        document/suspension d'un client — jamais exécuté
                        sans un clic explicite de confirmation ici. */}
                    {m.pendingClientActions && m.pendingClientActions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-black/10 space-y-2">
                        {m.pendingClientActions.map((action) => {
                          const isAdminTool = NOVA_ADMIN_TOOLS.has(action.toolName);
                          const isCalendarTool = CALENDAR_TOOLS.has(action.toolName);
                          const isSupportTool = SUPPORT_TOOLS.has(action.toolName);
                          const contact = !isAdminTool ? allContacts.find((c) => c.id === action.contactId) : undefined;

                          // Ticket #251 : carte dédiée (destinataire lecture
                          // seule, sujet/corps modifiables, aperçu signature)
                          // — trop différente du rendu générique ci-dessous
                          // pour partager son JSX.
                          if (action.toolName === 'send_client_email') {
                            if (action.status === 'done') {
                              return (
                                <div key={action.id} className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-start gap-2">
                                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                  <p>{action.resultLabel}</p>
                                </div>
                              );
                            }
                            if (action.status === 'cancelled') {
                              return (
                                <div key={action.id} className="p-2.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-600 text-xs">
                                  Annulé.
                                </div>
                              );
                            }
                            const draft = emailDrafts[action.id] || {
                              subject: typeof action.args.subject === 'string' ? action.args.subject : '',
                              body: typeof action.args.body === 'string' ? action.args.body : '',
                            };
                            const clientNameFallback = typeof action.args.clientName === 'string' ? action.args.clientName : '';
                            const hasEmail = !!contact?.email;
                            const usingHtmlSig = Boolean(mailSignatureHtml.trim());
                            // Demande explicite : "augmenter la fenêtre pour
                            // visualiser avant envoi et la mettre en
                            // rectangle" — vraie fenêtre modale large
                            // (portail, hors du flux étroit du chat) plutôt
                            // qu'une petite carte compacte.
                            return createPortal(
                              <div
                                key={action.id}
                                className="fixed inset-0 z-[250] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                                onClick={() => { if (action.status !== 'busy') updatePendingAction(m.id, action.id, { status: 'cancelled' }); }}
                              >
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full max-w-2xl max-h-[90vh] bg-white text-sky-950 rounded-2xl shadow-2xl border border-sky-300 flex flex-col overflow-hidden"
                                >
                                  <div className="flex items-center gap-2 p-4 border-b border-sky-200 shrink-0">
                                    <Mail className="w-4 h-4 text-sky-700 shrink-0" />
                                    <p className="font-bold text-sm">Préparer un e-mail</p>
                                  </div>
                                  <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
                                    <div>
                                      <span className="text-sky-900/70 font-semibold">À : </span>
                                      {contact ? (
                                        <span className={hasEmail ? '' : 'text-rose-700 font-semibold'}>
                                          {contact.name}{hasEmail ? ` <${contact.email}>` : " — aucune adresse e-mail enregistrée"}
                                        </span>
                                      ) : (
                                        <span className="text-rose-700 font-semibold">
                                          {clientNameFallback ? `« ${clientNameFallback} » introuvable dans le CRM` : 'Client introuvable dans le CRM'}
                                        </span>
                                      )}
                                    </div>
                                    <label className="block space-y-1">
                                      <span className="text-sky-900/70 font-semibold">Objet</span>
                                      <input
                                        value={draft.subject}
                                        onChange={(e) => setEmailDrafts((prev) => ({ ...prev, [action.id]: { subject: e.target.value, body: draft.body } }))}
                                        disabled={action.status === 'busy'}
                                        className="w-full px-3 py-2 rounded-lg border border-sky-300 bg-white text-sky-950 text-sm"
                                      />
                                    </label>
                                    <label className="block space-y-1">
                                      <span className="text-sky-900/70 font-semibold">Message</span>
                                      <textarea
                                        value={draft.body}
                                        onChange={(e) => setEmailDrafts((prev) => ({ ...prev, [action.id]: { subject: draft.subject, body: e.target.value } }))}
                                        disabled={action.status === 'busy'}
                                        rows={12}
                                        className="w-full px-3 py-2 rounded-lg border border-sky-300 bg-white text-sky-950 text-sm resize-y min-h-[220px]"
                                      />
                                    </label>
                                    {(mailSignatureHtml.trim() || mailSignatureText.trim()) && (
                                      <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-sky-900/70">
                                        <p className="text-[10px] uppercase tracking-wide font-bold mb-1">Signature ajoutée automatiquement</p>
                                        {usingHtmlSig ? (
                                          <div className="text-xs" dangerouslySetInnerHTML={{ __html: mailSignatureHtml }} />
                                        ) : (
                                          <p className="text-xs whitespace-pre-line">{mailSignatureText}</p>
                                        )}
                                      </div>
                                    )}
                                    {action.status === 'error' && <p className="text-rose-700 font-semibold">{action.errorMessage}</p>}
                                  </div>
                                  <div className="flex items-center gap-2 p-4 border-t border-sky-200 shrink-0">
                                    <button
                                      type="button"
                                      disabled={action.status === 'busy' || !hasEmail || !draft.subject.trim() || !draft.body.trim()}
                                      onClick={() => { setEmailDrafts((prev) => ({ ...prev, [action.id]: draft })); void confirmPendingAction(m.id, action); }}
                                      className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-50"
                                    >
                                      {action.status === 'busy' ? 'Envoi...' : 'Envoyer'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={action.status === 'busy'}
                                      onClick={() => updatePendingAction(m.id, action.id, { status: 'cancelled' })}
                                      className="px-4 py-2 rounded-lg bg-white border border-sky-300 hover:bg-sky-100 text-sky-800 text-sm font-bold disabled:opacity-50"
                                    >
                                      Annuler
                                    </button>
                                  </div>
                                </div>
                              </div>,
                              document.body,
                              action.id
                            );
                          }

                          const collaborator = action.toolName === 'set_collaborator_active_status'
                            ? collaborators.find((c) => c.id === action.args.userId)
                            : undefined;
                          const toolLabel =
                            action.toolName === 'invite_client_guest'
                              ? "Inviter dans l'Espace client"
                              : action.toolName === 'request_client_document'
                              ? `Demander : ${typeof action.args.docType === 'string' ? action.args.docType : 'document'}`
                              : action.toolName === 'set_client_guest_access_status'
                              ? (action.args.action === 'reactivate' ? "Réactiver l'accès" : action.args.action === 'revoke' ? "Révoquer l'accès" : "Suspendre l'accès")
                              : action.toolName === 'invite_collaborator'
                              ? 'Inviter un collaborateur'
                              : action.toolName === 'set_collaborator_active_status'
                              ? (action.args.isActive === false ? 'Désactiver un collaborateur' : 'Réactiver un collaborateur')
                              : action.toolName === 'create_pipeline_automation'
                              ? 'Créer une automatisation de pipeline'
                              : action.toolName === 'create_appointment'
                              ? `Créer le rendez-vous : ${typeof action.args.title === 'string' ? action.args.title : ''}`
                              : action.toolName === 'create_support_ticket'
                              ? `Créer un ticket support : ${typeof action.args.title === 'string' ? action.args.title : ''}`
                              : 'Publier une annonce';

                          if (action.status === 'done') {
                            return (
                              <div key={action.id} className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs flex items-start gap-2">
                                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                <p>{action.resultLabel}</p>
                              </div>
                            );
                          }
                          if (action.status === 'cancelled') {
                            return (
                              <div key={action.id} className="p-2.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-600 text-xs">
                                Annulé.
                              </div>
                            );
                          }
                          // Un outil admin sans donnée manquante peut toujours être confirmé
                          // (pas de "contact" à trouver) ; côté client_guest, il faut un contact valide.
                          // Le RDV n'a pas besoin d'un contact (clientName libre accepté) — l'échec
                          // éventuel (Google non connecté) est révélé après coup, pas bloqué ici.
                          const canConfirm = isCalendarTool || isSupportTool
                            ? true
                            : isAdminTool
                            ? (action.toolName !== 'set_collaborator_active_status' || !!collaborator)
                            : !!contact;
                          return (
                            <div key={action.id} className="p-3 rounded-xl bg-sky-50 border border-sky-300 text-sky-950 text-xs space-y-2">
                              <div className="flex items-center gap-2">
                                <UserPlus className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                                <p className="font-bold">{toolLabel}</p>
                              </div>
                              {!isAdminTool && !isCalendarTool && !isSupportTool && (
                                <p className="text-sky-900/90">
                                  Client : <span className="font-semibold">{contact?.name || 'Contact introuvable'}</span>
                                  {contact && (contact.email ? ` · ${contact.email}` : ' · aucun e-mail renseigné')}
                                </p>
                              )}
                              {isCalendarTool && (
                                <div className="text-sky-900/90 space-y-1">
                                  <p>
                                    📅 {typeof action.args.date === 'string' ? action.args.date : ''} à {typeof action.args.time === 'string' ? action.args.time : '09:00'}
                                    {typeof action.args.durationMinutes === 'number' ? ` (${action.args.durationMinutes} min)` : ''}
                                  </p>
                                  {(contact?.name || typeof action.args.clientName === 'string') && (
                                    <p>Client : <span className="font-semibold">{contact?.name || action.args.clientName as string}</span></p>
                                  )}
                                  {typeof action.args.location === 'string' && action.args.location && <p>Lieu : {action.args.location}</p>}
                                  {typeof action.args.type === 'string' && <p>Type : {action.args.type}</p>}
                                  {typeof action.args.attendees === 'string' && action.args.attendees && <p>Participants : {action.args.attendees}</p>}
                                  {action.args.sendClientConfirmation === true && <p className="italic">Une confirmation sera envoyée par e-mail au client.</p>}
                                </div>
                              )}
                              {action.toolName === 'invite_collaborator' && (
                                <p className="text-sky-900/90">
                                  <span className="font-semibold">{typeof action.args.email === 'string' ? action.args.email : ''}</span>
                                  {typeof action.args.fullName === 'string' && action.args.fullName ? ` · ${action.args.fullName}` : ''}
                                  {' · '}{typeof action.args.role === 'string' ? action.args.role : 'commercial'}
                                </p>
                              )}
                              {action.toolName === 'set_collaborator_active_status' && (
                                <p className="text-sky-900/90">
                                  Collaborateur : <span className="font-semibold">{collaborator?.name || 'Introuvable'}</span>
                                </p>
                              )}
                              {action.toolName === 'create_pipeline_automation' && (
                                <div className="text-sky-900/90 space-y-1">
                                  <p>Étape : <span className="font-semibold">{typeof action.args.stageName === 'string' ? action.args.stageName : ''}</span></p>
                                  <p>Sujet : {typeof action.args.emailSubject === 'string' ? action.args.emailSubject : ''}</p>
                                </div>
                              )}
                              {action.toolName === 'create_announcement' && (
                                <div className="text-sky-900/90 space-y-1">
                                  <p>Niveau : <span className="font-semibold">{{ info: 'Information', a_verifier: 'À vérifier', important: 'Important', succes: "Offre d'achat validée", veille: 'Veille', reponse_demandee: 'Réponse demandée SVP', signature_compromis: 'Signature compromis', signature_acte: 'Signature acte authentique' }[typeof action.args.level === 'string' ? action.args.level : 'info'] || 'Information'}</span></p>
                                  <p>Destinataires : <span className="font-semibold">
                                    {Array.isArray(action.args.agencyIds) && action.args.agencyIds.length > 0
                                      ? action.args.agencyIds.map((id: string) => AGENCIES.find((a) => a.id === id)?.name || id).join(', ')
                                      : 'Toutes les agences'}
                                  </span></p>
                                  <p className="italic">« {typeof action.args.message === 'string' ? action.args.message : ''} »</p>
                                  {Array.isArray(action.args.pollOptions) && action.args.pollOptions.length >= 2 && (
                                    <div className="pt-1">
                                      <p className="text-[11px] font-bold uppercase tracking-wide text-sky-700">Sondage :</p>
                                      <div className="flex flex-wrap gap-1.5 mt-1">
                                        {action.args.pollOptions.map((opt: string, i: number) => (
                                          <span key={i} className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-[11px] font-semibold">{opt}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              {isSupportTool && (
                                <div className="text-sky-900/90 space-y-1">
                                  <p>
                                    Priorité : <span className="font-semibold">{{ basse: 'Mineur', normale: 'Important', urgente: 'Majeur' }[typeof action.args.priority === 'string' ? action.args.priority : 'normale'] || 'Important'}</span>
                                    {' · '}Catégorie : {{ bug: 'Bug', technique: 'Technique', fonctionnalite: 'Fonctionnalité', autre: 'Autre' }[typeof action.args.category === 'string' ? action.args.category : 'autre'] || 'Autre'}
                                  </p>
                                  <p className="italic">« {typeof action.args.description === 'string' ? action.args.description : ''} »</p>
                                </div>
                              )}
                              {typeof action.args.deadline === 'string' && action.args.deadline && (
                                <p className="text-sky-900/80">Date limite : {action.args.deadline}</p>
                              )}
                              {typeof action.args.message === 'string' && action.args.message && action.toolName !== 'create_announcement' && (
                                <p className="text-sky-900/80 italic">« {action.args.message} »</p>
                              )}
                              {action.status === 'error' && <p className="text-rose-700 font-semibold">{action.errorMessage}</p>}
                              {!canConfirm ? (
                                <p className="text-rose-700 font-semibold">
                                  {isAdminTool ? 'Collaborateur introuvable — action impossible.' : 'Contact introuvable dans le CRM — action impossible.'}
                                </p>
                              ) : (
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    disabled={action.status === 'busy'}
                                    onClick={() => void confirmPendingAction(m.id, action)}
                                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold disabled:opacity-50"
                                  >
                                    {action.status === 'busy' ? 'En cours...' : 'Confirmer'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={action.status === 'busy'}
                                    onClick={() => updatePendingAction(m.id, action.id, { status: 'cancelled' })}
                                    className="px-3 py-1.5 rounded-lg bg-white border border-sky-300 hover:bg-sky-100 text-sky-800 text-[11px] font-bold disabled:opacity-50"
                                  >
                                    Annuler
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Immosphera360 : biens trouvés par Nova, en vignettes
                      photo + descriptif — côte à côte, défilement
                      horizontal s'il y en a plus que la largeur ne peut en
                      montrer d'un coup. */}
                  {m.properties && m.properties.length > 0 && (
                    <div data-swipe-back-exclude="true" className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 custom-scrollbar">
                      {m.properties.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setSelectedProperty(p); setPropertyPhotoIndex(0); }}
                          className="shrink-0 w-52 text-left rounded-xl overflow-hidden bg-[#0b1c1e] border border-[#F7BC5F]/25 shadow-lg hover:border-[#F7BC5F]/60 transition-colors"
                        >
                          <div className="w-full h-32 bg-black/30">
                            {p.image ? (
                              <img src={p.image} alt={p.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">Pas de photo</div>
                            )}
                          </div>
                          <div className="p-2.5 space-y-1">
                            <p className="text-xs font-bold text-white truncate">{p.title}</p>
                            {p.price != null && (
                              <p className="text-sm font-black text-[#F9C977]">{Number(p.price).toLocaleString('fr-FR')} €</p>
                            )}
                            <p className="text-[10px] text-slate-400 truncate">{p.address}</p>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                              {p.surfaceArea != null && <span>{p.surfaceArea} m²</span>}
                              {p.rooms != null && <span>· {p.rooms} pièces</span>}
                              {p.bedrooms != null && <span>· {p.bedrooms} ch.</span>}
                            </div>
                            {p.description && (
                              <p className="text-[10px] text-slate-500 line-clamp-2 leading-snug">{p.description}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Ticket #250 : image générée par Nova (generate_image),
                      avec ses actions dédiées. */}
                  {m.generatedImage && (
                    <div className="rounded-xl overflow-hidden bg-[#0b1c1e] border border-[#F7BC5F]/25 shadow-lg max-w-xs">
                      <img
                        src={m.generatedImage.dataUrl}
                        alt={m.generatedImage.label}
                        className="w-full h-auto object-contain bg-black/30"
                      />
                      <div className="p-2.5 space-y-2">
                        <p className="text-xs font-bold text-white">{m.generatedImage.label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href={m.generatedImage.dataUrl}
                            download={`nova-${m.generatedImage.intent}.png`}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#F7BC5F]/15 text-[#F9C977] border border-[#F7BC5F]/30 hover:bg-[#F7BC5F]/25 transition-colors"
                          >
                            Télécharger
                          </a>
                          <button
                            type="button"
                            onClick={() => handleSendMessage(`Régénère cette image (${m.generatedImage!.label}) avec une composition différente.`)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/10 text-white border border-white/15 hover:bg-white/15 transition-colors"
                          >
                            Régénérer
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendMessage(`Propose une variante de cette image (${m.generatedImage!.label}), même thème mais une mise en scène différente.`)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/10 text-white border border-white/15 hover:bg-white/15 transition-colors"
                          >
                            Variante
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyGeneratedImage(m.id, m.generatedImage!.dataUrl)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/10 text-white border border-white/15 hover:bg-white/15 transition-colors"
                          >
                            {imageActionStatus[m.id] === 'busy' ? 'Copie...' : imageActionStatus[m.id] === 'done' ? 'Copié !' : 'Copier'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUseGeneratedImageInCrm(m.id, m.generatedImage!.dataUrl, m.generatedImage!.label)}
                            disabled={imageActionStatus[m.id] === 'busy'}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#3ecf8e]/15 text-[#3ecf8e] border border-[#3ecf8e]/30 hover:bg-[#3ecf8e]/25 transition-colors disabled:opacity-50"
                          >
                            {imageActionStatus[m.id] === 'busy' ? 'Envoi...' : imageActionStatus[m.id] === 'done' ? 'Envoyé au Drive ✓' : 'Utiliser dans le CRM'}
                          </button>
                        </div>
                        {imageActionStatus[m.id] === 'error' && imageActionError[m.id] && (
                          <p className="text-[10px] text-rose-400">{imageActionError[m.id]}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <span className={`block text-[10px] text-[#1a1230]/50 px-1 ${isUser ? 'text-right' : ''}`}>
                    {m.timestamp}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/85 border border-white/70 w-fit text-xs text-[#1a1230] animate-pulse shadow-md">
              <Bot className="w-4 h-4 animate-spin" />
              <span>Nova réfléchit...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {errorStatus && (
        <div className="z-10 mb-3 px-4 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-700 text-xs flex items-center gap-2 max-w-xl w-full">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorStatus}</span>
        </div>
      )}

      {dicteeAgent && (
        <div className="z-10 mb-3 w-full max-w-xl rounded-2xl bg-white/95 backdrop-blur-xl border border-rose-500/30 shadow-[0_15px_40px_-10px_rgba(225,29,72,0.35)] px-4 py-3 flex items-start gap-3">
          <span className="mt-1 w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black uppercase tracking-wider text-rose-600">Nova vous écoute</p>
            <p className="text-sm text-[#1a1230] break-words">
              {dicteeAgentTexte || <span className="text-[#1a1230]/50">Dictez votre note ou votre action… l'envoi se fait dès que vous vous arrêtez.</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => terminerDicteeAgent(false)}
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold text-[#1a1230]/70 hover:bg-black/5 cursor-pointer"
          >
            Annuler
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
        // Au cas où "dans chat tu n'as pas mis le liseret" viserait aussi
        // cette barre de saisie (Nova) : border-white/60 sur un fond
        // bg-white/90 quasi identique (60% blanc sur 90% blanc) était très
        // peu contrasté. border-black/15 reste discret mais délimite
        // vraiment la barre, dans les deux thèmes (cette carte reste
        // volontairement blanche quel que soit le mode, inchangé).
        className="z-10 w-full max-w-xl flex items-end gap-2 bg-white/95 backdrop-blur-xl rounded-full shadow-[0_15px_40px_-10px_rgba(0,0,0,0.18),0_0_20px_rgba(247,188,95,0.1)] border border-white/90 px-3 py-2 transition-all ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-[#F7BC5F]/70"
      >
        <button
          type="button"
          title="Suggestions"
          onClick={() => setPromptInput('')}
          className="w-9 h-9 shrink-0 rounded-full bg-black/5 hover:bg-black/10 text-[#1a1230] flex items-center justify-center transition-colors mb-0.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
        {/* Zone de texte multi-lignes : Entrée insère un retour à la ligne
            (comportement par défaut d'un textarea), seul le bouton Envoyer
            déclenche réellement l'envoi. */}
        <textarea
          ref={promptTextareaRef}
          value={promptInput}
          onChange={(e) => { setPromptInput(e.target.value); autoResizePrompt(); }}
          placeholder={
            loading
              ? 'Demander autre chose à Nova (pas besoin d\'attendre)...'
              : activeClient
              ? `Demander à Nova pour ${activeClient.name}... (note, tâche, RDV, mail)`
              : 'Demander à Nova...'
          }
          rows={1}
          className="flex-1 bg-transparent outline-none text-sm text-[#1a1230] placeholder-[#1a1230]/50 resize-none py-1.5 max-h-[45vh] custom-scrollbar"
        />
        {VOICE_FEATURES_ENABLED && (
          <button
            type="button"
            onClick={toggleHeroVoiceInput}
            title={heroListening ? 'Arrêter la dictée' : 'Dictée vocale'}
            className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors mb-0.5 ${
              heroListening ? 'bg-rose-500/20 text-rose-600 animate-pulse' : 'bg-black/5 hover:bg-black/10 text-[#1a1230]'
            }`}
          >
            {heroListening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
        {/* Demande explicite : "le logo en bas, entre le micro et le bouton
            Envoyer" — même raccourci vers le mode vocal (nébuleuse) que
            l'icône du bandeau du haut, mais directement à portée de main
            pendant la saisie. */}
        {VOICE_FEATURES_ENABLED && (
          <button
            type="button"
            onClick={enterVoiceMode}
            title="Mode vocal — parler avec Nova en direct"
            className="w-9 h-9 shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-[#F7BC5F] to-[#B8863F] hover:brightness-110 shadow-md transition-all mb-0.5"
          >
            <img src="/nova-mascotte.png" alt="Nova" className="w-full h-full object-cover scale-110" />
          </button>
        )}
        {/* Micro rouge de dictée agentique : toujours visible, même pendant
            une conversation — un appui, on parle, Nova agit. */}
        <button
          type="button"
          onClick={demarrerDicteeAgent}
          title={dicteeAgent ? 'Envoyer maintenant' : 'Dicter une note ou une action'}
          aria-label={dicteeAgent ? 'Envoyer maintenant' : 'Dicter une note ou une action'}
          className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white shadow-md transition-all active:scale-95 cursor-pointer mb-0.5 ${
            dicteeAgent ? 'bg-rose-600 animate-pulse' : 'bg-gradient-to-br from-rose-500 to-red-600 hover:brightness-110'
          }`}
        >
          {dicteeAgent ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          type="submit"
          title="Envoyer"
          disabled={!promptInput.trim()}
          className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-default text-slate-950 flex items-center justify-center shadow-md transition-all cursor-pointer mb-0.5"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Demande explicite : "mode Commercial/Bureau" — depuis le chat
          texte (mode Bureau), lien pour repasser en mode Commercial vocal
          et en faire le mode par défaut à la prochaine ouverture sur
          mobile. Masqué tant que le vocal est désactivé. */}
      {VOICE_FEATURES_ENABLED && (
        <button
          type="button"
          onClick={switchToCommercialMode}
          className="md:hidden z-10 mt-2 text-xs text-[#1a1230]/60 hover:text-[#1a1230] underline underline-offset-2"
        >
          Passer en mode Commercial (vocal)
        </button>
      )}

      {wallpaperDrawer}

      {/* Ticket #61 : fiche détail d'un bien Immosphera360, ouverte en
          interne avec bouton retour — au lieu de partir sur l'annonce
          externe au clic sur une vignette. */}
      {selectedProperty && (
        <div
          className="fixed inset-0 z-[250] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedProperty(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] bg-[#0a1e20] border border-[#F7BC5F]/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center gap-2 p-4 border-b border-[#144447]/60 shrink-0">
              <button
                onClick={() => setSelectedProperty(null)}
                className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-1.5 text-xs font-bold"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
                Retour
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {(() => {
                const gallery = selectedProperty.images && selectedProperty.images.length > 0
                  ? selectedProperty.images
                  : selectedProperty.image ? [selectedProperty.image] : [];
                return (
                  <>
                    <div className="w-full h-64 sm:h-80 bg-black/40 relative shrink-0">
                      {gallery.length > 0 ? (
                        <img src={gallery[propertyPhotoIndex]} alt={selectedProperty.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">Pas de photo</div>
                      )}
                      {gallery.length > 1 && (
                        <>
                          <button
                            onClick={() => setPropertyPhotoIndex((i) => (i - 1 + gallery.length) % gallery.length)}
                            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white"
                          >
                            <ChevronRight className="w-4 h-4 rotate-180" />
                          </button>
                          <button
                            onClick={() => setPropertyPhotoIndex((i) => (i + 1) % gallery.length)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          <div className="absolute bottom-2 inset-x-0 flex items-center justify-center gap-1.5">
                            {gallery.map((_, i) => (
                              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === propertyPhotoIndex ? 'bg-[#F7BC5F]' : 'bg-white/40'}`} />
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="p-5 space-y-3">
                      <div>
                        <h2 className="text-lg font-black text-white">{selectedProperty.title}</h2>
                        <p className="text-sm text-slate-400">{selectedProperty.address}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        {selectedProperty.price != null && (
                          <span className="text-xl font-black text-[#F9C977]">{Number(selectedProperty.price).toLocaleString('fr-FR')} €</span>
                        )}
                        {selectedProperty.surfaceArea != null && (
                          <span className="text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">{selectedProperty.surfaceArea} m²</span>
                        )}
                        {selectedProperty.rooms != null && (
                          <span className="text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">{selectedProperty.rooms} pièces</span>
                        )}
                        {selectedProperty.bedrooms != null && (
                          <span className="text-xs font-semibold text-slate-300 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">{selectedProperty.bedrooms} chambres</span>
                        )}
                      </div>

                      {selectedProperty.description && (
                        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{selectedProperty.description}</p>
                      )}

                      {selectedProperty.listingUrl && (
                        <a
                          href={selectedProperty.listingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#F9C977] hover:text-[#FAD592] mt-2"
                        >
                          Voir l'annonce complète sur Immosphera360
                          <ChevronRight className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Demande explicite : "comme Siri, une nébuleuse Nova qui nous parle
          en direct" — panneau plein écran dédié, au-dessus de tout le reste
          (z-[80], plus haut que l'historique des actions) : un halo façon
          nébuleuse (plusieurs dégradés radiaux flous superposés, dorés/
          violets), dont l'intensité/le rythme de pulsation changent selon
          l'état (écoute / réflexion / parole), plus fidèle à un assistant
          vocal qu'une simple icône de micro statique. */}
      {voiceModeActive && (
        // Signalé en revue : ce panneau est un descendant direct du
        // conteneur suivi par le geste de retour (pas de portail) — sans
        // exclusion, un swipe ici fermerait tout Nova au lieu de juste
        // quitter le mode vocal.
        <div data-swipe-back-exclude="true" className="fixed inset-0 z-[80] bg-[#0a0612] flex flex-col items-center justify-center p-6">
          <style>{`
            @keyframes nova-nebula-breathe { 0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.9; } 50% { transform: scale(1.1) rotate(6deg); opacity: 1; } }
            @keyframes nova-nebula-listen { 0%, 100% { transform: scale(1) rotate(0deg); } 50% { transform: scale(1.22) rotate(-8deg); } }
            @keyframes nova-nebula-think { 0% { transform: rotate(0deg) scale(1); } 50% { transform: rotate(180deg) scale(1.08); } 100% { transform: rotate(360deg) scale(1); } }
            @keyframes nova-nebula-speak { 0%, 100% { transform: scale(1); } 25% { transform: scale(1.12); } 50% { transform: scale(0.95); } 75% { transform: scale(1.16); } }
            @keyframes nova-ring-pulse { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.6); opacity: 0; } }
            @keyframes nova-core-glow { 0%, 100% { opacity: 0.85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }
            @keyframes nova-spark-twinkle { 0%, 100% { opacity: 0; transform: scale(0.4); } 50% { opacity: 1; transform: scale(1); } }
          `}</style>

          <button
            type="button"
            onClick={exitVoiceMode}
            title="Quitter le mode vocal"
            className="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
          >
            <X className="w-5 h-5" />
          </button>

          {/* Demande explicite : "un seul panneau, plus design, contour
              jaune, effet glass à la Apple — uniquement quand il y a des
              infos (tâches, rendez-vous, ou autre), pas pour un simple
              échange de texte." Bureau uniquement (`hidden lg:flex` dans le
              composant) ; ne masque jamais l'orbe Nova (à ses côtés). */}
          <NovaInfoPanel
            status={voiceModeStatus}
            title={voiceInfoTitle}
            details={voiceInfoDetails}
            isPaused={isVoicePaused}
            onTogglePause={() => (isVoicePaused ? resumeSpeaking() : pauseSpeaking())}
            onReplay={replayLastSpeech}
            volume={voiceVolume}
            onVolumeChange={changeVoiceVolume}
            rate={voiceRate}
            onRateChange={changeVoiceRate}
          />

          <div className="relative w-56 h-56 sm:w-72 sm:h-72 flex items-center justify-center">
            {/* Anneaux qui se propagent vers l'extérieur pendant l'écoute. */}
            {voiceModeStatus === 'listening' && (
              <>
                <div className="absolute inset-0 rounded-full border border-[#F7BC5F]/50" style={{ animation: 'nova-ring-pulse 1.8s ease-out infinite' }} />
                <div className="absolute inset-0 rounded-full border border-[#F7BC5F]/50" style={{ animation: 'nova-ring-pulse 1.8s ease-out infinite 0.6s' }} />
                <div className="absolute inset-0 rounded-full border border-[#F7BC5F]/50" style={{ animation: 'nova-ring-pulse 1.8s ease-out infinite 1.2s' }} />
              </>
            )}

            {/* Nébuleuse elle-même — demande explicite : "plus de jaune, plus
                d'artefacts, supprime le logo". Repensée en 4 couches dorées
                (au lieu de 2 dorées + 1 violette) : le jaune/or domine
                largement, le violet ne reste que comme une pointe de
                profondeur discrète en bordure, jamais dominante. */}
            <div
              className="w-full h-full rounded-full"
              style={{
                background: 'radial-gradient(circle at 38% 32%, rgba(255,224,102,0.95), rgba(247,188,95,0.85) 35%, rgba(201,153,43,0.55) 60%, transparent 80%)',
                filter: 'blur(5px)',
                animation:
                  voiceModeStatus === 'listening' ? 'nova-nebula-listen 1.1s ease-in-out infinite'
                  : voiceModeStatus === 'thinking' ? 'nova-nebula-think 2.2s linear infinite'
                  : voiceModeStatus === 'speaking' ? 'nova-nebula-speak 0.9s ease-in-out infinite'
                  : 'nova-nebula-breathe 3.2s ease-in-out infinite',
              }}
            />
            <div
              className="absolute w-3/4 h-3/4 rounded-full"
              style={{
                background: 'radial-gradient(circle at 62% 68%, rgba(250,213,146,0.9), rgba(232,168,63,0.5) 50%, transparent 78%)',
                filter: 'blur(9px)',
                animation:
                  voiceModeStatus === 'listening' ? 'nova-nebula-listen 1.3s ease-in-out infinite 0.15s'
                  : voiceModeStatus === 'thinking' ? 'nova-nebula-think 2.6s linear infinite reverse'
                  : voiceModeStatus === 'speaking' ? 'nova-nebula-speak 1.1s ease-in-out infinite 0.1s'
                  : 'nova-nebula-breathe 3.6s ease-in-out infinite 0.3s',
              }}
            />
            <div
              className="absolute w-1/2 h-1/2 rounded-full"
              style={{
                background: 'radial-gradient(circle at 45% 40%, rgba(255,240,180,0.95), rgba(255,214,110,0.7) 50%, transparent 80%)',
                filter: 'blur(4px)',
                animation:
                  voiceModeStatus === 'listening' ? 'nova-nebula-listen 0.9s ease-in-out infinite 0.3s'
                  : voiceModeStatus === 'thinking' ? 'nova-nebula-think 1.8s linear infinite'
                  : voiceModeStatus === 'speaking' ? 'nova-nebula-speak 0.7s ease-in-out infinite 0.2s'
                  : 'nova-nebula-breathe 2.6s ease-in-out infinite 0.5s',
              }}
            />
            {/* touche violette résiduelle, en bordure seulement, pour la
                profondeur — jamais dominante */}
            <div
              className="absolute w-full h-full rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle at 78% 78%, rgba(107,33,168,0.35), transparent 35%)',
                filter: 'blur(12px)',
              }}
            />
            {/* Cœur lumineux central, remplace le logo retiré. */}
            <div
              className="absolute w-8 h-8 sm:w-10 sm:h-10 rounded-full"
              style={{
                background: 'radial-gradient(circle, #FFF6DE 0%, #FFE066 55%, #F7BC5F 100%)',
                boxShadow: '0 0 25px 8px rgba(255,224,102,0.7), 0 0 55px 20px rgba(247,188,95,0.35)',
                animation: 'nova-core-glow 2s ease-in-out infinite',
              }}
            />
            {/* Artefacts : particules scintillantes dispersées autour du
                halo, comme la poussière d'une vraie nébuleuse. */}
            {NEBULA_SPARKS.map((s, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  top: `${s.top}%`,
                  left: `${s.left}%`,
                  width: s.size,
                  height: s.size,
                  background: s.color,
                  boxShadow: `0 0 ${s.size * 2}px ${s.color}`,
                  animation: `nova-spark-twinkle ${s.duration}s ease-in-out infinite ${s.delay}s`,
                }}
              />
            ))}
          </div>

          <p className="mt-8 text-sm sm:text-base font-semibold text-[#F3EAD3] tracking-wide">
            {voiceModeStatus === 'listening' && 'Je vous écoute…'}
            {voiceModeStatus === 'thinking' && 'Nova réfléchit…'}
            {voiceModeStatus === 'speaking' && 'Nova vous répond…'}
            {voiceModeStatus === 'idle' && "Touchez le micro pour parler"}
            {voiceModeStatus === 'success' && (
              <span className="text-emerald-300">C'est fait ✓</span>
            )}
            {voiceModeStatus === 'error' && (
              <span className="text-rose-300">Un problème est survenu</span>
            )}
          </p>

          {/* Repère textuel de la dernière réponse — l'écran nébuleuse
              n'affiche normalement qu'un statut, jamais le contenu ; utile
              en repli visuel quand Nova ne lit pas la réponse à voix haute
              (shouldSpeak=false, voir handleSendMessage) pour ne jamais
              laisser l'utilisateur sans aucune information. */}
          {voiceModeLastText && voiceModeStatus !== 'listening' && (
            <p className="mt-3 max-w-sm text-center text-xs text-[#C9B67B]/70 leading-relaxed line-clamp-3 px-4">
              {voiceModeLastText}
            </p>
          )}

          {/* Demande explicite : "en bas, la barre à côté du micro" — le
              logo Nova accompagne désormais le bouton micro dans une même
              rangée, plutôt qu'un bouton micro isolé. */}
          <div className="mt-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full overflow-hidden shadow-lg shrink-0">
              <img src="/nova-mascotte.png" alt="Nova" className="w-full h-full object-cover scale-110" />
            </div>
            <button
              type="button"
              onClick={() => {
                if (voiceModeStatus === 'listening') {
                  if (voiceTranscriptRef.current && voiceTranscriptRef.current.trim() && !voiceHasDispatchedRef.current) {
                    // Clic pour valider immédiatement ce qui a été dit sans attendre la fin du silence
                    voiceHasDispatchedRef.current = true;
                    if (voiceSilenceTimerRef.current) {
                      clearTimeout(voiceSilenceTimerRef.current);
                      voiceSilenceTimerRef.current = null;
                    }
                    try { voiceModeRecognitionRef.current?.stop(); } catch {}
                    setVoiceModeStatus('thinking');
                    void handleSendMessage(voiceTranscriptRef.current.trim());
                  } else {
                    if (voiceSilenceTimerRef.current) {
                      clearTimeout(voiceSilenceTimerRef.current);
                      voiceSilenceTimerRef.current = null;
                    }
                    voiceModeRecognitionRef.current?.stop();
                    setVoiceModeStatus('idle');
                  }
                } else if (voiceModeStatus === 'idle') {
                  startVoiceModeListening();
                } else if (voiceModeStatus === 'speaking') {
                  // Demande explicite : "peut-on lui couper la parole si
                  // besoin ?" — coupe Nova immédiatement et repasse direct
                  // à l'écoute, comme dans une vraie conversation où on
                  // interrompt quelqu'un pour reprendre la parole.
                  stopSpeaking();
                  setIsVoicePaused(false);
                  startVoiceModeListening();
                }
              }}
              disabled={voiceModeStatus === 'thinking'}
              className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
              title={
                voiceModeStatus === 'listening' ? "Arrêter l'écoute"
                : voiceModeStatus === 'speaking' ? 'Couper Nova et parler'
                : 'Reparler'
              }
            >
              {voiceModeStatus === 'listening' || voiceModeStatus === 'speaking' ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-6 h-6" />}
            </button>
          </div>
          {voiceModeStatus === 'speaking' && (
            <p className="mt-2 text-[11px] text-[#C9B67B]/80">
              Touchez le bouton pour couper Nova
            </p>
          )}

          {/* Demande explicite : "mode Commercial/Bureau" — bascule
              PERSISTANTE (mémorisée pour la prochaine ouverture sur
              mobile), distincte de la simple croix de fermeture ci-dessus
              qui n'exit qu'une fois. Mobile uniquement, le concept n'a pas
              de sens sur ordinateur. */}
          <button
            type="button"
            onClick={switchToBureauMode}
            className="md:hidden mt-6 text-xs text-[#C9B67B] hover:text-[#F3EAD3] underline underline-offset-2"
          >
            Basculer en mode Bureau (par défaut la prochaine fois)
          </button>
        </div>
      )}

      {showActionHistory && (
        <div
          // Signalé en revue : même raison que le mode vocal ci-dessus —
          // sans exclusion, un swipe ici fermerait tout Nova au lieu de
          // juste cette modale.
          data-swipe-back-exclude="true"
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowActionHistory(false)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl bg-[#161022] border border-white/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#F9C977]" />
                <h3 className="text-sm font-bold text-white">Historique des actions de Nova</h3>
              </div>
              <button onClick={() => setShowActionHistory(false)} className="text-gray-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-3 space-y-2">
              {actionHistoryLoading ? (
                <div className="py-10 flex items-center justify-center text-gray-400 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                </div>
              ) : actionHistory.length === 0 ? (
                <p className="py-10 text-center text-xs text-gray-500">
                  Aucune action réalisée par Nova pour l'instant.
                </p>
              ) : (
                actionHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-xl border px-3 py-2.5 ${entry.ok ? 'border-white/10 bg-white/[0.03]' : 'border-rose-500/30 bg-rose-500/5'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">{ACTION_LABELS[entry.toolName] || entry.toolName}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${entry.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                        {entry.ok ? 'Réussi' : 'Échec'}
                      </span>
                    </div>
                    {entry.resultMessage && (
                      <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{entry.resultMessage}</p>
                    )}
                    <p className="text-[10px] text-gray-600 mt-1">
                      {format(new Date(entry.createdAt), 'dd/MM/yyyy HH:mm')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssistantIAView;
