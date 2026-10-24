import { describe, expect, it } from 'vitest';
import {
  comportementDefilementFil,
  fusionnerMessage,
  ligneCanalDepuisTempsReel,
  ligneDirecteDepuisTempsReel,
} from './affichageFil';

describe('ligne reçue en temps réel', () => {
  it('ignore un payload incomplet', () => {
    expect(ligneDirecteDepuisTempsReel(null)).toBeNull();
    expect(ligneDirecteDepuisTempsReel({ id: 'a' })).toBeNull();
    expect(ligneCanalDepuisTempsReel({ id: 'a', created_at: '2026-10-23T08:00:00.000Z' })).toBeNull();
  });

  it('peint une ligne de conversation dès qu’elle a un id et une date', () => {
    expect(ligneDirecteDepuisTempsReel({
      id: 'm1',
      conversation_id: 'c1',
      user_id: 'u1',
      kind: 'text',
      body: 'Bonjour',
      created_at: '2026-10-23T08:00:00.000Z',
    })).toMatchObject({ id: 'm1', body: 'Bonjour', kind: 'text' });
  });

  it('peint une ligne de canal avec son texte', () => {
    expect(ligneCanalDepuisTempsReel({
      id: 'm2',
      channel: 'ch1',
      created_at: '2026-10-23T08:00:00.000Z',
      sender_id: 'u1',
      data: { body: 'Salut' },
    })).toMatchObject({ id: 'm2', channel: 'ch1', data: { body: 'Salut' } });
  });
});

describe('fusion d’un message dans le fil', () => {
  const deja = {
    id: 'optimistic-1',
    created_at: '2026-10-23T08:00:00.000Z',
    user_id: 'u1',
    kind: 'text',
    body: 'Bonjour',
  };

  it('remplace l’écho provisoire par la ligne réelle', () => {
    const fusion = fusionnerMessage([deja], {
      id: 'reel',
      created_at: '2026-10-23T08:00:01.000Z',
      user_id: 'u1',
      kind: 'text',
      body: 'Bonjour',
    });
    expect(fusion.map((m) => m.id)).toEqual(['reel']);
  });

  it('ne duplique pas un message déjà affiché', () => {
    const reel = { id: 'reel', created_at: '2026-10-23T08:00:01.000Z', user_id: 'u1', body: 'Bonjour' };
    expect(fusionnerMessage([reel], { ...reel, body: 'Bonjour' })).toHaveLength(1);
  });
});

describe('défilement du fil', () => {
  it('saute tout de suite quand on ouvre un fil', () => {
    expect(comportementDefilementFil({
      changementDeFil: true,
      messagesAjoutes: 60,
      distanceDuBas: 900,
    })).toBe('auto');
  });

  it('glisse seulement pour un nouveau message quand on est déjà en bas', () => {
    expect(comportementDefilementFil({
      changementDeFil: false,
      messagesAjoutes: 1,
      distanceDuBas: 40,
    })).toBe('smooth');
  });

  it('ne dérange pas quelqu’un qui lit l’historique', () => {
    expect(comportementDefilementFil({
      changementDeFil: false,
      messagesAjoutes: 1,
      distanceDuBas: 400,
    })).toBeNull();
    expect(comportementDefilementFil({
      changementDeFil: false,
      messagesAjoutes: 60,
      distanceDuBas: 800,
    })).toBeNull();
  });

  it('saute un lot entier plutôt que de le faire défiler', () => {
    expect(comportementDefilementFil({
      changementDeFil: false,
      messagesAjoutes: 60,
      distanceDuBas: 0,
    })).toBe('auto');
  });
});
