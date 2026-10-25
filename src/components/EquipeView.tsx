import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import { supabase } from '@/lib/supabase';

import {
  Briefcase,
  Building2,
  Calendar,
  ExternalLink,
  GraduationCap,
  IdCard,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone as PhoneIcon,
  Search,
  ShieldCheck,
  Users,
  X,
  UserPlus,
  Plus,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Ban,
  Send,
  Power,
  PowerOff,
  Trash2,
  Check,
  Copy,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Bell,
  BellOff,
  Smartphone,
  Monitor,
} from 'lucide-react';

import { AGENCIES } from '@/types';

import { TEAM_MEMBERS } from '@/data/teamMembers';

import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

interface EquipeViewProps {
  onNavigate?: (nav: string) => void;
  onComposeMail?: (email: string) => void;
  onOpenContact?: (contactId: string) => void;
}

interface ProfileRow {
  id: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  job_title?: string | null;
  business_cards?: { url: string; label: string }[] | null;
  rsac_number?: string | null;
  rc_pro_insurance?: string | null;
  is_active?: boolean | null;
}

interface DirectoryMember {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  dbRole: string;
  agencyIds: string[];
  avatarUrl: string;
  phone: string | null;
  rsacNumber: string | null;
  rcProInsurance: string | null;
  businessCards: { url: string; label: string }[];
  isActive: boolean;
  // Signalé : "je ne sais pas comment on invite les membres de mon équipe,
  // j'ai voulu faire pour Philippe mais cela ne marche pas" — un membre
  // codé en dur dans TEAM_MEMBERS (photo/nom/agence de référence) s'affiche
  // toujours, MÊME si aucun compte réel (ligne `profiles`) n'existe encore
  // pour lui, avec les mêmes boutons "Renvoyer le lien"/"Désactiver l'accès"
  // qu'un membre déjà invité — qui échouent alors avec "Utilisateur non
  // trouvé" (aucune ligne `profiles` à cet id). Ce champ distingue les deux
  // cas pour adapter la fiche membre en conséquence.
  hasAccount: boolean;
}

