import { useState } from "react";
import { geocodeCity } from "@/immosphera/lib/geo";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Phone, Mail, MapPin, Building2, Edit, Trash2, Users, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import { PartnerDetailPanel } from "@/immosphera/components/PartnerDetailPanel";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "architecte", label: "Architecte" },
  { value: "automatisme", label: "Automatisme (portail, volet…)" },
  { value: "carreleur", label: "Carreleur" },
  { value: "chauffagiste", label: "Chauffagiste" },
  { value: "climaticien", label: "Climatisation" },
  { value: "courtier", label: "Courtier" },
  { value: "courtier_travaux", label: "Courtier en travaux" },
  { value: "couvreur", label: "Couvreur" },
  { value: "demenageur", label: "Déménageur" },
  { value: "diagnostiqueur", label: "Diagnostiqueur" },
  { value: "electricien", label: "Électricien" },
  { value: "expert_fissure", label: "Expert fissure bâtiment" },
  { value: "geometre", label: "Géomètre" },
  { value: "jardinier", label: "Jardinier / Paysagiste" },
  { value: "macon", label: "Maçon" },
  { value: "menuisier", label: "Menuisier" },
  { value: "multiservices", label: "Multiservices" },
  { value: "notaire", label: "Notaire" },
  { value: "peintre", label: "Peintre" },
  { value: "platrier", label: "Plâtrier" },
  { value: "plombier", label: "Plombier" },
  { value: "serrurier", label: "Serrurier" },
  { value: "terrassier", label: "Terrassier" },
  { value: "autre", label: "Autre" },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

type Partner = Tables<"immosphera_partners">;

type PartnerDoc = { url: string; name: string; type: "image" | "pdf" | "other" };

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  category: "autre" as string,
  company: "",
  intervention_area: "",
  notes: "",
  website: "",
  documents: [] as PartnerDoc[],
};

