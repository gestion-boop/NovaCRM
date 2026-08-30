/**
 * Feu d'artifice en fond du bandeau d'annonce "Signature d'un acte" (voir
 * AnnouncementBanner — association corrigée : "le succès c'est confettis et
 * signature de l'acte c'est feu d'artifice"), tant que le panneau reste
 * ouvert.
 *
 * Nouvelle vidéo fournie ("Feu d'artifices Desktop") — demande explicite :
 * "prends-le pour mobile aussi, on va tester" — même fichier sur les deux,
 * anciens fichiers (gif + vidéos précédentes) supprimés. autoPlay+muted+
 * playsInline+loop : requis par les navigateurs pour une lecture
 * automatique en fond sans interaction.
 */
const FireworksOverlay = () => {
  return (
    <video
      src="/nova/effects/feu-artifice-desktop.mp4"
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
      className="fixed inset-0 z-0 w-full h-full object-cover pointer-events-none"
    />
  );
};

export default FireworksOverlay;
