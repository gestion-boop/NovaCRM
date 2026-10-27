import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  MapPin,
  Maximize,
  BedDouble,
  Plus,
  ExternalLink,
  Edit,
  Trash2,
  Eye,
  UserCircle,
  Clock,
  Maximize2,
  X,
  Box,
  Droplet,
  Trees,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { VirtualTourIcon, Giraffe360Icon, WebsiteIcon } from "@/immosphera/components/PropertyIcons";
import React, { useState, useEffect, useRef } from "react";
import { TourShareModal } from "@/immosphera/components/TourShareModal";
import { PropertyFormModal } from "@/immosphera/components/PropertyFormModal";
import { AdvisorModal } from "@/immosphera/components/AdvisorModal";
import { ConfirmDeleteModal } from "@/immosphera/components/ConfirmDeleteModal";
import { getAdvisorById, advisors, type Advisor } from "@/immosphera/lib/advisors";
import { computeMatchScore } from "@/immosphera/lib/matchScore";
import { detectOpportunity, estimateYield, trackProperty } from "@/immosphera/lib/opportunities";
import { defaultFilters } from "@/immosphera/components/SearchPanel";
import type { Tables } from "@/integrations/supabase/types";
import { PROPERTY_TYPE_LABELS } from "@/immosphera/lib/propertyTypes";

/** Labels for structured tech_details fields */
const DETAIL_FIELDS: { key: string; label: string; category: string }[] = [
  { key: "salleDeBains", label: "Salle de bains", category: "Dimensions" },
  { key: "salleDeau", label: "Salle d'eau", category: "Dimensions" },
  { key: "wc", label: "WC", category: "Dimensions" },
  { key: "balcon", label: "Balcon", category: "Dimensions" },
  { key: "terrainSurface", label: "Terrain", category: "Dimensions" },
  { key: "chauffage", label: "Chauffage", category: "Équipements" },
  { key: "cuisine", label: "Cuisine", category: "Équipements" },
  { key: "garage", label: "Garage", category: "Équipements" },
  { key: "parking", label: "Parking", category: "Équipements" },
  { key: "descriptionPiscine", label: "Desc. piscine", category: "Équipements" },
  { key: "autres", label: "Autres", category: "Équipements" },
  { key: "construction", label: "Construction", category: "État & Détails" },
  { key: "etatInterieur", label: "État intérieur", category: "État & Détails" },
  { key: "ameublement", label: "Ameublement", category: "État & Détails" },
  { key: "vue", label: "Vue", category: "État & Détails" },
  { key: "exposition", label: "Exposition", category: "État & Détails" },
  { key: "cave", label: "Cave", category: "État & Détails" },
  { key: "assainissement", label: "Assainissement", category: "État & Détails" },
  { key: "taxeFonciere", label: "Taxe foncière", category: "Administratif" },
  { key: "reference", label: "Référence", category: "Administratif" },
  { key: "dpe", label: "DPE", category: "Administratif" },
  { key: "ges", label: "GES", category: "Administratif" },
];

const KNOWN_LABELS = new Set([
  "chauffage",
  "piscine",
  "autres",
  "surface",
  "pièces",
  "chambres",
  "salle de bains",
  "salle d'eau",
  "wc",
  "construction",
  "état intérieur",
  "cuisine",
  "ameublement",
  "vue",
  "exposition",
  "cave",
  "balcon",
  "description de la piscine",
  "terrain",
  "assainissement",
  "localisation",
  "taxe foncière",
  "référence",
  "garage",
  "parking",
  "étage",
  "ascenseur",
  "dpe",
  "ges",
  "diagnostic",
  "type de chauffage",
  "eau chaude",
  "internet",
  "meublé",
  "disponibilité",
  "loyer",
  "charges",
  "dépôt de garantie",
  "honoraires",
  "mandat",
]);

