import { getAuthedUser, isSuperAdminUser, requireSuperAdmin, statusForError, supabaseAdmin } from '../_supabaseAdmin.js';
import { estPipelineTransactions } from '../../src/lib/pipelinesAcces.js';

/**
 * DELETE /api/admin/announcements?resource=pipeline&id=... — Ticket #231
 * (v3) : supprime réellement un pipeline commercial (clé service_role,
 * contourne les policies RLS qui bloquaient silencieusement la suppression
 * directe côté client pour certains pipelines/agences). Regroupé dans ce
 * fichier plutôt que dans une route dédiée /api/admin/pipelines/:id pour
 * respecter la limite de 12 fonctions serverless du plan Vercel Hobby
 * (même contrainte déjà documentée pour /api/admin/drive/[agencyId].ts).
 */
async function handleDeletePipeline(req: any, res: any) {
  // Demandé le 2 septembre : « je veux que les utilisateurs puissent
  // supprimer les pipelines, sauf les pipelines officiels ». La route était
  // réservée aux super admins ; elle s'ouvre aux membres de l'agence, mais
  // la règle est vérifiée ICI, côté serveur : un contrôle posé seulement
  // dans l'interface se contourne avec une simple requête.
  //
  // Précisé ensuite : « c'est LEUR pipeline qu'ils pourront modifier
  // uniquement », et « je veux pouvoir verrouiller des pipelines ». Un membre
  // ne peut donc supprimer qu'un pipeline qu'il a CRÉÉ (owner_id), qui n'est
  // ni verrouillé (locked) ni officiel (is_default). Tout le reste reste
  // réservé aux super admins, avec la règle déjà en place du dernier pipeline
  // non supprimable.
  const user = await getAuthedUser(req);
  const estSuperAdmin = await isSuperAdminUser(user);

  const pipelineId = String(req.query?.id || '');
  if (!pipelineId) throw new Error('Identifiant de pipeline manquant.');

  const { data: pipeline, error: pipeErr } = await supabaseAdmin
    .from('pipelines')
    .select('id, agency_id, name, is_default, locked, owner_id')
    .eq('id', pipelineId)
    .maybeSingle();
  if (pipeErr) throw pipeErr;
  if (!pipeline) throw new Error('Pipeline introuvable.');

  const fiche = pipeline as { name: string; agency_id: string; is_default: boolean; locked?: boolean; owner_id?: string | null };
  if (estPipelineTransactions({ id: pipelineId, name: fiche.name, agencyId: fiche.agency_id })) {
    throw new Error(`« ${fiche.name} » est le pipeline Transactions d'Immosphera : personne ne peut le supprimer.`);
  }

  if (!estSuperAdmin) {
    const p = pipeline as { name: string; agency_id: string; is_default: boolean; locked?: boolean; owner_id?: string | null };
    if (p.is_default) {
      throw new Error(
        `« ${p.name} » est le pipeline officiel de la société : sa suppression est réservée aux super admins.`
      );
    }
    if (p.locked) {
      throw new Error(`« ${p.name} » est verrouillé : sa suppression est réservée aux super admins.`);
    }
    if (!p.owner_id || p.owner_id !== user.id) {
      throw new Error(
        `Suppression refusée : « ${p.name} » n'a pas été créé par vous. Chacun ne peut supprimer que ses propres pipelines.`
      );
    }
    const { data: appartenance, error: membreErr } = await supabaseAdmin
      .from('agency_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('agency_id', p.agency_id)
      .maybeSingle();
    if (membreErr) throw membreErr;
    if (!appartenance) {
      throw new Error("Suppression refusée : ce pipeline appartient à une société dont vous n'êtes pas membre.");
    }
  }

  const { data: siblings, error: siblingsErr } = await supabaseAdmin
    .from('pipelines')
    .select('id')
    .eq('agency_id', pipeline.agency_id);
  if (siblingsErr) throw siblingsErr;
  if (!siblings || siblings.length <= 1) {
    throw new Error('Il faut conserver au moins un pipeline pour cette société.');
  }

  // Les contacts restent des fiches : on retire le pipeline et la colonne
  // AVANT de supprimer, pour qu'un ON DELETE CASCADE ne les emporte pas.
  const maintenant = new Date().toISOString();
  const { error: detachErr } = await supabaseAdmin
    .from('leads')
    .update({ pipeline_id: null, stage_id: null, updated_at: maintenant })
    .eq('pipeline_id', pipelineId);
  if (detachErr) {
    throw new Error(
      `Impossible de laisser les contacts dans la fiche sans pipeline. ${detachErr.message || ''} Appliquez la migration 20261022120000.`
    );
  }

  const { data: etapes } = await supabaseAdmin
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId);
  const idsEtapes = (etapes || []).map((e: { id: string }) => e.id);
  if (idsEtapes.length > 0) {
    const { error: detachEtapeErr } = await supabaseAdmin
      .from('leads')
      .update({ pipeline_id: null, stage_id: null, updated_at: maintenant })
      .in('stage_id', idsEtapes);
    if (detachEtapeErr) throw detachEtapeErr;
  }

  const { error: stagesDeleteErr } = await supabaseAdmin
    .from('pipeline_stages')
    .delete()
    .eq('pipeline_id', pipelineId);
  if (stagesDeleteErr) throw stagesDeleteErr;

  const { data: deleted, error: deleteErr } = await supabaseAdmin
    .from('pipelines')
    .delete()
    .eq('id', pipelineId)
    .select();
  if (deleteErr) throw deleteErr;
  if (!deleted || deleted.length === 0) {
    throw new Error('La suppression a échoué côté base de données.');
  }

  res.status(200).json({ ok: true });
}

