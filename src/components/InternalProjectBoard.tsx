import React, { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { pickVoiceMimeType } from '@/lib/audioRecording';
import { ChevronLeft, Plus, Trash2, Calendar, X, Loader2, User, CheckSquare, Image as ImageIcon, Mic, Square, Send, Paperclip, MessageCircle, Eye, Users as UsersIcon, Check, Pencil } from 'lucide-react';
import { InternalTask, InternalTaskStatus, InternalTaskPriority } from '@/types';
import { NovaSphereUserProfile, useAuth } from '@/context/AuthContext';
import { useInternalProjectTasks, InternalTasksScope } from '@/hooks/useInternalProjectTasks';
import { useTaskChecklist, useChecklistCounts } from '@/hooks/useTaskChecklist';
import { useTaskActivity } from '@/hooks/useTaskActivity';
import { useTaskMessages, useTaskMessageCounts, TaskMessage } from '@/hooks/useTaskMessages';

// Ticket "Projets internes" (phase 1) : tableau kanban des tâches d'un
// projet — même mécanisme de glisser-déposer que le Pipeline CRM (@dnd-kit,
// carte + DragOverlay pour ne jamais être rognée par le cadre de sa
// colonne), en plus simple ici : 4 colonnes fixes, pas de réordonnancement
// de colonnes.

const COLUMNS: { id: InternalTaskStatus; label: string; accent: string }[] = [
  { id: 'a_faire', label: 'À faire', accent: '#38BDF8' },
  { id: 'en_cours', label: 'En cours', accent: '#F7BC5F' },
  { id: 'a_verifier', label: 'À vérifier', accent: '#A78BFA' },
  { id: 'termine', label: 'Terminé', accent: '#34D399' },
];

const PRIORITY_META: Record<InternalTask['priority'], { label: string; classes: string }> = {
  basse: { label: 'Basse', classes: 'bg-white/5 text-gray-400 border-white/10' },
  normale: { label: 'Normale', classes: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  haute: { label: 'Haute', classes: 'bg-[#F7BC5F]/15 text-[#F9C977] border-[#F7BC5F]/30' },
  urgente: { label: 'Urgente', classes: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

// Ticket "Refonte fiche tâche" (5/6) : phrase lisible pour chaque type
// d'entrée du journal d'activité (alimenté par un trigger Postgres — voir
// useTaskActivity).
function describeActivity(entry: { action: string; fromValue: string | null; toValue: string | null }): string {
  switch (entry.action) {
    case 'created':
      return `a créé la tâche "${entry.toValue}"`;
    case 'status_changed':
      return `a changé le statut : ${entry.fromValue || '—'} → ${entry.toValue || '—'}`;
    case 'priority_changed':
      return `a changé la priorité : ${entry.fromValue || '—'} → ${entry.toValue || '—'}`;
    case 'due_date_changed':
      return entry.toValue ? `a défini l'échéance au ${entry.toValue}` : "a retiré l'échéance";
    case 'collaborators_changed':
      return 'a modifié les personnes assignées';
    case 'title_changed':
      return `a renommé la tâche : "${entry.fromValue}" → "${entry.toValue}"`;
    default:
      return entry.action;
  }
}

const TaskCardContent: React.FC<{ task: InternalTask; users: NovaSphereUserProfile[]; onDelete?: (id: string) => void; onMove?: (id: string, status: InternalTaskStatus) => void; checklistCount?: { done: number; total: number }; messageCount?: number }> = ({
  task,
  users,
  onDelete,
  onMove,
  checklistCount,
  messageCount,
}) => {
  const collaborators = task.collaboratorIds
    .map((id) => users.find((u) => u.uid === id))
    .filter((u): u is NovaSphereUserProfile => Boolean(u));
  const overdue = task.dueDate && task.status !== 'termine' && new Date(task.dueDate) < new Date(new Date().toDateString());

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-bold text-white leading-snug">{task.title}</h4>
        <div className="flex items-center gap-1 shrink-0">
          {/* Signalé deux fois (31/08/2026) : « quand on met les cartes dans
              Terminé, on doit pouvoir les déplacer vers les colonnes que l'on
              souhaite pour retravailler sur le projet en cours ».
              Le glisser-déposer fonctionne à nouveau depuis le rétablissement
              du défilement automatique, mais tirer une carte sur trois
              colonnes reste pénible — impraticable au doigt. Ce menu déplace
              la carte en deux touches, depuis n'importe quelle colonne vers
              n'importe quelle autre. */}
          {onMove && (
            <select
              value={task.status}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => { e.stopPropagation(); onMove(task.id, e.target.value as InternalTaskStatus); }}
              title="Déplacer vers une autre colonne"
              className="bg-transparent border border-white/15 rounded-md text-[9px] text-gray-400 hover:text-white hover:border-[#F7BC5F]/50 px-1 py-0.5 cursor-pointer focus:outline-none"
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0E1A20] text-white">{c.label}</option>
              ))}
            </select>
          )}
          {onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} className="text-gray-600 hover:text-rose-300 shrink-0 p-0.5 -m-0.5">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {task.description && <p className="text-[11px] text-gray-400 mt-1.5 line-clamp-2">{task.description}</p>}
      <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
        <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${PRIORITY_META[task.priority].classes}`}>
          {PRIORITY_META[task.priority].label}
        </span>
        {task.dueDate && (
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${overdue ? 'bg-rose-500/15 text-rose-300 border-rose-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>
            <Calendar className="w-2.5 h-2.5" /> {new Date(task.dueDate).toLocaleDateString('fr-FR')}
          </span>
        )}
        {/* Ticket "Refonte fiche tâche" (4/6) : badge de progression, comme
            sur le modèle fourni (ex. "4/5") — masqué tant qu'aucun élément
            de checklist n'a été ajouté. */}
        {checklistCount && checklistCount.total > 0 && (
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${checklistCount.done === checklistCount.total ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-white/10'}`}>
            <CheckSquare className="w-2.5 h-2.5" /> {checklistCount.done}/{checklistCount.total}
          </span>
        )}
        {/* Ticket "Refonte fiche tâche" (6/6) : badge du nombre de messages,
            comme sur le modèle fourni. */}
        {Boolean(messageCount) && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 bg-white/5 text-gray-400 border-white/10">
            <MessageCircle className="w-2.5 h-2.5" /> {messageCount}
          </span>
        )}
      </div>
      {collaborators.length > 0 && (
        <div className="flex items-center -space-x-1.5 mt-2.5">
          {collaborators.map((u) => (
            <div
              key={u.uid}
              title={u.displayName}
              className="w-5 h-5 rounded-full bg-[#F7BC5F] text-[#20170a] text-[9px] font-black flex items-center justify-center border-2 border-[#0b1719] overflow-hidden"
            >
              {u.photoURL ? <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover" /> : initials(u.displayName)}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

// Signalé : "le déplacement des cartes saccade" — cause réelle trouvée :
// `useDroppable` (colonne survolée, `isOver`) change très fréquemment
// pendant un glisser (à chaque déplacement du pointeur), ce qui re-rend
// BoardColumn — qui recréait jusqu'ici une fonction `onOpen` DIFFÉRENTE à
// chaque fois pour CHAQUE carte de la colonne (`() => onOpenTask(task)`
// inline dans le `.map()`). Résultat : même en ajoutant React.memo,
// TOUTES les cartes de la colonne survolée se seraient quand même re-rendu
// à chaque frame, faute de props stables — c'est cette recréation en
// cascade (des dizaines de fois par seconde sur une colonne chargée) qui
// provoquait les saccades, pas le rendu de la carte déplacée elle-même
// (gérée séparément par DragOverlay, déjà performant). Fix : `onOpen`
// reçoit désormais la tâche en paramètre plutôt qu'une closure déjà liée,
// ce qui permet de passer `onOpenTask` tel quel (référence stable, un
// simple `setState`) — combiné à React.memo, une carte ne se re-rend plus
// que si SES PROPRES données changent.
// Demande explicite : "quand il y a plusieurs projets... pouvoir assigner un
// utilisateur plutôt que de les faire un par un" — mode sélection multiple
// (`selectable`) : le clic sur une carte coche/décoche au lieu d'ouvrir son
// détail, et un glisser-déposer désactivé pendant ce mode (sinon confusion
// entre "je sélectionne" et "je déplace"). `useDraggable` reste toujours
// appelé (règle des Hooks), seuls ses listeners sont omis du DOM en mode
// sélection.
const TaskCard = React.memo<{
  task: InternalTask;
  users: NovaSphereUserProfile[];
  onOpen: (task: InternalTask) => void;
  onDelete: (id: string) => void;
  onMove?: (id: string, status: InternalTaskStatus) => void;
  checklistCount?: { done: number; total: number };
  messageCount?: number;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}>(function TaskCard({
  task,
  users,
  onOpen,
  onDelete,
  onMove,
  checklistCount,
  messageCount,
  selectable,
  selected,
  onToggleSelect,
}) {
  // Demandé : « on ne peut pas faire un drop dans le vertical, il faudrait
  // qu'on ait la possibilité de mettre l'ordre qu'on a envie ». Les cartes
  // étaient de simples `useDraggable` : on pouvait changer de colonne, mais
  // pas se placer à un rang précis. `useSortable` donne le rang, la colonne
  // `position` (déjà présente en base et déjà relue triée) enregistre l'ordre.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task' as const, status: task.status },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(selectable ? {} : attributes)}
      {...(selectable ? {} : listeners)}
      onClick={() => (selectable ? onToggleSelect?.(task.id) : onOpen(task))}
      className={`relative p-3 rounded-xl bg-[#0b1719] border cursor-pointer transition-colors duration-150 touch-none select-none ${
        isDragging ? 'opacity-0' : selected ? 'border-[#F7BC5F] shadow-[0_0_0_2px_rgba(247,188,95,0.4)]' : 'border-white/10 hover:border-[#F7BC5F]/40 hover:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.5)]'
      }`}
    >
      {selectable && (
        <div
          className={`absolute top-2 right-2 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
            selected ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-gray-500 bg-black/30'
          }`}
        >
          {selected && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
        </div>
      )}
      <TaskCardContent task={task} users={users} onDelete={selectable ? undefined : onDelete} onMove={selectable ? undefined : onMove} checklistCount={checklistCount} messageCount={messageCount} />
    </div>
  );
});

const BoardColumn: React.FC<{
  column: (typeof COLUMNS)[number];
  tasks: InternalTask[];
  users: NovaSphereUserProfile[];
  onAddTask?: () => void;
  onOpenTask: (task: InternalTask) => void;
  onDeleteTask: (id: string) => void;
  onMoveTask?: (id: string, status: InternalTaskStatus) => void;
  checklistCounts: Record<string, { done: number; total: number }>;
  messageCounts: Record<string, number>;
  selectionMode?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}> = ({ column, tasks, users, onAddTask, onOpenTask, onDeleteTask, onMoveTask, checklistCounts, messageCounts, selectionMode, selectedTaskIds, onToggleSelect }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${column.id}`, data: { type: 'column', status: column.id } });
  return (
    // Demande explicite : même opacité que les colonnes du pipeline
    // commercial (Pipeline.tsx) — bleu canard plein (#0a1e20) au lieu du
    // gris quasi transparent (bg-white/5) d'origine.
    <div className="w-[85vw] max-w-[300px] sm:w-[280px] shrink-0 bg-[#0a1e20] border border-white/10 border-t-4 rounded-2xl overflow-hidden" style={{ borderTopColor: column.accent }}>
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-white">{column.label}</h3>
          <p className="text-[10px] text-gray-500">{tasks.length} tâche(s)</p>
        </div>
        {onAddTask && (
          <button onClick={onAddTask} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white" title="Ajouter une tâche">
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        style={{ boxShadow: isOver ? `inset 0 0 0 2px ${column.accent}88` : undefined, backgroundColor: isOver ? `${column.accent}0d` : undefined }}
        className="p-2.5 min-h-[140px] space-y-2 transition-shadow duration-150"
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            users={users}
            onOpen={onOpenTask}
            onDelete={onDeleteTask}
            onMove={onMoveTask}
            checklistCount={checklistCounts[task.id]}
            messageCount={messageCounts[task.id]}
            selectable={selectionMode}
            selected={selectedTaskIds?.has(task.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
        </SortableContext>
      </div>
    </div>
  );
};

interface InternalProjectBoardProps {
  // Ticket "Rôle Stagiaire" (phase 2) : { type: 'board' } = un projet précis
  // (usage normal, responsable) ; { type: 'mine' } = toutes les tâches
  // attribuées à l'utilisateur connecté, tous projets confondus (son
  // "pipeline de travail" de stagiaire) — même composant pour les deux.
  scope: InternalTasksScope;
  boardTitle: string;
  agencyId?: string;
  users: NovaSphereUserProfile[];
  onBack?: () => void;
  // Demandé : pouvoir renommer LE PROJET une fois ouvert (et non les
  // tableaux qu'il contient). Le renommage n'existait que dans la liste.
  onRenamed?: (title: string) => void;
  // En mode "mine", créer/supprimer une tâche n'a pas de sens pour le
  // stagiaire (RLS l'interdit déjà, mais on évite aussi de montrer un
  // bouton qui échouerait systématiquement).
  canCreateTasks?: boolean;
  // Ouvre directement la fiche détail de cette tâche dès qu'elle est
  // chargée — voir ProjetsInternes.tsx, `initialOpenTaskId` (clic sur une
  // notification de message posté sur une carte).
  initialOpenTaskId?: string | null;
  onOpenTaskConsumed?: () => void;
}

export const InternalProjectBoard: React.FC<InternalProjectBoardProps> = ({ scope, boardTitle, agencyId, users, onBack, onRenamed, canCreateTasks = true, initialOpenTaskId, onOpenTaskConsumed }) => {
  const [title, setTitle] = useState(boardTitle);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(boardTitle);
  useEffect(() => { setTitle(boardTitle); setRenameValue(boardTitle); }, [boardTitle]);

  // Demandé : « tous les tableaux créés à l'intérieur du projet Sarah
  // doivent être affiliés automatiquement à Sarah et Mélanie ». Plutôt que
  // d'inscrire deux noms dans le code — c'est exactement ce qui a rendu
  // l'attribution des contacts inutilisable — chaque projet porte sa propre
  // équipe par défaut, réglable depuis son en-tête. Toute tâche créée dans
  // le projet part avec ces personnes déjà assignées.
  const [defaultCollaborators, setDefaultCollaborators] = useState<string[]>([]);
  const [showDefaultTeam, setShowDefaultTeam] = useState(false);

  useEffect(() => {
    if (scope.type !== 'board') return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('task_boards')
        .select('default_collaborator_ids')
        .eq('id', scope.boardId)
        .maybeSingle();
      if (cancelled) return;
      setDefaultCollaborators(((data?.default_collaborator_ids as string[]) || []).filter(Boolean));
    })().catch(() => { /* colonne absente : on reste sans équipe par défaut */ });
    return () => { cancelled = true; };
  }, [scope]);

  const saveDefaultCollaborators = async (next: string[]) => {
    if (scope.type !== 'board') return;
    const previous = defaultCollaborators;
    setDefaultCollaborators(next);
    const { error } = await supabase
      .from('task_boards')
      .update({ default_collaborator_ids: next })
      .eq('id', scope.boardId);
    if (error) {
      setDefaultCollaborators(previous);
      toast.error("Impossible d'enregistrer l'équipe par défaut : " + error.message);
    }
  };

  const saveTitle = async () => {
    const next = renameValue.trim();
    setRenaming(false);
    if (!next || next === title || scope.type !== 'board') { setRenameValue(title); return; }
    const previous = title;
    setTitle(next);
    const { error } = await supabase.from('task_boards').update({ name: next }).eq('id', scope.boardId);
    if (error) {
      setTitle(previous);
      setRenameValue(previous);
      toast.error("Impossible de renommer ce projet : " + error.message);
      return;
    }
    onRenamed?.(next);
  };
  const { tasks, isLoading, addTask, updateTask, deleteTask, setTaskStatusOptimistic } = useInternalProjectTasks(scope);
  const checklistCounts = useChecklistCounts(tasks.map((t) => t.id));
  const messageCounts = useTaskMessageCounts(tasks.map((t) => t.id));
  const [activeDragTask, setActiveDragTask] = useState<InternalTask | null>(null);
  const [showAddFor, setShowAddFor] = useState<InternalTaskStatus | null>(null);
  const [openTask, setOpenTask] = useState<InternalTask | null>(null);
  useEffect(() => {
    if (!initialOpenTaskId || isLoading) return;
    const tache = tasks.find((t) => t.id === initialOpenTaskId);
    if (tache) setOpenTask(tache);
    onOpenTaskConsumed?.();
  }, [initialOpenTaskId, isLoading, tasks]);

  // Demande explicite : "pouvoir assigner un utilisateur... plutôt que de
  // les faire un par un [si] plusieurs projets [tâches]" — mode sélection
  // multiple + assignation groupée.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);

  const toggleSelectionMode = () => {
    setSelectionMode((v) => !v);
    setSelectedTaskIds(new Set());
  };

  const toggleTaskSelected = (id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkAssign = async (userId: string) => {
    const targets = tasks.filter((t) => selectedTaskIds.has(t.id));
    if (targets.length === 0 || !userId) return;
    setBulkAssigning(true);
    try {
      const results = await Promise.allSettled(
        targets.map((t) => {
          const nextIds = t.collaboratorIds.includes(userId) ? t.collaboratorIds : [...t.collaboratorIds, userId];
          return updateTask.mutateAsync({ id: t.id, updates: { collaboratorIds: nextIds } });
        })
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const userName = users.find((u) => u.uid === userId)?.displayName || 'cet utilisateur';
      if (failed === 0) {
        toast.success(`${targets.length} tâche(s) assignée(s) à ${userName}.`);
      } else {
        toast.error(`${failed} assignation(s) sur ${targets.length} ont échoué.`);
      }
    } finally {
      setBulkAssigning(false);
      setSelectionMode(false);
      setSelectedTaskIds(new Set());
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  // Signalé : "ça saccade encore, va-et-vient, la carte ne se pose pas
  // directement sur la prochaine colonne" — cause réelle : `closestCenter`
  // choisit la colonne dont le CENTRE est le plus proche du pointeur, ce
  // qui oscille entre deux colonnes voisines tant que le pointeur est près
  // de leur frontière (typique avec des colonnes de largeur similaire côte
  // à côte). `pointerWithin` teste directement "le pointeur est-il dans
  // cette colonne", sans ambiguïté ni oscillation — on ne retombe sur
  // `rectIntersection` que si le pointeur est momentanément hors de toute
  // colonne (glisser rapide), pour ne jamais perdre la cible.
  const collisionDetectionStrategy: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return rectIntersection(args);
  };

  // Demande explicite (14 septembre, Novavisio) : « je veux que cela soit
  // classé par priorité des urgences. Urgences, puis haute puis normal ».
  // Tri primaire par priorité (urgente → haute → normale → basse, non
  // demandée mais logiquement en dernier) ; `position` (l'ordre manuel du
  // glisser-déposer) ne sert plus qu'à départager les cartes de MÊME
  // priorité, pour ne pas perdre le rangement manuel à l'intérieur d'un
  // niveau de priorité.
  const ORDRE_PRIORITE: Record<InternalTaskPriority, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };
  const tasksByStatus = (status: InternalTaskStatus) =>
    tasks
      .filter((t) => t.status === status)
      .sort((a, b) => {
        const parPriorite = ORDRE_PRIORITE[a.priority] - ORDRE_PRIORITE[b.priority];
        if (parPriorite !== 0) return parPriorite;
        return (a.position ?? 0) - (b.position ?? 0);
      });

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === String(event.active.id));
    setActiveDragTask(task || null);
  };

  // Enregistre l'ordre d'une colonne : un rang par carte, dans l'ordre reçu.
  const persistOrder = (orderedIds: string[]) => {
    void Promise.all(
      orderedIds.map((id, index) => updateTask.mutateAsync({ id, updates: { position: index } }))
    ).catch((err: any) => {
      toast.error(err?.message || "Impossible d'enregistrer le nouvel ordre.");
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const overId = over ? String(over.id) : '';
    const task = tasks.find((t) => t.id === String(active.id));

    // Lâcher sur une AUTRE CARTE = choisir son rang, éventuellement dans une
    // autre colonne. Lâcher sur le fond d'une colonne = y placer la carte en
    // dernier, comme avant.
    const overTask = tasks.find((t) => t.id === overId);
    if (task && overTask) {
      const targetStatus = overTask.status;
      const column = tasksByStatus(targetStatus).map((t) => t.id);
      const from = column.indexOf(task.id);
      const to = column.indexOf(overTask.id);

      setActiveDragTask(null);
      if (task.status !== targetStatus) {
        setTaskStatusOptimistic(task.id, targetStatus);
        const next = [...column];
        next.splice(to, 0, task.id);
        void updateTask
          .mutateAsync({ id: task.id, updates: { status: targetStatus } })
          .then(() => persistOrder(next))
          .catch((err: any) => toast.error(err?.message || "Impossible de déplacer cette tâche."));
        return;
      }
      if (from === -1 || to === -1 || from === to) return;
      persistOrder(arrayMove(column, from, to));
      return;
    }

    const destinationStatus = overId.startsWith('column-') ? (overId.slice('column-'.length) as InternalTaskStatus) : null;

    // Signalé : "léger flash quand je déplace la carte" — la carte doit
    // basculer dans sa nouvelle colonne EXACTEMENT au moment où la vignette
    // flottante disparaît, sans le moindre décalage d'un rendu à l'autre.
    // On applique donc le nouveau statut de façon synchrone, dans ce même
    // clic, AVANT même de faire disparaître la vignette (setActiveDragTask)
    // — la persistance en base suit juste après, en tâche de fond.
    if (task && destinationStatus && task.status !== destinationStatus) {
      setTaskStatusOptimistic(task.id, destinationStatus);
    }
    setActiveDragTask(null);

    if (task && destinationStatus && task.status !== destinationStatus) {
      updateTask.mutateAsync({ id: task.id, updates: { status: destinationStatus } }).catch((err: any) => {
        toast.error(err?.message || "Impossible de déplacer cette tâche.");
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors" title="Retour aux projets">
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTitle();
                if (e.key === 'Escape') { setRenameValue(title); setRenaming(false); }
              }}
              className="w-full max-w-md bg-white/5 border border-[#F7BC5F]/50 rounded-lg px-2 py-1 text-lg font-bold text-white focus:outline-none focus:border-[#F7BC5F]"
            />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{title}</h2>
              {scope.type === 'board' && (
                <button
                  onClick={() => { setRenameValue(title); setRenaming(true); }}
                  className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-[#F7BC5F] hover:bg-[#F7BC5F]/10 transition-colors"
                  title="Renommer le projet"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400">{tasks.length} tâche(s) au total</p>
        </div>
        {scope.type === 'board' && canCreateTasks && (
          <button
            onClick={() => setShowDefaultTeam(true)}
            className="shrink-0 px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors bg-white/5 border-white/10 text-gray-300 hover:text-white hover:bg-white/10"
            title="Personnes assignées d'office à chaque nouvelle tâche de ce projet"
          >
            <UsersIcon className="w-3.5 h-3.5" />
            Équipe par défaut{defaultCollaborators.length > 0 ? ` (${defaultCollaborators.length})` : ''}
          </button>
        )}
        {canCreateTasks && tasks.length > 0 && (
          <button
            onClick={toggleSelectionMode}
            className={`shrink-0 px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
              selectionMode
                ? 'bg-[#F7BC5F] border-[#F7BC5F] text-black'
                : 'bg-white/5 border-white/10 text-gray-300 hover:text-white hover:bg-white/10'
            }`}
            title="Sélectionner plusieurs tâches pour les assigner d'un coup"
          >
            <UsersIcon className="w-3.5 h-3.5" />
            {selectionMode ? 'Annuler la sélection' : 'Assigner en masse'}
          </button>
        )}
      </div>

      {/* Demande explicite : "pouvoir assigner un utilisateur... plutôt que
          de les faire un par un" — barre flottante d'assignation groupée,
          visible dès qu'au moins une tâche est cochée en mode sélection. */}
      {selectionMode && selectedTaskIds.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#F7BC5F] text-black shadow-lg">
          <span className="text-xs font-bold">{selectedTaskIds.size} tâche(s) sélectionnée(s)</span>
          <div className="flex-1" />
          {bulkAssigning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <select
              onChange={(e) => { if (e.target.value) void handleBulkAssign(e.target.value); }}
              defaultValue=""
              className="text-xs font-bold rounded-lg border border-black/20 bg-white/90 text-black px-2 py-1.5 focus:outline-none"
            >
              <option value="" disabled>Assigner à...</option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>
              ))}
            </select>
          )}
          <button onClick={() => setSelectedTaskIds(new Set())} className="text-xs font-bold underline underline-offset-2">
            Désélectionner tout
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 flex items-center justify-center gap-3 text-gray-400 bg-white/5 border border-white/10 rounded-2xl">
          <Loader2 className="w-6 h-6 animate-spin text-[#F7BC5F]" />
          <span className="text-xs">Chargement des tâches...</span>
        </div>
      ) : (
        <DndContext
          // Signalé (31/08/2026) : "quand on met les cartes dans Terminé, on
          // ne peut pas les rebasculer sur les colonnes de gauche". Cause :
          // autoScroll etait desactive. Les quatre colonnes defilent
          // horizontalement et "Termine" est la derniere, tout a droite : pour
          // ramener une carte vers "A faire", il faut que le tableau defile
          // PENDANT le glissement, sans quoi la colonne de destination reste
          // hors ecran et physiquement inatteignable. Le defilement
          // automatique est donc retabli.
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <div className="flex gap-3 overflow-x-auto pb-4 -webkit-overflow-scrolling-touch touch-pan-x">
            {COLUMNS.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                tasks={tasksByStatus(column.id)}
                users={users}
                onAddTask={canCreateTasks ? () => setShowAddFor(column.id) : undefined}
                onOpenTask={setOpenTask}
                onDeleteTask={(id) => {
                  deleteTask.mutateAsync(id).catch((err: any) => {
                    toast.error(err?.message || "Impossible de supprimer cette tâche.");
                  });
                }}
                onMoveTask={(id, status) => {
                  // Même bascule optimiste que le glisser-déposer : la carte
                  // change de colonne immédiatement, la base suit derrière.
                  setTaskStatusOptimistic(id, status);
                  updateTask.mutateAsync({ id, updates: { status } }).catch((err: any) => {
                    toast.error(err?.message || "Impossible de déplacer cette tâche.");
                  });
                }}
                checklistCounts={checklistCounts}
                messageCounts={messageCounts}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleSelect={toggleTaskSelected}
              />
            ))}
          </div>
          {/* Signalé : "la carte fait un rebond sur la colonne d'origine
              dès qu'elle passe dans la suivante, elle doit rester tenue par
              la souris et suivre le déplacement" — cause réelle : sans
              `dropAnimation` explicite, dnd-kit essaie par défaut d'animer
              le retour de la vignette flottante vers la position finale
              d'un élément "sortable" — il retombait visiblement vers son
              point de départ avant
              de disparaître, provoquant ce rebond parasite. Le désactiver
              entièrement fait disparaître la vignette instantanément au
              lâcher, exactement là où la souris l'a lâchée. */}
          <DragOverlay dropAnimation={null}>
            {activeDragTask ? (
              <div className="p-3 rounded-xl bg-[#0b1719] border border-[#F7BC5F]/60 shadow-[0_20px_36px_-10px_rgba(0,0,0,0.7)] w-[260px] cursor-grabbing">
                <TaskCardContent task={activeDragTask} users={users} checklistCount={checklistCounts[activeDragTask.id]} messageCount={messageCounts[activeDragTask.id]} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {showAddFor && scope.type === 'board' && (
        <AddTaskModal
          status={showAddFor}
          users={users}
          initialCollaboratorIds={defaultCollaborators}
          onClose={() => setShowAddFor(null)}
          onCreate={async (payload) => {
            await addTask.mutateAsync({ boardId: scope.boardId, agencyId: agencyId || '', ...payload });
            setShowAddFor(null);
          }}
        />
      )}

      {showDefaultTeam && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowDefaultTeam(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#07191b] border border-[#1b4e52] rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-white/10">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UsersIcon className="w-4 h-4 text-[#F9C977]" /> Équipe par défaut
              </h3>
              <p className="text-[11px] text-gray-400 mt-1">
                Ces personnes sont assignées d'office à chaque nouvelle tâche de ce projet. Elles
                restent modifiables tâche par tâche.
              </p>
            </div>
            <div className="overflow-y-auto custom-scrollbar p-3 space-y-1.5">
              {users.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-500">Aucun collaborateur disponible.</p>
              ) : (
                users.map((u) => {
                  const selected = defaultCollaborators.includes(u.uid);
                  return (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() =>
                        void saveDefaultCollaborators(
                          selected
                            ? defaultCollaborators.filter((id) => id !== u.uid)
                            : [...defaultCollaborators, u.uid]
                        )
                      }
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                        selected ? 'border-[#F7BC5F] bg-[#F7BC5F]/10' : 'border-white/10 bg-white/5 hover:border-white/25'
                      }`}
                    >
                      <span className="text-sm text-white truncate">{u.displayName}</span>
                      {selected && <Check className="w-4 h-4 text-[#F7BC5F] shrink-0" strokeWidth={3} />}
                    </button>
                  );
                })
              )}
            </div>
            <div className="p-3 border-t border-white/10">
              <button
                onClick={() => setShowDefaultTeam(false)}
                className="w-full px-4 py-2.5 rounded-xl bg-[#F7BC5F] hover:bg-[#F9C977] text-slate-950 font-bold text-sm"
              >
                Terminé
              </button>
            </div>
          </div>
        </div>
      )}

      {openTask && (
        <TaskDetailModal
          task={openTask}
          users={users}
          onClose={() => setOpenTask(null)}
          onSave={async (updates) => {
            await updateTask.mutateAsync({ id: openTask.id, updates });
            setOpenTask(null);
          }}
          onDelete={async () => {
            await deleteTask.mutateAsync(openTask.id);
            setOpenTask(null);
          }}
        />
      )}
    </div>
  );
};

