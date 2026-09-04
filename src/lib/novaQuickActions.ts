import { supabase } from '@/lib/supabase';

// Action « créer une note » de Nova, partagée entre AssistantIAView.tsx (le
// chat complet) et NovaSearchBar.tsx (barre Nova d'Immosphera 360) — pour
// que « crée une note sur ce client » se comporte EXACTEMENT pareil des
// deux côtés, sans deux implémentations qui finissent par diverger.
//
// create_task/create_contact ne sont volontairement PAS ici : leur écriture
// réelle vit dans useTasks()/useContacts() (résolution d'agence/utilisateur
// en UUID, règles par agence pour les contacts...) — des hooks React, déjà
// appelables tels quels depuis n'importe quel composant (NovaSearchBar.tsx
// les appelle directement, voir ce fichier). Les dupliquer ici aurait
// recréé exactement le risque de divergence qu'on cherche à éviter.
export interface NovaNoteResult {
  success: boolean;
  title: string;
  details: string;
  contactId?: string;
  error?: string;
}

/**
 * Enregistre une note dictée/écrite à Nova.
 *
 * Une note liée à un client déjà identifié (matchedContactId, résolu par
 * l'appelant parmi les contacts connus — jamais un id halluciné) va dans
 * `comments` (visible sur sa fiche) ; sinon dans le Bloc-notes général
 * (`notes`), sans lien client.
 */
export async function creerNote(params: {
  userId: string | undefined;
  agencyId: string;
  title?: string;
  content: string;
  matchedContactId?: string;
  matchedContactName?: string;
  /** Nom du client cité par l'utilisateur si aucun contact n'a été retrouvé. */
  contactName?: string;
}): Promise<NovaNoteResult> {
  const title = params.title?.trim() || 'Note de suivi';
  const content = params.content?.trim() || '';

  if (params.matchedContactId) {
    const body = title !== 'Note de suivi' ? `**${title}**\n${content}` : content;
    const { error } = await supabase.from('comments').insert({
      lead_id: params.matchedContactId,
      body,
      user_id: params.userId,
    });
    if (error) return { success: false, title, details: '', error: error.message };
    return {
      success: true,
      title: `Note enregistrée : ${title}`,
      details: `Liée au client ${params.matchedContactName || ''} • ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`,
      contactId: params.matchedContactId,
    };
  }

  const body = params.contactName ? `Client : ${params.contactName}\n\n${content}` : content;
  const { error } = await supabase.from('notes').insert({
    agency_id: params.agencyId,
    user_id: params.userId,
    title,
    body,
  });
  if (error) return { success: false, title, details: '', error: error.message };
  return {
    success: true,
    title: `Note enregistrée : ${title}`,
    details: `${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`,
  };
}
