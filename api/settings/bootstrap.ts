import { getAuthedUser, isSuperAdminUser, resolvePublicOrigin, statusForError, supabaseAdmin } from '../_supabaseAdmin.js';

// Ticket #267 : intégration kDrive (Infomaniak) — regroupée ici plutôt que
// dans un nouveau fichier serverless (déjà 12/12 sur le plan Vercel Hobby).
// login.infomaniak.com/{authorize,token} + api.infomaniak.com sont les
// domaines officiels de l'API Infomaniak (OAuth2 + kDrive v2/v3).
const INFOMANIAK_AUTHORIZE_URL = 'https://login.infomaniak.com/authorize';
const INFOMANIAK_TOKEN_URL = 'https://login.infomaniak.com/token';

// Ticket #267 : `req.query` s'est révélé vide sur le callback OAuth arrivé
// via le rewrite vercel.json (constaté en logs de production — "Utilisateur
// non authentifié" alors que le code Infomaniak était bien dans l'URL) —
// on retombe donc sur un parsing manuel de `req.url`, fiable quel que soit
// la façon dont le runtime Vercel peuple (ou non) `req.query` après un
// rewrite.
function parsedQuery(req: any): URLSearchParams {
  try {
    return new URL(req.url || '', 'http://x').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

// GET /api/settings/bootstrap?kdrive_authorize=1 (authentifié) — construit
// l'URL d'autorisation Infomaniak avec `state` = l'id utilisateur COURANT,
// déduit du jeton Supabase déjà vérifié (jamais fourni par le client), pour
// que le callback (non authentifié, simple redirection navigateur) sache à
// quel compte associer le jeton obtenu.
async function handleKdriveAuthorize(req: any, res: any) {
  const authUser = await getAuthedUser(req);
  const clientId = process.env.INFOMANIAK_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'Intégration kDrive non configurée (INFOMANIAK_CLIENT_ID manquant).' });
    return;
  }
  const origin = resolvePublicOrigin(req);
  const redirectUri = `${origin}api/auth/kdrive/callback`;
  const url = new URL(INFOMANIAK_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  // Ticket #267 (suivi) : scope=drive ET scope=drive:read renvoient tous les
  // deux "invalid_scope" — ce n'est donc pas un problème de nom de scope.
  // Sans scope, le jeton s'obtient mais l'API kDrive renvoie "not_authorized"
  // à l'usage : le vrai blocage semble être une permission côté
  // configuration de l'app Infomaniak elle-même (accès kDrive à activer
  // explicitement dans sa console développeur), pas un paramètre à corriger
  // ici. Repli sur aucun scope (le seul qui obtient un jeton) en attendant.
  // Signalé : "Échange du jeton Infomaniak échoué" — cause réelle : le
  // callback (requête du NAVIGATEUR redirigé par Infomaniak, Referer =
  // login.infomaniak.com, jamais le domaine d'origine) recalculait
  // `resolvePublicOrigin` à partir de rien de fiable, retombant presque
  // toujours sur le domaine canonique par défaut — alors que le
  // redirect_uri envoyé ICI, à l'autorisation, dépend du VRAI domaine
  // utilisé (app vs test). Un redirect_uri différent entre les deux étapes
  // fait toujours échouer l'échange côté Infomaniak (exigé identique par le
  // protocole OAuth). On fige donc l'origine choisie ici et on la fait
  // voyager dans `state` (avec l'id utilisateur) pour que le callback
  // réutilise EXACTEMENT le même redirect_uri, quel que soit son propre
  // Referer.
  url.searchParams.set('state', `${authUser.id}|${origin}`);
  res.status(200).json({ authorizeUrl: url.toString() });
}

