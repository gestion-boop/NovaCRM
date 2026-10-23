import { describe, expect, it } from 'vitest';
import { ajouterDevant, contactProvisoire, majParId, remplacerParId, retirerParId } from './peintureImmediate';

describe('peinture immédiate', () => {
  it('déplace une carte sans attendre', () => {
    const cartes = majParId(
      [{ id: 'a', stage: 'Contact' }, { id: 'b', stage: 'Contact' }],
      'a',
      { stage: 'Compromis' },
    );
    expect(cartes?.map((carte) => carte.stage)).toEqual(['Compromis', 'Contact']);
  });

  it('coche un rappel et le retire de la liste', () => {
    const coches = majParId(
      [{ id: 'r1', completed: false }, { id: 'r2', completed: false }],
      'r1',
      { completed: true },
    );
    expect(coches?.[0].completed).toBe(true);
    expect(retirerParId(coches, 'r1')).toEqual([{ id: 'r2', completed: false }]);
  });

  it('pose le nouveau lead en tête, puis le remplace par la fiche réelle', () => {
    const provisoire = contactProvisoire({ name: 'Martin', agencyId: 'agence' }, 'optimistic-1');
    const liste = ajouterDevant([contactProvisoire({ name: 'Déjà là' }, 'ancien')], provisoire);
    expect(liste[0].name).toBe('Martin');
    const remplace = remplacerParId(liste, 'optimistic-1', { ...provisoire, id: 'vrai' });
    expect(remplace?.map((item) => item.id)).toEqual(['vrai', 'ancien']);
  });
});
