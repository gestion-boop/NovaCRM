import { useNavigate } from "react-router-dom";
import type { Tables } from "@/integrations/supabase/types";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { geocodeCity, distanceKm } from "@/immosphera/lib/geo";
import { createTeardropIcon, adresseTooltipHtml } from "@/immosphera/lib/mapPins";
import { computeMatchScore } from "@/immosphera/lib/matchScore";
import type { SearchFilters } from "@/immosphera/components/SearchPanel";
import { Phone, Mail, Building2 } from "lucide-react";

interface Partner {
  id: string;
  first_name: string;
  last_name: string;
  category: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  intervention_area?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string;
}

interface Props {
  properties: Tables<"immosphera_properties">[];
  partners?: Partner[];
  hoveredId?: string | null;
  searchLocation?: string;
  searchRadius?: string;
  filters?: SearchFilters;
}

type MapTab = "biens" | "partenaires";

const PARTNER_CATEGORIES: { value: string; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "architecte", label: "Architecte" },
  { value: "automatisme", label: "Automatisme" },
  { value: "carreleur", label: "Carreleur" },
  { value: "chauffagiste", label: "Chauffagiste" },
  { value: "climaticien", label: "Climatisation" },
  { value: "courtier", label: "Courtier" },
  { value: "courtier_travaux", label: "Courtier en travaux" },
  { value: "couvreur", label: "Couvreur" },
  { value: "demenageur", label: "Déménageur" },
  { value: "diagnostiqueur", label: "Diagnostiqueur" },
  { value: "electricien", label: "Électricien" },
  { value: "expert_fissure", label: "Expert fissure" },
  { value: "geometre", label: "Géomètre" },
  { value: "jardinier", label: "Jardinier" },
  { value: "macon", label: "Maçon" },
  { value: "menuisier", label: "Menuisier" },
  { value: "multiservices", label: "Multiservices" },
  { value: "notaire", label: "Notaire" },
  { value: "peintre", label: "Peintre" },
  { value: "platrier", label: "Plâtrier" },
  { value: "plombier", label: "Plombier" },
  { value: "serrurier", label: "Serrurier" },
  { value: "terrassier", label: "Terrassier" },
  { value: "autre", label: "Autre" },
];

const CATEGORY_LABEL_MAP = Object.fromEntries(PARTNER_CATEGORIES.map((c) => [c.value, c.label]));

// Category colors for partner pins
const CATEGORY_COLORS: Record<string, string> = {
  architecte: "#6366f1",
  carreleur: "#f97316",
  chauffagiste: "#ef4444",
  climaticien: "#06b6d4",
  courtier: "#8b5cf6",
  courtier_travaux: "#7c3aed",
  couvreur: "#a3552a",
  demenageur: "#64748b",
  diagnostiqueur: "#0ea5e9",
  electricien: "#eab308",
  geometre: "#14b8a6",
  jardinier: "#22c55e",
  macon: "#d97706",
  menuisier: "#92400e",
  automatisme: "#a855f7",
  multiservices: "#059669",
  notaire: "#1e40af",
  peintre: "#ec4899",
  platrier: "#a1a1aa",
  plombier: "#3b82f6",
  serrurier: "#71717a",
  terrassier: "#854d0e",
  expert_fissure: "#b91c1c",
  autre: "#6b7280",
};

