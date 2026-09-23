import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LifeBuoy, Plus, X, Image as ImageIcon, Send, Loader2, AlertTriangle,
  ArrowRight, Paperclip, MessageCircle, CheckCircle2, Archive, ArchiveRestore,
  ExternalLink, Rocket, Trash2, Check, CheckCheck,
} from 'lucide-react';
import {
  SupportTicket, SupportTicketMessage, SupportPriority, SupportCategory, SupportStatus, AGENCIES,
} from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';

// Les 3 niveaux demandés (mineur/important/majeur) sont mappés sur l'enum
// Postgres réel `support_priority` (basse/normale/haute/urgente) — pas de
// changement de schéma nécessaire, juste un choix de 3 valeurs parmi les 4.
const PRIORITY_OPTIONS: { value: SupportPriority; label: string; classes: string }[] = [
  { value: 'basse', label: 'Mineur', classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { value: 'normale', label: 'Important', classes: 'bg-[#F7BC5F]/15 text-[#F9C977] border-[#F7BC5F]/30' },
  { value: 'urgente', label: 'Majeur', classes: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
];

const CATEGORY_OPTIONS: { value: SupportCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'technique', label: 'Technique' },
  { value: 'fonctionnalite', label: 'Fonctionnalité' },
  { value: 'autre', label: 'Autre' },
];

// Workflow demandé : Nouveau → En cours → Terminé, mappé sur l'enum réel
// `support_status` (ouvert/en_cours/ferme).
const STATUS_COLUMNS: { value: SupportStatus; label: string }[] = [
  { value: 'ouvert', label: 'Nouveau' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'ferme', label: 'Terminé' },
];

const priorityMeta = (p: SupportPriority) =>
  PRIORITY_OPTIONS.find((o) => o.value === p) || { value: p, label: p, classes: 'bg-white/10 text-gray-300 border-white/10' };

const categoryLabel = (c: SupportCategory) => CATEGORY_OPTIONS.find((o) => o.value === c)?.label || c;

const statusLabel = (s: SupportStatus) => STATUS_COLUMNS.find((c) => c.value === s)?.label || s;

interface TicketRow {
  id: string;
  agency_id: string;
  created_by: string;
  assigned_to: string | null;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  title: string;
  description: string;
  attachments: string[] | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

const rowToTicket = (row: TicketRow, names: Record<string, string>): SupportTicket => ({
  id: row.id,
  agencyId: row.agency_id,
  createdBy: row.created_by,
  createdByName: names[row.created_by],
  assignedTo: row.assigned_to,
  category: row.category,
  priority: row.priority,
  status: row.status,
  title: row.title,
  description: row.description,
  attachments: row.attachments || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

interface MessageRow {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  attachments: string[] | null;
  created_at: string;
  read_by: { userId: string; userName?: string; readAt?: string }[] | null;
}

const rowToMessage = (row: MessageRow): SupportTicketMessage => ({
  id: row.id,
  ticketId: row.ticket_id,
  senderId: row.sender_id,
  senderName: row.sender_name || 'Utilisateur',
  body: row.body,
  attachments: row.attachments || [],
  createdAt: row.created_at,
  readBy: Array.isArray(row.read_by) ? row.read_by : [],
});

export const SupportView: React.FC = () => {
  const { currentUser, userProfile, activeAgency } = useAuth();
  const isAdmin = userProfile?.role === 'super_admin';

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<SupportCategory>('bug');
  const [priority, setPriority] = useState<SupportPriority>('normale');
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportTicketMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatFiles, setChatFiles] = useState<File[]>([]);
  // Demande explicite (23 septembre) : « le panneau des messages gagne en
  // hauteur pour qu'on puisse lire tout le texte qu'on tape » — même
  // mécanisme que ChatViewSupabase.tsx : le textarea grandit avec son
  // contenu, jusqu'à un plafond au-delà duquel il défile plutôt que de
  // manger tout l'écran (plafond plus haut sur mobile, où le clavier
  // masque déjà la moitié de l'écran).
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isMobileSaisie = useIsMobile();
  const HAUTEUR_MAX_SAISIE = isMobileSaisie ? 220 : 132;
  useEffect(() => {
    const zone = chatTextareaRef.current;
    if (!zone) return;
    zone.style.height = 'auto';
    zone.style.height = `${Math.min(zone.scrollHeight, HAUTEUR_MAX_SAISIE)}px`;
    zone.style.overflowY = zone.scrollHeight > HAUTEUR_MAX_SAISIE ? 'auto' : 'hidden';
  }, [chatInput, HAUTEUR_MAX_SAISIE]);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deployRequestState, setDeployRequestState] = useState<'idle' | 'sending' | 'sent'>('idle');

  // Bouton "Valider et déployer" réservé à Sylvain Grazia — même mécanique
  // que le bouton "Déployer" de la fenêtre de test (Header.tsx) : crée une
  // notification que Nova surveille activement pour promouvoir le
  // correctif validé vers la production, avec le ticket concerné en référence.
  const SYLVAIN_UID = '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29';
  const isSylvain = currentUser?.uid === SYLVAIN_UID;
  const NOVA_BOT_ID = '00000000-0000-0000-0000-000000000001';
  const [novaRepliedTicketIds, setNovaRepliedTicketIds] = useState<Set<string>>(new Set());
  // Demandé (19/09/2026, capture à l'appui) : « je ne vois pas sur la carte
  // le nombre de messages » — le Kanban affichait déjà le nombre de pièces
  // jointes mais jamais le nombre de messages de l'échange.
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({});

  const handleValidateAndDeploy = async (ticket: SupportTicket) => {
    if (!currentUser || deployRequestState === 'sending') return;
    setDeployRequestState('sending');
    try {
      await supabase.rpc('create_notification', {
        _user_id: currentUser.uid,
        _type: 'deploy_request',
        _title: '🚀 Déploiement demandé',
        _message: `Ticket validé sur test.nova360.space : "${ticket.title}". Merci de déployer en production.`,
        _entity_type: 'support_ticket',
        _entity_id: ticket.id,
        _agency_id: null,
        _metadata: { source: 'support_ticket_validate', ticket_id: ticket.id, at: new Date().toISOString() },
      });
      setDeployRequestState('sent');
      setTimeout(() => setDeployRequestState('idle'), 4000);
    } catch (err) {
      console.error('Erreur envoi demande de déploiement :', err);
      setDeployRequestState('idle');
    }
  };

  const loadTickets = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      let query = supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
      if (!isAdmin) query = query.eq('created_by', currentUser.uid);
      const { data, error: err } = await query;
      if (err) throw err;

      const rows = (data as TicketRow[]) || [];
      const creatorIds = Array.from(new Set(rows.map((r) => r.created_by)));
      let names: Record<string, string> = {};
      if (creatorIds.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', creatorIds);
        names = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.full_name || p.email || 'Utilisateur']));
      }
      setTickets(rows.map((r) => rowToTicket(r, names)));

      // Pastille rouge : tickets où Nova a répondu depuis la dernière fois
      // qu'on a ouvert le ticket (marqué "lu" en local à l'ouverture) — pas
      // juste "Nova a déjà répondu un jour", pour qu'elle disparaisse une
      // fois le ticket consulté.
      if (rows.length) {
        const { data: novaMsgs } = await supabase
          .from('support_ticket_messages')
          .select('ticket_id, created_at')
          .eq('sender_id', NOVA_BOT_ID)
          .in('ticket_id', rows.map((r) => r.id))
          .order('created_at', { ascending: false });
        const lastNovaByTicket: Record<string, string> = {};
        (novaMsgs || []).forEach((m: any) => {
          if (!lastNovaByTicket[m.ticket_id]) lastNovaByTicket[m.ticket_id] = m.created_at;
        });
        const unread = new Set<string>();
        Object.entries(lastNovaByTicket).forEach(([ticketId, lastAt]) => {
          const readAt = localStorage.getItem(`novasphere:ticket-read:${ticketId}`);
          if (!readAt || new Date(lastAt).getTime() > new Date(readAt).getTime()) unread.add(ticketId);
        });
        setNovaRepliedTicketIds(unread);

        const { data: allMsgs } = await supabase
          .from('support_ticket_messages')
          .select('ticket_id')
          .in('ticket_id', rows.map((r) => r.id));
        const counts: Record<string, number> = {};
        (allMsgs || []).forEach((m: any) => {
          counts[m.ticket_id] = (counts[m.ticket_id] || 0) + 1;
        });
        setMessageCounts(counts);
      } else {
        setNovaRepliedTicketIds(new Set());
        setMessageCounts({});
      }
    } catch (e) {
      console.error('Erreur chargement des tickets support :', e);
      setError((e as Error).message || 'Impossible de charger les tickets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, isAdmin]);

  const loadMessages = async (ticketId: string) => {
    setChatLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('support_ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
      if (err) throw err;
      const rows = (data as MessageRow[]) || [];
      setMessages(rows.map(rowToMessage));

      // Accusé de réception (19/09/2026, capture à l'appui) : « je ne vois
      // pas l'accusé réception de lecture » — même mécanique que les canaux
      // de discussion (read_by JSONB, voir ChatViewSupabase) : marque lu
      // tout message d'un autre expéditeur pas encore lu par moi, dès
      // l'ouverture du ticket.
      if (currentUser) {
        const toMarkRead = rows.filter(
          (r) => r.sender_id !== currentUser.uid && !(r.read_by || []).some((x) => x.userId === currentUser.uid)
        );
        if (toMarkRead.length > 0) {
          const displayName = userProfile?.displayName || currentUser.email || 'Utilisateur';
          void Promise.all(
            toMarkRead.map((r) =>
              supabase
                .from('support_ticket_messages')
                .update({
                  read_by: [...(r.read_by || []), { userId: currentUser.uid, userName: displayName, readAt: new Date().toISOString() }],
                } as any)
                .eq('id', r.id)
            )
          );
        }
      }
    } catch (e) {
      console.warn('Erreur chargement des messages du ticket :', e);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (selectedTicketId) {
      void loadMessages(selectedTicketId);
      // Marque le ticket comme "lu" dès son ouverture — fait disparaître la
      // pastille rouge de réponse Nova pour ce ticket.
      localStorage.setItem(`novasphere:ticket-read:${selectedTicketId}`, new Date().toISOString());
      setNovaRepliedTicketIds((cur) => {
        if (!cur.has(selectedTicketId)) return cur;
        const next = new Set(cur);
        next.delete(selectedTicketId);
        return next;
      });
    }
  }, [selectedTicketId]);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  const notifySuperAdmins = async (ticket: { id: string; title: string; agencyId: string }, message: string, type: string) => {
    try {
      const { data: admins } = await supabase.from('user_roles').select('user_id').eq('role', 'super_admin');
      await Promise.all(
        (admins || []).map((a: any) =>
          supabase.rpc('create_notification', {
            _user_id: a.user_id,
            _type: type,
            _title: type === 'support_ticket_created' ? '🎫 Nouveau ticket support' : '💬 Nouveau message sur un ticket',
            _message: message,
            _entity_type: 'support_ticket',
            _entity_id: ticket.id,
            _agency_id: ticket.agencyId,
            _metadata: {},
          })
        )
      );
    } catch (e) {
      console.warn('Notification super admin impossible :', e);
    }
  };

  const notifyUser = async (userId: string, ticket: { id: string; agencyId: string }, title: string, message: string, type: string) => {
    try {
      await supabase.rpc('create_notification', {
        _user_id: userId,
        _type: type,
        _title: title,
        _message: message,
        _entity_type: 'support_ticket',
        _entity_id: ticket.id,
        _agency_id: ticket.agencyId,
        _metadata: {},
      });
    } catch (e) {
      console.warn('Notification utilisateur impossible :', e);
    }
  };

  const resetCreateForm = () => {
    setTitle('');
    setDescription('');
    setCategory('bug');
    setPriority('normale');
    setFiles([]);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !title.trim()) return;

    setCreating(true);
    setError(null);

    try {
      const agencyId = activeAgency.id !== 'all' ? activeAgency.id : AGENCIES[0].id;

      // Upload des images vers le bucket privé "support-attachments" — on
      // génère des liens signés longue durée (10 ans) puisque le bucket
      // n'est pas public.
      const attachmentUrls: string[] = [];
      for (const file of files) {
        const path = `${currentUser.uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: upErr } = await supabase.storage.from('support-attachments').upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const { data: signed, error: signErr } = await supabase.storage
          .from('support-attachments')
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
        if (signErr) throw signErr;
        if (signed?.signedUrl) attachmentUrls.push(signed.signedUrl);
      }

      const { data: inserted, error: insErr } = await supabase
        .from('support_tickets')
        .insert({
          agency_id: agencyId,
          created_by: currentUser.uid,
          category,
          priority,
          status: 'ouvert',
          title: title.trim(),
          description: description.trim(),
          attachments: attachmentUrls,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      await notifySuperAdmins(
        { id: inserted.id, title: inserted.title, agencyId },
        `${userProfile?.displayName || currentUser.email} a créé un ticket : ${title.trim()}`,
        'support_ticket_created'
      );

      resetCreateForm();
      setShowCreate(false);
      await loadTickets();
    } catch (e) {
      setError((e as Error).message || 'Impossible de créer le ticket.');
    } finally {
      setCreating(false);
    }
  };

  const setTicketStatus = async (ticket: SupportTicket, next: SupportStatus) => {
    if (ticket.status === next) return;
    setUpdatingStatus(true);
    try {
      const { error: err } = await supabase
        .from('support_tickets')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', ticket.id);
      if (err) throw err;
      await loadTickets();

      // Ticket #20 (nouvelle base) : une fois le ticket clôturé, ses
      // anciennes notifications (nouveau ticket, nouveau message...) n'ont
      // plus lieu de trainer dans la clochette — on les supprime.
      if (next === 'ferme') {
        await supabase
          .from('notifications')
          .update({ dismissed_at: new Date().toISOString() })
          .eq('entity_type', 'support_ticket')
          .eq('entity_id', ticket.id);
      }

      // Prévenir le créateur du ticket quand son statut avance — seulement
      // s'il ne s'agit pas de son propre ticket (sinon il n'a pas besoin de
      // se notifier lui-même, ex. Sylvain qui traite ses tickets Nova).
      if (ticket.createdBy !== currentUser?.uid && (next === 'en_cours' || next === 'ferme')) {
        await notifyUser(
          ticket.createdBy,
          ticket,
          next === 'en_cours' ? '🔧 Votre ticket est en cours de traitement' : '✅ Votre ticket est résolu',
          next === 'en_cours'
            ? `"${ticket.title}" est passé en cours de traitement.`
            : `"${ticket.title}" a été marqué comme terminé.`,
          'support_ticket_status'
        );
      }
    } catch (e) {
      setError((e as Error).message || 'Impossible de changer le statut.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const advanceStatus = async (ticket: SupportTicket) => {
    const next: SupportStatus = ticket.status === 'ouvert' ? 'en_cours' : 'ferme';
    await setTicketStatus(ticket, next);
  };

  // Drag & drop entre colonnes du Kanban — même action que les boutons
  // "Passer en cours" / "Terminer" : on dépose la carte dans la colonne
  // cible et son statut est mis à jour en conséquence.
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<SupportStatus | null>(null);

  // Clôture directe sans passer par "En cours" — pour les tickets qui ne
  // nécessitent aucun correctif (faux positif, déjà bon, etc.), afin que
  // Nova ne se mette pas inutilement à travailler dessus.
  const markResolvedNoFix = async (ticket: SupportTicket) => {
    await setTicketStatus(ticket, 'ferme');
  };

  const toggleArchive = async (ticket: SupportTicket) => {
    setUpdatingStatus(true);
    try {
      const { error: err } = await supabase
        .from('support_tickets')
        .update({ archived_at: ticket.archivedAt ? null : new Date().toISOString() })
        .eq('id', ticket.id);
      if (err) throw err;
      await loadTickets();
      if (selectedTicketId === ticket.id) setSelectedTicketId(null);
    } catch (e) {
      setError((e as Error).message || "Impossible d'archiver ce ticket.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Ticket #111 : suppression définitive d'un ticket créé, si besoin.
  const deleteTicket = async (ticket: SupportTicket) => {
    if (!window.confirm(`Supprimer définitivement le ticket "${ticket.title}" ? Impossible à annuler.`)) return;
    setUpdatingStatus(true);
    try {
      await supabase.from('support_ticket_messages').delete().eq('ticket_id', ticket.id);
      const { error: err } = await supabase.from('support_tickets').delete().eq('id', ticket.id);
      if (err) throw err;
      if (selectedTicketId === ticket.id) setSelectedTicketId(null);
      await loadTickets();
    } catch (e) {
      setError((e as Error).message || 'Impossible de supprimer ce ticket.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const sendMessage = async () => {
    if ((!chatInput.trim() && chatFiles.length === 0) || !selectedTicket || !currentUser) return;
    setSendingMsg(true);
    try {
      // Upload des pièces jointes du chat vers le même bucket que la
      // création de ticket, pour pouvoir montrer une capture à Nova
      // directement dans l'échange (et pas seulement à l'ouverture).
      const attachmentUrls: string[] = [];
      for (const file of chatFiles) {
        const path = `${currentUser.uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: upErr } = await supabase.storage.from('support-attachments').upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('support-attachments').getPublicUrl(path);
        if (pub?.publicUrl) attachmentUrls.push(pub.publicUrl);
      }

      const { error: err } = await supabase.from('support_ticket_messages').insert({
        ticket_id: selectedTicket.id,
        sender_id: currentUser.uid,
        sender_name: userProfile?.displayName || currentUser.email,
        body: chatInput.trim(),
        attachments: attachmentUrls,
      });
      if (err) throw err;

      const sentBody = chatInput.trim();
      setChatInput('');
      setChatFiles([]);
      await loadMessages(selectedTicket.id);

      const amCreator = selectedTicket.createdBy === currentUser.uid;
      // Quand l'auteur du ticket (un utilisateur) répond dessus, seul
      // Sylvain est notifié — pas tous les admins (évite de spammer
      // Mélanie et les autres pour des tickets qui ne les concernent pas).
      // Si Sylvain répond sur son propre ticket (boucle Nova), personne
      // n'est notifié : il n'a pas besoin de se notifier lui-même.
      if (amCreator && !isAdmin) {
        await notifyUser(
          SYLVAIN_UID,
          selectedTicket,
          '💬 Nouveau message sur un ticket',
          `${userProfile?.displayName || currentUser.email} a répondu sur "${selectedTicket.title}" : ${sentBody.slice(0, 100)}`,
          'support_ticket_message'
        );
      } else if (!amCreator) {
        await notifyUser(
          selectedTicket.createdBy,
          selectedTicket,
          '💬 Réponse à votre ticket',
          `${userProfile?.displayName || currentUser.email} a répondu sur "${selectedTicket.title}" : ${sentBody.slice(0, 100)}`,
          'support_ticket_reply'
        );
      }
    } catch (e) {
      setError((e as Error).message || "Impossible d'envoyer le message.");
    } finally {
      setSendingMsg(false);
    }
  };

  // Les tickets archivés sont masqués de la vue courante (et inversement),
  // pour ne jamais les mélanger — comme demandé, "archiver" ≠ "supprimer" :
  // les tickets restent consultables via le bouton "Archivés".
  const visibleTickets = tickets.filter((t) => (showArchived ? !!t.archivedAt : !t.archivedAt));
  // Tickets où Nova a déjà répondu en premier dans chaque colonne, pour
  // repérer immédiatement ce qui attend une vérification de Sylvain.
  const ticketsByStatus = (status: SupportStatus) =>
    visibleTickets
      .filter((t) => t.status === status)
      .slice()
      .sort((a, b) => {
        const aReplied = novaRepliedTicketIds.has(a.id) ? 1 : 0;
        const bReplied = novaRepliedTicketIds.has(b.id) ? 1 : 0;
        return bReplied - aReplied;
      });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 text-white">
      {/* Signalé (30/08/2026, capture à l'appui) : "mets un fond car on ne
          voit pas les textes" — même correctif que les autres pages
          (Notes/Documents/Caméra/Agenda). */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#0a1e20]/95 border border-white/10 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-500/20 border border-slate-500/30 text-slate-300 flex items-center justify-center font-bold">
            <LifeBuoy className="w-5 h-5 text-[#F9C977]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Support</h1>
            <p className="text-xs text-gray-400">
              {showArchived
                ? 'Tickets archivés.'
                : isAdmin ? 'Tous les tickets — déplacez-les vers "En cours" puis "Terminé".' : 'Vos demandes d\'assistance et leur suivi.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isSylvain && (
            <a
              href="https://test.nova360.space"
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir la version Test pour vérifier les correctifs de Nova avant de valider"
              className="text-xs font-semibold px-3.5 py-2 rounded-xl border bg-purple-500/15 border-purple-500/30 text-purple-300 hover:bg-purple-500/25 flex items-center gap-1.5 transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Version Test
            </a>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#F7BC5F] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Ouvrir un ticket</span>
          </button>
          {/* Ticket #112 : dossier d'archive discret, tout à droite — plus
              une colonne ni un bouton texte au même niveau que les actions
              principales, juste une icône repliée qui bascule la vue. */}
          <button
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? 'Voir les tickets actifs' : 'Tickets archivés'}
            className={`p-2 rounded-xl border transition-all ${
              showArchived ? 'bg-[#F7BC5F]/15 border-[#F7BC5F]/40 text-[#F7BC5F]' : 'bg-white/5 border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/10'
            }`}
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Chargement des tickets...
        </div>
      ) : tickets.length === 0 ? (
        <div className="p-10 text-center rounded-3xl bg-white/5 border border-dashed border-white/10">
          <LifeBuoy className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-300">Aucun ticket pour le moment.</p>
        </div>
      ) : isAdmin ? (
        // Vue admin : 3 colonnes Nouveau / En cours / Terminé
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STATUS_COLUMNS.map((col) => (
            <div
              key={col.value}
              onDragOver={(e) => {
                if (!draggedTicketId) return;
                e.preventDefault();
                setDragOverColumn(col.value);
              }}
              onDragLeave={() => setDragOverColumn((c) => (c === col.value ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverColumn(null);
                const ticket = visibleTickets.find((t) => t.id === draggedTicketId);
                setDraggedTicketId(null);
                if (ticket) void setTicketStatus(ticket, col.value);
              }}
              className={`bg-[#0a1e20]/95 border rounded-2xl p-3 space-y-2 min-h-[200px] transition-colors ${
                dragOverColumn === col.value ? 'border-[#F7BC5F]/60 bg-[#F7BC5F]/20' : 'border-white/10'
              }`}
            >
              <div className="flex items-center justify-between px-1 pb-1">
                <h3 className="text-xs font-bold text-white">{col.label}</h3>
                <span className="text-[10px] text-gray-500">{ticketsByStatus(col.value).length}</span>
              </div>
              {ticketsByStatus(col.value).map((ticket) => {
                const pMeta = priorityMeta(ticket.priority);
                return (
                  <button
                    key={ticket.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggedTicketId(ticket.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDraggedTicketId(null);
                      setDragOverColumn(null);
                    }}
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={`relative w-full text-left p-3 rounded-xl bg-[#0b1719] border border-white/10 hover:border-[#F7BC5F]/40 transition-all cursor-grab active:cursor-grabbing ${
                      draggedTicketId === ticket.id ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${pMeta.classes}`}>
                        {pMeta.label}
                      </span>
                      <span className="text-[9px] text-gray-500">{categoryLabel(ticket.category)}</span>
                      {ticket.attachments.length > 0 && (
                        <span className="text-[9px] text-gray-500 flex items-center gap-0.5"><Paperclip className="w-2.5 h-2.5" />{ticket.attachments.length}</span>
                      )}
                      {!!messageCounts[ticket.id] && (
                        <span className="text-[9px] text-gray-500 flex items-center gap-0.5"><MessageCircle className="w-2.5 h-2.5" />{messageCounts[ticket.id]}</span>
                      )}
                    </div>
                    <h4 className="text-xs font-bold text-white">{ticket.title}</h4>
                    <p className="text-[10px] text-gray-500 mt-1">{ticket.createdByName || 'Utilisateur'}</p>

                    {col.value !== 'ferme' && (
                      <div
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void advanceStatus(ticket);
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[#F7BC5F] hover:underline"
                      >
                        {col.value === 'ouvert' ? 'Passer en cours' : 'Terminer'}
                        <ArrowRight className="w-3 h-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        // Vue utilisateur : liste simple de ses propres tickets
        <div className="space-y-3">
          {tickets.map((ticket) => {
            const pMeta = priorityMeta(ticket.priority);
            return (
              <button
                key={ticket.id}
                onClick={() => setSelectedTicketId(ticket.id)}
                className="w-full text-left p-4 bg-white/5 border border-white/10 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-[#F7BC5F]/40 transition-all"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      {statusLabel(ticket.status)}
                    </span>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${pMeta.classes}`}>{pMeta.label}</span>
                    <span className="text-[10px] text-gray-400">Ouvert le {new Date(ticket.createdAt).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <h3 className="font-bold text-white text-sm">{ticket.title}</h3>
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{ticket.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* CREATE TICKET MODAL */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-lg w-full p-6 text-white max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#F7BC5F]">Créer un ticket</h3>
              <button onClick={() => { setShowCreate(false); resetCreateForm(); }} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Titre</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Problème d'export PDF du mandat"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Catégorie</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as SupportCategory)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                  >
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} className="bg-[#0E1A20]">{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Sévérité</label>
                  <div className="flex gap-1.5">
                    {PRIORITY_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setPriority(o.value)}
                        className={`flex-1 text-[10px] font-bold px-2 py-2 rounded-lg border transition-all ${
                          priority === o.value ? o.classes : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Description / commentaire</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Décrivez l'anomalie rencontrée..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" /> Images (facultatif)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="w-full text-xs text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
                />
                {files.length > 0 && (
                  <p className="text-[10px] text-gray-500 mt-1">{files.length} image(s) sélectionnée(s)</p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); resetCreateForm(); }}
                  disabled={creating}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 text-xs font-bold text-black bg-[#F7BC5F] rounded-xl flex items-center gap-2 disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {creating ? 'Envoi...' : 'Créer le ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TICKET DETAIL + CHAT MODAL */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col text-white">
            <div className="p-5 border-b border-white/10 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    {statusLabel(selectedTicket.status)}
                  </span>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${priorityMeta(selectedTicket.priority).classes}`}>
                    {priorityMeta(selectedTicket.priority).label}
                  </span>
                  <span className="text-[10px] text-gray-500">{categoryLabel(selectedTicket.category)}</span>
                </div>
                <h3 className="text-base font-bold text-white truncate">{selectedTicket.title}</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {selectedTicket.createdByName || 'Utilisateur'} • {new Date(selectedTicket.createdAt).toLocaleString('fr-FR')}
                </p>
              </div>
              <button onClick={() => setSelectedTicketId(null)} className="text-gray-400 hover:text-white shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
              <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{selectedTicket.description}</p>

              {selectedTicket.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedTicket.attachments.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPreviewImageUrl(url)}
                      className="block w-20 h-20 rounded-lg overflow-hidden border border-white/10 hover:border-[#F7BC5F]/40 cursor-pointer"
                    >
                      <img src={url} alt={`Pièce jointe ${i + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {isAdmin && selectedTicket.status !== 'ferme' && (
                  <button
                    onClick={() => void advanceStatus(selectedTicket)}
                    disabled={updatingStatus}
                    className="text-xs font-bold px-3 py-2 rounded-lg bg-[#F7BC5F]/15 text-[#F7BC5F] border border-[#F7BC5F]/30 hover:bg-[#F7BC5F]/25 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {selectedTicket.status === 'ouvert' ? <ArrowRight className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {selectedTicket.status === 'ouvert' ? 'Passer en cours' : 'Marquer comme terminé'}
                  </button>
                )}

                {/* Clôture directe, sans passer par "En cours" — pour les
                    tickets sans correctif nécessaire (RAS, faux positif),
                    afin que Nova ne travaille pas dessus pour rien. */}
                {isAdmin && selectedTicket.status !== 'ferme' && (
                  <button
                    onClick={() => void markResolvedNoFix(selectedTicket)}
                    disabled={updatingStatus}
                    title="Aucun correctif nécessaire : clôture directe, sans passer par Nova"
                    className="text-xs font-bold px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Terminé (RAS)
                  </button>
                )}

                {isAdmin && (
                  <button
                    onClick={() => void toggleArchive(selectedTicket)}
                    disabled={updatingStatus}
                    className="text-xs font-bold px-3 py-2 rounded-lg bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {selectedTicket.archivedAt ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                    {selectedTicket.archivedAt ? 'Désarchiver' : 'Archiver'}
                  </button>
                )}

                {/* Ticket #111 : suppression définitive, ouverte à l'admin et
                    à l'auteur du ticket (pas seulement au super admin). */}
                {(isAdmin || selectedTicket.createdBy === currentUser?.uid) && (
                  <button
                    onClick={() => void deleteTicket(selectedTicket)}
                    disabled={updatingStatus}
                    title="Supprimer définitivement ce ticket"
                    className="text-xs font-bold px-3 py-2 rounded-lg bg-rose-900/20 text-rose-300 border border-rose-500/30 hover:bg-rose-900/35 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Supprimer
                  </button>
                )}

                {/* Boucle Support ↔ Nova : réservée à Sylvain, uniquement
                    pendant qu'un ticket est "En cours" (c'est ce statut qui
                    sert de signal — Nova le surveille activement). */}
                {isSylvain && selectedTicket.status === 'en_cours' && (
                  <>
                    <a
                      href="https://test.nova360.space"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold px-3 py-2 rounded-lg bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Ouvrir version Test
                    </a>
                    <button
                      onClick={() => void handleValidateAndDeploy(selectedTicket)}
                      disabled={deployRequestState === 'sending'}
                      className={`text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 border transition-all disabled:opacity-60 ${
                        deployRequestState === 'sent'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25'
                      }`}
                    >
                      <Rocket className={`w-3.5 h-3.5 ${deployRequestState === 'sending' ? 'animate-pulse' : ''}`} />
                      {deployRequestState === 'sent' ? 'Demande envoyée !' : deployRequestState === 'sending' ? 'Envoi...' : 'Valider et déployer'}
                    </button>
                  </>
                )}
              </div>

              <div className="pt-3 border-t border-white/10">
                <h4 className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5" /> Échange
                </h4>
                {chatLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement...</div>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-gray-500">Aucun message pour le moment.</p>
                ) : (
                  <div className="space-y-2.5">
                    {messages.map((m) => {
                      const isMine = m.senderId === currentUser?.uid;
                      return (
                        <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-xl px-3 py-2 ${isMine ? 'bg-[#F7BC5F]/15 border border-[#F7BC5F]/30' : 'bg-white/5 border border-white/10'}`}>
                            <p className="text-[10px] font-bold text-gray-400 mb-0.5">{m.senderName}</p>
                            {m.body && <p className="text-xs text-gray-200 whitespace-pre-wrap">{m.body}</p>}
                            {m.attachments.length > 0 && (
                              <div className="flex gap-1.5 flex-wrap mt-1.5">
                                {m.attachments.map((url, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => setPreviewImageUrl(url)}
                                    className="block w-16 h-16 rounded-lg overflow-hidden border border-white/10 hover:border-[#F7BC5F]/40"
                                  >
                                    <img src={url} alt={`Pièce jointe ${i + 1}`} className="w-full h-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1 mt-1">
                              <p className="text-[9px] text-gray-600">{new Date(m.createdAt).toLocaleString('fr-FR')}</p>
                              {isMine && (
                                m.readBy.some((r) => r.userId !== currentUser?.uid) ? (
                                  <CheckCheck className="w-3 h-3 text-[#F7BC5F]" aria-label="Lu" />
                                ) : (
                                  <Check className="w-3 h-3 text-gray-600" aria-label="Envoyé" />
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-white/10 shrink-0 space-y-2">
              {chatFiles.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {chatFiles.map((f, i) => (
                    <span key={i} className="text-[10px] bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-gray-300 flex items-center gap-1.5">
                      <Paperclip className="w-3 h-3" />
                      {f.name}
                      <button type="button" onClick={() => setChatFiles((cur) => cur.filter((_, j) => j !== i))} className="text-gray-500 hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 flex items-center justify-center shrink-0 cursor-pointer">
                  <Paperclip className="w-4 h-4" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => setChatFiles((cur) => [...cur, ...Array.from(e.target.files || [])])}
                  />
                </label>
                {/* Même méthodologie que les autres chats du CRM (23
                    septembre) : Entrée ne fait que revenir à la ligne,
                    seul le bouton d'envoi envoie — <textarea> au lieu
                    d'un <input>, qui ne pouvait pas contenir de retour à
                    la ligne. */}
                <textarea
                  ref={chatTextareaRef}
                  rows={1}
                  placeholder="Écrire un message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="flex-1 resize-none bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white leading-relaxed focus:outline-none focus:border-[#F7BC5F]/60"
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={sendingMsg || (!chatInput.trim() && chatFiles.length === 0)}
                  className="w-10 h-10 rounded-xl bg-[#F7BC5F] text-black flex items-center justify-center disabled:opacity-50 shrink-0"
                >
                  {sendingMsg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewImageUrl && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-[60] flex items-center justify-center p-6"
          onClick={() => setPreviewImageUrl(null)}
        >
          <button
            onClick={() => setPreviewImageUrl(null)}
            className="absolute right-6 text-white/70 hover:text-white p-2 rounded-lg hover:bg-white/10 z-10" style={{ top: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImageUrl}
            alt="Aperçu"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
export default SupportView;
