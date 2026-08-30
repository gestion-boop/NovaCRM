import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Plus, Users, FileText, Loader2, Building2, ArrowLeft } from "lucide-react";
import "@/immosphera/immosphera.css";
import { useImmoAuth } from "@/immosphera/lib/access";
import { PropertyFormModal } from "@/immosphera/components/PropertyFormModal";
import { ErrorBoundary } from "@/immosphera/components/ErrorBoundary";
import Index from "@/immosphera/pages/Index";
import PropertyDetail from "@/immosphera/pages/PropertyDetail";
import Partners from "@/immosphera/pages/Partners";
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
      {/* Sur la page Biens (isHome), ce bandeau est rendu par Index.tsx lui-même,
          sous la photo d'accueil — voir Index.tsx. Ici, on ne garde le bandeau
          que pour les autres pages du module (Propals, Partenaires, fiche bien). */}
      {!isHome && (
        <div className="border-b border-border">
          <div className="flex flex-wrap items-center gap-2 px-3 pt-3 pb-2">
            {/* Signalé : "Retour" ramenait parfois jusqu'à l'accueil
                principal du CRM (Conseils Finances) au lieu du panneau
                précédent DANS Immosphera360. Cause : navigate(-1) dépend de
                l'historique du navigateur, qui n'a pas forcément d'entrée
                pour chaque panneau interne (ex. arrivée directe sur une
                fiche bien depuis une recherche Nova IA) — il pouvait alors
                sauter par-dessus tout Immosphera360. Remplacé par une
                destination fixe et prévisible : la page Biens, page
                d'accueil du module — SAUF depuis Partenaires (accessible
                directement via sa propre tuile d'accueil), où "Retour" doit
                ressortir directement vers l'accueil du CRM. */}
            <button
              onClick={() => {
                if (location.pathname.startsWith("/immosphera/partenaires") && onExitToCrm) {
                  onExitToCrm();
                } else {
                  navigate("/immosphera");
                }
              }}
              className={`${PILL_BASE} ${PILL_IDLE}`}
            >
              <ArrowLeft className="h-4 w-4" />
              Retour
            </button>

            {navItems.map(({ label, icon: Icon, path }) => {
              const active = path === "/immosphera" ? isHome : location.pathname.startsWith(path);
              return (
                <button
                  key={label}
                  onClick={() => navigate(path)}
                  className={`${PILL_BASE} ${active ? PILL_ACTIVE : PILL_IDLE}`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
                  {label}
                </button>
              );
            })}

            <div className="ml-auto flex items-center gap-2">
              {isAdmin && (
                <button className="primary-gold text-xs" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Ajouter un bien
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