// Pin façon Google Maps — demande explicite : « cela s'affiche [...]
// comme un point ou un p comme Google Maps c'est peut-être plus joli
// d'ailleurs ». Voir mapPins.ts, partagé avec la carte Secteurs.
function createColoredIcon(color: string, isActive: boolean, status?: string, matchScore?: number | null) {
  const size = isActive ? 18 : 14;
  const hasStatus = status && status !== "active";
  const statusLabel = status === "under_offer" ? "OFFRE" : status === "under_compromise" ? "COMPROMIS" : "";
  const statusBadge = hasStatus
    ? `<span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:8px;font-weight:800;padding:1px 4px;border-radius:4px;background:#dc2626;color:white;line-height:1.2;letter-spacing:0.3px">${statusLabel}</span>`
    : "";
  const matchBadge =
    typeof matchScore === "number"
      ? `<span style="position:absolute;bottom:-12px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:8px;font-weight:800;padding:1px 4px;border-radius:4px;background:${matchScore >= 70 ? "#2f9e44" : matchScore >= 40 ? "#f59f00" : "#868e96"};color:white;line-height:1.2">${matchScore}%</span>`
      : "";
  return createTeardropIcon(hasStatus ? "#dc2626" : color, {
    size: isActive ? 32 : 26,
    extraHtml: `${statusBadge}${matchBadge}`,
  });
}

