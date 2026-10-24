import { describe, expect, it } from 'vitest';
import { extrait, fusionnerResultats, resultatCartePipeline, resultatMessage } from './rechercheGlobale';

describe('résultats de recherche', () => {
  it('présente une carte de pipeline avec son étape et ouvre la fiche', () => {
    const carte = resultatCartePipeline({
      id: 'lead-1',
      nom: 'Martin',
      etape: 'Compromis',
      contactId: 'contact-9',
    });
    expect(carte.type).toBe('pipeline');
    expect(carte.titre).toBe('Martin');
    expect(carte.sousTitre).toBe('Compromis');
    expect(carte.action).toEqual({ genre: 'client', contactId: 'contact-9' });
  });

  it('raccourcit un message et retient son identifiant', () => {
    const message = resultatMessage({
      id: 'msg-1',
      texte: 'Bonjour Martin, le compromis est prêt pour demain matin au cabinet',
      lieu: 'Équipe',
      quand: 'ven. 23 oct.',
    });
    expect(message.type).toBe('message');
    expect(message.titre).toContain('compromis');
    expect(message.sousTitre).toBe('Équipe · ven. 23 oct.');
    expect(message.action).toEqual({ genre: 'message', messageId: 'msg-1' });
  });

  it('coupe un extrait long', () => {
    expect(extrait('a'.repeat(90), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('fusionne sans doublon et s’arrête au maximum', () => {
    const carte = resultatCartePipeline({ id: '1', nom: 'Martin', contactId: '1' });
    const fusion = fusionnerResultats([[carte, carte], [resultatCartePipeline({ id: '2', nom: 'Sophie', contactId: '2' })]], 1);
    expect(fusion).toHaveLength(1);
    expect(fusion[0].titre).toBe('Martin');
  });
});
