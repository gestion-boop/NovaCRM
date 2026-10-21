import { describe, expect, it } from 'vitest';
import {
  ajouterMinutes,
  creneauConflit,
  creneauxAffiches,
  disponibiliteJour,
} from './creneauxReservationCamera';

const djiMatin = {
  id: 'a',
  status: 'Confirmée',
  startDate: '2026-10-06 10:00',
  endDate: '2026-10-06 11:00',
  startTime: '10:00',
  endTime: '11:00',
  equipmentName: 'Caméra DJI',
};

describe('créneaux de réservation caméra', () => {
  it('ajoute une heure au créneau choisi', () => {
    expect(ajouterMinutes('10:00', 60)).toBe('11:00');
    expect(ajouterMinutes('17:30', 60)).toBe('18:30');
  });

  it('garde un horaire déjà enregistré hors de la grille', () => {
    expect(creneauxAffiches('07:15')).toContain('07:15');
    expect(creneauxAffiches('10:00')).toEqual(creneauxAffiches());
  });

  it('marque le créneau occupé seulement pour le matériel concerné', () => {
    expect(creneauConflit('10:00', [djiMatin], ['Caméra DJI'])).toBe(true);
    expect(creneauConflit('10:00', [djiMatin], ['Caméra X4'])).toBe(false);
    expect(creneauConflit('11:00', [djiMatin], ['Caméra DJI'])).toBe(false);
  });

  it('ignore la réservation en cours de modification', () => {
    expect(creneauConflit('10:00', [djiMatin], ['Caméra DJI'], 'a')).toBe(false);
  });

  it('colore le jour selon la pression et le passé', () => {
    expect(disponibiliteJour('2026-10-05', '2026-10-06', [], [])).toBe('indisponible');
    expect(disponibiliteJour('2026-10-06', '2026-10-06', [], [])).toBe('disponible');
    expect(disponibiliteJour('2026-10-06', '2026-10-06', [djiMatin], ['Caméra DJI'])).toBe('peu');
    expect(disponibiliteJour('2026-10-06', '2026-10-06', [djiMatin], ['Caméra X4'])).toBe('disponible');
  });
});
