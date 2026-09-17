import React, { useState, useEffect } from 'react';
import { Bell, Plus, CheckCircle2, AlertCircle, Clock, Search, ChevronLeft, Pencil, Trash2, Calendar, User, Circle, CheckCircle, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { Task } from '@/types';
import TaskModal from './TaskModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useTasks } from '@/hooks/useTasks';
import { useContacts } from '@/hooks/useContacts';
import { getTaskDateStatus, countTodayAndOverdueTasks } from '@/lib/taskUtils';
import { useIsMobile } from '@/hooks/use-mobile';

export const RappelsView: React.FC<{ onSelectContact: (contactId: string) => void; onBack?: () => void }> = ({
  onSelectContact,
  onBack
}) => {
  const { tasks, addTask, updateTask, deleteTask } = useTasks();
  const { contacts } = useContacts();
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('Toutes');
  // Par défaut : tâches à faire, en retard ou du jour J — exactement le
  // périmètre compté par le badge de la tuile Accueil (countTodayAndOverdueTasks),
  // pour que le compteur et la liste affichée correspondent toujours.
  const [statusFilter, setStatusFilter] = useState('A faire');
  const [dueFilter, setDueFilter] = useState<'RetardEtJourJ' | 'Toutes'>('RetardEtJourJ');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedContactForNextTask, setSelectedContactForNextTask] = useState<string | undefined>(undefined);
  // Tâche en cours d'édition (clic sur le crayon) — si définie, le modal
  // s'ouvre pré-rempli et enregistre une modification au lieu d'une création.
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const isMobile = useIsMobile();
  // Sur mobile, les filtres sont repliés par défaut (ils prenaient trop de
  // place) — mais les valeurs sélectionnées restent actives tant que la
  // zone est repliée, seule leur affichage change.
  // Repliés par défaut sur mobile ET desktop désormais.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [
    dueFilter !== 'RetardEtJourJ',
    urgencyFilter !== 'Toutes',
    statusFilter !== 'A faire',
    search.trim().length > 0,
  ].filter(Boolean).length;

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
    const matchesDue = dueFilter === 'Toutes' || getTaskDateStatus(t.dueDate).diffDays <= 0;
    return matchesSearch && matchesUrgency && matchesStatus && matchesDue;
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
      {/* Signalé sur mobile : le titre + le badge + "Nouvelle tâche" tenus
          sur une seule ligne forçaient le titre à s'écraser sur 3 lignes en
          collision avec le bouton retour. Empilé en colonne sur petit
          écran (flex-col), redevient une ligne normale à partir de sm. */}
      {/* Signalé (30/08/2026) : "il n'y a plus de fond d'écran... mets des
          cases en haut" — le fond opaque sur TOUTE la page (essai
          précédent) cachait l'image de fond personnalisée partout sur
          cette page, alors qu'elle ne devait être couverte qu'au niveau du
          bandeau de titre. Revenu à une simple carte opaque autour de ce
          bandeau (comme Pipeline/Mail), le reste de la page laisse
          à nouveau voir la photo. Effet d'ombre portée sur le texte
          retiré (rendait le texte flou/moins lisible une fois sur fond
          plein — inutile en plus d'une carte opaque). */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#144447]/50 pb-6 bg-[#050f11] rounded-2xl p-4">
        <div className="flex items-start sm:items-center gap-3 sm:gap-4">
          <button
            onClick={onBack}
            disabled={!onBack}
            className="shrink-0 p-2 rounded-xl bg-black/40 hover:bg-black/60 border border-[#144447]/60 text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Rappels & Alertes</h1>
              <span className="px-3 py-1 rounded-full text-xs font-black bg-red-500/20 text-red-400 border border-red-500/40 shadow-sm whitespace-nowrap">
                {todayAndOverdueCount} {todayAndOverdueCount > 1 ? 'alertes (Jour J & Retards)' : 'alerte (Jour J & Retard)'}
              </span>
            </div>
            <p className="text-sm text-slate-400">Compteur calculé sur le Jour J et les retards uniquement</p>
          </div>
        </div>

        <button
          onClick={() => {
            setEditingTask(null);
            setShowTaskModal(true);
          }}
          className="self-start sm:self-auto px-5 py-2.5 bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-black text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg hover:scale-[1.02] shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          Nouvelle tâche
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          {/* Signalé (mode jour) : "on ne voit pas le mot filtre" — ce titre
              n'avait aucun fond propre et se retrouvait écrit à même la photo
              de fond de la page. Même pastille que les titres de section du
              Coffre Documents, pour rester cohérent d'un écran à l'autre. */}
          <div className="flex items-center px-3 py-1.5 rounded-xl nv-panel border border-white/10 w-fit">
            <h2 className="text-lg font-bold text-white leading-none">Filtres</h2>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0b1c1e] border border-[#144447]/70 text-xs font-semibold text-slate-200"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {activeFilterCount > 0 && (
              <span className="min-w-4 h-4 px-1 rounded-full bg-[#F7BC5F] text-[#061719] text-[10px] font-black flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
            {filtersOpen ? 'Masquer' : 'Afficher'}
            {filtersOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className={`grid grid-cols-1 md:grid-cols-12 gap-4 ${!filtersOpen ? 'hidden' : ''}`}>
          <div className="md:col-span-5 space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 pl-1">Recherche</label>
            <div className="relative">
              <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Titre ou client..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#F7BC5F] transition-colors"
              />
            </div>
          </div>

          <div className="md:col-span-3 space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 pl-1">Échéance</label>
            <select
              value={dueFilter}
              onChange={(e) => setDueFilter(e.target.value as 'RetardEtJourJ' | 'Toutes')}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
            >
              <option value="RetardEtJourJ">Retard &amp; Jour J</option>
              <option value="Toutes">Toutes les échéances</option>
            </select>
          </div>

          <div className="md:col-span-2 space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 pl-1">Urgence</label>
            <select
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
            >
              <option value="Toutes">Toutes</option>
              <option value="Urgent">Urgent</option>
              <option value="Haute">Haute</option>
              <option value="Moyenne">Moyenne</option>
              <option value="Basse">Basse</option>
            </select>
          </div>

          <div className="md:col-span-2 space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 pl-1">Statut</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F] appearance-none"
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
                <div className="p-12 text-center text-sm text-slate-500 bg-[#07191b] border border-[#144447]/60 rounded-3xl space-y-3">
                  <p>Aucune tâche ne correspond à vos filtres.</p>
                  {dueFilter === 'RetardEtJourJ' && (
                    <button
                      onClick={() => setDueFilter('Toutes')}
                      className="text-xs font-bold text-[#F9C977] hover:underline"
                    >
                      Rien en retard ni pour aujourd'hui — voir toutes les échéances
                    </button>
                  )}
                </div>
              ) : (
                filteredTasks.map((task, index) => {
                  const dateStatus = getTaskDateStatus(task.dueDate);
                  const dateStr = task.dueDate ? task.dueDate.split('T')[0] : '';
                  
                  // Left border color based on date status (Red for J / J-, Orange for J+1, Green for J+2+)
                  const borderLeftClass = 
                    dateStatus.color === 'red' ? 'border-l-red-500' :
                    dateStatus.color === 'orange' ? 'border-l-[#F7BC5F]' :
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
                          // Le survol utilisait un fond à 20% d'opacité
                          // (bg-[#143c3f]/20) : au lieu d'éclaircir la carte,
                          // ça la faisait paraître transparente/délavée sur
                          // le fond sombre. Remplacé par une teinte pleine
                          // (même famille de couleur, juste un peu plus
                          // claire), qui garde un vrai fond opaque au survol.
                          // Demande explicite (30/08/2026, puis "je n'ai pas
                          // d'effet hover... prononce un peu plus le halo") :
                          // lueur dorée nettement renforcée (alpha/rayon
                          // doublés) + le liseret lui-même passe au doré au
                          // survol — un second signal visuel indépendant du
                          // shadow, garanti visible même si l'ombre seule ne
                          // suffisait pas à se voir sur ce fond très sombre.
                          // Signalé (ticket #53, capture mobile) : sur téléphone,
                          // cette carte gardait sa disposition HORIZONTALE de
                          // bureau (case à cocher + texte à gauche, priorité +
                          // actions à droite, sur une seule ligne) — sur un écran
                          // étroit, les deux blocs se compressaient l'un contre
                          // l'autre, forçant le titre et la date à passer sur
                          // plusieurs lignes tassées. Elle s'empile maintenant
                          // verticalement sous `sm` (texte, puis priorité/actions
                          // en dessous, pleine largeur) ; à partir du format
                          // tablette, la disposition d'origine (une seule ligne)
                          // est inchangée.
                          className={`p-4 rounded-2xl bg-[#07191b] border-l-4 ${borderLeftClass} border-t border-r border-b border-[#144447]/60 flex flex-col sm:flex-row items-stretch sm:items-start justify-start sm:justify-between gap-3 sm:gap-4 cursor-pointer hover:bg-[#123336] hover:border-t-[#F7BC5F]/70 hover:border-r-[#F7BC5F]/70 hover:border-b-[#F7BC5F]/70 hover:shadow-[0_0_28px_6px_rgba(247,188,95,0.5)] transition-all group ${snapshot.isDragging ? 'shadow-2xl opacity-90 scale-[1.02] border-[#F7BC5F]/50 z-50 bg-[#0a1e20]' : 'shadow-md'}`}
                        >
                          <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                const willComplete = !task.completed;
                                if (willComplete) {
                                  deleteTask.mutateAsync(task.id);
                                  setLocalTasks(prev => prev.filter(t => t.id !== task.id));
                                  setSelectedContactForNextTask(task.contactId);
                                  setEditingTask(null);
                                  setShowTaskModal(true);
                                } else {
                                  updateTask.mutateAsync({ id: task.id, updates: { completed: false } });
                                }
                              }}
                              className="mt-0.5 cursor-pointer text-slate-400 hover:text-[#F7BC5F] transition-colors shrink-0"
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
                                      <User className="w-3.5 h-3.5 text-[#F9C977]" />
                                      {getContactName(task.contactId)}
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1.5 font-mono">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {dateStr ? new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Sourdine'}
                                  </span>
                                </div>
                              </div>
                              {/* Signalé (ticket #53) : cette ligne réaffichait
                                  le titre une seconde fois pour une tâche
                                  normale (déjà montré juste au-dessus dans le
                                  <h3>) — la condition était inversée par
                                  rapport à son intention réelle : montrer le
                                  VRAI titre en dessous quand le <h3> ne porte
                                  qu'un intitulé générique ("Appel",
                                  "Rendez-vous"), et ne rien répéter sinon.
                                  N'affiche donc plus rien pour une tâche
                                  normale ; pour un appel/rendez-vous, montre
                                  maintenant son vrai titre (au lieu du texte
                                  générique "Détails de la tâche..." qui ne
                                  disait rien de réel). */}
                              {(task.type === 'Appel' || task.type === 'Rendez-vous') && (
                                <p className="text-sm text-slate-400">{task.title}</p>
                              )}
                              {/* Demandé (17/09/2026) : « on sait qu'on a une
                                  tâche à faire mais on ne sait pas ce que
                                  c'est » — la description existait déjà en
                                  base (reminders.description) mais n'était
                                  affichée nulle part. `line-clamp-2` : une
                                  carte de liste, pas la place pour un pavé de
                                  texte complet ; le détail complet reste
                                  accessible en ouvrant la tâche. */}
                              {task.description && (
                                <p className="text-sm text-slate-400 line-clamp-2">{task.description}</p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 w-full sm:w-auto">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${dateStatus.badgeClass}`}>
                              {task.priority || 'Normal'}
                            </span>

                            {/* Les boutons n'apparaissaient qu'au survol
                                (`group-hover`), un geste qui n'existe pas au
                                doigt : sur téléphone, ils restaient invisibles
                                en permanence. Visibles en permanence sous
                                `sm`, toujours réservés au survol à partir de
                                la tablette (comportement bureau inchangé). */}
                            <div className="flex items-center gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTask(task);
                                  setShowTaskModal(true);
                                }}
                                className="p-2 rounded-lg bg-black/40 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                                title="Modifier la tâche"
                              >
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
            setEditingTask(null);
          }}
          onAddTask={(t) => addTask.mutateAsync(t)}
          onUpdateTask={(id, updates) => updateTask.mutateAsync({ id, updates })}
          contacts={contacts || []}
          defaultContactId={selectedContactForNextTask}
          allTasks={localTasks}
          initialTask={editingTask || undefined}
        />
      )}
    </div>
  );
};

export default RappelsView;
