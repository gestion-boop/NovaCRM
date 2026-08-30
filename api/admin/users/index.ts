import { randomUUID } from 'crypto';
import { inviteEmailHtml, requireSuperAdmin, resolvePublicOrigin, sendSystemEmail, statusForError, supabaseAdmin } from '../../_supabaseAdmin.js';

/**
 * POST /api/admin/users — crée (ou récupère) un compte Supabase Auth et son
 * profil, puis génère un lien de connexion directe. Porte de secours pour
 * les deux flux front qui appellent ce même endpoint : "Inviter un
 * utilisateur" et "Créer un utilisateur manuellement" (ParametresView.tsx).
 *
 * Remplace fidèlement `app.post('/api/admin/users', ...)` de l'ancien
 * server.ts (qui ne tourne pas en production sur Vercel).
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    await requireSuperAdmin(req);

    const email = String(req.body?.email || '').trim().toLowerCase();
    // Ticket "Inviter un collaborateur" (#166) : ce formulaire n'a jamais
    // demandé de mot de passe à l'admin (comme pour l'invitation d'un
    // stagiaire ou d'un client) — connexion uniquement via le lien magique
    // envoyé par e-mail. Un mot de passe aléatoire est généré en interne
    // (jamais transmis, jamais utilisé) pour satisfaire l'API Supabase.
    const password = String(req.body?.password || '') || `${randomUUID().replace(/-/g, '')}Aa1!`;
    const fullName = String(req.body?.fullName || '').trim();
    const role = ['super_admin', 'commercial', 'intern'].includes(req.body?.role) ? req.body.role : 'commercial';
    const agencyIds: string[] = Array.isArray(req.body?.agencyIds) ? req.body.agencyIds : [];
    const phone = String(req.body?.phone || '').trim();
    const businessCardEmail = String(req.body?.businessCardEmail || '').trim().toLowerCase();
    const avatarDataUrl = String(req.body?.avatarDataUrl || '');
    const avatarExtension = String(req.body?.avatarExtension || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';

    if (!email) {
      throw new Error('Email obligatoire.');
    }

    const publicOrigin = resolvePublicOrigin(req);

    let userId: string | null = null;
    let actionLink: string | null = null;

    // 1. Crée le compte Supabase Auth (tolérant si déjà existant).
    try {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr) throw createErr;
      userId = created?.user?.id || null;
    } catch (authErr: any) {
      console.warn('[api/admin/users] createUser notice:', authErr?.message);
    }

    // 2. Génère un lien magique de connexion directe (fonctionne aussi si
    // l'étape 1 a échoué parce que le compte existait déjà).
    try {
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: publicOrigin },
      });
      if (linkErr) throw linkErr;
      if (linkData?.properties?.action_link) actionLink = linkData.properties.action_link;
      if (!userId && linkData?.user?.id) userId = linkData.user.id;
    } catch (linkErr: any) {
      console.warn('[api/admin/users] generateLink notice:', linkErr?.message);
    }

    // 3. UUID de secours si tout ce qui précède a échoué.
    if (!userId) {
      const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('email', email).limit(1);
      userId = existing?.[0]?.id || randomUUID();
    }

    // 3b. Photo de profil (facultative) — envoyée en data URL par le
    // formulaire "Inviter un collaborateur" (#166), téléversée ici plutôt
    // que côté client car le nouveau compte n'a pas encore de session pour
    // s'uploader lui-même sa propre photo.
    let avatarUrl: string | null = null;
    if (avatarDataUrl.startsWith('data:')) {
      try {
        const base64 = avatarDataUrl.split(',')[1] || '';
        const buffer = Buffer.from(base64, 'base64');
        const contentType = avatarDataUrl.slice(5, avatarDataUrl.indexOf(';')) || 'image/jpeg';
        const path = `${userId}/avatar-${Date.now()}.${avatarExtension}`;
        const { error: uploadErr } = await supabaseAdmin.storage.from('avatars').upload(path, buffer, { contentType, upsert: true });
        if (uploadErr) throw uploadErr;
        avatarUrl = supabaseAdmin.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      } catch (avatarErr: any) {
        console.warn('[api/admin/users] avatar upload notice:', avatarErr?.message);
      }
    }

    // 4. Upsert de la ligne de profil (is_active/is_validated ont leurs
    // valeurs par défaut en base, true/true — pas besoin de les fixer ici).
    await supabaseAdmin.from('profiles').upsert(
      {
        id: userId,
        email,
        full_name: fullName || null,
        phone: phone || null,
        business_card_email: businessCardEmail || null,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    // 5. Rôle + rattachements aux agences.
    // Ticket "Rôle Stagiaire" (phase 2) : `expires_at` (sur user_roles) porte
    // la date de FIN de stage — `intern_details` (starts_at/responsable_id)
    // complète le reste. Manquait entièrement ici (server.ts, où ce code
    // avait été écrit, ne tourne pas en production sur Vercel).
    const internStartsAt: string | null = role === 'intern' && req.body?.internStartsAt ? String(req.body.internStartsAt) : null;
    const internEndsAt: string | null = role === 'intern' && req.body?.internEndsAt ? String(req.body.internEndsAt) : null;
    const internResponsableId: string | null = role === 'intern' && req.body?.internResponsableId ? String(req.body.internResponsableId) : null;
    // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (5/16) : modules
    // additionnels + note libre — appliqués côté client par StagiaireShell.tsx.
    const internAllowedModules: string[] = role === 'intern' && Array.isArray(req.body?.internAllowedModules) ? req.body.internAllowedModules.filter((m: unknown) => typeof m === 'string') : [];
    const internSpecialRights: string | null = role === 'intern' && req.body?.internSpecialRights ? String(req.body.internSpecialRights) : null;

    await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
    await supabaseAdmin.from('user_roles').insert({
      user_id: userId,
      role,
      expires_at: internEndsAt ? new Date(internEndsAt).toISOString() : null,
    });
    await supabaseAdmin.from('agency_members').delete().eq('user_id', userId);
    if (agencyIds.length) {
      await supabaseAdmin
        .from('agency_members')
        .insert(agencyIds.map((agency_id) => ({ user_id: userId, agency_id })));
    }
    if (role === 'intern') {
      await supabaseAdmin.from('intern_details').delete().eq('user_id', userId);
      await supabaseAdmin.from('intern_details').insert({
        user_id: userId,
        starts_at: internStartsAt || new Date().toISOString().slice(0, 10),
        responsable_id: internResponsableId,
        allowed_modules: internAllowedModules,
        special_rights: internSpecialRights,
      });
    }

    // 6. Envoi de l'e-mail d'invitation — signalé : rien n'était envoyé
    // jusqu'ici (le lien était juste copié dans le presse-papiers). Part
    // toujours du Gmail de Sylvain, quel que soit l'admin qui invite.
    let emailSent = false;
    let emailError: string | null = null;
    if (actionLink) {
      const result = await sendSystemEmail(email, 'Votre invitation Nova CRM', inviteEmailHtml(fullName, actionLink));
      emailSent = result.ok;
      emailError = result.error || null;
    }

    res.status(200).json({
      success: true,
      id: userId,
      email,
      fullName,
      role,
      actionLink,
      emailSent,
      emailError,
      message: emailSent
        ? `L'utilisateur ${email} a été créé et un e-mail d'invitation lui a été envoyé.`
        : `L'utilisateur ${email} a été créé et associé aux agences. L'e-mail d'invitation n'a pas pu être envoyé automatiquement — le lien reste copié dans le presse-papiers.`,
    });
  } catch (e: any) {
    console.error('[api/admin/users] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
