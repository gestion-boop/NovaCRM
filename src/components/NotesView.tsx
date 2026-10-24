import React, { useState, useEffect } from 'react';
import { FileEdit, Plus, Trash2, User, Search, Filter } from 'lucide-react';
import { NoteItem } from '@/types';
import { getImportedStorage, saveImportedStorage } from '@/utils/importedDataManager';
import { useAuth } from '@/context/AuthContext';
import { useContacts } from '@/hooks/useContacts';

const INITIAL_NOTES: NoteItem[] = [];

export const NotesView: React.FC = () => {
  const { activeAgency } = useAuth();
  const { contacts } = useContacts();
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('Général');
  const [selectedContactId, setSelectedContactId] = useState('');

  const loadAllNotes = () => {
    const imported = getImportedStorage().notes;
    const combined = [...INITIAL_NOTES, ...imported];
    const map = new Map<string, NoteItem>();
    combined.forEach(n => map.set(n.id, n));
    const all = Array.from(map.values());
    const filtered = all.filter(n => {
      if (activeAgency.id === 'all') return true;
      if (n.agencyId) return n.agencyId === activeAgency.id;
      return true;
    });
    setNotes(filtered);
  };

  useEffect(() => {
    loadAllNotes();
    const handleStorageChange = () => loadAllNotes();
    window.addEventListener('crm_imported_data_changed', handleStorageChange);
    return () => window.removeEventListener('crm_imported_data_changed', handleStorageChange);
  }, [activeAgency.id]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const matchedContact = contacts.find(c => c.id === selectedContactId);

    const newN: NoteItem = {
      id: 'n-' + Date.now(),
      title,
      content,
      category,
      updatedAt: new Date().toISOString().split('T')[0],
      agencyId: activeAgency.id === 'all' ? (matchedContact?.agencyId || '30f96ea9-41da-41c2-a95e-f5e7898f8d8e') : activeAgency.id,
      contactId: selectedContactId || undefined,
      contactName: matchedContact?.name || undefined
    };

    const currentNotes = getImportedStorage().notes;
    saveImportedStorage({ notes: [...currentNotes, newN] });
    setTitle('');
    setContent('');
    setSelectedContactId('');
    setShowAdd(false);
  };

  const handleDelete = (id: string) => {
    const currentImported = getImportedStorage().notes;
    const updated = currentImported.filter(n => n.id !== id);
    saveImportedStorage({ notes: updated });
    setNotes(notes.filter(n => n.id !== id));
  };

  const filteredNotes = notes.filter(n => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      n.title.toLowerCase().includes(s) ||
      n.content.toLowerCase().includes(s) ||
      n.category.toLowerCase().includes(s) ||
      (n.contactName && n.contactName.toLowerCase().includes(s))
    );
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center font-bold">
            <FileEdit className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Bloc-Notes & Remarques</h1>
            <p className="text-xs text-gray-400">Notes personnelles, comptes-rendus de rendez-vous et suivi clients ({filteredNotes.length} note(s))</p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher une note ou un client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#07191b] border border-[#144447] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-[#E5B842] hover:bg-[#d9ab38] text-slate-950 font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Nouvelle Note</span>
          </button>
        </div>
      </div>

      {filteredNotes.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-500 bg-[#07191b] border border-[#144447]/60 rounded-3xl flex flex-col items-center justify-center gap-2">
          <FileEdit className="w-8 h-8 text-slate-600" />
          <span>Aucune note trouvée. Vous pouvez rédiger une note liée à un client ou à un dossier à tout moment.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredNotes.map((n) => (
            <div key={n.id} className="p-5 bg-[#07191b] border border-[#144447] rounded-2xl space-y-3 flex flex-col justify-between hover:border-[#226368] transition-all shadow-md">
              <div>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="text-[10px] font-bold text-[#E5B842] bg-[#E5B842]/10 px-2.5 py-0.5 rounded-full border border-[#E5B842]/20">
                    {n.category}
                  </span>
                  <span className="text-[10px] text-slate-400">{n.updatedAt}</span>
                </div>
                
                {n.contactName && (
                  <div className="flex items-center gap-1.5 text-xs text-teal-400 font-medium mb-1.5">
                    <User className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    <span>{n.contactName}</span>
                  </div>
                )}

                <h3 className="font-bold text-white text-base mb-1">{n.title}</h3>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{n.content}</p>
              </div>

              <div className="pt-3 border-t border-[#144447]/60 flex justify-end">
                <button
                  onClick={() => handleDelete(n.id)}
                  className="text-slate-500 hover:text-rose-400 p-1 text-xs transition-colors rounded-lg hover:bg-rose-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#07191b] border border-[#144447] rounded-2xl max-w-md w-full p-6 text-white shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-[#E5B842] flex items-center gap-2">
              <FileEdit className="w-5 h-5" />
              <span>Rédiger une note</span>
            </h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">Titre de la note</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Compte-rendu entretien téléphonique"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">Client lié (optionnel)</label>
                <select
                  value={selectedContactId}
                  onChange={(e) => setSelectedContactId(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Aucun client lié --</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.agencyId || 'Général'})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">Catégorie</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="ex: Rendez-vous, Banque, Suivi"
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-300">Contenu / Remarques</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Saisissez vos remarques détaillées..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-slate-950 bg-[#E5B842] hover:bg-[#d9ab38] rounded-xl shadow-lg cursor-pointer"
                >
                  Enregistrer la note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default NotesView;
