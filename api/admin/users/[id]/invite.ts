import { inviteEmailHtml, requireSuperAdmin, resolvePublicOrigin, sendSystemEmail, statusForError, supabaseAdmin } from '../../../_supabaseAdmin.js';

/**
 * POST /api/admin/users/:id/invite — (ré)envoie une invitation à un
 * utilisateur déjà créé et génère un lien de connexion directe.
 *
 * Remplace fidèlement `app.post('/api/admin/users/:id/invite', ...)` de
 * l'ancien server.ts (qui ne tourne pas en production sur Vercel).
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    await requireSuperAdmin(req);

    const userId = String(req.query?.id || '');
    if (!userId) throw new Error('Identifiant utilisateur manquant.');

    const { data: profiles, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', userId)
      .limit(1);

    if (profileErr || !profiles?.length) {
      throw new Error('Utilisateur non trouvé.');
    }

    const email = profiles[0].email as string;
    const publicOrigin = resolvePublicOrigin(req);

    let emailSent = false;
    let emailError: string | null = null;
    let actionLink: string | null = null;

    // Génère un lien magique/direct.
    try {
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: publicOrigin },
      });
      if (linkErr) throw linkErr;
      if (linkData?.properties?.action_link) actionLink = linkData.properties.action_link;
    } catch (linkErr: any) {
      console.warn('[api/admin/users/:id/invite] generateLink notice:', linkErr?.message);
    }

    if (!actionLink) {
      actionLink = `${publicOrigin}/?email=${encodeURIComponent(email)}`;
    }

    // Signalé : "je ne reçois pas de mail" — remplace l'e-mail d'invitation
    // intégré de Supabase Auth (peu fiable / non configuré ici) par un vrai
    // envoi, toujours depuis le Gmail de Sylvain.
    const result = await sendSystemEmail(email, 'Votre invitation Nova CRM', inviteEmailHtml(profiles[0].full_name, actionLink));
    emailSent = result.ok;
    emailError = result.error || null;

    await supabaseAdmin.from('profiles').update({ updated_at: new Date().toISOString() }).eq('id', userId);

    res.status(200).json({ success: true, email, actionLink, emailSent, emailError });
  } catch (e: any) {
    console.error('[api/admin/users/:id/invite] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
