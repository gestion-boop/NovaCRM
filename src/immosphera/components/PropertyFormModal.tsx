import { useState, useEffect, useRef } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { advisors, type Advisor } from "@/immosphera/lib/advisors";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { useToast } from "@/hooks/use-toast";
import { geocodeAddress } from "@/immosphera/lib/geo";
import { useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";

import { VISIBLE_PROPERTY_TYPES as PROPERTY_TYPES } from "@/immosphera/lib/propertyTypes";

/** All structured fields stored in tech_details JSONB */
const EMPTY_DETAILS = {
  terrace: "Non",
  pool: "Non",
  serviced: "Non",
  builderFree: "Non",
  chauffage: "",
  cuisine: "",
  vue: "",
  exposition: "",
  construction: "",
  etatInterieur: "",
  ameublement: "",
  salleDeBains: "",
  salleDeau: "",
  wc: "",
  cave: "",
  balcon: "",
  garage: "",
  parking: "",
  terrainSurface: "",
  assainissement: "",
  taxeFonciere: "",
  reference: "",
  dpe: "",
  ges: "",
  descriptionPiscine: "",
  autres: "",
};

type TechDetails = typeof EMPTY_DETAILS;

function toNullableNumber(value: string): number | null {
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/,/g, ".")
    .trim();

  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProperty?: Tables<"immosphera_properties"> | null;
}

