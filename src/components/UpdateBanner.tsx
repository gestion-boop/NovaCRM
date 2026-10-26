import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

const POLL_INTERVAL_MS = 45 * 1000; // 45 secondes

interface ServerVersion {
  version: string;
  ref?: string;
  sha?: string;
}

async function fetchServerVersion(): Promise<ServerVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.version) return null;
    return { version: json.version, ref: json.ref, sha: json.sha };
  } catch {
    return null;
  }
}

/**
 * Vérifie si le rechargement peut se faire sans risque de perte de données.
 * Ne recharge pas si l'utilisateur a de la saisie active ou un vocal en cours.
 */
function isSafeToAutoReload(): boolean {
  try {
    // 1. Ne pas recharger si un champ de texte est en cours d'édition avec du texte saisi
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      const val = (active as HTMLInputElement | HTMLTextAreaElement).value;
      if (val && val.trim().length > 0) return false;
    }
    // 2. Ne pas recharger si une modale avec formulaire de saisie est ouverte
    const modals = document.querySelectorAll('[role="dialog"], dialog');
    for (const modal of Array.from(modals)) {
      const inputs = modal.querySelectorAll('input, textarea');
      for (const input of Array.from(inputs)) {
        if ((input as HTMLInputElement).value?.trim()?.length > 0) return false;
      }
    }
    // 3. Ne pas recharger si un enregistrement audio/vocal est en cours
    if ((window as any).__novaIsRecordingAudio) return false;
  } catch {
    // En cas de doute, autoriser prudemment
  }
  return true;
}

interface UpdateBannerProps {
  currentNav?: string;
  selectedClientProfileId?: string | null;
}

/**
 * Gestionnaire de mise à jour transparente et silencieuse :
 * - Détecte en arrière-plan la disponibilité d'une nouvelle version (version.json).
 * - Nettoie les anciennes notifications système d'app_update pour ne pas polluer la clochette.
 * - Dès que l'onglet passe en arrière-plan (changement d'onglet, minimisation, écran verrouillé),
 *   sauvegarde l'état de navigation et recharge automatiquement la page de façon transparente.
 * - L'utilisateur retrouve son écran et sa session intacts dès son retour, sans déconnexion.
 */
export default function UpdateBanner({ currentNav, selectedClientProfileId }: UpdateBannerProps) {
  const { currentUser } = useAuth();
  const [bootVersion, setBootVersion] = useState<string | null>(null);
  const pendingVersionRef = useRef<string | null>(null);
  const reloadingRef = useRef(false);
  const navStateRef = useRef({ currentNav, selectedClientProfileId });
  navStateRef.current = { currentNav, selectedClientProfileId };

  // 1. Découverte de la version initiale au démarrage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = await fetchServerVersion();
      if (!cancelled && v) {
        setBootVersion(v.version);
        // Nettoyer toute notification app_update résiduelle dans Supabase pour garder la clochette propre
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

  // 2. Surveillance périodique & application transparente au changement d'onglet
  useEffect(() => {
    if (!bootVersion) return;

    const performSilentReload = () => {
      if (reloadingRef.current) return;
      if (!isSafeToAutoReload()) return;

      reloadingRef.current = true;
      try {
        const state = navStateRef.current;
        sessionStorage.setItem(
          'novasphere:restore-nav',
          JSON.stringify({
            nav: state.currentNav,
            clientId: state.selectedClientProfileId,
            timestamp: Date.now(),
          })
        );
      } catch {
        /* best-effort */
      }

      window.location.reload();
    };

    const checkForUpdate = async () => {
      const v = await fetchServerVersion();
      if (v && v.version !== bootVersion) {
        pendingVersionRef.current = v.version;
        // Si l'onglet est déjà masqué/en arrière-plan quand la MAJ est détectée, appliquer tout de suite
        if (document.visibilityState === 'hidden') {
          performSilentReload();
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && pendingVersionRef.current) {
        // L'utilisateur vient de quitter l'onglet ou de minimiser : mise à jour transparente immédiate
        performSilentReload();
      } else if (document.visibilityState === 'visible') {
        // Au retour sur l'onglet, vérifier si une version est sortie pendant son absence
        checkForUpdate();
      }
    };

    const interval = setInterval(checkForUpdate, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [bootVersion]);

  // Plus de bandeau flottant intempestif : tout se fait de manière transparente
  return null;
}
