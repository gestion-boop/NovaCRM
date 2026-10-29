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
import {
  Map,
  LayoutGrid,
  List,
  ArrowUpDown,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
  Search,
  ChevronDown,
  ChevronUp,
  Tag,
  Key,
  FileText,
  FileSignature,
} from "lucide-react";
import { computeMatchScore } from "@/immosphera/lib/matchScore";
import { matchesPropertyType, VISIBLE_PROPERTY_TYPES } from "@/immosphera/lib/propertyTypes";
import { detectOpportunity, trackProperty } from "@/immosphera/lib/opportunities";
import type { Tables } from "@/integrations/supabase/types";
const heroVilla = {
  url: "https://rbzizzzvitxwnfygdpzo.supabase.co/storage/v1/object/sign/immosphera-properties/branding/hero-villa.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV85ODRlOTQ2OC1mZGE2LTRiZDktYjA3Yi1mZTU4ODhlMDA0YWIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJpbW1vc3BoZXJhLXByb3BlcnRpZXMvYnJhbmRpbmcvaGVyby12aWxsYS5qcGciLCJzY29wZSI6ImRvd25sb2FkIiwiaWF0IjoxNzg3MjM4MjAxLCJleHAiOjIxMDI1OTgyMDF9.LP7w5gjsB2QDnBjIVBYW13FocCfp0-QC7IC8wrtMhfY",
};

type ViewMode = "grid" | "compact";

const QUICK_FILTERS = [
  { chip: "", label: "Tous", icon: LayoutGrid },
  { chip: "Ventes", label: "Ventes", icon: Tag },
  { chip: "Locations", label: "Locations", icon: Key },
  { chip: "Nouveautés 15J", label: "Nouveautés", icon: Sparkles },
  { chip: "Sous offre", label: "Sous offre", icon: FileText },
  { chip: "Sous compromis", label: "Sous compromis", icon: FileSignature },
  { chip: "Carte", label: "Carte", icon: Map },
];

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
  showHero?: boolean;
  externalFormOpen?: boolean;
  onCloseExternalForm?: () => void;
  searchOpen?: boolean;
  onToggleSearch?: () => void;
  onCloseSearch?: () => void;
}

