import { describe, expect, it } from 'vitest';
import {
  estAgenceImmosphera,
  estBlocNotes,
  estDossierImmosphera,
  retirerDoublonsNotes,
} from './tuilesAccueilVisibles';

describe('tuiles d’accueil selon l’agence', () => {
  it('reconnaît le dossier Immosphera, pas les autres tuiles du même nom long', () => {
    expect(estDossierImmosphera('Immosphera')).toBe(true);
    expect(estDossierImmosphera('ImmoSphera')).toBe(true);
    expect(estDossierImmosphera('Immosphera 360')).toBe(false);
    expect(estDossierImmosphera('Banques')).toBe(false);
    expect(estAgenceImmosphera({ name: 'Novavisio' })).toBe(false);
    expect(estAgenceImmosphera({ name: 'Conseils Finances' })).toBe(false);
    expect(estAgenceImmosphera({ name: 'Immosphera' })).toBe(true);
  });

  it('ne garde qu’un seul bloc notes', () => {
    const grille = retirerDoublonsNotes([
      { id: 'notes', title: 'Bloc-notes', navTarget: 'notes' },
      { id: 'custom-blocs', title: 'Blocs - Notes', isFolder: true, children: [{ id: 'dedans', title: 'Suite' }] },
      { id: 'annonce', title: 'Annonce', navTarget: 'parametres' },
    ]);
    expect(grille.map((t) => t.id)).toEqual(['custom-blocs', 'annonce']);
    expect(estBlocNotes({ id: 'autre', title: 'Blocs - Notes' })).toBe(true);
    expect(estBlocNotes({ id: 'autre', title: 'Blocs — Notes' })).toBe(true);
    expect(estBlocNotes({ id: 'autre', title: 'Annonce' })).toBe(false);
  });

  it('garde le dossier verrouillé et les notes rangées dans un autre dossier', () => {
    const grille = retirerDoublonsNotes([
      { id: 'notes', title: 'Bloc-notes', navTarget: 'notes' },
      { id: 'custom-blocs', title: 'Blocs - Notes', isFolder: true, locked: true, children: [{ id: 'dedans', title: 'Suite' }] },
      {
        id: 'comm',
        title: 'Communication',
        isFolder: true,
        children: [{ id: 'notes-dedans', title: 'Bloc-notes', navTarget: 'notes' }],
      },
    ]);
    expect(grille.map((t) => t.id)).toEqual(['custom-blocs', 'comm']);
    expect(grille.find((t) => t.id === 'comm')?.children?.map((t) => t.id)).toEqual(['notes-dedans']);
  });
});
