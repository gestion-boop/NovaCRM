import { getAuthedUser, statusForError, supabaseAdmin } from '../_supabaseAdmin.js';

/**
 * PATCH /api/settings/daily-reminders — bascule `profiles.push_daily_reminders`
 * pour l'utilisateur connecté.
 *
 * Ticket #13 (nouvelle base) : cette route n'existait pas du tout (aucune
 * fonction Vercel sous /api/settings/daily-reminders), donc l'appel côté
 * client échouait avec une erreur HTTP 4xx (404) au clic sur "Rappel
 * quotidien" dans Paramètres > Notifications. Même cause déjà rencontrée sur
 * /api/settings/bootstrap (voir ce fichier) — la fonction manquait, pas la
 * colonne en base, qui existe bien.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'PATCH') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    const authUser = await getAuthedUser(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const enabled = body.enabled === true;

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ push_daily_reminders: enabled })
      .eq('id', authUser.id);

    if (error) throw new Error(error.message);

    res.status(200).json({ ok: true, enabled });
  } catch (e: any) {
    console.error('[api/settings/daily-reminders] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
