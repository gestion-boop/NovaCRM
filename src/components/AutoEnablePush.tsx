import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import {
  bufToB64Url,
  ensurePushServiceWorker,
  getPushSubscriptionInfo,
  getVapidPublicKey,
  subscribePushSafely,
  subscriptionUsesCurrentKey,
} from '@/lib/push';

/**
 * Répare silencieusement l'abonnement push à chaque connexion, pour TOUS les
 * utilisateurs :
 * - permission déjà accordée  => l'abonnement est réparé silencieusement
 *   (rotation de clé VAPID, service worker remplacé, abonnement expiré) ;
 * - permission jamais demandée => impossible de l'accorder sans un clic
 *   utilisateur sur la fenêtre native du navigateur (contrainte du
 *   navigateur, pas un choix applicatif) — dans ce cas on ne fait rien ici,
 *   l'utilisateur doit cliquer "Activer les alertes" dans Rappels & Alertes.
 */
let reparationEnCours: Promise<void> | null = null;

export const AutoEnablePush = () => {
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return;
    }

    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true;
    }
    if (inIframe) return;

    const subscribeNow = async () => {
      // Une seule réparation à la fois (évite les abonnements en double créés
      // à la même seconde quand plusieurs déclencheurs se chevauchent).
      if (reparationEnCours) return reparationEnCours;
      reparationEnCours = (async () => {
      try {
        const vapidPublicKey = await getVapidPublicKey();
        const existingInfo = await getPushSubscriptionInfo(vapidPublicKey);
        const staleEndpoint =
          existingInfo && !subscriptionUsesCurrentKey(existingInfo.subscription, vapidPublicKey)
            ? existingInfo.subscription.endpoint
            : null;
        const reg =
          existingInfo && subscriptionUsesCurrentKey(existingInfo.subscription, vapidPublicKey)
            ? existingInfo.registration
            : await ensurePushServiceWorker();
        const sub =
          existingInfo && subscriptionUsesCurrentKey(existingInfo.subscription, vapidPublicKey)
            ? existingInfo.subscription
            : await subscribePushSafely(reg, vapidPublicKey);

        const json = sub.toJSON();
        const endpoint = json.endpoint!;
        const p256dh = json.keys?.p256dh ?? bufToB64Url(sub.getKey('p256dh'));
        const auth = json.keys?.auth ?? bufToB64Url(sub.getKey('auth'));

        const { error } = await supabase.from('push_subscriptions').upsert(
          {
            user_id: currentUser.uid,
            endpoint,
            p256dh,
            auth,
            user_agent: navigator.userAgent,
          },
          { onConflict: 'endpoint' },
        );
        if (error) throw error;
        if (staleEndpoint && staleEndpoint !== endpoint) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', staleEndpoint);
        }
        // Les interrupteurs (Paramètres, clochette) relisent l'état réel.
        window.dispatchEvent(new Event('nv-push-repare'));
      } catch (e) {
        console.warn('[auto-push] subscription failed', e);
      } finally {
        reparationEnCours = null;
      }
      })();
      return reparationEnCours;
    };

    // Aucune demande automatique : seule une permission déjà accordée est
    // restaurée silencieusement si l'abonnement a expiré.
    const reparer = () => {
      if (Notification.permission === 'granted') void subscribeNow();
    };
    reparer();

    // Un abonnement peut disparaître pendant que l'app reste ouverte
    // (révocation par le navigateur, service worker remplacé) : on vérifie
    // à chaque retour sur l'app, au plus une fois par minute.
    let dernier = Date.now();
    const surVisibilite = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - dernier < 60_000) return;
      dernier = Date.now();
      reparer();
    };
    const surMessage = (e: MessageEvent) => {
      if (e.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') reparer();
    };
    document.addEventListener('visibilitychange', surVisibilite);
    navigator.serviceWorker.addEventListener('message', surMessage);
    return () => {
      document.removeEventListener('visibilitychange', surVisibilite);
      navigator.serviceWorker.removeEventListener('message', surMessage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  return null;
};

export default AutoEnablePush;
