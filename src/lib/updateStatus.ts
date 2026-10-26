import { useState, useEffect } from 'react';

export interface ServerVersion {
  version: string;
  ref?: string;
  sha?: string;
  builtAt?: string;
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
