/** Familles du menu. Accueil reste au-dessus, hors famille. */

export type FamilleMenu = 'activite' | 'echanges' | 'agence';

export const ORDRE_FAMILLES: { id: FamilleMenu; titre: string }[] = [
  { id: 'activite', titre: 'Activité' },
  { id: 'echanges', titre: 'Échanges' },
  { id: 'agence', titre: 'Agence' },
];

const FAMILLE: Record<string, FamilleMenu> = {
  'tableau-de-bord': 'activite',
  clients: 'activite',
  pipeline: 'activite',
  'projets-internes': 'activite',
  agenda: 'activite',
  rappels: 'activite',
  chat: 'echanges',
  mail: 'echanges',
  notes: 'echanges',
};

/** Accueil n'a pas de famille. Tout le reste sans entrée connue va dans Agence. */
export function familleMenu(id: string): FamilleMenu | null {
  if (id === 'accueil') return null;
  return FAMILLE[id] ?? 'agence';
}

export function titreFamille(id: string): string | null {
  const famille = familleMenu(id);
  return ORDRE_FAMILLES.find((entree) => entree.id === famille)?.titre ?? null;
}

export function grouperMenu<T extends { id: string }>(items: T[]): {
  accueil: T | null;
  familles: { id: FamilleMenu; titre: string; items: T[] }[];
} {
  return {
    accueil: items.find((item) => item.id === 'accueil') ?? null,
    familles: ORDRE_FAMILLES.map((famille) => ({
      ...famille,
      items: items.filter((item) => familleMenu(item.id) === famille.id),
    })).filter((famille) => famille.items.length > 0),
  };
}

/** Même ordre relatif à l'intérieur de chaque famille. */
export function ordonnerParFamille<T>(items: T[], idDe: (item: T) => string): T[] {
  const accueil = items.filter((item) => idDe(item) === 'accueil');
  const familles = ORDRE_FAMILLES.flatMap((famille) =>
    items.filter((item) => familleMenu(idDe(item)) === famille.id),
  );
  return [...accueil, ...familles];
}
