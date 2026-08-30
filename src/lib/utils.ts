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
