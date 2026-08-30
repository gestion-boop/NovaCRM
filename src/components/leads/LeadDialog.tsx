import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { UserPlus, Building2 } from "lucide-react";
import { Users } from "lucide-react";
import { getAgencyLogo } from "@/lib/agency-logos";
import { loadContactTypes } from "@/lib/contact-types";
import { useAutoSave } from "@/hooks/useAutoSave";
import AutoSaveBadge from "@/components/AutoSaveBadge";
import { getAssignedUserIdAsUuid, toValidUuidOrNull } from "@/data/teamMembers";

const schema = z
  .object({
    first_name: z.string().trim().max(60).optional().or(z.literal("")),
    last_name: z.string().trim().max(60).optional().or(z.literal("")),
    email: z.string().trim().email().max(255).optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional(),
    lead_type: z.string().trim().max(60).optional(),
    contact_type: z.string().trim().max(60).optional(),
    source: z.string().trim().max(120).optional(),
    sector: z.string().trim().max(120).optional(),
    property_type: z.string().trim().max(120).optional(),
    budget: z.coerce.number().min(0).max(100_000_000).optional(),
    estimated_value: z.coerce.number().min(0).max(10_000_000).optional(),
    comments: z.string().max(2000).optional(),
  })
  .refine((d) => Boolean((d.first_name ?? "").trim() || (d.last_name ?? "").trim()), {
    message: "Renseignez au moins un prénom ou un nom",
    path: ["first_name"],
  });

const TEMP_OPTIONS = [
  { value: "chaud", label: "Chaud - Très intéressé", dot: "bg-red-500" },
  { value: "tiede", label: "Tiède - Intéressé", dot: "bg-[#F7BC5F]" },
  { value: "froid", label: "Froid - Prospect peu intéressé", dot: "bg-blue-500" },
];

const LEAD_TYPES = ["Acheteur", "Vendeur"];

// Provenances proposées (Immosphera uniquement)
const SOURCE_OPTIONS = ["Le Bon Coin", "Bien'ici", "Le Figaro", "Se Loger"];

