import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  Tag,
  Key as KeyIcon,
  Sparkles,
  Map as MapIcon,
  ArrowLeft,
  Plus,
  Users,
  MapPinned,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

import { PROPERTY_TYPE_LABELS, VISIBLE_PROPERTY_TYPES } from "@/immosphera/lib/propertyTypes";
import { createLocationIndex } from "@/immosphera/lib/locationNormalization";

const RENT_RANGES = ["< 500 €", "500-800 €", "800-1200 €", "1200-1800 €", "> 1800 €"];

// Onglet "Propal clients" (Ma sélection) retiré (8 septembre, demande
// explicite) — la sélection elle-même (bouton cœur sur une fiche bien,
// barre flottante "Générer le lien") reste disponible, seul cet onglet de
// filtre disparaît.
const PANEL_CHIPS = [
  { chip: "", label: "Tous", icon: LayoutGrid },
  { chip: "Ventes", label: "Ventes", icon: Tag },
  { chip: "Locations", label: "Locations", icon: KeyIcon },
  { chip: "Nouveautés 15J", label: "Nouveautés", icon: Sparkles },
] as const;

const PILL_BASE =
  "inline-flex shrink-0 items-center gap-2 h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-all";
const PILL_IDLE =
  "bg-foreground/[0.08] border-border/60 text-foreground/80 hover:text-foreground hover:border-primary/50";
const PILL_ACTIVE = "bg-card border-primary text-foreground shadow-lg";

export interface SearchFilters {
  searchMode: "Vente" | "Location";
  selectedType: string;
  selectedLocation: string;
  searchRadius: string;
  budgetMin: string;
  budgetMax: string;
  areaMin: string;
  areaMax: string;
  roomsMin: string;
  bedroomsMin: string;
  terrace: string;
  pool: string;
  searchText: string;
  servicedFilter: string;
  builderFreeFilter: string;
  rentRange: string;
}

export const defaultFilters: SearchFilters = {
  searchMode: "Vente",
  selectedType: "",
  selectedLocation: "",
  searchRadius: "",
  budgetMin: "",
  budgetMax: "",
  areaMin: "",
  areaMax: "",
  roomsMin: "",
  bedroomsMin: "",
  terrace: "",
  pool: "",
  searchText: "",
  servicedFilter: "",
  builderFreeFilter: "",
  rentRange: "",
};

interface Props {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onReset: () => void;
  properties: Tables<"immosphera_properties">[];
  resultCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeChip: string;
  onChipClick: (chip: string) => void;
  mapAvailable?: boolean;
  canAdd?: boolean;
  onAddProperty?: () => void;
}

