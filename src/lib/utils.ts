import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}


/**
 * Taux de TVA appliqué aux commissions saisies TTC.
 *
 * Les conseillers saisissent leur commission TTC ; les colonnes du pipeline
 * et les statistiques l'affichent hors taxes. La conversion se fait à
 * l'affichage et non au stockage : le montant saisi reste celui que le
 * conseiller a sous les yeux, et un changement de taux ne réécrit pas
 * l'historique.
 */
export const TVA_RATE = 0.2;

export function htDepuisTtc(ttc?: number | null): number {
  if (ttc === null || ttc === undefined || Number.isNaN(Number(ttc))) return 0;
  return Number(ttc) / (1 + TVA_RATE);
}

/**
 * La commission de l'agence est STOCKÉE en HT — les montants déjà saisis le
 * sont, et les statistiques s'appuient dessus : les réécrire fausserait
 * l'historique. La fiche client, elle, se saisit et s'affiche en TTC. La
 * conversion se fait donc aux deux bords du formulaire, jamais en base.
 */
export function ttcDepuisHt(ht?: number | null): number {
  if (ht === null || ht === undefined || Number.isNaN(Number(ht))) return 0;
  return Number(ht) * (1 + TVA_RATE);
}


/**
 * Met une majuscule à chaque mot d'un nom de ville.
 *
 * Demandé : « quand je remplis le secteur, je veux qu'il y ait toujours une
 * majuscule sur la première lettre ». Les villes étaient saisies au fil de
 * l'eau ("quarante", "blagnac", "SIGEAN"), ce qui donnait un affichage
 * incohérent dans les fiches et dans le détail des statistiques.
 *
 * Les traits d'union et les apostrophes comptent comme des séparateurs
 * (Saint-Jean, L'Isle), et les particules restent en minuscules.
 */
const PARTICULES = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'sur', 'sous', 'en', 'et', 'aux', 'au', 'lès', 'd', 'l']);

export function formatVille(value: string): string {
  if (!value) return '';
  return value
    .toLocaleLowerCase('fr')
    .replace(/([^\s'-]+)/g, (mot, _m, index) => {
      if (index > 0 && PARTICULES.has(mot)) return mot;
      return mot.charAt(0).toLocaleUpperCase('fr') + mot.slice(1);
    });
}
