import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Plus, Users, FileText, Loader2, Building2, ArrowLeft, MapPinned } from "lucide-react";
import "@/immosphera/immosphera.css";
import { useImmoAuth } from "@/immosphera/lib/access";
import { PropertyFormModal } from "@/immosphera/components/PropertyFormModal";
import { ErrorBoundary } from "@/immosphera/components/ErrorBoundary";
import Index from "@/immosphera/pages/Index";
import PropertyDetail from "@/immosphera/pages/PropertyDetail";
import Partners from "@/immosphera/pages/Partners";
import Secteurs from "@/immosphera/pages/Secteurs";
import NovaSearchBar from "@/immosphera/components/NovaSearchBar";
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
  const [activeChip, setActiveChip] = useState("Recherche");
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
    <div className="immosphera-root">
      {/* Barre d'onglets de façade Immosphera 360 — toujours visible et claire pour s'y retrouver */}
      <div className="sticky top-0 z-30 bg-[#07171B]/95 backdrop-blur-md border-b border-white/10 px-3 sm:px-6 py-2.5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {navItems.map(({ label, icon: Icon, path }) => {
              const active = path === "/immosphera" ? isHome : location.pathname.startsWith(path);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => navigate(path)}
                  className={`inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                    active
                      ? "bg-[#F7BC5F] text-slate-950 shadow-md shadow-[#F7BC5F]/20 font-extrabold"
                      : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-slate-950" : "text-[#F7BC5F]"}`} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {isHome && isAdmin && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Ajouter un bien</span>
              </button>
            )}

            {onExitToCrm && (
              <button
                type="button"
                onClick={onExitToCrm}
                className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-slate-400 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Revenir à l'accueil du CRM"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Retour CRM</span>
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
