import { supabase } from '@/lib/supabase';

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

const CLE = 'novasphere_hidden_tiles_v1';

export interface TuileMasquee {
  id: string;
  [k: string]: unknown;
}

export function lireMasquees(): TuileMasquee[] {
  try {
    const brut = localStorage.getItem(CLE);
    const liste = brut ? (JSON.parse(brut) as unknown) : [];
    return Array.isArray(liste) ? (liste as TuileMasquee[]).filter((t) => t && typeof t.id === 'string') : [];
  } catch {
    return [];
  }
}

function ecrireMasquees(liste: TuileMasquee[]) {
  try {
    localStorage.setItem(CLE, JSON.stringify(liste));
  } catch {
    /* stockage indisponible : la copie serveur fait foi au prochain chargement */
  }
}

const fusionner = (a: TuileMasquee[], b: TuileMasquee[]): TuileMasquee[] => {
  const parId = new Map<string, TuileMasquee>();
  [...a, ...b].forEach((t) => { if (!parId.has(t.id)) parId.set(t.id, t); });
  return Array.from(parId.values());
};

async function ecrireSurServeur(userId: string, liste: TuileMasquee[]) {
  const { error } = await supabase
    .from('user_ui_settings')
    .upsert({ user_id: userId, hidden_tiles: liste } as any, { onConflict: 'user_id' });
  if (error) {
    // Colonne absente (migration pas encore passée) ou droits : on ne bloque
    // pas l'utilisateur, le navigateur garde la liste.
    console.warn('[tuiles masquées] synchronisation serveur impossible :', error.message);
  }
}

/**
 * Réunit la liste du navigateur et celle du compte, et met les deux à jour.
 * À appeler au chargement de l'accueil.
 */
export async function chargerMasqueesDepuisServeur(userId: string): Promise<TuileMasquee[]> {
  const locale = lireMasquees();
  try {
    const { data, error } = await supabase
      .from('user_ui_settings')
      .select('hidden_tiles')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    const serveur = Array.isArray((data as any)?.hidden_tiles) ? ((data as any).hidden_tiles as TuileMasquee[]) : [];
    const union = fusionner(locale, serveur);
    ecrireMasquees(union);
    // Si le navigateur en savait plus que le serveur, on le lui apprend.
    if (union.length !== serveur.length) await ecrireSurServeur(userId, union);
    return union;
  } catch (e: any) {
    console.warn('[tuiles masquées] lecture serveur impossible :', e?.message || e);
    return locale;
  }
}

export async function masquerTuile(userId: string | null | undefined, tuile: TuileMasquee): Promise<void> {
  const liste = fusionner(lireMasquees(), [tuile]);
  ecrireMasquees(liste);
  if (userId) await ecrireSurServeur(userId, liste);
}

export async function reafficherTuile(userId: string | null | undefined, id: string): Promise<void> {
  const liste = lireMasquees().filter((t) => t.id !== id);
  ecrireMasquees(liste);
  if (userId) await ecrireSurServeur(userId, liste);
}
