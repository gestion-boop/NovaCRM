import { Link } from "react-router-dom";
import { useState } from "react";
import { MapPin, Maximize, BedDouble, Home, TreePine, Headset } from "lucide-react";
import { VirtualTourIcon, Giraffe360Icon, WebsiteIcon } from "@/immosphera/components/PropertyIcons";
import { HeartIcon } from "@/immosphera/components/HeartIcon";
import { AdvisorModal } from "@/immosphera/components/AdvisorModal";
import { advisors, getAdvisorByName, type Advisor } from "@/immosphera/lib/advisors";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import type { Opportunity } from "@/immosphera/lib/opportunities";

interface Props {
  property: Tables<"immosphera_properties">;
  matchScore?: number | null;
  opportunity?: Opportunity | null;
  isHovered?: boolean;
  isInPropal?: boolean;
  onHover?: (id: string | null) => void;
  onTogglePropal?: (property: Tables<"immosphera_properties">) => void;
}

import { PROPERTY_TYPE_LABELS } from "@/immosphera/lib/propertyTypes";

export function PropertyCard({
  property,
  matchScore,
  opportunity,
  isHovered,
  isInPropal,
  onHover,
  onTogglePropal,
}: Props) {
  const imgSrc = property.images?.[0] || "/placeholder.svg";
  const status = property.status || "active";
  const td = (property.tech_details || {}) as Record<string, string>;
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listingType = ((property as any).listing_type as "sale" | "rental" | undefined) ?? "sale";
  const [updatingType, setUpdatingType] = useState(false);

  const toggleListingType = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAdmin || updatingType) return;
    const next = listingType === "sale" ? "rental" : "sale";
    setUpdatingType(true);
    const { error } = await supabase
      .from("immosphera_properties")
      .update({ listing_type: next } as any)
      .eq("id", property.id);
    setUpdatingType(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } else {
      toast({ title: next === "sale" ? "Basculé en Vente" : "Basculé en Location" });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    }
  };

  const advisor: Advisor | undefined =
    (property.agent_name && getAdvisorByName(property.agent_name)) ||
    (property.agent_email
      ? advisors.find((a) => a.email.toLowerCase() === property.agent_email!.toLowerCase())
      : undefined);

  const tags = [
    td.terrace === "Oui" ? { label: "Terrasse", tone: "accent" } : null,
    td.pool === "Oui" ? { label: "Piscine", tone: "accent" } : null,
    td.pool === "Possible" ? { label: "Piscine possible", tone: "soft" } : null,
    property.property_type === "land" && td.serviced === "Oui" ? { label: "Viabilisé", tone: "accent" } : null,
    property.property_type === "land" && td.builderFree === "Oui"
      ? { label: "Libre constructeur", tone: "accent" }
      : null,
  ].filter(Boolean) as { label: string; tone: string }[];

  const showOpportunity = opportunity?.priceDrop || opportunity?.underMarket;

  return (
    <div className="block h-full" onMouseEnter={() => onHover?.(property.id)} onMouseLeave={() => onHover?.(null)}>
      <div
        className={`bg-card rounded-[22px] overflow-hidden shadow-[0_18px_35px_hsl(30_30%_8%/0.12)] cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_40px_hsl(30_30%_8%/0.18)] h-full flex flex-col ${isHovered ? "ring-2 ring-primary -translate-y-0.5" : ""}`}
      >
        {/* Image */}
        <Link to={`/immosphera/bien/${property.id}`} className="block relative aspect-[4/3] overflow-hidden">
          <img
            src={imgSrc}
            alt={property.title}
            className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
            loading="lazy"
          />
          {/* Type badge */}
          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[11px] font-bold bg-gold-dark text-gold">
            {PROPERTY_TYPE_LABELS[property.property_type] || property.property_type}
          </span>
          {/* Listing type badge (Vente / Location) */}
          <button
            type="button"
            onClick={toggleListingType}
            disabled={!isAdmin || updatingType}
            title={isAdmin ? "Cliquer pour basculer Vente / Location" : listingType === "sale" ? "Vente" : "Location"}
            className={`absolute top-10 left-3 px-2.5 py-1 rounded-full text-[11px] font-bold shadow ${
              listingType === "rental" ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground"
            } ${isAdmin ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
          >
            {listingType === "rental" ? "Location" : "Vente"}
          </button>
          {/* Status badge */}
          {status !== "active" && (
            <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-bold bg-destructive text-destructive-foreground">
              {status === "under_offer" ? "Sous offre" : "Sous compromis"}
            </span>
          )}
          {/* Match score */}
          {typeof matchScore === "number" && (
            <span className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-bold bg-gold/90 text-gold-dark">
              Match {matchScore}%
            </span>
          )}
          {/* Demande explicite (15 septembre) : numéro de mandat en bas à
              droite de la carte, pour identifier le bien lors de la visite
              au casque VR (les biens y sont répertoriés par numéro de
              mandat). Décalé au-dessus du badge "Match" quand les deux
              sont présents, pour ne jamais se superposer. */}
          {property.mandate_number && (
            <span
              className={`absolute right-3 px-2.5 py-1 rounded-full text-[11px] font-bold bg-card/90 text-card-foreground shadow ${
                typeof matchScore === "number" ? "bottom-10" : "bottom-3"
              }`}
            >
              Mandat {property.mandate_number}
            </span>
          )}
          {/* Heart */}
          {onTogglePropal && (
            <button
              className={`absolute bottom-3 left-3 w-8 h-8 rounded-full grid place-items-center transition-colors ${isInPropal ? "bg-destructive text-destructive-foreground" : "bg-card/80 text-muted-foreground hover:text-destructive"}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTogglePropal(property);
              }}
              aria-label="Propal clients"
            >
              <HeartIcon />
            </button>
          )}
          {/* Agent avatar */}
          {advisor && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setAdvisorOpen(true);
              }}
              className={`absolute right-3 group ${status !== "active" ? "top-12" : "top-3"}`}
              title={`Conseiller : ${advisor.name}`}
              aria-label={`Voir les coordonnées de ${advisor.name}`}
            >
              <img
                src={advisor.photo}
                alt={advisor.name}
                className="w-14 h-14 rounded-full object-cover border-2 border-gold shadow-md transition-transform group-hover:scale-110"
              />
            </button>
          )}
        </Link>
        {advisor && <AdvisorModal advisor={advisor} open={advisorOpen} onOpenChange={setAdvisorOpen} />}

        {/* Body */}
        <div className="p-4 space-y-2 flex-1 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <Link
              to={`/immosphera/bien/${property.id}`}
              className="font-bold text-sm line-clamp-1 text-card-foreground hover:underline"
            >
              {property.title}
            </Link>
            <div className="flex gap-1.5 shrink-0">
              {/* Demande explicite (14 septembre) : « possibilité de mettre
                  un logo de casque quand la visite virtuelle est faite,
                  cela confirmera que c'est bien disponible au casque VR »
                  — coché manuellement dans la fiche (vr_headset_available),
                  indépendant de virtual_tour_url ci-dessous. */}
              {property.vr_headset_available && (
                <Link
                  to={`/immosphera/bien/${property.id}`}
                  className="w-9 h-9 rounded-full bg-muted grid place-items-center hover:bg-primary/20"
                  title="Disponible au casque VR"
                >
                  <Headset className="h-5 w-5 text-primary" />
                </Link>
              )}
              {property.virtual_tour_url && (
                <Link
                  to={`/immosphera/bien/${property.id}`}
                  className="w-9 h-9 rounded-full bg-muted grid place-items-center hover:bg-primary/20"
                  title="Visite virtuelle"
                >
                  <VirtualTourIcon className="h-6 w-6" />
                </Link>
              )}
              {property.giraffe_url && (
                <Link
                  to={`/immosphera/bien/${property.id}`}
                  className="w-9 h-9 rounded-full bg-muted grid place-items-center hover:bg-primary/20"
                  title="Site Giraffe"
                >
                  <Giraffe360Icon className="h-6 w-6" />
                </Link>
              )}
              {property.listing_url && (
                <a
                  href={property.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-9 h-9 rounded-full bg-muted grid place-items-center hover:bg-primary/20"
                  title="Site internet Immosphera"
                >
                  <WebsiteIcon className="h-6 w-6" />
                </a>
              )}
            </div>
          </div>

          {property.price && (
            <span className="text-primary font-extrabold text-base">
              {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
                Number(property.price),
              )}
            </span>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">{property.location || property.address}</span>
          </p>

          <div className="flex items-start gap-3 text-xs text-muted-foreground flex-wrap min-h-[2.75rem] content-start">
            {property.surface_area && (
              <span className="flex items-center gap-1">
                <Maximize className="h-3 w-3" />
                {property.surface_area} m²
              </span>
            )}
            {td.terrainSurface && (
              <span className="flex items-center gap-1">
                <TreePine className="h-3 w-3" />
                {td.terrainSurface} m²
              </span>
            )}
            {property.rooms && (
              <span className="flex items-center gap-1">
                <Home className="h-3 w-3" />
                {property.rooms} p.
              </span>
            )}
            {property.bedrooms && (
              <span className="flex items-center gap-1">
                <BedDouble className="h-3 w-3" />
                {property.bedrooms} ch.
              </span>
            )}
          </div>

          {/* Feature tags */}
          <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag.label}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${tag.tone === "accent" ? "bg-primary/15 text-primary border border-primary/30" : "bg-muted text-muted-foreground"}`}
              >
                {tag.label}
              </span>
            ))}
          </div>

          <div className="mt-auto" />
        </div>
      </div>
    </div>
  );
}
