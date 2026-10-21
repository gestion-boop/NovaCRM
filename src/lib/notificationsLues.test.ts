import { describe, expect, it } from 'vitest';
import { empreintesNotification, notificationsDisparues } from './notificationsLues';

describe('notifications lues sur un autre appareil', () => {
  it('retrouve la bannière d’un message et celle d’un ticket', () => {
    expect(empreintesNotification({
      id: 'notif-1',
      type: 'message',
      entity_type: 'chat_message',
      entity_id: 'msg-1',
    })).toEqual(['message-notif-1', 'msg-msg-1']);

    expect(empreintesNotification({
      id: 'notif-2',
      type: 'support_ticket_message',
      entity_type: 'support_ticket',
      entity_id: 'ticket-1',
    })).toEqual(['support_ticket_message-notif-2']);
  });

  it('ne signale une disparition qu’après un premier chargement', () => {
    const lue = { id: 'a' };
    const reste = { id: 'b' };
    expect(notificationsDisparues(null, [reste])).toEqual([]);
    expect(notificationsDisparues([lue, reste], [reste])).toEqual([lue]);
  });
});
