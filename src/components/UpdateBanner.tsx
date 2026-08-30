import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

// Signalé : le bandeau "mise à jour disponible" ne remontait qu'au bout de
// 5 minutes sur mobile (l'appli reste ouverte en arrière-plan sans jamais
// re-déclencher visibilitychange sur certains navigateurs mobiles/PWA) —
// ramené à 45s pour que ça se voie quasi instantanément après un déploiement.
const POLL_INTERVAL_MS = 45 * 1000; // 45 secondes
const SNOOZE_MS = 60 * 60 * 1000; // 1 heure ("Plus tard")

async function fetchServerVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json.version || null;
  } catch {
    return null;
  }
}

/**
 * Bandeau discret "mise à jour disponible" — PAS de notification push
 * navigateur (Notification API), juste un panneau in-app + une entrée dans
 * la clochette, pour ne pas déranger l'utilisateur avec une notif système.
 *
 * Détection : compare le `version.json` chargé au démarrage de l'app à celui
 * re-fetché périodiquement (toutes les 5 min + au retour d'onglet). Un clic
 * sur "Plus tard" masque le bandeau pendant 1h avant qu'il ne puisse
 * réapparaître.
 */
export default function UpdateBanner() {
  const { currentUser } = useAuth();
  const [bootVersion, setBootVersion] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const snoozedUntilRef = useRef<number>(0);

  // Version au chargement de l'app
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = await fetchServerVersion();
      if (!cancelled) setBootVersion(v);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bootVersion) return;

    const notifyBell = async (newVersion: string) => {
      if (!currentUser?.uid) return;
      const key = `novasphere:notified-version:${currentUser.uid}`;
      if (localStorage.getItem(key) === newVersion) return;
      localStorage.setItem(key, newVersion);

      // Signalé : chaque déploiement ajoutait une nouvelle notification
      // "Mise à jour disponible" sans jamais retirer les précédentes — pour
      // 10 déploiements, 10 notifications identiques et inutiles. On
      // masque désormais celles déjà en attente avant de poser la nouvelle,
      // pour qu'il n'y en ait jamais plus d'une à la fois.
      try {
        await supabase
          .from('notifications')
          .update({ dismissed_at: new Date().toISOString() })
          .eq('user_id', currentUser.uid)
          .eq('type', 'app_update')
          .is('dismissed_at', null);
      } catch {
        /* best-effort */
      }

      supabase
        .rpc('create_notification', {
          _user_id: currentUser.uid,
          _type: 'app_update',
          _title: '🚀 Mise à jour disponible',
          _message: 'Une nouvelle version de Nova CRM a été déployée. Rafraîchissez pour en profiter.',
          _entity_type: 'system',
          _entity_id: null,
          _agency_id: null,
          _metadata: {},
        } as any)
        .then(
          () => {},
          () => {}
        );
    };

    const checkForUpdate = async () => {
      if (Date.now() < snoozedUntilRef.current) return;
      const v = await fetchServerVersion();
      if (v && v !== bootVersion) {
        setVisible(true);
        notifyBell(v);
      }
    };

    const interval = setInterval(checkForUpdate, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootVersion, currentUser?.uid]);

  const handleLater = () => {
    setVisible(false);
    snoozedUntilRef.current = Date.now() + SNOOZE_MS;
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[200] max-w-sm w-[calc(100vw-3rem)] sm:w-96 animate-fade-in">
      <div className="bg-[#07191b] border border-[#F7BC5F]/40 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
        {/* Ticket #220 : même logo Nova CRM que partout ailleurs dans
            l'appli (en-tête, clochette) au lieu d'une icône générique. */}
        <img
          src="/nova-mascotte.png"
          alt="Nova CRM"
          className="w-9 h-9 rounded-xl shrink-0 object-cover border border-[#F7BC5F]/40 bg-[#0a2528]"
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Mise à jour disponible</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Une nouvelle version de Nova CRM a été déployée.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleRefresh}
              className="px-3 py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Rafraîchir
            </button>
            <button
              onClick={handleLater}
              className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 font-semibold text-xs"
            >
              Plus tard
            </button>
          </div>
        </div>
        <button onClick={handleLater} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0" title="Fermer">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
