// Même repli que le formulaire de réservation : les demandes anciennes
// n'ont parfois que `equipmentName` (« Caméra DJI, Caméra X4 »), pas
// `equipmentList`. Lire la liste sans ce repli plantait la fenêtre admin.

export function equipementsReservation(reservation: {
  equipmentList?: readonly string[] | null;
  equipmentName?: string | null;
}): string[] {
  if (reservation.equipmentList && reservation.equipmentList.length > 0) {
    return [...reservation.equipmentList];
  }
  if (!reservation.equipmentName) return [];
  return reservation.equipmentName.split(',').map((item) => item.trim());
}

export function partagentUnEquipement(
  a: { equipmentList?: readonly string[] | null; equipmentName?: string | null },
  b: { equipmentList?: readonly string[] | null; equipmentName?: string | null },
): boolean {
  const equipementsB = equipementsReservation(b);
  return equipementsReservation(a).some((equipment) => equipementsB.includes(equipment));
}
