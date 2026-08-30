import {
  getAuthedUser,
  inviteEmailHtml,
  requireSuperAdmin,
  CLIENT_PUBLIC_ORIGIN,
  sendSystemEmail,
  statusForError,
  supabaseAdmin,
} from '../_supabaseAdmin.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * POST /api/clients/guest — gestion complète du portail "Clients invités"
 * (tickets #139, #141, #146, #149). Un seul fichier avec un champ `action`
 * plutôt que plusieurs routes, pour rester sous la limite de 12 fonctions
 * serverless du plan Vercel Hobby (cf. commentaires dans
 * api/admin/users/[id]/access.ts pour le même principe).
 *
 * Actions : invite | resend | suspend | reactivate | revoke | upload-document
 *   | request-login-link
 *
 * `upload-document` et `request-login-link` sont les SEULES actions
 * appelables sans être super_admin — la première vérifiée par
 * client_guest_access (le client agit sur SA fiche), la seconde totalement
 * publique par nature (page de connexion, avant toute authentification).
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    const action = String(req.body?.action || '');

    if (action === 'upload-document') return handleUploadDocument(req, res);
    if (action === 'request-login-link') return handleRequestLoginLink(req, res);

    const admin = await requireSuperAdmin(req);

    if (action === 'invite') return handleInvite(req, res, admin);
    if (action === 'resend') return handleResend(req, res);
    if (action === 'suspend') return handleSetStatus(req, res, 'suspendue', false);
    if (action === 'reactivate') return handleSetStatus(req, res, 'active', true);
    if (action === 'revoke') return handleRevoke(req, res);

    res.status(400).json({ error: 'Action inconnue.' });
  } catch (e: any) {
    console.error('[api/clients/guest] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}

async function handleUploadDocument(req: any, res: any) {
  const user = await getAuthedUser(req);
  const leadId = String(req.body?.leadId || '');
  const fileName = String(req.body?.fileName || '');
  const mimeType = String(req.body?.mimeType || 'application/octet-stream');
  const fileBase64 = String(req.body?.fileBase64 || '');
  const category = String(req.body?.category || '');
  const requestId = String(req.body?.requestId || '');
  if (!leadId || !fileName || !fileBase64) throw new Error('Fichier ou fiche manquant.');

  // Le client ne peut envoyer un document QUE pour SA propre fiche.
  const { data: access } = await supabaseAdmin
    .from('client_guest_access')
    .select('status')
    .eq('lead_id', leadId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!access || !['active', 'envoyee'].includes((access as any).status)) {
    res.status(403).json({ error: 'Accès non autorisé à cette fiche.' });
    return;
  }

  const fnRes = await fetch(`${SUPABASE_URL}/functions/v1/upload-client-document`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'x-internal-secret': process.env.INTERNAL_FUNCTIONS_SECRET || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ leadId, userId: user.id, fileName, mimeType, fileBase64, category, requestId }),
  });
  const body = await fnRes.json().catch(() => ({}));
  if (!fnRes.ok || body?.error) {
    res.status(200).json({ ok: false, error: body?.error || `HTTP ${fnRes.status}` });
    return;
  }
  res.status(200).json({ ok: true, fileUrl: body.fileUrl });
}