function createPartnerIcon(color: string, label: string) {
  return L.divIcon({
    className: "map-pin-partner",
    html: `<span style="position:relative;display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:${color};color:white;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white">${label}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 12],
  });
}

const formatPrice = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);

import { PROPERTY_TYPE_LABELS, matchesPropertyType } from "@/immosphera/lib/propertyTypes";
const typeLabels: Record<string, string> = { ...PROPERTY_TYPE_LABELS, Tous: "Tous" };

export function PropertyMap({ properties, partners = [], hoveredId, searchLocation, searchRadius, filters }: Props) {
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const circleRef = useRef<L.Circle | null>(null);

  const [mapCity, setMapCity] = useState("");
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState("Tous");
  const [selected, setSelected] = useState<Tables<"immosphera_properties"> | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [activeTab, setActiveTab] = useState<MapTab>("biens");
  const [partnerCategoryFilter, setPartnerCategoryFilter] = useState("all");

  // Centre du rayon : la ville recherchée, sinon le bien sélectionné sur la carte
  const circleCenter = useMemo(() => {
    if (mapCenter) return mapCenter;
    if (selected && selected.latitude && selected.longitude) return { lat: selected.latitude, lng: selected.longitude };
    return null;
  }, [mapCenter, selected]);

  const filteredProperties = useMemo(() => {
    let items = properties;
    if (typeFilter !== "Tous") {
      items = items.filter((p) => matchesPropertyType(p.property_type, typeFilter));
    }
    if (circleCenter && radiusKm) {
      items = items.filter((p) => {
        if (p.latitude == null || p.longitude == null) return false;
        const d = distanceKm(circleCenter, { lat: p.latitude, lng: p.longitude });
        return d <= radiusKm + 10;
      });
    }
    return items;
  }, [properties, typeFilter, circleCenter, radiusKm]);

  const filteredPartners = useMemo(() => {
    return partners.filter((p) => {
      if (!p.latitude || !p.longitude) return false;
      if (partnerCategoryFilter !== "all" && p.category !== partnerCategoryFilter) return false;
      return true;
    });
  }, [partners, partnerCategoryFilter]);

  // Biens dans le rayon de recherche, triés du moins cher au plus cher.
  // N'a de sens que lorsqu'un centre + un rayon (10/20/30 km) sont actifs.
  const radiusSortedProperties = useMemo(() => {
    if (!circleCenter || !radiusKm) return [];
    return [...filteredProperties].sort((a, b) => {
      const pa = a.price != null ? Number(a.price) : Infinity;
      const pb = b.price != null ? Number(b.price) : Infinity;
      return pa - pb;
    });
  }, [filteredProperties, circleCenter, radiusKm]);

  // Match scores map
  const matchScores = useMemo(() => {
    if (!filters) return new Map<string, number | null>();
    const map = new Map<string, number | null>();
    filteredProperties.forEach((p) => {
      map.set(p.id, computeMatchScore(p, filters));
    });
    return map;
  }, [filteredProperties, filters]);

  const getMarkerColor = useCallback((p: Tables<"immosphera_properties">) => {
    const dateRef = (p as any).listed_at || p.created_at;
    const ageMs = Date.now() - new Date(dateRef).getTime();
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    if (ageMs <= oneMonth) return "#2f9e44";
    if (ageMs <= 2 * oneMonth) return "#f59f00";
    return "#d94835";
  }, []);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);
    map.setView([43.183, 3.004], 10);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fit bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapCenter) return;

    if (activeTab === "biens" && properties.length > 0) {
      const bounds = L.latLngBounds(properties.map((p) => [p.latitude, p.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    } else if (activeTab === "partenaires" && filteredPartners.length > 0) {
      const bounds = L.latLngBounds(filteredPartners.map((p) => [p.latitude!, p.longitude!] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [properties, filteredPartners, mapCenter, activeTab]);

  // Update markers for properties
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (activeTab === "biens") {
      filteredProperties.forEach((p) => {
        if (p.latitude == null || p.longitude == null) return;
        const score = matchScores.get(p.id);
        const marker = L.marker([p.latitude, p.longitude], {
          icon: createColoredIcon(getMarkerColor(p), hoveredId === p.id, p.status, score),
        });

        const matchBadgeHtml =
          typeof score === "number"
            ? `<p style="font-size:11px;font-weight:800;margin:4px 0 0;color:${score >= 70 ? "#2f9e44" : score >= 40 ? "#f59f00" : "#868e96"}">Match ${score}%</p>`
            : "";

        const popupHtml = `
          <div style="min-width:180px;cursor:pointer" data-property-id="${p.id}">
            ${p.images?.[0] ? `<img src="${p.images[0]}" alt="${p.title}" style="width:100%;height:96px;object-fit:cover;border-radius:6px;margin-bottom:8px" />` : ""}
            <p style="font-weight:600;font-size:13px;margin:0">${p.title}</p>
            <p style="font-size:11px;color:#888;margin:2px 0">${p.location || p.address}</p>
            ${p.price ? `<p style="font-size:13px;font-weight:700;color:hsl(36 90% 60%);margin:4px 0">${formatPrice(Number(p.price))} €</p>` : ""}
            ${matchBadgeHtml}
          </div>
        `;

        marker.bindPopup(popupHtml);
        // Survol = adresse en aperçu rapide, sans avoir à cliquer — demande
        // explicite : « qu'on survole avec la souris [...] il y a
        // automatiquement l'adresse du client ou l'adresse du Bien ».
        marker.bindTooltip(adresseTooltipHtml(p.location || p.address || "", p.title), { direction: "top", offset: [0, -28] });
        marker.on("click", () => {
          setSelected(p);
          setSelectedPartner(null);
        });
        marker.on("popupopen", () => {
          const el = document.querySelector(`[data-property-id="${p.id}"]`);
          el?.addEventListener("click", () => navigate(`/immosphera/bien/${p.id}`));
        });
        marker.addTo(map);
        markersRef.current.push(marker);
      });
    } else {
      // Partners markers - offset overlapping ones
      const coordCounts = new Map<string, number>();
      filteredPartners.forEach((p) => {
        const key = `${p.latitude!.toFixed(4)},${p.longitude!.toFixed(4)}`;
        coordCounts.set(key, coordCounts.get(key) || 0);
      });
      const coordIndex = new Map<string, number>();

      filteredPartners.forEach((p) => {
        const key = `${p.latitude!.toFixed(4)},${p.longitude!.toFixed(4)}`;
        const idx = coordIndex.get(key) || 0;
        coordIndex.set(key, idx + 1);

        // Offset: spread in a small circle around the point
        const angle = (idx * 2 * Math.PI) / Math.max((coordCounts.get(key) || 1) + 1, 2);
        const offsetDeg = idx === 0 ? 0 : 0.003; // ~300m offset
        const lat = p.latitude! + offsetDeg * Math.sin(angle);
        const lng = p.longitude! + offsetDeg * Math.cos(angle);

        const color = CATEGORY_COLORS[p.category] || CATEGORY_COLORS.autre;
        const catLabel = CATEGORY_LABEL_MAP[p.category] || p.category;
        const marker = L.marker([lat, lng], {
          icon: createPartnerIcon(color, catLabel),
        });

        const phoneLink = p.phone
          ? `<a href="tel:${p.phone}" style="color:#2563eb;font-weight:600;font-size:12px;display:flex;align-items:center;gap:4px;margin:4px 0">📞 ${p.phone}</a>`
          : "";
        const emailLink = p.email
          ? `<a href="mailto:${p.email}" style="color:#2563eb;font-size:11px;display:flex;align-items:center;gap:4px">✉️ ${p.email}</a>`
          : "";

        const popupHtml = `
          <div style="min-width:180px">
            <p style="font-weight:700;font-size:14px;margin:0">${p.last_name} ${p.first_name}</p>
            <span style="display:inline-block;padding:2px 8px;border-radius:8px;background:${color};color:white;font-size:10px;font-weight:700;margin:4px 0">${catLabel}</span>
            ${p.company ? `<p style="font-size:11px;color:#666;margin:2px 0">🏢 ${p.company}</p>` : ""}
            ${p.intervention_area ? `<p style="font-size:11px;color:#666;margin:2px 0">📍 ${p.intervention_area}</p>` : ""}
            ${phoneLink}
            ${emailLink}
          </div>
        `;

        marker.bindPopup(popupHtml);
        marker.on("click", () => {
          setSelectedPartner(p);
          setSelected(null);
        });
        marker.addTo(map);
        markersRef.current.push(marker);
      });
    }
  }, [activeTab, filteredProperties, filteredPartners, getMarkerColor, hoveredId, navigate, matchScores]);

  // Circle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (circleRef.current) {
      circleRef.current.remove();
      circleRef.current = null;
    }
    if (circleCenter && radiusKm) {
      circleRef.current = L.circle([circleCenter.lat, circleCenter.lng], {
        radius: radiusKm * 1000,
        color: "#2f9e44",
        weight: 2,
        fillColor: "#2f9e44",
        fillOpacity: 0.08,
        dashArray: "6 4",
      }).addTo(map);
      map.fitBounds(circleRef.current.getBounds(), { padding: [30, 30] });
    }
  }, [circleCenter, radiusKm]);

  // Sync search panel props
  useEffect(() => {
    if (!searchLocation?.trim()) return;
    const loc = searchLocation.split(",")[0]?.trim();
    if (!loc) return;
    const r = searchRadius ? Number(searchRadius) : null;
    (async () => {
      const coords = await geocodeCity(loc);
      if (coords) {
        setMapCenter(coords);
        setMapCity(loc);
        if (r && r > 0) setRadiusKm(r);
      }
    })();
  }, [searchLocation, searchRadius]);

  // Demande explicite (8 septembre) : « la barre du bas doit correspondre à
  // celle du haut » — la ville et le rayon étaient déjà repris (ci-dessus),
  // mais pas le type de bien : choisir "Maison" en haut n'avait aucun effet
  // ici, la carte gardait son propre filtre "Tous" par défaut. Même
  // principe : simple reprise, l'utilisateur garde la main pour changer le
  // type juste sur la carte ensuite si besoin.
  useEffect(() => {
    if (filters?.selectedType) setTypeFilter(filters.selectedType);
  }, [filters?.selectedType]);

  // Pan to center
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapCenter) return;
    map.setView([mapCenter.lat, mapCenter.lng], 12);
  }, [mapCenter]);

  // Highlight hovered
  useEffect(() => {
    const map = mapRef.current;
    if (!map || activeTab !== "biens") return;
    markersRef.current.forEach((m, i) => {
      const p = filteredProperties[i];
      if (p) m.setIcon(createColoredIcon(getMarkerColor(p), hoveredId === p.id, p.status, matchScores.get(p.id)));
    });
  }, [hoveredId, filteredProperties, getMarkerColor, activeTab]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapCity.trim()) return;
    const coords = await geocodeCity(mapCity);
    if (coords) setMapCenter(coords);
  };

  const handleReset = () => {
    setMapCity("");
    setMapCenter(null);
    setRadiusKm(null);
    setTypeFilter("Tous");
    setPartnerCategoryFilter("all");
    setSelected(null);
    setSelectedPartner(null);
    const map = mapRef.current;
    if (map && properties.length > 0 && activeTab === "biens") {
      const bounds = L.latLngBounds(properties.map((p) => [p.latitude, p.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar + Filter strip */}
      <div className="bg-card border-b border-border">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 pt-2">
          <button
            onClick={() => {
              setActiveTab("biens");
              setSelectedPartner(null);
            }}
            className={`px-4 py-1.5 rounded-t-lg text-xs font-bold transition-all border border-b-0 ${
              activeTab === "biens"
                ? "bg-background text-foreground border-border"
                : "bg-transparent text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            🏠 Biens ({filteredProperties.length})
          </button>
          <button
            onClick={() => {
              setActiveTab("partenaires");
              setSelected(null);
            }}
            className={`px-4 py-1.5 rounded-t-lg text-xs font-bold transition-all border border-b-0 ${
              activeTab === "partenaires"
                ? "bg-background text-primary border-border"
                : "bg-transparent text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            🤝 Partenaires ({filteredPartners.length})
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 p-3 items-center">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              placeholder="Ville ou quartier..."
              value={mapCity}
              onChange={(e) => setMapCity(e.target.value)}
              className="h-8 px-3 text-xs rounded-full border border-border bg-background"
            />
            <button type="submit" className="primary-gold text-xs px-3 py-1 rounded-full">
              Rechercher
            </button>
          </form>

          {activeTab === "biens" ? (
            <>
              <div className="flex gap-1">
                {["Tous", "house", "apartment", "land", "commercial"].map((t) => (
                  <button
                    key={t}
                    className={`type-pill text-[10px] px-2 py-1 ${typeFilter === t ? "type-pill--active" : ""}`}
                    onClick={() => setTypeFilter(t)}
                  >
                    {typeLabels[t] || t}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {[10, 20, 30].map((r) => (
                  <button
                    key={r}
                    className={`type-pill text-[10px] px-2 py-1 ${radiusKm === r ? "type-pill--active" : ""}`}
                    onClick={() => setRadiusKm((prev) => (prev === r ? null : r))}
                  >
                    {r} km
                  </button>
                ))}
              </div>
              {/* Color legend */}
              <div className="flex items-center gap-3 ml-2">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#2f9e44" }} /> &lt; 1
                  mois
                </span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#f59f00" }} /> 1-2 mois
                </span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#d94835" }} /> &gt; 2
                  mois
                </span>
              </div>
            </>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {PARTNER_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  className={`type-pill text-[10px] px-2 py-1 ${partnerCategoryFilter === c.value ? "type-pill--active" : ""}`}
                  onClick={() => setPartnerCategoryFilter(c.value)}
                  style={
                    partnerCategoryFilter === c.value
                      ? {
                          background: CATEGORY_COLORS[c.value] || "#6b7280",
                          color: "white",
                          borderColor: CATEGORY_COLORS[c.value] || "#6b7280",
                        }
                      : {}
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          <button className="ghost-btn text-[10px]" onClick={handleReset}>
            Reset
          </button>

          {activeTab === "biens" && (
            <span className="text-[10px] text-muted-foreground ml-auto">{filteredProperties.length} biens</span>
          )}
        </div>
      </div>

      {/* Map + sidebar */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1">
          <div ref={mapContainerRef} className="h-full w-full" style={{ minHeight: "400px" }} />
        </div>

        {/* Sidebar */}
        <aside className="hidden md:block w-72 border-l border-border bg-card overflow-y-auto">
          {activeTab === "biens" && selected ? (
            <div className="p-4 space-y-3">
              {selected.images?.[0] && (
                <img src={selected.images[0]} alt={selected.title} className="w-full h-40 object-cover rounded-xl" />
              )}
              <h4 className="font-bold text-sm">{selected.title}</h4>
              <p className="text-xs text-muted-foreground">{selected.location || selected.address}</p>
              {selected.price && (
                <p className="text-lg font-bold text-primary">{formatPrice(Number(selected.price))} €</p>
              )}
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {selected.surface_area && <span>{selected.surface_area} m²</span>}
                {selected.rooms && <span>{selected.rooms} pièces</span>}
                {selected.bedrooms && <span>{selected.bedrooms} ch.</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.listing_url && (
                  <a href={selected.listing_url} target="_blank" rel="noreferrer" className="ghost-btn text-[10px]">
                    Site
                  </a>
                )}
                {selected.virtual_tour_url && (
                  <a
                    href={selected.virtual_tour_url}
                    target="_blank"
                    rel="noreferrer"
                    className="ghost-btn text-[10px]"
                  >
                    Visite
                  </a>
                )}
                {selected.giraffe_url && (
                  <a href={selected.giraffe_url} target="_blank" rel="noreferrer" className="ghost-btn text-[10px]">
                    Giraffe
                  </a>
                )}
              </div>
              {selected.agent_name && (
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  {selected.agent_photo && <img src={selected.agent_photo} alt="" className="w-8 h-8 rounded-full" />}
                  <div>
                    <p className="text-xs font-bold">{selected.agent_name}</p>
                    {selected.agent_phone && (
                      <p className="text-[10px] text-muted-foreground">{selected.agent_phone}</p>
                    )}
                  </div>
                </div>
              )}
              <button
                className="primary-gold w-full text-xs py-2"
                onClick={() => navigate(`/immosphera/bien/${selected.id}`)}
              >
                Ouvrir la fiche
              </button>
            </div>
          ) : activeTab === "biens" && circleCenter && radiusKm ? (
            /* Biens dans le rayon de recherche - triés du moins cher au plus cher */
            <div className="divide-y divide-border">
              <div className="p-3 bg-muted/30 sticky top-0 z-10 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-foreground">
                  {radiusSortedProperties.length} bien{radiusSortedProperties.length > 1 ? "s" : ""} dans {radiusKm} km
                </h4>
                <span className="text-[9px] text-muted-foreground shrink-0">Prix croissant</span>
              </div>
              {radiusSortedProperties.map((p) => (
                <div
                  key={p.id}
                  className="p-3 cursor-pointer hover:bg-muted/40 transition-colors flex gap-2.5"
                  onClick={() => setSelected(p)}
                >
                  {p.images?.[0] ? (
                    <img src={p.images[0]} alt={p.title} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-muted shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate">{p.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{p.location || p.address}</p>
                    {p.price != null && (
                      <p className="text-xs font-bold text-primary mt-0.5">{formatPrice(Number(p.price))} €</p>
                    )}
                  </div>
                </div>
              ))}
              {radiusSortedProperties.length === 0 && (
                <div className="p-6 text-center text-muted-foreground">
                  <p className="text-xs">Aucun bien dans ce rayon.</p>
                </div>
              )}
            </div>
          ) : activeTab === "biens" ? (
            <div className="p-6 text-center text-muted-foreground">
              <h4 className="font-bold mb-2">Sélectionne un bien</h4>
              <p className="text-xs">Clique sur un pin pour voir les détails.</p>
            </div>
          ) : (
            /* Partners list - sorted by most recent */
            <div className="divide-y divide-border">
              <div className="p-3 bg-muted/30 sticky top-0 z-10">
                <h4 className="text-xs font-bold text-foreground">
                  {filteredPartners.length} partenaire{filteredPartners.length > 1 ? "s" : ""}
                </h4>
              </div>
              {[...filteredPartners]
                .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                .map((p) => {
                  const color = CATEGORY_COLORS[p.category] || CATEGORY_COLORS.autre;
                  const catLabel = CATEGORY_LABEL_MAP[p.category] || p.category;
                  const dateStr = p.created_at
                    ? new Date(p.created_at).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                      })
                    : "";
                  return (
                    <div
                      key={p.id}
                      className={`p-3 cursor-pointer hover:bg-muted/40 transition-colors ${selectedPartner?.id === p.id ? "bg-muted/60" : ""}`}
                      onClick={() => setSelectedPartner(p)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">
                            {p.last_name} {p.first_name}
                          </p>
                          {p.company && <p className="text-[10px] text-muted-foreground truncate">{p.company}</p>}
                        </div>
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white shrink-0"
                          style={{ background: color }}
                        >
                          {catLabel}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        {p.intervention_area && (
                          <span className="text-[10px] text-muted-foreground truncate">📍 {p.intervention_area}</span>
                        )}
                        <span className="text-[9px] text-muted-foreground/60 shrink-0 ml-1">{dateStr}</span>
                      </div>
                      <div className="flex gap-1.5 mt-1.5">
                        {p.phone && (
                          <a
                            href={`tel:${p.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500/10 text-green-700 text-[10px] font-semibold hover:bg-green-500/20"
                          >
                            <Phone className="h-3 w-3" /> Appeler
                          </a>
                        )}
                        {p.email && (
                          <a
                            href={`mailto:${p.email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-700 text-[10px] font-semibold hover:bg-blue-500/20"
                          >
                            <Mail className="h-3 w-3" /> Email
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              {filteredPartners.length === 0 && (
                <div className="p-6 text-center text-muted-foreground">
                  <p className="text-xs">Aucun partenaire avec coordonnées GPS.</p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Mobile card overlay */}
      {activeTab === "biens" && selected && (
        <div className="md:hidden fixed bottom-4 left-4 right-4 bg-card rounded-xl shadow-lg border border-border p-3 z-50">
          <button className="absolute top-2 right-2 text-xs text-muted-foreground" onClick={() => setSelected(null)}>
            ✕
          </button>
          <div className="flex gap-3">
            {selected.images?.[0] && (
              <img src={selected.images[0]} alt="" className="w-20 h-20 rounded-lg object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{selected.title}</p>
              <p className="text-xs text-muted-foreground">{selected.location || selected.address}</p>
              {selected.price && (
                <p className="text-sm font-bold text-primary">{formatPrice(Number(selected.price))} €</p>
              )}
              <button
                className="primary-gold text-[10px] px-3 py-1 mt-1"
                onClick={() => navigate(`/immosphera/bien/${selected.id}`)}
              >
                Ouvrir
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTab === "partenaires" && selectedPartner && (
        <div className="md:hidden fixed bottom-4 left-4 right-4 bg-card rounded-xl shadow-lg border border-border p-3 z-50">
          <button
            className="absolute top-2 right-2 text-xs text-muted-foreground"
            onClick={() => setSelectedPartner(null)}
          >
            ✕
          </button>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                style={{ background: CATEGORY_COLORS[selectedPartner.category] || CATEGORY_COLORS.autre }}
              >
                {CATEGORY_LABEL_MAP[selectedPartner.category]}
              </span>
              <span className="font-bold text-sm">
                {selectedPartner.last_name} {selectedPartner.first_name}
              </span>
            </div>
            <div className="flex gap-2">
              {selectedPartner.phone && (
                <a
                  href={`tel:${selectedPartner.phone}`}
                  className="primary-gold text-[10px] px-3 py-1 flex items-center gap-1"
                >
                  <Phone className="h-3 w-3" /> Appeler
                </a>
              )}
              {selectedPartner.email && (
                <a
                  href={`mailto:${selectedPartner.email}`}
                  className="ghost-btn text-[10px] px-3 py-1 flex items-center gap-1"
                >
                  <Mail className="h-3 w-3" /> Email
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
