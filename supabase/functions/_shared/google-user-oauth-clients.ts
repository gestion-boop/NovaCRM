import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type GoogleUserOAuthClient = {
  clientId: string;
  clientSecret: string;
  entity: "conseil_finances" | "novavisio" | "immosphera" | "default";
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function envFirst(keys: string[]): string | null {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function defaultClient(): GoogleUserOAuthClient | null {
  const clientId = envFirst(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"]);
  const clientSecret = envFirst(["GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, entity: "default" };
}

function clientFromEnv(
  clientIdKeys: string[],
  clientSecretKeys: string[],
  entity: GoogleUserOAuthClient["entity"],
): GoogleUserOAuthClient | null {
  const clientId = envFirst(clientIdKeys);
  const clientSecret = envFirst(clientSecretKeys);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, entity };
}

function clientForAgencyName(agencyName: string | null | undefined): GoogleUserOAuthClient | null {
  const n = normalize(agencyName ?? "");

  if (n.includes("conseil") || n.includes("finance")) {
    return clientFromEnv(
      ["GOOGLE_OAUTH_CLIENT_ID_CONSEIL_FINANCES", "GOOGLE_CLIENT_ID_CONSEIL_FINANCES"],
      ["GOOGLE_OAUTH_CLIENT_SECRET_CONSEIL_FINANCES", "GOOGLE_CLIENT_SECRET_CONSEIL_FINANCES"],
      "conseil_finances",
    );
  }

  if (n.includes("nova") || n.includes("visio")) {
    return clientFromEnv(
      ["GOOGLE_OAUTH_CLIENT_ID_NOVAVISIO", "GOOGLE_CLIENT_ID_NOVAVISIO"],
      ["GOOGLE_OAUTH_CLIENT_SECRET_NOVAVISIO", "GOOGLE_CLIENT_SECRET_NOVAVISIO"],
      "novavisio",
    );
  }

  if (n.includes("immosphera") || n.includes("imosphera") || n.includes("mosphera")) {
    return clientFromEnv(
      [
        "GOOGLE_OAUTH_CLIENT_ID_IMMOSPHERA",
        "GOOGLE_OAUTH_CLIENT_ID_IMOSPHERA",
        "GOOGLE_CLIENT_ID_IMMOSPHERA",
        "GOOGLE_CLIENT_ID_IMOSPHERA",
      ],
      [
        "GOOGLE_OAUTH_CLIENT_SECRET_IMMOSPHERA",
        "GOOGLE_OAUTH_CLIENT_SECRET_IMOSPHERA",
        "GOOGLE_CLIENT_SECRET_IMMOSPHERA",
        "GOOGLE_CLIENT_SECRET_IMOSPHERA",
      ],
      "immosphera",
    );
  }

  return null;
}

export function resolveUserOAuthClientByAgencyName(agencyName: string | null | undefined): GoogleUserOAuthClient {
  // L'authentification CRM (Supabase Auth) est mutualisée chez Conseils Finances,
  // MAIS chaque agence (Workspace Google) possède son propre projet Google Cloud
  // et son propre client OAuth. Un agent Novavisio doit donc s'authentifier
  // contre le projet Novavisio, un agent Immosphera contre Immosphera, etc.
  // On résout donc le client OAuth en fonction du nom de l'agence active.
  const agencyClient = clientForAgencyName(agencyName);
  if (agencyClient) return agencyClient;

  // Fallback : client OAuth générique (par défaut Conseils Finances si configuré
  // en tant que client par défaut, sinon le client global du projet).
  const fallback = defaultClient();
  if (fallback) return fallback;

  const conseilFinances = clientFromEnv(
    ["GOOGLE_OAUTH_CLIENT_ID_CONSEIL_FINANCES", "GOOGLE_CLIENT_ID_CONSEIL_FINANCES"],
    ["GOOGLE_OAUTH_CLIENT_SECRET_CONSEIL_FINANCES", "GOOGLE_CLIENT_SECRET_CONSEIL_FINANCES"],
    "conseil_finances",
  );
  if (conseilFinances) return conseilFinances;

  throw new Error("google_oauth_not_configured");
}

export async function resolveUserOAuthClientByAgencyId(
  admin: SupabaseClient,
  agencyId: string | null | undefined,
): Promise<GoogleUserOAuthClient | null> {
  if (!agencyId) return null;

  const { data: agency, error } = await admin.from("agencies").select("name").eq("id", agencyId).maybeSingle();
  if (error) throw new Error(`agency_lookup_failed: ${error.message}`);

  const agencyName = (agency as any)?.name as string | undefined;
  if (!agencyName) return null;

  return resolveUserOAuthClientByAgencyName(agencyName);
}

/**
 * Devine le client OAuth Google à utiliser à partir du domaine de l'adresse email
 * du collaborateur. Indispensable quand l'utilisateur appartient à plusieurs sociétés
 * dans le CRM : on doit s'authentifier contre le projet Google Cloud qui héberge
 * SA boîte mail, pas celui de la première société trouvée dans `agency_members`.
 *
 * Mapping :
 *   @immosphera.fr      → Immosphera
 *   @novavisio.fr       → Novavisio
 *   @conseilfinances.fr → Conseils Finances
 */
function clientForEmailDomain(email: string | null | undefined): GoogleUserOAuthClient | null {
  const domain = String(email ?? "").toLowerCase().split("@").pop() ?? "";
  if (!domain) return null;

  if (domain === "immosphera.fr" || domain.endsWith(".immosphera.fr")) {
    return clientForAgencyName("immosphera");
  }
  if (domain === "novavisio.fr" || domain.endsWith(".novavisio.fr")) {
    return clientForAgencyName("novavisio");
  }
  if (domain === "conseilfinances.fr" || domain.endsWith(".conseilfinances.fr")) {
    return clientForAgencyName("conseil finances");
  }
  return null;
}

export async function resolveUserOAuthClientByUserId(
  admin: SupabaseClient,
  userId: string,
  agencyId?: string | null,
): Promise<GoogleUserOAuthClient> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(`profile_lookup_failed: ${profileError.message}`);

  const email = (profile as any)?.email ?? "";
  const domain = String(email).toLowerCase().split("@").pop() ?? "";

  // Priorité 1 : on tire le client depuis le domaine de l'email (Workspace réel
  // de l'utilisateur). Évite qu'un agent Immosphera membre de plusieurs sociétés
  // se voie attribuer le client Google d'une autre société.
  const emailDomainClient = clientForEmailDomain(email);
  if (emailDomainClient) return emailDomainClient;

  const explicitAgencyClient = await resolveUserOAuthClientByAgencyId(admin, agencyId);
  if (explicitAgencyClient) return explicitAgencyClient;

  const { data: mappedAgency, error: mappedError } = await admin
    .from("allowed_email_domains")
    .select("agency_id")
    .eq("domain", domain)
    .maybeSingle();
  if (mappedError) throw new Error(`agency_domain_lookup_failed: ${mappedError.message}`);

  const mappedAgencyId = (mappedAgency as any)?.agency_id as string | undefined;
  if (mappedAgencyId) {
    const mappedClient = await resolveUserOAuthClientByAgencyId(admin, mappedAgencyId);
    if (mappedClient) return mappedClient;
  }

  const { data: member, error: memberError } = await admin
    .from("agency_members")
    .select("agency_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(`agency_member_lookup_failed: ${memberError.message}`);

  const memberAgencyId = (member as any)?.agency_id as string | undefined;
  if (memberAgencyId) {
    const memberClient = await resolveUserOAuthClientByAgencyId(admin, memberAgencyId);
    if (memberClient) return memberClient;
  }

  return resolveUserOAuthClientByAgencyName(null);
}

export async function resolveUserOAuthClientsForRefresh(
  admin: SupabaseClient,
  userId: string,
): Promise<GoogleUserOAuthClient[]> {
  const candidates: GoogleUserOAuthClient[] = [];

  try {
    candidates.push(await resolveUserOAuthClientByUserId(admin, userId));
  } catch {
    // On continue avec les clients connus ci-dessous.
  }

  for (const [idKeys, secretKeys, entity] of [
    [
      ["GOOGLE_OAUTH_CLIENT_ID_CONSEIL_FINANCES", "GOOGLE_CLIENT_ID_CONSEIL_FINANCES"],
      ["GOOGLE_OAUTH_CLIENT_SECRET_CONSEIL_FINANCES", "GOOGLE_CLIENT_SECRET_CONSEIL_FINANCES"],
      "conseil_finances",
    ],
    [
      [
        "GOOGLE_OAUTH_CLIENT_ID_IMMOSPHERA",
        "GOOGLE_OAUTH_CLIENT_ID_IMOSPHERA",
        "GOOGLE_CLIENT_ID_IMMOSPHERA",
        "GOOGLE_CLIENT_ID_IMOSPHERA",
      ],
      [
        "GOOGLE_OAUTH_CLIENT_SECRET_IMMOSPHERA",
        "GOOGLE_OAUTH_CLIENT_SECRET_IMOSPHERA",
        "GOOGLE_CLIENT_SECRET_IMMOSPHERA",
        "GOOGLE_CLIENT_SECRET_IMOSPHERA",
      ],
      "immosphera",
    ],
    [
      ["GOOGLE_OAUTH_CLIENT_ID_NOVAVISIO", "GOOGLE_CLIENT_ID_NOVAVISIO"],
      ["GOOGLE_OAUTH_CLIENT_SECRET_NOVAVISIO", "GOOGLE_CLIENT_SECRET_NOVAVISIO"],
      "novavisio",
    ],
  ] as const) {
    const c = clientFromEnv(idKeys, secretKeys, entity);
    if (c && !candidates.some((x) => x.clientId === c.clientId)) candidates.push(c);
  }

  const fallback = defaultClient();
  if (fallback && !candidates.some((x) => x.clientId === fallback.clientId)) candidates.push(fallback);

  return candidates;
}
