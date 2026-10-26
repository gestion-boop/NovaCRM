import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

// Vérification toutes les 45 secondes en arrière-plan
const POLL_INTERVAL_MS = 45 * 1000;

interface ServerVersion {
  version: string;
  ref?: string;
  sha?: string;
  builtAt?: string;
}

async function fetchServerVersion(): Promise<ServerVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.version) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Vérifie si l'utilisateur est en train de taper dans un champ ou d'éditer un formulaire
 * pour ne pas recharger brutalement en pleine saisie.
 */
function isSafeToAutoReload(): boolean {
  try {
    const active = document.activeElement;
    if (active) {
      const tag = active.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable) {
        return false;
      }
    }
    // Si un modal avec formulaire critique est ouvert
    const openModals = document.querySelectorAll('[role="dialog"], .modal-active');
    if (openModals.length > 0) {
      for (const modal of Array.from(openModals)) {
        if (modal.querySelector('input:not([type="hidden"]), textarea')) {
          return false;
        }
      }
    }
  } catch {
    /* fallback safe */
  }
  return true;
}

interface UpdateBannerProps {
  currentNav?: string;
  selectedClientProfileId?: string | null;
}

/**
 * Gestionnaire de mise à jour 100% silencieuse "en sous-marin" :
 * - Aucun panneau ni bandeau "rafraîchir" visible (retourne null).
 * - Ne génère aucune notification intrusive dans la clochette.
 * - Nettoie les anciennes notifications système `app_update` en BDD.
 * - Détecte en arrière-plan l'arrivée d'une nouvelle version (/version.json).
 * - Dès que l'utilisateur quitte l'onglet, minimise ou change d'application
 *   (document.visibilityState === 'hidden'), l'application sauvegarde son
 *   état de navigation (sessionStorage) et recharge la page en toute discrétion.
 * - L'utilisateur retrouve son écran immédiatement sans déconnexion.
 */
export default function UpdateBanner({ currentNav, selectedClientProfileId }: UpdateBannerProps) {
  const { currentUser } = useAuth();
  const bootVersionRef = useRef<string | null>(null);
  const updateDetectedRef = useRef(false);
  const currentNavRef = useRef(currentNav);
  currentNavRef.current = currentNav;
  const selectedClientIdRef = useRef(selectedClientProfileId);
  selectedClientIdRef.current = selectedClientProfileId;

  // 1. Détection de la version au chargement de l'app et nettoyage des anciennes alertes 'app_update'
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = await fetchServerVersion();
      if (!cancelled && v) {
        bootVersionRef.current = v.version;
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

  // 2. Surveillance périodique et déclenchement automatique lors du changement d'onglet
  useEffect(() => {
    const checkForUpdate = async () => {
      if (!bootVersionRef.current) return;
      const v = await fetchServerVersion();
      if (v && v.version && v.version !== bootVersionRef.current) {
        updateDetectedRef.current = true;
      }
    };

    const applyUpdateIfHidden = () => {
      if (document.visibilityState === 'hidden' && updateDetectedRef.current) {
        if (!isSafeToAutoReload()) return;

        // Sauvegarde de l'état de navigation pour reprise transparente
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

        // Rechargement immédiat en arrière-plan pendant que l'onglet n'est pas vu
        window.location.reload();
      }
    };

    const interval = setInterval(checkForUpdate, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        applyUpdateIfHidden();
      } else {
        checkForUpdate();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Aucune présence visuelle dans l'interface ("en sous-marin")
  return null;
}
