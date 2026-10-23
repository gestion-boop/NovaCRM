import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, FolderPlus, Hash, Plus, Send, Trash2, ChevronUp, ChevronDown, ChevronRight,
  MessageSquare, Users, Share2, X, UserPlus, Crown, Search, Pencil,
  Image as ImageIcon, Smile, Mic, Mic2, Square, Eye, ArrowLeft, Check, CheckCheck,
  Clock, Camera, Lock, Paperclip, FileText, Loader2, Video as VideoIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { pickVoiceMimeType } from '@/lib/audioRecording';
// Envoi de vidéos (23 octobre, signalé : « on ne peut pas uploader de vidéos
// mp4 dans les discussions chats ») — les messages sont stockés en base en
// data URL base64 directement dans la ligne (voir insertConvMessage /
// insertChannelMedia), ce qui exclut toute vidéo réaliste (un .mp4 dépasse
// vite les quelques Mo que ça tolère). Même parade déjà en place côté fiche
// client (ClientProfileView.tsx, handleChatVideoSelected) : on dépose le
// fichier sur le Drive Google de l'utilisateur et on ne stocke que le lien.
import { getCachedAccessToken, requestWorkspaceAccessToken, uploadVideoToDriveFolder, isDriveEmbedUrl } from '@/lib/workspace';
import { assemblerDictee } from '@/lib/dictee';
import { ouvrirPieceJointe } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { AGENCIES } from '@/types';
import { agencesDisponibles } from '@/lib/agency-logos';
import { useIsMobile, useIsCoarsePointer } from '@/hooks/use-mobile';
import { NOVA_QUICK_REACTIONS, renderEmojiOrNova, isNovaReaction } from '@/lib/novaReactions';

const MAX_VIDEO_SIZE = 150 * 1024 * 1024; // 150 Mo — même plafond que ClientProfileView.tsx

interface ChatProject {
  id: string;
  name: string;
  description: string | null;
  position: number;
  agency_id: string | null;
}

interface ChatProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  added_by: string | null;
  created_at: string;
}

interface MemberProfile {
  uid: string;
  displayName: string;
  email: string;
}

interface ChatChannel {
  id: string;
  project_id: string;
  name: string;
  position: number;
  // Sous-dossiers : un canal peut être imbriqué dans un autre canal (voir
  // migration 20260904130000). `null`/`undefined` pour un canal racine —
  // rendu et comportement strictement inchangés dans ce cas.
  parent_channel_id?: string | null;
  created_by?: string | null;
  // Participation par canal — demande explicite : « je veux choisir qui
  // participe à chaque canal ». `restricted` = false (par défaut, canaux
  // existants inclus) : tout le dossier voit le canal, comme avant. À
  // true : seuls les invités (chat_channel_members) + le créateur du canal
  // + les super admins le voient (voir migration
  // 20260916100000_chat_channel_members_restriction).
  restricted?: boolean;
}

interface ChatChannelMember {
  id: string;
  channel_id: string;
  user_id: string;
  added_by: string | null;
  created_at: string;
}

interface ChatMessageRow {
  id: string;
  channel: string;
  data: {
    body?: string;
    sender_id?: string;
    sender_name?: string;
    created_at?: string;
    // Photos et messages vocaux : `insertChannelMedia` écrit déjà ces
    // champs, le type ne les déclarait simplement pas.
    kind?: 'text' | 'image' | 'voice' | 'file' | 'video';
    attachmentUrl?: string;
    attachmentMime?: string;
    attachmentDuration?: number;
  };
  created_at: string;
  sender_id?: string | null;
  is_deleted?: boolean;
  read_by?: { userId: string; userName?: string; readAt?: string }[];
  reactions?: { userId: string; emoji: string }[];
}

// Envoi différé : ligne de `scheduled_messages` en attente (id/corps/date
// suffisent à l'affichage — voir programmerMessageCanal/Conversation et la
// livraison réelle dans supabase/functions/run-automations/index.ts).
interface MessageProgramme {
  id: string;
  body: string;
  scheduled_at: string;
}

interface ConversationRow {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  created_by: string;
  created_at: string;
  last_message_at: string | null;
  agency_id: string | null;
}

interface DirectMessageRow {
  id: string;
  conversation_id: string | null;
  user_id: string;
  kind: 'text' | 'image' | 'voice' | 'video' | 'file';
  body: string | null;
  attachment_url: string | null;
  attachment_mime: string | null;
  attachment_duration: number | null;
  edited_at: string | null;
  created_at: string;
}

const TABS = [
  { id: 'projets', label: 'Projets', icon: Folder },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'partages', label: 'Partagés', icon: Share2 },
] as const;

// Taille d'une page de messages (conversations directes ET canaux) — voir
// le commentaire perf sur convHasMoreOlder plus bas pour le contexte.
const RECENT_MESSAGES_PAGE = 60;

interface ChatViewSupabaseProps {
  // Message ciblé par un clic sur une notification push/in-app — ouvre
  // automatiquement la bonne conversation et fait "rebondir" ce message
  // pendant 5 secondes pour l'identifier visuellement.
  initialHighlightMessageId?: string | null;
  onHighlightConsumed?: () => void;
  /**
   * Conversation à ouvrir directement, sans message précis à mettre en avant.
   *
   * Signalé (01/09/2026) : « au clic sur la notification, elle ne va pas
   * directement à la cible ». La notification d'un nouveau message porte
   * l'URL `/messagerie?conversation=<id>` quand aucun identifiant de message
   * n'est disponible — jusqu'ici personne ne lisait ce paramètre : on
   * atterrissait sur la liste des conversations, jamais sur la bonne.
   */
  initialConversationId?: string | null;
  onConversationTargetConsumed?: () => void;
  // Sur mobile, quitte le chat plein écran (revient à l'accueil, ce qui
  // fait réapparaître la barre de navigation du bas et les autres panneaux).
  onExitMobile?: () => void;
  // Demande explicite (30/08/2026) : "on peut le laisser tourner en page de
  // fond mais très léger... maîtriser la consommation" — Chat reste monté
  // en permanence dans App.tsx (voir currentNav === 'chat', maintenant
  // affichage CSS plutôt que montage/démontage) pour ne plus jamais tout
  // recharger au retour sur ce module. `isActive` indique si Chat est le
  // module RÉELLEMENT affiché à l'écran en ce moment : coupe le sondage 4s
  // (setInterval, voir les deux useEffect plus bas) quand ce n'est pas le
  // cas, pour ne pas interroger la base pour rien pendant qu'on est
  // ailleurs dans le CRM. Défaut à `true` : si jamais utilisé sans ce prop
  // (aucun autre point d'entrée actuellement), comportement inchangé.
  isActive?: boolean;
}

