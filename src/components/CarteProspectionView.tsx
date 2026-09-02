import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

// Onglet "Carte" + tuile d'accueil demandés pour Novavisio, remis en place
// d'après un ancien backup ("mets pour novavisio la carte comme c'est sur le
// backup" / précisé : "l'onglet carte avec la tuile, qui correspond a la
// prospection de Natacha"). Aucune table dédiée dans la base — confirmé par
// inspection du backup (pg_restore -l), la fonctionnalité s'appuyait déjà
// sur les colonnes existantes de "leads" (latitude/longitude/geocoded_at),
// remplies via la géocodification déjà en place dans LeadDialog.tsx quand
// une adresse est saisie sur une fiche client. Message retrouvé dans
// l'historique confirmant le comportement attendu : "Il faudrait que tous
// les clients qui ont été signés et que Natacha rentre les adresses. Ça
// apparaissent avec le pin vert sur la carte."
//
// Demande explicite (couleurs des pins) : vert pour les signés, orange pour
// les tièdes/intéressés, bleu pour les froids. "chaud" n'a pas été précisé
// séparément — regroupé avec "tiède" sous l'orange (les deux étant "en
// cours d'intérêt", par opposition à "froid").
const SIGNED_COLOR = "#16a34a"; // vert — client signé
const WARM_COLOR = "#f97316"; // orange — tiède / chaud (intéressé)
const COLD_COLOR = "#2563eb"; // bleu — froid
const DEFAULT_COLOR = "#64748b"; // gris — température non renseignée

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
  if (!name) return false;
  return /sign/i.test(name);
}

