import React, { useEffect, useRef, useState } from 'react';
import {
  LogOut, Loader2, Send, Mic, Lock, ChevronDown, CheckCircle2, Check, CheckCheck,
  Paperclip, Smile, X, Pencil, Trash2, Square, Image as ImageIcon, FileText, MoreVertical,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useLeadChat, LeadMessage } from '@/hooks/useLeadChat';
import { toast } from 'sonner';

// Ticket "Espace Client" (refonte) : demande explicite — un espace
// "classique" façon Messenger, on atterrit DIRECTEMENT dans le chat (plus
// d'écran d'accueil intermédiaire, plus d'onglets "Documents"/"Demandes"
// séparés). L'envoi d'un document se fait DEPUIS le composer, comme une
// pièce jointe. Connexion déjà gérée par le lien magique / mot de passe /
// Google (AuthContext) — ce composant reste toujours isolé du reste du CRM
// (aucun Sidebar, aucune navigation vers pipeline/équipe/paramètres...).

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🙏', '😮', '👌', '🎉', '😢'];
const MAX_ATTACHMENT_BYTES = 4.5 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface GuestContext {
  leadId: string;
  leadName: string;
  agencyId: string;
  agencyName: string;
  advisorId: string | null;
  advisorName: string | null;
  advisorPhoto: string | null;
}

