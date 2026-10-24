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

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !onBack) return;

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
      if (e.touches.length !== 1) { reset(); return; }
      const touch = e.touches[0];
      if (touch.clientX > EDGE_ZONE_PX) return;
      if ((e.target as HTMLElement | null)?.closest('[data-swipe-back-exclude]')) return;
      tracking = true;
      committed = false;
      axis = null;
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
        onBack();
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
  }, [onBack, enabled]);

  return ref;
}

export default useSwipeBack;