/**
 * POST /api/admin/announcements — publie une annonce, optionnellement
 * restreinte à certaines agences ou à une seule personne. Porte de l'ancien
 * `app.post('/api/admin/announcements', ...)` de server.ts.
 *
 * Ticket "Paramètres/Nova/Utilisateurs/Annonces" (16/16) : système à 3
 * niveaux (info/important/urgent), lien direct vers un élément du CRM,
 * expiration automatique, ciblage étendu à une personne précise (en plus
 * des sociétés déjà gérées via announcement_agencies).
 */
export default async function handler(req: any, res: any) {
  if (req.method === 'DELETE' && req.query?.resource === 'pipeline') {
    try {
      await handleDeletePipeline(req, res);
    } catch (e: any) {
      console.error('[api/admin/announcements] delete pipeline error:', e);
      res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    const admin = await requireSuperAdmin(req);

    const message = String(req.body?.message || '').trim();
    const agencyIds: string[] = Array.isArray(req.body?.agencyIds) ? req.body.agencyIds : [];
    // Ticket #241 : 5 niveaux (info/a_verifier/important/succes/veille) —
    // l'ancien "urgent" a été retiré et remappé sur "important" par la
    // migration SQL du même ticket.
    const level = ['info', 'a_verifier', 'important', 'succes', 'veille', 'reponse_demandee', 'signature_compromis', 'signature_acte'].includes(req.body?.level) ? req.body.level : 'info';
    const link = req.body?.link ? String(req.body.link).trim() : null;
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt).toISOString() : null;
    const targetUserId = req.body?.targetUserId ? String(req.body.targetUserId) : null;
    if (!message) throw new Error('Annonce vide.');

    // Demande explicite : "possibilité de créer un sondage avec possibilité
    // de rajouter des choix" — au moins 2 options non vides pour que ce
    // soit un sondage exploitable, sinon on ignore silencieusement (annonce
    // normale, pas d'erreur bloquante pour une saisie incomplète).
    const rawPollOptions: unknown[] = Array.isArray(req.body?.pollOptions) ? req.body.pollOptions : [];
    const pollOptions = rawPollOptions
      .map((o) => String(o || '').trim())
      .filter(Boolean)
      .slice(0, 12);
    const isPoll = pollOptions.length >= 2;

    const { data: rows, error } = await supabaseAdmin
      .from('announcements')
      .insert({
        message,
        is_active: true,
        created_by: admin.id,
        level,
        link,
        expires_at: expiresAt,
        target_user_id: targetUserId,
        is_poll: isPoll,
      })
      .select('*')
      .limit(1);
    if (error) throw error;

    const announcement = rows?.[0];
    if (announcement && agencyIds.length) {
      await supabaseAdmin
        .from('announcement_agencies')
        .insert(agencyIds.map((agency_id) => ({ announcement_id: announcement.id, agency_id })));
    }
    if (announcement && isPoll) {
      await supabaseAdmin
        .from('announcement_poll_options')
        .insert(pollOptions.map((label, sort_order) => ({ announcement_id: announcement.id, label, sort_order })));
    }

    res.status(200).json({ success: true, announcement });
  } catch (e: any) {
    console.error('[api/admin/announcements] error:', e);
    res.status(statusForError(e?.message || '')).json({ error: e?.message || 'Erreur inconnue.' });
  }
}
