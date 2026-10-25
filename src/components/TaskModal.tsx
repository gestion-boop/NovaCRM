import React, { useEffect, useState } from 'react';
import {
  X,
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  User,
  CheckSquare,
  Phone,
  RefreshCw,
  FileText,
  Mail,
  Sparkles,
  AlertCircle,
  Flag
} from 'lucide-react';
import { Contact, Task } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { DEFAULT_APPOINTMENT_TITLES, defaultTaskTitlesFor, taskTitlesKey, lireTitresAgence } from './ParametresView';

// Mêmes clés de stockage que la page Paramètres ("Titres des tâches et
// rendez-vous") — pour que la liste proposée ici soit toujours identique à
// ce que l'utilisateur y a configuré, au lieu d'une liste figée séparée.
const readTitleList = (key: string, fallback: string[]): string[] => {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.warn(`Erreur lecture ${key}:`, err);
  }
  return fallback;
};

interface TaskModalProps {
  onClose: () => void;
  onAddTask: (task: Omit<Task, 'id' | 'createdAt' | 'agencyId'>) => void | Promise<unknown>;
  contacts: Contact[];
  defaultContactId?: string;
  allTasks?: Task[];
  titleOverride?: string;
  subtitleOverride?: string;
  // Mode édition : si fourni, le formulaire est pré-rempli avec cette tâche
  // et la validation appelle onUpdateTask au lieu de onAddTask.
  initialTask?: Task;
  onUpdateTask?: (id: string, updates: Partial<Omit<Task, 'id' | 'createdAt' | 'agencyId'>>) => void | Promise<unknown>;
}

const CONTACT_ORIGINS = [
  'Standard / Passage',
  'Site Web / Landing',
  'LeBonCoin',
  'SeLoger',
  'Parrainage / Recommandation',
  'Réseaux Sociaux',
  'Apporteur / Notaire',
  'Ancien Client',
  'Autre',
];

const TASK_TYPES: { id: Task['type']; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'Tâche', label: 'Tâche', icon: CheckSquare },
  { id: 'Rendez-vous', label: 'RDV', icon: CalendarIcon },
  { id: 'Appel', label: 'Appel', icon: Phone },
  { id: 'Relance', label: 'Relance', icon: RefreshCw },
  { id: 'Document', label: 'Document', icon: FileText },
  { id: 'Mail' as Task['type'], label: 'Mail', icon: Mail },
];

