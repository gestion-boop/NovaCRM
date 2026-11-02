import { supabase } from '@/lib/supabase';
import { AGENCIES } from '@/types';

/**
 * Tuiles d'accueil masquées par l'utilisateur.
 *
 * Demandé le 2 septembre : « je suis utilisateur lambda ; lors d'une mise à
 * jour, je ne veux pas que des tuiles réapparaissent, je veux que ça
 * sauvegarde mon interface ».
 *
 * La liste vivait uniquement dans le navigateur (localStorage). Or la grille,
 * elle, est synchronisée par compte : sur un autre poste, ou après un
 * nettoyage du navigateur, la grille revenait sans la liste des tuiles
 * masquées — et tout ce qui avait été masqué ressortait, comme si une mise à
 * jour l'avait remis. La liste suit donc maintenant le compte, dans
 * user_ui_settings.hidden_tiles, avec le navigateur en copie locale pour
 * rester instantanée.
 */

const CLE_ANCIENNE = 'novasphere_hidden_tiles_v1';

// Cloisonnement par société (demandé le 3 novembre) : masquer/réafficher une
// tuile dans une société ne doit rien changer dans les autres. La société
// courante est posée par l'accueil / les Paramètres (definirAgenceMasquees) ;
// la liste locale et la liste du compte sont indexées par société.
let agenceCourante = 'default';
export function definirAgenceMasquees(agencyId: string | null | undefined) {
  // « Toutes les sociétés » = même repli que l'accueil (AuthContext, AGENCIES[0]).
  agenceCourante = !agencyId ? 'default' : agencyId === 'all' ? (AGENCIES[0]?.id || 'default') : agencyId;
}
const cleLocale = () => `novasphere_hidden_tiles_v2_${agenceCourante}`;

export interface TuileMasquee {
  id: string;
  [k: string]: unknown;
}

const valides = (liste: unknown): TuileMasquee[] =>
  Array.isArray(liste) ? (liste as TuileMasquee[]).filter((t) => t && typeof t.id === 'string') : [];

export function lireMasquees(): TuileMasquee[] {
  try {
    const brut = localStorage.getItem(cleLocale());
    if (brut !== null) return valides(JSON.parse(brut));
    // Première lecture dans cette société : on reprend l'ancienne liste
    // commune (une seule fois), qui devient ensuite propre à la société.
    const ancienne = valides(JSON.parse(localStorage.getItem(CLE_ANCIENNE) || '[]'));
    if (ancienne.length) localStorage.setItem(cleLocale(), JSON.stringify(ancienne));
    return ancienne;
  } catch {
    return [];
  }
}

function ecrireMasquees(liste: TuileMasquee[]) {
  try {
    localStorage.setItem(cleLocale(), JSON.stringify(liste));
  } catch {
    /* stockage indisponible : la copie serveur fait foi au prochain chargement */
  }
}

const fusionner = (a: TuileMasquee[], b: TuileMasquee[]): TuileMasquee[] => {
  const parId = new Map<string, TuileMasquee>();
  [...a, ...b].forEach((t) => { if (!parId.has(t.id)) parId.set(t.id, t); });
  return Array.from(parId.values());
};

// Colonne serveur : ancien format = tableau commun ; nouveau = { _v: 2,
// [société]: liste, __ancienne: ancien tableau (graine des sociétés pas
// encore touchées) }.
const extraireServeur = (brut: unknown): TuileMasquee[] => {
  if (Array.isArray(brut)) return valides(brut);
  if (brut && typeof brut === 'object') {
    const o = brut as Record<string, unknown>;
    return valides(o[agenceCourante] !== undefined ? o[agenceCourante] : o.__ancienne);
  }
  return [];
};
const assemblerServeur = (brut: unknown, liste: TuileMasquee[]): Record<string, unknown> => {
  const base: Record<string, unknown> =
    Array.isArray(brut) ? { __ancienne: brut } : brut && typeof brut === 'object' ? { ...(brut as Record<string, unknown>) } : {};
  base._v = 2;
  base[agenceCourante] = liste;
  return base;
};

