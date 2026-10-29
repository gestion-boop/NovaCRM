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
      {/* Barre de navigation d'en-tête Immosphera 360 — Épurée et uniforme avec NovaSphere */}
      <div className="immosphera-topbar sticky top-0 z-40 bg-[#071317]/85 backdrop-blur-2xl border-b border-white/10 px-4 sm:px-6 py-2 shadow-md">
        <div className="flex items-center justify-between gap-4 w-full">
          {/* Gauche : Piliers du module Immosphera */}
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 shadow-inner shrink-0">
            {navItems.map(({ label, icon: Icon, path }) => {
              const active = path === "/immosphera" ? isHome : location.pathname.startsWith(path);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => navigate(path)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                    active
                      ? "bg-[#F7BC5F] text-slate-950 shadow-md shadow-[#F7BC5F]/20 font-extrabold"
                      : "text-slate-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-slate-950" : "text-[#F7BC5F]"}`} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Centre : Bouton Recherche (au centre absolu de la barre) */}
          {isHome && (
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => setSearchDrawerOpen((prev) => !prev)}
                className={`h-9 px-4 rounded-xl border text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm ${
                  searchDrawerOpen
                    ? "bg-[#F7BC5F] text-slate-950 shadow-md shadow-[#F7BC5F]/25 border-[#F7BC5F]"
                    : "bg-white/10 hover:bg-white/15 text-white border-white/15 hover:border-[#F7BC5F]/50"
                }`}
                title={searchDrawerOpen ? "Fermer le tiroir de recherche" : "Ouvrir le panneau de recherche par-dessus la photo 360°"}
              >
                <Search className="h-4 w-4" />
                <span>Recherche</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${searchDrawerOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
          )}

          {/* Droite : Action principale Ajouter un bien (si admin) ou Retour aux biens */}
          <div className="flex items-center gap-2 shrink-0">
            {isHome && isAdmin && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="h-9 px-3.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-[#F7BC5F]/20 transition-all cursor-pointer"
                title="Ajouter un nouveau bien immobilier"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Ajouter un bien</span>
              </button>
            )}

            {!isHome && (
              <button
                type="button"
                onClick={() => navigate("/immosphera")}
                className="h-9 px-3.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Retourner à la liste des biens"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-[#F7BC5F]" />
                <span>Retour aux biens</span>
              </button>
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
