// Logique métier centralisée du consentement client (NovaSphere V1).
// Un consentement est signé une seule fois, valable exactement 1 an.

export type ConsentStatus = "validated" | "partial" | "refused" | "sent" | "pending";

export interface ConsentRecord {
  id: string;
  sent_to_email?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  submitted_at?: string | null;
  signed_at?: string | null;
  valid_until?: string | null;
  consent_status?: string | null;
  data?: any;
  snapshot?: any;
}

/** Services proposés dans le consentement au démarchage téléphonique (ImmoSphera). */
export const CONSENT_SERVICES: { key: string; label: string }[] = [
  { key: "accepte_vente", label: "Vente de biens immobiliers" },
  { key: "accepte_achat", label: "Achat de biens immobiliers" },
  { key: "accepte_location", label: "Location de biens immobiliers" },
  { key: "accepte_gestion", label: "Gestion de biens immobiliers" },
  { key: "accepte_cession_parts", label: "Cession de parts de sociétés immobilières" },
  { key: "accepte_fonds_commerce", label: "Achat/Vente de fonds de commerce" },
  { key: "accepte_syndic", label: "Syndic/gestion ASL" },
  { key: "accepte_evaluation", label: "Évaluation de biens immobiliers" },
];

/** Libellés des autorisations du document de consentement immobilier. */
export const CONSENT_PERMISSIONS: { key: string; label: string }[] = [
  ...CONSENT_SERVICES,
  {
    key: "accepte_demarchage",
    label:
      "Je consens expressément à être contacté(e) (par SMS, mail, téléphone, WhatsApp) pour les services identifiés ci-dessus (consentement donné pour une durée d'un an).",
  },
  {
    key: "accepte_contact",
    label:
      "Être contacté(e) par téléphone, mail, SMS ou WhatsApp par l'agence ImmoSphera (estimation, vente ou achat, location, investissement, nouveaux biens, actualités du marché).",
  },
  { key: "accepte_newsletter", label: "Recevoir la newsletter de l'agence ImmoSphera." },
];

export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Autorisations réellement présentes dans les réponses signées. */
export function consentPermissions(record: ConsentRecord | null | undefined) {
  const c = (record?.data?.consentement ?? {}) as Record<string, unknown>;
  const keys = Object.keys(c).filter((k) => k.startsWith("accepte"));
  const list = keys.length > 0 ? keys : CONSENT_PERMISSIONS.map((p) => p.key);
  // La phrase de consentement expresse doit toujours figurer en dernier.
  const ordered = [...list].sort((a, b) => Number(a === "accepte_demarchage") - Number(b === "accepte_demarchage"));
  return ordered.map((key) => ({
    key,
    label: CONSENT_PERMISSIONS.find((p) => p.key === key)?.label ?? key,
    accepted: c[key] === true,
    answered: key in c,
  }));
}

/**
 * Statut du consentement. Une absence de réponse n'est JAMAIS un refus :
 * tant que le document n'est pas signé, le statut reste « en attente ».
 */
export function computeConsentStatus(record: ConsentRecord | null | undefined): ConsentStatus {
  if (!record) return "pending";
  // Document envoyé mais pas encore rempli par le client → « envoyé » (orange).
  if (!record.submitted_at) return "sent";
  const stored = record.consent_status;
  if (stored === "validated" || stored === "partial" || stored === "refused") {
    return stored;
  }
  const perms = consentPermissions(record).filter((p) => p.answered);
  if (perms.length === 0) return "sent";
  const c = (record?.data?.consentement ?? {}) as Record<string, unknown>;
  if (c.refus_demarchage === true) return "refused";
  const accepted = perms.filter((p) => p.accepted).length;
  if (accepted === perms.length) return "validated";
  if (accepted === 0) return "refused";
  return "partial";
}

export function consentSignedAt(record: ConsentRecord | null | undefined): Date | null {
  const raw = record?.signed_at ?? record?.submitted_at;
  return raw ? new Date(raw) : null;
}

export function consentValidUntil(record: ConsentRecord | null | undefined): Date | null {
  if (record?.valid_until) return new Date(record.valid_until);
  const signed = consentSignedAt(record);
  return signed ? new Date(signed.getTime() + ONE_YEAR_MS) : null;
}

export function isConsentExpired(record: ConsentRecord | null | undefined): boolean {
  const until = consentValidUntil(record);
  if (!until) return false;
  return until.getTime() < Date.now();
}

export const CONSENT_STATUS_META: Record<
  ConsentStatus,
  { label: string; short: string; className: string; dot: string }
> = {
  validated: {
    label: "Consentement validé",
    short: "Validé",
    className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/40",
    dot: "bg-emerald-500",
  },
  partial: {
    label: "Consentement partiel",
    short: "Partiel",
    className: "bg-orange-500/15 text-orange-600 border-orange-500/40",
    dot: "bg-orange-500",
  },
  refused: {
    label: "Consentement refusé",
    short: "Refusé",
    className: "bg-red-500/15 text-red-600 border-red-500/40",
    dot: "bg-red-500",
  },
  sent: {
    label: "Consentement envoyé",
    short: "Envoyé",
    className: "bg-orange-500/15 text-orange-600 border-orange-500/40",
    dot: "bg-orange-500",
  },
  pending: {
    label: "Consentement en attente",
    short: "En attente",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

export const CONSENT_EXPIRED_META = {
  label: "Consentement expiré",
  className: "bg-red-500/15 text-red-600 border-red-500/40",
  dot: "bg-red-500",
};

export function formatFr(date: Date | null | undefined): string {
  return date ? date.toLocaleDateString("fr-FR") : "—";
}

/** Le consentement le plus récent (signé en priorité). */
export function latestConsent<T extends ConsentRecord>(records: T[]): T | null {
  const signed = records.filter((r) => r.submitted_at);
  const pool = signed.length > 0 ? signed : records;
  return (
    [...pool].sort(
      (a, b) =>
        new Date(b.submitted_at ?? b.created_at ?? 0).getTime() -
        new Date(a.submitted_at ?? a.created_at ?? 0).getTime(),
    )[0] ?? null
  );
}
