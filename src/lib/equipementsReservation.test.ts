import { describe, expect, it } from 'vitest';
import { equipementsReservation, partagentUnEquipement } from './equipementsReservation';

describe('équipements d’une réservation caméra', () => {
  it('retombe sur le nom quand la liste est absente', () => {
    expect(equipementsReservation({
      equipmentName: 'Caméra DJI, Caméra X4',
    })).toEqual(['Caméra DJI', 'Caméra X4']);
  });

  it('ne plante pas si la liste et le nom manquent', () => {
    expect(equipementsReservation({})).toEqual([]);
  });

  it('détecte un matériel commun même sans liste', () => {
    expect(partagentUnEquipement(
      { equipmentName: 'Caméra DJI, Caméra Giraffe' },
      { equipmentList: ['Caméra X4', 'Caméra DJI'] },
    )).toBe(true);
  });

  it('ignore deux réservations sans matériel en commun', () => {
    expect(partagentUnEquipement(
      { equipmentName: 'Caméra Giraffe' },
      { equipmentList: ['Caméra X4'] },
    )).toBe(false);
  });
});
