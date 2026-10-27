import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Plus,
  Users,
  FileText,
  Loader2,
  Building2,
  ArrowLeft,
  MapPinned,
  Tag,
  Key,
  Sparkles,
  FileSignature,
  Map as MapIcon,
  X,
  Image as ImageIcon,
} from "lucide-react";
import "@/immosphera/immosphera.css";
import { useImmoAuth } from "@/immosphera/lib/access";
import { PropertyFormModal } from "@/immosphera/components/PropertyFormModal";
import { ErrorBoundary } from "@/immosphera/components/ErrorBoundary";
import Index from "@/immosphera/pages/Index";
import PropertyDetail from "@/immosphera/pages/PropertyDetail";
import Partners from "@/immosphera/pages/Partners";
import Secteurs from "@/immosphera/pages/Secteurs";
import NovaSearchBar from "@/immosphera/components/NovaSearchBar";

const PROPERTY_QUICK_FILTERS = [
  { chip: "Ventes", label: "Ventes", icon: Tag },
  { chip: "Locations", label: "Locations", icon: Key },
  { chip: "Nouveautés 15J", label: "Nouveautés", icon: Sparkles },
  { chip: "Sous offre", label: "Sous offre", icon: FileText },
  { chip: "Sous compromis", label: "Sous compromis", icon: FileSignature },
  { chip: "Carte", label: "Carte", icon: MapIcon },
];
const PILL_BASE =
  "inline-flex items-center gap-2 px-4 h-10 rounded-full text-sm font-semibold transition-all border backdrop-blur-md";
const PILL_IDLE = "bg-foreground/10 border-border/60 text-foreground/80 hover:text-foreground hover:border-primary/50";
const PILL_ACTIVE = "bg-card border-primary text-foreground shadow-lg";

interface ImmosphereProps {
  // Recherche immobilière lancée depuis Nova IA ailleurs dans le CRM
  // (accueil...) : ouvre directement le module avec ces résultats déjà
  // affichés, au lieu de démarrer sur la grille complète non filtrée.
  initialAiResultIds?: string[] | null;
  initialAiQueryText?: string;
  // Réinitialise la graine côté parent (App.tsx) une fois consommée, pour
  // qu'un aller-retour vers un autre onglet puis retour ici ne réaffiche
  // pas indéfiniment la même vieille recherche.
  onSeedConsumed?: () => void;
  // Tuile "Partenaires" de l'accueil : ouvre directement cet onglet au lieu
  // de la page Biens par défaut.
  initialSection?: string | null;
  onInitialSectionConsumed?: () => void;
  // Signalé : depuis la page Partenaires (accessible directement via sa
  // propre tuile d'accueil), "Retour" doit ressortir du module Immosphera
  // vers l'accueil du CRM — pas vers la page Biens du module, qu'on n'a
  // jamais voulu visiter dans ce cas.
  onExitToCrm?: () => void;
}

