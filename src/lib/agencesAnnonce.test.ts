import { describe, expect, it } from 'vitest';
import { AGENCIES } from '@/types';
import { agenceUniqueAnnonce, agencesCibleAnnonce } from './agencesAnnonce';

const conseils = AGENCIES.find((agence) => agence.name === 'Conseils Finances')!;
const novavisio = AGENCIES.find((agence) => agence.name === 'Novavisio')!;
const immosphera = AGENCIES.find((agence) => agence.name === 'Immosphera')!;

describe('destinataires d’une annonce', () => {
  it('ne propose que l’agence ouverte', () => {
    expect(agencesCibleAnnonce(conseils.id)).toEqual([conseils.id]);
    expect(agenceUniqueAnnonce(conseils.id)?.name).toBe('Conseils Finances');
    expect(agencesCibleAnnonce(novavisio.id)).toEqual([novavisio.id]);
    expect(agencesCibleAnnonce(immosphera.id)).toEqual([immosphera.id]);
  });

  it('dans la vue toutes les sociétés, les trois restent disponibles', () => {
    expect(agenceUniqueAnnonce('all')).toBeNull();
    expect(agencesCibleAnnonce('all').sort()).toEqual([conseils.id, novavisio.id, immosphera.id].sort());
  });
});
