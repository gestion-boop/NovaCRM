import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveUserOAuthClientsForRefresh } from "./google-user-oauth-clients.ts";

export type UserGoogleTokenInfo = { token: string; email: string | null; scope: string };

/**
 * Ticket #117 : renouvellement automatique et invisible du jeton Google
 * (Gmail/Drive/Agenda) d'un utilisateur — jamais besoin de se reconnecter
 * manuellement tant que le refresh_token stocké reste valide (il ne se
 * périme pas de lui-même côté Google, sauf révocation ou 6 mois d'inactivité
 * totale). Factorisé ici car dupliqué (presque à l'identique) dans
 * google-calendar, run-automations et camera-gcal-sync.
 */
export async function getValidUserGoogleToken(
  admin: SupabaseClient,
  userId: string,
): Promise<UserGoogleTokenInfo | null> {
  const { data: row } = await admin.from("user_google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) return null;

  const scope = (row as any).scope ?? "";
  const expiresAt = new Date((row as any).expires_at).getTime();

  if ((row as any).access_token && expiresAt - Date.now() > 60_000) {
    return { token: (row as any).access_token, email: (row as any).google_email ?? null, scope };
  }

  if (!(row as any).refresh_token) return null;

  let refreshData: any = null;
  for (const oauthClient of await resolveUserOAuthClientsForRefresh(admin, userId)) {
    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthClient.clientId,
        client_secret: oauthClient.clientSecret,
        refresh_token: (row as any).refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const text = await refreshRes.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      continue; // réponse non-JSON (erreur temporaire Google) — essaie le client suivant
    }

    if (refreshRes.ok && parsed?.access_token) {
      refreshData = parsed;
      break;
    }
    console.error("user-google-token refresh failed", { entity: oauthClient.entity, error: parsed?.error });

    // Refresh token révoqué/invalide : inutile d'essayer d'autres clients.
    if (["invalid_grant", "unauthorized_client"].includes(parsed?.error)) {
      await admin
        .from("user_google_tokens")
        .update({ access_token: "", refresh_token: null, expires_at: new Date(0).toISOString() })
        .eq("user_id", userId)
        .catch(() => {});
      return null;
    }
  }

  if (!refreshData?.access_token) return null;

  const newAccess = refreshData.access_token as string;
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
  const newScope = refreshData.scope ?? scope;

  await admin
    .from("user_google_tokens")
    .update({ access_token: newAccess, expires_at: newExpiresAt, scope: newScope })
    .eq("user_id", userId);

  return { token: newAccess, email: (row as any).google_email ?? null, scope: newScope };
}
