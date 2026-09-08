import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Camera, X, ChevronLeft, ChevronRight, Clock, MapPin, Calendar,
  Hash, Briefcase, CheckCircle2, XCircle, Video, Film, Package, Clapperboard, Send
} from 'lucide-react';
import { CameraReservation } from '@/types';
import { getCachedAccessToken, requestWorkspaceAccessToken, fetchGoogleCalendarEvents } from '@/lib/workspace';
import {
  useCameraReservations,
  StoredCameraReservation,
  EQUIPMENT_LABEL_TO_KEY,
  formatReservationDateFr,
} from '@/hooks/useCameraReservations';

interface CameraReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddReservation?: (res: CameraReservation) => void;
}

export const CameraReservationModal: React.FC<CameraReservationModalProps> = ({
  isOpen,
  onClose,
  onAddReservation,
}) => {
  const { currentUser, activeAgency, userProfile } = useAuth();

  const {
    reservations,
    loading: loadingReservations,
    error: loadError,
    isCameraAdmin,
    pendingReservations,
    reviewingId,
    reviewReservation,
  } = useCameraReservations();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Date state (date courante)
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDayNum, setSelectedDayNum] = useState<number>(today.getDate());

  // Form states
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(['Caméra DJI']);
  const [location, setLocation] = useState('');
  const [mandateNumber, setMandateNumber] = useState('');
  const [projectName, setProjectName] = useState('');
  const [note, setNote] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  // Ticket #19 (nouvelle base) : le contrôle d'une réservation se faisait
  // uniquement depuis une ligne compacte avec deux icônes minuscules — on
  // ouvre maintenant une fenêtre détaillée dédiée, avec un vrai bouton
  // "Valider".
  const [detailReservation, setDetailReservation] = useState<StoredCameraReservation | null>(null);
  // Ticket #41 (nouvelle base) : vérifier la compatibilité avec l'agenda
  // avant de valider — événements Google Calendar du même jour que la
  // réservation, affichés dans la fenêtre de contrôle.
  const [dayEvents, setDayEvents] = useState<{ title: string; time: string }[] | null>(null);
  const [loadingDayEvents, setLoadingDayEvents] = useState(false);
  const [calendarNeedsAuth, setCalendarNeedsAuth] = useState(false);
  // Demande explicite (7 septembre) : « qu'on ait trois propositions au
  // cas où, pour pallier aux besoins » — en refusant, l'admin peut
  // suggérer jusqu'à 3 créneaux de remplacement, repris dans la
  // notification envoyée au demandeur.
  const [showRefusePanel, setShowRefusePanel] = useState(false);
  const [refuseReason, setRefuseReason] = useState('');
  const [altSlots, setAltSlots] = useState<string[]>(['', '', '']);

  const loadDayEvents = async (dateStr: string, tokenOverride?: string) => {
    setLoadingDayEvents(true);
    setCalendarNeedsAuth(false);
    try {
      const token = tokenOverride || getCachedAccessToken();
      if (!token) {
        setCalendarNeedsAuth(true);
        setDayEvents(null);
        return;
      }
      const events = await fetchGoogleCalendarEvents(token);
      const targetDay = dateStr.slice(0, 10);
      const sameDay = events
        .filter((e: any) => (e.start?.dateTime || e.start?.date || '').slice(0, 10) === targetDay)
        .map((e: any) => ({
          title: e.summary || 'Sans titre',
          time: e.start?.dateTime
            ? new Date(e.start.dateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            : 'Toute la journée',
        }));
      setDayEvents(sameDay);
    } catch {
      setDayEvents(null);
    } finally {
      setLoadingDayEvents(false);
    }
  };

  useEffect(() => {
    if (detailReservation) void loadDayEvents(detailReservation.startDate);
    else { setDayEvents(null); setCalendarNeedsAuth(false); }
    setShowRefusePanel(false);
    setRefuseReason('');
    setAltSlots(['', '', '']);
  }, [detailReservation]);

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

  // Réservations du jour sélectionné
  const formattedDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDayNum).padStart(2, '0')}`;

  const selectedDayReservations = reservations
    .filter((reservation) => reservation.startDate.startsWith(formattedDateStr))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const hasTimeConflict = (equipment: string, start: string, end: string) => {
    return selectedDayReservations.some((reservation) => {
      const bookedEquipment = reservation.equipmentList?.length
        ? reservation.equipmentList
        : reservation.equipmentName.split(',').map((item) => item.trim());

      if (!bookedEquipment.includes(equipment)) {
        return false;
      }

      const bookedStart = reservation.startTime || reservation.startDate.slice(-5);
      const bookedEnd = reservation.endTime || reservation.endDate.slice(-5);

      return start < bookedEnd && end > bookedStart;
    });
  };

  // Submit reservation
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser) {
      setSubmitError("Vous devez être connecté pour réserver du matériel.");
      return;
    }

    if (!selectedEquipment.length) {
      setSubmitError("Sélectionnez au moins un matériel.");
      return;
    }

    if (endTime <= startTime) {
      setSubmitError("L'heure de fin doit être postérieure à l'heure de début.");
      return;
    }

    const conflictingEquipment = selectedEquipment.filter((equipment) =>
      hasTimeConflict(equipment, startTime, endTime)
    );

    if (conflictingEquipment.length) {
      setSubmitError(
        `Créneau indisponible pour : ${conflictingEquipment.join(', ')}. Choisissez un autre horaire ou matériel.`
      );
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const reservationId = `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentName =
      userProfile?.displayName ||
      currentUser.displayName ||
      currentUser.email ||
      'Utilisateur Nova CRM';

    const newRes: StoredCameraReservation = {
      id: reservationId,
      equipmentName: selectedEquipment.join(', '),
      agentName,
      propertyAddress: location.trim() || 'Adresse non spécifiée',
      startDate: `${formattedDateStr} ${startTime}`,
      endDate: `${formattedDateStr} ${endTime}`,
      status: 'En attente',
      mandateNumber: mandateNumber.trim(),
      projectName: projectName.trim(),
      note: note.trim(),
      equipmentList: selectedEquipment,
      startTime,
      endTime,
      location: location.trim(),
      agencyId: activeAgency.id === 'all' ? '' : activeAgency.id,
      createdByUserId: currentUser.uid,
      createdByEmail: currentUser.email?.trim().toLowerCase() || '',
      createdAt: new Date().toISOString(),
    };

    try {
      const equipment: Record<string, boolean> = {};
      selectedEquipment.forEach((label) => {
        const key = EQUIPMENT_LABEL_TO_KEY[label];
        if (key) equipment[key] = true;
      });
      const description = JSON.stringify({
        equipment,
        lieu: location.trim(),
        mandat: mandateNumber.trim(),
        projet: projectName.trim(),
        note: note.trim(),
      });
      const startAtIso = new Date(`${formattedDateStr}T${startTime}:00`).toISOString();
      const endAtIso = new Date(`${formattedDateStr}T${endTime}:00`).toISOString();

      const { error: insertError } = await supabase.from('camera_reservations' as any).insert({
        agency_id: activeAgency.id === 'all' ? null : activeAgency.id,
        user_id: currentUser.uid,
        title: 'Réservation matériel',
        description,
        start_at: startAtIso,
        end_at: endAtIso,
        status: 'pending',
      } as any);
      if (insertError) throw insertError;

      // La liste se rafraîchit toute seule via l'abonnement temps réel du
      // hook partagé (useCameraReservations) — plus besoin de la mettre à
      // jour ici à la main.

      if (onAddReservation) {
        onAddReservation(newRes);
      }

      // Correctif (7 septembre) : cet appel client faisait doublon avec DEUX
      // déclencheurs base identiques (`on_camera_reservation_created` et
      // `trg_camera_reservation_created`, tous deux appelant la même
      // fonction) — jusqu'à 3 notifications pour une seule demande, avec un
      // lien cassé (`/agenda?...`, jamais résolu) pour la version base. Le
      // doublon base a été supprimé et son lien corrigé (`/reserver-camera`,
      // voir ce même correctif côté SQL) ; il couvre déjà fiablement tous
      // les super admins + Mélanie (camera_reservation_approvers()), donc
      // cet appel n'est plus nécessaire.

      setIsSuccess(true);

      window.setTimeout(() => {
        setIsSuccess(false);
        setSubmitError(null);
        onClose();
      }, 1200);
    } catch (error) {
      console.error('Erreur enregistrement réservation caméra :', error);
      setSubmitError("La réservation n'a pas pu être enregistrée. Aucun succès n'a été simulé.");
    } finally {
      setSubmitting(false);
    }
  };

  // Selected date object for status text
  const selectedDateObj = new Date(year, month, selectedDayNum);
  const selectedDayName = dayNames[selectedDateObj.getDay()];
  const selectedFormattedStr = `${selectedDayName} ${String(selectedDayNum).padStart(2, '0')} ${monthNames[month].toLowerCase()}`;

  const hasExistingReservation = selectedDayReservations.length > 0;

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
              Remplissez le formulaire. La demande sera validée par <span className="text-slate-200 font-semibold">Sylvain ou Mélanie Grazia</span>.
            </p>
          </div>
        </div>

        {/* Panneau admin : demandes en attente (Sylvain / Mélanie uniquement) */}
        {isCameraAdmin && pendingReservations.length > 0 && !isSuccess && (
          <div className="bg-purple-950/20 border border-purple-500/30 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {pendingReservations.length} demande(s) en attente de validation
            </p>
            <div className="space-y-2">
              {pendingReservations.map((res) => (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => setDetailReservation(res)}
                  className="w-full flex items-center justify-between gap-3 bg-[#050f14] border border-[#182e38] rounded-xl p-3 text-left hover:border-[#F7BC5F]/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{res.equipmentName}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {res.agentName} • {res.startDate.slice(0, 10)} • {res.startTime}-{res.endTime}
                      {res.projectName ? ` • ${res.projectName}` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-[#F9C977] shrink-0">Contrôler →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Success Feedback Overlay */}
        {isSuccess ? (
          <div className="p-12 text-center space-y-3 bg-[#051319] border border-emerald-500/30 rounded-2xl animate-scale-up">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h3 className="text-lg font-bold text-white">Demande enregistrée avec succès !</h3>
            <p className="text-xs text-slate-400">Sylvain et Mélanie Grazia ont été notifiés et valideront votre demande.</p>
          </div>
        ) : (
          <>
            {(submitError || loadError) && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
                {submitError || loadError}
              </div>
            )}

            {loadingReservations && (
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-200 text-xs">
                Chargement du planning en cours...
              </div>
            )}

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
                      const dayDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                      const hasBookings = reservations.some((reservation) =>
                        reservation.startDate.startsWith(dayDate)
                      );

                      return (
                        <button
                          key={`day-${dayNum}`}
                          type="button"
                          onClick={() => setSelectedDayNum(dayNum)}
                          className={`relative py-1 flex flex-col items-center justify-center transition-all rounded-full cursor-pointer h-9 w-9 mx-auto ${
                            isSelected
                              ? 'bg-[#e5ab2a] text-slate-950 font-black shadow-lg shadow-[#F7BC5F]/20'
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
                    <p className="text-[10px] uppercase font-bold text-purple-300 tracking-wider">
                      {selectedDayReservations.length} réservation(s) ce jour
                    </p>
                    {selectedDayReservations.map((reservation) => (
                      <div key={reservation.id} className="border-t border-purple-500/10 pt-1.5 first:border-t-0 first:pt-0">
                        <p className="text-xs font-semibold text-white">
                          {reservation.equipmentName} • {reservation.startTime || reservation.startDate.slice(-5)} - {reservation.endTime || reservation.endDate.slice(-5)}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Agent : {reservation.agentName} • {reservation.status}
                        </p>
                      </div>
                    ))}
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
                    <span>N° mandat (optionnel)</span>
                  </label>
                  {/* Signalé (8 septembre, Mélanie, ImmoSphera/NovaVisio) :
                      « la réservation ne fonctionne pas » — en réalité, ce
                      champ obligatoire bloquait silencieusement l'envoi du
                      formulaire (validation HTML native, sans message
                      clair) dès qu'une réservation n'était pas rattachée à
                      un mandat précis (tournage interne, contenu NovaVisio,
                      etc.). Toutes les autres infos restent facultatives
                      sauf le matériel et les horaires — pas de raison
                      d'exiger un mandat pour réserver la caméra. */}
                  <input
                    type="text"
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
                    disabled={submitting || loadingReservations}
                  className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:opacity-95 text-white font-black text-xs shadow-lg shadow-purple-900/40 flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                  <span>{submitting ? 'Enregistrement...' : 'Envoyer la demande'}</span>
                </button>
              </div>

            </div>
          </form>
          </>
        )}
      </div>

      {/* Fenêtre de contrôle détaillée d'une réservation (ticket #19) */}
      {detailReservation && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md z-[70] flex items-center justify-center p-4"
          onClick={() => setDetailReservation(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#09151c] border border-[#182e38] rounded-3xl w-full max-w-lg p-6 sm:p-8 text-white shadow-2xl space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold text-purple-300 uppercase tracking-wider mb-1">Demande en attente</p>
                <h3 className="text-lg font-bold text-white">{detailReservation.equipmentName}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailReservation(null)}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2.5">
                <Briefcase className="w-4 h-4 text-slate-500 shrink-0" />
                <span>{detailReservation.agentName}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
                {/* Demande explicite (7 septembre) : « on ne voit pas trop
                    bien la date qui est demandée » — date en toutes lettres
                    au lieu du format brut AAAA-MM-JJ. */}
                <span className="font-semibold text-white">{formatReservationDateFr(detailReservation)}</span>
              </div>
              {detailReservation.propertyAddress && (
                <div className="flex items-center gap-2.5">
                  <Hash className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>{detailReservation.propertyAddress}</span>
                </div>
              )}
              {detailReservation.projectName && (
                <div className="flex items-center gap-2.5">
                  <Film className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>{detailReservation.projectName}</span>
                </div>
              )}
              {detailReservation.mandateNumber && (
                <div className="flex items-center gap-2.5">
                  <Package className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Mandat n° {detailReservation.mandateNumber}</span>
                </div>
              )}
              {detailReservation.note && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300 whitespace-pre-wrap">
                  {detailReservation.note}
                </div>
              )}
            </div>

            {/* Ticket #41 : compatibilité avec l'agenda avant de valider */}
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Votre agenda ce jour-là
              </p>
              {loadingDayEvents ? (
                <p className="text-xs text-slate-500">Vérification...</p>
              ) : calendarNeedsAuth ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const token = await requestWorkspaceAccessToken();
                      await loadDayEvents(detailReservation.startDate, token);
                    } catch {
                      /* l'utilisateur a annulé la connexion */
                    }
                  }}
                  className="text-xs text-[#F9C977] hover:underline"
                >
                  Connecter mon agenda Google pour vérifier les conflits
                </button>
              ) : dayEvents === null ? (
                <p className="text-xs text-slate-500">Agenda indisponible pour le moment.</p>
              ) : dayEvents.length === 0 ? (
                <p className="text-xs text-emerald-400">Rien d'autre à cette date — libre.</p>
              ) : (
                <ul className="space-y-1">
                  {dayEvents.map((ev, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-center gap-2">
                      <span className="text-slate-500 font-mono shrink-0">{ev.time}</span>
                      <span className="truncate">{ev.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Demande explicite (7 septembre) : « qu'on ait trois
                propositions au cas où, pour pallier aux besoins » — en
                refusant, proposer jusqu'à 3 créneaux de remplacement,
                repris dans la notification envoyée au demandeur. */}
            {showRefusePanel && (
              <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2.5">
                <p className="text-[11px] font-bold text-rose-300 uppercase tracking-wider">Refuser cette demande</p>
                <textarea
                  rows={2}
                  placeholder="Motif du refus (optionnel)..."
                  value={refuseReason}
                  onChange={(e) => setRefuseReason(e.target.value)}
                  className="w-full bg-[#050f14] border border-[#182e38] rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500/40 resize-none"
                />
                <p className="text-[10px] text-slate-400">Proposer d'autres créneaux (facultatif) :</p>
                {altSlots.map((slot, i) => (
                  <input
                    key={i}
                    type="text"
                    placeholder={`Proposition ${i + 1} (ex. mardi 9 sept. 14h-15h)`}
                    value={slot}
                    onChange={(e) => setAltSlots((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))}
                    className="w-full bg-[#050f14] border border-[#182e38] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500/40"
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#142832]">
              {showRefusePanel ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowRefusePanel(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await reviewReservation(detailReservation, false, { reason: refuseReason, alternativeSlots: altSlots });
                      setDetailReservation(null);
                    }}
                    disabled={reviewingId === detailReservation.id}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40 flex items-center gap-2"
                  >
                    <XCircle className="w-4 h-4" /> Confirmer le refus
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowRefusePanel(true)}
                    disabled={reviewingId === detailReservation.id}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40 flex items-center gap-2"
                  >
                    <XCircle className="w-4 h-4" /> Refuser
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await reviewReservation(detailReservation, true);
                      setDetailReservation(null);
                    }}
                    disabled={reviewingId === detailReservation.id}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Valider
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraReservationModal;