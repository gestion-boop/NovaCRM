import React, { useState } from 'react';
import { X, Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, CheckCircle2, User } from 'lucide-react';
import { Contact, Task } from '@/types';

interface TaskModalProps {
  onClose: () => void;
  onAddTask: (task: Omit<Task, 'id' | 'createdAt' | 'agencyId'>) => void;
  contacts: Contact[];
  defaultContactId?: string;
  allTasks?: Task[];
  titleOverride?: string;
  subtitleOverride?: string;
}

const PRESET_LABELS = [
  'Sélectionner un label',
  'Relance téléphonique client',
  'Rendez-vous bilan patrimonial',
  'Envoi des offres de prêt',
  'Relance organisme bancaire',
  'Signature compromis / notaire',
  'Demande de pièces justificatives',
  'Prise de contact initiale',
  'Suivi accord de principe',
];

const TaskModal: React.FC<TaskModalProps> = ({
  onClose,
  onAddTask,
  contacts,
  defaultContactId,
  allTasks = [],
  titleOverride,
  subtitleOverride,
}) => {
  const [type, setType] = useState<Task['type']>('Tâche');
  const [selectedLabel, setSelectedLabel] = useState('Sélectionner un label');
  const [customTitle, setCustomTitle] = useState('');
  
  // Date state (YYYY-MM-DD)
  const todayStr = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(todayStr);
  const [time, setTime] = useState('09:00');
  const [contactId, setContactId] = useState(defaultContactId || '');
  const [description, setDescription] = useState('');

  // Calendar month navigation state
  const initialDate = new Date(date || todayStr);
  const [currentMonth, setCurrentMonth] = useState(
    isNaN(initialDate.getTime()) ? new Date() : initialDate
  );

  const finalTitle = selectedLabel !== 'Sélectionner un label' ? selectedLabel : (customTitle.trim() || 'Nouvelle tâche');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalTitle || !date) return;

    const dueDate = `${date}T${time}`;

    onAddTask({
      title: finalTitle,
      type,
      priority: 'Urgent',
      completed: false,
      dueDate: dueDate,
      contactId: contactId || undefined,
    });
    onClose();
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

  // Helper to format date in French for display
  const formatFrenchDate = (dStr: string) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-');
    if (!y || !m || !d) return dStr;
    const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    return dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatFrenchLongDate = (dStr: string) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-');
    if (!y || !m || !d) return dStr;
    const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
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
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 z-50 overflow-y-auto">
      <div className="bg-[#061a1d] border border-[#144447] rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden animate-slide-up flex flex-col my-auto max-h-[92vh]">
        
        {/* Modal Top Header */}
        <div className="p-6 pb-4 border-b border-[#144447]/60 flex items-start justify-between bg-[#07191b] shrink-0">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              {titleOverride || 'Planifier la prochaine tâche'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              {subtitleOverride || 'Planifiez la suite pour ce client'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-black/40 text-slate-400 hover:text-white hover:bg-black/70 transition-colors"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Grid layout: Left Calendar, Right Form */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Calendar Picker */}
            <div className="md:col-span-6 bg-[#041214] rounded-2xl p-4 sm:p-5 border border-[#144447]/80 flex flex-col space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center justify-between">
                <span>Sélectionner une date</span>
              </h3>

              {/* Month Navigation */}
              <div className="flex justify-between items-center bg-[#07191b] px-3 py-2 rounded-xl border border-[#153c3f]">
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
                  className="p-1.5 rounded-lg bg-[#E5B842] text-black hover:bg-[#d4a83b] transition-transform active:scale-90"
                  title="Mois précédent"
                >
                  <ChevronLeft className="w-4 h-4 stroke-[3]" />
                </button>
                <span className="text-[#E5B842] font-black text-sm tracking-wide">
                  {capitalizedMonth}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
                  className="p-1.5 rounded-lg bg-[#E5B842] text-black hover:bg-[#d4a83b] transition-transform active:scale-90"
                  title="Mois suivant"
                >
                  <ChevronRight className="w-4 h-4 stroke-[3]" />
                </button>
              </div>

              {/* Day Name Headers */}
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-[#E5B842] py-1">
                <span>Di</span>
                <span>Lu</span>
                <span>Ma</span>
                <span>Me</span>
                <span>Je</span>
                <span>Ve</span>
                <span>Sa</span>
              </div>

              {/* Calendar Grid (6 rows of 7 days) */}
              <div className="grid grid-cols-7 gap-1 text-center text-xs sm:text-sm">
                {gridCells.map((cell, idx) => {
                  const isSelected = cell.fullDate === date;
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
                          ? 'bg-[#E5B842] text-slate-950 font-black shadow-lg scale-105 z-10'
                          : !cell.isCurrentMonth
                          ? 'text-slate-600 hover:text-slate-400 hover:bg-white/5'
                          : 'text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      <span>{cell.dayNum}</span>
                      {hasTasks && !isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#E5B842] absolute bottom-1" />
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
              <div className="space-y-1">
                <label className="text-xs font-bold text-white">Type *</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as Task['type'])}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#E5B842] appearance-none"
                >
                  <option value="Tâche">Tâche</option>
                  <option value="Rendez-vous">Rendez-vous</option>
                  <option value="Appel">Appel</option>
                  <option value="Relance">Relance</option>
                  <option value="Document">Document</option>
                  <option value="Mail">Mail</option>
                </select>
              </div>

              {/* Titre * */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-white">Titre *</label>
                <select
                  value={selectedLabel}
                  onChange={(e) => {
                    setSelectedLabel(e.target.value);
                    if (e.target.value !== 'Sélectionner un label') {
                      setCustomTitle('');
                    }
                  }}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#E5B842] appearance-none mb-1.5"
                >
                  {PRESET_LABELS.map((lbl, i) => (
                    <option key={i} value={lbl}>{lbl}</option>
                  ))}
                </select>

                {selectedLabel === 'Sélectionner un label' && (
                  <input
                    type="text"
                    placeholder="Saisissez un titre personnalisé..."
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    required={selectedLabel === 'Sélectionner un label'}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#E5B842]"
                  />
                )}
              </div>

              {/* Date * & Heure * */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-white">Date *</label>
                  <input
                    type="text"
                    readOnly
                    value={formatFrenchDate(date)}
                    onClick={() => {}}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#E5B842] cursor-default font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-white">Heure *</label>
                  <div className="relative">
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      required
                      className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3.5 py-2.5 pr-9 text-sm text-white focus:outline-none focus:border-[#E5B842] font-mono"
                    />
                    <Clock className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Client lié */}
              {contacts && contacts.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-white">Client lié</label>
                  <select
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#E5B842] appearance-none"
                  >
                    <option value="">Aucun client spécifique</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-white">Description</label>
                <textarea
                  rows={3}
                  placeholder="Détails de la tâche..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#030d0f] border border-[#153c3f] rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#E5B842] resize-none"
                />
              </div>
            </form>
          </div>

          {/* Bottom Panel: Existing Scheduled Tasks & RDVs for Selected Date (Prevents Duplicates) */}
          <div className="pt-4 border-t border-[#144447]/60 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center justify-between">
              <span>Tâches et RDV du {formatFrenchLongDate(date)}</span>
              <span className="text-xs text-slate-400 font-normal">
                ({tasksOnSelectedDate.length} programmée{tasksOnSelectedDate.length > 1 ? 's' : ''})
              </span>
            </h3>

            {tasksOnSelectedDate.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-[#041214] border border-[#144447]/60 text-xs text-slate-400 flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Aucun événement ni tâche prévu pour cette journée. Aucun risque de doublon.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-44 overflow-y-auto pr-1">
                {tasksOnSelectedDate.map(t => {
                  const clientName = getContactName(t.contactId);
                  const displayTime = t.dueDate && t.dueDate.includes('T') ? t.dueDate.split('T')[1] : '09:00';

                  return (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl bg-[#041214] border border-[#144447]/80 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          t.type === 'Rendez-vous' ? 'bg-[#E5B842]/20 text-[#E5B842]' :
                          t.type === 'Appel' ? 'bg-sky-500/20 text-sky-300' :
                          'bg-teal-500/20 text-teal-300'
                        }`}>
                          {t.type || 'Tâche'}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{t.title}</p>
                          {clientName && (
                            <p className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                              <User className="w-2.5 h-2.5" />
                              <span>{clientName}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-[#E5B842] font-mono text-xs font-bold shrink-0">
                        <Clock className="w-3 h-3" />
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
        <div className="p-4 sm:p-5 border-t border-[#144447]/60 bg-[#07191b] flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Annuler
          </button>
          <button
            type="submit"
            form="task-modal-form"
            className="px-6 py-2.5 bg-[#E5B842] hover:bg-[#d4a83b] text-slate-950 font-black text-sm rounded-xl flex items-center gap-2 shadow-lg transition-all active:scale-95 cursor-pointer"
          >
            <CalendarIcon className="w-4 h-4 stroke-[2.5]" />
            <span>Créer la tâche</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default TaskModal;
