import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { PropertyCard } from "@/immosphera/components/PropertyCard";
import { PropertyMap } from "@/immosphera/components/PropertyMap";
import { SearchPanel } from "@/immosphera/components/SearchPanel";
import { PropertyFormModal } from "@/immosphera/components/PropertyFormModal";
import { PropalBar } from "@/immosphera/components/PropalBar";
import { CompareModal } from "@/immosphera/components/CompareModal";
import { usePropertyFilters } from "@/immosphera/hooks/usePropertyFilters";
import { Skeleton } from "@/components/ui/skeleton";
import { Map, LayoutGrid, List, ArrowUpDown, Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { computeMatchScore } from "@/immosphera/lib/matchScore";
import { matchesPropertyType } from "@/immosphera/lib/propertyTypes";
import { detectOpportunity, trackProperty } from "@/immosphera/lib/opportunities";
import type { Tables } from "@/integrations/supabase/types";
const heroVilla = {
  url: "https://rbzizzzvitxwnfygdpzo.supabase.co/storage/v1/object/sign/immosphera-properties/branding/hero-villa.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV85ODRlOTQ2OC1mZGE2LTRiZDktYjA3Yi1mZTU4ODhlMDA0YWIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJpbW1vc3BoZXJhLXByb3BlcnRpZXMvYnJhbmRpbmcvaGVyby12aWxsYS5qcGciLCJzY29wZSI6ImRvd25sb2FkIiwiaWF0IjoxNzg3MjM4MjAxLCJleHAiOjIxMDI1OTgyMDF9.LP7w5gjsB2QDnBjIVBYW13FocCfp0-QC7IC8wrtMhfY",
};

type ViewMode = "grid" | "compact";

interface IndexProps {
  activeChip: string;
  onChipClick: (chip: string) => void;
  typeFilter?: string;
  /** Résultats de la recherche IA (ImmoAISearch) : liste d'ids à afficher en
   *  priorité, dans l'ordre renvoyé par Nova IA. null = pas de recherche IA
   *  active, la grille reste pilotée par les filtres classiques. */
  aiResultIds?: string[] | null;
  aiQueryText?: string;
  onClearAiResults?: () => void;
  onAiResults?: (ids: string[], queryText: string) => void;
}

export default function Index({
  activeChip,
  onChipClick,
  typeFilter = "",
  aiResultIds = null,
  aiQueryText = "",
  onClearAiResults,
  onAiResults,
}: IndexProps) {
  const isMobile = useIsMobile();
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  // Replié par défaut : le panneau de recherche déployé prenait trop de
  // place à l'écran — demande explicite de le garder replié en permanence
  // (l'utilisateur le déploie lui-même au besoin via le bouton existant).
  const [searchCollapsed, setSearchCollapsed] = useState(true);
  const [listView, setListView] = useState<ViewMode>("grid");
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(24);
  const [formOpen, setFormOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [sortByMatch, setSortByMatch] = useState(false);
  const [propalIds, setPropalIds] = useState<Set<string>>(new Set());
  const [currentPropalId, setCurrentPropalId] = useState<string | null>(null);
  const [showMapOnce, setShowMapOnce] = useState(false);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const mapWrapperRef = useRef<HTMLDivElement>(null);

  // Agrandir/quitter la carte en plein écran (API native, sans dépendance)
  const toggleMapFullscreen = () => {
    if (!mapWrapperRef.current) return;
    if (!document.fullscreenElement) {
      mapWrapperRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  useEffect(() => {
    const onFsChange = () => setIsMapFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Load active propal from DB
  const { data: activePropal } = useQuery({
    queryKey: ["active-propal", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_propals")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!user,
  });

  // Sync DB propal → local state
  useEffect(() => {
    if (activePropal) {
      setPropalIds(new Set(activePropal.property_ids));
      setCurrentPropalId(activePropal.id);
    }
  }, [activePropal]);

  // Mutation to save propal to DB
  const savePropalMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!user) return;
      if (currentPropalId) {
        const { error } = await supabase
          .from("immosphera_propals")
          .update({ property_ids: ids })
          .eq("id", currentPropalId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("immosphera_propals")
          .insert({ user_id: user.id, property_ids: ids })
          .select("id")
          .single();
        if (error) throw error;
        if (data) setCurrentPropalId(data.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-propal"] });
      queryClient.invalidateQueries({ queryKey: ["propals"] });
    },
  });

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_properties")
        .select("*")
        // Biens masqués (hidden_at) : conservés en base sans être supprimés,
        // mais exclus de la grille — cf. demande de repartir de zéro pour un
        // test réel de l'ajout de bien.
        .is("hidden_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      data.forEach((p) => trackProperty(p));
      return data;
    },
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_partners")
        .select("*")
        .order("last_name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { filters, setFilters, filteredProperties, isFiltering, resetFilters } = usePropertyFilters(properties);

  const showMap = activeChip === "Carte";
  const showSearch = true;

  // Garde la carte montée après sa première ouverture pour fluidifier les transitions.
  useEffect(() => {
    if (showMap) setShowMapOnce(true);
  }, [showMap]);

  // Nouveautés 15J
  const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
  const chipProperties =
    activeChip === "Nouveautés 15J"
      ? filteredProperties.filter((p) => {
          const createdDate = new Date(p.created_at).getTime();
          return createdDate >= fifteenDaysAgo;
        })
      : activeChip === "Propal clients"
        ? filteredProperties.filter((p) => propalIds.has(p.id))
        : activeChip === "Ventes"
          ? filteredProperties.filter((p) => ((p as any).listing_type ?? "sale") === "sale")
          : activeChip === "Locations"
            ? filteredProperties.filter((p) => (p as any).listing_type === "rental")
            : activeChip === "Sous offre"
              ? filteredProperties.filter((p) => (p as any).status === "under_offer")
              : activeChip === "Sous compromis"
                ? filteredProperties.filter((p) => (p as any).status === "under_compromise")
                : filteredProperties;

  const baseProperties = typeFilter
    ? chipProperties.filter((p) => matchesPropertyType(p.property_type, typeFilter))
    : chipProperties;

  // Match scores
  const scoredProperties = useMemo(() => {
    return baseProperties.map((p) => ({
      property: p,
      score: computeMatchScore(p, filters),
      opportunity: detectOpportunity(p, properties),
    }));
  }, [baseProperties, filters, properties]);

  const displayItems = useMemo(() => {
    if (sortByMatch) {
      return [...scoredProperties].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    }
    // Par défaut : du plus récent au plus ancien
    return [...scoredProperties].sort(
      (a, b) => new Date(b.property.created_at).getTime() - new Date(a.property.created_at).getTime(),
    );
  }, [scoredProperties, sortByMatch]);

  // Résultats de la recherche IA Immosphera360 : on affiche les biens
  // renvoyés par Nova IA, dans l'ordre donné, indépendamment des filtres
  // classiques actifs — l'utilisateur a explicitement demandé une recherche
  // en langage naturel, elle doit primer sur les chips/filtres en place.
  const aiDisplayItems = useMemo(() => {
    if (!aiResultIds || aiResultIds.length === 0) return null;
    const byId = new globalThis.Map(properties.map((p) => [p.id, p]));
    return aiResultIds
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((property) => ({
        property,
        score: computeMatchScore(property, filters),
        opportunity: detectOpportunity(property, properties),
      }));
  }, [aiResultIds, properties, filters]);

  const finalDisplayItems = aiDisplayItems ?? displayItems;
  const visibleItems = finalDisplayItems.slice(0, visibleCount);
  const canLoadMore = finalDisplayItems.length > visibleCount;

  const togglePropal = (property: Tables<"immosphera_properties">) => {
    setPropalIds((prev) => {
      const next = new Set(prev);
      if (next.has(property.id)) next.delete(property.id);
      else next.add(property.id);
      savePropalMutation.mutate([...next]);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero — masqué en mode Carte pour laisser toute la place aux filtres + à la carte */}
      {!showMap && (
        <div
          className="relative h-[min(48vh,420px)] bg-cover bg-center grid place-items-center px-6"
          style={{
            backgroundImage: `linear-gradient(120deg, hsl(30 30% 8% / 0.72), hsl(30 30% 8% / 0.12)), url('${heroVilla.url}')`,
          }}
        >
          <div className="text-center z-[1] w-full max-w-[1100px] space-y-5">
            <h1
              className="text-[clamp(28px,4.5vw,56px)] font-extrabold text-primary tracking-tight"
              style={{
                textShadow:
                  "2px 2px 0 hsl(0 0% 12%), 3px 3px 0 hsl(0 0% 18%), 4px 4px 0 hsl(0 0% 24%), 5px 5px 12px hsl(0 0% 0% / 0.5)",
              }}
            >
              ImmoSphera<span>360°</span>
            </h1>
            <p className="text-white/70 text-sm max-w-md mx-auto">
              Explorez notre sélection de biens immobiliers avec visites virtuelles 360°
            </p>
          </div>
        </div>
      )}

      {/* Search panel */}
      <div
        className="w-full px-5 mt-4 relative z-[8] mb-6"
        style={{
          display: "grid",
          gridTemplateRows: showSearch ? "1fr" : "0fr",
          opacity: showSearch ? 1 : 0,
          transition:
            "grid-template-rows 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
          marginBottom: showSearch ? undefined : "0px",
          marginTop: showSearch ? undefined : "0px",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              transform: showSearch ? "translateY(0) scale(1)" : "translateY(-30px) scale(0.97)",
              filter: showSearch ? "blur(0px)" : "blur(6px)",
              transition: "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), filter 0.5s ease",
            }}
          >
            <SearchPanel
              filters={filters}
              onChange={setFilters}
              onReset={resetFilters}
              properties={properties}
              resultCount={displayItems.length}
              isCollapsed={searchCollapsed}
              onToggleCollapse={() => setSearchCollapsed((p) => !p)}
              activeChip={activeChip}
              onChipClick={onChipClick}
              mapAvailable={true}
              canAdd={isAdmin}
              onAddProperty={() => setFormOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* Map — hidden on mobile. Rendue "en flux" (plus en fixed plein écran) pour
          rester correctement calée sous la TopBar du CRM et à droite de la Sidebar,
          quelle que soit la largeur disponible (repliée ou non). */}
      {!isMobile && (
        <div
          className="w-full px-5 relative z-[8] mb-6"
          style={{
            display: "grid",
            gridTemplateRows: showMap ? "1fr" : "0fr",
            opacity: showMap ? 1 : 0,
            transition: "grid-template-rows 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease",
          }}
        >
          <div style={{ overflow: "hidden" }}>
            <div
              ref={mapWrapperRef}
              className={`relative rounded-[26px] overflow-hidden border border-border shadow-[0_28px_60px_hsl(30_30%_8%/0.24)] bg-background ${
                isMapFullscreen ? "h-screen w-screen" : "h-[88vh]"
              }`}
            >
              <button
                type="button"
                onClick={toggleMapFullscreen}
                title={isMapFullscreen ? "Quitter le plein écran" : "Agrandir la carte"}
                className="absolute top-3 right-3 z-[1000] w-9 h-9 rounded-full bg-card/90 backdrop-blur-sm border border-border grid place-items-center hover:bg-card transition-colors shadow-md"
              >
                {isMapFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              {(showMap || showMapOnce) && (
                <PropertyMap
                  properties={baseProperties}
                  partners={partners}
                  hoveredId={hoveredPropertyId}
                  searchLocation={filters.selectedLocation}
                  searchRadius={filters.searchRadius}
                  filters={filters}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {(!showMap || isMobile) && (
        <div className="w-full px-11 pb-20 animate-fade-in">
          {aiDisplayItems && (
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm flex-1 min-w-0">
                Résultats IA pour « <span className="font-semibold">{aiQueryText}</span> » —{" "}
                {aiDisplayItems.length} bien{aiDisplayItems.length !== 1 ? "s" : ""} trouvé
                {aiDisplayItems.length !== 1 ? "s" : ""}.
              </p>
              {onClearAiResults && (
                <button
                  onClick={onClearAiResults}
                  className="ghost-btn text-xs shrink-0"
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Effacer
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 mb-7">
            <h2 className="text-lg font-bold">
              {finalDisplayItems.length} bien{finalDisplayItems.length !== 1 ? "s" : ""}{" "}
              {aiDisplayItems
                ? "(IA)"
                : activeChip === "Nouveautés 15J"
                  ? "récents"
                  : activeChip === "Propal clients"
                    ? "sélectionnés"
                    : activeChip === "Sous offre"
                      ? "sous offre"
                      : activeChip === "Sous compromis"
                        ? "sous compromis"
                        : "trouvés"}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSortByMatch((p) => !p)}
                className={`ghost-btn text-xs ${sortByMatch ? "!bg-gold-dark !text-gold !border-gold-dark" : ""}`}
              >
                <ArrowUpDown className="h-3.5 w-3.5 mr-1" /> Match
              </button>
              <button
                onClick={() => setListView("grid")}
                className={`ghost-btn ${listView === "grid" ? "!bg-gold-dark !text-gold !border-gold-dark" : ""}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setListView("compact")}
                className={`ghost-btn ${listView === "compact" ? "!bg-gold-dark !text-gold !border-gold-dark" : ""}`}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {isLoading || isFiltering ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-72 rounded-[22px]" />
              ))}
            </div>
          ) : finalDisplayItems.length === 0 ? (
            <div className="bg-card rounded-[22px] p-7 shadow-lg text-center text-muted-foreground">
              <Map className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="text-lg font-bold mb-1">Aucun bien trouvé</h3>
              <p className="text-sm">
                {aiDisplayItems
                  ? "Essayez de reformuler votre recherche IA."
                  : "Essayez de modifier vos filtres de recherche."}
              </p>
            </div>
          ) : (
            <>
              <div
                className={
                  listView === "grid"
                    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5"
                    : "space-y-3"
                }
              >
                {visibleItems.map(({ property, score, opportunity }) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    matchScore={score}
                    opportunity={opportunity}
                    isHovered={hoveredPropertyId === property.id}
                    isInPropal={propalIds.has(property.id)}
                    onHover={isMobile ? undefined : setHoveredPropertyId}
                    onTogglePropal={isMobile ? undefined : togglePropal}
                  />
                ))}
              </div>
              {canLoadMore && (
                <div className="flex justify-center mt-6">
                  <button className="ghost-btn px-5 py-2.5 text-sm" onClick={() => setVisibleCount((c) => c + 24)}>
                    Voir plus ({finalDisplayItems.length - visibleCount} restants)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Property form modal */}
      <PropertyFormModal open={formOpen} onOpenChange={setFormOpen} />

      {/* Propal bar — hidden on mobile */}
      {!isMobile && (
        <PropalBar
          propalIds={propalIds}
          properties={properties}
          onClear={() => {
            setPropalIds(new Set());
            savePropalMutation.mutate([]);
          }}
          onRemove={(id) => {
            setPropalIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              savePropalMutation.mutate([...next]);
              return next;
            });
          }}
          onCompare={() => setCompareOpen(true)}
        />
      )}

      {/* Compare modal */}
      <CompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        properties={properties.filter((p) => propalIds.has(p.id))}
      />
    </div>
  );
}
