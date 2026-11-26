import { supabase } from '@/lib/supabase';

/**
 * Projets internes épinglés par l'utilisateur, suivis sur son COMPTE.
 *
 * Signalé : « quand j'épingle dans les projets, ça ne se sauvegarde pas ».
 * L'épingle n'était gardée que dans le navigateur (localStorage) : sur un
 * autre appareil, dans l'appli installée, ou après un nettoyage du
 * navigateur, elle avait disparu.
 *
 * Elle est maintenant aussi enregistrée côté compte, dans la colonne
 * existante user_ui_settings.hidden_tiles, sous une clé réservée
 * (`__epingles_projets`) : aucune migration de base n'est nécessaire, et les
 * autres usages de la colonne (tuiles masquées par société) ne la touchent
 * pas. Le navigateur reste la copie instantanée.
 */

const CLE_SERVEUR = '__epingles_projets';

const valides = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const objetDepuis = (brut: unknown): Record<string, unknown> =>
  Array.isArray(brut) ? { __ancienne: brut } : brut && typeof brut === 'object' ? { ...(brut as Record<string, unknown>) } : {};

async function lireBrut(userId: string): Promise<unknown> {
  const { data, error } = await supabase
    .from('user_ui_settings')
    .select('hidden_tiles')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as any)?.hidden_tiles ?? null;
}

async function ecrire(userId: string, brut: unknown, liste: string[]) {
  const base = objetDepuis(brut);
  if (base._v === undefined) base._v = 2;
  base[CLE_SERVEUR] = liste;
  const { error } = await supabase
    .from('user_ui_settings')
    .upsert({ user_id: userId, hidden_tiles: base } as any, { onConflict: 'user_id' });
  if (error) console.warn('[épingles projets] synchronisation serveur impossible :', error.message);
}

/**
 * Liste du compte si elle existe ; sinon la copie du navigateur est
 * poussée au compte (première synchro). En cas d'échec réseau : `null`
 * (l'appelant garde la copie locale).
 */
export async function chargerEpinglesDepuisServeur(userId: string, locales: string[]): Promise<string[] | null> {
  try {
    const brut = await lireBrut(userId);
    const o = objetDepuis(brut);
    if (Array.isArray(o[CLE_SERVEUR])) return valides(o[CLE_SERVEUR]);
    if (locales.length > 0) await ecrire(userId, brut, locales);
    return locales;
  } catch (e: any) {
    console.warn('[épingles projets] lecture serveur impossible :', e?.message || e);
    return null;
  }
}

/** Enregistre la liste complète au compte (relit juste avant pour ne rien écraser d'autre). */
export async function enregistrerEpinglesSurServeur(userId: string, liste: string[]): Promise<void> {
  try {
    const brut = await lireBrut(userId).catch(() => null);
    await ecrire(userId, brut, liste);
  } catch (e: any) {
    console.warn('[épingles projets] enregistrement impossible :', e?.message || e);
  }
}
