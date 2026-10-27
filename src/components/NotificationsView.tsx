import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AlertCircle,
  Bell,
  BellRing,
  Camera,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Headphones,
  Info,
  Loader2,
  MessageSquare,
  MoveRight,
  RefreshCw,
  Send,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react';

import {
  supabase,
} from '@/lib/supabase';
import { cibleDepuisLien } from '@/lib/lienNotification';
import { filOuvert, notifsChatAAnnoncer, regardeDejaLeFil, texteAnnonce } from '@/lib/alerteChat';
import { fermerNotificationsSysteme, notificationsDisparues } from '@/lib/notificationsLues';
import { toast } from 'sonner';

import {
  useAuth,
} from '@/context/AuthContext';

import { useIsMobile } from '@/hooks/use-mobile';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { isStandaloneApp } from '@/hooks/useIsStandalone';
import { UpdateStatusBadge } from './UpdateStatusBadge';

interface RealNotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
  agency_id: string | null;
  metadata?: Record<string, unknown> | null;
}

interface NotificationsViewProps {
  onNavigate: (
    nav: string
  ) => void;
  onOpenContact?: (contactId: string, tab?: 'espace-client') => void;
  // Ouvre directement la conversation/canal du message ciblé — sans ça, un
  // clic sur une notif "message" ne faisait que naviguer vers l'onglet Chat
  // générique (liste des projets), sans jamais ouvrir la bonne conversation.
  onOpenMessage?: (cible: { messageId?: string; conversationId?: string; channelId?: string }) => void;
  /** Vrai quand le tiroir est ouvert : on recharge la liste tout de suite. */
  ouverte?: boolean;
  // Signalé (8 septembre) : « cliquer sur la notif d'un message dans un
  // projet ne m'amène pas directement au projet ». Même principe
  // qu'onOpenMessage, mais pour une carte de projet interne : ouvre
  // directement son projet + sa fiche détail au lieu de la liste générique.
  onOpenInternalTask?: (taskId: string, messageId?: string) => void;
}

interface ChatMessageRow {
  id: string;
  sender?: string;
  senderId?: string;
  message?: string;
  agencyId?: string;
  channel?: string;
  timestamp?: string;
  createdAt?: string;
  isDeleted?: boolean;
  readBy?: {
    userId: string;
    readAt?: string;
  }[];
}

interface SupportTicketRow {
  id: string;
  subject?: string;
  description?: string;
  status?: string;
  priority?: string;
  agencyId?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface CameraReservationRow {
  id: string;
  equipmentName?: string;
  projectName?: string;
  propertyAddress?: string;
  status?: string;
  agencyId?: string;
  startDate?: string;
  createdAt?: string;
}

interface InternalProjectRow {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  agencyId?: string;
  assignedUserId?: string;
  deadline?: string;
  updatedAt?: string;
}

type NotificationItem = {
  id: string;
  type:
    | 'chat'
    | 'support'
    | 'camera'
    | 'project';

  title: string;
  description: string;
  date: string;

  navTarget: string;
  contactId?: string;
  // Signalé : "le clic sur la notif du message du client doit envoyer sur
  // le chat Espace Client de la fiche" — plutôt que l'onglet RDV par
  // défaut de la fiche client.
  contactTab?: 'espace-client';
  messageId?: string;
  conversationId?: string;
  channelId?: string;
  taskId?: string;
  // Id du message précis à l'intérieur de la carte de projet interne — voir
  // useTaskMessages.ts (message_id dans les métadonnées). Distinct de
  // `messageId` ci-dessus, réservé à la messagerie (/messagerie?highlight=).
  taskMessageId?: string;
  rawType: string;

  priority:
    | 'normal'
    | 'important'
    | 'urgent';
};

// Notifications factices pour tester la différenciation visuelle et les couleurs dans la clochette
const MOCK_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'mock-camera-1',
    type: 'camera',
    rawType: 'camera_reservation',
    priority: 'urgent',
    title: 'Réservation Caméra 360 confirmée',
    description: 'Matériel réservé pour demain 10h00 - Visite virtuelle Villa Cannes.',
    date: new Date().toISOString(),
    navTarget: 'reserver-camera',
  },
  {
    id: 'mock-urgent-1',
    type: 'project',
    rawType: 'urgent_deadline',
    priority: 'urgent',
    title: 'Offre de prêt expirant aujourd’hui',
    description: 'Dossier M. Dupont : la banque attend l’accord signé avant 18h00 pour finaliser le prêt.',
    date: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    navTarget: 'pipeline',
  },
  {
    id: 'mock-chat-1',
    type: 'chat',
    rawType: 'chat_message',
    priority: 'important',
    title: 'Message de Natacha (Canal Général)',
    description: '« Peux-tu vérifier les pièces justificatives manquantes pour le dossier ImmoSphera ? »',
    date: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    navTarget: 'chat',
  },
  {
    id: 'mock-lead-1',
    type: 'project',
    rawType: 'lead_assigned',
    priority: 'important',
    title: 'Nouveau lead attribué : Sophie Martin',
    description: 'Recherche appartement 3 pièces centre-ville avec balcon (Budget max 320 000 €).',
    date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    navTarget: 'clients',
  },
  {
    id: 'mock-task-1',
    type: 'project',
    rawType: 'internal_task',
    priority: 'normal',
    title: 'Rappel : Relance commerciale investisseurs',
    description: 'Prévoir un appel de suivi pour 5 clients prioritaires avant la fin de semaine.',
    date: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    navTarget: 'projets-internes',
  },
  {
    id: 'mock-support-1',
    type: 'support',
    rawType: 'support_ticket',
    priority: 'normal',
    title: 'Ticket Support #1042 résolu',
    description: 'Votre demande d’export comptable a été traitée et validée avec succès.',
    date: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    navTarget: 'support',
  },
];

