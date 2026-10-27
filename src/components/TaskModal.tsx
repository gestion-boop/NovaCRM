import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Flag,
  ChevronDown,
  Layers
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

const QUICK_TIMES = ['09:00', '10:00', '11:30', '14:00', '15:30', '17:00'];

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

  // Titres configurés dans Paramètres > "Titres des tâches et rendez-vous"
  const [taskTitlesList, setTaskTitlesList] = useState<string[]>(() =>
    readTitleList(
      taskTitlesKey(activeAgency?.id),
      defaultTaskTitlesFor(activeAgency?.name),
    )
  );
  const [appointmentTitlesList, setAppointmentTitlesList] = useState<string[]>(() =>
    readTitleList('novasphere:appointment-titles', DEFAULT_APPOINTMENT_TITLES)
  );

  // Resynchronise depuis le serveur
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch('/api/settings/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const tpl = data?.templates;
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

  const availablePresets = type === 'Rendez-vous' ? appointmentTitlesList : taskTitlesList;

  // Titre unifié : un seul état sans double champ
  const [title, setTitle] = useState(initialTask?.title || '');
  const [contactOrigin, setContactOrigin] = useState(initialTask?.contactOrigin || 'Standard / Passage');
  const [showOriginDropdown, setShowOriginDropdown] = useState(false);

  // Date state (YYYY-MM-DD)
  const todayStr = new Date().toISOString().split('T')[0];
  const [initialDatePart, initialTimePart] = initialTask?.dueDate?.split('T') || [];
  const [date, setDate] = useState(initialDatePart || todayStr);
  const [time, setTime] = useState(initialTimePart?.slice(0, 5) || '09:00');
  const [contactId, setContactId] = useState(initialTask?.contactId || defaultContactId || '');
  const [showChangeContact, setShowChangeContact] = useState(false);
  const [description, setDescription] = useState(initialTask?.description || '');

  // Calendar month navigation state
  const initialDate = new Date(date || todayStr);
  const [currentMonth, setCurrentMonth] = useState(
    isNaN(initialDate.getTime()) ? new Date() : initialDate
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Raccourcis clavier : Cmd+Enter / Ctrl+Enter pour valider immédiatement, Échap pour fermer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const form = document.getElementById('task-modal-form') as HTMLFormElement | null;
        if (form) form.requestSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const finalTitle = title.trim() || (type === 'Rendez-vous' ? 'Rendez-vous' : 'Nouvelle tâche');

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

  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevMonthDate = new Date(year, month - 1, d);
    gridCells.push({
      dayNum: d,
      isCurrentMonth: false,
      fullDate: prevMonthDate.toISOString().split('T')[0],
    });
  }

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

  const formatFrenchDate = (dStr: string) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-');
    if (!y || !m || !d) return dStr;
    const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  // Tâches déjà programmées le jour choisi (anti-doublon et contrôle de disponibilité)
  const tasksOnSelectedDate = allTasks.filter(t => t.dueDate && t.dueDate.startsWith(date));

  // Contact lié
  const currentContact = contacts.find(item => item.id === contactId);

  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-stretch sm:items-center justify-center p-0 sm:p-4 z-[1000] overflow-y-auto animate-in fade-in duration-150">
      <div className="relative bg-gradient-to-b from-[#081e22]/98 via-[#061719]/98 to-[#041113]/98 border-0 sm:border border-teal-500/25 rounded-none sm:rounded-3xl max-w-4xl w-full shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(247,188,95,0.08)] overflow-hidden flex flex-col sm:my-auto h-[100dvh] sm:h-auto sm:max-h-[92vh]">
        
        {/* Liseré doré supérieur */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F7BC5F]/80 to-transparent pointer-events-none" />

        {/* En-tête de la modale */}
        <div className="p-3.5 sm:p-5 pb-3 border-b border-teal-500/20 flex items-center justify-between bg-gradient-to-r from-[#092226]/90 via-[#0b292e]/90 to-[#092226]/90 shrink-0 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:pt-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#F7BC5F]/20 to-[#E5A642]/10 border border-[#F7BC5F]/30 flex items-center justify-center shadow-[0_0_20px_rgba(247,188,95,0.15)] shrink-0">
              <CalendarIcon className="w-5 h-5 text-[#F7BC5F]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                <span>{titleOverride || (isEditing ? 'Modifier la tâche' : 'Planifier la prochaine tâche')}</span>
                {isEditing && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#F7BC5F]/20 text-[#F9C977] border border-[#F7BC5F]/40">
                    Édition
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 truncate">
                {subtitleOverride || (isEditing ? 'Mettez à jour les informations et l’échéance' : 'Fixez la date, l’heure et le type d’intervention en un clic')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-200 border border-white/5 hover:border-rose-500/30 transition-all active:scale-95 cursor-pointer shrink-0"
            title="Fermer (Échap)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps principal en deux colonnes équilibrées : QUAND (gauche) et QUOI (droite) */}
        <div className="p-3.5 sm:p-5 overflow-y-auto overscroll-contain flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
            
            {/* Colonne Gauche : DATE, HEURE & PLANNING DU JOUR (Pas de doublon !) */}
            <div className="md:col-span-5 bg-[#041316]/90 rounded-2xl p-3.5 sm:p-4 border border-teal-500/20 flex flex-col space-y-3.5 shadow-inner">
              
              {/* En-tête Date sélectionnée */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#F7BC5F]" />
                  <span className="text-xs font-black uppercase tracking-wider text-teal-200">
                    Échéance
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#06191c] border border-[#F7BC5F]/30 text-xs font-bold text-[#F9C977]">
                  <span className="capitalize">{formatFrenchDate(date)}</span>
                  <span>à</span>
                  <span className="font-mono text-white">{time}</span>
                </div>
              </div>

              {/* Raccourcis Date rapides (1 clic) */}
              <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#06191c] border border-teal-500/20">
                {[
                  { label: "Aujourd'hui", court: "Auj.", offset: 0 },
                  { label: "Demain", court: "Demain", offset: 1 },
                  { label: "+2 jours", court: "+2 j", offset: 2 },
                  { label: "+1 sem.", court: "+1 sem.", offset: 7 },
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
                      className={`py-1 px-1 rounded-lg text-[11px] font-bold transition-all text-center whitespace-nowrap cursor-pointer ${
                        isCurrentChoice
                          ? 'bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span className="sm:hidden">{chip.court}</span>
                      <span className="hidden sm:inline">{chip.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Navigation Mois Calendrier */}
              <div className="flex justify-between items-center bg-[#06181b]/90 px-3 py-1.5 rounded-xl border border-teal-500/25 shadow-inner">
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
                  className="p-1 rounded-lg bg-teal-500/10 hover:bg-[#F7BC5F]/20 text-[#F7BC5F] border border-teal-500/30 hover:border-[#F7BC5F]/50 transition-all active:scale-90 cursor-pointer"
                  title="Mois précédent"
                >
                  <ChevronLeft className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
                <div className="flex items-center gap-1.5">
                  <CalendarIcon className="w-3 h-3 text-[#F7BC5F]/80" />
                  <span className="text-[#F7BC5F] font-black text-xs tracking-wide capitalize">
                    {capitalizedMonth}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
                  className="p-1 rounded-lg bg-teal-500/10 hover:bg-[#F7BC5F]/20 text-[#F7BC5F] border border-teal-500/30 hover:border-[#F7BC5F]/50 transition-all active:scale-90 cursor-pointer"
                  title="Mois suivant"
                >
                  <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>

              {/* En-tête des jours de la semaine */}
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-teal-300/70">
                <span>Di</span>
                <span>Lu</span>
                <span>Ma</span>
                <span>Me</span>
                <span>Je</span>
                <span>Ve</span>
                <span>Sa</span>
              </div>

              {/* Grille du calendrier */}
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {gridCells.map((cell, idx) => {
                  const isSelected = cell.fullDate === date;
                  const isToday = cell.fullDate === todayStr;
                  const hasTasks = allTasks.some(t => t.dueDate && t.dueDate.startsWith(cell.fullDate));

                  return (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => setDate(cell.fullDate)}
                      className={`h-8 rounded-lg flex flex-col items-center justify-center relative transition-all cursor-pointer font-semibold ${
                        isSelected
                          ? 'bg-gradient-to-br from-[#F7BC5F] via-[#F9C977] to-[#E5A642] text-slate-950 font-black shadow-[0_0_15px_rgba(247,188,95,0.45)] scale-105 z-10'
                          : isToday
                          ? 'border border-[#F7BC5F]/80 text-[#FAD592] bg-[#F7BC5F]/10 font-bold hover:bg-[#F7BC5F]/20'
                          : !cell.isCurrentMonth
                          ? 'text-slate-600 hover:text-slate-400'
                          : 'text-slate-200 hover:text-white hover:bg-teal-500/15'
                      }`}
                    >
                      <span className="text-[11px] leading-none">{cell.dayNum}</span>
                      {hasTasks && !isSelected && (
                        <span className="w-1 h-1 rounded-full bg-[#F7BC5F] absolute bottom-0.5 shadow-[0_0_4px_rgba(247,188,95,0.8)]" />
                      )}
                      {hasTasks && isSelected && (
                        <span className="w-1 h-1 rounded-full bg-slate-950 absolute bottom-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Section Heure intégrée dans la colonne de gauche (Gain de temps & 0 doublon !) */}
              <div className="pt-2.5 border-t border-teal-500/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-teal-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#F7BC5F]" />
                    <span>Heure d'intervention *</span>
                  </label>
                  <div className="relative">
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      required
                      className="bg-[#06191c] border border-teal-500/30 focus:border-[#F7BC5F] rounded-lg px-2 py-0.5 text-xs text-white font-mono focus:outline-none cursor-pointer"
                      title="Modifier l'heure personnalisée"
                    />
                  </div>
                </div>

                {/* Puces d'heures rapides (1 clic pour choisir l'heure !) */}
                <div className="grid grid-cols-6 gap-1">
                  {QUICK_TIMES.map((qt) => {
                    const isSelectedTime = time === qt;
                    return (
                      <button
                        key={qt}
                        type="button"
                        onClick={() => setTime(qt)}
                        className={`py-1 px-0.5 rounded-lg text-[11px] font-mono font-bold transition-all text-center cursor-pointer border ${
                          isSelectedTime
                            ? 'bg-gradient-to-r from-[#F7BC5F] to-[#E5A642] text-slate-950 border-[#F7BC5F] shadow-sm'
                            : 'bg-[#06191c] text-slate-300 border-teal-500/20 hover:border-teal-500/40 hover:text-white'
                        }`}
                      >
                        {qt}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Conflits & Tâches déjà prévues ce jour-là */}
              <div className="pt-2 border-t border-teal-500/15">
                {tasksOnSelectedDate.length === 0 ? (
                  <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-[11px] font-medium text-emerald-200 truncate">
                      Journée libre · Aucun conflit d'horaire
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-amber-300 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                        {tasksOnSelectedDate.length} tâche{tasksOnSelectedDate.length > 1 ? 's' : ''} ce jour
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {tasksOnSelectedDate.some(t => t.dueDate?.includes(`T${time}`)) ? '⚠️ Créneau occupé' : 'Créneau libre'}
                      </span>
                    </div>
                    <div className="max-h-20 overflow-y-auto space-y-1 pr-1">
                      {tasksOnSelectedDate.map(t => {
                        const displayTime = t.dueDate && t.dueDate.includes('T') ? t.dueDate.split('T')[1].slice(0, 5) : '09:00';
                        const isConflict = displayTime === time;
                        return (
                          <div
                            key={t.id}
                            className={`px-2 py-0.5 rounded-lg text-[10px] flex items-center justify-between gap-1.5 border ${
                              isConflict
                                ? 'bg-rose-500/15 border-rose-500/40 text-rose-200 font-bold'
                                : 'bg-[#06191c] border-teal-500/15 text-slate-300'
                            }`}
                          >
                            <span className="truncate">{t.title}</span>
                            <span className="font-mono text-[#F7BC5F] shrink-0 font-bold">{displayTime}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Colonne Droite : L'ACTION & DÉTAILS (Simplifié, rapide, 0 doublon) */}
            <form onSubmit={handleSubmit} id="task-modal-form" className="md:col-span-7 space-y-3.5">
              
              {/* 1. Type d'action * (Boutons tactiles rapides) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                  <span>Type d'action *</span>
                  <span className="text-[10px] text-slate-400 font-normal">Sélection en 1 clic</span>
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {TASK_TYPES.map((t) => {
                    const Icon = t.icon;
                    const isCurrentType = type === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setType(t.id);
                        }}
                        className={`px-1.5 py-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer border ${
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

              {/* 2. Titre unifié avec puces de suggestions rapides (Élimine le double champ select + input !) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                  <span>Libellé / Titre de la tâche *</span>
                  <span className="text-[10px] text-slate-400">Tapez ou cliquez un libellé ci-dessous</span>
                </label>
                
                {/* Champ texte principal */}
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder={type === 'Rendez-vous' ? 'Ex: Premier RDV découverte, Visite bien...' : 'Ex: Relance offre de prêt, Rappeler le client...'}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#051518]/95 border border-[#F7BC5F]/40 focus:border-[#F7BC5F] rounded-xl px-3.5 py-2 text-sm text-white placeholder-teal-200/35 focus:outline-none focus:ring-1 focus:ring-[#F7BC5F]/30 shadow-inner transition-all"
                  />
                  {title && (
                    <button
                      type="button"
                      onClick={() => setTitle('')}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-white text-xs cursor-pointer"
                      title="Effacer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Suggestions rapides en 1 clic pour ce type d'action */}
                <div className="space-y-1 pt-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {availablePresets.slice(0, 5).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setTitle(preset)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                          title === preset
                            ? 'bg-[#F7BC5F]/20 text-[#F9C977] border-[#F7BC5F]/50 shadow-sm'
                            : 'bg-[#051518] text-slate-300 border-teal-500/20 hover:border-teal-500/40 hover:text-white'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}

                    {/* Menu déroulant pour le reste des libellés de l'agence */}
                    {availablePresets.length > 5 && (
                      <div className="relative">
                        <select
                          value={availablePresets.slice(5).includes(title) ? title : ''}
                          onChange={(e) => {
                            if (e.target.value) setTitle(e.target.value);
                          }}
                          className="bg-[#051518] border border-teal-500/25 rounded-lg px-2 py-1 text-[11px] text-slate-300 hover:text-white focus:outline-none focus:border-[#F7BC5F] cursor-pointer appearance-none pr-6"
                        >
                          <option value="">Autres libellés ({availablePresets.length - 5})...</option>
                          {availablePresets.slice(5).map((preset) => (
                            <option key={preset} value={preset} className="bg-[#07191b] text-white">
                              {preset}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-2 pointer-events-none" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. Priorité de traitement */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-[#F7BC5F]" />
                  <span>Priorité</span>
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

              {/* 4. Client lié au dossier (Affichage compact sans encombrer la vue) */}
              {contacts && contacts.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-[#F7BC5F]" />
                      <span>Client lié</span>
                    </span>
                    {currentContact && !showChangeContact && (
                      <button
                        type="button"
                        onClick={() => setShowChangeContact(true)}
                        className="text-[11px] text-[#F7BC5F] hover:underline cursor-pointer"
                      >
                        Changer de contact
                      </button>
                    )}
                  </label>

                  {currentContact && !showChangeContact ? (
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#051518]/90 border border-teal-500/25">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-[#F7BC5F]/20 text-[#F7BC5F] flex items-center justify-center font-bold text-xs shrink-0">
                          {currentContact.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{currentContact.name}</p>
                          {currentContact.phone && (
                            <p className="text-[10px] text-slate-400 font-mono truncate">{currentContact.phone}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-teal-500/15 border border-teal-500/30 text-teal-300 shrink-0">
                        Rattaché
                      </span>
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={contactId}
                        onChange={(e) => {
                          setContactId(e.target.value);
                          setShowChangeContact(false);
                        }}
                        className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/30 appearance-none shadow-inner transition-all pr-9 cursor-pointer"
                      >
                        <option value="" className="bg-[#07191b] text-slate-400">Aucun client spécifique</option>
                        {contacts.map(c => (
                          <option key={c.id} value={c.id} className="bg-[#07191b] text-white py-1">{c.name}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-2.5 pointer-events-none text-slate-400">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 5. Description / Notes d'intervention (Compact) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-teal-200 flex items-center justify-between">
                  <span>Notes d'intervention</span>
                  <span className="text-[10px] text-slate-400 font-normal">Optionnel</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Détails de l'intervention, pièces à demander, points abordés..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-teal-200/35 focus:outline-none focus:border-[#F7BC5F] focus:ring-1 focus:ring-[#F7BC5F]/30 resize-none shadow-inner transition-all"
                />
              </div>

              {/* 6. Provenance du contact (Replié dans une option discrète pour ne pas encombrer le formulaire !) */}
              <div className="pt-1">
                {!showOriginDropdown ? (
                  <button
                    type="button"
                    onClick={() => setShowOriginDropdown(true)}
                    className="text-[11px] text-slate-400 hover:text-[#F7BC5F] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Layers className="w-3 h-3 text-[#F7BC5F]/70" />
                    <span>Canal d'acquisition : <strong className="text-slate-300 font-medium">{contactOrigin}</strong> (modifier)</span>
                  </button>
                ) : (
                  <div className="space-y-1 p-2 rounded-xl bg-[#051518]/80 border border-teal-500/20">
                    <label className="text-[11px] font-bold text-[#F9C977] flex items-center justify-between">
                      <span>Canal d'acquisition (Provenance)</span>
                      <button
                        type="button"
                        onClick={() => setShowOriginDropdown(false)}
                        className="text-[10px] text-slate-400 hover:text-white"
                      >
                        Masquer
                      </button>
                    </label>
                    <div className="relative">
                      <select
                        value={contactOrigin}
                        onChange={(e) => setContactOrigin(e.target.value)}
                        className="w-full bg-[#051518]/95 border border-teal-500/30 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#F7BC5F] appearance-none cursor-pointer pr-8"
                      >
                        {CONTACT_ORIGINS.map((orig, i) => (
                          <option key={i} value={orig} className="bg-[#07191b] text-white py-1">{orig}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                    </div>
                  </div>
                )}
              </div>

            </form>
          </div>
        </div>

        {/* Pied de page de la modale */}
        <div className="p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:pb-4 border-t border-teal-500/20 bg-gradient-to-r from-[#06181b] via-[#071d22] to-[#06181b] flex items-center justify-between gap-3 shrink-0">
          {saveError ? (
            <p className="text-xs font-semibold text-rose-400 flex items-center gap-1.5 truncate">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{saveError}</span>
            </p>
          ) : (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
              <span>Rappel synchronisé · </span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-slate-300">⌘+Entrée</kbd>
            </div>
          )}

          <div className="flex items-center gap-2.5 shrink-0 ml-auto w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-slate-300 hover:text-white bg-white/5 sm:bg-transparent hover:bg-white/5 border border-white/10 sm:border-transparent hover:border-white/10 transition-all cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              form="task-modal-form"
              disabled={saving}
              className="flex-[2] sm:flex-none justify-center px-5 py-2 bg-gradient-to-r from-[#F7BC5F] via-[#F9C977] to-[#E5A642] hover:brightness-110 active:scale-95 text-slate-950 font-black text-xs sm:text-sm rounded-xl flex items-center gap-2 whitespace-nowrap shadow-[0_0_20px_rgba(247,188,95,0.3)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
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
    </div>,
    document.body
  );
};

export default TaskModal;
