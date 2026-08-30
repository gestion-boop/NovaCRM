import { supabaseAdmin } from './_supabaseAdmin.js';

/**
 * Renouvellement automatique du jeton Google Drive PARTAGÉ d'une agence
 * (ticket "Connexion Google Drive par agence... renouvellement automatique
 * du token... l'utilisateur ne doit pas avoir à cliquer régulièrement sur
 * 'Reconnecter'"). À appeler par TOUTE fonction serveur ayant besoin d'un
 * access_token valide pour le Drive d'une agence — jamais lire
 * `agency_drive_tokens.access_token` directement, il peut être expiré.
 *
 * - Si l'access_token stocké est encore valide (avec 2 min de marge), il
 *   est renvoyé tel quel, sans appel réseau superflu.
 * - Sinon, échange le refresh_token (jamais exposé au client — stocké
 *   uniquement côté serveur, table protégée par service_role) contre un
 *   nouvel access_token auprès de Google, met à jour la ligne en base, et
 *   renvoie le nouveau jeton.
 * - Si Google refuse le refresh_token (révoqué par l'utilisateur, ou
 *   accès retiré volontairement — les deux seuls cas légitimes selon la
 *   demande), l'erreur est propagée clairement plutôt que de renvoyer un
 *   jeton invalide silencieusement ; c'est la SEULE situation où une
 *   reconnexion manuelle doit être redemandée.
 */
export async function getAgencyDriveAccessToken(agencyId: string): Promise<string> {
  const { data: row, error } = await supabaseAdmin
    .from('agency_drive_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('agency_id', agencyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('Aucun Google Drive connecté pour cette agence.');

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const stillValid = expiresAt - Date.now() > 2 * 60 * 1000; // marge de 2 min
  if (stillValid && row.access_token) {
    return row.access_token as string;
  }

  if (!row.refresh_token) {
    throw new Error("Connexion Google Drive incomplète (pas de jeton de renouvellement) — reconnectez-la depuis Paramètres.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Configuration Google Drive manquante côté serveur.');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token as string,
      grant_type: 'refresh_token',
    }),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok) {
    // invalid_grant = refresh_token révoqué/expiré côté Google (révocation
    // manuelle par l'utilisateur, ou accès retiré) — seul cas où on doit
    // redemander une reconnexion manuelle, conformément à la demande.
    throw new Error(
      tokenBody.error === 'invalid_grant'
        ? "L'accès Google Drive de cette agence a été révoqué — reconnectez-le depuis Paramètres."
        : tokenBody.error_description || tokenBody.error || 'Renouvellement du jeton Google refusé.'
    );
  }

  const newAccessToken = tokenBody.access_token as string;
  await supabaseAdmin
    .from('agency_drive_tokens')
    .update({
      access_token: newAccessToken,
      expires_at: new Date(Date.now() + (tokenBody.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('agency_id', agencyId);

  return newAccessToken;
}