function safeDate(
  value?: string
) {
  if (!value) {
    return 0;
  }

  const normalized =
    value.includes('T')
      ? value
      : value.replace(
          ' ',
          'T'
        );

  const timestamp =
    new Date(
      normalized
    ).getTime();

  return Number.isNaN(
    timestamp
  )
    ? 0
    : timestamp;
}

function formatDate(
  value?: string
) {
  if (!value) {
    return '';
  }

  const normalized =
    value.includes('T')
      ? value
      : value.replace(
          ' ',
          'T'
        );

  const date =
    new Date(
      normalized
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    'fr-FR',
    {
      dateStyle:
        'short',
      timeStyle:
        'short',
    }
  ).format(date);
}

export const NotificationsView: React.FC<
  NotificationsViewProps
> = ({
  onNavigate,
  onOpenContact,
  onOpenMessage,
  onOpenInternalTask,
  ouverte = false,
}) => {
  const {
    currentUser,
    userProfile,
    activeAgency,
  } = useAuth();

  const [
    chatMessages,
    setChatMessages,
  ] = useState<
    ChatMessageRow[]
  >([]);

  const [
    supportTickets,
    setSupportTickets,
  ] = useState<
    SupportTicketRow[]
  >([]);

  const [
    cameraReservations,
    setCameraReservations,
  ] = useState<
    CameraReservationRow[]
  >([]);

  const [
    projects,
    setProjects,
  ] = useState<
    InternalProjectRow[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  // Abonnement push réel (VAPID) — reflète l'état effectif de l'appareil
  // (permission accordée ET abonnement enregistré côté serveur), pas
  // seulement la permission du navigateur. C'est ce badge qui répond à
  // "le téléphone est-il vraiment enregistré pour recevoir des alertes ?".
  const {
    supported: pushSupported,
    permission: pushPermission,
    subscribed: pushSubscribed,
    busy: pushBusy,
    checking: pushChecking,
    subscribe: subscribePush,
    sendTest: sendTestPush,
  } = usePushNotifications();

  // Audit (9 septembre) : « Sylvain et d'autres utilisateurs ne reçoivent
  // pas les notifications sur iPhone ». Vérifié côté serveur (logs de
  // send-push) : chaque envoi vers leurs iPhone est accepté par Apple
  // (status 201) à chaque fois, sans une seule erreur — le problème n'est
  // ni le serveur, ni l'abonnement (bien enregistré en base), ni le code
  // d'envoi. C'est une restriction d'iOS/Safari elle-même, peu connue :
  // depuis iOS 16.4, Safari n'affiche JAMAIS une notification push — même
  // acceptée par Apple — si le site est ouvert comme un simple onglet ou
  // favori. Ça ne fonctionne QUE si l'appli a été ajoutée à l'écran
  // d'accueil et est ouverte DEPUIS cette icône (mode "standalone"). Rien
  // dans l'appli n'avertissait de cette condition — l'utilisateur pouvait
  // activer les alertes avec succès (permission accordée, abonnement créé)
  // sans jamais recevoir la moindre notification, pour une raison invisible
  // depuis l'appli elle-même.
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = isStandaloneApp();
  const needsHomeScreenInstall = isIOS && !isStandalone;
  // Signalé (10 septembre, Pauline) : « ça marque permission refusée » sur
  // le raccourci Chrome Android, alors que « tout est bien mis en place ».
  // Une fois qu'un utilisateur refuse (ou que Chrome/Android bloque après
  // plusieurs demandes ignorées) la permission de notification pour le
  // site, `Notification.requestPermission()` renvoie 'denied' SANS jamais
  // réafficher la popup système — aucun code JS ne peut la redemander. Le
  // bouton "Réactiver dans les réglages" ci-dessous appelait donc cette
  // même fonction en boucle, sans jamais aboutir ni expliquer où se trouve
  // le réglage à changer manuellement (spécifique à chaque navigateur).
  // Absent aussi : le fait qu'un simple raccourci Chrome (icône ajoutée
  // depuis "Ajouter à l'écran d'accueil" version raccourci, plutôt qu'une
  // vraie installation d'appli/WebAPK) ne prend jamais en charge la
  // pastille numérotée sur l'icône, quel que soit l'état des notifications
  // — ce n'est pas un bug côté Nova CRM, Chrome ne l'implémente que pour
  // les PWA installées comme applications.
  const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

  const [
    testFeedback,
    setTestFeedback,
  ] = useState<string | null>(null);

  const handleEnablePush = async () => {
    const ok = await subscribePush();
    if (ok) {
      setTestFeedback('Notifications push activées sur cet appareil !');
      setTimeout(() => setTestFeedback(null), 4000);
    }
  };

  const handleSendTestNotification = async () => {
    const result = await sendTestPush();
    if (result?.error) {
      setTestFeedback("Erreur lors de l'envoi de la notification de test.");
    } else {
      setTestFeedback('Notification de test envoyée ! Regardez votre écran/barre de notifications.');
    }
    setTimeout(() => setTestFeedback(null), 5000);
  };

  const [realNotifications, setRealNotifications] = useState<RealNotificationRow[]>([]);
  const [dismissedMockIds, setDismissedMockIds] = useState<string[]>([]);
  // Ticket #40 (nouvelle base) : la carte "Rappels & Alertes sur mobile"
  // prenait toute la place en haut du panneau — repliée par défaut, elle ne
  // s'ouvre qu'au clic (ou reste dépliée automatiquement une seule fois
  // tant que les notifications ne sont pas encore actives sur l'appareil).
  const [pushCardExpanded, setPushCardExpanded] = useState(false);

  const dejaAnnoncees = useRef<Set<string> | null>(null);
  const nonLuesPrecedentes = useRef<RealNotificationRow[] | null>(null);
  const onOpenMessageRef = useRef(onOpenMessage);
  onOpenMessageRef.current = onOpenMessage;
  const chargementListe = useRef(false);
  const relancerListe = useRef(false);

  const loadNotifications = async () => {
    if (!currentUser) {
      setRealNotifications([]);
      setLoading(false);
      return;
    }
    if (chargementListe.current) {
      relancerListe.current = true;
      return;
    }
    chargementListe.current = true;
    try {
      do {
        relancerListe.current = false;
        // Filtre is_read=false directement côté serveur (au lieu de charger les
        // 100 dernières notifications toutes confondues puis filtrer côté
        // client) : avec .limit(100), un utilisateur ayant plus de 100
        // notifications lues+non lues cumulées voyait des non-lues ANCIENNES
        // disparaître de cette liste alors qu'elles comptaient toujours dans le
        // badge de la cloche (qui, lui, compte côté serveur sans limite) — la
        // cloche et ce panneau affichaient donc deux chiffres différents.
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', currentUser.uid)
          .eq('is_read', false)
          .is('dismissed_at', null)
          .order('created_at', { ascending: false })
          .limit(300);
        if (error) continue;
        const rows = (data as RealNotificationRow[]) || [];
        const fil = filOuvert();
        const fraiches = notifsChatAAnnoncer(dejaAnnoncees.current, rows, Date.now()).filter(
          (n) => !regardeDejaLeFil(fil.chatVisible, fil.onglet, fil.conversationId, n.link),
        );
        dejaAnnoncees.current = new Set(rows.map((n) => n.id));
        // Une ligne qui n'est plus non lue a été lue sur cet appareil ou un
        // autre : on retire aussi la bannière système d'ici.
        fermerNotificationsSysteme(notificationsDisparues(nonLuesPrecedentes.current, rows));
        nonLuesPrecedentes.current = rows;
        const annonce = texteAnnonce(fraiches);
        if (annonce) {
          toast(annonce.titre, {
            description: annonce.description,
            action: {
              label: 'Ouvrir',
              onClick: () => onOpenMessageRef.current?.(cibleDepuisLien(annonce.lien)),
            },
          });
        }
        setRealNotifications(rows);
      } while (relancerListe.current);
    } finally {
      chargementListe.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();

    if (!currentUser) return;

    const channel = supabase
      .channel(`notifications_view_${currentUser.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.uid}` },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    // Le temps réel peut arriver en retard. Tant que l'onglet est visible,
    // un sondage court rattrape un chat reçu sans attendre une demi-minute.
    let poll: number | null = null;
    const demarrer = () => {
      if (poll) return;
      poll = window.setInterval(() => { void loadNotifications(); }, 8000);
    };
    const arreter = () => {
      if (poll) window.clearInterval(poll);
      poll = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadNotifications();
        demarrer();
      } else {
        arreter();
      }
    };
    if (document.visibilityState === 'visible') demarrer();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      supabase.removeChannel(channel);
      arreter();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  useEffect(() => {
    if (ouverte) void loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouverte]);

  // Au retour sur cet appareil, ferme les bannières déjà lues ailleurs
  // pendant que l'application était fermée.
  useEffect(() => {
    if (!currentUser) return;
    let annule = false;
    const depuis = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    void supabase
      .from('notifications')
      .select('id, type, link, entity_id, entity_type')
      .eq('user_id', currentUser.uid)
      .or('is_read.eq.true,dismissed_at.not.is.null')
      .gte('created_at', depuis)
      .order('created_at', { ascending: false })
      .limit(80)
      .then(({ data }) => {
        if (!annule && data) fermerNotificationsSysteme(data);
      });
    return () => { annule = true; };
  }, [currentUser?.uid]);

  const markNotificationRead = async (id: string) => {
    const row = realNotifications.find((n) => n.id === id);
    if (row) fermerNotificationsSysteme([row]);
    setRealNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  };

  // Suppression individuelle uniquement (jamais de suppression groupée, pour
  // ne jamais risquer de perdre une notification par erreur) : on masque la
  // notification via `dismissed_at` plutôt qu'un DELETE, ce qui l'exclut
  // immédiatement de `loadNotifications()` (filtre `.is('dismissed_at', null)`).
  const dismissNotification = async (id: string) => {
    if (id.startsWith('mock-')) {
      setDismissedMockIds((prev) => [...prev, id]);
      return;
    }
    const row = realNotifications.find((n) => n.id === id);
    if (row) fermerNotificationsSysteme([row]);
    setRealNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('notifications').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
  };

  const dismissAllNotifications = async () => {
    setDismissedMockIds(MOCK_NOTIFICATIONS.map((m) => m.id));
    const ids = visibleNotifications.map((n) => n.id).filter((id) => !id.startsWith('mock-'));
    if (!ids.length) return;
    const rows = realNotifications.filter((n) => ids.includes(n.id));
    fermerNotificationsSysteme(rows);
    setRealNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
    await supabase.from('notifications').update({ dismissed_at: new Date().toISOString() }).in('id', ids);
  };

  const canSeeAgency = (
    agencyId?: string
  ) => {
    if (
      agencyId ===
      'all'
    ) {
      return true;
    }

    if (
      userProfile?.role ===
      'super_admin'
    ) {
      if (
        activeAgency.id ===
        'all'
      ) {
        return true;
      }

      return (
        !agencyId ||
        agencyId ===
          activeAgency.id
      );
    }

    if (
      !agencyId
    ) {
      return false;
    }

    if (
      activeAgency.id !==
        'all' &&
      agencyId !==
        activeAgency.id
    ) {
      return false;
    }

    return (
      userProfile
        ?.agencyIds
        .includes(
          agencyId
        ) === true
    );
  };

  const bucketFor = (type: string): NotificationItem['type'] => {
    if (type.startsWith('camera_reservation')) return 'camera';
    if (['lead_assigned', 'lead_moved', 'task_assigned', 'shared_task', 'share', 'shared_document'].includes(type)) {
      return 'project';
    }
    // Signalé : "push reçu mais pas de notif dans la clochette" (mobile) —
    // cause réelle trouvée : `client_message` (notification envoyée à
    // l'espace client, voir ClientGuestShell.tsx) ne correspondait à aucun
    // type ci-dessous et retombait sur le bucket 'support' par défaut — or
    // sur mobile, la clochette est volontairement réduite à 'chat'/'camera'
    // (voir plus bas), donc ce type disparaissait silencieusement.
    if (['message', 'mention', 'shared_message', 'reaction', 'task_message', 'announcement', 'daily_summary', 'shared_note', 'shared_chat_message', 'client_message'].includes(type)) {
      return 'chat';
    }
    return 'support';
  };

  // Ticket #10/#11 : redirection fiable au clic. Priorité au champ `link`
  // (déjà renseigné avec le bon chemin par les triggers en base) plutôt
  // qu'à des heuristiques type/entity_type incomplètes qui laissaient
  // beaucoup de notifications (mention, reaction, tâche interne...)
  // retomber par défaut sur l'accueil au lieu de leur vraie cible.
  const navTargetFor = (n: RealNotificationRow): string => {
    const link = n.link || '';
    if (/^\/clients\//.test(link)) return 'clients';
    if (link.startsWith('/projets-internes')) return 'projets-internes';
    if (link.startsWith('/messagerie')) return 'chat';
    if (link.startsWith('/notes')) return 'notes';
    if (link.startsWith('/rappels')) return 'rappels';
    if (link.startsWith('/documents')) return 'documents';
    if (link.startsWith('/support')) return 'support';
    if (link.startsWith('/reserver-camera')) return 'reserver-camera';

    // Pas de lien exploitable (ou absent) : on retombe sur le type/entity_type.
    if (n.entity_type === 'internal_task' || n.entity_type === 'internal_task_message') return 'projets-internes';
    if (n.entity_type === 'lead' || n.entity_type === 'comment' || n.entity_type === 'lead_chat') return 'clients';
    if (n.entity_type === 'note') return 'notes';
    if (n.entity_type === 'support_ticket' || n.type.startsWith('support_ticket')) return 'support';
    if (n.type.startsWith('camera_reservation')) return 'reserver-camera';
    if (n.type === 'task_assigned' || n.type === 'shared_task') return 'rappels';
    if (n.type === 'shared_document') return 'documents';
    if (['message', 'shared_message', 'mention', 'reaction', 'task_message'].includes(n.type)) return 'chat';
    return 'accueil';
  };

  const notifications = useMemo(() => {
    return realNotifications
      .filter((n) => !n.is_read)
      .map((n) => ({
        id: n.id,
        type: bucketFor(n.type),
        title: n.title || 'Notification',
        description: n.body || '',
        date: n.created_at,
        navTarget: navTargetFor(n),
        contactId: n.link?.match(/\/clients\/([0-9a-f-]{36})/)?.[1],
        contactTab: n.type === 'client_message' ? 'espace-client' : undefined,
        // Le lien réel est tantôt `?highlight=`, tantôt `?conversation=&message=`,
        // tantôt `?channel=&message=`. Sans les trois, le clic ouvrait le chat
        // sur la liste, jamais sur le message.
        ...(() => {
          const cible = cibleDepuisLien(n.link);
          return {
            messageId: cible.messageId,
            conversationId: cible.conversationId,
            channelId: cible.channelId,
          };
        })(),
        // Id de la CARTE de projet interne — encodé dans `link` (voir
        // useTaskMessages.ts, `?task=<id>`) et non dans les métadonnées : la
        // table `notifications` n'a PAS de colonne `metadata`, un premier
        // essai s'appuyant dessus (16 septembre) était donc inopérant, la
        // fonction SQL create_notification ne persistant que `link`. Repli
        // sur `entity_id` pour d'éventuelles anciennes notifications sans ce
        // paramètre (posées avant ce correctif, ou de type 'internal_task').
        taskId: (n.entity_type === 'internal_task' || n.entity_type === 'internal_task_message')
          ? (n.link?.match(/[?&]task=([0-9a-f-]{36})/)?.[1] || (n.entity_type === 'internal_task' ? n.entity_id || undefined : undefined))
          : undefined,
        // Signalé (16 septembre, Novavisio/Diane) : « en cliquant sur la
        // notification cela ne nous emmène pas à son message » — le message
        // précis à l'intérieur de la carte, réutilise le même `?highlight=`
        // que `messageId` ci-dessus (posé par useTaskMessages.ts).
        taskMessageId: (n.entity_type === 'internal_task' || n.entity_type === 'internal_task_message')
          ? n.link?.match(/[?&]highlight(?:_message)?=([0-9a-f-]{36})/)?.[1]
          : undefined,
        rawType: n.type,
        priority: n.type === 'lead_assigned' || n.type === 'task_assigned' ? 'important' : 'normal',
      } as NotificationItem));
  }, [realNotifications]);


  const isMobile = useIsMobile();
  // Sur mobile, la clochette est volontairement réduite aux messages et aux
  // réservations caméra (demande explicite) — les rappels/alertes et les
  // mails y créaient trop de bruit sans correspondre à ce que l'utilisateur
  // retrouve réellement dans la barre de notifications du téléphone.
  // Signalé : "quand on partage une fiche client, la personne reçoit la
  // notif push sur téléphone mais pas sur la petite cloche" — cause réelle
  // trouvée : le partage de fiche (type `share`, déclenché par un trigger
  // Postgres) est catégorisé dans le bucket 'project', exclu du filtre
  // mobile ci-dessous. C'est une notification personnelle et ponctuelle
  // (pas du bruit récurrent comme les autres notifications 'project'), on
  // l'autorise donc explicitement sur mobile sans élargir tout le bucket.
  // Les notifications factices ne s'affichent que sur les environnements de test / préproduction
  // pour ne pas polluer les vrais comptes utilisateurs en production sur main.
  const isTestEnv = useMemo(() => {
    try {
      if (typeof window === 'undefined') return false;
      const host = window.location.hostname;
      if (host.includes('test') || host.includes('localhost') || host === '127.0.0.1') return true;
      if (typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__.ref && __BUILD_INFO__.ref !== 'main') return true;
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  const mockNotifications = useMemo(
    () => (isTestEnv ? MOCK_NOTIFICATIONS.filter((m) => !dismissedMockIds.includes(m.id)) : []),
    [dismissedMockIds, isTestEnv]
  );
  const allNotifications = useMemo(
    () =>
      [...mockNotifications, ...notifications].filter(
        (n) => n.rawType !== 'app_update' && n.navTarget !== 'update'
      ),
    [mockNotifications, notifications]
  );
  const mobileNotifications = useMemo(
    () => allNotifications.filter((n) => n.type === 'chat' || n.type === 'camera' || n.rawType === 'share' || n.id.startsWith('mock-')),
    [allNotifications],
  );
  const visibleNotifications = isMobile ? mobileNotifications : allNotifications;

  const buildStampText = useMemo(() => {
    if (typeof __BUILD_INFO__ === 'undefined' || !__BUILD_INFO__?.sha) return '';
    const sha = __BUILD_INFO__.sha;
    const dateStr = __BUILD_INFO__.at
      ? new Date(__BUILD_INFO__.at).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    return [sha, dateStr].filter(Boolean).join(' · ');
  }, []);

  // Ticket #220 (v4) : pas juste "la même icône" mais la miniature de la
  // VRAIE tuile d'accueil correspondante (AccueilGrid.tsx) — même dégradé
  // de couleur ET même icône, comme un mini-clone de la tuile, exactement
  // le même principe déjà utilisé pour la mini-vignette du sélecteur de
  // tuile dans AccueilGrid.tsx (span w-8 h-8 + bg-gradient-to-br + icône
  // blanche).
  const tileFor = (
    type: NotificationItem['type']
  ): { Icon: React.ElementType; gradient: string } => {
    if (type === 'chat') {
      // Tuile "Chat Équipe".
      return { Icon: MessageSquare, gradient: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]' };
    }
    if (type === 'support') {
      // Tuile "Support".
      return { Icon: Headphones, gradient: 'from-[#334155] via-[#1E293B] to-[#0F172A]' };
    }
    if (type === 'camera') {
      // Tuile "Réserver caméra".
      return { Icon: Camera, gradient: 'from-[#D97706] via-[#B45309] to-[#78350F]' };
    }
    // Tuile "Pipeline interne" (projets internes, bucket par défaut).
    return { Icon: CheckSquare, gradient: 'from-[#7C3AED] via-[#5B21B6] to-[#2E1065]' };
  };

  return (
    <div className="p-4 sm:p-5 max-w-full space-y-4 text-white">
      {/* Barre de statut KPI & Actions */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-[#07191b]/90 via-[#0d282b]/80 to-[#07191b]/90 border border-teal-500/20 shadow-lg backdrop-blur-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#FAD592] flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(247,188,95,0.2)]">
            <BellRing className="w-4 h-4 text-[#F7BC5F]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-wide">Alertes actives</span>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/35 shadow-sm">
                {visibleNotifications.length}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">{activeAgency.name}</p>
          </div>
        </div>

        {visibleNotifications.length > 0 && (
          <button
            type="button"
            onClick={dismissAllNotifications}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            title="Effacer toutes les alertes de cette liste"
          >
            Tout effacer
          </button>
        )}
      </div>

      {/* Mobile Push & PWA Notifications Card — repliée par défaut */}
      <div className="rounded-2xl bg-[#07191b]/90 border border-[#144447]/80 shadow-md overflow-hidden backdrop-blur-md">
        <button
          type="button"
          onClick={() => setPushCardExpanded((v) => !v)}
          className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left transition-colors hover:bg-white/[0.03]"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#143c3f] border border-[#1e585c] text-[#F7BC5F] flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold text-slate-200 text-xs truncate">Rappels &amp; Alertes sur mobile</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pushChecking ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-slate-300 border border-white/10">
                <Loader2 className="w-3 h-3 animate-spin" /> Vérification...
              </span>
            ) : pushSubscribed ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-3 h-3" /> Actives
              </span>
            ) : pushPermission === 'denied' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                <AlertCircle className="w-3 h-3" /> Bloquées
              </span>
            ) : !pushSupported ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                <AlertCircle className="w-3 h-3" /> Non supporté
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <AlertCircle className="w-3 h-3" /> À activer
              </span>
            )}
            {pushCardExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
          </div>
        </button>

        {pushCardExpanded && (
          <div className="px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-white/5">
            <p className="text-xs text-gray-400">
              Recevez les messages du chat, alertes dossiers et réservations en temps réel sur votre smartphone.
            </p>

            {needsHomeScreenInstall && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <strong>Sur iPhone, les notifications ne fonctionnent que si l'appli est ajoutée à l'écran d'accueil</strong> — même en activant les alertes ici, rien n'arrivera depuis Safari. Ouvre le menu Partager <span className="whitespace-nowrap">(⬆️)</span> puis « Sur l'écran d'accueil », et lance ensuite Nova CRM depuis cette icône.
                </span>
              </div>
            )}

            {pushPermission === 'denied' && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                <span>
                  <strong>Notifications bloquées pour Nova CRM dans ce navigateur.</strong> Une fois refusée, la permission ne peut plus être redemandée depuis l'appli :
                  {isAndroid ? (
                    <>
                      {' '}sur Android Chrome, touche l'icône <span className="whitespace-nowrap">🔒 / ⓘ</span> à gauche de l'adresse du site, ouvre « Autorisations » → « Notifications » et choisis « Autoriser ».
                    </>
                  ) : (
                    <>
                      {' '}ouvre les réglages du site dans ton navigateur (icône 🔒 / ⓘ à côté de l'adresse), section Notifications, et choisis « Autoriser », puis recharge la page.
                    </>
                  )}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!pushSubscribed && pushSupported && (
                <button
                  onClick={handleEnablePush}
                  disabled={pushBusy}
                  className="px-3.5 py-1.5 bg-[#F7BC5F] hover:bg-[#d4a838] text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-60"
                >
                  {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
                  {pushPermission === 'denied' ? 'Réactiver dans les réglages' : 'Activer les alertes'}
                </button>
              )}

              {pushSubscribed && (
                <button
                  onClick={handleSendTestNotification}
                  disabled={pushBusy}
                  className="px-3 py-1.5 bg-[#143c3f] hover:bg-[#1e585c] text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 border border-white/10 transition-all cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-3 h-3 text-[#F7BC5F]" />
                  Tester une alerte
                </button>
              )}
            </div>

            {testFeedback && (
              <div className="p-2.5 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/30 text-[#FBE0AE] text-xs flex items-center gap-2 animate-fade-in">
                <Info className="w-3.5 h-3.5 flex-shrink-0 text-[#F7BC5F]" />
                <span>{testFeedback}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-10 text-center rounded-2xl bg-white/[0.02] border border-white/5 text-slate-400 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#F7BC5F]" />
          <p className="text-xs font-medium">Chargement des alertes...</p>
        </div>
      ) : visibleNotifications.length === 0 ? (
        <div className="p-10 text-center rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center gap-2.5">
          <div className="w-12 h-12 rounded-2xl bg-teal-900/30 border border-teal-700/30 flex items-center justify-center text-teal-400/80">
            <CheckCircle2 className="w-6 h-6 text-emerald-400/90" />
          </div>
          <p className="text-sm font-bold text-white">Aucune alerte active</p>
          <p className="text-xs text-slate-400 max-w-xs">Toutes vos actions et notifications sont à jour pour le moment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleNotifications.map((notification) => renderNotificationRow(notification))}
        </div>
      )}

      {/* État système & version — positionné proprement en bas du panneau */}
      <div className="pt-2 pb-1 flex items-center justify-center">
        <UpdateStatusBadge showDetails />
      </div>
    </div>
  );

  function getNotificationTheme(notification: NotificationItem) {
    const isAppUpdate = notification.rawType === 'app_update';
    if (notification.priority === 'urgent' || notification.rawType.includes('urgent')) {
      return {
        cardBorder: 'border-rose-500/50 hover:border-rose-400/80',
        cardBg: 'bg-gradient-to-r from-rose-950/50 via-[#220a13]/90 to-[#071317]/95',
        cardShadow: 'shadow-[0_4px_24px_rgba(244,63,94,0.2)]',
        leftAccent: 'border-l-[5px] border-l-rose-500',
        badgeBg: 'bg-rose-500/25 text-rose-200 border border-rose-500/40',
        badgeText: 'Urgent',
        iconBg: 'from-rose-500 via-rose-600 to-red-700',
        iconBorder: 'border-rose-400/50 shadow-[0_0_14px_rgba(244,63,94,0.4)]',
        Icon: AlertCircle,
      };
    }
    if (isAppUpdate) {
      return {
        cardBorder: 'border-[#F7BC5F]/50 hover:border-[#F7BC5F]/80',
        cardBg: 'bg-gradient-to-r from-amber-950/45 via-[#1d1808]/90 to-[#071317]/95',
        cardShadow: 'shadow-[0_4px_20px_rgba(247,188,95,0.2)]',
        leftAccent: 'border-l-[5px] border-l-[#F7BC5F]',
        badgeBg: 'bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/40',
        badgeText: 'Système',
        iconBg: 'from-amber-500 to-yellow-600',
        iconBorder: 'border-[#F7BC5F]/40 shadow-[0_0_12px_rgba(247,188,95,0.3)]',
        Icon: BellRing,
      };
    }
    if (notification.type === 'chat' || notification.rawType.includes('chat') || notification.rawType.includes('message')) {
      return {
        cardBorder: 'border-sky-500/45 hover:border-sky-400/80',
        cardBg: 'bg-gradient-to-r from-sky-950/45 via-[#081e2b]/90 to-[#071317]/95',
        cardShadow: 'shadow-[0_4px_20px_rgba(56,189,248,0.18)]',
        leftAccent: 'border-l-[5px] border-l-sky-400',
        badgeBg: 'bg-sky-500/25 text-sky-200 border border-sky-400/40',
        badgeText: 'Messagerie',
        iconBg: 'from-sky-500 via-sky-600 to-blue-700',
        iconBorder: 'border-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.35)]',
        Icon: MessageSquare,
      };
    }
    if (notification.rawType.includes('lead') || notification.rawType.includes('contact') || notification.contactId) {
      return {
        cardBorder: 'border-emerald-500/45 hover:border-emerald-400/80',
        cardBg: 'bg-gradient-to-r from-emerald-950/45 via-[#08241b]/90 to-[#071317]/95',
        cardShadow: 'shadow-[0_4px_20px_rgba(52,211,153,0.18)]',
        leftAccent: 'border-l-[5px] border-l-emerald-400',
        badgeBg: 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40',
        badgeText: 'Client & Lead',
        iconBg: 'from-emerald-500 via-emerald-600 to-teal-700',
        iconBorder: 'border-emerald-400/40 shadow-[0_0_12px_rgba(52,211,153,0.35)]',
        Icon: CheckCircle2,
      };
    }
    if (notification.type === 'support' || notification.rawType.includes('support') || notification.rawType.includes('ticket')) {
      return {
        cardBorder: 'border-purple-500/45 hover:border-purple-400/80',
        cardBg: 'bg-gradient-to-r from-purple-950/45 via-[#1a0e2a]/90 to-[#071317]/95',
        cardShadow: 'shadow-[0_4px_20px_rgba(192,132,252,0.18)]',
        leftAccent: 'border-l-[5px] border-l-purple-400',
        badgeBg: 'bg-purple-500/25 text-purple-200 border border-purple-400/40',
        badgeText: 'Support',
        iconBg: 'from-purple-500 via-purple-600 to-indigo-700',
        iconBorder: 'border-purple-400/40 shadow-[0_0_12px_rgba(192,132,252,0.35)]',
        Icon: Headphones,
      };
    }
    if (notification.type === 'camera' || notification.rawType.includes('camera')) {
      const isAccepted = notification.rawType.includes('accepted') || notification.rawType.includes('approved');
      const isRefused = notification.rawType.includes('refused') || notification.rawType.includes('rejected');
      if (isAccepted) {
        return {
          cardBorder: 'border-emerald-500/45 hover:border-emerald-400/80',
          cardBg: 'bg-gradient-to-r from-emerald-950/45 via-[#08241b]/90 to-[#071317]/95',
          cardShadow: 'shadow-[0_4px_20px_rgba(52,211,153,0.18)]',
          leftAccent: 'border-l-[5px] border-l-emerald-400',
          badgeBg: 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40',
          badgeText: 'Caméra validée',
          iconBg: 'from-emerald-400 via-emerald-500 to-teal-700',
          iconBorder: 'border-emerald-400/40 shadow-[0_0_12px_rgba(52,211,153,0.35)]',
          Icon: CheckCircle2,
        };
      }
      if (isRefused) {
        return {
          cardBorder: 'border-rose-500/45 hover:border-rose-400/80',
          cardBg: 'bg-gradient-to-r from-rose-950/45 via-[#220a13]/90 to-[#071317]/95',
          cardShadow: 'shadow-[0_4px_20px_rgba(244,63,94,0.18)]',
          leftAccent: 'border-l-[5px] border-l-rose-500',
          badgeBg: 'bg-rose-500/25 text-rose-200 border border-rose-400/40',
          badgeText: 'Caméra refusée',
          iconBg: 'from-rose-500 via-rose-600 to-red-700',
          iconBorder: 'border-rose-400/40 shadow-[0_0_12px_rgba(244,63,94,0.35)]',
          Icon: XCircle,
        };
      }
      return {
        cardBorder: 'border-teal-500/45 hover:border-teal-400/80',
        cardBg: 'bg-gradient-to-r from-teal-950/45 via-[#072528]/90 to-[#071317]/95',
        cardShadow: 'shadow-[0_4px_20px_rgba(45,212,191,0.18)]',
        leftAccent: 'border-l-[5px] border-l-teal-400',
        badgeBg: 'bg-teal-500/25 text-teal-200 border border-teal-400/40',
        badgeText: 'Caméra 360',
        iconBg: 'from-teal-400 via-teal-500 to-cyan-700',
        iconBorder: 'border-teal-400/40 shadow-[0_0_12px_rgba(45,212,191,0.35)]',
        Icon: Camera,
      };
    }
    // Tâches internes & projets par défaut
    return {
      cardBorder: 'border-amber-500/45 hover:border-amber-400/80',
      cardBg: 'bg-gradient-to-r from-amber-950/45 via-[#231a0a]/90 to-[#071317]/95',
      cardShadow: 'shadow-[0_4px_20px_rgba(251,191,36,0.18)]',
      leftAccent: 'border-l-[5px] border-l-amber-400',
      badgeBg: 'bg-amber-500/25 text-amber-200 border border-amber-400/40',
      badgeText: 'Tâche & Projet',
      iconBg: 'from-amber-500 via-amber-600 to-orange-700',
      iconBorder: 'border-amber-400/40 shadow-[0_0_12px_rgba(251,191,36,0.35)]',
      Icon: CheckSquare,
    };
  }

  function renderNotificationRow(notification: NotificationItem) {
    const isAppUpdate = notification.rawType === 'app_update';
    const theme = getNotificationTheme(notification);
    const IconComponent = theme.Icon;

    return (
      <div
        key={notification.id}
        className={`group relative w-full rounded-2xl border transition-all duration-200 overflow-hidden ${theme.leftAccent} ${theme.cardBorder} ${theme.cardBg} ${theme.cardShadow} hover:scale-[1.01]`}
      >
        {/* Bouton supprimer (croix) en haut à droite */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            void dismissNotification(notification.id);
          }}
          title="Supprimer cette alerte"
          className="absolute top-2.5 right-2.5 z-20 w-6 h-6 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div
          onClick={() => {
            if (notification.id.startsWith('mock-')) {
              if (notification.navTarget) onNavigate(notification.navTarget);
              return;
            }
            if (notification.rawType.startsWith('support_ticket')) {
              void dismissNotification(notification.id);
            } else if (notification.rawType === 'camera_reservation_request') {
              // Ne pas masquer la demande en cours sur simple clic tant qu'elle n'est pas traitée
            } else {
              void markNotificationRead(notification.id);
            }
            if (notification.contactId && onOpenContact) {
              onOpenContact(notification.contactId, notification.contactTab);
            } else if (
              notification.navTarget === 'chat' &&
              (notification.messageId || notification.conversationId || notification.channelId) &&
              onOpenMessage
            ) {
              onOpenMessage({
                messageId: notification.messageId,
                conversationId: notification.conversationId,
                channelId: notification.channelId,
              });
            } else if (notification.navTarget === 'projets-internes' && notification.taskId && onOpenInternalTask) {
              onOpenInternalTask(notification.taskId, notification.taskMessageId);
            } else {
              onNavigate(notification.navTarget);
            }
          }}
          className="p-3.5 pr-9 flex items-start gap-3 cursor-pointer"
        >
          {isAppUpdate ? (
            <div className="relative shrink-0 mt-0.5">
              <img
                src="/nova-mascotte.png"
                alt="Nova CRM"
                className="w-9 h-9 rounded-xl shrink-0 object-cover border border-[#F7BC5F]/50 bg-[#0a2528] shadow-[0_0_12px_rgba(247,188,95,0.25)] ring-1 ring-[#F7BC5F]/30"
              />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-[#07191b] animate-pulse" />
            </div>
          ) : (
            <div
              className={`w-9 h-9 rounded-xl shrink-0 mt-0.5 flex items-center justify-center bg-gradient-to-br ${theme.iconBg} border ${theme.iconBorder}`}
            >
              <IconComponent className="w-4 h-4 text-white" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-xs sm:text-sm font-bold text-white leading-snug">{notification.title}</h3>
              <span className={`text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full ${theme.badgeBg}`}>
                {theme.badgeText}
              </span>
            </div>

            <p className="text-xs text-slate-200/90 mt-1 leading-relaxed line-clamp-2">{notification.description}</p>

            <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
              {notification.date && (
                <p className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                  <Clock className="w-3 h-3 text-slate-400" />
                  {formatDate(notification.date)}
                </p>
              )}

              <div className="flex items-center gap-1 text-[11px] text-[#F7BC5F] font-semibold opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                <span>Consulter</span>
                <MoveRight className="w-3 h-3 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
};

// Section repliable "Rappels" / "Alertes" du centre de notifications mobile —
// le compteur reste visible même repliée, le contenu ne se déplie qu'au clic.
const NotificationSection: React.FC<{
  title: string;
  Icon: React.ElementType;
  items: NotificationItem[];
  open: boolean;
  onToggle: () => void;
  renderRow: (item: NotificationItem) => React.ReactNode;
}> = ({ title, Icon, items, open, onToggle, renderRow }) => {
  return (
    <div className="rounded-3xl bg-white/5 border border-white/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F7BC5F]/15 text-[#FAD592] flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <span className="text-sm font-bold text-white">{title}</span>
          <span className="min-w-5 h-5 px-1.5 rounded-full bg-white/10 text-white text-[11px] font-black flex items-center justify-center">
            {items.length}
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {items.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">Rien à signaler ici.</p>
          ) : (
            items.map((item) => renderRow(item))
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationsView;