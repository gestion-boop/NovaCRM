import { useAuth } from "@/contexts/AuthContext";

const IMMOSPHERA_RE = /immosphera/i;

/**
 * Accès au module ImmoSphera 360 :
 * - super admins,
 * - membres de l'agence ImmoSphera.
 * `isAdmin` = droit d'écriture (création / édition / suppression de biens).
 */
export function useImmoAuth() {
  const { user, agencies, activeAgency, isSuperAdmin, isIntern, loading } = useAuth() as any;

  const list: { name?: string | null; slug?: string | null }[] = Array.isArray(agencies)
    ? agencies
    : activeAgency
      ? [activeAgency]
      : [];

  const inImmosphera = list.some(
    (a) => IMMOSPHERA_RE.test(a?.name ?? "") || IMMOSPHERA_RE.test(a?.slug ?? ""),
  );

  const canAccess = !!user && (isSuperAdmin || inImmosphera);
  const isAdmin = canAccess && (isSuperAdmin || !isIntern);

  return { user, loading, canAccess, isAdmin };
}