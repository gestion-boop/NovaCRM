export interface CibleMessage {
  messageId?: string;
  conversationId?: string;
  channelId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lireUuid(valeur: string | null): string | undefined {
  if (!valeur || !UUID.test(valeur)) return undefined;
  return valeur;
}

/**
 * Cible d'une notification de message. Les liens historiques n'utilisent pas
 * tous le même paramètre : `highlight`, `message`, ou `highlight_message`.
 */
export function cibleDepuisLien(lien: string | null | undefined): CibleMessage {
  if (!lien) return {};
  const query = lien.includes('?') ? lien.slice(lien.indexOf('?') + 1) : '';
  if (!query) return {};
  const params = new URLSearchParams(query);
  return {
    messageId: lireUuid(params.get('highlight') || params.get('highlight_message') || params.get('message')),
    conversationId: lireUuid(params.get('conversation')),
    channelId: lireUuid(params.get('channel')),
  };
}
