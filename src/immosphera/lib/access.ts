import { useAuth } from "@/contexts/AuthContext";

const IMMOSPHERA_RE = /immosphera/i;

// Demande explicite (14 septembre) : « on est d'accord que c'est uniquement
// Mélanie et Sylvain qui pourront mettre les secteurs ? » — Sylvain est déjà
// couvert par isSuperAdmin ; Mélanie ne l'est pas (même principe que
// estDirectionCF dans Sidebar.tsx), d'où la vérification par email dédiée.
const GERANTE_IMMOSPHERA_RE = /melanie@immosphera\.fr/i;

/**
 * Accès au module ImmoSphera 360 :
 * - super admins,
 * - membres de l'agence ImmoSphera.
 * `isAdmin` = droit d'écriture (création / édition / suppression de biens).
 * `peutGererSecteurs` = droit de définir les secteurs (codes postaux/villes,
 * couleurs) des conseillers — volontairement plus restreint que `isAdmin` :
 * réservé à Mélanie et aux super admins (Sylvain), pas à tous les admins
 * Immosphera.
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
  const peutGererSecteurs = canAccess && (isSuperAdmin || GERANTE_IMMOSPHERA_RE.test(user?.email ?? ""));

  return { user, loading, canAccess, isAdmin, peutGererSecteurs };
}