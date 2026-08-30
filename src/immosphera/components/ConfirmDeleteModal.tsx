import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type { Tables } from "@/integrations/supabase/types";

import { PROPERTY_TYPE_LABELS } from "@/immosphera/lib/propertyTypes";

interface Props {
  property: Tables<"immosphera_properties"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => void;
}

export function ConfirmDeleteModal({ property, open, onOpenChange, onConfirm }: Props) {
  if (!property) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-[22px] border-border bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>Supprimer définitivement ce bien ?</p>
            <p className="font-bold text-card-foreground">
              {PROPERTY_TYPE_LABELS[property.property_type] || property.property_type}
            </p>
            <p className="text-muted-foreground">{property.location || property.address}</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-full">Non</AlertDialogCancel>
          <AlertDialogAction
            className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onConfirm(property.id)}
          >
            Oui, supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
