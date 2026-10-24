import { describe, expect, it } from 'vitest';
import { conversationASignaler, notifsChatAAnnoncer, regardeDejaLeFil, texteAnnonce, type NotifLegere } from './alerteChat';

const CONV = '22222222-2222-4222-8222-222222222222';

const ligne = (partiel: Partial<NotifLegere> & Pick<NotifLegere, 'id'>): NotifLegere => ({
  type: 'message',
  created_at: '2026-10-21T19:00:00.000Z',
  title: 'Paul',
  body: 'Bonjour',
  link: `/messagerie?conversation=${CONV}&message=11111111-1111-4111-8111-111111111111`,
  ...partiel,
});

describe('conversation signalée au service worker', () => {
  it('ne signale la conversation que si le chat est vraiment à l’écran', () => {
    expect(conversationASignaler(true, 'conversations', CONV)).toBe(CONV);
    expect(conversationASignaler(false, 'conversations', CONV)).toBeNull();
    expect(conversationASignaler(true, 'projets', CONV)).toBeNull();
    expect(conversationASignaler(true, 'conversations', null)).toBeNull();
  });

  it('ne considère pas le fil comme lu quand on est revenu à l’accueil', () => {
    const lien = `/messagerie?conversation=${CONV}&message=11111111-1111-4111-8111-111111111111`;
    expect(regardeDejaLeFil(true, 'conversations', CONV, lien)).toBe(true);
    expect(regardeDejaLeFil(false, 'conversations', CONV, lien)).toBe(false);
  });
});

describe('annonce immédiate d’un chat reçu', () => {
  const maintenant = Date.parse('2026-10-21T19:00:05.000Z');

  it('n’annonce pas l’historique au premier chargement', () => {
    expect(notifsChatAAnnoncer(null, [ligne({ id: 'a' })], maintenant)).toEqual([]);
  });

  it('annonce un message tout juste arrivé, pas un ancien ni un rappel', () => {
    const frais = ligne({ id: 'frais' });
    const dejaVu = ligne({ id: 'vu' });
    const ancien = ligne({ id: 'ancien', created_at: '2026-10-21T18:00:00.000Z' });
    const rappel = ligne({ id: 'rappel', type: 'task_assigned' });
    const resultat = notifsChatAAnnoncer(new Set(['vu']), [dejaVu, ancien, rappel, frais], maintenant);
    expect(resultat.map((n) => n.id)).toEqual(['frais']);
  });

  it('résume plusieurs messages dans une seule annonce', () => {
    const annonce = texteAnnonce([
      ligne({ id: 'b', title: 'Léa', body: 'On se voit ?', created_at: '2026-10-21T19:00:04.000Z' }),
      ligne({ id: 'a', title: 'Paul', body: 'Bonjour' }),
    ]);
    expect(annonce).toEqual({
      titre: 'Léa',
      description: 'On se voit ? (+1)',
      lien: ligne({ id: 'b' }).link,
    });
  });
});
