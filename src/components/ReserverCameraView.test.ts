import { describe, expect, it } from 'vitest';
import { mandatLisible, texteLisible } from './ReserverCameraView';

describe('lecture des cartes de réservation', () => {
  it('calme un lieu écrit en majuscules', () => {
    expect(texteLisible('CAMPING FIGUROTTA à BIZANET')).toBe('Camping Figurotta à Bizanet');
  });

  it('laisse un nom déjà lisible tel quel', () => {
    expect(texteLisible('Caméra DJI')).toBe('Caméra DJI');
  });

  it('ignore un mandat vide ou réduit à un point', () => {
    expect(mandatLisible('.')).toBe('');
    expect(mandatLisible('  ')).toBe('');
    expect(mandatLisible('257')).toBe('257');
  });
});
