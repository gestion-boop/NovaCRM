import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Trash2, FileText, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function Propals() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: propals = [], isLoading } = useQuery({
    queryKey: ["propals", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_propals")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("immosphera_propals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["propals"] });
      toast({ title: "Supprimée", description: "La proposition a été supprimée." });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("immosphera_propals").insert({ user_id: user!.id, property_ids: [] });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["propals"] });
      toast({ title: "Créée", description: "Nouvelle proposition créée. Ajoutez-y des biens !" });
    },
  });

  if (isLoading) {
    return (
      <div className="container py-8 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full py-8 max-w-4xl mx-auto px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
          Mes propositions
        </h1>
        <Button onClick={() => createMutation.mutate()}>
          <Plus className="mr-2 h-4 w-4" /> Nouvelle
        </Button>
      </div>

      {propals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold">Aucune proposition</h3>
          <p className="text-sm text-muted-foreground">
            Créez une proposition et ajoutez-y des biens depuis la page de détail.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {propals.map((propal) => (
            <Card key={propal.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Proposition du {format(new Date(propal.created_at), "dd MMMM yyyy", { locale: fr })}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(propal.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{propal.property_ids.length} bien(s) sélectionné(s)</p>
                {propal.note && <p className="text-sm mt-1">{propal.note}</p>}
                <div className="flex gap-2 mt-3 flex-wrap">
                  {propal.property_ids.map((pid: string) => (
                    <Link key={pid} to={`/immosphera/bien/${pid}`}>
                      <Button variant="outline" size="sm">
                        Voir le bien
                      </Button>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
