import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveOAuthClientByAgencyId } from "./drive-oauth-clients.ts";

/**
 * Récupère un access_token Drive valide pour une agence.
 * Refresh automatiquement via refresh_token si expiré.
 * Retourne null si l'agence n'a pas de token configuré.
 *
 * Pour TOUT échec de refresh (token révoqué, credentials incorrects, erreur
 * réseau, réponse non-JSON…) : le token cassé est effacé en base afin que
 * le frontend puisse proposer une nouvelle connexion OAuth.
 */
export async function getAgencyDriveAccessToken(
  admin: SupabaseClient,
  agencyId: string,
): Promise<{ accessToken: string; folderId: string | null; scope: string | null } | null> {
  const { data: token } = await admin.from("agency_drive_tokens").select("*").eq("agency_id", agencyId).maybeSingle();

  if (!token) return null;

  const { data: agency } = await admin.from("agencies").select("drive_folder_id").eq("id", agencyId).maybeSingle();

  const folderId: string | null = agency?.drive_folder_id ?? null;

  // Token encore valide ? (60s de marge)
  const expiresAt = new Date(token.expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) {
    return { accessToken: token.access_token, folderId, scope: token.scope ?? null };
  }

  // Refresh nécessaire
  if (!token.refresh_token) {
    // Efface le token inutilisable pour que le frontend détecte "non connecté"
    await admin
      .from("agency_drive_tokens")
      .update({ access_token: "", refresh_token: null, expires_at: new Date(0).toISOString() })
      .eq("agency_id", agencyId);

    throw new Error(
      "Token Drive expiré et aucun refresh_token disponible. " +
        "Reconnectez le Drive depuis Paramètres → Documents.",
    );
  }

  // Le refresh DOIT utiliser le même OAuth client que celui qui a émis le refresh_token.
  const oauthClient = await resolveOAuthClientByAgencyId(admin, agencyId);

  // Fonction utilitaire : efface le token cassé et lance une erreur "reconnectez"
  const clearAndThrow = async (reason: string) => {
    console.error("[drive-token] clearing broken token", { agencyId, reason });
    await admin
      .from("agency_drive_tokens")
      .update({ access_token: "", refresh_token: null, expires_at: new Date(0).toISOString() })
      .eq("agency_id", agencyId)
      .catch(() => {});
    throw new Error(
      `La connexion Google Drive doit être renouvelée (${reason}). ` +
        "Reconnectez le Drive depuis Paramètres → Documents.",
    );
  };

  let refreshData: Record<string, unknown>;
  try {
    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthClient.clientId,
        client_secret: oauthClient.clientSecret,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    // Google renvoie parfois du HTML (5xx, maintenance) — on parse prudemment
    const rawText = await refreshRes.text();
    try {
      refreshData = JSON.parse(rawText);
    } catch {
      console.error("[drive-token] non-JSON response from Google", { status: refreshRes.status, rawText: rawText.slice(0, 200) });
      // Pas de JSON = erreur temporaire côté Google ; on ne casse pas le token
      throw new Error(
        `Google OAuth indisponible (HTTP ${refreshRes.status}). Réessayez dans quelques instants.`,
      );
    }

    if (!refreshRes.ok) {
      const googleError: string = String(refreshData?.error ?? "unknown");
      const googleDesc: string = String(refreshData?.error_description ?? "");
      console.error("[drive-token] refresh failed", { googleError, googleDesc, agencyId });

      // Tous les codes d'erreur Google liés à l'autorisation → token définitivement invalide
      const AUTH_ERRORS = ["invalid_grant", "token_expired", "invalid_client", "unauthorized_client", "access_denied"];
      if (AUTH_ERRORS.includes(googleError)) {
        await clearAndThrow(googleError);
      }

      // Erreur générique : on efface aussi par sécurité
      await clearAndThrow(`${googleError}: ${googleDesc}`.trim());
    }
  } catch (fetchErr) {
    // Erreur réseau (timeout, DNS…) — on ne casse pas le token
    if (fetchErr instanceof Error && fetchErr.message.includes("Google OAuth")) throw fetchErr;
    if (fetchErr instanceof Error && fetchErr.message.includes("Reconnectez")) throw fetchErr;
    throw new Error(
      `Impossible de joindre Google pour rafraîchir le token Drive. Vérifiez la connexion réseau.`,
    );
  }

  const newAccess: string = String(refreshData.access_token ?? "");
  if (!newAccess) await clearAndThrow("access_token vide dans la réponse Google");

  const newExpiresIn: number = Number(refreshData.expires_in ?? 3600);
  const newExpiresAt = new Date(Date.now() + newExpiresIn * 1000).toISOString();

  // Google peut renvoyer un nouveau refresh_token (token rotation) — on le conserve.
  const updatePayload: Record<string, string> = {
    access_token: newAccess,
    expires_at: newExpiresAt,
  };
  if (refreshData.refresh_token) {
    updatePayload.refresh_token = String(refreshData.refresh_token);
  }

  await admin.from("agency_drive_tokens").update(updatePayload).eq("agency_id", agencyId);

  console.info("[drive-token] token refreshed successfully", { agencyId, entity: oauthClient.entity });
  return { accessToken: newAccess, folderId, scope: token.scope ?? null };
}
