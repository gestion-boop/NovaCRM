import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * Mapping agence -> couple (client_id, client_secret) Google OAuth.
 *
 * Chaque entité Home Compte possède son propre projet Google Cloud avec
 * son propre Web OAuth client. Les identifiants ne sont disponibles que
 * côté serveur via Deno.env (jamais exposés au frontend).
 *
 * La sélection se fait par NOM d'agence (insensible à la casse / accents
 * / pluriel) plutôt que par UUID, pour que ce soit stable même si la base
 * est ré-instanciée. Le fallback (GOOGLE_OAUTH_CLIENT_ID/SECRET hérité)
 * est conservé pour ne rien casser pendant la migration.
 */

export type DriveOAuthClient = {
  clientId: string;
  clientSecret: string;
  /** identifiant logique court, pour logs */
  entity: "conseil_finances" | "novavisio" | "imosphera" | "default";
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function fallback(): DriveOAuthClient | null {
  const id = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const secret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (id && secret) return { clientId: id, clientSecret: secret, entity: "default" };
  return null;
}

export function resolveOAuthClientByAgencyName(agencyName: string | null | undefined): DriveOAuthClient {
  // ── Clés agence-spécifiques ─────────────────────────────────────────────
  // Elles doivent primer sur la clé générique : sinon Google vérifie l'URI de
  // redirection sur le mauvais client OAuth et renvoie redirect_uri_mismatch.
  const n = normalize(agencyName ?? "");
  if (n.includes("conseil")) {
    const id = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID_CONSEIL_FINANCES");
    const secret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET_CONSEIL_FINANCES");
    if (id && secret) return { clientId: id, clientSecret: secret, entity: "conseil_finances" };
  }
  if (n.includes("nova")) {
    const id = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID_NOVAVISIO");
    const secret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET_NOVAVISIO");
    if (id && secret) return { clientId: id, clientSecret: secret, entity: "novavisio" };
  }
  if (n.includes("mosphera") || n.includes("imosphera") || n.includes("immosphera")) {
    const id = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID_IMOSPHERA");
    const secret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET_IMOSPHERA");
    if (id && secret) return { clientId: id, clientSecret: secret, entity: "imosphera" };
  }

  // ── Fallback Workspace unique ───────────────────────────────────────────
  const genericId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const genericSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (genericId && genericSecret) {
    return { clientId: genericId, clientSecret: genericSecret, entity: "default" };
  }

  throw new Error(
    "Google OAuth non configuré. " +
      "Ajoutez GOOGLE_OAUTH_CLIENT_ID et GOOGLE_OAUTH_CLIENT_SECRET " +
      "dans Supabase → Dashboard → Edge Functions → Secrets.",
  );
}

export async function resolveOAuthClientByAgencyId(admin: SupabaseClient, agencyId: string): Promise<DriveOAuthClient> {
  const { data, error } = await admin.from("agencies").select("name").eq("id", agencyId).maybeSingle();
  if (error) throw new Error(`Lecture agence échouée: ${error.message}`);
  if (!data) throw new Error(`Agence ${agencyId} introuvable`);
  return resolveOAuthClientByAgencyName(data.name);
}
