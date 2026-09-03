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
export const couleurNovavisio = (deal: Pick<Deal, 'agencyId' | 'stage' | 'signedAt'>): string | null => {
  if (!matchesAgency(deal.agencyId || '', NOVAVISIO_AGENCY_ID)) return null;
  if (deal.signedAt) return COULEURS_NOVAVISIO.vert;
  const nom = sansAccentsMin(deal.stage || '');
  if (nom.includes('attente')) return COULEURS_NOVAVISIO.orange;
  if (nom.includes('sign')) return COULEURS_NOVAVISIO.vert;
  if (nom.includes('discussion') || nom.includes('negoci') || nom.includes('echange')) return COULEURS_NOVAVISIO.jaune;
  if (nom.includes('contact') || nom.includes('nouveau')) return COULEURS_NOVAVISIO.bleu;
  return null;
};
export const estEtapeSigneeNovavisio = (nomEtape: string) => {
  const nom = sansAccentsMin(nomEtape || '');
  return nom.includes('sign') && !nom.includes('attente');
};