async function lireBrutServeur(userId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('user_ui_settings')
    .select('hidden_tiles')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as any)?.hidden_tiles ?? null;
}

async function ecrireSurServeur(userId: string, brut: unknown, liste: TuileMasquee[]) {
  const { error } = await supabase
    .from('user_ui_settings')
    .upsert({ user_id: userId, hidden_tiles: assemblerServeur(brut, liste) } as any, { onConflict: 'user_id' });
  if (error) {
    // Colonne absente (migration pas encore passée) ou droits : on ne bloque
    // pas l'utilisateur, le navigateur garde la liste.
    console.warn('[tuiles masquées] synchronisation serveur impossible :', error.message);
  }
}

/**
 * Réunit la liste du navigateur et celle du compte POUR LA SOCIÉTÉ COURANTE,
 * et met les deux à jour. À appeler au chargement de l'accueil.
 */
export async function chargerMasqueesDepuisServeur(userId: string): Promise<TuileMasquee[]> {
  const locale = lireMasquees();
  try {
    const brut = await lireBrutServeur(userId);
    const serveur = extraireServeur(brut);
    const union = fusionner(locale, serveur);
    ecrireMasquees(union);
    // Si le navigateur en savait plus que le serveur (ou si le serveur est
    // encore à l'ancien format), on le lui apprend.
    if (union.length !== serveur.length || Array.isArray(brut)) await ecrireSurServeur(userId, brut, union);
    return union;
  } catch (e: any) {
    console.warn('[tuiles masquées] lecture serveur impossible :', e?.message || e);
    return locale;
  }
}

// Audit stabilité (20 octobre) : même bug, même classe, que celui déjà
// corrigé sur les dossiers verrouillés de l'accueil (enregistrerVerrous,
// AccueilGrid.tsx) — masquerTuile/reafficherTuile ne regardaient QUE la
// copie locale (localStorage) de CET appareil, et écrasaient purement et
// simplement hidden_tiles côté serveur avec elle. Un second appareil/onglet
// resté ouvert plus longtemps (donc avec une copie locale plus ancienne)
// effaçait ainsi silencieusement, pour tout le compte, une tuile masquée
// entre-temps depuis un AUTRE appareil. Les deux fonctions relisent
// désormais la liste serveur juste avant d'écrire et fusionnent (union, pas
// remplacement) avant d'appliquer la seule action demandée ici.
async function brutServeurFrais(userId: string): Promise<unknown> {
  try {
    return await lireBrutServeur(userId);
  } catch {
    // Lecture fraîche indisponible (réseau, droits...) : l'appelant retombe
    // sur la seule copie locale, comme avant ce correctif.
    return null;
  }
}

export async function masquerTuile(userId: string | null | undefined, tuile: TuileMasquee): Promise<void> {
  const locale = fusionner(lireMasquees(), [tuile]);
  if (!userId) {
    ecrireMasquees(locale);
    return;
  }
  ecrireMasquees(locale);
  const brut = await brutServeurFrais(userId);
  const fraiche = fusionner(extraireServeur(brut), locale);
  ecrireMasquees(fraiche);
  await ecrireSurServeur(userId, brut, fraiche);
}

export async function reafficherTuile(userId: string | null | undefined, id: string): Promise<void> {
  const locale = lireMasquees().filter((t) => t.id !== id);
  // Écriture locale IMMÉDIATE : l'accueil, rouvert aussitôt après, filtre ses
  // tuiles avec cette liste — attendre la lecture serveur le laissait
  // re-masquer la tuile qu'on venait de réafficher.
  ecrireMasquees(locale);
  if (!userId) return;
  const brut = await brutServeurFrais(userId);
  const fraiche = fusionner(extraireServeur(brut), locale).filter((t) => t.id !== id);
  ecrireMasquees(fraiche);
  await ecrireSurServeur(userId, brut, fraiche);
}
