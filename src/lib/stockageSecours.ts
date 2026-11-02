// Quand le stockage du navigateur (localStorage, ~5 Mo) est plein, toute
// écriture échoue (« exceeded the quota ») et des écrans entiers refusent de
// se charger. On libère alors d'abord ce qui se reconstruit tout seul, puis
// on retente l'écriture une fois. Les tailles sont tracées dans la console
// pour identifier ce qui remplit le stockage.
const JETABLES_EXACTS = [
  'novasphere_frozen_layout_snapshot_v1', // copie de secours de la disposition (refaite à chaque mise à jour)
  'novasphere_hidden_tiles_v1', // ancienne liste commune, remplacée par la liste par société (v2)
];
const JETABLES_PREFIXES = ['novasphere_home_tiles_v3_anon', 'novasphere_home_slots_v5_anon'];

const estQuota = (e: unknown) =>
  e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);

function tracerTailles() {
  try {
    const lignes: Array<[string, number]> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) lignes.push([k, (localStorage.getItem(k) || '').length]);
    }
    lignes.sort((a, b) => b[1] - a[1]);
    console.warn('[stockage plein] plus grosses clés :', lignes.slice(0, 8).map(([k, n]) => `${k} (${Math.round(n / 1024)} Ko)`));
  } catch { /* ignore */ }
}

function liberer(): number {
  let libere = 0;
  const retirer = (k: string) => {
    try { libere += (localStorage.getItem(k) || '').length; localStorage.removeItem(k); } catch { /* ignore */ }
  };
  JETABLES_EXACTS.forEach(retirer);
  const cles: string[] = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) cles.push(k); }
  cles.forEach((k) => {
    if (JETABLES_PREFIXES.some((p) => k.startsWith(p))) retirer(k);
    // Horodatage orphelin (sa clé principale n'existe plus).
    else if (k.endsWith('__maj') && localStorage.getItem(k.slice(0, -5)) === null) retirer(k);
  });
  return libere;
}

let installe = false;
export function installerStockageSecours() {
  if (installe || typeof Storage === 'undefined') return;
  installe = true;
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (cle: string, valeur: string) {
    try {
      return original.call(this, cle, valeur);
    } catch (e) {
      if (this !== window.localStorage || !estQuota(e)) throw e;
      tracerTailles();
      liberer();
      return original.call(this, cle, valeur); // 2e échec : l'erreur remonte comme avant
    }
  };
}
