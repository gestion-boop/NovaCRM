import { estDossierReserveConseilsFinances } from '@/lib/dossiersConseilsFinances';
import { estDossierImmosphera } from '@/lib/tuilesAccueilVisibles';

/**
 * La grille de l'ordinateur est la source. Le téléphone l'affiche avec
 * ses propres tuiles plates. Il ne réécrit jamais cette grille : une
 * écriture depuis le téléphone relançait la synchro et pouvait déplacer
 * ou vider des dossiers.
 *
 * L'ordre et les tuiles masquées sur le téléphone restent dans le
 * navigateur du téléphone. Ils ne partent ni vers l'ordinateur, ni vers
 * le compte.
 */

export interface TuilePartagee {
  id: string;
  title?: string;
  iconName?: string;
  gradient?: string;
  navTarget?: string;
  isFolder?: boolean;
  children?: TuilePartagee[];
  externalUrl?: string;
  locked?: boolean;
}

export interface VisibiliteTuiles {
  immosphera: boolean;
  novavisio: boolean;
  conseilsFinances: boolean;
  banquesAssurances: boolean;
  dossierImmosphera: boolean;
  annonce: boolean;
  masquees: Set<string>;
}

/** Les quatre icônes du haut du téléphone. Elles ne sont pas redoublées en tuile. */
const IDS_DOCK = new Set(['rappels', 'chat', 'mail', 'agenda']);

const IDS_IMMOSPHERA = new Set([
  'immosphera-academy',
  'immosphera-site',
  'immosphera-partenaires',
  'immosphera-netty',
  'folder-passerelle',
  'immosphera-amanda',
  'immosphera-pool',
  'statistiques-etiquettes',
]);

const TUILE_TABLEAU: TuilePartagee = {
  id: 'tableau-de-bord',
  title: 'Tableau de bord',
  iconName: 'BarChart2',
  gradient: 'from-[#0D9488] via-[#0F766E] to-[#042F2E]',
  navTarget: 'tableau-de-bord',
};

export function cleTuilesBureau(uid: string | null | undefined, agencyId: string | null | undefined): string {
  return `novasphere_home_tiles_v3_${uid || 'anon'}_${agencyId || 'default'}`;
}

export function cleTuilesBureauAnonyme(agencyId: string | null | undefined): string {
  return `novasphere_home_tiles_v3_anon_${agencyId || 'default'}`;
}

export function cleCasesBureau(uid: string | null | undefined, agencyId: string | null | undefined): string {
  return `novasphere_home_slots_v1_${uid || 'anon'}_${agencyId || 'default'}`;
}

export function cleCasesBureauAnonyme(agencyId: string | null | undefined): string {
  return `novasphere_home_slots_v1_anon_${agencyId || 'default'}`;
}

export function cleArrangementTelephone(uid: string | null | undefined, agencyId: string | null | undefined): string {
  return `novasphere_phone_arrangement_v1_${uid || 'anon'}_${agencyId || 'default'}`;
}

export interface ArrangementTelephone {
  cases: (string | null)[];
  masquees: string[];
}

function normaliserTuiles(valeur: unknown): TuilePartagee[] | null {
  if (!Array.isArray(valeur) || valeur.length === 0) return null;
  const valides = valeur.filter(
    (item): item is TuilePartagee =>
      !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
  );
  return valides.length ? valides : null;
}

export function lireTuiles(brut: string | null): TuilePartagee[] | null {
  if (!brut) return null;
  try {
    return normaliserTuiles(JSON.parse(brut));
  } catch {
    return null;
  }
}

export function lireTuilesValeur(valeur: unknown): TuilePartagee[] | null {
  return normaliserTuiles(valeur);
}

export function lireCases(brut: string | null): (string | null)[] | null {
  if (!brut) return null;
  try {
    return lireCasesValeur(JSON.parse(brut));
  } catch {
    return null;
  }
}

export function lireCasesValeur(valeur: unknown): (string | null)[] | null {
  if (!Array.isArray(valeur) || valeur.length === 0) return null;
  return valeur.map((id) => (typeof id === 'string' ? id : null));
}

/** La copie la plus récente gagne. À date égale, le compte (serveur) fait foi. */
export function choisirVersion<T>(
  locale: { items: T | null; maj: number | null },
  serveur: { items: T | null; maj: number | null },
): T | null {
  if (locale.items != null && (locale.maj ?? 0) > (serveur.maj ?? 0)) return locale.items;
  if (serveur.items != null) return serveur.items;
  return locale.items;
}

