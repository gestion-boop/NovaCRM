import { useState } from "react";
import { createPortal } from "react-dom";
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
import { Plus, Search, Phone, Mail, MapPin, Building2, Edit, Trash2, Users, ChevronsUpDown, Check, X, FileText, Globe } from "lucide-react";
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
    <div className="w-full py-5 sm:py-7 px-4 sm:px-8 max-w-7xl mx-auto space-y-6">
      {/* En-tête de la page Partenaires */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-[#07191b]/95 via-[#0c262a]/90 to-[#07191b]/95 border border-[#F7BC5F]/20 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/35 text-[#FAD592] flex items-center justify-center shadow-[0_0_15px_rgba(247,188,95,0.2)]">
            <Users className="h-6 w-6 text-[#F7BC5F]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Annuaire Partenaires</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#F7BC5F]/20 text-[#F7BC5F] border border-[#F7BC5F]/30">
                {filtered.length} contact{filtered.length > 1 ? "s" : ""}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Artisans, notaires, diagnostiqueurs et professionnels recommandés
            </p>
          </div>
        </div>

        <button
          onClick={openNew}
          className="px-4 py-2.5 bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs sm:text-sm rounded-xl flex items-center gap-2 shadow-lg shadow-[#F7BC5F]/20 transition-all cursor-pointer shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Nouveau partenaire</span>
        </button>
      </div>

      {/* Barre de filtres et recherche */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-2xl bg-[#0a181c]/80 border border-white/10 backdrop-blur-md">
        <div className="sm:col-span-5 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            placeholder="Rechercher par nom, entreprise..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#051114] border border-white/15 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
          />
        </div>

        <div className="sm:col-span-4 relative">
          <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            placeholder="Filtrer par ville ou secteur..."
            value={searchCity}
            onChange={(e) => setSearchCity(e.target.value)}
            className="w-full bg-[#051114] border border-white/15 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
          />
        </div>

        <div className="sm:col-span-3">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="w-full bg-[#051114] border border-white/15 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-[#F7BC5F] transition-colors cursor-pointer"
          >
            <option value="all" className="bg-[#0D1B22] text-white">Toutes catégories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value} className="bg-[#0D1B22] text-white">
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grille des partenaires moderne */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl bg-white/5 animate-pulse border border-white/5" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-12 text-center border border-white/10 bg-[#07191b]/50 flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-slate-500">
            <Users className="h-7 w-7" />
          </div>
          <h3 className="font-bold text-white text-base">Aucun partenaire trouvé</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            {search || searchCity || filterCategory !== "all"
              ? "Aucun professionnel ne correspond à vos filtres actuels. Essayez de réinitialiser votre recherche."
              : "Ajoutez votre premier partenaire pour commencer à constituer votre carnet d'adresses professionnel."}
          </p>
          {(search || searchCity || filterCategory !== "all") && (
            <button
              onClick={() => {
                setSearch("");
                setSearchCity("");
                setFilterCategory("all");
              }}
              className="mt-2 text-xs text-[#F7BC5F] hover:underline"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => {
            const initials = `${p.first_name?.charAt(0) || ""}${p.last_name?.charAt(0) || ""}`.toUpperCase() || "P";
            const docCount = Array.isArray((p as any).documents) ? (p as any).documents.length : 0;
            return (
              <div
                key={p.id}
                className="group relative bg-[#09171b] border border-white/10 hover:border-[#F7BC5F]/50 rounded-2xl p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 cursor-pointer"
                onClick={() => setSelectedPartner(p)}
              >
                <div>
                  {/* Top card : avatar + nom + catégorie */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F7BC5F]/20 to-amber-700/30 border border-[#F7BC5F]/35 text-[#FAD592] font-black text-sm flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm text-white truncate group-hover:text-[#F7BC5F] transition-colors">
                          {p.first_name.charAt(0).toUpperCase() + p.first_name.slice(1).toLowerCase()} {p.last_name.toUpperCase()}
                        </h4>
                        {p.company ? (
                          <p className="text-xs text-slate-400 truncate flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3 w-3 shrink-0 text-[#F7BC5F]/80" />
                            <span>{p.company}</span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500 italic">Indépendant</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Badge Catégorie */}
                  <div className="mb-3">
                    <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#F7BC5F]/15 text-[#FAD592] border border-[#F7BC5F]/30 tracking-wide">
                      {CATEGORY_MAP[p.category] || p.category}
                    </span>
                  </div>

                  {/* Coordonnées rapides */}
                  <div className="space-y-1.5 text-xs text-slate-300">
                    {p.phone && (
                      <a
                        href={`tel:${p.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 hover:text-[#F7BC5F] transition-colors truncate"
                      >
                        <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="font-mono">{p.phone}</span>
                      </a>
                    )}
                    {p.email && (
                      <a
                        href={`mailto:${p.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 hover:text-[#F7BC5F] transition-colors truncate"
                      >
                        <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{p.email}</span>
                      </a>
                    )}
                    {p.intervention_area && (
                      <p className="flex items-center gap-2 text-slate-400 truncate">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span className="truncate">{p.intervention_area}</span>
                      </p>
                    )}
                  </div>

                  {p.notes && (
                    <p className="text-[11px] text-slate-400 mt-2.5 line-clamp-2 italic bg-white/[0.03] p-2 rounded-lg border border-white/5">
                      « {p.notes} »
                    </p>
                  )}
                </div>

                {/* Footer card : indicateur doc & actions */}
                <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-400">
                    {docCount > 0 ? (
                      <span className="flex items-center gap-1 text-sky-400 font-medium">
                        <FileText className="h-3.5 w-3.5" />
                        <span>{docCount} doc{docCount > 1 ? "s" : ""}</span>
                      </span>
                    ) : (
                      <span className="text-slate-600">Aucun doc</span>
                    )}
                  </div>

                  {canEdit(p) && (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        title="Modifier le partenaire"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(p.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title="Supprimer le partenaire"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Ajouter / Modifier Partenaire — TÉLÉPORTÉE SUR document.body AVEC z-[99999] */}
      {formOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => !saving && setFormOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[88vh] bg-[#0E1A20] border border-white/20 rounded-2xl shadow-2xl flex flex-col text-white overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header fixe — TOUJOURS visible au sommet sans jamais être masqué par le Header du CRM */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-[#0B151A]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#F7BC5F]/20 border border-[#F7BC5F]/40 text-[#FAD592] flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-[#F7BC5F]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-wide">
                    {editing ? "Modifier le partenaire" : "Nouveau partenaire"}
                  </h3>
                  <p className="text-[11px] text-slate-400">Annuaire des professionnels et partenaires</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={saving}
                className="w-8 h-8 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                title="Fermer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Corps défilable — avec contrastes nets et soignés */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-200">Prénom <span className="text-rose-400">*</span></label>
                  <input
                    autoFocus
                    value={form.first_name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({ ...f, first_name: v.charAt(0).toUpperCase() + v.slice(1) }));
                    }}
                    placeholder="Prénom"
                    className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/50 transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-200">Nom <span className="text-rose-400">*</span></label>
                  <input
                    value={form.last_name}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, last_name: e.target.value.toUpperCase() }));
                    }}
                    placeholder="NOM"
                    className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/50 transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200">Catégorie</label>
                <div className="relative">
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] transition-colors cursor-pointer appearance-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value} className="bg-[#0D1B22] text-white">
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <ChevronsUpDown className="w-4 h-4" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200">Entreprise</label>
                <input
                  value={form.company}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, company: v.charAt(0).toUpperCase() + v.slice(1) }));
                  }}
                  placeholder="Nom de l'entreprise"
                  className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/50 transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-200">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="email@exemple.fr"
                    className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-200">Téléphone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="06 12 34 56 78"
                    className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200">Zone d'intervention</label>
                <input
                  value={form.intervention_area}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, intervention_area: v.charAt(0).toUpperCase() + v.slice(1) }));
                  }}
                  placeholder="Ex: Béziers, Narbonne, Hérault…"
                  className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200">Site internet</label>
                <input
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  placeholder="www.exemple.fr"
                  className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-200">Notes &amp; Informations complémentaires</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Informations complémentaires, spécialités…"
                  className="w-full bg-[#061216] border border-white/20 rounded-xl px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors resize-none"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="text-xs font-semibold text-slate-200">Carte de visite / photos / documents</label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white cursor-pointer border border-white/15 transition-colors flex items-center gap-2">
                    <Plus className="w-3.5 h-3.5 text-[#F7BC5F]" />
                    <span>{uploadingDoc ? "Envoi…" : "Ajouter un fichier"}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      className="hidden"
                      disabled={uploadingDoc}
                      onChange={(e) => { void handleUploadDocs(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                  <p className="text-[11px] text-slate-400">Photos ou PDF lisibles en grand format.</p>
                </div>

                {form.documents.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 pt-1">
                    {form.documents.map((doc) => (
                      <div key={doc.url} className="relative group aspect-square rounded-xl overflow-hidden border border-white/15 bg-white/5">
                        {doc.type === "image" ? (
                          <img src={doc.url} alt={doc.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 p-1 text-center font-mono">
                            {doc.name}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeDoc(doc.url)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs cursor-pointer hover:bg-red-600"
                          title="Retirer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer fixe — TOUJOURS visible sans être coupé par le bas de l'écran */}
            <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-end gap-3 shrink-0 bg-[#0B151A]">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-white/15 hover:bg-white/10 text-slate-300 font-medium text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.first_name.trim() || !form.last_name.trim()}
                className="px-5 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 shadow-md"
              >
                {saving ? "Enregistrement…" : "Enregistrer le partenaire"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Detail panel */}
      {selectedPartner && <PartnerDetailPanel partner={selectedPartner} onClose={() => setSelectedPartner(null)} />}
    </div>
  );
}
