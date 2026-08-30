import React, { useState } from 'react';
import { X, Save, Pencil } from 'lucide-react';
import { Contact } from '@/types';

interface Props {
  client: Contact;
  onClose: () => void;
  onSave: (updates: Partial<Contact>) => Promise<void>;
}

export default function EditClientModal({ client, onClose, onSave }: Props) {
  const [name, setName] = useState(client.name || '');
  const [email, setEmail] = useState(client.email || '');
  const [phone, setPhone] = useState(client.phone || '');
  const [statutLead, setStatutLead] = useState(client.statutLead || 'Froid - Prospect peu intéressé');
  const [budgetMax, setBudgetMax] = useState(client.budgetMax ? String(client.budgetMax) : '');
  const [secteur, setSecteur] = useState(client.secteur || '');
  const [typeBien, setTypeBien] = useState(client.typeBien || client.projectType || '');
  const [comments, setComments] = useState(client.comments || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        statutLead,
        budgetMax: budgetMax === '' ? undefined : Number(budgetMax),
        secteur: secteur.trim(),
        typeBien: typeBien.trim(),
        comments: comments.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl max-w-lg w-full p-6 text-white shadow-2xl relative animate-scale-up max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#143c3f] border border-[#1a5155] flex items-center justify-center text-[#F9C977]">
              <Pencil className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white">Modifier la fiche</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto custom-scrollbar pr-1">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Nom complet</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Téléphone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Statut</label>
            <select
              value={statutLead}
              onChange={(e) => setStatutLead(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
            >
              <option value="Froid - Prospect peu intéressé">🔵 Froid - Peu intéressé</option>
              <option value="Tiède - Intérêt modéré">🟠 Tiède - Intérêt modéré</option>
              <option value="Chaud - Très intéressé">🔴 Chaud - Très intéressé</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Budget max (€)</label>
              <input
                type="number"
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
                className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Secteur</label>
              <input
                type="text"
                value={secteur}
                onChange={(e) => setSecteur(e.target.value)}
                className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Type de bien / projet</label>
            <input
              type="text"
              value={typeBien}
              onChange={(e) => setTypeBien(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Commentaires</label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] resize-y"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer">
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
