import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { creerAccumulateurDictee } from '@/lib/dictee';
import { pickVoiceMimeType } from '@/lib/audioRecording';
import { useIsMobile } from '@/hooks/use-mobile';
import { AGENCIES, NoteItem, DocItem, Task } from '@/types';
import TransactionChecklistModal, {
  STAGE_CHECKLISTS,
  IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID,
  IMMOSPHERA_AGENCY_ID,
  usePreviousStageMissingCount,
  useCurrentStageChecklistCount,
} from './TransactionChecklistModal';
import { ClipboardList } from 'lucide-react';
import { couleurEtapeNovavisio, estAgenceNovavisio } from '@/lib/couleursNovavisio';
import { clicMailCrm } from '@/lib/composerMail';
import { ChevronLeft, ChevronDown, Plus, Mail, Phone, Calendar, User, UserCheck, UserPlus, Pencil, Trash2, CheckCircle, Circle, FileEdit, Save, Clock, Check, CheckCheck, Mic, MicOff, Square, Pin, GripVertical, MessageSquare, X, FileText, Upload, Download, Folder, Eye, Lock, Share2, Send, UserX, Smile, Image as ImageIcon, Video as VideoIcon, Paperclip, ClipboardCheck, Landmark, Archive, ArchiveRestore, Copy, Loader2, ShieldCheck, Flame, Sun, Snowflake, MoreVertical } from 'lucide-react';

// Sélecteur Chaud/Tiède/Froid de la fiche client — même logique que la
// liste Clients (Clients.tsx) : l'icône reste affichée en permanence,
// seule sa couleur change selon la température actuellement sélectionnée.
const CLIENT_TEMP_OPTIONS: { value: 'chaud' | 'tiede' | 'froid'; label: string; icon: typeof Flame; activeClass: string }[] = [
  { value: 'chaud', label: 'Chaud', icon: Flame, activeClass: 'text-red-400 bg-red-500/20 border-red-500/50' },
  { value: 'tiede', label: 'Tiède', icon: Sun, activeClass: 'text-[#F7BC5F] bg-[#F7BC5F]/20 border-[#F7BC5F]/50' },
  { value: 'froid', label: 'Froid', icon: Snowflake, activeClass: 'text-sky-400 bg-sky-500/20 border-sky-500/50' },
];
import { consentSignedAt, consentValidUntil, isConsentExpired, latestConsent, formatFr } from '@/lib/consent';
import ConsentViewDialog, { useLeadConsents, useConsentSenders, downloadConsentPdf } from './consent/ConsentViewDialog';
import ConsentStatusBadge from './consent/ConsentStatusBadge';
import ConsentDocument from './consent/ConsentDocument';
import { formatCurrency, cn, htDepuisTtc, ttcDepuisHt } from '@/lib/utils';
import { NOVA_QUICK_REACTIONS, renderEmojiOrNova } from '@/lib/novaReactions';
import { toast } from 'sonner';
import TaskModal from './TaskModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useContacts, matchesAgency } from '@/hooks/useContacts';
import { useDeals } from '@/hooks/useDeals';
import { useTasks } from '@/hooks/useTasks';
import { useLeadChat } from '@/hooks/useLeadChat';
import { useDocumentRequests, DOC_REQUEST_STATUS_LABELS, DOC_CATEGORIES } from '@/hooks/useDocumentRequests';
import { useAuth } from '@/context/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { getCachedAccessToken, requestWorkspaceAccessToken, hydrateAccessTokenFromSession, reconnectGoogleWorkspace, deleteDriveFile, uploadVideoToDriveFolder, sendGmailMessage, fetchGmailMessages, GmailMessageSummary, fetchGoogleCalendarEvents, createGoogleCalendarEvent, GoogleCalendarEvent } from '@/lib/workspace';
import { uploadDocumentToDrive } from '@/lib/documentDrive';
import { getTaskDateStatus } from '@/lib/taskUtils';
import { TEAM_MEMBERS, getAssignedUser } from '@/data/teamMembers';
import { useAssignableUsers } from '@/hooks/useAssignableUsers';
import { useApporteurs } from '@/hooks/useApporteurs';
import ParcoursCreditModal from './ParcoursCreditModal';
import EditClientModal from './EditClientModal';

interface ClientShareRow {
  id: string;
  leadId: string;
  sharedBy: string;
  sharedWith: string;
}

interface ChatReadReceipt {
  userId: string;
  userName: string;
  readAt: string;
}

interface ChatReaction {
  emoji: string;
  userId: string;
}

interface ChatMessageRow {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  audioDuration: number | null;
  isEdited: boolean;
  isDeleted: boolean;
  readBy: ChatReadReceipt[];
  reactions: ChatReaction[];
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
// Suite #240 : réservé aux RÉACTIONS sur un message (jamais à l'insertion
// dans le texte, où un chemin de fichier Nova s'insérerait comme du texte
// brut illisible) — Nova en tête, "les vrais" emojis ensuite.
const REACTION_EMOJIS = [...NOVA_QUICK_REACTIONS, ...QUICK_EMOJIS];
const MAX_VIDEO_SIZE = 150 * 1024 * 1024; // 150 Mo

const STAGES = [
  'Prise de contact',
  'Montage bancaire',
  'En Banque',
  'Att Retour Caution',
  'Accord banque / Rendez-vous',
  'Attente édition des offres',
  'Décompte / Rendez-vous notaire',
  'Dossier facture'
];

interface ClientNoteItem extends NoteItem {
  createdByUserId: string;
  createdByEmail: string;
  createdByName: string;
  createdAt: string;
  isShared?: boolean;
}

interface ClientDocItem extends DocItem {
  contactId: string;
  contactName: string;

  type: 'file';
  mimeType?: string;

  driveFileId: string;
  driveFolderName?: string;
  downloadUrl?: string;

  uploadedByUserId: string;
  uploadedByEmail: string;
  uploadedByName: string;

