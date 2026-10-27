import { useState, useEffect } from 'react';
import { figerDispositionAvantMiseAJour } from '@/lib/dispositionAccueil';

export interface ServerVersion {
  version: string;
  ref?: string;
  sha?: string;
  builtAt?: string;
}

export const STORAGE_LAST_APPLIED_TIME = 'novasphere:last-applied-build-time';
export const STORAGE_LAST_APPLIED_SHA = 'novasphere:last-applied-build-sha';

export function getBuildInfo(): { ref: string; sha: string; at: string } {
  if (typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__) {
    if (__BUILD_INFO__.at && typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_LAST_APPLIED_TIME, __BUILD_INFO__.at); } catch { /* ignore */ }
    }
    if (__BUILD_INFO__.sha && __BUILD_INFO__.sha !== 'inconnu' && typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_LAST_APPLIED_SHA, __BUILD_INFO__.sha); } catch { /* ignore */ }
    }
    return __BUILD_INFO__;
  }
  return { ref: 'dev', sha: 'dev', at: '' };
}

export function formatBuildDate(options?: { withYear?: boolean; withSha?: boolean }): string {
  const info = getBuildInfo();
  let iso = info.at;
  if (!iso && typeof window !== 'undefined') {
    try {
      iso = localStorage.getItem(STORAGE_LAST_APPLIED_TIME) || '';
    } catch {
      iso = '';
    }
  }
  if (!iso && typeof window !== 'undefined') {
    iso = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_LAST_APPLIED_TIME, iso);
    } catch {
      /* ignore */
    }
  }
  if (!iso) return '';
  try {
    const d = new Date(iso);
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
    const sha = (info.sha && info.sha !== 'inconnu' && info.sha !== 'dev')
      ? info.sha
      : (typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_LAST_APPLIED_SHA) || '') : '');
    if (options?.withSha && sha) {
      return `${formatted} (${sha})`;
    }
    return formatted;
  } catch {
    return '';
  }
}

export async function fetchServerVersion(): Promise<ServerVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      return null;
    }
    const json = JSON.parse(text);
    if (!json.version) return null;
    return json;
  } catch {
    return null;
  }
}

let bootVersion: string | null = (typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__?.sha && __BUILD_INFO__.sha !== 'inconnu')
  ? __BUILD_INFO__.sha
  : null;
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
  if (!v) {
    notifyListeners();
    return;
  }

  const buildInfo = getBuildInfo();
  const currentSha = (buildInfo.sha && buildInfo.sha !== 'inconnu' && buildInfo.sha !== 'dev')
    ? buildInfo.sha
    : bootVersion;
  const currentAt = buildInfo.at;

  let updateFound = false;

  // 1. Détection prioritaire par SHA de commit (100% infaillible lors d'un déploiement)
  if (v.sha && currentSha && v.sha !== 'inconnu' && currentSha !== 'inconnu' && v.sha !== 'dev') {
    if (v.sha !== currentSha) {
      updateFound = true;
    }
  }
  // 2. Détection par horodatage de build (si timestamp serveur > timestamp local)
  else if (v.builtAt && currentAt) {
    try {
      const serverTime = new Date(v.builtAt).getTime();
      const localTime = new Date(currentAt).getTime();
      if (!Number.isNaN(serverTime) && !Number.isNaN(localTime) && serverTime > localTime) {
        updateFound = true;
      }
    } catch {
      /* ignore */
    }
  }
  // 3. Détection de secours par identifiant de version
  else if (v.version && bootVersion && v.version !== bootVersion) {
    updateFound = true;
  }

  isUpdatePending = updateFound;
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
