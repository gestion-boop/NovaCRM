import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, UserPlus, Building, Building2, ChevronDown, ChevronUp, User, Briefcase, FileText, Loader2, Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Contact, AGENCIES } from '@/types';
import { supabase } from '@/lib/supabase';
import { matchesAgency } from '@/hooks/useContacts';
import { formatVille, ttcDepuisHt } from '@/lib/utils';
import {
  ChampsSociete, ChampsConjoint, SOCIETE_VIDE, CONJOINT_VIDE, societeRenseignee,
  societeVersContact, societeDepuisContact, conjointVersTexte, conjointDepuisTexte, conjointRenseigne,
  type Societe, type Conjoint,
} from '@/components/leads/ChampsCommunsFiche';

interface NouveauLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (contact: Omit<Contact, 'id' | 'createdAt'>) => Promise<unknown>;
  selectedAgencyId: string;
  /**
   * Fiche existante : le formulaire s'ouvre pré-rempli, en mode
   * modification. Demandé le 3 septembre : « quand je fais Modifier, je veux
   * retomber sur les mêmes informations que quand je crée une fiche, pour
   * toutes les agences ». C'est donc le MÊME formulaire qui sert aux deux
   * (EditClientModal n'en est plus qu'une enveloppe), champ pour champ.
   */
  initial?: Contact;
}

/** Sépare « Prénom NOM (complément) » : les mots en MAJUSCULES forment le nom. */
const separerNom = (complet: string | undefined): { prenom: string; nom: string } => {
  const mots = (complet || '').trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return { prenom: '', nom: '' };
  const estMaj = (m: string) => m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase();
  const premierMaj = mots.findIndex(estMaj);
  if (premierMaj > 0) {
    return { prenom: mots.slice(0, premierMaj).join(' '), nom: mots.slice(premierMaj).join(' ') };
  }
  if (premierMaj === 0) return { prenom: '', nom: mots.join(' ') };
  if (mots.length === 1) return { prenom: '', nom: mots[0] };
  return { prenom: mots.slice(0, -1).join(' '), nom: mots[mots.length - 1] };
};

const temperatureDe = (c: Contact | undefined): string => {
  const raw = (c?.statutLead || c?.status || 'froid').toLowerCase();
  if (raw.startsWith('chaud')) return 'chaud';
  if (raw.startsWith('ti')) return 'tiede';
  return 'froid';
};

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

// ── Conseils Finances, demandé le 5 septembre : courtage et banque ──────────
// « Honoraires courtier : le courtier ne mettra rien, cela sera calculé
// comme tel : 80 % pour Eric Escourrou, 70 % pour Coralia, Lucie Perree et
// Karine Brebion » — sur les Honoraires agence de la même fiche. Le courtier
// est la personne à qui la fiche est attribuée ; on le reconnaît à son nom
// de famille plutôt qu'à un identifiant écrit en dur, qui deviendrait faux
// au premier changement de compte (même choix que « Natacha » sur le
// Tableau de bord).
const TAUX_COURTIER: { motif: RegExp; taux: number }[] = [
  { motif: /escourrou/i, taux: 0.8 },
  { motif: /ortega/i, taux: 0.7 },
  { motif: /perr[ée]e/i, taux: 0.7 },
  { motif: /brebion/i, taux: 0.7 },
];
const tauxCourtierPour = (nom: string): number | null =>
  TAUX_COURTIER.find((t) => t.motif.test(nom))?.taux ?? null;

// « Com banques : en fonction de la banque choisie », en pourcentage du
// montant du crédit du client. Taux donnés le 5 septembre : Caisse
// d'Épargne 0,5 %, Banque Populaire 0,25 %, Société Générale 1 % « on
// corrigera, cela dépend si le client est déjà client » (d'où un montant
// qui reste modifiable), Banque postale « je te dirai plus tard » (null :
// pas de calcul, saisie à la main en attendant).
export const BANQUES = ["Caisse d'Épargne", 'Banque Populaire', 'Banque postale', 'Société Générale'] as const;
const TAUX_BANQUE: Record<string, number | null> = {
  "Caisse d'Épargne": 0.005,
  'Banque Populaire': 0.0025,
  'Société Générale': 0.01,
  'Banque postale': null,
};
const pourcent = (taux: number) => `${(taux * 100).toLocaleString('fr-FR')} %`;

