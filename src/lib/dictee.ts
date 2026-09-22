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

/** Replie les segments définitifs d'UN évènement `results` entre eux (voir
 *  le commentaire en tête de fichier), et isole le segment provisoire en
 *  cours. Utilisé par `assemblerDictee` et par `creerAccumulateurDictee`. */
function replierSegmentsFinaux(results: any): { segmentsFinaux: string[]; enCours: string } {
  const segmentsFinaux: string[] = [];
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

    const precedent = segmentsFinaux[segmentsFinaux.length - 1];
    if (precedent && seProlongent(precedent, brut)) {
      // Même phrase, une version plus complète : on remplace au lieu d'ajouter.
      if (normaliser(brut).length >= normaliser(precedent).length) {
        segmentsFinaux[segmentsFinaux.length - 1] = brut;
      }
      continue;
    }
    segmentsFinaux.push(brut);
  }

  return { segmentsFinaux, enCours };
}

/**
 * Reconstruit le texte complet d'une dictée en cours.
 *
 * @param results   `event.results` de l'API SpeechRecognition.
 * @param texteDeBase Ce qui était déjà saisi avant de lancer la dictée.
 */
export function assemblerDictee(results: any, texteDeBase = ''): string {
  const { segmentsFinaux: segments, enCours: enCoursInitial } = replierSegmentsFinaux(results);
  let enCours = enCoursInitial;

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

// Signalé le 22 septembre : « les mots apparaissent puis disparaissent » — en
// rédigeant une note à la voix, quelques mots s'affichaient bien, puis la
// case se vidait partiellement (ou entièrement) en cours de dictée.
//
// Cause : `assemblerDictee` ci-dessus reconstruit TOUT le texte à partir du
// seul `event.results` de l'évènement en cours — ce qui suppose que ce
// dernier contient l'historique complet de la session depuis son début. Or
// certains navigateurs (Chrome mobile notamment) ne le garantissent pas :
// un redémarrage interne du moteur de reconnaissance peut faire repartir
// `results` sans les segments déjà validés, et l'aperçu provisoire peut lui
// aussi redevenir vide le temps d'un évènement. Dans les deux cas, la note
// affichée perdait ce qui avait déjà été dicté.
//
// `creerAccumulateurDictee` corrige ça en retenant elle-même, d'une session
// à l'autre, les segments déjà confirmés (`segments`) : chaque évènement ne
// peut plus que les prolonger ou en ajouter de nouveaux, jamais en faire
// disparaître. Seul l'aperçu (segment pas encore définitif) reste, à raison,
// volatile — c'est lui qui donne le rendu "en direct" de la dictée.
/**
 * Crée un accumulateur pour une session de dictée en continu.
 *
 * Contrairement à `assemblerDictee` (sans état, à appeler avec l'historique
 * complet supposé présent dans `results`), la fonction retournée ici garde
 * elle-même la trace de ce qui a déjà été confirmé : appelez-la à chaque
 * `onresult` avec le `results` de l'évènement, elle renvoie le texte complet
 * (confirmé + aperçu de la phrase en cours) à afficher.
 *
 * @param texteInitial Ce qui était déjà saisi avant de lancer la dictée.
 */
export function creerAccumulateurDictee(texteInitial = '') {
  const base = texteInitial.trim();
  // Segments définitifs déjà confirmés, dans l'ordre. Ne peut que grandir :
  // soit un segment existant est remplacé par une version plus longue de
  // lui-même, soit un nouveau segment est ajouté à la fin — jamais retiré.
  const segments: string[] = [];
  // Position dans `segments` à laquelle correspond l'indice 0 du prochain
  // `results` reçu. Reste à 0 tant que le navigateur renvoie un historique
  // cumulatif ; avancée dès que ce n'est plus le cas (voir plus bas), pour
  // continuer à comparer les segments correspondants entre eux.
  let decalage = 0;
  // Dernier aperçu non vide affiché, pour ne pas faire clignoter la case si
  // un évènement isolé renvoie un aperçu momentanément vide sans qu'aucune
  // phrase n'ait pourtant été validée entre-temps (l'utilisateur, lui, n'a
  // pas arrêté de parler).
  let dernierApercuNonVide = '';

  return function accumuler(results: any): string {
    const { segmentsFinaux, enCours: enCoursBrut } = replierSegmentsFinaux(results);
    let enCours = enCoursBrut;

    // Fait correspondre les segments définitifs de cet évènement à ceux déjà
    // connus, à partir de `decalage`. Soit ils se prolongent (on avance, en
    // gardant la version la plus longue), soit ils divergent : signe que
    // l'historique renvoyé par le navigateur ne remonte plus aussi loin que
    // ce qu'on avait déjà retenu.
    let k = 0;
    while (decalage + k < segments.length && k < segmentsFinaux.length) {
      const ancien = segments[decalage + k];
      const nouveau = segmentsFinaux[k];
      if (ancien !== nouveau) {
        if (!seProlongent(ancien, nouveau)) break;
        if (normaliser(nouveau).length > normaliser(ancien).length) {
          segments[decalage + k] = nouveau;
        }
      }
      k++;
    }

    // Sortie par divergence (et non parce qu'une des deux listes est
    // épuisée) : ce qui suit dans `segmentsFinaux` est une suite entièrement
    // nouvelle, qui vient s'ajouter APRÈS tout ce qui est déjà confirmé —
    // jamais à sa place.
    const divergence = decalage + k < segments.length && k < segmentsFinaux.length;
    if (divergence) {
      decalage = segments.length - k;
    }

    let changement = false;
    for (; k < segmentsFinaux.length; k++) {
      segments.push(segmentsFinaux[k]);
      changement = true;
    }

    if (changement) {
      dernierApercuNonVide = '';
    }
    if (enCours) {
      dernierApercuNonVide = enCours;
    } else if (!changement) {
      enCours = dernierApercuNonVide;
    }

    const confirme = [base, ...segments].filter(Boolean).join(' ');
    const dernierSegment = segments[segments.length - 1] || '';

    let baseAffichee = confirme;
    let apercu = '';
    if (enCours) {
      if (dernierSegment && seProlongent(dernierSegment, enCours)) {
        if (normaliser(enCours).length > normaliser(dernierSegment).length) {
          // L'aperçu est une version plus complète du dernier segment déjà
          // confirmé (le moteur revoit la fin de la phrase avant de la
          // refinaliser) : on l'affiche à sa place, sans dupliquer la fin de
          // phrase — sans toucher à `segments`, qui reste la seule source de
          // vérité tant que ce n'est pas redevenu définitif.
          baseAffichee = confirme.slice(0, confirme.length - dernierSegment.length).trim();
          apercu = enCours;
        }
        // Sinon : aperçu plus court ou égal au segment déjà confirmé —
        // redondant, on ne l'affiche pas.
      } else {
        apercu = enCours;
      }
    }

    return [baseAffichee, apercu].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };
}
