import { estDossierReserveConseilsFinances } from '@/lib/dossiersConseilsFinances';
import { estDossierImmosphera } from '@/lib/tuilesAccueilVisibles';

/**
 * La grille de l'ordinateur est la source. Le téléphone l'affiche avec
 * ses propres tuiles plates. Il ne réécrit jamais cette grille : une
 * écriture depuis le téléphone relançait la synchro et pouvait déplacer
 * ou vider des dossiers.
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
  if (visibilite.masquees.has(tuile.id) && !tuile.locked) return false;
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
