import React, { useState } from 'react';
import { Task, AGENCIES } from '@/types';
import { formatDate } from '@/lib/utils';
import { getTaskDateStatus, countTodayAndOverdueTasks } from '@/lib/taskUtils';
import { Plus, CheckSquare, Square, Trash2, Calendar, Filter, Sparkles, Building, X } from 'lucide-react';
import TaskModal from './TaskModal';
import { useContacts } from '@/hooks/useContacts';

interface TasksProps {
  tasks: Task[];
  onAddTask: (task: Omit<Task, 'id' | 'completed' | 'createdAt'>) => Promise<void>;
  onToggleTask: (id: string, completed: boolean) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
}

export default function Tasks({ tasks, onAddTask, onToggleTask, onDeleteTask }: TasksProps) {
  const { contacts = [] } = useContacts();
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedContactForNextTask, setSelectedContactForNextTask] = useState<string | undefined>(undefined);

  // Filter states
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [agencyFilter, setAgencyFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'origin' | 'title'>('dueDate');

  // Filter & Sort logic
  const filteredTasks = tasks
    .filter(t => {
      const matchesStatus = 
        filter === 'all' ? true :
        filter === 'completed' ? t.completed :
        !t.completed;

      const matchesAgency = agencyFilter === 'all' || t.agencyId === agencyFilter;
      return matchesStatus && matchesAgency;
    })
    .sort((a, b) => {
      if (sortBy === 'dueDate') {
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      }
      if (sortBy === 'priority') {
        const priorityWeight = { 'Urgent': 4, 'Haute': 3, 'Moyenne': 2, 'Basse': 1 };
        const weightA = priorityWeight[a.priority || 'Basse'] || 1;
        const weightB = priorityWeight[b.priority || 'Basse'] || 1;
        return weightB - weightA;
      }
      if (sortBy === 'origin') {
        return (a.contactOrigin || '').localeCompare(b.contactOrigin || '');
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, 'fr');
      }
      return 0;
    });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
      {/* Main Task List */}
      <div className="lg:col-span-2 space-y-6">
        {/* Title bar */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight">Liste des Actions & Tâches</h2>
            <p className="text-xs text-slate-400">Rappels d'appels, relances offres et échéances de prêt.</p>
          </div>
          <button
            onClick={() => {
              setSelectedContactForNextTask(undefined);
              setShowTaskModal(true);
            }}
            className="px-4 py-2 bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            Ajouter une tâche
          </button>
        </div>

        {/* Task quick-filters */}
        <div className="p-4 rounded-2xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow flex flex-col sm:flex-row gap-3 transition-all duration-300">
          <div className="flex-1 flex gap-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                filter === 'all' ? 'bg-[#F7BC5F] text-slate-950' : 'bg-transparent text-slate-400 hover:text-white'
              }`}
            >
              Toutes
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                filter === 'pending' ? 'bg-[#F7BC5F] text-slate-950' : 'bg-transparent text-slate-400 hover:text-white'
              }`}
            >
              En cours
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                filter === 'completed' ? 'bg-[#F7BC5F] text-slate-950' : 'bg-transparent text-slate-400 hover:text-white'
              }`}
            >
              Complétées
            </button>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
            <select
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              className="bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-[#F7BC5F]"
            >
              <option value="all">Filtrer par Agence</option>
              {AGENCIES.filter(a => a.id !== 'all').map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'dueDate' | 'priority' | 'origin' | 'title')}
              className="bg-[#030d0f] border border-[#153c3f] rounded-xl px-3 py-2 text-xs text-[#F9C977] font-semibold focus:outline-none focus:border-[#F7BC5F]"
            >
              <option value="dueDate">Trier par Échéance</option>
              <option value="priority">Trier par Priorité</option>
              <option value="origin">Trier par Provenance contact</option>
              <option value="title">Trier par Nom / Titre</option>
            </select>
          </div>
        </div>

        {/* List Card */}
        <div className="bg-[#07191b] border border-[#144447]/60 rounded-2xl overflow-hidden shadow-xl transition-all duration-300">
          {filteredTasks.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              Aucune tâche enregistrée dans ce filtre.
            </div>
          ) : (
            <div className="divide-y divide-[#143c3f]/30">
              {filteredTasks.map(t => {
                const agency = AGENCIES.find(a => a.id === t.agencyId);
                const dateStatus = getTaskDateStatus(t.dueDate);
                const linkedContact = t.contactId ? contacts.find(c => c.id === t.contactId) : null;

                return (
                  <div 
                    key={t.id}
                    className={`p-4 flex items-center justify-between gap-4 transition-all duration-150 hover:bg-[#143c3f]/15 ${
                      t.completed ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3.5 flex-1 min-w-0">
                      <button
                        onClick={async () => {
                          const willComplete = !t.completed;
                          await onToggleTask(t.id, willComplete);
                          if (willComplete) {
                            setSelectedContactForNextTask(t.contactId);
                            setShowTaskModal(true);
                          }
                        }}
                        className="text-slate-500 hover:text-[#F7BC5F] transition-colors cursor-pointer shrink-0"
                        title={t.completed ? "Marquer à faire" : "Valider et planifier la suite"}
                      >
                        {t.completed ? (
                          <CheckSquare className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-semibold block truncate ${
                            t.completed ? 'line-through text-slate-500' : 'text-white'
                          }`}>
                            {t.title}
                          </span>
                          {!t.completed && (
                            <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold border ${dateStatus.badgeClass}`}>
                              {dateStatus.label}
                            </span>
                          )}
                          {t.contactOrigin && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold bg-[#F7BC5F]/15 text-[#FAD592] border border-[#F7BC5F]/30">
                              {t.contactOrigin}
                            </span>
                          )}
                          {linkedContact && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-extrabold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                              Client: {linkedContact.name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-400 font-medium">
                          <span className="flex items-center gap-1 font-mono">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" /> 
                            <span>{formatDate(t.dueDate)}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Building className="w-3.5 h-3.5 text-slate-500" />
                            {agency?.name || 'Inconnue'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={async () => {
                        if (confirm("Voulez-vous supprimer cette tâche ?")) {
                          await onDeleteTask(t.id);
                        }
                      }}
                      className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                      title="Supprimer la tâche"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Stats and productivity card */}
      <div className="space-y-6">
        <div className="p-6 rounded-3xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow-2xl space-y-4 transition-all duration-300">
          <div className="flex items-center gap-2 text-[#F7BC5F] font-bold text-xs uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Statistiques Équipe</span>
          </div>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-black/40 border border-[#143c3f] space-y-2">
              <span className="text-[10px] uppercase font-bold text-slate-400">Taux de Résolution</span>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-black text-white">
                  {tasks.length > 0 ? Math.round((tasks.filter(t => t.completed).length / tasks.length) * 100) : 0}%
                </span>
                <span className="text-xs text-slate-500 pb-0.5">des objectifs atteints</span>
              </div>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed space-y-2">
              <p>
                La gestion rigoureuse des tâches permet d'accélérer les délais d'octroi de prêt immobilier de près de <strong>4 jours</strong>.
              </p>
              <p className="text-[11px] text-slate-400">
                Veillez à relancer les dossiers de prêt tous les mardis et jeudis matins auprès de vos interlocuteurs bancaires privilégiés.
              </p>
            </div>
          </div>
        </div>
      </div>

      {showTaskModal && (
        <TaskModal
          onClose={() => {
            setShowTaskModal(false);
            setSelectedContactForNextTask(undefined);
          }}
          onAddTask={async (t) => {
            await onAddTask({
              title: t.title,
              dueDate: t.dueDate,
              type: t.type,
              contactId: t.contactId,
              agencyId: AGENCIES[0].id,
            });
          }}
          contacts={contacts}
          defaultContactId={selectedContactForNextTask}
          allTasks={tasks}
        />
      )}
    </div>
  );
}
