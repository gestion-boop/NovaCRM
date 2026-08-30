import type { Tables } from "@/integrations/supabase/types";

type Property = Tables<"immosphera_properties">;

const HISTORY_KEY = "immosphera360-price-history";

interface PriceEntry {
  at: string;
  price: number | null;
  status: string;
}

function getHistory(): Record<string, PriceEntry[]> {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveHistory(history: Record<string, PriceEntry[]>) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

export function trackProperty(property: Property) {
  const history = getHistory();
  const entries = history[property.id] || [];
  const last = entries[entries.length - 1];
  const currentPrice = property.price ? Number(property.price) : null;
  const currentStatus = property.status || "active";

  if (!last || last.price !== currentPrice || last.status !== currentStatus) {
    entries.push({ at: new Date().toISOString(), price: currentPrice, status: currentStatus });
    history[property.id] = entries.slice(-20);
    saveHistory(history);
  }
}

export function getPropertyHistory(propertyId: string): PriceEntry[] {
  return getHistory()[propertyId] || [];
}

export interface Opportunity {
  priceDrop: boolean;
  underMarket: boolean;
  pricePerSqm: number | null;
  avgPerSqm: number | null;
}

export function detectOpportunity(
  property: Property,
  allProperties: Property[]
): Opportunity {
  const price = property.price ? Number(property.price) : null;
  const area = property.surface_area ? Number(property.surface_area) : null;
  const pricePerSqm = price && area ? price / area : null;

  // Price drop detection
  const history = getPropertyHistory(property.id);
  let priceDrop = false;
  if (history.length >= 2 && price) {
    const prev = history[history.length - 2];
    if (prev.price && prev.price > price) priceDrop = true;
  }

  // Under market detection
  let underMarket = false;
  let avgPerSqm: number | null = null;
  if (pricePerSqm) {
    const location = property.location || "";
    const similar = allProperties.filter(
      (p) =>
        p.id !== property.id &&
        p.property_type === property.property_type &&
        (p.location || "") === location &&
        p.price &&
        p.surface_area
    );
    if (similar.length >= 2) {
      const avgPrices = similar.map((p) => Number(p.price!) / Number(p.surface_area!));
      avgPerSqm = avgPrices.reduce((a, b) => a + b, 0) / avgPrices.length;
      if (pricePerSqm < avgPerSqm * 0.85) underMarket = true;
    }
  }

  return { priceDrop, underMarket, pricePerSqm, avgPerSqm };
}

// Average rents per sqm by property type (rough French estimates)
const AVG_RENT_PER_SQM: Record<string, number> = {
  apartment: 13,
  house: 10,
  villa: 12,
  studio: 18,
  loft: 14,
  commercial: 8,
  land: 0,
  other: 10,
};

export interface YieldEstimate {
  yieldPct: number;
  estimatedRent: number;
}

export function estimateYield(property: Property): YieldEstimate | null {
  const price = property.price ? Number(property.price) : null;
  const area = property.surface_area ? Number(property.surface_area) : null;
  if (!price || !area || price <= 0) return null;

  const rentPerSqm = AVG_RENT_PER_SQM[property.property_type] || 10;
  const monthlyRent = Math.round(area * rentPerSqm);
  if (monthlyRent <= 0) return null;

  const annualRent = monthlyRent * 12;
  const yieldPct = (annualRent / price) * 100;

  return { yieldPct, estimatedRent: monthlyRent };
}
