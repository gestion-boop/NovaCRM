import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, Maximize, BedDouble, Home, Check, X, Star, TrendingDown } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { Link } from "react-router-dom";
import { PROPERTY_TYPE_LABELS } from "@/immosphera/lib/propertyTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: Tables<"immosphera_properties">[];
}

const fmt = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);

const ROWS: { label: string; icon: React.ReactNode; render: (p: Tables<"immosphera_properties">) => string | React.ReactNode }[] = [
  {
    label: "Type",
    icon: <Home className="h-3.5 w-3.5" />,
    render: (p) => PROPERTY_TYPE_LABELS[p.property_type] || p.property_type,
  },
  {
    label: "Prix",
    icon: <TrendingDown className="h-3.5 w-3.5" />,
    render: (p) => p.price ? <span className="font-bold text-primary">{fmt(Number(p.price))} €</span> : <span className="text-muted-foreground/50">N.C.</span>,
  },
  {
    label: "Surface",
    icon: <Maximize className="h-3.5 w-3.5" />,
    render: (p) => p.surface_area ? `${p.surface_area} m²` : <span className="text-muted-foreground/50">N.C.</span>,
  },
  {
    label: "Prix/m²",
    icon: <TrendingDown className="h-3.5 w-3.5" />,
    render: (p) => p.price && p.surface_area ? `${fmt(Math.round(Number(p.price) / Number(p.surface_area)))} €/m²` : <span className="text-muted-foreground/50">N.C.</span>,
  },
  {
    label: "Pièces",
    icon: <Home className="h-3.5 w-3.5" />,
    render: (p) => p.rooms ? String(p.rooms) : <span className="text-muted-foreground/50">N.C.</span>,
  },
  {
    label: "Chambres",
    icon: <BedDouble className="h-3.5 w-3.5" />,
    render: (p) => p.bedrooms ? String(p.bedrooms) : <span className="text-muted-foreground/50">N.C.</span>,
  },
  {
    label: "Localisation",
    icon: <MapPin className="h-3.5 w-3.5" />,
    render: (p) => <span className="text-xs">{p.location || p.address}</span>,
  },
  {
    label: "Terrasse",
    icon: null,
    render: (p) => {
      const td = (p.tech_details || {}) as Record<string, string>;
      return td.terrace === "Oui"
        ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary"><Check className="h-3.5 w-3.5" /> Oui</span>
        : <X className="h-3.5 w-3.5 text-muted-foreground/30" />;
    },
  },
  {
    label: "Piscine",
    icon: null,
    render: (p) => {
      const td = (p.tech_details || {}) as Record<string, string>;
      if (td.pool === "Oui") return <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary"><Check className="h-3.5 w-3.5" /> Oui</span>;
      if (td.pool === "Possible") return <span className="text-xs text-muted-foreground italic">Possible</span>;
      return <X className="h-3.5 w-3.5 text-muted-foreground/30" />;
    },
  },
  {
    label: "Statut",
    icon: null,
    render: (p) => {
      if (p.status === "under_offer") return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-destructive/15 text-destructive border border-destructive/30">Sous offre</span>;
      if (p.status === "under_compromise") return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-destructive/15 text-destructive border border-destructive/30">Sous compromis</span>;
      return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary/12 text-primary border border-primary/25">Disponible</span>;
    },
  },
];

