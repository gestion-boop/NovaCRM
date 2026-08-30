import React, {
  useEffect,
  useMemo,
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
} from 'lucide-react';

import {
  supabase,
} from '@/lib/supabase';

import {
  useAuth,
} from '@/context/AuthContext';

import { useIsMobile } from '@/hooks/use-mobile';
import { usePushNotifications } from '@/hooks/use-push-notifications';

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
}

interface NotificationsViewProps {
  onNavigate: (
    nav: string
  ) => void;
  onOpenContact?: (contactId: string, tab?: 'espace-client') => void;
  // Ouvre directement la conversation/canal du message ciblé — sans ça, un
  // clic sur une notif "message" ne faisait que naviguer vers l'onglet Chat
  // générique (liste des projets), sans jamais ouvrir la bonne conversation.
  onOpenMessage?: (messageId: string) => void;
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
  rawType: string;

  priority:
    | 'normal'
    | 'important'
    | 'urgent';
};

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
  // Ticket #40 (nouvelle base) : la carte "Rappels & Alertes sur mobile"
  // prenait toute la place en haut du panneau — repliée par défaut, elle ne
  // s'ouvre qu'au clic (ou reste dépliée automatiquement une seule fois
  // tant que les notifications ne sont pas encore actives sur l'appareil).
  const [pushCardExpanded, setPushCardExpanded] = useState(false);

  const loadNotifications = async () => {
    if (!currentUser) {
      setRealNotifications([]);
      setLoading(false);
      return;
    }
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
    if (!error) setRealNotifications((data as RealNotificationRow[]) || []);
    setLoading(false);
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

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const markNotificationRead = async (id: string) => {
    setRealNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  };

  // Suppression individuelle uniquement (jamais de suppression groupée, pour
  // ne jamais risquer de perdre une notification par erreur) : on masque la
  // notification via `dismissed_at` plutôt qu'un DELETE, ce qui l'exclut
  // immédiatement de `loadNotifications()` (filtre `.is('dismissed_at', null)`).
  const dismissNotification = async (id: string) => {
    setRealNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('notifications').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
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
    if (n.entity_type === 'internal_task') return 'projets-internes';
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
        // Récupéré depuis le lien stocké par le trigger de message
        // (`?highlight=<id>` ou `&highlight_message=<id>`) — c'est ce qui
        // permet d'ouvrir directement la bonne conversation au clic.
        messageId: n.link?.match(/[?&]highlight(?:_message)?=([0-9a-f-]{36})/)?.[1],
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
  const mobileNotifications = useMemo(
    () => notifications.filter((n) => n.type === 'chat' || n.type === 'camera' || n.rawType === 'share'),
    [notifications],
  );
  const visibleNotifications = isMobile ? mobileNotifications : notifications;

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
    <div className="p-6 max-w-6xl mx-auto space-y-6 text-white">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[#F7BC5F]/20 border border-[#F7BC5F]/30 text-[#FAD592] flex items-center justify-center">
          <Bell className="w-5 h-5" />
        </div>

        <div>
          <h1 className="text-xl font-bold">
            Rappels & Alertes
          </h1>

          <p className="text-xs text-gray-400">
            Actions et éléments nécessitant votre attention.
          </p>
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">
            Alertes actives
          </p>

          <p className="text-3xl font-black text-[#F7BC5F] mt-1">
            {
              visibleNotifications.length
            }
          </p>
        </div>

        <p className="text-xs text-gray-500">
          {
            activeAgency.name
          }
        </p>
      </div>

      {/* Mobile Push & PWA Notifications Card — repliée par défaut (#40) */}
      <div className="rounded-3xl bg-[#07191b] border border-[#144447]/80 shadow-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setPushCardExpanded((v) => !v)}
          className="w-full p-4 flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1e585c] text-[#F7BC5F] flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-white text-sm truncate">Rappels & Alertes sur mobile</h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Badge vérifié à chaque connexion/retour sur l'app : vert
                seulement si la permission ET l'abonnement serveur sont
                tous les deux actifs (pas juste la permission navigateur). */}
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
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                <AlertCircle className="w-3 h-3" /> À activer
              </span>
            )}
            {pushCardExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </button>

        {pushCardExpanded && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-xs text-gray-400">
              Recevez les messages du chat, alertes dossiers et réservations en temps réel sur votre smartphone.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {!pushSubscribed && pushSupported && (
                <button
                  onClick={handleEnablePush}
                  disabled={pushBusy}
                  className="px-4 py-2 bg-[#F7BC5F] hover:bg-[#d4a838] text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-60"
                >
                  {pushBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
                  {pushPermission === 'denied' ? 'Réactiver dans les réglages' : 'Activer les alertes'}
                </button>
              )}

              {pushSubscribed && (
                <button
                  onClick={handleSendTestNotification}
                  disabled={pushBusy}
                  className="px-3.5 py-2 bg-[#143c3f] hover:bg-[#1e585c] text-white text-xs font-semibold rounded-xl flex items-center gap-2 border border-white/10 transition-all cursor-pointer disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5 text-[#F7BC5F]" />
                  Tester une alerte
                </button>
              )}
            </div>

            {testFeedback && (
              <div className="p-3 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/30 text-[#FBE0AE] text-xs flex items-center gap-2 animate-fade-in">
                <Info className="w-4 h-4 flex-shrink-0 text-[#F7BC5F]" />
                <span>{testFeedback}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-14 text-center rounded-3xl bg-white/5 border border-white/10 text-gray-400">
          <Loader2 className="w-7 h-7 animate-spin mx-auto mb-3" />

          <p className="text-xs">
            Chargement des alertes...
          </p>
        </div>
      ) : visibleNotifications.length === 0 ? (
        <div className="p-14 text-center rounded-3xl bg-white/5 border border-dashed border-white/10">
          <Bell className="w-10 h-10 text-gray-600 mx-auto mb-3" />

          <p className="text-sm font-semibold text-gray-300">
            Aucune action en attente.
          </p>

          <p className="text-xs text-gray-500 mt-1">
            Tout est à jour pour le moment.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleNotifications.map((notification) => renderNotificationRow(notification))}
        </div>
      )}
    </div>
  );

  function renderNotificationRow(notification: NotificationItem) {
    return (
      <div
        key={notification.id}
        className={`w-full rounded-2xl border flex items-stretch gap-1 transition-all hover:-translate-y-0.5 ${
          notification.priority === 'urgent'
            ? 'bg-rose-500/10 border-rose-500/30 hover:border-rose-400/50'
            : notification.priority === 'important'
            ? 'bg-[#F7BC5F]/5 border-[#F7BC5F]/20 hover:border-[#F9C977]/40'
            : 'bg-white/5 border-white/10 hover:border-[#F7BC5F]/40'
        }`}
      >
        <button
          onClick={() => {
            // Ticket #20 (nouvelle base) : les notifications liées à un
            // ticket Support ne doivent pas s'accumuler une fois consultées
            // — on les supprime directement au lieu de simplement les
            // marquer lues (elles sont aussi nettoyées à la clôture du
            // ticket, voir SupportView.tsx / setTicketStatus).
            if (notification.rawType.startsWith('support_ticket')) {
              void dismissNotification(notification.id);
            } else {
              void markNotificationRead(notification.id);
            }
            if (notification.contactId && onOpenContact) {
              onOpenContact(notification.contactId, notification.contactTab);
            } else if (notification.navTarget === 'chat' && notification.messageId && onOpenMessage) {
              onOpenMessage(notification.messageId);
            } else {
              onNavigate(notification.navTarget);
            }
          }}
          className="flex-1 min-w-0 p-4 text-left flex items-center gap-4"
        >
          {/* Ticket #220 : les notifications liées au CRM lui-même (ex.
              "Mise à jour disponible") affichaient une icône générique
              (dossier/étincelle) au lieu du vrai logo Nova CRM déjà utilisé
              partout ailleurs (en-tête, etc.) — même fichier, mêmes
              proportions, pour une identité visuelle cohérente. */}
          {notification.rawType === 'app_update' ? (
            <img
              src="/nova-mascotte.png"
              alt="Nova CRM"
              className="w-10 h-10 rounded-xl shrink-0 object-cover border border-[#F7BC5F]/40 bg-[#0a2528]"
            />
          ) : (() => {
            const { Icon, gradient } = tileFor(notification.type);
            return (
              <div
                className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center bg-gradient-to-br ${gradient} border border-white/10 shadow-md`}
              >
                <Icon className="w-4 h-4 text-white" />
              </div>
            );
          })()}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-white">{notification.title}</h3>

              {notification.priority === 'urgent' && (
                <span className="text-[9px] uppercase tracking-wider font-black text-rose-300 bg-rose-500/15 border border-rose-500/20 px-2 py-0.5 rounded-full">
                  Urgent
                </span>
              )}
            </div>

            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{notification.description}</p>

            {notification.date && (
              <p className="text-[10px] text-gray-600 mt-2">{formatDate(notification.date)}</p>
            )}
          </div>

          <MoveRight className="w-4 h-4 text-gray-500 shrink-0" />
        </button>

        {notification.rawType === 'app_update' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.location.reload();
            }}
            title="Rafraîchir la page pour appliquer la mise à jour"
            className="px-3 shrink-0 text-[#F9C977] hover:text-[#FAD592] hover:bg-[#F7BC5F]/10 transition-colors flex items-center gap-1.5 text-xs font-bold"
          >
            <RefreshCw className="w-4 h-4" />
            Rafraîchir
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            void dismissNotification(notification.id);
          }}
          title="Supprimer cette notification"
          className="px-3 shrink-0 text-gray-500 hover:text-rose-300 hover:bg-rose-500/10 rounded-r-2xl transition-colors flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
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