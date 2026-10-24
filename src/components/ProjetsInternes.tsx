import React, { useState } from 'react';
import { FolderKanban, Plus, CheckCircle2, Clock, AlertCircle, User } from 'lucide-react';
import { InternalProject } from '@/types';

interface ProjetsInternesProps {
  agencyId: string;
}

const INITIAL_PROJECTS: InternalProject[] = [];

export const ProjetsInternes: React.FC<ProjetsInternesProps> = () => {
  const [projects, setProjects] = useState<InternalProject[]>(INITIAL_PROJECTS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedMember, setAssignedMember] = useState('Sylvain Grazia');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const newP: InternalProject = {
      id: 'p-' + Date.now(),
      title,
      description,
      status: 'À faire',
      agencyId: 'conseils-finances',
      deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      assignedMember,
      progress: 0,
    };

    setProjects([...projects, newP]);
    setTitle('');
    setDescription('');
    setShowAddModal(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E5B842]/20 border border-[#E5B842]/30 text-[#E5B842] flex items-center justify-center font-bold">
            <FolderKanban className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Projets internes & Initiatives</h1>
            <p className="text-xs text-gray-400">Suivi des objectifs stratégiques d'agence</p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-[#E5B842] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow-md"
        >
          <Plus className="w-4 h-4" />
          <span>Nouveau Projet</span>
        </button>
      </div>

      {/* Grid of Projects */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-3 relative hover:border-white/20 transition-all">
            <div className="flex items-start justify-between">
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                p.status === 'Terminé' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                p.status === 'En cours' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                'bg-gray-500/20 text-gray-300 border border-gray-500/30'
              }`}>
                {p.status}
              </span>
              <div className="flex items-center gap-1 text-[11px] text-gray-400">
                <Clock className="w-3.5 h-3.5" />
                <span>{p.deadline}</span>
              </div>
            </div>

            <h3 className="font-bold text-white text-base">{p.title}</h3>
            <p className="text-xs text-gray-300 line-clamp-2">{p.description}</p>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Progression</span>
                <span>{p.progress}%</span>
              </div>
              <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#E5B842] h-full rounded-full transition-all duration-300"
                  style={{ width: `${p.progress}%` }}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#E5B842]" />
                <span className="text-gray-300">{p.assignedMember}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal create project */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white">
            <h3 className="text-lg font-bold mb-4 text-[#E5B842]">Créer un projet interne</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Titre du projet</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Campagne Partenaires Notaires"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Description</label>
                <textarea
                  rows={3}
                  placeholder="Objectif et étapes clés..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-black bg-[#E5B842] rounded-xl"
                >
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default ProjetsInternes;
