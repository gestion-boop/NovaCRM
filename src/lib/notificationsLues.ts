import { clearMatchingPushNotifications } from '@/lib/push';

export interface NotifEmpreinte {
  id: string;
  type: string;
  link?: string | null;
  entity_id?: string | null;
  entity_type?: string | null;
}

const TYPES_MESSAGE = new Set([
  'message',
  'chat_message',
  'mention',
  'shared_message',
  'shared_chat_message',
  'client_message',
  'task_message',
]);

/**
 * Étiquettes possibles de la bannière système pour cette ligne.
 * Le push de chat est étiqueté `msg-<message>`, celui de create_notification
 * `<type>-<id de la ligne>`.
 */
export function empreintesNotification(n: NotifEmpreinte): string[] {
  const tags = [`${n.type}-${n.id}`];
  const message = n.entity_type === 'message' || n.entity_type === 'chat_message' || TYPES_MESSAGE.has(n.type);
  if (n.entity_id && message) tags.push(`msg-${n.entity_id}`);
  return tags;
}

/** Lignes présentes avant et absentes maintenant : lues ou retirées ailleurs. */
export function notificationsDisparues<T extends { id: string }>(avant: T[] | null, apres: T[]): T[] {
  if (!avant) return [];
  const restantes = new Set(apres.map((n) => n.id));
  return avant.filter((n) => !restantes.has(n.id));
}

/** Ferme les bannières de cet appareil qui correspondent à ces lignes. */
export function fermerNotificationsSysteme(lignes: NotifEmpreinte[]) {
  const tags = Array.from(new Set(lignes.flatMap(empreintesNotification)));
  if (tags.length === 0) return;
  clearMatchingPushNotifications({ tags });
}
