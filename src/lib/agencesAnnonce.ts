import { AGENCIES } from '@/types';

export function agencesReelles() {
  return AGENCIES.filter((agence) => agence.id !== 'all');
}

/** Société réellement ouverte. « Toutes les sociétés » n'en est pas une. */
export function agenceUniqueAnnonce(agencyId: string | undefined) {
  if (!agencyId || agencyId === 'all') return null;
  return agencesReelles().find((agence) => agence.id === agencyId) ?? null;
}

/**
 * Destinataires par défaut : uniquement l'agence ouverte.
 * Dans la vue « Toutes les sociétés », les trois restent proposées.
 */
export function agencesCibleAnnonce(agencyId: string | undefined): string[] {
  const unique = agenceUniqueAnnonce(agencyId);
  if (unique) return [unique.id];
  return agencesReelles().map((agence) => agence.id);
}
