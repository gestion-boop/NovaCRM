/** Mise à jour locale, avant la réponse du serveur. */

export function majParId<T extends { id: string }>(
  liste: T[] | undefined,
  id: string,
  patch: Partial<T>,
): T[] | undefined {
  if (!liste) return liste;
  return liste.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function retirerParId<T extends { id: string }>(liste: T[] | undefined, id: string): T[] | undefined {
  if (!liste) return liste;
  return liste.filter((item) => item.id !== id);
}

export function ajouterDevant<T>(liste: T[] | undefined, item: T): T[] {
  return [item, ...(liste || [])];
}

export function remplacerParId<T extends { id: string }>(
  liste: T[] | undefined,
  ancienId: string,
  item: T,
): T[] | undefined {
  if (!liste) return liste;
  return liste.map((entree) => (entree.id === ancienId ? item : entree));
}

export function contactProvisoire(saisie: {
  name?: string;
  email?: string;
  phone?: string;
  agencyId?: string;
}, id: string) {
  return {
    id,
    name: (saisie.name || '').trim() || 'Nouveau Prospect',
    email: (saisie.email || '').trim(),
    phone: (saisie.phone || '').trim(),
    agencyId: saisie.agencyId || '',
    status: 'Froid' as const,
    createdAt: new Date().toISOString(),
  };
}
