import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

// Signalé (31/08/2026) : sur un Honor Magic V3 déplié, plus rien ne défilait
// dans la fiche client. Ce téléphone pliable mesure environ 800 px CSS de
// large une fois ouvert — il passe donc au-dessus du seuil de 768 px et
// l'application le traite comme un ordinateur de bureau, alors que c'est un
// écran tactile tenu à la main. Le verrou de défilement réservé au bureau
// (App.tsx, panneau Nova ouvert) s'appliquait donc à lui, sans molette ni
// autre moyen de s'en sortir.
//
// On ne touche pas au seuil de 768 px, qui gouverne toute la mise en page :
// le déplacer changerait l'affichage de tout le monde. On expose seulement
// la nature du pointeur, pour que les comportements qui n'ont de sens qu'à
// la souris puissent s'en tenir à la souris.
export function useIsCoarsePointer() {
  const [coarse, setCoarse] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener('change', onChange);
    setCoarse(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return coarse;
}
