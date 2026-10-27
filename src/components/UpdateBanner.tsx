import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { fetchServerVersion, setBootVersion, setServerVersion, isSafeToAutoReload, getUpdateStatus } from '@/lib/updateStatus';
import { figerDispositionAvantMiseAJour } from '@/lib/dispositionAccueil';

// Vérification toutes les 25 secondes en arrière-plan
const POLL_INTERVAL_MS = 25 * 1000;

interface UpdateBannerProps {
  currentNav?: string;
  selectedClientProfileId?: string | null;
}

/**
 * Déploiement 100% transparent et invisible ("en sous-marin") :
 * - Aucune mise à jour visible, aucun bandeau, aucun bouton rafraîchir (retourne null).
 * - Nettoie silencieusement toute ancienne notification système.
 * - Scrute les nouveaux déploiements en coulisses.
 * - Dès que l'utilisateur change d'onglet (visibilitychange) ou de fenêtre (blur/pagehide),
 *   la mise à jour s'applique instantanément en arrière-plan sans déconnexion.
 * - Si l'onglet est déjà en arrière-plan au moment où une mise à jour arrive,
 *   elle s'applique immédiatement en silence.
 */
export default function UpdateBanner({ currentNav, selectedClientProfileId }: UpdateBannerProps) {
  const { currentUser } = useAuth();
  const bootVersionRef = useRef<string | null>(
    typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__?.sha ? __BUILD_INFO__.sha : null
  );
  const updateDetectedRef = useRef(false);
  const currentNavRef = useRef(currentNav);
  currentNavRef.current = currentNav;
  const selectedClientIdRef = useRef(selectedClientProfileId);
  selectedClientIdRef.current = selectedClientProfileId;

  // 1. Initialisation de la version au démarrage et purge des anciennes alertes système
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = await fetchServerVersion();
      if (!cancelled && v) {
        bootVersionRef.current = v.version;
        setBootVersion(v.version);
        setServerVersion(v);
        if (currentUser?.uid) {
          try {
            await supabase
              .from('notifications')
              .update({ dismissed_at: new Date().toISOString() })
              .eq('user_id', currentUser.uid)
              .eq('type', 'app_update')
              .is('dismissed_at', null);
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid]);

  // 2. Surveillance et rechargement automatique dès changement d'onglet ou de fenêtre
  useEffect(() => {
    const triggerSilentReload = () => {
      if (!updateDetectedRef.current) return;
      if (!isSafeToAutoReload()) return;

      // Sauvegarde de l'état de navigation courant
      try {
        if (currentNavRef.current) {
          sessionStorage.setItem(
            'novasphere:restore-nav',
            JSON.stringify({
              nav: currentNavRef.current,
              clientId: selectedClientIdRef.current || null,
              timestamp: Date.now(),
            })
          );
        }
      } catch {
        /* ignore */
      }

      // Figer immédiatement les tuiles à l'instant T avant le reload silencieux
      figerDispositionAvantMiseAJour()
        .catch((err) => console.warn('[Freeze before silent reload]', err))
        .finally(() => {
          window.location.reload();
        });
    };

    const checkForUpdate = async () => {
      const v = await fetchServerVersion();
      if (v) {
        setServerVersion(v);
        const { isUpdatePending: pending } = getUpdateStatus();
        if (pending || (v.version && bootVersionRef.current && v.version !== bootVersionRef.current)) {
          updateDetectedRef.current = true;
          // Si l'onglet ou la fenêtre est déjà inactif/en arrière-plan, recharger tout de suite en silence
          if (document.visibilityState === 'hidden' || !document.hasFocus()) {
            triggerSilentReload();
          }
        }
      }
    };

    const interval = setInterval(checkForUpdate, POLL_INTERVAL_MS);

    // Changement d'onglet ou minimisation du navigateur
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        triggerSilentReload();
      } else {
        checkForUpdate();
      }
    };

    // Sortie de page mobile ou changement de vue
    const onPageHide = () => {
      triggerSilentReload();
    };

    // Changement de fenêtre ou perte de focus sur desktop
    let blurTimer: any = null;
    const onWindowBlur = () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.hasFocus() || document.visibilityState === 'hidden') {
          triggerSilentReload();
        }
      }, 800);
    };

    const onWindowFocus = () => {
      clearTimeout(blurTimer);
      checkForUpdate();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);

    return () => {
      clearInterval(interval);
      clearTimeout(blurTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  // 0 apparence / 0 rafraîchissement manuel
  return null;
}
