import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { advisors, getAdvisorById, type Advisor } from "@/immosphera/lib/advisors";
import { geocodeAddress, pointDansPolygone, type GeoPoint } from "@/immosphera/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, MapPin, Send, Loader2, X, Check } from "lucide-react";

// Demande explicite (14 septembre) : « avoir une carte par secteur [...]
// avoir des secteurs et s'envoyer des contacts si hors secteur si besoin. »
//
// Un secteur = un polygone dessiné à la main sur la carte (immosphera_secteurs),
// possédé par un ou plusieurs conseillers. Un contact rapide (immosphera_contacts)
// est géocodé à la création ; on détecte automatiquement dans quel secteur il
// tombe (point-dans-polygone, côté client) et on le suggère comme destinataire —
// libre au conseiller qui l'a saisi de l'envoyer à quelqu'un d'autre si besoin.

type Secteur = {
  id: string;
  agency_id: string;
  nom: string;
  couleur: string;
  polygone: GeoPoint[];
  conseiller_ids: string[];
  created_at: string;
};

type Contact = {
  id: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  adresse: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  secteur_id: string | null;
  conseiller_origine_id: string | null;
  conseiller_assigne_id: string | null;
  statut: "nouveau" | "transfere" | "traite";
  created_at: string;
};

const COULEURS = ["#E0A21A", "#2f9e44", "#1971c2", "#e8590c", "#9c36b5", "#c92a2a", "#0c8599"];

const EMPTY_CONTACT = { nom: "", telephone: "", email: "", adresse: "", notes: "" };