const AddTaskModal: React.FC<{
  status: InternalTaskStatus;
  users: NovaSphereUserProfile[];
  // Équipe par défaut du projet : pré-cochée, et modifiable tâche par tâche.
  initialCollaboratorIds?: string[];
  onClose: () => void;
  onCreate: (payload: { title: string; description?: string; priority?: InternalTask['priority']; dueDate?: string | null; collaboratorIds?: string[] }) => Promise<void>;
}> = ({ status, users, initialCollaboratorIds = [], onClose, onCreate }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<InternalTask['priority']>('normale');
  const [dueDate, setDueDate] = useState('');
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(initialCollaboratorIds);
  const [saving, setSaving] = useState(false);
  const columnLabel = COLUMNS.find((c) => c.id === status)?.label || status;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate({ title, description, priority, dueDate: dueDate || null, collaboratorIds });
    } catch (err: any) {
      // Ticket "Projets internes" (suivi) : avant, une erreur ici ne
      // montrait rien du tout — la modale se figeait sans explication,
      // perçu comme "je ne peux pas enregistrer".
      toast.error(err?.message || "Impossible de créer cette tâche.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-[#F7BC5F]">Nouvelle tâche · {columnLabel}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre de la tâche" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optionnelle)" rows={3} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] resize-none" />
          <div className="grid grid-cols-2 gap-3">
            <select value={priority} onChange={(e) => setPriority(e.target.value as InternalTask['priority'])} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]">
              {Object.entries(PRIORITY_META).map(([value, meta]) => (
                <option key={value} value={value} className="bg-[#0E1A20]">{meta.label}</option>
              ))}
            </select>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Assignés ({collaboratorIds.length})</label>
              {users.some((u) => !collaboratorIds.includes(u.uid)) && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setCollaboratorIds((prev) => [...prev, e.target.value]);
                  }}
                  className="text-[11px] bg-[#F7BC5F]/15 border border-[#F7BC5F]/40 text-[#F9C977] font-bold rounded-lg px-2 py-1 focus:outline-none"
                >
                  <option value="" className="bg-[#0E1A20] text-gray-300">+ Assigner</option>
                  {users.filter((u) => !collaboratorIds.includes(u.uid)).map((u) => (
                    <option key={u.uid} value={u.uid} className="bg-[#0E1A20] text-white">{u.displayName}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="mt-2 space-y-1.5 max-h-28 overflow-y-auto">
              {collaboratorIds.length === 0 && (
                <p className="text-xs text-gray-500">Aucun assigné</p>
              )}
              {collaboratorIds.map((id) => {
                const u = users.find((x) => x.uid === id);
                if (!u) return null;
                return (
                  <div key={id} className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-[#F7BC5F] text-[#20170a] text-[9px] font-black flex items-center justify-center overflow-hidden shrink-0">
                        {u.photoURL ? <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover" /> : initials(u.displayName)}
                      </div>
                      <span className="text-xs text-gray-200 truncate">{u.displayName}</span>
                    </div>
                    <button type="button" onClick={() => setCollaboratorIds((prev) => prev.filter((x) => x !== id))} className="text-gray-500 hover:text-rose-300 shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-white hover:bg-white/5">Annuler</button>
            <button type="submit" disabled={!title.trim() || saving} className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-black text-xs font-bold flex items-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Créer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TaskDetailModal: React.FC<{
  task: InternalTask;
  users: NovaSphereUserProfile[];
  onClose: () => void;
  onSave: (updates: Partial<InternalTask>) => Promise<void>;
  onDelete: () => Promise<void>;
}> = ({ task, users, onClose, onSave, onDelete }) => {
  // Audit responsive tablette (9 septembre) : le bouton "supprimer cette
  // ligne de checklist" n'était visible qu'au survol — invisible ET
  // inatteignable sur une tablette tactile (pas de souris). Corrigé une
  // première fois pour le tactile, puis rendu TOUJOURS visible (14
  // septembre, capture à l'appui) — même sur ordinateur, le survol seul
  // ne suffisait pas à le rendre découvrable.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : '');
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>(task.collaboratorIds);
  const [saving, setSaving] = useState(false);
  const creator = users.find((u) => u.uid === task.createdBy);
  // Ticket "Refonte fiche tâche" (2/6) : structure en onglets, comme sur le
  // modèle fourni. Checklist/Chat/Activité sont des coquilles pour l'instant
  // (rendues fonctionnelles dans les tickets #132/#134/#133) — pas de fausse
  // promesse : on affiche "bientôt disponible" plutôt qu'un onglet muet.
  const [tab, setTab] = useState<'details' | 'checklist' | 'chat' | 'activite'>('details');
  // Ticket "Refonte fiche tâche" (4/6) : checklist désormais fonctionnelle.
  const { items: checklistItems, addItem: addChecklistItem, toggleItem: toggleChecklistItem, deleteItem: deleteChecklistItem } = useTaskChecklist(task.id);
  const { entries: activityEntries } = useTaskActivity(task.id);
  // Ticket "Refonte fiche tâche" (6/6) : chat par tâche.
  const { currentUser, userProfile } = useAuth();
  // Audit (10 septembre) : « ça ne charge pas » — cet onglet affichait
  // "Aucun message pour l'instant." pendant le chargement lui-même,
  // indiscernable d'une conversation réellement vide (isLoading était
  // récupéré par le hook mais jamais utilisé ici).
  const { messages: chatMessages, isLoading: chatMessagesLoading, send: sendChatMessage } = useTaskMessages(task.id);
  const [chatDraft, setChatDraft] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [uploadingChatMedia, setUploadingChatMedia] = useState(false);
  const [isRecordingChat, setIsRecordingChat] = useState(false);
  // Ticket "Refonte fiche tâche" (suivi) : aperçu œil en plein cadre pour les
  // photos du chat, même comportement que la prévisualisation Documents.
  const [chatLightboxUrl, setChatLightboxUrl] = useState<string | null>(null);
  const [recordingChatSeconds, setRecordingChatSeconds] = useState(0);
  const chatImageInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chatAudioChunksRef = useRef<Blob[]>([]);
  const chatRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (tab === 'chat') chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages.length, tab]);

  const sendChatText = async () => {
    if (!chatDraft.trim() || !currentUser || sendingChat) return;
    setSendingChat(true);
    try {
      await sendChatMessage.mutateAsync({ userId: currentUser.uid, kind: 'text', body: chatDraft.trim() });
      setChatDraft('');
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'envoyer ce message.");
    } finally {
      setSendingChat(false);
    }
  };

  const handleChatImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      setUploadingChatMedia(true);
      try {
        await sendChatMessage.mutateAsync({ userId: currentUser.uid, kind: 'image', attachmentUrl: dataUrl, attachmentMime: file.type });
      } catch (err: any) {
        toast.error(err?.message || "Impossible d'envoyer cette image.");
      } finally {
        setUploadingChatMedia(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleChatFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      setUploadingChatMedia(true);
      try {
        await sendChatMessage.mutateAsync({ userId: currentUser.uid, kind: 'file', attachmentUrl: dataUrl, attachmentMime: file.type, body: file.name });
      } catch (err: any) {
        toast.error(err?.message || "Impossible d'envoyer ce document.");
      } finally {
        setUploadingChatMedia(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const startRecordingChat = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickVoiceMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chatMediaRecorderRef.current = recorder;
      chatAudioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chatAudioChunksRef.current.push(e.data); };
      recorder.start(100);
      setIsRecordingChat(true);
      setRecordingChatSeconds(0);
      chatRecordingTimerRef.current = setInterval(() => setRecordingChatSeconds((s) => s + 1), 1000);
    } catch {
      toast.error('Micro indisponible ou refusé.');
    }
  };

  const stopRecordingChat = async (cancel = false) => {
    const recorder = chatMediaRecorderRef.current;
    if (chatRecordingTimerRef.current) { clearInterval(chatRecordingTimerRef.current); chatRecordingTimerRef.current = null; }
    const duration = recordingChatSeconds;
    setIsRecordingChat(false);
    setRecordingChatSeconds(0);
    if (!recorder || recorder.state === 'inactive') return;

    if (cancel) {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
      chatAudioChunksRef.current = [];
      return;
    }

    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chatAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        if (!currentUser) return;
        setUploadingChatMedia(true);
        try {
          await sendChatMessage.mutateAsync({ userId: currentUser.uid, kind: 'voice', attachmentUrl: dataUrl, attachmentMime: recorder.mimeType || 'audio/webm', attachmentDuration: duration });
        } catch (err: any) {
          toast.error(err?.message || "Impossible d'envoyer ce message vocal.");
        } finally {
          setUploadingChatMedia(false);
        }
      };
      reader.readAsDataURL(blob);
    };
    recorder.stop();
  };
  const [newChecklistText, setNewChecklistText] = useState('');
  const [addingChecklistItem, setAddingChecklistItem] = useState(false);

  const submitChecklistItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChecklistText.trim() || addingChecklistItem) return;
    setAddingChecklistItem(true);
    try {
      await addChecklistItem.mutateAsync(newChecklistText);
      setNewChecklistText('');
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'ajouter cet élément.");
    } finally {
      setAddingChecklistItem(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ title, description, status, priority, dueDate: dueDate || null, collaboratorIds });
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'enregistrer cette tâche.");
    } finally {
      setSaving(false);
    }
  };

  const TABS: { id: typeof tab; label: string }[] = [
    { id: 'details', label: 'Détails' },
    { id: 'checklist', label: `Checklist (${checklistItems.length})` },
    { id: 'chat', label: chatMessages.length ? `Chat (${chatMessages.length})` : 'Chat' },
    { id: 'activite', label: 'Activité' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      {/* Signalé : fenêtre trop resserrée pour écrire confortablement dans
          le chat — élargie et un peu plus haute, moins d'effet "compressé". */}
      {/* Signalé : sur un écran plus petit, la barre d'envoi du chat
          (photo/pièce jointe/micro/texte) se retrouvait coupée en bas de la
          fenêtre — le défilement global de la carte (overflow-y-auto ici)
          rognait le dernier élément au lieu de ne faire défiler QUE le
          contenu de l'onglet actif. La carte ne défile plus elle-même
          (overflow-hidden) ; c'est la zone d'onglet ci-dessous qui défile,
          donc la barre d'envoi reste toujours entièrement visible, ancrée
          en bas. */}
      <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-2xl w-full p-6 sm:p-7 text-white max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-[#F7BC5F]">Modifier la tâche</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {creator && (
          <p className="text-[11px] text-gray-500 mb-3 flex items-center gap-1.5"><User className="w-3 h-3" /> Créée par {creator.displayName} le {new Date(task.createdAt).toLocaleDateString('fr-FR')}</p>
        )}
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm font-semibold text-white focus:outline-none focus:border-[#F7BC5F] mb-3" />
          {/* Ticket "Refonte fiche tâche" (1/6) : le statut se changeait
              jusqu'ici uniquement en glissant la carte dans le tableau —
              ajouté ici en menu déroulant, comme sur le modèle fourni. */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <select value={status} onChange={(e) => setStatus(e.target.value as InternalTaskStatus)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]">
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0E1A20]">{c.label}</option>
              ))}
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value as InternalTask['priority'])} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]">
              {Object.entries(PRIORITY_META).map(([value, meta]) => (
                <option key={value} value={value} className="bg-[#0E1A20]">{meta.label}</option>
              ))}
            </select>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F]" />
          </div>

          {/* Ticket "Refonte fiche tâche" (2/6) : onglets Détails / Checklist
              / Chat / Activité, comme sur le modèle fourni. */}
          <div className="flex gap-1 border-b border-white/10 mb-4 -mx-1 px-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-xs font-bold whitespace-nowrap rounded-t-lg transition-colors ${tab === t.id ? 'bg-white/10 text-[#F9C977]' : 'text-gray-400 hover:text-white'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={`flex-1 min-h-[220px] ${tab === 'chat' ? 'flex flex-col' : 'overflow-y-auto'}`}>
            {tab === 'details' && (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Description</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full mt-1.5 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#F7BC5F] resize-none" />
                </div>
                <div>
                  {/* Ticket "Refonte fiche tâche" (3/6) : la liste de puces à
                      cocher devenait illisible avec le nombre d'utilisateurs
                      ("la liste est beaucoup trop longue à force") —
                      remplacée par un menu déroulant "Assigner" + liste des
                      personnes déjà assignées, comme sur le modèle fourni. */}
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Assignés ({collaboratorIds.length})</label>
                    {users.some((u) => !collaboratorIds.includes(u.uid)) && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setCollaboratorIds((prev) => [...prev, e.target.value]);
                        }}
                        className="text-[11px] bg-[#F7BC5F]/15 border border-[#F7BC5F]/40 text-[#F9C977] font-bold rounded-lg px-2 py-1 focus:outline-none"
                      >
                        <option value="" className="bg-[#0E1A20] text-gray-300">+ Assigner</option>
                        {users.filter((u) => !collaboratorIds.includes(u.uid)).map((u) => (
                          <option key={u.uid} value={u.uid} className="bg-[#0E1A20] text-white">{u.displayName}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto">
                    {collaboratorIds.length === 0 && (
                      <p className="text-xs text-gray-500">Aucun assigné</p>
                    )}
                    {collaboratorIds.map((id) => {
                      const u = users.find((x) => x.uid === id);
                      if (!u) return null;
                      return (
                        <div key={id} className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 h-5 rounded-full bg-[#F7BC5F] text-[#20170a] text-[9px] font-black flex items-center justify-center overflow-hidden shrink-0">
                              {u.photoURL ? <img src={u.photoURL} alt={u.displayName} className="w-full h-full object-cover" /> : initials(u.displayName)}
                            </div>
                            <span className="text-xs text-gray-200 truncate">{u.displayName}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCollaboratorIds((prev) => prev.filter((x) => x !== id))}
                            className="text-gray-500 hover:text-rose-300 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {tab === 'checklist' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void submitChecklistItem(e); }
                    }}
                    placeholder="Ajouter un élément..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                  <button
                    type="button"
                    onClick={(e) => void submitChecklistItem(e)}
                    disabled={!newChecklistText.trim() || addingChecklistItem}
                    className="w-9 h-9 shrink-0 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-black flex items-center justify-center disabled:opacity-50"
                  >
                    {addingChecklistItem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {checklistItems.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-6">Aucun élément pour l'instant.</p>
                  )}
                  {checklistItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 group">
                      <button
                        type="button"
                        onClick={() => toggleChecklistItem.mutate({ id: item.id, isDone: !item.isDone })}
                        className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${item.isDone ? 'bg-[#F7BC5F] border-[#F7BC5F]' : 'border-white/30 hover:border-[#F7BC5F]'}`}
                      >
                        {item.isDone && <CheckSquare className="w-3 h-3 text-black" />}
                      </button>
                      <span className={`text-xs flex-1 min-w-0 truncate ${item.isDone ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{item.text}</span>
                      {/* Demande explicite (14 septembre, capture à l'appui)
                          : "je veux avoir la possibilité de la supprimer
                          quand elle est créée" — le bouton existait déjà
                          mais restait invisible tant que la souris ne
                          survolait pas la ligne (opacity-0 group-hover),
                          sans aucun indice qu'il existe. Toujours visible
                          désormais, plus seulement sur tactile. */}
                      <button
                        type="button"
                        onClick={() => deleteChecklistItem.mutate(item.id)}
                        title="Supprimer cet élément"
                        className="text-gray-500 hover:text-rose-300 shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab === 'chat' && (
              <div className="flex flex-col flex-1 min-h-0">
                <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                  {chatMessagesLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-gray-500 text-xs">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement…
                    </div>
                  ) : chatMessages.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-8">Aucun message pour l'instant.</p>
                  )}
                  {chatMessages.map((m) => {
                    const sender = users.find((u) => u.uid === m.userId);
                    const isMe = m.userId === currentUser?.uid;
                    return (
                      <div key={m.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                        <div className="w-6 h-6 rounded-full bg-white/10 text-gray-300 text-[9px] font-black flex items-center justify-center overflow-hidden shrink-0">
                          {sender ? (sender.photoURL ? <img src={sender.photoURL} alt={sender.displayName} className="w-full h-full object-cover" /> : initials(sender.displayName)) : '?'}
                        </div>
                        <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-gray-400">{isMe ? 'Vous' : sender?.displayName || 'Quelqu\'un'}</span>
                            <span className="text-[9px] text-gray-600">{new Date(m.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className={`rounded-2xl px-3 py-2 text-xs ${isMe ? 'bg-[#F7BC5F]/15 text-[#F9C977] border border-[#F7BC5F]/30' : 'bg-white/5 text-gray-200 border border-white/10'}`}>
                            {m.kind === 'text' && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
                            {m.kind === 'image' && m.attachmentUrl && (
                              <button
                                type="button"
                                onClick={() => setChatLightboxUrl(m.attachmentUrl)}
                                className="relative block group/img"
                                title="Agrandir"
                              >
                                <img src={m.attachmentUrl} alt="Pièce jointe" className="max-w-[200px] rounded-lg" />
                                <span className="absolute inset-0 rounded-lg bg-black/0 group-hover/img:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover/img:opacity-100">
                                  <Eye className="w-5 h-5 text-white" />
                                </span>
                              </button>
                            )}
                            {m.kind === 'voice' && m.attachmentUrl && (
                              <div className="flex items-center gap-2">
                                <audio src={m.attachmentUrl} controls className="max-w-[200px] h-8" />
                                {m.attachmentDuration ? <span className="text-[9px] text-gray-500">{m.attachmentDuration}s</span> : null}
                              </div>
                            )}
                            {m.kind === 'file' && m.attachmentUrl && (
                              <a href={m.attachmentUrl} download={m.body || 'document'} className="flex items-center gap-1.5 underline">
                                <Paperclip className="w-3 h-3 shrink-0" /> {m.body || 'Document'}
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 pt-3 mt-1 border-t border-white/10">
                  <input ref={chatImageInputRef} type="file" accept="image/*" hidden onChange={handleChatImageSelected} />
                  <input ref={chatFileInputRef} type="file" hidden onChange={handleChatFileSelected} />
                  <button type="button" onClick={() => chatImageInputRef.current?.click()} disabled={uploadingChatMedia} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-40 shrink-0" title="Envoyer une image">
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => chatFileInputRef.current?.click()} disabled={uploadingChatMedia} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-40 shrink-0" title="Joindre un document">
                    <Paperclip className="w-4 h-4" />
                  </button>
                  {isRecordingChat ? (
                    <button type="button" onClick={() => void stopRecordingChat(false)} className="p-2 rounded-lg bg-rose-500/20 text-rose-300 shrink-0 flex items-center gap-1" title="Arrêter et envoyer">
                      <Square className="w-4 h-4" /> <span className="text-[10px] font-bold">{recordingChatSeconds}s</span>
                    </button>
                  ) : (
                    <button type="button" onClick={() => void startRecordingChat()} disabled={uploadingChatMedia} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-40 shrink-0" title="Note vocale">
                      <Mic className="w-4 h-4" />
                    </button>
                  )}
                  <input
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChatText(); }
                    }}
                    placeholder="Écrire un message..."
                    className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F7BC5F]"
                  />
                  <button
                    type="button"
                    onClick={() => void sendChatText()}
                    disabled={!chatDraft.trim() || sendingChat}
                    className="w-8 h-8 shrink-0 rounded-lg bg-[#F7BC5F] hover:bg-[#d9ab38] text-black flex items-center justify-center disabled:opacity-50"
                  >
                    {sendingChat ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
            {tab === 'activite' && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {activityEntries.length === 0 && (
                  <p className="text-xs text-gray-500 text-center py-8">Aucune activité</p>
                )}
                {activityEntries.map((entry) => {
                  const actor = users.find((u) => u.uid === entry.actorId);
                  return (
                    <div key={entry.id} className="flex items-start gap-2.5 text-xs">
                      <div className="w-5 h-5 rounded-full bg-white/10 text-gray-300 text-[9px] font-black flex items-center justify-center overflow-hidden shrink-0 mt-0.5">
                        {actor ? (actor.photoURL ? <img src={actor.photoURL} alt={actor.displayName} className="w-full h-full object-cover" /> : initials(actor.displayName)) : '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-gray-300">
                          <span className="font-semibold text-gray-200">{actor?.displayName || 'Quelqu\'un'}</span>{' '}
                          {describeActivity(entry)}
                        </p>
                        <p className="text-[10px] text-gray-600">{new Date(entry.createdAt).toLocaleString('fr-FR')}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center gap-2 pt-4 mt-2 border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                onDelete().catch((err: any) => toast.error(err?.message || "Impossible de supprimer cette tâche."));
              }}
              className="px-3 py-2 rounded-xl bg-rose-900/20 hover:bg-rose-900/35 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Supprimer
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-300 hover:text-white hover:bg-white/5">Annuler</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-black text-xs font-bold flex items-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Enregistrer
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Aperçu plein cadre d'une photo du chat — même comportement que la
          prévisualisation "œil" du module Documents. */}
      {chatLightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-[70] flex items-center justify-center p-6"
          onClick={(e) => { e.stopPropagation(); setChatLightboxUrl(null); }}
        >
          {/* Signalé : fermer l'aperçu (clic sur la croix ou en dehors)
              refermait aussi toute la fiche tâche en dessous — le clic
              remontait jusqu'au fond de la fiche (onClose) faute d'arrêt de
              propagation ici. */}
          <button
            onClick={(e) => { e.stopPropagation(); setChatLightboxUrl(null); }}
            className="absolute right-6 text-white/70 hover:text-white p-2 rounded-lg hover:bg-white/10 z-10"
            style={{ top: 'calc(3rem + env(safe-area-inset-top, 0px))' }}
          >
            <X className="w-6 h-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl w-full max-h-[85vh] flex items-center justify-center">
            <img src={chatLightboxUrl} alt="Aperçu" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
};

export default InternalProjectBoard;