export default function Index({
  activeChip,
  onChipClick,
  typeFilter = "",
  aiResultIds = null,
  aiQueryText = "",
  onClearAiResults,
  onAiResults,
  showHero = true,
  externalFormOpen,
  onCloseExternalForm,
  searchOpen,
  onToggleSearch,
  onCloseSearch,
}: IndexProps) {
  const isMobile = useIsMobile();
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [localSearchOpen, setLocalSearchOpen] = useState(false);
  const isSearchDrawerOpen = searchOpen !== undefined ? searchOpen : localSearchOpen;
  const handleToggleSearch = () => {
    if (onToggleSearch) onToggleSearch();
    else setLocalSearchOpen((v) => !v);
  };
  const handleCloseSearch = () => {
    if (onCloseSearch) onCloseSearch();
    else setLocalSearchOpen(false);
  };
  const [listView, setListView] = useState<ViewMode>("grid");
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(24);
  const [formOpen, setFormOpen] = useState(false);
  const isFormOpen = externalFormOpen !== undefined ? externalFormOpen : formOpen;
  const handleSetFormOpen = (open: boolean) => {
    setFormOpen(open);
    if (!open && onCloseExternalForm) {
      onCloseExternalForm();
    }
  };
  const [compareOpen, setCompareOpen] = useState(false);
  const [sortByMatch, setSortByMatch] = useState(false);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>("");
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

  const effectiveTypeFilter = selectedTypeFilter || typeFilter;
  const baseProperties = effectiveTypeFilter
    ? chipProperties.filter((p) => matchesPropertyType(p.property_type, effectiveTypeFilter))
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
      {/* Hero photo 360° et Tiroir déroulant de recherche par-dessus */}
      <div className="relative w-full overflow-hidden">
        {/* Photo 360° Hero — masqué si showHero est false, en mode Carte, ou lors d'une recherche IA pour remonter les résultats */}
        {!showMap && showHero && !aiDisplayItems && (
          <div
            className="relative h-[min(48vh,420px)] bg-cover bg-center grid place-items-center px-6 transition-all duration-300 animate-in fade-in"
            style={{
              backgroundImage: `linear-gradient(120deg, hsl(30 30% 8% / 0.72), hsl(30 30% 8% / 0.12)), url('${heroVilla.url}')`,
            }}
          >
            <div className="text-center z-[1] w-full max-w-[1100px] space-y-4">
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

              {/* Bouton d'ouverture rapide sur la photo si le tiroir est fermé */}
              {!isSearchDrawerOpen && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleToggleSearch}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-black/65 hover:bg-black/85 text-[#F7BC5F] border border-[#F7BC5F]/40 hover:border-[#F7BC5F] backdrop-blur-md text-xs font-bold shadow-xl transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <Search className="h-4 w-4" />
                    <span>Ouvrir la recherche & filtres</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tiroir de recherche : descend par-dessus l'image de fond et remonte quand on le ferme */}
        <div
          className={`w-full z-30 transition-all duration-500 ease-in-out ${
            showHero && !showMap ? "absolute top-0 inset-x-0" : "relative"
          } ${
            isSearchDrawerOpen
              ? "translate-y-0 opacity-100 pointer-events-auto"
              : "-translate-y-full opacity-0 pointer-events-none"
          }`}
        >
          <div className="immosphera-drawer px-4 sm:px-8 py-5 bg-[#07171a]/95 backdrop-blur-2xl border-b border-[#F7BC5F]/35 shadow-[0_25px_60px_rgba(0,0,0,0.85)] max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="max-w-7xl mx-auto">
              <SearchPanel
                filters={filters}
                onChange={setFilters}
                onReset={resetFilters}
                properties={properties}
                resultCount={displayItems.length}
                isCollapsed={false}
                onToggleCollapse={handleCloseSearch}
                activeChip={activeChip}
                onChipClick={onChipClick}
                mapAvailable={true}
                canAdd={isAdmin}
                onAddProperty={() => setFormOpen(true)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Ruban unifié de filtres rapides & affichage — Standard plateforme NovaSphere */}
      <div className="w-full px-4 sm:px-11 pt-5 pb-1">
        <div className="flex flex-col gap-3 pb-3 border-b border-border/50">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Filtres rapides : Tous, Ventes, Locations, Nouveautés, Sous offre, Sous compromis, Carte */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {QUICK_FILTERS.map(({ chip, label, icon: Icon }) => {
                const active = activeChip === chip || (chip === "" && !activeChip);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      onChipClick(chip);
                      if (chip !== "Ventes" && chip !== "Locations") {
                        setSelectedTypeFilter("");
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      active
                        ? "bg-[#F7BC5F] text-slate-950 font-bold shadow-md shadow-[#F7BC5F]/20"
                        : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border border-border"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? "text-slate-950" : "text-[#F7BC5F]"}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Compteur et contrôles d'affichage (Grille, Liste, Tri) */}
            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
              <span className="text-xs text-muted-foreground font-medium">
                <strong className="text-foreground font-bold">{finalDisplayItems.length}</strong> bien{finalDisplayItems.length !== 1 ? "s" : ""}{" "}
                {aiDisplayItems
                  ? "(IA)"
                  : activeChip === "Nouveautés 15J"
                    ? "récents"
                    : activeChip === "Sous offre"
                      ? "sous offre"
                      : activeChip === "Sous compromis"
                        ? "sous compromis"
                        : "trouvés"}
              </span>
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setSortByMatch((p) => !p)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                    sortByMatch
                      ? "bg-[#F7BC5F] text-slate-950 font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Trier par pertinence IA"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Match</span>
                </button>
                <button
                  type="button"
                  onClick={() => setListView("grid")}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    listView === "grid"
                      ? "bg-[#F7BC5F] text-slate-950"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Affichage en grille"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setListView("compact")}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    listView === "compact"
                      ? "bg-[#F7BC5F] text-slate-950"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Affichage compact"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Sous-rangée d'onglets catégories de biens (Maison, Appartement, Professionnel, Terrain, Autre)
              qui apparaît dès qu'on clique sur Ventes ou Locations — demande explicite utilisateur */}
          {(activeChip === "Ventes" || activeChip === "Locations") && (
            <div className="flex items-center gap-2 pt-1 flex-wrap animate-in fade-in slide-in-from-top-1 duration-200">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mr-1">
                Catégories :
              </span>
              <button
                type="button"
                onClick={() => setSelectedTypeFilter("")}
                className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer border ${
                  !selectedTypeFilter
                    ? "bg-[#F7BC5F] text-slate-950 font-bold border-[#F7BC5F] shadow-sm"
                    : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border-border"
                }`}
              >
                Tous
              </button>
              {VISIBLE_PROPERTY_TYPES.map(({ value, label }) => {
                const isSelected = selectedTypeFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSelectedTypeFilter((prev) => (prev === value ? "" : value))}
                    className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer border ${
                      isSelected
                        ? "bg-[#F7BC5F] text-slate-950 font-bold border-[#F7BC5F] shadow-sm"
                        : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border-border"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
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
        <div className="w-full px-11 pb-20">
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
      <PropertyFormModal open={isFormOpen} onOpenChange={handleSetFormOpen} />

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
