import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

type Options<T> = {
  /** Valeur courante à surveiller (objet/string/etc). Doit être sérialisable JSON. */
  value: T;
  /** Fonction de sauvegarde — appelée après le debounce. */
  onSave: (value: T) => Promise<void>;
  /** Délai de debounce en ms (défaut 800). */
  debounceMs?: number;
  /** Clé localStorage pour conserver un brouillon en cas d'échec réseau. */
  storageKey?: string;
  /** Quand false, ne sauvegarde rien (ex: dialog fermé, données pas encore chargées). */
  enabled?: boolean;
};

/**
 * Auto-save générique :
 *  - debounce les écritures
 *  - ne déclenche QUE après une vraie modification utilisateur
 *  - garde un brouillon localStorage si le réseau échoue
 *  - flush automatique avant un changement de page / fermeture d'onglet
 */
export function useAutoSave<T>({
  value,
  onSave,
  debounceMs = 800,
  storageKey,
  enabled = true,
}: Options<T>) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialSerializedRef = useRef<string | null>(null);
  const lastSavedSerializedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);
  const pendingValueRef = useRef<T | null>(null);

  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { valueRef.current = value; }, [value]);

  // Réinitialise la baseline quand on (re)devient enabled : aucune écriture tant
  // que l'utilisateur n'a rien modifié.
  useEffect(() => {
    if (!enabled) return;
    const serialized = safeStringify(value);
    initialSerializedRef.current = serialized;
    lastSavedSerializedRef.current = serialized;
    setStatus("idle");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const doSave = useCallback(async (v: T) => {
    setStatus("saving");
    setError(null);
    try {
      await onSaveRef.current(v);
      lastSavedSerializedRef.current = safeStringify(v);
      setStatus("saved");
      setLastSavedAt(new Date());
      if (storageKey) {
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      }
    } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? "Erreur d'enregistrement");
      if (storageKey) {
        try { localStorage.setItem(storageKey, safeStringify(v)); } catch { /* ignore */ }
      }
    }
  }, [storageKey]);

  // Déclenche le debounce sur changement de valeur.
  useEffect(() => {
    if (!enabled) return;
    if (initialSerializedRef.current === null) return;
    const serialized = safeStringify(value);
    if (serialized === lastSavedSerializedRef.current) return;
    pendingValueRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    timerRef.current = setTimeout(() => {
      const v = pendingValueRef.current;
      pendingValueRef.current = null;
      if (v !== null) void doSave(v);
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, debounceMs]);

  // Flush avant fermeture / changement d'onglet pour ne pas perdre la dernière saisie.
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const v = pendingValueRef.current ?? valueRef.current;
      const serialized = safeStringify(v);
      if (serialized !== lastSavedSerializedRef.current) {
        void doSave(v);
      }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, doSave]);

  /** Force une sauvegarde immédiate (utile avant fermeture explicite d'un dialog). */
  const flushNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const v = pendingValueRef.current ?? valueRef.current;
    pendingValueRef.current = null;
    const serialized = safeStringify(v);
    if (serialized !== lastSavedSerializedRef.current) {
      await doSave(v);
    }
  }, [doSave]);

  return { status, lastSavedAt, error, flushNow };
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}