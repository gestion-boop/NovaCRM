import React, { useState } from 'react';
import { 
  Camera, X, ChevronLeft, ChevronRight, Clock, MapPin, 
  Hash, Briefcase, CheckCircle2, Video, Film, Package, Clapperboard, Send
} from 'lucide-react';
import { CameraReservation } from '@/types';

interface CameraReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddReservation?: (res: CameraReservation) => void;
}

const INITIAL_BOOKED_DAYS = [3, 4, 7, 10, 11]; // Sample dates with existing reservations (matching screenshot)

export const CameraReservationModal: React.FC<CameraReservationModalProps> = ({
  isOpen,
  onClose,
  onAddReservation,
}) => {
  // Date state (Default August 2026 as in screenshot)
  const [viewDate, setViewDate] = useState(new Date(2026, 7, 1)); // August 2026
  const [selectedDayNum, setSelectedDayNum] = useState<number>(8); // Saturday 8 August

  // Form states
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(['Caméra DJI']);
  const [location, setLocation] = useState('');
  const [mandateNumber, setMandateNumber] = useState('');
  const [projectName, setProjectName] = useState('');
  const [note, setNote] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  // Equipment options matching user's screenshot
  const EQUIPMENT_OPTIONS = [
    { id: 'Caméra Giraffe', label: 'Caméra Giraffe', icon: Video, emoji: '🎥' },
    { id: 'Caméra DJI', label: 'Caméra DJI', icon: Camera, emoji: '📷' },
    { id: 'Caméra X4', label: 'Caméra X4', icon: Package, emoji: '📦' },
    { id: 'Community Manager', label: 'Community Manager', icon: Clapperboard, emoji: '🎬' },
  ];

  // Calendar calculations
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const totalDaysInPrevMonth = new Date(year, month, 0).getDate();

  // Navigate month
  const handlePrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setViewDate(new Date(year, month + 1, 1));

  // Equipment toggle
  const toggleEquipment = (id: string) => {
    if (selectedEquipment.includes(id)) {
      setSelectedEquipment(selectedEquipment.filter(item => item !== id));
    } else {
      setSelectedEquipment([...selectedEquipment, id]);
    }
  };

  // Submit reservation
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formattedDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDayNum).padStart(2, '0')}`;
    const newRes: CameraReservation = {
      id: 'cr-' + Date.now(),
      equipmentName: selectedEquipment.join(', ') || 'Caméra DJI',
      agentName: 'Sylvain Grazia',
      propertyAddress: location || 'Adresse non spécifiée',
      startDate: `${formattedDateStr} ${startTime}`,
      endDate: `${formattedDateStr} ${endTime}`,
      status: 'Confirmée',
      mandateNumber,
      projectName,
      note,
      equipmentList: selectedEquipment,
      startTime,
      endTime,
      location,
    };

    if (onAddReservation) {
      onAddReservation(newRes);
    }

    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      onClose();
    }, 1200);
  };

  // Selected date object for status text
  const selectedDateObj = new Date(year, month, selectedDayNum);
  const selectedDayName = dayNames[selectedDateObj.getDay()];
  const selectedFormattedStr = `${selectedDayName} ${String(selectedDayNum).padStart(2, '0')} ${monthNames[month].toLowerCase()}`;

  const hasExistingReservation = INITIAL_BOOKED_DAYS.includes(selectedDayNum);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fade-in">
      <div className="bg-[#09151c] border border-[#182e38] rounded-3xl w-full max-w-4xl p-5 sm:p-7 text-white shadow-2xl relative space-y-6 my-auto">
        
        {/* Top Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer border border-white/10"
          title="Fermer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-start gap-3.5 pr-10">
          <div className="w-11 h-11 rounded-2xl bg-[#2a133d] border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0 shadow-lg shadow-purple-950/40">
            <Camera className="w-6 h-6 text-purple-300" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Réservation de matériel</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Remplissez le formulaire. La demande sera validée par <span className="text-slate-200 font-semibold">Mélanie GRAZIA</span> ou un administrateur.
            </p>
          </div>
        </div>

        {/* Success Feedback Overlay */}
        {isSuccess ? (
          <div className="p-12 text-center space-y-3 bg-[#051319] border border-emerald-500/30 rounded-2xl animate-scale-up">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h3 className="text-lg font-bold text-white">Demande enregistrée avec succès !</h3>
            <p className="text-xs text-slate-400">Un e-mail de confirmation va être transmis à l'administrateur.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left Column: Calendar & Availability Status (5 columns) */}
            <div className="lg:col-span-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-white mb-2.5">
                  Sélectionner une date *
                </label>

                {/* Calendar Card */}
                <div className="bg-[#050f14] border border-[#142832] rounded-2xl p-4 shadow-inner">
                  {/* Month Switcher Header */}
                  <div className="flex items-center justify-between mb-4">
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      className="w-8 h-8 rounded-full bg-[#8b2fc9] hover:bg-[#7823b2] text-white flex items-center justify-center transition-all cursor-pointer shadow-md shadow-purple-900/30"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-extrabold text-white text-sm sm:text-base tracking-wide">
                      {monthNames[month]} {year}
                    </span>
                    <button
                      type="button"
                      onClick={handleNextMonth}
                      className="w-8 h-8 rounded-full bg-[#8b2fc9] hover:bg-[#7823b2] text-white flex items-center justify-center transition-all cursor-pointer shadow-md shadow-purple-900/30"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Days of Week Header */}
                  <div className="grid grid-cols-7 text-center mb-2">
                    {['DI', 'LU', 'MA', 'ME', 'JE', 'VE', 'SA'].map((d) => (
                      <span key={d} className="text-[10px] font-extrabold text-slate-400 uppercase py-1">
                        {d}
                      </span>
                    ))}
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-7 gap-y-1.5 gap-x-1 text-center text-xs">
                    {/* Prev month tail days */}
                    {Array.from({ length: firstDayIndex }).map((_, idx) => {
                      const prevDay = totalDaysInPrevMonth - firstDayIndex + idx + 1;
                      return (
                        <div key={`prev-${idx}`} className="text-slate-600 py-1.5 font-medium text-[11px]">
                          {prevDay}
                        </div>
                      );
                    })}

                    {/* Current month days */}
                    {Array.from({ length: totalDaysInMonth }).map((_, idx) => {
                      const dayNum = idx + 1;
                      const isSelected = selectedDayNum === dayNum;
                      const hasBookings = INITIAL_BOOKED_DAYS.includes(dayNum);

                      return (
                        <button
                          key={`day-${dayNum}`}
                          type="button"
                          onClick={() => setSelectedDayNum(dayNum)}
                          className={`relative py-1 flex flex-col items-center justify-center transition-all rounded-full cursor-pointer h-9 w-9 mx-auto ${
                            isSelected
                              ? 'bg-[#e5ab2a] text-slate-950 font-black shadow-lg shadow-amber-500/20'
                              : 'text-slate-200 hover:bg-white/10 font-bold'
                          }`}
                        >
                          <span>{dayNum}</span>
                          {hasBookings && !isSelected && (
                            <span className="w-1.5 h-1.5 bg-[#c084fc] rounded-full absolute bottom-1" />
                          )}
                          {hasBookings && isSelected && (
                            <span className="w-1.5 h-1.5 bg-slate-950 rounded-full absolute bottom-1" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Legend below calendar */}
                  <div className="flex items-center justify-center gap-4 border-t border-[#142832] pt-3 mt-3 text-[11px] text-slate-300 font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#e5ab2a]" />
                      Jour sélectionné
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#c084fc]" />
                      Réservation existante
                    </span>
                  </div>
                </div>
              </div>

              {/* Slots Availability Card (below calendar) */}
              <div className="bg-[#050f14] border border-[#142832] rounded-2xl p-4 text-center space-y-2">
                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-300 font-bold">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                  <span>Créneaux — {selectedFormattedStr}</span>
                </div>

                {!hasExistingReservation ? (
                  <div className="pt-2 pb-1 space-y-1">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto mb-1.5">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-black text-emerald-400">Créneau libre</p>
                    <p className="text-[11px] text-slate-400">Aucune réservation ce jour</p>
                  </div>
                ) : (
                  <div className="pt-2 pb-1 text-left space-y-1.5 bg-purple-950/20 border border-purple-500/20 rounded-xl p-2.5">
                    <p className="text-[10px] uppercase font-bold text-purple-300 tracking-wider">Réservation occupée</p>
                    <p className="text-xs font-semibold text-white">Caméra DJI • 14:00 - 16:00</p>
                    <p className="text-[11px] text-slate-400">Agent : Mélanie Grazia</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Form Inputs (7 columns) */}
            <div className="lg:col-span-7 space-y-4">
              
              {/* Start and End Times */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-white mb-1.5">
                    Heure de début *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full bg-[#051319] border border-[#132c37] focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none transition-colors"
                    />
                    <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-white mb-1.5">
                    Heure de fin *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full bg-[#051319] border border-[#132c37] focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none transition-colors"
                    />
                    <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Matériel requis */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-bold text-white">
                    Matériel requis *
                  </label>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {selectedEquipment.length} sélectionné
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {EQUIPMENT_OPTIONS.map((item) => {
                    const isSelected = selectedEquipment.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleEquipment(item.id)}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all select-none ${
                          isSelected
                            ? 'bg-[#28133b] border-purple-500 text-white shadow-sm shadow-purple-900/20'
                            : 'bg-[#051319] border-[#132c37] text-slate-300 hover:border-purple-500/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-base">{item.emoji}</span>
                          <span className="text-xs font-extrabold">{item.label}</span>
                        </div>
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
                          isSelected ? 'bg-purple-500 border-purple-400 text-white' : 'border-slate-600'
                        }`}>
                          {isSelected && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lieu & Mandat */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-purple-400" />
                    <span>Lieu</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Adresse, ville..."
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-[#051319] border border-[#132c37] focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-purple-400" />
                    <span>N° mandat *</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex : 2024-001"
                    value={mandateNumber}
                    onChange={(e) => setMandateNumber(e.target.value)}
                    className="w-full bg-[#051319] border border-[#132c37] focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* Projet */}
              <div>
                <label className="block text-xs font-bold text-white mb-1.5 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-purple-400" />
                  <span>Projet</span>
                </label>
                <input
                  type="text"
                  placeholder="Nom du projet..."
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full bg-[#051319] border border-[#132c37] focus:border-purple-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-bold text-white mb-1.5">
                  Note (optionnel)
                </label>
                <textarea
                  rows={3}
                  placeholder="Informations supplémentaires..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-[#051319] border border-[#132c37] focus:border-purple-500 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none resize-none transition-colors"
                />
              </div>

              {/* Footer Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#142832]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl text-slate-300 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:opacity-95 text-white font-black text-xs shadow-lg shadow-purple-900/40 flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                  <span>Envoyer la demande</span>
                </button>
              </div>

            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default CameraReservationModal;