export function CompareModal({ open, onOpenChange, properties }: Props) {
  if (properties.length === 0) return null;

  // Best values
  const prices = properties.map(p => p.price ? Number(p.price) : Infinity);
  const bestPriceIdx = prices.indexOf(Math.min(...prices.filter(v => v !== Infinity)));
  const areas = properties.map(p => p.surface_area ? Number(p.surface_area) : 0);
  const bestAreaIdx = areas.indexOf(Math.max(...areas.filter(v => v > 0)));
  const ppm = properties.map(p => p.price && p.surface_area ? Number(p.price) / Number(p.surface_area) : Infinity);
  const bestPpmIdx = ppm.indexOf(Math.min(...ppm.filter(v => v !== Infinity)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] md:max-w-5xl max-h-[90vh] overflow-y-auto p-0 rounded-[28px] border-primary/20 bg-gradient-to-br from-card via-card to-secondary/40 shadow-[0_40px_80px_hsl(30_30%_8%/0.35)]">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b border-border/50 bg-gradient-to-r from-primary/8 via-transparent to-primary/5">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <span className="w-10 h-10 rounded-2xl bg-primary/15 border border-primary/30 grid place-items-center">
              <Star className="h-5 w-5 text-primary" />
            </span>
            Comparatif des biens
            <span className="ml-auto text-xs font-medium text-muted-foreground bg-muted/80 px-3 py-1 rounded-full">
              {properties.length} bien{properties.length > 1 ? "s" : ""}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-x-auto p-5">
          {/* Property cards header */}
          <div className="grid gap-4" style={{ gridTemplateColumns: `160px repeat(${properties.length}, minmax(180px, 1fr))` }}>
            {/* Empty corner */}
            <div />
            {/* Property header cards */}
            {properties.map((p) => (
              <Link
                key={p.id}
                to={`/immosphera/bien/${p.id}`}
                onClick={() => onOpenChange(false)}
                className="group relative rounded-2xl overflow-hidden border border-border/60 bg-card shadow-[0_8px_24px_hsl(30_30%_8%/0.1)] hover:shadow-[0_12px_32px_hsl(30_30%_8%/0.18)] transition-all duration-300 hover:-translate-y-0.5"
              >
                {p.images?.[0] && (
                  <div className="aspect-[4/3] overflow-hidden">
                    <img
                      src={p.images[0]}
                      alt={p.title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                )}
                <div className="p-3 space-y-1.5">
                  <p className="font-bold text-sm line-clamp-2 text-card-foreground group-hover:text-primary transition-colors">{p.title}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" /> {p.location || p.address}
                  </p>
                  {p.price && (
                    <p className="text-primary font-extrabold text-base">
                      {fmt(Number(p.price))} €
                    </p>
                  )}
                </div>
              </Link>
            ))}

            {/* Data rows */}
            {ROWS.map((row, ri) => {
              const isEvenRow = ri % 2 === 0;
              return (
                <>
                  {/* Label cell */}
                  <div
                    key={`label-${row.label}`}
                    className={`sticky left-0 z-10 flex items-center gap-2 px-4 py-3.5 rounded-l-xl text-xs font-bold uppercase tracking-wider text-muted-foreground ${
                      isEvenRow ? "bg-muted/40" : "bg-transparent"
                    }`}
                  >
                    {row.icon}
                    {row.label}
                  </div>
                  {/* Value cells */}
                  {properties.map((p, pi) => {
                    const isBest =
                      (row.label === "Prix" && pi === bestPriceIdx && prices[pi] !== Infinity) ||
                      (row.label === "Surface" && pi === bestAreaIdx && areas[pi] > 0) ||
                      (row.label === "Prix/m²" && pi === bestPpmIdx && ppm[pi] !== Infinity);

                    return (
                      <div
                        key={`${row.label}-${p.id}`}
                        className={`flex flex-col items-center justify-center px-4 py-3.5 text-sm text-center transition-colors ${
                          isEvenRow ? "bg-muted/25" : "bg-transparent"
                        } ${isBest ? "relative" : ""} ${
                          pi === properties.length - 1 ? "rounded-r-xl" : ""
                        }`}
                      >
                        {isBest && (
                          <div className="absolute inset-0 rounded-xl bg-primary/[0.06] border border-primary/15" />
                        )}
                        <div className="relative z-[1]">
                          {row.render(p)}
                        </div>
                        {isBest && (
                          <span className="relative z-[1] inline-flex items-center gap-0.5 text-[9px] text-primary font-bold bg-primary/12 px-2 py-0.5 rounded-full mt-1.5 border border-primary/20">
                            <Star className="h-2.5 w-2.5" /> Meilleur
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
