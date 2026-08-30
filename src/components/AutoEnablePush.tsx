import { useEffect, useRef } from 'react';
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
export const AutoEnablePush = () => {
  const { currentUser } = useAuth();
  const triedRef = useRef(false);

  useEffect(() => {
    if (!currentUser) return;
    if (triedRef.current) return;

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

    triedRef.current = true;

    const subscribeNow = async () => {
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
      } catch (e) {
        console.warn('[auto-push] subscription failed', e);
      }
    };

    // Aucune demande automatique : seule une permission déjà accordée est
    // restaurée silencieusement si l'abonnement a expiré.
    if (Notification.permission === 'granted') {
      void subscribeNow();
    }
  }, [currentUser]);

  useEffect(() => {
    triedRef.current = false;
  }, [currentUser?.uid]);

  return null;
};

export default AutoEnablePush;