export function SearchPanel({
  filters,
  onChange,
  onReset,
  properties,
  resultCount,
  isCollapsed,
  onToggleCollapse,
  activeChip,
  onChipClick,
  mapAvailable = true,
  canAdd = false,
  onAddProperty,
}: Props) {
  const navigate = useNavigate();
  const update = (partial: Partial<SearchFilters>) => onChange({ ...filters, ...partial });

  const uniqueLocations = useMemo(() => {
    const locationValues = properties.flatMap((property) => {
      const values: Array<string | null | undefined> = [property.location];

      // Certains anciens biens ont la commune uniquement dans l’adresse.
      // On l’ajoute à l’index afin qu’ils ne disparaissent pas des filtres.
      if (property.address) values.push(property.address);

      return values;
    });

    return createLocationIndex(locationValues).options;
  }, [properties]);

  const hasActiveFilters =
    filters.selectedType ||
    filters.selectedLocation ||
    filters.budgetMin ||
    filters.budgetMax ||
    filters.areaMin ||
    filters.areaMax ||
    filters.roomsMin ||
    filters.bedroomsMin ||
    filters.terrace ||
    filters.pool ||
    filters.servicedFilter ||
    filters.builderFreeFilter ||
    filters.rentRange;

  // Summary chips for collapsed mode
  const summaryChips = useMemo(() => {
    const chips: string[] = [];
    if (filters.selectedType) chips.push(PROPERTY_TYPE_LABELS[filters.selectedType] || filters.selectedType);
    if (filters.selectedLocation) {
      const primary = filters.selectedLocation.split(",")[0]?.trim();
      if (primary) chips.push(`📍 ${primary}`);
    }
    if (filters.searchRadius) chips.push(`Rayon ${filters.searchRadius} km`);
    if (filters.searchMode === "Vente") {
      if (filters.budgetMin || filters.budgetMax)
        chips.push(`💰 ${filters.budgetMin || "0"}-${filters.budgetMax || "∞"} €`);
      if (filters.areaMin || filters.areaMax) chips.push(`📐 ${filters.areaMin || "0"}-${filters.areaMax || "∞"} m²`);
      if (filters.roomsMin) chips.push(`${filters.roomsMin}+ pièces`);
      if (filters.bedroomsMin) chips.push(`${filters.bedroomsMin}+ ch`);
      if (filters.terrace) chips.push(`Terrasse ${filters.terrace}`);
      if (filters.pool) chips.push(`Piscine ${filters.pool}`);
      if (filters.servicedFilter) chips.push(`Viabilisé ${filters.servicedFilter}`);
      if (filters.builderFreeFilter) chips.push(`Constructeur ${filters.builderFreeFilter}`);
    } else {
      if (filters.rentRange) chips.push(filters.rentRange);
    }
    return chips;
  }, [filters]);

  const activePanelLabel =
    activeChip === "Carte" ? "Carte" : PANEL_CHIPS.find((item) => item.chip === activeChip)?.label || "Tous";

  if (isCollapsed) {
    return (
      <div
        className="bg-card/95 backdrop-blur-md border border-border rounded-[20px] px-4 py-3 shadow-[0_18px_34px_hsl(30_30%_8%/0.18)] cursor-pointer"
        onClick={onToggleCollapse}
        style={{ animation: "panel-rise 0.3s ease both" }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recherche</span>
            <span className="rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-xs font-bold">
              {activePanelLabel}
            </span>
            <span className="min-w-[26px] h-[26px] rounded-full grid place-items-center bg-primary/20 border border-primary/40 text-xs font-bold">
              {resultCount}
            </span>
          </div>

          <div className="flex items-center gap-1.5 overflow-hidden">
            {summaryChips.length > 0 ? (
              <>
                {summaryChips.slice(0, 4).map((chip) => (
                  <span
                    key={chip}
                    className="hidden sm:inline-flex rounded-full bg-foreground/[0.08] px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
                {summaryChips.length > 4 && (
                  <span className="hidden sm:inline-flex text-xs text-muted-foreground">
                    +{summaryChips.length - 4}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Cliquez pour développer</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-gradient-to-br from-card/98 via-card/95 to-secondary/90 border border-primary/25 rounded-[28px] p-6 shadow-[0_34px_70px_hsl(30_30%_8%/0.28)] relative"
      style={{ animation: "panel-rise 0.5s ease both" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-5 sticky top-3 z-[2] bg-card/95 backdrop-blur-md p-3 rounded-[18px] border border-border/50 shadow-lg">
        <div className="flex items-center gap-2">
          <button className={`${PILL_BASE} ${PILL_IDLE}`} onClick={() => navigate("/accueil")}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour
          </button>
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recherche avancée</span>
          <span className="min-w-[26px] h-[26px] rounded-full grid place-items-center bg-primary/20 border border-primary/40 text-xs font-bold">
            {resultCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button className="ghost-btn text-xs" onClick={onReset}>
              Réinitialiser
            </button>
          )}
          <button className="ghost-btn text-xs" onClick={onToggleCollapse}>
            Réduire
          </button>
          {canAdd && onAddProperty && (
            <button className="primary-gold text-xs" onClick={onAddProperty}>
              <Plus className="h-4 w-4 mr-1" /> Ajouter un bien
            </button>
          )}
        </div>
      </div>

      {/* Main property filters and map control */}
      <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PANEL_CHIPS.map(({ chip, label, icon: Icon }) => {
          const active = activeChip === chip || (chip === "" && activeChip === "Recherche");
          return (
            <button
              key={chip || "all"}
              type="button"
              onClick={() => onChipClick(chip)}
              className={`${PILL_BASE} ${active ? PILL_ACTIVE : PILL_IDLE}`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? "text-primary" : ""}`} />
              {label}
            </button>
          );
        })}

        {mapAvailable && (
          <>
            <span className="mx-1 h-7 w-px shrink-0 bg-border" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onChipClick("Carte")}
              className={`${PILL_BASE} ${activeChip === "Carte" ? PILL_ACTIVE : PILL_IDLE}`}
            >
              <MapIcon className={`h-3.5 w-3.5 ${activeChip === "Carte" ? "text-primary" : ""}`} />
              Carte
            </button>
          </>
        )}

        <span className="mx-1 h-7 w-px shrink-0 bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={() => navigate("/immosphera/partenaires")}
          className={`${PILL_BASE} ${PILL_IDLE}`}
        >
          <Users className="h-3.5 w-3.5" />
          Partenaires
        </button>
        {/* Demande explicite (14 septembre) : « avoir une carte par
            secteur » — cette barre (SearchPanel) est le SEUL endroit d'où
            on peut changer d'onglet depuis la page Biens (le bandeau de
            navigation d'Immosphera.tsx est volontairement masqué ici,
            voir isHome) : sans ce bouton, l'onglet Secteurs ajouté par
            ailleurs restait invisible/inatteignable depuis l'accueil. */}
        <button
          type="button"
          onClick={() => navigate("/immosphera/secteurs")}
          className={`${PILL_BASE} ${PILL_IDLE}`}
        >
          <MapPinned className="h-3.5 w-3.5" />
          Secteurs
        </button>
      </div>

      {/* Type pills */}
      <div className="flex flex-wrap gap-2.5 mb-5">
        {VISIBLE_PROPERTY_TYPES.map(({ value, label }) => (
          <button
            key={value}
            className={`type-pill ${filters.selectedType === value ? "type-pill--active" : ""}`}
            onClick={() => {
              update({
                selectedType: filters.selectedType === value ? "" : value,
                ...(value !== "land" ? { servicedFilter: "", builderFreeFilter: "" } : {}),
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Location */}
        <div className="field-card space-y-2">
          <p className="text-xs font-bold text-muted-foreground flex items-center gap-2">
            <span className="w-5 h-5 rounded-lg bg-primary/25 grid place-items-center text-[10px]">📍</span>
            Lieux (virgule pour multi)
          </p>
          <Input
            list="locations-list"
            placeholder="Ville ou quartier..."
            value={filters.selectedLocation}
            onChange={(e) => {
              update({
                selectedLocation: e.target.value,
                ...(e.target.value.includes(",") ? { searchRadius: "" } : {}),
              });
            }}
            className="bg-foreground/[0.06] text-foreground border-border placeholder:text-muted-foreground"
          />
          <datalist id="locations-list">
            {uniqueLocations.map((loc) => (
              <option key={loc} value={loc} />
            ))}
          </datalist>
          {filters.selectedLocation && !filters.selectedLocation.includes(",") && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">Distance (km)</p>
              <div className="flex gap-1.5">
                {["10", "20", "30"].map((r) => (
                  <button
                    key={r}
                    className={`type-pill text-[11px] px-2.5 py-1 ${filters.searchRadius === r ? "type-pill--active" : ""}`}
                    onClick={() => update({ searchRadius: filters.searchRadius === r ? "" : r })}
                  >
                    {r} km
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {filters.searchMode === "Vente" ? (
          <>
            {/* Budget */}
            <div className="field-card space-y-2">
              <p className="text-xs font-bold text-muted-foreground flex items-center gap-2">
                <span className="w-5 h-5 rounded-lg bg-primary/25 grid place-items-center text-[10px]">💰</span>
                Budget
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Min €"
                  value={filters.budgetMin}
                  onChange={(e) => update({ budgetMin: e.target.value })}
                  className="bg-foreground/[0.06] text-foreground border-border placeholder:text-muted-foreground"
                />
                <Input
                  type="number"
                  placeholder="Max €"
                  value={filters.budgetMax}
                  onChange={(e) => update({ budgetMax: e.target.value })}
                  className="bg-foreground/[0.06] text-foreground border-border placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* Terrain-specific filters */}
            {filters.selectedType === "land" && (
              <div className="field-card space-y-2">
                <p className="text-xs font-bold text-muted-foreground flex items-center gap-2">
                  <span className="w-5 h-5 rounded-lg bg-primary/25 grid place-items-center text-[10px]">🏗️</span>
                  Terrain
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-foreground/[0.06] text-foreground px-3 py-2 text-sm"
                    value={filters.servicedFilter}
                    onChange={(e) => update({ servicedFilter: e.target.value })}
                  >
                    <option value="">Viabilisé (tous)</option>
                    <option value="Oui">Viabilisé: Oui</option>
                    <option value="Non">Viabilisé: Non</option>
                  </select>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-foreground/[0.06] text-foreground px-3 py-2 text-sm"
                    value={filters.builderFreeFilter}
                    onChange={(e) => update({ builderFreeFilter: e.target.value })}
                  >
                    <option value="">Constructeur (tous)</option>
                    <option value="Oui">Libre: Oui</option>
                    <option value="Non">Libre: Non</option>
                  </select>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Rental mode */
          <div className="field-card space-y-2">
            <p className="text-xs font-bold text-muted-foreground flex items-center gap-2">
              <span className="w-5 h-5 rounded-lg bg-primary/25 grid place-items-center text-[10px]">🏠</span>
              Budget location
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RENT_RANGES.map((range) => (
                <button
                  key={range}
                  className={`type-pill text-[11px] px-2.5 py-1 ${filters.rentRange === range ? "type-pill--active" : ""}`}
                  onClick={() => update({ rentRange: filters.rentRange === range ? "" : range })}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Surface */}
        <div className="field-card space-y-2">
          <p className="text-xs font-bold text-muted-foreground flex items-center gap-2">
            <span className="w-5 h-5 rounded-lg bg-primary/25 grid place-items-center text-[10px]">📐</span>
            Surface
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Min m²"
              value={filters.areaMin}
              onChange={(e) => update({ areaMin: e.target.value })}
              className="bg-foreground/[0.06] text-foreground border-border placeholder:text-muted-foreground"
            />
            <Input
              type="number"
              placeholder="Max m²"
              value={filters.areaMax}
              onChange={(e) => update({ areaMax: e.target.value })}
              className="bg-foreground/[0.06] text-foreground border-border placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Rooms & extras */}
        <div className="field-card space-y-2">
          <p className="text-xs font-bold text-muted-foreground flex items-center gap-2">
            <span className="w-5 h-5 rounded-lg bg-primary/25 grid place-items-center text-[10px]">🏠</span>
            Pièces
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Pièces min"
              value={filters.roomsMin}
              onChange={(e) => update({ roomsMin: e.target.value })}
              className="bg-foreground/[0.06] text-foreground border-border placeholder:text-muted-foreground"
            />
            <Input
              type="number"
              placeholder="Ch. min"
              value={filters.bedroomsMin}
              onChange={(e) => update({ bedroomsMin: e.target.value })}
              className="bg-foreground/[0.06] text-foreground border-border placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {(["Terrasse", "Piscine"] as const).map((feat) => {
              const key = feat === "Terrasse" ? "terrace" : "pool";
              const val = filters[key];
              return (
                <button
                  key={feat}
                  className={`type-pill text-[11px] px-2.5 py-1 ${val === "Oui" ? "type-pill--active" : ""}`}
                  onClick={() => update({ [key]: val === "Oui" ? "" : "Oui" } as any)}
                >
                  {feat}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