export const NouveauLeadModal: React.FC<NouveauLeadModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  selectedAgencyId,
  initial,
}) => {
  const modification = Boolean(initial);
  // Société de la fiche : imposée à la création (agence active), modifiable
  // en mode modification (la fiche peut être rangée sous une autre société).
  const [agencyId, setAgencyId] = useState(initial?.agencyId || selectedAgencyId);
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
  // Conseils Finances : courtage et banque (voir les taux en tête de fichier).
  // Les deux montants calculés restent des champs ordinaires : ils se
  // remplissent seuls, et se corrigent à la main si besoin.
  const [honorairesCourtier, setHonorairesCourtier] = useState<number | ''>('');
  const [montantCredit, setMontantCredit] = useState<number | ''>('');
  const [banqueChoisie, setBanqueChoisie] = useState('');
  const [comBanque, setComBanque] = useState<number | ''>('');
  // « Touché » : la personne a écrit elle-même dans la case — on ne
  // recalcule plus par-dessus, jusqu'à ce qu'une base du calcul (honoraires,
  // attribution, banque, montant du crédit) change à nouveau. « Auto » : la
  // dernière valeur que le calcul a posée, pour n'effacer que celle-là quand
  // la base disparaît, jamais une saisie.
  const courtierTouche = useRef(false);
  const courtierAuto = useRef<number | ''>('');
  const banqueTouche = useRef(false);
  const banqueAuto = useRef<number | ''>('');
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
          .filter((pl: { agency_id: string }) => agencyId === 'all' || pl.agency_id === agencyId)
          .map((pl: { id: string; name: string }) => ({ id: pl.id, name: pl.name }));
        setAgencyPipelines(scopedPipelines);
        setPipeline((current) => (current && !scopedPipelines.some((pl) => pl.id === current) ? '' : current));
        const idsForAgency = new Set(
          (members || []).filter((m: { agency_id: string }) => m.agency_id === agencyId)
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
  }, [isOpen, agencyId]);

  // Collapsible sections
  const [showCoContact, setShowCoContact] = useState(false);
  const [conjoint, setConjoint] = useState<Conjoint>({ ...CONJOINT_VIDE });

  // Société / professionnel : mêmes champs qu'à la modification (voir
  // leads/ChampsCommunsFiche). Le bloc s'ouvre de lui-même quand le type de
  // contact est « Professionnel », et reste ajoutable pour un particulier.
  const [showCompany, setShowCompany] = useState(false);
  const [societe, setSociete] = useState<Societe>({ ...SOCIETE_VIDE });
  // « CA devis à venir » (Novavisio) : existait à la modification, pas à la
  // création.
  const [caDevis, setCaDevis] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Novavisio, demandé le 2 septembre : « quand on crée le client aussi il
  // faut changer les données ». Mêmes champs retirés qu'à la modification.
  // `matchesAgency` et non un `===` : les identifiants d'agence hérités
  // (« novavisio », « agency-2 ») sont encore présents.
  const estNovavisio = /novavisio/i.test(
    AGENCIES.find((a) => matchesAgency(agencyId, a.id))?.name || ''
  );
  const estConseilsFinances = /conseils?\s*finances?/i.test(
    AGENCIES.find((a) => matchesAgency(agencyId, a.id))?.name || ''
  );

  // Signalé le 2 septembre : « quand je crée un client et que je le valide,
  // puis que j'en recrée un nouveau, j'ai les coordonnées de l'ancienne fiche
  // qui s'affichent — je dois faire un hard refresh ». La fenêtre n'est pas
  // démontée à la fermeture (`if (!isOpen) return null` juste en dessous) :
  // ses champs gardaient donc la saisie précédente. On repart d'un formulaire
  // vierge à chaque ouverture.
  useEffect(() => {
    if (!isOpen) return;
    const c = initial;
    const { prenom, nom } = separerNom(c?.name);
    const conj = conjointDepuisTexte(c?.coBorrower);
    const soc = c ? societeDepuisContact(c) : { ...SOCIETE_VIDE };
    setAgencyId(c?.agencyId || selectedAgencyId);
    setFirstName(prenom);
    setLastName(nom);
    setEmail(c?.email || '');
    setPhone(c?.phone || '');
    setClientType(c?.clientType || 'Acheteur');
    setContactType(c?.contactType || 'Particulier');
    setBudgetMax(c?.budgetMax ? Number(c.budgetMax) : '');
    setSecteur(c?.secteur || '');
    setTypeBien(c?.typeBien || c?.projectType || '');
    setPipeline(c?.pipeline || '');
    setStatutLead(temperatureDe(c));
    // Le HT est en base ; le formulaire se saisit en TTC.
    setHonoraires(c?.honoraires ? Math.round(ttcDepuisHt(c.honoraires) * 100) / 100 : '');
    setAdvisorCommission(c?.advisorCommissionTtc ? Number(c.advisorCommissionTtc) : '');
    setMandateNumber(c?.mandateNumber || '');
    setAssignedTo(c?.assignedTo || '');
    setComments(c?.comments || '');
    setShowCoContact(conjointRenseigne(conj));
    setConjoint(conj);
    setShowCompany(societeRenseignee(soc));
    setSociete(soc);
    setCaDevis(c?.caDevisAVenir ? String(c.caDevisAVenir) : '');
    // Courtage et banque : une valeur déjà enregistrée est gardée telle
    // quelle (elle a pu être corrigée à la main) tant qu'aucune base du
    // calcul ne change.
    setHonorairesCourtier(c?.honorairesCourtier ? Number(c.honorairesCourtier) : '');
    setMontantCredit(c?.montantCredit ? Number(c.montantCredit) : '');
    setBanqueChoisie(c?.banqueChoisie || '');
    setComBanque(c?.comBanque ? Number(c.comBanque) : '');
    courtierTouche.current = Boolean(c?.honorairesCourtier);
    courtierAuto.current = '';
    banqueTouche.current = Boolean(c?.comBanque);
    banqueAuto.current = '';
    setSubmitting(false);
  }, [isOpen, initial, selectedAgencyId]);

  // Taux du courtier : celui de la personne à qui la fiche est attribuée.
  const tauxCourtier = useMemo(
    () => tauxCourtierPour(assignableUsers.find((u) => u.id === assignedTo)?.name || ''),
    [assignableUsers, assignedTo]
  );
  const tauxBanque: number | null = banqueChoisie ? (TAUX_BANQUE[banqueChoisie] ?? null) : null;

  // Honoraires courtier = taux du courtier × honoraires agence, recalculé à
  // chaque changement de l'un ou l'autre — sauf si la case a été écrite à
  // la main depuis (voir courtierTouche).
  useEffect(() => {
    if (!isOpen || !estConseilsFinances || courtierTouche.current) return;
    if (tauxCourtier === null || honoraires === '' || Number(honoraires) <= 0) {
      // Plus de base : on n'efface que ce que le calcul avait posé lui-même.
      setHonorairesCourtier((v) => (v !== '' && v === courtierAuto.current ? '' : v));
      return;
    }
    const calcule = Math.round(Number(honoraires) * tauxCourtier * 100) / 100;
    courtierAuto.current = calcule;
    setHonorairesCourtier(calcule);
  }, [isOpen, estConseilsFinances, tauxCourtier, honoraires]);

  // Com banques = taux de la banque × montant du crédit, même règle.
  useEffect(() => {
    if (!isOpen || !estConseilsFinances || banqueTouche.current) return;
    if (tauxBanque === null || montantCredit === '' || Number(montantCredit) <= 0) {
      setComBanque((v) => (v !== '' && v === banqueAuto.current ? '' : v));
      return;
    }
    const calcule = Math.round(Number(montantCredit) * tauxBanque * 100) / 100;
    banqueAuto.current = calcule;
    setComBanque(calcule);
  }, [isOpen, estConseilsFinances, tauxBanque, montantCredit]);

  if (!isOpen) return null;

  const currentAgency = AGENCIES.find((a) => matchesAgency(agencyId, a.id)) || AGENCIES[0];

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

    const coBorrowerInfo = conjointRenseigne(conjoint) ? conjointVersTexte(conjoint) : '';
    const societeAEnregistrer = societeRenseignee(societe) ? societeVersContact(societe) : {};

    const courtageRenseigne =
      honorairesCourtier !== '' || montantCredit !== '' || banqueChoisie !== '' || comBanque !== '' ||
      Boolean(initial?.honorairesCourtier || initial?.montantCredit || initial?.banqueChoisie || initial?.comBanque);

    setSubmitting(true);
    try {
      // En modification, un champ vidé doit être effacé en base : on envoie
      // '' / 0 plutôt que `undefined` (que la mise à jour ignore).
      const vide = <T,>(valeurSiModif: T): T | undefined => (modification ? valeurSiModif : undefined);
      await onSubmit({
        name: `${formattedFirstName} ${formattedLastName}`.trim() || 'Nouveau Prospect',
        email: email.trim(),
        phone: phone.trim(),
        agencyId,
        status: STATUT_LABELS[statutLead] || 'Froid',
        contactType,
        clientType,
        budgetMax: budgetMax === '' ? 0 : Number(budgetMax),
        secteur: formatVille(secteur.trim()),
        typeBien: typeBien.trim(),
        pipeline,
        statutLead,
        // Saisi en TTC, stocké en HT — voir lib/utils.
        honoraires: honoraires === '' ? 0 : Math.round((Number(honoraires) / 1.2) * 100) / 100,
        advisorCommissionTtc: advisorCommission === '' ? vide(0) : Number(advisorCommission),
        mandateNumber: mandateNumber.trim() || vide(''),
        comments: comments.trim(),
        // Signalé le 2 septembre : l'identité du professionnel doit être
        // visible dans le panneau Gestion des clients. Colonne JSON dédiée
        // (nom, SIRET, fonction, adresse, code postal, ville).
        ...(modification ? societeVersContact(societe) : societeAEnregistrer),
        caDevisAVenir: caDevis.trim() === '' ? vide(0) : Number(caDevis.trim().replace(',', '.')),
        coBorrower: coBorrowerInfo || vide(''),
        assignedTo: assignedTo || vide(''),
        // Courtage et banque : seulement sur Conseils Finances, où les cases
        // existent — ailleurs on n'écrit rien dans ces colonnes. Et seulement
        // si quelque chose y est (ou y était) renseigné : une fiche qui n'en
        // a pas ne touche pas ces colonnes, ce qui la laisse enregistrable
        // même avant que la migration SQL du 5 septembre soit passée.
        ...(estConseilsFinances && courtageRenseigne
          ? {
              honorairesCourtier: honorairesCourtier === '' ? vide(0) : Number(honorairesCourtier),
              montantCredit: montantCredit === '' ? vide(0) : Number(montantCredit),
              banqueChoisie: banqueChoisie || vide(''),
              comBanque: comBanque === '' ? vide(0) : Number(comBanque),
            }
          : {}),
      });
      // Ticket #119 : avant, `onClose()` était appelé immédiatement après
      // avoir déclenché `onSubmit` SANS attendre le résultat — la modale se
      // fermait donc même quand l'enregistrement échouait en base,
      // laissant croire que le lead avait bien été créé alors qu'il ne
      // l'était pas, sans aucun message d'erreur.
      onClose();
    } catch (err: any) {
      toast.error(err?.message || (modification ? "Impossible d'enregistrer cette fiche. Réessayez." : "Impossible de créer ce lead. Réessayez."));
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
              {modification ? <Pencil className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white tracking-tight leading-none">{modification ? 'Modifier la fiche' : 'Informations du lead'}</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {modification ? 'Mêmes informations qu\'à la création : corrige ce qu\'il faut, puis Enregistrer' : 'Saisissez les informations de votre nouveau prospect'}
              </p>
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
                      <option value="Location">Location</option>
                      <option value="Conciergerie">Conciergerie</option>
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
                {!estNovavisio && (
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
                )}

                {/* Secteur */}
                {!estNovavisio && (
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
                )}

                {/* Type de bien */}
                {!estNovavisio && (
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
                )}

                {/* Commission agence — anciennement « Honoraires ». C'est le
                    chiffre d'affaires de l'agence, celui qui alimente les
                    statistiques ; saisi en HT. */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">
                    {estConseilsFinances ? 'Honoraires agence' : 'Commission agence'} (€ TTC)
                  </label>
                  <input
                    type="number"
                    placeholder="ex: 5000"
                    value={honoraires}
                    onChange={(e) => {
                      // Base des honoraires courtier : on recalcule.
                      courtierTouche.current = false;
                      setHonoraires(e.target.value === '' ? '' : Number(e.target.value));
                    }}
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
                {!estNovavisio && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Numéro de mandat</label>
                  <input
                    placeholder="ex: 2026-0142"
                    value={mandateNumber}
                    onChange={(e) => setMandateNumber(e.target.value)}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
                  />
                </div>
                )}

                {/* CA devis à venir (Novavisio) — même case qu'à la modification. */}
                {estNovavisio && (
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-200">CA devis à venir (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Montant du devis envoyé, en attente de signature"
                    value={caDevis}
                    onChange={(e) => setCaDevis(e.target.value)}
                    className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                  />
                  <p className="text-[10px] text-slate-500">Repris dans la tuile « CA devis à venir » du Tableau de bord.</p>
                </div>
                )}

                {/* Conseils Finances (5 septembre) : courtage et banque. « Il
                    faudrait bien organiser en verticales les cases pour mettre
                    les bons montants » : un bloc à part, les cases les unes
                    sous les autres, libellé à gauche et montant à droite. */}
                {estConseilsFinances && (
                <div className="sm:col-span-2 lg:col-span-4 mt-1 rounded-xl border border-[#153c3f]/80 bg-[#07191b]/40 p-3 space-y-2.5">
                  <p className="text-[11px] font-bold text-[#F7BC5F] uppercase tracking-wider">Courtage & banque</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)] items-center gap-x-4 gap-y-2.5">
                    <label htmlFor="cf-honoraires-courtier" className="text-xs font-bold text-slate-200">
                      Honoraires courtier (€)
                      <span className="block text-[10px] font-normal text-slate-500">
                        {tauxCourtier !== null
                          ? `${pourcent(tauxCourtier)} des honoraires agence, calculé automatiquement — modifiable`
                          : 'Attribuez la fiche à un courtier pour le calcul automatique'}
                      </span>
                    </label>
                    <input
                      id="cf-honoraires-courtier"
                      type="number"
                      placeholder="Calculé"
                      value={honorairesCourtier}
                      onChange={(e) => {
                        courtierTouche.current = true;
                        setHonorairesCourtier(e.target.value === '' ? '' : Number(e.target.value));
                      }}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                    />

                    <label htmlFor="cf-banque" className="text-xs font-bold text-slate-200">
                      Banque choisie
                      <span className="block text-[10px] font-normal text-slate-500">Détermine le taux de la commission bancaire</span>
                    </label>
                    <div className="relative">
                      <select
                        id="cf-banque"
                        value={banqueChoisie}
                        onChange={(e) => {
                          banqueTouche.current = false;
                          setBanqueChoisie(e.target.value);
                        }}
                        className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 pr-7 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
                      >
                        <option value="">— Aucune —</option>
                        {BANQUES.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    </div>

                    <label htmlFor="cf-montant-credit" className="text-xs font-bold text-slate-200">
                      Montant du crédit (€)
                      <span className="block text-[10px] font-normal text-slate-500">Base du calcul de la commission bancaire</span>
                    </label>
                    <input
                      id="cf-montant-credit"
                      type="number"
                      placeholder="ex: 250000"
                      value={montantCredit}
                      onChange={(e) => {
                        banqueTouche.current = false;
                        setMontantCredit(e.target.value === '' ? '' : Number(e.target.value));
                      }}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                    />

                    <label htmlFor="cf-com-banque" className="text-xs font-bold text-slate-200">
                      Com banques (€)
                      <span className="block text-[10px] font-normal text-slate-500">
                        {!banqueChoisie
                          ? 'Choisissez la banque pour le calcul automatique'
                          : tauxBanque === null
                            ? 'Taux pas encore communiqué pour cette banque : à saisir à la main'
                            : `${pourcent(tauxBanque)} du montant du crédit, calculé automatiquement${banqueChoisie === 'Société Générale' ? ' (taux provisoire, à corriger selon le client)' : ' — modifiable'}`}
                      </span>
                    </label>
                    <input
                      id="cf-com-banque"
                      type="number"
                      placeholder={tauxBanque === null ? 'À saisir' : 'Calculé'}
                      value={comBanque}
                      onChange={(e) => {
                        banqueTouche.current = true;
                        setComBanque(e.target.value === '' ? '' : Number(e.target.value));
                      }}
                      className="w-full bg-[#07191b] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors font-mono"
                    />
                  </div>
                </div>
                )}
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
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Société du lead</p>
                    {modification ? (
                      <select
                        value={AGENCIES.find((a) => matchesAgency(agencyId, a.id))?.id || agencyId}
                        onChange={(e) => setAgencyId(e.target.value)}
                        className="mt-1 w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-2.5 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-[#F7BC5F]"
                      >
                        {AGENCIES.filter((a) => a.id !== 'all').map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs font-bold text-white truncate">{currentAgency.name}</p>
                    )}
                  </div>
                </div>

                {/* Attribuer à */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-200">Attribuer à l'utilisateur / agent</label>
                  <div className="relative">
                    <select
                      value={assignedTo}
                      onChange={(e) => {
                        // Le courtier change : ses honoraires aussi.
                        courtierTouche.current = false;
                        setAssignedTo(e.target.value);
                      }}
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
              {!estNovavisio && (
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
                  <div className="p-3.5 border-t border-[#153c3f] bg-[#07191b]/50 animate-fade-in">
                    <ChampsConjoint
                      valeur={conjoint}
                      onChange={setConjoint}
                      field="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                      label="block text-xs font-semibold text-slate-200 mb-1.5"
                    />
                  </div>
                )}
              </div>
              )}

              {/* Société / professionnel : ouvert d'office pour un
                  « Professionnel », ajoutable pour un particulier (SCI,
                  investisseur…). Mêmes champs qu'à la modification. */}
              {(() => {
                const ouvert = contactType === 'Professionnel' || showCompany;
                return (
              <div className="bg-[#030d0f] border border-[#153c3f] rounded-xl overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => setShowCompany(!ouvert)}
                  disabled={contactType === 'Professionnel'}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-bold text-slate-200 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:cursor-default"
                >
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-[#F7BC5F]" />
                    <span>Société / professionnel</span>
                  </div>
                  {contactType !== 'Professionnel' && (
                    <span className="text-[11px] text-[#F9C977] font-semibold flex items-center gap-1">
                      {ouvert ? (
                        <>Masquer <ChevronUp className="w-3.5 h-3.5" /></>
                      ) : (
                        <>+ Ajouter <ChevronDown className="w-3.5 h-3.5" /></>
                      )}
                    </span>
                  )}
                </button>

                {ouvert && (
                  <div className="p-3.5 border-t border-[#153c3f] bg-[#07191b]/50 animate-fade-in">
                    <ChampsSociete
                      valeur={societe}
                      onChange={setSociete}
                      field="w-full bg-[#030d0f] border border-[#153c3f] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                      label="block text-xs font-semibold text-slate-200 mb-1.5"
                    />
                  </div>
                )}
              </div>
                );
              })()}

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
            {submitting ? <Loader2 className="w-4 h-4 stroke-[2.5] animate-spin" /> : modification ? <Save className="w-4 h-4 stroke-[2.5]" /> : <UserPlus className="w-4 h-4 stroke-[2.5]" />}
            <span>{submitting ? (modification ? 'Enregistrement…' : 'Création...') : modification ? 'Enregistrer' : 'Créer le lead'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default NouveauLeadModal;
