import { requireSuperAdmin, statusForError, supabaseAdmin } from '../../../_supabaseAdmin.js';

/**
 * PUT /api/admin/users/:id/access — met à jour le rôle et les agences
 * rattachées d'un utilisateur. Porte de l'ancien
 * `app.put('/api/admin/users/:id/access', ...)` de server.ts.
 *
 * PATCH /api/admin/users/:id/access — "Prolonger le stage" (Équipe,
 * InternStageCard) : ne touche QUE les dates de stage / responsable, jamais
 * le rôle ou les agences. Fusionné ici (plutôt qu'un fichier dédié
 * intern-access.ts) pour rester sous la limite de 12 fonctions serverless
 * du plan Vercel Hobby — server.ts (où ce PATCH avait été écrit à part) ne
 * tourne de toute façon pas en production.
 *
 * PUT /api/admin/users/:id/access avec { isActive, isValidated } (sans
 * `role`) — active/désactive un compte. Fusionné depuis l'ancien fichier
 * dédié status.ts, même raison (limite de 12 fonctions).
 */
export default async function handler(req: any, res: any) {
  if (req.method === 'PATCH') return handleInternAccessPatch(req, res);
  if (req.method !== 'PUT') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }
  if (req.body?.role === undefined && (req.body?.isActive !== undefined || req.body?.isValidated !== undefined)) {
    return handleStatusUpdate(req, res);
  }

  try {
    await requireSuperAdmin(req);

    const userId = String(req.query?.id || '');
    if (!userId) throw new Error('Identifiant utilisateur manquant.');

    const role = ['super_admin', 'commercial', 'intern'].includes(req.body?.role) ? req.body.role : 'commercial';
    const agencyIds: string[] = Array.isArray(req.body?.agencyIds) ? req.body.agencyIds : [];

    // Ticket "Rôle Stagiaire" (phase 2) : mêmes champs que POST
    // /api/admin/users — manquait entièrement ici.
    const internStartsAt: string | null = role === 'intern' && req.body?.internStartsAt ? String(req.body.internStartsAt) : null;
    const internEndsAt: string | null = role === 'intern' && req.body?.internEndsAt ? String(req.body.internEndsAt) : null;
    const internResponsableId: string | null = role === 'intern' && req.body?.internResponsableId ? String(req.body.internResponsableId) : null;

    await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
    await supabaseAdmin.from('user_roles').insert({
      user_id: userId,
      role,
      expires_at: internEndsAt ? new Date(internEndsAt).toISOString() : null,
    });

    await supabaseAdmin.from('agency_members').delete().eq('user_id', userId);
    if (agencyIds.length) {
      await supabaseAdmin.from('agency_members').insert(agencyIds.map((agency_id) => ({ user_id: userId, agency_id })));
    }
    if (role === 'intern') {
      await supabaseAdmin.from('intern_details').delete().eq('user_id', userId);
      await supabaseAdmin.from('intern_details').insert({
        user_id: userId,
        starts_at: internStartsAt || new Date().toISOString().slice(0, 10),
        responsable_id: internResponsableId,
      });
    }

    res.status(200).json({ success: true });
  } catch (e: any) {
    console.error('[api/admin/users/:id/access] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}

async function handleStatusUpdate(req: any, res: any) {
  try {
    await requireSuperAdmin(req);

    const userId = String(req.query?.id || '');
    if (!userId) throw new Error('Identifiant utilisateur manquant.');

    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : undefined;
    const isValidated = req.body?.isValidated !== undefined ? Boolean(req.body.isValidated) : undefined;

    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (isActive !== undefined) payload.is_active = isActive;
    if (isValidated !== undefined) payload.is_validated = isValidated;

    await supabaseAdmin.from('profiles').update(payload).eq('id', userId);

    // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (7/16) : la
    // désactivation ne doit pas juste bloquer une FUTURE reconnexion —
    // ban_duration empêche tout nouveau jeton (vérifié empiriquement :
    // bloque le renouvellement/reconnexion immédiatement), et l'update de
    // `profiles.is_active` ci-dessus est relayé en temps réel aux sessions
    // déjà ouvertes (AuthContext.tsx s'y abonne et se déconnecte aussitôt)
    // — combinés, aucune session active ne survit à une désactivation.
    if (isActive === false) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '87600h' }).catch((e) => {
        console.warn('[api/admin/users/:id/access status] ban notice:', e?.message);
      });
    } else if (isActive === true) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' }).catch((e) => {
        console.warn('[api/admin/users/:id/access status] unban notice:', e?.message);
      });
    }

    res.status(200).json({ success: true, isActive, isValidated });
  } catch (e: any) {
    console.error('[api/admin/users/:id/access status] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}

async function handleInternAccessPatch(req: any, res: any) {
  try {
    await requireSuperAdmin(req);

    const userId = String(req.query?.id || '');
    if (!userId) throw new Error('Identifiant utilisateur manquant.');

    const internEndsAt = req.body?.internEndsAt ? String(req.body.internEndsAt) : null;
    const internStartsAt = req.body?.internStartsAt !== undefined ? String(req.body.internStartsAt) : undefined;
    const internResponsableId = req.body?.internResponsableId !== undefined ? (req.body.internResponsableId || null) : undefined;

    await supabaseAdmin
      .from('user_roles')
      .update({ expires_at: internEndsAt ? new Date(internEndsAt).toISOString() : null })
      .eq('user_id', userId)
      .eq('role', 'intern');

    const detailsPatch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (internStartsAt !== undefined) detailsPatch.starts_at = internStartsAt;
    if (internResponsableId !== undefined) detailsPatch.responsable_id = internResponsableId;
    if (Object.keys(detailsPatch).length > 1) {
      await supabaseAdmin.from('intern_details').update(detailsPatch).eq('user_id', userId);
    }

    res.status(200).json({ success: true });
  } catch (e: any) {
    console.error('[api/admin/users/:id/access PATCH] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
