import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  bufToB64Url,
  ensurePushServiceWorker,
  getPushSubscriptionInfo,
  getVapidPublicKey,
  subscribePushSafely,
  subscriptionUsesCurrentKey,
  unsubscribeAllPushSubscriptions,
} from '@/lib/push';

export function usePushNotifications() {
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'denied');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(supported);

  const checkSubscription = useCallback(async () => {
    if (!supported) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const vapidPublicKey = await getVapidPublicKey();
      const info = await getPushSubscriptionInfo(vapidPublicKey);
      setSubscribed(!!info && subscriptionUsesCurrentKey(info.subscription, vapidPublicKey));
    } catch {
      setSubscribed(false);
    } finally {
      setPermission(Notification.permission);
      setChecking(false);
    }
  }, [supported]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  const subscribe = useCallback(async () => {
    if (!supported) {
      toast.error('Notifications non supportées sur cet appareil/navigateur');
      return false;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        toast.error('Permission refusée');
        return false;
      }

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

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Non connecté');

      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: userData.user.id,
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

      setSubscribed(true);
      toast.success('Notifications activées');
      return true;
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erreur d'activation");
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const endpoints = await unsubscribeAllPushSubscriptions();
      if (endpoints.length > 0) {
        await supabase.from('push_subscriptions').delete().in('endpoint', endpoints);
      }
      setSubscribed(false);
      toast.success('Notifications désactivées');
    } catch (e: any) {
      toast.error(e?.message || 'Erreur');
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-push', {
        body: {
          title: 'Test Nova CRM',
          message: 'Si tu vois cette notification, tout fonctionne 🎉',
          url: '/',
          badge: 1,
          badgeType: 'message',
        },
      });
      if (error) throw error;
      const sent = (data as any)?.sent ?? 0;
      if (sent === 0) toast.warning("Aucun appareil abonné. Active d'abord les notifications.");
      else toast.success(`Notification acceptée par ${sent} service(s) push`);
      return data as any;
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'envoi");
      return { error: String(e?.message || e) } as any;
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, permission, subscribed, busy, checking, subscribe, unsubscribe, sendTest, checkSubscription };
}
