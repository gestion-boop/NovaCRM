import { partagentUnEquipement } from './equipementsReservation';

// Créneaux proposés dans la fenêtre (maquette) : de 8 h à 17 h 30,
// avec une pause entre 12 h 30 et 13 h 30. Une sélection dure une heure.
export const DEBUTS_CRENEAUX = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
] as const;

export const DUREE_CRENEAU_MIN = 60;

export const MATERIEL_CONNU = [
  'Caméra Giraffe',
  'Caméra DJI',
  'Caméra X4',
  'Community Manager',
] as const;

export type NiveauDispo = 'disponible' | 'peu' | 'indisponible';

export interface ReservationCreneau {
  id?: string;
  status?: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  equipmentList?: readonly string[] | null;
  equipmentName?: string | null;
}

export function ajouterMinutes(heure: string, minutes: number): string {
  const [h, m] = heure.split(':').map(Number);
  const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + minutes;
  const normalise = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalise / 60)).padStart(2, '0')}:${String(normalise % 60).padStart(2, '0')}`;
}

function bornes(reservation: ReservationCreneau): { start: string; end: string } {
  const start = reservation.startTime || reservation.startDate.slice(-5);
  const end = reservation.endTime || (reservation.endDate ? reservation.endDate.slice(-5) : ajouterMinutes(start, DUREE_CRENEAU_MIN));
  return { start, end };
}

export function creneauxAffiches(debutActuel?: string): string[] {
  const liste = [...DEBUTS_CRENEAUX] as string[];
  if (debutActuel && /^\d{2}:\d{2}$/.test(debutActuel) && !liste.includes(debutActuel)) {
    liste.push(debutActuel);
  }
  return liste.sort();
}

export function creneauConflit(
  debut: string,
  reservations: ReservationCreneau[],
  equipements: string[],
  excludeId?: string,
): boolean {
  if (equipements.length === 0) return false;
  const fin = ajouterMinutes(debut, DUREE_CRENEAU_MIN);
  return reservations.some((reservation) => {
    if (excludeId && reservation.id === excludeId) return false;
    if (reservation.status === 'Refusée') return false;
    const { start, end } = bornes(reservation);
    if (!(debut < end && fin > start)) return false;
    return equipements.some((equipment) =>
      partagentUnEquipement(reservation, { equipmentList: [equipment], equipmentName: equipment })
    );
  });
}

export function disponibiliteJour(
  dateIso: string,
  aujourdhuiIso: string,
  reservations: ReservationCreneau[],
  equipements: string[],
): NiveauDispo {
  if (dateIso < aujourdhuiIso) return 'indisponible';
  const duJour = reservations.filter(
    (reservation) => reservation.startDate.startsWith(dateIso) && reservation.status !== 'Refusée',
  );
  if (duJour.length === 0) return 'disponible';
  const cibles = equipements.length > 0 ? equipements : [...MATERIEL_CONNU];
  const occupes = DEBUTS_CRENEAUX.filter((debut) => creneauConflit(debut, duJour, cibles)).length;
  if (occupes === 0) return 'disponible';
  if (occupes >= DEBUTS_CRENEAUX.length) return 'indisponible';
  return 'peu';
}
