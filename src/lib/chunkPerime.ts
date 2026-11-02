import { figerDispositionAvantMiseAJour } from '@/lib/dispositionAccueil';

// Après un déploiement, une page restée ouverte (ou servie depuis un cache)
// demande des fichiers d'écran dont le nom a changé : le chargement échoue et
// l'écran affiche « Cet écran a rencontré un problème ». Un rechargement
// complet récupère les nouveaux fichiers ; on le fait une seule fois par
// minute au plus, pour ne jamais boucler.
const CLE = 'novasphere:chunk-reload-at';

export const estErreurChunk = (err: unknown): boolean => {
  const msg = String((err as { message?: string } | null)?.message || err || '');
  return /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|error loading dynamically/i.test(msg);
};

export function rechargerSiChunkPerime(): boolean {
  try {
    const dernier = Number(sessionStorage.getItem(CLE) || 0);
    if (Date.now() - dernier < 60_000) return false;
    sessionStorage.setItem(CLE, String(Date.now()));
  } catch { /* stockage indisponible : on tente quand même */ }
  figerDispositionAvantMiseAJour()
    .catch(() => {})
    .finally(() => window.location.reload());
  return true;
}
