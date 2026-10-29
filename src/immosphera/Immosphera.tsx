import { useCallback, useEffect, useState } from "react";
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
  Search,
  ChevronDown,
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
  const [showHero, setShowHero] = useState(true);
  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);
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

  const handleChipClick = useCallback((chip: string) => {
    setActiveChip((prev) => (prev === chip ? "" : chip));
  }, []);

  const isHome = location.pathname === "/immosphera" || location.pathname === "/immosphera/";
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
    <div className="immosphera-root min-h-screen">
      {/* Barre de navigation et filtres de façade Immosphera 360 — Effet glace dépoli tout en haut */}
      <div className="immosphera-topbar sticky top-0 z-40 bg-[#071317]/80 backdrop-blur-2xl border-b border-white/15 px-3 sm:px-6 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between gap-2.5 flex-wrap">
          {/* Piliers du module + Séparation marquée + Filtres Catégories */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {/* 3 grands piliers */}
            <div className="flex items-center gap-1 bg-black/45 p-1 rounded-2xl border border-white/15 shadow-inner">
              {navItems.map(({ label, icon: Icon, path }) => {
                const active = path === "/immosphera" ? isHome : location.pathname.startsWith(path);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => navigate(path)}
                    className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                      active
                        ? "bg-[#F7BC5F] text-slate-950 shadow-md shadow-[#F7BC5F]/25 font-extrabold"
                        : "text-slate-300 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-slate-950" : "text-[#F7BC5F]"}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* SÉPARATION NETTE AVEC LES CATÉGORIES */}
            {isHome && (
              <div className="flex items-center gap-1.5 flex-wrap pl-3 border-l-2 border-[#F7BC5F]/40 ml-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#FAD592]/80 select-none hidden lg:inline-flex items-center gap-1">
                  <Tag className="w-3 h-3 text-[#F7BC5F]" /> Catégories :
                </span>

                {PROPERTY_QUICK_FILTERS.map(({ chip, label, icon: Icon }) => {
                  const active = activeChip === chip;
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleChipClick(chip)}
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
                    onClick={() => setActiveChip("")}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition-colors cursor-pointer"
                    title="Effacer le filtre actif"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Tous</span>
                  </button>
                )}

                {/* Bouton "+ Ajouter un bien" tout au bout des catégories */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setFormOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs shadow-md shadow-[#F7BC5F]/20 transition-all cursor-pointer shrink-0 ml-1"
                    title="Ajouter un nouveau bien immobilier"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Ajouter un bien</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Outils et actions de droite : Tiroir recherche, Photo 360 et retour CRM */}
          <div className="flex items-center gap-2 ml-auto">
            {isHome && (
              <>
                <button
                  type="button"
                  onClick={() => setSearchDrawerOpen((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    searchDrawerOpen
                      ? "bg-[#F7BC5F] text-slate-950 shadow-md shadow-[#F7BC5F]/30 border-[#F7BC5F]"
                      : "bg-white/10 hover:bg-white/15 text-white border-white/15 hover:border-[#F7BC5F]/50"
                  }`}
                  title={searchDrawerOpen ? "Fermer le tiroir de recherche" : "Ouvrir le panneau de recherche par-dessus la photo 360°"}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Recherche</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${searchDrawerOpen ? "rotate-180" : ""}`} />
                </button>

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
              </>
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
                searchOpen={searchDrawerOpen}
                onToggleSearch={() => setSearchDrawerOpen((v) => !v)}
                onCloseSearch={() => setSearchDrawerOpen(false)}
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

      {/* Demande explicite : "un bouton Nova qui permet d'avoir simplement
          une barre horizontale de recherche... texte ou dictée vocale." */}
      <NovaSearchBar onResults={(ids, text) => { setAiResultIds(ids); setAiQueryText(text); }} />
    </div>
  );
}