function contientId(items: TuilePartagee[], id: string): boolean {
  return items.some((item) => item.id === id || (item.children ? contientId(item.children, id) : false));
}

function retirerDock(items: TuilePartagee[]): TuilePartagee[] {
  return items
    .filter((item) => !IDS_DOCK.has(item.id))
    .map((item) => (item.children ? { ...item, children: retirerDock(item.children) } : item))
    .filter((item) => !item.isFolder || (item.children && item.children.length > 0));
}

function tuileVisible(tuile: TuilePartagee, visibilite: VisibiliteTuiles): boolean {
  if (estDossierReserveConseilsFinances(tuile.title) && !visibilite.banquesAssurances) return false;
  if (estDossierImmosphera(tuile.title) && !visibilite.dossierImmosphera) return false;
  if (tuile.id === 'reserver-camera' && visibilite.conseilsFinances) return false;
  if (tuile.id === 'immosphera360' && !visibilite.immosphera) return false;
  if (IDS_IMMOSPHERA.has(tuile.id) && !visibilite.immosphera) return false;
  if (tuile.id === 'carte-novavisio' && !visibilite.novavisio) return false;
  if (tuile.id === 'conseils-aura' && !visibilite.conseilsFinances) return false;
  if ((tuile.id === 'annonce' || tuile.id === 'nova-lock-spacer') && !visibilite.annonce) return false;
  if (visibilite.masquees.has(tuile.id) && !tuile.locked && !(tuile.id === 'reserver-camera' && !visibilite.conseilsFinances)) return false;
  return true;
}

function filtrerVisibles(items: TuilePartagee[], visibilite: VisibiliteTuiles): TuilePartagee[] {
  return items
    .filter((item) => tuileVisible(item, visibilite))
    .map((item) => (item.children ? { ...item, children: filtrerVisibles(item.children, visibilite) } : item))
    .filter((item) => !item.isFolder || (item.children && item.children.length > 0));
}

/**
 * Tuiles de l'ordinateur, prêtes pour le téléphone.
 * Le tableau de bord vit dans les cinq icônes de l'ordinateur et n'est
 * plus dans la grille enregistrée. Le téléphone n'a que quatre icônes :
 * on le remet en tuile pour ne pas le perdre.
 */
export function tuilesPourTelephone(racine: TuilePartagee[], visibilite: VisibiliteTuiles): TuilePartagee[] {
  const nettoyees = filtrerVisibles(retirerDock(racine), visibilite);
  if (contientId(nettoyees, 'tableau-de-bord') || visibilite.masquees.has('tableau-de-bord')) return nettoyees;
  return [...nettoyees, TUILE_TABLEAU];
}

/**
 * Écran replié du téléphone : cinq cases, puis la flèche.
 * Un dossier verrouillé qui serait plus loin remonte dans ces cinq
 * cases, à la place d'une tuile ordinaire. La flèche ne descend pas.
 */
export function teteEcranTelephone<T extends string | null>(
  cases: T[],
  replie: boolean,
  estVerrou: (id: T) => boolean,
): T[] {
  if (!replie) return cases;
  const tete = cases.slice(0, 5);
  const presents = new Set(tete.filter((id) => id));
  for (const id of cases) {
    if (!id || !estVerrou(id) || presents.has(id)) continue;
    let cible = -1;
    for (let i = tete.length - 1; i >= 0; i--) {
      if (tete[i] && !estVerrou(tete[i])) { cible = i; break; }
    }
    if (cible === -1) break;
    presents.delete(tete[cible] as T);
    tete[cible] = id;
    presents.add(id);
  }
  return tete;
}

/** Même ordre que l'écran ordinateur (cases), sans les trous. */
export function ordonnerCommeLeBureau(
  tuiles: TuilePartagee[],
  cases: (string | null)[] | null,
): TuilePartagee[] {
  if (!cases?.length) return tuiles;
  const parId = new Map(tuiles.map((tuile) => [tuile.id, tuile]));
  const vues = new Set<string>();
  const ordre: TuilePartagee[] = [];
  for (const id of cases) {
    if (!id || vues.has(id) || !parId.has(id)) continue;
    ordre.push(parId.get(id)!);
    vues.add(id);
  }
  for (const tuile of tuiles) {
    if (!vues.has(tuile.id)) ordre.push(tuile);
  }
  return ordre;
}

