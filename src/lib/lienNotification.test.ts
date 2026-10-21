import { describe, expect, it } from 'vitest';
import { cibleDepuisLien } from './lienNotification';

const MESSAGE = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const CANAL = '33333333-3333-4333-8333-333333333333';

describe('cible d’une notification de message', () => {
  it('lit la conversation et le message des notifications récentes', () => {
    expect(cibleDepuisLien(`/messagerie?conversation=${CONVERSATION}&message=${MESSAGE}`)).toEqual({
      messageId: MESSAGE,
      conversationId: CONVERSATION,
      channelId: undefined,
    });
  });

  it('lit les anciens liens highlight et les canaux', () => {
    expect(cibleDepuisLien(`/messagerie?highlight=${MESSAGE}`).messageId).toBe(MESSAGE);
    expect(cibleDepuisLien(`/messagerie?channel=${CANAL}&message=${MESSAGE}`)).toMatchObject({
      messageId: MESSAGE,
      channelId: CANAL,
    });
    expect(cibleDepuisLien(`/projets-internes?task=${CANAL}&highlight=${MESSAGE}`).messageId).toBe(MESSAGE);
  });

  it('ignore un lien sans cible', () => {
    expect(cibleDepuisLien('/messagerie')).toEqual({});
    expect(cibleDepuisLien(null)).toEqual({});
    expect(cibleDepuisLien('/messagerie?message=pas-un-uuid')).toEqual({});
  });
});