// GET /api/auth/kdrive/callback (rewrite vercel.json → ici) — redirection
// navigateur depuis Infomaniak après consentement, jamais authentifiée par
// un Bearer token : `state` (l'id utilisateur posé par handleKdriveAuthorize
// ci-dessus) fait foi. Échange le code contre un jeton, tente de détecter
// automatiquement le kDrive de l'utilisateur, puis stocke tout et redirige
// vers Paramètres.
async function handleKdriveCallback(req: any, res: any) {
  // Repli uniquement pour les redirections d'erreur affichées à l'écran
  // (ex: "state" absent/corrompu) — jamais pour le redirect_uri envoyé à
  // Infomaniak, voir plus bas.
  const fallbackOrigin = resolvePublicOrigin(req);
  const redirectBack = (status: 'connected' | 'error', message?: string, backTo?: string) => {
    const url = new URL(`${backTo || fallbackOrigin}parametres`);
    url.searchParams.set('kdrive', status);
    if (message) url.searchParams.set('kdrive_error', message);
    res.writeHead(302, { Location: url.toString() });
    res.end();
  };

  try {
    const q = parsedQuery(req);
    const code = q.get('code') || '';
    const rawState = q.get('state') || '';
    // `state` = "<userId>|<origin>", l'origine ayant servi à construire le
    // redirect_uri lors de l'autorisation (voir handleKdriveAuthorize) — on
    // la réutilise TELLE QUELLE ici : cette requête de callback vient du
    // navigateur redirigé par Infomaniak (Referer = login.infomaniak.com,
    // jamais notre propre domaine), donc `resolvePublicOrigin(req)` ne peut
    // pas retrouver de façon fiable si l'utilisateur avait démarré depuis
    // app.nova360.space ou test.nova360.space, et retombait presque
    // toujours sur le domaine canonique par défaut. Un redirect_uri
    // différent de celui envoyé à l'autorisation fait systématiquement
    // échouer l'échange du jeton côté Infomaniak (obligatoire identique en
    // OAuth) — c'était la cause de "Échange du jeton Infomaniak échoué".
    const sepIndex = rawState.indexOf('|');
    const userId = sepIndex === -1 ? rawState : rawState.slice(0, sepIndex);
    const origin = sepIndex === -1 ? fallbackOrigin : rawState.slice(sepIndex + 1);
    const infomaniakError = q.get('error');
    if (infomaniakError) return redirectBack('error', `Infomaniak : ${infomaniakError}`, origin);
    if (!code || !userId) return redirectBack('error', 'Réponse Infomaniak incomplète.', origin);

    const clientId = process.env.INFOMANIAK_CLIENT_ID;
    const clientSecret = process.env.INFOMANIAK_CLIENT_SECRET;
    if (!clientId || !clientSecret) return redirectBack('error', 'Intégration kDrive non configurée.', origin);

    // L'utilisateur doit exister (jamais associer un jeton à un id inventé).
    const { data: profileRows } = await supabaseAdmin.from('profiles').select('id').eq('id', userId).limit(1);
    if (!profileRows?.length) return redirectBack('error', 'Utilisateur introuvable.', origin);

    const redirectUri = `${origin}api/auth/kdrive/callback`;
    const tokenRes = await fetch(INFOMANIAK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[kdrive callback] échange token échoué:', redirectUri, tokenData);
      return redirectBack('error', "Échange du jeton Infomaniak échoué.", origin);
    }

    // Détection automatique du kDrive de l'utilisateur — best effort : si
    // l'API ne répond pas dans le format attendu, on stocke quand même le
    // jeton (l'utilisateur pourra saisir son identifiant kDrive à la main).
    let driveId: string | null = null;
    try {
      const drivesRes = await fetch('https://api.infomaniak.com/2/drive', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const drivesData: any = await drivesRes.json().catch(() => ({}));
      const list = Array.isArray(drivesData?.data) ? drivesData.data : Array.isArray(drivesData) ? drivesData : [];
      if (list.length > 0) driveId = String(list[0].id ?? list[0].drive_id ?? '') || null;
    } catch {
      // best effort, voir commentaire ci-dessus
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;

    await supabaseAdmin.from('user_kdrive_tokens').upsert({
      user_id: userId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: expiresAt,
      drive_id: driveId,
      updated_at: new Date().toISOString(),
    });

    return redirectBack('connected', undefined, origin);
  } catch (e: any) {
    console.error('[kdrive callback] erreur:', e);
    return redirectBack('error', e?.message || 'Erreur inconnue.');
  }
}

/**
 * GET /api/settings/bootstrap — charge en un seul appel tout ce dont
 * ParametresView.tsx a besoin au montage : profil courant, préférences UI,
 * modèles d'évènements, statut de connexion Google Drive par agence et,
 * pour un super admin uniquement, la liste complète des utilisateurs
 * NovaSphere (avec rôle + agences rattachées).
 *
 * Cette route n'existait tout simplement pas en production (aucune fonction
 * Vercel réelle sous /api/settings/*), ce qui faisait silencieusement
 * échouer le chargement — le rewrite catch-all de vercel.json renvoyait le
 * HTML de l'app avec un statut 200, donc `response.ok` était vrai côté
 * client et aucune erreur n'était levée : la section "Utilisateurs" restait
 * bloquée à 0, et "Inviter un utilisateur" semblait cassé. Voir aussi
 * l'ancien server.ts (qui ne tourne pas sur Vercel) : cette fonction porte
 * fidèlement son ancienne route Express équivalente.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  const q = parsedQuery(req);

  // Ticket #267 : callback OAuth Infomaniak (rewrite vercel.json depuis
  // /api/auth/kdrive/callback) — reconnu à la présence de `code` OU d'une
  // erreur renvoyée par Infomaniak (ex: invalid_scope), jamais authentifié
  // par Bearer (simple redirection navigateur).
  if ((q.get('code') || q.get('error')) && q.get('state')) {
    return handleKdriveCallback(req, res);
  }
  // Ticket #267 : demande d'URL d'autorisation, déclenchée par le bouton
  // "Connecter kDrive" de ParametresView.tsx (authentifiée).
  if (q.get('kdrive_authorize') === '1') {
    try {
      return await handleKdriveAuthorize(req, res);
    } catch (e: any) {
      res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
      return;
    }
  }
  // Ticket #267 : déconnexion kDrive (authentifiée) — supprime le jeton de
  // l'utilisateur courant uniquement.
  if (q.get('kdrive_disconnect') === '1') {
    try {
      const authUser = await getAuthedUser(req);
      await supabaseAdmin.from('user_kdrive_tokens').delete().eq('user_id', authUser.id);
      res.status(200).json({ success: true });
      return;
    } catch (e: any) {
      res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
      return;
    }
  }
  // Ticket #267 : correction manuelle du driveId (authentifiée) — repli si
  // la détection automatique au moment du callback n'a rien trouvé (voir
  // handleKdriveCallback ci-dessus).
  if (q.get('kdrive_set_drive_id')) {
    try {
      const authUser = await getAuthedUser(req);
      const { error } = await supabaseAdmin
        .from('user_kdrive_tokens')
        .update({ drive_id: q.get('kdrive_set_drive_id'), updated_at: new Date().toISOString() })
        .eq('user_id', authUser.id);
      if (error) throw new Error(error.message);
      res.status(200).json({ success: true });
      return;
    } catch (e: any) {
      res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
      return;
    }
  }

  try {
    const authUser = await getAuthedUser(req);
    const email = (authUser.email || '').toLowerCase();
    const isSuperAdmin = await isSuperAdminUser(authUser);

    // Récupère le profil applicatif ET le rôle attribué (table `user_roles`)
    // de l'utilisateur. Un rôle en base ne peut exister que si un admin l'a
    // explicitement créé via /api/admin/users (invitation) ou .../access —
    // c'est notre véritable liste blanche : un compte Google qui n'a jamais
    // été invité n'a pas de ligne dans `user_roles` et se voit donc refuser
    // l'accès ci-dessous, SANS création automatique de profil pour lui.
    // (Remplace l'ancienne vérification contre la table `authorized_emails`,
    // qui n'existe plus du tout côté base — elle faisait échouer silencieu-
    // sement toute connexion sans profil déjà mis en cache localement.)
    const [{ data: profileRows }, { data: roleRow }] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', authUser.id).limit(1),
      supabaseAdmin.from('user_roles').select('role, expires_at').eq('user_id', authUser.id).maybeSingle(),
    ]);

    let profile = profileRows?.[0] || null;
    const role = isSuperAdmin ? 'super_admin' : roleRow?.role || null;

    // Ticket "Rôle Stagiaire" (phase 2) : dates d'accès temporaire — cette
    // route ne les renvoyait jamais (manquait entièrement en production),
    // donc la fenêtre d'accès temporaire n'était jamais vérifiée côté client
    // (AuthContext.syncSession). internEndsAt vient de user_roles.expires_at,
    // le reste de intern_details.
    let internStartsAt: string | null = null;
    let internEndsAt: string | null = (roleRow as any)?.expires_at || null;
    let internResponsableId: string | null = null;
    // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (5/16) : modules
    // additionnels ouverts au stagiaire (Accueil + son pipeline toujours
    // inclus) — StagiaireShell.tsx en dérive ses onglets dynamiques.
    let internAllowedModules: string[] = [];
    if (role === 'intern') {
      const { data: details } = await supabaseAdmin
        .from('intern_details')
        .select('starts_at, responsable_id, allowed_modules')
        .eq('user_id', authUser.id)
        .maybeSingle();
      internStartsAt = (details as any)?.starts_at || null;
      internResponsableId = (details as any)?.responsable_id || null;
      internAllowedModules = Array.isArray((details as any)?.allowed_modules) ? (details as any).allowed_modules : [];
    }

    if (!isSuperAdmin && !role) {
      throw new Error(
        "Accès refusé : votre compte n'a pas été invité sur NovaSphere. Contactez un administrateur."
      );
    }

    // Signalé en revue (25 octobre, sécurité) : la date de fin d'accès d'un
    // stagiaire (user_roles.expires_at) n'était jusqu'ici comparée qu'au
    // moment de la CONNEXION côté client (AuthContext). Cette route, qui
    // répond à CHAQUE chargement de l'app, ne refusait jamais le rôle
    // 'intern' une fois la date dépassée : un stagiaire qui bloque cette
    // requête dans les devtools garde son profil en cache côté client
    // indéfiniment, sans que le serveur ne le bannisse jamais lui-même.
    if (role === 'intern' && internEndsAt && new Date(internEndsAt) < new Date()) {
      throw new Error('Accès refusé : la période de votre accès stagiaire est terminée.');
    }

    if (!profile) {
      const { data: created } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authUser.id,
          email,
          full_name:
            (typeof authUser.user_metadata?.full_name === 'string' && authUser.user_metadata.full_name) || email,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .limit(1);
      profile = created?.[0] || { id: authUser.id, email, full_name: email };
    }

    if (profile?.is_active === false) {
      throw new Error("Accès refusé : votre compte est désactivé et l'accès au CRM vous a été retiré.");
    }

    const { data: ownMemberships } = await supabaseAdmin
      .from('agency_members')
      .select('agency_id')
      .eq('user_id', authUser.id);
    const agencyIds = (ownMemberships || []).map((m: any) => m.agency_id);

    const [{ data: ui }, { data: templates }, { data: drives }, { data: kdriveRows }] = await Promise.all([
      supabaseAdmin.from('user_ui_settings').select('*').eq('user_id', authUser.id).limit(1),
      supabaseAdmin.from('user_event_templates').select('*').eq('user_id', authUser.id).limit(1),
      supabaseAdmin.from('agency_drive_tokens').select('agency_id, google_email, updated_at'),
      // Ticket #267 : statut de connexion kDrive de l'utilisateur COURANT
      // (jamais celui d'un autre — jeton jamais renvoyé au client, juste
      // le fait qu'une connexion existe + le driveId détecté, si besoin de
      // le corriger manuellement).
      supabaseAdmin.from('user_kdrive_tokens').select('drive_id, updated_at').eq('user_id', authUser.id).limit(1),
    ]);

    let users: any[] = [];
    if (isSuperAdmin) {
      const [{ data: profiles, error: profilesErr }, { data: roles }, { data: memberships }, { data: internRows }] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('id, full_name, email, avatar_url, phone, job_title, is_active, is_validated'),
        // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (10/16) : `expires_at`
        // ajouté ici — nécessaire pour distinguer "Accès programmé"/"Accès
        // expiré" d'un compte simplement "Actif" dans le panneau centralisé
        // d'Équipe, sans requête supplémentaire par utilisateur.
        supabaseAdmin.from('user_roles').select('user_id, role, expires_at'),
        supabaseAdmin.from('agency_members').select('user_id, agency_id'),
        supabaseAdmin.from('intern_details').select('user_id, starts_at'),
      ]);
      if (profilesErr) console.error('[api/settings/bootstrap] profiles query error:', profilesErr);

      users = (profiles || []).map((p: any) => ({
        ...p,
        role: (roles || []).find((r: any) => r.user_id === p.id)?.role || 'commercial',
        agency_ids: (memberships || []).filter((m: any) => m.user_id === p.id).map((m: any) => m.agency_id),
        is_active: p.is_active !== false,
        is_validated: p.is_validated === true,
        expires_at: (roles || []).find((r: any) => r.user_id === p.id)?.expires_at || null,
        intern_starts_at: (internRows || []).find((r: any) => r.user_id === p.id)?.starts_at || null,
      }));
    }

    res.status(200).json({
      profile,
      role,
      internStartsAt,
      internEndsAt,
      internResponsableId,
      internAllowedModules,
      agency_ids: agencyIds,
      ui: ui?.[0] || null,
      templates: templates?.[0] || null,
      drives: drives || [],
      kdrive: kdriveRows?.[0] ? { connected: true, driveId: kdriveRows[0].drive_id || null } : { connected: false, driveId: null },
      users,
    });
  } catch (e: any) {
    console.error('[api/settings/bootstrap] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