function getPinColor(lead: LeadPoint, signed: boolean): string {
  if (signed) return SIGNED_COLOR;
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

// Demandé le 2 septembre : « quand on passe la souris sur un pin's de la
// carte, on doit voir le fichier du client dessus ». Le contenu est injecté
// en HTML dans une infobulle Leaflet : tout ce qui vient de la base doit donc
// être échappé, sinon une apostrophe ou un chevron dans un nom casse la carte
// (et, dans le pire des cas, y injecte du balisage).
function echapper(valeur: unknown): string {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Petite ligne d'information avec son icône, uniquement si la donnée existe.
function ligneFiche(icone: string, valeur: string | null | undefined): string {
  if (!valeur || !String(valeur).trim()) return '';
  return `
    <div style="display:flex;gap:7px;align-items:flex-start;margin-top:5px">
      <span style="flex:0 0 13px;opacity:0.75;margin-top:1px">${icone}</span>
      <span style="flex:1;min-width:0;color:#cbd5e1;font-size:11.5px;line-height:1.35;word-break:break-word">${echapper(valeur)}</span>
    </div>`;
}

const ICONE_TEL =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F7BC5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const ICONE_MAIL =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F7BC5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
const ICONE_ADRESSE =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F7BC5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

/**
 * La fiche client affichée au survol du pin : bandeau coloré à la couleur du
 * pin, nom, pastille d'état, puis téléphone / e-mail / adresse s'ils sont
 * renseignés. Rien d'inventé : une information absente ne laisse pas de ligne
 * vide.
 */
function ficheSurvol(
  nom: string,
  couleur: string,
  etat: string,
  etape: string | null,
  telephone: string | null,
  email: string | null,
  adresse: string | null
): string {
  return `
    <div style="width:232px;border-radius:14px;overflow:hidden;background:#07191b;border:1px solid #1b4e52;box-shadow:0 10px 30px rgba(0,0,0,0.45);font-family:inherit">
      <div style="height:4px;background:${couleur}"></div>
      <div style="padding:10px 12px 11px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <p style="margin:0;font-size:13px;font-weight:700;color:#ffffff;line-height:1.25">${echapper(nom)}</p>
          <span style="flex:0 0 auto;font-size:9.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:3px 7px;border-radius:999px;background:${couleur}22;color:${couleur};border:1px solid ${couleur}55">${echapper(etat)}</span>
        </div>
        ${etape ? `<p style="margin:3px 0 0;font-size:10.5px;color:#7c9ba0;letter-spacing:0.02em">${echapper(etape)}</p>` : ''}
        ${telephone || email || adresse ? '<div style="height:1px;background:#153c3f;margin:9px 0 4px"></div>' : ''}
        ${ligneFiche(ICONE_TEL, telephone)}
        ${ligneFiche(ICONE_MAIL, email)}
        ${ligneFiche(ICONE_ADRESSE, adresse)}
        <p style="margin:9px 0 0;font-size:10px;color:#5b7c81">Cliquer pour ouvrir la fiche</p>
      </div>
    </div>`;
}

function createPinIcon(color: string, pulse: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:26px;height:26px;">
        ${pulse ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:0.25;animation:carteprospection-pulse 1.8s ease-out infinite;"></span>` : ""}
        <svg width="26" height="26" viewBox="0 0 24 24" style="position:relative;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35));">
          <path fill="${color}" stroke="white" stroke-width="1.2" d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 15 9 15s9-8.25 9-15c0-4.97-4.03-9-9-9z"/>
          <circle cx="12" cy="9" r="3.4" fill="white"/>
        </svg>
      </div>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
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
  const markersRef = useRef<L.Marker[]>([]);

  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<LeadPoint[]>([]);
  const [stages, setStages] = useState<Map<string, StageInfo>>(new Map());
  const [filter, setFilter] = useState<"all" | "signed">("all");

  const loadData = async () => {
    if (!isNovavisio) return;
    setLoading(true);
    const [{ data: leadRows }, { data: stageRows }] = await Promise.all([
      supabase
        .from("leads")
        .select("id, full_name, phone, email, latitude, longitude, stage_id, temperature, company, updated_at")
        .eq("agency_id", activeAgency.id)
        .not("latitude", "is", null)
        .not("longitude", "is", null),
      supabase.from("pipeline_stages").select("id, name, color").eq("agency_id", activeAgency.id),
    ]);

    const stageMap = new Map<string, StageInfo>();
    (stageRows ?? []).forEach((s) => stageMap.set(s.id, s as StageInfo));
    setStages(stageMap);
    setLeads((leadRows ?? []) as LeadPoint[]);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [activeAgency?.id, isNovavisio]);

  const signedCount = useMemo(
    () => leads.filter((l) => isSignedStage(stages.get(l.stage_id ?? "")?.name)).length,
    [leads, stages]
  );

  const visibleLeads = useMemo(() => {
    if (filter === "all") return leads;
    return leads.filter((l) => isSignedStage(stages.get(l.stage_id ?? "")?.name));
  }, [leads, stages, filter]);

  // Init carte (identique au pattern déjà utilisé dans
  // src/immosphera/components/PropertyMap.tsx)
  useEffect(() => {
    if (!isNovavisio || !mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);
    map.setView([43.6, 3.5], 9);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [isNovavisio]);

  // Marqueurs
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    visibleLeads.forEach((lead) => {
      const stage = stages.get(lead.stage_id ?? "");
      const signed = isSignedStage(stage?.name);
      const color = getPinColor(lead, signed);
      const marker = L.marker([lead.latitude, lead.longitude], {
        icon: createPinIcon(color, signed),
      });

      const address = addressFromCompany(lead.company);
      const statusLabel = signed
        ? "✔ Signé"
        : lead.temperature
          ? TEMPERATURE_LABEL[lead.temperature]
          : stage?.name || "";
      // Infobulle au SURVOL plutôt que fenêtre au clic : le clic, lui, ouvre
      // la vraie fiche (voir juste en dessous). Sur mobile, où il n'y a pas
      // de survol, Leaflet l'affiche au premier appui.
      marker.bindTooltip(
        ficheSurvol(
          lead.full_name,
          color,
          statusLabel || 'Non renseigné',
          stage?.name ?? null,
          lead.phone,
          lead.email,
          address
        ),
        {
          direction: 'top',
          offset: [0, -28],
          opacity: 1,
          className: 'nova-carte-fiche',
        }
      );
      marker.on("click", () => onSelectContact?.(lead.id));
      marker.addTo(map);
      markersRef.current.push(marker);
    });

    if (visibleLeads.length > 0) {
      const bounds = L.latLngBounds(visibleLeads.map((l) => [l.latitude, l.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [visibleLeads, stages, onSelectContact]);

  if (!isNovavisio) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center px-6">
        <MapPin className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Cette carte est réservée aux membres de l'agence Novavisio.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <style>{`
        @keyframes carteprospection-pulse {
          0% { transform: scale(0.6); opacity: 0.35; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        /* Leaflet habille ses infobulles d'un cadre blanc à coins carrés : on
           le neutralise pour ne garder que la fiche elle-même. */
        .leaflet-tooltip.nova-carte-fiche {
          background: transparent;
          border: 0;
          box-shadow: none;
          padding: 0;
          border-radius: 14px;
          animation: carteprospection-fiche 0.14s ease-out;
        }
        .leaflet-tooltip.nova-carte-fiche::before { display: none; }
        @keyframes carteprospection-fiche {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 pt-3 pb-2 border-b border-border">
        <MapPin className="h-4 w-4 text-emerald-600" />
        <h1 className="text-sm font-semibold">Carte de prospection</h1>
        <span className="text-xs text-muted-foreground">
          {loading ? "Chargement…" : `${leads.length} adresse${leads.length > 1 ? "s" : ""} localisée${leads.length > 1 ? "s" : ""} · ${signedCount} signé${signedCount > 1 ? "s" : ""}`}
        </span>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground px-1">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SIGNED_COLOR }} />Signé</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: WARM_COLOR }} />Tiède / chaud</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: COLD_COLOR }} />Froid</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-full border border-border/60 bg-foreground/5 p-0.5 text-xs">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 h-7 rounded-full transition-colors ${filter === "all" ? "bg-card shadow font-semibold" : "text-muted-foreground"}`}
            >
              Tous
            </button>
            <button
              onClick={() => setFilter("signed")}
              className={`px-3 h-7 rounded-full transition-colors flex items-center gap-1 ${filter === "signed" ? "bg-card shadow font-semibold" : "text-muted-foreground"}`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: SIGNED_COLOR }} />
              Signés
            </button>
          </div>
          <button
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold border border-border/60 bg-foreground/5 hover:bg-foreground/10 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-[50vh]">
        {loading && leads.length === 0 && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && leads.length === 0 && (
          <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 text-center px-6 bg-background/80">
            <MapPin className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-xs">
              Aucune adresse localisée pour l'instant. Renseignez une adresse sur une fiche client pour qu'elle apparaisse ici.
            </p>
          </div>
        )}
        <div ref={mapContainerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
