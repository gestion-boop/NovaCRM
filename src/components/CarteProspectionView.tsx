import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { 
  MapPin, 
  Loader2, 
  RefreshCw, 
  Search, 
  X, 
  Moon, 
  Sun, 
  Compass, 
  AlertTriangle, 
  CheckCircle2, 
  Users
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { 
  couleurEtapeNovavisio, 
  estEtapeSigneeNovavisio, 
  categorieEtapeNovavisio, 
  type CategorieNovavisio 
} from "@/lib/couleursNovavisio";
import { ficheALocaliser, geolocaliserFiche } from "@/lib/geolocalisationFiches";

// Couleurs thématiques Novavisio pour la carte
const SIGNED_COLOR = "#10B981"; // Vert émeraude vibrant — client signé
const WARM_COLOR = "#F59E0B";   // Ambre doré — attente signature devis
const DISCUSSION_COLOR = "#FACC15"; // Jaune lumineux — prospect en discussion
const COLD_COLOR = "#38BDF8";   // Bleu ciel azur — prise de contact
const DEFAULT_COLOR = "#64748B"; // Gris ardoise — repli

interface LeadPoint {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  latitude: number;
  longitude: number;
  stage_id: string | null;
  temperature: "chaud" | "tiede" | "froid" | null;
  company: unknown;
  updated_at: string;
}

interface StageInfo {
  id: string;
  name: string;
  color: string;
}

function isSignedStage(name: string | undefined | null): boolean {
  return estEtapeSigneeNovavisio(name || "");
}

function getPinColor(lead: LeadPoint, signed: boolean, stageName?: string | null): string {
  if (signed) return SIGNED_COLOR;
  const parEtape = couleurEtapeNovavisio(stageName || undefined);
  if (parEtape) {
    if (parEtape === "#22C55E") return SIGNED_COLOR;
    if (parEtape === "#F97316") return WARM_COLOR;
    if (parEtape === "#FACC15") return DISCUSSION_COLOR;
    if (parEtape === "#3B82F6") return COLD_COLOR;
    return parEtape;
  }
  if (lead.temperature === "chaud" || lead.temperature === "tiede") return WARM_COLOR;
  if (lead.temperature === "froid") return COLD_COLOR;
  return DEFAULT_COLOR;
}

const TEMPERATURE_LABEL: Record<string, string> = {
  chaud: "Chaud",
  tiede: "Tiède",
  froid: "Froid",
};

function addressFromCompany(company: unknown): string | null {
  if (!company || typeof company !== "object") return null;
  const c = company as Record<string, unknown>;
  const parts = [c.address, c.postal_code, c.city].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
  return parts.length ? parts.join(", ") : null;
}

function echapper(valeur: unknown): string {
  return String(valeur ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ligneFiche(iconeSvg: string, valeur: string | null | undefined): string {
  if (!valeur || !String(valeur).trim()) return "";
  return `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-top:6px;">
      <span style="flex:0 0 16px;opacity:0.9;margin-top:1px;color:#F7BC5F;">${iconeSvg}</span>
      <span style="flex:1;min-width:0;color:#e2e8f0;font-size:12.5px;line-height:1.35;word-break:break-word;">${echapper(valeur)}</span>
    </div>`;
}

const ICONE_TEL =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const ICONE_MAIL =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
const ICONE_ADRESSE =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

function ficheSurvol(
  nom: string,
  couleur: string,
  etat: string,
  etape: string | null,
  telephone: string | null,
  email: string | null,
  adresse: string | null
): string {
  const initiales = nom
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "C";

  return `
    <div style="width:310px;border-radius:18px;overflow:hidden;background:rgba(8, 22, 26, 0.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(247, 188, 95, 0.35);box-shadow:0 24px 48px -12px rgba(0,0,0,0.7), 0 0 24px -4px rgba(247, 188, 95, 0.15);font-family:inherit;color:#ffffff;">
      <!-- Glowing header line with badge gradient -->
      <div style="height:5px;background:linear-gradient(90deg, ${couleur}, #F7BC5F);"></div>
      <div style="padding:15px 16px 14px;">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <div style="width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg, rgba(247, 188, 95, 0.2), rgba(15, 118, 110, 0.3));border:1px solid rgba(247, 188, 95, 0.4);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#F7BC5F;flex-shrink:0;">
            ${echapper(initiales)}
          </div>
          <div style="flex:1;min-width:0;">
            <p title="${echapper(nom)}" style="margin:0 0 4px;font-size:15px;font-weight:700;color:#ffffff;line-height:1.25;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${echapper(nom)}
            </p>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:${couleur}22;color:${couleur};border:1px solid ${couleur}66;">
                <span style="width:6px;height:6px;border-radius:999px;background:${couleur};box-shadow:0 0 6px ${couleur};"></span>
                ${echapper(etat)}
              </span>
            </div>
          </div>
        </div>

        ${etape ? `
          <div style="margin-bottom:10px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:#7c9ba0;">Étape :</span>
            <span style="font-size:11.5px;font-weight:600;color:#dbe4e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${echapper(etape)}</span>
          </div>
        ` : ""}

        ${telephone || email || adresse ? `
          <div style="height:1px;background:linear-gradient(90deg, transparent, rgba(27, 78, 82, 0.7), transparent);margin:10px 0 8px;"></div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${ligneFiche(ICONE_TEL, telephone)}
            ${ligneFiche(ICONE_MAIL, email)}
            ${ligneFiche(ICONE_ADRESSE, adresse)}
          </div>
        ` : ""}

        <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#F7BC5F;">
          <span style="display:flex;align-items:center;gap:5px;font-weight:600;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            Ouvrir la fiche client
          </span>
          <span style="opacity:0.65;font-size:10px;color:#94a3b8;">Clic direct</span>
        </div>
      </div>
    </div>`;
}

function createPinIcon(color: string, pulse: boolean): L.DivIcon {
  const safeId = color.replace("#", "");
  return L.divIcon({
    className: "nova-pin-marker",
    html: `
      <div style="position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
        ${pulse ? `<span style="position:absolute;inset:-8px;border-radius:9999px;background:${color};opacity:0.35;animation:carteprospection-pulse 2s cubic-bezier(0,0,0.2,1) infinite;"></span><span style="position:absolute;inset:-3px;border-radius:9999px;background:${color};opacity:0.25;animation:carteprospection-pulse 2s cubic-bezier(0,0,0.2,1) 0.6s infinite;"></span>` : ""}
        <div style="position:relative;width:34px;height:34px;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.55)) drop-shadow(0 0 8px ${color}66);transition:transform 0.2s ease;">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="pin-grad-${safeId}" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="#000000" stop-opacity="0.25"/>
              </linearGradient>
            </defs>
            <path d="M12 1.5C7.305 1.5 3.5 5.305 3.5 10c0 6.2 8.5 12.5 8.5 12.5s8.5-6.3 8.5-12.5c0-4.695-3.805-8.5-8.5-8.5z" 
                  fill="${color}" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 1.5C7.305 1.5 3.5 5.305 3.5 10c0 6.2 8.5 12.5 8.5 12.5s8.5-6.3 8.5-12.5c0-4.695-3.805-8.5-8.5-8.5z" 
                  fill="url(#pin-grad-${safeId})"/>
            <circle cx="12" cy="10" r="3.5" fill="#ffffff" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.4))"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 36],
    popupAnchor: [0, -36],
  });
}

interface CarteProspectionViewProps {
  onSelectContact?: (contactId: string) => void;
}

export default function CarteProspectionView({ onSelectContact }: CarteProspectionViewProps) {
  const { activeAgency } = useAuth();
  const isNovavisio = /novavisio/i.test(activeAgency?.name ?? "");

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const hasInitialFitRef = useRef(false);

  const [mapTheme, setMapTheme] = useState<"dark" | "light">("dark");
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<LeadPoint[]>([]);
  const [stages, setStages] = useState<Map<string, StageInfo>>(new Map());
  const [couleursActives, setCouleursActives] = useState<Set<CategorieNovavisio>>(new Set());
  const [recherche, setRecherche] = useState("");

  const basculerCouleur = (c: CategorieNovavisio) =>
    setCouleursActives((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(c)) suivant.delete(c);
      else suivant.add(c);
      return suivant;
    });

  const categorieDe = (lead: LeadPoint): CategorieNovavisio | null => {
    const nom = stages.get(lead.stage_id ?? "")?.name;
    if (isSignedStage(nom)) return "signe";
    return categorieEtapeNovavisio(nom);
  };

  const normaliser = (v: string | null | undefined) =>
    (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const [aLocaliser, setALocaliser] = useState<any[]>([]);
  const [localisation, setLocalisation] = useState<{ fait: number; total: number; introuvables: string[] } | null>(null);
  const localiserRef = useRef(false);

  const loadData = async () => {
    if (!isNovavisio) return;
    setLoading(true);
    const [{ data: leadRows }, { data: stageRows }] = await Promise.all([
      supabase
        .from("leads")
        .select("*")
        .eq("agency_id", activeAgency.id),
      supabase.from("pipeline_stages").select("id, name, color").eq("agency_id", activeAgency.id),
    ]);

    const stageMap = new Map<string, StageInfo>();
    (stageRows ?? []).forEach((s) => stageMap.set(s.id, s as StageInfo));
    setStages(stageMap);

    const vivantes = ((leadRows ?? []) as any[]).filter((l) => !l.deleted_at);
    setLeads(vivantes.filter((l) => l.latitude != null && l.longitude != null) as LeadPoint[]);
    setALocaliser(vivantes.filter(ficheALocaliser));
    setLoading(false);
  };

  const localiserManquantes = async () => {
    if (localiserRef.current || aLocaliser.length === 0) return;
    localiserRef.current = true;
    const introuvables: string[] = [];
    setLocalisation({ fait: 0, total: aLocaliser.length, introuvables });
    for (let i = 0; i < aLocaliser.length; i++) {
      const fiche = aLocaliser[i];
      const point = await geolocaliserFiche(fiche.id, fiche.company);
      if (!point) introuvables.push(fiche.full_name || fiche.id);
      setLocalisation({ fait: i + 1, total: aLocaliser.length, introuvables: [...introuvables] });
      await new Promise((r) => setTimeout(r, 250));
    }
    localiserRef.current = false;
    await loadData();
  };

  useEffect(() => {
    if (aLocaliser.length > 0 && !localiserRef.current) void localiserManquantes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aLocaliser.length]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadData();
  }, [activeAgency?.id, isNovavisio]);

  const signedCount = useMemo(
    () => leads.filter((l) => isSignedStage(stages.get(l.stage_id ?? "")?.name)).length,
    [leads, stages]
  );

  const compteurs = useMemo(() => {
    const c: Record<CategorieNovavisio, number> = { signe: 0, attente: 0, discussion: 0, contact: 0 };
    leads.forEach((l) => {
      const cat = categorieDe(l);
      if (cat) c[cat]++;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, stages]);

  const visibleLeads = useMemo(() => {
    const q = normaliser(recherche.trim());
    return leads.filter((l) => {
      if (couleursActives.size > 0) {
        const cat = categorieDe(l);
        if (!cat || !couleursActives.has(cat)) return false;
      }
      if (q) {
        const texte = normaliser(`${l.full_name} ${l.email ?? ""} ${l.phone ?? ""}`);
        if (!texte.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, stages, couleursActives, recherche]);

  // Initialisation de la carte Leaflet
  useEffect(() => {
    if (!isNovavisio || !mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });

    const url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

    const layer = L.tileLayer(url, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      subdomains: ["a", "b", "c"],
      maxZoom: 19,
      className: mapTheme === "dark" ? "nova-dark-tiles" : "",
    }).addTo(map);

    tileLayerRef.current = layer;
    map.setView([43.6, 3.5], 9);
    mapRef.current = map;

    // Assurer le calcul correct de la taille
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
  }, [isNovavisio]);

  // Changement dynamique du fond de carte (Sombre vs Clair)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    const url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

    const layer = L.tileLayer(url, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      subdomains: ["a", "b", "c"],
      maxZoom: 19,
      className: mapTheme === "dark" ? "nova-dark-tiles" : "",
    }).addTo(map);

    tileLayerRef.current = layer;
  }, [mapTheme]);

  // Gestion du redimensionnement de la fenêtre
  useEffect(() => {
    const onResize = () => {
      mapRef.current?.invalidateSize();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Marqueurs & fiches au survol
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    visibleLeads.forEach((lead) => {
      const stage = stages.get(lead.stage_id ?? "");
      const signed = isSignedStage(stage?.name);
      const color = getPinColor(lead, signed, stage?.name);
      const marker = L.marker([lead.latitude, lead.longitude], {
        icon: createPinIcon(color, signed),
      });

      const address = addressFromCompany(lead.company);
      const statusLabel = signed
        ? "✔ Signé"
        : couleurEtapeNovavisio(stage?.name || undefined)
        ? stage?.name || ""
        : lead.temperature
        ? TEMPERATURE_LABEL[lead.temperature]
        : stage?.name || "";

      marker.bindTooltip(
        ficheSurvol(
          lead.full_name,
          color,
          statusLabel || "Non renseigné",
          stage?.name ?? null,
          lead.phone,
          lead.email,
          address
        ),
        {
          direction: "top",
          offset: [0, -36],
          opacity: 1,
          className: "nova-carte-fiche",
        }
      );

      marker.on("tooltipopen", (e: L.LeafletEvent) => {
        const tooltipEl = (e as unknown as { tooltip?: L.Tooltip }).tooltip?.getElement?.();
        const mapEl = map.getContainer();
        if (!tooltipEl || !mapEl) return;
        const cadre = mapEl.getBoundingClientRect();
        const marge = 12;
        requestAnimationFrame(() => {
          const fiche = tooltipEl.getBoundingClientRect();
          let dx = 0;
          let dy = 0;
          if (fiche.top < cadre.top + marge) dy = cadre.top + marge - fiche.top;
          if (fiche.left < cadre.left + marge) dx = cadre.left + marge - fiche.left;
          if (fiche.right > cadre.right - marge) dx = Math.min(dx, cadre.right - marge - fiche.right);
          if (dx || dy) {
            tooltipEl.style.transform += ` translate(${dx}px, ${dy}px)`;
          }
        });
      });

      marker.on("click", () => onSelectContact?.(lead.id));
      marker.addTo(map);
      markersRef.current.push(marker);
    });

    // Ajustement de la vue initial ou quand tous les marqueurs sont chargés
    if (!hasInitialFitRef.current && visibleLeads.length > 0) {
      const bounds = L.latLngBounds(visibleLeads.map((l) => [l.latitude, l.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
      hasInitialFitRef.current = true;
    }
  }, [visibleLeads, stages, onSelectContact]);

  // Recalcul du cadre lors de la recherche
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !recherche.trim() || visibleLeads.length === 0) return;
    const bornes = L.latLngBounds(visibleLeads.map((l) => [l.latitude, l.longitude] as [number, number]));
    map.fitBounds(bornes, { padding: [60, 60], maxZoom: 15 });
  }, [visibleLeads, recherche]);

  const recentrerCarte = () => {
    const map = mapRef.current;
    if (!map) return;
    if (visibleLeads.length > 0) {
      const bornes = L.latLngBounds(visibleLeads.map((l) => [l.latitude, l.longitude] as [number, number]));
      map.fitBounds(bornes, { padding: [50, 50], maxZoom: 13 });
    } else {
      map.setView([43.6, 3.5], 9);
    }
  };

  if (!isNovavisio) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-teal-950/40 border border-teal-800/40 flex items-center justify-center text-teal-400 shadow-[0_0_20px_rgba(15,118,110,0.25)]">
          <MapPin className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-slate-300">
          Cette carte de prospection géolocalisée est réservée aux membres de l'agence Novavisio.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden relative bg-[#071315]">
      <style>{`
        @keyframes carteprospection-pulse {
          0% { transform: scale(0.6); opacity: 0.45; }
          100% { transform: scale(2.0); opacity: 0; }
        }
        /* Rendu Dark Night haute fidélité pour OpenStreetMap sans watermark ni clé */
        .nova-dark-tiles img {
          filter: brightness(0.6) invert(1) contrast(2.4) hue-rotate(195deg) saturate(0.35) brightness(0.75) !important;
        }
        .leaflet-tooltip.nova-carte-fiche {
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
          padding: 0 !important;
          border-radius: 18px !important;
          animation: carteprospection-fiche 0.18s cubic-bezier(0.16, 1, 0.3, 1);
          white-space: normal !important;
          max-width: none !important;
        }
        .leaflet-tooltip.nova-carte-fiche::before { display: none !important; }
        @keyframes carteprospection-fiche {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* Style Dark Glass pour les contrôles Leaflet */
        .leaflet-control-zoom {
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          box-shadow: 0 16px 32px -8px rgba(0, 0, 0, 0.7) !important;
          border-radius: 14px !important;
          overflow: hidden !important;
          backdrop-filter: blur(16px) !important;
          -webkit-backdrop-filter: blur(16px) !important;
          background: rgba(8, 22, 26, 0.85) !important;
        }
        .leaflet-control-zoom a {
          background: transparent !important;
          color: #F7BC5F !important;
          border-color: rgba(255, 255, 255, 0.08) !important;
          width: 34px !important;
          height: 34px !important;
          line-height: 34px !important;
          font-size: 16px !important;
          font-weight: 700 !important;
          transition: all 0.2s ease !important;
        }
        .leaflet-control-zoom a:hover {
          background: rgba(27, 78, 82, 0.8) !important;
          color: #ffffff !important;
        }
        .leaflet-container {
          background-color: #061113 !important;
          font-family: inherit !important;
        }
        .leaflet-control-attribution {
          background: rgba(8, 22, 26, 0.75) !important;
          color: #64748b !important;
          border-top-left-radius: 10px !important;
          padding: 3px 10px !important;
          backdrop-filter: blur(8px) !important;
          font-size: 10px !important;
          border: 1px solid rgba(255, 255, 255, 0.05) !important;
          border-right: none !important;
          border-bottom: none !important;
        }
        .leaflet-control-attribution a {
          color: #94a3b8 !important;
          text-decoration: none !important;
        }
        .leaflet-control-attribution a:hover {
          color: #F7BC5F !important;
        }
      `}</style>

      {/* Barre d'outils supérieure Glassmorphism */}
      <div className="relative z-20 flex-shrink-0 border-b border-teal-500/15 bg-gradient-to-r from-[#07191b]/95 via-[#0b2427]/95 to-[#07191b]/95 backdrop-blur-xl px-4 py-3 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Titre & Compteurs principaux */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/25 to-teal-800/40 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.25)] flex-shrink-0">
              <MapPin className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-white tracking-wide">
                  Carte de Prospection
                </h1>
                <span className="text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-[#F7BC5F]/15 text-[#F7BC5F] border border-[#F7BC5F]/30 shadow-[0_0_10px_rgba(247,188,95,0.15)]">
                  Novavisio
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                {loading ? (
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Loader2 className="h-3 w-3 animate-spin text-[#F7BC5F]" />
                    Chargement des coordonnées…
                  </span>
                ) : (
                  <span>
                    <strong className="text-white font-semibold">{leads.length}</strong> adresse{leads.length > 1 ? "s" : ""} localisée{leads.length > 1 ? "s" : ""}
                    <span className="mx-1.5 text-slate-600">·</span>
                    <strong className="text-emerald-400 font-semibold">{signedCount}</strong> signé{signedCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Filtres par étapes (Pills luxe avec counts et pastilles lumineuses) */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setCouleursActives(new Set())}
              className={`h-8 px-3.5 rounded-full border transition-all font-semibold flex items-center gap-1.5 shadow-sm ${
                couleursActives.size === 0
                  ? "bg-gradient-to-r from-[#F7BC5F]/20 to-[#F7BC5F]/10 border-[#F7BC5F]/60 text-[#F7BC5F] shadow-[0_0_12px_rgba(247,188,95,0.2)]"
                  : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.07]"
              }`}
            >
              <Users className="h-3.5 w-3.5 opacity-80" />
              <span>Tous</span>
              <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                couleursActives.size === 0 ? "bg-[#F7BC5F]/20 text-[#F7BC5F]" : "bg-white/10 text-slate-300"
              }`}>
                {leads.length}
              </span>
            </button>

            {([
              ["signe", "Signé", SIGNED_COLOR],
              ["attente", "Attente signature", WARM_COLOR],
              ["discussion", "En discussion", DISCUSSION_COLOR],
              ["contact", "Prise de contact", COLD_COLOR],
            ] as [CategorieNovavisio, string, string][]).map(([cat, libelle, couleur]) => {
              const actif = couleursActives.has(cat);
              const count = compteurs[cat] || 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => basculerCouleur(cat)}
                  aria-pressed={actif}
                  title={`${actif ? "Masquer" : "Afficher"} : ${libelle}`}
                  style={
                    actif
                      ? {
                          borderColor: `${couleur}99`,
                          backgroundColor: `${couleur}1c`,
                          boxShadow: `0 0 14px ${couleur}33`,
                          color: "#ffffff",
                        }
                      : undefined
                  }
                  className={`flex items-center gap-2 h-8 px-3 rounded-full border transition-all text-xs ${
                    actif
                      ? "font-semibold"
                      : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.07]"
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] flex-shrink-0"
                    style={{
                      background: couleur,
                      boxShadow: `0 0 6px ${couleur}`,
                    }}
                  />
                  <span>{libelle}</span>
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                      actif ? "bg-white/20 text-white" : "bg-white/5 text-slate-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Recherche, Mode sombre/clair et Actions */}
          <div className="flex items-center gap-2 ml-auto lg:ml-0">
            {/* Champ de recherche */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher un client…"
                aria-label="Rechercher un client sur la carte"
                className="h-8.5 w-44 sm:w-56 rounded-full border border-teal-500/25 bg-black/40 pl-8.5 pr-7 text-xs text-white placeholder:text-slate-500 outline-none focus:border-[#F7BC5F]/70 focus:ring-1 focus:ring-[#F7BC5F]/40 transition-all backdrop-blur-md"
              />
              {recherche && (
                <button
                  type="button"
                  onClick={() => setRecherche("")}
                  aria-label="Effacer la recherche"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Sélecteur de thème de carte (Dark Matter vs Voyager) */}
            <button
              type="button"
              onClick={() => setMapTheme((t) => (t === "dark" ? "light" : "dark"))}
              title={mapTheme === "dark" ? "Passer au thème clair" : "Passer au thème sombre"}
              className="h-8.5 px-3 rounded-full border border-teal-500/25 bg-black/30 hover:bg-teal-900/40 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5 transition-all shadow-sm backdrop-blur-md"
            >
              {mapTheme === "dark" ? (
                <>
                  <Moon className="h-3.5 w-3.5 text-[#F7BC5F]" />
                  <span className="hidden sm:inline">Sombre</span>
                </>
              ) : (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Clair</span>
                </>
              )}
            </button>

            {/* Bouton de recentrage */}
            <button
              type="button"
              onClick={recentrerCarte}
              title="Recentrer la carte"
              className="h-8.5 w-8.5 rounded-full border border-teal-500/25 bg-black/30 hover:bg-teal-900/40 text-slate-300 hover:text-white flex items-center justify-center transition-all shadow-sm backdrop-blur-md"
            >
              <Compass className="h-4 w-4" />
            </button>

            {/* Bouton Actualiser */}
            <button
              type="button"
              onClick={loadData}
              title="Actualiser les fiches et adresses"
              className="h-8.5 px-3.5 rounded-full border border-teal-500/25 bg-gradient-to-r from-teal-900/50 to-emerald-900/40 hover:from-teal-800/60 hover:to-emerald-800/50 text-xs font-semibold text-slate-100 hover:text-white flex items-center gap-1.5 transition-all shadow-sm backdrop-blur-md"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-[#F7BC5F]" : "text-slate-300"}`} />
              <span className="hidden md:inline">Actualiser</span>
            </button>
          </div>

        </div>
      </div>

      {/* Bannière géocodage / rattrapage des adresses sans coordonnées */}
      {(localisation || aLocaliser.length > 0) && (
        <div className="relative z-20 flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-yellow-950/30 to-amber-950/40 backdrop-blur-md text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
            {localisation && localisation.fait < localisation.total ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                Géocodage des adresses en cours : <strong>{localisation.fait}/{localisation.total}</strong>…
              </span>
            ) : localisation ? (
              <span>
                <strong>{localisation.total - localisation.introuvables.length}</strong> adresse{localisation.total - localisation.introuvables.length > 1 ? "s" : ""} positionnée{localisation.total - localisation.introuvables.length > 1 ? "s" : ""} avec succès.
                {localisation.introuvables.length > 0 && (
                  <span className="ml-1 text-amber-300/90">
                    Adresse introuvable pour : <strong>{localisation.introuvables.join(", ")}</strong>.
                  </span>
                )}
              </span>
            ) : (
              <span>
                <strong>{aLocaliser.length}</strong> fiche{aLocaliser.length > 1 ? "s" : ""} possède{aLocaliser.length > 1 ? "nt" : ""} une adresse sans coordonnées GPS.
              </span>
            )}
          </div>

          {!localisation && aLocaliser.length > 0 && (
            <button
              type="button"
              onClick={localiserManquantes}
              className="px-3 py-1 rounded-full border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 font-semibold transition-all shadow-sm flex items-center gap-1.5 text-xs"
            >
              <CheckCircle2 className="h-3 w-3 text-amber-400" />
              Localiser automatiquement
            </button>
          )}
        </div>
      )}

      {/* Conteneur de la Carte Leaflet plein écran */}
      <div className="relative flex-1 w-full h-full min-h-0">
        {loading && leads.length === 0 && (
          <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 bg-[#071315]/80 backdrop-blur-md">
            <div className="w-12 h-12 rounded-2xl bg-teal-900/40 border border-teal-700/40 flex items-center justify-center text-[#F7BC5F] shadow-[0_0_24px_rgba(247,188,95,0.25)]">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
            <p className="text-sm font-semibold text-slate-200">Chargement de la carte de prospection…</p>
          </div>
        )}

        {!loading && leads.length === 0 && (
          <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 text-center px-6 bg-[#071315]/90 backdrop-blur-md">
            <div className="w-14 h-14 rounded-2xl bg-teal-900/30 border border-teal-700/30 flex items-center justify-center text-teal-400">
              <MapPin className="h-7 w-7 opacity-70" />
            </div>
            <h3 className="text-base font-bold text-white">Aucune adresse localisée</h3>
            <p className="text-sm text-slate-400 max-w-sm">
              Renseignez une adresse postale sur vos fiches clients pour les faire apparaître automatiquement sur cette carte.
            </p>
          </div>
        )}

        {!loading && leads.length > 0 && visibleLeads.length === 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] px-4 py-2 rounded-full bg-[#081b1e]/90 border border-teal-500/30 text-xs text-slate-200 shadow-xl backdrop-blur-md flex items-center gap-2">
            <span>Aucun client ne correspond {recherche.trim() ? `à « ${recherche.trim()} »` : "aux filtres sélectionnés"}.</span>
            <button
              type="button"
              onClick={() => {
                setRecherche("");
                setCouleursActives(new Set());
              }}
              className="text-[#F7BC5F] hover:underline font-semibold ml-1"
            >
              Réinitialiser
            </button>
          </div>
        )}

        {/* Le div Leaflet attaché */}
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}