const PRIORITIES: { id: 'Urgent' | 'Haute' | 'Moyenne' | 'Basse'; label: string; color: string; badge: string }[] = [
  { id: 'Urgent', label: 'Urgent', color: 'bg-rose-500', badge: 'text-rose-300 border-rose-500/40 bg-rose-500/15' },
  { id: 'Haute', label: 'Haute', color: 'bg-orange-500', badge: 'text-orange-300 border-orange-500/40 bg-orange-500/15' },
  { id: 'Moyenne', label: 'Moyenne', color: 'bg-[#F7BC5F]', badge: 'text-[#F9C977] border-[#F7BC5F]/40 bg-[#F7BC5F]/15' },
  { id: 'Basse', label: 'Basse', color: 'bg-emerald-500', badge: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/15' },
];

const TaskModal: React.FC<TaskModalProps> = ({
  onClose,
  onAddTask,
  contacts,
  defaultContactId,
  allTasks = [],
  titleOverride,
  subtitleOverride,
  initialTask,
  onUpdateTask,
}) => {
  const isEditing = !!initialTask;
  const { currentUser, activeAgency } = useAuth();

  const [type, setType] = useState<Task['type']>(initialTask?.type || 'Tâche');
  const [priority, setPriority] = useState<'Urgent' | 'Haute' | 'Moyenne' | 'Basse'>(
    (initialTask?.priority as 'Urgent' | 'Haute' | 'Moyenne' | 'Basse') || 'Urgent'
  );

  // Les deux listes configurées dans Paramètres > "Titres des tâches et
  // rendez-vous" — on affiche celle qui correspond au Type sélectionné.
  // Libellés cloisonnés par agence (31/08/2026). La liste historique était
  // unique et purement courtage — retour banque, offre de prêt, ODP notaire —
  // proposée telle quelle à Immosphera et NovaVisio, pour qui elle n'avait
  // aucun sens. Chaque agence a maintenant sa clé et ses libellés de départ,
  // que chacun complète depuis Paramètres.
  const [taskTitlesList, setTaskTitlesList] = useState<string[]>(() =>
    readTitleList(
      taskTitlesKey(activeAgency?.id),
      defaultTaskTitlesFor(activeAgency?.name),
    )
  );
  const [appointmentTitlesList, setAppointmentTitlesList] = useState<string[]>(() =>
    readTitleList('novasphere:appointment-titles', DEFAULT_APPOINTMENT_TITLES)
  );

  // Resynchronise depuis le serveur au cas où l'utilisateur les a modifiées
  // depuis un autre appareil (même source que la page Paramètres).
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/settings/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const tpl = data?.templates;
        // `task_titles` est désormais un dictionnaire { agence: [...] }.
        // `lireTitresAgence` accepte aussi l'ancien tableau nu, qu'il
        // n'applique qu'à Conseils Finances — c'était du courtage.
        const titres = lireTitresAgence(tpl?.task_titles, activeAgency?.id, activeAgency?.name);
        if (titres) {
          setTaskTitlesList(titres);
          localStorage.setItem(taskTitlesKey(activeAgency?.id), JSON.stringify(titres));
        }
        if (Array.isArray(tpl?.rdv_titles) && tpl.rdv_titles.length) {
          setAppointmentTitlesList(tpl.rdv_titles);
          localStorage.setItem('novasphere:appointment-titles', JSON.stringify(tpl.rdv_titles));
        }
      } catch (err) {
        console.warn('Erreur synchronisation des titres depuis Paramètres :', err);
      }
    })();
  }, [currentUser, activeAgency]);

  const presetLabels = [
    'Sélectionner un label',
    ...(type === 'Rendez-vous' ? appointmentTitlesList : taskTitlesList),
  ];

  // Si le titre de la tâche à éditer correspond à un label prédéfini, on le
  // pré-sélectionne ; sinon on le place dans le champ "titre personnalisé".
  const initialMatchesPreset = initialTask ? presetLabels.includes(initialTask.title) : false;
  const [selectedLabel, setSelectedLabel] = useState(
    initialMatchesPreset && initialTask ? initialTask.title : 'Sélectionner un label'
  );
  const [customTitle, setCustomTitle] = useState(
    initialTask && !initialMatchesPreset ? initialTask.title : ''
  );
  const [contactOrigin, setContactOrigin] = useState(initialTask?.contactOrigin || 'Standard / Passage');

  // Date state (YYYY-MM-DD)
  const todayStr = new Date().toISOString().split('T')[0];
  const [initialDatePart, initialTimePart] = initialTask?.dueDate?.split('T') || [];
  const [date, setDate] = useState(initialDatePart || todayStr);
  const [time, setTime] = useState(initialTimePart?.slice(0, 5) || '09:00');
  const [contactId, setContactId] = useState(initialTask?.contactId || defaultContactId || '');
  const [description, setDescription] = useState(initialTask?.description || '');

  // Calendar month navigation state
  const initialDate = new Date(date || todayStr);
  const [currentMonth, setCurrentMonth] = useState(
    isNaN(initialDate.getTime()) ? new Date() : initialDate
  );

  const finalTitle = selectedLabel !== 'Sélectionner un label' ? selectedLabel : (customTitle.trim() || 'Nouvelle tâche');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // La fenêtre se fermait auparavant immédiatement à la soumission, sans
  // attendre ni vérifier le résultat de l'enregistrement : en cas d'échec
  // (réseau, contrainte base), rien ne le signalait — la tâche semblait
  // créée alors qu'elle ne l'était pas. On attend maintenant la vraie
  // réponse et on affiche l'erreur au lieu de fermer silencieusement.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalTitle || !date || saving) return;

    const dueDate = `${date}T${time}`;
    setSaveError(null);
    setSaving(true);

    try {
      if (isEditing && initialTask && onUpdateTask) {
        await onUpdateTask(initialTask.id, {
          title: finalTitle,
          type,
          priority,
          dueDate,
          contactId: contactId || undefined,
          contactOrigin: contactOrigin || undefined,
          description: description.trim() || undefined,
        });
      } else {
        await onAddTask({
          title: finalTitle,
          type,
          priority: priority || 'Urgent',
          completed: false,
          dueDate: dueDate,
          contactId: contactId || undefined,
          contactOrigin: contactOrigin || undefined,
          description: description.trim() || undefined,
        });
      }
      onClose();
    } catch (err) {
      console.error('Erreur enregistrement tâche :', err);
      setSaveError((err as Error)?.message || "L'enregistrement a échoué. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  // Calendar generation logic
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth(); // 0-indexed

  const monthNameFr = currentMonth.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const capitalizedMonth = monthNameFr.charAt(0).toUpperCase() + monthNameFr.slice(1);

  // Day calculations
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon ...
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Create grid cells (42 cells: 6 rows x 7 cols)
  const gridCells: { dayNum: number; isCurrentMonth: boolean; fullDate: string }[] = [];

  // Previous month padding
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevMonthDate = new Date(year, month - 1, d);
    gridCells.push({
      dayNum: d,
      isCurrentMonth: false,
      fullDate: prevMonthDate.toISOString().split('T')[0],
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(d).padStart(2, '0');
    const fullDate = `${year}-${monthStr}-${dayStr}`;
    gridCells.push({
      dayNum: d,
      isCurrentMonth: true,
      fullDate,
    });
  }

  // Next month padding
  const remaining = 42 - gridCells.length;
  for (let d = 1; d <= remaining; d++) {
    const nextMonthDate = new Date(year, month + 1, d);
    gridCells.push({
      dayNum: d,
      isCurrentMonth: false,
      fullDate: nextMonthDate.toISOString().split('T')[0],
    });
  }

  // Quick date jump helpers
  const handleQuickDate = (offsetDays: number) => {
    const target = new Date();
    target.setDate(target.getDate() + offsetDays);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');
    const fullIso = `${y}-${m}-${d}`;
    setDate(fullIso);
    setCurrentMonth(new Date(y, target.getMonth(), 1));
  };

  // Helper to format date in French for display
  const formatFrenchDate = (dStr: string) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-');
    if (!y || !m || !d) return dStr;
    const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatFrenchLongDate = (dStr: string) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-');
    if (!y || !m || !d) return dStr;
    const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Filter tasks scheduled on the currently selected date
  const tasksOnSelectedDate = allTasks.filter(t => t.dueDate && t.dueDate.startsWith(date));

  // Find contact name
  const getContactName = (cId?: string) => {
    if (!cId) return null;
    const c = contacts.find(item => item.id === cId);
    return c ? c.name : null;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 z-50 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative bg-gradient-to-b from-[#081e22]/98 via-[#061719]/98 to-[#041113]/98 border border-teal-500/25 rounded-3xl max-w-4xl w-full shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(247,188,95,0.08)] overflow-hidden flex flex-col my-auto max-h-[92vh]">
        
        {/* Golden accent bar top */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F]/80 to-transparent pointer-events-none" />

        {/* Modal Top Header */}
        <div className="p-5 sm:p-6 pb-4 sm:pb-5 border-b border-teal-500/20 flex items-center justify-between bg-gradient-to-r from-[#092226]/90 via-[#0b292e]/90 to-[#092226]/90 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#F7BC5F]/20 to-[#E5A642]/10 border border-[#F7BC5F]/30 flex items-center justify-center shadow-[0_0_20px_rgba(247,188,95,0.15)] shrink-0">
              <CalendarIcon className="w-5 h-5 text-[#F7BC5F]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                <span>{titleOverride || (isEditing ? 'Modifier la tâche' : 'Planifier la prochaine tâche')}</span>
                {isEditing && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#F7BC5F]/20 text-[#F9C977] border border-[#F7BC5F]/40">
                    Édition
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {subtitleOverride || (isEditing ? 'Mettez à jour les informations et l’échéance de cette tâche' : 'Organisez le suivi et les rappels pour ce dossier')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-200 border border-white/5 hover:border-rose-500/30 transition-all active:scale-95 cursor-pointer shrink-0"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* Grid layout: Left Calendar, Right Form */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Calendar Picker */}
            <div className="md:col-span-6 bg-[#041316]/90 rounded-2xl p-4 sm:p-5 border border-teal-500/20 flex flex-col space-y-4 shadow-inner">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#F7BC5F]" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-teal-200">
                    Date d'échéance
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-slate-400">
                  {formatFrenchDate(date)}
                </span>
              </div>

              {/* Quick date chips */}
              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#06191c] border border-teal-500/20">
                {[
                  { label: "Aujourd'hui", offset: 0 },
                  { label: "Demain", offset: 1 },
                  { label: "+2 jours", offset: 2 },
                  { label: "+1 sem.", offset: 7 },
                ].map((chip) => {
                  const target = new Date();
                  target.setDate(target.getDate() + chip.offset);
                  const y = target.getFullYear();
                  const m = String(target.getMonth() + 1).padStart(2, '0');
                  const d = String(target.getDate()).padStart(2, '0');
                  const fullIso = `${y}-${m}-${d}`;
                  const isCurrentChoice = date === fullIso;

                  return (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => handleQuickDate(chip.offset)}
                      className={`py-1.5 px-1 rounded-lg text-[11px] font-bold transition-all text-center truncate cursor-pointer ${
                        isCurrentChoice
                          ? 'bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              {/* Month Navigation */}
              <div className="flex justify-between items-center bg-[#06181b]/90 px-3.5 py-2.5 rounded-xl border border-teal-500/25 shadow-inner">
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
                  className="p-1.5 rounded-lg bg-teal-500/10 hover:bg-[#F7BC5F]/20 text-[#F7BC5F] border border-teal-500/30 hover:border-[#F7BC5F]/50 transition-all active:scale-90 cursor-pointer"
                  title="Mois précédent"
                >
                  <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
                </button>
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-3.5 h-3.5 text-[#F7BC5F]/80" />
                  <span className="text-[#F7BC5F] font-black text-sm tracking-wide capitalize">
                    {capitalizedMonth}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
                  className="p-1.5 rounded-lg bg-teal-500/10 hover:bg-[#F7BC5F]/20 text-[#F7BC5F] border border-teal-500/30 hover:border-[#F7BC5F]/50 transition-all active:scale-90 cursor-pointer"
                  title="Mois suivant"
                >
                  <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>

              {/* Day Name Headers */}
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-teal-300/70 py-1">
                <span>Di</span>
                <span>Lu</span>
                <span>Ma</span>
                <span>Me</span>
                <span>Je</span>
                <span>Ve</span>
                <span>Sa</span>
              </div>

              {/* Calendar Grid (6 rows of 7 days) */}
              <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-xs sm:text-sm">
                {gridCells.map((cell, idx) => {
                  const isSelected = cell.fullDate === date;
                  const isToday = cell.fullDate === todayStr;
                  const hasTasks = allTasks.some(t => t.dueDate && t.dueDate.startsWith(cell.fullDate));

                  return (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => {
                        setDate(cell.fullDate);
                      }}
                      className={`h-9 sm:h-10 rounded-xl flex flex-col items-center justify-center relative transition-all cursor-pointer font-semibold ${
                        isSelected
                          ? 'bg-gradient-to-br from-[#F7BC5F] via-[#F9C977] to-[#E5A642] text-slate-950 font-black shadow-[0_0_18px_rgba(247,188,95,0.45)] scale-105 z-10 ring-2 ring-[#F7BC5F]/40'
                          : isToday
                          ? 'border-2 border-[#F7BC5F]/80 text-[#FAD592] bg-[#F7BC5F]/10 font-bold hover:bg-[#F7BC5F]/20'
                          : !cell.isCurrentMonth
                          ? 'text-slate-600 hover:text-slate-400 hover:bg-white/5'
                          : 'text-slate-200 hover:text-white hover:bg-teal-500/15'
                      }`}
                    >
                      <span>{cell.dayNum}</span>
                      {hasTasks && !isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#F7BC5F] absolute bottom-1 shadow-[0_0_6px_rgba(247,188,95,0.8)]" />
                      )}
                      {hasTasks && isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-950 absolute bottom-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Task Form */}
            <form onSubmit={handleSubmit} id="task-modal-form" className="md:col-span-6 space-y-4">
              {/* Type * */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                  <span>Type d'action *</span>
                  <span className="text-[10px] text-slate-400 font-normal">Sélection rapide</span>
                </label>
                {/* Type quick chips */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {TASK_TYPES.map((t) => {
                    const Icon = t.icon;
                    const isCurrentType = type === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          const nextType = t.id;
                          setType(nextType);
                          const nextList = nextType === 'Rendez-vous' ? appointmentTitlesList : taskTitlesList;
                          if (!nextList.includes(selectedLabel)) {
                            setSelectedLabel('Sélectionner un label');
                          }
                        }}
                        className={`px-2 py-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer border ${
                          isCurrentType
                            ? 'bg-gradient-to-br from-[#F7BC5F] to-[#E5A642] text-slate-950 border-[#F7BC5F] shadow-[0_0_12px_rgba(247,188,95,0.35)] scale-[1.02]'
                            : 'bg-[#051518]/90 text-slate-300 border-teal-500/20 hover:border-teal-500/40 hover:text-white hover:bg-teal-500/10'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="text-[11px] leading-tight truncate">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Titre * */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                  <span>Libellé / Titre de la tâche *</span>
                  {selectedLabel !== 'Sélectionner un label' && (
                    <span className="text-[10px] text-[#F7BC5F] font-semibold">Prédéfini</span>
                  )}
                </label>
                <div className="relative">
                  <select
                    value={selectedLabel}
                    onChange={(e) => {
                      setSelectedLabel(e.target.value);
                      if (e.target.value !== 'Sélectionner un label') {
                        setCustomTitle('');
                      }
                    }}
                    className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/30 appearance-none shadow-inner transition-all pr-9 cursor-pointer"
                  >
                    {presetLabels.map((lbl, i) => (
                      <option key={i} value={lbl} className="bg-[#07191b] text-white py-1">
                        {lbl}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-3 pointer-events-none text-slate-400">
                    <ChevronRight className="w-4 h-4 rotate-90" />
                  </div>
                </div>

                {selectedLabel === 'Sélectionner un label' && (
                  <div className="relative pt-1 animate-in fade-in duration-150">
                    <input
                      type="text"
                      placeholder="Saisissez un titre personnalisé..."
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      required={selectedLabel === 'Sélectionner un label'}
                      className="w-full bg-[#051518]/95 border border-[#F7BC5F]/50 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-teal-200/40 focus:outline-none focus:border-[#F7BC5F] focus:ring-2 focus:ring-[#F7BC5F]/20 shadow-inner transition-all"
                    />
                  </div>
                )}
              </div>

              {/* Provenance du contact */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#F9C977] flex items-center justify-between">
                  <span>Provenance du contact</span>
                  <span className="text-[10px] text-slate-400 font-normal">Canal d'acquisition</span>
                </label>
                <div className="relative">
                  <select
                    value={contactOrigin}
                    onChange={(e) => setContactOrigin(e.target.value)}
                    className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/30 appearance-none shadow-inner transition-all pr-9 cursor-pointer"
                  >
                    {CONTACT_ORIGINS.map((orig, i) => (
                      <option key={i} value={orig} className="bg-[#07191b] text-white py-1">{orig}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-3 pointer-events-none text-slate-400">
                    <ChevronRight className="w-4 h-4 rotate-90" />
                  </div>
                </div>
              </div>

              {/* Date * & Heure * */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-teal-200">Date d'échéance *</label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={formatFrenchDate(date)}
                      className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3.5 py-2.5 pr-9 text-sm text-slate-100 focus:outline-none focus:border-[#F7BC5F] cursor-default font-mono shadow-inner"
                    />
                    <CalendarIcon className="w-4 h-4 text-[#F7BC5F] absolute right-3 top-3 pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-teal-200">Heure *</label>
                  <div className="relative">
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      required
                      className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3.5 py-2.5 pr-9 text-sm text-slate-100 focus:outline-none focus:border-[#F7BC5F] font-mono shadow-inner cursor-pointer"
                    />
                    <Clock className="w-4 h-4 text-[#F7BC5F] absolute right-3 top-3 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Priorité */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Flag className="w-3.5 h-3.5 text-[#F7BC5F]" />
                    Priorité de traitement
                  </span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {PRIORITIES.map((p) => {
                    const isSelectedPriority = priority === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPriority(p.id)}
                        className={`py-1.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border cursor-pointer ${
                          isSelectedPriority
                            ? `${p.badge} ring-1 ring-current shadow-sm`
                            : 'bg-[#051518]/70 border-teal-500/20 text-slate-400 hover:text-slate-200 hover:bg-white/5'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${p.color}`} />
                        <span>{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Client lié */}
              {contacts && contacts.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-teal-200 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#F7BC5F]" />
                    <span>Client lié au dossier</span>
                  </label>
                  <div className="relative">
                    <select
                      value={contactId}
                      onChange={(e) => setContactId(e.target.value)}
                      className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/30 appearance-none shadow-inner transition-all pr-9 cursor-pointer"
                    >
                      <option value="" className="bg-[#07191b] text-slate-400">Aucun client spécifique</option>
                      {contacts.map(c => (
                        <option key={c.id} value={c.id} className="bg-[#07191b] text-white py-1">{c.name}</option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-3 pointer-events-none text-slate-400">
                      <ChevronRight className="w-4 h-4 rotate-90" />
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                  <span>Description / Notes d'intervention</span>
                  <span className="text-[10px] text-slate-400 font-normal">Optionnel</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Détails de l'intervention, documents à apporter, ordre du jour..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-teal-200/40 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/30 resize-none shadow-inner transition-all"
                />
              </div>
            </form>
          </div>

          {/* Bottom Panel: Existing Scheduled Tasks & RDVs for Selected Date (Prevents Duplicates) */}
          <div className="pt-4 border-t border-teal-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#F7BC5F]" />
                <h3 className="text-xs sm:text-sm font-bold text-white">
                  Tâches et RDV du <span className="text-[#F7BC5F] capitalize">{formatFrenchLongDate(date)}</span>
                </h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/15 border border-teal-500/30 text-teal-300">
                {tasksOnSelectedDate.length} programmée{tasksOnSelectedDate.length > 1 ? 's' : ''}
              </span>
            </div>

            {tasksOnSelectedDate.length === 0 ? (
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-3">
                <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-emerald-200">Disponibilité complète</p>
                  <p className="text-[11px] text-emerald-300/80">Aucun rendez-vous ni tâche pour cette journée. Aucun risque de conflit.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-44 overflow-y-auto pr-1">
                {tasksOnSelectedDate.map(t => {
                  const clientName = getContactName(t.contactId);
                  const displayTime = t.dueDate && t.dueDate.includes('T') ? t.dueDate.split('T')[1].slice(0, 5) : '09:00';

                  return (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-[#041416]/90 border border-teal-500/25 hover:border-teal-500/40 flex items-center justify-between gap-2.5 text-xs transition-all shadow-sm group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider shrink-0 border ${
                          t.type === 'Rendez-vous' ? 'bg-[#F7BC5F]/20 text-[#F7BC5F] border-[#F7BC5F]/40' :
                          t.type === 'Appel' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' :
                          t.type === 'Relance' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
                          t.type === 'Mail' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' :
                          t.type === 'Document' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                          'bg-teal-500/20 text-teal-300 border-teal-500/40'
                        }`}>
                          {t.type || 'Tâche'}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{t.title}</p>
                          {clientName && (
                            <p className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                              <User className="w-2.5 h-2.5 text-[#F7BC5F]/70" />
                              <span>{clientName}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#06181b] border border-teal-500/20 text-[#F7BC5F] font-mono text-xs font-bold shrink-0">
                        <Clock className="w-3 h-3 text-[#F7BC5F]/80" />
                        <span>{displayTime}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Bottom Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-teal-500/20 bg-gradient-to-r from-[#06181b] via-[#071d22] to-[#06181b] flex items-center justify-between gap-3 shrink-0">
          {saveError ? (
            <p className="text-xs font-semibold text-rose-400 flex-1 flex items-center gap-1.5 truncate">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{saveError}</span>
            </p>
          ) : (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
              <span>Rappel automatique synchronisé</span>
            </div>
          )}
          <div className="flex items-center gap-3 shrink-0 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-300 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 transition-all cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              form="task-modal-form"
              disabled={saving}
              className="px-6 py-2.5 bg-gradient-to-r from-[#F7BC5F] via-[#F9C977] to-[#E5A642] hover:brightness-110 active:scale-95 text-slate-950 font-black text-sm rounded-xl flex items-center gap-2 shadow-[0_0_20px_rgba(247,188,95,0.3)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Enregistrement...</span>
                </>
              ) : (
                <>
                  <CalendarIcon className="w-4 h-4 stroke-[2.5]" />
                  <span>{isEditing ? 'Enregistrer les modifications' : 'Créer la tâche'}</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default TaskModal;