export function PropertyFormModal({ open, onOpenChange, editingProperty }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [showAllDetails, setShowAllDetails] = useState(false);

  // Import automatique depuis le lien de l'annonce Immosphera360 (demande
  // explicite : coller juste le lien du site, ça remplit toute la fiche et
  // prend la 1ère photo en couverture). `importedPhotos` garde les photos
  // suivantes de l'annonce pour compléter la galerie du bien à l'enregistrement.
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Pour un NOUVEAU bien, on ne montre d'abord que le lien à coller — le
  // reste du formulaire (pré-rempli) n'apparaît qu'une fois l'import réussi,
  // ou si l'utilisateur choisit explicitement de saisir à la main.
  const [formRevealed, setFormRevealed] = useState(true);
  const [importedPhotos, setImportedPhotos] = useState<string[]>([]);
  const [advisorAutoMatched, setAdvisorAutoMatched] = useState<boolean | null>(null);
  const [customTitle, setCustomTitle] = useState<string>("");
  const lastImportedUrlRef = useRef<string>("");

  const [form, setForm] = useState({
    location: "",
    type: "house" as string,
    listingType: "sale" as "sale" | "rental",
    advisorId: advisors[0]?.id ?? "",
    virtualTour: "",
    giraffeUrl: "",
    websiteUrl: "",
    price: "",
    area: "",
    rooms: "",
    bedrooms: "",
    description: "",
    listedAt: "",
  });

  const [details, setDetails] = useState<TechDetails>({ ...EMPTY_DETAILS });

  useEffect(() => {
    if (editingProperty) {
      const td = (editingProperty.tech_details || {}) as Record<string, string>;
      setForm({
        location: editingProperty.location || "",
        type: editingProperty.property_type || "house",
        listingType: (editingProperty as any).listing_type === "rental" ? "rental" : "sale",
        advisorId: editingProperty.agent_name
          ? advisors.find((a) => a.name === editingProperty.agent_name)?.id || advisors[0]?.id || ""
          : advisors[0]?.id || "",
        virtualTour: editingProperty.virtual_tour_url || "",
        giraffeUrl: editingProperty.giraffe_url || "",
        websiteUrl: editingProperty.listing_url || "",
        price: editingProperty.price ? String(editingProperty.price) : "",
        area: editingProperty.surface_area ? String(editingProperty.surface_area) : "",
        rooms: editingProperty.rooms ? String(editingProperty.rooms) : "",
        bedrooms: editingProperty.bedrooms ? String(editingProperty.bedrooms) : "",
        description: editingProperty.description || "",
        listedAt: (editingProperty as any).listed_at || "",
      });
      setDetails({
        ...EMPTY_DETAILS,
        terrace: td.terrace || "Non",
        pool: td.pool || "Non",
        serviced: td.serviced || "Non",
        builderFree: td.builderFree || "Non",
        chauffage: td.chauffage || "",
        cuisine: td.cuisine || "",
        vue: td.vue || "",
        exposition: td.exposition || "",
        construction: td.construction || "",
        etatInterieur: td.etatInterieur || "",
        ameublement: td.ameublement || "",
        salleDeBains: td.salleDeBains || "",
        salleDeau: td.salleDeau || "",
        wc: td.wc || "",
        cave: td.cave || "",
        balcon: td.balcon || "",
        garage: td.garage || "",
        parking: td.parking || "",
        terrainSurface: td.terrainSurface || "",
        assainissement: td.assainissement || "",
        taxeFonciere: td.taxeFonciere || "",
        reference: td.reference || "",
        dpe: td.dpe || "",
        ges: td.ges || "",
        descriptionPiscine: td.descriptionPiscine || "",
        autres: td.autres || "",
      });
      setPhotoPreview(editingProperty.images?.[0] || "");
      setPhotoFile(null);
      setImportedPhotos(editingProperty.images?.slice(1) || []);
      setCustomTitle(editingProperty.title || "");
    } else {
      // Même logique que l'import : pas de vraie date de mise en vente à
      // aller chercher pour une saisie manuelle, donc date du jour par
      // défaut (modifiable), utile pour le futur code couleur carte.
      setForm((prev) => ({ ...prev, location: "", listedAt: new Date().toISOString().slice(0, 10) }));
      setDetails({ ...EMPTY_DETAILS });
      setPhotoPreview("");
      setPhotoFile(null);
      setImportedPhotos([]);
      setCustomTitle("");
    }
    setImportError(null);
    setAdvisorAutoMatched(null);
    lastImportedUrlRef.current = "";
    setFormRevealed(!!editingProperty);
  }, [editingProperty, open]);

  const handleChange = (name: string, value: string) => setForm((prev) => ({ ...prev, [name]: value }));
  const handleDetail = (name: keyof TechDetails, value: string) => setDetails((prev) => ({ ...prev, [name]: value }));

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleImportFromWebsite = async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url || !/immosphera\.fr/i.test(url) || url === lastImportedUrlRef.current || importing) return;
    lastImportedUrlRef.current = url;
    setImporting(true);
    setImportError(null);

    try {
      const response = await fetch("/api/immosphera/import-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `Erreur import (${response.status})`);

      // Conseiller : d'abord par email (le plus fiable), puis par nom en
      // repli (accents/casse ignorés) si l'email n'a pas matché — la
      // dictée avait signalé "tu ne récupères pas la bonne personne", donc
      // on garde une trace explicite (advisorAutoMatched) pour ne plus
      // jamais laisser un conseiller par défaut passer inaperçu comme
      // s'il avait été identifié avec certitude.
      const normalizeName = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
      const matchedAdvisor =
        (data.agentEmail && advisors.find((a) => a.email.toLowerCase() === data.agentEmail.toLowerCase())) ||
        (data.agentName && advisors.find((a) => normalizeName(a.name).includes(normalizeName(data.agentName)) || normalizeName(data.agentName).includes(normalizeName(a.name)))) ||
        null;
      setAdvisorAutoMatched(!!matchedAdvisor);

      setCustomTitle(data.title || "");

      setForm((prev) => ({
        ...prev,
        location: data.location || prev.location,
        type: data.propertyType || prev.type,
        listingType: data.listingType === "rental" ? "rental" : "sale",
        price: data.price != null ? String(data.price) : prev.price,
        area: data.surfaceArea != null ? String(data.surfaceArea) : prev.area,
        rooms: data.rooms != null ? String(data.rooms) : prev.rooms,
        bedrooms: data.bedrooms != null ? String(data.bedrooms) : prev.bedrooms,
        description: data.description || prev.description,
        advisorId: matchedAdvisor?.id || prev.advisorId,
        // La date de mise en vente réelle n'est pas exposée sur les pages
        // immosphera.fr (aucune métadonnée de date trouvée) — on renseigne
        // donc la date d'import du jour, qui correspond dans l'usage normal
        // au jour où le bien entre réellement dans le CRM. Nécessaire pour
        // le futur code couleur carte (vert < 1 mois, orange 1-2 mois,
        // rouge > 2 mois) — laissé modifiable si le bien est en réalité
        // en vente depuis plus longtemps.
        listedAt: prev.listedAt || new Date().toISOString().slice(0, 10),
      }));
      if (data.dpe) handleDetail("dpe", data.dpe);
      if (data.ges) handleDetail("ges", data.ges);
      if (data.bathrooms != null) handleDetail("salleDeBains", String(data.bathrooms));
      if (data.shower) handleDetail("salleDeau", String(data.shower));
      if (data.wc) handleDetail("wc", String(data.wc));
      if (data.reference) handleDetail("reference", String(data.reference));
      // Terrasse/piscine : jamais récupérées jusqu'ici (toujours "Non" par
      // défaut même quand l'annonce les mentionne) — appliquées seulement
      // quand détectées avec certitude (sinon on laisse la valeur existante).
      if (data.terrace) handleDetail("terrace", data.terrace);
      if (data.pool) handleDetail("pool", data.pool);

      const photos: string[] = Array.isArray(data.photos) ? data.photos : [];
      if (photos.length > 0) {
        setPhotoPreview(photos[0]);
        setPhotoFile(null);
        setImportedPhotos(photos.slice(1));
      }

      setFormRevealed(true);
      toast({ title: "Annonce importée !", description: "Vérifie les champs pré-remplis avant d'enregistrer." });
    } catch (err: any) {
      setImportError(err?.message || "Import impossible.");
      lastImportedUrlRef.current = "";
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;

    if (!user) {
      toast({ title: "Connexion requise", variant: "destructive" });
      return;
    }

    const location = form.location.trim();
    if (!location) {
      toast({ title: "Lieu requis", variant: "destructive" });
      return;
    }

    const parsedPrice = toNullableNumber(form.price);
    if (form.price.trim() && parsedPrice === null) {
      toast({
        title: "Prix invalide",
        description: "Saisis uniquement un montant, par exemple 65000 ou 65 000.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      let imageUrl = editingProperty?.images?.[0] || "";
      let imageKey = editingProperty?.image_key || "";

      // L'upload reste bloquant uniquement lorsqu'une nouvelle photo a réellement été choisie.
      if (photoFile) {
        const ext = photoFile.name.split(".").pop() || "jpg";
        const filePath = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("immosphera-properties")
          .upload(filePath, photoFile, { upsert: false });
        if (uploadErr) throw uploadErr;

        const { data: urlData, error: signedUrlError } = await supabase.storage
          .from("immosphera-properties")
          .createSignedUrl(filePath, 60 * 60 * 24 * 365 * 5);
        if (signedUrlError) throw signedUrlError;

        imageUrl = urlData?.signedUrl || "";
        imageKey = filePath;
      }

      // Galerie complète : la couverture (imageUrl, uploadée ou importée)
      // suivie des autres photos récupérées depuis l'annonce Immosphera.fr,
      // sans doublon.
      const galleryImages = imageUrl
        ? [imageUrl, ...importedPhotos.filter((p) => p !== imageUrl)]
        : [...importedPhotos];

      const selectedAdvisor = advisors.find((a) => a.id === form.advisorId);
      const typeLabel = PROPERTY_TYPES.find((t) => t.value === form.type)?.label || form.type;

      // Sauvegarde immédiatement les valeurs saisies manuellement.
      const cleanDetails: Record<string, string> = {};
      Object.entries(details).forEach(([key, value]) => {
        const cleanValue = String(value ?? "").trim();
        if (cleanValue) cleanDetails[key] = cleanValue;
      });

      // La table immosphera_properties impose latitude/longitude à la création.
      // On géocode donc AVANT l'INSERT, mais uniquement pour un nouveau bien.
      let initialCoords: { lat: number; lng: number } | null = null;
      if (!editingProperty) {
        initialCoords = await geocodeAddress(location, true);
        if (!initialCoords) {
          throw new Error(
            "Impossible de localiser ce bien. Indique la commune ET le code postal, par exemple : Narbonne 11100.",
          );
        }
      }

      const payload: Record<string, unknown> = {
        title: customTitle.trim() || `${typeLabel} - ${location}`,
        address: location,
        location,
        property_type: form.type as any,
        listing_type: form.listingType,
        price: parsedPrice,
        surface_area: toNullableNumber(form.area),
        rooms: toNullableNumber(form.rooms),
        bedrooms: toNullableNumber(form.bedrooms),
        description: form.description.trim() || null,
        virtual_tour_url: form.virtualTour.trim() || null,
        giraffe_url: form.giraffeUrl.trim() || null,
        listing_url: form.websiteUrl.trim() || null,
        images: galleryImages,
        image_key: imageKey || null,
        agent_name: selectedAdvisor?.name || null,
        agent_email: selectedAdvisor?.email || null,
        agent_phone: selectedAdvisor?.phone || null,
        agent_photo: selectedAdvisor?.photo || null,
        tech_details: cleanDetails,
        listed_at: form.listedAt || null,
      };

      if (initialCoords) {
        payload.latitude = initialCoords.lat;
        payload.longitude = initialCoords.lng;
      }

      let savedId: string;

      const isMissingListingTypeError = (error: any) => {
        const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
        return message.includes("listing_type") && (message.includes("column") || message.includes("schema cache"));
      };

      if (editingProperty) {
        let result = await supabase
          .from("immosphera_properties")
          .update(payload as any)
          .eq("id", editingProperty.id)
          .select("id")
          .maybeSingle();

        // Compatibilité avec une base qui n'aurait pas encore la colonne listing_type.
        if (result.error && isMissingListingTypeError(result.error)) {
          const { listing_type: _ignored, ...legacyPayload } = payload;
          result = await supabase
            .from("immosphera_properties")
            .update(legacyPayload as any)
            .eq("id", editingProperty.id)
            .select("id")
            .maybeSingle();
        }

        if (result.error) throw result.error;
        if (!result.data?.id) {
          throw new Error("Le bien n'a pas été modifié. Vérifie les droits Supabase de cet utilisateur.");
        }

        savedId = result.data.id;
        toast({ title: "Bien modifié !" });
      } else {
        let result = await supabase
          .from("immosphera_properties")
          .insert({ ...payload, created_by: user.id } as any)
          .select("id")
          .single();

        // Compatibilité avec une base qui n'aurait pas encore la colonne listing_type.
        if (result.error && isMissingListingTypeError(result.error)) {
          const { listing_type: _ignored, ...legacyPayload } = payload;
          result = await supabase
            .from("immosphera_properties")
            .insert({ ...legacyPayload, created_by: user.id } as any)
            .select("id")
            .single();
        }

        if (result.error) throw result.error;
        savedId = result.data.id;
        toast({ title: "Bien ajouté !" });
      }

      // Fermer immédiatement après confirmation de la base.
      onOpenChange(false);
      setSaving(false);

      // Rafraîchir la liste ET la fiche actuellement ouverte.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["properties"] }),
        queryClient.invalidateQueries({ queryKey: ["property", savedId] }),
        queryClient.invalidateQueries({ queryKey: ["price-history", savedId] }),
      ]);

      // Géocodage et enrichissement IA en arrière-plan : ils ne bloquent plus le bouton Enregistrer.
      void (async () => {
        if (editingProperty) {
          try {
            const coords = await geocodeAddress(location, true);
            if (coords) {
              await supabase
                .from("immosphera_properties")
                .update({ latitude: coords.lat, longitude: coords.lng } as any)
                .eq("id", savedId);
            }
          } catch (error) {
            console.warn("Géocodage différé impossible", error);
          }
        }

        if (form.description.trim()) {
          try {
            const { data: aiData, error: aiError } = await supabase.functions.invoke("immosphera-parse-description", {
              body: {
                description: form.description,
                property_type: form.type,
              },
            });

            if (!aiError && aiData?.tech_details) {
              const mergedDetails = {
                ...(aiData.tech_details as Record<string, string>),
                ...cleanDetails,
              };
              await supabase
                .from("immosphera_properties")
                .update({ tech_details: mergedDetails } as any)
                .eq("id", savedId);
            }
          } catch (error) {
            console.warn("Analyse IA différée impossible", error);
          }
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["properties"] }),
          queryClient.invalidateQueries({ queryKey: ["property", savedId] }),
        ]);
      })();
    } catch (err: any) {
      console.error("Erreur d'enregistrement du bien", err);
      toast({
        title: "Erreur d'enregistrement",
        description: err?.message || "Une erreur inconnue est survenue.",
        variant: "destructive",
      });
      setSaving(false);
    }
  };

  const selectedAdvisor = advisors.find((a) => a.id === form.advisorId);

  const YesNoSelect = ({ label, value, field }: { label: string; value: string; field: keyof TechDetails }) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => handleDetail(field, v)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Oui">Oui</SelectItem>
          <SelectItem value="Non">Non</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const TextField = ({
    label,
    field,
    placeholder,
  }: {
    label: string;
    field: keyof TechDetails;
    placeholder?: string;
  }) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        placeholder={placeholder || ""}
        value={details[field]}
        onChange={(e) => handleDetail(field, e.target.value)}
      />
    </div>
  );

  // Champ DPE/GES avec la pastille couleur de la lettre saisie, mise à jour
  // en direct pendant la frappe — demande explicite : "essaie... de mettre
  // la lettre DPE en couleur" pour une interface plus "immobilier professionnel".
  const DPE_COLORS: Record<string, string> = {
    A: "bg-emerald-500 text-white", B: "bg-green-500 text-white", C: "bg-lime-500 text-[#0b1c1e]",
    D: "bg-yellow-400 text-[#0b1c1e]", E: "bg-orange-500 text-white", F: "bg-orange-700 text-white", G: "bg-red-600 text-white",
  };
  const DpeField = ({ label, field }: { label: string; field: "dpe" | "ges" }) => {
    const letter = details[field].trim().toUpperCase();
    const colorClass = DPE_COLORS[letter];
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Ex: D"
            maxLength={1}
            value={details[field]}
            onChange={(e) => handleDetail(field, e.target.value)}
          />
          {colorClass && (
            <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black shadow-sm ${colorClass}`}>
              {letter}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{editingProperty ? "Modifier le bien" : "Nouveau bien"}</DialogTitle>
        </DialogHeader>

        {/* Le bouton Enregistrer est dans un pied de page hors de cette zone
            scrollable, pour ne jamais disparaître sous la fenêtre — c'est ce
            qui rendait le bouton introuvable une fois la fiche pré-remplie
            (formulaire complet + galerie de photos = souvent plus haut que
            l'écran). */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
        {!editingProperty && !formRevealed ? (
          <div className="py-10 flex flex-col items-center gap-4 text-center max-w-md mx-auto">
            <Sparkles className="w-8 h-8 text-primary" />
            <div>
              <p className="font-bold">Colle simplement le lien de l'annonce</p>
              <p className="text-sm text-muted-foreground mt-1">
                Le lien de la page du bien sur immosphera.fr suffit : titre, prix, surface, pièces,
                description, DPE/GES, conseiller et toutes les photos se récupèrent automatiquement.
              </p>
            </div>
            <Input
              type="url"
              autoFocus
              placeholder="https://www.immosphera.fr/vente/..."
              value={form.websiteUrl}
              onChange={(e) => handleChange("websiteUrl", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleImportFromWebsite(form.websiteUrl);
                }
              }}
            />
            <Button
              className="primary-gold w-full"
              disabled={importing || !form.websiteUrl.trim()}
              onClick={() => handleImportFromWebsite(form.websiteUrl)}
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Import en cours...
                </>
              ) : (
                "Importer et créer la fiche"
              )}
            </Button>
            {importError && <p className="text-xs text-destructive">{importError}</p>}
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => setFormRevealed(true)}
            >
              Remplir manuellement sans lien
            </button>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6">
          <div className="space-y-6">
            {/* === Section 1: Infos principales === */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Informations principales
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Lieu du bien</Label>
                  <Input
                    placeholder="Ex: Béziers, 34500"
                    value={form.location}
                    onChange={(e) => handleChange("location", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Type de bien</Label>
                  <Select value={form.type} onValueChange={(v) => handleChange("type", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROPERTY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Vente ou Location</Label>
                  <Select
                    value={form.listingType}
                    onValueChange={(v) => setForm((prev) => ({ ...prev, listingType: v as "sale" | "rental" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sale">Vente</SelectItem>
                      <SelectItem value="rental">Location</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Prix (€)</Label>
                  <Input
                    placeholder="Ex: 350000"
                    value={form.price}
                    onChange={(e) => handleChange("price", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Superficie (m²)</Label>
                  <Input
                    placeholder="Ex: 120"
                    value={form.area}
                    onChange={(e) => handleChange("area", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Pièces</Label>
                  <Input
                    placeholder="Ex: 5"
                    value={form.rooms}
                    onChange={(e) => handleChange("rooms", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Chambres</Label>
                  <Input
                    placeholder="Ex: 3"
                    value={form.bedrooms}
                    onChange={(e) => handleChange("bedrooms", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Surface terrain (m²)</Label>
                  <Input
                    placeholder="Ex: 2000"
                    value={details.terrainSurface}
                    onChange={(e) => handleDetail("terrainSurface", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Date d'entrée du mandat</Label>
                  <Input type="date" value={form.listedAt} onChange={(e) => handleChange("listedAt", e.target.value)} />
                </div>
              </div>
            </div>

            {/* === Section 2: Caractéristiques === */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Caractéristiques
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <YesNoSelect label="Terrasse" value={details.terrace} field="terrace" />
                <div className="space-y-1.5">
                  <Label>Piscine</Label>
                  <Select value={details.pool} onValueChange={(v) => handleDetail("pool", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Oui">Oui</SelectItem>
                      <SelectItem value="Non">Non</SelectItem>
                      <SelectItem value="Possible">Possible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <TextField label="Salle de bains" field="salleDeBains" placeholder="Ex: 1" />
                <TextField label="Salle d'eau" field="salleDeau" placeholder="Ex: 2" />
                <TextField label="WC" field="wc" placeholder="Ex: 2" />
                <TextField label="Balcon" field="balcon" placeholder="Ex: 1" />
              </div>
            </div>

            {/* === Section 3: Détails complets (toggle) === */}
            <div>
              <button
                type="button"
                className="text-xs text-primary font-semibold mb-3 hover:underline"
                onClick={() => setShowAllDetails((p) => !p)}
              >
                {showAllDetails
                  ? "▼ Masquer les détails complets"
                  : "▶ Afficher tous les détails (chauffage, vue, DPE…)"}
              </button>

              {showAllDetails && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 animate-in fade-in-0 duration-200">
                  <TextField label="Chauffage" field="chauffage" placeholder="Ex: Au sol / Individuel" />
                  <TextField label="Cuisine" field="cuisine" placeholder="Ex: Aménagée et équipée" />
                  <TextField label="Vue" field="vue" placeholder="Ex: Dégagée" />
                  <TextField label="Exposition" field="exposition" placeholder="Ex: Sud" />
                  <TextField label="Année construction" field="construction" placeholder="Ex: 1949" />
                  <TextField label="État intérieur" field="etatInterieur" placeholder="Ex: En bon état" />
                  <TextField label="Ameublement" field="ameublement" placeholder="Ex: Non meublé" />
                  <YesNoSelect label="Cave" value={details.cave || "Non"} field="cave" />
                  <TextField label="Garage" field="garage" placeholder="Ex: 1" />
                  <TextField label="Parking" field="parking" placeholder="Ex: 2 places" />
                  <TextField label="Surface terrain" field="terrainSurface" placeholder="Ex: 2 000 m²" />
                  <TextField label="Assainissement" field="assainissement" placeholder="Ex: Tout à l'égout" />
                  <TextField label="Taxe foncière" field="taxeFonciere" placeholder="Ex: 2 362 € /an" />
                  <TextField label="Référence" field="reference" placeholder="Ex: 122" />
                  <DpeField label="DPE" field="dpe" />
                  <DpeField label="GES" field="ges" />
                  <TextField
                    label="Desc. piscine"
                    field="descriptionPiscine"
                    placeholder="Ex: Piscine chauffée 10x5m"
                  />
                  <TextField label="Autres" field="autres" placeholder="Ex: Cheminée" />

                  {form.type === "land" && (
                    <>
                      <YesNoSelect label="Viabilisé" value={details.serviced} field="serviced" />
                      <YesNoSelect label="Libre constructeur" value={details.builderFree} field="builderFree" />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* === Section 4: Liens & conseiller === */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Liens & conseiller
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Conseiller</Label>
                  {advisorAutoMatched === true && (
                    <p className="text-[11px] font-semibold text-emerald-400">✓ Détecté automatiquement depuis l'annonce</p>
                  )}
                  {advisorAutoMatched === false && (
                    <p className="text-[11px] font-semibold text-amber-400">
                      ⚠ Non identifié automatiquement — vérifie/choisis le bon conseiller.
                    </p>
                  )}
                  <Select
                    value={form.advisorId}
                    onValueChange={(v) => {
                      handleChange("advisorId", v);
                      setAdvisorAutoMatched(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {advisors.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="flex items-center gap-2">
                            <img src={a.photo} alt={a.name} className="w-5 h-5 rounded-full object-cover" />
                            {a.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Visite virtuelle (URL)</Label>
                  <Input
                    type="url"
                    placeholder="https://"
                    value={form.virtualTour}
                    onChange={(e) => handleChange("virtualTour", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Lien Giraffe360</Label>
                  <Input
                    type="url"
                    placeholder="https://"
                    value={form.giraffeUrl}
                    onChange={(e) => handleChange("giraffeUrl", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Lien site internet (immosphera.fr)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="url"
                      placeholder="Colle ici le lien de l'annonce immosphera.fr : toute la fiche se remplit automatiquement"
                      value={form.websiteUrl}
                      onChange={(e) => handleChange("websiteUrl", e.target.value)}
                      onBlur={(e) => handleImportFromWebsite(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleImportFromWebsite((e.target as HTMLInputElement).value);
                        }
                      }}
                    />
                    {importing && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-muted-foreground" />}
                  </div>
                  {importing && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Récupération des informations de l'annonce...
                    </p>
                  )}
                  {importError && <p className="text-xs text-destructive">{importError}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Photo du bien</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {photoPreview ? "Photo sélectionnée" : "Aucun fichier"}
                    </span>
                    <Label className="primary-gold cursor-pointer text-xs px-3 py-1.5">
                      Ajouter
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                    </Label>
                  </div>
                </div>
              </div>
            </div>

            {/* === Description libre === */}
            <div className="space-y-1.5">
              <Label>Description / Notes libres</Label>
              <Textarea
                rows={3}
                placeholder="Notes complémentaires sur le bien..."
                value={form.description}
                onChange={(e) => handleChange("description", e.target.value)}
              />
            </div>
          </div>

          {/* Preview sidebar */}
          <aside className="space-y-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Aperçu carte</p>
            <div className="bg-card rounded-[18px] overflow-hidden border border-border shadow-md">
              <div className="aspect-[4/3] bg-muted">
                {photoPreview && <img src={photoPreview} alt="Aperçu" className="w-full h-full object-cover" />}
              </div>
              <div className="p-3 space-y-1">
                <p className="font-bold text-sm">
                  {PROPERTY_TYPES.find((t) => t.value === form.type)?.label || form.type}
                </p>
                <p className="text-xs text-muted-foreground">{form.location || "Lieu du bien"}</p>
                {selectedAdvisor && (
                  <div className="flex items-center gap-2 mt-2">
                    <img src={selectedAdvisor.photo} alt={selectedAdvisor.name} className="w-6 h-6 rounded-full" />
                    <span className="text-xs">{selectedAdvisor.name}</span>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
        )}
        </div>

        {(editingProperty || formRevealed) && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border shrink-0 bg-card">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button className="primary-gold text-base px-6 py-5" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Validation en cours...
                </>
              ) : (
                "Valider et enregistrer"
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
