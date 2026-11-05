// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {} } }));

import { lireDispositionAgence, restaurerDispositionDepuisFige } from './dispositionAccueil';

// Garde-fous : une mise à jour de l'application ne doit jamais changer l'ordre
// ni la présence des tuiles de l'accueil d'un utilisateur.
describe('disposition de l’accueil — stabilité entre deux versions', () => {
  beforeEach(() => localStorage.clear());

  it('relit la disposition de la bonne agence sans toucher aux autres', () => {
    const colonne = { A: ['t1', 't2'], B: ['t9'], _maj: { A: 10, B: 20 } };
    expect(lireDispositionAgence(colonne, 'A')).toEqual({ items: ['t1', 't2'], maj: 10 });
    expect(lireDispositionAgence(colonne, 'B')).toEqual({ items: ['t9'], maj: 20 });
    expect(lireDispositionAgence(colonne, 'C')).toEqual({ items: null, maj: null });
  });

  it('lit encore l’ancien format { agencyId, items }', () => {
    expect(lireDispositionAgence({ agencyId: 'A', items: ['x'] }, 'A').items).toEqual(['x']);
    expect(lireDispositionAgence({ agencyId: 'A', items: ['x'] }, 'B').items).toBeNull();
  });

  it('ignore une colonne absente ou mal formée', () => {
    expect(lireDispositionAgence(null, 'A').items).toBeNull();
    expect(lireDispositionAgence([], 'A').items).toBeNull();
  });

  it('restaure la disposition figée si la clé locale a disparu', () => {
    const cle = 'novasphere_home_tiles_v3_A';
    localStorage.setItem('novasphere_frozen_layout_snapshot_v1', JSON.stringify({ timestamp: 5, keys: { [cle]: '["t2","t1"]' } }));
    restaurerDispositionDepuisFige();
    expect(localStorage.getItem(cle)).toBe('["t2","t1"]');
  });

  it('ne remplace jamais une disposition locale déjà présente', () => {
    const cle = 'novasphere_home_tiles_v3_A';
    localStorage.setItem(cle, '["actuel"]');
    localStorage.setItem('novasphere_frozen_layout_snapshot_v1', JSON.stringify({ timestamp: 5, keys: { [cle]: '["ancien"]' } }));
    restaurerDispositionDepuisFige();
    expect(localStorage.getItem(cle)).toBe('["actuel"]');
  });
});