export default function Immosphera({ initialAiResultIds = null, initialAiQueryText = "", onSeedConsumed, initialSection = null, onInitialSectionConsumed, onExitToCrm }: ImmosphereProps) {
  const { canAccess, isAdmin, loading } = useImmoAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeChip, setActiveChip] = useState("");
  const [showHero, setShowHero] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [aiResultIds, setAiResultIds] = useState<string[] | null>(initialAiResultIds);
  const [aiQueryText, setAiQueryText] = useState(initialAiQueryText);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialAiResultIds) onSeedConsumed?.();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialSection === 'partenaires') {
      navigate('/immosphera/partenaires', { replace: true });
      onInitialSectionConsumed?.();
    }
  }, []);

  // La barre Biens / Partenaires / Secteurs reste collée tout en haut de la zone
  // de contenu, juste sous l'en-tête du CRM. Si l'en-tête déborde sur la zone
  // défilante (la barre passait alors à moitié dessous), on décale d'autant.
  const barRef = useRef<HTMLDivElement>(null);
  const [stickyTop, setStickyTop] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const header = Array.from(document.querySelectorAll("header")).find((h) => !h.closest("main"));
    let scroller: HTMLElement | null = bar.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
      const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      setStickyTop(Math.max(0, Math.round(headerBottom - scrollerTop)));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (header) observer?.observe(header);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [loading, canAccess]);

  const handleChipClick = useCallback((chip: string) => {
    setActiveChip((prev) => (prev === chip ? "" : chip));
  }, []);

  const isHome = location.pathname === "/immosphera" || location.pathname === "/immosphera/";
  // Annuaire Partenaires : fond « glace » au lieu de la page blanche du module.
  const isPartners = location.pathname.startsWith("/immosphera/partenaires");
  const navItems = [
    { label: "Biens", icon: Building2, path: "/immosphera" },
    { label: "Partenaires", icon: Users, path: "/immosphera/partenaires" },
    // Demande explicite (14 septembre) : « avoir une carte par secteur [...]
    // s'envoyer des contacts si hors secteur si besoin. »
    { label: "Secteurs", icon: MapPinned, path: "/immosphera/secteurs" },
  ];

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center px-6">
        <Building2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Ce module est réservé aux membres de l'agence Immosphera.
        </p>
      </div>
    );
  }

  return (
    <div className={`immosphera-root${isPartners ? " immosphera-root--glace" : ""}`}>
      {/* Barre de navigation et filtres de façade Immosphera 360 — tout en haut, fluide et accessible */}
      <div
        ref={barRef}
        style={{ top: stickyTop }}
        className="immosphera-topbar sticky z-30 bg-[#07171B]/85 backdrop-blur-xl border-b border-white/[0.06] px-3 sm:px-6 py-2"
      >
        <div className="flex items-center justify-between gap-2.5 flex-wrap">
          {/* Piliers du module + Filtres rapides */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {/* 3 grands piliers */}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-2xl border border-white/10">
              {navItems.map(({ label, icon: Icon, path }) => {
                const active = path === "/immosphera" ? isHome : location.pathname.startsWith(path);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      navigate(path);
                      if (path === "/immosphera") {
                        setShowHero(false); // La photo disparait, tout le bloc remonte
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                      active
                        ? "bg-[#F7BC5F] text-slate-950 shadow-md shadow-[#F7BC5F]/20 font-extrabold"
                        : "text-slate-300 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-slate-950" : "text-[#F7BC5F]"}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* Raccourcis directs Ventes, Locations, Nouveautés... (sur la vue Biens) */}
            {isHome && (
              <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap pl-1.5 border-l border-white/[0.08] ml-1">
                {PROPERTY_QUICK_FILTERS.map(({ chip, label, icon: Icon }) => {
                  const active = activeChip === chip;
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setShowHero(false); // Clic sur un filtre rapide : la photo disparaît, la recherche remonte
                        handleChipClick(chip);
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        active
                          ? "bg-amber-400/25 text-amber-300 border border-amber-400/50 shadow-sm font-bold"
                          : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5"
                      }`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${active ? "text-amber-300" : "text-[#F7BC5F]"}`} />
                      <span>{label}</span>
                    </button>
                  );
                })}

                {activeChip && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveChip("");
                      setShowHero(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition-colors cursor-pointer"
                    title="Effacer le filtre actif"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Tous</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Outils et actions de droite */}
          <div className="flex items-center gap-2 ml-auto">
            {isHome && (
              <button
                type="button"
                onClick={() => setShowHero((prev) => !prev)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  showHero
                    ? "bg-[#F7BC5F]/20 border-[#F7BC5F]/40 text-[#FAD592]"
                    : "border-white/10 hover:bg-white/5 text-slate-400 hover:text-white"
                }`}
                title={showHero ? "Masquer la bannière photo pour remonter la recherche" : "Afficher la photo d'accueil 360°"}
              >
                <ImageIcon className="h-3.5 w-3.5 text-[#F7BC5F]" />
                <span className="hidden md:inline">{showHero ? "Masquer photo" : "Photo 360°"}</span>
              </button>
            )}

            {isHome && isAdmin && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>Ajouter un bien</span>
              </button>
            )}

            {!isHome ? (
              <button
                type="button"
                onClick={() => navigate("/immosphera")}
                className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                title="Retourner à la liste des biens"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-[#F7BC5F]" />
                <span>Retour aux biens</span>
              </button>
            ) : (
              onExitToCrm && (
                <button
                  type="button"
                  onClick={onExitToCrm}
                  className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-400 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                  title="Revenir à l'accueil du CRM"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Retour CRM</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <ErrorBoundary>
        <Routes>
          <Route
            index
            element={
              <Index
                activeChip={activeChip}
                onChipClick={handleChipClick}
                showHero={showHero}
                externalFormOpen={formOpen}
                onCloseExternalForm={() => setFormOpen(false)}
                aiResultIds={aiResultIds}
                aiQueryText={aiQueryText}
                onClearAiResults={() => { setAiResultIds(null); setAiQueryText(""); }}
                onAiResults={(ids, text) => { setAiResultIds(ids); setAiQueryText(text); }}
              />
            }
          />
          <Route path="bien/:id" element={<PropertyDetail />} />
          {/* Onglet "Propals" retiré (jugé inutile) — la route reste
              volontairement supprimée elle aussi ; "Ajouter à une
              proposition" sur une fiche bien continue d'enregistrer en base
              mais n'a plus d'écran pour la consulter. */}
          <Route path="partenaires" element={<Partners />} />
          <Route path="secteurs" element={<Secteurs />} />
          <Route path="*" element={<Navigate to="/immosphera" replace />} />
        </Routes>
      </ErrorBoundary>

      {isAdmin && <PropertyFormModal open={formOpen} onOpenChange={setFormOpen} />}

      {/* Demande explicite : "un bouton Nova qui permet d'avoir simplement
          une barre horizontale de recherche... texte ou dictée vocale." */}
      <NovaSearchBar onResults={(ids, text) => { setAiResultIds(ids); setAiQueryText(text); }} />
    </div>
  );
}
