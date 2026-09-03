import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Loader2, RefreshCw, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { couleurEtapeNovavisio, estEtapeSigneeNovavisio, categorieEtapeNovavisio, type CategorieNovavisio } from "@/lib/couleursNovavisio";
import { ficheALocaliser, geolocaliserFiche } from "@/lib/geolocalisationFiches";

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

// Signalé (3 septembre) : « En attente signature devis » contenait « sign »
// et passait pour signé — pin vert. La règle est maintenant celle du
// pipeline de Natacha (src/lib/couleursNovavisio) : signé = vert, attente
// de signature = orange, en discussion = jaune, prise de contact = bleu.
// La température ne sert plus que de repli quand l'étape n'a pas de couleur.
function isSignedStage(name: string | undefined | null): boolean {
  return estEtapeSigneeNovavisio(name || "");
}

function getPinColor(lead: LeadPoint, signed: boolean, stageName?: string | null): string {
  if (signed) return SIGNED_COLOR;
  const parEtape = couleurEtapeNovavisio(stageName || undefined);
  if (parEtape) return parEtape;
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
    <div style="display:flex;gap:10px;align-items:flex-start;margin-top:8px">
      <span style="flex:0 0 17px;opacity:0.85;margin-top:1px">${icone}</span>
      <span style="flex:1;min-width:0;color:#dbe4e6;font-size:13.5px;line-height:1.4;word-break:break-word">${echapper(valeur)}</span>
    </div>`;
}

const ICONE_TEL =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#F7BC5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const ICONE_MAIL =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#F7BC5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
const ICONE_ADRESSE =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#F7BC5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

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
    <div style="width:320px;border-radius:18px;overflow:hidden;background:#07191b;border:1px solid #1b4e52;box-shadow:0 16px 42px rgba(0,0,0,0.55);font-family:inherit">
      <div style="height:6px;background:${couleur}"></div>
      <div style="padding:14px 16px 15px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <p style="margin:0;font-size:17px;font-weight:800;color:#ffffff;line-height:1.2;letter-spacing:-0.01em">${echapper(nom)}</p>
          <span style="flex:0 0 auto;font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;padding:5px 10px;border-radius:999px;background:${couleur}22;color:${couleur};border:1px solid ${couleur}55;white-space:nowrap">${echapper(etat)}</span>
        </div>
        ${etape ? `<p style="margin:5px 0 0;font-size:12.5px;color:#7c9ba0;letter-spacing:0.02em">${echapper(etape)}</p>` : ''}
        ${telephone || email || adresse ? '<div style="height:1px;background:#153c3f;margin:13px 0 5px"></div>' : ''}
        ${ligneFiche(ICONE_TEL, telephone)}
        ${ligneFiche(ICONE_MAIL, email)}
        ${ligneFiche(ICONE_ADRESSE, adresse)}
        <p style="margin:14px 0 0;font-size:11.5px;color:#5b7c81">Cliquer pour ouvrir la fiche</p>
      </div>
    </div>`;
}

