import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MapPin, Maximize, BedDouble, Home, Eye, ExternalLink, TreePine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/integrations/supabase/types";

const formatPrice = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);

import { PROPERTY_TYPE_LABELS } from "@/immosphera/lib/propertyTypes";

export default function PropalView() {
  const [searchParams] = useSearchParams();
  const idsParam = searchParams.get("ids") || "";
  const ids = idsParam.split(",").filter(Boolean);

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ["propal-view", idsParam],
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data, error } = await supabase.functions.invoke("immosphera-propal-properties", {
        body: { ids },
      });
      if (error) throw error;
      return (data?.properties || []) as Tables<"immosphera_properties">[];
    },
    enabled: ids.length > 0,
  });

  if (ids.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen text-center">
        <div>
          <h2 className="text-xl font-semibold mb-2">Lien invalide</h2>
          <p className="text-muted-foreground">Aucun bien dans cette proposition.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container py-8 max-w-5xl space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
              ImmoSphera<span className="text-primary">360°</span> — Proposition
            </h1>
            <p className="text-sm text-muted-foreground">{properties.length} bien{properties.length > 1 ? "s" : ""} sélectionné{properties.length > 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {properties.map((p) => {
          const td = (p.tech_details || {}) as Record<string, string>;
          return (
            <div key={p.id} className="bg-card rounded-2xl border border-border overflow-hidden shadow-lg">
              <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-0">
                {/* Image */}
                <div className="aspect-[4/3] md:aspect-auto">
                  {p.images?.[0] ? (
                    <img src={p.images[0]} alt={p.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted grid place-items-center text-muted-foreground">Pas de photo</div>
                  )}
                </div>

                {/* Details */}
                <div className="p-6 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge className="mb-2 bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold border-none shadow-sm">{PROPERTY_TYPE_LABELS[p.property_type] || p.property_type}</Badge>
                      {p.status !== "active" && (
                        <Badge variant="destructive" className="ml-2">
                          {p.status === "under_offer" ? "Sous offre" : "Sous compromis"}
                        </Badge>
                      )}
                      <h2 className="text-lg font-bold">{p.title}</h2>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {p.location || p.address}
                      </p>
                    </div>
                    {p.price && (
                      <p className="text-xl font-bold text-primary shrink-0">
                        {formatPrice(Number(p.price))} €
                      </p>
                    )}
                  </div>

                  <div className="flex gap-4 text-sm flex-wrap">
                    {p.surface_area && <span className="flex items-center gap-1"><Maximize className="h-4 w-4" /> {p.surface_area} m²</span>}
                    {td.terrainSurface && <span className="flex items-center gap-1"><TreePine className="h-4 w-4" /> {td.terrainSurface} m²</span>}
                    {p.rooms && <span className="flex items-center gap-1"><Home className="h-4 w-4" /> {p.rooms} pièces</span>}
                    {p.bedrooms && <span className="flex items-center gap-1"><BedDouble className="h-4 w-4" /> {p.bedrooms} ch.</span>}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {td.terrace === "Oui" && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary border border-primary/30">Terrasse</span>}
                    {(td.pool === "Oui" || td.pool === "Possible") && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary border border-primary/30">Piscine{td.pool === "Possible" ? " possible" : ""}</span>}
                  </div>

                  {/* Virtual tour */}
                  {p.virtual_tour_url && (
                    <div className="pt-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Visite virtuelle</p>
                      <div className="rounded-xl overflow-hidden border aspect-video">
                        <iframe src={p.virtual_tour_url} className="w-full h-full" allowFullScreen title="Visite virtuelle" />
                      </div>
                    </div>
                  )}

                  {/* Agent */}
                  {p.agent_name && (
                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                      {p.agent_photo && <img src={p.agent_photo} alt="" className="w-8 h-8 rounded-full" />}
                      <div>
                        <p className="text-sm font-bold">{p.agent_name}</p>
                        {p.agent_phone && <p className="text-xs text-muted-foreground">{p.agent_phone}</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
