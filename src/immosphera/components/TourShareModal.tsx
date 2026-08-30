import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { Clock, Copy, Check, Link2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyTitle: string;
  tourType: "giraffe360" | "giraffe360_site";
}

const DURATIONS = [
  { label: "1 heure", hours: 1 },
  { label: "3 heures", hours: 3 },
  { label: "5 heures", hours: 5 },
  { label: "1 journée", hours: 24 },
  { label: "3 jours", hours: 72 },
  { label: "5 jours", hours: 120 },
];

export function TourShareModal({ open, onOpenChange, propertyId, propertyTitle, tourType }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedHours, setSelectedHours] = useState<number | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!selectedHours || !user) return;
    setLoading(true);
    try {
      const expiresAt = new Date(Date.now() + selectedHours * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("immosphera_tour_tokens")
        .insert({
          property_id: propertyId,
          tour_type: tourType,
          expires_at: expiresAt,
          created_by: user.id,
        })
        .select("token")
        .single();

      if (error) throw error;
      const url = `${window.location.origin}/immosphera/visite/${data.token}`;
      setGeneratedUrl(url);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl).then(() => {
      setCopied(true);
      toast({ title: "Lien copié !", description: "Partagez-le avec votre client." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setSelectedHours(null);
      setGeneratedUrl(null);
      setCopied(false);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Lien visite temporaire
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Générez un lien temporaire pour que votre client accède uniquement à la visite virtuelle{" "}
          <span className="font-semibold text-foreground">
            {tourType === "giraffe360" ? "Giraffe360°" : "Site Giraffe360°"}
          </span>{" "}
          de <span className="font-semibold text-foreground">{propertyTitle}</span>.
        </p>

        {!generatedUrl ? (
          <div className="space-y-4">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Durée de validité
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.hours}
                  onClick={() => setSelectedHours(d.hours)}
                  className={`px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                    selectedHours === d.hours
                      ? "bg-primary/15 border-primary text-primary shadow-sm"
                      : "bg-muted/50 border-border text-foreground hover:border-primary/40"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!selectedHours || loading}
              className="w-full primary-gold gap-2"
            >
              <Link2 className="h-4 w-4" />
              {loading ? "Génération…" : "Générer le lien"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-xl p-4 border border-border">
              <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Lien généré</p>
              <p className="text-sm font-mono break-all text-foreground/80">{generatedUrl}</p>
              <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Expire dans {DURATIONS.find(d => d.hours === selectedHours)?.label || ""}
              </p>
            </div>

            <Button onClick={handleCopy} className="w-full gap-2">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copié !" : "Copier le lien"}
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setGeneratedUrl(null);
                setSelectedHours(null);
              }}
            >
              Générer un autre lien
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
