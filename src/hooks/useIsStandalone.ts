// Détection "application installée" (PWA en display-mode standalone, ou
// l'équivalent iOS `navigator.standalone`), déjà utilisée telle quelle dans
// NotificationsView.tsx pour l'invite "ajouter à l'écran d'accueil".
// Extraite ici pour être réutilisée ailleurs (ex. la barre d'onglets, visible
// uniquement dans l'app installée — voir App.tsx) sans dupliquer le calcul.
// Un simple calcul direct suffit : contrairement à la taille d'écran, le
// display-mode ne change jamais en cours de session (il faudrait désinstaller
// puis rouvrir l'app) — pas besoin d'état ni d'écouteur.
export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}
