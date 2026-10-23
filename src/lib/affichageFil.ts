/**
 * Décisions pures pour l'affichage du fil de discussion.
 * Le composant reste responsable du réseau ; ici on ne fait que choisir
 * comment peindre et comment défiler, pour que ce soit testable sans DOM.
 */

export interface LigneDirecte {
  id: string;
  conversation_id: string | null;
  user_id: string;
  kind: 'text' | 'image' | 'voice' | 'video' | 'file';
  body: string | null;
  attachment_url: string | null;
  attachment_mime: string | null;
  attachment_duration: number | null;
  edited_at: string | null;
  created_at: string;
}

export interface LigneCanal {
  id: string;
  channel: string;
  data: {
    body?: string;
    sender_id?: string;
    sender_name?: string;
    created_at?: string;
    kind?: 'text' | 'image' | 'voice' | 'file';
    attachmentUrl?: string;
    attachmentMime?: string;
    attachmentDuration?: number;
  };
  created_at: string;
  sender_id?: string | null;
  is_deleted?: boolean;
  read_by?: { userId: string; userName?: string; readAt?: string }[];
  reactions?: { userId: string; emoji: string }[];
}

const GENRES_DIRECTS = new Set(['text', 'image', 'voice', 'video', 'file']);

/** Transforme la ligne livrée par le temps réel en message affichable. */
export function ligneDirecteDepuisTempsReel(brut: unknown): LigneDirecte | null {
  if (!brut || typeof brut !== 'object') return null;
  const row = brut as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.created_at !== 'string') return null;
  const kind = typeof row.kind === 'string' && GENRES_DIRECTS.has(row.kind) ? row.kind : 'text';
  return {
    id: row.id,
    conversation_id: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    user_id: typeof row.user_id === 'string' ? row.user_id : '',
    kind: kind as LigneDirecte['kind'],
    body: typeof row.body === 'string' ? row.body : null,
    attachment_url: typeof row.attachment_url === 'string' ? row.attachment_url : null,
    attachment_mime: typeof row.attachment_mime === 'string' ? row.attachment_mime : null,
    attachment_duration: typeof row.attachment_duration === 'number' ? row.attachment_duration : null,
    edited_at: typeof row.edited_at === 'string' ? row.edited_at : null,
    created_at: row.created_at,
  };
}

/** Même chose pour un message de canal (`chat_messages`). */
export function ligneCanalDepuisTempsReel(brut: unknown): LigneCanal | null {
  if (!brut || typeof brut !== 'object') return null;
  const row = brut as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.channel !== 'string' || typeof row.created_at !== 'string') return null;
  const data = row.data && typeof row.data === 'object' ? (row.data as LigneCanal['data']) : {};
  return {
    id: row.id,
    channel: row.channel,
    data,
    created_at: row.created_at,
    sender_id: typeof row.sender_id === 'string' ? row.sender_id : null,
    is_deleted: row.is_deleted === true,
    read_by: Array.isArray(row.read_by) ? (row.read_by as LigneCanal['read_by']) : [],
    reactions: Array.isArray(row.reactions) ? (row.reactions as LigneCanal['reactions']) : [],
  };
}

/**
 * Ajoute ou remplace un message dans le lot déjà connu.
 * Un écho provisoire (`optimistic-…`) disparaît dès que la ligne réelle
 * du même auteur et du même texte est arrivée, pour ne pas l'afficher deux fois.
 */
export function fusionnerMessage<T extends { id: string; created_at: string; user_id?: string; kind?: string; body?: string | null }>(
  existants: T[],
  entrant: T,
): T[] {
  const parId = new Map(existants.map((m) => [m.id, m]));
  parId.set(entrant.id, entrant);
  if (!entrant.id.startsWith('optimistic-')) {
    for (const [id, echo] of parId) {
      if (!id.startsWith('optimistic-')) continue;
      const memeAuteur = (echo.user_id ?? '') === (entrant.user_id ?? '');
      const memeTexte = (echo.body ?? '') === (entrant.body ?? '');
      const memeGenre = (echo.kind ?? 'text') === (entrant.kind ?? 'text');
      if (memeAuteur && memeTexte && memeGenre) parId.delete(id);
    }
  }
  return Array.from(parId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Comment amener le fil vers le dernier message.
 * - changement de conversation ou de canal : saut immédiat
 * - un ou deux messages, et le lecteur est déjà en bas : défilement fluide
 * - lot entier alors qu'on est en bas (ouverture) : saut immédiat
 * - le lecteur lit l'historique : on ne bouge pas
 */
export function comportementDefilementFil(opts: {
  changementDeFil: boolean;
  messagesAjoutes: number;
  distanceDuBas: number;
}): ScrollBehavior | null {
  if (opts.changementDeFil) return 'auto';
  if (opts.messagesAjoutes <= 0) return null;
  if (opts.distanceDuBas > 160) return null;
  return opts.messagesAjoutes > 2 ? 'auto' : 'smooth';
}