export default function Secteurs() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonLayersRef = useRef<L.Polygon[]>([]);
  const draftLayerRef = useRef<L.Polygon | L.Polyline | null>(null);

  const [dessinActif, setDessinActif] = useState(false);
  const [pointsDraft, setPointsDraft] = useState<GeoPoint[]>([]);
  const [secteurFormOpen, setSecteurFormOpen] = useState(false);
  const [secteurEnEdition, setSecteurEnEdition] = useState<Secteur | null>(null);
  const [nomSecteur, setNomSecteur] = useState("");
  const [couleurSecteur, setCouleurSecteur] = useState(COULEURS[0]);
  const [conseillersSecteur, setConseillersSecteur] = useState<string[]>([]);
  const [secteurSurvole, setSecteurSurvole] = useState<string | null>(null);

  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT);
  const [enregistrementContact, setEnregistrementContact] = useState(false);

  // Le conseiller connecté, retrouvé par email — sert d'origine par défaut
  // pour un contact créé ici (comme agent_email sur les Biens, mais déduit
  // automatiquement plutôt que choisi à chaque fois).
  const conseillerActuel: Advisor | undefined = useMemo(
    () => advisors.find((a) => a.email.toLowerCase() === (user?.email || "").toLowerCase()),
    [user?.email]
  );

  const { data: secteurs = [] } = useQuery({
    queryKey: ["immosphera-secteurs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("immosphera_secteurs" as any).select("*").order("nom");
      if (error) throw error;
      return (data as any[]).map((s) => ({ ...s, polygone: s.polygone as GeoPoint[] })) as Secteur[];
    },
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["immosphera-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_contacts" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any as Contact[];
    },
  });

  const secteurParId = useMemo(() => new Map(secteurs.map((s) => [s.id, s])), [secteurs]);

  // Init carte
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);
    map.setView([43.183, 3.004], 10);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Dessin d'un nouveau secteur : chaque clic ajoute un point
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (!dessinActif) return;
      setPointsDraft((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [dessinActif]);

  // Trace en cours (pointillé tant qu'il n'est pas fermé)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (draftLayerRef.current) {
      draftLayerRef.current.remove();
      draftLayerRef.current = null;
    }
    if (pointsDraft.length >= 3) {
      draftLayerRef.current = L.polygon(
        pointsDraft.map((p) => [p.lat, p.lng] as [number, number]),
        { color: couleurSecteur, weight: 2, dashArray: "6 4", fillOpacity: 0.15 }
      ).addTo(map);
    } else if (pointsDraft.length > 0) {
      draftLayerRef.current = L.polyline(
        pointsDraft.map((p) => [p.lat, p.lng] as [number, number]),
        { color: couleurSecteur, weight: 2, dashArray: "6 4" }
      ).addTo(map);
    }
  }, [pointsDraft, couleurSecteur]);

  // Secteurs enregistrés
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    polygonLayersRef.current.forEach((l) => l.remove());
    polygonLayersRef.current = [];
    secteurs.forEach((s) => {
      if (!Array.isArray(s.polygone) || s.polygone.length < 3) return;
      const layer = L.polygon(
        s.polygone.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: s.couleur,
          weight: secteurSurvole === s.id ? 3 : 2,
          fillOpacity: secteurSurvole === s.id ? 0.35 : 0.18,
        }
      );
      const noms = s.conseiller_ids.map((id) => getAdvisorById(id)?.name).filter(Boolean).join(", ") || "Aucun conseiller";
      layer.bindTooltip(`<b>${s.nom}</b><br/>${noms}`, { sticky: true });
      layer.on("mouseover", () => setSecteurSurvole(s.id));
      layer.on("mouseout", () => setSecteurSurvole((v) => (v === s.id ? null : v)));
      if (isAdmin) {
        layer.on("click", () => ouvrirEdition(s));
      }
      layer.addTo(map);
      polygonLayersRef.current.push(layer);
    });
  }, [secteurs, isAdmin, secteurSurvole]);

  // Fit bounds sur les secteurs au premier chargement
  useEffect(() => {
    const map = mapRef.current;
    if (!map || secteurs.length === 0) return;
    const tousPoints = secteurs.flatMap((s) => s.polygone.map((p) => [p.lat, p.lng] as [number, number]));
    if (tousPoints.length > 0) map.fitBounds(L.latLngBounds(tousPoints), { padding: [30, 30], maxZoom: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secteurs.length > 0]);

  const demarrerDessin = () => {
    setSecteurEnEdition(null);
    setNomSecteur("");
    setCouleurSecteur(COULEURS[secteurs.length % COULEURS.length]);
    setConseillersSecteur([]);
    setPointsDraft([]);
    setDessinActif(true);
  };

  const annulerDessin = () => {
    setDessinActif(false);
    setPointsDraft([]);
  };

  const terminerDessin = () => {
    if (pointsDraft.length < 3) {
      toast({ title: "Trace un polygone d'au moins 3 points avant de terminer.", variant: "destructive" });
      return;
    }
    setSecteurFormOpen(true);
  };

  const ouvrirEdition = (s: Secteur) => {
    if (!isAdmin || dessinActif) return;
    setSecteurEnEdition(s);
    setNomSecteur(s.nom);
    setCouleurSecteur(s.couleur);
    setConseillersSecteur(s.conseiller_ids);
    setPointsDraft(s.polygone);
    setSecteurFormOpen(true);
  };

  const sauvegarderSecteurMutation = useMutation({
    mutationFn: async () => {
      const base = {
        nom: nomSecteur.trim(),
        couleur: couleurSecteur,
        polygone: pointsDraft,
        conseiller_ids: conseillersSecteur,
      };
      if (secteurEnEdition) {
        const { error } = await supabase
          .from("immosphera_secteurs" as any)
          .update(base as any)
          .eq("id", secteurEnEdition.id);
        if (error) throw error;
      } else {
        // agency_id résolu côté RLS via can_access_immosphera pour la
        // lecture, mais l'écriture a besoin de la valeur explicite — on la
        // déduit de l'agence Immosphera déjà utilisée partout ailleurs dans
        // le module (properties/partners), pas d'un formulaire séparé.
        const { data: agences } = await supabase
          .from("agencies" as any)
          .select("id, slug, name")
          .ilike("name", "%immosphera%")
          .limit(1);
        const agencyId = (agences as any[])?.[0]?.id;
        if (!agencyId) throw new Error("Agence Immosphera introuvable.");
        const { error } = await supabase.from("immosphera_secteurs" as any).insert({ ...base, agency_id: agencyId } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["immosphera-secteurs"] });
      toast({ title: secteurEnEdition ? "Secteur modifié" : "Secteur créé" });
      setSecteurFormOpen(false);
      setDessinActif(false);
      setPointsDraft([]);
      setSecteurEnEdition(null);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const supprimerSecteurMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("immosphera_secteurs" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["immosphera-secteurs"] });
      toast({ title: "Secteur supprimé" });
      setSecteurFormOpen(false);
    },
  });

  const toggleConseillerSecteur = (id: string) => {
    setConseillersSecteur((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  // Nouveau contact — géocode l'adresse, détecte le secteur correspondant.
  const creerContact = async () => {
    if (!contactForm.nom.trim() || !contactForm.adresse.trim()) {
      toast({ title: "Nom et adresse requis", variant: "destructive" });
      return;
    }
    setEnregistrementContact(true);
    try {
      const point = await geocodeAddress(contactForm.adresse);
      let secteurTrouve: Secteur | null = null;
      if (point) {
        secteurTrouve = secteurs.find((s) => pointDansPolygone(point, s.polygone)) || null;
      }
      const { data: agences } = await supabase
        .from("agencies" as any)
        .select("id, name")
        .ilike("name", "%immosphera%")
        .limit(1);
      const agencyId = (agences as any[])?.[0]?.id;
      const { error } = await supabase.from("immosphera_contacts" as any).insert({
        agency_id: agencyId,
        nom: contactForm.nom.trim(),
        telephone: contactForm.telephone.trim() || null,
        email: contactForm.email.trim() || null,
        adresse: contactForm.adresse.trim(),
        latitude: point?.lat ?? null,
        longitude: point?.lng ?? null,
        notes: contactForm.notes.trim() || null,
        secteur_id: secteurTrouve?.id ?? null,
        conseiller_origine_id: conseillerActuel?.id ?? null,
        conseiller_assigne_id: conseillerActuel?.id ?? null,
        statut: "nouveau",
      } as any);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["immosphera-contacts"] });
      if (secteurTrouve && !secteurTrouve.conseiller_ids.includes(conseillerActuel?.id || "")) {
        const proprietaires = secteurTrouve.conseiller_ids.map((id) => getAdvisorById(id)?.name).filter(Boolean).join(", ");
        toast({
          title: `Ce contact tombe dans le secteur « ${secteurTrouve.nom} »`,
          description: proprietaires ? `Pense à l'envoyer à ${proprietaires} si besoin.` : undefined,
        });
      } else {
        toast({ title: "Contact enregistré" });
      }
      setContactForm(EMPTY_CONTACT);
      setContactFormOpen(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setEnregistrementContact(false);
    }
  };

  const transfererContact = async (contact: Contact, conseillerId: string) => {
    const { error } = await supabase
      .from("immosphera_contacts" as any)
      .update({ conseiller_assigne_id: conseillerId, statut: "transfere", updated_at: new Date().toISOString() } as any)
      .eq("id", contact.id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["immosphera-contacts"] });
    const destinataire = getAdvisorById(conseillerId);
    toast({ title: destinataire ? `Contact envoyé à ${destinataire.name}` : "Contact envoyé" });

    // Notification best-effort : ne doit jamais faire échouer le transfert.
    try {
      if (destinataire?.email) {
        const { data: profil } = await supabase
          .from("profiles" as any)
          .select("id")
          .ilike("email", destinataire.email)
          .maybeSingle();
        const profilId = (profil as any)?.id;
        if (profilId) {
          await supabase.rpc("create_notification" as any, {
            _user_id: profilId,
            _type: "immosphera_contact",
            _title: `📍 Nouveau contact hors secteur : ${contact.nom}`,
            _message: `${conseillerActuel?.name || "Un conseiller"} t'a envoyé ${contact.nom} (${contact.adresse}).`,
            _entity_type: "immosphera_contact",
            _entity_id: contact.id,
            _agency_id: null,
            _metadata: { url: "/immosphera/secteurs" },
          } as any);
        }
      }
    } catch (e) {
      console.warn("Notification de transfert de contact impossible :", e);
    }
  };

  const statutLabel: Record<Contact["statut"], string> = {
    nouveau: "Nouveau",
    transfere: "Transféré",
    traite: "Traité",
  };

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Carte */}
      <div className="flex-1 flex flex-col min-h-[360px]">
        <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
          <h2 className="font-bold text-sm mr-auto">🗺️ Secteurs</h2>
          {isAdmin && !dessinActif && (
            <Button size="sm" onClick={demarrerDessin} className="text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" /> Nouveau secteur
            </Button>
          )}
          {dessinActif && (
            <>
              <span className="text-xs text-muted-foreground">
                Clique sur la carte pour tracer le contour ({pointsDraft.length} point{pointsDraft.length > 1 ? "s" : ""})
              </span>
              <Button size="sm" variant="outline" onClick={terminerDessin} className="text-xs" disabled={pointsDraft.length < 3}>
                <Check className="h-3.5 w-3.5 mr-1" /> Terminer
              </Button>
              <Button size="sm" variant="ghost" onClick={annulerDessin} className="text-xs">
                <X className="h-3.5 w-3.5 mr-1" /> Annuler
              </Button>
            </>
          )}
        </div>
        <div ref={mapContainerRef} className="flex-1 w-full" style={{ minHeight: "360px" }} />
      </div>

      {/* Contacts */}
      <aside className="w-full md:w-96 border-l border-border flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <h2 className="font-bold text-sm mr-auto">Contacts ({contacts.length})</h2>
          <Button size="sm" onClick={() => setContactFormOpen(true)} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1" /> Nouveau contact
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {contacts.length === 0 && (
            <p className="text-xs text-muted-foreground p-4 text-center">Aucun contact enregistré.</p>
          )}
          {contacts.map((c) => {
            const secteur = c.secteur_id ? secteurParId.get(c.secteur_id) : null;
            const origine = c.conseiller_origine_id ? getAdvisorById(c.conseiller_origine_id) : null;
            const assigne = c.conseiller_assigne_id ? getAdvisorById(c.conseiller_assigne_id) : null;
            const suggestion =
              secteur && !secteur.conseiller_ids.includes(c.conseiller_assigne_id || "")
                ? secteur.conseiller_ids.map((id) => getAdvisorById(id)).filter(Boolean) as Advisor[]
                : [];
            return (
              <div key={c.id} className="p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold">{c.nom}</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                    {statutLabel[c.statut]}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" /> {c.adresse}
                </p>
                {(c.telephone || c.email) && (
                  <p className="text-[10px] text-muted-foreground">{[c.telephone, c.email].filter(Boolean).join(" · ")}</p>
                )}
                <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                  {secteur ? (
                    <span
                      className="px-1.5 py-0.5 rounded-full font-semibold text-white"
                      style={{ background: secteur.couleur }}
                    >
                      {secteur.nom}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Hors secteur tracé</span>
                  )}
                  {origine && <span className="text-muted-foreground">de {origine.name}</span>}
                  {assigne && assigne.id !== origine?.id && (
                    <span className="text-muted-foreground">→ assigné à {assigne.name}</span>
                  )}
                </div>
                {suggestion.length > 0 && (
                  <p className="text-[10px] text-amber-600 font-medium">
                    Secteur de {suggestion.map((a) => a.name).join(", ")}
                  </p>
                )}
                <div className="flex items-center gap-1.5 pt-1">
                  <Select onValueChange={(id) => transfererContact(c, id)}>
                    <SelectTrigger className="h-7 text-[11px] flex-1">
                      <SelectValue placeholder="Envoyer à..." />
                    </SelectTrigger>
                    <SelectContent>
                      {advisors.map((a) => (
                        <SelectItem key={a.id} value={a.id} className="text-xs">
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Send className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Dialogue secteur (création / édition, super admin) */}
      <Dialog open={secteurFormOpen} onOpenChange={(v) => { setSecteurFormOpen(v); if (!v) { setDessinActif(false); setPointsDraft([]); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{secteurEnEdition ? "Modifier le secteur" : "Nouveau secteur"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nom du secteur</Label>
              <Input value={nomSecteur} onChange={(e) => setNomSecteur(e.target.value)} placeholder="Ex. Béziers centre" />
            </div>
            <div>
              <Label>Couleur</Label>
              <div className="flex gap-1.5 mt-1">
                {COULEURS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCouleurSecteur(c)}
                    className={`w-6 h-6 rounded-full border-2 ${couleurSecteur === c ? "border-foreground" : "border-transparent"}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label>Conseiller(s) propriétaire(s)</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {advisors.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleConseillerSecteur(a.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                      conseillersSecteur.includes(a.id)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-muted-foreground border-border"
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              {secteurEnEdition ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive text-xs"
                  onClick={() => supprimerSecteurMutation.mutate(secteurEnEdition.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Supprimer
                </Button>
              ) : (
                <span />
              )}
              <Button
                size="sm"
                onClick={() => sauvegarderSecteurMutation.mutate()}
                disabled={!nomSecteur.trim() || sauvegarderSecteurMutation.isPending}
              >
                {sauvegarderSecteurMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : secteurEnEdition ? "Enregistrer" : "Créer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialogue nouveau contact */}
      <Dialog open={contactFormOpen} onOpenChange={setContactFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nom</Label>
              <Input value={contactForm.nom} onChange={(e) => setContactForm((f) => ({ ...f, nom: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Téléphone</Label>
                <Input value={contactForm.telephone} onChange={(e) => setContactForm((f) => ({ ...f, telephone: e.target.value }))} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Adresse</Label>
              <Input
                value={contactForm.adresse}
                onChange={(e) => setContactForm((f) => ({ ...f, adresse: e.target.value }))}
                placeholder="N° rue, code postal, ville"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Géocodée automatiquement pour détecter le secteur.</p>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={contactForm.notes} onChange={(e) => setContactForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <Button className="w-full" onClick={creerContact} disabled={enregistrementContact}>
              {enregistrementContact ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
