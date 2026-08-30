import type { Tables } from "@/integrations/supabase/types";
import type { SearchFilters } from "@/immosphera/components/SearchPanel";
import { matchesPropertyType } from "@/immosphera/lib/propertyTypes";

type Property = Tables<"immosphera_properties">;

interface Weights {
  type: number;
  location: number;
  budget: number;
  area: number;
  rooms: number;
  bedrooms: number;
  features: number;
}

const WEIGHTS: Weights = {
  type: 20,
  location: 20,
  budget: 20,
  area: 15,
  rooms: 10,
  bedrooms: 10,
  features: 5,
};

function toNumber(v: any): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function withinRange(value: number, target: number, tolerance: number): number {
  if (value === target) return 1;
  const diff = Math.abs(value - target);
  const maxDiff = target * tolerance;
  if (diff >= maxDiff) return 0;
  return 1 - diff / maxDiff;
}

export function computeMatchScore(property: Property, filters: SearchFilters): number | null {
  const hasFilters =
    filters.selectedType ||
    filters.budgetMin ||
    filters.budgetMax ||
    filters.areaMin ||
    filters.areaMax ||
    filters.roomsMin ||
    filters.bedroomsMin ||
    filters.terrace ||
    filters.pool;

  if (!hasFilters) return null;

  // Always use full weight sum as denominator (100)
  const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const NEUTRAL = 0.5; // score for criteria not specified

  let totalScore = 0;
  let activeCount = 0;

  // Type match
  if (filters.selectedType) {
    activeCount++;
    totalScore += matchesPropertyType(property.property_type, filters.selectedType) ? WEIGHTS.type : 0;
  } else {
    totalScore += WEIGHTS.type * NEUTRAL;
  }

  // Location — always neutral for now (scored elsewhere)
  totalScore += WEIGHTS.location * NEUTRAL;

  // Budget match
  const budgetMin = toNumber(filters.budgetMin);
  const budgetMax = toNumber(filters.budgetMax);
  const price = toNumber(property.price);
  if ((budgetMin || budgetMax) && price) {
    activeCount++;
    const target = budgetMax ? (budgetMin ? (budgetMin + budgetMax) / 2 : budgetMax) : budgetMin!;
    totalScore += WEIGHTS.budget * withinRange(price, target, 0.3);
  } else {
    totalScore += WEIGHTS.budget * NEUTRAL;
  }

  // Area match
  const areaMin = toNumber(filters.areaMin);
  const areaMax = toNumber(filters.areaMax);
  const area = toNumber(property.surface_area);
  if ((areaMin || areaMax) && area) {
    activeCount++;
    const target = areaMax ? (areaMin ? (areaMin + areaMax) / 2 : areaMax) : areaMin!;
    totalScore += WEIGHTS.area * withinRange(area, target, 0.3);
  } else {
    totalScore += WEIGHTS.area * NEUTRAL;
  }

  // Rooms
  const roomsMin = toNumber(filters.roomsMin);
  const rooms = toNumber(property.rooms);
  if (roomsMin && rooms) {
    activeCount++;
    totalScore += rooms >= roomsMin ? WEIGHTS.rooms : WEIGHTS.rooms * (rooms / roomsMin);
  } else {
    totalScore += WEIGHTS.rooms * NEUTRAL;
  }

  // Bedrooms
  const bedroomsMin = toNumber(filters.bedroomsMin);
  const bedrooms = toNumber(property.bedrooms);
  if (bedroomsMin && bedrooms) {
    activeCount++;
    totalScore += bedrooms >= bedroomsMin ? WEIGHTS.bedrooms : WEIGHTS.bedrooms * (bedrooms / bedroomsMin);
  } else {
    totalScore += WEIGHTS.bedrooms * NEUTRAL;
  }

  // Features (terrace, pool)
  if (filters.terrace || filters.pool) {
    activeCount++;
    const td = property.tech_details as Record<string, string> | null;
    let featScore = 0;
    let featCount = 0;
    if (filters.terrace) {
      featCount++;
      if (td?.terrace === filters.terrace) featScore++;
    }
    if (filters.pool) {
      featCount++;
      if (td?.pool === filters.pool || (filters.pool === "Oui" && td?.pool === "Possible")) featScore++;
    }
    totalScore += WEIGHTS.features * (featCount ? featScore / featCount : 0);
  } else {
    totalScore += WEIGHTS.features * NEUTRAL;
  }

  return Math.round((totalScore / TOTAL_WEIGHT) * 100);
}
