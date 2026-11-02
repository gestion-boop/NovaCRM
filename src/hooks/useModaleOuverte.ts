import { useEffect, useState } from 'react';

// Vrai tant qu'une fenêtre plein écran (modale, panneau) est ouverte : une
// couche `position: fixed` qui couvre l'écran avec un z-index >= 40. Les
// fenêtres vivent dans <main> (contexte d'empilement z-[1]) et passaient
// donc SOUS les barres du bas ; on les masque pendant l'ouverture.
export function useModaleOuverte(): boolean {
  const [ouverte, setOuverte] = useState(false);

  useEffect(() => {
    let raf = 0;
    const verifier = () => {
      raf = 0;
      const l = window.innerWidth;
      const h = window.innerHeight;
      let trouvee = false;
      document.querySelectorAll<HTMLElement>('.fixed').forEach((el) => {
        if (trouvee || el.closest('[data-barre-bas]')) return;
        const st = window.getComputedStyle(el);
        if (st.position !== 'fixed' || st.display === 'none' || st.visibility === 'hidden') return;
        const z = parseInt(st.zIndex, 10);
        if (!Number.isFinite(z) || z < 40) return;
        const r = el.getBoundingClientRect();
        if (r.width >= l * 0.9 && r.height >= h * 0.9) trouvee = true;
      });
      setOuverte(trouvee);
    };
    const planifier = () => { if (!raf) raf = requestAnimationFrame(verifier); };
    const obs = new MutationObserver(planifier);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    planifier();
    return () => { obs.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return ouverte;
}
