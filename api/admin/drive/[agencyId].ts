import crypto from 'crypto';
import { getAuthedUser, isSuperAdminUser, requireSuperAdmin, statusForError, supabaseAdmin } from '../../_supabaseAdmin.js';
import { PORTEES_WORKSPACE, clientPourEntite, clientPourUtilisateur, etatConfiguration } from '../../_googleUserOAuth.js';

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

// ── Connexion Google Workspace PAR SOCIÉTÉ (2 septembre) ────────────────
// Trois Workspace distincts, trois applications Google « internes » : chaque
// collaborateur autorise Gmail, Drive et Agenda sur l'application de SA
// société (voir api/_googleUserOAuth.ts). Reçu ICI, et non dans un fichier
// /api/google/*.ts : le plafond Vercel Hobby de 12 fonctions est atteint
// (voir l'en-tête). vercel.json réécrit /api/google/connect et
// /api/google/callback vers cette route dynamique, avec agencyId =
// "google-connect" / "google-callback". L'adresse de retour déclarée chez
// Google reste donc bien https://<hôte>/api/google/callback.
//
// - POST google-connect  : renvoie l'adresse d'autorisation Google de la
//   société de l'utilisateur ({ url }), ou { configured: false } si sa
//   société n'a pas encore ses clés — le CRM retombe alors sur la connexion
//   historique.
// - GET  google-callback : retour de Google, échange du code avec le client
//   de la société, enregistrement du jeton de renouvellement dans
//   user_google_tokens (la même table que l'edge function google-token, qui
//   le renouvelle ensuite indéfiniment).

const DUREE_DEMANDE_MS = 10 * 60 * 1000;

// Vécu le 3 septembre (Pauline, ImmoSphera) : Google répond « The OAuth
// client was not found » APRÈS la redirection, sur sa propre page — le CRM
// ne voit rien, la personne est bloquée. Pourtant l'identifiant de la console
// Google existe : c'est donc la valeur lue dans Vercel qui ne correspond pas.
// On demande à Google, avant de rediriger, s'il connaît cet identifiant : sa
// page d'autorisation renvoie vers /signin/oauth/error pour un client inconnu.
// Résultat gardé dix minutes pour ne pas interroger Google à chaque clic.
const verdictsClients = new Map<string, { connu: boolean; jusqua: number }>();
async function googleConnaitLeClient(clientId: string): Promise<boolean | null> {
  const memo = verdictsClients.get(clientId);
  if (memo && memo.jusqua > Date.now()) return memo.connu;
  try {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent('https://app.nova360.space/api/google/callback')}&response_type=code&scope=openid`;
    const reponse = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const cible = reponse.headers.get('location') || '';
    // Client connu : Google envoie vers l'écran de choix de compte ; inconnu :
    // vers sa page d'erreur. Toute autre réponse : on ne conclut pas.
    const connu = /signin\/oauth\/error/.test(cible) ? false : /accounts\.google\.com/.test(cible) || reponse.status === 200 ? true : null;
    if (connu !== null) verdictsClients.set(clientId, { connu, jusqua: Date.now() + 10 * 60 * 1000 });
    return connu;
  } catch {
    return null;
  }
}

async function handleUserConnect(req: any, res: any) {
  try {
    const user = await getAuthedUser(req);
    const { societe, client } = await clientPourUtilisateur({ id: user.id, email: user.email });
    if (!societe || !client) {
      res.status(200).json({
        configured: false,
        societe: societe?.nom ?? null,
        raison: societe ? 'cles_absentes' : 'societe_inconnue',
      });
      return;
    }
    if ((await googleConnaitLeClient(client.clientId)) === false) {
      console.error('[api/google/connect] client Google inconnu pour', societe.nom, client.clientId);
      res.status(200).json({
        configured: false,
        societe: societe.nom,
        raison: 'client_inconnu',
        // L'ID client n'est pas un secret (il figure dans chaque adresse
        // d'autorisation Google) : on le renvoie pour le comparer à la console.
        clientId: client.clientId,
      });
      return;
    }
    const origin = `https://${req.headers.host}`;
    const expiration = Date.now() + DUREE_DEMANDE_MS;
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: `${origin}/api/google/callback`,
      response_type: 'code',
      access_type: 'offline',
      // Sans consentement explicite, Google ne renvoie pas de refresh_token
      // à une reconnexion — et le jeton redeviendrait aussi fragile qu'avant.
      prompt: 'consent',
      scope: PORTEES_WORKSPACE,
      state: signState(`${user.id}|${client.entite}|${expiration}`),
      // Restreint l'écran Google aux comptes du Workspace de la société, et
      // présélectionne la boîte du collaborateur.
      hd: client.domaine,
      ...(user.email ? { login_hint: user.email } : {}),
    });
    res.status(200).json({
      configured: true,
      societe: societe.nom,
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    });
  } catch (e: any) {
    console.error('[api/google/connect] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}

async function handleUserCallback(req: any, res: any) {
  const { code, state, error: oauthError } = req.query || {};
  const origin = `https://${req.headers.host}`;
  try {
    if (oauthError) throw new Error(String(oauthError));
    const charge = verifyState(String(state || ''));
    const [userId, entite, expiration] = String(charge || '').split('|');
    if (!code || !userId || !entite) {
      throw new Error('Réponse Google invalide ou expirée — relancez la connexion depuis le CRM.');
    }
    if (Number(expiration) < Date.now()) {
      throw new Error('Cette demande de connexion a expiré — relancez-la depuis le CRM.');
    }
    const client = clientPourEntite(entite);
    if (!client) throw new Error('Configuration Google manquante côté serveur pour cette société.');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: `${origin}/api/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenBody.error_description || tokenBody.error || 'Échange du jeton Google refusé.');
    if (!tokenBody.refresh_token) {
      throw new Error("Google n'a pas renvoyé de jeton de renouvellement — révoquez l'accès de Nova CRM dans myaccount.google.com/permissions puis réessayez.");
    }

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const userInfo = await userInfoRes.json().catch(() => ({}));

    const { error } = await supabaseAdmin.from('user_google_tokens').upsert(
      {
        user_id: userId,
        google_email: userInfo?.email || null,
        access_token: tokenBody.access_token,
        refresh_token: tokenBody.refresh_token,
        expires_at: new Date(Date.now() + (tokenBody.expires_in || 3600) * 1000).toISOString(),
        scope: tokenBody.scope || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error(`Enregistrement du jeton impossible : ${error.message}`);

    res.writeHead(302, { Location: `${origin}/?google=connecte` });
    res.end();
  } catch (e: any) {
    console.error('[api/google/callback] error:', e);
    res.writeHead(302, { Location: `${origin}/?google_erreur=${encodeURIComponent(e?.message || 'Erreur inconnue.')}` });
    res.end();
  }
}

export default async function handler(req: any, res: any) {
  const cible = String(req.query?.agencyId || '');
  if (cible === 'google-connect') {
    if (req.method === 'POST') await handleUserConnect(req, res);
    // GET : diagnostic lisible dans un navigateur — quelles sociétés ont
    // leurs clés dans CET environnement (Production ou Preview). Des
    // booléens seulement, jamais une valeur.
    else if (req.method === 'GET') res.status(200).json({ environnement: process.env.VERCEL_ENV || null, cles: etatConfiguration() });
    else res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }
  if (cible === 'google-callback') {
    if (req.method === 'GET') await handleUserCallback(req, res);
    else res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

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
