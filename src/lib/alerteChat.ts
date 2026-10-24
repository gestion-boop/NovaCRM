import { cibleDepuisLien } from '@/lib/lienNotification';

/** Un message de chat reçu, pas un rappel ni une annonce. */
const TYPES_MESSAGE = new Set([
  'message',
  'mention',
  'shared_message',
  'shared_chat_message',
  'client_message',
  'task_message',
]);

/** Au-delà, le message est déjà dans la cloche : on ne le réannonce pas.
 *  La marge négative absorbe une horloge un peu en retard sur le serveur. */
const FRAICHEUR_MS = 90_000;

export interface NotifLegere {
  id: string;
  type: string;
  created_at: string;
  title: string;
  body: string | null;
  link: string | null;
}

/**
 * Conversation réellement affichée. Le chat reste monté quand on est
 * ailleurs dans le CRM : sans ce garde-fou, le service worker croit qu'on
 * lit encore l'ancienne conversation et avale la bannière.
 */
export interface FilOuvert {
  chatVisible: boolean;
  onglet: string;
  conversationId: string | null;
}

let filCourant: FilOuvert = { chatVisible: false, onglet: 'conversations', conversationId: null };

/** Le chat prévient la cloche de ce qui est vraiment à l'écran. */
export function memoriserFilOuvert(etat: FilOuvert) {
  filCourant = etat;
}

export function filOuvert(): FilOuvert {
  return filCourant;
}

export function conversationASignaler(
  chatVisible: boolean,
  onglet: string,
  conversationId: string | null | undefined,
): string | null {
  if (!chatVisible || onglet !== 'conversations' || !conversationId) return null;
  return conversationId;
}

export function regardeDejaLeFil(
  chatVisible: boolean,
  onglet: string,
  conversationId: string | null | undefined,
  lien: string | null | undefined,
): boolean {
  const ouverte = conversationASignaler(chatVisible, onglet, conversationId);
  if (!ouverte) return false;
  return cibleDepuisLien(lien).conversationId === ouverte;
}

/**
 * Nouvelles notifications de chat à annoncer tout de suite.
 * `dejaVues === null` : premier chargement, on n'annonce pas l'historique.
 */
export function notifsChatAAnnoncer<T extends NotifLegere>(
  dejaVues: Set<string> | null,
  lignes: T[],
  maintenant: number,
): T[] {
  if (!dejaVues) return [];
  return lignes
    .filter((n) => {
      if (dejaVues.has(n.id) || !TYPES_MESSAGE.has(n.type)) return false;
      const age = maintenant - Date.parse(n.created_at);
      return Number.isFinite(age) && age > -120_000 && age < FRAICHEUR_MS;
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function texteAnnonce(fraiches: NotifLegere[]): { titre: string; description?: string; lien: string | null } | null {
  if (fraiches.length === 0) return null;
  const premiere = fraiches[0];
  const suite = fraiches.length > 1 ? ` (+${fraiches.length - 1})` : '';
  const description = `${premiere.body || ''}${suite}`.trim() || undefined;
  return { titre: premiere.title, description, lien: premiere.link };
}
