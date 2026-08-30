import { Check, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";

type Props = {
  status: AutoSaveStatus;
  lastSavedAt?: Date | null;
  className?: string;
};

export default function AutoSaveBadge({ status, lastSavedAt, className }: Props) {
  let icon: JSX.Element;
  let label: string;
  let tone = "text-muted-foreground";

  if (status === "saving") {
    icon = <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    label = "Enregistrement…";
  } else if (status === "error") {
    icon = <CloudOff className="w-3.5 h-3.5" />;
    label = "Hors ligne — sauvegarde en attente";
    tone = "text-destructive";
  } else if (status === "saved" || lastSavedAt) {
    icon = <Check className="w-3.5 h-3.5" />;
    label = lastSavedAt ? `Enregistré ${formatRelative(lastSavedAt)}` : "Enregistré";
    tone = "text-emerald-600 dark:text-emerald-500";
  } else {
    icon = <Check className="w-3.5 h-3.5 opacity-40" />;
    label = "Auto-enregistrement actif";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium select-none",
        tone,
        className,
      )}
      aria-live="polite"
    >
      {icon}
      {label}
    </span>
  );
}

function formatRelative(date: Date): string {
  const diff = Math.max(0, Date.now() - date.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}