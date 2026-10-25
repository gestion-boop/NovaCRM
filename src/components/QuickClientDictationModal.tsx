import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Mic, Square, Search, User, Check, FileEdit, MessageSquare,
  Sparkles, ExternalLink, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { creerAccumulateurDictee } from '@/lib/dictee';
import { useContacts } from '@/hooks/useContacts';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

interface QuickClientDictationModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialClientId?: string | null;
  onOpenClientProfile?: (clientId: string) => void;
}

export const QuickClientDictationModal: React.FC<QuickClientDictationModalProps> = ({
  isOpen,
  onClose,
  initialClientId = null,
  onOpenClientProfile,
}) => {
  const { contacts = [], updateContact } = useContacts();
  const { currentUser } = useAuth();

  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || '');
  const [clientSearch, setClientSearch] = useState('');
  const [targetField, setTargetField] = useState<'note' | 'comment'>('note');
  const [noteTitle, setNoteTitle] = useState('');
  const [dictatedText, setDictatedText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const dicteeAccRef = useRef<((results: any) => string) | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedClientId(initialClientId || '');
      setClientSearch('');
      setErrorMsg(null);
    } else {
      stopListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialClientId]);

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  useEffect(() => {
    return () => stopListening();
  }, []);

  const toggleListening = () => {
    const SpeechRecognitionApi =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      setErrorMsg(
        "La reconnaissance vocale n'est pas disponible sur ce navigateur (utilisez Chrome, Safari ou Edge)."
      );
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    setErrorMsg(null);
    try {
      const recognition = new SpeechRecognitionApi();
      recognition.lang = 'fr-FR';
      recognition.continuous = true;
      recognition.interimResults = true;

      dicteeAccRef.current = creerAccumulateurDictee(dictatedText.trim());
      recognition.onresult = (event: any) => {
        if (dicteeAccRef.current) {
          setDictatedText(dicteeAccRef.current(event.results));
        }
      };
      recognition.onerror = (event: any) => {
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          setErrorMsg("Accès au microphone refusé par le navigateur.");
        }
        setIsListening(false);
      };
      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsListening(true);
    } catch {
      setIsListening(false);
      setErrorMsg("Impossible de démarrer le microphone.");
    }
  };

  const selectedClient = useMemo(
    () => contacts.find((c) => c.id === selectedClientId) || null,
    [contacts, selectedClientId]
  );

  const filteredContacts = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const active = contacts.filter((c) => !c.archivedAt);
    if (!q) return active.slice(0, 8);
    return active
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.phone && String(c.phone).includes(q))
      )
      .slice(0, 10);
  }, [contacts, clientSearch]);

  const handleSave = async (openAfterSave = false) => {
    if (!selectedClient) {
      setErrorMsg('Veuillez sélectionner un client.');
      return;
    }
    if (!dictatedText.trim()) {
      setErrorMsg('Dictez ou saisissez un texte avant d’enregistrer.');
      return;
    }
    if (!currentUser) return;

    if (isListening) stopListening();
    setSaving(true);
    setErrorMsg(null);

    try {
      const now = new Date().toISOString();
      if (targetField === 'note') {
        const defaultTitle = `Dictée vocale du ${new Date().toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}`;
        const finalTitle = noteTitle.trim() || defaultTitle;
        const body = `**${finalTitle}**\n${dictatedText.trim()}`;

        const { error: sbErr } = await supabase.from('comments').insert({
          lead_id: selectedClient.id,
          body,
          user_id: currentUser.uid,
          created_at: now,
          updated_at: now,
          is_shared: false,
        } as any);
        if (sbErr) throw sbErr;
        toast.success(`Note vocale enregistrée dans la fiche de ${selectedClient.name}`);
      } else {
        const existing = (selectedClient.comments || '').trim();
        const stamp = new Date().toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const nextComments = existing
          ? `${existing}\n[${stamp}] ${dictatedText.trim()}`
          : dictatedText.trim();

        await updateContact.mutateAsync({
          id: selectedClient.id,
          updates: { comments: nextComments },
        });
        toast.success(`Commentaire mis à jour sur la fiche de ${selectedClient.name}`);
      }

      window.dispatchEvent(
        new CustomEvent('nova:client-dictation-saved', { detail: { clientId: selectedClient.id } })
      );

      setDictatedText('');
      setNoteTitle('');
      onClose();
      if (openAfterSave && onOpenClientProfile) {
        onOpenClientProfile(selectedClient.id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Erreur lors de l'enregistrement dans la fiche client.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[260] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl max-h-[90dvh] bg-gradient-to-b from-[#081f23] to-[#051417] border border-[#F7BC5F]/30 rounded-3xl shadow-[0_25px_70px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-white"
      >
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-[#F7BC5F] to-transparent opacity-85 shrink-0" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center shadow-[0_0_20px_rgba(244,63,94,0.35)] shrink-0">
              <Mic className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-white truncate">
                Dictée vocale → Fiche Client
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Dictez en direct, c’est enregistré instantanément dans le dossier du client
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Étape 1 : Choix du client */}
          <div className="space-y-2">
            <label className="text-[11px] font-extrabold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span>1. Fiche client destinataire</span>
              {selectedClient && (
                <button
                  type="button"
                  onClick={() => setSelectedClientId('')}
                  className="text-[11px] text-[#F7BC5F] hover:underline font-bold normal-case"
                >
                  Changer de client
                </button>
              )}
            </label>

            {selectedClient ? (
              <div className="p-3 rounded-2xl bg-[#F7BC5F]/15 border border-[#F7BC5F]/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#F7BC5F] text-slate-950 font-black text-xs flex items-center justify-center shrink-0">
                    {selectedClient.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-white truncate">{selectedClient.name}</p>
                    <p className="text-[11px] text-[#F9C977] truncate">
                      {selectedClient.type || 'Client'} {selectedClient.phone ? `· ${selectedClient.phone}` : ''}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center gap-1 shrink-0">
                  <Check className="w-3 h-3" /> Sélectionné
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Rechercher un client par nom, téléphone, e-mail..."
                    className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-black/35 border border-white/[0.1] focus:border-[#F7BC5F] text-xs sm:text-sm text-white placeholder-slate-500 outline-none"
                  />
                  {clientSearch && (
                    <button
                      type="button"
                      onClick={() => setClientSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                  {filteredContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedClientId(c.id)}
                      className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-[#F7BC5F]/15 border border-white/[0.07] hover:border-[#F7BC5F]/40 text-left flex items-center gap-2.5 transition-all"
                    >
                      <div className="w-7 h-7 rounded-lg bg-white/[0.08] text-[#F7BC5F] flex items-center justify-center text-[11px] font-bold shrink-0">
                        <User className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{c.type || 'Contact'}</p>
                      </div>
                    </button>
                  ))}
                  {filteredContacts.length === 0 && (
                    <p className="text-xs text-slate-500 col-span-2 py-2 text-center">
                      Aucun client trouvé pour « {clientSearch} ».
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Étape 2 : Où enregistrer dans la fiche ? */}
          <div className="space-y-2">
            <label className="text-[11px] font-extrabold uppercase tracking-wider text-slate-300 block">
              2. Où enregistrer dans la fiche ?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetField('note')}
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                  targetField === 'note'
                    ? 'bg-[#F7BC5F]/20 border-[#F7BC5F]/50 text-[#F7BC5F]'
                    : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                <FileEdit className="w-4 h-4 shrink-0" />
                <div className="text-left min-w-0">
                  <div className="truncate">Nouvelle Note datée</div>
                  <div className="text-[10px] font-normal text-slate-400 truncate">Onglet Notes du client</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setTargetField('comment')}
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                  targetField === 'comment'
                    ? 'bg-[#F7BC5F]/20 border-[#F7BC5F]/50 text-[#F7BC5F]'
                    : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                <MessageSquare className="w-4 h-4 shrink-0" />
                <div className="text-left min-w-0">
                  <div className="truncate">Commentaire général</div>
                  <div className="text-[10px] font-normal text-slate-400 truncate">Encadré principal de la fiche</div>
                </div>
              </button>
            </div>
          </div>

          {/* Étape 3 : Dictée vocale & Texte */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-extrabold uppercase tracking-wider text-slate-300">
                3. Votre dictée vocale
              </label>
              <button
                type="button"
                onClick={toggleListening}
                className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-2 transition-all shadow-md cursor-pointer ${
                  isListening
                    ? 'bg-rose-600 text-white animate-pulse shadow-[0_0_20px_rgba(225,29,72,0.5)]'
                    : 'bg-gradient-to-r from-[#F7BC5F] to-[#e5a94c] text-slate-950 hover:brightness-110'
                }`}
              >
                {isListening ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Arrêter la dictée</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" />
                    <span>Démarrer la dictée vocale</span>
                  </>
                )}
              </button>
            </div>

            {targetField === 'note' && (
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Titre de la note (optionnel — daté automatiquement sinon)"
                className="w-full px-3.5 py-2 rounded-xl bg-black/35 border border-white/[0.09] focus:border-[#F7BC5F] text-xs text-white placeholder-slate-500 outline-none"
              />
            )}

            <div className="relative">
              <textarea
                rows={5}
                value={dictatedText}
                onChange={(e) => setDictatedText(e.target.value)}
                placeholder={
                  isListening
                    ? 'Parlez maintenant, vos mots apparaissent ici en direct...'
                    : 'Cliquez sur « Démarrer la dictée vocale » ou tapez votre compte-rendu ici...'
                }
                className={`w-full p-3.5 rounded-2xl bg-black/40 border text-xs sm:text-sm text-white placeholder-slate-500 outline-none resize-y leading-relaxed transition-colors ${
                  isListening ? 'border-rose-500/60 ring-2 ring-rose-500/20' : 'border-white/[0.1] focus:border-[#F7BC5F]'
                }`}
              />
              {isListening && (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-rose-400 font-bold">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span>Écoute en cours… parlez naturellement.</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.08] bg-[#051417]/95 flex items-center justify-between gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1]"
          >
            Annuler
          </button>
          <div className="flex items-center gap-2">
            {onOpenClientProfile && selectedClient && (
              <button
                type="button"
                disabled={saving || !dictatedText.trim()}
                onClick={() => void handleSave(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-[#F7BC5F] bg-[#F7BC5F]/15 hover:bg-[#F7BC5F]/25 border border-[#F7BC5F]/35 disabled:opacity-40 flex items-center gap-1.5 transition-all"
              >
                <span>Enregistrer & ouvrir la fiche</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              disabled={saving || !selectedClient || !dictatedText.trim()}
              onClick={() => void handleSave(false)}
              className="px-4 py-2 rounded-xl text-xs font-extrabold text-slate-950 bg-[#F7BC5F] hover:bg-[#f9c977] disabled:opacity-40 flex items-center gap-1.5 shadow-md transition-all"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 stroke-[3]" />}
              <span>Enregistrer dans la fiche</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
};

export default QuickClientDictationModal;
