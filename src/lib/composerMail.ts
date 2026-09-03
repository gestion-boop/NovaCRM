// Demande de Sylvain (3 septembre) : un clic sur une adresse e-mail dans le
// CRM (fiche client, listes Clients et Contacts) doit ouvrir la boîte Mail
// du CRM, pas l'application mail du poste. Un événement global évite de
// faire remonter un rappel de fonction dans chaque écran ; App.tsx l'écoute
// et ouvre Mail avec le destinataire pré-rempli.
export const EVENEMENT_COMPOSER_MAIL = 'nova:composer-mail';

export function ouvrirMailCrm(email: string) {
  const adresse = (email || '').trim();
  if (!adresse) return;
  window.dispatchEvent(new CustomEvent(EVENEMENT_COMPOSER_MAIL, { detail: { email: adresse } }));
}

/** Gestionnaire prêt à poser sur un lien mailto: ouvre Mail du CRM à la place. */
export function clicMailCrm(email: string) {
  return (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    ouvrirMailCrm(email);
  };
}
