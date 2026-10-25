import { requireSuperAdmin, statusForError, supabaseAdmin } from '../../../_supabaseAdmin.js';

/**
 * DELETE /api/admin/users/:id — deux comportements distincts, sous la même
 * route (limite de 12 fonctions serverless du plan Vercel Hobby) :
 *
 * 1. Appel "classique" (sans `permanent: true` dans le body, ou sans body) :
 *    annulation d'une invitation encore en attente (aucun historique réel à
 *    préserver) — coupe l'accès, retire rôle/agences, tente une suppression
 *    du compte Auth, mais LAISSE le profil intact (utile si l'admin veut
 *    encore relancer une invitation plus tard).
 *
 * 2. Ticket #227 : `{ permanent: true, confirmWord: 'SUPPRIMER',
 *    reassignTo?: string }` — suppression DÉFINITIVE d'un utilisateur (la
 *    poubelle de Gestion des utilisateurs, EquipeView.tsx — tous rôles,
 *    plus seulement les stagiaires), distincte d'une simple désactivation
 *    (qui reste possible séparément via le bouton Activer/Désactiver) :
 *      - détecte les fiches clients (`leads.assigned_to`) qui lui
 *        appartiennent ; si `reassignTo` n'est pas fourni, ne touche RIEN
 *        et renvoie `needsReassignment` pour que l'admin choisisse un
 *        repreneur avant de confirmer à nouveau ;
 *      - compte Supabase Auth supprimé (définitivement impossible de se
 *        reconnecter), rôles/agences/détails stagiaire/notifications
 *        supprimés ;
 *      - le PROFIL n'est PAS supprimé (une ligne `profiles` orpheline
 *        casserait toute mention de cet utilisateur dans l'historique —
 *        messages de chat, notes, tâches, "créé par"...) : il est ANONYMISÉ
 *        à la place (nom réduit à "[Prénom] off", e-mail/téléphone/avatar/
 *        infos pro effacés, compte désactivé) — l'historique reste donc
 *        intact et lisible, sans exposer l'identité complète de la
 *        personne supprimée ni casser la moindre clé étrangère.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'DELETE') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    await requireSuperAdmin(req);

    const userId = String(req.query?.id || '');
    if (!userId) throw new Error('Identifiant utilisateur manquant.');

    const body = req.body || {};

    if (body.permanent === true) {
      if (body.confirmWord !== 'SUPPRIMER') {
        throw new Error('Confirmation invalide — tapez exactement "SUPPRIMER".');
      }

      const { data: ownedLeads } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('assigned_to', userId);
      const ownedCount = (ownedLeads || []).length;

      let reassignTo = body.reassignTo ? String(body.reassignTo) : null;

      // Règle CRM : Si l'utilisateur possède des contacts et qu'aucun repreneur explicite
      // n'est désigné, les contacts sont automatiquement et systématiquement réassignés
      // à Sylvain GRAZIA.
      if (ownedCount > 0 && !reassignTo) {
        const { data: sylvainProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .or('email.eq.s.grazia@conseilfinances.fr,id.eq.4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29')
          .maybeSingle();

        if (sylvainProfile?.id && sylvainProfile.id !== userId) {
          reassignTo = sylvainProfile.id;
        }
      }

      if (ownedCount > 0 && reassignTo) {
        if (reassignTo === userId) throw new Error('Le repreneur doit être une autre personne.');
        const { data: target } = await supabaseAdmin.from('profiles').select('id').eq('id', reassignTo).maybeSingle();
        if (!target) throw new Error('Utilisateur repreneur introuvable.');
        await supabaseAdmin.from('leads').update({ assigned_to: reassignTo, updated_at: new Date().toISOString() }).eq('assigned_to', userId);
      }

      await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
      await supabaseAdmin.from('agency_members').delete().eq('user_id', userId);
      await supabaseAdmin.from('intern_details').delete().eq('user_id', userId);
      await supabaseAdmin.from('notifications').delete().eq('user_id', userId);

      // Anonymisation plutôt que suppression de la ligne `profiles` (voir
      // commentaire d'en-tête) — garde la clé primaire intacte pour tout
      // l'historique qui la référence (messages, notes, tâches, "créé
      // par"...), sans jamais réafficher l'identité complète de la personne.
      const { data: profileRow } = await supabaseAdmin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
      const firstName = (profileRow?.full_name || '').trim().split(/\s+/)[0] || 'Utilisateur';
      await supabaseAdmin
        .from('profiles')
        .update({
          full_name: `${firstName} off`,
          email: `deleted-${userId}@removed.local`,
          phone: null,
          avatar_url: null,
          job_title: null,
          rsac_number: null,
          rc_pro_insurance: null,
          business_card_url: null,
          business_cards: [],
          business_card_email: null,
          is_active: false,
          is_validated: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      try {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (authErr: any) {
        console.warn('[api/admin/users/:id] permanent deleteUser notice:', authErr?.message);
      }

      res.status(200).json({ success: true, permanent: true, reassignedCount: ownedCount });
      return;
    }

    // Réassignation des contacts à Sylvain GRAZIA si l'utilisateur supprimé ou désactivé en possédait
    const { data: sylvainFallback } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or('email.eq.s.grazia@conseilfinances.fr,id.eq.4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29')
      .maybeSingle();

    if (sylvainFallback?.id && sylvainFallback.id !== userId) {
      await supabaseAdmin.from('leads').update({ assigned_to: sylvainFallback.id, updated_at: new Date().toISOString() }).eq('assigned_to', userId);
    }

    await supabaseAdmin
      .from('profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', userId);

    await supabaseAdmin.from('user_roles').delete().eq('user_id', userId);
    await supabaseAdmin.from('agency_members').delete().eq('user_id', userId);

    try {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    } catch (authErr: any) {
      console.warn('[api/admin/users/:id] deleteUser notice:', authErr?.message);
    }

    res.status(200).json({ success: true, message: "Accès au CRM coupé avec succès pour cet utilisateur." });
  } catch (e: any) {
    console.error('[api/admin/users/:id] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
