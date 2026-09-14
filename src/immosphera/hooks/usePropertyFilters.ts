import { useState, useEffect, useMemo } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { type SearchFilters, defaultFilters } from "@/immosphera/components/SearchPanel";
import { geocodeCity, distanceKm } from "@/immosphera/lib/geo";
import { matchesPropertyType } from "@/immosphera/lib/propertyTypes";
import { createLocationIndex, normalizeLocationText } from "@/immosphera/lib/locationNormalization";

type Property = Tables<"immosphera_properties">;

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value)
    .replace(/\s|\u00a0/g, "")
    .replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const parsed = parseFloat(s);
  return Number.isFinite(parsed) ? parsed : null;
}

export function usePropertyFilters(properties: Property[]) {
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
  const [filteredProperties, setFilteredProperties] = useState<Property[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);

  const locationIndex = useMemo(() => {
    const values = properties.flatMap((property) => [property.location, property.address]);
    return createLocationIndex(values);
  }, [properties]);

  const propertyMatchesLocation = (property: Property, query: string) =>
    locationIndex.matches(property.location, query) ||
    locationIndex.matches(property.address, query) ||
    normalizeLocationText(`${property.location || ""} ${property.address || ""}`).includes(
      normalizeLocationText(query),
    );

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setIsFiltering(true);

      let items = [...properties];

      // Type filter
      if (filters.selectedType) {
        items = items.filter((p) => matchesPropertyType(p.property_type, filters.selectedType));
      }

      // Text search
      if (filters.searchText) {
        const q = normalizeLocationText(filters.searchText);
        items = items.filter((p) => {
          const title = normalizeLocationText(p.title || "");
          const address = normalizeLocationText(p.address || "");
          // Demande explicite (15 septembre) : « la recherche de mandat
          // puisse se faire dans la barre de recherche si on tape un
          // numéro » — recherche exacte OU partielle sur mandate_number
          // (normalisée comme le reste : accents/casse ignorés, utile si
          // le numéro contient des lettres).
          const mandate = normalizeLocationText((p as any).mandate_number || "");
          return (
            title.includes(q) ||
            address.includes(q) ||
            (mandate.length > 0 && mandate.includes(q)) ||
            propertyMatchesLocation(p, filters.searchText)
          );
        });
      }

      // Budget
      const budgetMin = toNumber(filters.budgetMin);
      const budgetMax = toNumber(filters.budgetMax);
      if (budgetMin !== null || budgetMax !== null) {
        items = items.filter((p) => {
          const price = toNumber(p.price);
          if (price === null) return false;
          if (budgetMin !== null && price < budgetMin * 0.95) return false;
          if (budgetMax !== null && price > budgetMax * 1.05) return false;
          return true;
        });
      }

      // Surface
      const areaMin = toNumber(filters.areaMin);
      const areaMax = toNumber(filters.areaMax);
      if (areaMin !== null || areaMax !== null) {
        items = items.filter((p) => {
          const area = toNumber(p.surface_area);
          if (area === null) return false;
          if (areaMin !== null && area < areaMin * 0.95) return false;
          if (areaMax !== null && area > areaMax * 1.05) return false;
          return true;
        });
      }

      // Rooms
      const roomsMin = toNumber(filters.roomsMin);
      if (roomsMin !== null) {
        items = items.filter((p) => {
          const rooms = toNumber(p.rooms);
          return rooms !== null && rooms >= roomsMin;
        });
      }

      // Bedrooms
      const bedroomsMin = toNumber(filters.bedroomsMin);
      if (bedroomsMin !== null) {
        items = items.filter((p) => {
          const bedrooms = toNumber(p.bedrooms);
          return bedrooms !== null && bedrooms >= bedroomsMin;
        });
      }

      // Tech details (terrace, pool, serviced, builderFree)
      if (filters.terrace === "Oui") {
        items = items.filter((p) => {
          const td = p.tech_details as Record<string, string> | null;
          return td && td.terrace === "Oui";
        });
      }
      if (filters.pool === "Oui") {
        items = items.filter((p) => {
          const td = p.tech_details as Record<string, string> | null;
          return td && (td.pool === "Oui" || td.pool === "Possible");
        });
      }
      if (filters.servicedFilter) {
        items = items.filter((p) => {
          const td = p.tech_details as Record<string, string> | null;
          return td && td.serviced === filters.servicedFilter;
        });
      }
      if (filters.builderFreeFilter) {
        items = items.filter((p) => {
          const td = p.tech_details as Record<string, string> | null;
          return td && td.builderFree === filters.builderFreeFilter;
        });
      }

      // Location/distance filter
      if (filters.selectedLocation) {
        const locations = filters.selectedLocation
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (locations.length > 0) {
          if (locations.length === 1 && filters.searchRadius) {
            // Single location with radius
            const center = await geocodeCity(locations[0]);
            if (center) {
              const radius = Math.min(Number(filters.searchRadius) || 30, 50) * 1.2;
              const uniqueLocs = [...new Set(items.map((p) => p.location || p.address || "").filter(Boolean))];
              const coords = new Map<string, { lat: number; lng: number } | null>();
              await Promise.all(
                uniqueLocs.map(async (loc) => {
                  coords.set(loc, await geocodeCity(loc));
                }),
              );
              items = items.filter((p) => {
                if (p.latitude && p.longitude) {
                  return distanceKm(center, { lat: p.latitude, lng: p.longitude }) <= radius;
                }
                const fallbackLocation = p.location || p.address || "";
                const c = fallbackLocation ? coords.get(fallbackLocation) : null;
                return c ? distanceKm(center, c) <= radius : false;
              });
            }
          } else {
            // Recherche par ville et/ou code postal, avec regroupement des variantes.
            // Exemple : "11120", "Argeliers", "11120 Argeliers" et
            // "11120 - Argeliers" retrouvent les mêmes biens.
            items = items.filter((p) => locations.some((location) => propertyMatchesLocation(p, location)));
          }
        }
      }

      if (active) {
        setFilteredProperties(items);
        setIsFiltering(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [properties, filters, locationIndex]);

  const resetFilters = () => setFilters(defaultFilters);

  return { filters, setFilters, filteredProperties, isFiltering, resetFilters };
}
