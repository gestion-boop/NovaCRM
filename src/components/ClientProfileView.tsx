import React, { useState, useEffect } from 'react';
import { AGENCIES, NoteItem, DocItem, Task } from '@/types';
import { ChevronLeft, Plus, Mail, Phone, Calendar, User, UserCheck, Pencil, Trash2, CheckCircle, Circle, FileEdit, Save, Clock, Check, Mic, MicOff, Square, Pin, GripVertical, MessageSquare, X, FileText, Upload, Download, Folder, Eye, Lock } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import TaskModal from './TaskModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useContacts, matchesAgency } from '@/hooks/useContacts';
import { useDeals } from '@/hooks/useDeals';
import { useTasks } from '@/hooks/useTasks';
import { useAuth } from '@/context/AuthContext';
import { getTaskDateStatus } from '@/lib/taskUtils';
import { getImportedStorage, saveImportedStorage } from '@/utils/importedDataManager';
import { TEAM_MEMBERS, getAssignedUser } from '@/data/teamMembers';

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

export default function ClientProfileView({
  clientId,
  onBack,
}: {
  clientId: string;
  onBack: () => void;
}) {
  const { currentUser } = useAuth();
  const currentUserEmail = (currentUser?.email || 's.grazia@conseilfinances.fr').toLowerCase().trim();
  const currentUserId = (currentUser?.uid || currentUserEmail).toLowerCase().trim();
  const currentUserName = currentUser?.displayName || currentUserEmail.split('@')[0];

  const [activeTab, setActiveTab] = useState<'rdv' | 'notes' | 'emails' | 'documents'>('rdv');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const { contacts = [], updateContact } = useContacts();
  const { deals = [] } = useDeals();
  const { tasks, addTask, updateTask, deleteTask } = useTasks();

  const client = contacts.find(c => c.id === clientId);
  const clientDeals = deals.filter(d => d.contactId === clientId);
  const activeDeal = clientDeals[0]; 

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
  const [clientNotes, setClientNotes] = useState<NoteItem[]>([]);
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('Suivi Client');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);

  // Documents tab states
  const [clientDocs, setClientDocs] = useState<DocItem[]>([]);
  const [showDocModal, setShowDocModal] = useState(false);
  const [docName, setDocName] = useState('');
  const [docCategory, setDocCategory] = useState('Pièce d\'identité');
  const [docFile, setDocFile] = useState<File | null>(null);

  useEffect(() => {
    if (client?.comments !== undefined) {
      setContactComments(client.comments || '');
    }
  }, [client?.comments]);

  const loadClientNotes = () => {
    if (!client) return;
    const imported = getImportedStorage().notes || [];
    const clientNameLower = client.name.toLowerCase();
    
    const filtered = imported.filter(n => 
      n.contactId === client.id ||
      (n.contactName && n.contactName.toLowerCase() === clientNameLower) ||
      (n.title && n.title.toLowerCase().includes(clientNameLower)) ||
      (n.content && n.content.toLowerCase().includes(clientNameLower))
    );

    // Cloisonnement per user for Notes
    const isMyNote = (n: NoteItem) => {
      if (!n.createdBy && !n.authorEmail) return true;
      const creator = (n.createdBy || n.authorEmail || '').toLowerCase().trim();
      return creator === currentUserEmail || creator === currentUserId;
    };

    const myNotes = filtered.filter(isMyNote);

    // Sort pinned notes first, then order or date
    myNotes.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    setClientNotes(myNotes);
  };

  const loadClientDocs = () => {
    if (!client) return;
    try {
      const stored = localStorage.getItem('novasphere_client_docs_v1');
      const docs: DocItem[] = stored ? JSON.parse(stored) : [];
      const filtered = docs.filter(d => d.contactId === client.id);
      
      // Cloisonnement per user for Documents
      const myDocs = filtered.filter(d => {
        if (!d.uploadedBy) return true;
        const u = d.uploadedBy.toLowerCase().trim();
        return u === currentUserEmail || u === currentUserId || (currentUserName && u.includes(currentUserName.toLowerCase()));
      });
      setClientDocs(myDocs);
    } catch (e) {
      console.warn('Error loading client docs', e);
    }
  };

  useEffect(() => {
    loadClientNotes();
    loadClientDocs();
    const handleStorageChange = () => {
      loadClientNotes();
      loadClientDocs();
    };
    window.addEventListener('crm_imported_data_changed', handleStorageChange);
    return () => window.removeEventListener('crm_imported_data_changed', handleStorageChange);
  }, [clientId, client?.name, currentUserEmail]);

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

  const handleOpenEditNote = (note: NoteItem) => {
    setEditingNoteId(note.id);
    setNoteTitle(note.title);
    setNoteCategory(note.category || 'Suivi Client');
    setNoteContent(note.content);
    setShowNewNoteModal(true);
  };

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;
    const finalTitle = noteTitle.trim() || 'Note du ' + new Date().toLocaleDateString('fr-FR');

    const currentImported = getImportedStorage().notes || [];

    if (editingNoteId) {
      const updatedImported = currentImported.map(n => {
        if (n.id === editingNoteId) {
          return {
            ...n,
            title: finalTitle,
            content: noteContent,
            category: noteCategory,
            updatedAt: new Date().toISOString().split('T')[0],
          };
        }
        return n;
      });
      saveImportedStorage({ notes: updatedImported });
      setClientNotes(prev => prev.map(n => n.id === editingNoteId ? {
        ...n,
        title: finalTitle,
        content: noteContent,
        category: noteCategory,
        updatedAt: new Date().toISOString().split('T')[0],
      } : n));
    } else {
      const newN: NoteItem = {
        id: 'note-' + Date.now(),
        title: finalTitle,
        content: noteContent,
        category: noteCategory,
        updatedAt: new Date().toISOString().split('T')[0],
        agencyId: client.agencyId,
        contactId: client.id,
        contactName: client.name,
        isPinned: false,
        order: clientNotes.length,
        createdBy: currentUserEmail,
        authorEmail: currentUserEmail,
      };
      const currentNotes = getImportedStorage().notes;
      saveImportedStorage({ notes: [...currentNotes, newN] });
      setClientNotes(prev => [newN, ...prev]);
    }

    setNoteTitle('');
    setNoteContent('');
    setEditingNoteId(null);
    setShowNewNoteModal(false);
  };

  const handleAddDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !docName.trim()) return;

    const newDoc: DocItem = {
      id: 'doc-' + Date.now(),
      name: docName.trim(),
      category: docCategory,
      size: docFile ? `${(docFile.size / 1024).toFixed(0)} KB` : '145 KB',
      updatedAt: new Date().toISOString().split('T')[0],
      uploadedBy: currentUserEmail,
      contactId: client.id,
      agencyId: client.agencyId,
      url: docFile ? URL.createObjectURL(docFile) : undefined
    };

    try {
      const stored = localStorage.getItem('novasphere_client_docs_v1');
      const docs: DocItem[] = stored ? JSON.parse(stored) : [];
      const updated = [newDoc, ...docs];
      localStorage.setItem('novasphere_client_docs_v1', JSON.stringify(updated));
      setClientDocs(prev => [newDoc, ...prev]);
    } catch (err) {
      console.error('Error saving document', err);
    }

    setDocName('');
    setDocFile(null);
    setShowDocModal(false);
  };

  const handleDeleteDoc = (docId: string) => {
    try {
      const stored = localStorage.getItem('novasphere_client_docs_v1');
      const docs: DocItem[] = stored ? JSON.parse(stored) : [];
      const updated = docs.filter(d => d.id !== docId);
      localStorage.setItem('novasphere_client_docs_v1', JSON.stringify(updated));
      setClientDocs(prev => prev.filter(d => d.id !== docId));
    } catch (err) {
      console.error('Error deleting document', err);
    }
  };

  const handleTogglePinNote = (noteId: string) => {
    const currentImported = getImportedStorage().notes || [];
    const updatedImported = currentImported.map(n => {
      if (n.id === noteId) {
        return { ...n, isPinned: !n.isPinned };
      }
      return n;
    });
    saveImportedStorage({ notes: updatedImported });
    setClientNotes(prev => {
      const updated = prev.map(n => n.id === noteId ? { ...n, isPinned: !n.isPinned } : n);
      updated.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return 0;
      });
      return updated;
    });
  };

  const handleDragEndNotes = (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(clientNotes);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    const updatedWithOrder = items.map((item, idx) => ({ ...item, order: idx }));
    setClientNotes(updatedWithOrder);

    const currentImported = getImportedStorage().notes || [];
    const map = new Map(currentImported.map(n => [n.id, n]));
    updatedWithOrder.forEach(n => map.set(n.id, n));
    saveImportedStorage({ notes: Array.from(map.values()) });
  };

  const toggleDictation = () => {
    const SpeechRecognitionApi = (window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition || 
                                 (window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;
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

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            currentTranscript += event.results[i][0].transcript + ' ';
          }
        }
        if (currentTranscript) {
          setNoteContent(prev => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed} ${currentTranscript.trim()}` : currentTranscript.trim();
          });
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
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

  const handleDeleteNote = (noteId: string) => {
    const currentImported = getImportedStorage().notes;
    const updated = currentImported.filter(n => n.id !== noteId);
    saveImportedStorage({ notes: updated });
    setClientNotes(prev => prev.filter(n => n.id !== noteId));
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
  };

  if (!client) return (
    <div className="p-8 text-white">Client introuvable <button onClick={onBack} className="ml-4 underline text-amber-500">Retour</button></div>
  );

  const agency = AGENCIES.find(a => a.id === client.agencyId);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#051416] animate-fade-in relative">
      {/* Top Header & Pipeline Visual */}
      <div className="bg-[#07191b] border-b border-[#144447]/60 p-6 flex flex-col gap-6 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 rounded-xl bg-black/40 hover:bg-black/60 border border-[#144447]/60 text-slate-300 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">{client.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 text-xs font-bold">
                  {client.status}
                </span>
                <span className="text-sm text-slate-400">
                  Créé le {new Date(client.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
          <button className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg hover:scale-[1.02] transition-all">
            <Plus className="w-4 h-4 stroke-[3]" />
            Actions
          </button>
        </div>

        {/* Visual Pipeline Header */}
        <div className="bg-[#0a1e20] rounded-xl border border-[#144447]/60 p-4 pb-8 flex items-center justify-between relative shadow-inner">
          <div className="absolute top-4 left-4 text-xs font-bold text-slate-400 flex items-center gap-2">
            Pipeline : 
            <select className="bg-transparent text-white border border-[#144447] rounded px-2 py-1 focus:outline-none">
              <option>Pipeline {agency?.name}</option>
            </select>
          </div>
          
          <div className="w-full flex items-center justify-between mt-8 relative px-12">
            <div className="absolute top-1/2 left-12 right-12 h-0.5 bg-[#144447]/40 -translate-y-1/2 z-0" />
            
            {STAGES.map((stage, index) => {
              const isActive = activeDeal?.stage === stage;
              const isPast = activeDeal ? STAGES.indexOf(activeDeal.stage) > index : false;
              
              return (
                <div key={stage} className="relative z-10 flex flex-col items-center gap-2 group">
                  <div className={`w-5 h-5 rounded-full border-4 flex items-center justify-center transition-all ${
                    isActive ? 'border-amber-500 bg-amber-500 w-6 h-6 shadow-[0_0_10px_rgba(245,158,11,0.5)]' :
                    isPast ? 'border-amber-500 bg-[#0a1e20]' : 'border-[#144447]/80 bg-[#0a1e20]'
                  }`}>
                    {isPast && <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />}
                  </div>
                  <span className={`absolute top-8 text-[9px] font-bold tracking-wider whitespace-nowrap text-center ${
                    isActive ? 'text-amber-500' : 'text-slate-500 group-hover:text-slate-300'
                  }`}>
                    {stage}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-y-auto custom-scrollbar">
        {/* Left Column - Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Card */}
          <div className="bg-[#07191b] border border-[#144447]/60 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
            
            <div className="flex items-start gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-amber-500 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg">
                {client.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-white leading-tight">{client.name}</h2>
                <div className="flex gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 text-[10px] font-bold">Chaud</span>
                  <span className="px-2 py-0.5 rounded-md border border-amber-500/40 text-amber-500 text-[10px] font-bold">{client.type}</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#143c3f]/50">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Montant Estimé</span>
              <div className="text-3xl font-black text-amber-500 mt-1">
                {activeDeal ? formatCurrency(activeDeal.amount) : '0 €'}
              </div>
            </div>

            <div className="pt-4 border-t border-[#143c3f]/50 space-y-4">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Coordonnées</span>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <div className="w-8 h-8 rounded-full bg-[#143c3f]/40 flex items-center justify-center text-amber-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  {client.email}
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <div className="w-8 h-8 rounded-full bg-[#143c3f]/40 flex items-center justify-center text-amber-500">
                    <Phone className="w-4 h-4" />
                  </div>
                  {client.phone}
                </div>
                {client.type && (
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    <div className="w-8 h-8 rounded-full bg-[#143c3f]/40 flex items-center justify-center text-amber-500">
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
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {AGENCIES.filter(a => a.id !== 'all').map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-slate-400 mb-1">Utilisateur / Agent Lié</label>
                  <select
                    value={getAssignedUser(client.assignedTo).id}
                    onChange={(e) => updateContact.mutateAsync({ id: client.id, updates: { assignedTo: e.target.value } })}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {TEAM_MEMBERS.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {(client.revenus || client.apport || client.projectType) ? (
              <div className="pt-4 border-t border-[#143c3f]/50 space-y-2">
                <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Données Patrimoniales</span>
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
                      <span className="font-bold text-amber-400">{client.projectType}</span>
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
        <div className="lg:col-span-2 bg-[#07191b] border border-[#144447]/60 rounded-2xl flex flex-col shadow-md overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-[#144447]/60 bg-black/20">
            {[
              { id: 'rdv', label: 'RDV/Tâches' },
              { id: 'notes', label: 'Notes' },
              { id: 'emails', label: 'Emails' },
              { id: 'documents', label: 'Documents' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'rdv' | 'notes' | 'emails' | 'documents')}
                className={`px-8 py-4 text-sm font-bold transition-all border-b-2 ${
                  activeTab === tab.id 
                    ? 'border-amber-500 text-amber-500 bg-amber-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
            {activeTab === 'rdv' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-white">RDV/Tâches</h2>
                    <p className="text-xs text-slate-400">Tous les rendez-vous et tâches pour ce client</p>
                  </div>
                  <button 
                    onClick={() => setShowTaskModal(true)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg transition-transform hover:scale-105"
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
                              dateStatus.color === 'orange' ? 'border-l-amber-500' :
                              'border-l-emerald-500';

                            return (
                              <Draggable key={task.id} draggableId={task.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={`p-4 rounded-2xl bg-[#0a1e20] border-l-4 ${borderLeftClass} border-t border-r border-b border-[#144447]/40 flex items-start justify-between gap-4 group hover:bg-[#143c3f]/20 transition-all ${snapshot.isDragging ? 'shadow-2xl opacity-90 scale-[1.02] border-amber-500/50 z-50 bg-[#0c2628]' : 'shadow-sm'}`}
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
                                        className="mt-0.5 cursor-pointer text-slate-400 hover:text-amber-500 transition-colors"
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
                                      <button className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-black/40">
                                        <Pencil className="w-4 h-4" />
                                      </button>
                                      <button 
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
            
            {activeTab === 'notes' && (
              <div className="space-y-6 animate-fade-in">
                {/* Section 1: Main contact notes / comments */}
                <div className="p-5 rounded-2xl bg-[#07191b] border border-[#144447] space-y-3 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileEdit className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">Note générale & Remarques du client</h3>
                    </div>
                    <button
                      onClick={handleSaveComments}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
                    >
                      {savedCommentsSuccess ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                          <span>Enregistré !</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>Enregistrer les remarques</span>
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={contactComments}
                    onChange={(e) => setContactComments(e.target.value)}
                    placeholder="Saisissez ici les éléments clés du client, situation patrimoniale, souhaits particuliers ou remarques d'entretien..."
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-3 text-xs text-white focus:outline-none focus:border-amber-500 placeholder-slate-600 resize-none leading-relaxed"
                  />
                </div>

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
                            className="grid grid-cols-1 md:grid-cols-2 gap-4"
                          >
                            {clientNotes.map((n, index) => (
                              <Draggable key={n.id} draggableId={n.id} index={index}>
                                {(providedDrag, snapshot) => (
                                  <div
                                    ref={providedDrag.innerRef}
                                    {...providedDrag.draggableProps}
                                    className={`p-4 rounded-2xl bg-[#07191b] border ${n.isPinned ? 'border-amber-500/70 bg-[#0b2427]' : 'border-[#144447]'} space-y-2 relative group hover:border-[#226368] transition-all shadow-md ${snapshot.isDragging ? 'shadow-2xl scale-[1.02] z-50 border-amber-400 bg-[#0d2a2d]' : ''}`}
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

                                        <span className="text-[10px] font-bold text-[#E5B842] bg-[#E5B842]/10 px-2.5 py-0.5 rounded-full border border-[#E5B842]/20">
                                          {n.category || 'Suivi Client'}
                                        </span>

                                        {n.isPinned && (
                                          <span className="text-[10px] font-extrabold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/30 flex items-center gap-1">
                                            <Pin className="w-3 h-3 fill-amber-400 text-amber-400" />
                                            Épinglé
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-slate-400 flex items-center gap-1 mr-1">
                                          <Clock className="w-3 h-3" />
                                          {n.updatedAt}
                                        </span>

                                        {/* Pin button */}
                                        <button
                                          onClick={() => handleTogglePinNote(n.id)}
                                          className={`p-1.5 rounded-lg transition-colors ${n.isPinned ? 'text-amber-400 hover:bg-amber-400/10' : 'text-slate-500 hover:text-amber-400 hover:bg-white/5'}`}
                                          title={n.isPinned ? "Désépingler" : "Épingler en haut"}
                                        >
                                          <Pin className={`w-3.5 h-3.5 ${n.isPinned ? 'fill-amber-400' : ''}`} />
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
            {showNewNoteModal && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                <div className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-lg w-full p-6 text-white shadow-2xl relative animate-scale-up">
                  {/* Modal Header */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-amber-400">
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
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">Catégorie</label>
                        <input
                          type="text"
                          value={noteCategory}
                          onChange={(e) => setNoteCategory(e.target.value)}
                          placeholder="ex: Entretien, Banque"
                          className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500 transition-colors"
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
                        className="w-full bg-[#030d0f] border border-[#1d575b] rounded-xl p-3.5 text-xs text-white focus:outline-none focus:border-amber-500 resize-none leading-relaxed shadow-inner"
                      />
                    </div>

                    {/* Footer Buttons */}
                    <div className="flex items-center justify-end gap-3 pt-2">
                      {/* Dictation Button */}
                      {!isListening ? (
                        <button
                          type="button"
                          onClick={toggleDictation}
                          className="px-4 py-2.5 rounded-xl bg-[#0a2326] border border-[#184c50] hover:bg-[#113236] text-white font-semibold text-xs flex items-center gap-2 shadow-md transition-all cursor-pointer"
                        >
                          <Mic className="w-4 h-4 text-amber-400" />
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
                        className="px-5 py-2.5 rounded-xl bg-[#cba135] hover:bg-[#b88f2d] text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer"
                      >
                        <Save className="w-4 h-4" />
                        <span>Sauvegarder</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            {activeTab === 'emails' && <div className="text-slate-400 p-4 text-center">Aucun email lié</div>}
            {activeTab === 'documents' && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex justify-between items-center bg-[#0a1e20] p-4 rounded-2xl border border-[#144447]/60">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
                      <Folder className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        Documents du client
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Espace Cloisonné
                        </span>
                      </h2>
                      <p className="text-xs text-slate-400">
                        Espace sécurisé personnel ({clientDocs.length} document(s)). Seul votre compte a accès à ces documents.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowDocModal(true)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 shadow-lg transition-transform hover:scale-105 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 stroke-[3]" />
                    Ajouter un document
                  </button>
                </div>

                {clientDocs.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 border border-dashed border-[#144447]/60 rounded-2xl bg-[#07191b] flex flex-col items-center justify-center gap-2">
                    <FileText className="w-8 h-8 text-slate-600" />
                    <span className="text-xs">Aucun document importé pour ce client. Cliquez sur "Ajouter un document" pour joindre une pièce.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {clientDocs.map((doc) => (
                      <div key={doc.id} className="p-4 rounded-2xl bg-[#0a1e20] border border-[#144447]/60 hover:border-[#1d5c60] transition-all flex items-start justify-between gap-3 group shadow-md">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#143c3f] border border-[#1d5c60] flex items-center justify-center text-amber-400 shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-md border border-teal-400/20">
                              {doc.category || 'Général'}
                            </span>
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
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                              title="Consulter"
                            >
                              <Eye className="w-4 h-4" />
                            </a>
                          ) : null}
                          <button
                            onClick={() => handleDeleteDoc(doc.id)}
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

                {showDocModal && (
                  <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-md w-full p-6 text-white shadow-2xl relative animate-scale-up">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-amber-400">
                            <Upload className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-white">Ajouter un document</h3>
                            <p className="text-xs text-slate-400">Espace strictement cloisonné à votre compte</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowDocModal(false)}
                          className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <form onSubmit={handleAddDoc} className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-300 mb-1">Nom du document</label>
                          <input
                            type="text"
                            required
                            placeholder="ex: Pièce d'identité / Compromis de vente"
                            value={docName}
                            onChange={(e) => setDocName(e.target.value)}
                            className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-300 mb-1">Catégorie</label>
                          <select
                            value={docCategory}
                            onChange={(e) => setDocCategory(e.target.value)}
                            className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
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
                          <label className="block text-xs font-bold text-slate-300 mb-1">Fichier (PDF, Image, Word)</label>
                          <input
                            type="file"
                            onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                            className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2 text-xs text-slate-300 focus:outline-none file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#143c3f] file:text-amber-400 hover:file:bg-[#1a5155]"
                          />
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => setShowDocModal(false)}
                            className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg cursor-pointer"
                          >
                            Enregistrer le document
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showTaskModal && (
        <TaskModal
          onClose={() => setShowTaskModal(false)}
          onAddTask={(t) => addTask.mutateAsync(t)}
          contacts={contacts || []}
          defaultContactId={clientId}
          allTasks={tasks || []}
        />
      )}
    </div>
  );
}
