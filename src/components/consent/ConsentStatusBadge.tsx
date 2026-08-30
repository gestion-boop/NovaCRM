import { cn } from "@/lib/utils";
import {
  CONSENT_EXPIRED_META,
  CONSENT_STATUS_META,
  computeConsentStatus,
  isConsentExpired,
  consentValidUntil,
  formatFr,
  type ConsentRecord,
  type ConsentStatus,
} from "@/lib/consent";

interface Props {
  /** Consentement à qualifier. `null` => en attente. */
  record?: ConsentRecord | null;
  /** Forcer un statut (sans enregistrement). */
  status?: ConsentStatus;
  /** Affiche « expiré » quand la validité d'un an est dépassée. */
  showExpiry?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Badge de statut du consentement — couleur + texte (jamais la couleur seule).
 * Vert = validé · Orange = partiel · Rouge = refusé · Gris = en attente.
 */
export default function ConsentStatusBadge({
  record,
  status,
  showExpiry = true,
  size = "sm",
  className,
}: Props) {
  const resolved = status ?? computeConsentStatus(record);
  const expired = showExpiry && resolved !== "pending" && resolved !== "sent" && isConsentExpired(record);
  const meta = expired ? CONSENT_EXPIRED_META : CONSENT_STATUS_META[resolved];
  const until = consentValidUntil(record);

  return (
    <span
      role="status"
      title={
        expired
          ? "Ce consentement a plus d'un an : un nouveau consentement doit être réalisé."
          : until
            ? `Valable jusqu'au ${formatFr(until)}`
            : undefined
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
        meta.className,
        className,
      )}
    >
      <span className={cn("w-2 h-2 rounded-full shrink-0", meta.dot)} aria-hidden />
      {expired ? `${CONSENT_STATUS_META[resolved].label} — expiré` : meta.label}
    </span>
  );
}