export default function Partners() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [searchCity, setSearchCity] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [saving, setSaving] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_partners")
        .select("*")
        .order("last_name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("immosphera_partners").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      toast({ title: "Partenaire supprimé" });
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (p: Partner) => {
    setEditing(p);
    setForm({
      first_name: p.first_name,
      last_name: p.last_name,
      email: p.email || "",
      phone: p.phone || "",
      category: p.category,
      company: p.company || "",
      intervention_area: p.intervention_area || "",
      notes: p.notes || "",
      website: (p as any).website || "",
      documents: Array.isArray((p as any).documents) ? (p as any).documents : [],
    });
    setFormOpen(true);
  };

  // Carte de visite / photos / documents du partenaire — upload direct dans
  // le bucket Storage déjà utilisé par le module (immosphera-properties,
  // sous un dossier "partners/" dédié) : évite d'avoir à créer un nouveau
  // bucket. Plusieurs fichiers possibles, lus ensuite en grand avec
  // navigation gauche/droite façon carrousel (voir PartnerDetailPanel).
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const handleUploadDocs = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;
    setUploadingDoc(true);
    try {
      const uploaded: PartnerDoc[] = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() || "bin";
        const path = `partners/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("immosphera-properties")
          .upload(path, file, { upsert: false });
        if (uploadErr) throw uploadErr;
        const { data: urlData, error: signedUrlError } = await supabase.storage
          .from("immosphera-properties")
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        if (signedUrlError) throw signedUrlError;
        uploaded.push({
          url: urlData?.signedUrl || "",
          name: file.name,
          type: file.type.startsWith("image/") ? "image" : file.type === "application/pdf" ? "pdf" : "other",
        });
      }
      setForm((f) => ({ ...f, documents: [...f.documents, ...uploaded] }));
    } catch (err: any) {
      toast({ title: "Erreur d'envoi du fichier", description: err.message, variant: "destructive" });
    } finally {
      setUploadingDoc(false);
    }
  };
  const removeDoc = (url: string) => {
    setForm((f) => ({ ...f, documents: f.documents.filter((d) => d.url !== url) }));
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast({ title: "Nom et prénom requis", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Géocodage automatique depuis la zone d'intervention
      let latitude: number | null = null;
      let longitude: number | null = null;
      const area = form.intervention_area.trim();
      if (area) {
        // Extraire la première ville : séparer par virgule, "et", "/"
        const firstCity = area
          .split(/[,\/]|\bet\b/i)[0]
          .trim()
          .replace(/\s+\d{5}$/, "");
        const coords = await geocodeCity(firstCity);
        if (coords) {
          latitude = coords.lat;
          longitude = coords.lng;
        }
      }

      const payload = {
        first_name: form.first_name.trim().charAt(0).toUpperCase() + form.first_name.trim().slice(1).toLowerCase(),
        last_name: form.last_name.trim().toUpperCase(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        category: form.category as any,
        company: form.company.trim()
          ? form.company.trim().charAt(0).toUpperCase() + form.company.trim().slice(1)
          : null,
        intervention_area: area || null,
        notes: form.notes.trim() || null,
        website: form.website.trim() || null,
        documents: form.documents,
        created_by: user.id,
        latitude,
        longitude,
      };

      if (editing) {
        const { error } = await supabase
          .from("immosphera_partners")
          .update(payload as any)
          .eq("id", editing.id);
        if (error) throw error;
        toast({ title: "Partenaire modifié !" });
      } else {
        const { error } = await supabase.from("immosphera_partners").insert(payload as any);
        if (error) throw error;
        toast({ title: "Partenaire ajouté !" });
      }
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      setFormOpen(false);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const filtered = partners.filter((p) => {
    const matchCat = filterCategory === "all" || p.category === filterCategory;
    const matchSearch =
      !search || `${p.first_name} ${p.last_name} ${p.company || ""}`.toLowerCase().includes(search.toLowerCase());
    const matchCity = !searchCity || (p.intervention_area || "").toLowerCase().includes(searchCity.toLowerCase());
    return matchCat && matchSearch && matchCity;
  });

  const canEdit = (p: Partner) => isAdmin || p.created_by === user?.id;

  return (
    <div className="w-full py-4 sm:py-6 space-y-4 sm:space-y-6 px-3 sm:px-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3">
          <Users className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
          <h1 className="text-lg sm:text-2xl font-bold">Annuaire Partenaires</h1>
        </div>
        <Button onClick={openNew} size="sm" className="text-xs sm:text-sm">
          <Plus className="mr-1.5 h-3.5 w-3.5 sm:h-4 sm:w-4" /> Ajouter
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="relative flex-1 min-w-0">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filtrer par ville…"
            value={searchCity}
            onChange={(e) => setSearchCity(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="w-full sm:w-[220px] justify-between h-9 text-sm">
              {filterCategory === "all"
                ? "Toutes catégories"
                : CATEGORIES.find((c) => c.value === filterCategory)?.label}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[220px] p-0">
            <Command>
              <CommandInput placeholder="Rechercher..." />
              <CommandList>
                <CommandEmpty>Aucune catégorie</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="all" onSelect={() => setFilterCategory("all")}>
                    <Check className={cn("mr-2 h-4 w-4", filterCategory === "all" ? "opacity-100" : "opacity-0")} />
                    Toutes catégories
                  </CommandItem>
                  {CATEGORIES.map((c) => (
                    <CommandItem key={c.value} value={c.label} onSelect={() => setFilterCategory(c.value)}>
                      <Check className={cn("mr-2 h-4 w-4", filterCategory === c.value ? "opacity-100" : "opacity-0")} />
                      {c.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl p-8 text-center border border-border">
          <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
          <h3 className="font-bold mb-1">Aucun partenaire trouvé</h3>
          <p className="text-sm text-muted-foreground">Ajoutez votre premier partenaire pour commencer le catalogue.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="bg-card rounded-xl border border-border p-4 space-y-3 hover:border-primary/40 transition-colors cursor-pointer"
              onClick={() => setSelectedPartner(p)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-sm">
                    {p.first_name.charAt(0).toUpperCase() + p.first_name.slice(1).toLowerCase()}{" "}
                    {p.last_name.toUpperCase()}
                  </p>
                  {p.company && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {p.company}
                    </p>
                  )}
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                  {CATEGORY_MAP[p.category] || p.category}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-muted-foreground">
                {p.phone && (
                  <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 hover:text-foreground">
                    <Phone className="h-3 w-3" /> {p.phone}
                  </a>
                )}
                {p.email && (
                  <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 hover:text-foreground">
                    <Mail className="h-3 w-3" /> {p.email}
                  </a>
                )}
                {p.intervention_area && (
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" /> {p.intervention_area}
                  </p>
                )}
              </div>

              {p.notes && <p className="text-xs text-muted-foreground/80 line-clamp-2">{p.notes}</p>}

              {canEdit(p) && (
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => openEdit(p)}>
                    <Edit className="h-3 w-3 mr-1" /> Modifier
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => deleteMutation.mutate(p.id)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Supprimer
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le partenaire" : "Nouveau partenaire"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Prénom *</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, first_name: v.charAt(0).toUpperCase() + v.slice(1) }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nom *</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, last_name: e.target.value.toUpperCase() }));
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Catégorie</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Entreprise</Label>
              <Input
                value={form.company}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, company: v.charAt(0).toUpperCase() + v.slice(1) }));
                }}
                placeholder="Nom de l'entreprise"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Téléphone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="06 12 34 56 78"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Zone d'intervention</Label>
              <Input
                value={form.intervention_area}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, intervention_area: v.charAt(0).toUpperCase() + v.slice(1) }));
                }}
                placeholder="Ex: Béziers, Narbonne, Hérault…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Site internet</Label>
              <Input
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="www.exemple.fr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Informations complémentaires…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Carte de visite / photos / documents</Label>
              <div className="flex items-center gap-3">
                <label className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 text-sm font-semibold cursor-pointer border border-border transition-colors shrink-0">
                  {uploadingDoc ? "Envoi…" : "Ajouter un fichier"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    disabled={uploadingDoc}
                    onChange={(e) => { void handleUploadDocs(e.target.files); e.target.value = ""; }}
                  />
                </label>
                <p className="text-xs text-muted-foreground">Photos ou PDF — plusieurs possibles, lus en grand ensuite avec navigation.</p>
              </div>
              {form.documents.length > 0 && (
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {form.documents.map((doc) => (
                    <div key={doc.url} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                      {doc.type === "image" ? (
                        <img src={doc.url} alt={doc.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground p-1 text-center">{doc.name}</div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeDoc(doc.url)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                        title="Retirer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail panel */}
      {selectedPartner && <PartnerDetailPanel partner={selectedPartner} onClose={() => setSelectedPartner(null)} />}
    </div>
  );
}
