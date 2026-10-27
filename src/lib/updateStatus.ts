import { useState, useEffect } from 'react';
import { figerDispositionAvantMiseAJour } from '@/lib/dispositionAccueil';

export interface ServerVersion {
  version: string;
  ref?: string;
  sha?: string;
  builtAt?: string;
}

export function getBuildInfo(): { ref: string; sha: string; at: string } {
  if (typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__) {
    return __BUILD_INFO__;
  }
  return { ref: 'dev', sha: 'dev', at: '' };
}

export function formatBuildDate(options?: { withYear?: boolean; withSha?: boolean }): string {
  const info = getBuildInfo();
  if (!info.at) return '';
  try {
    const d = new Date(info.at);
    if (Number.isNaN(d.getTime())) return '';
    const datePart = d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      ...(options?.withYear ? { year: 'numeric' } : {}),
    });
    const timePart = d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const formatted = `${datePart} à ${timePart}`;
    if (options?.withSha && info.sha && info.sha !== 'inconnu') {
      return `${formatted} (${info.sha})`;
    }
    return formatted;
  } catch {
    return '';
  }
}

export async function fetchServerVersion(): Promise<ServerVersion | null> {
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

let bootVersion: string | null = null;
let latestServerVersion: ServerVersion | null = null;
let isUpdatePending = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore */
    }
  });
}

export function setBootVersion(v: string) {
  if (!bootVersion) {
    bootVersion = v;
    notifyListeners();
  }
}

export function setServerVersion(v: ServerVersion | null) {
  latestServerVersion = v;
  if (v && bootVersion && v.version && v.version !== bootVersion) {
    isUpdatePending = true;
  } else {
    isUpdatePending = false;
  }
  notifyListeners();
}

export function getUpdateStatus() {
  return {
    bootVersion,
    latestServerVersion,
    isUpdatePending,
  };
}

export function useAppUpdateStatus() {
  const [status, setStatus] = useState(getUpdateStatus);

  useEffect(() => {
    const handleChange = () => setStatus(getUpdateStatus());
    listeners.add(handleChange);
    // Sync immédiat au montage
    handleChange();
    return () => {
      listeners.delete(handleChange);
    };
  }, []);

  return status;
}

/**
 * Vérifie si un modal de saisie ouvert contient du texte tapé non sauvegardé.
 */
export function isSafeToAutoReload(): boolean {
  try {
    const openModals = document.querySelectorAll('[role="dialog"], .modal-active');
    for (const modal of Array.from(openModals)) {
      const inputs = modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]), textarea'
      );
      for (const input of Array.from(inputs)) {
        if (input.value && input.value.trim().length > 0) {
          return false;
        }
      }
    }
  } catch {
    /* fallback safe */
  }
  return true;
}

/**
 * Tente d'appliquer une mise à jour en attente lors d'une transition de navigation in-app :
 * (ex: retour d'une fiche client, changement de dossier, changement d'onglet/section).
 * Si une mise à jour est en attente, enregistre la destination cible et recharge silencieusement la page.
 * Pour l'utilisateur, la transition sert d'intégration transparente de la mise à jour.
 * Renvoie true si un rechargement a été déclenché, false sinon.
 */
export function applyUpdateOnNavigation(destination: {
  nav?: string;
  clientId?: string | null;
  tab?: 'espace-client';
}): boolean {
  if (!isUpdatePending) return false;
  if (!isSafeToAutoReload()) return false;

  try {
    sessionStorage.setItem(
      'novasphere:restore-nav',
      JSON.stringify({
        nav: destination.nav,
        clientId: destination.clientId ?? null,
        tab: destination.tab,
        timestamp: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }

  // Figer immédiatement la disposition des tuiles à l'instant T avant le reload
  figerDispositionAvantMiseAJour()
    .catch((err) => console.warn('[Freeze before nav update]', err))
    .finally(() => {
      window.location.reload();
    });

  return true;
}
