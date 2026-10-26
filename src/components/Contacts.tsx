import React, { useState, useEffect } from 'react';
import { clicMailCrm } from '@/lib/composerMail';
import { supabase } from '@/lib/supabase';
import { Contact, Deal, AGENCIES } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { 
  Search, Plus, Filter, User, Phone, Mail, Building2, 
  Trash2, FileSpreadsheet, Award, Landmark, UserPlus, 
  ChevronRight, Calendar, Sparkles, X, CheckSquare, Users, UserCheck,
  Share2, Loader2
} from 'lucide-react';
import { useContacts, matchesAgency } from '@/hooks/useContacts';
import { NovaSphereUserProfile, useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

import { TEAM_MEMBERS, getAssignedUser } from '@/data/teamMembers';
import { useAssignableUsers } from '@/hooks/useAssignableUsers';

interface ContactsProps {
  onAddDeal: (deal: Omit<Deal, 'id' | 'createdAt'>) => Promise<void>;
  onSelectContact?: (contactId: string) => void;
}

export default function Contacts({ 
  onAddDeal,
  onSelectContact
}: ContactsProps) {
  const { activeAgency, currentUser, userProfile } = useAuth();
  const { contacts, allContacts, isLoading, addContact, updateContact, deleteContact } = useContacts();

  // Selected Structure Tab (Defaults to activeAgency.id, but can switch to view each structure separately or all)
  const [selectedStructure, setSelectedStructure] = useState<string>(activeAgency.id);

  // Sync tab if user changes global active agency in header/sidebar
  useEffect(() => {
    setSelectedStructure(activeAgency.id);
    if (activeAgency.id === 'all') {
      setViewScope('all');
    } else {
      setViewScope('agency');
    }
  }, [activeAgency.id]);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assignedUserFilter, setAssignedUserFilter] = useState<string>('all');
  const [viewScope, setViewScope] = useState<'mine' | 'agency' | 'all'>('agency');

  // Selected Contact for Detail view
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Modals / Form displays
  const [showAddForm, setShowAddForm] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [showAddDealForm, setShowAddDealForm] = useState(false);

  // Utilisateurs Nova CRM réels pour le partage de fiches
  const [novaUsers, setNovaUsers] = useState<NovaSphereUserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);

  // New Contact Form fields
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAgencyId, setNewAgencyId] = useState(AGENCIES[0].id);
  // Voir useAssignableUsers : la liste vient de la base, pas du fichier figé.
  // Valeur initiale vide plutôt que le premier membre codé en dur, qui
  // pouvait ne correspondre à aucun compte existant.
  const [newAssignedTo, setNewAssignedTo] = useState('');
  const assignableUsers = useAssignableUsers(selectedStructure);
  const [newStatus, setNewStatus] = useState<Contact['status']>('Nouveau');
  const [creatingContact, setCreatingContact] = useState(false);

  // Questionnaire Form fields
  const [revenus, setRevenus] = useState('0');
  const [apport, setApport] = useState('0');
  const [credits, setCredits] = useState('0');
  const [contractType, setContractType] = useState('CDI');
  const [projectType, setProjectType] = useState('Résidence Principale');
  const [coBorrower, setCoBorrower] = useState('');

  // New Deal associated with this contact
  const [dealTitle, setDealTitle] = useState('');
  const [dealAmount, setDealAmount] = useState('150000');

  // Utilisateur d'équipe correspondant au compte Google connecté (compatibilité anciens assignedTo)
  useEffect(() => {
    const loadNovaUsers = async () => {
      if (!currentUser) {
        setNovaUsers([]);
        return;
      }

      setUsersLoading(true);

      try {
        // Signalé (31/08/2026) : "quand Natacha crée un contact, elle ne peut
        // pas le partager". Cause : `agencyIds` était figé à [] pour CHAQUE
        // utilisateur ci-dessous. Or le filtre du panneau de partage fait
        // ensuite `targetAgencies.some(...)` sur cette liste — toujours vide,
        // donc toujours faux. La liste des collègues avec qui partager était
        // par conséquent VIDE pour tout le monde sauf les super_admin, qui
        // sortent avant ce filtre. On charge donc les rattachements réels.
        const [{ data }, { data: memberships }] = await Promise.all([
          supabase.from('profiles').select('*'),
          supabase.from('agency_members').select('user_id, agency_id'),
        ]);

        const agencesParUtilisateur: Record<string, string[]> = {};
        ((memberships || []) as { user_id: string; agency_id: string }[]).forEach((m) => {
          (agencesParUtilisateur[m.user_id] ||= []).push(m.agency_id);
        });

        const loaded = (data || [])
          .map((item: any) => ({
            uid: item.id,
            email: item.email || '',
            displayName: item.full_name || item.email || 'Membre',
            photoURL: item.avatar_url || null,
            role: 'commercial',
            agencyIds: agencesParUtilisateur[item.id] || [],
            active: true,
            jobTitle: item.job_title || null,
          } as unknown as NovaSphereUserProfile))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));

        setNovaUsers(loaded);
      } catch (error) {
        console.error('Impossible de charger les utilisateurs Nova CRM :', error);
        setNovaUsers([]);
      } finally {
        setUsersLoading(false);
      }
    };

    void loadNovaUsers();
  }, [currentUser]);

  const handleToggleShare = async (user: NovaSphereUserProfile) => {
    if (!selectedContact || !currentUser) return;

    const isOwner = selectedContact.ownerUserId === currentUser.uid;

    if (!isOwner) {
      setShareError("Seul le propriétaire de cette fiche peut modifier son partage.");
      return;
    }

    if (user.uid === currentUser.uid) {
      return;
    }

    const currentShared = Array.isArray(selectedContact.sharedWithUserIds)
      ? selectedContact.sharedWithUserIds
      : [];

    const alreadyShared = currentShared.includes(user.uid);

    const nextShared = alreadyShared
      ? currentShared.filter((uid) => uid !== user.uid)
      : [...currentShared, user.uid];

    setShareError(null);
    setShareSuccess(null);

    try {
      await updateContact.mutateAsync({
        id: selectedContact.id,
        updates: {
          sharedWithUserIds: nextShared,
        },
      });

      setSelectedContact({
        ...selectedContact,
        sharedWithUserIds: nextShared,
      });

      setShareSuccess(
        alreadyShared
          ? `Le partage avec ${user.displayName} a été retiré.`
          : `La fiche est maintenant partagée avec ${user.displayName}.`
      );
    } catch (error) {
      console.error('Erreur partage client :', error);
      setShareError("Impossible de modifier le partage de cette fiche.");
    }
  };

  const currentTeamMember = TEAM_MEMBERS.find(
    member => member.email.toLowerCase() === currentUser?.email?.toLowerCase()
  );

  const isMyContact = (contact: Contact) => {
    if (!currentUser) return false;

    const isOwner = contact.ownerUserId === currentUser.uid;
    const isShared = Array.isArray(contact.sharedWithUserIds) && contact.sharedWithUserIds.includes(currentUser.uid);

    // Compatibilité avec les anciennes fiches qui n'ont pas encore ownerUserId.
    const isLegacyAssigned = Boolean(
      !contact.ownerUserId &&
      currentTeamMember &&
      (
        contact.assignedTo === currentTeamMember.id ||
        contact.assignedTo?.toLowerCase() === currentTeamMember.email.toLowerCase() ||
        contact.assignedTo?.toLowerCase() === currentTeamMember.name.toLowerCase()
      )
    );

    return isOwner || isShared || isLegacyAssigned;
  };

  // Counts per structure across database
  const totalAllCount = (allContacts || []).length;
  const conseilsFinancesCount = (allContacts || []).filter(c => matchesAgency(c.agencyId, '30f96ea9-41da-41c2-a95e-f5e7898f8d8e')).length;
  const novavisioCount = (allContacts || []).filter(c => matchesAgency(c.agencyId, '0cd9362c-316e-4b57-af0b-b6cea092961b')).length;
  const immospheraCount = (allContacts || []).filter(c => matchesAgency(c.agencyId, '15157da9-71ea-4760-ae1c-3bc99d9caa20')).length;
  const myContactsCount = (allContacts || []).filter(isMyContact).length;
  const currentAgencyCount = activeAgency.id === 'all'
    ? totalAllCount
    : (allContacts || []).filter(c => matchesAgency(c.agencyId, activeAgency.id)).length;

  // Filtering Logic
  const filteredContacts = (allContacts || []).filter(c => {
    const matchesScope =
      viewScope === 'mine'
        ? isMyContact(c)
        : selectedStructure === 'all'
          ? true
          : matchesAgency(c.agencyId, selectedStructure);

    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
                          c.email.toLowerCase().includes(search.toLowerCase()) ||
                          c.phone.includes(search);
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    
    const assignedUser = getAssignedUser(c.assignedTo);
    const matchesUser = assignedUserFilter === 'all' || 
                        c.assignedTo === assignedUserFilter || 
                        assignedUser.id === assignedUserFilter ||
                        assignedUser.name.toLowerCase().includes(assignedUserFilter.toLowerCase());

    return matchesScope && matchesSearch && matchesStatus && matchesUser;
  });

  // Handle opening Details
  const handleSelectContact = (contact: Contact) => {
    if (onSelectContact) {
      onSelectContact(contact.id);
      return;
    }
    setSelectedContact(contact);
    // Sync questionnaire values
    setRevenus(String(contact.revenus || 0));
    setApport(String(contact.apport || 0));
    setCredits(String(contact.credits || 0));
    setContractType(contact.contractType || 'CDI');
    setProjectType(contact.projectType || "Résidence Principale");
    setCoBorrower(contact.coBorrower || '');
    setShowQuestionnaire(false);
    setShowAddDealForm(false);
  };

  // Submit new contact
  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail || !newPhone) return;
    if (creatingContact) return;

    setCreatingContact(true);
    try {
      const created = await addContact.mutateAsync({
        name: newName,
        email: newEmail,
        phone: newPhone,
        agencyId: newAgencyId,
        assignedTo: newAssignedTo,
        status: newStatus
      });
      // Reset
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setShowAddForm(false);
      toast.success('Lead créé avec succès !');
      if (created?.id && onSelectContact) {
        onSelectContact(created.id);
      }
    } catch (error: any) {
      console.error('Erreur création contact :', error);
      toast.error(error?.message || "Impossible de créer ce contact. Réessayez.");
    } finally {
      setCreatingContact(false);
    }
  };

  // Submit Questionnaire details
  const handleSaveQuestionnaire = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) return;
    const updates = {
      revenus: Number(revenus),
      apport: Number(apport),
      credits: Number(credits),
      contractType,
      projectType,
      coBorrower,
      comments: `[Questionnaire] Projet: ${projectType}, Contrat: ${contractType}, Apport: ${apport}€, Mensualités crédits: ${credits}€, Co-emprunteur: ${coBorrower || 'Aucun'}`
    };
    await updateContact.mutateAsync({ id: selectedContact.id, updates });
    // Sync current state
    setSelectedContact({ ...selectedContact, ...updates });
    setShowQuestionnaire(false);
  };

  // Submit dynamic deal from contact details
  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact || !dealTitle || !dealAmount) return;
    await onAddDeal({
      title: dealTitle,
      amount: Number(dealAmount),
      stage: 'To-Do List',
      agencyId: selectedContact.agencyId || '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
      contactId: selectedContact.id
    });
    setDealTitle('');
    setShowAddDealForm(false);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
      {/* List side */}
      <div className="xl:col-span-2 space-y-6">
        {/* En-tête compact */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 rounded-2xl bg-[#07191b] border border-[#144447]">
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-white tracking-tight">Répertoire des Prospects & Clients</h2>
            <p className="text-xs text-slate-400 mt-1">
              <span className="font-bold text-white">{filteredContacts.length}</span> contact(s) affiché(s)
            </p>
          </div>
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer shrink-0">
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Nouveau contact</span>
          </button>
        </div>

        {/* Une seule ligne de navigation */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <button type="button" onClick={() => { setViewScope('mine'); setSelectedStructure('all'); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${viewScope === 'mine' ? 'bg-[#F7BC5F] text-slate-950 border-[#F9C977] shadow-lg shadow-[#F7BC5F]/20' : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'}`}>
            <UserCheck className="w-4 h-4" /><span>Mes clients</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/60">{myContactsCount}</span>
          </button>

          <button type="button" onClick={() => { setViewScope('agency'); setSelectedStructure(activeAgency.id); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${viewScope === 'agency' && selectedStructure === activeAgency.id ? 'bg-[#F7BC5F] text-slate-950 border-[#F9C977] shadow-lg shadow-[#F7BC5F]/20' : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'}`}>
            <Users className="w-4 h-4" /><span>Tous agence</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/60">{currentAgencyCount}</span>
          </button>

          <div className="h-7 w-px bg-[#153c3f] shrink-0 mx-1" />

          <button type="button" onClick={() => { setSelectedStructure('30f96ea9-41da-41c2-a95e-f5e7898f8d8e'); setViewScope('agency'); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${viewScope === 'agency' && selectedStructure === '30f96ea9-41da-41c2-a95e-f5e7898f8d8e' ? 'bg-[#F7BC5F] text-slate-950 border-[#F9C977] shadow-lg shadow-[#F7BC5F]/20' : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'}`}>
            <Landmark className="w-3.5 h-3.5" /><span>Conseils Finances</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/60">{conseilsFinancesCount}</span>
          </button>

          <button type="button" onClick={() => { setSelectedStructure('0cd9362c-316e-4b57-af0b-b6cea092961b'); setViewScope('agency'); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${viewScope === 'agency' && selectedStructure === '0cd9362c-316e-4b57-af0b-b6cea092961b' ? 'bg-[#F7BC5F] text-slate-950 border-[#F9C977] shadow-lg shadow-[#F7BC5F]/20' : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'}`}>
            <Sparkles className="w-3.5 h-3.5" /><span>NovaVisio</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/60">{novavisioCount}</span>
          </button>

          <button type="button" onClick={() => { setSelectedStructure('15157da9-71ea-4760-ae1c-3bc99d9caa20'); setViewScope('agency'); }}
            className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${viewScope === 'agency' && selectedStructure === '15157da9-71ea-4760-ae1c-3bc99d9caa20' ? 'bg-[#F7BC5F] text-slate-950 border-[#F9C977] shadow-lg shadow-[#F7BC5F]/20' : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'}`}>
            <Building2 className="w-3.5 h-3.5" /><span>ImmoSphera</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800/60">{immospheraCount}</span>
          </button>
        </div>

        {/* Filters (30/08/2026, demande explicite) : "supprime la barre de
            recherche car il y en a une tout en haut" — barre locale
            retirée, la barre globale (Header.tsx, "Rechercher un client, un
            dossier...") cherche déjà précisément parmi les clients, donc
            réellement redondante ici (contrairement à Équipe, où la barre
            globale ne cherche PAS les membres — voir EquipeView.tsx). */}
        <div className="p-4 rounded-2xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow flex flex-col md:flex-row gap-3 transition-all duration-300">
          <div className="flex flex-wrap sm:flex-nowrap gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-[#F7BC5F]"
            >
              <option value="all">Tous les Statuts</option>
              <option value="Nouveau">Nouveau</option>
              <option value="Qualifié">Qualifié</option>
              <option value="Proposition">Proposition</option>
              <option value="En Négociation">En Négociation</option>
              <option value="Converti">Converti</option>
              <option value="Perdu">Perdu</option>
            </select>

            <select
              value={assignedUserFilter}
              onChange={(e) => setAssignedUserFilter(e.target.value)}
              className="bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-[#F7BC5F]"
            >
              <option value="all">Tous les Utilisateurs / Agents</option>
              {assignableUsers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic add-contact form inside flow */}
        {showAddForm && (
          <form onSubmit={handleCreateContact} className="p-6 rounded-2xl bg-[#07191b] border border-[#F7BC5F]/40 hover:border-[#F7BC5F]/60 shadow-2xl space-y-4 animate-slide-up relative transition-all duration-300">
            <div className="absolute top-4 right-4">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)} 
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <h3 className="text-xs uppercase font-extrabold text-[#F7BC5F] tracking-widest flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              <span>Créer un profil client</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Nom Complet</label>
                <input
                  type="text"
                  required
                  placeholder="Jean Dupont"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  required
                  placeholder="jean.dupont@gmail.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Téléphone</label>
                <input
                  type="tel"
                  required
                  placeholder="06 12 34 56 78"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Société / Structure</label>
                <select
                  value={newAgencyId}
                  onChange={(e) => setNewAgencyId(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                >
                  {AGENCIES.filter(a => a.id !== 'all').map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Utilisateur Lié (Agent)</label>
                <select
                  value={newAssignedTo}
                  onChange={(e) => setNewAssignedTo(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                >
                  <option value="">— Non attribué —</option>
                  {assignableUsers.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Statut Initial</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as Contact['status'])}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                >
                  <option value="Nouveau">Nouveau</option>
                  <option value="Qualifié">Qualifié</option>
                  <option value="Proposition">Proposition</option>
                  <option value="En Négociation">En Négociation</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#153c3f]/80">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={creatingContact}
                className="px-5 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs cursor-pointer shadow-lg transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                title="Créer un Lead"
              >
                {creatingContact ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 stroke-[2.5]" />
                )}
                <span>{creatingContact ? 'Création en cours…' : 'Créer un Lead'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Contacts Table/List */}
        <div className="bg-[#07191b] border border-[#144447]/60 rounded-2xl overflow-hidden shadow-xl transition-all duration-300">
          {filteredContacts.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              Aucun prospect ne correspond à cette structure ou à ces filtres.
            </div>
          ) : (
            <div className="divide-y divide-[#144447]/30 p-2 space-y-1">
              {filteredContacts.map(c => {
                const agency = AGENCIES.find(a => matchesAgency(c.agencyId, a.id) && a.id !== 'all') || AGENCIES[0];
                const assignedUser = getAssignedUser(c.assignedTo);
                const isSelected = selectedContact?.id === c.id;

                return (
                  <div 
                    key={c.id} 
                    onClick={() => handleSelectContact(c)}
                    className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer transition-all duration-200 border rounded-xl ${
                      isSelected ? 'bg-[#143c3f]/40 border-[#1e5d61] shadow-lg shadow-teal-950/20' : 'border-transparent hover:bg-[#143c3f]/15'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-[#143c3f]/60 border border-[#256064]/40 flex items-center justify-center text-[#F7BC5F] font-black uppercase tracking-tight shadow">
                        {c.name.substring(0, 2)}
                      </div>
                      <div>
                        <div className="text-xs font-black text-white flex items-center gap-2">
                          <span>{c.name}</span>
                          {c.revenus && c.revenus > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[8px] bg-[#F7BC5F]/10 text-[#F9C977] border border-[#F7BC5F]/20 px-1.5 py-0.5 rounded-full uppercase tracking-widest font-extrabold">
                              Découvert
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                          {/* Demande (3 septembre) : e-mail et téléphone cliquables et surlignés. */}
                          <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-slate-500" />{' '}
                            {c.email ? <a href={`mailto:${c.email}`} onClick={clicMailCrm(c.email)} title="Écrire depuis la boîte Mail du CRM" className="text-[#F9C977] underline underline-offset-2 decoration-[#F9C977]/50 hover:text-[#FAD592]">{c.email}</a> : '—'}
                          </span>
                          <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-slate-500" />{' '}
                            {c.phone ? <a href={`tel:${String(c.phone).replace(/[^+\d]/g, '')}`} onClick={(e) => e.stopPropagation()} className="text-[#F9C977] underline underline-offset-2 decoration-[#F9C977]/50 hover:text-[#FAD592]">{c.phone}</a> : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2.5 justify-end sm:justify-start">
                      {/* Structure Badge */}
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                        agency.id === '0cd9362c-316e-4b57-af0b-b6cea092961b' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                        agency.id === '15157da9-71ea-4760-ae1c-3bc99d9caa20' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                        'bg-[#F7BC5F]/10 text-[#F9C977] border-[#F7BC5F]/30'
                      }`}>
                        {agency.name}
                      </span>

                      {/* Linked User Badge */}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#030d0f] border border-[#153c3f] text-[10px] font-medium text-slate-300">
                        {assignedUser.avatarUrl ? (
                          <img src={assignedUser.avatarUrl} alt={assignedUser.name} className="w-4 h-4 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-[#F7BC5F]/20 text-[#F9C977] font-extrabold text-[8px] flex items-center justify-center shrink-0">
                            {assignedUser.avatar}
                          </span>
                        )}
                        <span>{assignedUser.name}</span>
                      </span>

                      {/* Status Badge */}
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${
                        c.status === 'Converti' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' :
                        c.status === 'Perdu' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/25' :
                        c.status === 'Nouveau' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25' :
                        'bg-[#F7BC5F]/10 text-[#F9C977] border border-[#F7BC5F]/25'
                      }`}>
                        {c.status}
                      </span>
                      {currentUser && c.ownerUserId !== currentUser.uid && Array.isArray(c.sharedWithUserIds) && c.sharedWithUserIds.includes(currentUser.uid) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 text-[10px] font-bold text-violet-300">
                          <UserCheck className="w-3 h-3" /> Partagé avec moi
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Details Side Drawer / Card */}
      <div className="space-y-6">
        {selectedContact ? (
          <div className="p-6 rounded-3xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow-2xl space-y-6 animate-slide-up transition-all duration-300">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-[#143c3f]/50 pb-4">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-[#F7BC5F] tracking-wider">Fiche de Synthèse Prospect</span>
                <h3 className="text-base font-black text-white">{selectedContact.name}</h3>
                <p className="text-[10px] text-slate-400">Créé le {formatDate(selectedContact.createdAt)}</p>
              </div>
              <button
                onClick={async () => {
                  if (confirm("Voulez-vous supprimer ce prospect ? Tous ses dossiers et tâches associés resteront affectés.")) {
                    await deleteContact.mutateAsync(selectedContact.id);
                    setSelectedContact(null);
                  }
                }}
                className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                title="Supprimer le client"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Partage réel de la fiche client */}
            <div className="p-4 rounded-2xl bg-[#030d0f] border border-violet-500/25 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-[10px] uppercase font-bold text-violet-300 tracking-wider flex items-center gap-1.5">
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Partager cette fiche</span>
                </h4>

                {selectedContact.ownerUserId === currentUser?.uid ? (
                  <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">
                    Vous êtes propriétaire
                  </span>
                ) : (
                  <span className="text-[9px] font-bold text-slate-400 bg-white/5 border border-white/10 px-2 py-1 rounded-full">
                    Consultation du partage
                  </span>
                )}
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Les personnes sélectionnées verront cette fiche dans leur onglet « Mes clients ».
              </p>

              {shareError && (
                <div className="text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                  {shareError}
                </div>
              )}

              {shareSuccess && (
                <div className="text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                  {shareSuccess}
                </div>
              )}

              {usersLoading ? (
                <div className="flex items-center gap-2 text-[10px] text-slate-500 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Chargement des utilisateurs...
                </div>
              ) : (
                <div className="space-y-2">
                  {novaUsers
                    .filter((user) => {
                      if (user.uid === currentUser?.uid) return false;
                      // Absolute rule: users can ONLY share contacts with colleagues of the SAME company
                      if (userProfile?.role === 'super_admin' || userProfile?.agencyIds?.includes('all')) {
                        return true;
                      }
                      const currentAgencies = userProfile?.agencyIds || [activeAgency.id];
                      const targetAgencies = user.agencyIds || [];
                      return targetAgencies.some((ag) => currentAgencies.includes(ag) || matchesAgency(selectedContact.agencyId, ag));
                    })
                    .map((user) => {
                      const isShared = Array.isArray(selectedContact.sharedWithUserIds)
                        && selectedContact.sharedWithUserIds.includes(user.uid);

                      const sameAgency =
                        Array.isArray(user.agencyIds) &&
                        user.agencyIds.some((agencyId) =>
                          matchesAgency(selectedContact.agencyId, agencyId)
                        );

                      return (
                        <button
                          type="button"
                          key={user.uid}
                          onClick={() => void handleToggleShare(user)}
                          disabled={selectedContact.ownerUserId !== currentUser?.uid}
                          className={`w-full p-3 rounded-xl border flex items-center justify-between gap-3 transition-all text-left ${
                            isShared
                              ? 'bg-violet-500/10 border-violet-500/35'
                              : 'bg-white/5 border-white/10 hover:bg-white/10'
                          } disabled:opacity-55 disabled:cursor-not-allowed`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {user.photoURL ? (
                              <img
                                src={user.photoURL}
                                alt={user.displayName}
                                className="w-8 h-8 rounded-full object-cover border border-white/10 shrink-0"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-violet-500/15 border border-violet-500/20 text-violet-300 flex items-center justify-center text-[10px] font-black shrink-0">
                                {user.displayName
                                  .split(/\s+/)
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((part) => part[0]?.toUpperCase())
                                  .join('')}
                              </div>
                            )}

                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-white truncate">
                                {user.displayName}
                              </div>

                              <div className="text-[9px] text-slate-500 truncate">
                                {user.email}
                                {sameAgency ? ' • même structure' : ' • autre structure'}
                              </div>
                            </div>
                          </div>

                          <div
                            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                              isShared
                                ? 'bg-violet-500 border-violet-400 text-white'
                                : 'border-white/20 text-transparent'
                            }`}
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                          </div>
                        </button>
                      );
                    })}

                  {novaUsers.filter((user) => user.uid !== currentUser?.uid).length === 0 && (
                    <div className="text-[10px] text-slate-500 p-3 border border-dashed border-white/10 rounded-xl text-center">
                      Aucun autre utilisateur actif n'est encore enregistré dans Nova CRM.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Structure & User Assignment Management Card */}
            <div className="p-4 rounded-2xl bg-[#030d0f] border border-[#153c3f] space-y-3">
              <h4 className="text-[10px] uppercase font-bold text-[#F9C977] tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" />
                <span>Rattachement Structure & Agent</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Structure / Société</label>
                  <select
                    value={AGENCIES.find(a => matchesAgency(selectedContact.agencyId, a.id) && a.id !== 'all')?.id || AGENCIES[0].id}
                    onChange={async (e) => {
                      const newAgId = e.target.value;
                      await updateContact.mutateAsync({ id: selectedContact.id, updates: { agencyId: newAgId } });
                      setSelectedContact({ ...selectedContact, agencyId: newAgId });
                    }}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                  >
                    {AGENCIES.filter(a => a.id !== 'all').map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Utilisateur Lié (Agent)</label>
                  <select
                    // Signalé : « cela reste au premier qui est mis ». La
                    // valeur affichée passait par getAssignedUser(), qui
                    // retombe sur TEAM_MEMBERS[0] (Sylvain Grazia) dès que
                    // l'identifiant n'est pas dans la liste figée — donc
                    // pour tout collaborateur réel. Le champ ne reflétait
                    // jamais l'attribution enregistrée et revenait au
                    // premier nom après chaque changement. On lit
                    // directement la valeur stockée.
                    value={selectedContact.assignedTo || ''}
                    onChange={async (e) => {
                      const newUserId = e.target.value;
                      await updateContact.mutateAsync({ id: selectedContact.id, updates: { assignedTo: newUserId } });
                      setSelectedContact({ ...selectedContact, assignedTo: newUserId });
                    }}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                  >
                    {assignableUsers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Quick Actions Panel */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setShowQuestionnaire(true);
                  setShowAddDealForm(false);
                }}
                className="p-3 bg-[#F7BC5F]/10 hover:bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 hover:border-[#F7BC5F]/50 rounded-2xl text-left transition-all cursor-pointer group"
              >
                <Landmark className="w-5 h-5 text-[#F9C977] mb-1 group-hover:scale-105 transition-transform" />
                <div className="text-[11px] font-bold text-white">Wealth Discovery</div>
                <div className="text-[9px] text-slate-400">Questionnaire patrimoine</div>
              </button>
              <button
                onClick={() => {
                  setShowAddDealForm(true);
                  setShowQuestionnaire(false);
                }}
                className="p-3 bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/30 hover:border-teal-500/50 rounded-2xl text-left transition-all cursor-pointer group"
              >
                <Award className="w-5 h-5 text-teal-400 mb-1 group-hover:scale-105 transition-transform" />
                <div className="text-[11px] font-bold text-white">Créer Affaire</div>
                <div className="text-[9px] text-slate-400">Valoriser une opportunité</div>
              </button>
            </div>

            {/* Patrimony results panel */}
            {selectedContact.revenus && selectedContact.revenus > 0 ? (
              <div className="p-4 rounded-2xl bg-black/40 border border-[#143c3f] space-y-3">
                <h4 className="text-[10px] uppercase font-bold text-[#F9C977] tracking-wider">Données Découvertes Patrimoniales</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div>
                    <span className="text-slate-400 block">Revenus annuels:</span>
                    <span className="font-extrabold text-white">{formatCurrency(selectedContact.revenus)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Apport personnel:</span>
                    <span className="font-extrabold text-white">{formatCurrency(selectedContact.apport || 0)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Encours mensuels:</span>
                    <span className="font-extrabold text-white">{formatCurrency(selectedContact.credits || 0)}/mois</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Type de Contrat:</span>
                    <span className="font-extrabold text-white">{selectedContact.contractType || 'CDI'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 block">Projet d'acquisition:</span>
                    <span className="font-extrabold text-[#F7BC5F]">{selectedContact.projectType || 'Résidence Principale'}</span>
                  </div>
                  {selectedContact.coBorrower && (
                    <div className="col-span-2">
                      <span className="text-slate-400 block">Co-emprunteur:</span>
                      <span className="font-extrabold text-slate-200">{selectedContact.coBorrower}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-black/20 border border-dashed border-[#143c3f]/60 text-center text-xs text-slate-500">
                Aucun questionnaire patrimoine renseigné. Utilisez "Wealth Discovery" pour cartographier ses besoins de prêt.
              </div>
            )}

            {/* Active Sub-forms */}
            {showQuestionnaire && (
              <form onSubmit={handleSaveQuestionnaire} className="p-4 rounded-2xl bg-teal-950/20 border border-[#F7BC5F]/20 space-y-3 animate-slide-up">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-[#F9C977] uppercase tracking-widest">Questionnaire Confidentiel</h4>
                  <button type="button" onClick={() => setShowQuestionnaire(false)} className="text-slate-400 hover:text-white text-xs">Annuler</button>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Revenus annuels (€)</label>
                    <input
                      type="number"
                      value={revenus}
                      onChange={(e) => setRevenus(e.target.value)}
                      className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Apport personnel (€)</label>
                    <input
                      type="number"
                      value={apport}
                      onChange={(e) => setApport(e.target.value)}
                      className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Mensualités crédits (€)</label>
                    <input
                      type="number"
                      value={credits}
                      onChange={(e) => setCredits(e.target.value)}
                      className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Nature Contrat Pro</label>
                    <select
                      value={contractType}
                      onChange={(e) => setContractType(e.target.value)}
                      className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                    >
                      <option value="CDI">CDI (Essai validé)</option>
                      <option value="CDD">CDD</option>
                      <option value="Fonctionnaire">Fonctionnaire</option>
                      <option value="TNS">TNS / Indépendant</option>
                      <option value="Interim">Intérimaire / Saisonnier</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Nature de l'Acquisition</label>
                  <select
                    value={projectType}
                    onChange={(e) => setProjectType(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    <option value="Résidence Principale">Résidence Principale</option>
                    <option value="Résidence Secondaire">Résidence Secondaire</option>
                    <option value="Investissement Locatif Pinel">Investissement Locatif (LMNP/Pinel)</option>
                    <option value="Rachat de Soulte">Rachat de Soulte / Regroupement</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Co-emprunteur (Époux/Partenaire)</label>
                  <input
                    type="text"
                    placeholder="Nom complet du partenaire"
                    value={coBorrower}
                    onChange={(e) => setCoBorrower(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2 rounded-xl bg-[#F7BC5F] text-slate-950 text-xs font-black cursor-pointer shadow-lg mt-2"
                >
                  Enregistrer les données patrimoniales
                </button>
              </form>
            )}

            {showAddDealForm && (
              <form onSubmit={handleCreateDeal} className="p-4 rounded-2xl bg-teal-950/20 border border-teal-500/20 space-y-3 animate-slide-up">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-teal-400 uppercase tracking-widest">Nouveau Dossier Affaire</h4>
                  <button type="button" onClick={() => setShowAddDealForm(false)} className="text-slate-400 hover:text-white text-xs">Annuler</button>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Titre de l'Affaire</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Prêt Immo Résidence Principale"
                    value={dealTitle}
                    onChange={(e) => setDealTitle(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-0.5">Montant Estimé du Prêt (€)</label>
                  <input
                    type="number"
                    required
                    value={dealAmount}
                    onChange={(e) => setDealAmount(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2 py-1 text-xs text-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2 rounded-xl bg-teal-500 text-white text-xs font-bold cursor-pointer shadow-lg mt-2"
                >
                  Valider et Lancer l'Affaire
                </button>
              </form>
            )}

            {/* General comments section */}
            <div className="space-y-2">
              <h4 className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Commentaires de Suivi</h4>
              <textarea
                placeholder="Renseignez des notes complémentaires d'entretien..."
                value={selectedContact.comments || ''}
                onChange={(e) => updateContact.mutateAsync({ id: selectedContact.id, updates: { comments: e.target.value } })}
                className="w-full h-24 bg-black/40 border border-[#143c3f] rounded-xl p-3 text-xs text-white focus:outline-none focus:border-teal-500 placeholder-slate-600 resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="p-12 text-center text-xs text-slate-500 bg-[#07191b] border border-[#144447]/60 rounded-3xl h-full flex flex-col items-center justify-center gap-2">
            <User className="w-8 h-8 text-slate-600" />
            <span>Sélectionnez un client dans la liste de gauche pour consulter sa fiche détaillée et gérer ses droits & données patrimoniales.</span>
          </div>
        )}
      </div>
    </div>
  );
}
