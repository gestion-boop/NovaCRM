import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, FolderPlus, Hash, Plus, Send, Trash2, ChevronUp, ChevronDown,
  MessageSquare, Users, Share2, X, UserPlus, Crown, Search, Pencil,
  Image as ImageIcon, Smile, Mic, Square, Eye, ArrowLeft, Check, CheckCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { AGENCIES } from '@/types';
import { useIsMobile } from '@/hooks/use-mobile';
import { NOVA_QUICK_REACTIONS, renderEmojiOrNova, isNovaReaction } from '@/lib/novaReactions';

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
}

interface ChatMessageRow {
  id: string;
  channel: string;
  data: {
    body?: string;
    sender_id?: string;
    sender_name?: string;
    created_at?: string;
  };
  created_at: string;
  sender_id?: string | null;
  is_deleted?: boolean;
  read_by?: { userId: string; userName?: string; readAt?: string }[];
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

export default function ChatViewSupabase({ initialHighlightMessageId, onHighlightConsumed, onExitMobile, isActive = true }: ChatViewSupabaseProps = {}) {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const isSuperAdmin = userProfile?.role === 'super_admin';
  // Les invitations / gestion des membres sont réservées aux admins (et super admin)
  const isAdmin = isSuperAdmin || userProfile?.role === 'admin';

  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('projets');
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [channelsByProject, setChannelsByProject] = useState<Record<string, ChatChannel[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [showChannelEmoji, setShowChannelEmoji] = useState(false);
  // Signalé : "les Novadji dans les messages ne se mettent pas" — le
  // composeur des canaux d'équipe (#général...) est un composant à part de
  // celui des conversations directes, sans le bouton Nova ajouté au ticket
  // #260 — ajouté ici aussi.
  const [showChannelNovaPicker, setShowChannelNovaPicker] = useState(false);
  const [newChannelFor, setNewChannelFor] = useState<string | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Gestion des membres par projet (table chat_project_members) ─────────
  const [membersModalProjectId, setMembersModalProjectId] = useState<string | null>(null);
  const [projectMembers, setProjectMembers] = useState<ChatProjectMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<MemberProfile[]>([]);
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
  const [convLightboxUrl, setConvLightboxUrl] = useState<string | null>(null);
  const lightboxPressTimer = useRef<number | null>(null);
  // Ticket #24 (nouvelle base) : accusé de lecture — quel autre membre de la
  // conversation a lu tel message (table `message_receipts`, déjà prête en
  // base mais jamais exploitée côté front).
  const [convReadBy, setConvReadBy] = useState<Record<string, string[]>>({});

  const profileByUid = useMemo(() => {
    const map: Record<string, MemberProfile> = {};
    allProfiles.forEach((p) => { map[p.uid] = p; });
    TEAM_MEMBERS.forEach((m) => { if (!map[m.id]) map[m.id] = { uid: m.id, displayName: m.name, email: m.email }; });
    return map;
  }, [allProfiles]);

  const ensureProfilesLoaded = async () => {
    if (allProfiles.length > 0) return;
    const { data } = await supabase.from('profiles').select('id, full_name, email');
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

  // Signalé (29/08/2026) : "quand on met des liens dans les discussions, ça
  // serait bien qu'on les souligne pour qu'on puisse y accéder directement
  // à un clic" — détecte les URL dans un message texte et les rend
  // cliquables/soulignées, le reste du texte inchangé.
  const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const IS_URL_REGEX = /^(https?:\/\/|www\.)/;
  const linkifyText = (text: string): React.ReactNode[] => {
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
          className="underline underline-offset-2 text-[#F9C977] hover:text-[#FAD592] break-all"
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

  const filteredConversations = conversations
    .filter((c) => !isRawLeadPlaceholder(c))
    .filter((c) => conversationLabel(c).toLowerCase().includes(convSearch.toLowerCase()));

  // Réactions + accusés de lecture pour un LOT de messages donné — factorisé
  // pour être réutilisé par loadConvMessages (lot récent) ET
  // loadOlderConvMessages (lot plus ancien, chargé à la demande).
  const loadReactionsAndReceiptsFor = async (rows: DirectMessageRow[]) => {
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

    const readBy: Record<string, string[]> = {};
    ((receipts ?? []) as any[]).forEach((r) => {
      (readBy[r.message_id] ||= []).push(r.user_id);
    });
    setConvReadBy((prev) => ({ ...prev, ...readBy }));

    // Accuse réception : tout message reçu (pas envoyé par moi) dans cette
    // conversation est marqué lu dès qu'on l'affiche à l'écran.
    // Ne retraite que les messages PAS ENCORE lus (readBy) — avant, on
    // ré-écrivait read_at pour TOUS les messages reçus à chaque appel, ce
    // qui, avec un sondage toutes les 4s, multipliait inutilement les
    // écritures en base pour des messages déjà lus depuis longtemps.
    if (currentUser) {
      const toMarkRead = rows.filter(
        (r) => r.user_id !== currentUser.uid && !(readBy[r.id] || []).includes(currentUser.uid)
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
    setConvMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
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

      return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    if (rows.length > 0) {
      await loadReactionsAndReceiptsFor(rows);
    } else {
      setConvReactions({});
      setConvReadBy({});
    }
  };

  // "Charger les messages précédents" : récupère le lot juste avant le plus
  // ancien message actuellement affiché et le préfixe à la liste.
  const loadOlderConvMessages = async () => {
    if (!activeConversationId || loadingOlderConv || convMessages.length === 0) return;
    const oldest = convMessages[0];
    setLoadingOlderConv(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', activeConversationId)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(RECENT_MESSAGES_PAGE);
      if (error) {
        console.warn('Erreur chargement des messages précédents :', error);
        return;
      }
      const older = ((data as DirectMessageRow[]) || []).slice().reverse();
      setConvHasMoreOlder(older.length === RECENT_MESSAGES_PAGE);
      if (older.length === 0) return;
      setConvMessages((prev) => [...older, ...prev]);
      await loadReactionsAndReceiptsFor(older);
    } finally {
      setLoadingOlderConv(false);
    }
  };

  const openConversation = (id: string) => {
    setActiveConversationId(id);
    setConvMessages([]);
    setConvHasMoreOlder(true);
    loadConvMessages(id);
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
  }, [highlightedMessageId, convMessages.length]);

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
    setConvReactions(grouped);
  };

  useEffect(() => {
    if (!activeConversationId) return;
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
  }, [activeConversationId, isActive]);

  // Ticket #9 (nouvelle base) : à l'ouverture d'une conversation le défilement
  // ne se produisait pas — un scrollTo immédiat tirait souvent avant que la
  // liste ait fini de se mettre en page (scrollHeight pas encore à jour).
  // Un rAF force le saut au prochain paint, puis un rattrapage après le
  // rendu complet (images) garantit qu'on atterrit bien tout en bas.
  useEffect(() => {
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
  }, [convMessages.length, activeConversationId]);

  const sendConvMessage = async () => {
    const body = convDraft.trim();
    if (!body || !activeConversationId || !currentUser) return;
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
    if (existing && existing.emoji === emoji) {
      await supabase.from('message_reactions' as any).delete().eq('message_id', messageId).eq('user_id', currentUser.uid);
    } else {
      await supabase.from('message_reactions' as any).upsert(
        { message_id: messageId, user_id: currentUser.uid, emoji } as any,
        { onConflict: 'message_id,user_id' }
      );
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
    await supabase.from('messages').delete().eq('id', messageId);
    if (activeConversationId) loadConvMessages(activeConversationId);
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
    await supabase.from('chat_messages').delete().eq('id', messageId);
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
  useEffect(() => {
    if (!showChannelEmoji && !showChannelNovaPicker && !showConvEmoji && !showConvNovaPicker) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showChannelEmoji && channelEmojiRef.current && !channelEmojiRef.current.contains(target)) setShowChannelEmoji(false);
      if (showChannelNovaPicker && channelNovaPickerRef.current && !channelNovaPickerRef.current.contains(target)) setShowChannelNovaPicker(false);
      if (showConvEmoji && convEmojiRef.current && !convEmojiRef.current.contains(target)) setShowConvEmoji(false);
      if (showConvNovaPicker && convNovaPickerRef.current && !convNovaPickerRef.current.contains(target)) setShowConvNovaPicker(false);
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => document.removeEventListener('mousedown', handleOutsideClick, true);
  }, [showChannelEmoji, showChannelNovaPicker, showConvEmoji, showConvNovaPicker]);
  const [isRecordingConv, setIsRecordingConv] = useState(false);
  const [recordingConvSeconds, setRecordingConvSeconds] = useState(0);
  const [uploadingConvMedia, setUploadingConvMedia] = useState(false);
  const convImageInputRef = useRef<HTMLInputElement>(null);
  const convMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const convAudioChunksRef = useRef<Blob[]>([]);
  const convRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const insertConvMessage = async (kind: 'image' | 'voice', attachmentUrl: string, attachmentDuration?: number) => {
    if (!activeConversationId || !currentUser) return;
    await supabase.from('messages').insert({
      conversation_id: activeConversationId,
      user_id: currentUser.uid,
      kind,
      attachment_url: attachmentUrl,
      attachment_duration: attachmentDuration ?? null,
    } as any);
    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', activeConversationId);
    loadConversations(true);
    if (activeConversationId) loadConvMessages(activeConversationId);
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

  const handleStartRecordingConv = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
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
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        setUploadingConvMedia(true);
        try {
          await insertConvMessage('voice', dataUrl, duration);
        } finally {
          setUploadingConvMedia(false);
        }
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  };

  // Signalé : "chaque entité doit être cloisonné, SAUF pour les chats, où
  // les 3 entités, tout le monde peut poster" — cette liste ne doit donc
  // PLUS être restreinte à l'agence active (c'était le cas avant, à
  // l'inverse de ce qui est demandé). L'agence de chacun reste affichée
  // (voir la modale plus bas) pour qu'on sache toujours à qui on écrit.
  const colleaguesForNewConv = useMemo(() => {
    const existingDirectPartners = new Set<string>();
    conversations.forEach((c) => {
      if (c.type !== 'direct') return;
      (conversationMembers[c.id] || []).forEach((u) => { if (u !== currentUser?.uid) existingDirectPartners.add(u); });
    });
    return TEAM_MEMBERS.filter(
      (m) =>
        m.id !== currentUser?.uid &&
        (m.name.toLowerCase().includes(newConvQuery.toLowerCase()) || m.email.toLowerCase().includes(newConvQuery.toLowerCase()))
    ).map((m) => ({ ...m, hasConversation: existingDirectPartners.has(m.id) }));
  }, [conversations, conversationMembers, currentUser?.uid, newConvQuery]);

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
    const otherMember = TEAM_MEMBERS.find((m) => m.id === otherUserId);
    const sameAgency = otherMember?.agencyId === activeAgency.id;
    const { data: conv, error } = await supabase
      .from('conversations')
      .insert({ type: 'direct', title: null, created_by: currentUser.uid, agency_id: sameAgency ? activeAgency.id : null } as any)
      .select()
      .single();
    if (error || !conv) return;
    await supabase.from('conversation_members').insert([
      { conversation_id: (conv as any).id, user_id: currentUser.uid },
      { conversation_id: (conv as any).id, user_id: otherUserId },
    ] as any);
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
      const allSameAgency = memberIds.every((id) => TEAM_MEMBERS.find((m) => m.id === id)?.agencyId === activeAgency.id);
      const { data: conv, error } = await supabase
        .from('conversations')
        .insert({
          type: 'group',
          title: groupTitle.trim(),
          created_by: currentUser.uid,
          agency_id: allSameAgency ? activeAgency.id : null,
        } as any)
        .select()
        .single();
      if (error || !conv) return;
      await supabase.from('conversation_members').insert([
        { conversation_id: (conv as any).id, user_id: currentUser.uid },
        ...memberIds.map((id) => ({ conversation_id: (conv as any).id, user_id: id })),
      ] as any);
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

  // ── Charger dossiers + canaux (agence active + espace "3 entités") ──────
  const loadProjectsAndChannels = async () => {
    const { data: projectRows } = await supabase
      .from('chat_projects')
      .select('*')
      .or(`agency_id.is.null,agency_id.eq.${activeAgency.id}`)
      .order('position');

    const list = (projectRows as ChatProject[]) || [];
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
    }
  };

  useEffect(() => {
    loadProjectsAndChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgency.id]);

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
    const rows = ((data as any[]) || []).slice().reverse();
    setMessages(rows as ChatMessageRow[]);

    // Bug remonté : lire les messages d'un canal ne marquait jamais rien —
    // le badge "Chat" grossissait indéfiniment. On marque ici lu tout
    // message d'un autre membre pas encore lu par moi, et on synchronise la
    // notification correspondante (même logique que pour les conversations
    // directes).
    if (currentUser) {
      const toMarkRead = rows.filter(
        (r) => r.sender_id !== currentUser.uid && !(Array.isArray(r.read_by) && r.read_by.some((x: any) => x.userId === currentUser.uid))
      );
      if (toMarkRead.length > 0) {
        await Promise.all(
          toMarkRead.map((r) =>
            supabase
              .from('chat_messages')
              .update({
                read_by: [...(Array.isArray(r.read_by) ? r.read_by : []), { userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
              } as any)
              .eq('id', r.id)
          )
        );
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('user_id', currentUser.uid)
          .eq('is_read', false)
          .in('entity_id', toMarkRead.map((r) => r.id));
      }
    }
  };

  useEffect(() => {
    if (!activeChannel) return;
    loadMessages(activeChannel.id);

    const channel = supabase
      .channel(`chat_${activeChannel.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel=eq.${activeChannel.id}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as ChatMessageRow]);
        }
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
  }, [activeChannel?.id, isActive]);

  // Ticket #9 (nouvelle base) : voir le correctif identique sur convScrollRef
  // ci-dessus — même cause, même fix, pour les canaux d'équipe.
  useEffect(() => {
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
  }, [messages.length, activeChannel?.id]);

  const sendMessage = async () => {
    if (!draft.trim() || !activeChannel || !currentUser) return;
    // Même garde que pour les conversations directes : voir sendConvMessage.
    if (sendingChannelRef.current) return;
    sendingChannelRef.current = true;
    const body = draft.trim();
    setDraft('');
    try {
    await supabase.from('chat_messages').insert({
      // Signalé : "les Novadji dans les messages ne se mettent pas" — en
      // creusant, la colonne `id` de `chat_messages` n'a pas de valeur par
      // défaut côté base (corrigé séparément par une migration SQL), donc
      // AUCUN message de canal ne s'enregistrait jamais, silencieusement
      // (violait la contrainte NOT NULL). Fourni explicitement ici aussi,
      // en plus du correctif base, pour ne plus jamais dépendre d'un défaut
      // serveur pour cette colonne.
      id: crypto.randomUUID(),
      channel: activeChannel.id,
      data: { body, sender_id: currentUser.uid, sender_name: displayName, created_at: new Date().toISOString() },
      // Bug remonté : sans ces colonnes réelles (avant, seulement dans le
      // JSONB `data`), le badge "Chat" ne pouvait jamais reconnaître ni ses
      // propres messages ni un message lu — il grossissait indéfiniment.
      sender_id: currentUser.uid,
      is_deleted: false,
      read_by: [{ userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
    } as any);
    await supabase.from('chat_channels').update({ last_message_at: new Date().toISOString() }).eq('id', activeChannel.id);
    } finally {
      sendingChannelRef.current = false;
    }
  };

  const sendNovaChannelMessage = async (novaSrc: string) => {
    if (!activeChannel || !currentUser) return;
    setShowChannelNovaPicker(false);
    await supabase.from('chat_messages').insert({
      id: crypto.randomUUID(),
      channel: activeChannel.id,
      data: { body: novaSrc, sender_id: currentUser.uid, sender_name: displayName, created_at: new Date().toISOString() },
      sender_id: currentUser.uid,
      is_deleted: false,
      read_by: [{ userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
    } as any);
    await supabase.from('chat_channels').update({ last_message_at: new Date().toISOString() }).eq('id', activeChannel.id);
  };

  // ── Gestion des canaux (admin uniquement) ─────────────────────────────
  const addChannel = async (projectId: string) => {
    const name = newChannelName.trim();
    if (!name || !currentUser) return;
    const existing = channelsByProject[projectId] || [];
    const { data } = await supabase
      .from('chat_channels')
      .insert({ project_id: projectId, name, position: existing.length, created_by: currentUser.uid })
      .select()
      .single();
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

  const moveChannel = async (channel: ChatChannel, direction: -1 | 1) => {
    const list = [...(channelsByProject[channel.project_id] || [])];
    const idx = list.findIndex((c) => c.id === channel.id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
    list.forEach((c, i) => { c.position = i; });
    setChannelsByProject((prev) => ({ ...prev, [channel.project_id]: list }));
    await Promise.all(list.map((c) => supabase.from('chat_channels').update({ position: c.position }).eq('id', c.id)));
  };

  // Ouvre le modal "Membres" d'un projet et charge la liste
  const openMembersModal = async (projectId: string) => {
    setMembersModalProjectId(projectId);
    setMemberPickerQuery('');
    setMembersLoading(true);
    try {
      const [{ data: members }, { data: profiles }] = await Promise.all([
        supabase.from('chat_project_members').select('*').eq('project_id', projectId),
        allProfiles.length > 0
          ? Promise.resolve({ data: null })
          : supabase.from('profiles').select('id, full_name, email'),
      ]);

      setProjectMembers((members as ChatProjectMember[]) || []);

      if (profiles) {
        setAllProfiles(
          (profiles as { id: string; full_name: string | null; email: string | null }[]).map((p) => ({
            uid: p.id,
            displayName: p.full_name || p.email || 'Utilisateur',
            email: p.email || '',
          }))
        );
      }
    } finally {
      setMembersLoading(false);
    }
  };

  const addMember = async (projectId: string, userId: string) => {
    if (!isAdmin || !currentUser) return;
    const { data, error } = await supabase
      .from('chat_project_members')
      .insert({ project_id: projectId, user_id: userId, added_by: currentUser.uid })
      .select()
      .single();
    if (!error && data) {
      setProjectMembers((prev) => [...prev, data as ChatProjectMember]);
    }
  };

  const removeMember = async (member: ChatProjectMember) => {
    if (!isAdmin) return;
    if (!confirm('Retirer ce membre de cet espace ?')) return;
    await supabase.from('chat_project_members').delete().eq('id', member.id);
    setProjectMembers((prev) => prev.filter((m) => m.id !== member.id));
  };

  const membersModalProject = projects.find((p) => p.id === membersModalProjectId) || null;
  const memberablePeople = allProfiles.filter(
    (p) =>
      !projectMembers.some((m) => m.user_id === p.uid) &&
      (p.displayName.toLowerCase().includes(memberPickerQuery.toLowerCase()) ||
        p.email.toLowerCase().includes(memberPickerQuery.toLowerCase()))
  );

  const formatTime = (d: string) =>
    new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // Sur mobile, le chat est un panneau à la fois (liste OU conversation),
  // avec un bouton retour — la mise en page desktop (liste + conversation
  // côte à côte) reste inchangée en tapant `w-72` en dur. Sans ça, sur un
  // écran étroit le canal actif se retrouvait écrasé/superposé à la liste.
  const isMobile = useIsMobile();
  const mobileShowingConversation = tab === 'conversations' ? !!activeConversationId : !!activeChannel;
  const goBackToList = () => {
    if (tab === 'conversations') setActiveConversationId(null);
    else setActiveChannel(null);
  };

  return (
    <div className="h-full flex flex-col bg-[#050f11] text-white">
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
            className="p-1.5 -ml-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-semibold">Retour</span>
          </button>
        </div>
      )}

      {/* Tabs — masqués sur mobile une fois une conversation ouverte, pour
          laisser toute la place au panneau de discussion. */}
      {(!isMobile || !mobileShowingConversation) && (
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/20 shrink-0">
        <div className="flex items-center gap-2">
          {TABS.map((t) => {
            // Demandé : "un compteur sur conversation" — total des messages
            // non lus toutes conversations confondues, affiché directement
            // sur l'onglet (même source que les pastilles par conversation
            // et le badge global du menu, pour rester cohérent partout).
            const tabUnread = t.id === 'conversations'
              ? Object.values(unreadByConversation).reduce((sum, n) => sum + n, 0)
              : 0;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${
                  tab === t.id ? 'bg-[#F7BC5F] text-slate-950' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
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
        {tab === 'conversations' && (
          <button
            onClick={() => { setShowNewConvModal(true); ensureProfilesLoaded(); }}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-[#F7BC5F] text-slate-950 hover:bg-[#d4a83b] flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Nouveau
          </button>
        )}
      </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Folder tree */}
        {tab === 'projets' && (!isMobile || !activeChannel) && (
          <div className={`${isMobile ? 'w-full' : 'w-72 shrink-0'} border-r border-white/20 overflow-y-auto custom-scrollbar p-3 space-y-2`}>
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Projets</span>
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
                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                      {(channelsByProject[project.id] || []).length} canaux
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
                    {(channelsByProject[project.id] || []).map((c, i, arr) => (
                      <div key={c.id} className="group flex items-center gap-1">
                        <button
                          onClick={() => setActiveChannel(c)}
                          className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-left truncate ${
                            activeChannel?.id === c.id ? 'bg-[#F7BC5F]/20 text-[#F7BC5F]' : 'text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <Hash className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{c.name}</span>
                        </button>
                        {isSuperAdmin && (
                          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                            <button onClick={() => moveChannel(c, -1)} disabled={i === 0} className="p-1 text-slate-500 hover:text-white disabled:opacity-20">
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button onClick={() => moveChannel(c, 1)} disabled={i === arr.length - 1} className="p-1 text-slate-500 hover:text-white disabled:opacity-20">
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            <button onClick={() => deleteChannel(c)} className="p-1 text-slate-500 hover:text-rose-400">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

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
                    <button onClick={goBackToList} className="p-1 -ml-1 mr-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 shrink-0">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}
                  <MessageSquare className="w-4 h-4 text-[#F7BC5F]" />
                  <span className="font-bold">
                    {conversationLabel(conversations.find((c) => c.id === activeConversationId))}
                  </span>
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
                          <div className={`flex items-end gap-1.5 max-w-[80%] ${mine ? 'flex-row-reverse' : ''}`}>
                            <div className={`px-3.5 py-2 rounded-2xl text-sm ${
                              mine ? 'bg-[#F7BC5F] text-slate-950 font-medium' : 'bg-[#0b1c1e] border border-[#153c3f] text-white'
                            }`}>
                              {!mine && <p className="text-[10px] font-bold text-[#F7BC5F] mb-0.5">{author?.displayName || 'Utilisateur'}</p>}

                              {isEditing ? (
                                <div className="flex flex-col gap-2 min-w-[200px]">
                                  <textarea
                                    value={editingConvMsgText}
                                    onChange={(e) => setEditingConvMsgText(e.target.value)}
                                    className="bg-black/20 rounded-lg p-2 text-xs text-inherit border border-black/20 focus:outline-none resize-none"
                                    rows={2}
                                    autoFocus
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setEditingConvMsgId(null)} className="text-[10px] opacity-70 hover:opacity-100">Annuler</button>
                                    <button type="button" onClick={() => void handleSaveEditConvMsg(m.id)} className="text-[10px] font-bold underline">Enregistrer</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {m.kind === 'text' && <p className="whitespace-pre-line">{linkifyText(m.body || '')}</p>}
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
                                  {m.kind === 'video' && m.attachment_url && (
                                    <video src={m.attachment_url} controls controlsList="nofullscreen" className="max-w-[220px] rounded-xl bg-black" />
                                  )}
                                  {m.kind === 'voice' && m.attachment_url && (
                                    <div className="flex items-center gap-2">
                                      <audio src={m.attachment_url} controls className="max-w-[220px] h-9" />
                                      {m.attachment_duration ? <span className="text-[10px] opacity-70">{m.attachment_duration}s</span> : null}
                                    </div>
                                  )}
                                  {m.kind === 'file' && m.attachment_url && (
                                    <a href={m.attachment_url} target="_blank" rel="noreferrer" className="underline text-xs">
                                      {m.body || 'Document'}
                                    </a>
                                  )}
                                  {m.edited_at && <span className="text-[9px] italic opacity-60 ml-1">(modifié)</span>}
                                </>
                              )}
                            </div>

                            {!isEditing && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
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
                                          <button key={e} type="button" onClick={() => void handleToggleConvReaction(m.id, e)} className="text-4xl leading-none hover:scale-110 transition-transform p-2 rounded-xl hover:bg-white/10">
                                            {/* Signalé : "grossis quand même les Novadji, ils
                                                sont moins visibles que les émoticônes
                                                classiques" — image à taille fixe (w-5 h-5 par
                                                défaut) à côté d'un emoji Unicode en text-xl,
                                                visuellement plus petite malgré la même
                                                hauteur nominale (glyphe emoji avec sa propre
                                                marge). Agrandie pour un poids visuel comparable. */}
                                            {renderEmojiOrNova(e, 'w-12 h-12')}
                                          </button>
                                        ))}
                                        {/* Suite #240 : séparation visuelle nette entre les
                                            mini-expressions Nova et "les vrais" emojis. */}
                                        <div className="col-span-10 h-px bg-[#153c3f] my-1" />
                                        {QUICK_EMOJIS.map((e) => (
                                          <button key={e} type="button" onClick={() => void handleToggleConvReaction(m.id, e)} className="text-4xl leading-none hover:scale-110 transition-transform p-2 rounded-xl hover:bg-white/10">
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
                                              className="grid grid-cols-5 gap-2.5 bg-[#0b1c1e] border border-[#153c3f] rounded-2xl p-4 shadow-xl w-full max-w-[440px] max-h-[70vh] overflow-y-auto custom-scrollbar"
                                            >
                                              {pickerItems}
                                            </div>
                                          </div>
                                        ) : (
                                          <div ref={reactionPickerRef} className={`absolute z-20 ${convReactionPickerUp ? 'bottom-full mb-1' : 'top-full mt-1'} grid grid-cols-6 gap-2 bg-[#0b1c1e] border border-[#153c3f] rounded-xl p-3 shadow-xl w-max max-w-[440px] max-h-[340px] overflow-y-auto custom-scrollbar ${mine ? 'right-0' : 'left-0'}`}>
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
                                  <span>{renderEmojiOrNova(emoji, 'w-5 h-5')}</span>
                                  {list.length > 1 && <span className="text-[10px] text-slate-400">{list.length}</span>}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] text-slate-500">{formatTime(m.created_at)}</span>
                            {/* Accusé de lecture (#24) : coché uniquement sur mes
                                propres messages, une fois lus par l'autre. */}
                            {mine && (
                              (convReadBy[m.id] || []).some((uid) => uid !== currentUser?.uid) ? (
                                <CheckCheck className="w-3.5 h-3.5 text-[#F7BC5F]" aria-label="Lu" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-slate-600" aria-label="Envoyé" />
                              )
                            )}
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
                <div className="p-3 border-t border-white/20 space-y-2.5">
                  <input ref={convImageInputRef} type="file" accept="image/*" hidden onChange={handleConvImageSelected} />

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
                      <button type="button" onClick={() => void handleStopRecordingConv(false)} className="p-1.5 rounded-lg bg-rose-500 text-white" title="Envoyer">
                        <Square className="w-4 h-4" />
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
                  <input
                    value={convDraft}
                    onChange={(e) => setConvDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // `isComposing` : sur clavier mobile et en saisie
                      // accentuée, Entrée peut arriver deux fois pour une
                      // seule frappe. `repeat` : touche maintenue enfoncée.
                      if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.repeat) return;
                      e.preventDefault();
                      void sendConvMessage();
                    }}
                    placeholder="Écrire un message..."
                    disabled={isRecordingConv}
                    className="w-full bg-[#0b1c1e] border border-white/20 rounded-full px-5 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] disabled:opacity-40"
                  />

                  <div className="grid grid-cols-3 items-center">
                    <div className="flex items-center gap-2 justify-self-start">
                      <button
                        type="button"
                        onClick={() => convImageInputRef.current?.click()}
                        disabled={uploadingConvMedia || isRecordingConv}
                        className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                        title="Envoyer une image"
                      >
                        <ImageIcon className="w-5 h-5" />
                      </button>
                      <div className="relative" ref={convEmojiRef}>
                        <button
                          type="button"
                          onClick={() => setShowConvEmoji((v) => !v)}
                          className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                          title="Emoji"
                        >
                          <Smile className="w-5 h-5" />
                        </button>
                        {showConvEmoji && (
                          <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-6 gap-2 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max max-w-[440px] max-h-[340px] overflow-y-auto custom-scrollbar">
                            {QUICK_EMOJIS.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => setConvDraft((v) => v + e)}
                                className="text-4xl leading-none hover:scale-110 transition-transform p-2 rounded-xl hover:bg-white/10"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="relative" ref={convNovaPickerRef}>
                        <button
                          type="button"
                          onClick={() => setShowConvNovaPicker((v) => !v)}
                          className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                          title="Envoyer une mascotte Nova"
                        >
                          <img src="/nova/expressions/nova-neutre.png" alt="Nova" className="w-6 h-6 object-contain" />
                        </button>
                        {showConvNovaPicker && (
                          <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-3 gap-2.5 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max">
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

                    <button
                      type="button"
                      onClick={() => (isRecordingConv ? void handleStopRecordingConv(false) : void handleStartRecordingConv())}
                      disabled={uploadingConvMedia}
                      className="justify-self-center w-12 h-12 rounded-full flex items-center justify-center shadow-lg shadow-rose-500/30 transition-transform hover:scale-105 disabled:opacity-40 bg-rose-500/90 hover:bg-rose-500 text-white"
                      title="Message vocal"
                    >
                      <Mic className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-2 justify-self-end">
                      <button
                        onClick={sendConvMessage}
                        disabled={!convDraft.trim() || isRecordingConv}
                        className="w-10 h-10 rounded-full flex items-center justify-center bg-[#F7BC5F] hover:bg-[#d4a83b] disabled:opacity-30 text-slate-950"
                      >
                        <Send className="w-4 h-4" />
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
                  <button onClick={goBackToList} className="p-1 -ml-1 mr-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 shrink-0">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <Hash className="w-4 h-4 text-[#F7BC5F]" />
                <span className="font-bold">{activeChannel.name}</span>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-3">
                {messages.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 py-10">Aucun message pour l'instant. Lancez la conversation !</p>
                ) : (
                  messages.map((m) => {
                    const mine = (m.sender_id || m.data?.sender_id) === currentUser?.uid;
                    const isNova = isNovaReaction(m.data?.body || '');
                    const isEditing = editingChannelMsgId === m.id;
                    return (
                    <div key={m.id} className={`group flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      <div className={`flex items-end gap-1.5 max-w-[70%] ${mine ? 'flex-row-reverse' : ''}`}>
                      <div className={`px-3.5 py-2 rounded-2xl text-sm ${
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
                          <div className="flex flex-col gap-2 min-w-[200px]">
                            <textarea
                              value={editingChannelMsgText}
                              onChange={(e) => setEditingChannelMsgText(e.target.value)}
                              className="bg-black/20 rounded-lg p-2 text-xs text-inherit border border-black/20 focus:outline-none resize-none"
                              rows={2}
                              autoFocus
                            />
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => setEditingChannelMsgId(null)} className="text-[10px] opacity-70 hover:opacity-100">Annuler</button>
                              <button type="button" onClick={() => void handleSaveEditChannelMsg(m.id)} className="text-[10px] font-bold underline">Enregistrer</button>
                            </div>
                          </div>
                        ) : isNova ? (
                          <img src={m.data?.body} alt="Nova" className="w-14 h-14 object-contain" />
                        ) : (
                          <p className="whitespace-pre-line">{linkifyText(m.data?.body || '')}</p>
                        )}
                      </div>
                      {/* Demande explicite (30/08/2026) : "chaque utilisateur qui
                          envoie un message [peut] le modifier ou le supprimer,
                          [et] le super admin ou admin pourra également supprimer
                          un message" — modifier réservé à l'auteur (et aux
                          messages texte, pas aux mascottes Nova), supprimer
                          ouvert à l'auteur ET à isAdmin (super_admin ou admin,
                          voir la définition en haut du composant). */}
                      {!isEditing && (mine || isAdmin) && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
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
                          <button
                            type="button"
                            onClick={() => void handleDeleteChannelMsg(m.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"
                            title="Supprimer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1">{formatTime(m.created_at)}</span>
                    </div>
                  );})
                )}
              </div>

              <div className="p-4 border-t border-white/20 flex items-center gap-2">
                {/* Ticket #10 (nouvelle base) : le composer des canaux d'équipe
                    n'avait aucun accès emoji — ajout d'un picker au même
                    endroit et avec la même palette élargie que côté messages
                    directs. */}
                <div className="relative" ref={channelEmojiRef}>
                  <button
                    type="button"
                    onClick={() => setShowChannelEmoji((v) => !v)}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                    title="Emoji"
                  >
                    <Smile className="w-5 h-5" />
                  </button>
                  {showChannelEmoji && (
                    <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-6 gap-2 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max max-w-[440px] max-h-[340px] overflow-y-auto custom-scrollbar">
                      {QUICK_EMOJIS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setDraft((v) => v + e)}
                          className="text-4xl leading-none hover:scale-110 transition-transform p-2 rounded-xl hover:bg-white/10"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative" ref={channelNovaPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowChannelNovaPicker((v) => !v)}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                    title="Envoyer une mascotte Nova"
                  >
                    <img src="/nova/expressions/nova-neutre.png" alt="Nova" className="w-6 h-6 object-contain" />
                  </button>
                  {showChannelNovaPicker && (
                    <div className="absolute z-20 bottom-full mb-2 left-0 grid grid-cols-3 gap-2.5 bg-[#0b1c1e] border border-white/20 rounded-xl p-3 shadow-xl w-max">
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
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Voir commentaire équivalent côté conversations directes.
                    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.repeat) return;
                    e.preventDefault();
                    void sendMessage();
                  }}
                  placeholder="Écrire un message..."
                  className="flex-1 bg-[#0b1c1e] border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                />
                <button
                  onClick={sendMessage}
                  className="p-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d4a83b] text-slate-950"
                >
                  <Send className="w-4 h-4" />
                </button>
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

      {/* Modal Nouvelle conversation */}
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
    </div>
  );
}
