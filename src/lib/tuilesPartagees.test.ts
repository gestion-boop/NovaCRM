import { describe, expect, it } from 'vitest';
import {
  choisirVersion,
  lireTuiles,
  ordonnerCommeLeBureau,
  tuilesPourTelephone,
  type VisibiliteTuiles,
} from './tuilesPartagees';

const voirTout: VisibiliteTuiles = {
  immosphera: true,
  novavisio: true,
  conseilsFinances: false,
  banquesAssurances: false,
  dossierImmosphera: true,
  annonce: true,
  masquees: new Set(),
};

const ids = (tuiles: { id: string }[]) => tuiles.map((tuile) => tuile.id);

describe('tuiles partagées entre ordinateur et téléphone', () => {
  it('retire les quatre icônes du dock et garde l’ordre', () => {
    const tuiles = tuilesPourTelephone(
      [
        { id: 'clients', title: 'Clients & Leads', navTarget: 'clients' },
        { id: 'rappels', title: 'Rappels', navTarget: 'rappels' },
        {
          id: 'folder-business',
          title: 'Stratégie & Ventes',
          isFolder: true,
          children: [
            { id: 'pipeline', title: 'Pipelines', navTarget: 'pipeline' },
            { id: 'chat', title: 'Chat', navTarget: 'chat' },
          ],
        },
        { id: 'agenda', title: 'Agenda', navTarget: 'agenda' },
      ],
      voirTout,
    );
    expect(ids(tuiles)).toEqual(['clients', 'folder-business', 'tableau-de-bord']);
    expect(ids(tuiles[1].children || [])).toEqual(['pipeline']);
  });

  it('ne remet pas le tableau de bord s’il est déjà dans un dossier ou masqué', () => {
    const dansDossier = tuilesPourTelephone(
      [{
        id: 'dossier',
        title: 'Dossier',
        isFolder: true,
        children: [{ id: 'tableau-de-bord', title: 'Tableau de bord', navTarget: 'tableau-de-bord' }],
      }],
      voirTout,
    );
    expect(ids(dansDossier)).toEqual(['dossier']);

    const masque = tuilesPourTelephone(
      [{ id: 'clients', title: 'Clients', navTarget: 'clients' }],
      { ...voirTout, masquees: new Set(['tableau-de-bord']) },
    );
    expect(ids(masque)).toEqual(['clients']);
  });

  it('laisse tomber un dossier qui ne contenait que le dock, et cache les tuiles d’une autre société', () => {
    const tuiles = tuilesPourTelephone(
      [
        {
          id: 'communication',
          title: 'Communication',
          isFolder: true,
          children: [{ id: 'mail', title: 'Mail', navTarget: 'mail' }],
        },
        { id: 'immosphera360', title: 'Immosphera 360', navTarget: 'immosphera360' },
        { id: 'reserver-camera', title: 'Caméra', navTarget: 'reserver-camera' },
        { id: 'banques', title: 'Banques', isFolder: true, children: [{ id: 'x', title: 'X', navTarget: 'clients' }] },
        { id: 'site', title: 'Mon site', externalUrl: 'https://exemple.fr' },
      ],
      { ...voirTout, immosphera: false, conseilsFinances: true },
    );
    expect(ids(tuiles)).toEqual(['site', 'tableau-de-bord']);
  });

  it('prend la version la plus récente, et l’ordre des cases de l’ordinateur', () => {
    expect(choisirVersion(
      { items: ['local'], maj: 2 },
      { items: ['serveur'], maj: 5 },
    )).toEqual(['serveur']);
    expect(choisirVersion(
      { items: ['local'], maj: 8 },
      { items: ['serveur'], maj: 5 },
    )).toEqual(['local']);
    expect(choisirVersion({ items: null, maj: null }, { items: null, maj: null })).toBeNull();
    expect(lireTuiles('{')).toBeNull();

    const ordre = ordonnerCommeLeBureau(
      [
        { id: 'documents', title: 'Documents', navTarget: 'documents' },
        { id: 'clients', title: 'Clients', navTarget: 'clients' },
        { id: 'tableau-de-bord', title: 'Tableau de bord', navTarget: 'tableau-de-bord' },
      ],
      ['clients', null, 'rappels', 'documents'],
    );
    expect(ids(ordre)).toEqual(['clients', 'documents', 'tableau-de-bord']);
  });
});
