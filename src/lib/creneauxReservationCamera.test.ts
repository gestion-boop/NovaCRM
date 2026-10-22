import { describe, expect, it } from 'vitest';
import {
  ajouterMinutes,
  creneauConflit,
  creneauxAffiches,
  disponibiliteJour,
  heuresFinAffichees,
  libelleDuree,
  plageConflit,
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

  it('propose pour la fin seulement les heures après le début', () => {
    const fins = heuresFinAffichees('14:00', '16:00');
    expect(fins[0]).toBe('14:30');
    expect(fins).toContain('16:00');
    expect(fins).toContain('20:00');
    expect(fins.every((heure) => heure > '14:00')).toBe(true);
  });

  it('marque seulement la demi-heure réellement occupée', () => {
    expect(creneauConflit('10:00', [djiMatin], ['Caméra DJI'])).toBe(true);
    expect(creneauConflit('10:30', [djiMatin], ['Caméra DJI'])).toBe(true);
    expect(creneauConflit('09:30', [djiMatin], ['Caméra DJI'])).toBe(false);
    expect(creneauConflit('11:00', [djiMatin], ['Caméra DJI'])).toBe(false);
    expect(creneauConflit('10:00', [djiMatin], ['Caméra X4'])).toBe(false);
  });

  it('une après-midi libre reste réservable à côté d’un créneau pris', () => {
    expect(plageConflit('13:30', '16:00', [djiMatin], ['Caméra DJI'])).toBe(false);
    expect(plageConflit('09:00', '10:00', [djiMatin], ['Caméra DJI'])).toBe(false);
    expect(plageConflit('09:30', '11:30', [djiMatin], ['Caméra DJI'])).toBe(true);
    expect(libelleDuree('13:30', '17:00')).toBe('3 h 30');
    expect(libelleDuree('14:00', '15:00')).toBe('1 h');
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