function createPinIcon(color: string, pulse: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:34px;height:34px;">
        ${pulse ? `<span style="position:absolute;inset:-8px;border-radius:9999px;background:${color};opacity:0.25;animation:carteprospection-pulse 1.8s ease-out infinite;"></span>` : ""}
        <svg width="34" height="34" viewBox="0 0 24 24" style="position:relative;filter:drop-shadow(0 3px 4px rgba(0,0,0,0.4));">
          <path fill="${color}" stroke="white" stroke-width="1.2" d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 15 9 15s9-8.25 9-15c0-4.97-4.03-9-9-9z"/>
          <circle cx="12" cy="9" r="3.4" fill="white"/>
        </svg>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -32],
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
  // Demande de Sylvain pour Natacha (3 septembre) : filtres par couleur en
  // haut de la carte, pour relancer les clients d'une couleur donnée, et une
  // recherche qui ne laisse que le pin du client tapé.
  const [couleursActives, setCouleursActives] = useState<Set<CategorieNovavisio>>(new Set());
  const [recherche, setRecherche] = useState("");
  const basculerCouleur = (c: CategorieNovavisio) =>
    setCouleursActives((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(c)) suivant.delete(c); else suivant.add(c);
      return suivant;
    });
  const categorieDe = (lead: LeadPoint): CategorieNovavisio | null => {
    const nom = stages.get(lead.stage_id ?? "")?.name;
    if (isSignedStage(nom)) return "signe";
    return categorieEtapeNovavisio(nom);
  };
  const normaliser = (v: string | null | undefined) =>
    (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // Rattrapage (3 septembre) : fiches avec une adresse mais sans point sur la
  // carte — l'ancienne géolocalisation n'a jamais fonctionné. Lancé tout seul
  // au chargement, et à la demande par le bouton « Localiser ».
  const [aLocaliser, setALocaliser] = useState<any[]>([]);
  const [localisation, setLocalisation] = useState<{ fait: number; total: number; introuvables: string[] } | null>(null);
  const localiserRef = useRef(false);

  const loadData = async () => {
    if (!isNovavisio) return;
    setLoading(true);
    const [{ data: leadRows }, { data: stageRows }] = await Promise.all([
      supabase
        .from("leads")
        // `*` et non une liste de colonnes : la corbeille (deleted_at) doit
        // être lue pour être filtrée, sans casser tant que la migration
        // 20260903120000 n'est pas appliquée. Toutes les fiches de l'agence,
        // pour repérer celles qui ont une adresse sans coordonnées.
        .select("*")
        .eq("agency_id", activeAgency.id),
      supabase.from("pipeline_stages").select("id, name, color").eq("agency_id", activeAgency.id),
    ]);

    const stageMap = new Map<string, StageInfo>();
    (stageRows ?? []).forEach((s) => stageMap.set(s.id, s as StageInfo));
    setStages(stageMap);
    // Corbeille (3 septembre) : une fiche mise de côté ne s'affiche plus sur la carte.
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
      // L'API Adresse demande de rester raisonnable : une requête par 250 ms.
      await new Promise((r) => setTimeout(r, 250));
    }
    localiserRef.current = false;
    await loadData();
  };

  // Lancement automatique dès qu'on connaît des fiches à localiser.
  useEffect(() => {
    if (aLocaliser.length > 0 && !localiserRef.current) void localiserManquantes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aLocaliser.length]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [activeAgency?.id, isNovavisio]);

  const signedCount = useMemo(
    () => leads.filter((l) => isSignedStage(stages.get(l.stage_id ?? "")?.name)).length,
    [leads, stages]
  );

  const compteurs = useMemo(() => {
    const c: Record<CategorieNovavisio, number> = { signe: 0, attente: 0, discussion: 0, contact: 0 };
    leads.forEach((l) => { const cat = categorieDe(l); if (cat) c[cat]++; });
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

  // Recherche : la carte se recentre sur le ou les pins restants, et zoome
  // sur le client quand il n'en reste qu'un.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !recherche.trim() || visibleLeads.length === 0) return;
    const bornes = L.latLngBounds(visibleLeads.map((l) => [l.latitude, l.longitude] as [number, number]));
    map.fitBounds(bornes, { padding: [60, 60], maxZoom: 15 });
  }, [visibleLeads, recherche]);

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
          offset: [0, -34],
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

        {/* Filtres par couleur : un clic allume une couleur, un autre l'éteint ;
            plusieurs couleurs peuvent être allumées ; aucune = tout. */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setCouleursActives(new Set())}
            className={`px-2.5 h-7 rounded-full border transition-colors ${couleursActives.size === 0 ? "bg-card shadow font-semibold border-border" : "border-border/60 text-muted-foreground hover:bg-foreground/5"}`}
          >
            Tous
          </button>
          {([
            ["signe", "Signé", SIGNED_COLOR],
            ["attente", "Attente de signature", WARM_COLOR],
            ["discussion", "En discussion", "#FACC15"],
            ["contact", "Prise de contact", COLD_COLOR],
          ] as [CategorieNovavisio, string, string][]).map(([cat, libelle, couleur]) => {
            const actif = couleursActives.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => basculerCouleur(cat)}
                aria-pressed={actif}
                title={`${actif ? "Masquer" : "Afficher"} : ${libelle}`}
                style={actif ? { borderColor: couleur, backgroundColor: `${couleur}22` } : undefined}
                className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full border transition-colors ${actif ? "font-semibold" : "border-border/60 text-muted-foreground hover:bg-foreground/5"}`}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: couleur }} />
                {libelle}
                <span className="opacity-70">{compteurs[cat]}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Recherche : ne laisse que le ou les pins dont le nom, l'e-mail ou
              le téléphone contient ce qui est tapé, et zoome dessus. */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Un client sur la carte…"
              aria-label="Rechercher un client sur la carte"
              className="h-8 w-44 sm:w-56 rounded-full border border-border/60 bg-foreground/5 pl-8 pr-7 text-xs outline-none focus:border-[#F7BC5F]"
            />
            {recherche && (
              <button
                type="button"
                onClick={() => setRecherche("")}
                aria-label="Effacer la recherche"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-muted-foreground hover:bg-foreground/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
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

      {/* État du rattrapage des adresses sans point. */}
      {(localisation || aLocaliser.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-1.5 text-xs border-b border-border bg-[#F7BC5F]/10">
          {localisation && localisation.fait < localisation.total ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Localisation des adresses : {localisation.fait}/{localisation.total}…</span>
            </>
          ) : localisation ? (
            <span>
              {localisation.total - localisation.introuvables.length} adresse{localisation.total - localisation.introuvables.length > 1 ? "s" : ""} placée{localisation.total - localisation.introuvables.length > 1 ? "s" : ""} sur la carte.
              {localisation.introuvables.length > 0 && (
                <> Introuvable{localisation.introuvables.length > 1 ? "s" : ""} (adresse à vérifier sur la fiche) : <b>{localisation.introuvables.join(", ")}</b>.</>
              )}
            </span>
          ) : (
            <>
              <span>{aLocaliser.length} fiche{aLocaliser.length > 1 ? "s" : ""} avec une adresse mais sans point.</span>
              <button type="button" onClick={localiserManquantes} className="px-2.5 h-6 rounded-full border border-border/60 bg-card hover:bg-foreground/5 font-semibold">
                Localiser
              </button>
            </>
          )}
        </div>
      )}

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
        {!loading && leads.length > 0 && visibleLeads.length === 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] px-3 py-1.5 rounded-full bg-card/95 border border-border text-xs shadow">
            Aucun client ne correspond {recherche.trim() ? `à « ${recherche.trim()} »` : "à ces couleurs"}.
          </div>
        )}
        <div ref={mapContainerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
