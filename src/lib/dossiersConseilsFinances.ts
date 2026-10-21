// Dossiers « Banques » et « Assurances » : réservés à l'agence Conseils
// Finances. Ils sont créés comme des dossiers ordinaires (verrous stockés par
// agence dans agency_ui_settings) ; aucune autre agence ne doit les voir ni
// les ouvrir, quel que soit le rôle (super admin compris) — seule compte
// l'agence ACTIVE, comme pour Immosphera 360.

const sansCasse = (v: string) =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const estAgenceConseilsFinances = (
  a: { name?: string | null; slug?: string | null } | null | undefined,
) => /conseil|finance/i.test(a?.name ?? '') || /conseil|finance/i.test(a?.slug ?? '');

/** Vrai pour un dossier/tuile dont le titre est « Banques » ou « Assurances ». */
export const estDossierReserveConseilsFinances = (titre: string | null | undefined) =>
  /^(banques?|assurances?)$/.test(sansCasse(titre ?? ''));
