import { supabase } from '@/lib/supabase';

/**
 * Disposition de l'accueil (grille de tuiles et positions racine), par
 * utilisateur et par agence, dans `user_ui_settings.home_tiles` et
 * `user_ui_settings.home_root_slots` : un dictionnaire `{ [agencyId]: … }`,
 * plus une clé `_maj` `{ [agencyId]: horodatage }` qui date chaque agence.
 *
 * Signalé le 3 septembre : « quand l'utilisateur crée un dossier, très
 * souvent après une mise à jour, les tuiles ne sont pas sauvegardées dans
 * les dossiers, comme s'il y avait des sauvegardes ». Deux causes, toutes
 * deux ici :
 *  1. Chaque changement de grille lançait sa propre écriture serveur
 *     (lecture puis réécriture de la colonne), toutes en parallèle : créer
 *     un dossier puis y glisser trois tuiles = quatre écritures en vol, et
 *     la plus ANCIENNE pouvait arriver en dernier. Le serveur gardait alors
 *     le dossier vide.
 *  2. Au rechargement (une mise à jour de l'appli en provoque un), la
 *     version serveur remplaçait la grille du navigateur sans regarder
 *     laquelle était la plus récente : la copie en retard revenait.
 * Les écritures sont maintenant enchaînées une par une (la dernière valeur
 * seulement), et chaque version porte sa date, comparée au chargement.
 */

export type ColonneDisposition = 'home_tiles' | 'home_root_slots';

export interface DispositionLue {
  items: unknown[] | null;
  /** Horodatage (ms) de la dernière écriture pour cette agence, si connu. */
  maj: number | null;
}

/** Relit la valeur d'une agence dans la colonne, quel que soit son format. */
export function lireDispositionAgence(colonne: unknown, agencyId: string): DispositionLue {
  if (!colonne || Array.isArray(colonne) || typeof colonne !== 'object') return { items: null, maj: null };
  const obj = colonne as Record<string, unknown>;
  // Ancien format : { agencyId, items }
  if (typeof obj.agencyId === 'string' && Array.isArray(obj.items)) {
    return { items: obj.agencyId === agencyId ? (obj.items as unknown[]) : null, maj: null };
  }
  const pour = obj[agencyId];
  const majs = obj._maj && typeof obj._maj === 'object' ? (obj._maj as Record<string, unknown>) : {};
  const maj = typeof majs[agencyId] === 'number' ? (majs[agencyId] as number) : null;
  return { items: Array.isArray(pour) ? (pour as unknown[]) : null, maj };
}

/** Clé localStorage de l'horodatage qui accompagne une clé de disposition. */
export const cleHorodatage = (cle: string) => `${cle}__maj`;

export function lireHorodatageLocal(cle: string): number | null {
  try {
    const v = Number(localStorage.getItem(cleHorodatage(cle)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function ecrireHorodatageLocal(cle: string, maj: number) {
  try { localStorage.setItem(cleHorodatage(cle), String(maj)); } catch { /* ignore */ }
}

interface EcritureEnAttente {
  userId: string;
  agencyId: string;
  valeur: unknown;
  maj: number;
  resolveurs: Array<(r: { error: { message: string } | null }) => void>;
}

// Une file par colonne : au plus une écriture en vol, et si plusieurs
// changements arrivent pendant qu'elle roule, seule la dernière valeur de
// chaque agence est écrite ensuite.
//
// Signalé (17/09/2026, famille du bug "les tuiles changent de place à la
// reconnexion") : le lot était indexé PAR AGENCE SEULE (`lot.get(agencyId)`)
// alors que la même file sert tout l'onglet navigateur. Sur un poste
// partagé, si le compte A avait une écriture en attente pour l'agence X
// quand le compte B (même agence, même onglet) en posait une aussi, la
// deuxième écrasait purement et simplement `userId`/`valeur` de la première
// dans la même entrée : la disposition de A ne partait jamais vers SA ligne
// `user_ui_settings`, silencieusement. Clé composite utilisateur+agence.
const clefLot = (userId: string, agencyId: string) => `${userId}::${agencyId}`;
const enVol: Partial<Record<ColonneDisposition, Promise<void>>> = {};
const enAttente: Partial<Record<ColonneDisposition, Map<string, EcritureEnAttente>>> = {};

async function ecrireMaintenant(colonne: ColonneDisposition, lot: Map<string, EcritureEnAttente>) {
  for (const e of lot.values()) {
    let resultat: { error: { message: string } | null } = { error: null };
    try {
      const { data } = await supabase
        .from('user_ui_settings')
        .select(colonne)
        .eq('user_id', e.userId)
        .maybeSingle();
      const actuel = (data as Record<string, unknown> | null)?.[colonne];
      const base: Record<string, unknown> =
        actuel && !Array.isArray(actuel) && typeof actuel === 'object'
          ? { ...(actuel as Record<string, unknown>) }
          : {};
      // Purge de l'ancien format au passage : ses deux clés parasiteraient
      // le dictionnaire.
      delete base.agencyId;
      delete base.items;
      const majs = base._maj && typeof base._maj === 'object' ? { ...(base._maj as Record<string, unknown>) } : {};
      const majServeur = typeof majs[e.agencyId] === 'number' ? (majs[e.agencyId] as number) : 0;
      // Une version plus récente est déjà là (autre appareil) : on ne la
      // recouvre pas avec une plus ancienne.
      if (majServeur > e.maj) {
        e.resolveurs.forEach((r) => r({ error: null }));
        continue;
      }
      base[e.agencyId] = e.valeur;
      majs[e.agencyId] = e.maj;
      base._maj = majs;
      const { error } = await supabase
        .from('user_ui_settings')
        .upsert({ user_id: e.userId, [colonne]: base } as any, { onConflict: 'user_id' });
      resultat = { error: error ? { message: error.message } : null };
    } catch (err) {
      resultat = { error: { message: (err as { message?: string })?.message || String(err) } };
    }
    e.resolveurs.forEach((r) => r(resultat));
  }
}

function vider(colonne: ColonneDisposition): Promise<void> {
  const lot = enAttente[colonne];
  if (!lot || lot.size === 0) { delete enVol[colonne]; return Promise.resolve(); }
  enAttente[colonne] = new Map();
  const p = ecrireMaintenant(colonne, lot).then(() => vider(colonne));
  enVol[colonne] = p;
  return p;
}

/**
 * Enregistre la disposition d'une agence côté serveur, sans jamais effacer
 * celle des autres agences. Les appels rapprochés sont fusionnés : seule la
 * dernière valeur part, une fois l'écriture précédente terminée.
 */
export function ecrireDispositionAgence(
  colonne: ColonneDisposition,
  userId: string,
  agencyId: string,
  valeur: unknown,
  maj: number,
): Promise<{ error: { message: string } | null }> {
  return new Promise((resolve) => {
    const lot = (enAttente[colonne] ??= new Map());
    const clef = clefLot(userId, agencyId);
    const existante = lot.get(clef);
    if (existante) {
      existante.valeur = valeur;
      existante.maj = Math.max(existante.maj, maj);
      existante.resolveurs.push(resolve);
    } else {
      lot.set(clef, { userId, agencyId, valeur, maj, resolveurs: [resolve] });
    }
    if (!enVol[colonne]) {
      // Petit délai : une rafale de changements (dossier créé puis rempli)
      // ne déclenche qu'une écriture.
      enVol[colonne] = new Promise<void>((r) => setTimeout(r, 300)).then(() => vider(colonne));
    }
  });
}
