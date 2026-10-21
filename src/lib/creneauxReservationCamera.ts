import { partagentUnEquipement } from './equipementsReservation';

// Repères toutes les 30 minutes, de 8 h à 19 h 30. La durée n'est pas
// figée : l'utilisateur choisit l'heure de début puis l'heure de fin
// (une après-midi entière, par exemple).
export const DEBUTS_CRENEAUX = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
] as const;

export const PAS_CRENEAU_MIN = 30;

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

export function minutesEntre(debut: string, fin: string): number {
  const [h1, m1] = debut.split(':').map(Number);
  const [h2, m2] = fin.split(':').map(Number);
  if (![h1, m1, h2, m2].every(Number.isFinite)) return 0;
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

export function libelleDuree(debut: string, fin: string): string {
  const total = minutesEntre(debut, fin);
  if (total <= 0) return '';
  const heures = Math.floor(total / 60);
  const minutes = total % 60;
  if (heures && minutes) return `${heures} h ${minutes}`;
  if (heures) return heures === 1 ? '1 h' : `${heures} h`;
  return `${minutes} min`;
}

function bornes(reservation: ReservationCreneau): { start: string; end: string } {
  const start = reservation.startTime || reservation.startDate.slice(-5);
  const end = reservation.endTime || (reservation.endDate ? reservation.endDate.slice(-5) : ajouterMinutes(start, PAS_CRENEAU_MIN));
  return { start, end };
}

export function creneauxAffiches(debutActuel?: string): string[] {
  const liste = [...DEBUTS_CRENEAUX] as string[];
  if (debutActuel && /^\d{2}:\d{2}$/.test(debutActuel) && !liste.includes(debutActuel)) {
    liste.push(debutActuel);
  }
  return liste.sort();
}

export function plageConflit(
  debut: string,
  fin: string,
  reservations: ReservationCreneau[],
  equipements: string[],
  excludeId?: string,
): boolean {
  if (equipements.length === 0 || fin <= debut) return false;
  return reservations.some((reservation) => {
    if (excludeId && reservation.id === excludeId) return false;
    if (reservation.status === 'Refusée') return false;
    const bornesReservation = bornes(reservation);
    if (!(debut < bornesReservation.end && fin > bornesReservation.start)) return false;
    return equipements.some((equipment) =>
      partagentUnEquipement(reservation, { equipmentList: [equipment], equipmentName: equipment })
    );
  });
}

export function creneauConflit(
  debut: string,
  reservations: ReservationCreneau[],
  equipements: string[],
  excludeId?: string,
): boolean {
  return plageConflit(debut, ajouterMinutes(debut, PAS_CRENEAU_MIN), reservations, equipements, excludeId);
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