  createdAt: string;
  isShared?: boolean;
}

// Petit bouton "Checklist X/Y" sous l'étape active du pipeline (demande
// explicite) — même mécanique que sur la carte kanban (Pipeline.tsx), avec
// en plus le badge rouge si des documents obligatoires manquent encore à
// l'étape précédente.
const ClientStageChecklistButton: React.FC<{ leadId: string; stageName: string; onOpen: () => void }> = ({ leadId, stageName, onOpen }) => {
  const count = useCurrentStageChecklistCount(leadId, stageName);
  const missingFromPrevStage = usePreviousStageMissingCount(leadId, stageName);
  return (
    <div className="flex items-center justify-center gap-2 mt-3">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#F7BC5F] text-xs font-bold hover:bg-[#F7BC5F]/25 transition-colors"
      >
        <ClipboardList className="w-3.5 h-3.5" />
        Checklist
        {count && <span className="text-[10px] opacity-80">{count.done}/{count.total}</span>}
      </button>
      {!!missingFromPrevStage && (
        <span
          title={`${missingFromPrevStage} document(s) obligatoire(s) manquant(s) à l'étape précédente — n'empêche pas d'avancer, juste un rappel.`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[10px] font-black"
        >
          {missingFromPrevStage} manquant{missingFromPrevStage > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
};

export default function ClientProfileView({
  clientId,
  onBack,
  highlightPulse,
  onComposeMail,
  initialTab,
  onOpenNova,
  onSelectContact,
}: {
  clientId: string;
  onBack: () => void;
  highlightPulse?: number;
  onComposeMail?: (email: string) => void;
  // Lien Vendeur ↔ Acquéreur (7 septembre) : navigation en un clic vers la
  // fiche liée, sans quitter le composant (App.tsx transmet openClientProfile).
  onSelectContact?: (contactId: string) => void;
  // Signalé : "clic sur la notif du message du client doit envoyer sur le
  // chat Espace Client de la fiche" — auparavant la fiche s'ouvrait
  // toujours sur l'onglet RDV par défaut, quel que soit le contexte du
  // clic (notification de message, lien, etc.).
  initialTab?: 'rdv' | 'agenda' | 'notes' | 'emails' | 'documents' | 'chat' | 'espace-client';
  // Demande explicite : "intégrer Nova dans la fiche du client" — ouvre
  // Nova (App.tsx lui transmet déjà currentClientId dès qu'une fiche est
  // affichée, donc Nova résout tout de suite le bon dossier sans qu'on ait
  // à répéter le nom).
  onOpenNova?: () => void;
}) {
  const [showHalo, setShowHalo] = useState(false);
  useEffect(() => {
    if (!highlightPulse) return;
    setShowHalo(true);
    const t = setTimeout(() => setShowHalo(false), 1500);
    return () => clearTimeout(t);
  }, [highlightPulse]);
  const { currentUser, userProfile } = useAuth();
  const currentUserEmail = (currentUser?.email || 's.grazia@conseilfinances.fr').toLowerCase().trim();
  const currentUserId = (currentUser?.uid || currentUserEmail).toLowerCase().trim();
  const currentUserName = currentUser?.displayName || currentUserEmail.split('@')[0];
  const isSuperAdmin = userProfile?.role === 'super_admin';

  // Demande explicite : "un onglet rdv pour prendre un rdv si besoin avec
  // vue sur agenda" — 'rdv' (déjà existant) ne contenait en réalité que des
  // TÂCHES internes CRM, jamais synchronisées à un agenda ; 'agenda' est un
  // nouvel onglet séparé, avec un vrai rendez-vous Google Calendar (comme
  // Nova IA sait déjà le faire, cf. AssistantIAView.tsx `create_appointment`)
  // et la liste des prochains événements pour voir les disponibilités.
  const [activeTab, setActiveTab] = useState<'rdv' | 'agenda' | 'notes' | 'emails' | 'documents' | 'chat' | 'espace-client'>(initialTab || 'rdv');
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, initialTab]);

  // Ticket "Clients invités" (8/13) : "Espace client / Conversation" — le
  // client discute avec son conseiller depuis son mobile (ClientGuestShell),
  // le conseiller répond ici. Toujours séparé des "Commentaires" internes.
  const { data: guestAccess } = useQuery({
    queryKey: ['client-guest-access', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from('client_guest_access' as any)
        .select('status')
        .eq('lead_id', clientId)
        .maybeSingle();
      return data as { status: string } | null;
    },
  });
  const isGuestActive = guestAccess?.status === 'active' || guestAccess?.status === 'envoyee';
  const { messages: leadMessages, send: sendLeadMessage, update: updateLeadMessage, remove: removeLeadMessage, markRead: markLeadMessageRead } = useLeadChat(isGuestActive ? clientId : null);
  const [leadDraft, setLeadDraft] = useState('');
  const [leadSending, setLeadSending] = useState(false);
  const [leadUploading, setLeadUploading] = useState(false);
  const leadChatScrollRef = useRef<HTMLDivElement>(null);
  const leadImageInputRef = useRef<HTMLInputElement>(null);
  const leadFileInputRef = useRef<HTMLInputElement>(null);
  // Demande explicite (23 septembre) : « le panneau des messages gagne en
  // hauteur pour qu'on puisse lire tout le texte qu'on tape » — même
  // mécanisme que ChatViewSupabase.tsx : le textarea grandit avec son
  // contenu, jusqu'à un plafond au-delà duquel il défile plutôt que de
  // manger tout l'écran (plafond plus haut sur mobile, où le clavier
  // masque déjà la moitié de l'écran).
  const leadTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isMobileSaisieLead = useIsMobile();
  const HAUTEUR_MAX_SAISIE_LEAD = isMobileSaisieLead ? 220 : 132;
  useEffect(() => {
    const zone = leadTextareaRef.current;
    if (!zone) return;
    zone.style.height = 'auto';
    zone.style.height = `${Math.min(zone.scrollHeight, HAUTEUR_MAX_SAISIE_LEAD)}px`;
    zone.style.overflowY = zone.scrollHeight > HAUTEUR_MAX_SAISIE_LEAD ? 'auto' : 'hidden';
  }, [leadDraft, HAUTEUR_MAX_SAISIE_LEAD]);
  const [leadEmojiPickerOpen, setLeadEmojiPickerOpen] = useState(false);
  const [leadMessageMenuId, setLeadMessageMenuId] = useState<string | null>(null);
  const [leadEditingId, setLeadEditingId] = useState<string | null>(null);
  const [leadEditingText, setLeadEditingText] = useState('');
  const [leadLightboxUrl, setLeadLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'espace-client') leadChatScrollRef.current?.scrollTo({ top: leadChatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [leadMessages.length, activeTab]);

  // Accusé de lecture côté conseiller : marque automatiquement les
  // messages du client comme lus dès l'ouverture de l'onglet.
  useEffect(() => {
    if (activeTab !== 'espace-client' || !currentUser) return;
    leadMessages.filter((m) => m.userId !== currentUser.uid && !m.readAt && !m.deletedAt).forEach((m) => markLeadMessageRead.mutate(m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, leadMessages.length, currentUser?.uid]);

  async function sendLeadText() {
    if (!leadDraft.trim() || !currentUser || leadSending) return;
    setLeadSending(true);
    try {
      await sendLeadMessage.mutateAsync({ userId: currentUser.uid, kind: 'text', body: leadDraft.trim() });
      setLeadDraft('');
    } finally {
      setLeadSending(false);
    }
  }

  function insertLeadEmoji(emoji: string) {
    setLeadDraft((prev) => prev + emoji);
    setLeadEmojiPickerOpen(false);
  }

  async function sendLeadAttachment(file: File, kind: 'image' | 'file') {
    if (!currentUser) return;
    if (file.size > 4.5 * 1024 * 1024) { toast.error('Fichier trop volumineux (4,5 Mo maximum).'); return; }
    setLeadUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await sendLeadMessage.mutateAsync({
        userId: currentUser.uid, kind, attachmentUrl: dataUrl, attachmentMime: file.type || 'application/octet-stream',
        body: kind === 'file' ? file.name : undefined,
      });
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'envoyer ce fichier.");
    } finally {
      setLeadUploading(false);
    }
  }

  function startEditingLeadMessage(m: { id: string; body: string | null }) {
    setLeadMessageMenuId(null);
    setLeadEditingId(m.id);
    setLeadEditingText(m.body || '');
  }

  async function saveLeadMessageEdit() {
    if (!leadEditingId || !leadEditingText.trim()) return;
    try {
      await updateLeadMessage.mutateAsync({ id: leadEditingId, body: leadEditingText.trim() });
      setLeadEditingId(null);
      setLeadEditingText('');
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de modifier ce message.');
    }
  }

  async function deleteLeadMessage(id: string) {
    setLeadMessageMenuId(null);
    try {
      await removeLeadMessage.mutateAsync(id);
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de supprimer ce message.');
    }
  }

  // Ticket "Clients invités" (12/13) : demandes de documents au client.
  const { requests: docRequests, create: createDocRequest, setDecision: setDocRequestDecision } = useDocumentRequests(guestAccess ? clientId : null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reqDocType, setReqDocType] = useState(DOC_CATEGORIES[0]);
  const [reqDeadline, setReqDeadline] = useState('');
  const [reqMessage, setReqMessage] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqDecisionBusy, setReqDecisionBusy] = useState<string | null>(null);

  async function submitDocRequest() {
    if (!currentUser || !client || reqSubmitting) return;
    setReqSubmitting(true);
    try {
      await createDocRequest.mutateAsync({ agencyId: client.agencyId, requestedBy: currentUser.uid, docType: reqDocType, deadline: reqDeadline || null, message: reqMessage || null });
      toast.success('Demande envoyée au client.');
      setShowRequestForm(false);
      setReqDeadline('');
      setReqMessage('');
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'envoyer la demande.");
    } finally {
      setReqSubmitting(false);
    }
  }

  async function decideDocRequest(requestId: string, status: 'valide' | 'refuse') {
    setReqDecisionBusy(requestId);
    try {
      await setDocRequestDecision.mutateAsync({ requestId, status });
    } catch (err: any) {
      toast.error(err?.message || 'Erreur.');
    } finally {
      setReqDecisionBusy(null);
    }
  }

  // Ticket #27 (nouvelle base) : l'onglet "Emails" existait déjà dans la
  // fiche client mais n'a jamais rien chargé — affichait toujours "Aucun
  // email lié" en dur. On y branche une vraie recherche Gmail (from/to
  // l'adresse du contact).
  const [clientEmails, setClientEmails] = useState<GmailMessageSummary[]>([]);
  const [loadingClientEmails, setLoadingClientEmails] = useState(false);
  const [clientEmailsError, setClientEmailsError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxKind, setLightboxKind] = useState<'image' | 'audio' | null>(null);
  // Ticket #47 : ouvrir un e-mail en grand depuis la fiche client, avec
  // réponse directe sans quitter la fiche.
  const [openEmail, setOpenEmail] = useState<GmailMessageSummary | null>(null);
  const [emailReplyOpen, setEmailReplyOpen] = useState(false);
  const [emailReplyBody, setEmailReplyBody] = useState('');
  const [emailReplySending, setEmailReplySending] = useState(false);
  // Demande explicite (28/08/2026, Immosphera / Pipeline Transactions V2) :
  // petit bouton Checklist sous l'étape active du pipeline, dans la fiche
  // client — voir TransactionChecklistModal.tsx. Gardé aussi sur la carte
  // du kanban (Pipeline.tsx), les deux ouvrent la même modale.
  const [showChecklistModal, setShowChecklistModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Demande explicite : onglet "RDV" avec vue sur agenda — liste des
  // prochains événements Google Agenda (pour voir les disponibilités avant
  // de choisir un créneau) + formulaire de prise de rendez-vous réel,
  // synchronisé (même mécanisme que Nova IA : AssistantIAView.tsx
  // `create_appointment`).
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showNewAppointment, setShowNewAppointment] = useState(false);
  const [newApptTitle, setNewApptTitle] = useState('');
  const [newApptDate, setNewApptDate] = useState('');
  const [newApptTime, setNewApptTime] = useState('09:00');
  const [newApptDuration, setNewApptDuration] = useState(30);
  const [newApptLocation, setNewApptLocation] = useState('');
  const [creatingAppt, setCreatingAppt] = useState(false);
  const { contacts = [], allContacts = [], updateContact } = useContacts();
  const { deals = [] } = useDeals();
  const { tasks, addTask, updateTask, deleteTask } = useTasks();

  // Ticket #14 (nouvelle base) : `contacts` est filtré sur l'agence active
  // de l'utilisateur courant — un contact partagé par un autre utilisateur,
  // rattaché à une AUTRE agence que celle actuellement sélectionnée, était
  // donc introuvable ici (`client` = undefined) et faisait planter la fiche
  // à l'ouverture, alors même que le contact était visible dans la liste
  // "Partagés" (qui ne filtre pas par agence). On cherche dans la liste
  // complète, non filtrée, pour couvrir ce cas de partage inter-agence.
  const client = contacts.find(c => c.id === clientId) || allContacts.find(c => c.id === clientId);
  const clientDeals = deals.filter(d => d.contactId === clientId);
  const activeDeal = clientDeals[0];

  // ── Pipeline réel (leads.pipeline_id / leads.stage_id) ──────────────────
  const qc = useQueryClient();

  const handleSetClientTemperature = async (temperature: 'chaud' | 'tiede' | 'froid') => {
    if (!clientId) return;
    const { error } = await supabase.from('leads').update({ temperature }).eq('id', clientId);
    if (error) { console.error('Impossible de changer la température :', error); return; }
    qc.invalidateQueries({ queryKey: ['contacts_all'] });
    qc.invalidateQueries({ queryKey: ['leads'] });
  };

  const agencyId = client?.agencyId;
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);

  const { data: leadStage } = useQuery({
    queryKey: ['lead-stage', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from('leads')
        .select('pipeline_id, stage_id')
        .eq('id', clientId)
        .maybeSingle();
      return data as { pipeline_id: string | null; stage_id: string | null } | null;
    },
  });

  const { data: pipelines = [] } = useQuery({
    queryKey: ['pipelines', agencyId, currentUserId],
    enabled: !!agencyId,
    queryFn: async () => {
      const { data } = await supabase
        .from('pipelines' as any)
        .select('*')
        .eq('agency_id', agencyId!)
        .order('created_at');
      return (data ?? []) as any[];
    },
  });

  const currentPipelineId =
    leadStage?.pipeline_id ??
    activePipelineId ??
    pipelines.find((p: any) => p.owner_id === null && p.is_default)?.id ??
    pipelines.find((p: any) => p.owner_id === null)?.id ??
    pipelines[0]?.id ??
    null;

  const { data: stages = [] } = useQuery({
    queryKey: ['stages', agencyId, currentPipelineId],
    enabled: !!agencyId && !!currentPipelineId,
    queryFn: async () => {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('agency_id', agencyId!)
        .eq('pipeline_id', currentPipelineId as any)
        .order('position');
      return data ?? [];
    },
  });

  const currentPipelineName =
    pipelines.find((p: any) => p.id === currentPipelineId)?.name ?? 'Sélectionner un pipeline';
  const currentStageIndex = leadStage?.stage_id
    ? stages.findIndex((s: any) => s.id === leadStage.stage_id)
    : -1;
  // Couleur d'une étape sur la fiche : code de Natacha pour Novavisio, sinon aucune (doré par défaut).
  const couleurEtapeFiche = (nom: string | undefined): string | null =>
    estAgenceNovavisio(client.agencyId) ? couleurEtapeNovavisio(nom) : null;

  // Demandé le 2 septembre : « quand c'est à facturer, on met le montant ».
  // Même fenêtre que dans le Pipeline, pour le même geste : ici les pastilles
  // d'étape de la fiche. Posée APRÈS le changement d'étape, jamais avant.
  const [montantEtapePrompt, setMontantEtapePrompt] = useState<string | null>(null);
  const [montantEtapeSaisi, setMontantEtapeSaisi] = useState('');
  const [montantEtapeEnCours, setMontantEtapeEnCours] = useState(false);

  const estEtapeAFacturer = (nom: string) =>
    nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().includes('factur');

  const estConciergerie = /concierg/i.test(client?.clientType || '');
  // Apporteur d'affaires (agent immobilier référent, 6 septembre) :
  // uniquement chargé/affiché pour les fiches Conciergerie.
  const { apporteurs: apporteursDisponibles } = useApporteurs(IMMOSPHERA_AGENCY_ID);

  // Lien Vendeur ↔ Acquéreur (7 septembre, ImmoSphera Transactions V2) :
  // « rattacher la fiche client acquéreur à la fiche client vendeur ».
  // Facultatif, limité aux fiches de ce pipeline précis — comme confirmé.
  const estTransactionsV2 = matchesAgency(client?.agencyId, IMMOSPHERA_AGENCY_ID) && client?.pipeline === IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID;
  const fichesLiablesTransactionsV2 = React.useMemo(
    () =>
      allContacts.filter(
        (c) =>
          c.id !== client?.id &&
          matchesAgency(c.agencyId, IMMOSPHERA_AGENCY_ID) &&
          c.pipeline === IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID
      ),
    [allContacts, client?.id]
  );
  const ficheLieePrincipale = client?.linkedLeadId
    ? allContacts.find((c) => c.id === client.linkedLeadId) || null
    : null;
  // Recherche inverse : toute fiche qui pointe VERS celle-ci (ex. sur la
  // fiche du Vendeur, les Acquéreurs qui l'ont choisi comme « Vendeur lié »).
  const fichesLieesInverse = client
    ? allContacts.filter((c) => c.linkedLeadId === client.id)
    : [];


  // Novavisio, demandé le 2 septembre : « remettre le CA agence en TTC, et tu
  // le calculeras dans le tableau de bord en hors taxes ». La saisie se fait
  // donc en TTC et la base continue de stocker le HT — exactement la règle
  // déjà appliquée au champ « Commission agence » de la fiche. Les autres
  // agences confirment leurs montants en HT depuis le 1er septembre : leur
  // saisie n'est pas touchée, sans quoi tout l'historique serait faussé.
  // `matchesAgency` et non un `===` : voir EditClientModal — les fiches
  // portent encore des identifiants d'agence hérités.
  const estNovavisio = /novavisio/i.test(
    AGENCIES.find((a) => matchesAgency(client?.agencyId, a.id))?.name || ''
  );
  // « Il n'y a pas de hors taxes dans Conseils Finances, c'est que du TTC »
  // (5 septembre) : le montant est enregistré tel que saisi, comme ici pour
  // les autres agences, mais il se NOMME TTC.
  const estConseilsFinances = /conseils?\s*finances?/i.test(
    AGENCIES.find((a) => matchesAgency(client?.agencyId, a.id))?.name || ''
  );
  const uniteMontant = estNovavisio || estConseilsFinances ? 'TTC' : 'HT';
  const libelleUnite = estNovavisio || estConseilsFinances ? 'TTC' : 'hors taxes';
  const versBase = (saisi: number) => (estNovavisio ? Math.round(htDepuisTtc(saisi) * 100) / 100 : saisi);
  const depuisBase = (stocke: number) =>
    estNovavisio ? Math.round(ttcDepuisHt(stocke) * 100) / 100 : stocke;

  const validerMontantEtape = async () => {
    const saisi = montantEtapeSaisi.trim().replace(',', '.');
    if (saisi === '') { setMontantEtapePrompt(null); return; }
    const montant = Number(saisi);
    if (!Number.isFinite(montant) || montant < 0) {
      toast.error(`Le montant ${libelleUnite} n'est pas un nombre valide.`);
      return;
    }
    setMontantEtapeEnCours(true);
    const { error } = await supabase
      .from('leads')
      .update({ estimated_value: versBase(montant) } as any)
      .eq('id', clientId);
    setMontantEtapeEnCours(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${estConseilsFinances ? 'Honoraires' : 'Commission'} agence ${uniteMontant} enregistré${estConseilsFinances ? 's' : 'e'}`);
    qc.invalidateQueries({ queryKey: ['contacts_all'] });
    qc.invalidateQueries({ queryKey: ['deals'] });
    setMontantEtapePrompt(null);
  };

  const changeStage = async (stageId: string) => {
    const { error } = await (supabase as any).rpc('change_lead_stage', {
      p_lead_id: clientId,
      p_stage_id: stageId,
      p_pipeline_id: currentPipelineId,
      p_pipeline_position: null,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['lead-stage', clientId] });
    qc.invalidateQueries({ queryKey: ['contacts_all'] });
    // Changer l'étape depuis la fiche client change ce que compte le Tableau
    // de bord (le chiffre d'affaires se lit sur l'étape du dossier) : sans
    // cette ligne, le montant restait celui d'avant jusqu'au prochain
    // rechargement complet. Même oubli que celui corrigé pour l'archivage.
    qc.invalidateQueries({ queryKey: ['deals'] });
    toast.success('Étape mise à jour');

    const nom = (stages as any[]).find((e) => e.id === stageId)?.name || '';
    if (estEtapeAFacturer(nom)) {
      const { data } = await supabase
        .from('leads')
        .select('estimated_value')
        .eq('id', clientId)
        .maybeSingle();
      const valeur = (data as { estimated_value: number | null } | null)?.estimated_value;
      setMontantEtapeSaisi(valeur === null || valeur === undefined ? '' : String(depuisBase(Number(valeur))));
      setMontantEtapePrompt(nom);
    }
  };

  const changePipeline = async (pipelineId: string) => {
    const { data: firstStage } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('agency_id', agencyId!)
      .eq('pipeline_id', pipelineId as any)
      .order('position')
      .limit(1)
      .maybeSingle();
    const { error } = await (supabase as any).rpc('change_lead_stage', {
      p_lead_id: clientId,
      p_stage_id: firstStage?.id ?? null,
      p_pipeline_id: pipelineId,
      p_pipeline_position: null,
    });
    if (error) return toast.error(error.message);
    setActivePipelineId(pipelineId);
    qc.invalidateQueries({ queryKey: ['lead-stage', clientId] });
    qc.invalidateQueries({ queryKey: ['contacts_all'] });
    qc.invalidateQueries({ queryKey: ['deals'] });
    toast.success('Pipeline mis à jour');
  };

  // Cloisonnement filtering for Tasks
  const isMyTask = (t: Task) => {
    if (!t.createdBy && !t.assignedTo) return true;
    const creator = (t.createdBy || '').toLowerCase().trim();
    const assigned = (t.assignedTo || '').toLowerCase().trim();
    return (
      creator === currentUserEmail ||
      creator === currentUserId ||
      assigned === currentUserEmail ||
      assigned === currentUserId ||
      (currentUserName && assigned.includes(currentUserName.toLowerCase()))
    );
  };

  const clientTasks = (tasks || [])
    .filter(t => t.contactId === clientId)
    .filter(isMyTask)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Notes tab states
  const [contactComments, setContactComments] = useState(client?.comments || '');
  const [savedCommentsSuccess, setSavedCommentsSuccess] = useState(false);
  const [clientNotes, setClientNotes] = useState<ClientNoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [noteSaving, setNoteSaving] = useState(false);
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('Suivi Client');
  // Ticket #55 : notes/documents "partagés" — visibles par les personnes
  // ayant accès au contact, au lieu de rester implicitement privés.
  const [noteIsShared, setNoteIsShared] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = React.useRef<any>(null);
  const dicteeRef = React.useRef<((results: any) => string) | null>(null);

  // Documents tab states
  const [clientDocs, setClientDocs] = useState<ClientDocItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docSaving, setDocSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [showDocModal, setShowDocModal] = useState(false);
  const [docName, setDocName] = useState('');
  const [docCategory, setDocCategory] = useState('Pièce d\'identité');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docIsShared, setDocIsShared] = useState(false);

  // Partage de la fiche client entre collègues de la même société
  const [shares, setShares] = useState<ClientShareRow[]>([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTargetId, setShareTargetId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);

  const assignableUsers = useAssignableUsers(client?.agencyId);
  // « La commission de Natacha » : on nomme la case avec le prénom du
  // conseiller réellement attribué au dossier, plutôt qu'en écrivant
  // « Natacha » en dur — un dossier peut appartenir à quelqu'un d'autre.
  const prenomConseiller = (() => {
    const nom = assignableUsers.find((u) => u.id === client?.assignedTo)?.name || '';
    return nom.trim().split(/\s+/)[0] || '';
  })();
  const colleagues = TEAM_MEMBERS.filter(
    (m) => m.agencyId === client?.agencyId && m.id !== currentUserId
  );

  const loadShares = async () => {
    if (!client) { setShares([]); setSharesLoading(false); return; }
    setSharesLoading(true);
    try {
      const { data, error } = await supabase
        .from('client_shares')
        .select('id, lead_id, shared_by, shared_with')
        .eq('lead_id', clientId);
      if (error) throw error;
      setShares(
        (data ?? []).map((r: any) => ({
          id: r.id,
          leadId: r.lead_id,
          sharedBy: r.shared_by,
          sharedWith: r.shared_with,
        }))
      );
    } catch (e: any) {
      // silencieux : table peut ne pas être encore accessible pour cet utilisateur
    } finally {
      setSharesLoading(false);
    }
  };

  useEffect(() => {
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const isSharedWithSomeone = shares.length > 0;
  const isSharedForMe = shares.some((s) => s.sharedWith === currentUserId || s.sharedBy === currentUserId);

  // Ticket #55 : quand l'un des deux côtés d'un partage ajoute une note/un
  // document partagé, ou un message dans le Chat du dossier, l'autre doit
  // en être averti. Les notes/documents partagés sont déjà couverts côté
  // base par des triggers (`trg_notify_shared_comment_insert`,
  // `trg_notify_shared_document`) — cette fonction ne sert donc plus
  // qu'au Chat du dossier partagé (table `client_share_messages`, sans
  // trigger équivalent). Lien direct vers l'onglet Chat du contact, sur le
  // même modèle que les liens posés par les triggers.
  const notifyShareParticipants = async (opts: {
    type: string;
    title: string;
    message: string;
  }) => {
    const recipients = new Set<string>();
    shares.forEach((s) => {
      if (s.sharedBy !== currentUserId) recipients.add(s.sharedBy);
      if (s.sharedWith !== currentUserId) recipients.add(s.sharedWith);
    });
    const link = `/clients/${clientId}?tab=chat`;
    for (const uid of recipients) {
      try {
        await supabase.rpc('create_notification', {
          _user_id: uid,
          _type: opts.type,
          _title: opts.title,
          _body: opts.message,
          _link: link,
          _entity_type: 'lead',
          _entity_id: clientId,
        } as any);
      } catch {
        // Ne bloque jamais l'envoi du message (déjà enregistré).
      }
    }
  };

  const handleShareContact = async () => {
    if (!shareTargetId) return;
    setShareSaving(true);
    try {
      const { error } = await supabase.from('client_shares').insert({
        lead_id: clientId,
        shared_by: currentUserId,
        shared_with: shareTargetId,
      } as any);
      if (error) throw error;
      toast.success('Fiche partagée');
      setShareTargetId('');
      await loadShares();
    } catch (e: any) {
      toast.error(e?.message || 'Impossible de partager la fiche');
    } finally {
      setShareSaving(false);
    }
  };

  const handleUnshare = async (shareId: string) => {
    if (!confirm('Arrêter le partage de cette fiche avec cette personne ?')) return;
    try {
      const { error } = await supabase.from('client_shares').delete().eq('id', shareId);
      if (error) throw error;
      toast.success('Partage arrêté');
      await loadShares();
    } catch (e: any) {
      toast.error(e?.message || 'Impossible d\'arrêter le partage');
    }
  };

  // Menu "Actions" en haut à droite de la fiche
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showParcoursCredit, setShowParcoursCredit] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Demandé le 1er septembre : « quand dans la fiche client on archive, c'est
  // là que cela demande le montant ». L'archivage est le dernier moment où
  // quelqu'un regarde l'affaire — c'est donc le bon endroit pour confirmer la
  // commission agence, puisque c'est elle qui alimente le chiffre d'affaires
  // du Tableau de bord (voir chiffreAffairesAgence dans Dashboard.tsx).
  const [montantHt, setMontantHt] = useState('');
  const [montantCharge, setMontantCharge] = useState(false);
  // Demandé le 2 septembre : « si on archive, ça serait bien qu'on ait la
  // commission de Natacha au-dessus de la commission de l'agence, et voir
  // pourquoi pas une troisième, récurrence — comme ça sur un dossier archivé
  // on pourra marquer les trois éléments différents, à la main. »
  const [commissionConseiller, setCommissionConseiller] = useState('');
  const [recurrenceSaisie, setRecurrenceSaisie] = useState('');

  useEffect(() => {
    if (!showArchiveModal) return;
    let vivant = true;
    setMontantCharge(false);
    (async () => {
      const { data } = await supabase
        .from('leads')
        .select('estimated_value, advisor_commission_ttc, recurring_amount')
        .eq('id', clientId)
        .maybeSingle();
      if (!vivant) return;
      const ligne = data as {
        estimated_value: number | null;
        advisor_commission_ttc: number | null;
        recurring_amount: number | null;
      } | null;
      const valeur = ligne?.estimated_value;
      setMontantHt(valeur === null || valeur === undefined ? '' : String(depuisBase(Number(valeur))));
      // Ces deux-là sont stockés tels qu'ils sont saisis : aucune conversion.
      setCommissionConseiller(
        ligne?.advisor_commission_ttc === null || ligne?.advisor_commission_ttc === undefined
          ? ''
          : String(ligne.advisor_commission_ttc)
      );
      setRecurrenceSaisie(
        ligne?.recurring_amount === null || ligne?.recurring_amount === undefined
          ? ''
          : String(ligne.recurring_amount)
      );
      setMontantCharge(true);
    })();
    return () => { vivant = false; };
  }, [showArchiveModal, clientId]);

  const handleArchive = async (signed: boolean) => {
    setArchiving(true);
    try {
      // Virgule ou point, au choix : personne ne tape un montant deux fois
      // parce que le clavier a mis une virgule.
      const lireMontant = (valeur: string): number | null | 'invalide' => {
        const brut = valeur.trim().replace(',', '.');
        if (brut === '') return null;
        const nombre = Number(brut);
        if (!Number.isFinite(nombre) || nombre < 0) return 'invalide';
        return nombre;
      };

      const montant = lireMontant(montantHt);
      const commission = lireMontant(commissionConseiller);
      const recurrence = lireMontant(recurrenceSaisie);
      if (montant === 'invalide' || commission === 'invalide' || recurrence === 'invalide') {
        toast.error("Un des montants saisis n'est pas un nombre valide.");
        setArchiving(false);
        return;
      }

      // L'archivage ne déplace plus la fiche sur une étape « Facturé ».
      // Signalé le 2 septembre : « je n'ai plus les locations de Clémence qui
      // remontent dans les stats, ni les signatures » — c'était ça. Les
      // statistiques comptent les dossiers à l'étape qu'ils ont atteinte ;
      // les déplacer à l'archivage les effaçait de leur colonne au moment
      // précis où l'affaire était réalisée. Ce déplacement n'a plus lieu
      // d'être : le chiffre d'affaires se calcule désormais sur l'archivage
      // et le montant confirmé, sans regarder le nom de l'étape.
      //
      // Beaucoup de fiches n'ont pas de pipeline_id en base : le Pipeline les
      // affiche dans le pipeline ouvert, mais la colonne reste vide. Le
      // Tableau de bord, lui, ne peut pas deviner. On la renseigne donc au
      // moment de l'archivage, à partir de l'étape où se trouve la fiche —
      // sinon le montant confirmé n'entre jamais dans le chiffre d'affaires.
      let pipelineARenseigner: string | null = null;
      {
        const { data: ligne } = await supabase
          .from('leads')
          .select('pipeline_id, stage_id')
          .eq('id', clientId)
          .maybeSingle();
        const brut = ligne as { pipeline_id: string | null; stage_id: string | null } | null;
        let pipelineId = brut?.pipeline_id ?? null;
        if (!pipelineId && brut?.stage_id) {
          const { data: etape } = await supabase
            .from('pipeline_stages')
            .select('pipeline_id')
            .eq('id', brut.stage_id)
            .maybeSingle();
          pipelineId = (etape as { pipeline_id: string | null } | null)?.pipeline_id ?? null;
          if (pipelineId) pipelineARenseigner = pipelineId;
        }
      }

      const { error } = await supabase
        .from('leads')
        .update({
          archived_at: new Date().toISOString(),
          signed_at: signed ? new Date().toISOString() : null,
          // Demandé le 6 septembre : « du moment que le dossier est
          // archivé [et signé], il faut que la commission courtier soit
          // cochée par défaut » — elle est décidée à l'archivage, contre la
          // commission Banque qui n'arrive que plus tard et se coche à la
          // main une fois réellement payée par la banque.
          commission_validee: signed,
          // Champ laissé vide : on ne touche pas au montant déjà enregistré,
          // plutôt que de l'effacer par inadvertance.
          ...(montant === null ? {} : { estimated_value: versBase(montant) }),
          // Saisis tels quels : la commission du conseiller est déjà une
          // valeur TTC par définition, et la récurrence n'est pas une base
          // taxable — aucune conversion sur ces deux-là.
          ...(commission === null ? {} : { advisor_commission_ttc: commission }),
          ...(recurrence === null ? {} : { recurring_amount: recurrence }),
          ...(pipelineARenseigner ? { pipeline_id: pipelineARenseigner } : {}),
        } as any)
        .eq('id', clientId);
      if (error) throw error;
      toast.success('Fiche archivée');
      qc.invalidateQueries({ queryKey: ['contacts_all'] });
      // Sans ça, le Tableau de bord garderait l'ancien montant jusqu'au
      // prochain rechargement complet.
      qc.invalidateQueries({ queryKey: ['deals'] });
      setShowArchiveModal(false);
      onBack();
    } catch (e: any) {
      toast.error(e?.message || "Impossible d'archiver la fiche");
    } finally {
      setArchiving(false);
    }
  };

  // Retour arrière signalé : l'action "Désarchiver" n'existait nulle part
  // dans le menu Actions d'une fiche déjà archivée — seule la voie
  // d'archivage existait, sans moyen d'en sortir depuis la fiche.
  const handleUnarchive = async () => {
    setArchiving(true);
    try {
      const { error } = await supabase
        .from('leads')
        .update({ archived_at: null } as any)
        .eq('id', clientId);
      if (error) throw error;
      toast.success('Fiche désarchivée');
      qc.invalidateQueries({ queryKey: ['contacts_all'] });
    } catch (e: any) {
      toast.error(e?.message || "Impossible de désarchiver la fiche");
    } finally {
      setArchiving(false);
    }
  };

  // Questionnaire confidentiel
  interface QuestionnaireRow {
    id: string;
    token: string;
    sentToEmail: string;
    status: 'pending' | 'completed';
    sentAt: string;
    completedAt: string | null;
    answers: any;
  }
  const [showQuestionnaireModal, setShowQuestionnaireModal] = useState(false);
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireRow[]>([]);
  const [questionnairesLoading, setQuestionnairesLoading] = useState(false);
  const [questionnaireEmail, setQuestionnaireEmail] = useState('');
  const [questionnaireSending, setQuestionnaireSending] = useState(false);
  const [expandedQuestionnaireId, setExpandedQuestionnaireId] = useState<string | null>(null);
  const pendingQuestionnairesCount = questionnaires.filter((q) => q.status === 'pending').length;
  const completedQuestionnairesCount = questionnaires.filter((q) => q.status === 'completed').length;

  // ── Consentement au démarchage téléphonique (Immosphera uniquement) ─────
  // Porté depuis l'ancien CRM (ConnectSphere) : table `confidential_questionnaires`
  // filtrée sur kind='consent'. Lecture seule ici — l'envoi d'un nouveau
  // consentement se fait toujours depuis l'ancien outil pour le moment.
  const IMMOSPHERA_ID = '15157da9-71ea-4760-ae1c-3bc99d9caa20';
  const isImmosphera = matchesAgency(client?.agencyId, IMMOSPHERA_ID);
  const { data: consentRecords = [] } = useLeadConsents(clientId, isImmosphera);
  // Demande explicite (16 septembre) : « quand le consentement a été
  // signé, mets à jour sur la fiche du contact » — la signature se fait
  // depuis la page publique (un autre appareil/onglet, sans session CRM) ;
  // sans ceci, la fiche déjà ouverte restait sur l'ancien statut tant
  // qu'elle n'était pas rechargée à la main. Même principe que le chat
  // partagé juste au-dessus (client-share-chat).
  useEffect(() => {
    if (!isImmosphera || !clientId) return;
    const channel = supabase
      .channel(`consentement-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'confidential_questionnaires', filter: `lead_id=eq.${clientId}` },
        () => qc.invalidateQueries({ queryKey: ['consent-forms-full', clientId] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isImmosphera, clientId, qc]);

  // Signalé (16 septembre) : « tu n'as pas mis en place le consentement
  // pour les agents immobiliers, mais le questionnaire confidentiel. Qui
  // n'est pas pour immosphera mais pour conseils finances uniquement » —
  // le Consentement (ci-dessus) est déjà bien réservé à Immosphera ; c'est
  // le Questionnaire confidentiel qui n'avait AUCUNE restriction d'agence
  // (visible pour tout le monde, Immosphera compris) alors qu'il ne
  // concerne que Conseils Finances. Réutilise `estConseilsFinances`,
  // déjà calculé plus haut (ligne ~569) pour les honoraires TTC.
  const [consentViewOpen, setConsentViewOpen] = useState(false);
  const hasConsent = consentRecords.length > 0;
  const signedConsents = consentRecords.filter((r) => r.submitted_at);
  const submittedConsentCount = signedConsents.length;
  const latestSignedConsent = latestConsent(signedConsents);
  const displayedConsent = latestSignedConsent ?? latestConsent(consentRecords);
  const consentSenderIds = latestSignedConsent?.created_by ? [latestSignedConsent.created_by] : [];
  const { data: consentSenders = {} } = useConsentSenders(consentSenderIds);
  const consentSignedDate = consentSignedAt(latestSignedConsent);
  const consentExpiryDate = consentValidUntil(latestSignedConsent);
  const consentExpired = isConsentExpired(latestSignedConsent);

  const [showSendConsentModal, setShowSendConsentModal] = useState(false);
  const [consentSendEmail, setConsentSendEmail] = useState('');
  const [consentSending, setConsentSending] = useState(false);
  const [consentSendError, setConsentSendError] = useState<string | null>(null);
  const consentPdfRef = useRef<HTMLDivElement | null>(null);
  const [consentPdfDownloading, setConsentPdfDownloading] = useState(false);

  const handleDownloadConsentPdf = async () => {
    if (!consentPdfRef.current || !latestSignedConsent) return;
    setConsentPdfDownloading(true);
    try {
      const name = (client?.name ?? 'client').replace(/\s+/g, '_');
      const dateStr = formatFr(consentSignedDate).replace(/\//g, '-');
      await downloadConsentPdf(consentPdfRef.current, `consentement_${name}_${dateStr}.pdf`);
    } catch (e: any) {
      toast.error(e?.message || 'Échec du téléchargement du PDF.');
    } finally {
      setConsentPdfDownloading(false);
    }
  };

  const handleSendConsent = async () => {
    const email = consentSendEmail.trim();
    if (!email) return;
    setConsentSending(true);
    setConsentSendError(null);
    try {
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
      const link = `${window.location.origin}/consentement/${token}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await supabase.from('confidential_questionnaires' as any).insert({
        lead_id: clientId,
        agency_id: client?.agencyId || null,
        created_by: currentUserId,
        sent_to_email: email,
        token,
        kind: 'consent',
        expires_at: expiresAt,
      } as any);
      if (error) throw error;

      let token2 = getCachedAccessToken();
      if (!token2) token2 = await requestWorkspaceAccessToken().catch(() => null);
      if (token2) {
        await sendGmailMessage(token2, {
          to: email,
          subject: 'Consentement au démarchage téléphonique — merci de le signer',
          body: `Bonjour,\n\nMerci de compléter et signer votre consentement au démarchage téléphonique :\n${link}\n\nCordialement,\n${currentUserName}`,
          bodyHtml: `<p>Bonjour,</p><p>Merci de compléter et signer votre consentement au démarchage téléphonique en cliquant sur le lien ci-dessous :</p><p><a href="${link}">${link}</a></p><p>Cordialement,<br/>${currentUserName}</p>`,
        }).catch((e) => {
          toast.error("La demande a été créée mais l'email n'a pas pu être envoyé : " + (e?.message || 'erreur'));
        });
      } else {
        toast.error("Connectez votre compte Google Workspace (Paramètres) pour envoyer l'email automatiquement. Le lien a été créé : " + link);
      }

      toast.success('Consentement envoyé au client');
      setConsentSendEmail('');
      setShowSendConsentModal(false);
      qc.invalidateQueries({ queryKey: ['consent-forms-full', clientId] });
    } catch (e: any) {
      setConsentSendError(e?.message || "Impossible d'envoyer le consentement.");
    } finally {
      setConsentSending(false);
    }
  };

  const loadQuestionnaires = async () => {
    setQuestionnairesLoading(true);
    try {
      const { data, error } = await supabase
        .from('credit_questionnaires' as any)
        .select('id, token, sent_to_email, status, sent_at, completed_at, answers')
        .eq('lead_id', clientId)
        .order('sent_at', { ascending: false });
      if (error) throw error;
      setQuestionnaires(
        ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          token: r.token,
          sentToEmail: r.sent_to_email,
          status: r.status,
          sentAt: r.sent_at,
          completedAt: r.completed_at,
          answers: r.answers,
        }))
      );
    } catch (e) {
      // silencieux
    } finally {
      setQuestionnairesLoading(false);
    }
  };

  useEffect(() => {
    // Questionnaire confidentiel : Conseils Finances uniquement (voir plus
    // haut, estConseilsFinances) — inutile de charger quoi que ce soit
    // ailleurs.
    if (estConseilsFinances) loadQuestionnaires();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, estConseilsFinances]);

  const loadClientEmails = async () => {
    if (!client?.email) return;
    setLoadingClientEmails(true);
    setClientEmailsError(null);
    try {
      const token = getCachedAccessToken() || (await requestWorkspaceAccessToken());
      const msgs = await fetchGmailMessages(token, {
        query: `from:${client.email} OR to:${client.email}`,
        maxResults: 25,
        includeSpamTrash: false,
      });
      setClientEmails(msgs);
    } catch (e: any) {
      setClientEmailsError(e?.message || "Impossible de charger les e-mails.");
    } finally {
      setLoadingClientEmails(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'emails' && client?.email) void loadClientEmails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, client?.email]);

  const loadClientCalendar = async () => {
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      let token = getCachedAccessToken();
      if (!token) token = await hydrateAccessTokenFromSession();
      if (!token) {
        setCalendarError('workspace-non-connecte');
        return;
      }
      const events = await fetchGoogleCalendarEvents(token);
      setCalendarEvents(events);
    } catch (err: any) {
      setCalendarError(err?.message || 'Erreur lors du chargement de l\'agenda.');
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'agenda') void loadClientCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const submitNewAppointment = async () => {
    if (!newApptTitle.trim() || !newApptDate.trim() || !client) return;
    setCreatingAppt(true);
    setCalendarError(null);
    try {
      let token = getCachedAccessToken();
      if (!token) token = await hydrateAccessTokenFromSession();
      if (!token) {
        setCalendarError('workspace-non-connecte');
        return;
      }
      const startISO = new Date(`${newApptDate}T${newApptTime}:00`).toISOString();
      const endISO = new Date(new Date(`${newApptDate}T${newApptTime}:00`).getTime() + newApptDuration * 60 * 1000).toISOString();
      await createGoogleCalendarEvent(token, {
        summary: newApptTitle.trim(),
        description: `Client : ${client.name}`,
        location: newApptLocation.trim() || undefined,
        startISO,
        endISO,
      });
      toast.success('Rendez-vous créé et synchronisé sur Google Agenda.');
      setShowNewAppointment(false);
      setNewApptTitle('');
      setNewApptDate('');
      setNewApptTime('09:00');
      setNewApptDuration(30);
      setNewApptLocation('');
      void loadClientCalendar();
    } catch (err: any) {
      toast.error(err?.message || 'Impossible de créer le rendez-vous.');
    } finally {
      setCreatingAppt(false);
    }
  };

  // Ticket #47 : répondre directement depuis la lightbox, dans le même fil
  // Gmail (threadId + In-Reply-To/References quand l'en-tête Message-Id est
  // disponible — sinon Gmail range quand même le message dans le même
  // threadId, juste sans le lien de citation visuel).
  const handleSendEmailReply = async () => {
    if (!openEmail || !emailReplyBody.trim()) return;
    setEmailReplySending(true);
    try {
      const token = getCachedAccessToken() || (await requestWorkspaceAccessToken());
      const subject = openEmail.subject?.startsWith('Re:') ? openEmail.subject : `Re: ${openEmail.subject || ''}`;
      await sendGmailMessage(token, {
        to: openEmail.from,
        subject,
        body: emailReplyBody.trim(),
        threadId: openEmail.threadId,
        inReplyTo: openEmail.messageIdHeader,
        references: openEmail.messageIdHeader,
      });
      toast.success('Réponse envoyée.');
      setEmailReplyBody('');
      setEmailReplyOpen(false);
      setOpenEmail(null);
      await loadClientEmails();
    } catch (e: any) {
      toast.error(e?.message || "Impossible d'envoyer la réponse.");
    } finally {
      setEmailReplySending(false);
    }
  };

  useEffect(() => {
    if (showQuestionnaireModal) {
      setQuestionnaireEmail(client?.email || '');
      loadQuestionnaires();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQuestionnaireModal]);

  const handleSendQuestionnaire = async () => {
    const email = questionnaireEmail.trim();
    if (!email) return;
    setQuestionnaireSending(true);
    try {
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
      const link = `${window.location.origin}/questionnaire/${token}`;

      const { error } = await supabase.from('credit_questionnaires' as any).insert({
        lead_id: clientId,
        agency_id: client?.agencyId || null,
        sent_by: currentUserId,
        sent_to_email: email,
        token,
        status: 'pending',
      } as any);
      if (error) throw error;

      // Envoi de l'email via Gmail (compte Google Workspace de l'utilisateur
      // connecté — "users/me" sur l'API Gmail envoie déjà nécessairement
      // depuis ce compte-là, un `From:` explicite n'est ni nécessaire ni
      // souhaitable : s'il ne correspond pas exactement à un alias "send-as"
      // autorisé sur ce compte Workspace, Gmail rejette l'envoi entier).
      let token2 = getCachedAccessToken();
      if (!token2) token2 = await requestWorkspaceAccessToken().catch(() => null);

      let emailSent = false;
      if (token2) {
        try {
          await sendGmailMessage(token2, {
            to: email,
            subject: 'Questionnaire confidentiel — merci de le compléter',
            body: `Bonjour,\n\nMerci de compléter votre questionnaire confidentiel :\n${link}\n\nCes informations resteront strictement confidentielles et sécurisées.\n\nCordialement,\n${currentUserName}`,
            bodyHtml: `<p>Bonjour,</p><p>Merci de compléter votre questionnaire confidentiel en cliquant sur le lien ci-dessous :</p><p><a href="${link}">${link}</a></p><p>Ces informations resteront strictement confidentielles et sécurisées.</p><p>Cordialement,<br/>${currentUserName}</p>`,
          });
          emailSent = true;
        } catch (e: any) {
          console.error('Envoi questionnaire (Gmail) échoué :', e);
          // Signalé : le message de succès s'affichait quand même juste après
          // cette erreur — impossible de distinguer "vraiment envoyé" de
          // "fiche créée mais e-mail parti nulle part". On ne montre plus
          // QUE cette erreur dans ce cas, jamais le toast de succès.
          toast.error("L'e-mail n'a pas pu être envoyé (" + (e?.message || 'erreur inconnue') + "). Lien : " + link, { duration: 10000 });
        }
      } else {
        // Ticket #108 (suivi) : le jeton Google expire ~1h après connexion et
        // rien ne le renouvelait — plus de renvoi vers un bouton "Paramètres"
        // inexistant, un vrai bouton de reconnexion directement sur le toast.
        toast.error("Votre accès Google a expiré, l'e-mail n'a pas pu être envoyé automatiquement. Le lien a été créé : " + link, {
          duration: 15000,
          action: {
            label: 'Reconnecter Google',
            onClick: () => { void reconnectGoogleWorkspace(); },
          },
        });
      }

      if (emailSent) {
        toast.success('Questionnaire envoyé par e-mail à ' + email);
      }
      setQuestionnaireEmail('');
      await loadQuestionnaires();
    } catch (e: any) {
      toast.error(e?.message || "Impossible d'envoyer le questionnaire");
    } finally {
      setQuestionnaireSending(false);
    }
  };

  const handleDeleteQuestionnaire = async (id: string) => {
    if (!confirm('Supprimer cet envoi de questionnaire ?')) return;
    try {
      const { error } = await supabase.from('credit_questionnaires' as any).delete().eq('id', id);
      if (error) throw error;
      await loadQuestionnaires();
    } catch (e: any) {
      toast.error(e?.message || 'Impossible de supprimer');
    }
  };

  const copyQuestionnaireLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/questionnaire/${token}`).catch(() => {});
    toast.success('Lien copié');
  };

  // Chat de la fiche partagée
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatText, setEditingChatText] = useState('');
  const [readByModalMsg, setReadByModalMsg] = useState<ChatMessageRow | null>(null);
  const [isRecordingChat, setIsRecordingChat] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadingChatMedia, setUploadingChatMedia] = useState(false);
  const chatMediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chatAudioChunksRef = React.useRef<Blob[]>([]);
  const chatRecordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const chatImageInputRef = React.useRef<HTMLInputElement>(null);
  const chatVideoInputRef = React.useRef<HTMLInputElement>(null);
  const chatScrollRef = React.useRef<HTMLDivElement>(null);

  const CHAT_ROW_SELECT =
    'id, sender_id, sender_name, body, created_at, image_url, video_url, audio_url, audio_duration, is_edited, is_deleted, read_by, reactions';

  const mapChatRow = (r: any): ChatMessageRow => ({
    id: r.id,
    senderId: r.sender_id,
    senderName: r.sender_name || 'Utilisateur',
    body: r.body || '',
    createdAt: r.created_at,
    imageUrl: r.image_url ?? null,
    videoUrl: r.video_url ?? null,
    audioUrl: r.audio_url ?? null,
    audioDuration: r.audio_duration ?? null,
    isEdited: !!r.is_edited,
    isDeleted: !!r.is_deleted,
    readBy: Array.isArray(r.read_by) ? r.read_by : [],
    reactions: Array.isArray(r.reactions) ? r.reactions : [],
  });

  const loadChat = async () => {
    if (!client) { setChatMessages([]); setChatLoading(false); return; }
    setChatLoading(true);
    try {
      const { data, error } = await supabase
        .from('client_share_messages' as any)
        .select(CHAT_ROW_SELECT)
        .eq('lead_id', clientId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setChatMessages(((data ?? []) as any[]).map(mapChatRow));
    } catch (e) {
      setChatMessages([]);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'chat') return;
    loadChat();
    const channel = supabase
      .channel(`client-share-chat-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_share_messages', filter: `lead_id=eq.${clientId}` },
        () => loadChat()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, clientId]);

  // Auto-scroll bas de conversation
  useEffect(() => {
    if (activeTab === 'chat') chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [chatMessages, activeTab]);

  // Accusés de lecture : marquer comme lus les messages des autres dès l'ouverture du tab
  useEffect(() => {
    if (activeTab !== 'chat' || chatLoading) return;
    const toMark = chatMessages.filter(
      (m) => m.senderId !== currentUserId && !m.isDeleted && !m.readBy.some((r) => r.userId === currentUserId)
    );
    if (toMark.length === 0) return;
    (async () => {
      for (const m of toMark) {
        const nextReadBy = [...m.readBy, { userId: currentUserId, userName: currentUserName, readAt: new Date().toISOString() }];
        await supabase.from('client_share_messages' as any).update({ read_by: nextReadBy } as any).eq('id', m.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, chatLoading, chatMessages.length]);

  const insertChatMessage = async (fields: Partial<{ body: string; image_url: string; video_url: string; audio_url: string; audio_duration: number }>) => {
    const { error } = await supabase.from('client_share_messages' as any).insert({
      lead_id: clientId,
      sender_id: currentUserId,
      sender_name: currentUserName,
      body: fields.body || '',
      image_url: fields.image_url || null,
      video_url: fields.video_url || null,
      audio_url: fields.audio_url || null,
      audio_duration: fields.audio_duration || null,
      read_by: [{ userId: currentUserId, userName: currentUserName, readAt: new Date().toISOString() }],
    } as any);
    if (error) throw error;
    await loadChat();

    // Ticket #55 : un message dans le Chat du dossier partagé doit
    // prévenir l'autre côté, comme pour une note/un document partagé.
    const preview =
      fields.body?.trim() ||
      (fields.image_url ? '📷 Photo' : fields.video_url ? '🎥 Vidéo' : fields.audio_url ? '🎤 Message vocal' : 'Nouveau message');
    void notifyShareParticipants({
      type: 'shared_chat_message',
      title: '💬 Nouveau message',
      message: `${currentUserName} (${client?.name || 'dossier partagé'}) : ${preview}`,
    });
  };

  const handleSendChat = async () => {
    const body = chatInput.trim();
    if (!body) return;
    setChatSending(true);
    try {
      await insertChatMessage({ body });
      setChatInput('');
    } catch (e: any) {
      toast.error(e?.message || "Impossible d'envoyer le message");
    } finally {
      setChatSending(false);
    }
  };

  const handleChatImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      try {
        setUploadingChatMedia(true);
        await insertChatMessage({ image_url: dataUrl });
      } catch (err: any) {
        toast.error(err?.message || "Impossible d'envoyer l'image");
      } finally {
        setUploadingChatMedia(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleChatVideoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_VIDEO_SIZE) {
      toast.error('Vidéo trop volumineuse (150 Mo maximum)');
      return;
    }
    setUploadingChatMedia(true);
    try {
      let token = getCachedAccessToken();
      if (!token) token = await requestWorkspaceAccessToken().catch(() => null);
      if (token) {
        const res = await uploadVideoToDriveFolder(token, file, client?.name || 'Fiche client');
        await insertChatMessage({ video_url: res.fileUrl });
      } else {
        await insertChatMessage({ video_url: URL.createObjectURL(file) });
      }
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'envoyer la vidéo");
    } finally {
      setUploadingChatMedia(false);
    }
  };

  const handleStartRecordingChat = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickVoiceMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chatMediaRecorderRef.current = recorder;
      chatAudioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chatAudioChunksRef.current.push(e.data); };
      recorder.start(100);
      setIsRecordingChat(true);
      setRecordingSeconds(0);
      chatRecordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (err) {
      toast.error('Microphone indisponible ou refusé');
    }
  };

  const handleStopRecordingChat = async (cancel = false) => {
    const recorder = chatMediaRecorderRef.current;
    if (chatRecordingTimerRef.current) { clearInterval(chatRecordingTimerRef.current); chatRecordingTimerRef.current = null; }
    const duration = recordingSeconds;
    setIsRecordingChat(false);
    setRecordingSeconds(0);
    if (!recorder || recorder.state === 'inactive') return;

    if (cancel) {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
      chatAudioChunksRef.current = [];
      return;
    }

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chatAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        try {
          setUploadingChatMedia(true);
          await insertChatMessage({ audio_url: dataUrl, audio_duration: duration });
        } catch (err: any) {
          toast.error(err?.message || "Impossible d'envoyer le vocal");
        } finally {
          setUploadingChatMedia(false);
        }
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  };

  const handleSaveEditChat = async (msg: ChatMessageRow) => {
    const body = editingChatText.trim();
    if (!body) return;
    try {
      const { error } = await supabase
        .from('client_share_messages' as any)
        .update({ body, is_edited: true, edited_at: new Date().toISOString() } as any)
        .eq('id', msg.id);
      if (error) throw error;
      setEditingChatId(null);
      setEditingChatText('');
      await loadChat();
    } catch (e: any) {
      toast.error(e?.message || 'Impossible de modifier le message');
    }
  };

  const handleDeleteChatMsg = async (msg: ChatMessageRow) => {
    if (!confirm('Supprimer ce message ?')) return;
    try {
      const { error } = await supabase
        .from('client_share_messages' as any)
        .update({ is_deleted: true, body: '', image_url: null, video_url: null, audio_url: null } as any)
        .eq('id', msg.id);
      if (error) throw error;
      await loadChat();
    } catch (e: any) {
      toast.error(e?.message || 'Impossible de supprimer le message');
    }
  };

  const handleToggleReaction = async (msg: ChatMessageRow, emoji: string) => {
    const already = msg.reactions.find((r) => r.emoji === emoji && r.userId === currentUserId);
    const next = already
      ? msg.reactions.filter((r) => !(r.emoji === emoji && r.userId === currentUserId))
      : [...msg.reactions, { emoji, userId: currentUserId }];
    try {
      const { error } = await supabase.from('client_share_messages' as any).update({ reactions: next } as any).eq('id', msg.id);
      if (error) throw error;
      setShowEmojiPickerFor(null);
      await loadChat();
    } catch (e: any) {
      toast.error(e?.message || 'Impossible de réagir');
    }
  };

  useEffect(() => {
    if (client?.comments !== undefined) {
      setContactComments(client.comments || '');
    }
  }, [client?.comments]);

  const loadNotes = async () => {
    if (!client || !currentUser) {
      setClientNotes([]);
      setNotesLoading(false);
      return;
    }

    setNotesLoading(true);
    try {
      const { data, error: sbErr } = await supabase
        .from('comments')
        .select('*')
        .eq('lead_id', client.id)
        .order('is_pinned', { ascending: false })
        .order('position', { ascending: false })
        .order('created_at', { ascending: false });

      if (sbErr) throw sbErr;

      // La table `comments` n'a pas de colonne "titre" : si on en a saisi un
      // à la création, il est stocké comme 1ère ligne en gras du corps du texte.
      const splitTitle = (body: string): { title: string; content: string } => {
        const m = /^\*\*(.+?)\*\*\n([\s\S]*)$/.exec(body || '');
        if (m) return { title: m[1], content: m[2] };
        return { title: 'Note', content: body || '' };
      };

      const rows: ClientNoteItem[] = (data || []).map((item: any) => {
        const { title, content } = splitTitle(item.body);
        return {
          id: item.id,
          title,
          content,
          category: 'Note',
          updatedAt: item.updated_at || item.created_at || new Date().toISOString(),
          agencyId: client.agencyId,
          contactId: item.lead_id,
          contactName: client.name,
          isPinned: !!item.is_pinned,
          createdByUserId: item.user_id || '',
          createdByEmail: '',
          createdByName: 'Collaborateur',
          createdAt: item.created_at || new Date().toISOString(),
          isShared: !!item.is_shared,
        };
      });

      setClientNotes(rows);
    } catch (error) {
      console.error('Erreur chargement notes client :', error);
      setProfileError("Impossible de charger les notes de ce client.");
    } finally {
      setNotesLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, currentUser?.uid]);

  // Synchronisation temps réel : toute note créée/modifiée/supprimée sur ce
  // client (par moi ou un collègue, ou depuis un autre écran) rafraîchit la liste.
  useEffect(() => {
    if (!client?.id) return;
    const channel = supabase
      .channel(`notes_lead_${client.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `lead_id=eq.${client.id}` },
        () => {
          loadNotes();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);

  const loadDocs = async () => {
    if (!client || !currentUser) {
      setClientDocs([]);
      setDocsLoading(false);
      return;
    }

    setDocsLoading(true);
    try {
      const { data, error: sbErr } = await supabase
        .from('documents')
        .select('*')
        .eq('lead_id', client.id)
        .order('created_at', { ascending: false });

      if (sbErr) throw sbErr;

      const uploaderIds = Array.from(new Set((data || []).map((d: any) => d.uploaded_by).filter(Boolean)));
      const uploaderNames: Record<string, string> = {};
      if (uploaderIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', uploaderIds);
        (profs || []).forEach((p: any) => {
          uploaderNames[p.id] = p.full_name || p.email || 'Collaborateur';
        });
      }

      const rows: ClientDocItem[] = (data || []).map((item: any) => ({
        id: item.id,
        type: 'file',
        name: item.file_name || 'Document',
        category: 'Autre',
        size: item.size_bytes ? `${(item.size_bytes / 1024).toFixed(1)} Ko` : 'N/A',
        mimeType: item.mime_type || 'application/octet-stream',
        updatedAt: item.created_at || new Date().toISOString(),
        uploadedBy: uploaderNames[item.uploaded_by] || 'Collaborateur',
        url: item.drive_web_view_link || '#',
        driveFileId: item.drive_file_id || '',
        contactId: client.id,
        contactName: client.name,
        agencyId: client.agencyId,
        uploadedByUserId: item.uploaded_by || currentUser.uid,
        uploadedByEmail: '',
        uploadedByName: uploaderNames[item.uploaded_by] || 'Collaborateur',
        createdAt: item.created_at || new Date().toISOString(),
        isShared: !!item.is_shared,
      }));

      setClientDocs(rows);
    } catch (error) {
      console.error('Erreur chargement documents client :', error);
      setProfileError("Impossible de charger les documents de ce client.");
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, currentUser?.uid]);

  useEffect(() => {
    if (!client?.id) return;
    const channel = supabase
      .channel(`documents_lead_${client.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documents', filter: `lead_id=eq.${client.id}` },
        () => {
          loadDocs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);

  const handleSaveComments = async () => {
    if (!client) return;
    await updateContact.mutateAsync({
      id: client.id,
      updates: { comments: contactComments }
    });
    setSavedCommentsSuccess(true);
    setTimeout(() => setSavedCommentsSuccess(false), 2500);
  };

  const handleOpenCreateNote = () => {
    setEditingNoteId(null);
    setNoteTitle('');
    setNoteCategory('Suivi Client');
    setNoteContent('');
    setShowNewNoteModal(true);
  };

  const handleOpenEditNote = (note: ClientNoteItem) => {
    setEditingNoteId(note.id);
    setNoteTitle(note.title);
    setNoteCategory(note.category || 'Suivi Client');
    setNoteContent(note.content);
    setShowNewNoteModal(true);
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!client || !currentUser) return;

    const trimmedTitle = noteTitle.trim();
    // Pas de colonne "titre" dans `comments` : on le préfixe en gras dans le corps.
    const body = trimmedTitle
      ? `**${trimmedTitle}**\n${noteContent.trim()}`
      : noteContent.trim();

    const now = new Date().toISOString();

    setNoteSaving(true);
    setProfileError(null);
    setProfileSuccess(null);

    try {
      const { error: sbErr } = editingNoteId
        ? await supabase.from('comments').update({
            body,
            updated_at: now,
          }).eq('id', editingNoteId)
        : await supabase.from('comments').insert({
            lead_id: client.id,
            body,
            user_id: currentUser.uid,
            created_at: now,
            updated_at: now,
            is_shared: noteIsShared,
          } as any);

      if (sbErr) throw sbErr;

      // Ticket #55 : pas de notification JS ici — un trigger base de
      // données (`trg_notify_shared_comment_insert`) prévient déjà tous
      // les participants du partage dès qu'une note est insérée avec
      // `is_shared = true`. Un appel ici ferait doublon.

      setNoteTitle('');
      setNoteContent('');
      setNoteIsShared(false);
      setEditingNoteId(null);
      setShowNewNoteModal(false);
      setProfileSuccess('Note enregistrée.');
      await loadNotes();
    } catch (error) {
      console.error('Erreur sauvegarde note client :', error);
      setProfileError("La note n'a pas pu être enregistrée.");
    } finally {
      setNoteSaving(false);
    }
  };

  const getGoogleToken = async () => {
    let token = getCachedAccessToken();

    if (!token) {
      token = await requestWorkspaceAccessToken();
    }

    return token;
  };

  const handleAddDoc = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!client || !currentUser) return;

    if (!docName.trim()) {
      setProfileError('Le nom du document est obligatoire.');
      return;
    }

    if (!docFile) {
      setProfileError('Sélectionnez un fichier à envoyer.');
      return;
    }

    if (docFile.size > 50 * 1024 * 1024) {
      setProfileError('Le fichier dépasse la limite de 50 Mo.');
      return;
    }

    setDocSaving(true);
    setProfileError(null);
    setProfileSuccess(null);

    try {
      const token = await getGoogleToken();

      const agencyName =
        AGENCIES.find((agency) =>
          matchesAgency(client.agencyId, agency.id)
        )?.name || 'Nova CRM';

      const upload = await uploadDocumentToDrive(
        token,
        docFile,
        agencyName
      );

      const now = new Date().toISOString();

      const documentId =
        `doc-file-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      const newDoc: ClientDocItem = {
        id: documentId,
        type: 'file',
        name: docName.trim(),
        category: docCategory,
        size:
          docFile.size < 1024 * 1024
            ? `${(docFile.size / 1024).toFixed(1)} Ko`
            : `${(docFile.size / 1024 / 1024).toFixed(1)} Mo`,
        mimeType:
          docFile.type || 'application/octet-stream',
        updatedAt: now,

        uploadedBy:
          userProfile?.displayName ||
          currentUser.displayName ||
          currentUser.email ||
          'Utilisateur Nova CRM',

        url: upload.fileUrl,
        downloadUrl: upload.downloadUrl,
        driveFileId: upload.fileId,
        driveFolderName: upload.folderName,

        contactId: client.id,
        contactName: client.name,
        agencyId: client.agencyId,

        uploadedByUserId: currentUser.uid,
        uploadedByEmail:
          currentUser.email?.trim().toLowerCase() || '',
        uploadedByName:
          userProfile?.displayName ||
          currentUser.displayName ||
          currentUser.email ||
          'Utilisateur Nova CRM',

        createdAt: now,
      };

      const { error: docInsertErr } = await supabase.from('documents').insert({
        agency_id: client.agencyId,
        lead_id: client.id,
        uploaded_by: currentUser.uid,
        file_name: docName.trim(),
        mime_type: docFile.type || 'application/octet-stream',
        size_bytes: docFile.size,
        drive_web_view_link: upload.fileUrl,
        drive_file_id: upload.fileId,
        created_at: now,
        is_shared: docIsShared,
      } as any);
      if (docInsertErr) throw docInsertErr;

      // Ticket #55 : pas de notification JS ici — un trigger base de
      // données (`trg_notify_shared_document`) prévient déjà tous les
      // participants du partage dès qu'un document est inséré avec
      // `is_shared = true`. Un appel ici ferait doublon.

      setDocName('');
      setDocFile(null);
      setDocIsShared(false);
      await loadDocs();
      setShowDocModal(false);
      setProfileSuccess('Document ajouté à la fiche client.');
    } catch (error) {
      console.error('Erreur ajout document client :', error);
      setProfileError(
        (error as Error).message ||
          "Impossible d'ajouter le document."
      );
    } finally {
      setDocSaving(false);
    }
  };

  const handleDeleteDoc = async (documentItem: ClientDocItem) => {
    const canDelete =
      userProfile?.role === 'super_admin' ||
      documentItem.uploadedByUserId === currentUser?.uid;

    if (!canDelete) {
      setProfileError(
        "Seul le créateur du document ou le Super Admin peut le supprimer."
      );
      return;
    }

    const confirmed = window.confirm(
      `Supprimer "${documentItem.name}" de la fiche client et de Google Drive ?`
    );

    if (!confirmed) return;

    setProfileError(null);
    setProfileSuccess(null);

    try {
      const token = await getGoogleToken();

      if (documentItem.driveFileId) {
        await deleteDriveFile(token, documentItem.driveFileId);
      }

      const { error: delErr } = await supabase.from('documents').delete().eq('id', documentItem.id);
      if (delErr) throw delErr;

      setProfileSuccess('Document supprimé.');
      await loadDocs();
    } catch (error) {
      console.error('Erreur suppression document client :', error);
      setProfileError("Impossible de supprimer complètement le document.");
    }
  };

  const handleTogglePinNote = async (noteId: string) => {
    const note = clientNotes.find((item) => item.id === noteId);

    if (!note) return;

    try {
      const { error } = await supabase.from('comments').update({
        is_pinned: !note.isPinned,
        updated_at: new Date().toISOString(),
      }).eq('id', noteId);
      if (error) throw error;
      await loadNotes();
    } catch (error) {
      console.error('Erreur épinglage note :', error);
      setProfileError("Impossible de modifier l'épinglage de la note.");
    }
  };

  const handleDragEndNotes = async (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(clientNotes);
    const [reorderedItem] = items.splice(result.source.index, 1);

    items.splice(result.destination.index, 0, reorderedItem);

    const updatedWithOrder = items.map(
      (item, index) => ({
        ...item,
        order: index,
      })
    );

    setClientNotes(updatedWithOrder);
  };

  const toggleDictation = () => {
    const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      alert("La reconnaissance vocale n'est pas disponible sur ce navigateur. Veuillez utiliser Google Chrome ou Edge.");
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) { console.warn('Dictation stop error', e); }
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognitionApi();
      recognition.lang = 'fr-FR';
      recognition.continuous = true;
      recognition.interimResults = true;

      // CORRECTIF (31/08/2026) — signalé : « quand Natacha veut rédiger une
      // note en vocal, cela ne marche pas ». Deux defauts cumules :
      //
      // 1. ACCUMULATION. `setNoteContent(prev => prev + currentTranscript)`
      //    ajoutait a chaque evenement. Or Android Chrome renvoie tres souvent
      //    TOUT l'historique des resultats a chaque fois, avec resultIndex a
      //    0 : chaque passage reecrivait ce qui etait deja la, et la note
      //    gonflait en repetitions — le meme defaut que la dictee de Nova.
      //
      // 2. PERTE DU DERNIER SEGMENT. Seuls les segments marques `isFinal`
      //    etaient retenus. Si l'on arrete de parler avant que le navigateur
      //    ne valide le dernier, il n'etait jamais ecrit — et sur une phrase
      //    courte, souvent AUCUN segment n'atteint cet etat : la note restait
      //    vide, d'ou « ca ne marche pas ».
      //
      // On capture le texte deja saisi, puis on reconstruit la phrase entiere
      // a chaque evenement — segments definitifs ET en cours. L'operation
      // devient idempotente et ne perd plus rien.
      const texteDeBase = noteContent.trim();

      // 3. RÉPÉTITION DE LA MÊME LIGNE (signalé le 2 septembre, photo de la
      //    note de Natacha à l'appui). Concaténer tous les segments
      //    « définitifs » ne suffit pas : sur Android, Chrome empile une
      //    nouvelle entrée définitive à chaque prolongement de la phrase, si
      //    bien qu'on obtenait « j'ai / j'ai vu / j'ai vu le / j'ai vu le
      //    client... ».
      //
      // 4. DISPARITION EN COURS DE DICTÉE (signalé le 22 septembre) : « les
      //    mots apparaissent puis disparaissent ». `event.results` n'est pas
      //    toujours l'historique complet de la session — un aléa du moteur de
      //    reconnaissance peut le faire repartir sans les segments déjà
      //    dictés, ce qui effaçait une partie de la note en cours de route.
      //    `creerAccumulateurDictee` (voir src/lib/dictee.ts) retient
      //    lui-même, pour toute la session, ce qui est déjà confirmé — qui ne
      //    peut donc plus disparaître. Seul l'aperçu de la phrase en cours
      //    reste vivant, pour voir la dictée se construire en direct.
      dicteeRef.current = creerAccumulateurDictee(texteDeBase);
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        setNoteContent(dicteeRef.current!(event.results));
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch (err) {
      console.error('Dictée error:', err);
      setIsListening(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    const note = clientNotes.find((item) => item.id === noteId);

    if (!note) return;

    const canDelete =
      userProfile?.role === 'super_admin' ||
      note.createdByUserId === currentUser?.uid;

    if (!canDelete) {
      setProfileError(
        "Seul le créateur de la note ou le Super Admin peut la supprimer."
      );
      return;
    }

    try {
      const { error } = await supabase.from('comments').delete().eq('id', noteId);
      if (error) throw error;

      setProfileSuccess('Note supprimée.');
      await loadNotes();
    } catch (error) {
      console.error('Erreur suppression note client :', error);
      setProfileError("Impossible de supprimer la note.");
    }
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
  };

  if (!client) return (
    <div className="p-8 text-white">Client introuvable <button onClick={onBack} className="ml-4 underline text-[#F7BC5F]">Retour</button></div>
  );

  const agency = AGENCIES.find(a => a.id === client.agencyId);

  return (
    // Signalé sur mobile : rien n'apparaissait après "Commentaires" (les
    // onglets RDV/Notes/Emails/Documents restaient invisibles même en
    // scrollant). Cause : ce composant gérait son PROPRE défilement interne
    // (h-full overflow-hidden + une div enfant en overflow-y-auto), imbriqué
    // dans le <main> de l'appli qui défile lui aussi — schéma de double
    // conteneur de scroll notoirement fragile sur mobile Safari (la hauteur
    // "h-full" ne se calculait pas correctement dans ce contexte, coupant le
    // contenu). Simplifié : ce composant flotte maintenant normalement dans
    // <main>, qui gère le défilement de toute la page — plus de double scroll.
    <div className="flex flex-col bg-[#051416] animate-fade-in relative">
      {(profileError || profileSuccess) && (
        <div className="px-6 pt-4">
          {profileError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
              {profileError}
            </div>
          )}

          {profileSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs">
              {profileSuccess}
            </div>
          )}
        </div>
      )}

      {/* Top Header & Pipeline Visual */}
      {/* Demande explicite (30/08/2026, capture à l'appui) : "améliore les
          séparations entre les éléments, liseret obligatoire" — border-
          [#144447]/60 existait déjà partout ici mais se fondait dans les
          fonds tout aussi sombres (#07191b/#0a1e20), donc quasi invisible
          — même constat/correctif que le liseré du champ de saisie du chat
          plus tôt dans la session : passage à border-white/15, nettement
          plus visible sans être criard. */}
      <div className="bg-[#07191b] border-b border-white/15 p-4 sm:p-6 flex flex-col gap-4 sm:gap-6 sticky top-0 z-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={onBack} className="p-2 rounded-xl bg-black/40 hover:bg-black/60 border border-[#144447]/60 text-slate-300 transition-colors shrink-0">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight truncate">{client.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 text-xs font-bold">
                  {client.status}
                </span>
                <span className="text-sm text-slate-400">
                  Créé le {new Date(client.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 relative flex-wrap">
            {completedQuestionnairesCount > 0 && (
              <button
                onClick={() => setShowQuestionnaireModal(true)}
                title={`${completedQuestionnairesCount} questionnaire(s) confidentiel(s) rempli(s)`}
                className="px-3 py-2.5 font-black text-xs rounded-xl flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-all"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Questionnaire validé
              </button>
            )}
            {pendingQuestionnairesCount > 0 && (
              <button
                onClick={() => setShowQuestionnaireModal(true)}
                className="px-4 py-2.5 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg hover:scale-[1.02] transition-all bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25"
              >
                <Eye className="w-4 h-4" />
                Questionnaire
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/30 text-[10px]">{pendingQuestionnairesCount}</span>
              </button>
            )}
            <button
              onClick={() => setShowShareModal(true)}
              className={`px-4 py-2.5 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg hover:scale-[1.02] transition-all ${
                isSharedWithSomeone
                  ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-black/40 border border-[#144447]/60 text-slate-300 hover:bg-black/60'
              }`}
            >
              <Share2 className="w-4 h-4" />
              {isSharedWithSomeone ? `Partagé (${shares.length})` : 'Partager'}
            </button>
            {onOpenNova && (
              <button
                onClick={onOpenNova}
                title="Demander à Nova d'agir sur cette fiche (note, tâche, rendez-vous...)"
                className="px-4 py-2.5 bg-gradient-to-br from-[#F7BC5F] to-[#B8863F] hover:brightness-110 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg hover:scale-[1.02] transition-all"
              >
                <img src="/nova-mascotte.png" alt="" className="w-4 h-4 rounded-full object-cover" />
                Demander à Nova
              </button>
            )}
            <button
              onClick={() => setShowActionsMenu((v) => !v)}
              className="px-5 py-2.5 bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg hover:scale-[1.02] transition-all"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Actions
            </button>

            {showActionsMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowActionsMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-64 bg-[#0a1e20] border border-[#144447]/60 rounded-2xl shadow-2xl z-40 py-2 overflow-hidden">
                  {[
                    ...(estConseilsFinances ? [{ icon: ClipboardCheck, label: 'Questionnaire confidentiel', action: () => setShowQuestionnaireModal(true) }] : []),
                    { icon: Landmark, label: 'Parcours Crédit', action: () => setShowParcoursCredit(true) },
                    { icon: Calendar, label: 'Nouveau RDV/tâche', action: () => { setEditingTask(null); setShowTaskModal(true); } },
                    { icon: MessageSquare, label: 'Nouvelle note', action: () => { setActiveTab('notes'); setShowNewNoteModal(true); } },
                    { icon: Mail, label: 'Nouveau Mail', action: () => (onComposeMail ? onComposeMail(client.email || '') : toast.info('Ouvrez Mail depuis le menu latéral')) },
                    { icon: Pencil, label: 'Modifier', action: () => setShowEditModal(true) },
                    client.archivedAt
                      ? { icon: ArchiveRestore, label: 'Désarchiver', action: () => void handleUnarchive() }
                      : { icon: Archive, label: 'Archiver', action: () => setShowArchiveModal(true) },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { item.action(); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/5 hover:text-white text-left"
                    >
                      <item.icon className="w-4 h-4 text-[#F9C977]" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Pipeline réel — cliquer une étape l'enregistre en base */}
        <div className="bg-[#0a1e20] rounded-xl border border-white/15 p-4 pb-6 relative shadow-inner">
          <div className="flex items-center gap-2 mb-4 text-xs font-bold text-slate-400">
            Pipeline :
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/30 border border-[#144447] text-white text-xs font-semibold hover:bg-black/50 transition-colors">
                {currentPipelineName}
                <ChevronDown className="w-3.5 h-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-[220px]">
                {pipelines.map((p: any) => {
                  const active = p.id === currentPipelineId;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => changePipeline(p.id)}
                      className={cn('flex items-center gap-2', active && 'bg-[#F7BC5F] text-slate-950')}
                    >
                      {active ? <Check className="w-4 h-4" /> : <User className="w-4 h-4 text-[#F7BC5F]" />}
                      <span>{p.name}</span>
                    </DropdownMenuItem>
                  );
                })}
                {pipelines.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Aucun pipeline</div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {stages.length > 0 ? (
            // Signalé sur mobile : forcer toutes les étapes à tenir dans la
            // largeur de l'écran (w-0 flex-1) écrasait les libellés en 2
            // lignes qui se chevauchaient et devenaient illisibles dès qu'il
            // y avait plus de 5-6 étapes. Largeur minimale par étape +
            // défilement horizontal à la place : ça tient toujours sur
            // desktop (assez de place, pas de scroll visible) et devient
            // swipeable sur mobile au lieu de s'écraser.
            <div className="w-full overflow-x-auto -mx-4 px-4 custom-scrollbar">
              <div
                className="flex items-start relative pb-1"
                style={{ minWidth: `${Math.max(stages.length * 76, 100)}px` }}
              >
                {/* Signalé : "dans la fiche client la barre de la pipeline,
                    on ne la voit pas" en mode jour — la ligne de fond et les
                    pastilles inactives utilisaient des couleurs sombres
                    (bg-[#144447]/40, bg-[#0a1e20]) que le remap mode-jour
                    forçait en blanc/gris très clair : blanc sur fond blanc,
                    quasi invisible. Classes dédiées ci-dessous avec leur
                    propre valeur en mode jour (voir index.css). */}
                <div className="absolute top-[10px] left-2.5 right-2.5 h-0.5 pipeline-track z-0" />
                {currentStageIndex >= 0 && (
                  <div
                    className="absolute top-[10px] left-2.5 h-0.5 bg-[#F7BC5F] z-0 transition-all"
                    style={{
                      width: `calc(${(currentStageIndex / Math.max(stages.length - 1, 1)) * 100}% - 0px)`,
                      ...(couleurEtapeFiche(stages[currentStageIndex]?.name) ? { backgroundColor: couleurEtapeFiche(stages[currentStageIndex]?.name) as string } : {}),
                    }}
                  />
                )}

                {stages.map((stage: any, index: number) => {
                  const isActive = index === currentStageIndex;
                  const isPast = index < currentStageIndex;
                  // Demande (3 septembre) : sur Novavisio, le ruban de la fiche
                  // reprend le code couleur de Natacha, comme le pipeline.
                  const couleur = couleurEtapeFiche(stage.name);
                  const stylePastille = couleur
                    ? isActive
                      ? { borderColor: couleur, backgroundColor: couleur, boxShadow: `0 0 10px ${couleur}80` }
                      : isPast
                        ? { borderColor: couleur }
                        : { borderColor: `${couleur}66` }
                    : undefined;

                  return (
                    <div key={stage.id} className="relative z-10 flex flex-col items-center gap-2 group flex-1 min-w-[68px] px-1">
                      <button
                        type="button"
                        onClick={() => changeStage(stage.id)}
                        title={stage.name}
                        style={stylePastille}
                        className={`w-5 h-5 rounded-full border-4 flex items-center justify-center transition-all shrink-0 ${
                          isActive ? 'border-[#F7BC5F] bg-[#F7BC5F] w-6 h-6 shadow-[0_0_10px_rgba(245,158,11,0.5)]' :
                          isPast ? 'border-[#F7BC5F] pipeline-dot-bg' : 'pipeline-dot-border-inactive pipeline-dot-bg hover:border-[#F7BC5F]/60'
                        }`}
                      >
                        {isPast && <div className="w-1.5 h-1.5 bg-[#F7BC5F] rounded-full" style={couleur ? { backgroundColor: couleur } : undefined} />}
                      </button>
                      <span
                        style={couleur ? { color: isActive ? couleur : `${couleur}b3` } : undefined}
                        className={`text-[10px] font-bold tracking-wide text-center leading-tight whitespace-nowrap ${
                          isActive ? 'text-[#F7BC5F]' : 'text-slate-500 group-hover:text-slate-300'
                        }`}
                      >
                        {stage.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-slate-500 py-2">Aucune étape de pipeline configurée</p>
          )}

          {/* Checklist de l'étape active — n'apparaît QUE sur Immosphera /
              Pipeline Transactions V2, et seulement si cette étape précise a
              une checklist configurée. */}
          {client.agencyId === '15157da9-71ea-4760-ae1c-3bc99d9caa20' &&
            currentPipelineId === IMMOSPHERA_TRANSACTIONS_V2_PIPELINE_ID &&
            currentStageIndex >= 0 &&
            STAGE_CHECKLISTS[stages[currentStageIndex]?.name] && (
              <ClientStageChecklistButton
                leadId={client.id}
                stageName={stages[currentStageIndex].name}
                onOpen={() => setShowChecklistModal(true)}
              />
            )}
        </div>
      </div>

      {showChecklistModal && currentStageIndex >= 0 && (
        <TransactionChecklistModal
          leadId={client.id}
          pipelineId={currentPipelineId as string}
          stageName={stages[currentStageIndex].name}
          onClose={() => setShowChecklistModal(false)}
        />
      )}

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Card */}
          <div className={`bg-[#07191b] border border-white/15 rounded-2xl p-6 shadow-xl relative overflow-hidden transition-shadow hover:shadow-[0_0_20px_2px_rgba(247,188,95,0.15)] ${showHalo ? 'target-halo-bounce' : ''}`}>
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#F7BC5F]" />
            
            <div className="flex items-start gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-[#F7BC5F] flex items-center justify-center text-slate-950 font-black text-xl shadow-lg">
                {client.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white leading-tight">{client.name}</h2>
                  {/* Ticket #110 : badge questionnaire confidentiel — orange
                      tant qu'en attente, vert dès qu'un envoi est rempli. */}
                  {completedQuestionnairesCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowQuestionnaireModal(true)}
                      title="Questionnaire confidentiel rempli et reçu"
                      className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[9px] font-bold uppercase tracking-wide cursor-pointer"
                    >
                      Questionnaire rempli
                    </button>
                  ) : pendingQuestionnairesCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowQuestionnaireModal(true)}
                      title="Questionnaire confidentiel envoyé, en attente de réponse"
                      className="px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/40 text-orange-400 text-[9px] font-bold uppercase tracking-wide cursor-pointer"
                    >
                      Questionnaire envoyé
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-0.5">
                    {CLIENT_TEMP_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const isActive = client.statutLead === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          title={opt.label}
                          onClick={() => void handleSetClientTemperature(opt.value)}
                          className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${
                            isActive ? opt.activeClass : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/5'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      );
                    })}
                  </div>
                  <span className="px-2 py-0.5 rounded-md border border-[#F7BC5F]/40 text-[#F7BC5F] text-[10px] font-bold">{client.type}</span>
                </div>
              </div>
            </div>

            {/* Consentement au démarchage téléphonique — Immosphera
                uniquement. Demande explicite (16 septembre) : positionné
                juste sous l'en-tête (avatar/nom/température/type), au lieu
                d'après "Coordonnées" plus bas. */}
            {isImmosphera && (
              <div className="pt-4 border-t border-[#143c3f]/50 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Consentement</span>
                  <button
                    onClick={() => { setConsentSendEmail(client.email || ''); setConsentSendError(null); setShowSendConsentModal(true); }}
                    className="text-[10px] font-bold text-[#F7BC5F] hover:text-[#e5ab4c] flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" /> Envoyer
                  </button>
                </div>
                {!hasConsent && (
                  <p className="text-sm text-slate-400">Aucun consentement envoyé pour ce client.</p>
                )}
                {hasConsent && <ConsentStatusBadge record={displayedConsent} size="md" />}
                {latestSignedConsent ? (
                  <div className="space-y-1 text-sm text-slate-300">
                    <p>
                      <span className="text-slate-500">Signé le : </span>
                      <span className="font-semibold text-white">{formatFr(consentSignedDate)}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Valable jusqu'au : </span>
                      <span className={cn('font-semibold', consentExpired ? 'text-rose-400' : 'text-white')}>
                        {formatFr(consentExpiryDate)}
                      </span>
                    </p>
                    <p>
                      <span className="text-slate-500">Réalisé par : </span>
                      <span className="font-semibold text-white">
                        {(latestSignedConsent.created_by && consentSenders[latestSignedConsent.created_by]?.name) ??
                          latestSignedConsent.snapshot?.broker_name ??
                          '—'}
                      </span>
                    </p>
                    {consentExpired && (
                      <p className="text-xs text-rose-400">
                        Consentement expiré : un nouveau consentement doit être réalisé.
                      </p>
                    )}
                    {submittedConsentCount > 1 && (
                      <p className="text-xs text-slate-500">
                        {submittedConsentCount} consentements dans l'historique.
                      </p>
                    )}
                  </div>
                ) : hasConsent ? (
                  <p className="text-sm text-slate-400">Consentement envoyé, en attente de signature du client.</p>
                ) : null}
                {hasConsent && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConsentViewOpen(true)}
                      disabled={submittedConsentCount === 0}
                      className="flex-1 px-3 py-2 rounded-xl border border-[#144447]/60 bg-black/20 text-xs font-bold text-slate-200 flex items-center justify-center gap-2 hover:bg-black/30 disabled:opacity-40"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" /> Voir le questionnaire
                    </button>
                    <button
                      onClick={handleDownloadConsentPdf}
                      disabled={submittedConsentCount === 0 || consentPdfDownloading}
                      title="Télécharger le PDF"
                      className="px-3 py-2 rounded-xl border border-[#144447]/60 bg-black/20 text-xs font-bold text-slate-200 flex items-center justify-center gap-2 hover:bg-black/30 disabled:opacity-40"
                    >
                      {consentPdfDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-[#143c3f]/50">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Montant Estimé</span>
              <div className="text-3xl font-black text-[#F7BC5F] mt-1">
                {activeDeal ? formatCurrency(activeDeal.amount) : '0 €'}
              </div>
            </div>

            {/* Ticket #109 : "Notes générales / Remarques client" retirées du
                sous-onglet Notes — commentaire libre directement ici, sur la
                fiche, éditable et enregistrable sur place. */}
            <div className="pt-4 border-t border-[#143c3f]/50 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Commentaire</span>
                <button
                  onClick={handleSaveComments}
                  className="text-[10px] font-bold text-[#F7BC5F] hover:text-[#e5ab4c] flex items-center gap-1 cursor-pointer"
                >
                  {savedCommentsSuccess ? (
                    <>
                      <Check className="w-3 h-3 stroke-[3]" /> Enregistré
                    </>
                  ) : (
                    <>
                      <Save className="w-3 h-3" /> Enregistrer
                    </>
                  )}
                </button>
              </div>
              <textarea
                rows={3}
                value={contactComments}
                onChange={(e) => setContactComments(e.target.value)}
                placeholder="Éléments clés, situation, souhaits particuliers..."
                className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] placeholder-slate-600 resize-none leading-relaxed"
              />
            </div>

            <div className="pt-4 border-t border-[#143c3f]/50 space-y-4">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Coordonnées</span>
              <div className="space-y-3">
                {/* Demande (3 septembre) : e-mail et téléphone cliquables et
                    surlignés — un clic ouvre la messagerie ou lance l'appel
                    (sur téléphone) au lieu d'obliger à recopier. */}
                <div className="flex items-center gap-3 text-sm text-slate-300 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#143c3f]/40 flex items-center justify-center text-[#F7BC5F] shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  {client.email ? (
                    <a
                      href={`mailto:${client.email}`}
                      onClick={clicMailCrm(client.email)}
                      title="Écrire depuis la boîte Mail du CRM"
                      className="text-[#F9C977] underline underline-offset-2 decoration-[#F9C977]/60 hover:text-[#FAD592] hover:decoration-[#FAD592] break-all"
                    >
                      {client.email}
                    </a>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-300 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#143c3f]/40 flex items-center justify-center text-[#F7BC5F] shrink-0">
                    <Phone className="w-4 h-4" />
                  </div>
                  {client.phone ? (
                    <a
                      href={`tel:${String(client.phone).replace(/[^+\d]/g, '')}`}
                      title="Appeler"
                      className="text-[#F9C977] underline underline-offset-2 decoration-[#F9C977]/60 hover:text-[#FAD592] hover:decoration-[#FAD592]"
                    >
                      {client.phone}
                    </a>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
                {client.type && (
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    <div className="w-8 h-8 rounded-full bg-[#143c3f]/40 flex items-center justify-center text-[#F7BC5F]">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    {client.type}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-[#143c3f]/50 space-y-3">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Structure & Agent Lié</span>
              <div className="space-y-2">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Structure / Agence</label>
                  <select
                    value={AGENCIES.find(a => matchesAgency(client.agencyId, a.id) && a.id !== 'all')?.id || AGENCIES[0].id}
                    onChange={(e) => updateContact.mutateAsync({ id: client.id, updates: { agencyId: e.target.value } })}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                  >
                    {AGENCIES.filter(a => a.id !== 'all').map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Utilisateur / Agent Lié</label>
                  <select
                    // Signalé : « cela reste au premier qui est mis ». La
                    // valeur affichée passait par getAssignedUser(), qui
                    // retombe sur TEAM_MEMBERS[0] (Sylvain Grazia) dès que
                    // l'identifiant n'est pas dans la liste figée — donc
                    // pour tout collaborateur réel. Le champ ne reflétait
                    // jamais l'attribution enregistrée et revenait au
                    // premier nom après chaque changement. On lit
                    // directement la valeur stockée.
                    value={client.assignedTo || ''}
                    onChange={(e) => updateContact.mutateAsync({ id: client.id, updates: { assignedTo: e.target.value } })}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                  >
                    <option value="">— Non attribué —</option>
                    {assignableUsers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                {/* Apporteur d'affaires (agent immobilier référent, 6
                    septembre) : uniquement sur les fiches Conciergerie,
                    pour le classement par référent. */}
                {estConciergerie && (
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Apporteur d'affaires (agent immobilier)</label>
                    <select
                      value={client.referrerId || ''}
                      onChange={(e) => updateContact.mutateAsync({ id: client.id, updates: { referrerId: e.target.value || null } })}
                      className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                    >
                      <option value="">Aucun</option>
                      {apporteursDisponibles.filter(a => a.active).map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.agencyName ? ` (${a.agencyName})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Lien Vendeur ↔ Acquéreur (7 septembre) : facultatif,
                    limité aux fiches ImmoSphera du pipeline Transactions
                    V2 — l'agent choisit de lier ou non. */}
                {estTransactionsV2 && (
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Fiche liée (Vendeur/Acquéreur)</label>
                    <select
                      value={client.linkedLeadId || ''}
                      onChange={(e) => updateContact.mutateAsync({ id: client.id, updates: { linkedLeadId: e.target.value || null } })}
                      className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                    >
                      <option value="">Aucune</option>
                      {fichesLiablesTransactionsV2.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {ficheLieePrincipale && (
                      <button
                        type="button"
                        onClick={() => onSelectContact?.(ficheLieePrincipale.id)}
                        className="mt-1.5 text-[10px] text-[#F7BC5F] hover:underline flex items-center gap-1"
                      >
                        → Voir la fiche de {ficheLieePrincipale.name}
                      </button>
                    )}
                    {fichesLieesInverse.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {fichesLieesInverse.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => onSelectContact?.(c.id)}
                            className="block text-[10px] text-[#F7BC5F] hover:underline"
                          >
                            → Fiche liée : {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {(client.revenus || client.apport || client.projectType) ? (
              <div className="pt-4 border-t border-[#143c3f]/50 space-y-2">
                <span className="text-[10px] uppercase font-bold text-[#F9C977] tracking-wider">Données Patrimoniales</span>
                <div className="grid grid-cols-2 gap-2 text-xs bg-black/30 p-3 rounded-xl border border-[#143c3f]">
                  {client.revenus ? (
                    <div>
                      <span className="text-slate-400 text-[10px] block">Revenus annuels</span>
                      <span className="font-bold text-white">{formatCurrency(client.revenus)}</span>
                    </div>
                  ) : null}
                  {client.apport ? (
                    <div>
                      <span className="text-slate-400 text-[10px] block">Apport personnel</span>
                      <span className="font-bold text-white">{formatCurrency(client.apport)}</span>
                    </div>
                  ) : null}
                  {client.credits ? (
                    <div>
                      <span className="text-slate-400 text-[10px] block">Encours crédits</span>
                      <span className="font-bold text-white">{formatCurrency(client.credits)}/m</span>
                    </div>
                  ) : null}
                  {client.contractType ? (
                    <div>
                      <span className="text-slate-400 text-[10px] block">Contrat</span>
                      <span className="font-bold text-white">{client.contractType}</span>
                    </div>
                  ) : null}
                  {client.projectType ? (
                    <div className="col-span-2 mt-1">
                      <span className="text-slate-400 text-[10px] block">Projet d'acquisition</span>
                      <span className="font-bold text-[#F9C977]">{client.projectType}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="pt-4 border-t border-[#143c3f]/50 space-y-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Commentaires</span>
              <p className="text-sm text-slate-300">{client.comments || 'Aucun commentaire'}</p>
            </div>
          </div>
        </div>

        {/* Right Column - Tabs & Content */}
        <div className="lg:col-span-2 bg-[#07191b] border border-white/15 rounded-2xl flex flex-col shadow-md overflow-hidden">
          {/* Tabs (30/08/2026, demande explicite : "effet hover et halo lors
              de la sélection aussi") — halo doré au survol de tout onglet,
              et légère lueur permanente sur l'onglet actif (déjà surligné
              par sa couleur/soulignement, la lueur renforce juste la
              sélection). */}
          <div data-tour="client-tabs" className="flex border-b border-white/15 bg-black/20">
            {[
              { id: 'rdv', label: 'Tâches' },
              { id: 'agenda', label: 'RDV' },
              { id: 'notes', label: 'Notes' },
              { id: 'emails', label: 'Emails' },
              { id: 'documents', label: 'Documents' },
              ...(isSharedWithSomeone ? [{ id: 'chat', label: 'Chat' }] : []),
              ...(guestAccess ? [{ id: 'espace-client', label: 'Espace client' }] : []),
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'rdv' | 'agenda' | 'notes' | 'emails' | 'documents' | 'chat' | 'espace-client')}
                className={`px-8 py-4 text-sm font-bold transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-[#F7BC5F] text-[#F7BC5F] bg-[#F7BC5F]/5 shadow-[inset_0_0_16px_1px_rgba(247,188,95,0.12)]'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5 hover:shadow-[inset_0_0_16px_1px_rgba(247,188,95,0.1)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'rdv' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-white">RDV/Tâches</h2>
                    <p className="text-xs text-slate-400">Tous les rendez-vous et tâches pour ce client</p>
                  </div>
                  <button
                    onClick={() => { setEditingTask(null); setShowTaskModal(true); }}
                    className="px-4 py-2 bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg transition-transform hover:scale-105"
                  >
                    <Plus className="w-4 h-4 stroke-[3]" />
                    Ajouter
                  </button>
                </div>
                
                <DragDropContext onDragEnd={onDragEnd}>
                  <Droppable droppableId="client-tasks">
                    {(provided) => (
                      <div 
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className="space-y-3"
                      >
                        {clientTasks.length === 0 ? (
                          <div className="p-8 text-center text-slate-500 border border-dashed border-[#144447]/50 rounded-xl">
                            Aucune tâche
                          </div>
                        ) : (
                          clientTasks.map((task, index) => {
                            const dateStatus = getTaskDateStatus(task.dueDate);
                            const dateStr = task.dueDate ? task.dueDate.split('T')[0] : '';
                            
                            const borderLeftClass = 
                              dateStatus.color === 'red' ? 'border-l-red-500' :
                              dateStatus.color === 'orange' ? 'border-l-[#F7BC5F]' :
                              'border-l-emerald-500';

                            return (
                              <Draggable key={task.id} draggableId={task.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={`p-4 rounded-2xl bg-[#0a1e20] border-l-4 ${borderLeftClass} border-t border-r border-b border-[#144447]/40 flex items-start justify-between gap-4 group hover:bg-[#143c3f]/20 transition-all ${snapshot.isDragging ? 'shadow-2xl opacity-90 scale-[1.02] border-[#F7BC5F]/50 z-50 bg-[#0c2628]' : 'shadow-sm'}`}
                                  >
                                    <div className="flex items-start gap-4">
                                      <div 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const willComplete = !task.completed;
                                          updateTask.mutateAsync({ id: task.id, updates: { completed: willComplete } });
                                          if (willComplete) {
                                            setShowTaskModal(true);
                                          }
                                        }}
                                        className="mt-0.5 cursor-pointer text-slate-400 hover:text-[#F7BC5F] transition-colors"
                                        title={task.completed ? "Marquer à faire" : "Valider et planifier la suite"}
                                      >
                                        {task.completed ? (
                                          <CheckCircle className="w-5 h-5 text-emerald-500" />
                                        ) : (
                                          <Circle className="w-5 h-5" />
                                        )}
                                      </div>
                                      
                                      <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                          <span className="text-white font-bold text-sm">
                                            {task.completed ? 'Terminée' : 'A faire'}
                                          </span>
                                          <span className="px-2 py-0.5 rounded bg-[#143c3f] text-teal-400 text-[10px] font-bold">
                                            {task.type || 'Tâche'}
                                          </span>
                                          {!task.completed && (
                                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${dateStatus.badgeClass}`}>
                                              {dateStatus.label}
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-sm text-slate-300">{task.title}</p>
                                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-2 font-mono">
                                          <Calendar className="w-3.5 h-3.5" />
                                          {dateStr ? new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                                        </div>
                                      </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                      {/* Signalé : le clic sur le crayon n'ouvrait jamais la
                                          fenêtre d'édition — `dragHandleProps` (react-beautiful-
                                          dnd) est posé sur toute la carte, pas juste une poignée
                                          dédiée, et sa capture du geste démarre dès `mousedown`
                                          (bien avant que le `onClick` du bouton, avec son
                                          `stopPropagation`, n'ait la moindre chance de s'exécuter)
                                          — la lecture initiale de la carte était donc interprétée
                                          comme un micro-glisser-déposer avorté plutôt qu'un vrai
                                          clic. On coupe la propagation dès `onMouseDown` (et au
                                          toucher, `onTouchStart`) pour empêcher la carte de
                                          capter le geste avant le clic. */}
                                      <button
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingTask(task);
                                          setShowTaskModal(true);
                                        }}
                                        className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-black/40"
                                      >
                                        <Pencil className="w-4 h-4" />
                                      </button>
                                      <button
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteTask.mutateAsync(task.id);
                                        }}
                                        className="p-2 text-rose-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </Draggable>
                            );
                          })
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </div>
            )}
            
            {activeTab === 'agenda' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-white">RDV</h2>
                    <p className="text-xs text-slate-400">Vue sur l'agenda et prise de rendez-vous pour ce client</p>
                  </div>
                  {!showNewAppointment && (
                    <button
                      onClick={() => {
                        setNewApptTitle(`RDV — ${client?.name || ''}`.trim());
                        const now = new Date();
                        now.setDate(now.getDate() + 1);
                        setNewApptDate(now.toISOString().slice(0, 10));
                        setShowNewAppointment(true);
                      }}
                      className="px-4 py-2 bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg transition-transform hover:scale-105"
                    >
                      <Plus className="w-4 h-4 stroke-[3]" />
                      Nouveau rendez-vous
                    </button>
                  )}
                </div>

                {showNewAppointment && (
                  <div className="p-4 rounded-2xl bg-[#0a1e20] border border-[#144447]/60 space-y-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-bold text-slate-400">Titre</span>
                      <input
                        value={newApptTitle}
                        onChange={(e) => setNewApptTitle(e.target.value)}
                        className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-400">Date</span>
                        <input
                          type="date"
                          value={newApptDate}
                          onChange={(e) => setNewApptDate(e.target.value)}
                          className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-400">Heure</span>
                        <input
                          type="time"
                          value={newApptTime}
                          onChange={(e) => setNewApptTime(e.target.value)}
                          className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-400">Durée (minutes)</span>
                        <input
                          type="number"
                          min={5}
                          step={5}
                          value={newApptDuration}
                          onChange={(e) => setNewApptDuration(Number(e.target.value) || 30)}
                          className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-bold text-slate-400">Lieu (facultatif)</span>
                        <input
                          value={newApptLocation}
                          onChange={(e) => setNewApptLocation(e.target.value)}
                          className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                      </label>
                    </div>
                    {calendarError === 'workspace-non-connecte' && (
                      <p className="text-xs text-rose-400">Connectez votre compte Google Workspace (Paramètres → Mon profil) pour créer un rendez-vous synchronisé.</p>
                    )}
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setShowNewAppointment(false)}
                        disabled={creatingAppt}
                        className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-xs font-bold hover:bg-white/10 disabled:opacity-50"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={() => void submitNewAppointment()}
                        disabled={creatingAppt || !newApptTitle.trim() || !newApptDate.trim()}
                        className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs flex items-center gap-2 disabled:opacity-50"
                      >
                        {creatingAppt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Créer le rendez-vous
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Prochains événements de votre agenda</p>
                  {calendarLoading ? (
                    <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                  ) : calendarError === 'workspace-non-connecte' ? (
                    <div className="p-8 text-center text-slate-500 border border-dashed border-[#144447]/50 rounded-xl text-sm">
                      Connectez votre compte Google Workspace (Paramètres → Mon profil) pour voir votre agenda et créer des rendez-vous synchronisés.
                    </div>
                  ) : calendarError ? (
                    <div className="p-8 text-center text-rose-400 border border-dashed border-rose-500/30 rounded-xl text-sm">{calendarError}</div>
                  ) : calendarEvents.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 border border-dashed border-[#144447]/50 rounded-xl">
                      Aucun événement à venir dans votre agenda.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {calendarEvents.map((ev) => {
                        const isForThisClient = !!client?.name && `${ev.summary || ''} ${ev.description || ''}`.toLowerCase().includes(client.name.toLowerCase());
                        const start = ev.start?.dateTime || ev.start?.date;
                        return (
                          <div
                            key={ev.id}
                            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                              isForThisClient ? 'border-[#F7BC5F]/50 bg-[#F7BC5F]/5' : 'border-[#144447]/40 bg-[#0a1e20]'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-white font-semibold truncate">{ev.summary || '(Sans titre)'}</p>
                              <p className="text-[11px] text-slate-400 font-mono">
                                {start ? new Date(start).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                              </p>
                            </div>
                            {isForThisClient && (
                              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-extrabold border border-[#F7BC5F]/50 text-[#F9C977]">
                                Ce client
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'notes' && (
              <div className="space-y-6 animate-fade-in">
                {/* Ticket #109 : "Note générale & Remarques du client" retirée
                    d'ici — remplacée par le champ "Commentaire" directement
                    sur la fiche (carte de gauche), voir plus haut. */}

                {/* Section 2: Specific meeting notes & logs with DND, Pinning & Editing */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">Comptes-rendus & Notes d'entretien</h3>
                      <p className="text-xs text-slate-400">Historique des comptes-rendus de rendez-vous ({clientNotes.length} note(s))</p>
                    </div>
                    <button
                      onClick={handleOpenCreateNote}
                      className="px-3.5 py-1.5 rounded-xl bg-[#143c3f] hover:bg-[#1c5054] text-teal-300 font-semibold text-xs border border-teal-500/30 flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Ajouter une note</span>
                    </button>
                  </div>

                  {clientNotes.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 bg-[#07191b] border border-[#144447]/60 rounded-2xl flex flex-col items-center justify-center gap-2">
                      <FileEdit className="w-6 h-6 text-slate-600" />
                      <span>Aucun compte-rendu ou note spécifique enregistré pour {client.name}. Cliquez sur "Ajouter une note" ci-dessus pour en créer un.</span>
                    </div>
                  ) : (
                    <DragDropContext onDragEnd={handleDragEndNotes}>
                      <Droppable droppableId="client-notes-list">
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="flex flex-col gap-3"
                          >
                            {clientNotes.map((n, index) => (
                              <Draggable key={n.id} draggableId={n.id} index={index}>
                                {(providedDrag, snapshot) => (
                                  <div
                                    ref={providedDrag.innerRef}
                                    {...providedDrag.draggableProps}
                                    className={`p-4 rounded-2xl bg-[#07191b] border ${n.isPinned ? 'border-[#F7BC5F]/70 bg-[#0b2427]' : 'border-[#144447]'} space-y-2 relative group hover:border-[#226368] transition-all shadow-md ${snapshot.isDragging ? 'shadow-2xl scale-[1.02] z-50 border-[#F9C977] bg-[#0d2a2d]' : ''}`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        {/* Drag Handle */}
                                        <div
                                          {...providedDrag.dragHandleProps}
                                          className="text-slate-500 hover:text-slate-300 p-1 cursor-grab active:cursor-grabbing"
                                          title="Glisser pour déplacer la note"
                                        >
                                          <GripVertical className="w-4 h-4" />
                                        </div>

                                        <span className="text-[10px] font-bold text-[#F7BC5F] bg-[#F7BC5F]/10 px-2.5 py-0.5 rounded-full border border-[#F7BC5F]/20">
                                          {n.category || 'Suivi Client'}
                                        </span>

                                        {n.isPinned && (
                                          <span className="text-[10px] font-extrabold text-[#F9C977] bg-[#F9C977]/10 px-2 py-0.5 rounded-full border border-[#F9C977]/30 flex items-center gap-1">
                                            <Pin className="w-3 h-3 fill-[#F9C977] text-[#F9C977]" />
                                            Épinglé
                                          </span>
                                        )}

                                        {/* Ticket #55 */}
                                        {n.isShared && (
                                          <span className="text-[10px] font-extrabold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/30 flex items-center gap-1">
                                            <Share2 className="w-3 h-3" />
                                            Partagée
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-slate-400 flex items-center gap-1 mr-1">
                                          <Clock className="w-3 h-3" />
                                          {new Date(n.updatedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </span>

                                        {/* Pin button */}
                                        <button
                                          onClick={() => handleTogglePinNote(n.id)}
                                          className={`p-1.5 rounded-lg transition-colors ${n.isPinned ? 'text-[#F9C977] hover:bg-[#F9C977]/10' : 'text-slate-500 hover:text-[#F9C977] hover:bg-white/5'}`}
                                          title={n.isPinned ? "Désépingler" : "Épingler en haut"}
                                        >
                                          <Pin className={`w-3.5 h-3.5 ${n.isPinned ? 'fill-[#F9C977]' : ''}`} />
                                        </button>

                                        {/* Edit Pencil button */}
                                        <button
                                          onClick={() => handleOpenEditNote(n)}
                                          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                                          title="Modifier la note"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>

                                        {/* Delete button */}
                                        <button
                                          onClick={() => handleDeleteNote(n.id)}
                                          className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                                          title="Supprimer la note"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>

                                    <h4 className="font-bold text-white text-sm pl-7">{n.title}</h4>
                                    <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed pl-7">{n.content}</p>
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>
                  )}
                </div>
              </div>
            )}

            {/* Modal for adding or editing a note with Voice Dictation */}
            {showNewNoteModal && createPortal(
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                <div className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-lg w-full p-6 text-white shadow-2xl relative animate-scale-up">
                  {/* Modal Header */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-[#F9C977]">
                        <MessageSquare className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">
                          {editingNoteId ? 'Modifier la note' : 'Ajouter une note'}
                        </h3>
                        <p className="text-xs text-slate-400">
                          Ajoutez des notes rapides avec le clavier ou la voix
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setShowNewNoteModal(false);
                        if (isListening && recognitionRef.current) {
                          try { recognitionRef.current.stop(); } catch(e){ console.warn('Stop dictation error', e); }
                          setIsListening(false);
                        }
                      }}
                      className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleSaveNote} className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">Titre de la note</label>
                        <input
                          type="text"
                          placeholder="ex: RDV de découverte / Proposition prêt"
                          value={noteTitle}
                          onChange={(e) => setNoteTitle(e.target.value)}
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">Catégorie</label>
                        <input
                          type="text"
                          value={noteCategory}
                          onChange={(e) => setNoteCategory(e.target.value)}
                          placeholder="ex: Entretien, Banque"
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">Contenu de la note</label>
                        {isListening && (
                          <span className="text-[10px] text-red-400 font-bold flex items-center gap-1 animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                            Dictée vocale en cours...
                          </span>
                        )}
                      </div>
                      <textarea
                        rows={6}
                        required
                        placeholder="Ajoutez une note... (utilisez @ pour mentionner)"
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        className="w-full bg-[#030d0f] border border-[#1d575b] rounded-xl p-3.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F] resize-none leading-relaxed shadow-inner"
                      />
                    </div>

                    {/* Ticket #55 : marquer la note comme partagée avec les
                        personnes ayant accès à ce contact — sinon elle reste
                        privée par défaut. */}
                    {isSharedWithSomeone && (
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={noteIsShared}
                          onChange={(e) => setNoteIsShared(e.target.checked)}
                          className="w-4 h-4 rounded accent-[#F7BC5F]"
                        />
                        <Share2 className="w-3.5 h-3.5 text-[#F7BC5F]" />
                        Partager cette note avec les personnes ayant accès à ce contact
                      </label>
                    )}

                    {/* Footer Buttons */}
                    <div className="flex items-center justify-end gap-3 pt-2">
                      {/* Dictation Button */}
                      {!isListening ? (
                        <button
                          type="button"
                          onClick={toggleDictation}
                          className="px-4 py-2.5 rounded-xl bg-[#0a2326] border border-[#184c50] hover:bg-[#113236] text-white font-semibold text-xs flex items-center gap-2 shadow-md transition-all cursor-pointer"
                        >
                          <Mic className="w-4 h-4 text-[#F9C977]" />
                          <span>Dicter</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={toggleDictation}
                          className="px-4 py-2.5 rounded-xl bg-rose-950/70 border border-rose-500/80 hover:bg-rose-900/80 font-bold text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer animate-pulse"
                        >
                          <Square className="w-4 h-4 text-red-500 fill-red-500" />
                          <span className="text-red-500 font-extrabold tracking-wide">Arrêter</span>
                        </button>
                      )}

                      {/* Save Button */}
                      <button
                        type="submit"
                        disabled={noteSaving}
                        className="px-5 py-2.5 rounded-xl bg-[#cba135] hover:bg-[#b88f2d] text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        <span>{noteSaving ? 'Sauvegarde...' : 'Sauvegarder'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body
            )}
            {activeTab === 'emails' && (
              <div className="space-y-2">
                {loadingClientEmails ? (
                  <div className="text-slate-400 p-6 text-center flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement des e-mails...
                  </div>
                ) : clientEmailsError ? (
                  <div className="text-rose-300 p-4 text-center text-sm">{clientEmailsError}</div>
                ) : !client?.email ? (
                  <div className="text-slate-400 p-4 text-center text-sm">
                    Aucune adresse e-mail renseignée sur cette fiche.
                  </div>
                ) : clientEmails.length === 0 ? (
                  <div className="text-slate-400 p-4 text-center text-sm">
                    Aucun e-mail échangé avec {client.email} pour le moment.
                  </div>
                ) : (
                  clientEmails.map((mail) => (
                    <button
                      key={mail.id}
                      type="button"
                      onClick={() => { setOpenEmail(mail); setEmailReplyOpen(false); setEmailReplyBody(''); }}
                      className="w-full text-left p-3.5 rounded-xl bg-black/20 border border-[#144447]/60 text-sm hover:border-[#F7BC5F]/50 hover:bg-black/30 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white truncate">{mail.fromName || mail.from}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">{mail.date}</span>
                      </div>
                      <p className="text-xs text-[#F9C977] font-semibold truncate mt-0.5">{mail.subject || '(sans objet)'}</p>
                      <p className="text-xs text-slate-400 truncate mt-1">{mail.snippet}</p>
                    </button>
                  ))
                )}
              </div>
            )}
            {activeTab === 'documents' && (
              <div className="space-y-6 animate-fade-in">
                {guestAccess && (
                  <div className="bg-[#0a1e20] p-4 rounded-2xl border border-[#144447]/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Demandes au client</span>
                      <button
                        type="button"
                        onClick={() => setShowRequestForm((v) => !v)}
                        className="text-xs font-bold text-[#F9C977] hover:text-[#F7BC5F]"
                      >
                        {showRequestForm ? 'Annuler' : '+ Demander un document'}
                      </button>
                    </div>

                    {showRequestForm && (
                      <div className="space-y-2 pt-1">
                        <select
                          value={reqDocType}
                          onChange={(e) => setReqDocType(e.target.value)}
                          className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                        >
                          {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                          type="date"
                          value={reqDeadline}
                          onChange={(e) => setReqDeadline(e.target.value)}
                          className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                        />
                        <textarea
                          value={reqMessage}
                          onChange={(e) => setReqMessage(e.target.value)}
                          placeholder="Message pour le client (facultatif)"
                          rows={2}
                          className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F] resize-none"
                        />
                        <button
                          type="button"
                          onClick={() => void submitDocRequest()}
                          disabled={reqSubmitting}
                          className="w-full py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 text-sm font-bold disabled:opacity-40"
                        >
                          {reqSubmitting ? 'Envoi...' : 'Envoyer la demande'}
                        </button>
                      </div>
                    )}

                    {docRequests.length > 0 && (
                      <div className="space-y-2 pt-1">
                        {docRequests.map((r) => {
                          const badge: Record<string, string> = {
                            demande: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                            consulte: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
                            recu: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
                            valide: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                            refuse: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
                          };
                          return (
                            <div key={r.id} className="flex items-center justify-between gap-2 bg-black/20 border border-[#144447]/60 rounded-xl px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate">{r.docType}</p>
                                {r.deadline && <p className="text-[10px] text-slate-500">Avant le {new Date(r.deadline).toLocaleDateString('fr-FR')}</p>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge[r.status]}`}>{DOC_REQUEST_STATUS_LABELS[r.status]}</span>
                                {r.status === 'recu' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void decideDocRequest(r.id, 'valide')}
                                      disabled={reqDecisionBusy === r.id}
                                      className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                                    >
                                      Valider
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void decideDocRequest(r.id, 'refuse')}
                                      disabled={reqDecisionBusy === r.id}
                                      className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40"
                                    >
                                      Refuser
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-between items-center bg-[#0a1e20] p-4 rounded-2xl border border-[#144447]/60">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/30 flex items-center justify-center text-[#F9C977] font-bold">
                      <Folder className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        Documents du client
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Espace Partagé
                        </span>
                      </h2>
                      <p className="text-xs text-slate-400">
                        Documents sécurisés partagés avec les utilisateurs autorisés de cette structure ({clientDocs.length} document(s)).
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowDocModal(true)}
                    className="px-4 py-2 bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg transition-transform hover:scale-105 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 stroke-[3]" />
                    Ajouter un document
                  </button>
                </div>

                {docsLoading ? (
                  <div className="p-12 text-center text-slate-500 border border-dashed border-[#144447]/60 rounded-2xl bg-[#07191b]">
                    Chargement des documents...
                  </div>
                ) : clientDocs.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 border border-dashed border-[#144447]/60 rounded-2xl bg-[#07191b] flex flex-col items-center justify-center gap-2">
                    <FileText className="w-8 h-8 text-slate-600" />
                    <span className="text-xs">Aucun document importé pour ce client. Cliquez sur "Ajouter un document" pour joindre une pièce.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {clientDocs.map((doc) => (
                      <div key={doc.id} className="p-4 rounded-2xl bg-[#0a1e20] border border-[#144447]/60 hover:border-[#1d5c60] transition-all flex items-start justify-between gap-3 group shadow-md">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#143c3f] border border-[#1d5c60] flex items-center justify-center text-[#F9C977] shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-md border border-teal-400/20">
                              {doc.category || 'Général'}
                            </span>
                            {/* Ticket #55 */}
                            {doc.isShared && (
                              <span className="text-[10px] font-extrabold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/30 inline-flex items-center gap-1 ml-1.5">
                                <Share2 className="w-3 h-3" />
                                Partagé
                              </span>
                            )}
                            <h4 className="font-bold text-white text-sm leading-tight mt-1">{doc.name}</h4>
                            <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono mt-1">
                              <span>{doc.size || '120 KB'}</span>
                              <span>•</span>
                              <span>{doc.updatedAt}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 opacity-90 group-hover:opacity-100">
                          {doc.url ? (
                            doc.mimeType?.startsWith('image/') || doc.mimeType?.startsWith('audio/') ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setLightboxKind(doc.mimeType?.startsWith('audio/') ? 'audio' : 'image');
                                  setLightboxUrl(doc.url!);
                                }}
                                className="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                                title="Aperçu"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            ) : (
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noreferrer"
                                className="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                                title="Consulter"
                              >
                                <Eye className="w-4 h-4" />
                              </a>
                            )
                          ) : null}
                          <button
                            onClick={() => void handleDeleteDoc(doc)}
                            className="p-2 text-rose-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {showDocModal && createPortal(
                  <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowDocModal(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-lg w-full p-6 sm:p-7 text-white shadow-2xl relative animate-scale-up">
                      <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/30 flex items-center justify-center text-[#F9C977] shrink-0">
                            <Upload className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-white">Ajouter un document</h3>
                            <p className="text-xs text-slate-400 mt-0.5">Enregistré dans Google Drive et lié à cette fiche</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowDocModal(false)}
                          className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer shrink-0"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <form onSubmit={handleAddDoc} className="space-y-4">
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">Nom du document</label>
                          <input
                            type="text"
                            required
                            placeholder="ex : Pièce d'identité, Compromis de vente..."
                            value={docName}
                            onChange={(e) => setDocName(e.target.value)}
                            className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">Catégorie</label>
                          <select
                            value={docCategory}
                            onChange={(e) => setDocCategory(e.target.value)}
                            className="w-full bg-black/20 border border-[#144447]/60 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                          >
                            <option value="Pièce d'identité">Pièce d'identité</option>
                            <option value="Compromis de vente">Compromis de vente</option>
                            <option value="Offre de prêt">Offre de prêt</option>
                            <option value="Avis d'imposition">Avis d'imposition</option>
                            <option value="Justificatif de domicile">Justificatif de domicile</option>
                            <option value="Autre document">Autre document</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">Fichier (PDF, image, Word...)</label>
                          <label className="flex items-center gap-3 w-full bg-black/20 border border-dashed border-[#144447] rounded-xl px-3.5 py-3 cursor-pointer hover:border-[#F7BC5F]/50 transition-colors">
                            <span className="shrink-0 px-3 py-1.5 rounded-lg bg-[#F7BC5F]/15 text-[#F9C977] text-xs font-bold">Choisir un fichier</span>
                            <span className="text-sm text-slate-400 truncate">{docFile ? docFile.name : 'Aucun fichier choisi'}</span>
                            <input
                              type="file"
                              onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                              className="hidden"
                            />
                          </label>
                        </div>

                        {/* Ticket #55 : document partagé avec les personnes
                            ayant accès à ce contact. */}
                        {isSharedWithSomeone && (
                          <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-300 cursor-pointer select-none bg-black/20 border border-[#144447]/60 rounded-xl px-3.5 py-3">
                            <input
                              type="checkbox"
                              checked={docIsShared}
                              onChange={(e) => setDocIsShared(e.target.checked)}
                              className="w-4 h-4 rounded accent-[#F7BC5F] shrink-0"
                            />
                            <Share2 className="w-3.5 h-3.5 text-[#F7BC5F] shrink-0" />
                            Partager ce document avec les personnes ayant accès à ce contact
                          </label>
                        )}

                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setShowDocModal(false)}
                            className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            className="px-5 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-sm shadow-lg cursor-pointer"
                          >
                            Enregistrer le document
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            )}
            {activeTab === 'chat' && (
              <div className="flex flex-col h-full min-h-[420px] animate-fade-in">
                <div ref={chatScrollRef} className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pb-4">
                  {chatLoading ? (
                    <div className="p-12 text-center text-slate-500">Chargement du chat...</div>
                  ) : chatMessages.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 border border-dashed border-[#144447]/60 rounded-2xl bg-[#07191b] flex flex-col items-center gap-2">
                      <MessageSquare className="w-8 h-8 text-slate-600" />
                      <span className="text-xs">Aucun message. Échangez ici avec la personne avec qui cette fiche est partagée.</span>
                    </div>
                  ) : (
                    chatMessages.map((m) => {
                      const mine = m.senderId === currentUserId;
                      const otherRead = m.readBy.some((r) => r.userId !== currentUserId);
                      const grouped: Record<string, ChatReaction[]> = {};
                      m.reactions.forEach((r) => { (grouped[r.emoji] ??= []).push(r); });
                      const isEditing = editingChatId === m.id;

                      return (
                        <div key={m.id} className={`group flex flex-col ${mine ? 'items-end' : 'items-start'} py-1.5`}>
                          <div className={`flex items-end gap-1.5 max-w-[75%] ${mine ? 'flex-row-reverse' : ''}`}>
                            <div className={`rounded-2xl px-4 py-2.5 text-sm relative ${mine ? 'bg-[#F7BC5F] text-slate-950 font-semibold' : 'bg-[#0a1e20] border border-[#144447]/60 text-slate-200'}`}>
                              {!mine && <div className="text-[10px] font-bold text-[#F9C977] mb-0.5">{m.senderName}</div>}

                              {m.isDeleted ? (
                                <div className="italic text-xs opacity-60">Message supprimé</div>
                              ) : isEditing ? (
                                <div className="flex flex-col gap-2 min-w-[200px]">
                                  <textarea
                                    value={editingChatText}
                                    onChange={(e) => setEditingChatText(e.target.value)}
                                    className="bg-black/20 rounded-lg p-2 text-xs text-inherit border border-black/20 focus:outline-none resize-none"
                                    rows={2}
                                    autoFocus
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setEditingChatId(null)} className="text-[10px] opacity-70 hover:opacity-100">Annuler</button>
                                    <button type="button" onClick={() => void handleSaveEditChat(m)} className="text-[10px] font-bold underline">Enregistrer</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                                  {m.imageUrl && (
                                    <button
                                      type="button"
                                      onClick={() => { setLightboxKind('image'); setLightboxUrl(m.imageUrl); }}
                                      className="block mt-1 cursor-pointer"
                                    >
                                      <img src={m.imageUrl} alt="Pièce jointe" className="max-w-[220px] max-h-[220px] rounded-xl object-cover" />
                                    </button>
                                  )}
                                  {/* controlsList="nofullscreen" : le plein écran natif du lecteur
                                      sortait de notre modale et faisait disparaître sa croix de
                                      fermeture — on le désactive pour ne garder que la nôtre. */}
                                  {m.videoUrl && (
                                    <video src={m.videoUrl} controls controlsList="nofullscreen" className="max-w-[240px] rounded-xl mt-1 bg-black" />
                                  )}
                                  {m.audioUrl && (
                                    <div className="mt-1 flex items-center gap-2">
                                      <audio src={m.audioUrl} controls className="max-w-[220px] h-9" />
                                      {m.audioDuration ? <span className="text-[10px] opacity-70">{m.audioDuration}s</span> : null}
                                    </div>
                                  )}
                                  {m.isEdited && <span className="text-[9px] italic opacity-60 ml-1">(modifié)</span>}
                                </>
                              )}
                            </div>

                            {!isEditing && !m.isDeleted && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={() => setShowEmojiPickerFor(showEmojiPickerFor === m.id ? null : m.id)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                                    title="Réagir"
                                  >
                                    <Smile className="w-3.5 h-3.5" />
                                  </button>
                                  {showEmojiPickerFor === m.id && (
                                    <div className={`absolute z-20 top-full mt-1 flex gap-1 bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-1.5 shadow-xl ${mine ? 'right-0' : 'left-0'}`}>
                                      {NOVA_QUICK_REACTIONS.map((e) => (
                                        <button key={e} type="button" onClick={() => void handleToggleReaction(m, e)} className="text-lg hover:scale-125 transition-transform">
                                          {renderEmojiOrNova(e)}
                                        </button>
                                      ))}
                                      {/* Suite #240 : séparation visuelle nette entre les
                                          mini-expressions Nova et "les vrais" emojis. */}
                                      <div className="w-px self-stretch bg-[#144447]/60 mx-0.5" />
                                      {QUICK_EMOJIS.map((e) => (
                                        <button key={e} type="button" onClick={() => void handleToggleReaction(m, e)} className="text-lg hover:scale-125 transition-transform">
                                          {e}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {mine && m.body && (
                                  <button
                                    type="button"
                                    onClick={() => { setEditingChatId(m.id); setEditingChatText(m.body); }}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                                    title="Modifier"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {mine && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteChatMsg(m)}
                                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400"
                                    title="Supprimer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {Object.keys(grouped).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(grouped).map(([emoji, list]) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => void handleToggleReaction(m, emoji)}
                                  className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border ${list.some((r) => r.userId === currentUserId) ? 'border-[#F7BC5F]/50 bg-[#F7BC5F]/10' : 'border-[#144447]/60 bg-[#0a1e20]'}`}
                                >
                                  <span>{renderEmojiOrNova(emoji, 'w-4 h-4')}</span>
                                  {list.length > 1 && <span className="text-[10px] text-slate-400">{list.length}</span>}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className={`flex items-center gap-1 mt-0.5 text-[10px] text-slate-500 ${mine ? 'flex-row-reverse' : ''}`}>
                            <span>{new Date(m.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            {mine && (
                              <button
                                type="button"
                                onClick={() => setReadByModalMsg(m)}
                                className="flex items-center gap-0.5 hover:text-slate-300"
                                title={otherRead ? 'Vu' : 'Envoyé'}
                              >
                                <CheckCheck className={`w-3 h-3 ${otherRead ? 'text-[#F9C977]' : ''}`} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {isRecordingChat && (
                  <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-xl bg-rose-500/10 border border-rose-500/30">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                    </span>
                    <span className="text-xs font-mono text-rose-300 flex-1">
                      {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')} — Enregistrement...
                    </span>
                    <button type="button" onClick={() => void handleStopRecordingChat(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300" title="Annuler">
                      <X className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => void handleStopRecordingChat(false)} className="p-1.5 rounded-lg bg-rose-500 text-white" title="Envoyer">
                      <Square className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <form
                  onSubmit={(e) => { e.preventDefault(); void handleSendChat(); }}
                  className="pt-3 border-t border-[#144447]/60 space-y-3"
                >
                  <input ref={chatImageInputRef} type="file" accept="image/*" hidden onChange={handleChatImageSelected} />
                  <input ref={chatVideoInputRef} type="file" accept="video/*" hidden onChange={handleChatVideoSelected} />

                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Écrire un message..."
                    disabled={isRecordingChat}
                    className="w-full bg-[#0a1e20] border border-[#144447]/60 rounded-full px-5 py-3 text-sm text-white focus:outline-none focus:border-[#F7BC5F] disabled:opacity-40"
                  />

                  <div className="grid grid-cols-3 items-center">
                    <div className="flex items-center gap-2 justify-self-start">
                      <button
                        type="button"
                        onClick={() => chatImageInputRef.current?.click()}
                        disabled={uploadingChatMedia || isRecordingChat}
                        className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                        title="Envoyer une image"
                      >
                        <ImageIcon className="w-5 h-5" />
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowComposerEmoji((v) => !v)}
                          className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10"
                          title="Emoji"
                        >
                          <Smile className="w-5 h-5" />
                        </button>
                        {showComposerEmoji && (
                          <div className="absolute z-20 bottom-full mb-2 left-0 flex gap-1 bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-1.5 shadow-xl">
                            {QUICK_EMOJIS.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => { setChatInput((v) => v + e); setShowComposerEmoji(false); }}
                                className="text-lg hover:scale-125 transition-transform"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => (isRecordingChat ? void handleStopRecordingChat(false) : void handleStartRecordingChat())}
                      disabled={uploadingChatMedia}
                      className={`justify-self-center w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 disabled:opacity-40 ${isRecordingChat ? 'bg-rose-500 text-white shadow-rose-500/40' : 'bg-rose-500/90 hover:bg-rose-500 text-white shadow-rose-500/30'}`}
                      title="Message vocal"
                    >
                      <Mic className="w-6 h-6" />
                    </button>

                    <div className="flex items-center gap-2 justify-self-end">
                      <button
                        type="button"
                        onClick={() => chatVideoInputRef.current?.click()}
                        disabled={uploadingChatMedia || isRecordingChat}
                        className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
                        title="Envoyer une vidéo (150 Mo max)"
                      >
                        <VideoIcon className="w-5 h-5" />
                      </button>
                      <button
                        type="submit"
                        disabled={chatSending || !chatInput.trim() || isRecordingChat}
                        className="w-10 h-10 rounded-full flex items-center justify-center bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 shadow-lg transition-transform hover:scale-105"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {activeTab === 'espace-client' && (
              // Ticket #226 : cette zone vivait dans la page qui défile
              // entière (pas de hauteur bornée) — la barre de saisie,
              // pourtant déjà en bas du flex, finissait donc par défiler
              // avec le reste de la page au lieu de rester accessible. Une
              // hauteur bornée en unités de viewport (indépendante du
              // `sticky` du bandeau Pipeline au-dessus, non touché) donne
              // enfin un vrai cadre défilant aux messages, avec la barre de
              // saisie fixée en bas de ce cadre.
              <div className="flex flex-col h-[min(64vh,680px)] min-h-[420px] animate-fade-in">
                <div className="mb-3 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-300 flex items-center gap-2 shrink-0">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  Conversation avec le client depuis son espace mobile — distincte des commentaires internes.
                </div>

                {/* Demande explicite : le conseiller affiché au client dans
                    son espace (ClientGuestShell) vient directement de
                    client.assignedTo — s'il est vide, le client voyait "Non
                    renseigné" alors que le sélecteur général de la fiche
                    (colonne de gauche) affiche toujours un nom par défaut
                    (getAssignedUser retombe sur le 1er membre de l'équipe),
                    ce qui masquait le problème côté équipe. Ici, on lit
                    directement client.assignedTo (jamais le fallback) pour
                    que ce soit visible et corrigeable en un clic. */}
                {!client.assignedTo && (
                  <div className="mb-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
                    <span className="flex-1 flex items-center gap-1.5"><img src="/nova/expressions/nova-attention.png" alt="" className="w-4 h-4 shrink-0" />Aucun conseiller renseigné — le client le voit comme "Non renseigné" dans son espace.</span>
                    <select
                      defaultValue=""
                      onChange={(e) => { if (e.target.value) void updateContact.mutateAsync({ id: client.id, updates: { assignedTo: e.target.value } }); }}
                      className="bg-black/30 border border-amber-500/40 rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-400 shrink-0"
                    >
                      <option value="" disabled>Assigner un conseiller...</option>
                      {assignableUsers.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div ref={leadChatScrollRef} className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pb-4">
                  {leadMessages.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 border border-dashed border-[#144447]/60 rounded-2xl bg-[#07191b] flex flex-col items-center gap-2">
                      <MessageSquare className="w-8 h-8 text-slate-600" />
                      <span className="text-xs">Aucun message pour l'instant.</span>
                    </div>
                  ) : (
                    <>
                      {leadMessages.map((m) => {
                        const mine = m.userId === currentUser?.uid;
                        const isEditing = leadEditingId === m.id;
                        return (
                          <div key={m.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'} py-0.5`}>
                            <div className={`flex items-end gap-1 max-w-[75%] ${mine ? 'flex-row-reverse' : ''}`}>
                              <div className={`rounded-2xl px-4 py-2.5 text-sm relative ${mine ? 'bg-[#F7BC5F] text-slate-950 font-semibold' : 'bg-[#0a1e20] border border-[#144447]/60 text-slate-200'}`}>
                                {!mine && <div className="text-[10px] font-bold text-[#F9C977] mb-0.5">{client?.name || 'Client'}</div>}
                                {m.deletedAt ? (
                                  <p className="italic text-xs opacity-60">Message supprimé</p>
                                ) : isEditing ? (
                                  <div className="flex flex-col gap-2 min-w-[200px]">
                                    <textarea
                                      value={leadEditingText}
                                      onChange={(e) => setLeadEditingText(e.target.value)}
                                      className="bg-black/10 rounded-lg p-2 text-sm text-inherit border border-black/20 focus:outline-none resize-none"
                                      rows={2}
                                      autoFocus
                                    />
                                    <div className="flex justify-end gap-2">
                                      <button onClick={() => setLeadEditingId(null)} className="text-[11px] opacity-70 hover:opacity-100">Annuler</button>
                                      <button onClick={() => void saveLeadMessageEdit()} className="text-[11px] font-bold underline">Enregistrer</button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {m.body && m.kind !== 'file' && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                                    {m.kind === 'image' && m.attachmentUrl && (
                                      <button type="button" onClick={() => setLeadLightboxUrl(m.attachmentUrl)} className="block cursor-pointer">
                                        <img src={m.attachmentUrl} alt="Pièce jointe" className="max-w-[220px] max-h-[220px] rounded-xl object-cover" />
                                      </button>
                                    )}
                                    {m.kind === 'file' && m.attachmentUrl && (
                                      <a href={m.attachmentUrl} download={m.body || 'document'} className="flex items-center gap-2 underline">
                                        <FileText className="w-4 h-4 shrink-0" /> {m.body || 'Document'}
                                      </a>
                                    )}
                                    {m.kind === 'voice' && m.attachmentUrl && (
                                      <div className="flex items-center gap-2">
                                        <audio src={m.attachmentUrl} controls className="max-w-[200px] h-9" />
                                        {m.attachmentDuration ? <span className="text-[10px] opacity-70">{m.attachmentDuration}s</span> : null}
                                      </div>
                                    )}
                                    {m.editedAt && <span className="text-[9px] italic opacity-60 ml-1">(modifié)</span>}
                                  </>
                                )}
                                <p className={`text-[10px] mt-1 ${mine ? 'text-slate-950/60' : 'text-slate-500'}`}>{new Date(m.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                              </div>

                              {mine && !m.deletedAt && !isEditing && (
                                <div className="relative opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  <button onClick={() => setLeadMessageMenuId(leadMessageMenuId === m.id ? null : m.id)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white">
                                    <MoreVertical className="w-3.5 h-3.5" />
                                  </button>
                                  {leadMessageMenuId === m.id && (
                                    <>
                                      <div className="fixed inset-0 z-40" onClick={() => setLeadMessageMenuId(null)} />
                                      <div className="absolute z-50 top-full right-0 mt-1 bg-[#0a1e20] border border-[#144447]/60 rounded-xl shadow-xl overflow-hidden w-32">
                                        {m.kind === 'text' && (
                                          <button onClick={() => startEditingLeadMessage(m)} className="w-full px-3 py-2 flex items-center gap-2 text-xs text-white hover:bg-white/10">
                                            <Pencil className="w-3 h-3" /> Modifier
                                          </button>
                                        )}
                                        <button onClick={() => void deleteLeadMessage(m.id)} className="w-full px-3 py-2 flex items-center gap-2 text-xs text-rose-300 hover:bg-rose-500/10">
                                          <Trash2 className="w-3 h-3" /> Supprimer
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {(() => {
                        const lastMine = [...leadMessages].reverse().find((m) => m.userId === currentUser?.uid && !m.deletedAt);
                        if (!lastMine) return null;
                        return (
                          <div className="flex justify-end pr-1">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              {lastMine.readAt ? (<><CheckCheck className="w-3 h-3 text-sky-400" /> Vu</>) : (<><Check className="w-3 h-3" /> Envoyé</>)}
                            </span>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                {leadLightboxUrl && createPortal(
                  <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" onClick={() => setLeadLightboxUrl(null)}>
                    <button onClick={() => setLeadLightboxUrl(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
                      <X className="w-5 h-5" />
                    </button>
                    <img src={leadLightboxUrl} alt="" className="max-w-full max-h-full object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
                  </div>,
                  document.body
                )}

                {isGuestActive ? (
                  <div className="pt-2 border-t border-[#144447]/60 shrink-0 relative">
                    {leadEmojiPickerOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setLeadEmojiPickerOpen(false)} />
                        <div className="absolute z-50 bottom-full left-0 mb-2 bg-[#0a1e20] border border-[#144447]/60 rounded-2xl p-2 shadow-xl flex gap-1">
                          {QUICK_EMOJIS.map((e) => (
                            <button key={e} onClick={() => insertLeadEmoji(e)} className="text-xl hover:scale-125 transition-transform p-1">{e}</button>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => leadImageInputRef.current?.click()} disabled={leadUploading} className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-40" title="Envoyer une photo">
                        <ImageIcon className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => leadFileInputRef.current?.click()} disabled={leadUploading} className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-40" title="Envoyer un document">
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => setLeadEmojiPickerOpen((v) => !v)} className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10" title="Emoji">
                        <Smile className="w-4 h-4" />
                      </button>
                      {/* Même méthodologie que les autres chats du CRM (23
                          septembre) : Entrée ne fait que revenir à la
                          ligne, seul le bouton d'envoi envoie —
                          <textarea> au lieu d'un <input>, qui ne pouvait
                          pas contenir de retour à la ligne. */}
                      <textarea
                        ref={leadTextareaRef}
                        rows={1}
                        value={leadDraft}
                        onChange={(e) => setLeadDraft(e.target.value)}
                        placeholder="Répondre au client..."
                        className="flex-1 min-w-0 resize-none bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-3.5 py-2.5 text-sm text-white leading-relaxed placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                      />
                      <button
                        onClick={() => void sendLeadText()}
                        disabled={!leadDraft.trim() || leadSending}
                        className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 disabled:opacity-30"
                      >
                        {leadSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </div>
                    {leadUploading && <p className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Envoi en cours...</p>}
                    <input ref={leadImageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void sendLeadAttachment(f, 'image'); }} />
                    <input ref={leadFileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void sendLeadAttachment(f, 'file'); }} />
                  </div>
                ) : (
                  <div className="pt-2 border-t border-[#144447]/60 shrink-0 text-xs text-slate-500 text-center py-2">
                    Le compte client est {guestAccess?.status === 'suspendue' ? 'suspendu' : 'révoqué'} — impossible de lui écrire.
                  </div>
                )}
              </div>
            )}

            {readByModalMsg && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setReadByModalMsg(null)}>
                <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-xs w-full p-5 text-white shadow-2xl">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold">Vu par</h4>
                    <button onClick={() => setReadByModalMsg(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                  </div>
                  {readByModalMsg.readBy.filter((r) => r.userId !== currentUserId).length === 0 ? (
                    <p className="text-xs text-slate-500">Pas encore vu.</p>
                  ) : (
                    <div className="space-y-2">
                      {readByModalMsg.readBy.filter((r) => r.userId !== currentUserId).map((r) => (
                        <div key={r.userId} className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-200">{r.userName}</span>
                          <span className="text-slate-500">{new Date(r.readAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showQuestionnaireModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowQuestionnaireModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-lg w-full p-6 text-white shadow-2xl relative animate-scale-up max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between mb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-[#F9C977]">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-white">Questionnaire confidentiel</h3>
              </div>
              <button onClick={() => setShowQuestionnaireModal(false)} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4 shrink-0">
              Le client recevra un lien sécurisé par email pour remplir le questionnaire. Les réponses se déposeront automatiquement sur sa fiche.
            </p>

            <div className="flex items-center gap-2 mb-5 shrink-0">
              <input
                type="email"
                value={questionnaireEmail}
                onChange={(e) => setQuestionnaireEmail(e.target.value)}
                placeholder="email@client.com"
                className="flex-1 bg-[#030d0f] border border-[#F7BC5F]/40 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
              <button
                onClick={() => void handleSendQuestionnaire()}
                disabled={questionnaireSending || !questionnaireEmail.trim()}
                className="px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-40 text-slate-950 font-bold text-xs shadow-lg flex items-center gap-2 shrink-0"
              >
                {questionnaireSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Envoyer
              </button>
            </div>

            <div className="overflow-y-auto custom-scrollbar flex-1 space-y-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Historique</h4>
              {questionnairesLoading ? (
                <p className="text-xs text-slate-500 text-center py-6">Chargement...</p>
              ) : questionnaires.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Aucun envoi pour l'instant.</p>
              ) : (
                questionnaires.map((q) => (
                  <div key={q.id} className="bg-[#0a1e20] border border-[#144447]/60 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{q.sentToEmail}</p>
                        <p className="text-[10px] text-slate-500">envoyé le {new Date(q.sentAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {q.status === 'completed' ? (
                          <span className="px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Reçu le {q.completedAt ? new Date(q.completedAt).toLocaleDateString('fr-FR') : ''}
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-full bg-slate-500/15 border border-slate-500/30 text-slate-300 text-[10px] font-bold flex items-center gap-1">
                            <Clock className="w-3 h-3" /> En attente
                          </span>
                        )}
                        <button onClick={() => copyQuestionnaireLink(q.token)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" title="Copier le lien">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => void handleDeleteQuestionnaire(q.id)} className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {q.status === 'completed' && q.answers && (
                      <button
                        onClick={() => setExpandedQuestionnaireId(expandedQuestionnaireId === q.id ? null : q.id)}
                        className="text-[11px] text-[#F9C977] hover:text-[#FAD592] mt-2 font-semibold"
                      >
                        {expandedQuestionnaireId === q.id ? '▾ Masquer les réponses' : '▸ Voir les réponses'}
                      </button>
                    )}
                    {expandedQuestionnaireId === q.id && q.answers && (
                      <pre className="mt-2 p-3 rounded-lg bg-black/40 text-[10px] text-slate-300 overflow-x-auto max-h-64 whitespace-pre-wrap">
                        {JSON.stringify(q.answers, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showShareModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-md w-full p-6 text-white shadow-2xl relative animate-scale-up">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-[#F9C977]">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Partager la fiche</h3>
                  <p className="text-xs text-slate-400">Un collègue de votre société pourra voir les notes, documents et discuter avec vous sur cette fiche.</p>
                </div>
              </div>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {sharesLoading ? (
                <div className="text-xs text-slate-500 text-center py-4">Chargement...</div>
              ) : shares.length > 0 ? (
                <div className="space-y-2">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Partagé avec</span>
                  {shares.map((s) => {
                    const otherId = s.sharedWith === currentUserId ? s.sharedBy : s.sharedWith;
                    const member = TEAM_MEMBERS.find((m) => m.id === otherId);
                    return (
                      <div key={s.id} className="flex items-center justify-between bg-[#0a1e20] border border-[#144447]/60 rounded-xl px-3 py-2">
                        <span className="text-sm text-slate-200 font-semibold">{member?.name || 'Utilisateur'}</span>
                        <button
                          onClick={() => void handleUnshare(s.id)}
                          className="p-1.5 text-rose-400 hover:text-rose-300 rounded-lg hover:bg-rose-500/10"
                          title="Arrêter le partage"
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Partager avec un collègue</label>
                <select
                  value={shareTargetId}
                  onChange={(e) => setShareTargetId(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                >
                  <option value="">Sélectionner...</option>
                  {colleagues
                    .filter((m) => !shares.some((s) => s.sharedWith === m.id || s.sharedBy === m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  disabled={!shareTargetId || shareSaving}
                  onClick={() => void handleShareContact()}
                  className="px-5 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs shadow-lg cursor-pointer"
                >
                  {shareSaving ? 'Partage...' : 'Partager'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-6"
          onClick={() => { setLightboxUrl(null); setLightboxKind(null); }}
        >
          {/* Ticket #102 : la croix (prévisualisation via l'icône œil d'un
              document) était positionnée trop haut en haut à droite —
              redescendue. */}
          <button
            onClick={() => { setLightboxUrl(null); setLightboxKind(null); }}
            className="absolute right-6 text-white/70 hover:text-white p-2 rounded-lg hover:bg-white/10 z-10" style={{ top: 'calc(5rem + env(safe-area-inset-top, 0px))' }}
          >
            <X className="w-6 h-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl w-full max-h-[85vh] flex items-center justify-center">
            {lightboxKind === 'audio' ? (
              <audio src={lightboxUrl} controls autoPlay className="w-full" />
            ) : lightboxUrl.includes('drive.google.com') ? (
              <iframe
                src={lightboxUrl.replace('/view', '/preview')}
                className="w-full h-[80vh] rounded-xl shadow-2xl border-0"
                allow="autoplay"
              />
            ) : (
              <img src={lightboxUrl} alt="Aperçu" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
            )}
          </div>
        </div>
      )}

      {/* Ticket #47 : e-mail ouvert en grand + réponse directe sans quitter
          la fiche client. */}
      {openEmail && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 sm:p-6"
          onClick={() => setOpenEmail(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[88vh] bg-[#0a1e20] border border-[#144447]/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-[#144447]/60 shrink-0">
              <div className="min-w-0">
                <p className="text-base font-bold text-white truncate">{openEmail.subject || '(sans objet)'}</p>
                <p className="text-xs text-slate-400 mt-1">
                  <span className="font-semibold text-slate-300">{openEmail.fromName || openEmail.from}</span>
                  {' '}·{' '}{openEmail.date}
                </p>
              </div>
              <button
                onClick={() => setOpenEmail(null)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {openEmail.bodyHtml ? (
                <iframe
                  title="Contenu de l'e-mail"
                  sandbox=""
                  srcDoc={openEmail.bodyHtml}
                  className="w-full h-[45vh] rounded-lg bg-white border-0"
                />
              ) : (
                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{openEmail.bodyText}</p>
              )}
            </div>

            <div className="p-5 border-t border-[#144447]/60 shrink-0 space-y-3">
              {!emailReplyOpen ? (
                <button
                  onClick={() => setEmailReplyOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  Répondre
                </button>
              ) : (
                <>
                  <textarea
                    rows={5}
                    autoFocus
                    placeholder={`Répondre à ${openEmail.fromName || openEmail.from}...`}
                    value={emailReplyBody}
                    onChange={(e) => setEmailReplyBody(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#1d575b] rounded-xl p-3 text-sm text-white focus:outline-none focus:border-[#F7BC5F] resize-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => { setEmailReplyOpen(false); setEmailReplyBody(''); }}
                      className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={() => void handleSendEmailReply()}
                      disabled={emailReplySending || !emailReplyBody.trim()}
                      className="px-5 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      {emailReplySending ? 'Envoi...' : 'Envoyer'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showTaskModal && (
        <TaskModal
          onClose={() => { setShowTaskModal(false); setEditingTask(null); }}
          onAddTask={(t) => addTask.mutateAsync(t)}
          contacts={contacts || []}
          defaultContactId={clientId}
          allTasks={tasks || []}
          initialTask={editingTask || undefined}
          onUpdateTask={(id, updates) => updateTask.mutateAsync({ id, updates })}
        />
      )}

      {showParcoursCredit && <ParcoursCreditModal onClose={() => setShowParcoursCredit(false)} />}

      <ConsentViewDialog
        open={consentViewOpen}
        onOpenChange={setConsentViewOpen}
        leadId={clientId}
        leadName={client.name}
      />

      {/* Rendu hors-écran utilisé pour générer le PDF téléchargeable directement
          depuis la fiche, sans passer par la modale "Voir le questionnaire". */}
      {latestSignedConsent && (
        <div className="fixed -left-[10000px] top-0 w-[794px] pointer-events-none" aria-hidden>
          <div ref={consentPdfRef} className="bg-white p-6">
            <ConsentDocument
              record={latestSignedConsent}
              senderName={latestSignedConsent.created_by ? consentSenders[latestSignedConsent.created_by]?.name : null}
              senderRsac={latestSignedConsent.created_by ? consentSenders[latestSignedConsent.created_by]?.rsac : null}
              senderRcPro={latestSignedConsent.created_by ? consentSenders[latestSignedConsent.created_by]?.rcPro : null}
            />
          </div>
        </div>
      )}

      {/* Envoyer un nouveau consentement */}
      {showSendConsentModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={() => setShowSendConsentModal(false)}
        >
          <div
            className="w-full sm:max-w-md bg-[#0a1e20] border border-[#144447]/60 sm:rounded-3xl rounded-t-3xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#F7BC5F]" /> Envoyer le consentement
              </h2>
              <button onClick={() => setShowSendConsentModal(false)} className="p-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Le client recevra un lien sécurisé par email pour signer son consentement au démarchage téléphonique.
              Le document se déposera automatiquement sur sa fiche une fois signé.
            </p>
            <label className="block space-y-1 mb-4">
              <span className="text-xs font-bold text-slate-400">Email du client</span>
              <input
                type="email"
                value={consentSendEmail}
                onChange={(e) => setConsentSendEmail(e.target.value)}
                placeholder="email@duclient.fr"
                className="w-full bg-[#021316] border border-[#1b484d] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
            </label>
            {consentSendError && <p className="text-xs text-rose-400 mb-3">{consentSendError}</p>}
            <button
              onClick={handleSendConsent}
              disabled={consentSending || !consentSendEmail.trim()}
              className="w-full px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#e5ab4c] text-slate-950 text-sm font-black flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {consentSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Envoyer
            </button>
          </div>
        </div>
      )}

      {showEditModal && (
        <EditClientModal
          client={client}
          onClose={() => setShowEditModal(false)}
          onSave={async (updates) => {
            await updateContact.mutateAsync({ id: clientId, updates });
            toast.success('Fiche mise à jour');
          }}
        />
      )}

      {/* "Inviter dans l'espace client" retiré (demande explicite, 16
          septembre) — plus d'entrée dans le menu Actions ni de popup. */}

      {montantEtapePrompt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setMontantEtapePrompt(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-sm w-full p-6 text-white shadow-2xl relative animate-scale-up">
            {/* Conciergerie : « ce sera le même système, le TTC sera
                comptabilisé dans le chiffre d'affaires de l'agence ». Même
                champ, même circuit — seul l'intitulé change. */}
            <h3 className="text-base font-bold text-white mb-2">
              {estConciergerie
                ? 'Montant TTC (conciergerie)'
                : `${estConseilsFinances ? 'Honoraires' : 'Commission'} agence, ${libelleUnite}`}
            </h3>
            <p className="text-sm text-slate-300 mb-4">
              La fiche vient de passer en « {montantEtapePrompt} ».{' '}
              {estConciergerie
                ? 'Quel est le montant TTC de la prestation de conciergerie ?'
                : `Quel est le montant ${estConseilsFinances ? 'des honoraires agence' : 'de la commission agence'}, ${libelleUnite} ?`}
            </p>
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={montantEtapeSaisi}
              onChange={(e) => setMontantEtapeSaisi(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void validerMontantEtape(); }}
              disabled={montantEtapeEnCours}
              placeholder="Non renseigné"
              className="w-full px-3 py-2.5 rounded-xl bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60 disabled:opacity-60"
            />
            <p className="text-[11px] text-slate-500 mt-2 mb-5 leading-relaxed">
              C'est ce montant qui apparaît en « CA à venir » sur le Tableau de bord, puis dans le
              chiffre d'affaires de l'agence une fois la fiche archivée. Laissé vide, le montant
              déjà enregistré est conservé.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMontantEtapePrompt(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white"
              >
                Plus tard
              </button>
              <button
                onClick={() => void validerMontantEtape()}
                disabled={montantEtapeEnCours}
                className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-50 text-black text-xs font-bold"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {showArchiveModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowArchiveModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-sm w-full p-6 text-white shadow-2xl relative animate-scale-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-[#F9C977]">
                <Archive className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Archiver la fiche</h3>
            </div>
            <p className="text-sm text-slate-300 mb-4">La signature du dossier a-t-elle été faite ? Cela permet de comptabiliser cette affaire dans les statistiques du mois.</p>

            {/* Demandé le 2 septembre : la commission du conseiller AU-DESSUS
                de celle de l'agence, puis la récurrence — trois montants
                distincts, saisis à la main au moment d'archiver. */}
            {/* Demandé le 6 septembre (Conseils Finances) : la case
                « Commission des courtiers » du tableau de bord restait à
                0 € — ce champ n'existait qu'à l'archivage Novavisio, donc
                advisor_commission_ttc n'était jamais saisi sur ces
                dossiers. */}
            {(estNovavisio || estConseilsFinances) && (
              <div className="mb-4">
                <label htmlFor="archive-commission-conseiller" className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Commission {prenomConseiller ? `de ${prenomConseiller}` : 'du conseiller'}, TTC
                </label>
                <input
                  id="archive-commission-conseiller"
                  type="text"
                  inputMode="decimal"
                  value={montantCharge ? commissionConseiller : ''}
                  onChange={(e) => setCommissionConseiller(e.target.value)}
                  disabled={!montantCharge || archiving}
                  placeholder={montantCharge ? 'Non renseigné' : 'Chargement…'}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60 disabled:opacity-60"
                />
              </div>
            )}

            <div className="mb-5">
              <label htmlFor="archive-montant-ht" className="block text-xs font-semibold text-slate-400 mb-1.5">
                {estConseilsFinances ? 'Honoraires' : 'Commission'} agence, {libelleUnite}
              </label>
              <input
                id="archive-montant-ht"
                type="text"
                inputMode="decimal"
                value={montantCharge ? montantHt : ''}
                onChange={(e) => setMontantHt(e.target.value)}
                disabled={!montantCharge || archiving}
                placeholder={montantCharge ? 'Non renseigné' : 'Chargement…'}
                className="w-full px-3 py-2.5 rounded-xl bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60 disabled:opacity-60"
              />
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                C'est ce montant qui comptera dans le chiffre d'affaires de l'agence
                {estNovavisio ? ', converti en hors taxes' : ''}. Corrige-le si besoin — laissé
                vide, celui déjà enregistré est conservé. En répondant « signature faite »,
                l'affaire est comptée comme signée dans les statistiques.
              </p>
            </div>

            {estNovavisio && (
              <div className="mb-5">
                <label htmlFor="archive-recurrence" className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Récurrence {prenomConseiller ? `de ${prenomConseiller}` : ''}
                </label>
                <input
                  id="archive-recurrence"
                  type="text"
                  inputMode="decimal"
                  value={montantCharge ? recurrenceSaisie : ''}
                  onChange={(e) => setRecurrenceSaisie(e.target.value)}
                  disabled={!montantCharge || archiving}
                  placeholder={montantCharge ? 'Non renseigné' : 'Chargement…'}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#0a1e20] border border-[#144447]/60 text-white text-sm focus:outline-none focus:border-[#F7BC5F]/60 disabled:opacity-60"
                />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Ce qui revient ensuite sur ce client — abonnement, prestation renouvelée. Noté à
                  part : ce n'est ni une commission agence, ni une commission conseiller.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={() => void handleArchive(true)}
                disabled={archiving}
                className="w-full px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm"
              >
                Oui, signature faite
              </button>
              <button
                onClick={() => void handleArchive(false)}
                disabled={archiving}
                className="w-full px-4 py-2.5 rounded-xl bg-[#0a1e20] border border-[#144447]/60 hover:bg-black/40 disabled:opacity-50 text-slate-200 font-bold text-sm"
              >
                Non, archiver sans signature
              </button>
              <button
                onClick={() => setShowArchiveModal(false)}
                disabled={archiving}
                className="w-full px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}