const ClientGuestShell: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const [context, setContext] = useState<GuestContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const { messages, send: sendMessage, update: updateMessage, remove: removeMessage, markRead } = useLeadChat(context?.leadId || null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Demande explicite : "NovaCRM Espace Client" comme identité propre à
  // l'Espace Client (login ET chat), distincte de "Nova CRM" (interface
  // équipe, App.tsx) — cet écran est monté comme enfant d'App, dont l'effet
  // de titre a été adapté pour ne jamais écraser celui-ci sur /espace-client.
  useEffect(() => {
    document.title = 'NovaCRM Espace Client';
  }, []);

  // Accusé de lecture : marque automatiquement les messages du conseiller
  // comme lus dès qu'ils sont affichés au client.
  useEffect(() => {
    if (!currentUser) return;
    messages.filter((m) => m.userId !== currentUser.uid && !m.readAt && !m.deletedAt).forEach((m) => markRead.mutate(m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, currentUser?.uid]);

  // Ticket "Clients invités" (9/13) : dictée vocale — dépose le texte
  // reconnu dans le champ, jamais d'envoi automatique.
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggleDictation = () => {
    const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      toast.error("La reconnaissance vocale n'est pas disponible sur ce navigateur.");
      return;
    }
    if (isListening) {
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { /* noop */ } }
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
          if (event.results[i].isFinal) currentTranscript += event.results[i][0].transcript + ' ';
        }
        if (currentTranscript) {
          setDraft((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed} ${currentTranscript.trim()}` : currentTranscript.trim();
          });
        }
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  // Message vocal RÉEL (enregistrement audio envoyé tel quel — distinct de
  // la dictée ci-dessus, qui convertit la voix en texte).
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(100);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      toast.error('Micro indisponible ou refusé.');
    }
  };

  const stopRecording = async (cancel = false) => {
    const recorder = mediaRecorderRef.current;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    const duration = recordingSeconds;
    setIsRecording(false);
    setRecordingSeconds(0);
    if (!recorder || recorder.state === 'inactive') return;

    if (cancel) {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
      audioChunksRef.current = [];
      return;
    }

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        toast.error('Message vocal trop long (4,5 Mo maximum).');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        if (!currentUser) return;
        setUploading(true);
        try {
          await sendMessage.mutateAsync({ userId: currentUser.uid, kind: 'voice', attachmentUrl: dataUrl, attachmentMime: recorder.mimeType || 'audio/webm', attachmentDuration: duration });
          notifyAdvisor('🎤 Message vocal');
        } catch (err: any) {
          toast.error(err?.message || "Impossible d'envoyer ce message vocal.");
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  };

  async function notifyAdvisor(preview: string) {
    if (!context?.advisorId) return;
    // Signalé : "l'utilisateur assigné ne reçoit pas de notification" — un
    // INSERT direct dans `notifications` s'est révélé peu fiable pour une
    // session client_guest (policy RLS imbriquée, échec intermittent malgré
    // des droits corrects — voir migrations 20260826220000/221000). On
    // passe par une RPC dédiée (SECURITY DEFINER, même mécanisme que
    // `create_notification` utilisée partout ailleurs dans le CRM), qui
    // résout elle-même le conseiller assigné côté serveur — le client ne
    // peut donc jamais notifier personne d'autre que son propre conseiller.
    const { error } = await supabase.rpc('client_guest_notify_advisor' as any, {
      p_title: `💬 Message de ${context.leadName || 'votre client'}`,
      p_body: preview,
      p_link: `/clients/${context.leadId}`,
      p_entity_type: 'lead',
      p_entity_id: context.leadId,
    } as any);
    if (error) console.warn('Notification conseiller impossible :', error);
  }

  const sendText = async () => {
    if (!draft.trim() || !currentUser || !context || sending) return;
    setSending(true);
    const body = draft.trim();
    try {
      await sendMessage.mutateAsync({ userId: currentUser.uid, kind: 'text', body });
      setDraft('');
      void notifyAdvisor(body.length > 140 ? `${body.slice(0, 140)}…` : body);
    } finally {
      setSending(false);
    }
  };

  const sendAttachment = async (file: File, kind: 'image' | 'file') => {
    if (!currentUser || !context) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error('Fichier trop volumineux (4,5 Mo maximum).');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      await sendMessage.mutateAsync({
        userId: currentUser.uid, kind, attachmentUrl: dataUrl, attachmentMime: file.type || 'application/octet-stream',
        body: kind === 'file' ? file.name : undefined,
      });
      void notifyAdvisor(kind === 'image' ? '📷 Photo' : `📎 ${file.name}`);
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'envoyer ce fichier.");
    } finally {
      setUploading(false);
    }
  };

  function insertEmoji(emoji: string) {
    setDraft((prev) => prev + emoji);
    setShowEmojiPicker(false);
  }

  async function startEditing(m: LeadMessage) {
    setOpenMessageMenuId(null);
    setEditingId(m.id);
    setEditingText(m.body || '');
  }

  async function saveEdit() {
    if (!editingId || !editingText.trim()) return;
    try {
      await updateMessage.mutateAsync({ id: editingId, body: editingText.trim() });
      setEditingId(null);
      setEditingText('');
    } catch (err: any) {
      toast.error(err?.message || "Impossible de modifier ce message.");
    }
  }

  async function deleteMessage(id: string) {
    setOpenMessageMenuId(null);
    try {
      await removeMessage.mutateAsync(id);
    } catch (err: any) {
      toast.error(err?.message || "Impossible de supprimer ce message.");
    }
  }

  // Ticket "Espace Client" (suivi) : le client n'a pas forcément de compte
  // Google — il peut créer lui-même un mot de passe pour se reconnecter
  // plus vite ensuite (en plus du lien par e-mail, toujours disponible).
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  async function savePassword() {
    if (newPassword.length < 8) { toast.error('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (newPassword !== confirmPassword) { toast.error('Les deux mots de passe ne correspondent pas.'); return; }
    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Mot de passe créé.');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
      setShowMenu(false);
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'enregistrer le mot de passe.");
    } finally {
      setPasswordSaving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser) return;
      try {
        const { data: access, error: accessErr } = await supabase
          .from('client_guest_access')
          .select('lead_id, agency_id')
          .eq('user_id', currentUser.uid)
          .maybeSingle();
        if (accessErr || !access) throw new Error("Impossible de retrouver votre dossier.");

        const [{ data: lead }, { data: agency }] = await Promise.all([
          supabase.from('leads').select('id, full_name, first_name, last_name, assigned_to').eq('id', access.lead_id).maybeSingle(),
          supabase.from('agencies').select('name').eq('id', access.agency_id).maybeSingle(),
        ]);

        let advisorName: string | null = null;
        let advisorPhoto: string | null = null;
        if (lead?.assigned_to) {
          const { data: advisor } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', lead.assigned_to).maybeSingle();
          advisorName = advisor?.full_name || null;
          advisorPhoto = advisor?.avatar_url || null;
        }

        if (cancelled) return;
        setContext({
          leadId: access.lead_id,
          leadName: lead?.full_name || `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim(),
          agencyId: access.agency_id,
          agencyName: agency?.name || 'Nova CRM',
          advisorId: lead?.assigned_to || null,
          advisorName,
          advisorPhoto,
        });

        void supabase.from('client_guest_access').update({ last_login_at: new Date().toISOString() }).eq('user_id', currentUser.uid);
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Erreur de chargement.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  if (loading) {
    return (
      <div className="h-screen bg-[#071015] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#F7BC5F] animate-spin" />
      </div>
    );
  }

  if (loadError || !context) {
    return (
      <div className="h-screen bg-[#071015] flex flex-col items-center justify-center text-white p-6 text-center gap-4">
        <p className="text-sm text-slate-300">{loadError || 'Accès introuvable.'}</p>
        <button onClick={() => void logout()} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-bold flex items-center gap-2">
          <LogOut className="w-4 h-4" /> Se déconnecter
        </button>
      </div>
    );
  }

  const initials = (context.advisorName || 'C').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const lastMine = [...messages].reverse().find((m) => m.userId === currentUser?.uid && !m.deletedAt);

  return (
    <div className="h-screen bg-[#071015] text-gray-100 flex flex-col font-sans overflow-hidden">
      <header className="shrink-0 flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-white/10 bg-[#07191b] relative">
        <div className="w-9 h-9 rounded-full bg-[#F7BC5F]/15 text-[#F9C977] font-black flex items-center justify-center overflow-hidden shrink-0">
          {context.advisorPhoto ? <img src={context.advisorPhoto} alt="" className="w-full h-full object-cover" /> : initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white truncate">{context.advisorName || 'Votre conseiller'}</p>
          <p className="text-[10px] text-slate-500 truncate">{context.agencyName}</p>
        </div>
        <button onClick={() => setShowMenu((v) => !v)} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors shrink-0" title="Options">
          <MoreVertical className="w-4 h-4" />
        </button>

        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            <div className="absolute right-4 top-14 z-50 w-72 bg-[#0a1e20] border border-[#144447]/60 rounded-2xl shadow-2xl overflow-hidden">
              <button
                onClick={() => setShowPasswordForm((v) => !v)}
                className="w-full p-3.5 flex items-center gap-3 text-left hover:bg-white/5 transition-colors"
              >
                <Lock className="w-4 h-4 text-[#F9C977] shrink-0" />
                <span className="text-sm font-bold text-white flex-1">Sécuriser mon accès</span>
                <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${showPasswordForm ? 'rotate-180' : ''}`} />
              </button>
              {showPasswordForm && (
                <div className="px-3.5 pb-3.5 space-y-2 border-t border-[#144447]/60 pt-3">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Nouveau mot de passe (8 car. min.)"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void savePassword(); }}
                    placeholder="Confirmer"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
                  />
                  <button
                    onClick={() => void savePassword()}
                    disabled={passwordSaving || !newPassword || !confirmPassword}
                    className="w-full py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    {passwordSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Enregistrer
                  </button>
                </div>
              )}
              <button
                onClick={() => void logout()}
                className="w-full p-3.5 flex items-center gap-3 text-left hover:bg-rose-500/10 transition-colors border-t border-[#144447]/60"
              >
                <LogOut className="w-4 h-4 text-rose-300 shrink-0" />
                <span className="text-sm font-bold text-rose-300">Se déconnecter</span>
              </button>
            </div>
          </>
        )}
      </header>

      <main ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 sm:p-6 space-y-2">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-16">
            <div className="w-14 h-14 rounded-full bg-[#F7BC5F]/15 text-[#F9C977] font-black flex items-center justify-center overflow-hidden">
              {context.advisorPhoto ? <img src={context.advisorPhoto} alt="" className="w-full h-full object-cover" /> : initials}
            </div>
            <p className="text-sm text-slate-400 mt-2">Écrivez votre premier message à {context.advisorName || 'votre conseiller'}.</p>
          </div>
        )}
        {messages.map((m) => {
          const isMe = m.userId === currentUser?.uid;
          const isEditing = editingId === m.id;
          return (
            <div key={m.id} className={`group flex ${isMe ? 'justify-end' : 'justify-start'} py-0.5`}>
              <div className={`flex items-end gap-1 max-w-[82%] sm:max-w-[70%] ${isMe ? 'flex-row-reverse' : ''}`}>
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm relative ${isMe ? 'bg-[#F7BC5F] text-slate-950 font-semibold' : 'bg-white/5 text-gray-200 border border-white/10'}`}>
                  {m.deletedAt ? (
                    <p className="italic text-xs opacity-60">Message supprimé</p>
                  ) : isEditing ? (
                    <div className="flex flex-col gap-2 min-w-[180px]">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="bg-black/10 rounded-lg p-2 text-sm text-inherit border border-black/20 focus:outline-none resize-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="text-[11px] opacity-70 hover:opacity-100">Annuler</button>
                        <button onClick={() => void saveEdit()} className="text-[11px] font-bold underline">Enregistrer</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {m.body && m.kind !== 'file' && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      {m.kind === 'image' && m.attachmentUrl && (
                        <button type="button" onClick={() => setLightboxUrl(m.attachmentUrl)} className="block cursor-pointer">
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
                  <p className={`text-[10px] mt-1 ${isMe ? 'text-slate-950/60' : 'text-gray-500'}`}>
                    {new Date(m.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {isMe && !m.deletedAt && !isEditing && (
                  <div className="relative opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => setOpenMessageMenuId(openMessageMenuId === m.id ? null : m.id)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                    {openMessageMenuId === m.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setOpenMessageMenuId(null)} />
                        <div className="absolute z-50 top-full right-0 mt-1 bg-[#0a1e20] border border-[#144447]/60 rounded-xl shadow-xl overflow-hidden w-32">
                          {m.kind === 'text' && (
                            <button onClick={() => void startEditing(m)} className="w-full px-3 py-2 flex items-center gap-2 text-xs text-white hover:bg-white/10">
                              <Pencil className="w-3 h-3" /> Modifier
                            </button>
                          )}
                          <button onClick={() => void deleteMessage(m.id)} className="w-full px-3 py-2 flex items-center gap-2 text-xs text-rose-300 hover:bg-rose-500/10">
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
        {lastMine && (
          <div className="flex justify-end pr-1">
            <span className="text-[10px] text-slate-500 flex items-center gap-1">
              {lastMine.readAt ? (<><CheckCheck className="w-3 h-3 text-sky-400" /> Vu</>) : (<><Check className="w-3 h-3" /> Envoyé</>)}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {lightboxUrl && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
            <X className="w-5 h-5" />
          </button>
          <img src={lightboxUrl} alt="" className="max-w-full max-h-full object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      <div className="shrink-0 border-t border-white/10 bg-[#07191b] p-3 relative">
        {showEmojiPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />
            <div className="absolute z-50 bottom-full left-3 mb-2 bg-[#0a1e20] border border-[#144447]/60 rounded-2xl p-2 shadow-xl flex gap-1">
              {QUICK_EMOJIS.map((e) => (
                <button key={e} onClick={() => insertEmoji(e)} className="text-xl hover:scale-125 transition-transform p-1">{e}</button>
              ))}
            </div>
          </>
        )}

        {isRecording ? (
          <div className="flex items-center gap-3 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
            <span className="flex-1 text-sm text-rose-200 font-semibold">Enregistrement... {recordingSeconds}s</span>
            <button onClick={() => void stopRecording(true)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" title="Annuler">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={() => void stopRecording(false)} className="p-2 rounded-lg bg-[#F7BC5F] text-slate-950" title="Envoyer">
              <Square className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={uploading}
              className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              title="Envoyer une photo"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              title="Envoyer un document"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Emoji"
            >
              <Smile className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleDictation}
              title="Dictée vocale (texte)"
              className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center transition-colors ${isListening ? 'bg-rose-500 text-white animate-pulse' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
            >
              <Mic className="w-4 h-4" />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendText(); } }}
              placeholder={isListening ? 'Je vous écoute...' : 'Écrire un message...'}
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F7BC5F]"
            />
            {draft.trim() ? (
              <button
                onClick={() => void sendText()}
                disabled={sending}
                className="w-9 h-9 shrink-0 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 flex items-center justify-center disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            ) : (
              <button
                onClick={() => void startRecording()}
                disabled={uploading}
                className="w-9 h-9 shrink-0 rounded-full bg-rose-500/90 hover:bg-rose-500 text-white flex items-center justify-center disabled:opacity-40"
                title="Message vocal"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        {uploading && <p className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Envoi en cours...</p>}

        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void sendAttachment(f, 'image'); }} />
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void sendAttachment(f, 'file'); }} />
      </div>
    </div>
  );
};

export default ClientGuestShell;
