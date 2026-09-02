// Assemblage du texte d'une dictée vocale (Web Speech API).
//
// Signalé le 2 septembre : « Natacha a plusieurs fois la même ligne » — la
// note contenait « j'ai / j'ai vu / j'ai vu le / j'ai vu le client... », soit
// chaque état intermédiaire de la phrase collé les uns derrière les autres.
//
// Cause : sur Android, Chrome ne se contente pas de compléter le segment en
// cours, il empile une NOUVELLE entrée marquée `isFinal` à chaque
// prolongement de la phrase. `event.results` contient donc « j'ai », puis
// « j'ai vu », puis « j'ai vu le »... et concaténer tous les segments
// définitifs — ce que fait la lecture classique de cette API, et ce que
// faisait NovaCRM — reconstruit exactement la répétition observée.
//
// On replie donc les segments qui se prolongent l'un l'autre : quand un
// segment commence par le précédent (ou l'inverse), on ne garde que le plus
// long. Deux phrases réellement différentes, elles, restent bien distinctes.

const normaliser = (valeur: string) =>
  valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Un segment prolonge-t-il l'autre (à la casse, aux accents et à la
 *  ponctuation près) ? */
const seProlongent = (a: string, b: string) => {
  const na = normaliser(a);
  const nb = normaliser(b);
  if (!na || !nb) return false;
  return na.startsWith(nb) || nb.startsWith(na);
};

/**
 * Reconstruit le texte complet d'une dictée en cours.
 *
 * @param results   `event.results` de l'API SpeechRecognition.
 * @param texteDeBase Ce qui était déjà saisi avant de lancer la dictée.
 */
export function assemblerDictee(results: any, texteDeBase = ''): string {
  const segments: string[] = [];
  let enCours = '';

  for (let i = 0; i < (results?.length ?? 0); i++) {
    const brut = String(results[i]?.[0]?.transcript ?? '').trim();
    if (!brut) continue;

    if (!results[i].isFinal) {
      // Les segments provisoires arrivent eux aussi en entier à chaque fois :
      // seul le dernier compte.
      enCours = brut;
      continue;
    }

    const precedent = segments[segments.length - 1];
    if (precedent && seProlongent(precedent, brut)) {
      // Même phrase, une version plus complète : on remplace au lieu d'ajouter.
      if (normaliser(brut).length >= normaliser(precedent).length) {
        segments[segments.length - 1] = brut;
      }
      continue;
    }
    segments.push(brut);
  }

  // Le segment en cours n'est souvent que la suite du dernier définitif :
  // l'ajouter tel quel redoublerait la fin de la phrase.
  const dernier = segments[segments.length - 1];
  if (enCours && dernier && seProlongent(dernier, enCours)) {
    if (normaliser(enCours).length > normaliser(dernier).length) {
      segments[segments.length - 1] = enCours;
    }
    enCours = '';
  }

  return [texteDeBase.trim(), ...segments, enCours]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
