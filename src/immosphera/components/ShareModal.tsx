import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink } from "lucide-react";

const DURATIONS = [
  { value: "1h", label: "1 heure" },
  { value: "2h", label: "2 heures" },
  { value: "3h", label: "3 heures" },
  { value: "12h", label: "12 heures" },
  { value: "1d", label: "1 jour" },
  { value: "3d", label: "3 jours" },
  { value: "5d", label: "5 jours" },
];

function durationToMs(d: string): number {
  const map: Record<string, number> = {
    "1h": 3600000,
    "2h": 7200000,
    "3h": 10800000,
    "12h": 43200000,
    "1d": 86400000,
    "3d": 259200000,
    "5d": 432000000,
  };
  return map[d] || 86400000;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}

export function ShareModal({ open, onOpenChange, propertyId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [duration, setDuration] = useState("1d");
  const [loading, setLoading] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const expiresAt = new Date(Date.now() + durationToMs(duration)).toISOString();
      const { data, error: err } = await supabase
        .from("immosphera_share_tokens")
        .insert({
          property_id: propertyId,
          created_by: user.id,
          expires_at: expiresAt,
        })
        .select("token")
        .single();
      if (err) throw err;
      const url = `${window.location.origin}/immosphera/partage/${data.token}`;
      setShareLink(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareLink);
    toast({ title: "Lien copié !" });
  };

  const handleOpen = () => {
    window.open(shareLink, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lien temporaire</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Durée de validité</p>
            <div className="flex gap-2">
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={handleGenerate} disabled={loading}>
                {loading ? "Création..." : "Générer"}
              </Button>
            </div>
          </div>

          {shareLink && (
            <div className="space-y-2">
              <Input value={shareLink} readOnly className="text-xs" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={handleCopy}>
                  <Copy className="mr-2 h-3.5 w-3.5" /> Copier
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={handleOpen}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Ouvrir
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
