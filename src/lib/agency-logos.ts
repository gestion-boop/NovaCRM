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
  "30f96ea9-41da-41c2-a95e-f5e7898f8d8e", // Conseils Finances
  "15157da9-71ea-4760-ae1c-3bc99d9caa20", // Immosphera
  "0cd9362c-316e-4b57-af0b-b6cea092961b", // Novavisio
  "all",
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

import { TEAM_MEMBERS } from "@/data/teamMembers";

// Sociétés qu'une personne peut choisir : cloisonnement strict par utilisateur.
// Seul le super_admin a accès aux 3 agences ; chaque autre utilisateur n'a accès qu'à son agence affectée.
export function agencesDisponibles<T extends { id: string }>(
  agencies: T[],
  profil: { role?: string; agencyIds?: string[]; email?: string | null; primaryAgencyId?: string } | null | undefined,
): T[] {
  const base = agencies.filter((ag) => ag.id !== 'all');
  if (!profil) return [];

  // Seul le super_admin accède à toutes les agences
  if (profil.role === 'super_admin') {
    const triees = sortByAgencyOrder(base);
    return triees.length > 0 ? triees : agencies.slice(0, 1);
  }

  // Cloisonnement strict pour chaque utilisateur :
  const userAgencyIds = new Set<string>();
  if (Array.isArray(profil.agencyIds) && profil.agencyIds.length > 0) {
    profil.agencyIds.forEach((id) => {
      if (id && id !== 'all') userAgencyIds.add(id);
    });
  }
  if (profil.primaryAgencyId && profil.primaryAgencyId !== 'all') {
    userAgencyIds.add(profil.primaryAgencyId);
  }

  // Si non renseigné dans le profil, déduire par email (domaine ou correspondance TEAM_MEMBERS)
  if (userAgencyIds.size === 0 && profil.email) {
    const emailNorm = profil.email.trim().toLowerCase();
    const teamMember = TEAM_MEMBERS.find((m) => m.email?.trim().toLowerCase() === emailNorm);
    if (teamMember?.agencyId && teamMember.agencyId !== 'all') {
      userAgencyIds.add(teamMember.agencyId);
    } else if (emailNorm.includes('immosphera')) {
      userAgencyIds.add('15157da9-71ea-4760-ae1c-3bc99d9caa20');
    } else if (emailNorm.includes('novavisio')) {
      userAgencyIds.add('0cd9362c-316e-4b57-af0b-b6cea092961b');
    } else if (emailNorm.includes('conseil') || emailNorm.includes('finance')) {
      userAgencyIds.add('30f96ea9-41da-41c2-a95e-f5e7898f8d8e');
    }
  }

  const autorisees = base.filter((ag) => userAgencyIds.has(ag.id));
  const triees = sortByAgencyOrder(autorisees);

  if (triees.length > 0) return triees;

  // Repli sécurisé : ne jamais tout ouvrir, repli sur la première agence autorisée
  return base.slice(0, 1);
}
