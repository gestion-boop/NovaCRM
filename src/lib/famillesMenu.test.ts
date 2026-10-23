import { describe, expect, it } from 'vitest';
import { familleMenu, grouperMenu, ordonnerParFamille } from './famillesMenu';

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('familles du menu', () => {
  it('laisse Accueil hors famille et range le reste', () => {
    expect(familleMenu('accueil')).toBeNull();
    expect(familleMenu('pipeline')).toBe('activite');
    expect(familleMenu('mail')).toBe('echanges');
    expect(familleMenu('notes')).toBe('echanges');
    expect(familleMenu('comptabilite')).toBe('agence');
  });

  it('regroupe sans perdre l’ordre déjà choisi dans une famille', () => {
    const groupe = grouperMenu([
      { id: 'accueil' },
      { id: 'mail' },
      { id: 'clients' },
      { id: 'documents' },
      { id: 'chat' },
      { id: 'pipeline' },
      { id: 'notes' },
    ]);

    expect(groupe.accueil?.id).toBe('accueil');
    expect(ids(groupe.familles[0].items)).toEqual(['clients', 'pipeline']);
    expect(groupe.familles[0].titre).toBe('Activité');
    expect(ids(groupe.familles[1].items)).toEqual(['mail', 'chat', 'notes']);
    expect(groupe.familles[1].titre).toBe('Échanges');
    expect(ids(groupe.familles[2].items)).toEqual(['documents']);
  });

  it('omet une famille vide', () => {
    const groupe = grouperMenu([{ id: 'clients' }, { id: 'agenda' }]);
    expect(groupe.familles.map((famille) => famille.id)).toEqual(['activite']);
  });

  it('réordonne une liste d’onglets pour l’affichage', () => {
    const ordre = ordonnerParFamille(
      [
        ['Notes', 'notes'],
        ['Accueil', 'accueil'],
        ['Équipe', 'equipe'],
        ['Chat', 'chat'],
        ['Clients', 'clients'],
      ] as Array<[string, string]>,
      ([, id]) => id,
    );
    expect(ordre.map(([, id]) => id)).toEqual(['accueil', 'clients', 'notes', 'chat', 'equipe']);
  });
});
