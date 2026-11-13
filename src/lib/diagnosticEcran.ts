// Aide au dépannage : ouvrir l'appli avec `?diag=ecran` affiche en haut de
// l'écran les dimensions réelles vues par le navigateur (largeur de la page,
// de l'écran, zoom…). Sert à comprendre un affichage décalé sur un appareil
// pliable ; sans ce paramètre, rien n'est affiché.
export function installerDiagnosticEcran(): void {
  try {
    if (!/[?&]diag=ecran\b/.test(window.location.search)) return;
    const boite = document.createElement('pre');
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