const capitalize = (s: string) =>
  s
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) => (part.length > 0 && !/\s|-/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("");

const uppercaseName = (s: string) => s.toUpperCase();

export const LeadDialog = ({
  open,
  onOpenChange,
  lead,
  prefill,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  lead: any;
  prefill?: any;
}) => {
  const { activeAgency: rawActiveAgency, currentUser: user, userProfile } = useAuth();
  const activeAgency = rawActiveAgency?.id === 'all' ? null : rawActiveAgency;
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const qc = useQueryClient();
  const [contactTypes, setContactTypes] = useState<string[]>(() => loadContactTypes(user?.uid));
  useEffect(() => {
    setContactTypes(loadContactTypes(user?.uid));
    const handler = () => setContactTypes(loadContactTypes(user?.uid));
    window.addEventListener("contact-types-updated", handler);
    return () => window.removeEventListener("contact-types-updated", handler);
  }, [user?.uid]);
  const CONTACT_TYPES = contactTypes;

  // Champ "Provenance" réservé à l'agence Immosphera
  const isImmosphera = (activeAgency?.name ?? "").toLowerCase().includes("immosphera");

  const [form, setForm] = useState<any>({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    lead_type: "",
    contact_type: "",
    source: "",
    source_other: false,
    budget: 0,
    sector: "",
    property_type: "",
    temperature: "froid",
    pipeline_id: "",
    stage_id: "",
    estimated_value: 0,
    comments: "",
    assigned_to: "",
    secondary_contact: { first_name: "", last_name: "", email: "", phone: "" },
    company: { name: "", siret: "", role: "", address: "", postal_code: "", city: "" },
    has_secondary: false,
    has_company: false,
  });
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const { data: pipelines = [] } = useQuery({
    queryKey: ["pipelines", activeAgency?.id],
    enabled: !!activeAgency && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("pipelines")
        .select("*")
        .eq("agency_id", activeAgency!.id)
        .order("created_at");
      return data ?? [];
    },
  });

  const { data: allStages = [] } = useQuery({
    queryKey: ["stages-all", activeAgency?.id],
    enabled: !!activeAgency && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("agency_id", activeAgency!.id)
        .order("position");
      return data ?? [];
    },
  });

  // Liste des membres de l'agence (pour attribution par super_admin)
  const { data: agencyMembers = [] } = useQuery({
    queryKey: ["agency-members-for-assign", activeAgency?.id],
    enabled: !!activeAgency && open && isSuperAdmin,
    queryFn: async () => {
      const { data: mem } = await supabase.from("agency_members").select("user_id").eq("agency_id", activeAgency!.id);
      const ids = (mem ?? []).map((m: any) => m.user_id);
      if (ids.length === 0) return [] as { id: string; full_name: string | null; email: string | null }[];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      return (profs ?? []) as { id: string; full_name: string | null; email: string | null }[];
    },
  });

  const stages = form.pipeline_id ? allStages.filter((s: any) => s.pipeline_id === form.pipeline_id) : allStages;

  useEffect(() => {
    // On ne réinitialise le formulaire qu'à l'ouverture du dialogue
    // (ou lorsqu'on change de fiche). Sans cette garde, un simple
    // refetch react-query (par exemple au retour sur l'onglet) qui
    // remplace la référence de `lead` ferait perdre la saisie en cours.
    if (!open) return;
    if (lead) {
      const [fn, ...rest] = (lead.full_name ?? "").split(" ");
      const nextForm = {
        first_name: lead.first_name ?? fn ?? "",
        last_name: lead.last_name ?? rest.join(" ") ?? "",
        email: lead.email ?? "",
        phone: lead.phone ?? "",
        lead_type: lead.lead_type ?? "",
        contact_type: lead.contact_type ?? "",
        contact_type_other: lead.contact_type && !CONTACT_TYPES.includes(lead.contact_type),
        source: lead.source ?? "",
        source_other: !!(lead.source && !SOURCE_OPTIONS.includes(lead.source)),
        budget: lead.budget ?? 0,
        sector: lead.sector ?? "",
        property_type: lead.property_type ?? "",
        temperature: lead.temperature ?? "froid",
        pipeline_id: lead.pipeline_id ?? "",
        stage_id: lead.stage_id ?? "",
        estimated_value: lead.estimated_value ?? 0,
        comments: lead.comments ?? "",
        assigned_to: lead.assigned_to ?? "",
        secondary_contact: lead.secondary_contact ?? { first_name: "", last_name: "", email: "", phone: "" },
        company: lead.company ?? { name: "", siret: "", role: "", address: "", postal_code: "", city: "" },
        has_secondary: !!(
          lead.secondary_contact &&
          (lead.secondary_contact.first_name ||
            lead.secondary_contact.last_name ||
            lead.secondary_contact.email ||
            lead.secondary_contact.phone)
        ),
        has_company: !!(
          lead.company &&
          (lead.company.name ||
            lead.company.siret ||
            lead.company.role ||
            lead.company.address ||
            lead.company.postal_code ||
            lead.company.city)
        ),
      };
      setForm(nextForm);
      setHydrated(true);
    } else {
      setForm({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        lead_type: "",
        contact_type: "",
        budget: 0,
        sector: "",
        property_type: "",
        source: "",
        source_other: false,
        temperature: "froid",
        pipeline_id: "",
        stage_id: "",
        estimated_value: 0,
        comments: "",
        assigned_to: "",
        secondary_contact: { first_name: "", last_name: "", email: "", phone: "" },
        company: { name: "", siret: "", role: "", address: "", postal_code: "", city: "" },
        has_secondary: false,
        has_company: false,
        ...(prefill ?? {}),
      });
      setHydrated(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, open]);

  useEffect(() => {
    if (!open) setHydrated(false);
  }, [open]);

  // Auto-select first stage when pipeline changes (création ET édition)
  // Sans cela, en édition, changer de pipeline laisse stage_id vide et le
  // trigger DB `sync_lead_pipeline_from_stage` remet pipeline_id à NULL.
  useEffect(() => {
    if (form.pipeline_id && stages.length && !stages.find((s: any) => s.id === form.stage_id)) {
      setForm((f: any) => ({ ...f, stage_id: stages[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.pipeline_id, allStages.length]);

  // Auto-rattachement au pipeline "Transactions" lorsqu'un client Vendeur est saisi.
  // Ne s'applique qu'à la création (pas en édition) et seulement si aucun pipeline
  // n'a encore été choisi manuellement.
  useEffect(() => {
    if (!open || lead) return;
    if (form.lead_type !== "Vendeur") return;
    if (form.pipeline_id) return;
    const match = (pipelines as any[]).find((p: any) => /transaction/i.test(p?.name ?? ""));
    if (match) {
      setForm((f: any) => ({ ...f, pipeline_id: match.id, stage_id: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.lead_type, pipelines.length, open]);

  /** Construit le payload depuis le state form. Retourne null si la validation échoue. */
  const buildPayload = useCallback(
    (silent = false): any | null => {
      const normalizedForm = {
        ...form,
        first_name: capitalize(form.first_name ?? ""),
        last_name: uppercaseName(form.last_name ?? ""),
      };
      const parsed = schema.safeParse(normalizedForm);
      if (!parsed.success) {
        if (!silent) toast.error(parsed.error.errors[0].message);
        return null;
      }
      const fn = (parsed.data.first_name ?? "").trim();
      const ln = (parsed.data.last_name ?? "").trim();
      const fullName = `${fn} ${ln}`.trim() || "(Sans nom)";
      const payload = {
        first_name: fn || null,
        last_name: ln || null,
        full_name: fullName,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        lead_type: parsed.data.lead_type || null,
        contact_type: parsed.data.contact_type || null,
        source: parsed.data.source || null,
        sector: parsed.data.sector || null,
        property_type: parsed.data.property_type || null,
        budget: parsed.data.budget ?? 0,
        estimated_value: parsed.data.estimated_value ?? 0,
        comments: parsed.data.comments || null,
        temperature: form.temperature,
        pipeline_id: form.pipeline_id || null,
        stage_id: form.stage_id || null,
        agency_id: activeAgency!.id,
      } as any;
      // Co-contact (2ᵉ personne) — stocké en JSON ; null si la section est masquée
      if (form.has_secondary) {
        const sc = form.secondary_contact ?? {};
        const hasAny = sc.first_name || sc.last_name || sc.email || sc.phone;
        payload.secondary_contact = hasAny
          ? {
              first_name: (sc.first_name ?? "").trim() || null,
              last_name: (sc.last_name ?? "").trim() || null,
              email: (sc.email ?? "").trim() || null,
              phone: (sc.phone ?? "").trim() || null,
            }
          : null;
      } else {
        payload.secondary_contact = null;
      }
      // Société / professionnel
      if (form.has_company) {
        const co = form.company ?? {};
        const hasAny = co.name || co.siret || co.role || co.address || co.postal_code || co.city;
        payload.company = hasAny
          ? {
              name: (co.name ?? "").trim() || null,
              siret: (co.siret ?? "").trim() || null,
              role: (co.role ?? "").trim() || null,
              address: (co.address ?? "").trim() || null,
              postal_code: (co.postal_code ?? "").trim() || null,
              city: (co.city ?? "").trim() || null,
            }
          : null;
      } else {
        payload.company = null;
      }
      // Attribution : super_admin peut choisir, sinon par défaut = créateur
      if (isSuperAdmin && form.assigned_to) {
        payload.assigned_to = form.assigned_to;
      }
      return payload;
    },
    [form, activeAgency, isSuperAdmin],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAgency) {
      toast.error("Sélectionnez une agence avant de créer un lead.");
      return;
    }
    if (!user) {
      toast.error("Utilisateur non authentifié.");
      return;
    }
    const payload = buildPayload(false);
    if (!payload) return;
    setSaving(true);
    const buildFullAddress = (co: any) => {
      if (!co) return "";
      const parts = [
        (co.address ?? "").trim(),
        [(co.postal_code ?? "").trim(), (co.city ?? "").trim()].filter(Boolean).join(" "),
      ].filter(Boolean);
      return parts.join(", ");
    };
    const previousAddress = buildFullAddress(lead?.company);
    const hadCoords = lead?.latitude != null && lead?.longitude != null;
    const createdByUuid =
      toValidUuidOrNull(user.uid) ||
      getAssignedUserIdAsUuid(user.email) ||
      null;
    const assignedToUuid =
      isSuperAdmin && form.assigned_to
        ? getAssignedUserIdAsUuid(form.assigned_to)
        : createdByUuid;
    const { error } = lead
      ? await supabase.from("leads").update(payload).eq("id", lead.id)
      : await supabase.from("leads").insert({
          ...payload,
          created_by: createdByUuid,
          assigned_to: assignedToUuid,
        } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(lead ? "Lead mis à jour" : "Lead créé");
    if (!lead) {
      try {
        window.dispatchEvent(new Event("nova:lead-created"));
      } catch {}
    }
    // Fire-and-forget geocode
    try {
      const nextAddress = buildFullAddress(payload.company);
      const addressChanged = nextAddress && nextAddress !== previousAddress;
      const needsInitial = nextAddress && !hadCoords;
      if (addressChanged || needsInitial) {
        const co = payload.company ?? {};
        const geoBody = {
          address: co.address ?? null,
          postal_code: co.postal_code ?? null,
          city: co.city ?? null,
        };
        const targetId = lead?.id;
        if (targetId) {
          void supabase.functions.invoke("geocode-lead", { body: { lead_id: targetId, ...geoBody } });
        } else {
          // new lead: fetch id then geocode
          void (async () => {
            const { data } = await supabase
              .from("leads")
              .select("id")
              .eq("agency_id", activeAgency!.id)
              .eq("created_by", user!.uid)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (data?.id) {
              void supabase.functions.invoke("geocode-lead", { body: { lead_id: data.id, ...geoBody } });
            }
          })();
        }
      }
    } catch {}
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["pipeline"] });
    qc.invalidateQueries({ queryKey: ["home-counts"] });
    qc.invalidateQueries({ queryKey: ["lead-detail"] });
    onOpenChange(false);
  };

  // Auto-save UNIQUEMENT en édition (lead existant) après hydratation.
  // Les saisies invalides (champs requis vides) sont silencieusement ignorées.
  const autoEnabled = open && !!lead && hydrated && !!activeAgency;
  const {
    status: autoStatus,
    lastSavedAt,
    flushNow,
  } = useAutoSave({
    value: form,
    enabled: autoEnabled,
    debounceMs: 800,
    storageKey: lead?.id ? `autosave:lead:${lead.id}` : undefined,
    onSave: async () => {
      if (!lead) return;
      const payload = buildPayload(true);
      if (!payload) return; // validation silencieuse — on attend une saisie valide
      const { error } = await supabase.from("leads").update(payload).eq("id", lead.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["home-counts"] });
      qc.invalidateQueries({ queryKey: ["lead-detail"] });
      qc.invalidateQueries({ queryKey: ["lead", lead.id] });
    },
  });

  const handleOpenChange = async (next: boolean) => {
    if (!next && lead) {
      try {
        await flushNow();
      } catch {
        /* l'erreur reste affichée dans le badge */
      }
    }
    onOpenChange(next);
  };

  const selectedPipeline = pipelines.find((p: any) => p.id === form.pipeline_id);

  // Valeur affichée dans le Select de provenance :
  // - une des options connues → l'option
  // - "Autre" coché ou valeur libre hors liste → "Autre"
  // - vide → placeholder
  const sourceSelectValue = form.source_other
    ? "Autre"
    : SOURCE_OPTIONS.includes(form.source)
      ? form.source
      : form.source
        ? "Autre"
        : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-2xl font-bold">
                {lead ? "Modifier le lead" : "Informations du lead"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {lead
                  ? "Toutes les modifications sont enregistrées automatiquement."
                  : "Saisissez les informations de votre nouveau prospect"}
              </p>
            </div>
            {lead && <AutoSaveBadge status={autoStatus} lastSavedAt={lastSavedAt} />}
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-6 pt-2">
          {/* Identité */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prénom</Label>
              <Input
                value={form.first_name}
                onChange={(e) =>
                  setForm((f: any) => ({
                    ...f,
                    first_name: capitalize(e.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input
                value={form.last_name}
                onChange={(e) => setForm((f: any) => ({ ...f, last_name: uppercaseName(e.target.value) }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="contact@exemple.fr"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Téléphone</Label>
              <Input
                placeholder="06 12 34 56 78"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.lead_type} onValueChange={(v) => setForm({ ...form, lead_type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionnez le type" />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type de contact</Label>
              <Select
                value={
                  CONTACT_TYPES.includes(form.contact_type) || form.contact_type === "" ? form.contact_type : "Autre"
                }
                onValueChange={(v) =>
                  setForm({ ...form, contact_type: v === "Autre" ? "" : v, contact_type_other: v === "Autre" })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionnez le type de contact" />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.contact_type_other && (
                <Input
                  className="mt-2"
                  placeholder="Précisez le type de contact"
                  value={form.contact_type}
                  onChange={(e) => setForm({ ...form, contact_type: e.target.value })}
                />
              )}
            </div>
          </div>

          {/* Provenance du contact — Immosphera uniquement */}
          {isImmosphera && (
            <div className="space-y-2">
              <Label>Provenance</Label>
              <Select
                value={sourceSelectValue}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    source: v === "Autre" ? "" : v,
                    source_other: v === "Autre",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="D'où vient ce contact ?" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                  <SelectItem value="Autre">Autre</SelectItem>
                </SelectContent>
              </Select>
              {form.source_other && (
                <Input
                  className="mt-2"
                  placeholder="Précisez la provenance"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Budget max client (€)</Label>
              <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Secteur</Label>
              <Input
                placeholder="Secteur"
                value={form.sector}
                onChange={(e) => setForm({ ...form, sector: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Type de bien</Label>
              <Input
                placeholder="Ex: Appartement, Maison"
                value={form.property_type}
                onChange={(e) => setForm({ ...form, property_type: e.target.value })}
              />
            </div>
          </div>

          {/* Société selon pipeline */}
          <div className="space-y-2">
            <Label>Société (selon le pipeline)</Label>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-4">
              {activeAgency ? (
                <img
                  src={getAgencyLogo(activeAgency.name)}
                  alt={activeAgency.name}
                  className="h-10 w-10 rounded-md object-contain bg-background p-1"
                />
              ) : (
                <Building2 className="h-10 w-10 text-muted-foreground" />
              )}
              <div>
                <p className="font-semibold">{activeAgency?.name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">La société du lead suit le pipeline sélectionné</p>
              </div>
            </div>
          </div>

          {/* Pipeline + Étape */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select
                value={form.pipeline_id || "__none__"}
                onValueChange={(v) => setForm({ ...form, pipeline_id: v === "__none__" ? "" : v, stage_id: "" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Aucun (libre)</SelectItem>
                  {pipelines.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Le client peut rester libre et être ajouté à un pipeline plus tard.
              </p>
            </div>
            {form.pipeline_id ? (
              <div className="space-y-2">
                <Label>Étape pipeline</Label>
                <Select value={form.stage_id} onValueChange={(v) => setForm({ ...form, stage_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir une étape" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div />
            )}
          </div>

          <div className={isImmosphera ? "grid grid-cols-3 gap-4" : "grid grid-cols-2 gap-4"}>
            <div className="space-y-2">
              <Label>Statut du lead</Label>
              <Select value={form.temperature} onValueChange={(v) => setForm({ ...form, temperature: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMP_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex items-center gap-2">
                        <span className={`inline-block h-2.5 w-2.5 rounded-sm ${o.dot}`} />
                        {o.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isImmosphera && (
              <div className="space-y-2">
                <Label>Acheteur / Vendeur</Label>
                <Select value={form.lead_type} onValueChange={(v) => setForm({ ...form, lead_type: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Acheteur">Acheteur</SelectItem>
                    <SelectItem value="Vendeur">Vendeur</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Honoraires (€)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.estimated_value}
                onChange={(e) => setForm({ ...form, estimated_value: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Commentaires</Label>
            <Textarea
              rows={4}
              placeholder="Informations complémentaires sur le prospect..."
              value={form.comments}
              onChange={(e) => setForm({ ...form, comments: e.target.value })}
            />
          </div>

          {/* Deuxième personne (conjoint / co-contact) */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, has_secondary: !form.has_secondary })}
              className="w-full flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4 text-primary" />
                Deuxième personne (conjoint, co-contact)
              </span>
              <span className="text-xs text-muted-foreground">{form.has_secondary ? "Masquer" : "Ajouter"}</span>
            </button>
            {form.has_secondary && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label>Prénom</Label>
                  <Input
                    value={form.secondary_contact?.first_name ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        secondary_contact: {
                          ...form.secondary_contact,
                          first_name: capitalize(e.target.value),
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Nom</Label>
                  <Input
                    value={form.secondary_contact?.last_name ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        secondary_contact: { ...form.secondary_contact, last_name: e.target.value.toUpperCase() },
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.secondary_contact?.email ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, secondary_contact: { ...form.secondary_contact, email: e.target.value } })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Téléphone</Label>
                  <Input
                    value={form.secondary_contact?.phone ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, secondary_contact: { ...form.secondary_contact, phone: e.target.value } })
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Panneau Société (professionnel) */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, has_company: !form.has_company })}
              className="w-full flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Building2 className="h-4 w-4 text-primary" />
                Société (professionnel)
              </span>
              <span className="text-xs text-muted-foreground">{form.has_company ? "Masquer" : "Ajouter"}</span>
            </button>
            {form.has_company && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label>Nom de la société</Label>
                  <Input
                    value={form.company?.name ?? ""}
                    onChange={(e) => setForm({ ...form, company: { ...form.company, name: e.target.value } })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>SIRET</Label>
                  <Input
                    value={form.company?.siret ?? ""}
                    onChange={(e) => setForm({ ...form, company: { ...form.company, siret: e.target.value } })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Fonction / poste</Label>
                  <Input
                    value={form.company?.role ?? ""}
                    onChange={(e) => setForm({ ...form, company: { ...form.company, role: e.target.value } })}
                  />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Adresse (rue, n°)</Label>
                  <Input
                    value={form.company?.address ?? ""}
                    onChange={(e) => setForm({ ...form, company: { ...form.company, address: e.target.value } })}
                    placeholder="12 rue de la République"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Code postal</Label>
                  <Input
                    value={form.company?.postal_code ?? ""}
                    onChange={(e) => setForm({ ...form, company: { ...form.company, postal_code: e.target.value } })}
                    placeholder="11100"
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Ville</Label>
                  <Input
                    value={form.company?.city ?? ""}
                    onChange={(e) => setForm({ ...form, company: { ...form.company, city: e.target.value } })}
                    placeholder="Narbonne"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Attribution super_admin uniquement */}
          {isSuperAdmin && (
            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <Label className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-primary" />
                Attribuer à (super admin)
              </Label>
              <Select
                value={form.assigned_to || "__none__"}
                onValueChange={(v) => setForm({ ...form, assigned_to: v === "__none__" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un utilisateur" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Non attribué —</SelectItem>
                  {agencyMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name?.trim() || m.email?.split("@")[0] || "Utilisateur"}
                      {m.email ? ` · ${m.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                L'utilisateur attribué aura un accès complet à cette fiche selon les règles de permissions.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            {lead ? (
              <Button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="gradient-gold text-primary-foreground shadow-md"
              >
                Fermer
              </Button>
            ) : (
              <>
                <Button
                  type="submit"
                  disabled={saving}
                  className="gradient-gold text-primary-foreground gap-2 shadow-md"
                >
                  <UserPlus className="h-4 w-4" />
                  {saving ? "Enregistrement…" : "Créer le lead"}
                </Button>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Annuler
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
