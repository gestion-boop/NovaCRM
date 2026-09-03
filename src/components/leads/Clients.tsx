import { matchesAgency } from "@/hooks/useContacts";
import { clicMailCrm } from '@/lib/composerMail';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import {
  Users,
  Mail,
  Phone,
  Calendar,
  Trash2,
  Pencil,
  ArchiveRestore,
  Search,
  Share2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronRight,
  Building2,
  Flame,
  Sun,
  Snowflake,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { LeadDialog } from "@/components/leads/LeadDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ConsentStatusBadge from "@/components/consent/ConsentStatusBadge";

const IMMOSPHERA_ID = "15157da9-71ea-4760-ae1c-3bc99d9caa20";

const tempLabel = { chaud: "Chaud", tiede: "Tiède", froid: "Froid" } as const;

// Icône + couleur pour le sélecteur cliquable Chaud/Tiède/Froid — l'icône
// reste la même en permanence, seule sa couleur change selon la
// température actuellement sélectionnée du lead.
const TEMP_OPTIONS: { value: "chaud" | "tiede" | "froid"; icon: typeof Flame; activeClass: string }[] = [
  { value: "chaud", icon: Flame, activeClass: "text-red-400 bg-red-500/20 border-red-500/50" },
  { value: "tiede", icon: Sun, activeClass: "text-[#F7BC5F] bg-[#F7BC5F]/20 border-[#F7BC5F]/50" },
  { value: "froid", icon: Snowflake, activeClass: "text-sky-400 bg-sky-500/20 border-sky-500/50" },
];

function getReminderStatus(reminders: any[]): "overdue" | "ongoing" | "upcoming" | null {
  if (!reminders || reminders.length === 0) return null;
  const now = new Date();
  const active = reminders.filter((r) => !r.is_done);
  if (active.length === 0) return null;
  const overdue = active.filter((r) => new Date(r.due_at) < now);
  if (overdue.length > 0) return "overdue";
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const ongoing = active.filter((r) => new Date(r.due_at) <= soon);
  if (ongoing.length > 0) return "ongoing";
  return "upcoming";
}

const STATUS_CONFIG = {
  overdue: {
    color: "bg-red-500",
    ring: "ring-red-500/40",
    label: "Tâche en retard",
    Icon: AlertCircle,
    chip: "bg-red-500/15 text-red-300 border-red-500/30",
  },
  ongoing: {
    color: "bg-[#F9C977]",
    ring: "ring-[#F9C977]/40",
    label: "Tâche en cours (< 7j)",
    Icon: Clock,
    chip: "bg-[#F9C977]/15 text-[#FAD592] border-[#F9C977]/30",
  },
  upcoming: {
    color: "bg-emerald-500",
    ring: "ring-emerald-500/40",
    label: "Tâche à venir",
    Icon: CheckCircle2,
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
};

interface ClientsProps {
  onSelectContact?: (contactId: string) => void;
}

const Clients = ({ onSelectContact }: ClientsProps) => {
  const { activeAgency: rawActiveAgency, currentUser: user } = useAuth();
  const activeAgency = rawActiveAgency?.id === 'all' ? null : rawActiveAgency;
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "chaud" | "tiede" | "froid">("all");
  const [scope, setScope] = useState<"mine" | "shared" | "all">("mine");
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const { data: leads = [] } = useQuery({
    queryKey: ["leads", rawActiveAgency?.id, scope, user?.uid],
    enabled: !!rawActiveAgency && !!user,
    queryFn: async () => {
      let rows: any[] = [];

      if (scope === "shared") {
        const { data: shares, error: sErr } = await supabase
          .from("client_shares")
          .select("lead_id")
          .eq("shared_with", user!.uid);
        if (sErr) throw sErr;
        const ids = (shares ?? []).map((s: any) => s.lead_id);
        if (ids.length === 0) return [];
        const { data, error } = await supabase
          .from("leads")
          .select("*, pipeline_stages(name)")
          .in("id", ids)
          .order("created_at", { ascending: false });
        if (error) throw error;
        rows = (data ?? []).filter((l: any) => !l.deleted_at);
      } else {
        let q = supabase
          .from("leads")
          .select("*, pipeline_stages(name)")
          .order("created_at", { ascending: false });
        // Ticket #52 : sélectionner "Toutes les sociétés" mettait
        // activeAgency à null, ce qui désactivait carrément la requête
        // (enabled: !!activeAgency) — plus aucun client ne s'affichait.
        // On ne filtre par agence que si une agence précise est choisie ;
        // "Toutes les sociétés" doit vraiment tout remonter.
        //
        // Urgence du 3 septembre : « Natacha n'a pas ses clients ». Le filtre
        // d'agence se faisait ici en base, sur l'UUID exact. Or beaucoup de
        // fiches Novavisio portent encore un identifiant d'agence hérité
        // (« novavisio », « agency-2 »…, voir matchesAgency) : ces fiches
        // n'apparaissaient jamais sur cet écran, alors que le pipeline et
        // les contacts, qui passent par matchesAgency, les montrent. Même
        // règle partout maintenant : on filtre côté application.
        // Tous les utilisateurs voient leurs propres clients par défaut
        // Le sélecteur "Tous" permet de voir tous les contacts de l'agence
        if (scope !== "all") q = q.or(`created_by.eq.${user!.uid},assigned_to.eq.${user!.uid}`);
        const { data, error } = await q;
        if (error) throw error;
        rows = (data ?? []).filter((l: any) => !l.deleted_at && (!activeAgency || matchesAgency((l.agency_id as string) || "", activeAgency.id)));
      }

      const leadIds = rows.map((l: any) => l.id);
      const creatorIds = Array.from(new Set(rows.map((l: any) => l.created_by).filter(Boolean)));
      const assignedIds = Array.from(new Set(rows.map((l: any) => l.assigned_to).filter(Boolean)));
      const profileIds = Array.from(new Set([...creatorIds, ...assignedIds]));

      const [profilesRes, remindersRes, sharesRes, consentsRes] = await Promise.all([
        profileIds.length > 0
          ? supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
          : Promise.resolve({ data: [] }),
        leadIds.length > 0
          ? supabase
              .from("reminders")
              .select("id, lead_id, due_at, is_done, user_id, assigned_to")
              .in("lead_id", leadIds)
              .eq("is_done", false)
              .or(`user_id.eq.${user!.uid},assigned_to.eq.${user!.uid}`)
          : Promise.resolve({ data: [] }),
        leadIds.length > 0
          ? supabase.from("client_shares").select("lead_id, shared_with").in("lead_id", leadIds)
          : Promise.resolve({ data: [] }),
        leadIds.length > 0
          ? supabase
              .from("confidential_questionnaires" as any)
              .select("lead_id, submitted_at, signed_at, valid_until, consent_status, data")
              .in("lead_id", leadIds)
              .eq("kind", "consent")
              .not("submitted_at", "is", null)
          : Promise.resolve({ data: [] }),
      ]);

      const profilesById: Record<string, any> = {};
      (profilesRes.data ?? []).forEach((p: any) => {
        profilesById[p.id] = p;
      });

      const remindersByLead: Record<string, any[]> = {};
      (remindersRes.data ?? []).forEach((r: any) => {
        (remindersByLead[r.lead_id] ||= []).push(r);
      });

      const sharedWithByLead: Record<string, Set<string>> = {};
      (sharesRes.data ?? []).forEach((share: any) => {
        if (!share?.lead_id || !share?.shared_with) return;
        (sharedWithByLead[share.lead_id] ||= new Set<string>()).add(share.shared_with);
      });

      const latestConsentByLead: Record<string, any> = {};
      ((consentsRes as any).data ?? []).forEach((c: any) => {
        if (!c?.lead_id || !c?.submitted_at) return;
        const existing = latestConsentByLead[c.lead_id];
        if (!existing || new Date(c.submitted_at).getTime() > new Date(existing.submitted_at).getTime()) {
          latestConsentByLead[c.lead_id] = c;
        }
      });

      return rows.map((l: any) => ({
        ...l,
        creator_profile: l.created_by ? (profilesById[l.created_by] ?? null) : null,
        assigned_profile: l.assigned_to ? (profilesById[l.assigned_to] ?? null) : null,
        is_assigned_contact_shared: Boolean(l.assigned_to && sharedWithByLead[l.id]?.has(l.assigned_to)),
        reminders: remindersByLead[l.id] ?? [],
        latest_consent: latestConsentByLead[l.id] ?? null,
        latest_consent_submitted_at: latestConsentByLead[l.id]?.submitted_at ?? null,
      }));
    },
  });

  const filtered = leads.filter((l: any) => {
    if (filter !== "all" && l.temperature !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        l.full_name?.toLowerCase().includes(s) ||
        l.email?.toLowerCase().includes(s) ||
        l.phone?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  /**
   * Extrait le nom de famille pour classer les contacts archivés.
   */
  const getLastName = (fullName?: string | null) => {
    const normalizedName = (fullName ?? "").trim().replace(/\s+/g, " ");
    if (!normalizedName) return "";

    const parts = normalizedName.split(" ");
    return parts.at(-1) ?? normalizedName;
  };

  /**
   * Ordre d'affichage :
   * 1. Tous les contacts actifs en premier, dans leur ordre actuel.
   * 2. Tous les contacts archivés à la fin, classés par nom de famille.
   */
  const displayedLeads = filtered
    .map((lead: any, originalIndex: number) => ({ lead, originalIndex }))
    .sort((a, b) => {
      const aArchived = Boolean(a.lead.archived_at);
      const bArchived = Boolean(b.lead.archived_at);

      if (aArchived !== bArchived) {
        return aArchived ? 1 : -1;
      }

      if (!aArchived && !bArchived) {
        return a.originalIndex - b.originalIndex;
      }

      const lastNameComparison = getLastName(a.lead.full_name).localeCompare(getLastName(b.lead.full_name), "fr", {
        sensitivity: "base",
        ignorePunctuation: true,
      });

      if (lastNameComparison !== 0) return lastNameComparison;

      return (a.lead.full_name ?? "").localeCompare(b.lead.full_name ?? "", "fr", {
        sensitivity: "base",
        ignorePunctuation: true,
      });
    })
    .map(({ lead }) => lead);

  const handleDelete = async (id: string) => {
    if (scope === "shared") return;
    if (!confirm("Supprimer définitivement ce contact ?")) return;
    try {
      // 3 septembre : corbeille au lieu de l'effacement. Rappels, rendez-vous,
      // documents et commentaires restent attachés à la fiche, pour qu'une
      // restauration depuis Paramètres → « Corbeille des clients » rende
      // tout. L'effacement définitif (avec ses dépendances) se fait là-bas.
      const { data: mises, error } = await supabase
        .from("leads")
        .update({ deleted_at: new Date().toISOString(), deleted_by: user?.uid || null } as any)
        .eq("id", id)
        .select("id");
      if (error) {
        return toast.error(
          /deleted_at/.test(error.message)
            ? "La corbeille n'est pas encore installée en base (migration 20260903120000_leads_corbeille_et_journal.sql à appliquer)."
            : error.message
        );
      }
      if (!mises || mises.length === 0) return toast.error("Mise à la corbeille refusée par la base : votre compte n'a pas le droit de modifier cette fiche.");
      toast.success("Contact mis à la corbeille (récupérable dans Paramètres)");
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["home-counts"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Impossible de supprimer ce contact");
    }
  };

  // Signalé : aucune action ne permettait de sortir un contact archivé de
  // cet état depuis sa carte — seul l'archivage existait, jamais le retour.
  const handleUnarchive = async (id: string) => {
    const { error } = await supabase.from("leads").update({ archived_at: null }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Contact désarchivé");
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["pipeline"] });
  };

  const handleSetTemperature = async (leadId: string, temperature: "chaud" | "tiede" | "froid") => {
    const { error } = await supabase.from("leads").update({ temperature }).eq("id", leadId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["pipeline"] });
  };

  const formatCreatedDate = (date?: string | null) => {
    if (!date) return "Date inconnue";
    return new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  };

  const getCreatorName = (lead: any) =>
    lead.creator_profile?.full_name || lead.creator_profile?.email || "Utilisateur inconnu";

  const getAssignedName = (lead: any) => lead.assigned_profile?.full_name || lead.assigned_profile?.email || null;

  const shouldShowAssignedBadge = (lead: any) =>
    Boolean(
      lead.assigned_to &&
      lead.assigned_to !== lead.created_by &&
      lead.is_assigned_contact_shared === true &&
      getAssignedName(lead),
    );

  const openContact = (id: string) => {
    onSelectContact?.(id);
  };

  return (
    <div className="space-y-6 w-full p-3 sm:p-6">
      {/* ── En-tête ── */}
      <div className="rounded-2xl border border-border bg-card/95 px-4 py-4 shadow-card backdrop-blur-sm">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground drop-shadow-sm">
              Gestion des Clients
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {filtered.length} client{filtered.length !== 1 ? "s" : ""}
              {filter !== "all" || search
                ? " filtrés"
                : scope === "all"
                  ? " dans l'agence"
                  : scope === "shared"
                    ? " partagés"
                    : " mes clients"}
            </p>
          </div>
        </div>

        {/* ── Scope : Mes clients / Partagés / Tous ── */}
        <div className="flex gap-2 flex-wrap mt-4">
          {(["all", "mine", "shared"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-150",
                // Signalé : "gradient-gold"/"shadow-gold" n'existent nulle
                // part dans la config Tailwind du projet — aucun style
                // généré, donc le bouton actif se retrouvait sans fond ni
                // bordure (quasi invisible sur le fond sombre). Remplacé par
                // le même dégradé doré déjà utilisé ailleurs dans ce fichier.
                scope === s
                  ? "bg-gradient-to-r from-[#FAD592] via-[#F9C977] to-[#D9A34E] text-[#1a1230] border-transparent shadow-lg shadow-[#F7BC5F]/30"
                  : "bg-background/70 border-border hover:bg-accent",
              )}
            >
              {s === "mine" ? (
                <>
                  <Users className="w-4 h-4" /> Mes clients
                </>
              ) : s === "shared" ? (
                <>
                  <Share2 className="w-4 h-4" /> Partagés avec moi
                </>
              ) : (
                <>
                  <Building2 className="w-4 h-4" /> Tous (agence)
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Recherche, sur MOBILE uniquement ──────────────────────────────
          Cette barre avait été retirée le 30/08/2026 sur demande explicite
          ("supprime la barre de recherche car il y en a une tout en haut"),
          la barre globale de l'appli faisant déjà le travail.
          Signalé le 31/08/2026 : "elle n'a pas la barre de recherche du
          téléphone portable". En effet — l'en-tête qui porte cette barre
          globale est `hidden md:flex` (Header.tsx) : il DISPARAÎT entièrement
          sous 768 px. Sur téléphone, il n'existait donc plus aucun moyen de
          chercher un client depuis le 30/08.
          Revenue sur TOUS les écrans le 31/08/2026, demande explicite :
          « mets une barre de recherche client quand on clique dans Client,
          Natacha par exemple n'a pas de barre de recherche ». Elle n'était
          jusqu'ici rendue que sous 768 px (`md:hidden`), or un téléphone
          pliable déplié dépasse ce seuil : ni la barre mobile, ni le réflexe
          d'aller chercher celle de l'en-tête. Elle est donc partout. */}
      <div className="relative">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un client (nom, e-mail, téléphone)..."
          className="w-full bg-card/95 border border-border focus:border-primary rounded-2xl pl-10 pr-4 py-3 text-sm outline-none shadow-card"
        />
      </div>

      <div className="bg-card/95 border border-border rounded-2xl p-4 backdrop-blur-sm flex items-center gap-3 flex-wrap shadow-card">
        <div className="flex gap-2 flex-wrap">
          {(["all", "chaud", "tiede", "froid"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150",
                filter === f
                  ? "gradient-gold text-primary-foreground border-transparent shadow-gold"
                  : "border-border hover:bg-accent",
              )}
            >
              {f === "all" ? "Tous" : tempLabel[f]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Grille de cartes ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {displayedLeads.map((l: any) => {
          const reminderStatus = getReminderStatus(l.reminders ?? []);
          const statusCfg = reminderStatus ? STATUS_CONFIG[reminderStatus] : null;

          return (
            <div
              key={l.id}
              data-lead-id={l.id}
              onClick={() => openContact(l.id)}
              className={cn(
                // Ticket #4 (nouvelle base) : fond de carte plus marqué, moins
                // transparent (bg-card/96 laissait trop transparaître le fond).
                "group relative flex h-full min-h-[286px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card cursor-pointer",
                "hover:border-[hsl(43_55%_40%/0.42)] hover:shadow-[0_16px_40px_hsl(43_70%_28%/0.13)] hover:-translate-y-0.5 transition-all duration-200",
                l.archived_at && "opacity-35 grayscale border-dashed",
              )}
            >
              {/* Barre or gauche */}
              <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#FAD592] via-[#F9C977] to-[#D9A34E] opacity-90 shadow-[0_0_14px_rgba(251,191,36,0.30)] transition-opacity group-hover:opacity-100 pointer-events-none" />

              <div className="flex-1 pl-5 pr-4 pt-4 pb-3.5">
                {/* ── Ligne 1 : nom + actions ── */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {statusCfg && (
                      <span
                        title={statusCfg.label}
                        className={cn(
                          "mt-1.5 shrink-0 inline-flex h-2.5 w-2.5 rounded-full ring-2",
                          statusCfg.color,
                          statusCfg.ring,
                        )}
                      />
                    )}
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold leading-tight truncate">{l.full_name}</h3>
                      {l.archived_at && (
                        <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                          Archivé
                        </span>
                      )}
                    </div>
                  </div>

                  {scope === "mine" ? (
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditing(l);
                          setOpen(true);
                        }}
                        className="p-1.5 rounded-full bg-[hsl(43_28%_14%)] border border-[hsl(43_55%_40%)] text-[hsl(43_65%_55%)] hover:bg-[hsl(43_28%_18%)] hover:border-[hsl(43_60%_48%)] transition-all duration-150"
                        title="Modifier les infos"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openContact(l.id)}
                        title="Créer un rendez-vous ou une tâche"
                        className="p-1.5 rounded-full bg-[hsl(43_28%_14%)] border border-[hsl(43_55%_40%)] text-[hsl(43_65%_55%)] hover:bg-[hsl(43_28%_18%)] hover:border-[hsl(43_60%_48%)] transition-all duration-150"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                      </button>
                      {l.archived_at && (
                        <button
                          onClick={() => handleUnarchive(l.id)}
                          className="p-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-all duration-150"
                          title="Désarchiver le contact"
                        >
                          <ArchiveRestore className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(l.id)}
                        className="p-1.5 rounded-full bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 hover:border-destructive/50 transition-all duration-150"
                        title="Supprimer le contact"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                      <Share2 className="w-3 h-3" /> Partagé
                    </span>
                  )}
                </div>

                {/* ── Ligne 2 : badges ── */}
                <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                  <div
                    className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {TEMP_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const isActive = l.temperature === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          title={tempLabel[opt.value]}
                          onClick={() => void handleSetTemperature(l.id, opt.value)}
                          className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center border transition-colors",
                            isActive ? opt.activeClass : "text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/5",
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      );
                    })}
                  </div>
                  {l.agency_id === IMMOSPHERA_ID && <ConsentStatusBadge record={l.latest_consent} />}
                  {l.lead_type && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-[hsl(43_28%_14%)] border-[hsl(43_55%_40%)] text-[hsl(43_65%_55%)]">
                      {l.lead_type}
                    </span>
                  )}
                  {shouldShowAssignedBadge(l) && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-violet-500/15 text-violet-200 border-violet-500/30">
                      Attribué à {getAssignedName(l)}
                    </span>
                  )}
                  {statusCfg && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                        statusCfg.chip,
                      )}
                    >
                      <statusCfg.Icon className="w-3 h-3" />
                      {statusCfg.label}
                    </span>
                  )}
                </div>

                {/* ── Contact ── */}
                <div className="space-y-1.5 text-[13px] mb-3">
                  {/* Demande (3 septembre) : e-mail et téléphone cliquables et
                      surlignés. stopPropagation : le clic ne doit pas aussi
                      ouvrir la fiche. */}
                  {l.email && (
                    <p className="flex items-center gap-2.5 text-muted-foreground">
                      <Mail className="w-4 h-4 shrink-0 text-primary/60" />
                      <a
                        href={`mailto:${l.email}`}
                        title="Écrire depuis la boîte Mail du CRM"
                        onClick={clicMailCrm(l.email)}
                        className="truncate text-primary underline underline-offset-2 decoration-primary/50 hover:decoration-primary"
                      >
                        {l.email}
                      </a>
                    </p>
                  )}
                  {l.phone && (
                    <p className="flex items-center gap-2.5 text-muted-foreground">
                      <Phone className="w-4 h-4 shrink-0 text-primary/60" />
                      <a
                        href={`tel:${String(l.phone).replace(/[^+\d]/g, '')}`}
                        title="Appeler"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary underline underline-offset-2 decoration-primary/50 hover:decoration-primary"
                      >
                        {l.phone}
                      </a>
                    </p>
                  )}
                  {/* Demandé le 2 septembre pour Novavisio : « cette
                      information-là doit être à la vue sur la fiche client
                      quand on est sur le panneau gestion des clients ».
                      Affiché dès qu'un professionnel est renseigné, quelle
                      que soit l'agence — un professionnel sans identité
                      visible n'aide personne. */}
                  {(l.company?.name || l.company?.address) && (
                    <p className="flex items-start gap-2.5 text-muted-foreground">
                      <Building2 className="w-4 h-4 shrink-0 text-primary/60 mt-0.5" />
                      <span className="min-w-0">
                        {l.company?.name && <span className="font-semibold text-foreground">{l.company.name}</span>}
                        {l.company?.name && l.company?.address && <span> — </span>}
                        {l.company?.address}
                      </span>
                    </p>
                  )}
                </div>

                {/* ── Pipeline + Commentaires ── */}
                <div className="border-t border-border/60 pt-3 grid grid-cols-1 gap-2.5 text-[13px]">
                  {l.pipeline_stages?.name && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                        Pipeline
                      </p>
                      <p className="font-semibold text-foreground">{l.pipeline_stages.name}</p>
                    </div>
                  )}
                  {l.comments && (
                    <div className={cn(l.pipeline_stages?.name ? "" : "col-span-2")}>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                        Commentaires
                      </p>
                      <p className="text-muted-foreground line-clamp-2">{l.comments}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Footer : créateur + flèche ── */}
              <div className="mt-auto shrink-0 px-5 py-3 bg-background/85 border-t border-border/40 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Créé par <span className="font-semibold text-foreground">{getCreatorName(l)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Le {formatCreatedDate(l.created_at)}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">Aucun client trouvé</p>
          <p className="text-sm mt-1 opacity-70">Essayez de modifier votre recherche ou vos filtres</p>
        </div>
      )}

      <LeadDialog open={open} onOpenChange={setOpen} lead={editing} />
    </div>
  );
};

export default Clients;