export default function ChatViewSupabase({ initialHighlightMessageId, onHighlightConsumed, initialConversationId, onConversationTargetConsumed, onExitMobile, isActive = true }: ChatViewSupabaseProps = {}) {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const isSuperAdmin = userProfile?.role === 'super_admin';
  // Les invitations / gestion des membres sont réservées aux admins (et super admin)
  const isAdmin = isSuperAdmin || userProfile?.role === 'admin';

  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('projets');
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [channelsByProject, setChannelsByProject] = useState<Record<string, ChatChannel[]>>({});
  // Nombre de participants invités par canal — la restriction est
  // désormais automatique (voir plus bas) : dès qu'un canal a au moins un
  // participant, il est restreint. Sert à afficher le cadenas sans avoir à
  // ouvrir le popup de gestion.
  const [channelMemberCounts, setChannelMemberCounts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  // Audit stabilité (20 octobre) : même bug que celui corrigé côté
  // conversations (voir activeConversationIdRef plus bas) mais côté canaux
  // d'équipe — loadMessages n'avait ni ref ni cache et remplaçait `messages`
  // sans jamais vérifier que le canal demandé était encore celui affiché.
  // Changer rapidement de canal pouvait donc faire apparaître, pour
  // quelques secondes, les messages d'un AUTRE canal sous le nom du canal
  // actif.
  const activeChannelIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeChannelIdRef.current = activeChannel?.id || null;
  }, [activeChannel?.id]);
  const channelMessagesCacheRef = useRef<Record<string, ChatMessageRow[]>>({});
  const [draft, setDraft] = useState('');
  const [showChannelEmoji, setShowChannelEmoji] = useState(false);
  // Signalé : "les Novadji dans les messages ne se mettent pas" — le
  // composeur des canaux d'équipe (#général...) est un composant à part de
  // celui des conversations directes, sans le bouton Nova ajouté au ticket
  // #260 — ajouté ici aussi.
  const [showChannelNovaPicker, setShowChannelNovaPicker] = useState(false);
  // Images et vocaux dans les canaux de projet (31/08/2026) — « pour tous les
  // messages du chat, dans tous les dossiers et conversations, je veux qu'on
  // puisse mettre des images, vocaux, emojis et Novadji ». Les conversations
  // directes avaient les quatre ; les canaux n'avaient que les deux derniers.
  const channelImageInputRef = useRef<HTMLInputElement>(null);
  const channelMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const channelAudioChunksRef = useRef<Blob[]>([]);
  const channelRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRecordingChannel, setIsRecordingChannel] = useState(false);
  const [recordingChannelSeconds, setRecordingChannelSeconds] = useState(0);
  // Demandé (4 septembre) : « pour les envois vocaux, je voudrais avoir un
  // bouton d'envoi et de réécoute avant envoi ». Jusqu'ici, arrêter
  // l'enregistrement l'envoyait aussitôt : aucun moyen de se réécouter, ni de
  // renoncer une fois le doigt levé. Le vocal terminé attend désormais ici,
  // et n'est inséré que sur un clic explicite.
  const [channelVocalPret, setChannelVocalPret] = useState<{ dataUrl: string; duree: number } | null>(null);
  const [uploadingChannelMedia, setUploadingChannelMedia] = useState(false);
  const [newChannelFor, setNewChannelFor] = useState<string | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  // Sous-dossiers — même mécanique que `expanded`/`newChannelFor`, mais au
  // niveau d'un canal plutôt que d'un dossier (voir renderCanal plus bas).
  const [expandedChannels, setExpandedChannels] = useState<Record<string, boolean>>({});
  const [newSubChannelFor, setNewSubChannelFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Gestion des membres par projet (table chat_project_members) ─────────
  const [membersModalProjectId, setMembersModalProjectId] = useState<string | null>(null);
  const [projectMembers, setProjectMembers] = useState<ChatProjectMember[]>([]);
  // Audit stabilité (20 octobre) : openMembersModal/openChannelMembersModal
  // (plus bas) remplaçaient sans condition projectMembers/channelMembers à
  // la résolution — ouvrir "Gérer les membres" du dossier/canal X puis,
  // avant que ça réponde, l'ouvrir pour Y affichait la liste de X sous le
  // nom de Y (et une suppression cliquée dessus visait alors X). Ces refs
  // (toujours à jour, contrairement à la closure de l'id au moment de
  // l'appel) permettent de vérifier que la modale concernée est toujours
  // ouverte sur ce même projet/canal avant d'écrire dans l'état affiché.
  const membersModalProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    membersModalProjectIdRef.current = membersModalProjectId;
  }, [membersModalProjectId]);

  // ── Gestion des membres par CANAL (table chat_channel_members) ──────────
  // Demande explicite : « je veux choisir qui participe à chaque canal »
  // (ex. un canal "Laetitia" au sein du dossier "Réseaux sociaux", visible
  // seulement d'elle + les personnes qu'on y invite).
  const [membersModalChannelId, setMembersModalChannelId] = useState<string | null>(null);
  const membersModalChannelIdRef = useRef<string | null>(null);
  useEffect(() => {
    membersModalChannelIdRef.current = membersModalChannelId;
  }, [membersModalChannelId]);
  const [channelMembers, setChannelMembers] = useState<ChatChannelMember[]>([]);
  const [channelMembersLoading, setChannelMembersLoading] = useState(false);
  const [channelMemberPickerQuery, setChannelMemberPickerQuery] = useState('');
  // Création d'un dossier de projet (31/08/2026) — « chaque agence doit avoir
  // sa propre vue des dossiers, et le + serait idéal pour créer des dossiers
  // en rattachant les utilisateurs des agences concernées ».
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectMemberIds, setNewProjectMemberIds] = useState<Set<string>>(new Set());
  const [newProjectQuery, setNewProjectQuery] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [allProfiles, setAllProfiles] = useState<MemberProfile[]>([]);
  // Agences réelles de chaque personne, lues dans `agency_members` — et non
  // plus dans la liste figée `teamMembers.ts` (voir le correctif du
  // 31/08/2026 plus bas).
  const [agencyIdsByUid, setAgencyIdsByUid] = useState<Record<string, string[]>>({});
  // Message d'échec de création de conversation. Sans lui, un refus de la base
  // fermait simplement la fenêtre sans rien dire.
  const [convCreateError, setConvCreateError] = useState<string | null>(null);
  const [memberPickerQuery, setMemberPickerQuery] = useState('');
  const [membersLoading, setMembersLoading] = useState(false);

  const displayName = userProfile?.displayName || currentUser?.email || 'Utilisateur';

  // ── Conversations directes (table `conversations` / `conversation_members` / `messages`) ──
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationMembers, setConversationMembers] = useState<Record<string, string[]>>({});
  const [convSearch, setConvSearch] = useState('');
  // Bug remonté : la liste des conversations ne bougeait jamais en direct —
  // ni réordonnancement, ni badge non-lu — tant qu'on ne quittait pas
  // l'onglet Chat et n'y revenait pas. `loadConversations()` n'était appelé
  // qu'une fois à l'ouverture, sans abonnement temps réel.
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>({});
  // Ticket #225 : la liste des conversations n'affichait aucun aperçu du
  // dernier message ni son heure — juste "Groupe"/"Message direct" en
  // permanence, peu importe l'historique réel.
  const [lastMessageByConv, setLastMessageByConv] = useState<Record<string, { body: string | null; kind: DirectMessageRow['kind']; created_at: string }>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Signalé (20 octobre) : « je suis sur la conversation de Laetitia et je
  // vois que c'est sur Natacha » — loadConvMessages (plus bas) reste en vol
  // pendant un changement de conversation ; à sa résolution, il fusionnait
  // ses lignes fraîches dans `prev` (l'état PARTAGÉ, celui affiché À CET
  // INSTANT, désormais celui de l'AUTRE conversation) au lieu de la
  // conversation pour laquelle il avait été lancé. Une fermeture React
  // (`activeConversationId` lu directement) peut dater d'un rendu plus
  // ancien que cette résolution tardive ; cette ref, mise à jour à chaque
  // changement, donne toujours la conversation RÉELLEMENT affichée à
  // l'instant de la fusion.
  const activeConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  const [convMessages, setConvMessages] = useState<DirectMessageRow[]>([]);
  // Perf (30/08/2026, signalé "plus de 10 secondes avant que tout
  // apparaisse" + proposition de l'utilisateur "classer des antécédents") :
  // chaque ouverture ET chaque sondage (toutes les 4s, voir plus bas)
  // chargeait TOUTE la conversation d'un coup (jusqu'à 300 messages,
  // triés du PLUS ANCIEN — donc potentiellement même pas les plus
  // récents sur un fil de 300+ messages). Remplacé par une pagination :
  // seuls les RECENT_MESSAGES_PAGE derniers messages sont chargés par
  // défaut (rapide, à l'ouverture comme à chaque sondage), le reste de
  // l'historique reste en base, accessible via "Charger les messages
  // précédents" plutôt que perdu.
  const [convHasMoreOlder, setConvHasMoreOlder] = useState(true);
  const [loadingOlderConv, setLoadingOlderConv] = useState(false);
  // Audit "effets instantanés" : les réactions emoji sur une conversation
  // n'étaient jamais poussées en direct à l'autre participant — seul un
  // nouveau message (INSERT/UPDATE/DELETE sur `messages`) redéclenchait le
  // rechargement complet (qui recharge aussi les réactions par effet de
  // bord). Réagir sans envoyer de message restait donc invisible pour
  // l'autre tant qu'il ne rouvrait pas la conversation. Ce ref (toujours à
  // jour, contrairement à une simple closure d'effet) permet de savoir si un
  // changement sur `message_reactions` concerne CETTE conversation avant de
  // déclencher un rechargement ciblé.
  const convMessageIdsRef = useRef<Set<string>>(new Set());
  // Signalé (17/09/2026) : "on attend jusqu'à 5 secondes pour que l'historique
  // s'affiche" — rouvrir une conversation déjà consultée pendant cette
  // session affichait `[]` (voir openConversation) et attendait le
  // round-trip réseau avant de montrer quoi que ce soit, alors que son
  // dernier lot de messages était déjà connu. Ce cache mémoire (par
  // conversation, jamais persisté) permet de la réafficher instantanément
  // pendant que loadConvMessages rafraîchit en tâche de fond — même
  // principe que `silent=true` dans loadConversations, appliqué ici par
  // conversation plutôt qu'à la liste entière.
  const convMessagesCacheRef = useRef<Record<string, DirectMessageRow[]>>({});
  // Verrous d'envoi — un message à la fois par composeur. Un `useRef` et non
  // un `useState` : la valeur doit être lue et écrite dans le même tic, avant
  // tout nouveau rendu, sinon la garde arrive trop tard.
  const sendingConvRef = useRef(false);
  const sendingChannelRef = useRef(false);
  useEffect(() => {
    convMessageIdsRef.current = new Set(convMessages.map((m) => m.id));
  }, [convMessages]);
  const [convDraft, setConvDraft] = useState('');
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [newConvQuery, setNewConvQuery] = useState('');
  // Demande explicite (29/08/2026) : "chaque entité doit être cloisonné,
  // sauf pour les chats... chaque utilisateur peut créer des groupes aussi
  // avec des utilisateurs de plusieurs agences différentes" — la modale
  // "Nouvelle conversation" gère désormais deux modes.
  const [newConvMode, setNewConvMode] = useState<'direct' | 'group'>('direct');
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  // Demande explicite (24/09/2026) : "dans les conversations des chats, je
  // veux que chaque utilisateur puisse inviter des utilisateurs de
  // Immosphera, Conseils Finances et Novavisio [...] et inviter plusieurs
  // utilisateurs si possible" — jusqu'ici, seule la CRÉATION d'un groupe
  // permettait de choisir plusieurs collègues multi-agences (createGroup
  // ci-dessous) ; impossible d'agrandir un groupe déjà créé. Même principe
  // de sélection multiple que la modale "Nouveau groupe", rejoué ici pour
  // un groupe déjà ouvert.
  const [showInviteConvModal, setShowInviteConvModal] = useState(false);
  const [inviteConvQuery, setInviteConvQuery] = useState('');
  const [selectedInviteIds, setSelectedInviteIds] = useState<Set<string>>(new Set());
  const [invitingToConv, setInvitingToConv] = useState(false);
  const convScrollRef = useRef<HTMLDivElement>(null);
  const [convReactions, setConvReactions] = useState<Record<string, { userId: string; emoji: string }[]>>({});
  const [showConvReactionPickerFor, setShowConvReactionPickerFor] = useState<string | null>(null);
  const reactionPickerRef = useRef<HTMLDivElement | null>(null);
  // Signalé (30/08/2026) : "je clique à côté sur ordinateur... l'écran des
  // emojis ne se ferme pas" — le calque invisible plein écran (fixed
  // inset-0) censé fermer le sélecteur au clic extérieur ne couvrait pas
  // fiablement tout l'écran (position:fixed peut se retrouver cadré par un
  // ancêtre avec transform/filter au lieu du viewport). Remplacé par une
  // détection de clic extérieur sur `document`, indépendante de tout
  // positionnement CSS. Toujours pas fiable au premier essai (persistait
  // même en cliquant loin) : cause probable, un élément intermédiaire
  // (input, autre bouton...) qui stoppe la propagation de l'événement en
  // phase de bulles avant qu'il n'atteigne `document`. Le écouteur est donc
  // maintenant posé en PHASE DE CAPTURE (3ᵉ argument `true`) : il se
  // déclenche AVANT que quoi que ce soit ne puisse stopper la propagation,
  // quel que soit l'élément cliqué.
  useEffect(() => {
    if (!showConvReactionPickerFor) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setShowConvReactionPickerFor(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => document.removeEventListener('mousedown', handleOutsideClick, true);
  }, [showConvReactionPickerFor]);
  // Quand le message est en bas de la conversation, le picker (380px de haut)
  // n'a pas la place de s'ouvrir vers le bas et se fait rogner par le cadre
  // défilant — on choisit le sens d'ouverture au clic selon la place
  // disponible sous le bouton.
  const [convReactionPickerUp, setConvReactionPickerUp] = useState(false);
  const [editingConvMsgId, setEditingConvMsgId] = useState<string | null>(null);
  const [editingConvMsgText, setEditingConvMsgText] = useState('');
  // Demande explicite (30/08/2026) : "chaque utilisateur qui envoie un
  // message [dans les canaux/projets] pour le modifier ou le supprimer,
  // quand au super admin ou admin, il pourra également supprimer un
  // message" — les canaux d'équipe (chat_messages) n'avaient encore AUCUNE
  // action modifier/supprimer (contrairement aux conversations directes
  // ci-dessus, qui servent de modèle ici).
  const [editingChannelMsgId, setEditingChannelMsgId] = useState<string | null>(null);
  const [editingChannelMsgText, setEditingChannelMsgText] = useState('');
  // Signalé (25/09/2026, capture à l'appui, canal "Nouveautés (biens)") :
  // "les utilisateurs ne peuvent pas rajouter [de réaction] sur les textes
  // qui sont postés, [ils sont] obligés de faire un message à part [...]
  // comme ça se fait déjà dans notre interface" — les réactions existaient
  // déjà pour les conversations directes (convReactions ci-dessus,
  // message_reactions), jamais portées aux canaux d'équipe. Les canaux
  // vivent dans une table à part (chat_messages, pas `messages`) : les
  // réactions sont donc stockées directement sur la ligne du message
  // (colonne JSONB `reactions`), même principe déjà en place ici pour
  // `read_by`, plutôt que dans message_reactions (qui ne connaît que la
  // table `messages`). Même modèle "toute personne du canal peut réagir",
  // même sélecteur, rejoué pour chat_messages.
  const [showChannelReactionPickerFor, setShowChannelReactionPickerFor] = useState<string | null>(null);
  const [channelReactionPickerUp, setChannelReactionPickerUp] = useState(false);
  const channelReactionPickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showChannelReactionPickerFor) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (channelReactionPickerRef.current && !channelReactionPickerRef.current.contains(e.target as Node)) {
        setShowChannelReactionPickerFor(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => document.removeEventListener('mousedown', handleOutsideClick, true);
  }, [showChannelReactionPickerFor]);
  const [convLightboxUrl, setConvLightboxUrl] = useState<string | null>(null);
  const lightboxPressTimer = useRef<number | null>(null);
  // Ticket #24 (nouvelle base) : accusé de lecture — quel autre membre de la
  // conversation a lu tel message (table `message_receipts`, déjà prête en
  // base mais jamais exploitée côté front). `readAt` gardé en plus de l'id
  // (16 octobre) : la requête le lisait déjà (voir loadReactionsAndReceiptsFor)
  // mais le jetait aussitôt — nécessaire maintenant pour l'afficher dans la
  // fenêtre détaillée (readReceiptModal, plus bas).
  const [convReadBy, setConvReadBy] = useState<Record<string, { userId: string; readAt?: string }[]>>({});
  // Demande explicite (30/09/2026) : "je voudrais savoir qui c'est qui lit
  // donc en passant la souris sur la réception je voudrais que tu me mettes
  // les noms des personnes qui ont lu le message [...] dans tous les
  // messages chat" — la double coche ne dit aujourd'hui que "au moins une
  // autre personne a lu", ce qui ne suffit pas dans un groupe/canal à
  // plusieurs (on ne sait pas QUI, ni si TOUT LE MONDE a lu). Une seule
  // info-bulle à la fois par surface (conversations/canaux, voir plus bas) :
  // déclenchée au survol (souris, un coup d'œil rapide).
  const [showConvReadByFor, setShowConvReadByFor] = useState<string | null>(null);
  // Même bascule que ci-dessus, pour les canaux d'équipe (état séparé :
  // conversations et canaux sont deux surfaces indépendantes partout
  // ailleurs dans ce fichier).
  const [showChannelReadByFor, setShowChannelReadByFor] = useState<string | null>(null);
  // Signalé (16 octobre) : « une fenêtre un peu plus grande pour voir qui a
  // lu les messages » — l'info-bulle ci-dessus (petite, texte tronqué au-delà
  // de 220px) reste pour le survol rapide ; un clic ouvre maintenant cette
  // fenêtre, commune aux conversations ET aux canaux (la liste de lecteurs
  // est normalisée au clic, voir plus bas, pour que le rendu de la fenêtre
  // ignore d'où elle vient).
  const [readReceiptModal, setReadReceiptModal] = useState<{
    readers: { userId: string; name: string; readAt?: string }[];
  } | null>(null);

  const profileByUid = useMemo(() => {
    const map: Record<string, MemberProfile> = {};
    allProfiles.forEach((p) => { map[p.uid] = p; });
    TEAM_MEMBERS.forEach((m) => { if (!map[m.id]) map[m.id] = { uid: m.id, displayName: m.name, email: m.email }; });
    return map;
  }, [allProfiles]);

  // Bouton "Documents" (super admins) — demandé le 5 octobre : « avoir
  // accès à tous les documents qui ont été envoyés... rechercher beaucoup
  // plus rapidement ». Agrège les pièces jointes (images et fichiers) des
  // conversations ET des canaux, pour l'agence active, avec une recherche
  // texte. Nécessite les policies RLS messages_select_superadmin et
  // conversations_select_superadmin (migrations du 5 octobre) : sans
  // elles, un super admin ne verrait que les conversations dont il est
  // lui-même membre — pas un accès réellement global. Les canaux, eux,
  // étaient déjà entièrement lisibles par les super admins (can_access_chat_project
  // et can_view_chat_channel ont toujours inclus ce bypass).
  const [showDocuments, setShowDocuments] = useState(false);
  const [chargementDocuments, setChargementDocuments] = useState(false);
  const [documentsMessagerie, setDocumentsMessagerie] = useState<
    { id: string; genre: 'image' | 'file'; nom: string; url: string; expediteur: string; lieu: string; lieuType: 'Conversation' | 'Canal'; date: string }[]
  >([]);
  const [rechercheDocuments, setRechercheDocuments] = useState('');

  const LIMITE_DOCUMENTS = 300;

  const chargerDocumentsMessagerie = async () => {
    if (!activeAgency?.id) return;
    setChargementDocuments(true);
    try {
      await ensureProfilesLoaded();

      // Perf (audit du 20 octobre) : ces deux tables servaient uniquement à
      // résoudre le nom/l'agence des pièces jointes des LIMITE_DOCUMENTS
      // messages ci-dessus, mais étaient téléchargées intégralement — TOUTE
      // conversation et TOUT dossier de l'entreprise, toutes agences
      // confondues — alors que le filtrage par agence qui suit (plus bas)
      // ne garde de toute façon que celles de l'agence active. `agency_id
      // is null` reste inclus : certaines conversations/dossiers sont
      // partagés, visibles de toutes les agences.
      const filtreAgence = activeAgency.id === 'all' ? null : `agency_id.eq.${activeAgency.id},agency_id.is.null`;
      let conversationsQuery = supabase.from('conversations').select('id, title, type, agency_id');
      if (filtreAgence) conversationsQuery = conversationsQuery.or(filtreAgence);

      const [{ data: msgRows, error: errMsg }, { data: convRows }] = await Promise.all([
        supabase
          .from('messages')
          .select('id, conversation_id, user_id, kind, body, attachment_url, created_at')
          .not('conversation_id', 'is', null)
          .in('kind', ['image', 'file'])
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(LIMITE_DOCUMENTS),
        conversationsQuery,
      ]);
      if (errMsg) throw errMsg;
      const convById = new Map(
        ((convRows || []) as { id: string; title: string | null; type: string; agency_id: string | null }[]).map((c) => [c.id, c])
      );
      const docsConv = ((msgRows || []) as { id: string; conversation_id: string; user_id: string; kind: string; body: string | null; attachment_url: string | null; created_at: string }[])
        .filter((m) => m.attachment_url)
        .map((m) => {
          const conv = convById.get(m.conversation_id);
          return { m, conv };
        })
        .filter((x): x is { m: typeof x.m; conv: NonNullable<typeof x.conv> } =>
          Boolean(x.conv) && (activeAgency.id === 'all' || x.conv!.agency_id === activeAgency.id || x.conv!.agency_id === null)
        )
        .map(({ m, conv }) => ({
          id: m.id,
          genre: m.kind as 'image' | 'file',
          nom: m.body || (m.kind === 'image' ? 'Photo' : 'Document'),
          url: m.attachment_url as string,
          expediteur: profileByUid[m.user_id]?.displayName || 'Utilisateur',
          lieu: conv.title || (conv.type === 'group' ? 'Groupe' : 'Conversation'),
          lieuType: 'Conversation' as const,
          date: m.created_at,
        }));

      let projectsQuery = supabase.from('chat_projects').select('id, agency_id');
      if (filtreAgence) projectsQuery = projectsQuery.or(filtreAgence);

      const [{ data: chanRows, error: errChan }, { data: channelRows }, { data: projectRows }] = await Promise.all([
        supabase
          .from('chat_messages')
          .select('id, channel, data, created_at')
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .limit(LIMITE_DOCUMENTS),
        supabase.from('chat_channels').select('id, name, project_id'),
        projectsQuery,
      ]);
      if (errChan) throw errChan;
      const channelById = new Map(((channelRows || []) as { id: string; name: string; project_id: string }[]).map((c) => [c.id, c]));
      const agencyByProjectId = new Map(((projectRows || []) as { id: string; agency_id: string | null }[]).map((p) => [p.id, p.agency_id]));
      const docsChan = ((chanRows || []) as { id: string; channel: string; data: any; created_at: string }[])
        .filter((r) => (r.data?.kind === 'image' || r.data?.kind === 'file') && r.data?.attachmentUrl)
        .map((r) => {
          const chan = channelById.get(r.channel);
          const agencyId = chan ? agencyByProjectId.get(chan.project_id) : undefined;
          return { r, chan, agencyId };
        })
        .filter((x) => x.chan && (activeAgency.id === 'all' || x.agencyId === activeAgency.id || x.agencyId === null || x.agencyId === undefined))
        .map(({ r, chan }) => ({
          id: r.id,
          genre: r.data.kind as 'image' | 'file',
          nom: r.data.body || (r.data.kind === 'image' ? 'Photo' : 'Document'),
          url: r.data.attachmentUrl as string,
          expediteur: r.data.sender_name || profileByUid[r.data.sender_id]?.displayName || 'Utilisateur',
          lieu: chan!.name,
          lieuType: 'Canal' as const,
          date: r.created_at,
        }));

      setDocumentsMessagerie(
        [...docsConv, ...docsChan].sort((a, b) => b.date.localeCompare(a.date))
      );
    } catch (e) {
      toast.error((e as Error)?.message || 'Impossible de charger les documents.');
    } finally {
      setChargementDocuments(false);
    }
  };

  const ouvrirDocuments = () => {
    setShowDocuments(true);
    void chargerDocumentsMessagerie();
  };

  const documentsFiltres = useMemo(() => {
    const q = rechercheDocuments.trim().toLowerCase();
    if (!q) return documentsMessagerie;
    return documentsMessagerie.filter(
      (d) => d.nom.toLowerCase().includes(q) || d.expediteur.toLowerCase().includes(q) || d.lieu.toLowerCase().includes(q)
    );
  }, [documentsMessagerie, rechercheDocuments]);

  const ensureProfilesLoaded = async () => {
    if (allProfiles.length > 0) return;
    const [{ data }, { data: memberRows }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email'),
      supabase.from('agency_members').select('user_id, agency_id'),
    ]);
    if (memberRows) {
      const byUid: Record<string, string[]> = {};
      (memberRows as { user_id: string; agency_id: string }[]).forEach((m) => {
        (byUid[m.user_id] ||= []).push(m.agency_id);
      });
      setAgencyIdsByUid(byUid);
    }
    if (data) {
      setAllProfiles(
        (data as { id: string; full_name: string | null; email: string | null }[]).map((p) => ({
          uid: p.id,
          displayName: p.full_name || p.email || 'Utilisateur',
          email: p.email || '',
        }))
      );
    }
  };

  // Signalé : "quand j'envoie un message j'ai toujours cette page à gauche
  // qui se rafraîchit" — loadConversations() est aussi appelée après
  // l'envoi (pour mettre à jour l'aperçu du dernier message et l'ordre de
  // la liste), ce qui affichait "Chargement…" à la place de toute la
  // liste à chaque message. `silent=true` garde les données déjà affichées
  // pendant le rechargement en arrière-plan — seul le tout premier
  // chargement (ouverture de l'onglet) reste "bruyant".
  const loadConversations = async (silent = false) => {
    if (!currentUser) return;
    if (!silent) setConversationsLoading(true);
    try {
      // Perf (30/08/2026, "les conversations prennent du temps à se mettre
      // en place") : `ensureProfilesLoaded()` était attendu AVANT la
      // requête des memberships, alors que les deux sont indépendantes —
      // ça ajoutait un aller-retour réseau complet et séquentiel avant même
      // de savoir quelles conversations charger. Lancées en parallèle ici.
      const [, { data: myMemberships, error: membershipsError }] = await Promise.all([
        ensureProfilesLoaded(),
        supabase.from('conversation_members').select('conversation_id').eq('user_id', currentUser.uid),
      ]);

      // Signalé (urgent, 30/08/2026) : "aucun message n'apparaît" — un
      // échec de CETTE requête (réseau, limite momentanée...) n'était
      // jamais distingué de "vraiment aucune conversation" : `ids` tombait
      // à 0 et la liste entière était vidée (`setConversations([])`), pour
      // une simple erreur passagère. On ne touche plus à rien si elle a
      // échoué — la liste précédente reste affichée.
      if (membershipsError) {
        console.warn('Erreur chargement des conversations (memberships) :', membershipsError);
        return;
      }

      const ids = (myMemberships || []).map((m: any) => m.conversation_id);
      if (ids.length === 0) { setConversations([]); setConversationMembers({}); return; }

      const [{ data: convRows, error: convError }, { data: memberRows, error: memberError }] = await Promise.all([
        supabase.from('conversations').select('*').in('id', ids).order('last_message_at', { ascending: false, nullsFirst: false }),
        supabase.from('conversation_members').select('conversation_id, user_id').in('conversation_id', ids),
      ]);

      // Même filet : une erreur ici ne doit jamais vider la liste déjà
      // affichée, seulement être ignorée (le prochain rafraîchissement
      // réessaiera).
      if (convError || memberError) {
        console.warn('Erreur chargement des conversations :', convError || memberError);
        return;
      }

      setConversations((convRows as ConversationRow[]) || []);
      const grouped: Record<string, string[]> = {};
      (memberRows || []).forEach((m: any) => { (grouped[m.conversation_id] ||= []).push(m.user_id); });
      setConversationMembers(grouped);

      // Perf (30/08/2026, signalé "les conversations mettent trop de temps
      // à apparaître") : l'aperçu du dernier message par conversation
      // (Ticket #225 — jusqu'à 300 lignes à parcourir tous canaux
      // confondus, puis regroupées en ne gardant que le plus récent par
      // conversation) n'a pas besoin de bloquer l'affichage de la liste
      // elle-même, déjà utilisable dès `setConversations` ci-dessus — lancé
      // en tâche de fond (pas de `await`), l'aperçu se complète dès qu'il
      // arrive au lieu de retarder tout le reste.
      supabase
        .from('messages')
        .select('conversation_id, body, kind, created_at')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false })
        .limit(300)
        .then(({ data: recentMsgs }) => {
          const lastByConv: Record<string, { body: string | null; kind: DirectMessageRow['kind']; created_at: string }> = {};
          (recentMsgs || []).forEach((m: any) => {
            if (!m.conversation_id || lastByConv[m.conversation_id]) return;
            lastByConv[m.conversation_id] = { body: m.body, kind: m.kind, created_at: m.created_at };
          });
          setLastMessageByConv(lastByConv);
        });
    } finally {
      setConversationsLoading(false);
    }
  };

  // 30/08/2026, "les conversations prennent du temps à se mettre en
  // place" : cet effet se redéclenche à CHAQUE fois que l'onglet
  // "conversations" redevient actif (dépendance `tab`), et rappelait
  // `loadConversations()` en mode "bruyant" (efface la liste, affiche de
  // nouveau "Chargement…") même si elle avait déjà été chargée une minute
  // plus tôt — donnant l'impression que ça recharge à chaque fois qu'on
  // revient sur l'onglet. À partir du 2ᵉ passage, on recharge en silence
  // (`silent=true`, voir loadConversations) : la liste déjà affichée reste
  // visible pendant le rafraîchissement en arrière-plan.
  const conversationsLoadedOnceRef = useRef(false);
  useEffect(() => {
    if (tab === 'conversations' && currentUser) {
      loadConversations(conversationsLoadedOnceRef.current);
      conversationsLoadedOnceRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currentUser?.uid]);

  const loadUnreadByConversation = async () => {
    if (!currentUser) return;
    try {
      const { data, error } = await supabase
        .from('message_receipts')
        .select('message_id, messages!inner(conversation_id)')
        .eq('user_id', currentUser.uid)
        .is('read_at', null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        const convId = row.messages?.conversation_id;
        if (!convId) return;
        counts[convId] = (counts[convId] || 0) + 1;
      });
      setUnreadByConversation(counts);
    } catch {
      // Best-effort : pas de badge plutôt que de casser la liste.
    }
  };

  // Rafraîchit en direct la liste (réordonnancement) + les badges non-lus
  // dès qu'un message m'est adressé n'importe où, sans devoir quitter
  // l'onglet Chat et y revenir.
  useEffect(() => {
    if (!currentUser) return;
    loadUnreadByConversation();
    const channel = supabase
      .channel(`chat_receipts_${currentUser.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts', filter: `user_id=eq.${currentUser.uid}` },
        () => {
          loadUnreadByConversation();
          if (tab === 'conversations') loadConversations(true);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, tab]);

  // Signalé (7 septembre, Isabelle — « valable pour tous ») : aucune pastille
  // non-lu nulle part côté Projets (ni sur l'onglet, ni sur un canal précis),
  // contrairement aux Conversations. Les messages de canal (`chat_messages`)
  // n'ont pas de table `message_receipts` : leur statut lu/non-lu vit dans
  // leur propre colonne JSONB `read_by` (déjà utilisée par loadMessages pour
  // marquer lu à l'ouverture d'un canal) — on la relit ici pour tous les
  // canaux accessibles, plutôt qu'un seul à la fois.
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const loadUnreadByChannel = async () => {
    if (!currentUser) return;
    const channelIds = Object.values(channelsByProject).flat().map((c) => c.id);
    if (channelIds.length === 0) { setUnreadByChannel({}); return; }
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, channel, sender_id, read_by')
        .in('channel', channelIds)
        .neq('sender_id', currentUser.uid)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        const lu = Array.isArray(row.read_by) && row.read_by.some((x: any) => x?.userId === currentUser.uid);
        if (lu) return;
        counts[row.channel] = (counts[row.channel] || 0) + 1;
      });
      setUnreadByChannel(counts);
    } catch {
      // Best-effort : pas de badge plutôt que de casser l'écran.
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    loadUnreadByChannel();
    const channel = supabase
      .channel(`chat_channel_unread_${currentUser.uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => loadUnreadByChannel())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, channelsByProject]);

  // Signalé (29/08/2026) : "quand on met des liens dans les discussions, ça
  // serait bien qu'on les souligne pour qu'on puisse y accéder directement
  // à un clic" — détecte les URL dans un message texte et les rend
  // cliquables/soulignées, le reste du texte inchangé.
  const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const IS_URL_REGEX = /^(https?:\/\/|www\.)/;
  // Signalé (3 septembre) : dans la bulle jaune de l'expéditeur, un lien
  // jaune sur fond jaune ne se voyait pas en mode sombre. `surJaune` passe
  // le lien en encre foncée, soulignée et en gras.
  const linkifyText = (text: string, surJaune = false): React.ReactNode[] => {
    const parts = text.split(URL_REGEX);
    return parts.map((part, i) => {
      if (!IS_URL_REGEX.test(part)) return part;
      const href = part.startsWith('www.') ? `https://${part}` : part;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          // Couleur posée en style direct : aucune règle de thème ne peut
          // la repasser en jaune sur la bulle jaune.
          style={surJaune ? { color: '#0b1719', textDecorationColor: '#0b1719' } : undefined}
          className={`underline underline-offset-2 break-all ${
            surJaune ? 'font-bold hover:opacity-80' : 'text-[#F9C977] hover:text-[#FAD592]'
          }`}
        >
          {part}
        </a>
      );
    });
  };

  // Ticket #225 : aperçu texte du dernier message (adapté aux pièces
  // jointes, qui n'ont pas de `body`) + heure/date courte pour la liste.
  const lastMessagePreview = (conversationId: string): string => {
    const m = lastMessageByConv[conversationId];
    if (!m) return 'Aucun message pour l\'instant';
    if (m.kind === 'text') return (m.body || '').trim() || '…';
    if (m.kind === 'image') return '📷 Photo';
    if (m.kind === 'voice') return '🎤 Message vocal';
    if (m.kind === 'video') return '🎥 Vidéo';
    return '📎 Fichier';
  };

  const conversationTime = (conversationId: string): string => {
    const m = lastMessageByConv[conversationId];
    if (!m) return '';
    const d = new Date(m.created_at);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  };

  // Ticket #12 (nouvelle base, cause réelle) : appelée avec la conversation
  // ouverte par une notification (clochette ou push), qui peut ne pas
  // encore être présente dans `conversations` (liste pas encore chargée) —
  // l'appelant utilisait un `!` non-null qui plantait tout le panneau
  // ("Cannot read properties of undefined (reading 'title')"), page figée.
  const conversationLabel = (c: ConversationRow | undefined) => {
    if (!c) return 'Conversation';
    if (c.title) return c.title;
    const others = (conversationMembers[c.id] || []).filter((u) => u !== currentUser?.uid);
    if (others.length === 0) return 'Conversation';
    return others.map((u) => profileByUid[u]?.displayName || 'Utilisateur').join(', ');
  };

  // Photo réelle du collaborateur pour une conversation directe (message
  // privé à 1 seul autre membre) — les groupes gardent les initiales.
  const conversationAvatarUrl = (c: ConversationRow): string | null => {
    if (c.type === 'group') return null;
    const others = (conversationMembers[c.id] || []).filter((u) => u !== currentUser?.uid);
    if (others.length !== 1) return null;
    return TEAM_MEMBERS.find((m) => m.id === others[0])?.avatarUrl || null;
  };

  // Ticket #225 : les conversations liées à un lead sans nom donné restent
  // en base sous un titre technique brut ("lead:<uuid>") jamais pensé pour
  // être vu — elles s'affichaient telles quelles ("lead:bb3653d1-...") et
  // encombraient la liste sans être réellement exploitables. Masquées
  // uniquement de cette vue (rien n'est supprimé en base).
  const isRawLeadPlaceholder = (c: ConversationRow) => !!c.title && c.title.startsWith('lead:');

  // Signalé (17/09/2026) : "beaucoup marqué Utilisateur" — des identifiants
  // fantômes restants dans conversation_members (comptes jamais recréés
  // après une resynchronisation passée, cf. teamMembers.ts) ne se résolvent
  // vers aucun profil ni aucun membre de TEAM_MEMBERS. Tant qu'on ne peut
  // pas les identifier avec certitude, mieux vaut les masquer (comme les
  // placeholders "lead:") que d'afficher un nom générique trompeur. Une
  // conversation reste visible dès qu'AU MOINS un des autres membres se
  // résout à un nom réel — rien n'est supprimé en base.
  const hasOnlyUnresolvedMembers = (c: ConversationRow) => {
    if (c.title) return false;
    const others = (conversationMembers[c.id] || []).filter((u) => u !== currentUser?.uid);
    return others.length > 0 && others.every((u) => !profileByUid[u]);
  };

  const filteredConversations = conversations
    .filter((c) => !isRawLeadPlaceholder(c))
    .filter((c) => !hasOnlyUnresolvedMembers(c))
    .filter((c) => conversationLabel(c).toLowerCase().includes(convSearch.toLowerCase()));

  // Réactions + accusés de lecture pour un LOT de messages donné — factorisé
  // pour être réutilisé par loadConvMessages (lot récent) ET
  // loadOlderConvMessages (lot plus ancien, chargé à la demande).
  const loadReactionsAndReceiptsFor = async (rows: DirectMessageRow[], forConversationId?: string) => {
    if (rows.length === 0) return;
    const rowIds = rows.map((r) => r.id);
    // Perf (30/08/2026, signalé "18 secondes") : réactions et accusés de
    // lecture ne dépendent pas l'un de l'autre — chargés en parallèle (au
    // lieu de deux allers-retours en séquence).
    const [{ data: reactions }, { data: receipts }] = await Promise.all([
      supabase.from('message_reactions' as any).select('message_id, user_id, emoji').in('message_id', rowIds),
      supabase.from('message_receipts' as any).select('message_id, user_id, read_at').in('message_id', rowIds).not('read_at', 'is', null),
    ]);
    const grouped: Record<string, { userId: string; emoji: string }[]> = {};
    ((reactions ?? []) as any[]).forEach((r) => {
      (grouped[r.message_id] ||= []).push({ userId: r.user_id, emoji: r.emoji });
    });
    // Fusion (pas remplacement) : ne doit pas effacer les réactions déjà
    // connues des messages plus anciens chargés séparément (voir
    // loadOlderConvMessages) — reloadConvReactions (temps réel) reste la
    // source de vérité complète pour les suppressions de réaction.
    setConvReactions((prev) => ({ ...prev, ...grouped }));

    const readBy: Record<string, { userId: string; readAt?: string }[]> = {};
    ((receipts ?? []) as any[]).forEach((r) => {
      (readBy[r.message_id] ||= []).push({ userId: r.user_id, readAt: r.read_at });
    });
    setConvReadBy((prev) => ({ ...prev, ...readBy }));

    // Audit stabilité (20 octobre) : si ces lignes appartiennent à une
    // conversation qu'on a quittée entre-temps (sondage/pagination resté en
    // vol pendant un changement de conversation), ne pas les marquer "lu" —
    // l'utilisateur ne les a en réalité jamais vues affichées à l'écran.
    if (forConversationId && activeConversationIdRef.current !== forConversationId) return;

    // Accuse réception : tout message reçu (pas envoyé par moi) dans cette
    // conversation est marqué lu dès qu'on l'affiche à l'écran.
    // Ne retraite que les messages PAS ENCORE lus (readBy) — avant, on
    // ré-écrivait read_at pour TOUS les messages reçus à chaque appel, ce
    // qui, avec un sondage toutes les 4s, multipliait inutilement les
    // écritures en base pour des messages déjà lus depuis longtemps.
    if (currentUser) {
      const toMarkRead = rows.filter(
        (r) => r.user_id !== currentUser.uid && !(readBy[r.id] || []).some((x) => x.userId === currentUser.uid)
      );
      if (toMarkRead.length > 0) {
        // Perf : ces deux écritures (accusé de lecture + pastille de
        // notification) ne conditionnent plus rien à l'écran une fois
        // lancées — plus besoin de les attendre (elles partent en
        // parallèle) avant de considérer le lot "chargé".
        void Promise.all([
          supabase.from('message_receipts' as any).upsert(
            toMarkRead.map((r) => ({
              message_id: r.id,
              user_id: currentUser.uid,
              delivered_at: new Date().toISOString(),
              read_at: new Date().toISOString(),
            })),
            { onConflict: 'message_id,user_id' }
          ),
          // Bug remonté : lire un message ici ne mettait jamais à jour la
          // notification correspondante (`notifications.entity_id` =
          // l'id du message) — la pastille de la cloche et le badge de
          // l'accueil (comptés sur `notifications.is_read`) restaient
          // donc allumés indéfiniment même après lecture.
          supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', currentUser.uid)
            .eq('is_read', false)
            .in('entity_id', toMarkRead.map((r) => r.id)),
        ]);
      }
    }
  };

  const loadConvMessages = async (conversationId: string) => {
    // Perf (30/08/2026, signalé "plus de 10 secondes" + "classer des
    // antécédents") : on ne charge plus TOUTE la conversation (jusqu'à 300
    // messages, triés du plus ANCIEN — donc pas forcément les plus
    // récents sur un fil de 300+ messages) à chaque ouverture ET à chaque
    // sondage. Seul le lot le plus RÉCENT (RECENT_MESSAGES_PAGE) est
    // chargé ici ; le reste de l'historique reste en base, atteignable via
    // "Charger les messages précédents" (loadOlderConvMessages) plutôt que
    // systématiquement re-téléchargé et re-affiché.
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(RECENT_MESSAGES_PAGE);

    // Signalé (urgent, 30/08/2026) : "aucun message n'apparaît" — cause
    // trouvée : un échec de cette requête (réseau, limite momentanée...)
    // n'était JAMAIS distingué d'une conversation réellement vide, donc
    // `setConvMessages([])` effaçait la conversation affichée à chaque
    // appel en échec. Rendu bien plus probable par le sondage ajouté
    // juste avant (toutes les 4s au lieu de seulement à l'ouverture/au
    // temps réel) : un raté ponctuel, invisible avant, revenait désormais
    // vider l'écran en boucle. On ne touche plus à rien si la requête a
    // échoué — la liste précédente reste affichée, le prochain sondage ou
    // événement temps réel réessaiera.
    if (error) {
      console.warn('Erreur chargement messages de conversation :', error);
      return;
    }

    const rows = ((data as DirectMessageRow[]) || []).slice().reverse();
    // Fusion (pas remplacement) : l'ouverture d'une conversation vide
    // convMessages juste avant (voir openConversation), donc ceci ne fait
    // que rafraîchir le lot récent SANS effacer les messages plus anciens
    // déjà chargés via "Charger les messages précédents" pendant que la
    // conversation reste ouverte (le sondage toutes les 4s rappelle cette
    // même fonction).
    //
    // Signalé (20 octobre, « je suis sur la conversation de Laetitia et je
    // vois que c'est sur Natacha ») : fusionné jusqu'ici dans `prev`, l'état
    // AFFICHÉ au moment où cet appel se termine — partagé par toutes les
    // conversations, donc celui de la conversation qu'on a ouverte ENTRE-
    // TEMPS si cet appel (sondage, temps réel, chargement initial...) est
    // resté en vol pendant un changement de conversation. Base de fusion
    // reprise sur le cache PROPRE à `conversationId` (jamais partagé) ;
    // `convMessages` (l'affichage réel) n'est lui touché que si cette
    // conversation est encore celle à l'écran (activeConversationIdRef).
    const base = convMessagesCacheRef.current[conversationId] || [];
    const byId = new Map(base.map((m) => [m.id, m]));
    rows.forEach((m) => byId.set(m.id, m));

    // Signalé (31/08/2026) : "le message dans chat part deux fois".
    // Cette fusion par id a remplacé un remplacement pur de la liste ; or
    // `sendConvMessage` affiche d'abord un écho optimiste portant un id
    // provisoire (`optimistic-…`) qui ne correspondra JAMAIS à l'uuid de
    // la ligne réelle. Il n'était donc plus jamais retiré, et le message
    // restait affiché en double. Le correctif principal est dans
    // `sendConvMessage` (l'id provisoire y devient l'id réel dès la
    // réponse de la base) ; ce filet rattrape les cas où cette réponse
    // n'est jamais arrivée — perte de réseau juste après l'écriture.
    const reels = Array.from(byId.values()).filter((m) => !m.id.startsWith('optimistic-'));
    Array.from(byId.keys())
      .filter((id) => id.startsWith('optimistic-'))
      .forEach((id) => {
        const echo = byId.get(id)!;
        const couvert = reels.some(
          (r) => r.user_id === echo.user_id && r.kind === echo.kind && r.body === echo.body,
        );
        if (couvert) byId.delete(id);
      });

    const fusion = Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    // Toujours mis à jour, scopé par `conversationId` : au retour sur cette
    // conversation plus tard, elle doit refléter ce lot frais.
    convMessagesCacheRef.current[conversationId] = fusion;
    if (activeConversationIdRef.current === conversationId) {
      setConvMessages(fusion);
    }
    if (rows.length > 0) {
      await loadReactionsAndReceiptsFor(rows, conversationId);
    } else if (activeConversationIdRef.current === conversationId) {
      // Audit stabilité (20 octobre) : cette remise à zéro ne doit viser que
      // la conversation réellement affichée — sinon un appel resté en vol
      // pour une conversation A (devenue vide, ou dont tous les messages ont
      // été supprimés) pouvait effacer les réactions/accusés de lecture de
      // la conversation B affichée entre-temps.
      setConvReactions({});
      setConvReadBy({});
    }
  };

  // "Charger les messages précédents" : récupère le lot juste avant le plus
  // ancien message actuellement affiché et le préfixe à la liste.
  const loadOlderConvMessages = async () => {
    if (!activeConversationId || loadingOlderConv || convMessages.length === 0) return;
    // Audit stabilité (20 octobre) : même bug que loadConvMessages, jamais
    // couvert par son correctif — `activeConversationId` était relu tel
    // quel après l'attente réseau, qui reflète alors la conversation
    // ouverte à la RÉSOLUTION, pas celle pour laquelle la requête a été
    // lancée. Capturé une fois ici, comparé à activeConversationIdRef (la
    // conversation réellement affichée) avant de toucher à l'écran.
    const convIdAtCall = activeConversationId;
    const oldest = convMessages[0];
    setLoadingOlderConv(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', convIdAtCall)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(RECENT_MESSAGES_PAGE);
      if (error) {
        console.warn('Erreur chargement des messages précédents :', error);
        return;
      }
      const older = ((data as DirectMessageRow[]) || []).slice().reverse();
      if (older.length === 0) {
        if (activeConversationIdRef.current === convIdAtCall) setConvHasMoreOlder(false);
        return;
      }
      if (activeConversationIdRef.current === convIdAtCall) {
        // Cas normal (pas de changement de conversation entre-temps) :
        // fusion directe dans l'état affiché, comme avant.
        const fusion = [...older, ...convMessages];
        convMessagesCacheRef.current[convIdAtCall] = fusion;
        setConvHasMoreOlder(older.length === RECENT_MESSAGES_PAGE);
        setConvMessages(fusion);
      } else {
        // L'utilisateur a changé de conversation pendant le chargement :
        // on ne touche plus à l'écran (qui affiche déjà une AUTRE
        // conversation) — seul le cache de convIdAtCall est mis à jour,
        // pour qu'un retour dessus retrouve ces messages plus anciens.
        const base = convMessagesCacheRef.current[convIdAtCall] || [];
        convMessagesCacheRef.current[convIdAtCall] = [...older, ...base];
      }
      await loadReactionsAndReceiptsFor(older, convIdAtCall);
    } finally {
      setLoadingOlderConv(false);
    }
  };

  const openConversation = (id: string) => {
    setActiveConversationId(id);
    // Signalé (17/09/2026) : "on attend jusqu'à 5 secondes" — deux correctifs
    // conjoints :
    //  1) Affiche tout de suite le dernier lot connu de CETTE conversation
    //     (voir convMessagesCacheRef) au lieu de vider l'écran en attendant
    //     le round-trip réseau ; `loadConvMessages` rafraîchit ensuite en
    //     tâche de fond et met le cache à jour. Une conversation jamais
    //     ouverte cette session reste vide le temps du premier chargement,
    //     comme avant.
    //  2) `loadConvMessages(id)` n'est plus appelé ICI : l'effet plus bas
    //     (dépendances [activeConversationId, isActive]) le fait déjà dès
    //     que `activeConversationId` change — l'appeler aussi ici doublait
    //     systématiquement chaque ouverture (2x messages + 2x
    //     réactions/accusés de lecture, jusqu'à 6 requêtes au lieu de 3).
    setConvMessages(convMessagesCacheRef.current[id] || []);
    setConvHasMoreOlder(true);
  };

  // Signalé (urgent, 30/08/2026) : "elle ne sait pas d'où ça vient" —
  // certains push de message n'affichaient AUCUNE bannière. Cause : le
  // service worker (sw.js) ne pouvait juger "l'utilisateur regarde déjà
  // cette conversation" qu'en comparant des chemins d'URL, qui ne changent
  // jamais d'une conversation à l'autre dans cette SPA — il supprimait donc
  // la bannière dès que l'app était ouverte sur N'IMPORTE QUELLE
  // conversation. On informe maintenant le SW de la conversation
  // réellement affichée à l'écran (et qu'on n'en affiche plus aucune en
  // sortant), pour qu'il ne supprime la bannière QUE quand c'est vraiment
  // celle du nouveau message.
  useEffect(() => {
    const target = tab === 'conversations' ? activeConversationId : null;
    navigator.serviceWorker?.controller?.postMessage({ type: 'ACTIVE_CONVERSATION', conversationId: target });
    return () => {
      navigator.serviceWorker?.controller?.postMessage({ type: 'ACTIVE_CONVERSATION', conversationId: null });
    };
  }, [activeConversationId, tab]);

  // ── Rebond de 5s sur le message ciblé par une notification ──────────────
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  // Ouverture directe d'une conversation depuis une notification, quand
  // celle-ci ne désigne pas un message précis (voir initialConversationId).
  useEffect(() => {
    if (!initialConversationId) return;
    setTab('conversations');
    openConversation(initialConversationId);
    onConversationTargetConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  useEffect(() => {
    if (!initialHighlightMessageId) return;
    let cancelled = false;
    (async () => {
      // Perf (30/08/2026, signalé "18 secondes pour ouvrir la conversation
      // depuis une notification") : on ne sait pas d'avance si le message
      // visé est un message direct (`messages`) ou un message de canal
      // d'équipe (`chat_messages`) — les deux tables étaient interrogées
      // L'UNE APRÈS L'AUTRE (round-trip perdu à chaque notification de
      // canal, la moitié des cas). Indépendantes : interrogées en parallèle.
      const [{ data }, { data: channelMsg }] = await Promise.all([
        supabase.from('messages').select('conversation_id').eq('id', initialHighlightMessageId).maybeSingle(),
        supabase.from('chat_messages').select('channel').eq('id', initialHighlightMessageId).maybeSingle(),
      ]);
      if (cancelled) return;
      const convId = (data as any)?.conversation_id;
      if (convId) {
        setTab('conversations');
        openConversation(convId);
        setHighlightedMessageId(initialHighlightMessageId);
        onHighlightConsumed?.();
        setTimeout(() => setHighlightedMessageId((cur) => (cur === initialHighlightMessageId ? null : cur)), 5000);
        return;
      }

      const channelId = (channelMsg as any)?.channel;
      if (!channelId) {
        onHighlightConsumed?.();
        return;
      }
      const { data: channelRow } = await supabase
        .from('chat_channels')
        .select('*')
        .eq('id', channelId)
        .maybeSingle();
      if (cancelled) return;
      if (channelRow) {
        setTab('projets');
        setActiveChannel(channelRow as ChatChannel);
        // Signalé (15 octobre) : « le message ne se présente pas, il faut
        // aller à la cible » — pour un canal d'équipe uniquement. La branche
        // conversation juste au-dessus pose déjà highlightedMessageId ;
        // cette branche-ci ouvrait le bon canal mais ne le faisait jamais,
        // donc rien ne distinguait le message visé des autres (et voir plus
        // bas, le défilement auto vers le bas du canal l'emportait).
        setHighlightedMessageId(initialHighlightMessageId);
        setTimeout(() => setHighlightedMessageId((cur) => (cur === initialHighlightMessageId ? null : cur)), 5000);
      }
      onHighlightConsumed?.();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHighlightMessageId]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const el = document.getElementById(`msg-${highlightedMessageId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedMessageId, convMessages.length, messages.length]);

  // Rechargement ciblé des réactions seules (sans retoucher aux messages ni
  // aux accusés de lecture) — voir convMessageIdsRef plus haut.
  const reloadConvReactions = async () => {
    const ids = Array.from(convMessageIdsRef.current);
    if (ids.length === 0) return;
    const { data: reactions } = await supabase
      .from('message_reactions' as any)
      .select('message_id, user_id, emoji')
      .in('message_id', ids);
    const grouped: Record<string, { userId: string; emoji: string }[]> = {};
    ((reactions ?? []) as any[]).forEach((r) => {
      (grouped[r.message_id] ||= []).push({ userId: r.user_id, emoji: r.emoji });
    });
    // Audit stabilité (20 octobre) : remplaçait tout `convReactions` par les
    // seules réactions des ids capturés en début d'appel — un changement de
    // conversation pendant l'attente réseau (ids alors ceux de l'ANCIENNE
    // conversation) effaçait les réactions affichées de la conversation
    // actuelle. Fusion ciblée sur ces ids uniquement (id de message = unique
    // globalement, jamais partagé entre deux conversations) : tout le reste
    // de l'état, y compris celui d'une autre conversation, reste intact.
    setConvReactions((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        if (grouped[id]) next[id] = grouped[id];
        else delete next[id];
      });
      return next;
    });
  };

  useEffect(() => {
    // Audit stabilité (20 octobre) : ni isActive ni activeConversationId ne
    // tenaient compte du SOUS-onglet interne à Chat ('conversations' vs
    // 'projets', voir `tab`) — passer sur Projets sans fermer la
    // conversation laissait ce canal temps réel ET ce sondage 4s tourner
    // indéfiniment, EN PLUS de leurs équivalents côté canal d'équipe,
    // doublant pour rien les requêtes/abonnements pendant qu'on ne regarde
    // plus cette conversation.
    if (!activeConversationId || tab !== 'conversations') return;
    const channel = supabase
      .channel(`conversation_${activeConversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeConversationId}` },
        () => loadConvMessages(activeConversationId)
      )
      // Signalé lors d'un audit général : sans filtre serveur possible
      // (`message_reactions` n'a pas de conversation_id), on écoute toutes
      // les réactions et on ignore celles hors de cette conversation via
      // convMessageIdsRef — beaucoup plus léger qu'un rechargement complet
      // des messages pour un simple emoji.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const changedMessageId = (payload.new as any)?.message_id || (payload.old as any)?.message_id;
          if (changedMessageId && convMessageIdsRef.current.has(changedMessageId)) {
            void reloadConvReactions();
          }
        }
      )
      .subscribe();

    // Signalé (30/08/2026, urgent) : "il peut se passer 8 secondes" avant
    // qu'un message envoyé/reçu apparaisse — le temps réel Supabase seul
    // (WebSocket) peut ponctuellement traîner (reconnexion, replication
    // lag...) sans que rien ne le compense. Filet de sécurité par sondage,
    // même principe déjà éprouvé ailleurs dans l'appli (voir
    // useDashboardStats) : borne le pire cas à quelques secondes au lieu de
    // dépendre uniquement du temps réel.
    // Revu (30/08/2026, "on peut le laisser tourner en fond mais très léger,
    // maîtriser la consommation") : Chat reste maintenant monté en
    // permanence (voir isActive/App.tsx) même quand un autre module est
    // affiché — ce sondage 4s ne doit donc tourner que pendant qu'on
    // regarde VRAIMENT cette conversation, sinon il continuerait à
    // interroger la base toutes les 4s indéfiniment pour rien. Le canal
    // temps réel ci-dessus (écoute poussée, quasi gratuite) reste lui actif
    // même en arrière-plan, pour que l'essentiel soit déjà à jour au retour.
    let pollInterval: number | null = null;
    if (isActive) {
      loadConvMessages(activeConversationId);
      pollInterval = window.setInterval(() => {
        loadConvMessages(activeConversationId);
      }, 4000);
    }

    // Signalé (30/08/2026, "parfois 18 secondes") : le sondage 4s ci-dessus
    // ne suffisait pas dans un cas précis — onglet/appli en arrière-plan
    // (verrouillage d'écran, changement d'onglet/app). Les navigateurs
    // ralentissent alors fortement les `setInterval` en arrière-plan (throttling,
    // parfois plusieurs dizaines de secondes entre deux exécutions), alors
    // que la notification push, elle, passe par un canal OS séparé non
    // affecté — d'où l'écart observé ("l'autre utilisateur a bien reçu la
    // notification avant"). Un rafraîchissement immédiat dès que l'onglet
    // redevient visible/actif comble ce trou sans attendre le prochain tick
    // — seulement si Chat est le module réellement affiché (isActive).
    const handleVisible = () => {
      if (document.visibilityState === 'visible' && isActive) loadConvMessages(activeConversationId);
    };
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);

    return () => {
      supabase.removeChannel(channel);
      if (pollInterval) window.clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, isActive, tab]);

  // Ticket #9 (nouvelle base) : à l'ouverture d'une conversation le défilement
  // ne se produisait pas — un scrollTo immédiat tirait souvent avant que la
  // liste ait fini de se mettre en page (scrollHeight pas encore à jour).
  // Un rAF force le saut au prochain paint, puis un rattrapage après le
  // rendu complet (images) garantit qu'on atterrit bien tout en bas.
  useEffect(() => {
    // Signalé (10 septembre, Sylvain/Pauline) : « ça ne va pas dans le bon
    // message » en cliquant sur une notification. Cause trouvée : CET effet
    // (scroll-tout-en-bas, avec son propre rattrapage à 150ms conçu pour
    // gagner toute course de mise en page) et celui du rebond sur le message
    // ciblé plus haut (scrollIntoView, voir highlightedMessageId) dépendent
    // tous les deux de `convMessages.length` — ils se déclenchent donc sur
    // le MÊME rendu à l'ouverture d'une conversation depuis une
    // notification, et celui-ci, pensé pour être increvable, l'emportait
    // systématiquement : on atterrissait toujours en bas de la conversation
    // (le message le plus récent), jamais sur le message visé par la
    // notification s'il ne s'agissait pas déjà du dernier.
    if (highlightedMessageId) return;
    const pane = convScrollRef.current;
    if (!pane) return;
    const frame = window.requestAnimationFrame(() => {
      pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
    });
    const settle = window.setTimeout(() => {
      pane.scrollTo({ top: pane.scrollHeight, behavior: 'auto' });
    }, 150);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [convMessages.length, activeConversationId, highlightedMessageId]);

  const sendConvMessage = async () => {
    const body = convDraft.trim();
    if (!activeConversationId || !currentUser) return;
    if (!body) {
      // Audit (10 septembre, Sylvain → Natacha) : « le vocal n'est pas
      // parti, il a dû le refaire ». Cause trouvée : un vocal enregistré
      // reste en attente de réécoute (convVocalPret) jusqu'au clic sur le
      // bouton dédié de son aperçu — mais CE bouton-ci (composeur
      // principal) et la touche Entrée restent actifs pendant ce temps, et
      // ce garde-fou, écrit pour le texte, renvoyait alors silencieusement
      // sans rien envoyer ni prévenir : on a l'impression d'avoir appuyé
      // sur "Envoyer" pour rien. On fait maintenant réellement partir le
      // vocal en attente dans ce cas, au lieu de l'ignorer.
      if (convVocalPret) void envoyerVocalConv();
      return;
    }
    // Deux envois ne peuvent plus se chevaucher : `setConvDraft('')` ne prend
    // effet qu'au rendu suivant, donc deux appels dans le même tic lisaient
    // tous les deux le même brouillon et écrivaient deux fois en base
    // (Entrée maintenue enfoncée, clavier mobile qui répète l'événement,
    // double appui sur le bouton d'envoi...).
    if (sendingConvRef.current) return;
    sendingConvRef.current = true;
    setConvDraft('');

    // Signalé : le message met ~18s à apparaître, et le destinataire le
    // reçoit avant même que l'expéditeur ne le voie comme envoyé sur son
    // propre téléphone. Cause : l'expéditeur n'avait AUCUN affichage
    // optimiste — son propre message ne s'affichait qu'après l'aller-retour
    // complet du canal Realtime (postgres_changes → loadConvMessages), un
    // trajet qui peut traîner plusieurs secondes sur mobile (WebSocket mis
    // en veille en arrière-plan, changement de réseau...), alors que la
    // notification push du destinataire suit un circuit indépendant et
    // souvent plus rapide. On affiche donc le message immédiatement côté
    // expéditeur ; le rechargement Realtime qui suit remplace ensuite cet
    // état provisoire par la version réelle (id, accusés...).
    //
    // ATTENTION (31/08/2026) : ce remplacement ne va PAS de soi. Il tenait à
    // l'origine au fait que `loadConvMessages` réécrivait toute la liste ;
    // cette fonction fusionne désormais par id, et l'écho ci-dessous a
    // justement un id qui n'existe pas en base — d'où le message affiché en
    // double, signalé. C'est la reprise de l'id réel, plus bas, qui rend le
    // remplacement effectif. Ne pas la retirer.
    const optimisticId = `optimistic-${Date.now()}`;
    setConvMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        conversation_id: activeConversationId,
        user_id: currentUser.uid,
        kind: 'text',
        body,
        attachment_url: null,
        attachment_mime: null,
        attachment_duration: null,
        edited_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    let inserted: { id?: string } | null = null;
    let error: unknown = null;
    try {
      const res = await supabase
        .from('messages')
        .insert({
          conversation_id: activeConversationId,
          user_id: currentUser.uid,
          kind: 'text',
          body,
        } as any)
        .select('id')
        .single();
      inserted = res.data as { id?: string } | null;
      error = res.error;
    } catch (e) {
      // Réseau coupé en plein envoi : sans ce filet, le verrou resterait
      // fermé et plus AUCUN message ne pourrait partir jusqu'au rechargement
      // de la page.
      error = e;
    }

    if (error) {
      // L'envoi a échoué : on retire l'écho optimiste et on restaure le
      // brouillon pour ne pas faire croire que le message est parti.
      setConvMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setConvDraft(body);
      sendingConvRef.current = false;
      return;
    }

    // L'écho provisoire prend immédiatement l'identifiant réel renvoyé par
    // la base. La fusion de `loadConvMessages` le reconnaît alors et le
    // remplace au lieu d'ajouter une seconde copie à côté — c'est ce qui
    // faisait apparaître chaque message en double.
    const realId = inserted?.id;
    if (realId) {
      setConvMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, id: realId } : m)));
    } else {
      setConvMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    }
    sendingConvRef.current = false;

    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', activeConversationId);
    loadConversations(true);
    // le push est géré côté base (voir note ci-dessous)

    // Ticket #12 (nouvelle base, correctif) : un déclencheur existe déjà
    // côté base pour envoyer le push à la réception d'un message — l'appel
    // ajouté ici en plus créait un DOUBLON (deux notifications pour un seul
    // message, signalé). Retiré : le vrai problème (mauvaise URL) est
    // maintenant corrigé directement dans l'edge function send-push, qui
    // reconstruit l'URL à partir de conversation_id/message_id même quand
    // l'appelant (le déclencheur base) ne la précise pas.
  };

  const handleToggleConvReaction = async (messageId: string, emoji: string) => {
    if (!currentUser) return;
    const existing = (convReactions[messageId] || []).find((r) => r.userId === currentUser.uid);
    setShowConvReactionPickerFor(null);
    // Signalé (10 septembre, Sylvain → Natacha, sur ordinateur) : « je mets
    // un pouce et rien ». Deux causes trouvées :
    // 1. L'erreur de l'upsert/delete n'était jamais lue (`await ...` sans
    //    récupérer `error`) — un refus RLS ou réseau ne faisait RIEN
    //    apparaître, ni la pastille, ni le moindre message.
    // 2. La pastille n'apparaissait qu'après le `loadConvMessages` complet
    //    (tout le lot de messages récents rechargé) : sur une connexion
    //    lente ce délai pouvait donner l'impression que le clic n'avait rien
    //    fait. Mise à jour optimiste de `convReactions` en plus du rechargement,
    //    annulée si la requête échoue réellement.
    const previous = convReactions[messageId] || [];
    const optimistic = existing
      ? existing.emoji === emoji
        ? previous.filter((r) => r.userId !== currentUser.uid)
        : previous.map((r) => (r.userId === currentUser.uid ? { ...r, emoji } : r))
      : [...previous, { userId: currentUser.uid, emoji }];
    setConvReactions((v) => ({ ...v, [messageId]: optimistic }));
    const { error } =
      existing && existing.emoji === emoji
        ? await supabase.from('message_reactions' as any).delete().eq('message_id', messageId).eq('user_id', currentUser.uid)
        : await supabase.from('message_reactions' as any).upsert(
            { message_id: messageId, user_id: currentUser.uid, emoji } as any,
            { onConflict: 'message_id,user_id' }
          );
    if (error) {
      setConvReactions((v) => ({ ...v, [messageId]: previous }));
      toast.error("La réaction n'a pas pu être enregistrée.");
      return;
    }
    if (activeConversationId) loadConvMessages(activeConversationId);
  };

  const handleSaveEditConvMsg = async (messageId: string) => {
    const body = editingConvMsgText.trim();
    if (!body) return;
    await supabase.from('messages').update({ body, edited_at: new Date().toISOString() } as any).eq('id', messageId);
    setEditingConvMsgId(null);
    setEditingConvMsgText('');
    if (activeConversationId) loadConvMessages(activeConversationId);
  };

  const handleDeleteConvMsg = async (messageId: string) => {
    if (!confirm('Supprimer ce message ?')) return;
    // Signalé (11 septembre, Sylvain) : « impossible de le supprimer quand
    // il est envoyé ». L'erreur éventuelle du `.delete()` n'était jamais
    // lue — un refus (RLS, réseau) ne faisait rien apparaître ni disparaître,
    // sans le moindre message. Retrait optimiste de l'affichage en plus
    // (au lieu de dépendre du rechargement complet pour le faire
    // disparaître), annulé si la suppression échoue réellement.
    const before = convMessages;
    setConvMessages((v) => v.filter((msg) => msg.id !== messageId));
    const { error } = await supabase.from('messages').delete().eq('id', messageId);
    if (error) {
      setConvMessages(before);
      toast.error("La suppression a échoué : " + error.message);
      return;
    }
    if (activeConversationId) loadConvMessages(activeConversationId);
  };

  // Réactions sur un message de canal — même principe que
  // handleToggleConvReaction, mais stocké directement sur la ligne
  // (chat_messages.reactions, JSONB) plutôt que dans une table à part : pas
  // de rechargement séparé nécessaire, la mise à jour optimiste EST l'état
  // final, annulée si l'écriture échoue réellement.
  const handleToggleChannelReaction = async (messageId: string, emoji: string) => {
    if (!currentUser) return;
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;
    const previous = target.reactions || [];
    const existing = previous.find((r) => r.userId === currentUser.uid);
    setShowChannelReactionPickerFor(null);
    const nextReactions = existing
      ? existing.emoji === emoji
        ? previous.filter((r) => r.userId !== currentUser.uid)
        : previous.map((r) => (r.userId === currentUser.uid ? { ...r, emoji } : r))
      : [...previous, { userId: currentUser.uid, emoji }];
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: nextReactions } : m)));
    const { error } = await supabase.from('chat_messages').update({ reactions: nextReactions } as any).eq('id', messageId);
    if (error) {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: previous } : m)));
      toast.error("La réaction n'a pas pu être enregistrée.");
    }
  };

  // Demande explicite (30/08/2026) : mêmes actions modifier/supprimer que
  // ci-dessus, pour les canaux d'équipe (table `chat_messages`, contenu
  // texte dans la colonne JSONB `data.body` — voir ChatMessageRow plus haut
  // — donc on fusionne le body modifié dans le `data` existant plutôt que
  // de l'écraser, pour ne pas perdre sender_id/sender_name/created_at).
  const handleSaveEditChannelMsg = async (messageId: string) => {
    const body = editingChannelMsgText.trim();
    if (!body) return;
    const target = messages.find((m) => m.id === messageId);
    await supabase.from('chat_messages').update({ data: { ...(target?.data || {}), body } } as any).eq('id', messageId);
    setEditingChannelMsgId(null);
    setEditingChannelMsgText('');
    if (activeChannel) loadMessages(activeChannel.id);
  };

  // Suppression : l'auteur du message (mine, voir le rendu plus bas) OU un
  // admin/super_admin peuvent supprimer — vérifié aussi côté rendu (bouton
  // affiché seulement si autorisé), ici c'est la confirmation + l'appel.
  const handleDeleteChannelMsg = async (messageId: string) => {
    if (!confirm('Supprimer ce message ?')) return;
    // Même correctif que handleDeleteConvMsg ci-dessus.
    const before = messages;
    setMessages((v) => v.filter((msg) => msg.id !== messageId));
    const { error } = await supabase.from('chat_messages').delete().eq('id', messageId);
    if (error) {
      setMessages(before);
      toast.error("La suppression a échoué : " + error.message);
      return;
    }
    if (activeChannel) loadMessages(activeChannel.id);
  };

  // ── Image / emoji / vocal dans une conversation directe ──────────────────
  // Ticket #10 (nouvelle base, correctif d'origine) : la palette à 48
  // restait perçue comme trop limitée — passée à un grand choix (plus de
  // 200, organisé par thème) avec défilement.
  // Revu (30/08/2026, demande explicite) : "mets les 20 plus [utilisés] que
  // la planète utilise mais pas plus" — retour en arrière volontaire sur le
  // point ci-dessus, la grande palette gênait plus qu'elle n'aidait. Liste
  // resserrée aux 20 emojis les plus utilisés au monde (classements
  // Unicode Consortium / réseaux sociaux, stables dans le temps), classés
  // par fréquence décroissante. Les mascottes Nova, elles, restent
  // accessibles via leur propre bouton dédié juste à côté (voir
  // showConvNovaPicker/showChannelNovaPicker plus bas) — jamais fusionnées
  // ici : ce picker insère l'emoji tel quel DANS le texte du message, une
  // image Nova s'y afficherait comme un chemin de fichier illisible (voir
  // aussi le commentaire sur REACTION_EMOJIS juste en dessous, qui lui
  // affiche bien Nova car il s'agit d'une pastille-image, pas de texte).
  const QUICK_EMOJIS = [
    '😂', '❤️', '🤣', '👍', '😭', '🙏', '😘', '🥰', '😍', '😊',
    '🎉', '😁', '💕', '🥺', '😅', '🔥', '☺️', '😉', '👏', '💯',
  ];
  // Suite #240 : réservé aux RÉACTIONS (pastille attachée à un message),
  // où une image peut être affichée normalement — jamais pour insérer un
  // emoji DANS le texte (QUICK_EMOJIS ci-dessus), où un chemin de fichier
  // Nova s'insérerait comme du texte brut illisible. Nova en tête, "les
  // vrais" emojis ensuite.
  const REACTION_EMOJIS = [...NOVA_QUICK_REACTIONS, ...QUICK_EMOJIS];
  const [showConvEmoji, setShowConvEmoji] = useState(false);
  // Demande explicite : bouton dédié dans la barre de saisie (entre le
  // smiley et le micro) pour envoyer directement une mini-expression Nova
  // comme message image, sans passer par une réaction sur un message déjà
  // envoyé.
  const [showConvNovaPicker, setShowConvNovaPicker] = useState(false);
  // Signalé (30/08/2026) : "quand on clique sur l'icône [emoji], la fenêtre
  // reste activée tant qu'on ne reclique pas sur l'icône. On doit cliquer
  // ailleurs" — même bug que showConvReactionPickerFor plus haut (déjà
  // corrigé), mais sur les 4 AUTRES sélecteurs (emoji + Nova, canaux ET
  // conversations directes) qui n'avaient encore aucune fermeture au clic
  // extérieur. Même mécanisme (écoute `mousedown` en phase de capture,
  // indépendante du positionnement CSS) regroupé ici en un seul effet pour
  // les 4 plutôt que 4 quasi-identiques.
  const channelEmojiRef = useRef<HTMLDivElement | null>(null);
  const channelNovaPickerRef = useRef<HTMLDivElement | null>(null);
  const convEmojiRef = useRef<HTMLDivElement | null>(null);
  const convNovaPickerRef = useRef<HTMLDivElement | null>(null);
  // Bouton « + » du téléphone — demandé (4 septembre) : « comme sur les
  // téléphones, une barre beaucoup plus grande, et un + qui ouvre une fenêtre
  // pour choisir des options ». Sur téléphone, les trois boutons de gauche
  // (photo, émoticônes, Nova) laissent la place à ce seul bouton, ce qui
  // dégage la barre de saisie ; sur ordinateur, où la place ne manque pas,
  // les trois boutons restent exactement où ils sont.
  const [showChannelPlus, setShowChannelPlus] = useState(false);
  const [showConvPlus, setShowConvPlus] = useState(false);
  // Message dont les outils (réagir / modifier / supprimer) sont ouverts sur
  // écran tactile — voir classesOutilsMessage / gestesMessage plus bas.
  const [messageOutilsFor, setMessageOutilsFor] = useState<string | null>(null);
  const appuiMessageRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // Fermeture animée de la feuille du « + » : on laisse l'animation de
  // sortie se jouer avant de retirer la feuille du document. Une seule à la
  // fois (canal OU conversation, jamais les deux à l'écran), d'où un seul
  // indicateur partagé.
  const [feuilleQuitte, setFeuilleQuitte] = useState(false);
  const minuteurFeuille = useRef<number | null>(null);
  const fermerFeuille = (fermer: () => void) => {
    setFeuilleQuitte(true);
    if (minuteurFeuille.current) window.clearTimeout(minuteurFeuille.current);
    minuteurFeuille.current = window.setTimeout(() => {
      fermer();
      setFeuilleQuitte(false);
      minuteurFeuille.current = null;
    }, 200);
  };
  useEffect(() => () => { if (minuteurFeuille.current) window.clearTimeout(minuteurFeuille.current); }, []);
  // Prise de photo directe : même chemin que la photothèque (le fichier
  // choisi passe par le même gestionnaire), seul l'attribut `capture` change,
  // qui demande au téléphone d'ouvrir l'appareil photo plutôt que la galerie.
  const channelCameraInputRef = useRef<HTMLInputElement>(null);
  const channelFileInputRef = useRef<HTMLInputElement>(null);
  const channelVideoInputRef = useRef<HTMLInputElement>(null);
  const convCameraInputRef = useRef<HTMLInputElement>(null);
  // Zones de saisie qui grandissent avec le texte : la hauteur est remise à
  // zéro puis recalée sur le contenu à chaque frappe (une zone de texte ne
  // sait pas le faire seule), plafonnée pour ne pas manger l'écran — au-delà,
  // elle défile. Remis à une ligne quand le message part, sinon la zone
  // resterait haute et vide.
  const convTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const channelTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Signalé (9 septembre, capture à l'appui) : « on ne peut pas mieux taper
  // les SMS » sur mobile — le plafond de hauteur était le même sur mobile
  // que sur desktop, alors qu'un écran de téléphone masque déjà la moitié
  // de l'écran avec le clavier : quelques lignes visibles seulement avant
  // que ça défile. Relevé sur mobile uniquement (desktop inchangé).
  const isMobileSaisie = useIsMobile();
  const HAUTEUR_MAX_SAISIE = isMobileSaisie ? 220 : 132;
  const ajusterHauteur = (zone: HTMLTextAreaElement | null) => {
    if (!zone) return;
    zone.style.height = 'auto';
    zone.style.height = `${Math.min(zone.scrollHeight, HAUTEUR_MAX_SAISIE)}px`;
    zone.style.overflowY = zone.scrollHeight > HAUTEUR_MAX_SAISIE ? 'auto' : 'hidden';
  };
  useEffect(() => { ajusterHauteur(convTextareaRef.current); }, [convDraft]);
  useEffect(() => { ajusterHauteur(channelTextareaRef.current); }, [draft]);
  // Envoi différé — demande explicite : pouvoir programmer un message pour
  // plus tard au lieu de l'envoyer tout de suite, dans un canal comme dans
  // une conversation directe. Même mécanisme de popover (fermeture au clic
  // extérieur) que les sélecteurs Nova/emoji juste au-dessus. La table
  // `scheduled_messages` existait déjà en base (jamais utilisée par aucun
  // code) ; la livraison réelle se fait côté serveur, voir
  // supabase/functions/run-automations/index.ts (runScheduledMessages,
  // ~toutes les 15 min).
  const [showChannelSchedule, setShowChannelSchedule] = useState(false);
  const [showConvSchedule, setShowConvSchedule] = useState(false);
  const channelScheduleRef = useRef<HTMLDivElement | null>(null);
  const convScheduleRef = useRef<HTMLDivElement | null>(null);
  const [channelScheduleDate, setChannelScheduleDate] = useState('');
  const [channelScheduleTime, setChannelScheduleTime] = useState('');
  const [convScheduleDate, setConvScheduleDate] = useState('');
  const [convScheduleTime, setConvScheduleTime] = useState('');
  const [channelScheduled, setChannelScheduled] = useState<MessageProgramme[]>([]);
  const [convScheduled, setConvScheduled] = useState<MessageProgramme[]>([]);
  useEffect(() => {
    if (!showChannelEmoji && !showChannelNovaPicker && !showConvEmoji && !showConvNovaPicker && !showChannelSchedule && !showConvSchedule) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showChannelEmoji && channelEmojiRef.current && !channelEmojiRef.current.contains(target)) setShowChannelEmoji(false);
      if (showChannelNovaPicker && channelNovaPickerRef.current && !channelNovaPickerRef.current.contains(target)) setShowChannelNovaPicker(false);
      if (showConvEmoji && convEmojiRef.current && !convEmojiRef.current.contains(target)) setShowConvEmoji(false);
      if (showConvNovaPicker && convNovaPickerRef.current && !convNovaPickerRef.current.contains(target)) setShowConvNovaPicker(false);
      if (showChannelSchedule && channelScheduleRef.current && !channelScheduleRef.current.contains(target)) setShowChannelSchedule(false);
      if (showConvSchedule && convScheduleRef.current && !convScheduleRef.current.contains(target)) setShowConvSchedule(false);
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => document.removeEventListener('mousedown', handleOutsideClick, true);
  }, [showChannelEmoji, showChannelNovaPicker, showConvEmoji, showConvNovaPicker, showChannelSchedule, showConvSchedule]);
  // Recharge la liste des messages en attente à chaque changement de canal
  // ou de conversation active (et après programmation/annulation, voir plus
  // bas) — jamais partagée entre les deux, comme le reste de cet écran.
  const chargerMessagesProgrammes = async (colonne: 'channel_id' | 'conversation_id', id: string): Promise<MessageProgramme[]> => {
    const { data } = await supabase
      .from('scheduled_messages' as any)
      .select('id, body, scheduled_at')
      .eq(colonne, id)
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true });
    return (data as MessageProgramme[] | null) || [];
  };
  useEffect(() => {
    if (!activeChannel?.id) { setChannelScheduled([]); return; }
    void chargerMessagesProgrammes('channel_id', activeChannel.id).then(setChannelScheduled);
  }, [activeChannel?.id]);
  useEffect(() => {
    if (!activeConversationId) { setConvScheduled([]); return; }
    void chargerMessagesProgrammes('conversation_id', activeConversationId).then(setConvScheduled);
  }, [activeConversationId]);

  /**
   * Livraison des messages programmés arrivés à échéance, depuis l'application
   * elle-même.
   *
   * Signalé trois fois : « le message différé ne part pas ». La livraison
   * d'origine dépendait d'un service EXTERNE censé appeler Supabase toutes les
   * 15 minutes, que rien dans le dépôt ne configure et dont on ne peut pas
   * vérifier l'existence depuis l'application. Une migration SQL remet cette
   * livraison dans la base (voir 20260904160000), mais elle demande une action
   * manuelle : tant qu'elle n'est pas passée, rien ne part.
   *
   * Ici, aucune installation n'est nécessaire : dès que le chat est ouvert, on
   * envoie ses PROPRES messages dus. Chaque ligne est d'abord réservée en la
   * supprimant (voir le détail plus bas : c'est la seule écriture que les
   * règles d'accès autorisent au client) ; celui qui reçoit la ligne effacée
   * est le seul à l'avoir prise, donc jamais deux fois le même message, même
   * avec le téléphone et l'ordinateur ouverts en même temps. Si l'envoi échoue
   * ensuite, la ligne est réinscrite à l'identique avec sa raison : rien n'est
   * perdu, le passage suivant réessaie.
   *
   * Limite assumée : ça ne part que si quelqu'un a le chat ouvert. La migration
   * SQL reste le moyen de le rendre complètement autonome.
   */
  const livrerMesMessagesProgrammes = async () => {
    if (!currentUser) return;
    const { data: dues } = await supabase
      .from('scheduled_messages' as any)
      .select('id, body, channel_id, conversation_id')
      .eq('user_id', currentUser.uid)
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString());

    const lignes = (dues as any[]) || [];
    if (lignes.length === 0) return;

    let livres = 0;
    for (const ligne of lignes) {
      // Réservation par SUPPRESSION, et non par passage à « envoyé ».
      //
      // La règle d'accès écrite ce matin (migration 20260904090000) interdit
      // explicitement au client de faire passer un message programmé de
      // `pending` à `sent` — sa clause `with check` exige que la ligne reste
      // `pending` après écriture. C'était volontaire : seule la fonction
      // serveur devait faire cette transition. Une réservation par mise à jour
      // serait donc refusée, et en silence.
      //
      // Supprimer une de ses propres lignes en attente, en revanche, est
      // permis (c'est ce que fait déjà le bouton « annuler »). La suppression
      // renvoie la ligne effacée : celui qui la reçoit est le seul à l'avoir
      // prise, ce qui donne exactement la réservation atomique recherchée.
      // Compatible avec la livraison en base : elle verrouille la ligne, donc
      // les deux ne peuvent pas la traiter ensemble.
      const { data: prise } = await supabase
        .from('scheduled_messages' as any)
        .delete()
        .eq('id', ligne.id)
        .eq('status', 'pending')
        .select('id, body, channel_id, conversation_id, user_id, scheduled_at, kind');
      const reservee = ((prise as any[]) || [])[0];
      if (!reservee) continue;

      let erreur: string | null = null;

      if (ligne.conversation_id) {
        const { error } = await supabase.from('messages').insert({
          conversation_id: ligne.conversation_id,
          user_id: currentUser.uid,
          kind: 'text',
          body: ligne.body,
        } as any);
        erreur = error?.message ?? null;
        if (!erreur) {
          await supabase.from('conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', ligne.conversation_id);
        }
      } else if (ligne.channel_id) {
        const messageId = crypto.randomUUID();
        const { error } = await supabase.from('chat_messages').insert({
          id: messageId,
          channel: ligne.channel_id,
          sender_id: currentUser.uid,
          is_deleted: false,
          read_by: [{ userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
          data: {
            body: ligne.body,
            sender_id: currentUser.uid,
            sender_name: displayName,
            created_at: new Date().toISOString(),
          },
        } as any);
        erreur = error?.message ?? null;
        if (!erreur) {
          await supabase.from('chat_channels')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', ligne.channel_id);
          // Même notification que pour un message envoyé à la main : aucun
          // déclencheur n'existe sur `chat_messages`, contrairement à
          // `messages` (conversations directes), où la base s'en charge.
          const { data: canal } = await supabase
            .from('chat_channels').select('*').eq('id', ligne.channel_id).maybeSingle();
          if (canal) await notifierMembresDuDossier(canal as ChatChannel, ligne.body, messageId);
        }
      } else {
        erreur = 'Ni canal ni conversation.';
      }

      if (erreur) {
        // L'envoi a échoué après la réservation : on remet la ligne telle
        // qu'elle était, pour que rien ne soit perdu et que le passage suivant
        // réessaie. Et on le dit, au lieu d'échouer en silence.
        await supabase.from('scheduled_messages' as any).insert({
          id: reservee.id,
          user_id: reservee.user_id,
          channel_id: reservee.channel_id,
          conversation_id: reservee.conversation_id,
          body: reservee.body,
          kind: reservee.kind ?? 'text',
          scheduled_at: reservee.scheduled_at,
          status: 'pending',
          error: erreur,
        });
        toast.error(`Message programmé non envoyé : ${erreur}`);
      } else {
        livres++;
      }
    }

    if (livres > 0) {
      toast.success(livres > 1 ? `${livres} messages programmés envoyés.` : 'Message programmé envoyé.');
      if (activeChannel?.id) setChannelScheduled(await chargerMessagesProgrammes('channel_id', activeChannel.id));
      if (activeConversationId) setConvScheduled(await chargerMessagesProgrammes('conversation_id', activeConversationId));
      loadConversations(true);
      if (activeConversationId) loadConvMessages(activeConversationId);
      if (activeChannel?.id) loadMessages(activeChannel.id);
    }
  };

  // Le minuteur appelle toujours la dernière version de la fonction : sans
  // cette référence, il resterait figé sur la conversation ouverte au moment
  // où il a démarré, et le rafraîchissement d'écran viserait à côté.
  const livrerRef = useRef(livrerMesMessagesProgrammes);
  useEffect(() => { livrerRef.current = livrerMesMessagesProgrammes; });
  useEffect(() => {
    const passage = () => { void livrerRef.current(); };
    passage();
    const minuteur = setInterval(passage, 60000);
    return () => clearInterval(minuteur);
  }, []);
  // Combine les deux champs (date + heure) du popover en horodatage ISO —
  // null si incomplet ou déjà passé (le serveur n'enverrait de toute façon
  // jamais un message "programmé" dans le passé).
  const combinerDateHeure = (date: string, heure: string): string | null => {
    if (!date || !heure) return null;
    const iso = new Date(`${date}T${heure}:00`);
    if (Number.isNaN(iso.getTime()) || iso.getTime() <= Date.now()) return null;
    return iso.toISOString();
  };
  const formaterEcheance = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const annulerMessageProgramme = async (id: string, contexte: 'channel' | 'conversation') => {
    await supabase.from('scheduled_messages' as any).delete().eq('id', id);
    if (contexte === 'channel') setChannelScheduled((prev) => prev.filter((m) => m.id !== id));
    else setConvScheduled((prev) => prev.filter((m) => m.id !== id));
    toast.info('Message programmé annulé.');
  };
  const programmerMessageCanal = async () => {
    if (!draft.trim() || !activeChannel || !currentUser) return;
    const scheduledAt = combinerDateHeure(channelScheduleDate, channelScheduleTime);
    if (!scheduledAt) { toast.error('Choisissez une date et une heure dans le futur.'); return; }
    const body = draft.trim();
    const { error } = await supabase
      .from('scheduled_messages' as any)
      .insert({ user_id: currentUser.uid, channel_id: activeChannel.id, body, scheduled_at: scheduledAt });
    if (error) { toast.error(`Programmation impossible : ${error.message}`); return; }
    setDraft('');
    setShowChannelSchedule(false);
    setChannelScheduleDate('');
    setChannelScheduleTime('');
    setChannelScheduled(await chargerMessagesProgrammes('channel_id', activeChannel.id));
    toast.success(`Message programmé pour le ${formaterEcheance(scheduledAt)}.`);
  };
  const programmerMessageConversation = async () => {
    const body = convDraft.trim();
    if (!body || !activeConversationId || !currentUser) return;
    const scheduledAt = combinerDateHeure(convScheduleDate, convScheduleTime);
    if (!scheduledAt) { toast.error('Choisissez une date et une heure dans le futur.'); return; }
    const { error } = await supabase
      .from('scheduled_messages' as any)
      .insert({ user_id: currentUser.uid, conversation_id: activeConversationId, body, scheduled_at: scheduledAt });
    if (error) { toast.error(`Programmation impossible : ${error.message}`); return; }
    setConvDraft('');
    setShowConvSchedule(false);
    setConvScheduleDate('');
    setConvScheduleTime('');
    setConvScheduled(await chargerMessagesProgrammes('conversation_id', activeConversationId));
    toast.success(`Message programmé pour le ${formaterEcheance(scheduledAt)}.`);
  };
  // Demande explicite (11 septembre) : « dans le [menu] plus, rajoute la
  // dictée vocale » — DIFFÉRENT du message vocal (bouton micro rouge
  // ci-dessous, qui ENREGISTRE et ENVOIE un fichier audio) : ici la voix est
  // transcrite en TEXTE, directement dans le champ de saisie, comme le
  // clavier du téléphone. Même moteur (Web Speech API) et même assemblage
  // anti-répétition que la dictée déjà en place dans les notes client (voir
  // src/lib/dictee.ts, assemblerDictee — bug d'origine : Android répète la
  // phrase à chaque mot ajouté si on la concatène naïvement).
  const [isListeningConv, setIsListeningConv] = useState(false);
  const [isListeningChannel, setIsListeningChannel] = useState(false);
  const recognitionConvRef = useRef<any>(null);
  const recognitionChannelRef = useRef<any>(null);
  const toggleDictee = (
    enCours: boolean,
    setEnCours: (v: boolean) => void,
    recognitionRef: React.MutableRefObject<any>,
    texteActuel: string,
    setTexte: (v: string) => void,
  ) => {
    const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      toast.error("La dictée vocale n'est pas disponible sur ce navigateur.");
      return;
    }
    if (enCours) {
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      setEnCours(false);
      return;
    }
    try {
      const recognition = new SpeechRecognitionApi();
      recognition.lang = 'fr-FR';
      recognition.continuous = true;
      recognition.interimResults = true;
      const texteDeBase = texteActuel.trim();
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        setTexte(assemblerDictee(event.results, texteDeBase));
      };
      recognition.onerror = () => setEnCours(false);
      recognition.onend = () => setEnCours(false);
      recognition.start();
      recognitionRef.current = recognition;
      setEnCours(true);
    } catch {
      setEnCours(false);
    }
  };

  const [isRecordingConv, setIsRecordingConv] = useState(false);
  const [recordingConvSeconds, setRecordingConvSeconds] = useState(0);
  // Même attente avant envoi que côté canal — voir le commentaire sur
  // `channelVocalPret` plus haut.
  const [convVocalPret, setConvVocalPret] = useState<{ dataUrl: string; duree: number } | null>(null);
  const [uploadingConvMedia, setUploadingConvMedia] = useState(false);
  const convImageInputRef = useRef<HTMLInputElement>(null);
  const convFileInputRef = useRef<HTMLInputElement>(null);
  const convVideoInputRef = useRef<HTMLInputElement>(null);
  const convMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const convAudioChunksRef = useRef<Blob[]>([]);
  const convRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Audit stabilité (20 octobre) : un enregistrement vocal (canal ou
  // conversation) en cours n'était jamais arrêté si l'utilisateur quittait
  // Chat (navigation ailleurs dans le CRM, déconnexion...) pendant qu'il
  // parlait — ni handleStopRecordingChannel/Conv ni aucun autre code ne
  // s'exécute au démontage. Le micro restait alors capturé indéfiniment
  // (indicateur navigateur allumé en permanence, aucun moyen de l'éteindre
  // sans recharger l'onglet) : fuite mémoire ET problème de confidentialité
  // dans un CRM. Filet de secours au démontage : coupe les deux pistes
  // micro et les deux minuteurs s'ils tournent encore, sans tenter de
  // finaliser/envoyer l'enregistrement en cours (il n'y a plus d'écran pour
  // le proposer à la réécoute).
  useEffect(() => {
    return () => {
      if (channelRecordingTimerRef.current) clearInterval(channelRecordingTimerRef.current);
      const canalRecorder = channelMediaRecorderRef.current;
      if (canalRecorder && canalRecorder.state !== 'inactive') {
        try { canalRecorder.stop(); } catch { /* déjà arrêté */ }
        canalRecorder.stream.getTracks().forEach((t) => t.stop());
      }
      if (convRecordingTimerRef.current) clearInterval(convRecordingTimerRef.current);
      const convRecorder = convMediaRecorderRef.current;
      if (convRecorder && convRecorder.state !== 'inactive') {
        try { convRecorder.stop(); } catch { /* déjà arrêté */ }
        convRecorder.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  /**
   * Renvoie `null` si l'insertion a réussi, sinon le message d'erreur de la
   * base. Les appelants historiques (image, Novadji) ignorent ce retour et se
   * comportent comme avant ; l'envoi d'un vocal, lui, s'en sert pour prévenir
   * plutôt que de perdre l'enregistrement en silence.
   */
  const insertConvMessage = async (
    kind: 'image' | 'voice' | 'file' | 'video',
    attachmentUrl: string,
    attachmentDuration?: number,
    attachmentMime?: string,
    fileName?: string
  ): Promise<string | null> => {
    if (!activeConversationId || !currentUser) return 'Conversation introuvable.';
    // Audit (10 septembre) : cet insert n'avait pas le filet try/catch que
    // sendConvMessage a (voir son commentaire "Réseau coupé en plein
    // envoi") — une coupure réseau ici levait une exception au lieu de
    // renvoyer { error }, qui ressortait comme un rejet de promesse jamais
    // rattrapé (l'appelant n'a pas de .catch) : le bouton "Envoyer"
    // semblait n'avoir rien fait, sans le moindre message d'erreur.
    let error: { message: string } | null = null;
    try {
      const res = await supabase.from('messages').insert({
        conversation_id: activeConversationId,
        user_id: currentUser.uid,
        kind,
        body: fileName ?? null,
        attachment_url: attachmentUrl,
        attachment_mime: attachmentMime ?? null,
        attachment_duration: attachmentDuration ?? null,
      } as any);
      error = res.error;
    } catch (e) {
      error = { message: (e as Error)?.message || "Erreur réseau pendant l'envoi." };
    }
    if (error) return error.message;
    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', activeConversationId);
    loadConversations(true);
    if (activeConversationId) loadConvMessages(activeConversationId);
    return null;
  };

  const handleConvImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      setUploadingConvMedia(true);
      try {
        await insertConvMessage('image', dataUrl);
      } finally {
        setUploadingConvMedia(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Envoi d'un PDF dans une conversation directe — demandé le 5 octobre
  // (« je veux avoir la possibilité d'intégrer des pdfs dans les
  // messages »). Même mécanique que l'image (data URL rangée directement
  // dans `attachment_url`, pas d'upload Storage séparé) : le rendu du
  // message (`m.kind === 'file'`) existait déjà, pensé à l'avance mais
  // jamais atteignable faute de bouton pour l'envoyer.
  const handleConvFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4.5 * 1024 * 1024) {
      toast.error('Fichier trop volumineux (4,5 Mo maximum).');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      setUploadingConvMedia(true);
      try {
        const erreur = await insertConvMessage('file', dataUrl, undefined, file.type || 'application/pdf', file.name);
        if (erreur) toast.error(erreur);
      } finally {
        setUploadingConvMedia(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Envoi d'une vidéo dans une conversation directe (23 octobre, signalé :
  // « on ne peut pas uploader de vidéos mp4 dans les discussions chats »).
  // Contrairement à l'image/au PDF ci-dessus, une vidéo ne tient pas en data
  // URL dans la ligne — on la dépose sur le Drive Google de l'utilisateur
  // (même mécanique que ClientProfileView.tsx, handleChatVideoSelected) et
  // seul le lien est stocké comme attachment_url. Sans compte Workspace
  // connecté, repli sur une URL locale au navigateur (perdue à la fermeture
  // de l'onglet, mais au moins le message part).
  const handleConvVideoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_VIDEO_SIZE) {
      toast.error('Vidéo trop volumineuse (150 Mo maximum).');
      return;
    }
    setUploadingConvMedia(true);
    try {
      let token = getCachedAccessToken();
      if (!token) token = await requestWorkspaceAccessToken().catch(() => null);
      const url = token
        ? (await uploadVideoToDriveFolder(token, file, 'Messagerie interne')).fileUrl
        : URL.createObjectURL(file);
      const erreur = await insertConvMessage('video', url, undefined, file.type || 'video/mp4', file.name);
      if (erreur) toast.error(erreur);
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'envoyer la vidéo");
    } finally {
      setUploadingConvMedia(false);
    }
  };

  /**
   * Envoie une image ou un vocal dans le canal de projet actif.
   *
   * Les messages de canal vivent dans `chat_messages`, dont le contenu est un
   * JSONB libre — contrairement aux conversations directes qui ont des
   * colonnes dédiées. On range donc le média dans ce même objet `data`, à
   * côté du corps du message, sans migration de schéma.
   */
  const insertChannelMedia = async (
    kind: 'image' | 'voice' | 'file' | 'video',
    attachmentUrl: string,
    attachmentDuration?: number,
    attachmentMime?: string,
    fileName?: string
  ): Promise<string | null> => {
    if (!activeChannel || !currentUser) return 'Canal introuvable.';
    // Audit (10 septembre) : même filet que insertConvMessage (voir son
    // commentaire) — sans lui, une coupure réseau ici devenait un rejet de
    // promesse jamais rattrapé au lieu de remonter un message d'erreur.
    let error: { message: string } | null = null;
    try {
      const res = await supabase.from('chat_messages').insert({
        id: crypto.randomUUID(),
        channel: activeChannel.id,
        sender_id: currentUser.uid,
        is_deleted: false,
        read_by: [{ userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
        data: {
          body: fileName ?? '',
          kind,
          attachmentUrl,
          attachmentMime: attachmentMime ?? null,
          attachmentDuration: attachmentDuration ?? null,
          sender_id: currentUser.uid,
          sender_name: displayName,
          created_at: new Date().toISOString(),
        },
      } as any);
      error = res.error;
    } catch (e) {
      error = { message: (e as Error)?.message || "Erreur réseau pendant l'envoi." };
    }
    if (error) return error.message;
    await supabase.from('chat_channels').update({ last_message_at: new Date().toISOString() }).eq('id', activeChannel.id);
    return null;
  };

  const handleChannelImagePick = async (file: File | null) => {
    if (!file) return;
    setUploadingChannelMedia(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await insertChannelMedia('image', dataUrl);
    } finally {
      setUploadingChannelMedia(false);
      if (channelImageInputRef.current) channelImageInputRef.current.value = '';
    }
  };

  // Même demande (5 octobre) que côté conversations directes — voir le
  // commentaire détaillé sur handleConvFileSelected.
  const handleChannelFilePick = async (file: File | null) => {
    if (!file) return;
    if (file.size > 4.5 * 1024 * 1024) {
      toast.error('Fichier trop volumineux (4,5 Mo maximum).');
      return;
    }
    setUploadingChannelMedia(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const erreur = await insertChannelMedia('file', dataUrl, undefined, file.type || 'application/pdf', file.name);
      if (erreur) toast.error(erreur);
    } finally {
      setUploadingChannelMedia(false);
      if (channelFileInputRef.current) channelFileInputRef.current.value = '';
    }
  };

  // Même demande (23 octobre) que côté conversations directes — voir le
  // commentaire détaillé sur handleConvVideoSelected.
  const handleChannelVideoPick = async (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_VIDEO_SIZE) {
      toast.error('Vidéo trop volumineuse (150 Mo maximum).');
      return;
    }
    setUploadingChannelMedia(true);
    try {
      let token = getCachedAccessToken();
      if (!token) token = await requestWorkspaceAccessToken().catch(() => null);
      const url = token
        ? (await uploadVideoToDriveFolder(token, file, `Canal - ${activeChannel?.name || 'Messagerie'}`)).fileUrl
        : URL.createObjectURL(file);
      const erreur = await insertChannelMedia('video', url, undefined, file.type || 'video/mp4', file.name);
      if (erreur) toast.error(erreur);
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'envoyer la vidéo");
    } finally {
      setUploadingChannelMedia(false);
      if (channelVideoInputRef.current) channelVideoInputRef.current.value = '';
    }
  };

  const handleStartRecordingChannel = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickVoiceMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      channelMediaRecorderRef.current = recorder;
      channelAudioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) channelAudioChunksRef.current.push(e.data); };
      recorder.start(100);
      setIsRecordingChannel(true);
      setRecordingChannelSeconds(0);
      channelRecordingTimerRef.current = setInterval(() => setRecordingChannelSeconds((x) => x + 1), 1000);
    } catch {
      // micro refusé ou indisponible
    }
  };

  const handleStopRecordingChannel = async (cancel = false) => {
    const recorder = channelMediaRecorderRef.current;
    if (channelRecordingTimerRef.current) { clearInterval(channelRecordingTimerRef.current); channelRecordingTimerRef.current = null; }
    const duration = recordingChannelSeconds;
    setIsRecordingChannel(false);
    setRecordingChannelSeconds(0);
    if (!recorder || recorder.state === 'inactive') return;
    if (cancel) {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
      channelAudioChunksRef.current = [];
      return;
    }
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(channelAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        // On ne poste plus directement : le vocal se met en attente de
        // réécoute, l'envoi se fait au clic (voir `envoyerVocalChannel`).
        setChannelVocalPret({ dataUrl: reader.result as string, duree: duration });
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  };

  const envoyerVocalChannel = async () => {
    if (!channelVocalPret) return;
    // Audit (10 septembre) : même verrou que sendMessage (double appui/
    // double déclenchement) — le vocal n'avait AUCUNE protection contre un
    // second appel pendant que le premier était encore en vol.
    if (sendingChannelRef.current) return;
    sendingChannelRef.current = true;
    setUploadingChannelMedia(true);
    try {
      const erreur = await insertChannelMedia('voice', channelVocalPret.dataUrl, channelVocalPret.duree);
      if (erreur) {
        // L'enregistrement est conservé : on peut réessayer sans le refaire.
        toast.error(`Vocal non envoyé : ${erreur}`);
        return;
      }
      setChannelVocalPret(null);
    } finally {
      setUploadingChannelMedia(false);
      sendingChannelRef.current = false;
    }
  };

  const handleStartRecordingConv = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickVoiceMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      convMediaRecorderRef.current = recorder;
      convAudioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) convAudioChunksRef.current.push(e.data); };
      recorder.start(100);
      setIsRecordingConv(true);
      setRecordingConvSeconds(0);
      convRecordingTimerRef.current = setInterval(() => setRecordingConvSeconds((s) => s + 1), 1000);
    } catch {
      // micro refusé ou indisponible
    }
  };

  const handleStopRecordingConv = async (cancel = false) => {
    const recorder = convMediaRecorderRef.current;
    if (convRecordingTimerRef.current) { clearInterval(convRecordingTimerRef.current); convRecordingTimerRef.current = null; }
    const duration = recordingConvSeconds;
    setIsRecordingConv(false);
    setRecordingConvSeconds(0);
    if (!recorder || recorder.state === 'inactive') return;

    if (cancel) {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
      convAudioChunksRef.current = [];
      return;
    }

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(convAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        // Mise en attente de réécoute, pas d'envoi direct — voir
        // `envoyerVocalConv` et le commentaire sur `channelVocalPret`.
        setConvVocalPret({ dataUrl: reader.result as string, duree: duration });
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  };

  const envoyerVocalConv = async () => {
    if (!convVocalPret) return;
    // Audit (10 septembre, Sylvain → Natacha) : même verrou que
    // sendConvMessage (double appui/double déclenchement) — le vocal
    // n'avait AUCUNE protection contre un second appel pendant que le
    // premier était encore en vol (le bouton ne se désactive qu'au rendu
    // suivant, comme pour le texte).
    if (sendingConvRef.current) return;
    sendingConvRef.current = true;
    setUploadingConvMedia(true);
    try {
      const erreur = await insertConvMessage('voice', convVocalPret.dataUrl, convVocalPret.duree);
      if (erreur) {
        toast.error(`Vocal non envoyé : ${erreur}`);
        return;
      }
      setConvVocalPret(null);
    } finally {
      setUploadingConvMedia(false);
      sendingConvRef.current = false;
    }
  };

  // Signalé : "chaque entité doit être cloisonné, SAUF pour les chats, où
  // les 3 entités, tout le monde peut poster" — cette liste ne doit donc
  // PLUS être restreinte à l'agence active (c'était le cas avant, à
  // l'inverse de ce qui est demandé). L'agence de chacun reste affichée
  // (voir la modale plus bas) pour qu'on sache toujours à qui on écrit.
  // CORRECTIF (31/08/2026) — signalé : "je lui ai écrit, elle ne reçoit rien".
  //
  // Cette liste venait de `TEAM_MEMBERS`, un fichier figé dans le code. Or les
  // identifiants qui y figurent ne correspondent plus aux comptes réels :
  // Natacha y est enregistrée sous `4fdf3cf2-…` alors que son compte, créé le
  // 31/08, porte `f5c70ff8-…`. Cliquer sur son nom créait donc une
  // conversation avec un identifiant FANTÔME ; l'ajout du participant violait
  // la clé étrangère vers `profiles` et échouait, sans que rien ne s'affiche.
  // Constat en base : les trois dernières conversations directes ont ZÉRO
  // participant — le chat direct était cassé pour tout le monde, pas
  // seulement pour elle.
  //
  // La liste vient désormais de `profiles`, qui fait foi. `teamMembers.ts`
  // n'est plus consulté que pour l'habillage (photo, intitulé de poste), et
  // uniquement par correspondance d'ADRESSE E-MAIL — jamais par identifiant.
  // Même principe que `useAssignableUsers`, écrit pour la même raison sur
  // l'attribution des contacts.
  const colleaguesForNewConv = useMemo(() => {
    const existingDirectPartners = new Set<string>();
    conversations.forEach((c) => {
      if (c.type !== 'direct') return;
      (conversationMembers[c.id] || []).forEach((u) => { if (u !== currentUser?.uid) existingDirectPartners.add(u); });
    });
    const query = newConvQuery.toLowerCase();
    return allProfiles
      .filter((p) => p.uid !== currentUser?.uid)
      .filter((p) =>
        p.displayName.toLowerCase().includes(query) || (p.email || '').toLowerCase().includes(query))
      .map((p) => {
        const habillage = TEAM_MEMBERS.find(
          (m) => m.email.toLowerCase() === (p.email || '').toLowerCase());
        const agences = agencyIdsByUid[p.uid] || [];
        return {
          id: p.uid,
          name: p.displayName,
          email: p.email || '',
          role: habillage?.role || '',
          agencyId: agences[0] || habillage?.agencyId || null,
          avatar: habillage?.avatar || p.displayName.slice(0, 2).toUpperCase(),
          avatarUrl: habillage?.avatarUrl,
          hasConversation: existingDirectPartners.has(p.uid),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations, conversationMembers, currentUser?.uid, newConvQuery, allProfiles, agencyIdsByUid]);

  // Collègues proposés pour agrandir un groupe déjà ouvert — même source
  // (toutes agences confondues) que colleaguesForNewConv ci-dessus, mais
  // exclut les membres déjà présents dans CETTE conversation plutôt que de
  // signaler une conversation directe existante.
  const colleaguesToInvite = useMemo(() => {
    if (!activeConversationId) return [];
    const dejaMembres = new Set(conversationMembers[activeConversationId] || []);
    const query = inviteConvQuery.toLowerCase();
    return allProfiles
      .filter((p) => p.uid !== currentUser?.uid && !dejaMembres.has(p.uid))
      .filter((p) =>
        p.displayName.toLowerCase().includes(query) || (p.email || '').toLowerCase().includes(query))
      .map((p) => {
        const habillage = TEAM_MEMBERS.find(
          (m) => m.email.toLowerCase() === (p.email || '').toLowerCase());
        const agences = agencyIdsByUid[p.uid] || [];
        return {
          id: p.uid,
          name: p.displayName,
          email: p.email || '',
          agencyId: agences[0] || habillage?.agencyId || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeConversationId, conversationMembers, currentUser?.uid, inviteConvQuery, allProfiles, agencyIdsByUid]);

  const agencyNameById = (id: string | null | undefined) => AGENCIES.find((a) => a.id === id)?.name || null;

  const startConversation = async (otherUserId: string) => {
    if (!currentUser) return;
    // Réutilise une conversation directe existante avec cette personne si elle existe déjà
    const existing = conversations.find(
      (c) => c.type === 'direct' && (conversationMembers[c.id] || []).includes(otherUserId)
    );
    if (existing) {
      setShowNewConvModal(false);
      setTab('conversations');
      openConversation(existing.id);
      return;
    }
    // Conversation multi-entités (participants de deux agences différentes)
    // : agency_id null, même principe déjà utilisé par l'espace "3
    // Entités" (chat_projects/chat_channels) — sinon, agence active comme
    // avant (comportement inchangé pour un échange au sein d'une même
    // agence).
    const miennes = agencyIdsByUid[currentUser.uid] || [];
    const siennes = agencyIdsByUid[otherUserId] || [];
    const communes = miennes.filter((a) => siennes.includes(a));
    // Signalé (30/09/2026, Diane → Eric) : « Eric reçoit la notification
    // mais n'a pas accès à la conversation ». Cause : Diane et Eric n'ont
    // AUCUNE agence en commun (Novavisio / Conseils Finances) — le repli
    // ci-dessous retombait alors sur `miennes[0]`, l'agence PROPRE de
    // Diane, ce qui rend la conversation illisible pour quiconque n'est pas
    // membre de CETTE agence précise (voir is_conversation_member) : Eric
    // avait bien sa ligne `conversation_members` (d'où la notification),
    // mais ne passait plus la policy de lecture.
    //
    // Avant le correctif du 24/09/2026 sur `is_conversation_member`
    // (agency_id NULL = pas de restriction d'agence, seule l'appartenance à
    // conversation_members compte), NULL était effectivement invisible pour
    // tout le monde, y compris l'auteur — d'où le repli sur une agence
    // précise ci-dessous, coûte que coûte (31/08/2026, « Sarah ne peut pas
    // créer de conversation »). Ce n'est plus vrai : NULL fonctionne
    // maintenant correctement pour tous les membres, quelle que soit leur
    // agence. Repli supprimé : à défaut d'agence VRAIMENT commune, la
    // conversation reste multi-entités plutôt que de pencher arbitrairement
    // vers l'agence de l'un des deux au détriment de l'autre.
    const agencePartagee =
      (communes.includes(activeAgency.id) ? activeAgency.id : null)
      || communes[0]
      || null;

    // L'identifiant est généré ici plutôt que demandé à la base.
    //
    // Auparavant on faisait `.insert(...).select().single()`, ce qui demande à
    // PostgreSQL de RELIRE la ligne juste créée. Or la règle de lecture des
    // conversations, ouverte ce soir aux échanges inter-agences, exige d'être
    // MEMBRE de la conversation — et à cet instant précis elle n'a encore
    // aucun membre, ils sont ajoutés juste après. La relecture échouait donc,
    // et l'échec remontait sous la forme trompeuse « new row violates
    // row-level security policy », qui désigne d'ordinaire un refus
    // d'écriture. On a cherché du mauvais côté un bon moment.
    //
    // En fournissant l'identifiant, plus besoin de relire quoi que ce soit.
    const conversationId = crypto.randomUUID();
    const { error } = await supabase
      .from('conversations')
      .insert({ id: conversationId, type: 'direct', title: null, created_by: currentUser.uid, agency_id: agencePartagee } as any);
    const conv = error ? null : { id: conversationId };
    if (error || !conv) {
      // Cet échec était avalé en silence : on cliquait sur un nom, la fenêtre
      // se fermait, et rien ne se passait.
      setConvCreateError(error?.message || "La conversation n'a pas pu être créée.");
      return;
    }
    const { error: membersError } = await supabase.from('conversation_members').insert([
      { conversation_id: (conv as any).id, user_id: currentUser.uid },
      { conversation_id: (conv as any).id, user_id: otherUserId },
    ] as any);
    if (membersError) {
      // C'est ICI que tout se jouait : l'ajout des participants échouait
      // (identifiant inexistant), la conversation restait vide, et le
      // destinataire ne la voyait jamais. On ne laisse plus passer.
      await supabase.from('conversations').delete().eq('id', (conv as any).id);
      setConvCreateError(`Participants non enregistrés : ${membersError.message}`);
      return;
    }
    setConvCreateError(null);
    setShowNewConvModal(false);
    setNewConvQuery('');
    await loadConversations();
    setTab('conversations');
    openConversation((conv as any).id);
  };

  // Demande explicite : "chaque utilisateur peut créer des groupes aussi
  // avec des utilisateurs de plusieurs agences différentes."
  const createGroup = async () => {
    if (!currentUser || selectedGroupMemberIds.size === 0 || !groupTitle.trim()) return;
    setCreatingGroup(true);
    try {
      const memberIds = Array.from(selectedGroupMemberIds);
      // Même correctif que pour les conversations directes (voir
      // startConversation, signalé 30/09/2026 « Eric reçoit la notification
      // mais n'a pas accès ») : à défaut d'agence commune à TOUS les
      // membres, on reste en multi-entités (NULL) plutôt que de retomber
      // sur l'agence d'une seule personne, invisible aux autres.
      const agencesDeChacun = memberIds.map((id) => agencyIdsByUid[id] || []);
      const miennesG = agencyIdsByUid[currentUser.uid] || [];
      const communesG = miennesG.filter((a) => agencesDeChacun.every((liste) => liste.includes(a)));
      const agenceGroupe =
        (communesG.includes(activeAgency.id) ? activeAgency.id : null)
        || communesG[0]
        || null;
      // Même raison que pour les conversations directes : pas de relecture
      // après insertion, elle échoue tant que le groupe n'a pas de membre.
      const groupeId = crypto.randomUUID();
      const { error } = await supabase
        .from('conversations')
        .insert({
          id: groupeId,
          type: 'group',
          title: groupTitle.trim(),
          created_by: currentUser.uid,
          agency_id: agenceGroupe,
        } as any);
      const conv = error ? null : { id: groupeId };
      // Signalé (31/08/2026) : « impossible de créer un groupe de discussion ».
      // Même défaut que pour les conversations directes, corrigé ce matin :
      // l'échec était avalé — la fenêtre se fermait sans rien dire, et l'erreur
      // d'ajout des participants n'était même pas regardée.
      if (error || !conv) {
        setConvCreateError(error?.message || "Le groupe n'a pas pu être créé.");
        return;
      }
      const { error: membresError } = await supabase.from('conversation_members').insert([
        { conversation_id: (conv as any).id, user_id: currentUser.uid },
        ...memberIds.map((id) => ({ conversation_id: (conv as any).id, user_id: id })),
      ] as any);
      if (membresError) {
        // On ne laisse pas de groupe vide derrière soi : sans participants,
        // il serait invisible pour tout le monde, y compris son auteur.
        await supabase.from('conversations').delete().eq('id', (conv as any).id);
        setConvCreateError(`Participants non enregistrés : ${membresError.message}`);
        return;
      }
      setConvCreateError(null);
      setShowNewConvModal(false);
      setNewConvMode('direct');
      setSelectedGroupMemberIds(new Set());
      setGroupTitle('');
      setNewConvQuery('');
      await loadConversations();
      setTab('conversations');
      openConversation((conv as any).id);
    } finally {
      setCreatingGroup(false);
    }
  };

  // Agrandir un groupe déjà créé — voir colleaguesToInvite plus haut. Toute
  // personne déjà dans le groupe peut désormais en inviter d'autres (pas
  // seulement son créateur, voir migration RLS associée) : "chaque
  // utilisateur puisse inviter des utilisateurs de Immosphera, Conseils
  // Finances et Novavisio [...] et inviter plusieurs utilisateurs".
  const inviteToConversation = async () => {
    if (!currentUser || !activeConversationId || selectedInviteIds.size === 0) return;
    setInvitingToConv(true);
    try {
      const memberIds = Array.from(selectedInviteIds);
      const conv = conversations.find((c) => c.id === activeConversationId);
      const agencyId = conv?.agency_id ?? null;
      // Un groupe cantonné à une seule agence doit s'ouvrir "3 entités"
      // (agency_id null) dès qu'on y invite quelqu'un qui n'en est pas
      // membre — sinon l'ajout réussirait en silence mais la personne
      // invitée ne verrait jamais la conversation (règle de lecture par
      // agence, voir is_conversation_member).
      const inviteHorsAgence = agencyId
        ? memberIds.some((id) => !(agencyIdsByUid[id] || []).includes(agencyId))
        : false;
      if (inviteHorsAgence) {
        const { error: agenceError } = await supabase
          .from('conversations')
          .update({ agency_id: null } as any)
          .eq('id', activeConversationId);
        if (agenceError) {
          toast.error(`Ouverture aux autres agences impossible : ${agenceError.message}`);
          return;
        }
      }
      const { error } = await supabase.from('conversation_members').insert(
        memberIds.map((id) => ({ conversation_id: activeConversationId, user_id: id })) as any
      );
      if (error) {
        toast.error(`Participants non ajoutés : ${error.message}`);
        return;
      }
      setShowInviteConvModal(false);
      setSelectedInviteIds(new Set());
      setInviteConvQuery('');
      await loadConversations();
    } finally {
      setInvitingToConv(false);
    }
  };

  // ── Charger dossiers + canaux (agence active + espace "3 entités") ──────
  // Signalé (4 septembre) : un membre invité par le super admin dans un
  // dossier d'une AUTRE agence que la sienne (voir migration
  // 20260904130000_chat_dossiers_multi_agences) ne le voyait jamais tant
  // que son agence active ne correspondait pas à celle du dossier — le
  // filtre ci-dessous l'excluait complètement. On charge donc aussi, en
  // plus, tout dossier dont il est déjà membre (chat_project_members),
  // quelle que soit l'agence du dossier.
  // Les sociétés que cette personne peut atteindre par le sélecteur du haut
  // (toutes, pour un super admin). Sert au cloisonnement ci-dessous.
  const agencesJoignables = useMemo(
    () => new Set(agencesDisponibles(AGENCIES, userProfile).map((a) => a.id)),
    [userProfile],
  );
  // Clé stable de cet ensemble : tant que le profil n'est pas chargé,
  // `agencesDisponibles` répond « toutes les sociétés », donc le filet
  // ci-dessous ne laisse rien passer — sans danger (on cloisonne plutôt
  // trop), mais un dossier d'une autre société resterait invisible pour la
  // personne invitée jusqu'au rechargement suivant. On relit donc la liste
  // dès que le profil arrive. Chaîne plutôt que l'objet `userProfile` :
  // une nouvelle identité d'objet au même contenu ne déclenche rien.
  const cleAgencesJoignables = useMemo(
    () => [...agencesJoignables].sort().join(','),
    [agencesJoignables],
  );

  const loadProjectsAndChannels = async () => {
    const [{ data: projectRows }, { data: memberProjectRows }] = await Promise.all([
      supabase
        .from('chat_projects')
        .select('*')
        .or(`agency_id.is.null,agency_id.eq.${activeAgency.id}`)
        .order('position'),
      currentUser
        ? supabase.from('chat_project_members').select('chat_projects(*)').eq('user_id', currentUser.uid)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const parAgence = (projectRows as ChatProject[]) || [];
    // Signalé (4 septembre) : « tu m'as mélangé tous les projets de toutes les
    // agences, tu ne m'as pas cloisonné le tout ». La requête d'appartenance
    // ci-dessus ne filtre sur AUCUNE agence : pour quelqu'un qui est membre de
    // dossiers dans les trois sociétés (le super admin en tête), elle les
    // ramenait donc tous à la fois, quelle que soit la société sélectionnée —
    // le cloisonnement sautait.
    //
    // Elle n'existe que pour un cas précis : la personne invitée dans le
    // dossier d'une société qu'elle n'a PAS dans son sélecteur, et qui n'a donc
    // aucun autre moyen de le voir. On s'y tient : un dossier d'une société
    // atteignable autrement passe par la règle d'agence normale, comme avant.
    // Pour un super admin, toutes les sociétés étant atteignables, ce filet ne
    // laisse rien passer : cloisonnement strictement identique à l'origine.
    const parAppartenance = (((memberProjectRows as any[]) || [])
      .map((r) => r.chat_projects)
      .filter(Boolean) as ChatProject[])
      .filter((p) => p.agency_id && !agencesJoignables.has(p.agency_id));
    const dejaVus = new Set<string>();
    const list = [...parAgence, ...parAppartenance]
      .filter((p) => (dejaVus.has(p.id) ? false : (dejaVus.add(p.id), true)))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    setProjects(list);

    if (list.length > 0) {
      const { data: channelRows } = await supabase
        .from('chat_channels')
        .select('*')
        .in('project_id', list.map((p) => p.id))
        .order('position');

      const grouped: Record<string, ChatChannel[]> = {};
      (channelRows as ChatChannel[] || []).forEach((c) => {
        (grouped[c.project_id] ||= []).push(c);
      });
      setChannelsByProject(grouped);

      // Comptage des participants par canal — un canal restreint où
      // l'utilisateur courant n'est pas invité n'apparaît de toute façon
      // pas dans channelRows (RLS), donc ce comptage ne peut porter que sur
      // des canaux déjà visibles.
      const ids = (channelRows as ChatChannel[] || []).map((c) => c.id);
      if (ids.length > 0) {
        const { data: membresRows } = await supabase.from('chat_channel_members').select('channel_id').in('channel_id', ids);
        const counts: Record<string, number> = {};
        ((membresRows as { channel_id: string }[]) || []).forEach((m) => {
          counts[m.channel_id] = (counts[m.channel_id] || 0) + 1;
        });
        setChannelMemberCounts(counts);
      }
    }
  };

  useEffect(() => {
    loadProjectsAndChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgency.id, cleAgencesJoignables]);

  // ── Messages du canal actif, avec synchro temps réel ─────────────────────
  const loadMessages = async (channelId: string) => {
    // Perf (30/08/2026, signalé "plus de 10 secondes") : même correctif que
    // loadConvMessages ci-dessus — ne charge plus que les
    // RECENT_MESSAGES_PAGE derniers messages (triés du plus RÉCENT, pas du
    // plus ancien comme avant, qui pouvait même exclure les messages
    // récents sur un canal de 200+ messages) au lieu de 200 d'un coup.
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('channel', channelId)
      .order('created_at', { ascending: false })
      .limit(RECENT_MESSAGES_PAGE);
    const rows = ((data as any[]) || []).slice().reverse() as ChatMessageRow[];

    // Audit stabilité (20 octobre) : même bug, même correctif que
    // loadConvMessages — un appel (sondage, retour au premier plan, ou
    // maintenant le temps réel ci-dessous) resté en vol pendant un
    // changement de canal remplaçait sans condition l'affichage, faisant
    // apparaître les messages d'un AUTRE canal sous le nom du canal actif.
    channelMessagesCacheRef.current[channelId] = rows;
    if (activeChannelIdRef.current === channelId) {
      setMessages(rows);
    }

    // Bug remonté : lire les messages d'un canal ne marquait jamais rien —
    // le badge "Chat" grossissait indéfiniment. On marque ici lu tout
    // message d'un autre membre pas encore lu par moi, et on synchronise la
    // notification correspondante (même logique que pour les conversations
    // directes).
    if (currentUser && activeChannelIdRef.current === channelId) {
      const toMarkRead = rows.filter(
        (r) => r.sender_id !== currentUser.uid && !(Array.isArray(r.read_by) && r.read_by.some((x: any) => x.userId === currentUser.uid))
      );
      if (toMarkRead.length > 0) {
        // Perf (10 septembre) : même correctif que loadReactionsAndReceiptsFor
        // (conversations directes, 30/08/2026) — ces deux écritures ne
        // conditionnent plus rien à l'écran (setMessages a déjà eu lieu
        // au-dessus) : plus besoin de les attendre l'une après l'autre, ni
        // de bloquer dessus du tout. Lancées en parallèle, sans attendre —
        // ce sondage tourne toutes les 4s tant qu'un canal est ouvert,
        // chaque aller-retour évité compte.
        void Promise.all([
          Promise.all(
            toMarkRead.map((r) =>
              supabase
                .from('chat_messages')
                .update({
                  read_by: [...(Array.isArray(r.read_by) ? r.read_by : []), { userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
                } as any)
                .eq('id', r.id)
            )
          ),
          supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', currentUser.uid)
            .eq('is_read', false)
            .in('entity_id', toMarkRead.map((r) => r.id)),
        ]);
      }
    }
  };

  useEffect(() => {
    // Audit stabilité (20 octobre) : même correctif que côté conversations
    // juste au-dessus — sans la dépendance à `tab`, ce canal temps réel et
    // ce sondage 4s continuaient de tourner même après être passé sur
    // l'onglet Conversations, tant qu'un canal d'équipe restait "actif" en
    // arrière-plan.
    if (!activeChannel || tab !== 'projets') return;
    loadMessages(activeChannel.id);

    const channel = supabase
      .channel(`chat_${activeChannel.id}`)
      .on(
        'postgres_changes',
        // Audit stabilité (20 octobre) : élargi de 'INSERT' à '*' (comme
        // côté conversations) — une édition, une suppression ou une
        // réaction (stockée inline dans chat_messages.reactions) sur un
        // message déjà affiché ne se reflétait avant qu'au sondage suivant
        // (jusqu'à 4s). Et un ajout direct dans `messages` (prev => [...])
        // contournait le cache/garde de loadMessages ci-dessus — recharger
        // via loadMessages (déjà protégé) plutôt que fusionner à la main
        // corrige les deux en même temps.
        { event: '*', schema: 'public', table: 'chat_messages', filter: `channel=eq.${activeChannel.id}` },
        () => loadMessages(activeChannel.id)
      )
      .subscribe();

    // Signalé (30/08/2026, "parfois 18 secondes") : même correctif que sur
    // les conversations directes (voir plus haut) — ce canal ne reposait
    // QUE sur l'événement temps réel `INSERT` ci-dessus, sans aucun filet de
    // secours. Si le WebSocket a le temps de se déconnecter/reconnecter
    // (onglet en arrière-plan, veille de l'appareil...), les messages
    // arrivés pendant la coupure n'étaient jamais rattrapés. Même sondage
    // 4s + rafraîchissement immédiat au retour au premier plan.
    // Revu (30/08/2026, "on peut le laisser tourner en fond mais très léger,
    // maîtriser la consommation") : même principe que côté conversations —
    // le sondage 4s ne tourne que si Chat est réellement affiché (isActive).
    let pollInterval: number | null = null;
    if (isActive) {
      pollInterval = window.setInterval(() => {
        loadMessages(activeChannel.id);
      }, 4000);
    }
    const handleVisible = () => {
      if (document.visibilityState === 'visible' && isActive) loadMessages(activeChannel.id);
    };
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);

    return () => {
      supabase.removeChannel(channel);
      if (pollInterval) window.clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel?.id, isActive, tab]);

  // Ticket #9 (nouvelle base) : voir le correctif identique sur convScrollRef
  // ci-dessus — même cause, même fix, pour les canaux d'équipe. Signalé (15
  // octobre) : ce garde-fou n'avait en réalité jamais été reporté ici — ce
  // défilement systématique vers le bas du canal l'emportait donc toujours
  // sur le rebond ciblé (highlightedMessageId) au clic sur une notification
  // de message de canal, exactement la course déjà corrigée côté
  // conversations directes le 10 septembre.
  useEffect(() => {
    if (highlightedMessageId) return;
    const pane = scrollRef.current;
    if (!pane) return;
    const frame = window.requestAnimationFrame(() => {
      pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
    });
    const settle = window.setTimeout(() => {
      pane.scrollTo({ top: pane.scrollHeight, behavior: 'auto' });
    }, 150);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [messages.length, activeChannel?.id, highlightedMessageId]);

  // Bug nº 6 (consigne du 1er septembre), deuxieme partie. Signale a la
  // recette : « quand je mets un chat dans le dossier, elle ne recoit rien ».
  // Le chat d'un DOSSIER passe par `chat_messages` (colonne `channel`), un
  // chemin distinct du chat d'une TACHE (table `messages`, deja corrige dans
  // useTaskMessages.ts) : personne n'etait donc prevenu. On reutilise la RPC
  // `create_notification` deja en place partout ailleurs — pas de second
  // systeme, et aucun declencheur base n'existe sur `chat_messages` (celui
  // documente plus haut ne porte que sur `messages`, cf. sendConvMessage).
  const notifierMembresDuDossier = async (canal: ChatChannel, apercu: string, messageId?: string) => {
    if (!currentUser) return;
    try {
      // Signalé (16 septembre, capture à l'appui) : « Isabelle voit les
      // canaux de Laetitia, Carine etc. et [...] reçoit également le
      // message alors qu'elle ne fait pas partie du canal. Il faut
      // cloisonner et conditionner ABSOLUMENT ». La restriction est
      // désormais automatique (voir can_view_chat_channel, migration
      // 20260916180000) : dès qu'un canal a des participants invités
      // (chat_channel_members), il est restreint à eux — plus de case à
      // cocher séparée à oublier. On interroge donc toujours
      // chat_channel_members d'abord ; s'il n'y a AUCUN participant invité,
      // le canal est ouvert et on retombe sur tout le dossier.
      const { data: membresCanal } = await supabase.from('chat_channel_members').select('user_id').eq('channel_id', canal.id);
      const participantsInvites = (membresCanal as { user_id: string }[]) || [];
      const canalRestreint = participantsInvites.length > 0;

      const { data: membres } = canalRestreint
        ? { data: participantsInvites }
        : await supabase.from('chat_project_members').select('user_id').eq('project_id', canal.project_id);

      const destinataires = Array.from(
        new Set(
          [
            ...((membres as { user_id: string }[]) || []).map((m) => m.user_id),
            ...(canalRestreint && canal.created_by ? [canal.created_by] : []),
          ].filter((uid) => uid && uid !== currentUser.uid)
        )
      );
      if (destinataires.length === 0) return;

      const projet = projects.find((p) => p.id === canal.project_id);
      // Signalé (7 septembre, Isabelle — « valable pour tous ») : le clic
      // sur la notification d'un message de Projet n'amenait jamais au
      // message, juste à la liste — parce que le lien envoyé ici était
      // toujours `/messagerie`, sans jamais désigner le message précis.
      // `?highlight=<id>` est exactement ce que ChatViewSupabase sait déjà
      // résoudre (voir l'effet sur `initialHighlightMessageId` plus haut) :
      // il retrouve le canal via `chat_messages` et ouvre directement dessus.
      const url = messageId ? `/messagerie?highlight=${messageId}` : '/messagerie';
      await Promise.all(
        destinataires.map((uid) =>
          supabase.rpc('create_notification', {
            _user_id: uid,
            _type: 'message',
            _title: `💬 ${projet ? projet.name : 'Projet interne'} · ${canal.name}`,
            _message: `${displayName} : ${apercu}`.slice(0, 180),
            // Signalé le 7 octobre : "quand on lit des messages sur le
            // téléphone cela ne se met pas à jour sur l'ordinateur et les
            // autres supports". Cause réelle (aucun rapport avec l'appareil) :
            // `loadMessages` marque lu par IDENTIFIANT DE MESSAGE
            // (`entity_id IN (...message ids)`, voir plus bas), mais l'entité
            // enregistrée ici était celle du CANAL — les deux ne
            // correspondaient jamais, donc ce `.update(is_read)` ne touchait
            // 0 ligne, sur n'importe quel appareil. Même correctif déjà
            // appliqué à `internal_task_message` (voir useTaskMessages.ts) :
            // l'entité est le MESSAGE lui-même.
            _entity_type: messageId ? 'chat_message' : 'chat_channel',
            _entity_id: messageId || canal.id,
            _agency_id: /^[0-9a-f-]{36}$/i.test(activeAgency.id) ? activeAgency.id : null,
            _metadata: { url },
          } as any)
        )
      );
    } catch (e) {
      // Une notification qui echoue ne doit jamais faire echouer l'envoi.
      console.warn('Notification de message de dossier impossible :', e);
    }
  };

  const sendMessage = async () => {
    if (!activeChannel || !currentUser) return;
    if (!draft.trim()) {
      // Même correctif que sendConvMessage (voir son commentaire) : un
      // vocal en attente (channelVocalPret) ne doit pas rester bloqué
      // silencieusement si on utilise ce bouton/Entrée plutôt que celui de
      // son aperçu.
      if (channelVocalPret) void envoyerVocalChannel();
      return;
    }
    // Même garde que pour les conversations directes : voir sendConvMessage.
    if (sendingChannelRef.current) return;
    sendingChannelRef.current = true;
    const body = draft.trim();
    setDraft('');
    try {
    const messageId = crypto.randomUUID();
    const { error } = await supabase.from('chat_messages').insert({
      // Signalé : "les Novadji dans les messages ne se mettent pas" — en
      // creusant, la colonne `id` de `chat_messages` n'a pas de valeur par
      // défaut côté base (corrigé séparément par une migration SQL), donc
      // AUCUN message de canal ne s'enregistrait jamais, silencieusement
      // (violait la contrainte NOT NULL). Fourni explicitement ici aussi,
      // en plus du correctif base, pour ne plus jamais dépendre d'un défaut
      // serveur pour cette colonne.
      id: messageId,
      channel: activeChannel.id,
      data: { body, sender_id: currentUser.uid, sender_name: displayName, created_at: new Date().toISOString() },
      // Bug remonté : sans ces colonnes réelles (avant, seulement dans le
      // JSONB `data`), le badge "Chat" ne pouvait jamais reconnaître ni ses
      // propres messages ni un message lu — il grossissait indéfiniment.
      sender_id: currentUser.uid,
      is_deleted: false,
      read_by: [{ userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
    } as any);
    // Signalé (19/09/2026, Laetitia Pioche/Réseaux sociaux) : "elle reçoit
    // bien le message mais ne peut pas répondre" — l'erreur de cet insert
    // n'était jamais lue : que la ligne parte réellement en base ou qu'elle
    // soit refusée (RLS, contrainte...), le champ se vidait quand même
    // (`setDraft('')` ci-dessus, avant même l'appel réseau) et rien
    // n'indiquait un échec — un blocage strictement invisible. Le texte
    // tapé est maintenant restauré et l'erreur réelle affichée.
    if (error) {
      setDraft(body);
      toast.error(`Message non envoyé : ${error.message}`);
      return;
    }
    await supabase.from('chat_channels').update({ last_message_at: new Date().toISOString() }).eq('id', activeChannel.id);
    await notifierMembresDuDossier(activeChannel, body, messageId);
    } finally {
      sendingChannelRef.current = false;
    }
  };

  const sendNovaChannelMessage = async (novaSrc: string) => {
    if (!activeChannel || !currentUser) return;
    setShowChannelNovaPicker(false);
    const messageId = crypto.randomUUID();
    const { error } = await supabase.from('chat_messages').insert({
      id: messageId,
      channel: activeChannel.id,
      data: { body: novaSrc, sender_id: currentUser.uid, sender_name: displayName, created_at: new Date().toISOString() },
      sender_id: currentUser.uid,
      is_deleted: false,
      read_by: [{ userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
    } as any);
    // Même correctif que sendMessage : une erreur ici restait invisible.
    if (error) {
      toast.error(`Mascotte non envoyée : ${error.message}`);
      return;
    }
    await supabase.from('chat_channels').update({ last_message_at: new Date().toISOString() }).eq('id', activeChannel.id);
    await notifierMembresDuDossier(activeChannel, 'a envoye une mini-expression', messageId);
  };

  // ── Gestion des canaux (admin uniquement) ─────────────────────────────
  // `parentChannelId` optionnel : sous-dossier imbriqué dans un canal
  // existant plutôt qu'un canal racine du dossier (voir migration
  // 20260904130000_chat_dossiers_multi_agences, colonne parent_channel_id).
  const addChannel = async (projectId: string, parentChannelId?: string) => {
    const name = newChannelName.trim();
    if (!name || !currentUser) return;
    const existing = channelsByProject[projectId] || [];
    const { data, error } = await supabase
      .from('chat_channels')
      .insert({
        project_id: projectId,
        name,
        position: existing.length,
        created_by: currentUser.uid,
        ...(parentChannelId ? { parent_channel_id: parentChannelId } : {}),
      } as any)
      .select()
      .single();
    if (error) {
      // Signalé : cet échec restait avalé en silence, indiscernable d'un
      // bouton qui ne fait rien — même correctif que createProject.
      toast.error(`Canal non créé : ${error.message}`);
      return;
    }
    if (data) {
      setChannelsByProject((prev) => ({ ...prev, [projectId]: [...(prev[projectId] || []), data as ChatChannel] }));
    }
    setNewChannelName('');
    setNewChannelFor(null);
  };

  const deleteChannel = async (channel: ChatChannel) => {
    if (!confirm(`Supprimer le canal "${channel.name}" ?`)) return;
    await supabase.from('chat_channels').delete().eq('id', channel.id);
    setChannelsByProject((prev) => ({
      ...prev,
      [channel.project_id]: (prev[channel.project_id] || []).filter((c) => c.id !== channel.id),
    }));
    if (activeChannel?.id === channel.id) setActiveChannel(null);
  };

  // Sous-dossiers : ne réordonne qu'entre FRÈRES (même parent, racine ou
  // sous-dossier) — sans quoi monter/descendre un sous-dossier le mêlerait
  // aux canaux racine d'un tout autre niveau. Pour un canal racine (cas
  // d'aujourd'hui, aucun canal n'a encore de parent), la fratrie EST déjà
  // la liste complète : comportement strictement inchangé.
  const moveChannel = async (channel: ChatChannel, direction: -1 | 1) => {
    const tous = channelsByProject[channel.project_id] || [];
    const fratrie = tous.filter((c) => (c.parent_channel_id || null) === (channel.parent_channel_id || null));
    const idx = fratrie.findIndex((c) => c.id === channel.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= fratrie.length) return;
    [fratrie[idx], fratrie[swapIdx]] = [fratrie[swapIdx], fratrie[idx]];
    fratrie.forEach((c, i) => { c.position = i; });
    const majParId = new Map(fratrie.map((c) => [c.id, c] as [string, ChatChannel]));
    const nouvelleListe = tous.map((c) => majParId.get(c.id) || c);
    setChannelsByProject((prev) => ({ ...prev, [channel.project_id]: nouvelleListe }));
    // Perf (20 octobre) : échange adjacent — seuls ces deux éléments
    // changent réellement de position. Écrire aussi tous leurs frères
    // inchangés (comme avant) coûtait jusqu'à N écritures pour un simple
    // clic flèche haut/bas, au lieu de 2.
    await Promise.all([
      supabase.from('chat_channels').update({ position: fratrie[idx].position }).eq('id', fratrie[idx].id),
      supabase.from('chat_channels').update({ position: fratrie[swapIdx].position }).eq('id', fratrie[swapIdx].id),
    ]);
  };

  // Sous-dossiers (4 septembre) : un canal peut désormais en contenir
  // d'autres (parent_channel_id, migration 20260904130000). Rendu
  // récursif — un canal qui a des enfants prend l'icône Folder (au lieu de
  // Hash) et un chevron d'expansion, EXACTEMENT le même principe que la
  // ligne d'un dossier juste au-dessus dans l'arbre ; un canal SANS enfant
  // garde très exactement son rendu d'avant (aucun changement visuel pour
  // l'existant, aucun canal n'ayant de parent avant cette fonctionnalité).
  // Cliquer sur le canal reste l'ouvrir (ses messages) qu'il ait des
  // enfants ou non — seul le chevron, séparé, replie/déplie ses
  // sous-dossiers, sans quoi un dossier-canal deviendrait impossible à
  // consulter lui-même.
  // Pastille d'un canal : son propre total, plus celui de ses sous-dossiers
  // (repliés, ils ne doivent pas faire disparaître un non-lu qu'ils contiennent).
  const unreadCanalRecursif = (channelId: string): number => {
    const enfants = Object.values(channelsByProject).flat().filter((e) => e.parent_channel_id === channelId);
    return (unreadByChannel[channelId] || 0) + enfants.reduce((sum, e) => sum + unreadCanalRecursif(e.id), 0);
  };

  const renderCanal = (c: ChatChannel, fratrie: ChatChannel[], i: number): React.ReactNode => {
    const enfants = (channelsByProject[c.project_id] || []).filter((e) => e.parent_channel_id === c.id);
    const aDesEnfants = enfants.length > 0;
    const canalUnread = unreadCanalRecursif(c.id);
    return (
      <div key={c.id} className="space-y-1">
        <div className="group flex items-center gap-1">
          {aDesEnfants && (
            <button
              onClick={() => setExpandedChannels((p) => ({ ...p, [c.id]: !p[c.id] }))}
              className="p-1 text-slate-400 hover:text-white shrink-0"
              title={expandedChannels[c.id] ? 'Replier' : 'Déplier'}
            >
              {expandedChannels[c.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          )}
          <button
            onClick={() => setActiveChannel(c)}
            className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-left truncate ${
              activeChannel?.id === c.id ? 'bg-[#F7BC5F]/20 text-[#F7BC5F]' : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            {aDesEnfants ? <Folder className="w-3.5 h-3.5 shrink-0" /> : <Hash className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate flex-1">{c.name}</span>
            {(channelMemberCounts[c.id] || 0) > 0 && (
              <span title="Canal restreint à ses participants"><Lock className="w-3 h-3 shrink-0 text-[#F7BC5F]" /></span>
            )}
            {canalUnread > 0 && (
              <span className="shrink-0 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-[#F7BC5F] text-slate-950">
                {canalUnread > 9 ? '9+' : canalUnread}
              </span>
            )}
          </button>
          {(isAdmin || isSuperAdmin) && (
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              {isSuperAdmin && (
                <>
                  <button onClick={() => moveChannel(c, -1)} disabled={i === 0} className="p-1 text-slate-500 hover:text-white disabled:opacity-20">
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button onClick={() => moveChannel(c, 1)} disabled={i === fratrie.length - 1} className="p-1 text-slate-500 hover:text-white disabled:opacity-20">
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </>
              )}
              {/* Signalé (17/09/2026, Réseaux sociaux/Immosphera) : "il faut
                  que les admins, pas seulement les super admins, puissent
                  inviter des utilisateurs" — ouvrir la modale de gestion des
                  participants (voir plus bas) est désormais accessible aux
                  admins, pas seulement aux super admins. Réorganiser/
                  supprimer un canal reste réservé aux super admins. */}
              <button
                onClick={() => openChannelMembersModal(c.id)}
                className="p-1 text-slate-500 hover:text-[#F7BC5F]"
                title="Choisir les participants du canal"
              >
                <Users className="w-3 h-3" />
              </button>
              {isSuperAdmin && (
                <>
                  <button onClick={() => setNewSubChannelFor(c.id)} className="p-1 text-slate-500 hover:text-[#F7BC5F]" title="Ajouter un sous-dossier">
                    <FolderPlus className="w-3 h-3" />
                  </button>
                  <button onClick={() => deleteChannel(c)} className="p-1 text-slate-500 hover:text-rose-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {isSuperAdmin && newSubChannelFor === c.id && (
          <div className="flex items-center gap-1 px-1 pl-4">
            <input
              autoFocus
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addChannel(c.project_id, c.id)}
              placeholder="Nom du sous-dossier"
              className="flex-1 bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
            />
            <button onClick={() => addChannel(c.project_id, c.id)} className="p-1 text-[#F7BC5F]"><Plus className="w-3.5 h-3.5" /></button>
            <button onClick={() => setNewSubChannelFor(null)} className="p-1 text-slate-500"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {aDesEnfants && expandedChannels[c.id] && (
          <div className="pl-4 space-y-1">
            {enfants.map((enfant, j) => renderCanal(enfant, enfants, j))}
          </div>
        )}
      </div>
    );
  };

  // Ouvre le modal "Membres" d'un projet et charge la liste
  const openMembersModal = async (projectId: string) => {
    setMembersModalProjectId(projectId);
    setMemberPickerQuery('');
    setMembersLoading(true);
    try {
      // Correctif (7 septembre, « Philippe Serra ») : cette fonction avait
      // sa propre requête profils, indépendante de ensureProfilesLoaded()
      // — donc `agencyIdsByUid` (nécessaire à memberablePeople pour ne
      // proposer que les membres de la bonne agence) restait vide tant que
      // la modale "Nouvelle conversation"/"Nouveau dossier" n'avait pas été
      // ouverte au moins une fois.
      const [{ data: members }] = await Promise.all([
        supabase.from('chat_project_members').select('*').eq('project_id', projectId),
        ensureProfilesLoaded(),
      ]);

      if (membersModalProjectIdRef.current !== projectId) return;
      setProjectMembers((members as ChatProjectMember[]) || []);
    } finally {
      setMembersLoading(false);
    }
  };

  // Bug nº 6 (consigne du 1er septembre), troisieme partie. Signale a la
  // recette : « quand je cree le dossier, elle ne recoit aucune notification ».
  // La creation ecrivait le dossier, son canal et ses participants, puis
  // s'arretait. Meme RPC que partout ailleurs — pas de second systeme. Le
  // risque de doublon a ete leve par le test lui-meme : aucune notification
  // n'arrivait, donc aucun declencheur base ne couvre ce cas.
  const notifierAjoutAuDossier = async (
    projectId: string,
    nomDuDossier: string,
    destinataires: string[],
  ) => {
    if (!currentUser) return;
    const cibles = Array.from(new Set(destinataires.filter((uid) => uid && uid !== currentUser.uid)));
    if (cibles.length === 0) return;
    try {
      await Promise.all(
        cibles.map((uid) =>
          supabase.rpc('create_notification', {
            _user_id: uid,
            _type: 'message',
            _title: '📁 Ajouté à un dossier de projet',
            _message: `${displayName} t'a ajouté au dossier « ${nomDuDossier} ».`,
            _entity_type: 'chat_project',
            _entity_id: projectId,
            _agency_id: /^[0-9a-f-]{36}$/i.test(activeAgency.id) ? activeAgency.id : null,
            _metadata: { url: '/messagerie' },
          } as any)
        )
      );
    } catch (e) {
      // Une notification qui echoue ne doit jamais faire echouer la creation.
      console.warn('Notification d\'ajout au dossier impossible :', e);
    }
  };

  /**
   * Crée un dossier de projet dans l'AGENCE ACTIVE, avec ses participants.
   *
   * L'agence est posée sur le dossier : `loadProjectsAndChannels` ne charge
   * que `agency_id = agence active` (plus les dossiers marqués « toutes
   * agences », comme « 3 Entités »). Chaque agence garde donc sa propre vue,
   * sans que personne ait à filtrer quoi que ce soit à la main.
   *
   * Un canal « Général » est créé dans la foulée : un dossier sans canal
   * n'affiche rien et n'a aucun usage.
   */
  const createProject = async () => {
    const nom = newProjectName.trim();
    if (!nom || !currentUser) return;
    setCreatingProject(true);
    setProjectError(null);
    try {
      const projectId = crypto.randomUUID();
      const { error } = await supabase.from('chat_projects').insert({
        id: projectId,
        name: nom,
        agency_id: activeAgency.id,
        created_by: currentUser.uid,
        position: projects.length,
      } as any);
      if (error) { setProjectError(error.message); return; }

      const { error: canalError } = await supabase.from('chat_channels').insert({
        project_id: projectId,
        name: 'Général',
        position: 0,
        created_by: currentUser.uid,
      } as any);
      if (canalError) {
        // Pas de dossier vide laissé derrière : sans canal il serait inerte.
        await supabase.from('chat_projects').delete().eq('id', projectId);
        setProjectError(`Canal non créé : ${canalError.message}`);
        return;
      }

      const participants = Array.from(newProjectMemberIds);
      if (participants.length > 0) {
        // L'echec de cet ajout etait avale en silence : la fenetre se fermait
        // comme si tout allait bien, et le dossier se retrouvait sans aucun
        // participant. On le dit maintenant, comme pour le canal juste avant.
        const { error: membresError } = await supabase.from('chat_project_members').insert(
          participants.map((uid) => ({ project_id: projectId, user_id: uid, added_by: currentUser.uid })) as any,
        );
        if (membresError) {
          setProjectError(`Participants non ajoutés : ${membresError.message}`);
          return;
        }
        await notifierAjoutAuDossier(projectId, nom, participants);
      }

      setShowAddProject(false);
      setNewProjectName('');
      setNewProjectMemberIds(new Set());
      setNewProjectQuery('');
      await loadProjectsAndChannels();
    } finally {
      setCreatingProject(false);
    }
  };

  const addMember = async (projectId: string, userId: string) => {
    if (!isAdmin || !currentUser) return;
    const { data, error } = await supabase
      .from('chat_project_members')
      .insert({ project_id: projectId, user_id: userId, added_by: currentUser.uid })
      .select()
      .single();
    if (error) {
      // Signalé (4 septembre, Immosphera) : « je ne peux pas inviter les
      // autres équipes » — l'ajout d'un membre d'une autre agence était
      // refusé côté serveur (RLS), mais cet échec restait avalé en
      // silence : rien ne distinguait ça d'un bouton qui ne fait rien. Le
      // super admin peut désormais inviter n'importe qui (voir migration
      // 20260904130000) ; pour toute AUTRE cause de refus, l'erreur est au
      // moins visible maintenant.
      toast.error(`Participant non ajouté : ${error.message}`);
      return;
    }
    if (data) {
      setProjectMembers((prev) => [...prev, data as ChatProjectMember]);
      // Même règle qu'à la création : on prévient la personne qu'on vient de
      // l'ajouter, sinon elle découvre le dossier par hasard.
      const dossier = projects.find((p) => p.id === projectId);
      await notifierAjoutAuDossier(projectId, dossier ? dossier.name : 'un dossier', [userId]);
    }
  };

  const removeMember = async (member: ChatProjectMember) => {
    if (!isAdmin) return;
    if (!confirm('Retirer ce membre de cet espace ?')) return;
    await supabase.from('chat_project_members').delete().eq('id', member.id);
    setProjectMembers((prev) => prev.filter((m) => m.id !== member.id));
  };

  // ── Membres d'un CANAL (restriction optionnelle) ─────────────────────
  const openChannelMembersModal = async (channelId: string) => {
    setMembersModalChannelId(channelId);
    setChannelMemberPickerQuery('');
    setChannelMembersLoading(true);
    try {
      const [{ data: membres }] = await Promise.all([
        supabase.from('chat_channel_members').select('*').eq('channel_id', channelId),
        ensureProfilesLoaded(),
      ]);
      if (membersModalChannelIdRef.current !== channelId) return;
      setChannelMembers((membres as ChatChannelMember[]) || []);
    } finally {
      setChannelMembersLoading(false);
    }
  };

  const addChannelMember = async (channelId: string, userId: string) => {
    if (!isAdmin || !currentUser) return;
    const channel = Object.values(channelsByProject).flat().find((c) => c.id === channelId);
    if (!channel) return;
    // Signalé (16 septembre, Réseaux sociaux/Immosphera) : « Laetitia et
    // Christophe ne reçoivent aucune notification » — en base, ils
    // n'étaient dans AUCUN chat_project_members pour ce dossier, alors
    // qu'ils étaient bien invités à leur canal. Les policies RLS des
    // messages exigent les DEUX (dossier ET canal) : sans le premier, rien
    // ne passe (ni lecture, ni notification), silencieusement.
    //
    // Cause : ce garde-fou s'appuyait sur `projectMembers`, un state local
    // rempli UNIQUEMENT en ouvrant le popup "Gérer les membres" du DOSSIER
    // — jamais chargé quand on invite quelqu'un directement depuis un
    // CANAL. Et l'insertion elle-même n'avait aucune gestion d'erreur : un
    // échec restait invisible. Remplacé par un upsert inconditionnel et
    // idempotent (peu importe l'état local), avec son erreur affichée.
    const { error: erreurDossier } = await supabase
      .from('chat_project_members')
      .upsert(
        { project_id: channel.project_id, user_id: userId, added_by: currentUser.uid } as any,
        { onConflict: 'project_id,user_id', ignoreDuplicates: true }
      );
    if (erreurDossier) {
      toast.error(`Participant non ajouté au dossier : ${erreurDossier.message}`);
      return;
    }
    const { data, error } = await supabase
      .from('chat_channel_members')
      .insert({ channel_id: channelId, user_id: userId, added_by: currentUser.uid } as any)
      .select()
      .single();
    if (error) {
      toast.error(`Participant non ajouté : ${error.message}`);
      return;
    }
    if (data) {
      setChannelMembers((prev) => [...prev, data as ChatChannelMember]);
      // Restriction automatique (voir can_view_chat_channel) : le compteur
      // local suffit à faire apparaître le cadenas tout de suite, sans
      // recharger toute la liste des canaux.
      setChannelMemberCounts((prev) => ({ ...prev, [channelId]: (prev[channelId] || 0) + 1 }));
      const dossier = projects.find((p) => p.id === channel.project_id);
      await notifierAjoutAuDossier(channel.project_id, `${dossier?.name || 'un dossier'} — ${channel.name}`, [userId]);
    }
  };

  const removeChannelMember = async (member: ChatChannelMember) => {
    if (!isAdmin) return;
    await supabase.from('chat_channel_members').delete().eq('id', member.id);
    setChannelMembers((prev) => prev.filter((m) => m.id !== member.id));
    setChannelMemberCounts((prev) => ({ ...prev, [member.channel_id]: Math.max(0, (prev[member.channel_id] || 1) - 1) }));
  };

  const membersModalProject = projects.find((p) => p.id === membersModalProjectId) || null;
  // Signalé (7 septembre, « Philippe Serra ») : deux comptes du même nom
  // existent (un par agence — voir agency_members), et le sélecteur les
  // proposait TOUS les deux, quelle que soit l'agence du dossier. Un
  // dossier appartenant à une agence précise (agency_id non nul — le
  // groupe partagé "3 Entités" reste, lui, ouvert à tout le monde) ne
  // propose plus que les personnes membres de CETTE agence.
  const memberablePeople = allProfiles.filter(
    (p) =>
      !projectMembers.some((m) => m.user_id === p.uid) &&
      (!membersModalProject?.agency_id || (agencyIdsByUid[p.uid] || []).includes(membersModalProject.agency_id)) &&
      (p.displayName.toLowerCase().includes(memberPickerQuery.toLowerCase()) ||
        p.email.toLowerCase().includes(memberPickerQuery.toLowerCase()))
  );

  const membersModalChannel = Object.values(channelsByProject).flat().find((c) => c.id === membersModalChannelId) || null;
  const membersModalChannelProject = membersModalChannel ? projects.find((p) => p.id === membersModalChannel.project_id) || null : null;
  // Même filtre par agence que memberablePeople — un canal restreint reste
  // à l'intérieur du dossier et de son agence, super admin excepté (RLS).
  const channelMemberablePeople = allProfiles.filter(
    (p) =>
      !channelMembers.some((m) => m.user_id === p.uid) &&
      (!membersModalChannelProject?.agency_id || (agencyIdsByUid[p.uid] || []).includes(membersModalChannelProject.agency_id)) &&
      (p.displayName.toLowerCase().includes(channelMemberPickerQuery.toLowerCase()) ||
        p.email.toLowerCase().includes(channelMemberPickerQuery.toLowerCase()))
  );

  const formatTime = (d: string) =>
    new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // Sur mobile, le chat est un panneau à la fois (liste OU conversation),
  // avec un bouton retour — la mise en page desktop (liste + conversation
  // côte à côte) reste inchangée en tapant `w-72` en dur. Sans ça, sur un
  // écran étroit le canal actif se retrouvait écrasé/superposé à la liste.
  const isMobile = useIsMobile();
  const isCoarsePointer = useIsCoarsePointer();
  // Signalé (31/08/2026) : "Natacha ne peut pas modifier ni supprimer les
  // messages qu'elle met dans le chat". Les boutons existaient bien, mais en
  // `opacity-0 group-hover:opacity-100` : ils n'apparaissent qu'au SURVOL de
  // la souris. Sur un écran tactile il n'y a pas de survol — ils restaient
  // donc invisibles et inatteignables. Ils ont donc été affichés en
  // permanence dès qu'il n'y a pas de pointeur fin.
  // Suite (4 septembre) : « ne mets pas toujours le crayon et la poubelle à
  // côté des messages, ça ne sert à rien ». Sur écran tactile ils ne sont
  // plus permanents : un appui BREF sur le message les fait apparaître (un
  // second appui, ou l'appui sur un autre message, les referme). Un appui
  // LONG n'ouvre rien — il laisse le navigateur faire sa sélection de texte
  // native, donc « copier le texte ou une partie du texte ». Un appui qui se
  // déplace est un défilement : rien non plus. Sur ordinateur, le survol
  // reste exactement le comportement d'origine.
  const pointeurTactile = isMobile || isCoarsePointer;
  const classesOutilsMessage = (id: string) =>
    pointeurTactile
      ? (messageOutilsFor === id ? 'opacity-100' : 'hidden')
      : 'opacity-0 group-hover:opacity-100';
  const gestesMessage = (id: string) =>
    !pointeurTactile
      ? {}
      : {
          onPointerDown: (e: React.PointerEvent) => {
            appuiMessageRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
          },
          onPointerUp: (e: React.PointerEvent) => {
            const depart = appuiMessageRef.current;
            appuiMessageRef.current = null;
            if (!depart) return;
            // Un appui sur un bouton, un lien ou un lecteur média garde son
            // propre rôle (agrandir la photo, ouvrir le lien, écouter le vocal).
            if ((e.target as HTMLElement).closest('button, a, audio, video, input, textarea')) return;
            // 400 ms : au-delà, c'est un appui long (sélection de texte).
            if (Date.now() - depart.t > 400) return;
            // 10 px : au-delà, le doigt a fait défiler la conversation.
            if (Math.abs(e.clientX - depart.x) > 10 || Math.abs(e.clientY - depart.y) > 10) return;
            // Une sélection de texte en cours ne doit pas être balayée.
            if ((window.getSelection()?.toString() || '').length > 0) return;
            setMessageOutilsFor((v) => (v === id ? null : id));
          },
        };
  const mobileShowingConversation = tab === 'conversations' ? !!activeConversationId : !!activeChannel;
  const goBackToList = () => {
    if (tab === 'conversations') setActiveConversationId(null);
    else setActiveChannel(null);
  };

  // Signalé (4 septembre, deux captures) : « quand je clique dans le message
  // pour écrire et que j'abaisse le clavier, j'ai un écart tout en bas, ce
  // n'est pas figé » et « le clavier monte trop haut ».
  //
  // Sur iPhone, le clavier ne rétrécit PAS la page : il se pose par-dessus.
  // La racine de l'application est haute de 100dvh (App.tsx), donc son bas
  // se retrouve caché sous le clavier — et pour garder le champ de saisie
  // visible, iOS fait défiler la PAGE entière vers le haut. D'où les deux
  // symptômes : pendant la frappe, tout le chat remonte bien plus haut que
  // nécessaire (le composeur flotte loin au-dessus du clavier) ; et à la
  // fermeture du clavier, ce défilement de page ne revient pas toujours à
  // zéro, ce qui laisse une bande vide en bas.
  //
  // Le viewport VISUEL, lui, connaît la hauteur réellement visible, clavier
  // déduit. On y cale la hauteur du chat et on annule le défilement de page
  // devenu inutile : le composeur se pose alors exactement sur le clavier,
  // et rien ne dépasse à sa fermeture. Uniquement sur téléphone et
  // uniquement quand le chat est à l'écran ; ailleurs, `h-full` reprend la
  // main comme avant (précédent identique dans AssistantIAView.tsx pour la
  // fenêtre de Nova, déjà en production).
  const [hauteurVisible, setHauteurVisible] = useState<number | null>(null);
  // Clavier ouvert : le rembourrage bas de la barre de saisie, calé sur la
  // zone sûre de l'écran (barre gestuelle), n'a plus lieu d'être — c'est le
  // clavier qui occupe cette place. Sans ça, le composeur flotterait une
  // cinquantaine de pixels au-dessus des touches.
  const [clavierOuvert, setClavierOuvert] = useState(false);
  const rembourrageBarre = clavierOuvert ? { paddingBottom: '0.75rem' } : undefined;
  // Signalé (10 septembre, Sylvain Grazia, iPhone) : « j'ai un espace tout
  // en bas, ce n'est pas figé au niveau du remplissage de l'écran ».
  //
  // Fausse piste écartée : d'abord soupçonné comme un bug Android (ce
  // correctif s'appliquait à tort à tout `isMobile`, pas seulement iOS —
  // réservé à iOS depuis, ce qui reste juste en soi), mais Sylvain confirme
  // utiliser un iPhone — donc ni la cause ni le correctif pour LUI.
  //
  // Vraie cause : `hauteurVisible` restait appliqué EN PERMANENCE dès que
  // le chat est actif sur iOS, clavier ouvert ou non — figeant la hauteur
  // du conteneur sur le dernier `visualViewport.height` mesuré, y compris
  // une fois le clavier refermé. Si cette dernière mesure ne correspondait
  // plus exactement à l'écran réellement disponible (barre d'adresse
  // Safari qui se rétracte/réapparaît, cas où aucun resize ne se
  // redéclenche entre-temps), rien ne revenait jamais à `h-full` (100dvh) —
  // la bande figée en bas persistait indéfiniment, même clavier fermé.
  // Corrigé : `hauteurVisible` n'est appliqué QUE pendant que le clavier
  // est réellement ouvert (`clavierOuvert`) ; dès qu'il se ferme, on
  // relâche la main et `h-full`/100dvh reprend le dessus, qui suit
  // nativement la vraie fenêtre visible sans jamais se figer.
  const isIOSClavier = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isMobile || !isActive || !isIOSClavier) {
      setHauteurVisible(null);
      setClavierOuvert(false);
      return;
    }
    const appliquer = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      // Un clavier prend au moins un cinquième de l'écran ; en dessous, ce
      // n'est qu'une variation de barre système, pas un clavier.
      const ouvert = window.innerHeight - vv.height > window.innerHeight * 0.2;
      setClavierOuvert(ouvert);
      setHauteurVisible(ouvert ? Math.round(vv.height) : null);
    };
    // Rattrapage (10 septembre, persiste après un premier correctif) :
    // fermer le clavier via le petit bouton dédié du clavier iOS (plutôt
    // qu'en perdant le focus autrement) ne redéclenche pas toujours
    // `resize` sur `visualViewport` de façon fiable pendant l'animation —
    // parfois un seul événement arrive, avec une valeur encore intermédiaire
    // (mi-animation), jamais suivi d'un second qui corrigerait. Un
    // rattrapage différé, une fois l'animation forcément terminée, sécurise
    // la mesure finale — même principe que le rattrapage à 150ms déjà
    // utilisé plus haut pour le défilement (repère "Ticket #9").
    let settle: number | null = null;
    const appliquerAvecRattrapage = () => {
      appliquer();
      if (settle) window.clearTimeout(settle);
      settle = window.setTimeout(appliquer, 350);
    };
    appliquer();
    vv.addEventListener('resize', appliquerAvecRattrapage);
    vv.addEventListener('scroll', appliquerAvecRattrapage);
    // Filet supplémentaire : la perte de focus d'un champ de saisie est le
    // signal le plus direct qu'un clavier vient de se fermer, indépendant
    // de `visualViewport` — capturé en phase de capture pour intercepter
    // n'importe quel champ (texte des conversations ET des canaux).
    const onBlurCapture = (e: FocusEvent) => {
      const cible = e.target as HTMLElement | null;
      if (cible?.tagName !== 'TEXTAREA') return;
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
  }, [isMobile, isActive, isIOSClavier]);

  return (
    <div
      className="h-full flex flex-col bg-[#050f11] text-white"
      style={hauteurVisible ? { height: `${hauteurVisible}px` } : undefined}
    >
      {/* Barre de retour mobile — le chat prend tout l'écran sur mobile (la
          barre de navigation du bas est masquée par App.tsx), ce bouton est
          donc le seul moyen de "sortir" et de faire réapparaître la barre du
          bas + les autres panneaux. Masquée dès qu'une conversation/canal est
          ouvert : la flèche retour locale (goBackToList) prend le relais pour
          revenir à la liste, sinon les deux boutons retour s'empilaient. */}
      {isMobile && onExitMobile && !mobileShowingConversation && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-white/20 pt-[calc(env(safe-area-inset-top,0px)+1.1rem)]">
          <button
            onClick={onExitMobile}
            className="p-2.5 -ml-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 flex items-center gap-1.5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-semibold">Retour</span>
          </button>
        </div>
      )}

      {/* Tabs — masqués sur mobile une fois une conversation ouverte, pour
          laisser toute la place au panneau de discussion. */}
      {(!isMobile || !mobileShowingConversation) && (
      /* Bug nº 3 (consigne du 1er septembre) : sur téléphone, les trois
         onglets plus le bouton « Nouveau » dépassaient la largeur de l'écran.
         Marges resserrées sur mobile uniquement, et la rangée peut défiler
         si elle reste trop large. Rien ne change sur ordinateur. */
      /* 3 septembre (capture iPhone de Christophe) : la rangée défilait, le
         troisième onglet « Partagés » restait caché derrière « Nouveau » et
         rien n'était aligné. Sur téléphone, les trois onglets se partagent
         maintenant la largeur à parts égales, sur une seule ligne, et
         « Nouveau » devient un simple « + » rond à droite. Ordinateur
         inchangé. */
      <div className={`flex items-center justify-between gap-2 ${isMobile ? 'px-3' : 'px-4'} py-3 border-b border-white/20 shrink-0`}>
        <div className={isMobile ? 'flex-1 min-w-0 grid grid-cols-3 gap-1.5' : 'flex items-center min-w-0 overflow-x-auto custom-scrollbar gap-2'}>
          {TABS.map((t) => {
            // Demandé : "un compteur sur conversation" — total des messages
            // non lus toutes conversations confondues, affiché directement
            // sur l'onglet (même source que les pastilles par conversation
            // et le badge global du menu, pour rester cohérent partout).
            const tabUnread = t.id === 'conversations'
              ? Object.values(unreadByConversation).reduce((sum, n) => sum + n, 0)
              : t.id === 'projets'
              ? Object.values(unreadByChannel).reduce((sum, n) => sum + n, 0)
              : 0;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`${isMobile ? 'w-full min-w-0 justify-center px-1.5 gap-1 text-[13px]' : 'shrink-0 px-4 gap-2 text-sm'} py-2 rounded-xl font-semibold flex items-center transition-all ${
                  tab === t.id ? 'bg-[#F7BC5F] text-slate-950' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <t.icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{t.label}</span>
                {tabUnread > 0 && (
                  <span className={`min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    tab === t.id ? 'bg-slate-950 text-[#F7BC5F]' : 'bg-[#F7BC5F] text-slate-950'
                  }`}>
                    {tabUnread > 9 ? '9+' : tabUnread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* "Documents" épinglé — super admins uniquement (5 octobre) :
              accès global, recherchable, à toutes les pièces jointes
              envoyées dans la messagerie (conversations + canaux), pour
              retrouver un document sans se souvenir de la conversation où
              il a été envoyé. */}
          {isSuperAdmin && (
            <button
              onClick={ouvrirDocuments}
              aria-label="Documents"
              title="Tous les documents envoyés dans la messagerie"
              className={`shrink-0 ${isMobile ? 'w-10 h-10 rounded-full justify-center' : 'px-3.5 py-2 rounded-xl gap-1.5'} text-sm font-bold bg-white/10 text-white hover:bg-white/20 flex items-center border border-white/10`}
            >
              <FileText className={isMobile ? 'w-4 h-4' : 'w-4 h-4'} />
              {!isMobile && 'Documents'}
            </button>
          )}
          {tab === 'conversations' && (
            <button
              onClick={() => { setShowNewConvModal(true); ensureProfilesLoaded(); }}
              aria-label="Nouvelle conversation"
              title="Nouvelle conversation"
              className={`shrink-0 ${isMobile ? 'w-10 h-10 rounded-full justify-center' : 'px-4 py-2 rounded-xl gap-1.5'} text-sm font-bold bg-[#F7BC5F] text-slate-950 hover:bg-[#d4a83b] flex items-center`}
            >
              <Plus className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
              {!isMobile && 'Nouveau'}
            </button>
          )}
        </div>
      </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Folder tree */}
        {tab === 'projets' && (!isMobile || !activeChannel) && (
          <div className={`${isMobile ? 'w-full' : 'w-72 shrink-0'} border-r border-white/20 overflow-y-auto custom-scrollbar p-3 space-y-2`}>
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Projets</span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => { setProjectError(null); setShowAddProject(true); void ensureProfilesLoaded(); }}
                  title="Créer un dossier de projet"
                  className="w-7 h-7 rounded-lg bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 flex items-center justify-center shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
            {projects.map((project, pi) => {
              // Espace commun "3 Entités" : agency_id null → mis en évidence par un cadre jaune
              const isSpecialGroup = project.agency_id === null;
              return (
              // Ticket (nouvelle base, signalé) : texte plus grand + séparateurs
              // entre les projets sur mobile.
              <React.Fragment key={project.id}>
              {isMobile && pi > 0 && <div className="h-px bg-white/10 mx-1 my-1" />}
              <div className="space-y-1">
                <div
                  className={`w-full flex items-center gap-1 rounded-xl bg-[#0b1c1e] border transition-colors ${
                    isSpecialGroup
                      ? 'border-[#F7BC5F] ring-1 ring-[#F7BC5F]/50'
                      : 'border-white/20 hover:border-[#F7BC5F]/40'
                  }`}
                >
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [project.id]: !p[project.id] }))}
                    className={`flex-1 flex items-center justify-between min-w-0 font-bold ${isMobile ? 'px-3 py-3.5 text-base' : 'px-3 py-2 text-sm'}`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {isSpecialGroup ? (
                        <Crown className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                      ) : (
                        <Folder className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                      )}
                      {project.name}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0 ml-2">
                      {(() => {
                        const projetUnread = (channelsByProject[project.id] || [])
                          .filter((c) => !c.parent_channel_id)
                          .reduce((sum, c) => sum + unreadCanalRecursif(c.id), 0);
                        return projetUnread > 0 ? (
                          <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-[#F7BC5F] text-slate-950">
                            {projetUnread > 9 ? '9+' : projetUnread}
                          </span>
                        ) : null;
                      })()}
                      <span className="text-[10px] text-slate-400">
                        {(channelsByProject[project.id] || []).length} canaux
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => openMembersModal(project.id)}
                    className="p-1.5 mr-1.5 rounded-lg text-slate-400 hover:text-[#F7BC5F] hover:bg-white/5 shrink-0"
                    title="Gérer les membres"
                  >
                    <Users className="w-3.5 h-3.5" />
                  </button>
                </div>

                {expanded[project.id] && (
                  <div className="pl-3 space-y-1">
                    {(() => {
                      const racines = (channelsByProject[project.id] || []).filter((c) => !c.parent_channel_id);
                      return racines.map((c, i) => renderCanal(c, racines, i));
                    })()}

                    {isSuperAdmin && (
                      newChannelFor === project.id ? (
                        <div className="flex items-center gap-1 px-1">
                          <input
                            autoFocus
                            value={newChannelName}
                            onChange={(e) => setNewChannelName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addChannel(project.id)}
                            placeholder="Nom du canal"
                            className="flex-1 bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                          />
                          <button onClick={() => addChannel(project.id)} className="p-1 text-[#F7BC5F]"><Plus className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setNewChannelFor(null)} className="p-1 text-slate-500"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setNewChannelFor(project.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-[#F7BC5F] hover:bg-white/5"
                        >
                          <FolderPlus className="w-3 h-3" /> Ajouter un canal
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
              </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Conversations list */}
        {tab === 'conversations' && (!isMobile || !activeConversationId) && (
          <div className={`${isMobile ? 'w-full' : 'w-72 shrink-0'} border-r border-white/20 overflow-y-auto custom-scrollbar p-3 space-y-2`}>
            <div className="relative mb-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full bg-[#0b1c1e] border border-[#153c3f] rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
              />
            </div>
            {conversationsLoading ? (
              <p className="text-xs text-slate-500 text-center py-6">Chargement…</p>
            ) : filteredConversations.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">Aucune conversation. Cliquez sur "Nouveau" pour en démarrer une.</p>
            ) : (
              filteredConversations.map((c, i) => {
                const unread = unreadByConversation[c.id] || 0;
                return (
                // Ticket #225 : refonte visuelle — avatar plus grand, nom
                // plus lisible, vrai aperçu du dernier message + heure au
                // lieu de "Groupe"/"Message direct" fixe, plus d'espace
                // entre les entrées. Comportement d'envoi/permissions/
                // pièces jointes/notifications inchangé (uniquement l'affichage).
                <React.Fragment key={c.id}>
                  {isMobile && i > 0 && <div className="h-px bg-white/10 mx-2" />}
                  <button
                    onClick={() => openConversation(c.id)}
                    className={`w-full flex items-center gap-3 rounded-xl border text-left transition-colors ${
                      isMobile ? 'px-3 py-3' : 'px-3 py-3'
                    } ${
                      activeConversationId === c.id ? 'bg-[#F7BC5F]/20 border-[#F7BC5F]/40' : 'border-white/10 hover:bg-white/5 hover:border-[#F7BC5F]/40'
                    }`}
                  >
                    <div className={`rounded-full bg-[#0b1c1e] border border-[#153c3f] flex items-center justify-center font-bold shrink-0 overflow-hidden text-sm ${isMobile ? 'w-12 h-12' : 'w-11 h-11'} ${activeConversationId === c.id ? 'text-[#F7BC5F]' : 'text-slate-300'}`}>
                      {conversationAvatarUrl(c) ? (
                        <img src={conversationAvatarUrl(c)!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        conversationLabel(c).slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`font-bold truncate ${isMobile ? 'text-base' : 'text-sm'} ${activeConversationId === c.id ? 'text-[#F7BC5F]' : 'text-white'}`}>
                          {conversationLabel(c)}
                        </p>
                        {conversationTime(c.id) && (
                          <span className={`shrink-0 text-[10px] ${unread > 0 ? 'text-[#F7BC5F] font-bold' : 'text-slate-500'}`}>
                            {conversationTime(c.id)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className={`truncate ${isMobile ? 'text-sm' : 'text-xs'} ${unread > 0 ? 'text-slate-200 font-semibold' : 'text-slate-500'}`}>
                          {lastMessagePreview(c.id)}
                        </p>
                        {unread > 0 && (
                          <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-[#F7BC5F] text-slate-950 text-[10px] font-black flex items-center justify-center">
                            {unread > 9 ? '9+' : unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </React.Fragment>
                );
              })
            )}
          </div>
        )}

        {/* Conversation panel — masqué sur mobile tant qu'aucun canal/conversation
            n'est ouvert, pour ne jamais se superposer à la liste. */}
        <div className={`flex-1 flex-col min-w-0 ${isMobile ? (mobileShowingConversation ? 'flex' : 'hidden') : 'flex'}`}>
          {tab === 'conversations' ? (
            activeConversationId ? (
              <>
                {/* Signalé : ce header remplace la barre du haut (qui a son
                    padding de sécurité) une fois la conversation ouverte,
                    sans jamais reprendre ce padding — il se retrouvait sous
                    l'encoche/la barre de statut, invisible et inatteignable
                    sur mobile. */}
                <div className={`px-5 py-3.5 border-b border-white/20 flex items-center gap-2 ${isMobile ? 'pt-[calc(env(safe-area-inset-top,0px)+0.875rem)]' : ''}`}>
                  {isMobile && (
                    <button onClick={goBackToList} aria-label="Revenir à la liste" className="p-3 -ml-2 mr-0.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 shrink-0">
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <MessageSquare className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                  <span className="font-bold truncate flex-1 min-w-0">
                    {conversationLabel(conversations.find((c) => c.id === activeConversationId))}
                  </span>
                  {/* "chaque utilisateur puisse inviter [...] et inviter
                      plusieurs utilisateurs si possible" — réservé aux
                      groupes : une conversation directe reste un échange à
                      deux, "Nouveau groupe" existe déjà pour en démarrer un
                      à plusieurs. */}
                  {conversations.find((c) => c.id === activeConversationId)?.type === 'group' && (
                    <button
                      type="button"
                      onClick={() => {
                        setInviteConvQuery('');
                        setSelectedInviteIds(new Set());
                        setShowInviteConvModal(true);
                        void ensureProfilesLoaded();
                      }}
                      title="Inviter des participants"
                      aria-label="Inviter des participants"
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-[#F7BC5F] transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {!isMobile && <span className="text-xs font-semibold">Inviter</span>}
                    </button>
                  )}
                </div>

                <div ref={convScrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
                  {convMessages.length === 0 ? (
                    <p className="text-center text-sm text-slate-500 py-10">Aucun message pour l'instant. Lancez la conversation !</p>
                  ) : (
                    <>
                    {convHasMoreOlder && (
                      <button
                        type="button"
                        onClick={async () => {
                          // Garde la position de lecture ancrée sur le même
                          // message pendant l'ajout des plus anciens au-dessus
                          // (sinon la vue saute au dernier message tout en bas).
                          const pane = convScrollRef.current;
                          const previousHeight = pane?.scrollHeight ?? 0;
                          await loadOlderConvMessages();
                          requestAnimationFrame(() => {
                            if (pane) pane.scrollTop = pane.scrollHeight - previousHeight;
                          });
                        }}
                        disabled={loadingOlderConv}
                        className="w-full text-center text-xs font-semibold text-slate-400 hover:text-[#F7BC5F] py-2 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
                      >
                        {loadingOlderConv ? 'Chargement…' : 'Charger les messages précédents'}
                      </button>
                    )}
                    {convMessages.map((m) => {
                      const mine = m.user_id === currentUser?.uid;
                      const author = profileByUid[m.user_id];
                      const isEditing = editingConvMsgId === m.id;
                      const grouped: Record<string, { userId: string; emoji: string }[]> = {};
                      (convReactions[m.id] || []).forEach((r) => { (grouped[r.emoji] ||= []).push(r); });

                      return (
                        <div
                          key={m.id}
                          id={`msg-${m.id}`}
                          className={`group flex flex-col ${mine ? 'items-end' : 'items-start'} ${
                            highlightedMessageId === m.id ? 'message-highlight-flash rounded-2xl' : ''
                          }`}
                        >
                          {/* Signalé (4 septembre, captures mobile) : « les
                              messages envoyés sont trop concentrés sur la
                              droite, ils ne prennent pas toute la largeur ».
                              80 % d'un écran de téléphone laisse une marge
                              perdue qui écrase le texte en colonne étroite.
                              92 % sur téléphone, la valeur d'avant à partir du
                              format tablette : sur ordinateur, rien ne bouge. */}
                          <div className={`flex items-end gap-1.5 ${isEditing ? 'w-full max-w-full' : 'max-w-[92%] sm:max-w-[80%]'} ${mine ? 'flex-row-reverse' : ''}`} {...gestesMessage(m.id)}>
                            <div className={`px-3.5 py-2 rounded-2xl text-sm ${isEditing ? 'w-full' : ''} ${
                              mine ? 'bg-[#F7BC5F] text-slate-950 font-medium' : 'bg-[#0b1c1e] border border-[#153c3f] text-white'
                            }`}>
                              {!mine && <p className="text-[10px] font-bold text-[#F7BC5F] mb-0.5">{author?.displayName || 'Utilisateur'}</p>}

                              {isEditing ? (
                                // Demandé (7 septembre) : « le texte soit beaucoup
                                // plus grand [...] qu'il prenne la largeur de
                                // l'écran » — zone d'édition pleine largeur, texte
                                // à la même taille que le reste du chat (text-sm).
                                <div className="flex flex-col gap-2 w-full">
                                  <textarea
                                    value={editingConvMsgText}
                                    onChange={(e) => setEditingConvMsgText(e.target.value)}
                                    className="bg-transparent rounded-lg p-2.5 text-sm text-inherit border border-black/20 focus:outline-none resize-none w-full"
                                    rows={4}
                                    autoFocus
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setEditingConvMsgId(null)} className="text-[10px] opacity-70 hover:opacity-100">Annuler</button>
                                    <button type="button" onClick={() => void handleSaveEditConvMsg(m.id)} className="text-[10px] font-bold underline">Enregistrer</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {/* Signalé (29/09/2026) : "on ne peut pas copier-coller le texte
                                      d'un message" — cause : la racine de l'appli (App.tsx) porte
                                      `select-none` pour tout le CRM (évite la sélection accidentelle
                                      de libellés/boutons au doigt), ce qui désactivait aussi la
                                      sélection du texte des messages, jamais réactivée localement.
                                      `select-text` la restaure ici, sans toucher au reste de l'appli. */}
                                  {m.kind === 'text' && <p className="whitespace-pre-line select-text">{linkifyText(m.body || '', mine)}</p>}
                                  {/* Signalé (30/08/2026, capture à l'appui) : "comme ils sont gros...
                                      divise par exemple par cinq" — une mascotte Nova envoyée comme
                                      message (insertConvMessage('image', ...)) était traitée
                                      exactement comme une VRAIE photo jointe (jusqu'à 220px). Taille
                                      dédiée, plus calme, et alignée sur celle déjà utilisée côté
                                      canaux d'équipe (voir isNovaReaction(m.data?.body) plus bas,
                                      "format cohérent" entre les deux surfaces de chat). Une vraie
                                      photo jointe par un utilisateur garde sa taille d'origine. */}
                                  {m.kind === 'image' && m.attachment_url && isNovaReaction(m.attachment_url) && (
                                    <button type="button" onClick={() => setConvLightboxUrl(m.attachment_url)} className="block cursor-pointer">
                                      <img src={m.attachment_url} alt="Nova" className="w-14 h-14 object-contain" />
                                    </button>
                                  )}
                                  {m.kind === 'image' && m.attachment_url && !isNovaReaction(m.attachment_url) && (
                                    <button type="button" onClick={() => setConvLightboxUrl(m.attachment_url)} className="block cursor-pointer">
                                      <img src={m.attachment_url} alt="Pièce jointe" className="max-w-[220px] rounded-xl" />
                                    </button>
                                  )}
                                  {/* controlsList="nofullscreen" : voir ClientProfileView.tsx — le
                                      plein écran natif fait perdre notre croix de fermeture. */}
                                  {/* Signalé (23 octobre) : « la vidéo ne peut pas se lire... Natacha
                                      par exemple ne peut pas la lire » — un lien Drive (voir
                                      uploadVideoToDriveFolder) est une page de visionneuse, illisible
                                      par un <video>, d'où l'iframe. Le repli local (pas de Workspace
                                      connecté) reste un vrai fichier, lisible en <video>. */}
                                  {m.kind === 'video' && m.attachment_url && (
                                    isDriveEmbedUrl(m.attachment_url) ? (
                                      <iframe src={m.attachment_url} allow="autoplay" className="max-w-[220px] w-[220px] h-[160px] rounded-xl bg-black border-0" />
                                    ) : (
                                      <video src={m.attachment_url} controls controlsList="nofullscreen" className="max-w-[220px] rounded-xl bg-black" />
                                    )
                                  )}
                                  {m.kind === 'voice' && m.attachment_url && (
                                    <div className="flex items-center gap-2">
                                      <audio src={m.attachment_url} controls className="max-w-[220px] h-9" />
                                      {m.attachment_duration ? <span className="text-[10px] opacity-70">{m.attachment_duration}s</span> : null}
                                    </div>
                                  )}
                                  {m.kind === 'file' && m.attachment_url && (
                                    <button
                                      type="button"
                                      onClick={() => void ouvrirPieceJointe(m.attachment_url as string)}
                                      className="underline text-xs text-left"
                                    >
                                      {m.body || 'Document'}
                                    </button>
                                  )}
                                  {m.edited_at && <span className="text-[9px] italic opacity-60 ml-1">(modifié)</span>}
                                </>
                              )}
                            </div>

                            {!isEditing && (
                              <div className={`${classesOutilsMessage(m.id)} transition-opacity flex items-center gap-0.5 shrink-0`}>
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      const opening = showConvReactionPickerFor !== m.id;
                                      if (opening) {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const pickerHeight = 380;
                                        setConvReactionPickerUp(rect.bottom + pickerHeight > window.innerHeight);
                                      }
                                      setShowConvReactionPickerFor(opening ? m.id : null);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                                    title="Réagir"
                                  >
                                    <Smile className="w-3.5 h-3.5" />
                                  </button>
                                  {showConvReactionPickerFor === m.id && (() => {
                                    const pickerItems = (
                                      <>
                                        {NOVA_QUICK_REACTIONS.map((e) => (
                                          <button key={e} type="button" onClick={() => void handleToggleConvReaction(m.id, e)} className={`${isMobile || isCoarsePointer ? 'text-4xl p-2' : 'text-3xl p-2'} leading-none hover:scale-110 transition-transform rounded-xl hover:bg-white/10`}>
                                            {/* Équilibre Novadji / emojis (31/08/2026 :
                                                "les Novadji ne sont pas de la même taille,
                                                équilibre le tout sur ordinateur et téléphone
                                                pour que cela soit visible").
                                                Une image PNG et un glyphe emoji ne se
                                                comparent pas à taille de boîte égale : le PNG
                                                Nova comporte une marge transparente, donc son
                                                dessin occupe environ 70 % du carré. Il faut
                                                l'agrandir d'environ un tiers pour un poids
                                                visuel identique.
                                                  souris   : emoji 30px (text-3xl) → Nova 48px
                                                  tactile  : emoji 36px (text-4xl) → Nova 56px
                                                Bug nº 8 (consigne du 1er septembre) : à la souris
                                                les emojis étaient trop petits pour être visés. */}
                                            {renderEmojiOrNova(e, isMobile || isCoarsePointer ? 'w-14 h-14' : 'w-12 h-12')}
                                          </button>
                                        ))}
                                        {/* Suite #240 : séparation visuelle nette entre les
                                            mini-expressions Nova et "les vrais" emojis. */}
                                        <div className={`${isMobile || isCoarsePointer ? 'col-span-5' : 'col-span-6'} h-px bg-[#153c3f] my-1`} />
                                        {QUICK_EMOJIS.map((e) => (
                                          <button key={e} type="button" onClick={() => void handleToggleConvReaction(m.id, e)} className={`${isMobile || isCoarsePointer ? 'text-4xl p-2' : 'text-3xl p-2'} leading-none hover:scale-110 transition-transform rounded-xl hover:bg-white/10`}>
                                            {e}
                                          </button>
                                        ))}
                                      </>
                                    );
                                    return (
                                      <>
                                        {/* Signalé : "je clique à côté sur ordinateur... l'écran
                                            des emojis ne se ferme pas" — le calque invisible
                                            plein écran (fixed inset-0) censé fermer au clic
                                            extérieur ne couvrait pas fiablement tout l'écran
                                            (position:fixed peut se retrouver cadré par un
                                            ancêtre avec transform/filter au lieu du viewport).
                                            Remplacé par une détection de clic extérieur sur
                                            `document` (voir reactionPickerRef), indépendante de
                                            tout positionnement CSS. */}
                                        {isMobile ? (
                                          // Signalé : "la fenêtre va tout à gauche, pas centrée
                                          // au portable" — le panneau était ancré (absolute
                                          // left-0/right-0) au bouton dans la bulle, dont la
                                          // position horizontale varie selon l'expéditeur et le
                                          // texte ; sur un écran étroit il débordait hors-champ.
                                          // Sur mobile on l'affiche plutôt en recouvrement
                                          // plein écran centré, indépendant de la position du
                                          // bouton d'origine.
                                          <div className="fixed inset-0 z-20 flex items-center justify-center p-6">
                                            <div
                                              ref={reactionPickerRef}
                                              className="grid grid-cols-5 gap-2.5 bg-[#0b1c1e] border border-[#153c3f] rounded-2xl p-4 shadow-xl w-full max-w-[min(440px,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto custom-scrollbar"
                                            >
                                              {pickerItems}
                                            </div>
                                          </div>
                                        ) : (
                                          <div ref={reactionPickerRef} className={`absolute z-20 ${convReactionPickerUp ? 'bottom-full mb-1' : 'top-full mt-1'} grid grid-cols-6 gap-2 bg-[#0b1c1e] border border-[#153c3f] rounded-xl p-3 shadow-xl w-max max-w-[min(440px,calc(100vw-1.5rem))] max-h-[340px] overflow-y-auto custom-scrollbar ${mine ? 'right-0' : 'left-0'}`}>
                                            {pickerItems}
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                                {m.kind === 'image' && m.attachment_url && (
                                  <button
                                    type="button"
                                    onClick={() => setConvLightboxUrl(m.attachment_url)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                                    title="Aperçu"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {mine && m.kind === 'text' && (
                                  <button
                                    type="button"
                                    onClick={() => { setEditingConvMsgId(m.id); setEditingConvMsgText(m.body || ''); }}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                                    title="Modifier"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {/* Demande explicite (30/08/2026) : "en tant
                                    qu'administrateur, je ne peux pas
                                    supprimer des messages" — la suppression
                                    admin n'avait été ajoutée que dans les
                                    canaux de projets (portée demandée à
                                    l'origine), jamais dans les conversations
                                    directes. Même règle qu'un admin/
                                    super_admin dans les canaux (voir
                                    isAdmin, plus haut). */}
                                {(mine || isAdmin) && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteConvMsg(m.id)}
                                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"
                                    title="Supprimer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {Object.keys(grouped).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(grouped).map(([emoji, list]) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => void handleToggleConvReaction(m.id, emoji)}
                                  className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border ${list.some((r) => r.userId === currentUser?.uid) ? 'border-[#F7BC5F]/50 bg-[#F7BC5F]/10' : 'border-[#153c3f] bg-[#0b1c1e]'}`}
                                >
                                  <span>{renderEmojiOrNova(emoji, 'w-[1.4em] h-[1.4em]')}</span>
                                  {list.length > 1 && <span className="text-[10px] text-slate-400">{list.length}</span>}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] text-slate-500">{formatTime(m.created_at)}</span>
                            {/* Accusé de lecture (#24) : coché uniquement sur mes
                                propres messages, une fois lus par l'autre. Qui
                                exactement (30/09/2026) : voir showConvReadByFor
                                plus haut — survol pour l'info-bulle rapide,
                                clic pour la fenêtre détaillée (readReceiptModal,
                                16 octobre). */}
                            {mine && (() => {
                              const lecteurs = (convReadBy[m.id] || []).filter((r) => r.userId !== currentUser?.uid);
                              return (
                                <div className="relative">
                                  <button
                                    type="button"
                                    onMouseEnter={() => setShowConvReadByFor(m.id)}
                                    onMouseLeave={() => setShowConvReadByFor(null)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowConvReadByFor(null);
                                      setReadReceiptModal({
                                        readers: lecteurs.map((r) => ({
                                          userId: r.userId,
                                          name: profileByUid[r.userId]?.displayName || 'Utilisateur',
                                          readAt: r.readAt,
                                        })),
                                      });
                                    }}
                                    className="flex items-center"
                                  >
                                    {lecteurs.length > 0 ? (
                                      <CheckCheck className="w-3.5 h-3.5 text-[#F7BC5F]" aria-label="Lu" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5 text-slate-600" aria-label="Envoyé" />
                                    )}
                                  </button>
                                  {showConvReadByFor === m.id && (
                                    <div className="absolute z-20 bottom-full right-0 mb-1 bg-[#0b1c1e] border border-[#153c3f] rounded-lg px-2.5 py-1.5 shadow-xl text-[10px] text-slate-300 whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis">
                                      {lecteurs.length === 0
                                        ? 'Pas encore vu'
                                        : `Vu par ${lecteurs.map((r) => profileByUid[r.userId]?.displayName || 'Utilisateur').join(', ')}`}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                    </>
                  )}
                </div>

                {/* Demande explicite : bloc de saisie un peu trop imposant
                    en bas (surtout le bouton micro, nettement plus gros que
                    les autres icônes) — padding réduit et micro remis à une
                    taille cohérente avec les autres boutons, sans toucher
                    aux autres icônes (image/emoji/envoyer). */}
                {/* Demande explicite (11 septembre) : « agrandis l'espace
                    d'écriture du message sur la gauche et sur la droite,
                    prends le maximum d'espace » — moins de marge horizontale
                    sur mobile (le menu "+" a repris la place des icônes qui
                    la justifiaient), inchangé sur ordinateur. */}
                {/* Même correctif que côté canaux (11 septembre) : espace
                    réduit au strict nécessaire sous la barre de saisie. */}
                <div className="relative p-3 max-sm:px-1 max-sm:pb-[env(safe-area-inset-bottom,0px)] border-t border-white/20 space-y-2.5" style={rembourrageBarre}>
                  <input ref={convImageInputRef} type="file" accept="image/*" hidden onChange={handleConvImageSelected} />
                  <input ref={convCameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleConvImageSelected} />
                  <input ref={convFileInputRef} type="file" accept="application/pdf" hidden onChange={handleConvFileSelected} />
                  <input ref={convVideoInputRef} type="file" accept="video/*" hidden onChange={handleConvVideoSelected} />

                  {isRecordingConv && (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                      </span>
                      <span className="text-xs font-mono text-rose-300 flex-1">
                        {Math.floor(recordingConvSeconds / 60)}:{String(recordingConvSeconds % 60).padStart(2, '0')} — Enregistrement...
                      </span>
                      <button type="button" onClick={() => void handleStopRecordingConv(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300" title="Annuler">
                        <X className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => void handleStopRecordingConv(false)} className="p-1.5 rounded-lg bg-rose-500 text-white" title="Arrêter et réécouter">
                        <Square className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Vocal terminé : réécoute puis envoi. Même gabarit que la
                      barre d'enregistrement juste au-dessus, en liseré neutre
                      (border-white/20, déjà celui du champ de saisie) pour
                      qu'on voie tout de suite qu'on n'enregistre plus. Le
                      lecteur est celui du navigateur : lecture, pause et
                      déplacement dans la bande, sans rien à réécrire. */}
                  {convVocalPret && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/20">
                      <audio
                        src={convVocalPret.dataUrl}
                        controls
                        className="flex-1 h-9 min-w-0"
                        aria-label="Réécouter le message vocal"
                      />
                      <button
                        type="button"
                        onClick={() => setConvVocalPret(null)}
                        disabled={uploadingConvMedia}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 disabled:opacity-40"
                        title="Supprimer et recommencer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void envoyerVocalConv()}
                        disabled={uploadingConvMedia}
                        className="w-10 h-10 rounded-full flex items-center justify-center bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-30 text-slate-950"
                        title={`Envoyer le vocal (${convVocalPret.duree}s)`}
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Signalé (30/08/2026) : "quand on tape un message, on ne
                      voit pas la barre" — border-[#153c3f] (quasi identique
                      au fond bg-[#0b1c1e] juste à côté) remplacé par
                      border-white/20, déjà le liseré "visible" éprouvé
                      ailleurs dans l'appli (ex. barre de recherche Équipe) et
                      déjà couvert par le remap mode jour existant
                      (index.css, [class*="border-[#144447"]). Le doré au
                      focus (déjà présent) est inchangé. */}
                  {/* Demandé (4 septembre) : « quand on va à droite en tapant
                      du texte, la hauteur augmente pour voir le message en
                      entier et faire les corrections, comme sur un téléphone ».
                      D'où le passage d'un champ à une ligne à une zone de texte
                      qui grandit : le texte revient à la ligne au lieu de
                      défiler hors du cadre, et la zone s'étire jusqu'à six
                      lignes environ avant de défiler à son tour. Entrée envoie
                      toujours ; Maj+Entrée fait un retour à la ligne. Le coin
                      arrondi passe de `rounded-full` à `rounded-3xl` : un
                      arrondi total sur plusieurs lignes rognerait le texte. */}
                  <textarea
                    ref={convTextareaRef}
                    rows={1}
                    value={convDraft}
                    onChange={(e) => setConvDraft(e.target.value)}
                    // Demande explicite (23 septembre) : Entrée ne doit
                    // qu'aller à la ligne, ordinateur comme téléphone —
                    // seul le bouton d'envoi envoie. Avant, Entrée envoyait
                    // sur ordinateur (Maj+Entrée pour la ligne) ; ce
                    // comportement spécifique au clavier physique est
                    // retiré, le textarea garde son insertion de retour à
                    // la ligne par défaut, plus rien à intercepter ici.
                    placeholder="Écrire un message..."
                    disabled={isRecordingConv}
                    className="w-full resize-none bg-[#0b1c1e] border border-white/20 rounded-3xl px-5 max-sm:px-3 py-2.5 text-sm text-white leading-relaxed focus:outline-none focus:border-[#F7BC5F] disabled:opacity-40"
                  />

                  {/* Signalé (17/09/2026) : le bouton flottant de dictée
                      ajouté au-dessus de la barre débordait sur le dernier
                      message (position `absolute`/`bottom-full` mal vue à
                      l'usage réel). Remis à sa place naturelle, DANS la
                      rangée de boutons, colonne centrale. `grid-cols-3`
                      (colonnes égales) devient `grid-cols-[auto_1fr_auto]` :
                      les colonnes gauche/droite prennent exactement la
                      largeur de leur contenu et collent aux bords, la
                      colonne centrale (1fr) absorbe tout l'espace restant —
                      le bouton Envoyer colle donc au bord droit réel de
                      l'écran, plus au bord d'un simple tiers de grille. */}
                  <div className="grid grid-cols-[auto_1fr_auto] items-center">
                    <div className="flex items-center gap-2 justify-self-start">
                      {/* Téléphone : un seul « + » à la place des trois
                          boutons, qui ouvre la liste des options. Les trois
                          boutons restent dans le document (leurs sélecteurs
                          emoji/Nova s'y ancrent) mais sont masqués sous le
                          format tablette — sur ordinateur, rien ne change. */}
                      <div className="sm:hidden">
                        <button
                          type="button"
                          onClick={() => setShowConvPlus((v) => !v)}
                          disabled={uploadingConvMedia || isRecordingConv}
                          className="w-11 h-11 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                          title="Ajouter"
                          aria-label="Ajouter une photo, un émoji ou un Novadji"
                        >
                          <Plus className="w-6 h-6 sm:w-5 sm:h-5" />
                        </button>
                        {/* Demandé (4 septembre) : « quand on appuie sur le
                            Plus, une animation pour la fenêtre qui monte vers
                            le haut, qui prenne toute la largeur du téléphone ».
                            La liste devient donc une feuille qui glisse depuis
                            le bas de l'écran, bord à bord, avec un voile
                            derrière qui la referme d'un appui.
                            Portail vers document.body : même raison que la
                            visionneuse de photos plus bas — un `position:
                            fixed` imbriqué dans un ancêtre animé perd son
                            repère (la fenêtre) et se recale sur cet ancêtre.
                            Les entrées gardent exactement leurs classes
                            d'avant : seul le cadre change. */}
                        {showConvPlus && createPortal(
                          <div className="fixed inset-0 z-[70] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Ajouter à votre message">
                            <button
                              type="button"
                              aria-label="Fermer"
                              onClick={() => fermerFeuille(() => setShowConvPlus(false))}
                              className={`absolute inset-0 bg-black/60 backdrop-blur-sm duration-200 ${feuilleQuitte ? 'animate-out fade-out-0 fill-mode-forwards' : 'animate-in fade-in-0'}`}
                            />
                            <div className={`relative bg-[#0b1c1e] border-t border-white/20 rounded-t-3xl p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-xl ease-out ${feuilleQuitte ? 'animate-out slide-out-to-bottom-full fill-mode-forwards duration-200' : 'animate-in slide-in-from-bottom-full duration-300'}`}>
                              <div className="mx-auto mt-1 mb-2 h-1 w-10 rounded-full bg-white/20" />
                              <button
                                type="button"
                                onClick={() => { fermerFeuille(() => setShowConvPlus(false)); convCameraInputRef.current?.click(); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <Camera className="w-5 h-5 text-[#F7BC5F]" /> Prendre une photo
                              </button>
                              <button
                                type="button"
                                onClick={() => { fermerFeuille(() => setShowConvPlus(false)); convImageInputRef.current?.click(); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <ImageIcon className="w-5 h-5 text-[#F7BC5F]" /> Photo de la galerie
                              </button>
                              <button
                                type="button"
                                onClick={() => { fermerFeuille(() => setShowConvPlus(false)); convFileInputRef.current?.click(); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <Paperclip className="w-5 h-5 text-[#F7BC5F]" /> Document (PDF)
                              </button>
                              <button
                                type="button"
                                onClick={() => { fermerFeuille(() => setShowConvPlus(false)); convVideoInputRef.current?.click(); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <VideoIcon className="w-5 h-5 text-[#F7BC5F]" /> Vidéo (150 Mo max)
                              </button>
                              <button
                                type="button"
                                onClick={() => { fermerFeuille(() => setShowConvPlus(false)); setShowConvEmoji(true); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <Smile className="w-5 h-5 text-[#F7BC5F]" /> Émoticônes
                              </button>
                              <button
                                type="button"
                                onClick={() => { fermerFeuille(() => setShowConvPlus(false)); setShowConvNovaPicker(true); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <img src={NOVA_QUICK_REACTIONS[0]} alt="" className="w-5 h-5 object-contain" /> Novadji
                              </button>
                              {/* Demande explicite (11 septembre) : ajouter la
                                  dictée vocale et l'envoi différé dans le menu
                                  "+" mobile — "comme les vrais téléphones
                                  portables". Uniquement mobile : sur
                                  ordinateur les deux ont déjà leur propre
                                  icône dans la barre, qui a la place. */}
                              <button
                                type="button"
                                onClick={() => {
                                  fermerFeuille(() => setShowConvPlus(false));
                                  toggleDictee(isListeningConv, setIsListeningConv, recognitionConvRef, convDraft, setConvDraft);
                                }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <Mic2 className={`w-5 h-5 ${isListeningConv ? 'text-rose-400 animate-pulse' : 'text-[#F7BC5F]'}`} />
                                {isListeningConv ? 'Dictée en cours... (toucher pour arrêter)' : 'Dictée vocale'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { fermerFeuille(() => setShowConvPlus(false)); setShowConvSchedule(true); }}
                                className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                              >
                                <Clock className="w-5 h-5 text-[#F7BC5F]" /> Envoi différé
                              </button>
                              {/* Message vocal : retiré d'ici (17/09/2026) —
                                  redondant depuis que son bouton dédié (voir
                                  la rangée juste en dessous) est visible sur
                                  mobile aussi, plus seulement sur ordinateur. */}
                            </div>
                          </div>,
                          document.body
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => convImageInputRef.current?.click()}
                        disabled={uploadingConvMedia || isRecordingConv}
                        className="w-10 h-10 rounded-full hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                        title="Envoyer une image"
                      >
                        <ImageIcon className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => convFileInputRef.current?.click()}
                        disabled={uploadingConvMedia || isRecordingConv}
                        className="w-10 h-10 rounded-full hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                        title="Envoyer un PDF"
                      >
                        <Paperclip className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => convVideoInputRef.current?.click()}
                        disabled={uploadingConvMedia || isRecordingConv}
                        className="w-10 h-10 rounded-full hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                        title="Envoyer une vidéo (150 Mo max)"
                      >
                        <VideoIcon className="w-5 h-5" />
                      </button>
                      <div className="sm:relative" ref={convEmojiRef}>
                        <button
                          type="button"
                          onClick={() => setShowConvEmoji((v) => !v)}
                          className="w-10 h-10 rounded-full hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                          title="Emoji"
                        >
                          <Smile className="w-5 h-5" />
                        </button>
                        {showConvEmoji && (
                          <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-6 gap-2 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max max-sm:w-auto max-sm:right-0 max-sm:justify-items-center max-w-[min(440px,calc(100vw-1.5rem))] max-sm:max-w-none max-h-[340px] overflow-y-auto custom-scrollbar">
                            {QUICK_EMOJIS.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => setConvDraft((v) => v + e)}
                                className={`${isMobile || isCoarsePointer ? 'text-4xl p-2' : 'text-3xl p-2'} leading-none hover:scale-110 transition-transform rounded-xl hover:bg-white/10`}
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="sm:relative" ref={convNovaPickerRef}>
                        <button
                          type="button"
                          onClick={() => setShowConvNovaPicker((v) => !v)}
                          className="w-10 h-10 rounded-full hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                          title="Envoyer une mascotte Nova"
                        >
                          <img src="/nova/expressions/nova-neutre.png" alt="Nova" className="w-6 h-6 object-contain" />
                        </button>
                        {showConvNovaPicker && (
                          <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-3 gap-2.5 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max max-sm:w-auto max-sm:right-0 max-sm:justify-items-center">
                            {NOVA_QUICK_REACTIONS.map((src) => (
                              <button
                                key={src}
                                type="button"
                                onClick={() => { setShowConvNovaPicker(false); void insertConvMessage('image', src); }}
                                className="w-20 h-20 hover:scale-110 transition-transform rounded-xl hover:bg-white/10 p-1.5"
                              >
                                <img src={src} alt="Nova" className="w-full h-full object-contain" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Demandé (17/09/2026) : « je veux que ça soit un
                        enregistrement audio comme dans le "+", [...] qu'on
                        puisse avant de l'envoyer le réécouter ou l'annuler »
                        — revenu sur la demande du 11 septembre qui l'avait
                        masqué sur mobile (déplacé dans le menu "+", voir
                        "Message vocal" plus haut, retiré du menu puisqu'il
                        a maintenant sa place ici) : visible partout
                        (mobile ET ordinateur), même bouton, même
                        comportement. La réécoute/annulation avant envoi
                        existaient déjà (voir plus haut le bloc
                        `convVocalPret`) — rien à ajouter de ce côté. */}
                    <button
                      type="button"
                      onClick={() => (isRecordingConv ? void handleStopRecordingConv(false) : void handleStartRecordingConv())}
                      disabled={uploadingConvMedia || !!convVocalPret}
                      className="justify-self-center flex w-14 h-14 sm:w-12 sm:h-12 rounded-full items-center justify-center shadow-lg shadow-rose-500/30 transition-transform hover:scale-105 disabled:opacity-40 bg-rose-500/90 hover:bg-rose-500 text-white"
                      title="Message vocal"
                    >
                      <Mic className="w-6 h-6 sm:w-5 sm:h-5" />
                    </button>

                    <div className="flex items-center gap-2 justify-self-end">
                      {/* Envoi différé — placé à côté du bouton d'envoi plutôt
                          que dans le groupe emoji/nova/image ci-dessus :
                          signalé (4 septembre) que ce groupe, déjà tassé,
                          débordait sur le micro en mobile (icônes superposées)
                          une fois un 4e bouton ajouté — grille à trois
                          colonnes ÉGALES (voir plus haut), qui ne laisse
                          aucune marge pour grandir. Ce groupe-ci n'avait
                          jusqu'ici qu'un seul bouton (Envoyer) : il a la place.
                          Voir le commentaire détaillé sur les états
                          showConvSchedule/convScheduled plus haut. */}
                      {/* Demande explicite (11 septembre) : « j'ai toujours
                          les icônes sur la droite, il faut que tu les
                          enlèves » — l'horloge ci-dessous, maintenant
                          accessible depuis le menu "+" (voir plus haut),
                          restait EN PLUS affichée dans cette rangée sur
                          mobile, redondante et grignotant l'espace de
                          saisie. Le BOUTON est masqué sur mobile (visible
                          sur ordinateur, pas de menu "+" là-bas — voir
                          "pas desktop, car on a la place") ; le popup, lui,
                          doit rester dans le DOM sur mobile (ouvert
                          directement depuis le menu "+"), donc c'est le
                          bouton seul qui porte `hidden sm:flex`, pas le
                          conteneur. */}
                      <div className="relative" ref={convScheduleRef}>
                        <button
                          type="button"
                          onClick={() => setShowConvSchedule((v) => !v)}
                          className="relative w-11 h-11 sm:w-10 sm:h-10 rounded-full hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                          title="Programmer l'envoi"
                        >
                          <Clock className="w-6 h-6 sm:w-5 sm:h-5" />
                          {convScheduled.length > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#F7BC5F] text-slate-950 text-[10px] font-bold flex items-center justify-center">
                              {convScheduled.length}
                            </span>
                          )}
                        </button>
                        {showConvSchedule && (
                          <div className="absolute z-20 bottom-full mb-2 right-0 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-72 space-y-3">
                            {convScheduled.length > 0 && (
                              <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Programmés</p>
                                {convScheduled.map((m) => (
                                  <div key={m.id} className="flex items-center justify-between gap-2 text-xs text-slate-200 bg-white/5 rounded-lg px-2 py-1.5">
                                    <span className="truncate flex-1" title={m.body}>{formaterEcheance(m.scheduled_at)} — {m.body}</span>
                                    <button type="button" onClick={() => void annulerMessageProgramme(m.id, 'conversation')} className="text-slate-400 hover:text-white shrink-0" title="Annuler">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="space-y-2">
                              <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Programmer ce message</p>
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  value={convScheduleDate}
                                  onChange={(e) => setConvScheduleDate(e.target.value)}
                                  min={new Date().toISOString().slice(0, 10)}
                                  className="flex-1 bg-[#081318] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                                />
                                <input
                                  type="time"
                                  value={convScheduleTime}
                                  onChange={(e) => setConvScheduleTime(e.target.value)}
                                  className="flex-1 bg-[#081318] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => void programmerMessageConversation()}
                                disabled={!convDraft.trim()}
                                className="w-full py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-40 text-slate-950 text-xs font-semibold"
                              >
                                Programmer
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={sendConvMessage}
                        // Audit (10 septembre) : le bouton restait grisé tant
                        // qu'aucun texte n'était tapé, MÊME avec un vocal en
                        // attente de réécoute — on peut désormais l'envoyer
                        // depuis ici (voir le commentaire dans
                        // sendConvMessage), le bouton doit donc rester actif
                        // dans ce cas.
                        disabled={(!convDraft.trim() && !convVocalPret) || isRecordingConv}
                        className="w-11 h-11 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-30 text-slate-950"
                      >
                        <Send className="w-5 h-5 sm:w-4 sm:h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center bg-[#0b1c1e] border border-[#153c3f] rounded-3xl p-10 max-w-sm">
                  <div className="w-14 h-14 rounded-2xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="w-6 h-6 text-[#F7BC5F]" />
                  </div>
                  <h3 className="text-lg font-bold mb-1">Aucune conversation sélectionnée</h3>
                  <p className="text-sm text-slate-400">Choisissez une conversation à gauche, ou cliquez sur "Nouveau" pour en démarrer une.</p>
                </div>
              </div>
            )
          ) : activeChannel ? (
            <>
              <div className={`px-5 py-3.5 border-b border-white/20 flex items-center gap-2 ${isMobile ? 'pt-[calc(env(safe-area-inset-top,0px)+0.875rem)]' : ''}`}>
                {isMobile && (
                  <button onClick={goBackToList} aria-label="Revenir à la liste" className="p-3 -ml-2 mr-0.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 shrink-0">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <Hash className="w-4 h-4 text-[#F7BC5F]" />
                <span className="font-bold">{activeChannel.name}</span>
                {(channelMemberCounts[activeChannel.id] || 0) > 0 && (
                  <span title="Canal restreint à ses participants"><Lock className="w-3.5 h-3.5 text-[#F7BC5F]" /></span>
                )}
                {/* Voir qui est dans ce canal — demande explicite : « ici je
                    veux voir les collaborateurs qui sont dans le CRM » (en
                    étant sur un canal). Le bouton équivalent dans la liste
                    à gauche n'apparaît qu'au survol (réservé aux super
                    admins) : celui-ci reste visible pour tout le monde,
                    en lecture au minimum. */}
                <button
                  onClick={() => openChannelMembersModal(activeChannel.id)}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 shrink-0"
                  title="Voir les participants de ce canal"
                >
                  <Users className="w-3.5 h-3.5" />
                  {!isMobile && 'Participants'}
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
                {messages.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 py-10">Aucun message pour l'instant. Lancez la conversation !</p>
                ) : (
                  messages.map((m) => {
                    const mine = (m.sender_id || m.data?.sender_id) === currentUser?.uid;
                    const isNova = isNovaReaction(m.data?.body || '');
                    const isEditing = editingChannelMsgId === m.id;
                    const groupedReactions: Record<string, { userId: string; emoji: string }[]> = {};
                    (m.reactions || []).forEach((r) => { (groupedReactions[r.emoji] ||= []).push(r); });
                    return (
                    <div
                      key={m.id}
                      id={`msg-${m.id}`}
                      className={`group flex flex-col ${mine ? 'items-end' : 'items-start'} ${
                        highlightedMessageId === m.id ? 'message-highlight-flash rounded-2xl' : ''
                      }`}
                    >
                      {/* Même correctif de largeur que côté conversations
                          directes (voir le commentaire là-haut) — les canaux
                          étaient encore plus étroits : 70 %. */}
                      <div className={`flex items-end gap-1.5 ${isEditing ? 'w-full max-w-full' : 'max-w-[92%] sm:max-w-[70%]'} ${mine ? 'flex-row-reverse' : ''}`} {...gestesMessage(m.id)}>
                      <div className={`px-3.5 py-2 rounded-2xl text-sm ${isEditing ? 'w-full' : ''} ${
                        mine
                          ? 'bg-[#F7BC5F] text-slate-950 font-medium'
                          : 'bg-[#0b1c1e] border border-[#153c3f] text-white'
                      }`}>
                        {!mine && (
                          <p className="text-[10px] font-bold text-[#F7BC5F] mb-0.5">{m.data?.sender_name || 'Collaborateur'}</p>
                        )}
                        {/* Suite #260 : les canaux d'équipe n'ont pas de
                            colonne "pièce jointe" (texte uniquement, `data.body`)
                            — un message Nova envoyé depuis ce composeur y stocke
                            donc le CHEMIN de la mascotte comme corps, détecté et
                            rendu comme image ici plutôt que comme texte brut.
                            Taille alignée (30/08/2026) sur celle des conversations
                            directes ci-dessus — même "format cohérent" des deux
                            côtés du chat. */}
                        {isEditing ? (
                          <div className="flex flex-col gap-2 w-full">
                            <textarea
                              value={editingChannelMsgText}
                              onChange={(e) => setEditingChannelMsgText(e.target.value)}
                              className="bg-transparent rounded-lg p-2.5 text-sm text-inherit border border-black/20 focus:outline-none resize-none w-full"
                              rows={4}
                              autoFocus
                            />
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => setEditingChannelMsgId(null)} className="text-[10px] opacity-70 hover:opacity-100">Annuler</button>
                              <button type="button" onClick={() => void handleSaveEditChannelMsg(m.id)} className="text-[10px] font-bold underline">Enregistrer</button>
                            </div>
                          </div>
                        ) : isNova ? (
                          <img src={m.data?.body} alt="Nova" className="w-14 h-14 object-contain" />
                        ) : m.data?.kind === 'image' && m.data?.attachmentUrl ? (
                          /* Images et vocaux dans les canaux (31/08/2026) : le
                             média est rangé dans le JSONB `data`, les canaux
                             n'ayant pas les colonnes dédiées des conversations. */
                          <button type="button" onClick={() => setConvLightboxUrl(m.data.attachmentUrl ?? null)} className="block">
                            <img src={m.data.attachmentUrl} alt="Pièce jointe" className="max-w-[220px] max-h-[220px] rounded-xl object-cover" />
                          </button>
                        ) : m.data?.kind === 'video' && m.data?.attachmentUrl ? (
                          isDriveEmbedUrl(m.data.attachmentUrl) ? (
                            <iframe src={m.data.attachmentUrl} allow="autoplay" className="max-w-[220px] w-[220px] h-[160px] rounded-xl bg-black border-0" />
                          ) : (
                            <video src={m.data.attachmentUrl} controls controlsList="nofullscreen" className="max-w-[220px] rounded-xl bg-black" />
                          )
                        ) : m.data?.kind === 'voice' && m.data?.attachmentUrl ? (
                          <div className="flex items-center gap-2">
                            <audio controls preload="none" src={m.data.attachmentUrl} className="h-9 max-w-[220px]" />
                            {Boolean(m.data.attachmentDuration) && (
                              <span className="text-[10px] opacity-70">{m.data.attachmentDuration}s</span>
                            )}
                          </div>
                        ) : m.data?.kind === 'file' && m.data?.attachmentUrl ? (
                          // PDF dans un canal (5 octobre) : même rendu que les
                          // conversations directes (voir plus haut, m.kind === 'file').
                          <button
                            type="button"
                            onClick={() => void ouvrirPieceJointe(m.data.attachmentUrl as string)}
                            className="underline text-xs flex items-center gap-1.5 text-left"
                          >
                            <Paperclip className="w-3.5 h-3.5 shrink-0" />
                            {m.data.body || 'Document'}
                          </button>
                        ) : (
                          // select-text : voir le commentaire équivalent côté conversations
                          // directes plus haut (même correctif, même cause : select-none racine).
                          <p className="whitespace-pre-line select-text">{linkifyText(m.data?.body || '', mine)}</p>
                        )}
                      </div>
                      {/* Demande explicite (30/08/2026) : "chaque utilisateur qui
                          envoie un message [peut] le modifier ou le supprimer,
                          [et] le super admin ou admin pourra également supprimer
                          un message" — modifier réservé à l'auteur (et aux
                          messages texte, pas aux mascottes Nova), supprimer
                          ouvert à l'auteur ET à isAdmin (super_admin ou admin,
                          voir la définition en haut du composant). Réagir (25/09/2026),
                          lui, est ouvert à tout membre du canal — la barre d'outils
                          n'est donc plus conditionnée à (mine || isAdmin) comme avant,
                          seuls Modifier/Supprimer le restent individuellement. */}
                      {!isEditing && (
                        <div className={`${classesOutilsMessage(m.id)} transition-opacity flex items-center gap-0.5 shrink-0`}>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => {
                                const opening = showChannelReactionPickerFor !== m.id;
                                if (opening) {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const pickerHeight = 380;
                                  setChannelReactionPickerUp(rect.bottom + pickerHeight > window.innerHeight);
                                }
                                setShowChannelReactionPickerFor(opening ? m.id : null);
                              }}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                              title="Réagir"
                            >
                              <Smile className="w-3.5 h-3.5" />
                            </button>
                            {showChannelReactionPickerFor === m.id && (() => {
                              const pickerItems = (
                                <>
                                  {NOVA_QUICK_REACTIONS.map((e) => (
                                    <button key={e} type="button" onClick={() => void handleToggleChannelReaction(m.id, e)} className={`${isMobile || isCoarsePointer ? 'text-4xl p-2' : 'text-3xl p-2'} leading-none hover:scale-110 transition-transform rounded-xl hover:bg-white/10`}>
                                      {renderEmojiOrNova(e, isMobile || isCoarsePointer ? 'w-14 h-14' : 'w-12 h-12')}
                                    </button>
                                  ))}
                                  <div className={`${isMobile || isCoarsePointer ? 'col-span-5' : 'col-span-6'} h-px bg-[#153c3f] my-1`} />
                                  {QUICK_EMOJIS.map((e) => (
                                    <button key={e} type="button" onClick={() => void handleToggleChannelReaction(m.id, e)} className={`${isMobile || isCoarsePointer ? 'text-4xl p-2' : 'text-3xl p-2'} leading-none hover:scale-110 transition-transform rounded-xl hover:bg-white/10`}>
                                      {e}
                                    </button>
                                  ))}
                                </>
                              );
                              return isMobile ? (
                                <div className="fixed inset-0 z-20 flex items-center justify-center p-6">
                                  <div
                                    ref={channelReactionPickerRef}
                                    className="grid grid-cols-5 gap-2.5 bg-[#0b1c1e] border border-[#153c3f] rounded-2xl p-4 shadow-xl w-full max-w-[min(440px,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto custom-scrollbar"
                                  >
                                    {pickerItems}
                                  </div>
                                </div>
                              ) : (
                                <div ref={channelReactionPickerRef} className={`absolute z-20 ${channelReactionPickerUp ? 'bottom-full mb-1' : 'top-full mt-1'} grid grid-cols-6 gap-2 bg-[#0b1c1e] border border-[#153c3f] rounded-xl p-3 shadow-xl w-max max-w-[min(440px,calc(100vw-1.5rem))] max-h-[340px] overflow-y-auto custom-scrollbar ${mine ? 'right-0' : 'left-0'}`}>
                                  {pickerItems}
                                </div>
                              );
                            })()}
                          </div>
                          {mine && !isNova && (
                            <button
                              type="button"
                              onClick={() => { setEditingChannelMsgId(m.id); setEditingChannelMsgText(m.data?.body || ''); }}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                              title="Modifier"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {(mine || isAdmin) && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteChannelMsg(m.id)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"
                              title="Supprimer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      </div>

                      {Object.keys(groupedReactions).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(groupedReactions).map(([emoji, list]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => void handleToggleChannelReaction(m.id, emoji)}
                              className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border ${list.some((r) => r.userId === currentUser?.uid) ? 'border-[#F7BC5F]/50 bg-[#F7BC5F]/10' : 'border-[#153c3f] bg-[#0b1c1e]'}`}
                            >
                              <span>{renderEmojiOrNova(emoji, 'w-[1.4em] h-[1.4em]')}</span>
                              {list.length > 1 && <span className="text-[10px] text-slate-400">{list.length}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-slate-500">{formatTime(m.created_at)}</span>
                        {/* Signalé (12 septembre, « dans les 3 agences, et les
                            autres sûrement, on n'a plus les accusés de
                            lecture ») : le statut lu/non-lu existait déjà
                            (colonne read_by, déjà utilisée pour le badge non-
                            lu — voir loadUnreadByChannel) mais n'a jamais été
                            AFFICHÉ sur les messages d'un canal, contrairement
                            aux conversations directes (convReadBy plus haut,
                            même logique reprise ici : lu dès qu'un autre
                            membre que moi apparaît dans read_by). Qui
                            exactement (30/09/2026) : voir showChannelReadByFor
                            plus haut — utile surtout ici, un canal pouvant
                            avoir bien plus de deux membres. Survol pour
                            l'info-bulle rapide, clic pour la fenêtre détaillée
                            (readReceiptModal, 16 octobre). */}
                        {mine && (() => {
                          const lecteurs = (Array.isArray(m.read_by) ? m.read_by : []).filter((r) => r.userId !== currentUser?.uid);
                          return (
                            <div className="relative">
                              <button
                                type="button"
                                onMouseEnter={() => setShowChannelReadByFor(m.id)}
                                onMouseLeave={() => setShowChannelReadByFor(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowChannelReadByFor(null);
                                  setReadReceiptModal({
                                    readers: lecteurs.map((r) => ({
                                      userId: r.userId,
                                      name: r.userName || profileByUid[r.userId]?.displayName || 'Utilisateur',
                                      readAt: r.readAt,
                                    })),
                                  });
                                }}
                                className="flex items-center"
                              >
                                {lecteurs.length > 0 ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-[#F7BC5F]" aria-label="Lu" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 text-slate-600" aria-label="Envoyé" />
                                )}
                              </button>
                              {showChannelReadByFor === m.id && (
                                <div className="absolute z-20 bottom-full right-0 mb-1 bg-[#0b1c1e] border border-[#153c3f] rounded-lg px-2.5 py-1.5 shadow-xl text-[10px] text-slate-300 whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis">
                                  {lecteurs.length === 0
                                    ? 'Pas encore vu'
                                    : `Vu par ${lecteurs.map((r) => r.userName || profileByUid[r.userId]?.displayName || 'Utilisateur').join(', ')}`}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );})
                )}
              </div>

              {/* La rangée d'icônes est désormais enveloppée, pour pouvoir
                  poser au-dessus la barre de réécoute du vocal — exactement
                  le même agencement que le composeur des conversations
                  directes (bloc `space-y-2.5` plus haut). Tant qu'aucun vocal
                  n'attend, ce conteneur n'a qu'un enfant : rendu identique à
                  avant, aucune classe des boutons n'a bougé. */}
              {/* Même correctif que côté conversations directes (11
                  septembre) : moins de marge horizontale sur mobile. */}
              {/* Signalé (11 septembre, capture à l'appui, canal « général »)
                  : espace visible sous la barre de saisie sur mobile —
                  réduit au strict nécessaire (juste la zone sûre du bas,
                  sans marge ajoutée) plutôt que 1.5rem + zone sûre. */}
              <div className="relative p-4 max-sm:px-1 max-sm:pb-[env(safe-area-inset-bottom,0px)] border-t border-white/20 space-y-2.5" style={rembourrageBarre}>
                {channelVocalPret && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/20">
                    <audio
                      src={channelVocalPret.dataUrl}
                      controls
                      className="flex-1 h-9 min-w-0"
                      aria-label="Réécouter le message vocal"
                    />
                    <button
                      type="button"
                      onClick={() => setChannelVocalPret(null)}
                      disabled={uploadingChannelMedia}
                      className="p-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                      title="Supprimer et recommencer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void envoyerVocalChannel()}
                      disabled={uploadingChannelMedia}
                      className="p-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-30 text-slate-950"
                      title={`Envoyer le vocal (${channelVocalPret.duree}s)`}
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                {/* Ticket #10 (nouvelle base) : le composer des canaux d'équipe
                    n'avait aucun accès emoji — ajout d'un picker au même
                    endroit et avec la même palette élargie que côté messages
                    directs. */}
                {/* Téléphone : le « + » remplace les trois boutons (émoji,
                    Nova, photo) et libère la largeur de la barre de saisie.
                    Sur ordinateur il disparaît, les trois boutons reprennent
                    leur place d'origine. */}
                <div className="sm:hidden">
                  <button
                    type="button"
                    onClick={() => setShowChannelPlus((v) => !v)}
                    disabled={uploadingChannelMedia || isRecordingChannel}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                    title="Ajouter"
                    aria-label="Ajouter une photo, un émoji ou un Novadji"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  {/* Même feuille que côté conversation directe — voir le
                      commentaire détaillé là-bas. */}
                  {showChannelPlus && createPortal(
                    <div className="fixed inset-0 z-[70] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Ajouter à votre message">
                      <button
                        type="button"
                        aria-label="Fermer"
                        onClick={() => fermerFeuille(() => setShowChannelPlus(false))}
                        className={`absolute inset-0 bg-black/60 backdrop-blur-sm duration-200 ${feuilleQuitte ? 'animate-out fade-out-0 fill-mode-forwards' : 'animate-in fade-in-0'}`}
                      />
                      <div className={`relative bg-[#0b1c1e] border-t border-white/20 rounded-t-3xl p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-xl ease-out ${feuilleQuitte ? 'animate-out slide-out-to-bottom-full fill-mode-forwards duration-200' : 'animate-in slide-in-from-bottom-full duration-300'}`}>
                        <div className="mx-auto mt-1 mb-2 h-1 w-10 rounded-full bg-white/20" />
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); channelCameraInputRef.current?.click(); }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <Camera className="w-5 h-5 text-[#F7BC5F]" /> Prendre une photo
                        </button>
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); channelImageInputRef.current?.click(); }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <ImageIcon className="w-5 h-5 text-[#F7BC5F]" /> Photo de la galerie
                        </button>
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); channelFileInputRef.current?.click(); }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <Paperclip className="w-5 h-5 text-[#F7BC5F]" /> Document (PDF)
                        </button>
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); channelVideoInputRef.current?.click(); }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <VideoIcon className="w-5 h-5 text-[#F7BC5F]" /> Vidéo (150 Mo max)
                        </button>
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); setShowChannelEmoji(true); }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <Smile className="w-5 h-5 text-[#F7BC5F]" /> Émoticônes
                        </button>
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); setShowChannelNovaPicker(true); }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <img src={NOVA_QUICK_REACTIONS[0]} alt="" className="w-5 h-5 object-contain" /> Novadji
                        </button>
                        {/* Même ajout que côté conversations directes — voir
                            le commentaire détaillé plus haut. */}
                        <button
                          type="button"
                          onClick={() => {
                            fermerFeuille(() => setShowChannelPlus(false));
                            toggleDictee(isListeningChannel, setIsListeningChannel, recognitionChannelRef, draft, setDraft);
                          }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <Mic2 className={`w-5 h-5 ${isListeningChannel ? 'text-rose-400 animate-pulse' : 'text-[#F7BC5F]'}`} />
                          {isListeningChannel ? 'Dictée en cours... (toucher pour arrêter)' : 'Dictée vocale'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); setShowChannelSchedule(true); }}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10"
                        >
                          <Clock className="w-5 h-5 text-[#F7BC5F]" /> Envoi différé
                        </button>
                        {/* Message vocal (11 septembre, répété) : retiré de
                            la rangée sur mobile, déplacé ici. */}
                        <button
                          type="button"
                          onClick={() => { fermerFeuille(() => setShowChannelPlus(false)); void handleStartRecordingChannel(); }}
                          disabled={uploadingChannelMedia || !!channelVocalPret}
                          className="w-full flex items-center gap-3.5 px-3.5 py-3.5 rounded-xl text-[15px] text-slate-200 hover:bg-white/10 disabled:opacity-40"
                        >
                          <Mic className="w-5 h-5 text-[#F7BC5F]" /> Message vocal
                        </button>
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
                <div className="sm:relative" ref={channelEmojiRef}>
                  <button
                    type="button"
                    onClick={() => setShowChannelEmoji((v) => !v)}
                    className="w-10 h-10 rounded-xl hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                    title="Emoji"
                  >
                    <Smile className="w-5 h-5" />
                  </button>
                  {showChannelEmoji && (
                    <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-6 gap-2 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max max-sm:w-auto max-sm:right-0 max-sm:justify-items-center max-w-[min(440px,calc(100vw-1.5rem))] max-sm:max-w-none max-h-[340px] overflow-y-auto custom-scrollbar">
                      {QUICK_EMOJIS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setDraft((v) => v + e)}
                          className={`${isMobile || isCoarsePointer ? 'text-4xl p-2' : 'text-3xl p-2'} leading-none hover:scale-110 transition-transform rounded-xl hover:bg-white/10`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sm:relative" ref={channelNovaPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowChannelNovaPicker((v) => !v)}
                    className="w-10 h-10 rounded-xl hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                    title="Envoyer une mascotte Nova"
                  >
                    <img src="/nova/expressions/nova-neutre.png" alt="Nova" className="w-6 h-6 object-contain" />
                  </button>
                  {showChannelNovaPicker && (
                    <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-3 gap-2.5 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max max-sm:w-auto max-sm:right-0 max-sm:justify-items-center">
                      {NOVA_QUICK_REACTIONS.map((src) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => void sendNovaChannelMessage(src)}
                          className="w-20 h-20 hover:scale-110 transition-transform rounded-xl hover:bg-white/10 p-1.5"
                        >
                          <img src={src} alt="Nova" className="w-full h-full object-contain" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Voir commentaire équivalent côté conversations directes
                    plus haut — même correctif de liseré. */}
                <textarea
                  ref={channelTextareaRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  // Voir commentaire équivalent côté conversations directes
                  // (23 septembre) : Entrée n'envoie plus nulle part, ni
                  // ordinateur ni téléphone — seul le bouton d'envoi envoie.
                  placeholder="Écrire un message..."
                  /* `min-w-0` : signalé (4 septembre, capture du canal « Comm
                     générale » sur téléphone) — le bouton d'envoi, le micro et
                     l'horloge étaient absents de l'écran. Un champ de saisie
                     est un élément flex qui, par défaut, refuse de descendre
                     sous sa largeur naturelle (une vingtaine de caractères) :
                     sur un écran étroit, la rangée débordait et poussait les
                     trois derniers boutons hors du cadre, sans barre de
                     défilement pour les rattraper. Avec `min-w-0`, le champ
                     accepte de rétrécir et tous les boutons restent visibles.
                     Sur ordinateur, rien ne change : la place ne manquait pas. */
                  className="flex-1 min-w-0 resize-none bg-[#0b1c1e] border border-white/20 rounded-xl px-4 max-sm:px-2.5 py-2.5 text-sm text-white leading-relaxed focus:outline-none focus:border-[#F7BC5F]"
                />
                {/* Image et vocal dans les canaux (31/08/2026) — les
                    conversations directes les avaient depuis toujours, les
                    canaux de projet non. Même comportement, même rendu. */}
                <input
                  ref={channelImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleChannelImagePick(e.target.files?.[0] || null)}
                />
                <input
                  ref={channelCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void handleChannelImagePick(e.target.files?.[0] || null)}
                />
                <input
                  ref={channelFileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => void handleChannelFilePick(e.target.files?.[0] || null)}
                />
                <input
                  ref={channelVideoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => void handleChannelVideoPick(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => channelImageInputRef.current?.click()}
                  disabled={uploadingChannelMedia || isRecordingChannel}
                  title="Envoyer une image"
                  className="p-2.5 rounded-xl hidden sm:block text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => channelFileInputRef.current?.click()}
                  disabled={uploadingChannelMedia || isRecordingChannel}
                  title="Envoyer un PDF"
                  className="p-2.5 rounded-xl hidden sm:block text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => channelVideoInputRef.current?.click()}
                  disabled={uploadingChannelMedia || isRecordingChannel}
                  title="Envoyer une vidéo (150 Mo max)"
                  className="p-2.5 rounded-xl hidden sm:block text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                >
                  <VideoIcon className="w-4 h-4" />
                </button>
                {isRecordingChannel ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleStopRecordingChannel(true)}
                      title="Annuler"
                      className="p-2.5 rounded-xl text-slate-300 hover:bg-white/10"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStopRecordingChannel(false)}
                      title={`Arrêter et réécouter (${recordingChannelSeconds}s)`}
                      className="p-2.5 rounded-xl bg-rose-500 text-white"
                    >
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                  </>
                ) : (
                  // Même correctif que côté conversations directes (11
                  // septembre, répété) : retiré de la rangée sur mobile,
                  // déplacé dans le menu "+".
                  <button
                    type="button"
                    onClick={() => void handleStartRecordingChannel()}
                    disabled={uploadingChannelMedia || !!channelVocalPret}
                    title="Message vocal"
                    className="hidden sm:flex p-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}
                {/* Envoi différé — placé juste avant le bouton d'envoi
                    plutôt qu'entre les icônes emoji/Nova et le champ de
                    saisie, pour rester cohérent avec la conversation
                    directe (voir le correctif du 4 septembre là-bas : un
                    groupe déjà tassé débordait sur le micro en mobile).
                    Ici la rangée est en flex (le champ de saisie absorbe
                    l'espace restant), donc pas de superposition possible,
                    mais autant garder le même emplacement des deux côtés.
                    Voir le commentaire détaillé sur les états
                    showChannelSchedule/channelScheduled plus haut. */}
                {/* Même correctif que côté conversations directes (11
                    septembre) : bouton masqué sur mobile (accessible depuis
                    le menu "+"), popup laissé dans le DOM. */}
                <div className="relative" ref={channelScheduleRef}>
                  <button
                    type="button"
                    onClick={() => setShowChannelSchedule((v) => !v)}
                    className="relative p-2.5 rounded-xl hidden sm:flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                    title="Programmer l'envoi"
                  >
                    <Clock className="w-4 h-4" />
                    {channelScheduled.length > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#F7BC5F] text-slate-950 text-[10px] font-bold flex items-center justify-center">
                        {channelScheduled.length}
                      </span>
                    )}
                  </button>
                  {showChannelSchedule && (
                    <div className="absolute z-20 bottom-full mb-2 right-0 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-72 space-y-3">
                      {channelScheduled.length > 0 && (
                        <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Programmés</p>
                          {channelScheduled.map((m) => (
                            <div key={m.id} className="flex items-center justify-between gap-2 text-xs text-slate-200 bg-white/5 rounded-lg px-2 py-1.5">
                              <span className="truncate flex-1" title={m.body}>{formaterEcheance(m.scheduled_at)} — {m.body}</span>
                              <button type="button" onClick={() => void annulerMessageProgramme(m.id, 'channel')} className="text-slate-400 hover:text-white shrink-0" title="Annuler">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">Programmer ce message</p>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            value={channelScheduleDate}
                            onChange={(e) => setChannelScheduleDate(e.target.value)}
                            min={new Date().toISOString().slice(0, 10)}
                            className="flex-1 bg-[#081318] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                          />
                          <input
                            type="time"
                            value={channelScheduleTime}
                            onChange={(e) => setChannelScheduleTime(e.target.value)}
                            className="flex-1 bg-[#081318] border border-white/20 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void programmerMessageCanal()}
                          disabled={!draft.trim()}
                          className="w-full py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-40 text-slate-950 text-xs font-semibold"
                        >
                          Programmer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={sendMessage}
                  // Audit (10 septembre) : ce bouton n'avait AUCUN garde-fou
                  // `disabled`, contrairement à son équivalent en conversation
                  // directe — un tap dessus sans texte tapé (le cas normal
                  // juste après un enregistrement vocal) invoquait sendMessage
                  // qui ne faisait rien de visible. Même logique désormais que
                  // le composeur direct : actif si texte OU vocal en attente.
                  disabled={(!draft.trim() && !channelVocalPret) || isRecordingChannel}
                  className="p-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-30 text-slate-950"
                >
                  <Send className="w-4 h-4" />
                </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center bg-[#0b1c1e] border border-[#153c3f] rounded-3xl p-10 max-w-sm">
                <div className="w-14 h-14 rounded-2xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 flex items-center justify-center mx-auto mb-4">
                  <Folder className="w-6 h-6 text-[#F7BC5F]" />
                </div>
                <h3 className="text-lg font-bold mb-1">Aucun canal sélectionné</h3>
                <p className="text-sm text-slate-400">Choisissez un canal de projet à gauche pour consulter les échanges associés.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Gestion des membres d'un projet */}
      {membersModalProjectId && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setMembersModalProjectId(null)}
        >
          <div
            className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#F7BC5F]" />
                <h3 className="text-base font-bold">Membres — {membersModalProject?.name}</h3>
              </div>
              <button onClick={() => setMembersModalProjectId(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isAdmin && (
              <p className="text-[11px] text-slate-400 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                Seuls les administrateurs peuvent inviter ou retirer des membres.
              </p>
            )}

            {/* Liste des membres actuels */}
            <div className="space-y-1.5 overflow-y-auto custom-scrollbar max-h-56">
              {membersLoading ? (
                <p className="text-xs text-slate-500 py-4 text-center">Chargement…</p>
              ) : projectMembers.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">Aucun membre pour l'instant.</p>
              ) : (
                projectMembers.map((member) => {
                  const profile = allProfiles.find((p) => p.uid === member.user_id);
                  return (
                    <div key={member.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{profile?.displayName || member.user_id}</p>
                        {profile?.email && <p className="text-[10px] text-slate-400 truncate">{profile.email}</p>}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => removeMember(member)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                          title="Retirer ce membre"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Ajout d'un membre (admins uniquement) */}
            {isAdmin && (
              <div className="pt-3 border-t border-white/10 space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                  <UserPlus className="w-3.5 h-3.5 text-[#F7BC5F]" /> Inviter un membre
                </label>
                <input
                  value={memberPickerQuery}
                  onChange={(e) => setMemberPickerQuery(e.target.value)}
                  placeholder="Rechercher par nom ou email…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                />
                <div className="max-h-36 overflow-y-auto custom-scrollbar space-y-1">
                  {memberablePeople.slice(0, 20).map((p) => (
                    <button
                      key={p.uid}
                      onClick={() => membersModalProjectId && addMember(membersModalProjectId, p.uid)}
                      className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-left text-slate-300 hover:bg-white/5 hover:text-white"
                    >
                      <span className="truncate">{p.displayName}</span>
                      <Plus className="w-3.5 h-3.5 text-[#F7BC5F] shrink-0" />
                    </button>
                  ))}
                  {memberPickerQuery && memberablePeople.length === 0 && (
                    <p className="text-[11px] text-slate-500 px-1 py-1">Aucun résultat.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Gestion des participants d'un CANAL — demande explicite :
          « je veux choisir qui participe à chaque canal ». La restriction
          est automatique et absolue (16 septembre, suite à un signalement :
          une case à cocher séparée avait été oubliée sur 5 canaux, qui
          restaient donc ouverts à tout le dossier malgré des participants
          déjà invités) : dès qu'un participant est invité ci-dessous, le
          canal est restreint à lui/eux, sans bouton à activer. Retirer
          tout le monde rouvre automatiquement le canal à tout le dossier. */}
      {membersModalChannelId && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setMembersModalChannelId(null)}
        >
          <div
            className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#F7BC5F]" />
                <h3 className="text-base font-bold">Participants — {membersModalChannel?.name}</h3>
              </div>
              <button onClick={() => setMembersModalChannelId(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isAdmin && (
              <p className="text-[11px] text-slate-400 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                Seuls les admins et super admins peuvent inviter ou retirer des participants.
              </p>
            )}

            {membersModalChannel && (
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${
                  channelMembers.length > 0
                    ? 'bg-[#F7BC5F]/10 border-[#F7BC5F]/50 text-[#F7BC5F]'
                    : 'bg-white/5 border-white/10 text-slate-300'
                }`}
              >
                <Lock className="w-3.5 h-3.5 shrink-0" />
                {channelMembers.length > 0
                  ? 'Canal restreint — seuls les participants ci-dessous le voient et reçoivent ses messages'
                  : 'Canal ouvert à tout le dossier — invitez un participant pour le restreindre automatiquement'}
              </div>
            )}

            {/* Liste des participants actuels (n'a de sens que si le canal
                est restreint, mais reste visible sinon pour préparer une
                restriction à venir). */}
            <div className="space-y-1.5 overflow-y-auto custom-scrollbar max-h-56">
              {channelMembersLoading ? (
                <p className="text-xs text-slate-500 py-4 text-center">Chargement…</p>
              ) : channelMembers.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">Aucun participant invité pour l'instant.</p>
              ) : (
                channelMembers.map((member) => {
                  const profile = allProfiles.find((p) => p.uid === member.user_id);
                  return (
                    <div key={member.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{profile?.displayName || member.user_id}</p>
                        {profile?.email && <p className="text-[10px] text-slate-400 truncate">{profile.email}</p>}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => removeChannelMember(member)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                          title="Retirer ce participant"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Invitation d'un participant (admins et super admins) */}
            {isAdmin && (
              <div className="pt-3 border-t border-white/10 space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                  <UserPlus className="w-3.5 h-3.5 text-[#F7BC5F]" /> Inviter au canal
                </label>
                <input
                  value={channelMemberPickerQuery}
                  onChange={(e) => setChannelMemberPickerQuery(e.target.value)}
                  placeholder="Rechercher par nom ou email…"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                />
                <div className="max-h-36 overflow-y-auto custom-scrollbar space-y-1">
                  {channelMemberablePeople.slice(0, 20).map((p) => (
                    <button
                      key={p.uid}
                      onClick={() => membersModalChannelId && addChannelMember(membersModalChannelId, p.uid)}
                      className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-left text-slate-300 hover:bg-white/5 hover:text-white"
                    >
                      <span className="truncate">{p.displayName}</span>
                      <Plus className="w-3.5 h-3.5 text-[#F7BC5F] shrink-0" />
                    </button>
                  ))}
                  {channelMemberPickerQuery && channelMemberablePeople.length === 0 && (
                    <p className="text-[11px] text-slate-500 px-1 py-1">Aucun résultat.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal "Documents" — accès global super admin (5 octobre), voir
          chargerDocumentsMessagerie plus haut. */}
      {showDocuments && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowDocuments(false)}
        >
          <div
            className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-2xl w-full p-5 text-white space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#F7BC5F]" /> Documents de la messagerie
              </h3>
              <button onClick={() => setShowDocuments(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative shrink-0">
              <input
                value={rechercheDocuments}
                onChange={(e) => setRechercheDocuments(e.target.value)}
                placeholder="Rechercher par nom de fichier, expéditeur, conversation ou canal..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#030d0f] border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                autoFocus
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1.5">
              {chargementDocuments ? (
                <div className="flex items-center justify-center py-10 text-slate-400 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                </div>
              ) : documentsFiltres.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-10">
                  {rechercheDocuments ? 'Aucun document ne correspond à cette recherche.' : 'Aucun document trouvé.'}
                </p>
              ) : (
                documentsFiltres.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => void ouvrirPieceJointe(d.url)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 text-left"
                  >
                    {d.genre === 'image' ? (
                      <img src={d.url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/10" />
                    ) : (
                      <span className="w-10 h-10 rounded-lg bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#F7BC5F] flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{d.nom}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {d.expediteur} · {d.lieuType} « {d.lieu} » · {new Date(d.date).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Nouvelle conversation */}
      {/* Création d'un dossier de projet — cloisonné à l'agence active, avec
          ses participants. Voir createProject pour le détail. */}
      {showAddProject && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddProject(false)}
        >
          <div
            className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-[#F7BC5F]" />
                <h3 className="text-base font-bold">Nouveau dossier de projet</h3>
              </div>
              <button onClick={() => setShowAddProject(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {projectError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
                {projectError}
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              Ce dossier appartiendra à <span className="text-[#F7BC5F] font-semibold">{activeAgency.name}</span> et
              n'apparaîtra que pour cette agence. Un canal « Général » y est créé automatiquement.
            </p>

            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Nom du dossier (ex. Marketing, Recrutement...)"
              className="w-full bg-[#0b1c1e] border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
            />

            <div className="space-y-2 flex-1 min-h-0 flex flex-col">
              <p className="text-[11px] text-slate-400">
                Participants ({newProjectMemberIds.size} sélectionné{newProjectMemberIds.size > 1 ? 's' : ''})
              </p>
              <input
                value={newProjectQuery}
                onChange={(e) => setNewProjectQuery(e.target.value)}
                placeholder="Rechercher par nom ou email..."
                className="w-full bg-[#0b1c1e] border border-white/20 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1">
                {allProfiles
                  .filter((p) => p.uid !== currentUser?.uid)
                  // Signalé (7 septembre, « Philippe Serra ») : le dossier
                  // n'appartient qu'à `activeAgency` (voir texte au-dessus) —
                  // ne proposer que les comptes réellement membres de CETTE
                  // agence, pas tous les comptes de l'app.
                  .filter((p) => (agencyIdsByUid[p.uid] || []).includes(activeAgency.id))
                  .filter((p) =>
                    p.displayName.toLowerCase().includes(newProjectQuery.toLowerCase())
                    || (p.email || '').toLowerCase().includes(newProjectQuery.toLowerCase()))
                  .map((p) => {
                    const choisi = newProjectMemberIds.has(p.uid);
                    const agences = (agencyIdsByUid[p.uid] || [])
                      .map((id) => AGENCIES.find((a) => a.id === id)?.name)
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <button
                        key={p.uid}
                        type="button"
                        onClick={() => setNewProjectMemberIds((prev) => {
                          const n = new Set(prev);
                          if (n.has(p.uid)) n.delete(p.uid); else n.add(p.uid);
                          return n;
                        })}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-left transition-colors ${
                          choisi ? 'bg-[#F7BC5F]/10 border-[#F7BC5F]/50' : 'bg-[#0b1c1e] border-white/10 hover:border-[#F7BC5F]/40'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold truncate">{p.displayName}</span>
                          <span className="block text-[10px] text-slate-500 truncate">
                            {p.email}{agences ? ` · ${agences}` : ''}
                          </span>
                        </span>
                        {choisi && <Check className="w-4 h-4 text-[#F7BC5F] shrink-0" strokeWidth={3} />}
                      </button>
                    );
                  })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void createProject()}
              disabled={!newProjectName.trim() || creatingProject}
              className="w-full py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-sm disabled:opacity-40"
            >
              {creatingProject ? 'Création...' : 'Créer le dossier'}
            </button>
          </div>
        </div>
      )}

      {showNewConvModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowNewConvModal(false)}
        >
          <div
            className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-[#F7BC5F]" />
                <h3 className="text-base font-bold">{newConvMode === 'direct' ? 'Nouvelle conversation' : 'Nouveau groupe'}</h3>
              </div>
              <button
                onClick={() => { setShowNewConvModal(false); setNewConvMode('direct'); setSelectedGroupMemberIds(new Set()); setGroupTitle(''); }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {convCreateError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
                {convCreateError}
              </div>
            )}

            {/* Demande explicite : "chaque utilisateur peut créer des
                groupes aussi avec des utilisateurs de plusieurs agences
                différentes" — bascule Discussion/Groupe. */}
            <div className="inline-flex items-center gap-1 rounded-full p-1 bg-white/5 border border-white/10 self-start">
              {[
                { id: 'direct' as const, label: 'Discussion' },
                { id: 'group' as const, label: 'Groupe' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setNewConvMode(id); setSelectedGroupMemberIds(new Set()); setGroupTitle(''); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                    newConvMode === id ? 'bg-[#F7BC5F] text-slate-950' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {newConvMode === 'group' && (
              <input
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="Nom du groupe…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
              />
            )}

            <p className="text-[11px] text-slate-400">
              {newConvMode === 'direct'
                ? 'Toutes les agences — sélectionnez un collègue pour démarrer une discussion.'
                : `Toutes les agences — sélectionnez les membres du groupe (${selectedGroupMemberIds.size} sélectionné${selectedGroupMemberIds.size > 1 ? 's' : ''}).`}
            </p>
            <input
              value={newConvQuery}
              onChange={(e) => setNewConvQuery(e.target.value)}
              placeholder="Rechercher par nom ou email…"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
            />
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
              {colleaguesForNewConv.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Aucun collègue trouvé.</p>
              ) : (
                colleaguesForNewConv.map((m) => {
                  const isSelected = selectedGroupMemberIds.has(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        if (newConvMode === 'direct') {
                          void startConversation(m.id);
                          return;
                        }
                        setSelectedGroupMemberIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                          return next;
                        });
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors ${
                        isSelected ? 'bg-[#F7BC5F]/15 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{m.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {m.email} · <span className="text-[#F9C977]/80">{agencyNameById(m.agencyId) || 'Agence inconnue'}</span>
                        </p>
                      </div>
                      {newConvMode === 'direct' ? (
                        m.hasConversation ? (
                          <span className="text-[10px] text-[#F7BC5F] shrink-0">Ouvrir</span>
                        ) : (
                          <Plus className="w-3.5 h-3.5 text-[#F7BC5F] shrink-0" />
                        )
                      ) : (
                        <div className={`w-4.5 h-4.5 rounded-md border shrink-0 flex items-center justify-center ${isSelected ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-white/20'}`}>
                          {isSelected && <Check className="w-3 h-3 text-slate-950" />}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {newConvMode === 'group' && (
              <button
                type="button"
                onClick={() => void createGroup()}
                disabled={creatingGroup || selectedGroupMemberIds.size === 0 || !groupTitle.trim()}
                className="w-full bg-[#F7BC5F] hover:bg-[#d9ab38] disabled:opacity-40 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl transition-all"
              >
                {creatingGroup ? 'Création…' : 'Créer le groupe'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal "Inviter des participants" — agrandir un groupe déjà créé,
          voir inviteToConversation/colleaguesToInvite plus haut. Même
          gabarit que la modale "Nouveau groupe" ci-dessus, ouverte à
          n'importe quel membre du groupe (pas seulement son créateur). */}
      {showInviteConvModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowInviteConvModal(false)}
        >
          <div
            className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#F7BC5F]" />
                <h3 className="text-base font-bold">Inviter des participants</h3>
              </div>
              <button
                onClick={() => setShowInviteConvModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              {`Toutes les agences — sélectionnez qui inviter (${selectedInviteIds.size} sélectionné${selectedInviteIds.size > 1 ? 's' : ''}).`}
            </p>
            <input
              value={inviteConvQuery}
              onChange={(e) => setInviteConvQuery(e.target.value)}
              placeholder="Rechercher par nom ou email…"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
            />
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
              {colleaguesToInvite.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Aucun collègue trouvé.</p>
              ) : (
                colleaguesToInvite.map((m) => {
                  const isSelected = selectedInviteIds.has(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelectedInviteIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                          return next;
                        });
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors ${
                        isSelected ? 'bg-[#F7BC5F]/15 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{m.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {m.email} · <span className="text-[#F9C977]/80">{agencyNameById(m.agencyId) || 'Agence inconnue'}</span>
                        </p>
                      </div>
                      <div className={`w-4.5 h-4.5 rounded-md border shrink-0 flex items-center justify-center ${isSelected ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-white/20'}`}>
                        {isSelected && <Check className="w-3 h-3 text-slate-950" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => void inviteToConversation()}
              disabled={invitingToConv || selectedInviteIds.size === 0}
              className="w-full bg-[#F7BC5F] hover:bg-[#d9ab38] disabled:opacity-40 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl transition-all"
            >
              {invitingToConv ? 'Invitation…' : `Inviter${selectedInviteIds.size > 0 ? ` (${selectedInviteIds.size})` : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* Signalé : "fenêtre pas centrée, pas de croix pour fermer" — même
          cause que les autres visionneuses déjà réparées cette session : un
          `position: fixed` imbriqué dans un ancêtre animé de la page perd
          son vrai repère (la fenêtre), il se recentre alors sur cet ancêtre
          au lieu de l'écran, et la croix peut se retrouver hors du cadre
          visible. Un portail vers `document.body` élimine le problème. */}
      {convLightboxUrl && createPortal(
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-6"
          onClick={() => setConvLightboxUrl(null)}
        >
          <button
            onClick={() => setConvLightboxUrl(null)}
            className="absolute right-6 text-white/70 hover:text-white p-2 rounded-lg hover:bg-white/10 z-10" style={{ top: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}
          >
            <X className="w-6 h-6" />
          </button>
          {/* Appui long sur la photo pour la fermer, en plus de la croix
              (demande explicite) — un appui court reste sans effet pour ne
              pas gêner un simple regard rapide. */}
          <img
            src={convLightboxUrl}
            alt="Aperçu"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => { lightboxPressTimer.current = window.setTimeout(() => setConvLightboxUrl(null), 500); }}
            onPointerUp={() => { if (lightboxPressTimer.current) window.clearTimeout(lightboxPressTimer.current); }}
            onPointerLeave={() => { if (lightboxPressTimer.current) window.clearTimeout(lightboxPressTimer.current); }}
            className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl select-none"
          />
        </div>,
        document.body
      )}

      {/* Signalé (16 octobre) : « une fenêtre un peu plus grande pour voir
          qui a lu les messages » — l'info-bulle au survol (voir
          showConvReadByFor/showChannelReadByFor plus haut) tronquait le texte
          au-delà de 220px, illisible dès que plusieurs personnes avaient lu.
          Un clic sur l'accusé de lecture ouvre maintenant cette fenêtre à la
          place : une ligne par lecteur (avatar, nom, heure de lecture),
          commune aux conversations et aux canaux. */}
      {readReceiptModal && createPortal(
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
          onClick={() => setReadReceiptModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0b1c1e] border border-[#153c3f] rounded-2xl w-full max-w-sm max-h-[70vh] flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#153c3f] shrink-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 min-w-0">
                <CheckCheck className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                <span className="truncate">
                  {readReceiptModal.readers.length === 0
                    ? 'Pas encore vu'
                    : `Vu par ${readReceiptModal.readers.length} personne${readReceiptModal.readers.length > 1 ? 's' : ''}`}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setReadReceiptModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {readReceiptModal.readers.length === 0 ? (
                <p className="text-center text-sm text-slate-500 py-8 px-4">
                  Personne n'a encore vu ce message.
                </p>
              ) : (
                readReceiptModal.readers.map((r) => (
                  <div key={r.userId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5">
                    <div className="w-9 h-9 rounded-full bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#F7BC5F] font-bold text-xs flex items-center justify-center shrink-0">
                      {r.name.slice(0, 2).toUpperCase()}
                    </div>
                    <p className="flex-1 min-w-0 text-sm font-semibold text-white truncate">{r.name}</p>
                    {r.readAt && (
                      <span className="text-[11px] text-slate-500 shrink-0">{formatTime(r.readAt)}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
