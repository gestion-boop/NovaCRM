/**
 * Shared property type labels & grouping.
 * "house", "villa", and "loft" are merged into a single "Maison" category.
 */

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  apartment: "Appartement",
  house: "Maison",
  villa: "Maison",
  studio: "Appartement",
  loft: "Maison",
  commercial: "Professionnel",
  land: "Terrain",
  other: "Autre",
};

export const HOUSE_GROUP = ["house", "villa", "loft"];
export const APARTMENT_GROUP = ["apartment", "studio"];
/** Types to show in filter/selection UI (villa & loft hidden, merged into Maison) */
export const VISIBLE_PROPERTY_TYPES = [
  { value: "house", label: "Maison" },
  { value: "apartment", label: "Appartement" },
  { value: "commercial", label: "Professionnel" },
  { value: "land", label: "Terrain" },
  { value: "other", label: "Autre" },
];

/** Check if a property type matches a filter type (handles grouped types) */
export function matchesPropertyType(propertyType: string, filterType: string): boolean {
  if (!filterType) return true;
  if (filterType === "house") {
    return HOUSE_GROUP.includes(propertyType);
  }
  if (filterType === "apartment") {
    return APARTMENT_GROUP.includes(propertyType);
  }
  return propertyType === filterType;
}
