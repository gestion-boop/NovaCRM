import conseilsFinances from "@/assets/agency-conseils-finances.png";
import immosphera from "@/assets/agency-immosphera.png";
import novavisio from "@/assets/agency-novavisio.png";
import novasphere from "@/assets/novasphere-logo.png";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

export const getAgencyLogo = (name?: string | null): string => {
  if (!name) return novasphere;
  const n = norm(name);
  if (n.includes("conseil")) return conseilsFinances;
  if (n.includes("immosphera") || n.includes("immo")) return immosphera;
  if (n.includes("novavisio") || n.includes("visio")) return novavisio;
  return novasphere;
};

// Ticket #228 : ordre impos\u00e9 partout o\u00f9 l'agence se s\u00e9lectionne \u2014 NovaSphere
// ("all", vue consolid\u00e9e), Conseils Finances, ImmoSphera, NovaVisio.
export const AGENCY_ORDER = [
  "all",
  "30f96ea9-41da-41c2-a95e-f5e7898f8d8e", // Conseils Finances
  "15157da9-71ea-4760-ae1c-3bc99d9caa20", // Immosphera
  "0cd9362c-316e-4b57-af0b-b6cea092961b", // Novavisio
];

export function sortByAgencyOrder<T extends { id: string }>(agencies: T[]): T[] {
  return [...agencies].sort((a, b) => {
    const indexA = AGENCY_ORDER.indexOf(a.id);
    const indexB = AGENCY_ORDER.indexOf(b.id);
    const safeA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
    const safeB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
    return safeA - safeB;
  });
}

// Sociétés qu'une personne peut choisir : toutes (dont la vue « Toutes les
// sociétés ») pour un super admin, sinon celles de son profil. Même règle
// que le sélecteur du menu, partagée avec la barre de logos de l'en-tête.
export function agencesDisponibles<T extends { id: string }>(
  agencies: T[],
  profil: { role?: string; agencyIds?: string[] } | null | undefined,
): T[] {
  const base = !profil
    ? agencies
    : profil.role === 'super_admin' || profil.agencyIds?.includes('all')
      ? agencies
      : agencies.filter((ag) => (ag.id === 'all' ? false : profil.agencyIds?.includes(ag.id)));
  const triees = sortByAgencyOrder(base);
  return triees.length > 0 ? triees : agencies.slice(0, 1);
}
