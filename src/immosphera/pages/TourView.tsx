import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, AlertTriangle } from "lucide-react";

export default function TourView() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["tour-token", token],
    queryFn: async () => {
      if (!token) throw new Error("Token manquant");
      const { data, error } = await supabase.functions.invoke("immosphera-tour-resolve", {
        body: { token },
      });
      if (error || !data) throw new Error("expired");
      return data as { tourUrl: string | null; expiresAt: string };
    },
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Skeleton className="w-96 h-12 rounded-xl" />
      </div>
    );
  }

  if (error) {
    const isExpired = (error as Error).message === "expired";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 grid place-items-center">
            {isExpired ? <Clock className="h-8 w-8 text-destructive" /> : <AlertTriangle className="h-8 w-8 text-destructive" />}
          </div>
          <h1 className="text-xl font-bold">{isExpired ? "Lien expiré" : "Lien invalide"}</h1>
          <p className="text-muted-foreground text-sm">
            {isExpired
              ? "Ce lien a expiré. Contactez votre conseiller pour en obtenir un nouveau."
              : "Ce lien n'est pas valide."}
          </p>
        </div>
      </div>
    );
  }

  if (!data?.tourUrl) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <h1 className="text-xl font-bold">Visite non disponible</h1>
          <p className="text-muted-foreground text-sm">Cette visite virtuelle n'est pas disponible.</p>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, new Date(data.expiresAt).getTime() - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <div className="bg-card/80 backdrop-blur-sm border-b border-border/50 px-4 py-2 flex items-center justify-end shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
          <Clock className="h-3 w-3" />
          <span>
            Expire dans {hours > 0 ? `${hours}h ` : ""}{minutes}min
          </span>
        </div>
      </div>

      <iframe
        src={data.tourUrl}
        className="flex-1 w-full border-0"
        allowFullScreen
        title="Visite virtuelle"
      />
    </div>
  );
}
