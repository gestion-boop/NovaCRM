// NovaSphere Service Worker — push notifications + app badge + cache des assets
// Registered only in production by src/main.tsx

// Signalé (30/08/2026, urgent) : "elle ne sait pas d'où ça vient" — Isabelle
// ne recevait AUCUNE bannière pour certains messages. Cause racine : la
// notification d'un message n'a jamais transmis conversation_id à
// send-push (voir migration jointe côté base), donc le seul repli possible
// ici était de comparer le CHEMIN de l'URL ("/messagerie" == "/messagerie")
// — vrai dès que l'app est ouverte sur N'IMPORTE QUELLE conversation, pas
// spécifiquement celle du nouveau message. Remplacé par un vrai signal
// envoyé par la page elle-même (ACTIVE_CONVERSATION), mis à jour à chaque
// changement de conversation ouverte — bien plus fiable qu'une déduction à
// partir de l'URL, qui ne change jamais quand on change de conversation
// dans cette SPA (pas de history.pushState).
let activeConversationId = null;

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
  // DÉCISION INVERSÉE le 31/08/2026, après un blocage définitif constaté sur
  // le téléphone d'une utilisatrice : depuis son raccourci installé, l'appli
  // n'affichait qu'un écran turquoise vide, alors que la même adresse
  // fonctionnait dans Chrome.
  //
  // L'ancienne consigne — ne pas prendre le contrôle avant que l'utilisateur
  // clique "Mettre à jour" — reposait sur un bouton qui N'EXISTE PAS : rien
  // dans src/ n'écoute `controllerchange` ni n'envoie SKIP_WAITING (vérifié).
  // Une nouvelle version s'installait donc, restait en attente… et n'était
  // jamais activée. Or c'est l'activation qui purge les caches d'assets
  // périmés (voir plus bas). Un service worker ayant mis en cache une réponse
  // erronée gardait donc cette réponse INDÉFINIMENT, sans aucun moyen d'en
  // sortir autre que désinstaller l'application.
  //
  // Prendre le contrôle immédiatement ne provoque aucun rechargement ici :
  // personne n'écoute `controllerchange`, et index.html n'est de toute façon
  // jamais servi depuis le cache. Le seul effet est que le ménage a lieu.
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Ménage : purge les anciens caches d'assets (versions précédentes du
  // bundle) pour ne pas accumuler indéfiniment des fichiers hashés qui ne
  // sont plus référencés par aucun index.html actuel — et surtout pour
  // évacuer toute entrée erronée d'une version antérieure.
  //
  // `clients.claim()` : sans lui, les pages déjà ouvertes restent pilotées par
  // l'ancien service worker jusqu'à leur prochain démarrage complet. Sur une
  // application installée, cela peut durer des jours. Voir le commentaire de
  // l'installation ci-dessus.
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("novasphere-assets-") && k !== ASSETS_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })(),
  );
});

