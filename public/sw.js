// NovaSphere Service Worker — push notifications + app badge
// Registered only in production by src/main.tsx

// Persistent badge counter using Cache Storage (survives SW restarts)
const BADGE_CACHE = "novasphere-badge-v1";
const BADGE_URL = "/__badge_count__";

async function readBadgeCount() {
  try {
    const cache = await caches.open(BADGE_CACHE);
    const res = await cache.match(BADGE_URL);
    if (!res) return 0;
    const n = parseInt(await res.text(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

async function writeBadgeCount(n) {
  try {
    const cache = await caches.open(BADGE_CACHE);
    await cache.put(BADGE_URL, new Response(String(n)));
  } catch (_) {}
}

async function applyBadge(count) {
  await writeBadgeCount(count);
  if (typeof self.navigator === "undefined") return;
  try {
    if (count > 0 && "setAppBadge" in self.navigator) {
      await self.navigator.setAppBadge(count);
    } else if (count === 0 && "clearAppBadge" in self.navigator) {
      await self.navigator.clearAppBadge();
    }
  } catch (_) {}
}

self.addEventListener("install", (e) => {
  // Ne PAS skipWaiting automatiquement : sinon, dès qu'une nouvelle
  // version du SW est détectée (par ex. au retour sur l'onglet), elle
  // prend immédiatement le contrôle et la page peut se recharger,
  // ce qui fait perdre la saisie en cours. On attend que l'utilisateur
  // clique explicitement sur "Mettre à jour" (message SKIP_WAITING).
});

self.addEventListener("activate", (e) => {
  // Idem : on ne réclame le contrôle des clients existants qu'au
  // prochain chargement naturel de la page, pour éviter tout reload
  // intempestif au retour sur l'onglet.
});

// Receive push from server
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "NovaSphere", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "NovaSphere";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || `novasphere-${Date.now()}`,
    renotify: true,
    silent: false,
    data: {
      url: data.url || "/",
      badgeType: data.badgeType || null,
      conversation_id: data.conversation_id || null,
      lead_id: data.lead_id || null,
      tag: data.tag || null,
    },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(
    (async () => {
      // Si une fenêtre de l'app est ouverte ET consulte déjà la page liée
      // à cette notification, on n'affiche PAS de bannière : l'utilisateur
      // est en train de lire le contenu, comme sur iOS Messages.
      const targetUrl = new URL(data.url || "/", self.location.origin);
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const isFocusedOnContext = all.some((c) => {
        if (!c.focused || c.visibilityState !== "visible") return false;
        try {
          const u = new URL(c.url);
          if (data.conversation_id && c.url.includes(String(data.conversation_id))) return true;
          if (data.lead_id && u.pathname.includes(`/clients/${data.lead_id}`)) return true;
          // Fallback: même chemin
          return u.pathname === targetUrl.pathname;
        } catch {
          return false;
        }
      });

      if (isFocusedOnContext) {
        // L'utilisateur regarde déjà — on saute la bannière et on ne touche pas au badge.
        return;
      }

      await self.registration.showNotification(title, options);

      // Met à jour le badge pour TOUT type de notification push
      // (messages, rappels, RDV, news — tous contribuent au unreadCount).
      // Priorité : si le serveur envoie le vrai total (data.badge), on l'utilise
      // directement. Sinon on incrémente de 1 (best-effort quand l'app est fermée).
      const previous = await readBadgeCount();
      const next = typeof data.badge === "number" && data.badge >= 0 ? data.badge : previous + 1;
      await applyBadge(next);
    })(),
  );
});

// Click on notification -> focus or open the app at the right URL
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || "/";
  const url = new URL(rawUrl, self.location.origin).href;
  const clickedData = event.notification.data || {};
  const conversationId = clickedData.conversation_id || null;
  const leadId = clickedData.lead_id || null;
  const clickedTag = event.notification.tag || clickedData.tag || null;
  event.waitUntil(
    (async () => {
      // iOS Messages behaviour: close every notification tied to the same
      // conversation / lead immediately, and drop the badge accordingly —
      // so the notification centre feels instantaneous instead of waiting
      // for the app to boot and clear it after mount.
      try {
        const notifs = await self.registration.getNotifications();
        let closed = 0;
        for (const n of notifs) {
          const d = n.data || {};
          const match =
            (conversationId && d.conversation_id === conversationId) ||
            (leadId && d.lead_id === leadId) ||
            (clickedTag && (n.tag === clickedTag || d.tag === clickedTag));
          if (match) {
            n.close();
            closed++;
          }
        }
        if (closed > 0) {
          const previous = await readBadgeCount();
          await applyBadge(Math.max(0, previous - closed));
        }
      } catch (_) {}

      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          try {
            await c.navigate(url);
          } catch (_) {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});

// Messages depuis la page
self.addEventListener("message", (event) => {
  // L'app est active et connaît le vrai total — on synchronise le badge
  if (event.data && event.data.type === "SET_BADGE") {
    const count = typeof event.data.count === "number" ? Math.max(0, event.data.count) : 0;
    event.waitUntil(applyBadge(count));
    return;
  }

  // L'utilisateur a ouvert le panel ou tout lu — on efface le badge
  if (event.data && event.data.type === "CLEAR_BADGE") {
    event.waitUntil(applyBadge(0));
    return;
  }

  // Ferme les notifications correspondant à un contexte donné
  // (ex: l'utilisateur a ouvert la conversation / le dossier client).
  if (event.data && event.data.type === "CLEAR_NOTIFICATIONS") {
    const { tag, conversationId, leadId, urlIncludes } = event.data;
    event.waitUntil(
      (async () => {
        const notifs = await self.registration.getNotifications();
        let closed = 0;
        for (const n of notifs) {
          const d = n.data || {};
          const match =
            (tag && (n.tag === tag || d.tag === tag)) ||
            (conversationId && d.conversation_id === conversationId) ||
            (leadId && d.lead_id === leadId) ||
            (urlIncludes && typeof d.url === "string" && d.url.includes(urlIncludes));
          if (match) {
            n.close();
            closed++;
          }
        }
        // Diminue le badge instantanément du nombre de notifs fermées,
        // sans attendre que l'app resynchronise le vrai total.
        if (closed > 0) {
          const previous = await readBadgeCount();
          await applyBadge(Math.max(0, previous - closed));
        }
      })(),
    );
    return;
  }

  // App asks the waiting SW to take over now (manual "Update" button)
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
