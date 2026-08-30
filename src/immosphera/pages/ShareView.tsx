import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

export default function ShareView() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["share", token],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("immosphera-share-property", {
        body: { token },
      });
      if (error) throw error;
      if (!data?.property) throw new Error("invalid");
      return data.property;
    },
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="h-96 w-full max-w-4xl rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen text-center">
        <div>
          <h2 className="text-xl font-semibold mb-2">Lien invalide ou expiré</h2>
          <p className="text-muted-foreground">Ce lien de partage n'est plus disponible.</p>
        </div>
      </div>
    );
  }

  const property = data;

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-6 max-w-5xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>
            {property?.title}
          </h1>
          <p className="text-muted-foreground">{property?.address}</p>
        </div>
        {property?.virtual_tour_url ? (
          <div className="rounded-xl overflow-hidden border aspect-video">
            <iframe
              src={property.virtual_tour_url}
              className="w-full h-full"
              allowFullScreen
              title="Visite virtuelle"
            />
          </div>
        ) : (
          <p className="text-muted-foreground">Aucune visite virtuelle disponible pour ce bien.</p>
        )}
      </div>
    </div>
  );
}
