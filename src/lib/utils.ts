import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

// Demandé le 6 septembre : « concernant les chiffres des commissions
// Banque, je veux que tu respectes la virgule avec les deux décimales
// après, n'arrondis pas » — contrairement à formatCurrency (arrondi à
// l'euro), toujours deux décimales exactes pour la commission Banque.
export function formatCurrencyPrecis(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
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

/**
 * Ouvre dans un nouvel onglet une pièce jointe de message stockée en data
 * URL (photo, PDF — voir ChatViewSupabase.tsx, ClientProfileView.tsx,
 * InternalProjectBoard.tsx : pas d'upload Storage séparé, le fichier vit
 * directement dans la ligne du message).
 *
 * Signalé le 5 octobre : « les pdfs que j'ai inséré ne s'ouvre pas ». Un
 * simple <a href="data:...;base64,..." target="_blank"> échoue en
 * silence sur plusieurs navigateurs (Safari/iOS en tête) dès que l'URL
 * dépasse quelques centaines de ko — un PDF de quelques Mo en base64 y
 * arrive en quelques secondes. La reconversion en Blob puis en URL
 * `blob:` (bien plus courte, sans cette limite) avant l'ouverture est la
 * façon fiable de procéder, cross-navigateur.
 */
export async function ouvrirPieceJointe(dataUrl: string): Promise<void> {
  try {
    const reponse = await fetch(dataUrl);
    const blob = await reponse.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
    // Laisse le temps au nouvel onglet de charger le contenu avant de
    // libérer la mémoire : un retrait immédiat casse l'ouverture sur
    // certains navigateurs, qui chargent la ressource de façon différée.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch {
    // Au pire, ouverture directe de la data URL — le comportement d'avant
    // ce correctif, toujours mieux que rien si fetch() échoue.
    window.open(dataUrl, '_blank', 'noopener,noreferrer');
  }
}
