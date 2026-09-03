import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, AlertTriangle } from "lucide-react";

/**
 * Visite virtuelle ImmoSphera360 partagée par lien temporaire.
 *
 * Page PUBLIQUE : le client n'a aucun compte (ni Gmail, ni CRM). Le jeton
 * est résolu côté base par `get_immosphera_tour_by_token` (fonction
 * security definer ouverte au rôle anon), qui ne renvoie que l'URL de la
 * visite et la date d'expiration.
 *
 * Une fois le délai passé — que le client arrive trop tard OU qu'il soit
 * encore sur la page — la visite est remplacée par « Le lien n'est plus
 * valable ».
 */
interface Props {
  token: string;
}

type Reponse =
  | { statut: "ok"; tour_url: string | null; expires_at: string; titre?: string | null; adresse?: string | null }
  | { statut: "expire"; expires_at: string }
  | { statut: "invalide" };

function formaterRestant(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function Ecran({ icone, titre, texte }: { icone: React.ReactNode; titre: string; texte: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 grid place-items-center">{icone}</div>
        <h1 className="text-xl font-bold">{titre}</h1>
        <p className="text-muted-foreground text-sm">{texte}</p>
      </div>
    </div>
  );
}

export default function TourView({ token }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tour-token", token],
    queryFn: async () => {
      if (!token) throw new Error("Jeton manquant");
      const { data, error } = await supabase.rpc("get_immosphera_tour_by_token" as never, {
        p_token: token,
      } as never);
      if (error) throw error;
      return (data ?? { statut: "invalide" }) as Reponse;
    },
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });

  // Compte à rebours vivant : quand il atteint zéro, la visite disparaît
  // et laisse place au message d'expiration, sans recharger la page.
  const expireA = data && data.statut !== "invalide" ? new Date(data.expires_at).getTime() : null;
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!expireA) return;
    const id = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expireA]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Skeleton className="w-96 h-12 rounded-xl" />
      </div>
    );
  }

  if (error || !data || data.statut === "invalide") {
    return (
      <Ecran
        icone={<AlertTriangle className="h-8 w-8 text-destructive" />}
        titre="Lien invalide"
        texte="Ce lien n'est pas valide. Demandez un nouveau lien à votre conseiller."
      />
    );
  }

  const restant = expireA ? expireA - maintenant : 0;
  if (data.statut === "expire" || restant <= 0) {
    return (
      <Ecran
        icone={<Clock className="h-8 w-8 text-destructive" />}
        titre="Le lien n'est plus valable"
        texte="La durée d'accès à cette visite virtuelle est terminée. Contactez votre conseiller pour recevoir un nouveau lien."
      />
    );
  }

  if (!data.tour_url) {
    return (
      <Ecran
        icone={<AlertTriangle className="h-8 w-8 text-destructive" />}
        titre="Visite non disponible"
        texte="Cette visite virtuelle n'est pas disponible pour le moment."
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <div className="bg-card/80 backdrop-blur-sm border-b border-border/50 px-4 py-2 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          {data.titre && <p className="text-sm font-semibold truncate">{data.titre}</p>}
          {data.adresse && <p className="text-xs text-muted-foreground truncate">{data.adresse}</p>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full shrink-0">
          <Clock className="h-3 w-3" />
          <span>Expire dans {formaterRestant(restant)}</span>
        </div>
      </div>

      <iframe src={data.tour_url} className="flex-1 w-full border-0" allowFullScreen title="Visite virtuelle" />
    </div>
  );
}
