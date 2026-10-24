import React, { useState, useEffect } from 'react';
import { Contact, Deal, AGENCIES } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { 
  Search, Plus, Filter, User, Phone, Mail, Building2, 
  Trash2, FileSpreadsheet, Award, Landmark, UserPlus, 
  ChevronRight, Calendar, Sparkles, X, CheckSquare, Users, UserCheck, Shield
} from 'lucide-react';
import { useContacts, matchesAgency } from '@/hooks/useContacts';
import { useAuth } from '@/context/AuthContext';
import { TEAM_MEMBERS, getAssignedUser } from '@/data/teamMembers';

interface ContactsProps {
  onAddDeal: (deal: Omit<Deal, 'id' | 'createdAt'>) => Promise<void>;
  onSelectContact?: (contactId: string) => void;
}

export default function Contacts({ 
  onAddDeal,
  onSelectContact
}: ContactsProps) {
  const { activeAgency } = useAuth();
  const { contacts, allContacts, isLoading, addContact, updateContact, deleteContact } = useContacts();

  // Selected Structure Tab (Defaults to activeAgency.id, but can switch to view each structure separately or all)
  const [selectedStructure, setSelectedStructure] = useState<string>(activeAgency.id);

  // Sync tab if user changes global active agency in header/sidebar
  useEffect(() => {
    setSelectedStructure(activeAgency.id);
  }, [activeAgency.id]);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assignedUserFilter, setAssignedUserFilter] = useState<string>('all');

  // Selected Contact for Detail view
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Modals / Form displays
  const [showAddForm, setShowAddForm] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [showAddDealForm, setShowAddDealForm] = useState(false);

  // New Contact Form fields
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAgencyId, setNewAgencyId] = useState(AGENCIES[0].id);
  const [newAssignedTo, setNewAssignedTo] = useState(TEAM_MEMBERS[0].id);
  const [newStatus, setNewStatus] = useState<Contact['status']>('Nouveau');

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

  // Counts per structure across database
  const totalAllCount = (allContacts || []).length;
  const conseilsFinancesCount = (allContacts || []).filter(c => matchesAgency(c.agencyId, '30f96ea9-41da-41c2-a95e-f5e7898f8d8e')).length;
  const novavisioCount = (allContacts || []).filter(c => matchesAgency(c.agencyId, '0cd9362c-316e-4b57-af0b-b6cea092961b')).length;
  const immospheraCount = (allContacts || []).filter(c => matchesAgency(c.agencyId, '15157da9-71ea-4760-ae1c-3bc99d9caa20')).length;

  // Filtering Logic
  const filteredContacts = (allContacts || []).filter(c => {
    const matchesStruct = matchesAgency(c.agencyId, selectedStructure);
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
                          c.email.toLowerCase().includes(search.toLowerCase()) ||
                          c.phone.includes(search);
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    
    const assignedUser = getAssignedUser(c.assignedTo);
    const matchesUser = assignedUserFilter === 'all' || 
                        c.assignedTo === assignedUserFilter || 
                        assignedUser.id === assignedUserFilter ||
                        assignedUser.name.toLowerCase().includes(assignedUserFilter.toLowerCase());

    return matchesStruct && matchesSearch && matchesStatus && matchesUser;
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
    await addContact.mutateAsync({
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
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 animate-fade-in items-start">
      {/* List side */}
      <div className="xl:col-span-2 space-y-6">
        {/* Title bar with dynamic contact counter */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 rounded-2xl bg-[#07191b] border border-[#144447]">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-white tracking-tight">Répertoire des Prospects & Clients</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Vue actuelle : <span className="text-amber-400 font-semibold">
                {selectedStructure === 'all' ? 'Toutes les sociétés (Vue Admin Consolidée)' : AGENCIES.find(a => a.id === selectedStructure)?.name || 'Structure'}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Nouveau Contact</span>
            </button>
            <div className="flex items-center gap-2.5 bg-[#030d0f] border border-[#153c3f] px-4 py-2 rounded-xl shadow-inner">
              <Users className="w-5 h-5 text-[#E5B842]" />
              <div className="leading-tight">
                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Effectif affiché</p>
                <p className="text-lg font-black text-white">
                  {filteredContacts.length} <span className="text-xs font-normal text-gray-400">contact(s)</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Structure Selector Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedStructure('all')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${
              selectedStructure === 'all'
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/20'
                : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Toutes les structures</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${selectedStructure === 'all' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-amber-400'}`}>
              {totalAllCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStructure('30f96ea9-41da-41c2-a95e-f5e7898f8d8e')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${
              selectedStructure === '30f96ea9-41da-41c2-a95e-f5e7898f8d8e'
                ? 'bg-[#d4a843] text-slate-950 border-amber-300 shadow-lg shadow-amber-500/20'
                : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>Conseils Finances</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${selectedStructure === '30f96ea9-41da-41c2-a95e-f5e7898f8d8e' ? 'bg-slate-950/30 text-slate-950' : 'bg-amber-500/10 text-amber-400'}`}>
              {conseilsFinancesCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStructure('0cd9362c-316e-4b57-af0b-b6cea092961b')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${
              selectedStructure === '0cd9362c-316e-4b57-af0b-b6cea092961b'
                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-500/20'
                : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Novavisio</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${selectedStructure === '0cd9362c-316e-4b57-af0b-b6cea092961b' ? 'bg-slate-950/30 text-slate-950' : 'bg-emerald-500/10 text-emerald-400'}`}>
              {novavisioCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedStructure('15157da9-71ea-4760-ae1c-3bc99d9caa20')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition-all border shrink-0 ${
              selectedStructure === '15157da9-71ea-4760-ae1c-3bc99d9caa20'
                ? 'bg-blue-500 text-white border-blue-400 shadow-lg shadow-blue-500/20'
                : 'bg-[#030d0f] text-slate-300 border-[#153c3f] hover:border-[#256064]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Immosphera</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${selectedStructure === '15157da9-71ea-4760-ae1c-3bc99d9caa20' ? 'bg-white/20 text-white' : 'bg-blue-500/10 text-blue-400'}`}>
              {immospheraCount}
            </span>
          </button>
        </div>

        {/* Filters and search box */}
        <div className="p-4 rounded-2xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow flex flex-col md:flex-row gap-3 transition-all duration-300">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Rechercher par nom, email ou téléphone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>
          <div className="flex flex-wrap sm:flex-nowrap gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-amber-500"
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
              className="bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-amber-500"
            >
              <option value="all">Tous les Utilisateurs / Agents</option>
              {TEAM_MEMBERS.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic add-contact form inside flow */}
        {showAddForm && (
          <form onSubmit={handleCreateContact} className="p-6 rounded-2xl bg-[#07191b] border border-amber-500/40 hover:border-amber-500/60 shadow-2xl space-y-4 animate-slide-up relative transition-all duration-300">
            <div className="absolute top-4 right-4">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)} 
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <h3 className="text-xs uppercase font-extrabold text-amber-500 tracking-widest flex items-center gap-2">
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
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
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
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
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
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Société / Structure</label>
                <select
                  value={newAgencyId}
                  onChange={(e) => setNewAgencyId(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
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
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  {TEAM_MEMBERS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Statut Initial</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as Contact['status'])}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="Nouveau">Nouveau</option>
                  <option value="Qualifié">Qualifié</option>
                  <option value="Proposition">Proposition</option>
                  <option value="En Négociation">En Négociation</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer shadow-lg transition-all"
              >
                Valider et Créer
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
                      <div className="w-10 h-10 rounded-2xl bg-[#143c3f]/60 border border-[#256064]/40 flex items-center justify-center text-amber-500 font-black uppercase tracking-tight shadow">
                        {c.name.substring(0, 2)}
                      </div>
                      <div>
                        <div className="text-xs font-black text-white flex items-center gap-2">
                          <span>{c.name}</span>
                          {c.revenus && c.revenus > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[8px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-widest font-extrabold">
                              Découvert
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                          <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-slate-500" /> {c.email}</span>
                          <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-slate-500" /> {c.phone}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2.5 justify-end sm:justify-start">
                      {/* Structure Badge */}
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                        agency.id === '0cd9362c-316e-4b57-af0b-b6cea092961b' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                        agency.id === '15157da9-71ea-4760-ae1c-3bc99d9caa20' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                        'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}>
                        {agency.name}
                      </span>

                      {/* Linked User Badge */}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#030d0f] border border-[#153c3f] text-[10px] font-medium text-slate-300">
                        <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 font-extrabold text-[8px] flex items-center justify-center">
                          {assignedUser.avatar}
                        </span>
                        <span>{assignedUser.name}</span>
                      </span>

                      {/* Status Badge */}
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${
                        c.status === 'Converti' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' :
                        c.status === 'Perdu' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/25' :
                        c.status === 'Nouveau' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25' :
                        'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                      }`}>
                        {c.status}
                      </span>
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
                <span className="text-[10px] uppercase font-bold text-amber-500 tracking-wider">Fiche de Synthèse Prospect</span>
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

            {/* Structure & User Assignment Management Card */}
            <div className="p-4 rounded-2xl bg-[#030d0f] border border-[#153c3f] space-y-3">
              <h4 className="text-[10px] uppercase font-bold text-amber-400 tracking-wider flex items-center gap-1.5">
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
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {AGENCIES.filter(a => a.id !== 'all').map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Utilisateur Lié (Agent)</label>
                  <select
                    value={getAssignedUser(selectedContact.assignedTo).id}
                    onChange={async (e) => {
                      const newUserId = e.target.value;
                      await updateContact.mutateAsync({ id: selectedContact.id, updates: { assignedTo: newUserId } });
                      setSelectedContact({ ...selectedContact, assignedTo: newUserId });
                    }}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {TEAM_MEMBERS.map(m => (
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
                className="p-3 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/30 hover:border-amber-500/50 rounded-2xl text-left transition-all cursor-pointer group"
              >
                <Landmark className="w-5 h-5 text-amber-400 mb-1 group-hover:scale-105 transition-transform" />
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
                <h4 className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Données Découvertes Patrimoniales</h4>
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
                    <span className="font-extrabold text-amber-500">{selectedContact.projectType || 'Résidence Principale'}</span>
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
              <form onSubmit={handleSaveQuestionnaire} className="p-4 rounded-2xl bg-teal-950/20 border border-amber-500/20 space-y-3 animate-slide-up">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-widest">Questionnaire Confidentiel</h4>
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
                  className="w-full py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black cursor-pointer shadow-lg mt-2"
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