async function handleInvite(req: any, res: any, admin: { id: string }) {
  const leadId = String(req.body?.leadId || '');
  if (!leadId) throw new Error('Fiche client manquante.');

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads')
    .select('id, agency_id, email, first_name, last_name, full_name')
    .eq('id', leadId)
    .maybeSingle();
  if (leadErr || !lead) throw new Error('Fiche client introuvable.');

  const email = String((lead as any).email || '').trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!email || !emailValid) {
    return res.status(200).json({ ok: false, reason: 'missing_email', message: "Cette fiche n'a pas d'adresse e-mail valide." });
  }

  // Déjà invité ?
  const { data: existing } = await supabaseAdmin
    .from('client_guest_access')
    .select('id, status')
    .eq('lead_id', leadId)
    .maybeSingle();
  if (existing && (existing as any).status !== 'revoquee') {
    return res.status(200).json({ ok: false, reason: 'already_invited', message: 'Ce client est déjà invité.', status: (existing as any).status });
  }

  // Adresse utilisée par une AUTRE fiche ?
  const { data: dupes } = await supabaseAdmin
    .from('leads')
    .select('id, first_name, last_name, full_name, agency_id')
    .eq('email', email)
    .neq('id', leadId);
  if (dupes && dupes.length > 0) {
    return res.status(200).json({ ok: false, reason: 'duplicate_email', message: 'Cette adresse e-mail est utilisée par une autre fiche.', duplicates: dupes });
  }

  // Ce lien est destiné au CLIENT, jamais à un collaborateur : il doit
  // toujours cibler client.nova360.space, quel que soit le domaine (app/test)
  // depuis lequel le membre de l'équipe déclenche l'invitation.
  const publicOrigin = CLIENT_PUBLIC_ORIGIN;

  // Crée (ou récupère) le compte Supabase Auth du client.
  let userId: string | null = null;
  try {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: (lead as any).full_name || `${(lead as any).first_name || ''} ${(lead as any).last_name || ''}`.trim() },
    });
    if (createErr) throw createErr;
    userId = created?.user?.id || null;
  } catch (authErr: any) {
    console.warn('[api/clients/guest] createUser notice:', authErr?.message);
  }

  let actionLink: string | null = null;
  try {
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${publicOrigin}/espace-client` },
    });
    if (linkErr) throw linkErr;
    if (linkData?.properties?.action_link) actionLink = linkData.properties.action_link;
    if (!userId && linkData?.user?.id) userId = linkData.user.id;
  } catch (linkErr: any) {
    console.warn('[api/clients/guest] generateLink notice:', linkErr?.message);
  }
  if (!userId) throw new Error("Impossible de créer le compte de l'espace client.");
  if (!actionLink) throw new Error("Impossible de générer le lien d'invitation.");

  // Profil + rôle client_guest (jamais mélangé aux autres rôles).
  await supabaseAdmin.from('profiles').upsert(
    { id: userId, email, full_name: (lead as any).full_name || null, updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  );
  await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
  await supabaseAdmin.from('user_roles').insert({ user_id: userId, role: 'client_guest' });

  const { error: upsertErr } = await supabaseAdmin.from('client_guest_access').upsert(
    {
      lead_id: leadId,
      agency_id: (lead as any).agency_id,
      user_id: userId,
      email,
      status: 'envoyee',
      invited_by: admin.id,
      invited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'lead_id' }
  );
  if (upsertErr) throw new Error(upsertErr.message);

  const clientName = (lead as any).first_name || (lead as any).full_name || null;
  const result = await sendSystemEmail(email, 'Votre espace client Nova CRM', inviteEmailHtml(clientName, actionLink));

  res.status(200).json({ ok: true, emailSent: result.ok, emailError: result.error || null });
}

async function handleResend(req: any, res: any) {
  const accessId = String(req.body?.accessId || '');
  if (!accessId) throw new Error('Invitation introuvable.');

  const { data: access, error } = await supabaseAdmin.from('client_guest_access').select('*').eq('id', accessId).maybeSingle();
  if (error || !access) throw new Error('Invitation introuvable.');

  // Ticket #224 : cas d'erreur explicites plutôt qu'un échec silencieux ou
  // un message Supabase opaque — adresse absente ou visiblement invalide.
  const email = String((access as any).email || '').trim();
  if (!email) throw new Error("Ce client n'a pas d'adresse e-mail enregistrée.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("L'adresse e-mail enregistrée n'est pas valide.");

  const publicOrigin = CLIENT_PUBLIC_ORIGIN;
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${publicOrigin}/espace-client` },
  });
  if (linkErr || !linkData?.properties?.action_link) throw new Error("Impossible de générer le lien d'invitation.");

  await supabaseAdmin
    .from('client_guest_access')
    .update({ status: 'envoyee', invited_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', accessId);

  const result = await sendSystemEmail(email, 'Votre espace client Nova CRM', inviteEmailHtml(null, linkData.properties.action_link));
  res.status(200).json({ ok: true, emailSent: result.ok, emailError: result.error || null });
}

async function handleSetStatus(req: any, res: any, status: 'active' | 'suspendue', isActive: boolean) {
  const accessId = String(req.body?.accessId || '');
  if (!accessId) throw new Error('Invitation introuvable.');

  const { data: access, error } = await supabaseAdmin.from('client_guest_access').select('user_id').eq('id', accessId).maybeSingle();
  if (error || !access) throw new Error('Invitation introuvable.');

  await supabaseAdmin.from('client_guest_access').update({ status, updated_at: new Date().toISOString() }).eq('id', accessId);
  if ((access as any).user_id) {
    await supabaseAdmin.from('profiles').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', (access as any).user_id);
  }
  res.status(200).json({ ok: true });
}

async function handleRevoke(req: any, res: any) {
  const accessId = String(req.body?.accessId || '');
  if (!accessId) throw new Error('Invitation introuvable.');

  const { data: access, error } = await supabaseAdmin.from('client_guest_access').select('user_id').eq('id', accessId).maybeSingle();
  if (error || !access) throw new Error('Invitation introuvable.');

  // Révocation : coupe uniquement le DROIT DE CONNEXION — la fiche CRM, ses
  // documents et son historique restent intacts (demande explicite).
  await supabaseAdmin.from('client_guest_access').update({ status: 'revoquee', updated_at: new Date().toISOString() }).eq('id', accessId);
  if ((access as any).user_id) {
    await supabaseAdmin.from('profiles').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', (access as any).user_id);
    await supabaseAdmin.from('user_roles').delete().eq('user_id', (access as any).user_id).eq('role', 'client_guest');
  }
  res.status(200).json({ ok: true });
}

// Demande explicite (Sylvain) : un client sans compte Google ne pouvait pas
// se reconnecter une fois sa session expirée — le seul bouton de connexion
// de l'app entière est "Se connecter avec Google". Ce point d'entrée public
// (page /espace-client, avant toute authentification) permet au client de
// recevoir lui-même un nouveau lien de connexion par e-mail, en réutilisant
// exactement le même mécanisme que l'invitation initiale (magic link,
// jamais de mot de passe à créer/retenir/perdre). Ne révèle JAMAIS si
// l'adresse saisie correspond ou non à un client connu (même message dans
// les deux cas) — sinon ce point d'entrée public deviendrait un moyen de
// vérifier quelles adresses e-mail sont des clients de l'agence.
async function handleRequestLoginLink(req: any, res: any) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const genericResponse = { ok: true, message: 'Si cette adresse est associée à un espace client, un lien de connexion vient de lui être envoyé.' };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(200).json(genericResponse);
    return;
  }

  try {
    const { data: access } = await supabaseAdmin
      .from('client_guest_access')
      .select('id, status, invited_at')
      .eq('email', email)
      .maybeSingle();

    if (access && ['active', 'envoyee'].includes((access as any).status)) {
      // Anti-spam minimal : pas plus d'un renvoi par minute pour la même fiche.
      const lastSent = (access as any).invited_at ? new Date((access as any).invited_at).getTime() : 0;
      if (Date.now() - lastSent > 60_000) {
        const publicOrigin = CLIENT_PUBLIC_ORIGIN;
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo: `${publicOrigin}/espace-client` },
        });
        if (!linkErr && linkData?.properties?.action_link) {
          await sendSystemEmail(email, 'Votre lien de connexion Nova CRM', inviteEmailHtml(null, linkData.properties.action_link));
          await supabaseAdmin.from('client_guest_access').update({ invited_at: new Date().toISOString() }).eq('id', (access as any).id);
        }
      }
    }
  } catch (e: any) {
    console.warn('[api/clients/guest] request-login-link notice:', e?.message);
  }

  // Toujours la même réponse, que l'e-mail existe ou non / ait été envoyé ou non.
  res.status(200).json(genericResponse);
}
