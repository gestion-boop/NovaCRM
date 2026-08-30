import { useState, useEffect } from "react";
import { Heart, Link2, BarChart3, X, Trash2, Copy, Check, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSidebarToggle } from "@/contexts/SidebarContext";
import type { Tables } from "@/integrations/supabase/types";

interface Props {
  propalIds: Set<string>;
  properties: Tables<"immosphera_properties">[];
  onClear: () => void;
  onRemove: (id: string) => void;
  onCompare: () => void;
}

const formatPrice = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);

export function PropalBar({ propalIds, properties, onClear, onRemove, onCompare }: Props) {
  const { toast } = useToast();
  const { collapsed } = useSidebarToggle();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  const selected = properties.filter((p) => propalIds.has(p.id));

  useEffect(() => {
    if (selected.length === 0) setDismissed(false);
  }, [selected.length]);

  if (selected.length === 0) return null;

  if (dismissed) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setDismissed(false)}
          className="flex items-center gap-2 bg-card/95 backdrop-blur-md border border-primary/30 rounded-full px-4 py-2.5 shadow-[0_4px_20px_hsl(30_30%_8%/0.2)] hover:shadow-[0_4px_24px_hsl(30_30%_8%/0.3)] transition-shadow"
        >
          <Heart className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">{selected.length}</span>
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    );
  }

  const generateLink = () => {
    const ids = selected.map((p) => p.id).join(",");
    const url = `${window.location.origin}/immosphera/propal?ids=${ids}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast({ title: "Lien copié !", description: "Partagez ce lien avec votre client." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={`fixed bottom-0 right-0 z-50 pointer-events-none transition-[left] duration-300 ${
        collapsed ? "left-0" : "left-0 sm:left-[224px]"
      }`}
    >
      <div className="max-w-[1500px] mx-auto px-4 pb-4 pointer-events-auto">
        <div className="bg-card/95 backdrop-blur-md border border-primary/30 rounded-2xl shadow-[0_-8px_40px_hsl(30_30%_8%/0.25)] overflow-hidden">
          {/* Expanded list */}
          {expanded && (
            <div className="max-h-[40vh] overflow-y-auto p-4 space-y-2 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Biens sélectionnés</p>
                <button onClick={onClear} className="text-xs text-destructive hover:underline flex items-center gap-1">
                  <Trash2 className="h-3 w-3" /> Tout retirer
                </button>
              </div>
              {selected.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-2 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                >
                  {p.images?.[0] && (
                    <img src={p.images[0]} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.title}</p>
                    <p className="text-[11px] text-muted-foreground">{p.location || p.address}</p>
                  </div>
                  {p.price && (
                    <span className="text-sm font-bold text-primary shrink-0">{formatPrice(Number(p.price))} €</span>
                  )}
                  <button
                    onClick={() => onRemove(p.id)}
                    className="w-7 h-7 rounded-full grid place-items-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={() => setExpanded((p) => !p)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <span className="w-9 h-9 rounded-full bg-primary/20 border border-primary/40 grid place-items-center">
                <Heart className="h-4 w-4 text-primary" />
              </span>
              <div className="text-left">
                <p className="text-sm font-bold">
                  {selected.length} bien{selected.length > 1 ? "s" : ""}
                </p>
                <p className="text-[10px] text-muted-foreground">dans la propal</p>
              </div>
            </button>

            <div className="flex-1" />

            <button
              onClick={() => {
                setExpanded(false);
                onClear();
              }}
              className="w-8 h-8 rounded-full grid place-items-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Vider la sélection"
            >
              <X className="h-4 w-4" />
            </button>

            <Button variant="outline" size="sm" onClick={onCompare} disabled={selected.length < 2} className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Comparatif
            </Button>

            <Button size="sm" onClick={generateLink} className="primary-gold gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {copied ? "Copié !" : "Générer le lien"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
