import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { getCachedAccessToken, requestWorkspaceAccessToken, fetchGmailUnreadCount } from '@/lib/workspace';

// Intervalle de rafraîchissement du compteur de mails non lus (5 min)
const MAIL_COUNT_REFRESH_MS = 5 * 60 * 1000;

interface SupportTicketStatsRow {
  agencyId?: string;
  status?: string;
  createdByUserId?: string;
  archivedAt?: string | null;
}

export function useDashboardStats() {
  const {
    currentUser,
    userProfile,
    activeAgency,
  } = useAuth();

  const [supportTickets, setSupportTickets] = useState<SupportTicketStatsRow[]>([]);
  // Bug remonté : le badge "Chat" (tuile Accueil, barre du haut, notif
  // desktop) ne comptait que les canaux d'équipe (`chat_messages`) — les
  // messages directs/fiche client (`messages` + accusés `message_receipts`,
  // un système de messagerie entièrement séparé) n'étaient jamais pris en
  // compte, donc un message reçu là n'affichait jamais rien nulle part.
  const [unreadDirectMessagesCount, setUnreadDirectMessagesCount] = useState(0);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    // Perf (audit du 20 octobre) : cette fonction téléchargeait 5 tables
    // ENTIÈRES en parallèle (chat_messages, camera_reservations,
    // task_boards, chat_channels + chat_projects joints) à chaque appel —
    // au chargement, à chaque message de chat (voir l'abonnement plus bas)
    // ET toutes les 30s. Or seul `support_tickets` est réellement lu
    // quelque part dans ce fichier (openSupportTicketsCount, plus bas) :
    // chatMessages/cameraReservations/internalProjects étaient calculés
    // puis jamais consultés nulle part, ni ici ni dans la valeur renvoyée
    // par ce hook — mort depuis le correctif qui a arrêté de compter
    // chat_messages pour la pastille (voir commentaire plus bas, "Bug
    // racine trouvé"), jamais nettoyé depuis. Supprimé : 4 des 5 requêtes
    // disparaissent sans aucun changement de comportement visible.
    const loadData = async () => {
      try {
        const { data: tickets, error } = await supabase.from('support_tickets').select('*');
        if (error) throw error;

        if (tickets) {
          setSupportTickets(
            tickets.map((t: any) => ({
              agencyId: t.agency_id,
              status: t.status,
              createdByUserId: t.created_by,
              archivedAt: t.archived_at,
            }))
          );
        }
      } catch (err) {
        console.warn('Erreur chargement stats dashboard :', err);
      }
    };

    const loadDirectUnread = async () => {
      try {
        // Signalé : "le compteur chat ne reflète pas la réalité" — cause
        // réelle trouvée : `message_receipts` sert aussi à un ANCIEN
        // système de canaux (messages.channel_id), remplacé depuis par les
        // canaux d'équipe actuels (table `chat_messages`, non concernée
        // ici). Ses accusés de réception, jamais marqués lus par une
        // interface qui n'existe plus, restaient comptés indéfiniment comme
        // non lus — gonflant le badge de messages "orphelins" impossibles à
        // faire disparaître normalement. On ne compte donc que les accusés
        // liés à une vraie conversation directe (`conversation_id`).
        const { count, error } = await supabase
          .from('message_receipts')
          .select('message_id, messages!inner(conversation_id)', { count: 'exact', head: true })
          .eq('user_id', currentUser.uid)
          .is('read_at', null)
          .not('messages.conversation_id', 'is', null);
        if (!error) setUnreadDirectMessagesCount(count || 0);
      } catch (err) {
        console.warn('Erreur chargement messages directs non lus :', err);
      }
    };

    loadData();
    loadDirectUnread();

    // Perf/correction (audit du 20 octobre) : ce canal écoutait
    // `chat_messages` SANS AUCUN FILTRE (tout message envoyé par tout le
    // monde, toutes agences confondues) pour redéclencher loadData() — un
    // effet de bord qui ne rafraîchissait le compteur de tickets support
    // qu'à l'occasion fortuite d'un message de chat, et jamais sur un vrai
    // changement de ticket survenu sans message en même temps. Retargeté
    // directement sur `support_tickets` : plus correct (un ticket
    // fermé/rouvert se reflète enfin en direct) ET beaucoup plus léger.
    const ticketsChannel = supabase
      .channel(`dashboard_support_tickets_${currentUser.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets' },
        () => {
          loadData();
        }
      )
      .subscribe();

    // Messages directs / fiche client (`messages` + `message_receipts`) —
    // canal séparé du précédent, sinon ce badge ne bouge jamais pour eux.
    const directChannel = supabase
      .channel(`dashboard_direct_messages_${currentUser.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts', filter: `user_id=eq.${currentUser.uid}` },
        () => {
          loadDirectUnread();
        }
      )
      .subscribe();

    // Perf (audit du 20 octobre) : ce sondage tournait toutes les 30s en
    // permanence, même onglet/app en arrière-plan indéfiniment. Mis en
    // pause pendant ce temps (même principe déjà éprouvé sur Chat, voir
    // ChatViewSupabase.tsx) + rafraîchissement immédiat au retour au
    // premier plan, pour ne pas rater une mise à jour survenue pendant la
    // pause.
    let chatPollInterval: ReturnType<typeof setInterval> | null = null;
    const demarrerSondage = () => {
      if (chatPollInterval) return;
      chatPollInterval = setInterval(() => {
        loadData();
        loadDirectUnread();
      }, 30000);
    };
    const arreterSondage = () => {
      if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData();
        loadDirectUnread();
        demarrerSondage();
      } else {
        arreterSondage();
      }
    };
    demarrerSondage();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      supabase.removeChannel(ticketsChannel);
      supabase.removeChannel(directChannel);
      arreterSondage();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser?.uid]);

  const visibleAgencyIds = useMemo(() => {
    if (userProfile?.role === 'super_admin') {
      return null;
    }
    return new Set(userProfile?.agencyIds || []);
  }, [userProfile?.role, userProfile?.agencyIds]);

  const canSeeAgency = (agencyId: string | undefined) => {
    if (agencyId === 'all') return true;

    if (userProfile?.role === 'super_admin') {
      if (activeAgency.id === 'all') return true;
      return !agencyId || agencyId === activeAgency.id;
    }

    if (!agencyId) return false;
    if (activeAgency.id !== 'all' && agencyId !== activeAgency.id) return false;
    return visibleAgencyIds?.has(agencyId) === true;
  };

  // Bug racine trouvé : la table `chat_messages` (canaux d'équipe) n'a
  // JAMAIS eu de colonnes `sender_id`/`read_by` au niveau racine — ce sont
  // en réalité `id, channel, data (jsonb), created_at, updated_at`, avec
  // l'expéditeur planqué dans `data.sender_id`. Le filtre ci-dessous lisait
  // donc toujours `undefined` pour l'expéditeur et l'état de lecture, ce
  // qui comptait LITTÉRALEMENT TOUTES les lignes de la table (y compris mes
  // propres messages) comme non lues, en permanence, sans jamais pouvoir
  // redescendre — d'où la pastille qui ne s'actualisait jamais à la
  // lecture. Il n'existe par ailleurs aucun mécanisme d'accusé de lecture
  // pour ce canal (pas de colonne équivalente à `message_receipts`), donc
  // impossible de le compter correctement pour l'instant : on ne le compte
  // plus du tout plutôt que d'afficher un chiffre faux. Seuls les messages
  // directs (`messages` + `message_receipts`, correctement suivis) sont
  // comptés ci-dessous.
  const unreadMessagesCount = useMemo(() => {
    if (!currentUser) return 0;
    return unreadDirectMessagesCount;
  }, [unreadDirectMessagesCount, currentUser?.uid]);

  // ── Compteur réel de notifications non lues (table `notifications`) ──────
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  // Signalé : la pastille de la cloche sur mobile comptait TOUTES les
  // notifications non lues, mais le panneau mobile n'affiche volontairement
  // que les messages et réservations caméra (voir NotificationsView.tsx) —
  // une notification d'un autre type (mention, tâche...) allumait donc la
  // pastille sans que rien de correspondant n'apparaisse dans la liste.
  // Ce compteur ne porte que sur les types réellement montrés sur mobile.
  const [unreadMobileNotificationsCount, setUnreadMobileNotificationsCount] = useState(0);

  // 'shared_document' et 'shared_chat_message' ajoutés (ticket #55) : sans
  // eux, la pastille mobile s'allumait pour ces notifications sans que rien
  // de correspondant n'apparaisse dans la liste — même incohérence déjà
  // corrigée une fois pour les autres types (voir commentaire plus bas).
  const MOBILE_VISIBLE_TYPES = ['message', 'mention', 'shared_message', 'reaction', 'task_message', 'announcement', 'daily_summary', 'shared_note', 'shared_document', 'shared_chat_message'];

  const refreshUnreadNotifications = async () => {
    if (!currentUser) {
      setUnreadNotificationsCount(0);
      setUnreadMobileNotificationsCount(0);
      return;
    }
    // Bug trouvé en test réel : "app_update" (le bandeau "Mise à jour
    // disponible") gonflait le badge de l'app téléphone (setAppBadge, dans
    // App.tsx, basé sur unreadNotificationsCount) sans jamais apparaître
    // nulle part pour pouvoir être lu/effacé — un seul déploiement suffisait
    // à décaler le badge du téléphone (ex: 14) par rapport aux vrais
    // rappels visibles dans le CRM (13), le solde "fantôme" restant coincé
    // indéfiniment. "app_update" a son propre traitement (bandeau +
    // déduplication via localStorage dans UpdateBanner.tsx) : à exclure ici
    // comme il l'était déjà de MOBILE_VISIBLE_TYPES.
    const [{ count }, { count: mobileCount }] = await Promise.all([
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.uid)
        .eq('is_read', false)
        .is('dismissed_at', null)
        .neq('type', 'app_update'),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', currentUser.uid)
        .eq('is_read', false)
        .is('dismissed_at', null)
        .or(`type.in.(${MOBILE_VISIBLE_TYPES.join(',')}),type.like.camera_reservation%`),
    ]);
    setUnreadNotificationsCount(count ?? 0);
    setUnreadMobileNotificationsCount(mobileCount ?? 0);
  };

  useEffect(() => {
    refreshUnreadNotifications();

    if (!currentUser) return;

    const channel = supabase
      .channel(`notifications_badge_${currentUser.uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.uid}` },
        () => {
          refreshUnreadNotifications();
        }
      )
      .subscribe();

    // Filet de sécurité : le temps réel peut rater un événement. Le sondage
    // était à 30s, donc un chat reçu sans événement restait invisible trop
    // longtemps. Tant que l'onglet est ouvert, on rattrape en quelques
    // secondes ; en arrière-plan le sondage s'arrête, et le retour au
    // premier plan recharge tout de suite.
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    const demarrer = () => {
      if (pollInterval) return;
      pollInterval = setInterval(refreshUnreadNotifications, 8000);
    };
    const arreter = () => {
      if (!pollInterval) return;
      clearInterval(pollInterval);
      pollInterval = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshUnreadNotifications();
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

  // ── Compteur réel de mails non lus (Gmail, via le token Google Workspace) ──
  const [unreadMailCount, setUnreadMailCount] = useState(0);

  // Exposée (voir `return` plus bas) pour que MailView puisse forcer un
  // recomptage immédiat juste après avoir marqué un mail comme lu/non lu
  // depuis l'app — sans ça, la pastille de la barre latérale ne se
  // resynchronisait qu'au prochain sondage (jusqu'à 5 min plus tard).
  const refreshUnreadMail = async () => {
    if (!currentUser) {
      setUnreadMailCount(0);
      return;
    }
    try {
      // Récupère le jeton Google depuis la session Supabase s'il n'est pas
      // déjà en mémoire — pas besoin d'avoir visité Mail/Agenda au préalable.
      const token = getCachedAccessToken() || (await requestWorkspaceAccessToken());
      const count = await fetchGmailUnreadCount(token);
      setUnreadMailCount(count);
    } catch (err) {
      // Pas grave : l'utilisateur n'est simplement pas encore connecté à
      // Google Workspace (pas de provider_token dans la session).
      console.warn('Comptage mails non lus indisponible :', err);
    }
  };

  useEffect(() => {
    if (!currentUser) {
      setUnreadMailCount(0);
      return;
    }

    void refreshUnreadMail();
    const interval = setInterval(() => void refreshUnreadMail(), MAIL_COUNT_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshUnreadMail();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // ── Compteur réel de tickets support ouverts (visibles par l'utilisateur) ──
  // Le statut réel (enum Postgres `support_status`) est 'ouvert' / 'en_cours'
  // / 'ferme' — la comparaison à 'Résolu' ne correspondait jamais à aucune
  // valeur réelle, ce qui comptait TOUS les tickets comme "ouverts" au lieu
  // d'exclure ceux déjà terminés.
  // Signalé ensuite : "le compteur ne correspond pas à la réalité" — cause
  // réelle : un ticket archivé (masqué de la liste par défaut dans
  // SupportView, indépendamment de son statut) continuait d'être compté
  // ici puisque l'archivage n'était jamais vérifié — le badge pouvait donc
  // afficher un nombre supérieur à ce qui apparaît réellement à l'écran.
  const openSupportTicketsCount = useMemo(() => {
    return supportTickets.filter((ticket) => {
      if (ticket.status === 'ferme') return false;
      if (ticket.archivedAt) return false;
      return canSeeAgency(ticket.agencyId);
    }).length;
  }, [supportTickets, activeAgency.id, userProfile?.role, userProfile?.agencyIds]);

  return {
    unreadNotificationsCount,
    unreadMobileNotificationsCount,
    unreadMessagesCount,
    unreadMailCount,
    openSupportTicketsCount,
    refreshUnreadNotifications,
    refreshUnreadMail,
  };
}
