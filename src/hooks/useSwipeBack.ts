import { useEffect, useRef } from 'react';

// Demande explicite (24 octobre) : « sur mobile, quand on est dans un
// dossier ou une autre fenêtre, swiper vers la droite doit revenir à
// l'écran précédent, comme sur les téléphones ». Geste calqué sur le
// edge-swipe iOS : il ne se déclenche que si le doigt se pose près du
// bord GAUCHE de l'écran (sinon tout balayage horizontal ailleurs dans le
// contenu — pipeline, listes, carrousels — serait intercepté), puis se
// valide dès que le mouvement est nettement horizontal et dépasse un
// seuil de distance (pas d'attente du relâchement, pour rester réactif).
//
// Volontairement pas de suivi visuel du doigt (pas de translateX en
// direct) : juste un déclenchement net une fois le geste reconnu. Plus
// simple et plus sûr qu'une animation à reproduire à l'identique sur 6
// écrans différents, et ça reste fidèle à la demande (« revienne sur la
// fenêtre précédente »).
//
// Écouteurs tactiles passifs partout (jamais de preventDefault) : le
// défilement vertical natif n'est donc jamais bloqué. Les zones qui ont
// déjà leur propre geste horizontal (barre de pipeline, grille
// réordonnable au glisser-déposer, etc.) doivent être marquées avec
// l'attribut `data-swipe-back-exclude` sur leur conteneur : un doigt posé
// dedans ne déclenche jamais ce geste de retour.
const EDGE_ZONE_PX = 24;
const COMMIT_DISTANCE_PX = 80;
const AXIS_LOCK_PX = 10;

export function useSwipeBack<T extends HTMLElement>(
  onBack: (() => void) | null | undefined,
  enabled: boolean,
) {
  const ref = useRef<T | null>(null);
  // Signalé en revue (25 octobre, chasse aux bugs) : `onBack` est presque
  // toujours une fonction fléchée recréée à chaque rendu du composant
  // appelant (ex. AccueilGrid, ChatViewSupabase, ou simplement parce que
  // App.tsx se re-rend pour une raison sans rapport). Tant que l'effet
  // ci-dessous dépendait directement de `onBack`, le moindre re-rendu
  // PENDANT un geste en cours (minuteur, compteur temps réel, sondage...)
  // désabonnait puis réabonnait les écouteurs — React recrée alors
  // `tracking`/`axis`/`startX`/`startY` à leur valeur initiale, mais le
  // doigt reste posé sur le MÊME nœud DOM : seuls touchmove/touchend
  // continuent d'arriver (touchstart ne se redéclenche pas), et le nouvel
  // écouteur les ignore (`!tracking`). Le retour ne se déclenche donc pas,
  // sans aucun signe visible — un bug intermittent qui semblait aléatoire.
  // Gardé dans une ref mise à jour à CHAQUE rendu (jamais dans l'effet),
  // pour que celui-ci n'ait plus besoin de dépendre de la référence de la
  // fonction elle-même.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let tracking = false;
    let committed = false;
    let axis: 'x' | 'y' | null = null;
    let startX = 0;
    let startY = 0;

    const reset = () => {
      tracking = false;
      committed = false;
      axis = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      // Signalé en revue : remis à zéro AVANT tout retour anticipé —
      // sans ça, un geste commencé sur un élément retiré du DOM en cours
      // de route (qui ne reçoit alors ni touchend ni touchcancel, voir le
      // comportement documenté de Touch.target) pouvait laisser
      // `tracking` bloqué à `true` ; un toucher totalement différent,
      // plus tard, loin du bord gauche, déclenchait alors onBack à tort
      // dès qu'il dépassait la distance de validation.
      reset();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX > EDGE_ZONE_PX) return;
      if ((e.target as HTMLElement | null)?.closest('[data-swipe-back-exclude]')) return;
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || committed) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (axis === null) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis === 'y') { tracking = false; return; }
      }

      if (axis !== 'x' || dx <= 0) return;
      if (dx >= COMMIT_DISTANCE_PX) {
        committed = true;
        tracking = false;
        onBackRef.current?.();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', reset, { passive: true });
    el.addEventListener('touchcancel', reset, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', reset);
      el.removeEventListener('touchcancel', reset);
    };
  }, [enabled]);

  return ref;
}

export default useSwipeBack;
