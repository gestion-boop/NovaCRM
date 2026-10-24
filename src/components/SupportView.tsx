import React, { useState } from 'react';
import { LifeBuoy, Plus, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { SupportTicket } from '@/types';

const INITIAL_TICKETS: SupportTicket[] = [];

export const SupportView: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>(INITIAL_TICKETS);
  const [showAdd, setShowAdd] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) return;

    const newTk: SupportTicket = {
      id: 'tk-' + Date.now(),
      subject,
      clientName: 'Sylvain Grazia',
      priority: 'Moyenne',
      status: 'Ouvert',
      createdAt: new Date().toISOString().split('T')[0],
      description,
    };

    setTickets([newTk, ...tickets]);
    setSubject('');
    setDescription('');
    setShowAdd(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-500/20 border border-slate-500/30 text-slate-300 flex items-center justify-center font-bold">
            <LifeBuoy className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Support & Assistance CRM</h1>
            <p className="text-xs text-gray-400">Assistance technique et questions sur la plateforme</p>
          </div>
        </div>

        <button
          onClick={() => setShowAdd(true)}
          className="bg-[#E5B842] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Ouvrir un ticket</span>
        </button>
      </div>

      <div className="space-y-3">
        {tickets.map((tk) => (
          <div key={tk.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-white/20 transition-all">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                  tk.status === 'Résolu' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                  tk.status === 'En cours' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                }`}>
                  {tk.status}
                </span>
                <span className="text-[10px] text-gray-400">Ouvert le {tk.createdAt}</span>
              </div>
              <h3 className="font-bold text-white text-sm">{tk.subject}</h3>
              <p className="text-xs text-gray-400 mt-1">{tk.description}</p>
            </div>

            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
                tk.priority === 'Urgent' ? 'bg-rose-500/20 text-rose-400' : 'bg-gray-500/20 text-gray-300'
              }`}>
                {tk.priority}
              </span>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white">
            <h3 className="text-lg font-bold mb-4 text-[#E5B842]">Créer une demande d'assistance</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Sujet de la demande</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Problème d'export PDF du mandat"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Description détaillée</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Décrivez l'anomalie rencontrée..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-black bg-[#E5B842] rounded-xl"
                >
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default SupportView;
