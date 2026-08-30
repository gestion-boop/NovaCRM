import crypto from 'crypto';
import { getAuthedUser, isSuperAdminUser, requireSuperAdmin, statusForError, supabaseAdmin } from '../../_supabaseAdmin.js';

/**
 * /api/admin/drive/:agencyId
 *
 * Un seul fichier gère TROIS choses (limite Vercel Hobby : 12 fonctions
 * serverless max — déjà atteinte, voir le commentaire plus bas) :
 *
 * - DELETE               : déconnecte le Drive partagé d'une agence.
 * - GET  (agencyId=uuid) : démarre la connexion OAuth Google COMPLÈTE
 *   (avec refresh_token) pour le Drive PARTAGÉ de cette agence — distinct
 *   du Drive personnel de chaque utilisateur (celui-là reste lié à Supabase
 *   Auth, jeton sans refresh_token, ~1h). Appelée par une navigation de
 *   page (pas un fetch), donc le jeton d'authentification arrive en query
 *   (?token=...), pas en en-tête.
 * - GET  (agencyId="callback") : retour de l'écran de consentement Google
 *   — même fichier, car `/api/admin/drive/callback` matche aussi la route
 *   dynamique `[agencyId].ts` (agencyId="callback" n'est qu'une chaîne
 *   parmi d'autres pour ce paramètre). Ça évite d'ajouter un 13e fichier
 *   sous /api, ce qui aurait dépassé le plafond Hobby (12 fonctions max —
 *   confirmé en échec de déploiement réel avant ce refactor).
 *
 * Sécurité : `state` est signé (HMAC) à l'initiation pour que le callback
 * puisse vérifier qu'il vient bien d'une initiation validée ici, et non
 * d'un `state` deviné/forgé par un acteur non authentifié.
 */

function signState(agencyId: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const sig = crypto.createHmac('sha256', secret).update(agencyId).digest('hex').slice(0, 24);
  return `${agencyId}.${sig}`;
}

function verifyState(state: string): string | null {
  const [agencyId, sig] = String(state || '').split('.');
  if (!agencyId || !sig) return null;
  const expected = signState(agencyId).split('.')[1];
  return sig === expected ? agencyId : null;
}

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/userinfo.email'].join(' ');

async function handleOAuthCallback(req: any, res: any) {
  const { code, state, error: oauthError } = req.query || {};
  const origin = `https://${req.headers.host}`;
  const redirectBack = `${origin}/?parametres=drive`;

  try {
    if (oauthError) throw new Error(String(oauthError));
    const agencyId = verifyState(String(state || ''));
    if (!code || !agencyId) throw new Error('Réponse Google invalide ou expirée — relancez la connexion depuis Paramètres.');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Configuration Google Drive manquante côté serveur.');

    const redirectUri = `${origin}/api/admin/drive/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenBody.error_description || tokenBody.error || 'Échange du jeton Google refusé.');
    if (!tokenBody.refresh_token) {
      // Google ne renvoie un refresh_token que lors du TOUT premier
      // consentement (prompt=consent, déjà forcé côté init) — sans lui, la
      // connexion redeviendrait aussi fragile que le Drive personnel.
      throw new Error("Google n'a pas renvoyé de jeton de renouvellement — révoquez l'accès existant de cette app dans myaccount.google.com/permissions puis réessayez.");
    }

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const userInfo = await userInfoRes.json();

    await supabaseAdmin.from('agency_drive_tokens').upsert(
      {
        agency_id: agencyId,
        google_email: userInfo.email || null,
        access_token: tokenBody.access_token,
        refresh_token: tokenBody.refresh_token,
        expires_at: new Date(Date.now() + (tokenBody.expires_in || 3600) * 1000).toISOString(),
        scope: tokenBody.scope || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'agency_id' }
    );

    res.writeHead(302, { Location: redirectBack });
    res.end();
  } catch (e: any) {
    console.error('[api/admin/drive/callback] error:', e);
    res.writeHead(302, { Location: `${redirectBack}&drive_error=${encodeURIComponent(e?.message || 'Erreur inconnue.')}` });
    res.end();
  }
}

async function handleOAuthInitiate(req: any, res: any, agencyId: string) {
  try {
    const token = String(req.query?.token || '');
    if (!token) throw new Error('Authentification manquante.');

    const user = await getAuthedUser({ headers: { authorization: `Bearer ${token}` } });
    if (!(await isSuperAdminUser(user))) throw new Error('Action réservée aux super administrateurs.');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error('Configuration Google Drive manquante côté serveur.');

    const origin = `https://${req.headers.host}`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${origin}/api/admin/drive/callback`,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: DRIVE_SCOPES,
      state: signState(agencyId),
    });

    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
    res.end();
  } catch (e: any) {
    console.error('[api/admin/drive/:agencyId] GET error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === 'DELETE') {
    try {
      await requireSuperAdmin(req);
      const agencyId = String(req.query?.agencyId || '');
      if (!agencyId) throw new Error('Identifiant agence manquant.');
      await supabaseAdmin.from('agency_drive_tokens').delete().eq('agency_id', agencyId);
      res.status(200).json({ success: true });
    } catch (e: any) {
      console.error('[api/admin/drive/:agencyId] DELETE error:', e);
      res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
    }
    return;
  }

  if (req.method === 'GET') {
    const agencyId = String(req.query?.agencyId || '');
    if (agencyId === 'callback') {
      await handleOAuthCallback(req, res);
    } else if (agencyId) {
      await handleOAuthInitiate(req, res, agencyId);
    } else {
      res.status(400).json({ error: 'Identifiant agence manquant.' });
    }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée.' });
}
