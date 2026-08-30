/**
 * Confettis en fond du bandeau d'annonce "Succès" (voir AnnouncementBanner —
 * association corrigée : "le succès c'est confettis et signature de l'acte
 * c'est feu d'artifice"), tant que le panneau reste ouvert.
 *
 * Vidéo fournie par l'utilisateur ("ordinateur version" + réutilisée telle
 * quelle sur mobile, aucun fichier confetti dédié au mobile fourni pour
 * l'instant). autoPlay+muted+playsInline+loop : requis par les navigateurs
 * pour une lecture automatique en fond sans interaction.
 */
const ConfettiOverlay = () => {
  return (
    <video
      src="/nova/effects/confetti.mp4"
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
      className="fixed inset-0 z-0 w-full h-full object-cover pointer-events-none"
    />
  );
};

export default ConfettiOverlay;