function rognerFin(cases: (string | null)[]): (string | null)[] {
  const next = [...cases];
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next;
}

export function lireArrangement(brut: string | null): ArrangementTelephone | null {
  if (!brut) return null;
  try {
    const valeur = JSON.parse(brut) as { cases?: unknown; masquees?: unknown };
    if (!valeur || !Array.isArray(valeur.cases)) return null;
    return {
      cases: valeur.cases.map((id) => (typeof id === 'string' ? id : null)),
      masquees: Array.isArray(valeur.masquees)
        ? valeur.masquees.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Ordre du téléphone par-dessus les tuiles de l'ordinateur.
 * Sans arrangement, l'ordre de l'ordinateur est repris tel quel.
 * Une tuile masquée ici disparaît. Une tuile verrouillée reste.
 * Une tuile nouvelle, arrivée depuis l'ordinateur, se pose à la fin.
 */
export function presenterTelephone(
  sourceIds: string[],
  arrangement: ArrangementTelephone | null,
  estVerrou: (id: string) => boolean,
): (string | null)[] {
  if (!arrangement) return [...sourceIds];
  const masquees = new Set(arrangement.masquees.filter((id) => !estVerrou(id)));
  const autorises = new Set(sourceIds.filter((id) => !masquees.has(id)));
  const places: (string | null)[] = [];
  const deja = new Set<string>();
  for (const id of arrangement.cases) {
    if (!id || !autorises.has(id) || deja.has(id)) {
      places.push(null);
      continue;
    }
    places.push(id);
    deja.add(id);
  }
  const posees = rognerFin(places);
  for (const id of sourceIds) {
    if (!autorises.has(id) || deja.has(id)) continue;
    posees.push(id);
    deja.add(id);
  }
  return posees;
}

export function etendreGrilleEdition(cases: (string | null)[], edition: boolean): (string | null)[] {
  if (!edition) return cases;
  const dernier = cases.reduce((acc, id, i) => (id ? i : acc), -1);
  const lignes = Math.ceil(Math.max(dernier + 1, 1) / 3) + 1;
  const taille = Math.max(6, lignes * 3);
  const next = [...cases];
  while (next.length < taille) next.push(null);
  return next;
}

export function masquerSurTelephone(
  sourceIds: string[],
  arrangement: ArrangementTelephone | null,
  id: string,
  estVerrou: (id: string) => boolean,
): ArrangementTelephone {
  const actuel = arrangement ?? { cases: [...sourceIds], masquees: [] };
  if (estVerrou(id)) return actuel;
  const visibles = presenterTelephone(sourceIds, actuel, estVerrou);
  return {
    cases: rognerFin(visibles.map((place) => (place === id ? null : place))),
    masquees: actuel.masquees.includes(id) ? actuel.masquees : [...actuel.masquees, id],
  };
}

export function reafficherSurTelephone(
  sourceIds: string[],
  arrangement: ArrangementTelephone | null,
  id: string,
): ArrangementTelephone {
  const actuel = arrangement ?? { cases: [...sourceIds], masquees: [] };
  const cases = [...actuel.cases];
  if (!cases.includes(id)) {
    const trou = cases.indexOf(null);
    if (trou === -1) cases.push(id);
    else cases[trou] = id;
  }
  return {
    cases: rognerFin(cases),
    masquees: actuel.masquees.filter((masquee) => masquee !== id),
  };
}

export function deplacerSurTelephone(
  sourceIds: string[],
  arrangement: ArrangementTelephone | null,
  activeId: string,
  overId: string,
  estVerrou: (id: string) => boolean,
): ArrangementTelephone {
  const actuel = arrangement ?? { cases: [...sourceIds], masquees: [] };
  const visibles = etendreGrilleEdition(presenterTelephone(sourceIds, actuel, estVerrou), true);
  const slotIds = visibles.map((id, i) => id || `empty-${i}`);
  const depart = slotIds.indexOf(activeId);
  const arrivee = slotIds.indexOf(overId);
  if (depart < 0 || arrivee < 0 || depart === arrivee) return actuel;
  const next = [...visibles];
  [next[depart], next[arrivee]] = [next[arrivee], next[depart]];
  return { cases: rognerFin(next), masquees: actuel.masquees };
}