// Audit "démarrage lent" (30/08/2026, signalé à plusieurs reprises —
// "même mis en cache... jamais fluide... 5 secondes" au lancement mobile) :
// ce service worker ne mettait RIEN en cache jusqu'ici (uniquement les
// notifications/badge ci-dessus) — chaque lancement retéléchargeait donc
// intégralement le bundle JS (~3.5 Mo) et le CSS par le réseau, sans
// bénéficier d'un vrai fonctionnement "appli installée". Complète le
// correctif d'en-têtes HTTP (vercel.json, Cache-Control immutable sur
// /assets/*) par une mise en cache CÔTÉ NAVIGATEUR : cache-first pour les
// fichiers /assets/* (noms hashés au contenu par Vite — un nouveau build
// produit toujours de nouveaux noms, donc aucun risque de servir une
// vieille version : les anciens fichiers deviennent simplement orphelins,
// nettoyés ci-dessus). index.html et les routes applicatives restent
// volontairement HORS cache ici (toujours réseau) : c'est LUI qui doit
// rester à jour pour référencer les bons noms de fichiers hashés — voir
// UpdateBanner.tsx / version.json pour la détection de nouvelle version.
// Bug constaté (30/08/2026, page blanche + erreurs MIME "text/html" au lieu
// de JS) : vercel.json redirige TOUTE route inconnue vers /index.html
// (rewrite SPA catch-all), avec un statut 200 — donc si une requête vers un
// fichier /assets/*.js arrivait ne serait-ce qu'une fois avant que ce
// fichier soit vraiment disponible côté CDN (juste après un déploiement),
// la réponse (200, mais du HTML) passait quand même le test `res.ok`
// ci-dessous et se retrouvait mise en cache DÉFINITIVEMENT sous le nom du
// fichier JS — ce cache ne se corrige jamais tout seul (cache-first, jamais
// revérifié). Un onglet touché restait bloqué sur une page blanche à
// chaque chargement suivant, même après un nouveau déploiement (nom de
// fichier différent, donc jamais réinvalidé). Double correctif : (1) on ne
// met en cache que si le content-type ressemble vraiment à du JS/CSS, (2)
// le nom de cache change de version pour abandonner immédiatement toute
// entrée déjà piégée par ce bug chez les utilisateurs déjà passés par là
// (purgée par le "Ménage" de l'activate ci-dessus, qui supprime déjà tout
// cache "novasphere-assets-*" différent du nom courant).
const ASSETS_CACHE = "novasphere-assets-v3";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/assets/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSETS_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const ct = res && res.headers.get("content-type");
      const looksRight = ct && !ct.includes("text/html");
      if (res && res.ok && looksRight) cache.put(req, res.clone());
      return res;
    })(),
  );
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
      //
      // Signalé (Diane, 7 septembre) : le bouton "Tester une alerte" envoie
      // toujours `url: '/'` sans conversation_id/lead_id — donc si on
      // clique "Tester" en étant sur l'accueil de l'app (le cas le plus
      // probable), la logique ci-dessous croyait qu'on "lisait déjà" la
      // page ciblée et supprimait la bannière en silence, alors que le
      // serveur confirmait bien l'envoi (accepté par Apple/Google). Un test
      // manuel doit TOUJOURS s'afficher, quelle que soit la page ouverte —
      // reconnu par son tag dédié, posé par use-push-notifications.ts.
      const targetUrl = new URL(data.url || "/", self.location.origin);
      const all = data.tag === "novasphere-test" ? [] : await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const isFocusedOnContext = all.some((c) => {
        if (!c.focused || c.visibilityState !== "visible") return false;
        try {
          const u = new URL(c.url);
          if (data.conversation_id && data.conversation_id === activeConversationId) return true;
          if (data.lead_id && u.pathname.includes(`/clients/${data.lead_id}`)) return true;
          // Repli uniquement pour les pages SANS granularité interne (une
          // seule cible possible par chemin, ex. /rappels) — jamais pour
          // /messagerie, qui héberge N'IMPORTE QUELLE conversation sur le
          // même chemin sans que l'URL ne bouge quand on en change.
          // Même chose pour /projets-internes (3 septembre) : tous les
          // projets et toutes les cartes vivent sur ce seul chemin. Avoir
          // l'écran des projets ouvert faisait taire la bannière d'un
          // message posté sur N'IMPORTE QUELLE carte.
          if (targetUrl.pathname.startsWith("/messagerie") || targetUrl.pathname.startsWith("/projets-internes")) return false;
          if (!data.conversation_id && !data.lead_id) return u.pathname === targetUrl.pathname;
          return false;
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
          // Signalé : le clic sur une notification ramène "seulement dans les
          // conversations", pas sur le message précis. `client.navigate()`
          // échoue silencieusement dans certains contextes PWA (notamment
          // iOS/Safari en mode standalone) — le `catch` ci-dessous avale
          // l'erreur et l'onglet se contente d'être focus() à son ancienne
          // URL, sans jamais atteindre la cible. On envoie donc AUSSI l'URL
          // par postMessage : la page déjà chargée peut router elle-même
          // en JS, sans dépendre d'une vraie navigation document.
          try {
            c.postMessage({ type: "NOTIFICATION_NAVIGATE", url, conversationId, leadId });
          } catch (_) {}
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
  // La page signale quelle conversation est actuellement ouverte à l'écran
  // (ou aucune, avec conversationId: null) — voir isFocusedOnContext
  // ci-dessus, seul moyen fiable de savoir si une bannière doit s'afficher.
  if (event.data && event.data.type === "ACTIVE_CONVERSATION") {
    activeConversationId = event.data.conversationId || null;
    return;
  }

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
