// Aide au dépannage : ouvrir l'appli avec `?diag=ecran` affiche en haut de
// l'écran les dimensions réelles vues par le navigateur (largeur de la page,
// de l'écran, zoom…). Sert à comprendre un affichage décalé sur un appareil
// pliable ; sans ce paramètre, rien n'est affiché. Appelé uniquement pour
// Sylvain Grazia (voir App.tsx).
/** Affiche ou masque le bandeau depuis l'appli (sans passer par l'adresse). */
export function basculerDiagnosticEcran(): boolean {
  try {
    const present = !!document.getElementById('nv-diag-ecran');
    if (present) {
      document.getElementById('nv-diag-ecran')?.remove();
      localStorage.removeItem('nv-diag-ecran');
      return false;
    }
    localStorage.setItem('nv-diag-ecran', '1');
    installerDiagnosticEcran();
    return true;
  } catch {
    return false;
  }
}

export function installerDiagnosticEcran(): void {
  try {
    // Le paramètre est mémorisé : une redirection (connexion…) peut le retirer de l'adresse.
    if (/[?&]diag=off\b/.test(window.location.search)) { localStorage.removeItem('nv-diag-ecran'); return; }
    if (/[?&]diag=ecran\b/.test(window.location.search)) localStorage.setItem('nv-diag-ecran', '1');
    if (localStorage.getItem('nv-diag-ecran') !== '1') return;
    if (document.getElementById('nv-diag-ecran')) return;
    const boite = document.createElement('pre');
    boite.id = 'nv-diag-ecran';
    boite.style.cssText =
      'position:fixed;top:0;left:0;z-index:2147483647;margin:0;padding:6px 8px;max-width:100%;font:11px/1.35 monospace;color:#fff;background:rgba(190,24,93,.92);white-space:pre-wrap;pointer-events:none';
    const maj = () => {
      const v = window.visualViewport;
      const racine = document.documentElement;
      boite.textContent = [
        `innerWidth × innerHeight : ${window.innerWidth} × ${window.innerHeight}`,
        `visualViewport : ${v ? `${Math.round(v.width)} × ${Math.round(v.height)} (zoom ${v.scale.toFixed(2)})` : 'n/a'}`,
        `clientWidth (html) : ${racine.clientWidth} · scrollWidth : ${racine.scrollWidth}`,
        `screen : ${screen.width} × ${screen.height} · dpr : ${window.devicePixelRatio}`,
        `mode : ${window.matchMedia('(display-mode: standalone)').matches ? 'appli installée' : 'navigateur'}`,
        `agent : ${navigator.userAgent}`,
      ].join('\n');
    };
    maj();
    window.addEventListener('resize', maj);
    window.visualViewport?.addEventListener('resize', maj);
    document.body.appendChild(boite);
  } catch {
    /* sans effet */
  }
}
