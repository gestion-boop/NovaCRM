import { useAuth } from "@/contexts/AuthContext";
import { MELANIE_UID } from "@/lib/pipelinesAcces";

const IMMOSPHERA_RE = /immosphera/i;

// Demande explicite (14 septembre) : « on est d'accord que c'est uniquement
// Mélanie et Sylvain qui pourront mettre les secteurs ? » — Sylvain est déjà
// couvert par isSuperAdmin ; Mélanie ne l'est pas (même principe que
// estDirectionCF dans Dashboard.tsx), d'où la vérification dédiée.
// Signalé en revue (25 octobre, sécurité) : ciblait auparavant
// melanie@immosphera.fr par e-mail — ce n'est PAS l'adresse du compte de
// Mélanie (gestion@immosphera.fr, UID 15bcec53, voir src/lib/pipelinesAcces.ts
// et src/data/teamMembers.ts), seulement son adresse de contact publique sur
// le site. Mélanie ne pouvait donc jamais gérer les secteurs comme demandé,
// et n'importe quelle session Supabase dont l'e-mail serait
// melanie@immosphera.fr (hors du contrôle de cette app) aurait au contraire
// obtenu ce droit. Basculé sur l'UID stable de son vrai compte.

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
  const peutGererSecteurs = canAccess && (isSuperAdmin || user?.id === MELANIE_UID);

  return { user, loading, canAccess, isAdmin, peutGererSecteurs };
}