function parseDescription(text: string): { pairs: [string, string][]; freeText: string[] } {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const pairs: [string, string][] = [];
  const freeText: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const normalized = lines[i].toLowerCase().replace(/\s+/g, " ");
    if (KNOWN_LABELS.has(normalized) && i + 1 < lines.length) {
      pairs.push([lines[i], lines[i + 1]]);
      i += 2;
    } else {
      const colonMatch = lines[i].match(/^(.+?)\s*[:：]\s*(.+)$/);
      if (colonMatch) {
        pairs.push([colonMatch[1].trim(), colonMatch[2].trim()]);
      } else {
        freeText.push(lines[i]);
      }
      i++;
    }
  }
  return { pairs, freeText };
}

// Couleurs normalisées DPE/GES (A=vert → G=rouge), pour un repérage visuel
// immédiat au lieu d'une simple ligne de texte perdue dans les caractéristiques.
const DPE_COLORS: Record<string, string> = {
  A: "bg-emerald-500 text-white",
  B: "bg-green-500 text-white",
  C: "bg-lime-500 text-[#0b1c1e]",
  D: "bg-yellow-400 text-[#0b1c1e]",
  E: "bg-orange-500 text-white",
  F: "bg-orange-700 text-white",
  G: "bg-red-600 text-white",
};

function DpeBadge({ label, value }: { label: string; value: string }) {
  const letter = value.trim().toUpperCase();
  const colorClass = DPE_COLORS[letter] || "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shadow-sm ${colorClass}`}
      >
        {letter}
      </span>
      <span className="text-xs text-muted-foreground font-semibold">{label}</span>
    </div>
  );
}

// Bandeau de caractéristiques calqué sur le site immosphera.fr (icône dans
// un carré doré, libellé, valeur) — demande explicite : "reprendre un petit
// peu comme le site Internet Immosphera... se caler un peu aux couleurs".
function SpecTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center px-3 sm:px-5 py-1">
      <div className="w-11 h-11 rounded-xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 flex items-center justify-center text-[#F9C977]">
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

const CATEGORY_MAP: Record<string, string> = {
  surface: "Dimensions",
  pièces: "Dimensions",
  chambres: "Dimensions",
  "salle de bains": "Dimensions",
  "salle d'eau": "Dimensions",
  wc: "Dimensions",
  terrain: "Dimensions",
  balcon: "Dimensions",
  étage: "Dimensions",
  chauffage: "Équipements",
  piscine: "Équipements",
  cuisine: "Équipements",
  "description de la piscine": "Équipements",
  garage: "Équipements",
  parking: "Équipements",
  autres: "Équipements",
  ascenseur: "Équipements",
  construction: "État & Détails",
  "état intérieur": "État & Détails",
  ameublement: "État & Détails",
  vue: "État & Détails",
  exposition: "État & Détails",
  cave: "État & Détails",
  assainissement: "État & Détails",
  localisation: "Administratif",
  "taxe foncière": "Administratif",
  référence: "Administratif",
  dpe: "Administratif",
  ges: "Administratif",
};

