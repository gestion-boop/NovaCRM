const sansCasse = (v: string) =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const estAgenceImmosphera = (
  a: { name?: string | null; slug?: string | null } | null | undefined,
) => /immosphera/i.test(a?.name ?? '') || /immosphera/i.test(a?.slug ?? '');

/** Dossier créé et verrouillé pour Immosphera. Les autres sociétés ne le voient pas. */
export const estDossierImmosphera = (titre: string | null | undefined) =>
  /^immosphera$/.test(sansCasse(titre ?? ''));

export interface TuileNotes {
  id: string;
  title?: string | null;
  navTarget?: string | null;
  isFolder?: boolean;
  locked?: boolean;
  children?: TuileNotes[];
}

/** Le raccourci Bloc-notes et les dossiers renommés « Blocs - Notes ». */
export const estBlocNotes = (tuile: { id?: string; title?: string | null; navTarget?: string | null }) => {
  if (tuile.id === 'notes' || tuile.navTarget === 'notes') return true;
  return /^blocs?\s*[-–]?\s*notes?$/.test(sansCasse(tuile.title ?? ''));
};

function scoreNotes(tuile: TuileNotes): number {
  const enfants = tuile.children?.length ?? 0;
  const base = tuile.isFolder && enfants > 0 ? 100 + enfants : tuile.id === 'notes' ? 10 : 1;
  // Le verrou départage deux dossiers. Il ne cache pas un dossier qui a
  // des cartes au profit d'une copie vide.
  return base + (tuile.locked ? 50 : 0);
}

/**
 * Une seule tuile Bloc-notes par niveau. On garde le dossier verrouillé,
 * sinon celui qui a du contenu, sinon le raccourci d'origine. Les notes
 * rangées dans un autre dossier ne sont pas touchées.
 */
export function retirerDoublonsNotes<T extends TuileNotes>(items: T[]): T[] {
  const notes = items.filter((tuile) => estBlocNotes(tuile));
  const garde = notes.length > 1
    ? [...notes].sort((a, b) => scoreNotes(b) - scoreNotes(a))[0]
    : null;
  return items
    .filter((tuile) => !garde || !estBlocNotes(tuile) || tuile.id === garde.id)
    .map((tuile) =>
      tuile.children
        ? { ...tuile, children: retirerDoublonsNotes(tuile.children as T[]) }
        : tuile,
    );
}
