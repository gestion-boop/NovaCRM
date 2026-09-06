import type { Deal } from '@/types';
import { matchesAgency } from '@/hooks/useContacts';

// Code couleur Novavisio (Natacha, 3 septembre), sur les cartes du pipeline :
//   vert   : devis signé — et la carte reste verte si elle intègre ensuite
//            le pipeline officiel (leads.signed_at fait foi, pas l'étape) ;
//   orange : en attente de signature ;
//   jaune  : prospect en discussion ;
//   bleu   : prise de contact — la couleur par défaut d'une fiche créée.
// La couleur se lit dans le NOM de l'étape, pour suivre les pipelines tels
// que Natacha les nomme, sans rien coder en dur sur des identifiants.
const NOVAVISIO_AGENCY_ID = '0cd9362c-316e-4b57-af0b-b6cea092961b';
const COULEURS_NOVAVISIO = { vert: '#22C55E', orange: '#F97316', jaune: '#FACC15', bleu: '#3B82F6' } as const;
const sansAccentsMin = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Couleur portée par le NOM d'une étape (colonne ou carte), sans regarder
// le dossier. Sert aussi à teinter la colonne elle-même, pour que la
// colonne « En attente signature devis » et ses cartes soient orange
// ensemble — avant, la colonne prenait une couleur de palette (la 3e était
// verte), ce qui faisait passer un dossier en attente pour signé.
export const couleurEtapeNovavisio = (nomEtape: string | null | undefined): string | null => {
  const nom = sansAccentsMin(nomEtape || '');
  if (nom.includes('attente')) return COULEURS_NOVAVISIO.orange;
  // « facture » : le dossier est déjà signé, il est même allé plus loin
  // (facturé) — sans ce mot-clé, ces fiches sortaient du décompte « Signé »
  // affiché tout en haut de la carte, alors qu'elles ont bien une adresse
  // localisée (constaté le 6 septembre : 59 adresses sur la carte contre 52
  // seulement dans les 4 pastilles de filtre, l'écart venant de là).
  if (nom.includes('sign') || nom.includes('factur')) return COULEURS_NOVAVISIO.vert;
  if (nom.includes('discussion') || nom.includes('negoci') || nom.includes('echange')) return COULEURS_NOVAVISIO.jaune;
  if (nom.includes('contact') || nom.includes('nouveau')) return COULEURS_NOVAVISIO.bleu;
  return null;
};
// Catégorie du code couleur portée par le nom d'une étape — pour les filtres
// de la carte de prospection (relancer par couleur).
export type CategorieNovavisio = 'signe' | 'attente' | 'discussion' | 'contact';
export const categorieEtapeNovavisio = (nomEtape: string | null | undefined): CategorieNovavisio | null => {
  const nom = sansAccentsMin(nomEtape || '');
  if (nom.includes('attente')) return 'attente';
  if (nom.includes('sign') || nom.includes('factur')) return 'signe';
  if (nom.includes('discussion') || nom.includes('negoci') || nom.includes('echange')) return 'discussion';
  if (nom.includes('contact') || nom.includes('nouveau')) return 'contact';
  return null;
};
export const estAgenceNovavisio = (agencyId: string | null | undefined) => matchesAgency(agencyId || '', NOVAVISIO_AGENCY_ID);
export const couleurNovavisio = (deal: Pick<Deal, 'agencyId' | 'stage' | 'signedAt'>): string | null => {
  if (!estAgenceNovavisio(deal.agencyId)) return null;
  // Le NOM de l'étape prime : un dossier rangé dans « En attente signature
  // devis » est orange même s'il a déjà été marqué signé un jour (archivage,
  // passage par « Signé » puis retour en arrière). Le marqueur signed_at
  // ne joue que pour les étapes sans mot-clé — celles du pipeline officiel —
  // afin que la carte y reste verte.
  const parNom = couleurEtapeNovavisio(deal.stage);
  if (parNom) return parNom;
  if (deal.signedAt) return COULEURS_NOVAVISIO.vert;
  return null;
};
export const estEtapeSigneeNovavisio = (nomEtape: string) => {
  const nom = sansAccentsMin(nomEtape || '');
  return nom.includes('sign') && !nom.includes('attente');
};

