import React, { useState, useEffect } from 'react';
import { Bell, Plus, CheckCircle2, AlertCircle, Clock, Search, ChevronLeft, Pencil, Trash2, Calendar, User, Circle, CheckCircle } from 'lucide-react';
import { Task } from '@/types';
import TaskModal from './TaskModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useTasks } from '@/hooks/useTasks';
import { useContacts } from '@/hooks/useContacts';
import { getTaskDateStatus, countTodayAndOverdueTasks } from '@/lib/taskUtils';

export const RappelsView: React.FC<{ onSelectContact: (contactId: string) => void }> = ({
  onSelectContact
}) => {
  const { tasks, addTask, updateTask, deleteTask } = useTasks();
  const { contacts } = useContacts();
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('Toutes');
  const [statusFilter, setStatusFilter] = useState('A faire');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedContactForNextTask, setSelectedContactForNextTask] = useState<string | undefined>(undefined);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (tasks) setLocalTasks(tasks);
  }, [tasks]);

  const getContactName = (contactId?: string) => {
    if (!contactId) return 'Aucun client';
    const contact = (contacts || []).find(c => c.id === contactId);
    return contact ? contact.name : 'Client inconnu';
  };

  const filteredTasks = localTasks.filter(t => {
    const contactName = getContactName(t.contactId).toLowerCase();
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase()) || contactName.includes(search.toLowerCase());
    const matchesUrgency = urgencyFilter === 'Toutes' || t.priority === urgencyFilter;
    const matchesStatus = statusFilter === 'Toutes' || (statusFilter === 'A faire' ? !t.completed : t.completed);
    return matchesSearch && matchesUrgency && matchesStatus;
  });

  const onDragEnd = (result: DropResult) => {
    // ... same as before
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;

    if (sourceIndex === destinationIndex) return;

    const reorderedTasks = Array.from(filteredTasks);
    const [movedTask] = reorderedTasks.splice(sourceIndex, 1);
    reorderedTasks.splice(destinationIndex, 0, movedTask);

    setLocalTasks(prev => {
      const newTasks = [...prev];
      const taskInLocal = newTasks.find(t => t.id === movedTask.id);
      if (taskInLocal) {
        newTasks.splice(newTasks.indexOf(taskInLocal), 1);
        
        const sibling = reorderedTasks[destinationIndex + (sourceIndex < destinationIndex ? -1 : 1)];
        if (sibling) {
            const siblingIdx = newTasks.findIndex(t => t.id === sibling.id);
            newTasks.splice(siblingIdx + (sourceIndex < destinationIndex ? 1 : 0), 0, taskInLocal);
        } else {
            newTasks.unshift(taskInLocal);
        }
      }
      return newTasks;
    });
  };

  const todayAndOverdueCount = countTodayAndOverdueTasks(localTasks);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 animate-fade-in relative">
      <div className="flex items-center justify-between border-b border-[#144447]/50 pb-6">
        <div className="flex items-center gap-4">
          <button className="p-2 rounded-xl bg-black/40 hover:bg-black/60 border border-[#144447]/60 text-slate-300 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Rappels & Alertes</h1>
              <span className="px-3 py-1 rounded-full text-xs font-black bg-red-500/20 text-red-400 border border-red-500/40 shadow-sm">
                {todayAndOverdueCount} {todayAndOverdueCount > 1 ? 'alertes (Jour J & Retards)' : 'alerte (Jour J & Retard)'}
              </span>
            </div>
            <p className="text-sm text-slate-400">Compteur calculé sur le Jour J et les retards uniquement</p>
          </div>
        </div>
        
        <button 
          onClick={() => setShowTaskModal(true)}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg hover:scale-[1.02]"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          Nouvelle tâche
        </button>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white">Filtres</h2>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-6 space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 pl-1">Recherche</label>
            <div className="relative">
              <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Titre ou client..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>
          </div>
          
          <div className="md:col-span-3 space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 pl-1">Urgence</label>
            <select
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-amber-500 appearance-none"
            >
              <option value="Toutes">Toutes</option>
              <option value="Urgent">Urgent</option>
              <option value="Haute">Haute</option>
              <option value="Moyenne">Moyenne</option>
              <option value="Basse">Basse</option>
            </select>
          </div>
          
          <div className="md:col-span-3 space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 pl-1">Statut</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-amber-500 appearance-none"
            >
              <option value="Toutes">Toutes</option>
              <option value="A faire">A faire</option>
              <option value="Terminée">Terminée</option>
            </select>
          </div>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="tasks-list">
          {(provided) => (
            <div 
              {...provided.droppableProps}
              ref={provided.innerRef}
              className="space-y-3"
            >
              {filteredTasks.length === 0 ? (
                <div className="p-12 text-center text-sm text-slate-500 bg-[#07191b] border border-[#144447]/60 rounded-3xl">
                  Aucune tâche ne correspond à vos filtres.
                </div>
              ) : (
                filteredTasks.map((task, index) => {
                  const dateStatus = getTaskDateStatus(task.dueDate);
                  const dateStr = task.dueDate ? task.dueDate.split('T')[0] : '';
                  
                  // Left border color based on date status (Red for J / J-, Orange for J+1, Green for J+2+)
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
                          onClick={() => {
                            if (task.contactId) {
                              onSelectContact(task.contactId);
                            }
                          }}
                          className={`p-4 rounded-2xl bg-[#07191b] border-l-4 ${borderLeftClass} border-t border-r border-b border-[#144447]/60 flex items-start justify-between gap-4 cursor-pointer hover:bg-[#143c3f]/20 transition-all group ${snapshot.isDragging ? 'shadow-2xl opacity-90 scale-[1.02] border-amber-500/50 z-50 bg-[#0a1e20]' : 'shadow-md'}`}
                        >
                          <div className="flex items-start gap-4 min-w-0 flex-1">
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                const willComplete = !task.completed;
                                if (willComplete) {
                                  deleteTask.mutateAsync(task.id);
                                  setLocalTasks(prev => prev.filter(t => t.id !== task.id));
                                  setSelectedContactForNextTask(task.contactId);
                                  setShowTaskModal(true);
                                } else {
                                  updateTask.mutateAsync({ id: task.id, updates: { completed: false } });
                                }
                              }}
                              className="mt-0.5 cursor-pointer text-slate-400 hover:text-amber-500 transition-colors shrink-0"
                              title={task.completed ? "Marquer à faire" : "Valider et planifier la suite"}
                            >
                              {task.completed ? (
                                <CheckCircle className="w-5 h-5 text-emerald-500" />
                              ) : (
                                <Circle className="w-5 h-5" />
                              )}
                            </div>
                            
                            <div className="space-y-1.5 min-w-0 flex-1">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3 className={`text-base font-bold ${task.completed ? 'text-slate-500 line-through' : 'text-white'}`}>
                                    {task.type === 'Appel' ? 'Appel' : task.type === 'Rendez-vous' ? 'Rendez-vous' : task.title}
                                  </h3>
                                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${dateStatus.badgeClass}`}>
                                    {dateStatus.label}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                                  {task.contactId && (
                                    <span className="flex items-center gap-1.5 font-medium text-slate-300">
                                      <User className="w-3.5 h-3.5 text-amber-400" />
                                      {getContactName(task.contactId)}
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1.5 font-mono">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {dateStr ? new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Sourdine'}
                                  </span>
                                </div>
                              </div>
                              <p className="text-sm text-slate-400">{task.type !== 'Appel' && task.type !== 'Rendez-vous' ? task.title : 'Détails de la tâche...'}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3 shrink-0">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${dateStatus.badgeClass}`}>
                              {task.priority || 'Normal'}
                            </span>
                            
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="p-2 rounded-lg bg-black/40 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteTask.mutateAsync(task.id);
                                }}
                                className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 hover:text-rose-400 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
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

      {showTaskModal && (
        <TaskModal
          onClose={() => {
            setShowTaskModal(false);
            setSelectedContactForNextTask(undefined);
          }}
          onAddTask={(t) => addTask.mutateAsync(t)}
          contacts={contacts || []}
          defaultContactId={selectedContactForNextTask}
          allTasks={localTasks}
        />
      )}
    </div>
  );
};

export default RappelsView;
