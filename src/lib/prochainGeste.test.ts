import { describe, expect, it } from 'vitest';
import { prochainRendezVous, texteProchainGeste, type RendezVousProchain } from './prochainGeste';

const maintenant = new Date(2026, 9, 23, 9, 0);

const martin: RendezVousProchain = {
  debut: new Date(2026, 9, 23, 14, 30),
  titre: 'Martin',
  journeeEntiere: false,
};

describe('prochain rendez-vous', () => {
  it('prend le premier rendez-vous du jour et ignore demain', () => {
    const choisi = prochainRendezVous([
      { summary: 'Demain', start: { dateTime: '2026-10-24T09:00:00' } },
      { summary: 'Martin', start: { dateTime: '2026-10-23T14:30:00' } },
    ], maintenant);
    expect(choisi?.titre).toBe('Martin');
    expect(choisi?.journeeEntiere).toBe(false);
  });

  it('reconnaît une journée entière sans la décaler de fuseau', () => {
    const choisi = prochainRendezVous([
      { summary: 'Salon', start: { date: '2026-10-23' } },
    ], maintenant);
    expect(choisi?.journeeEntiere).toBe(true);
    expect(choisi?.debut.getDate()).toBe(23);
  });

  it('laisse une journée entière derrière un rendez-vous à heure fixe', () => {
    const choisi = prochainRendezVous([
      { summary: 'Salon', start: { date: '2026-10-23' } },
      { summary: 'Martin', start: { dateTime: '2026-10-23T14:30:00' } },
    ], maintenant);
    expect(choisi?.titre).toBe('Martin');
  });
});

describe('phrase sous les priorités', () => {
  const vide = { maintenant, messagesNonLus: 0, mailsNonLus: 0, rappelsDuJour: 0 };

  it('annonce l’heure et le nom du rendez-vous', () => {
    expect(texteProchainGeste({ ...vide, rendezVous: martin })).toEqual({
      texte: '14 h 30 · Martin',
      nav: 'agenda',
    });
  });

  it('laisse le rendez-vous passer devant les messages', () => {
    expect(texteProchainGeste({
      ...vide,
      rendezVous: martin,
      messagesNonLus: 4,
    })?.nav).toBe('agenda');
  });

  it('dit les messages, puis les mails, puis les rappels', () => {
    expect(texteProchainGeste({ ...vide, rendezVous: null, messagesNonLus: 2 })?.texte).toBe('2 messages sans réponse');
    expect(texteProchainGeste({ ...vide, rendezVous: null, messagesNonLus: 1 })?.texte).toBe('1 message sans réponse');
    expect(texteProchainGeste({ ...vide, rendezVous: null, mailsNonLus: 1 })?.nav).toBe('mail-unread');
    expect(texteProchainGeste({ ...vide, rendezVous: null, rappelsDuJour: 3 })?.texte).toBe('3 rappels à traiter');
  });

  it('n’affiche rien quand la journée est calme', () => {
    expect(texteProchainGeste({ ...vide, rendezVous: null })).toBeNull();
  });
});
