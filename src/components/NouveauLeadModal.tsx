import React, { useEffect, useState } from 'react';
import { X, UserPlus, Building, Building2, ChevronDown, ChevronUp, User, Briefcase, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Contact, AGENCIES } from '@/types';
import { supabase } from '@/lib/supabase';
import { formatVille } from '@/lib/utils';

interface NouveauLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (contact: Omit<Contact, 'id' | 'createdAt'>) => Promise<unknown>;
  selectedAgencyId: string;
}

// Capitalize first letter of each word (e.g. "jean-pierre" -> "Jean-Pierre")
const formatFirstName = (text: string) => {
  if (!text) return '';
  return text.toLowerCase().replace(/(^|[\s-])([a-zàáâäãåçèéêëìíîïñòóôöõøùúûüýÿ])/g, (_m, sep, c) => sep + c.toUpperCase());
};

// Force full uppercase (e.g. "dupont" -> "DUPONT")
const formatLastName = (text: string) => {
  if (!text) return '';
  return text.toUpperCase();
};

export const NouveauLeadModal: React.FC<NouveauLeadModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  selectedAgencyId,
}) => {
  // Main contact
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Qualification & Project
  const [clientType, setClientType] = useState('Acheteur');
  const [contactType, setContactType] = useState('Particulier');
  const [budgetMax, setBudgetMax] = useState<number | ''>('');
  const [secteur, setSecteur] = useState('');
  const [typeBien, setTypeBien] = useState('');

  // Pipeline & Status
  // Signalé : « en agence ImmoSphera, la création de client propose les
  // pipelines de Conseils Finances ». La liste était codée en dur avec quatre
  // ÉTAPES de Conseils Finances, sans aucun lien avec l'agence. Pire : la
  // valeur part dans `pipeline_id` après `toValidUuidOrNull()` (voir
  // useContacts) — un nom n'étant pas un UUID, le choix était silencieusement
  // remplacé par null et aucun pipeline n'était jamais enregistré.
  // La liste vient maintenant de la table `pipelines`, filtrée sur l'agence
  // du lead, et les valeurs sont les vrais identifiants.
  const [pipeline, setPipeline] = useState('');
  const [agencyPipelines, setAgencyPipelines] = useState<{ id: string; name: string }[]>([]);
  const [statutLead, setStatutLead] = useState('froid');
  // Renommé « Commission agence » (demande ImmoSphera). S'y ajoutent la
  // commission du conseiller, saisie TTC, et le numéro de mandat.
  const [honoraires, setHonoraires] = useState<number | ''>('');
  const [advisorCommission, setAdvisorCommission] = useState<number | ''>('');
  const [mandateNumber, setMandateNumber] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [comments, setComments] = useState('');

  // Signalé : « insert or update on table "leads" violates foreign key
  // constraint "leads_assigned_to_fkey" » à la création d'un contact
  // ImmoSphera. La liste « Attribuer à » venait d'un fichier codé en dur
  // (src/data/teamMembers.ts) dont les identifiants ne correspondaient plus à
  // la base : sur 16 personnes proposées, 11 n'avaient aucun compte et 2
  // existaient sous un autre identifiant. Choisir l'une de ces 13 faisait
  // échouer l'enregistrement. La liste est désormais lue dans `profiles`,
  // la table qui fait foi et que référence la contrainte — un identifiant
  // proposé est donc toujours valide.
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; name: string; jobTitle?: string }[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setUsersLoading(true);
      try {
        // Le rattachement aux agences vit dans `agency_members` ; quand il est
        // renseigné, on ne propose que les collaborateurs de la société du
        // lead. Sinon (table vide, collaborateur multi-agences), on propose
        // tout le monde plutôt que de bloquer l'attribution.
        const [{ data: profiles }, { data: members }, { data: pipelines }] = await Promise.all([
          supabase.from('profiles').select('id, full_name, email, job_title'),
          supabase.from('agency_members').select('user_id, agency_id'),
          supabase.from('pipelines').select('id, name, agency_id').order('name'),
        ]);
        if (cancelled) return;

        const scopedPipelines = (pipelines || [])
          .filter((pl: { agency_id: string }) => selectedAgencyId === 'all' || pl.agency_id === selectedAgencyId)
          .map((pl: { id: string; name: string }) => ({ id: pl.id, name: pl.name }));
        setAgencyPipelines(scopedPipelines);
        setPipeline((current) => (current && !scopedPipelines.some((pl) => pl.id === current) ? '' : current));
        const idsForAgency = new Set(
          (members || []).filter((m: { agency_id: string }) => m.agency_id === selectedAgencyId)
            .map((m: { user_id: string }) => m.user_id)
        );
        const rows = (profiles || [])
          .filter((p: { id: string }) => idsForAgency.size === 0 || idsForAgency.has(p.id))
          .map((p: { id: string; full_name: string | null; email: string | null; job_title: string | null }) => ({
            id: p.id,
            name: p.full_name || p.email || 'Membre',
            jobTitle: p.job_title || undefined,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        setAssignableUsers(rows);
        // Une valeur choisie puis devenue invalide (changement de société)
        // est effacée : mieux vaut « non attribué » qu'un enregistrement
        // refusé par la base.
        setAssignedTo((current) => (current && !rows.some((r) => r.id === current) ? '' : current));
      } catch (error) {
        console.error('Impossible de charger les collaborateurs :', error);
        if (!cancelled) setAssignableUsers([]);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, selectedAgencyId]);

  // Collapsible sections
  const [showCoContact, setShowCoContact] = useState(false);
  const [coFirstName, setCoFirstName] = useState('');
  const [coLastName, setCoLastName] = useState('');
  const [coEmail, setCoEmail] = useState('');
  const [coPhone, setCoPhone] = useState('');

  const [showCompany, setShowCompany] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [siret, setSiret] = useState('');
  const [companyRole, setCompanyRole] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyZip, setCompanyZip] = useState('');
  const [companyCity, setCompanyCity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const currentAgency = AGENCIES.find(a => a.id === selectedAgencyId) || AGENCIES[0];

  // Ticket #119 : `status` est un affichage plus large ('Froid'/'Tiède'/
  // 'Chaud' avec majuscule+accent) que la vraie valeur enregistrée en base
  // (`statutLead`, qui doit être l'enum Postgres exact 'froid'/'tiede'/
  // 'chaud') — on dérive l'un de l'autre au lieu de les faire diverger.
  const STATUT_LABELS: Record<string, 'Froid' | 'Tiède' | 'Chaud'> = {
    froid: 'Froid',
    tiede: 'Tiède',
    chaud: 'Chaud',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() && !lastName.trim()) return;
    if (submitting) return;

    const formattedFirstName = formatFirstName(firstName.trim());
    const formattedLastName = formatLastName(lastName.trim());

    // Build coBorrower string if filled
    let coBorrowerInfo = '';
    if (coFirstName.trim() || coLastName.trim()) {
      const fCoFirst = formatFirstName(coFirstName.trim());
      const fCoLast = formatLastName(coLastName.trim());
      coBorrowerInfo = `${fCoFirst} ${fCoLast}`.trim();
      if (coPhone) coBorrowerInfo += ` (${coPhone})`;
      if (coEmail) coBorrowerInfo += ` [${coEmail}]`;
    }

    // Append company info to comments if provided
    let companyComments = '';
    if (showCompany && companyName.trim()) {
      companyComments = `\n[Société]: ${companyName.trim()}${siret ? ` (SIRET: ${siret})` : ''}${companyRole ? ` - Poste: ${companyRole}` : ''}${companyAddress ? ` - Adresse: ${companyAddress} ${companyZip} ${companyCity}` : ''}`;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: `${formattedFirstName} ${formattedLastName}`.trim() || 'Nouveau Prospect',
        email: email.trim(),
        phone: phone.trim(),
        agencyId: selectedAgencyId,
        status: STATUT_LABELS[statutLead] || 'Froid',
        contactType,
        clientType,
        budgetMax: budgetMax === '' ? 0 : Number(budgetMax),
        secteur: formatVille(secteur.trim()),
        typeBien: typeBien.trim(),
        pipeline,
        statutLead,
        // Saisi en TTC, stocké en HT — voir EditClientModal et lib/utils.
        honoraires: honoraires === '' ? 0 : Math.round((Number(honoraires) / 1.2) * 100) / 100,
        advisorCommissionTtc: advisorCommission === '' ? undefined : Number(advisorCommission),
        mandateNumber: mandateNumber.trim() || undefined,
        comments: (comments.trim() + companyComments).trim(),
        coBorrower: coBorrowerInfo || undefined,
        assignedTo: assignedTo || undefined,
      });
      // Ticket #119 : avant, `onClose()` était appelé immédiatement après
      // avoir déclenché `onSubmit` SANS attendre le résultat — la modale se
      // fermait donc même quand l'enregistrement échouait en base,
      // laissant croire que le lead avait bien été créé alors qu'il ne
      // l'était pas, sans aucun message d'erreur.
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Impossible de créer ce lead. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-[#061a1d] border border-[#144447] rounded-2xl shadow-2xl my-auto overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#07191b] border-b border-[#144447]/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#F7BC5F]/20 border border-[#F7BC5F]/40 flex items-center justify-center text-[#F7BC5F]">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white tracking-tight leading-none">Informations du lead</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">Saisissez les informations de votre nouveau prospect</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white bg-black/30 hover:bg-black/60 transition-colors"
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body - Compact, Minimal Scrolling */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 custom-scrollbar flex-1">
          <form id="new-lead-form" onSubmit={handleSubmit} className="space-y-4">
            
            {/* SECTION 1: CONTACT PRINCIPAL */}
            <div className="bg-[#030d0f] border border-[#153c3f] rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-[#153c3f]/80 pb-2">
                <span className="text-xs font-bold text-[#F7BC5F] uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  Contact principal
                </span>
                <span className="text-[11px] text-slate-400 font-mono">* Saisie automatique: Nom en MAJUSCULES, Prénom avec Majuscule</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Prénom */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">
                    Prénom <span className="text-[#F9C977]">*</span>
                  </label>
                  <input
                    data-tour="lead-firstname-field"
                    type="text"
                    placeholder="ex: Jean-Pierre"
                    value={firstName}
                    onChange={(e) => setFirstName(formatFirstName(e.target.value))}
                    required
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>

                {/* Nom */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">
                    Nom <span className="text-[#F9C977]">*</span>
                  </label>
                  <input
                    data-tour="lead-name-field"
                    type="text"
                    placeholder="ex: DUPONT"
                    value={lastName}
                    onChange={(e) => setLastName(formatLastName(e.target.value))}
                    required
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white font-bold placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors uppercase"
                  />
                </div>

                {/* Téléphone */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Téléphone</label>
                  <input
                    data-tour="lead-phone-field"
                    type="tel"
                    placeholder="06 12 34 56 78"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Email</label>
                  <input
                    data-tour="lead-email-field"
                    type="email"
                    placeholder="contact@exemple.fr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* SECTION 2: QUALIFICATION & TYPOLOGIE */}
            <div className="bg-[#030d0f] border border-[#153c3f] rounded-xl p-4 space-y-4">
              <span className="text-xs font-bold text-[#F7BC5F] uppercase tracking-wider flex items-center gap-1.5 border-b border-[#153c3f]/80 pb-2 block">
                <Briefcase className="w-3.5 h-3.5" />
                Qualification & Pipeline
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Type */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Type</label>
                  <div className="relative">
                    <select
                      value={clientType}
                      onChange={(e) => setClientType(e.target.value)}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 pr-7 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
                    >
                      <option value="Acheteur">Acheteur</option>
                      <option value="Vendeur">Vendeur</option>
                      <option value="Locataire">Locataire</option>
                      <option value="Investisseur">Investisseur</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                {/* Type de contact */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Type de contact</label>
                  <div className="relative">
                    <select
                      value={contactType}
                      onChange={(e) => setContactType(e.target.value)}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 pr-7 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
                    >
                      <option value="Particulier">Particulier</option>
                      <option value="Professionnel">Professionnel</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                {/* Pipeline */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Pipeline</label>
                  <div className="relative">
                    <select
                      value={pipeline}
                      onChange={(e) => setPipeline(e.target.value)}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 pr-7 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
                    >
                      <option value="">Aucun (libre)</option>
                      {agencyPipelines.map((pl) => (
                        <option key={pl.id} value={pl.id}>{pl.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                {/* Statut du lead */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Statut du lead</label>
                  <div className="relative">
                    <select
                      value={statutLead}
                      onChange={(e) => setStatutLead(e.target.value)}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 pr-7 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
                    >
                      {/* Ticket #119 : les valeurs devaient être celles de
                          l'enum Postgres `lead_temperature` (froid/tiede/
                          chaud) — avant, c'était un libellé descriptif
                          complet ("Froid - Prospect peu intéressé"), rejeté
                          par la base à chaque création, sans message
                          d'erreur visible pour l'utilisateur. */}
                      <option value="froid">🔵 Froid - Peu intéressé</option>
                      <option value="tiede">🟠 Tiède - Intérêt modéré</option>
                      <option value="chaud">🔴 Chaud - Très intéressé</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 3: PROJET & FINANCIER */}
            <div className="bg-[#030d0f] border border-[#153c3f] rounded-xl p-4 space-y-4">
              <span className="text-xs font-bold text-[#F7BC5F] uppercase tracking-wider flex items-center gap-1.5 border-b border-[#153c3f]/80 pb-2 block">
                <FileText className="w-3.5 h-3.5" />
                Projet & Cible Financière
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Budget Max */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Budget max (€)</label>
                  <input
                    type="number"
                    placeholder="ex: 250000"
                    value={budgetMax}
                    onChange={(e) => setBudgetMax(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                  />
                </div>

                {/* Secteur */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Secteur</label>
                  <input
                    type="text"
                    placeholder="Secteur / Ville"
                    value={secteur}
                    onChange={(e) => setSecteur(e.target.value)}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>

                {/* Type de bien */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Type de bien</label>
                  <input
                    type="text"
                    placeholder="Maison, Appartement..."
                    value={typeBien}
                    onChange={(e) => setTypeBien(e.target.value)}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>

                {/* Commission agence — anciennement « Honoraires ». C'est le
                    chiffre d'affaires de l'agence, celui qui alimente les
                    statistiques ; saisi en HT. */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Commission agence (€ TTC)</label>
                  <input
                    type="number"
                    placeholder="ex: 5000"
                    value={honoraires}
                    onChange={(e) => setHonoraires(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                  />
                </div>

                {/* Commission du conseiller — saisie TTC, affichée HT ailleurs. */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Commission conseiller (€ TTC)</label>
                  <input
                    type="number"
                    placeholder="ex: 3000"
                    value={advisorCommission}
                    onChange={(e) => setAdvisorCommission(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                  />
                </div>

                {/* Numéro de mandat */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Numéro de mandat</label>
                  <input
                    placeholder="ex: 2026-0142"
                    value={mandateNumber}
                    onChange={(e) => setMandateNumber(e.target.value)}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* SECTION 4: SOCIÉTÉ, ATTRIBUTION & COMMENTAIRES (Compact Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
              
              {/* Left Column: Société Rattachée & Attribuer à */}
              <div className="md:col-span-5 bg-[#030d0f] border border-[#153c3f] rounded-xl p-3 space-y-3">
                {/* Société Badge */}
                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[#07191b] border border-[#144447]">
                  <div className="w-8 h-8 rounded-md bg-[#F7BC5F]/10 border border-[#F7BC5F]/30 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-[#F7BC5F]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Société du lead</p>
                    <p className="text-xs font-bold text-white truncate">{currentAgency.name}</p>
                  </div>
                </div>

                {/* Attribuer à */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Attribuer à l'utilisateur / agent</label>
                  <div className="relative">
                    <select
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 pr-7 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
                    >
                      <option value="">{usersLoading ? 'Chargement…' : '— Non attribué —'}</option>
                      {assignableUsers.map(m => (
                        <option key={m.id} value={m.id}>{m.jobTitle ? `${m.name} (${m.jobTitle})` : m.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Right Column: Commentaires */}
              <div className="md:col-span-7 bg-[#030d0f] border border-[#153c3f] rounded-xl p-3 space-y-1.5">
                <label className="block text-xs font-bold text-slate-200">Commentaires</label>
                <textarea
                  rows={3}
                  placeholder="Informations complémentaires sur le prospect..."
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] resize-none"
                />
              </div>
            </div>

            {/* SECTION 5: OPTIONS SUPPLÉMENTAIRES PLIABLES (COLLAPSIBLES TO MINIMIZE SCROLL) */}
            <div className="space-y-2 pt-1">
              
              {/* Toggle 1: Deuxième personne (conjoint) */}
              <div className="bg-[#030d0f] border border-[#153c3f] rounded-xl overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => setShowCoContact(!showCoContact)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-slate-200 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-[#F7BC5F]" />
                    <span>Deuxième personne (conjoint, co-contact)</span>
                  </div>
                  <span className="text-[11px] text-[#F9C977] font-semibold flex items-center gap-1">
                    {showCoContact ? (
                      <>Masquer <ChevronUp className="w-3.5 h-3.5" /></>
                    ) : (
                      <>+ Ajouter <ChevronDown className="w-3.5 h-3.5" /></>
                    )}
                  </span>
                </button>

                {showCoContact && (
                  <div className="p-3.5 border-t border-[#153c3f] bg-[#07191b]/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-200">Prénom conjoint</label>
                      <input
                        type="text"
                        placeholder="ex: Marie"
                        value={coFirstName}
                        onChange={(e) => setCoFirstName(formatFirstName(e.target.value))}
                        className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-200">Nom conjoint</label>
                      <input
                        type="text"
                        placeholder="ex: DUPONT"
                        value={coLastName}
                        onChange={(e) => setCoLastName(formatLastName(e.target.value))}
                        className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-[#F7BC5F] uppercase"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-200">Email conjoint</label>
                      <input
                        type="email"
                        placeholder="conjoint@exemple.fr"
                        value={coEmail}
                        onChange={(e) => setCoEmail(e.target.value)}
                        className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-200">Téléphone conjoint</label>
                      <input
                        type="tel"
                        placeholder="06 00 00 00 00"
                        value={coPhone}
                        onChange={(e) => setCoPhone(e.target.value)}
                        className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Toggle 2: Société (professionnel) */}
              <div className="bg-[#030d0f] border border-[#153c3f] rounded-xl overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => setShowCompany(!showCompany)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-slate-200 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-[#F7BC5F]" />
                    <span>Société (professionnel)</span>
                  </div>
                  <span className="text-[11px] text-[#F9C977] font-semibold flex items-center gap-1">
                    {showCompany ? (
                      <>Masquer <ChevronUp className="w-3.5 h-3.5" /></>
                    ) : (
                      <>+ Ajouter <ChevronDown className="w-3.5 h-3.5" /></>
                    )}
                  </span>
                </button>

                {showCompany && (
                  <div className="p-3.5 border-t border-[#153c3f] bg-[#07191b]/50 space-y-3 animate-fade-in">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-200">Nom de la société</label>
                        <input
                          type="text"
                          placeholder="Nom entreprise"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-200">SIRET</label>
                        <input
                          type="text"
                          placeholder="123 456 789 00012"
                          value={siret}
                          onChange={(e) => setSiret(e.target.value)}
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-200">Fonction / poste</label>
                        <input
                          type="text"
                          placeholder="ex: Gérant"
                          value={companyRole}
                          onChange={(e) => setCompanyRole(e.target.value)}
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                      <div className="sm:col-span-6 space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-200">Adresse (rue, n°)</label>
                        <input
                          type="text"
                          placeholder="12 rue de la République"
                          value={companyAddress}
                          onChange={(e) => setCompanyAddress(e.target.value)}
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </div>
                      <div className="sm:col-span-3 space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-200">Code postal</label>
                        <input
                          type="text"
                          placeholder="11100"
                          value={companyZip}
                          onChange={(e) => setCompanyZip(e.target.value)}
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] font-mono"
                        />
                      </div>
                      <div className="sm:col-span-3 space-y-1.5">
                        <label className="block text-xs font-semibold text-slate-200">Ville</label>
                        <input
                          type="text"
                          placeholder="Narbonne"
                          value={companyCity}
                          onChange={(e) => setCompanyCity(e.target.value)}
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>

          </form>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 py-3.5 bg-[#07191b] border-t border-[#144447]/80 flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Annuler
          </button>
          <button
            data-tour="lead-submit-button"
            type="submit"
            form="new-lead-form"
            disabled={submitting}
            className="px-5 py-2.5 bg-[#F7BC5F] hover:bg-[#d4a83b] text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg transition-all active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 stroke-[2.5] animate-spin" /> : <UserPlus className="w-4 h-4 stroke-[2.5]" />}
            <span>{submitting ? 'Création...' : 'Créer le lead'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default NouveauLeadModal;