function StructuredCharacteristics({ td, description }: { td: Record<string, string>; description?: string | null }) {
  const groups: Record<string, { label: string; value: string }[]> = {};

  // From structured tech_details
  DETAIL_FIELDS.forEach(({ key, label, category }) => {
    const val = td[key];
    if (val && val.trim() && val !== "Non") {
      if (!groups[category]) groups[category] = [];
      groups[category].push({ label, value: val });
    }
  });

  // Parse description for legacy data
  let legacyPairs: [string, string][] = [];
  let freeText: string[] = [];
  if (description) {
    const parsed = parseDescription(description);
    legacyPairs = parsed.pairs;
    freeText = parsed.freeText;
  }

  const existingKeys = new Set(
    DETAIL_FIELDS.filter((f) => td[f.key] && td[f.key].trim() && td[f.key] !== "Non").map((f) => f.label.toLowerCase()),
  );
  legacyPairs.forEach(([key, val]) => {
    if (existingKeys.has(key.toLowerCase())) return;
    const cat = CATEGORY_MAP[key.toLowerCase()] || "Autres infos";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ label: key, value: val });
  });

  const categoryOrder = ["Dimensions", "Équipements", "État & Détails", "Administratif", "Autres infos"];
  const hasContent = Object.keys(groups).length > 0 || freeText.length > 0;
  if (!hasContent) return null;

  return (
    <div className="space-y-5">
      {categoryOrder
        .filter((cat) => groups[cat])
        .map((cat) => (
          <div key={cat} className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/50 border-b border-border">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{cat}</p>
            </div>
            <div className="divide-y divide-border">
              {groups[cat].map(({ label, value }, i) => {
                // Signalé : dans "Autres infos", certaines valeurs ne sont
                // pas de courtes données (nombre, lettre DPE...) mais de
                // vrais paragraphes de description extraits du texte de
                // l'annonce — la ligne à pointillés/alignée à droite les
                // écrasait tout à droite, mal alignés et illisibles. Ces
                // valeurs longues passent désormais en dessous du label,
                // alignées à gauche comme un texte de description normal.
                const isLongValue = value.length > 40;
                if (isLongValue) {
                  return (
                    <div key={i} className="px-4 py-2.5 space-y-1">
                      <span className="text-sm text-muted-foreground font-medium">{label}</span>
                      <p className="text-sm font-medium text-left leading-relaxed">{value}</p>
                    </div>
                  );
                }
                // Ligne à pointillés façon fiche technique immosphera.fr,
                // au lieu d'un simple label/valeur alignés aux extrémités.
                return (
                  <div key={i} className="flex items-baseline gap-2 px-4 py-2.5">
                    <span className="text-sm text-muted-foreground shrink-0">{label}</span>
                    <span className="flex-1 border-b border-dotted border-[#F7BC5F]/30 translate-y-[-3px]" />
                    <span className="text-sm font-semibold text-right shrink-0 max-w-[50%]">{value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAdvisor, setSelectedAdvisor] = useState<Advisor | null>(null);
  const [tourFullscreen, setTourFullscreen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  // Enter/exit real browser fullscreen
  useEffect(() => {
    if (tourFullscreen && fullscreenRef.current) {
      fullscreenRef.current.requestFullscreen?.().catch(() => {});
    }
    if (!tourFullscreen && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [tourFullscreen]);

  // Sync state when user exits fullscreen via Escape
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement && tourFullscreen) {
        setTourFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [tourFullscreen]);
  const [tourShareOpen, setTourShareOpen] = useState(false);
  const [tourShareType, setTourShareType] = useState<"giraffe360" | "giraffe360_site">("giraffe360");

  const { data: properties = [] } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      // Même filtre hidden_at que Index.tsx (queryKey "properties" partagée
      // par React Query) : sinon la dernière requête exécutée écrase le
      // cache de l'autre avec un jeu de résultats incohérent.
      const { data, error } = await supabase.from("immosphera_properties").select("*").is("hidden_at", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: property, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("immosphera_properties").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // DB-based price history
  const { data: priceHistory = [] } = useQuery({
    queryKey: ["price-history", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_price_history")
        .select("*")
        .eq("property_id", id!)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (property) trackProperty(property);
  }, [property]);

  // Navigation clavier dans le diaporama plein écran (flèches + Échap).
  useEffect(() => {
    if (!lightboxOpen || !property) return;
    const slideCount = (property.virtual_tour_url ? 1 : 0) + (property.images?.length || 0);
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
      if (e.key === "ArrowLeft") setGalleryIndex((i) => (i - 1 + slideCount) % slideCount);
      if (e.key === "ArrowRight") setGalleryIndex((i) => (i + 1) % slideCount);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxOpen, property]);

  useEffect(() => {
    setGalleryIndex(0);
    setLightboxOpen(false);
  }, [id]);

  const matchScore = property ? computeMatchScore(property, defaultFilters) : null;
  const opportunity = property ? detectOpportunity(property, properties) : null;
  const yieldEst = property ? estimateYield(property) : null;
  const td = (property?.tech_details || {}) as Record<string, string>;

  const handleStatusChange = async (status: string) => {
    if (!property) return;
    const newStatus = property.status === status ? "active" : status;
    const { error } = await supabase.from("immosphera_properties").update({ status: newStatus }).eq("id", property.id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["property", id] });
    queryClient.invalidateQueries({ queryKey: ["properties"] });
    toast({ title: "Statut mis à jour" });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("immosphera_properties").delete().eq("id", id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    setDeleteOpen(false);
    queryClient.invalidateQueries({ queryKey: ["properties"] });
    toast({ title: "Bien supprimé" });
    navigate("/immosphera");
  };

  const openAdvisorModal = () => {
    // Try to find advisor by agent_name match
    const found = advisors.find((a) => a.name === property?.agent_name) || null;
    setSelectedAdvisor(found);
    if (found) setAdvisorOpen(true);
  };

  const handleAddToPropal = async () => {
    if (!user || !property) {
      toast({ title: "Connexion requise", variant: "destructive" });
      return;
    }
    const { data: existing } = await supabase
      .from("immosphera_propals")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) {
      const propal = existing[0];
      if (propal.property_ids.includes(property.id)) {
        toast({ title: "Déjà ajouté" });
        return;
      }
      await supabase
        .from("immosphera_propals")
        .update({ property_ids: [...propal.property_ids, property.id] })
        .eq("id", propal.id);
    } else {
      await supabase.from("immosphera_propals").insert({ user_id: user.id, property_ids: [property.id] });
    }
    toast({ title: "Ajouté à la proposition !" });
  };

  if (isLoading) {
    return (
      <div className="container py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="container py-20 text-center">
        <h2 className="text-xl font-semibold">Bien introuvable</h2>
        <Button variant="ghost" className="mt-4" onClick={() => navigate("/immosphera")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full py-6 max-w-[1400px] mx-auto px-4 sm:px-6 space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <button
          type="button"
          onClick={() => navigate("/immosphera")}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 text-[#F7BC5F]" />
          <span>Retour aux biens</span>
        </button>

        {user && isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Edit className="mr-2 h-3.5 w-3.5" /> Modifier
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Supprimer
            </Button>
          </div>
        )}
      </div>

      {/* Status toggles */}
      {user && (
        <div className="flex gap-2">
          <button
            className={`type-pill text-xs ${property.status === "under_offer" ? "type-pill--active" : ""}`}
            onClick={() => handleStatusChange("under_offer")}
          >
            Sous offre
          </button>
          <button
            className={`type-pill text-xs ${property.status === "under_compromise" ? "type-pill--active" : ""}`}
            onClick={() => handleStatusChange("under_compromise")}
          >
            Sous compromis
          </button>
        </div>
      )}

      {/* Galerie panoramique : une seule grande photo à la fois avec flèches
          gauche/droite pour défiler (au lieu d'une grille de miniatures) —
          la visite virtuelle vient en 1ère position, à la place de la
          photo principale, comme sur immosphera.fr. */}
      {(property.virtual_tour_url || (property.images && property.images.length > 0)) && (() => {
        const photos: string[] = property.images || [];
        const slides: Array<{ type: "tour" } | { type: "photo"; url: string }> = [
          ...(property.virtual_tour_url ? [{ type: "tour" as const }] : []),
          ...photos.map((url) => ({ type: "photo" as const, url })),
        ];
        const slide = slides[Math.min(galleryIndex, slides.length - 1)];
        return (
          <div className="relative w-full h-[38vh] sm:h-[52vh] lg:h-[68vh] rounded-2xl overflow-hidden bg-muted border border-border group">
            {slide?.type === "tour" ? (
              <button
                type="button"
                onClick={() => setTourFullscreen(true)}
                className="relative w-full h-full block"
                title="Agrandir la visite virtuelle"
              >
                <iframe src={property.virtual_tour_url!} className="w-full h-full pointer-events-none" title="Visite virtuelle" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 text-[#0b1c1e] text-sm font-bold px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
                    <Maximize2 className="w-4 h-4" /> Agrandir la visite virtuelle
                  </span>
                </div>
                <span className="absolute top-3 left-3 bg-black/65 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5">
                  <Giraffe360Icon className="h-3.5 w-3.5" /> Visite virtuelle 360°
                </span>
              </button>
            ) : slide ? (
              <img
                src={slide.url}
                alt={property.title}
                onClick={() => setLightboxOpen(true)}
                className="w-full h-full object-cover cursor-zoom-in"
              />
            ) : null}

            {slides.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setGalleryIndex((i) => (i - 1 + slides.length) % slides.length)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                  title="Photo précédente"
                >
                  <ChevronLeftIcon className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setGalleryIndex((i) => (i + 1) % slides.length)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                  title="Photo suivante"
                >
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
                  {slides.map((_, i) => (
                    <span
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${i === galleryIndex ? "bg-white" : "bg-white/40"}`}
                    />
                  ))}
                </div>
                <span className="absolute top-3 right-3 bg-black/65 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  {galleryIndex + 1} / {slides.length}
                </span>
              </>
            )}
          </div>
        );
      })()}

      {/* Diaporama plein écran au clic sur une photo (demande explicite),
          avec les mêmes flèches gauche/droite pour défiler toutes les
          photos — cf. `slides`/`galleryIndex` de la galerie ci-dessus. */}
      {lightboxOpen && (() => {
        const photos: string[] = property.images || [];
        const slides: Array<{ type: "tour" } | { type: "photo"; url: string }> = [
          ...(property.virtual_tour_url ? [{ type: "tour" as const }] : []),
          ...photos.map((url) => ({ type: "photo" as const, url })),
        ];
        const slide = slides[Math.min(galleryIndex, slides.length - 1)];
        if (slide?.type !== "photo") return null;
        return (
          <div className="fixed inset-0 z-[300] bg-black flex items-center justify-center" onClick={() => setLightboxOpen(false)}>
            {/* Descendue (top-16) et transformée en bouton "Fermer" libellé
                pour ne plus se retrouver trop haute / collée au bord,
                parfois sous la barre du navigateur mobile. */}
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="absolute top-16 right-4 sm:top-6 sm:right-6 h-11 px-4 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center gap-2 font-bold text-sm z-10"
              title="Fermer"
            >
              <X className="w-5 h-5" /> Fermer
            </button>
            <img src={slide.url} alt={property.title} className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
            {slides.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGalleryIndex((i) => (i - 1 + slides.length) % slides.length);
                  }}
                  className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                  title="Photo précédente"
                >
                  <ChevronLeftIcon className="w-6 h-6" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGalleryIndex((i) => (i + 1) % slides.length);
                  }}
                  className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                  title="Photo suivante"
                >
                  <ChevronRightIcon className="w-6 h-6" />
                </button>
                <span className="absolute bottom-5 inset-x-0 text-center text-white/80 text-sm font-semibold">
                  {galleryIndex + 1} / {slides.length}
                </span>
              </>
            )}
          </div>
        );
      })()}

      {/* Info */}
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div>
            <div className="flex gap-2 mb-2 flex-wrap">
              <Badge>{PROPERTY_TYPE_LABELS[property.property_type] || property.property_type}</Badge>
              {property.status !== "active" && (
                <Badge variant="destructive">
                  {property.status === "under_offer" ? "Sous offre" : "Sous compromis"}
                </Badge>
              )}
              {typeof matchScore === "number" && (
                <Badge variant="outline" className="border-primary text-primary">
                  Match {matchScore}%
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-bold">{property.title}</h1>
            <p className="flex items-center gap-1 text-muted-foreground mt-1">
              <MapPin className="h-4 w-4" /> {property.location || property.address}
            </p>
          </div>

          <div className="flex flex-wrap gap-x-2 gap-y-3 bg-card border border-border rounded-2xl py-3 px-2 justify-center sm:justify-start">
            {property.surface_area != null && (
              <SpecTile icon={Maximize} label="Surface" value={`${property.surface_area} m²`} />
            )}
            {property.rooms != null && <SpecTile icon={Box} label="Pièces" value={String(property.rooms)} />}
            {property.bedrooms != null && (
              <SpecTile icon={BedDouble} label="Chambres" value={String(property.bedrooms)} />
            )}
            {(td.salleDeau || td.salleDeBains) && (
              <SpecTile icon={Droplet} label="Salle d'eau" value={td.salleDeau || td.salleDeBains} />
            )}
            {td.terrainSurface && <SpecTile icon={Trees} label="Terrain" value={td.terrainSurface} />}
          </div>

          {(td.dpe || td.ges) && (
            <div className="flex items-center gap-5">
              {td.dpe && <DpeBadge label="DPE" value={td.dpe} />}
              {td.ges && <DpeBadge label="GES" value={td.ges} />}
            </div>
          )}

          {/* Feature tags */}
          <div className="flex flex-wrap gap-2">
            {td.terrace === "Oui" && <span className="type-pill type-pill--active text-xs">Terrasse</span>}
            {td.pool === "Oui" && <span className="type-pill type-pill--active text-xs">Piscine</span>}
            {td.pool === "Possible" && <span className="type-pill text-xs">Piscine possible</span>}
            {property.property_type === "land" && td.serviced === "Oui" && (
              <span className="type-pill type-pill--active text-xs">Viabilisé</span>
            )}
            {property.property_type === "land" && td.builderFree === "Oui" && (
              <span className="type-pill type-pill--active text-xs">Libre constructeur</span>
            )}
          </div>

          {/* Descriptif — case avec titre à gauche au-dessus, texte complet
              en dessous (au lieu de la présentation à pointillés utilisée
              pour les caractéristiques techniques, qui écrasait le
              descriptif dans un format qui ne lui convient pas). */}
          {property.description && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/50 border-b border-border">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Descriptif</p>
              </div>
              <div className="px-4 py-4">
                <p className="text-sm leading-relaxed whitespace-pre-line">{property.description}</p>
              </div>
            </div>
          )}

          {/* Opportunity badges */}
          {(opportunity?.priceDrop || opportunity?.underMarket) && (
            <div className="bg-card rounded-xl p-4 border border-border space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase">Opportunité</p>
              <div className="flex gap-2">
                {opportunity.priceDrop && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-300">
                    Baisse de prix
                  </span>
                )}
                {opportunity.underMarket && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-300">
                    Sous marché
                  </span>
                )}
              </div>
              {opportunity.pricePerSqm && opportunity.avgPerSqm && (
                <p className="text-xs text-muted-foreground">
                  {Math.round(opportunity.pricePerSqm)} €/m² · Moyenne locale {Math.round(opportunity.avgPerSqm)} €/m²
                </p>
              )}
            </div>
          )}

          {/* Price history */}
          {priceHistory.length > 0 && (
            <div className="bg-card rounded-xl p-4 border border-border space-y-3">
              <p className="text-xs font-bold text-muted-foreground uppercase">Historique des prix</p>
              <div className="space-y-2">
                {priceHistory.map((entry, i) => {
                  const oldP = entry.old_price ? Number(entry.old_price) : null;
                  const newP = entry.new_price ? Number(entry.new_price) : null;
                  const isDown = oldP && newP && newP < oldP;
                  const isUp = oldP && newP && newP > oldP;
                  const fmt = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
                  return (
                    <div key={entry.id} className="flex items-center gap-3 text-sm p-2 rounded-lg bg-muted/40">
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(entry.changed_at).toLocaleDateString("fr-FR")}
                      </span>
                      {oldP && <span className="line-through text-muted-foreground">{fmt(oldP)} €</span>}
                      <span className="text-muted-foreground">→</span>
                      <span
                        className={`font-bold ${isDown ? "text-emerald-600 dark:text-emerald-400" : isUp ? "text-destructive" : ""}`}
                      >
                        {newP ? `${fmt(newP)} €` : "N.C."}
                      </span>
                      {isDown && oldP && newP && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                          -{Math.round(((oldP - newP) / oldP) * 100)}%
                        </span>
                      )}
                      {isUp && oldP && newP && (
                        <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-full">
                          +{Math.round(((newP - oldP) / oldP) * 100)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(Object.keys(td).length > 0 || property.description) && (
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase mb-3">Caractéristiques</p>
              <StructuredCharacteristics td={td} description={property.description} />
            </div>
          )}

          {/* Advisor — photo agrandie pour le reconnaître d'un coup d'œil ;
              clic = fiche complète (nom, tél, email, carte de visite). */}
          {property.agent_name && (
            <button
              onClick={openAdvisorModal}
              title="Voir la fiche du conseiller"
              className="flex items-center gap-4 bg-card rounded-xl p-4 border border-border w-full text-left hover:border-primary/50 transition-colors cursor-pointer"
            >
              {property.agent_photo ? (
                <img
                  src={property.agent_photo}
                  alt={property.agent_name}
                  className="w-16 h-16 rounded-full object-cover border-2 border-primary/30 shrink-0"
                />
              ) : (
                <UserCircle className="w-16 h-16 text-muted-foreground shrink-0" />
              )}
              <div>
                <p className="font-bold text-base">{property.agent_name}</p>
                {property.agent_email && <p className="text-xs text-muted-foreground">{property.agent_email}</p>}
                {property.agent_phone && <p className="text-xs text-muted-foreground">{property.agent_phone}</p>}
              </div>
            </button>
          )}
        </div>

        <div className="md:w-72 space-y-3 bg-card border border-border rounded-2xl p-4 h-fit shadow-sm">
          {/* La visite virtuelle est désormais dans la galerie principale
              (en 1ère position, à la place de la photo de couverture) —
              on garde ici uniquement le partage du lien temporaire. */}
          {property.virtual_tour_url && user && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setTourShareType("giraffe360");
                setTourShareOpen(true);
              }}
            >
              <Clock className="mr-2 h-3.5 w-3.5" /> Partager le lien temporaire
            </Button>
          )}

          {property.price && (
            <div className="text-3xl font-black text-primary">
              {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
                Number(property.price),
              )}
            </div>
          )}
          <Button className="w-full primary-gold" onClick={handleAddToPropal}>
            <Plus className="mr-2 h-4 w-4" /> Ajouter à une proposition
          </Button>
          {property.giraffe_url && (
            <a href={property.giraffe_url} target="_blank" rel="noreferrer">
              <Button variant="outline" className="w-full justify-start">
                <Giraffe360Icon className="mr-2 h-5 w-5" withBg /> Site Giraffe
              </Button>
            </a>
          )}
          {property.listing_url && (
            <a href={property.listing_url} target="_blank" rel="noreferrer">
              <Button variant="outline" className="w-full justify-start">
                <WebsiteIcon className="mr-2 h-4 w-4" /> Site internet Immosphera
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* La visite virtuelle en plein écran reste pilotée par tourFullscreen,
          désormais déclenchée depuis l'aperçu en haut à droite (ci-dessus)
          au lieu de cette section pleine largeur — retirée pour éviter la
          redondance ("même principe que sur immosphera.fr"). */}

      {/* Fullscreen tour */}
      {tourFullscreen && property.virtual_tour_url && (
        <div ref={fullscreenRef} className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="absolute top-4 left-4 z-10">
            <Button variant="secondary" size="sm" className="shadow-lg" onClick={() => setTourFullscreen(false)}>
              <X className="h-4 w-4 mr-1" /> Fermer
            </Button>
          </div>
          <iframe
            src={property.virtual_tour_url}
            className="w-full h-full"
            allowFullScreen
            title="Visite virtuelle plein écran"
          />
        </div>
      )}

      <PropertyFormModal open={editOpen} onOpenChange={setEditOpen} editingProperty={property} />
      <AdvisorModal advisor={selectedAdvisor} open={advisorOpen} onOpenChange={setAdvisorOpen} />
      <ConfirmDeleteModal property={property} open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleDelete} />
      <TourShareModal
        open={tourShareOpen}
        onOpenChange={setTourShareOpen}
        propertyId={property.id}
        propertyTitle={property.title}
        tourType={tourShareType}
      />
    </div>
  );
}
