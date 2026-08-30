// Web Push (VAPID) — abonnement navigateur/service worker.
// Porté depuis l'ancien CRM (ConnectSphere), où ce code était éprouvé en
// production. Nécessite la fonction Edge "send-push" côté Supabase/Lovable
// Cloud (GET renvoie la clé publique VAPID, POST envoie une notification).
import { supabase } from '@/lib/supabase';

const PUSH_SW_URL = '/sw.js';

let vapidPublicKeyPromise: Promise<string> | null = null;

export function getVapidPublicKey() {
  if (!vapidPublicKeyPromise) {
    vapidPublicKeyPromise = supabase.functions
      .invoke('send-push', { method: 'GET' })
      .then(({ data, error }) => {
        if (error) throw error;
        const publicKey = (data as { publicKey?: string })?.publicKey;
        if (!publicKey) throw new Error('Clé de notification indisponible');
        return publicKey;
      });
  }
  return vapidPublicKeyPromise;
}

export function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

function toApplicationServerKey(publicKey: string): ArrayBuffer {
  const bytes = urlBase64ToUint8Array(publicKey);
  const key = new Uint8Array(bytes.byteLength);
  key.set(bytes);
  return key.buffer;
}

export function bufToB64Url(buf: ArrayBuffer | null) {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function subscriptionUsesCurrentKey(sub: PushSubscription, publicKey: string) {
  const current = urlBase64ToUint8Array(publicKey);
  const existing = sub.options?.applicationServerKey;
  // Si le navigateur n'expose pas la clé existante (fréquent sur Chrome après
  // une mise à jour du SW ou un abonnement précédent avec une autre clé
  // VAPID), on considère qu'elle NE correspond PAS pour forcer un
  // ré-abonnement. Conserver l'ancien abonnement dans ce cas déclenche
  // l'erreur Chrome "Registration failed - could not retrieve the public key".
  if (!existing) return false;
  const existingBytes = new Uint8Array(existing);
  return existingBytes.length === current.length && existingBytes.every((value, index) => value === current[index]);
}

function sameOriginRegistration(reg: ServiceWorkerRegistration) {
  return new URL(reg.scope).origin === window.location.origin;
}

function scopePath(reg: ServiceWorkerRegistration) {
  return new URL(reg.scope).pathname;
}

function isRecoverablePushSubscribeError(err: unknown) {
  const msg = String((err as any)?.message || err);
  return /public key|already.*subscribed|invalid.*state/i.test(msg);
}

async function waitForUsableRegistration(reg: ServiceWorkerRegistration) {
  if (reg.active) return reg;
  const worker = reg.installing || reg.waiting;
  if (!worker) return reg;

  await new Promise<void>((resolve) => {
    if (worker.state === 'activated') {
      resolve();
      return;
    }
    const timeout = window.setTimeout(resolve, 3000);
    worker.addEventListener(
      'statechange',
      () => {
        if (worker.state === 'activated') {
          window.clearTimeout(timeout);
          resolve();
        }
      },
      { once: true },
    );
  });

  return reg;
}

export async function ensurePushServiceWorker(scope = '/') {
  const registration = await navigator.serviceWorker.register(PUSH_SW_URL, { scope });
  return waitForUsableRegistration(registration);
}

export async function getPushSubscriptionInfo(publicKey?: string) {
  const registrations = (await navigator.serviceWorker.getRegistrations()).filter(sameOriginRegistration);
  let first: { registration: ServiceWorkerRegistration; subscription: PushSubscription } | null = null;

  for (const registration of registrations) {
    const subscription = await registration.pushManager.getSubscription().catch(() => null);
    if (!subscription) continue;
    const info = { registration, subscription };
    if (publicKey && subscriptionUsesCurrentKey(subscription, publicKey)) return info;
    if (!first) first = info;
  }

  return first;
}

export async function unsubscribeAllPushSubscriptions() {
  const registrations = (await navigator.serviceWorker.getRegistrations()).filter(sameOriginRegistration);
  const endpoints: string[] = [];

  for (const registration of registrations) {
    const subscription = await registration.pushManager.getSubscription().catch(() => null);
    if (!subscription) continue;
    endpoints.push(subscription.endpoint);
    try { await subscription.unsubscribe(); } catch (_) {}
  }

  return endpoints;
}

async function unsubscribeRegistration(reg: ServiceWorkerRegistration) {
  const leftover = await reg.pushManager.getSubscription().catch(() => null);
  if (leftover) {
    try { await leftover.unsubscribe(); } catch (_) {}
  }
}

async function resetRegistration(reg: ServiceWorkerRegistration) {
  const scope = scopePath(reg);
  await unsubscribeRegistration(reg);
  try { await reg.unregister(); } catch (_) {}
  return ensurePushServiceWorker(scope || '/');
}

/**
 * Abonnement web-push robuste :
 * - supprime tout abonnement préexistant (même si `applicationServerKey`
 *   correspond côté JS, le navigateur peut avoir une liaison orpheline qui
 *   fait échouer `subscribe()` avec "could not retrieve the public key")
 * - retente une fois après un unsubscribe / reset forcé du SW, toujours sur
 *   le scope racine pour qu'iOS n'ait jamais deux service workers en
 *   compétition.
 */
export async function subscribePushSafely(
  reg: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const appKey = toApplicationServerKey(vapidPublicKey);

  const subscribe = (registration: ServiceWorkerRegistration) =>
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey,
    });

  const existing = await reg.pushManager.getSubscription();
  if (existing && !subscriptionUsesCurrentKey(existing, vapidPublicKey)) {
    try {
      await existing.unsubscribe();
    } catch (_) {}
  } else if (existing) {
    return existing;
  }

  try {
    return await subscribe(reg);
  } catch (err: any) {
    if (!isRecoverablePushSubscribeError(err)) throw err;

    const fresh = await resetRegistration(reg);
    try {
      return await subscribe(fresh);
    } catch (resetErr: any) {
      if (!isRecoverablePushSubscribeError(resetErr)) throw resetErr;

      // Dernier recours : "Registration failed - could not retrieve the
      // public key" survient souvent quand plusieurs onglets Nova CRM
      // sont ouverts en même temps et se disputent le même abonnement push
      // (condition de course navigateur, pas un problème de
      // configuration). Un court délai + une dernière tentative suffit la
      // plupart du temps, une fois l'autre onglet retombé silencieux.
      await new Promise((r) => setTimeout(r, 1200));
      try {
        return await subscribe(fresh);
      } catch {
        throw new Error(
          "Impossible d'activer les notifications : fermez les autres onglets Nova CRM ouverts, puis réessayez."
        );
      }
    }
  }
}

/**
 * Ferme toutes les notifications push affichées correspondant à un contexte.
 * À appeler dès que l'utilisateur ouvre la page liée (chat, dossier client…)
 * — comportement « iOS Messages » : la notification disparaît dès qu'on lit.
 */
export function clearMatchingPushNotifications(criteria: {
  tag?: string;
  conversationId?: string;
  leadId?: string;
  urlIncludes?: string;
}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage({ type: 'CLEAR_NOTIFICATIONS', ...criteria });
    })
    .catch(() => {});
}