// Ticket "Rôle Stagiaire" (phase 2, section 3/11) : durée de stage + statut
// — affichage indépendant du reste de la fiche (charge ses propres données,
// la RLS de intern_details limite déjà qui peut les lire : le stagiaire
// lui-même, son responsable, ou un super admin).
const InternStageCard: React.FC<{ userId: string; isSuperAdmin: boolean; currentUser: { getIdToken: () => Promise<string> } | null }> = ({
  userId,
  isSuperAdmin,
  currentUser,
}) => {
  const [loading, setLoading] = useState(true);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [editEndsAt, setEditEndsAt] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: role }, { data: details }] = await Promise.all([
      supabase.from('user_roles').select('expires_at').eq('user_id', userId).eq('role', 'intern').maybeSingle(),
      supabase.from('intern_details').select('starts_at').eq('user_id', userId).maybeSingle(),
    ]);
    setEndsAt((role as any)?.expires_at || null);
    setStartsAt((details as any)?.starts_at || null);
    setEditEndsAt((role as any)?.expires_at ? String((role as any).expires_at).slice(0, 10) : '');
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const now = Date.now();
  const endsAtMs = endsAt ? new Date(endsAt).getTime() : null;
  const status: { label: string; dot: string } | null =
    endsAtMs === null
      ? null
      : endsAtMs < now
      ? { label: 'Terminé', dot: '⚫' }
      : endsAtMs - now < 7 * 86400_000
      ? { label: 'Bientôt terminé', dot: '🟠' }
      : { label: 'Actif', dot: '🟢' };

  const extend = async () => {
    if (!currentUser || !editEndsAt) return;
    setSaving(true);
    try {
      const token = await currentUser.getIdToken();
      // Fusionné dans .../access (PATCH) — limite de 12 fonctions serverless
      // du plan Vercel Hobby, cf. commentaire dans api/admin/users/[id]/access.ts.
      const res = await fetch(`/api/admin/users/${userId}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ internEndsAt: editEndsAt }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Erreur');
      await load();
      setEditing(false);
    } catch (err) {
      console.error('Erreur prolongation stage :', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="p-3 rounded-xl bg-[#F7BC5F]/5 border border-[#F7BC5F]/20 space-y-2">
      <div className="flex items-center gap-2 text-xs font-bold text-[#F9C977]">
        <GraduationCap className="w-3.5 h-3.5" /> Stage
        {status && <span className="ml-auto text-[11px] font-semibold text-slate-300">{status.dot} {status.label}</span>}
      </div>
      {startsAt && endsAt && !editing && (
        <p className="text-xs text-slate-300 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-[#F7BC5F]" />
          Du {new Date(startsAt).toLocaleDateString('fr-FR')} au {new Date(endsAt).toLocaleDateString('fr-FR')}
        </p>
      )}
      {isSuperAdmin && (
        editing ? (
          <div className="flex items-center gap-2 pt-1">
            <input
              type="date"
              value={editEndsAt}
              onChange={(e) => setEditEndsAt(e.target.value)}
              className="flex-1 bg-[#021316] border border-[#1b484d] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
            />
            <button onClick={() => void extend()} disabled={saving} className="px-3 py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 text-xs font-bold">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'OK'}
            </button>
            <button onClick={() => setEditing(false)} className="px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white">Annuler</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-[11px] font-bold text-[#F7BC5F] hover:text-[#F9C977]">
            Prolonger le stage
          </button>
        )
      )}
    </div>
  );
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

interface EditForm {
  fullName: string;
  email: string;
  jobTitle: string;
  phone: string;
  rsacNumber: string;
  rcProInsurance: string;
  // Demandé (30/08/2026) : "il faut vraiment que cela soit complet... une
  // carte visite digitale, c'est-à-dire un lien URL" — le champ existait
  // déjà côté lecture (businessCards affichées sur la fiche, voir plus bas)
  // et en base (colonne `business_cards`), mais aucune UI ne permettait
  // d'en AJOUTER un depuis cette fiche membre.
  businessCards: { url: string; label: string }[];
}

// Signalé : "dans les membres, je ne peux pas tout modifier" — le formulaire
// n'exposait que poste/téléphone/RSAC/RC Pro, jamais le nom ni l'e-mail
// affichés juste au-dessus dans la même fiche.
const EMPTY_EDIT: EditForm = { fullName: '', email: '', jobTitle: '', phone: '', rsacNumber: '', rcProInsurance: '', businessCards: [] };

export const EquipeView: React.FC<EquipeViewProps> = ({ onNavigate, onComposeMail, onOpenContact }) => {
  const { userProfile, currentUser, activeAgency } = useAuth();
  const isSuperAdmin = userProfile?.role === 'super_admin';

  // Ticket "Clients invités" (4/13) : nouvel onglet à côté de l'annuaire.
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (10/16) : troisième
  // onglet "Gestion des utilisateurs" — centralise ici ce qui vivait avant
  // dans Paramètres > Utilisateurs (retiré de Paramètres, cf. ce fichier
  // plus bas et ParametresView.tsx).
  const [view, setView] = useState<'membres' | 'clients-invites'>('membres');
  // "Inviter un stagiaire" bascule sur ce nouvel onglet ET pré-ouvre la
  // modale avec le rôle "Stagiaire" déjà sélectionné (remplace l'ancienne
  // navigation vers Paramètres via onInviteIntern).
  const [pendingInviteRole, setPendingInviteRole] = useState<'commercial' | 'intern' | null>(null);

  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [rolesById, setRolesById] = useState<Record<string, string>>({});
  const [agenciesById, setAgenciesById] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  // Signalé (9 septembre, Sylvain — Natacha ne reçoit pas ses notifications
  // sur son téléphone) : « peut-être mettre des trackers pour voir si cette
  // option est activée ». Rien ne permettait jusqu'ici de le voir depuis
  // l'appli (RLS restreint push_subscriptions à son propriétaire) — visible
  // uniquement pour un super admin, via une RPC dédiée qui n'expose que le
  // nombre d'appareils/le user-agent, jamais les clés de souscription.
  const [pushStatusById, setPushStatusById] = useState<
    Record<string, { deviceCount: number; lastUpdated: string | null; userAgents: string[] }>
  >({});

  const [search, setSearch] = useState('');
  const [agencyFilter, setAgencyFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT);
  // Saisie transitoire de la carte de visite en cours d'ajout (label + URL),
  // vidée à chaque ajout réussi — voir le formulaire dans la fiche membre.
  const [newCardLabel, setNewCardLabel] = useState('');
  const [newCardUrl, setNewCardUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [directoryReloadKey, setDirectoryReloadKey] = useState(0);
  const [showInviteCollabModal, setShowInviteCollabModal] = useState(false);
  // Signalé : membre de TEAM_MEMBERS sans compte réel (voir `hasAccount`
  // sur DirectoryMember) — "Inviter ce collaborateur" depuis sa fiche
  // pré-remplit ce même formulaire avec ses infos déjà connues (nom,
  // e-mail, téléphone, agence), pour ne pas les retaper.
  const [inviteFromMember, setInviteFromMember] = useState<DirectoryMember | null>(null);
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (11/16) : suppression
  // DÉFINITIVE d'un stagiaire, distincte de la désactivation.
  const [deleteInternModal, setDeleteInternModal] = useState<{ userId: string; name: string } | null>(null);
  const [deleteInternConfirmText, setDeleteInternConfirmText] = useState('');
  const [deleteInternReassignTo, setDeleteInternReassignTo] = useState('');
  const [deleteInternOwnedCount, setDeleteInternOwnedCount] = useState<number | null>(null);
  const [deleteInternBusy, setDeleteInternBusy] = useState(false);

  // Charge le vrai annuaire depuis Supabase (profils + rôles + agences).
  // TEAM_MEMBERS reste la liste de référence des comptes connus (nom, id,
  // agence, photo) — toujours disponible même si un champ Supabase manque —
  // ce chargement vient enrichir chaque fiche avec les vraies données
  // (téléphone, poste, RSAC, assurance RC Pro, cartes de visite).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: profiles }, { data: roleRows }, { data: memberRows }] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url, phone, job_title, business_cards, rsac_number, rc_pro_insurance, is_active'),
          supabase.from('user_roles').select('user_id, role'),
          supabase.from('agency_members').select('user_id, agency_id'),
        ]);
        if (cancelled) return;

        const profileMap: Record<string, ProfileRow> = {};
        (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });
        setProfilesById(profileMap);

        const roleMap: Record<string, string> = {};
        (roleRows || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
        setRolesById(roleMap);

        const agencyMap: Record<string, string[]> = {};
        (memberRows || []).forEach((m: any) => { (agencyMap[m.user_id] ||= []).push(m.agency_id); });
        setAgenciesById(agencyMap);
      } catch (err) {
        console.warn('Erreur chargement annuaire équipe :', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [directoryReloadKey]);

  useEffect(() => {
    if (!isSuperAdmin || !activeAgency?.id) { setPushStatusById({}); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_team_push_status', { _agency_id: activeAgency.id });
      if (cancelled) return;
      if (error) { console.warn('Erreur chargement statut notifications push :', error); return; }
      const map: Record<string, { deviceCount: number; lastUpdated: string | null; userAgents: string[] }> = {};
      (data || []).forEach((row: any) => {
        map[row.user_id] = {
          deviceCount: row.device_count,
          lastUpdated: row.last_updated,
          userAgents: row.user_agents || [],
        };
      });
      setPushStatusById(map);
    })();
    return () => { cancelled = true; };
  }, [isSuperAdmin, activeAgency?.id, directoryReloadKey]);

  // Reconnaît, très grossièrement, un user-agent mobile — pour repérer d'un
  // coup d'œil un membre dont TOUS les appareils inscrits sont des
  // ordinateurs (cas exact de Natacha : une seule souscription, Windows).
  const isMobileUserAgent = (ua: string) => /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

  const members: DirectoryMember[] = useMemo(() => {
    // Signalé : un membre de TEAM_MEMBERS invité APRÈS coup obtient un id
    // Supabase Auth généré par le serveur, jamais l'id codé en dur dans
    // TEAM_MEMBERS (l'API admin ne permet pas de choisir l'id à la
    // création) — sans ce rapprochement par e-mail, sa vraie ligne
    // `profiles` restait invisible pour cette fiche (toujours "aucun
    // compte"), tout en créant un second doublon plus bas via `extra`.
    const profilesByEmail: Record<string, ProfileRow> = {};
    Object.values(profilesById).forEach((p: any) => {
      if (p?.email) profilesByEmail[String(p.email).toLowerCase()] = p;
    });
    const usedProfileIds = new Set<string>();

    const fromTeamMembers = TEAM_MEMBERS.map((m) => {
      const byId = profilesById[m.id];
      const byEmail = !byId && m.email ? profilesByEmail[m.email.toLowerCase()] : undefined;
      const p = byId || byEmail;
      const realId = p?.id || m.id;
      if (p?.id) usedProfileIds.add(p.id);
      const agencyIds = agenciesById[realId]?.length ? agenciesById[realId] : [m.agencyId];
      return {
        id: realId,
        name: p?.full_name?.trim() || m.name,
        email: p?.email || m.email,
        jobTitle: p?.job_title?.trim() || m.role,
        dbRole: rolesById[realId] || 'commercial',
        agencyIds,
        avatarUrl: p?.avatar_url || m.avatarUrl || '',
        phone: p?.phone || m.phone || null,
        rsacNumber: p?.rsac_number || null,
        rcProInsurance: p?.rc_pro_insurance || null,
        businessCards: Array.isArray(p?.business_cards) ? p!.business_cards! : [],
        isActive: p?.is_active !== false,
        hasAccount: !!p,
      };
    });

    // Ticket "Inviter un collaborateur" (#166) : l'annuaire ne listait QUE
    // TEAM_MEMBERS (liste codée en dur) — un collaborateur fraîchement
    // invité (existant en base : profil + rôle) restait donc invisible ici
    // tant que personne n'éditait le code pour l'y ajouter. On complète
    // avec tout profil connu en base qui n'est pas déjà dans TEAM_MEMBERS,
    // sans toucher à la liste elle-même (le remplacement complet par un
    // annuaire 100% base de données est le chantier #150-165).
    const knownIds = new Set(TEAM_MEMBERS.map((m) => m.id));
    const extra: DirectoryMember[] = Object.keys(rolesById)
      .filter((id) => !knownIds.has(id) && !usedProfileIds.has(id) && rolesById[id] !== 'client_guest')
      .map((id) => {
        const p = profilesById[id];
        return {
          id,
          name: p?.full_name?.trim() || p?.email || 'Nouveau collaborateur',
          email: p?.email || '',
          jobTitle: p?.job_title?.trim() || '',
          dbRole: rolesById[id] || 'commercial',
          agencyIds: agenciesById[id] || [],
          avatarUrl: p?.avatar_url || '',
          phone: p?.phone || null,
          rsacNumber: p?.rsac_number || null,
          rcProInsurance: p?.rc_pro_insurance || null,
          businessCards: Array.isArray(p?.business_cards) ? p!.business_cards! : [],
          isActive: p?.is_active !== false,
          hasAccount: true,
        };
      });

    return [...fromTeamMembers, ...extra];
  }, [profilesById, rolesById, agenciesById]);

  const filtered = members.filter((m) => {
    if (agencyFilter !== 'all' && !m.agencyIds.includes(agencyFilter)) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.jobTitle.toLowerCase().includes(q) ||
      m.agencyIds.some((id) => AGENCIES.find((a) => a.id === id)?.name.toLowerCase().includes(q))
    );
  });

  const selected = members.find((m) => m.id === selectedId) || null;
  const canEdit = !!selected && (isSuperAdmin || selected.id === currentUser?.uid);

  // Demande explicite : depuis la fiche membre, pouvoir renvoyer le lien de
  // connexion et activer/désactiver l'accès — mêmes routes déjà utilisées
  // par l'onglet "Gestion des utilisateurs" (/api/admin/users/:id/invite et
  // .../access), réservées aux super admins comme là-bas.
  const [memberActionBusy, setMemberActionBusy] = useState<'invite' | 'toggle' | null>(null);

  const callAdminApi = async (url: string, options: RequestInit = {}) => {
    if (!currentUser) throw new Error('Utilisateur non authentifié.');
    const token = await currentUser.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `Erreur HTTP ${response.status}`);
    return body;
  };

  const resendMemberLink = async () => {
    if (!selected) return;
    setMemberActionBusy('invite');
    try {
      const result = await callAdminApi(`/api/admin/users/${selected.id}/invite`, { method: 'POST' });
      if (result?.emailSent === false) {
        toast.error(result?.emailError || "L'e-mail n'a pas pu être envoyé.");
      } else {
        toast.success('Lien de connexion renvoyé avec succès.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de renvoyer le lien.');
    } finally {
      setMemberActionBusy(null);
    }
  };

  const toggleMemberActive = async () => {
    if (!selected) return;
    const nextActive = !selected.isActive;
    setMemberActionBusy('toggle');
    try {
      await callAdminApi(`/api/admin/users/${selected.id}/access`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: nextActive }),
      });
      setProfilesById((cur) => ({
        ...cur,
        [selected.id]: { ...(cur[selected.id] || {}), is_active: nextActive } as ProfileRow,
      }));
      toast.success(nextActive ? 'Accès réactivé.' : 'Accès désactivé.');
    } catch (err: any) {
      toast.error(err?.message || "Impossible de modifier l'accès.");
    } finally {
      setMemberActionBusy(null);
    }
  };

  // Demande explicite : depuis la fiche membre, pouvoir choisir aussi le
  // rôle ET les agences du membre (le sélecteur d'agences s'affiche en
  // fonction du rôle choisi, même principe que "Gestion des utilisateurs" /
  // InviteCollaboratorModal). Formulaire local, réinitialisé à chaque
  // ouverture de fiche pour repartir des vraies valeurs enregistrées.
  const [accessForm, setAccessForm] = useState<{ role: string; agencyIds: string[] } | null>(null);
  const [savingAccess, setSavingAccess] = useState(false);

  useEffect(() => {
    if (selected) {
      setAccessForm({ role: selected.dbRole, agencyIds: selected.agencyIds });
    } else {
      setAccessForm(null);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMemberAccess = async () => {
    if (!selected || !accessForm) return;
    if (accessForm.agencyIds.length === 0) {
      toast.error('Sélectionnez au moins une agence.');
      return;
    }
    setSavingAccess(true);
    try {
      await callAdminApi(`/api/admin/users/${selected.id}/access`, {
        method: 'PUT',
        body: JSON.stringify({ role: accessForm.role, agencyIds: accessForm.agencyIds }),
      });
      setRolesById((cur) => ({ ...cur, [selected.id]: accessForm.role }));
      setAgenciesById((cur) => ({ ...cur, [selected.id]: accessForm.agencyIds }));
      toast.success('Rôle et agences mis à jour.');
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de mettre à jour le rôle/les agences.');
    } finally {
      setSavingAccess(false);
    }
  };

  const closeModal = () => {
    setSelectedId(null);
    setEditing(false);
    setSaveError(null);
  };

  const openEdit = () => {
    if (!selected) return;
    setEditForm({
      fullName: selected.name || '',
      email: selected.email || '',
      jobTitle: selected.jobTitle || '',
      phone: selected.phone || '',
      rsacNumber: selected.rsacNumber || '',
      rcProInsurance: selected.rcProInsurance || '',
      businessCards: selected.businessCards || [],
    });
    setNewCardLabel('');
    setNewCardUrl('');
    setSaveError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const fullName = editForm.fullName.trim();
      const email = editForm.email.trim().toLowerCase();
      if (!fullName) throw new Error('Le nom est obligatoire.');
      if (!email) throw new Error("L'e-mail est obligatoire.");
      const payload = {
        full_name: fullName,
        email,
        job_title: editForm.jobTitle.trim() || null,
        phone: editForm.phone.trim() || null,
        rsac_number: editForm.rsacNumber.trim() || null,
        rc_pro_insurance: editForm.rcProInsurance.trim() || null,
        business_cards: editForm.businessCards.length > 0 ? editForm.businessCards : null,
        updated_at: new Date().toISOString(),
      };
      const { data: updatedRows, error } = await supabase.from('profiles').update(payload).eq('id', selected.id).select('id');
      if (error) throw error;
      // Signalé : pour un membre codé en dur dans TEAM_MEMBERS mais jamais
      // réellement invité (aucune ligne `profiles`), cette mise à jour
      // touchait silencieusement 0 ligne — la fiche affichait quand même
      // "enregistré" alors que rien n'avait été persisté nulle part.
      if (!updatedRows || updatedRows.length === 0) throw new Error("Ce membre n'a pas encore de compte réel — invitez-le d'abord (bouton \"Inviter ce collaborateur\") avant de modifier sa fiche.");
      setProfilesById((cur) => ({
        ...cur,
        [selected.id]: { ...cur[selected.id], id: selected.id, ...payload },
      }));
      setEditing(false);
    } catch (err: any) {
      setSaveError(err?.message || 'Erreur lors de l\'enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (11/16) : suppression
  // DÉFINITIVE d'un stagiaire — détecte d'abord les fiches clients qui lui
  // sont assignées ; si `reassignTo` n'est pas encore choisi, le serveur ne
  // supprime rien et renvoie `needsReassignment` pour afficher le sélecteur.
  const runDeleteIntern = async () => {
    if (!deleteInternModal || !currentUser || deleteInternConfirmText !== 'SUPPRIMER') return;
    setDeleteInternBusy(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`/api/admin/users/${deleteInternModal.userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          permanent: true,
          confirmWord: deleteInternConfirmText,
          reassignTo: deleteInternReassignTo || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Erreur.');

      if (body.needsReassignment) {
        setDeleteInternOwnedCount(body.ownedLeadsCount || 0);
        return;
      }

      toast.success(`${deleteInternModal.name} supprimé définitivement${body.reassignedCount ? ` — ${body.reassignedCount} fiche(s) client réattribuée(s)` : ''}.`);
      setDeleteInternModal(null);
      setDeleteInternConfirmText('');
      setDeleteInternReassignTo('');
      setDeleteInternOwnedCount(null);
      setSelectedId(null);
      setDirectoryReloadKey((k) => k + 1);
    } catch (err: any) {
      toast.error(err?.message || 'Suppression impossible.');
    } finally {
      setDeleteInternBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[#051416]">
      {/* Signalé (30/08/2026, capture à l'appui, à deux reprises) : "c'est
          fou que tu bordes les côtés... tu restreins les images" — ce
          conteneur plafonnait toute la page à max-w-3xl (768px), un reste
          de l'ancienne liste verticale simple d'avant la grille. Un premier
          passage à max-w-7xl (aligné sur ProjetsInternes.tsx/
          DocumentsView.tsx/SupportView.tsx) restait encore trop étroit sur
          un grand écran (toujours un vide visible à droite, capture à
          l'appui) — plafond retiré complètement ici : la grille (3 colonnes
          fixes, voir plus bas) s'étale sur toute la largeur réellement
          disponible, les cartes grandissent avec l'écran plutôt que de
          rester figées à une taille de conteneur arbitraire. */}
      <div className="p-4 sm:p-6 space-y-4">
        {/* En-tête (30/08/2026, capture à l'appui) : "réorganise cela en
            haut... mets tout sur une ligne" — titre, onglets Membres/Clients
            invités et boutons Inviter tenaient chacun leur propre ligne
            (4 lignes empilées), gaspillant beaucoup de hauteur sur
            ordinateur. Repassés sur UNE seule ligne à partir de `lg:`
            (l'empilement vertical reste sur mobile/tablette, où une seule
            ligne ne tiendrait pas). Suite ("il y a deux barres de
            recherches, supprime celle que tu vois sur la photo") : la barre
            de recherche dédiée à cette page (ci-dessous auparavant) faisait
            doublon avec la barre globale tout en haut de l'appli — retirée. */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAgencyFilter(agencyFilter)}
              className="w-11 h-11 rounded-2xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 flex items-center justify-center shrink-0 pointer-events-none"
            >
              <Users className="w-5 h-5 text-[#F7BC5F]" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold text-white truncate">Équipe</h1>
              <p className="text-xs text-slate-400">Annuaire complet · {members.length} membres</p>
            </div>
            {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin shrink-0" />}
          </div>

          {isSuperAdmin && (
            <div className="flex gap-1.5 bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-1 w-fit shrink-0">
              <button
                onClick={() => setView('membres')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${view === 'membres' ? 'bg-[#F7BC5F] text-slate-950' : 'text-slate-400 hover:text-white'}`}
              >
                Membres
              </button>
              <button
                onClick={() => setView('clients-invites')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${view === 'clients-invites' ? 'bg-[#F7BC5F] text-slate-950' : 'text-slate-400 hover:text-white'}`}
              >
                Clients invités
              </button>
            </div>
          )}

          {/* Boutons "Inviter" remontés ici (même ligne, ordinateur) —
              inchangés sinon : toujours réservés à la vue "Membres" et aux
              super_admin, voir la même condition sur leur ancien
              emplacement plus bas dans le JSX. */}
          {isSuperAdmin && view !== 'clients-invites' && (
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                onClick={() => setShowInviteCollabModal(true)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white/5 border border-[#F7BC5F]/40 hover:bg-white/10 text-[#F9C977] font-black text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <UserPlus className="w-4 h-4" /> Inviter un collaborateur
              </button>
              <button
                onClick={() => { setPendingInviteRole('intern'); setShowInviteCollabModal(true); }}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <GraduationCap className="w-4 h-4" /> Inviter un stagiaire
              </button>
            </div>
          )}
        </div>

        {/* Ticket #229 : rubrique "Gestion des utilisateurs" retirée
            (doublon avec "Membres") — tout ce qu'elle proposait (rôle,
            agences, activation/désactivation, renvoi du lien de connexion,
            suppression définitive) est désormais géré directement depuis la
            fiche d'un membre ci-dessous (déjà câblé : accessForm,
            resendMemberLink, toggleMemberActive, deleteInternModal), sans
            perte de fonctionnalité ni changement de route API. */}
        {view === 'clients-invites' ? (
          <ClientsInvitesPanel onNavigate={onNavigate} onOpenContact={onOpenContact} />
        ) : (
        <>
        {/* Boutons "Inviter" retirés d'ici (30/08/2026) — voir plus haut dans
            le JSX, ils rejoignent désormais la ligne d'en-tête (ordinateur).
            Recherche : retirée, remise, puis retirée à nouveau (même
            session, demande explicite à chaque fois) — `search`/`setSearch`
            laissés tels quels ailleurs dans ce fichier (chaîne vide en
            permanence désormais, le filtre plus bas continue de fonctionner
            normalement, juste sans saisie possible). */}

        {/* Filtre agence */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setAgencyFilter('all')}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
              agencyFilter === 'all' ? 'bg-[#F7BC5F] text-slate-950' : 'bg-[#0a1e20] border border-[#144447]/60 text-slate-300'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" /> Toutes les agences
          </button>
          {AGENCIES.filter((a) => a.id !== 'all').map((a) => (
            <button
              key={a.id}
              onClick={() => setAgencyFilter(a.id)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                agencyFilter === a.id ? 'text-slate-950' : 'bg-[#0a1e20] border border-[#144447]/60 text-slate-300'
              }`}
              style={agencyFilter === a.id ? { background: a.color } : undefined}
            >
              {a.name}
            </button>
          ))}
        </div>

        {/* Liste des membres (30/08/2026) : "des carrés avec le liseret
            autour... cinq collaborateurs par ligne" — grille de tuiles
            compactes (liseret + centrées) plutôt que la liste empilée en
            pleine largeur d'origine.
            Revu (30/08/2026, capture à l'appui, "complètement illisible") :
            la fiche montrait aussi le poste + jusqu'à 3 badges d'agence +
            super_admin/désactivé empilés dessous — trop de contenu pour la
            largeur d'une tuile, le nom lui-même finissait tronqué ("Sylv...").
            Épuré à l'essentiel demandé explicitement : logo + nom prénom
            SEULEMENT, plus rien d'autre (le sélecteur d'agence tout en haut
            fait déjà cette distinction). `truncate` retiré sur le nom — il
            passe à la ligne plutôt que d'être coupé.
            Revu (30/08/2026, capture "fais comme cela c'est beaucoup mieux") :
            6 colonnes serrées ne réglait pas le vrai problème ("tu restreins
            les images") — la place gagnée en largeur de conteneur doit
            profiter aux CARTES elles-mêmes, pas être redécoupée en toujours
            plus de petites colonnes. Passage à 3 colonnes + conteneur plein
            largeur (voir plus haut, max-w retiré), validé par l'utilisateur.
            Revu à nouveau (30/08/2026, "réduit pour en mettre 5 par ligne") :
            demande explicite de 5 colonnes désormais que la largeur de page
            est correcte — avatars/cartes réduits en conséquence (mais pas
            revenus à la taille "illisible" du passage à 6 colonnes, dont le
            vrai problème était le contenu en trop, déjà réglé au-dessus). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-6">
          {filtered.length === 0 && (
            <p className="col-span-full text-center text-sm text-slate-500 py-10">Aucun membre ne correspond à cette recherche.</p>
          )}
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className="rounded-2xl border-2 border-[#1c4448] bg-[#0a1e20] p-4 lg:p-5 flex flex-col items-center text-center gap-2 hover:border-[#F7BC5F]/60 transition-colors"
            >
              <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-full overflow-hidden border-2 border-[#F7BC5F]/60 shrink-0 bg-black/30 flex items-center justify-center text-white font-bold text-2xl">
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(m.name)
                )}
              </div>
              <p className="font-bold text-white text-base lg:text-lg leading-tight w-full">{m.name}</p>
            </button>
          ))}
        </div>
        </>
        )}
      </div>

      {/* Fiche membre */}
      {selected && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={closeModal}
        >
          {/* Ticket (nouvelle base, signalé) : sur mobile, le bouton
              "Envoyer un mail" se retrouvait à moitié caché derrière la
              barre de navigation basse (z-index insuffisant + pas de marge
              réservée pour elle). */}
          <div
            className="w-full sm:max-w-xl bg-[#0a1e20] border border-[#144447]/60 sm:rounded-3xl rounded-t-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6 max-h-[90vh] overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">Fiche membre</h2>
              <div className="flex items-center gap-2">
                {canEdit && !editing && (
                  <button
                    onClick={openEdit}
                    className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-slate-200 flex items-center gap-1.5 hover:bg-white/10"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Modifier
                  </button>
                )}
                <button onClick={closeModal} className="p-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 mb-5">
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[#F7BC5F]/60 shrink-0 bg-black/30 flex items-center justify-center text-white font-bold text-xl">
                {selected.avatarUrl ? (
                  <img src={selected.avatarUrl} alt={selected.name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(selected.name)
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-white truncate">{selected.name}</p>
                <p className="text-sm text-slate-400 truncate">{selected.jobTitle}</p>
              </div>
            </div>

            {editing ? (
              <div className="space-y-3">
                {/* Demandé (30/08/2026) : "éviter de scroller sur
                    l'ordinateur... simple, rapide, efficace" — les 6 champs
                    passent de 6 lignes empilées à 2 colonnes sur desktop,
                    pour tenir dans la hauteur du modal (max-h-[90vh] déjà en
                    place ci-dessus) sans avoir à défiler. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-400">Nom complet</span>
                  <input
                    value={editForm.fullName}
                    onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-400">E-mail</span>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-400">Poste / fonction</span>
                  <input
                    value={editForm.jobTitle}
                    onChange={(e) => setEditForm((f) => ({ ...f, jobTitle: e.target.value }))}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-400">Téléphone</span>
                  <input
                    value={editForm.phone}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-400">RSAC</span>
                  <input
                    value={editForm.rsacNumber}
                    onChange={(e) => setEditForm((f) => ({ ...f, rsacNumber: e.target.value }))}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-400">Assurance RC Pro</span>
                  <input
                    value={editForm.rcProInsurance}
                    onChange={(e) => setEditForm((f) => ({ ...f, rcProInsurance: e.target.value }))}
                    className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                </label>
                </div>

                {/* Demandé (30/08/2026) : "rajouter une carte visite
                    digitale, c'est-à-dire un lien URL" — colonne
                    `business_cards` (JSON) déjà lue et affichée en mode
                    consultation (voir plus bas), jamais éditable jusqu'ici.
                    Plusieurs cartes possibles (LinkedIn, site perso...). */}
                <div className="space-y-2 pt-1">
                  <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                    <IdCard className="w-3.5 h-3.5" /> Cartes de visite digitales
                  </span>
                  {editForm.businessCards.length > 0 && (
                    <div className="space-y-1.5">
                      {editForm.businessCards.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#1b484d] bg-[#021316]">
                          <IdCard className="w-3.5 h-3.5 text-[#F9C977] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate">{c.label}</p>
                            <p className="text-[10px] text-slate-500 truncate">{c.url}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditForm((f) => ({ ...f, businessCards: f.businessCards.filter((_, idx) => idx !== i) }))}
                            className="text-slate-400 hover:text-rose-300 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={newCardLabel}
                      onChange={(e) => setNewCardLabel(e.target.value)}
                      placeholder="Nom (ex : LinkedIn)"
                      className="flex-1 min-w-0 bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                    />
                    <input
                      value={newCardUrl}
                      onChange={(e) => setNewCardUrl(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 min-w-0 bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const label = newCardLabel.trim();
                        const url = newCardUrl.trim();
                        if (!label || !url) return;
                        setEditForm((f) => ({ ...f, businessCards: [...f.businessCards, { label, url }] }));
                        setNewCardLabel('');
                        setNewCardUrl('');
                      }}
                      disabled={!newCardLabel.trim() || !newCardUrl.trim()}
                      className="px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white disabled:opacity-40 shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {saveError && <p className="text-xs text-rose-400">{saveError}</p>}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setEditing(false)}
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-slate-200"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 text-sm font-black flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                  <span className="text-white text-sm truncate">{selected.email}</span>
                  <span className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-slate-400">
                    défaut
                  </span>
                </div>
                {selected.phone && (
                  <div className="flex items-center gap-3">
                    <PhoneIcon className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <span className="text-white text-sm">{selected.phone}</span>
                  </div>
                )}
                {selected.jobTitle && (
                  <div className="flex items-center gap-3">
                    <Briefcase className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <span className="text-white text-sm">{selected.jobTitle}</span>
                  </div>
                )}
                {selected.rsacNumber && (
                  <div className="flex items-center gap-3">
                    <IdCard className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <span className="text-white text-sm">RSAC : {selected.rsacNumber}</span>
                  </div>
                )}
                {selected.rcProInsurance && (
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-4 h-4 text-[#F7BC5F] shrink-0" />
                    <span className="text-white text-sm">Assurance RC Pro : {selected.rcProInsurance}</span>
                  </div>
                )}

                {/* Signalé (9 septembre) : « Natacha ne reçoit pas ses
                    notifications sur son téléphone, peut-être mettre des
                    trackers pour voir si cette option est activée » — seul
                    moyen jusqu'ici de le vérifier : interroger la base à la
                    main. Visible uniquement pour un super admin (voir
                    get_team_push_status, RPC dédiée qui n'expose que le
                    nombre d'appareils/le user-agent, jamais les clés de
                    souscription). */}
                {isSuperAdmin && (() => {
                  const status = pushStatusById[selected.id];
                  const hasMobile = !!status?.userAgents.some(isMobileUserAgent);
                  return (
                    <div className={`flex items-start gap-3 p-3 rounded-xl border ${
                      status && status.deviceCount > 0
                        ? hasMobile
                          ? 'bg-emerald-500/10 border-emerald-500/25'
                          : 'bg-amber-500/10 border-amber-500/25'
                        : 'bg-red-500/10 border-red-500/25'
                    }`}>
                      {status && status.deviceCount > 0 ? (
                        <Bell className={`w-4 h-4 shrink-0 mt-0.5 ${hasMobile ? 'text-emerald-400' : 'text-amber-400'}`} />
                      ) : (
                        <BellOff className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white">
                          {!status || status.deviceCount === 0
                            ? 'Notifications push : jamais activées'
                            : `Notifications push : ${status.deviceCount} appareil${status.deviceCount > 1 ? 's' : ''}${!hasMobile ? ' — aucun mobile' : ''}`}
                        </p>
                        {status && status.deviceCount > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {status.userAgents.map((ua, i) => (
                              <p key={i} className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                {isMobileUserAgent(ua) ? (
                                  <Smartphone className="w-3 h-3 shrink-0" />
                                ) : (
                                  <Monitor className="w-3 h-3 shrink-0" />
                                )}
                                <span className="truncate">{ua}</span>
                              </p>
                            ))}
                            {status.lastUpdated && (
                              <p className="text-[10px] text-slate-500">
                                Dernière activité : {new Date(status.lastUpdated).toLocaleString('fr-FR')}
                              </p>
                            )}
                          </div>
                        )}
                        {(!status || !hasMobile) && (
                          <p className="text-[11px] text-slate-400 mt-1">
                            {!status || status.deviceCount === 0
                              ? "Ce membre n'a jamais accepté les notifications, sur aucun appareil."
                              : "Aucun téléphone n'a activé les notifications — seulement un ordinateur. Sur le téléphone : Rappels & Alertes → \"Activer les alertes\"."}
                          </p>
                        )}
                        {/* Audit (9 septembre) : un iPhone abonné (présent ci-dessus,
                            envois acceptés côté serveur) ne reçoit RIEN si Safari
                            n'a pas été utilisé en mode "écran d'accueil" — une
                            restriction propre à iOS, invisible depuis les logs
                            serveur. C'est la cause la plus probable pour un membre
                            qui a un iPhone dans la liste ci-dessus mais dit ne rien
                            recevoir. */}
                        {status && status.userAgents.some((ua) => /iPhone|iPad/i.test(ua)) && (
                          <p className="text-[11px] text-amber-300/90 mt-1.5 flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>
                              iPhone détecté : si rien n'arrive malgré un abonnement actif, vérifier que
                              Nova CRM a bien été ajouté à l'écran d'accueil (Safari → Partager → « Sur
                              l'écran d'accueil ») — sur iOS, un onglet/favori Safari ne reçoit jamais
                              de notification, même acceptée par Apple côté serveur.
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {selected.dbRole === 'intern' && (
                  <InternStageCard userId={selected.id} isSuperAdmin={isSuperAdmin} currentUser={currentUser} />
                )}

                {/* Ticket #227 : suppression définitive (poubelle) disponible
                    pour tous les rôles, pas seulement les stagiaires. */}
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      const sylvain = members.find((m) =>
                        m.id === '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29' ||
                        m.email?.toLowerCase() === 's.grazia@conseilfinances.fr' ||
                        (m.name.toLowerCase().includes('sylvain') && m.name.toLowerCase().includes('grazia'))
                      );
                      setDeleteInternModal({ userId: selected.id, name: selected.name });
                      setDeleteInternConfirmText('');
                      setDeleteInternReassignTo(sylvain && sylvain.id !== selected.id ? sylvain.id : '');
                      setDeleteInternOwnedCount(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 text-xs font-bold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Supprimer définitivement cet utilisateur
                  </button>
                )}

                {selected.businessCards.length > 0 && (
                  <div className="pt-3">
                    <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                      <IdCard className="w-3.5 h-3.5" /> Cartes de visite digitales
                    </p>
                    <div className="space-y-2">
                      {selected.businessCards.map((c, i) => (
                        <a
                          key={i}
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between px-4 py-3 rounded-xl border border-[#144447]/60 bg-black/20 text-[#F9C977] text-sm font-semibold hover:bg-black/30"
                        >
                          {c.label}
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 space-y-2">
                  <button
                    onClick={() => onComposeMail?.(selected.email)}
                    className="w-full px-4 py-3 rounded-xl border border-[#144447]/60 bg-black/20 text-slate-200 font-bold text-sm flex items-center justify-center gap-2 hover:bg-black/30"
                  >
                    <Mail className="w-4 h-4" /> Envoyer un mail
                  </button>
                  <button
                    onClick={() => { onNavigate?.('chat'); closeModal(); }}
                    className="w-full px-4 py-3 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-sm flex items-center justify-center gap-2"
                  >
                    <MessageSquare className="w-4 h-4" /> Envoyer un message
                  </button>

                  {/* Signalé : "je ne sais pas comment on invite les
                      membres de mon équipe, j'ai voulu faire pour Philippe
                      mais cela ne marche pas" — un membre de TEAM_MEMBERS
                      sans compte réel affichait "Renvoyer le lien de
                      connexion"/"Désactiver l'accès" comme s'il en avait
                      déjà un, ce qui échouait avec "Utilisateur non
                      trouvé". Chemin clair vers l'invitation à la place. */}
                  {isSuperAdmin && !selected.hasAccount && (
                    <div className="pt-3 mt-1 border-t border-[#144447]/60 space-y-2.5">
                      <p className="text-xs text-slate-400">
                        Ce collaborateur n'a pas encore de compte de connexion — invitez-le pour lui donner accès au CRM.
                      </p>
                      <button
                        onClick={() => { setInviteFromMember(selected); closeModal(); }}
                        className="w-full px-4 py-3 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-sm flex items-center justify-center gap-2"
                      >
                        <UserPlus className="w-4 h-4" /> Inviter ce collaborateur
                      </button>
                    </div>
                  )}

                  {/* Demande explicite : pouvoir choisir aussi le rôle et
                      l'agence du membre directement depuis sa fiche — le
                      sélecteur d'agences reste disponible quel que soit le
                      rôle choisi (un super admin peut aussi être rattaché à
                      une seule agence par défaut, comme "Gestion des
                      utilisateurs" le permet déjà). */}
                  {isSuperAdmin && selected.hasAccount && accessForm && (
                    <div className="pt-2 pb-1 space-y-2.5 border-t border-[#144447]/60 mt-1">
                      <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider pt-3">
                        Rôle & agences
                      </p>
                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-400">Rôle</span>
                        <select
                          value={accessForm.role}
                          onChange={(e) => setAccessForm((f) => (f ? { ...f, role: e.target.value } : f))}
                          className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                        >
                          <option value="commercial">Commercial</option>
                          <option value="intern">Stagiaire</option>
                          <option value="super_admin">Super admin</option>
                        </select>
                      </label>
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-400">Agences</span>
                        <div className="flex flex-wrap gap-1.5">
                          {AGENCIES.filter((a) => a.id !== 'all').map((a) => {
                            const checked = accessForm.agencyIds.includes(a.id);
                            return (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() =>
                                  setAccessForm((f) =>
                                    f
                                      ? {
                                          ...f,
                                          agencyIds: checked
                                            ? f.agencyIds.filter((id) => id !== a.id)
                                            : [...f.agencyIds, a.id],
                                        }
                                      : f
                                  )
                                }
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                  checked
                                    ? 'bg-[#F7BC5F]/20 border-[#F7BC5F] text-[#F7BC5F]'
                                    : 'bg-white/5 border-white/10 text-slate-300 hover:border-white/30'
                                }`}
                              >
                                {a.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        disabled={savingAccess}
                        onClick={() => void saveMemberAccess()}
                        className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 hover:bg-white/10 disabled:opacity-50"
                      >
                        {savingAccess ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Enregistrer le rôle et les agences
                      </button>
                    </div>
                  )}

                  {/* Demande explicite : renvoyer le lien de connexion et
                      activer/désactiver l'accès directement depuis la fiche
                      membre — réservé aux super admins, même règle que les
                      routes serveur appelées. */}
                  {isSuperAdmin && selected.hasAccount && (
                    <>
                      <button
                        disabled={memberActionBusy !== null}
                        onClick={() => void resendMemberLink()}
                        className="w-full px-4 py-3 rounded-xl border border-[#144447]/60 bg-black/20 text-slate-200 font-bold text-sm flex items-center justify-center gap-2 hover:bg-black/30 disabled:opacity-50"
                      >
                        {memberActionBusy === 'invite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Renvoyer le lien de connexion
                      </button>
                      {selected.id !== currentUser?.uid && (
                        <button
                          disabled={memberActionBusy !== null}
                          onClick={() => {
                            const label = selected.isActive ? 'désactiver' : 'réactiver';
                            if (confirm(`Confirmer : ${label} l'accès de ${selected.name} au CRM ?`)) void toggleMemberActive();
                          }}
                          className={`w-full px-4 py-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 ${
                            selected.isActive
                              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                          }`}
                        >
                          {memberActionBusy === 'toggle' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : selected.isActive ? (
                            <PowerOff className="w-4 h-4" />
                          ) : (
                            <Power className="w-4 h-4" />
                          )}
                          {selected.isActive ? "Désactiver l'accès" : "Réactiver l'accès"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {(showInviteCollabModal || inviteFromMember) && (
        <InviteCollaboratorModal
          members={members}
          initial={
            inviteFromMember
              ? {
                  name: inviteFromMember.name,
                  email: inviteFromMember.email,
                  phone: inviteFromMember.phone || '',
                  role: inviteFromMember.dbRole,
                  agencyId: inviteFromMember.agencyIds[0] || '',
                }
              : pendingInviteRole
                ? { name: '', email: '', phone: '', role: pendingInviteRole, agencyId: '' }
                : undefined
          }
          onClose={() => { setShowInviteCollabModal(false); setInviteFromMember(null); setPendingInviteRole(null); }}
          onInvited={() => { setShowInviteCollabModal(false); setInviteFromMember(null); setPendingInviteRole(null); setDirectoryReloadKey((k) => k + 1); }}
        />
      )}

      {deleteInternModal && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { if (!deleteInternBusy) setDeleteInternModal(null); }}>
          <div className="bg-[#0a1e20] border border-red-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">Suppression définitive</h3>
                <p className="text-xs text-slate-400 truncate">{deleteInternModal.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Action irréversible : compte de connexion, rôle et rattachements d'agence sont entièrement supprimés — impossible de se reconnecter. Distincte d'une simple désactivation (réversible, via le bouton Marche/Arrêt). L'historique existant (messages, notes, tâches...) reste visible, sous le nom "{deleteInternModal.name.split(/\s+/)[0] || 'Utilisateur'} off" au lieu de l'identité complète.
            </p>

            {deleteInternOwnedCount !== null && deleteInternOwnedCount > 0 && (
              <div className="space-y-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30">
                <p className="text-xs text-orange-200">
                  {deleteInternOwnedCount} fiche{deleteInternOwnedCount > 1 ? 's' : ''} client{deleteInternOwnedCount > 1 ? 's' : ''} lui {deleteInternOwnedCount > 1 ? 'sont' : 'est'} assignée{deleteInternOwnedCount > 1 ? 's' : ''}. Par défaut, elles seront réassignées à Sylvain GRAZIA.
                </p>
                <select
                  value={deleteInternReassignTo}
                  onChange={(e) => setDeleteInternReassignTo(e.target.value)}
                  className="w-full rounded-lg bg-[#071f21] border border-[#1c4448] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                >
                  <option value="">Choisir un repreneur...</option>
                  {members.filter((m) => m.id !== deleteInternModal.userId).map((m) => {
                    const isSylvain =
                      m.id === '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29' ||
                      m.email?.toLowerCase() === 's.grazia@conseilfinances.fr' ||
                      (m.name.toLowerCase().includes('sylvain') && m.name.toLowerCase().includes('grazia'));
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name} {isSylvain ? '★ (Par défaut)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="text-xs text-slate-300 font-semibold">Tapez <span className="text-red-300 font-mono">SUPPRIMER</span> pour confirmer</span>
              <input
                value={deleteInternConfirmText}
                onChange={(e) => setDeleteInternConfirmText(e.target.value)}
                placeholder="SUPPRIMER"
                className="w-full rounded-lg bg-[#071f21] border border-red-500/30 px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-400"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setDeleteInternModal(null)} disabled={deleteInternBusy} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold">
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void runDeleteIntern()}
                disabled={deleteInternBusy || deleteInternConfirmText !== 'SUPPRIMER' || (deleteInternOwnedCount !== null && deleteInternOwnedCount > 0 && !deleteInternReassignTo)}
                className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleteInternBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Ticket "Inviter un collaborateur" (#166) : formulaire dédié dans Équipe
// (jusqu'ici, "Inviter un stagiaire" ne faisait que rediriger vers
// Paramètres) — première brique du "user-management centralisé dans
// Équipe" prévu au chantier #150-165, ici limitée à la création.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const COLLAB_ROLES: { value: string; label: string }[] = [
  { value: 'commercial', label: 'Commercial / Conseiller' },
  { value: 'intern', label: 'Stagiaire' },
  { value: 'super_admin', label: 'Super admin' },
];

interface InviteCollaboratorInitial {
  name: string;
  email: string;
  phone: string;
  role: string;
  agencyId: string;
}

const InviteCollaboratorModal: React.FC<{ onClose: () => void; onInvited: () => void; initial?: InviteCollaboratorInitial; members?: DirectoryMember[] }> = ({ onClose, onInvited, initial, members }) => {
  const { currentUser } = useAuth();
  // Un membre invité depuis sa fiche (`initial`) n'a qu'un nom complet, pas
  // prénom/nom séparés — coupé au premier espace, le reste dans "nom" (mieux
  // qu'un champ "prénom" vide qui obligerait à tout retaper).
  const initialParts = initial?.name?.trim().split(/\s+/) || [];
  const [nom, setNom] = useState(initialParts.slice(1).join(' '));
  const [prenom, setPrenom] = useState(initialParts[0] || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [businessCardEmail, setBusinessCardEmail] = useState('');
  const [role, setRole] = useState(initial?.role && COLLAB_ROLES.some((r) => r.value === initial.role) ? initial.role : 'commercial');
  const [agencyId, setAgencyId] = useState(initial?.agencyId || AGENCIES.find((a) => a.id !== 'all')?.id || '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Demandé : pouvoir créer/activer le compte MAINTENANT sans prévenir
  // l'intéressé, et récupérer le lien de connexion pour le transmettre
  // soi-même. Sans compte, la personne n'existe pas dans `profiles` et ne
  // peut donc pas se voir attribuer un contact (contrainte
  // `leads_assigned_to_fkey`). Le lien ouvre une session : la personne
  // arrive connectée et peut ensuite utiliser son compte Google.
  const [sendInviteEmail, setSendInviteEmail] = useState(true);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  // Le nom du collaborateur, retenu au moment de la création. `fullName`
  // est une variable LOCALE à submit() : la réutiliser dans l'affichage
  // ci-dessous levait une erreur et vidait l'écran « Compte activé »,
  // celui qu'on voit justement quand aucun e-mail n'est envoyé.
  const [createdName, setCreatedName] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  // Ticket #229 : "Inviter un stagiaire" ouvrait auparavant un formulaire
  // dédié (rubrique "Gestion des utilisateurs", supprimée) avec des champs
  // spécifiques au stage — repris ici, affichés seulement pour le rôle
  // Stagiaire, pour ne perdre aucune fonctionnalité.
  const [internStartsAt, setInternStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [internEndsAt, setInternEndsAt] = useState('');
  const [internResponsableId, setInternResponsableId] = useState('');
  const [internAllowedModules, setInternAllowedModules] = useState<string[]>([]);
  const [internSpecialRights, setInternSpecialRights] = useState('');

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(await fileToDataUrl(file));
  }

  async function submit() {
    const fullName = `${prenom.trim()} ${nom.trim()}`.trim();
    if (!fullName || !email.trim()) {
      toast.error('Nom, prénom et e-mail sont obligatoires.');
      return;
    }
    if (role === 'intern' && !internEndsAt) {
      toast.error('Date de fin de stage obligatoire pour un stagiaire.');
      return;
    }
    if (!currentUser) return;
    setSubmitting(true);
    try {
      const token = await currentUser.getIdToken();
      let avatarDataUrl: string | undefined;
      let avatarExtension: string | undefined;
      if (photoFile) {
        avatarDataUrl = await fileToDataUrl(photoFile);
        avatarExtension = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      }
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          fullName,
          role,
          sendInviteEmail,
          agencyIds: agencyId ? [agencyId] : [],
          phone: phone.trim() || undefined,
          businessCardEmail: businessCardEmail.trim() || undefined,
          avatarDataUrl,
          avatarExtension,
          ...(role === 'intern' ? {
            internStartsAt,
            internEndsAt,
            internResponsableId: internResponsableId || null,
            internAllowedModules,
            internSpecialRights: internSpecialRights || null,
          } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Erreur serveur (${res.status})`);
      if (body.emailSkipped && body.actionLink) {
        // On garde la fenêtre ouverte : le lien ne s'affiche qu'ici, il
        // serait perdu en fermant. `onInvited()` (qui ferme et recharge la
        // liste) est appelé à la fermeture volontaire.
        setCreatedName(fullName);
        setCreatedLink(body.actionLink);
        toast.success('Compte activé. Transmettez le lien de connexion.');
        return;
      }
      toast.success(body.emailSent ? 'Invitation envoyée par e-mail.' : "Collaborateur créé, mais l'e-mail n'a pas pu être envoyé.");
      onInvited();
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'inviter ce collaborateur.");
    } finally {
      setSubmitting(false);
    }
  }

  if (createdLink) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
        <div className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-md w-full p-6 text-white shadow-2xl">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-2">
            <UserPlus className="w-5 h-5 text-emerald-400" /> Compte activé
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed mb-4">
            <b>{createdName || email}</b> est maintenant attribuable sur les contacts.
            Aucun e-mail n'a été envoyé. Transmettez-lui ce lien quand vous le
            souhaitez : il ouvre directement sa session, et il pourra ensuite se
            connecter avec son compte Google.
          </p>
          <div className="p-2.5 rounded-xl nv-panel border border-[#144447]/60 text-[11px] text-slate-300 break-all select-all mb-3">
            {createdLink}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(createdLink).then(() => {
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2500);
                });
              }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-sm"
            >
              {linkCopied ? 'Lien copié ✓' : 'Copier le lien'}
            </button>
            <button onClick={onInvited} className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-bold text-sm">
              Terminé
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => !submitting && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-md w-full p-6 text-white shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><UserPlus className="w-5 h-5 text-[#F9C977]" /> Inviter un collaborateur</h3>
          <button onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[#F7BC5F]/15 text-[#F9C977] font-black flex items-center justify-center overflow-hidden shrink-0">
              {photoPreview ? <img src={photoPreview} alt="" className="w-full h-full object-cover" /> : <UserPlus className="w-6 h-6" />}
            </div>
            <label className="text-xs font-bold text-[#F9C977] hover:text-[#F7BC5F] cursor-pointer">
              {photoFile ? 'Changer la photo' : 'Ajouter une photo (facultatif)'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void handlePhoto(e.target.files?.[0])} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Prénom" className="bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]" />
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom" className="bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]" />
          </div>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone (facultatif)" className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]" />
          <input type="email" value={businessCardEmail} onChange={(e) => setBusinessCardEmail(e.target.value)} placeholder="E-mail de carte de visite (facultatif)" className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]" />

          <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]">
            {COLLAB_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)} className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]">
            {AGENCIES.filter((a) => a.id !== 'all').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          {role === 'intern' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#F7BC5F]/5 border border-[#F7BC5F]/20">
              <label className="space-y-1">
                <span className="text-xs text-slate-300 font-semibold">Début du stage</span>
                <input type="date" value={internStartsAt} onChange={(e) => setInternStartsAt(e.target.value)} className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-300 font-semibold">Fin du stage</span>
                <input type="date" value={internEndsAt} onChange={(e) => setInternEndsAt(e.target.value)} className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]" />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-xs text-slate-300 font-semibold">Responsable du stage</span>
                <select value={internResponsableId} onChange={(e) => setInternResponsableId(e.target.value)} className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]">
                  <option value="">Non défini</option>
                  {(members || []).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <div className="space-y-1 col-span-2">
                <span className="text-xs text-slate-300 font-semibold">Modules autorisés (en plus d'Accueil et de son pipeline, toujours inclus)</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {INTERN_EXTRA_MODULES.map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 text-xs text-white bg-[#0b292b] border border-[#1c4448] rounded-lg px-2.5 py-1.5 cursor-pointer hover:border-[#F7BC5F]/50">
                      <input
                        type="checkbox"
                        checked={internAllowedModules.includes(m.id)}
                        onChange={() => setInternAllowedModules((cur) => cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id])}
                        className="accent-[#F7BC5F]"
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="space-y-1 col-span-2">
                <span className="text-xs text-slate-300 font-semibold">Droits particuliers (facultatif, note pour le responsable)</span>
                <textarea value={internSpecialRights} onChange={(e) => setInternSpecialRights(e.target.value)} placeholder="Ex : peut modifier les fiches clients de l'agence Conseils Finances uniquement." rows={2} className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F] resize-none" />
              </label>
            </div>
          )}
        </div>

        <label className="mt-4 flex items-start gap-2.5 p-3 rounded-xl nv-panel border border-[#144447]/60 cursor-pointer">
          <input
            type="checkbox"
            checked={sendInviteEmail}
            onChange={(e) => setSendInviteEmail(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#F7BC5F] shrink-0"
          />
          <span className="text-xs text-slate-300 leading-relaxed">
            <span className="font-bold text-white">Envoyer l'invitation par e-mail maintenant</span>
            <br />
            Décochez pour <b>activer le compte sans prévenir la personne</b> : elle devient
            immédiatement attribuable sur les contacts, et le lien de connexion s'affiche
            ici pour que vous le transmettiez quand vous le souhaitez.
          </span>
        </label>

        <div className="flex gap-2 pt-5">
          <button onClick={onClose} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-bold text-sm">Annuler</button>
          <button onClick={() => void submit()} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} {sendInviteEmail ? "Envoyer l'invitation" : 'Activer le compte'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Ticket "Clients invités" (4/13 et 5/13) : onglet dédié dans Équipe —
// liste des accès + recherche d'une fiche client existante à inviter.
// Impossible de créer une nouvelle fiche depuis cette fenêtre (demande
// explicite) : si la fiche n'existe pas, on renvoie simplement vers Clients.
interface GuestAccessRow {
  id: string;
  lead_id: string;
  agency_id: string;
  user_id: string | null;
  email: string;
  status: string;
  invited_at: string | null;
  last_login_at: string | null;
}

interface LeadLite {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  agency_id: string | null;
  assigned_to: string | null;
}

const GUEST_STATUS_META: Record<string, { label: string; classes: string }> = {
  a_envoyer: { label: 'Invitation à envoyer', classes: 'bg-white/5 text-gray-400 border-white/10' },
  envoyee: { label: 'Invitation envoyée', classes: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  expiree: { label: 'Invitation expirée', classes: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  active: { label: 'Accès actif', classes: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  suspendue: { label: 'Accès suspendu', classes: 'bg-orange-500/10 text-orange-300 border-orange-500/30' },
  revoquee: { label: 'Accès révoqué', classes: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
};

const ClientsInvitesPanel: React.FC<{ onNavigate?: (nav: string) => void; onOpenContact?: (contactId: string) => void }> = ({ onNavigate, onOpenContact }) => {
  const { currentUser } = useAuth();
  const [rows, setRows] = useState<GuestAccessRow[]>([]);
  const [leadsById, setLeadsById] = useState<Record<string, LeadLite>>({});
  const [profilesById, setProfilesById] = useState<Record<string, { full_name: string | null }>>({});
  // Ticket #214 : "retrouver facilement la fiche liée à l'adresse e-mail" —
  // en plus de la fiche déjà rattachée (lead_id), on recherche aussi par
  // adresse e-mail (celle saisie pour l'accès, pas forcément identique à
  // celle de la fiche liée si elle a été mal saisie) pour retrouver LA
  // bonne fiche même en cas d'erreur de rattachement. La recherche passe
  // par le client Supabase normal : le RLS sur `leads` scope déjà les
  // résultats à l'agence de l'utilisateur connecté, aucune fiche d'une
  // autre agence ne peut donc jamais remonter ici.
  const [leadsByEmail, setLeadsByEmail] = useState<Record<string, LeadLite[]>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LeadLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<{ leadId: string; reason?: string; message?: string; duplicates?: any[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: access } = await supabase.from('client_guest_access').select('*').order('created_at', { ascending: false });
      setRows((access as GuestAccessRow[]) || []);
      const leadIds = Array.from(new Set((access || []).map((a: any) => a.lead_id)));
      if (leadIds.length) {
        const { data: leads } = await supabase.from('leads').select('id, first_name, last_name, full_name, email, phone, agency_id, assigned_to').in('id', leadIds);
        const map: Record<string, LeadLite> = {};
        (leads || []).forEach((l: any) => { map[l.id] = l; });
        setLeadsById(map);
        const assignedIds = Array.from(new Set((leads || []).map((l: any) => l.assigned_to).filter(Boolean)));
        if (assignedIds.length) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', assignedIds);
          const pMap: Record<string, { full_name: string | null }> = {};
          (profs || []).forEach((p: any) => { pMap[p.id] = p; });
          setProfilesById(pMap);
        }
      } else {
        setLeadsById({});
      }

      // Ticket #214 : recherche par adresse e-mail (une seule requête pour
      // toutes les adresses distinctes de la liste, plutôt qu'une par
      // ligne). Insensible à la casse — une adresse ressaisie avec une
      // majuscule différente doit quand même être retrouvée.
      const emails = Array.from(new Set((access || []).map((a: any) => (a.email || '').trim().toLowerCase()).filter(Boolean)));
      if (emails.length) {
        // `.in()` compare de façon stricte/sensible à la casse — une
        // fiche enregistrée avec une majuscule différente ne remonterait
        // jamais. `ilike` (insensible à la casse, sans caractère
        // générique ici) sur chaque adresse via un `or` évite ce piège.
        const orFilter = emails.map((e) => `email.ilike.${e.replace(/,/g, '')}`).join(',');
        const { data: byEmail } = await supabase
          .from('leads')
          .select('*')
          .or(orFilter);
        const grouped: Record<string, LeadLite[]> = {};
        ((byEmail || []) as any[]).filter((l) => !l.deleted_at).forEach((l: any) => {
          const key = (l.email || '').trim().toLowerCase();
          if (!key) return;
          (grouped[key] ||= []).push(l);
        });
        setLeadsByEmail(grouped);
      } else {
        setLeadsByEmail({});
      }
    } catch (err) {
      console.warn('Erreur chargement clients invités :', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .limit(15);
      // Corbeille (3 septembre) : une fiche mise de côté ne se propose plus.
      if (!cancelled) { setSearchResults(((data as any[]) || []).filter((l) => !l.deleted_at) as LeadLite[]); setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery]);

  const callGuestApi = async (body: Record<string, unknown>) => {
    if (!currentUser) throw new Error('Utilisateur non authentifié.');
    const token = await currentUser.getIdToken();
    const res = await fetch('/api/clients/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const respBody = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(respBody?.error || 'Erreur.');
    return respBody;
  };

  const inviteLead = async (lead: LeadLite) => {
    setInviting(true);
    setInviteFeedback(null);
    try {
      const result = await callGuestApi({ action: 'invite', leadId: lead.id });
      if (result.ok === false) {
        setInviteFeedback({ leadId: lead.id, ...result });
        return;
      }
      setShowSearchModal(false);
      setSearchQuery('');
      setSearchResults([]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'inviter ce client.");
    } finally {
      setInviting(false);
    }
  };

  const runAction = async (row: GuestAccessRow, action: 'resend' | 'suspend' | 'reactivate' | 'revoke') => {
    setBusyId(row.id);
    try {
      const result = await callGuestApi({ action, accessId: row.id });
      // Ticket #224 : "ne jamais faire croire que l'envoi a réussi" — le
      // serveur répondait 200/ok même quand l'e-mail lui-même avait échoué
      // à partir (emailSent: false), donc rien ne le signalait ici avant.
      if (action === 'resend') {
        if (result?.emailSent === false) {
          toast.error(result?.emailError || "L'e-mail n'a pas pu être envoyé. Réessayez ou vérifiez l'adresse.");
        } else {
          toast.success('Accès à l\'espace client renvoyé avec succès.');
        }
      }
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => { setShowSearchModal(true); setInviteFeedback(null); }}
        className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-sm flex items-center justify-center gap-2 transition-colors"
      >
        <UserPlus className="w-4 h-4" /> Inviter un client existant
      </button>

      {loading ? (
        <div className="p-8 flex items-center justify-center text-slate-500 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">Aucun client invité pour l'instant.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const lead = leadsById[row.lead_id];
            const conseiller = lead?.assigned_to ? profilesById[lead.assigned_to]?.full_name : null;
            const agency = AGENCIES.find((a) => a.id === row.agency_id)?.name || row.agency_id;
            const meta = GUEST_STATUS_META[row.status] || GUEST_STATUS_META.a_envoyer;

            // Ticket #214 : "retrouver facilement la fiche liée à
            // l'adresse e-mail". `emailMatches` ne contient QUE des fiches
            // déjà scopées par le RLS de `leads` à l'agence de
            // l'utilisateur connecté — jamais de fuite inter-agences.
            const emailKey = (row.email || '').trim().toLowerCase();
            const emailMatches = leadsByEmail[emailKey] || [];
            const otherEmailMatches = emailMatches.filter((l) => l.id !== row.lead_id);
            const hasAnyMatch = !!lead || emailMatches.length > 0;

            return (
              <div key={row.id} className="bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{lead?.full_name || `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim() || row.email}</p>
                    <p className="text-xs text-slate-400 truncate">{row.email} · {agency}{conseiller ? ` · ${conseiller}` : ''}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full border ${meta.classes}`}>{meta.label}</span>
                </div>
                {row.invited_at && (
                  <p className="text-[11px] text-slate-500">Invité le {new Date(row.invited_at).toLocaleDateString('fr-FR')}{row.last_login_at ? ` · Dernière connexion le ${new Date(row.last_login_at).toLocaleDateString('fr-FR')}` : ''}</p>
                )}

                {/* Ticket #214 : lien direct vers la fiche liée, alerte si
                    l'adresse correspond aussi à d'autres fiches (utile pour
                    corriger un rattachement erroné), ou message clair si
                    aucune fiche ne correspond du tout. */}
                {onOpenContact && lead && (
                  <button
                    onClick={() => onOpenContact(lead.id)}
                    className="text-xs font-bold text-[#F9C977] hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Voir la fiche client
                  </button>
                )}
                {!lead && emailMatches.length === 1 && onOpenContact && (
                  <button
                    onClick={() => onOpenContact(emailMatches[0].id)}
                    className="text-xs font-bold text-[#F9C977] hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Voir la fiche correspondant à cette adresse
                  </button>
                )}
                {!hasAnyMatch && (
                  <p className="text-[11px] text-amber-400/90">Aucune fiche ne correspond à cette adresse e-mail.</p>
                )}
                {otherEmailMatches.length > 0 && (
                  <div className="text-[11px] text-amber-400/90 space-y-1">
                    <p className="flex items-center gap-1.5"><img src="/nova/expressions/nova-attention.png" alt="" className="w-4 h-4 shrink-0" />Cette adresse correspond aussi à {otherEmailMatches.length > 1 ? 'd\'autres fiches' : 'une autre fiche'} (adresse e-mail probablement à corriger) :</p>
                    <div className="flex flex-wrap gap-2">
                      {otherEmailMatches.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => onOpenContact?.(m.id)}
                          className="underline hover:text-amber-300"
                        >
                          {m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(row.status === 'envoyee' || row.status === 'expiree' || row.status === 'a_envoyer') && (
                    <button disabled={busyId === row.id} onClick={() => void runAction(row, 'resend')} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-200 flex items-center gap-1.5 disabled:opacity-50">
                      <RefreshCw className="w-3.5 h-3.5" /> Renvoyer
                    </button>
                  )}
                  {row.status === 'active' && (
                    <button disabled={busyId === row.id} onClick={() => void runAction(row, 'suspend')} className="px-3 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-xs font-bold text-orange-300 flex items-center gap-1.5 disabled:opacity-50">
                      <PauseCircle className="w-3.5 h-3.5" /> Suspendre
                    </button>
                  )}
                  {row.status === 'suspendue' && (
                    <button disabled={busyId === row.id} onClick={() => void runAction(row, 'reactivate')} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-bold text-emerald-300 flex items-center gap-1.5 disabled:opacity-50">
                      <PlayCircle className="w-3.5 h-3.5" /> Réactiver
                    </button>
                  )}
                  {row.status !== 'revoquee' && (
                    <button
                      disabled={busyId === row.id}
                      onClick={() => { if (confirm('Révoquer définitivement l\'accès de ce client ? Sa fiche et ses documents seront conservés.')) void runAction(row, 'revoke'); }}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-xs font-bold text-rose-300 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Ban className="w-3.5 h-3.5" /> Révoquer
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showSearchModal && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setShowSearchModal(false)}>
          <div className="w-full sm:max-w-md bg-[#0a1e20] border border-[#144447]/60 sm:rounded-3xl rounded-t-3xl p-6 max-h-[85vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">Inviter un client existant</h2>
              <button onClick={() => setShowSearchModal(false)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setInviteFeedback(null); }}
                placeholder="Nom, prénom, e-mail, téléphone..."
                className="w-full bg-black/20 border border-[#144447]/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]/60"
              />
            </div>
            {searching && <p className="text-xs text-slate-500 text-center py-3">Recherche...</p>}
            {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <div className="text-center py-4 space-y-2">
                <p className="text-xs text-slate-500">Aucune fiche trouvée.</p>
                <button onClick={() => onNavigate?.('clients')} className="text-xs font-bold text-[#F9C977] hover:underline">Créer d'abord sa fiche dans Clients</button>
              </div>
            )}
            <div className="space-y-1.5">
              {searchResults.map((lead) => (
                <div key={lead.id} className="bg-black/20 border border-white/5 rounded-xl p-3">
                  <p className="text-sm font-bold text-white">{lead.full_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim()}</p>
                  <p className="text-xs text-slate-400">{lead.email || 'Pas d\'e-mail'}{lead.phone ? ` · ${lead.phone}` : ''}</p>
                  {inviteFeedback?.leadId === lead.id ? (
                    <p className="text-[11px] text-rose-300 mt-1.5">{inviteFeedback.message}</p>
                  ) : (
                    <button
                      disabled={!lead.email || inviting}
                      onClick={() => void inviteLead(lead)}
                      className="mt-2 px-3 py-1.5 rounded-lg bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 text-xs font-black disabled:opacity-50"
                    >
                      {!lead.email ? "Pas d'e-mail" : 'Inviter'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Modules optionnels proposables à un stagiaire (en plus d'Accueil et de
// son pipeline, toujours inclus) — utilisé par la modale d'invitation
// ci-dessus (InviteCollaboratorModal, rôle Stagiaire).
const INTERN_EXTRA_MODULES: { id: string; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'notes', label: 'Notes' },
];


export default EquipeView;
