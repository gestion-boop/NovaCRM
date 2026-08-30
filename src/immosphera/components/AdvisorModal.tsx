import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Advisor } from "@/immosphera/lib/advisors";
import { ExternalLink, Share2, Mail, Phone } from "lucide-react";

interface Props {
  advisor: Advisor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShare?: (advisor: Advisor) => void;
}

export function AdvisorModal({ advisor, open, onOpenChange, onShare }: Props) {
  if (!advisor) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-[22px] border-border bg-card p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-lg font-bold">Conseiller Immobilier</DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Business card preview */}
          {advisor.cardUrl && (
            <div className="field-card space-y-3">
              <p className="text-xs font-bold text-muted-foreground uppercase">Carte de visite</p>
              <div className="rounded-xl overflow-hidden border border-border aspect-[16/9]">
                <iframe
                  title="Carte de visite"
                  src={advisor.cardUrl}
                  className="w-full h-full"
                  scrolling="no"
                />
              </div>
              <div className="flex gap-2">
                {onShare && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full text-xs"
                    onClick={() => onShare(advisor)}
                  >
                    <Share2 className="h-3.5 w-3.5 mr-1.5" /> Partager
                  </Button>
                )}
                <a href={advisor.cardUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="rounded-full text-xs">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Ouvrir
                  </Button>
                </a>
              </div>
            </div>
          )}

          {/* Agent profile */}
          <div className="flex items-center gap-4">
            <img
              src={advisor.photo}
              alt={advisor.name}
              className="w-14 h-14 rounded-full object-cover border-2 border-primary/30"
            />
            <div>
              <p className="font-bold text-sm text-card-foreground">{advisor.name}</p>
              <p className="text-xs text-muted-foreground">Conseiller Immobilier</p>
            </div>
          </div>

          {/* Contact info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="field-card">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Email</p>
              <a
                href={`mailto:${advisor.email}`}
                className="text-xs font-bold text-card-foreground flex items-center gap-1.5 hover:text-primary transition-colors"
              >
                <Mail className="h-3.5 w-3.5" />
                {advisor.email || "Non renseigné"}
              </a>
            </div>
            <div className="field-card">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Téléphone</p>
              <a
                href={`tel:${advisor.phone}`}
                className="text-xs font-bold text-card-foreground flex items-center gap-1.5 hover:text-primary transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />
                {advisor.phone || "Non renseigné"}
              </a>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
