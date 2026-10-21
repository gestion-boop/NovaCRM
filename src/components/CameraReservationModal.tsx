import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Camera, X, ChevronLeft, ChevronRight, ChevronDown, Clock, MapPin, Calendar,
  Hash, Briefcase, CheckCircle2, XCircle, Video, Film, Package, Clapperboard, Send,
  FileText, Check,
} from 'lucide-react';
import { CameraReservation } from '@/types';
import { getCachedAccessToken, requestWorkspaceAccessToken, fetchGoogleCalendarEvents } from '@/lib/workspace';
import {
  useCameraReservations,
  StoredCameraReservation,
  EQUIPMENT_LABEL_TO_KEY,
  formatReservationDateFr,
} from '@/hooks/useCameraReservations';
import { equipementsReservation, partagentUnEquipement } from '@/lib/equipementsReservation';

interface CameraReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddReservation?: (res: CameraReservation) => void;
  // Demande explicite : pouvoir cliquer sur une réservation déjà enregistrée
  // (depuis ReserverCameraView) pour la modifier au lieu d'en recréer une —
  // ouvre ce même formulaire pré-rempli, en UPDATE plutôt qu'en INSERT.
  editReservation?: StoredCameraReservation | null;
}

export const CameraReservationModal: React.FC<CameraReservationModalProps> = ({
  isOpen,
  onClose,
  onAddReservation,
  editReservation = null,
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

  // Pré-remplissage du formulaire quand on ouvre la fenêtre pour MODIFIER
  // une réservation existante (clic sur une carte dans ReserverCameraView) —
  // y compris la date, pour que le calendrier s'ouvre directement sur le
  // bon jour au lieu de rester sur celui parcouru la dernière fois.
  useEffect(() => {
    if (!isOpen || !editReservation) return;
    const [datePart, timePart] = editReservation.startDate.split(' ');
    const [y, m, d] = datePart.split('-').map(Number);
    if (y && m && d) {
      setViewDate(new Date(y, m - 1, 1));
      setSelectedDayNum(d);
    }
    setStartTime(editReservation.startTime || timePart || '09:00');
    setEndTime(editReservation.endTime || '10:00');
    setSelectedEquipment(equipementsReservation(editReservation));
    setLocation(editReservation.location || editReservation.propertyAddress || '');
    setMandateNumber(editReservation.mandateNumber || '');
    setProjectName(editReservation.projectName || '');
    setNote(editReservation.note || '');
    setSubmitError(null);
  }, [isOpen, editReservation]);

  if (!isOpen) return null;

  // Demande explicite (10 octobre) : « comme une appli, avec des boutons
  // comme des pads plus gros, et plus facile à utiliser » — icônes vectorielles
  // (déjà présentes ici, juste jamais affichées) à la place des emoji.
  const EQUIPMENT_OPTIONS = [
    { id: 'Caméra Giraffe', label: 'Caméra Giraffe', icon: Video },
    { id: 'Caméra DJI', label: 'Caméra DJI', icon: Camera },
    { id: 'Caméra X4', label: 'Caméra X4', icon: Package },
    { id: 'Community Manager', label: 'Community Manager', icon: Clapperboard },
  ];

  // Calendar calculations
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

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

  const hasTimeConflict = (equipment: string, start: string, end: string, excludeId?: string) => {
    return selectedDayReservations.some((reservation) => {
      if (excludeId && reservation.id === excludeId) return false;

      const bookedEquipment = equipementsReservation(reservation);

      if (!bookedEquipment.includes(equipment)) {
        return false;
      }

      const bookedStart = reservation.startTime || reservation.startDate.slice(-5);
      const bookedEnd = reservation.endTime || reservation.endDate.slice(-5);

      return start < bookedEnd && end > bookedStart;
    });
  };

  // Conflits avec les autres réservations (mêmes équipements, créneau qui se
  // chevauche) — utilisé pour l'indicateur de disponibilité vu par l'admin
  // dans la fenêtre de contrôle d'une demande.
  const getConflictingReservations = (target: StoredCameraReservation) => {
    return reservations.filter((reservation) => {
      if (reservation.id === target.id) return false;
      if (reservation.status === 'Refusée') return false;

      const sameDay = reservation.startDate.slice(0, 10) === target.startDate.slice(0, 10);
      if (!sameDay) return false;

      const sharesEquipment = partagentUnEquipement(reservation, target);
      if (!sharesEquipment) return false;

      const rStart = reservation.startTime || reservation.startDate.slice(-5);
      const rEnd = reservation.endTime || reservation.endDate.slice(-5);
      const tStart = target.startTime || target.startDate.slice(-5);
      const tEnd = target.endTime || target.endDate.slice(-5);

      return tStart < rEnd && tEnd > rStart;
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
      hasTimeConflict(equipment, startTime, endTime, editReservation?.id)
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

      if (editReservation) {
        const { error: updateError } = await supabase
          .from('camera_reservations' as any)
          .update({
            description,
            start_at: startAtIso,
            end_at: endAtIso,
          } as any)
          .eq('id', editReservation.id);
        if (updateError) throw updateError;
      } else {
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
      }

      // La liste se rafraîchit toute seule via l'abonnement temps réel du
      // hook partagé (useCameraReservations) — plus besoin de la mettre à
      // jour ici à la main.

      if (!editReservation && onAddReservation) {
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
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {editReservation ? 'Modifier la réservation' : 'Réservation de matériel'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {editReservation
                ? 'Ajustez le créneau ou le matériel, puis enregistrez.'
                : <>Remplissez le formulaire. La demande sera validée par <span className="text-slate-200 font-semibold">Sylvain ou Mélanie Grazia</span>.</>}
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
                  onClick={() => {
                    // Demande explicite : on perdait le fil de la date
                    // demandée en parcourant le calendrier soi-même — on
                    // recale systématiquement le calendrier sur le jour de
                    // la demande ouverte, pour qu'il ne reste jamais sur un
                    // mois parcouru entre-temps.
                    const [datePart] = res.startDate.split(' ');
                    const [y, m, d] = datePart.split('-').map(Number);
                    if (y && m && d) {
                      setViewDate(new Date(y, m - 1, 1));
                      setSelectedDayNum(d);
                    }
                    setDetailReservation(res);
                  }}
                  className="w-full flex items-center justify-between gap-3 bg-[#050f14] border border-[#182e38] rounded-xl p-3 text-left hover:border-[#F7BC5F]/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{res.equipmentName}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {res.agentName} • {formatReservationDateFr(res)}
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
            <h3 className="text-lg font-bold text-white">
              {editReservation ? 'Réservation mise à jour !' : 'Demande enregistrée avec succès !'}
            </h3>
            <p className="text-xs text-slate-400">
              {editReservation
                ? 'Les modifications ont été enregistrées.'
                : 'Sylvain et Mélanie Grazia ont été notifiés et valideront votre demande.'}
            </p>
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

          {/* Demande explicite (10 octobre) : « comme une appli, avec des
              boutons comme des pads plus gros, et plus facile à utiliser » —
              étapes numérotées et grandes cartes tactiles à la place de la
              grille de calendrier et des petits champs texte, sur le modèle
              validé par Sylvain (capture d'écran fournie). */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

              {/* Colonne gauche : date, horaire, matériel */}
              <div className="lg:col-span-7 space-y-5">

                {/* 1. Date */}
                <div>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-xs font-black flex items-center justify-center shrink-0">1</span>
                      <label className="text-sm font-extrabold text-white">Sélectionner une date *</label>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handlePrevMonth}
                        className="w-7 h-7 rounded-full bg-[#051319] border border-[#132c37] hover:border-purple-500/50 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-bold text-slate-300 min-w-[90px] text-center">
                        {monthNames[month]} {year}
                      </span>
                      <button
                        type="button"
                        onClick={handleNextMonth}
                        className="w-7 h-7 rounded-full bg-[#051319] border border-[#132c37] hover:border-purple-500/50 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2.5 overflow-x-auto pb-1 custom-scrollbar">
                    {Array.from({ length: totalDaysInMonth }).map((_, idx) => {
                      const dayNum = idx + 1;
                      const isSelected = selectedDayNum === dayNum;
                      const dayDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                      const hasBookings = reservations.some((reservation) =>
                        reservation.startDate.startsWith(dayDate)
                      );
                      const dow = dayNames[new Date(year, month, dayNum).getDay()].slice(0, 3).toUpperCase();

                      return (
                        <button
                          key={`day-${dayNum}`}
                          type="button"
                          onClick={() => setSelectedDayNum(dayNum)}
                          className={`shrink-0 w-[68px] h-[92px] rounded-2xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-gradient-to-br from-purple-600 via-fuchsia-600 to-pink-600 text-white shadow-lg shadow-purple-900/40'
                              : 'bg-[#051319] border border-[#132c37] text-slate-300 hover:border-purple-500/40'
                          }`}
                        >
                          <span className="text-[10px] font-extrabold tracking-wide opacity-80">{dow}</span>
                          <span className="text-xl font-black">{dayNum}</span>
                          {hasBookings && (
                            <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-[#c084fc]'}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Horaire */}
                <div>
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-xs font-black flex items-center justify-center shrink-0">2</span>
                    <label className="text-sm font-extrabold text-white">Choisir l'horaire *</label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-3 bg-[#051319] border border-[#132c37] rounded-2xl px-4 py-3 cursor-pointer focus-within:border-purple-500 transition-colors">
                      <span className="w-9 h-9 rounded-full bg-purple-950/50 text-purple-300 flex items-center justify-center shrink-0">
                        <Clock className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] text-slate-400 font-semibold">Heure de début</span>
                        <input
                          type="time"
                          required
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full bg-transparent border-none p-0 text-lg font-extrabold text-white focus:outline-none [color-scheme:dark]"
                        />
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                    </label>

                    <label className="flex items-center gap-3 bg-[#051319] border border-[#132c37] rounded-2xl px-4 py-3 cursor-pointer focus-within:border-purple-500 transition-colors">
                      <span className="w-9 h-9 rounded-full bg-purple-950/50 text-purple-300 flex items-center justify-center shrink-0">
                        <Clock className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] text-slate-400 font-semibold">Heure de fin</span>
                        <input
                          type="time"
                          required
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full bg-transparent border-none p-0 text-lg font-extrabold text-white focus:outline-none [color-scheme:dark]"
                        />
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                    </label>
                  </div>
                </div>

                {/* 3. Matériel */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-xs font-black flex items-center justify-center shrink-0">3</span>
                      <label className="text-sm font-extrabold text-white">Matériel requis *</label>
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium">
                      {selectedEquipment.length} sélectionné
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {EQUIPMENT_OPTIONS.map((item) => {
                      const isSelected = selectedEquipment.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleEquipment(item.id)}
                          aria-pressed={isSelected}
                          className={`p-3.5 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all select-none text-left ${
                            isSelected
                              ? 'bg-[#28133b] border-purple-500 text-white shadow-sm shadow-purple-900/20'
                              : 'bg-[#051319] border-[#132c37] text-slate-300 hover:border-purple-500/40'
                          }`}
                        >
                          <span className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                            <item.icon className="w-5 h-5" />
                          </span>
                          <span className="flex-1 min-w-0 text-sm font-extrabold truncate">{item.label}</span>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center border shrink-0 transition-colors ${
                            isSelected ? 'bg-purple-500 border-purple-400 text-white' : 'border-slate-600'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Réservations existantes ce jour */}
                  <div className="mt-3 bg-purple-950/15 border border-purple-500/25 rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-bold text-slate-200">
                        <Calendar className="w-3.5 h-3.5 text-purple-400" />
                        Réservations existantes ce jour
                      </span>
                      <span className="text-[10px] font-bold text-slate-200 bg-white/10 px-2.5 py-0.5 rounded-full shrink-0">
                        {selectedDayReservations.length} réservation{selectedDayReservations.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    {!hasExistingReservation ? (
                      <p className="text-xs text-emerald-400 font-semibold">Aucune réservation ce jour — créneau libre.</p>
                    ) : (
                      selectedDayReservations.map((reservation) => (
                        <div key={reservation.id} className="flex items-center justify-between gap-3 bg-white/5 rounded-xl px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{reservation.equipmentName}</p>
                            <p className="text-[11px] text-slate-400 truncate">Agent : {reservation.agentName} • {reservation.status}</p>
                          </div>
                          <span className="text-[11px] font-bold text-slate-200 shrink-0">
                            {reservation.startTime || reservation.startDate.slice(-5)} - {reservation.endTime || reservation.endDate.slice(-5)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Colonne droite : informations complémentaires */}
              <div className="lg:col-span-5 space-y-3">
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-xs font-black flex items-center justify-center shrink-0">4</span>
                  <label className="text-sm font-extrabold text-white">Informations complémentaires</label>
                </div>

                <div className="bg-[#051319] border border-[#132c37] rounded-2xl p-3.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-white mb-2">
                    <MapPin className="w-3.5 h-3.5 text-purple-400" />
                    Lieu
                  </label>
                  <input
                    type="text"
                    placeholder="Adresse, ville..."
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-[#050f14] border border-[#142832] focus:border-purple-500 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                  />
                </div>

                <div className="bg-[#051319] border border-[#132c37] rounded-2xl p-3.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-white mb-2">
                    <Hash className="w-3.5 h-3.5 text-purple-400" />
                    N° mandat (optionnel)
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
                    className="w-full bg-[#050f14] border border-[#142832] focus:border-purple-500 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                  />
                </div>

                <div className="bg-[#051319] border border-[#132c37] rounded-2xl p-3.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-white mb-2">
                    <Briefcase className="w-3.5 h-3.5 text-purple-400" />
                    Projet
                  </label>
                  <input
                    type="text"
                    placeholder="Nom du projet..."
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full bg-[#050f14] border border-[#142832] focus:border-purple-500 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
                  />
                </div>

                <div className="bg-[#051319] border border-[#132c37] rounded-2xl p-3.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-white mb-2">
                    <FileText className="w-3.5 h-3.5 text-purple-400" />
                    Note (optionnel)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Informations supplémentaires..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full bg-[#050f14] border border-[#142832] focus:border-purple-500 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none resize-none transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Footer Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#142832]">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-3 rounded-full border border-[#132c37] bg-[#051319] text-slate-300 hover:text-white hover:border-purple-500/40 text-xs font-bold transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || loadingReservations}
                className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:opacity-95 text-white font-black text-xs shadow-lg shadow-purple-900/40 flex items-center gap-2 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'Enregistrement...'
                    : editReservation
                    ? 'Enregistrer les modifications'
                    : 'Envoyer la demande'}
                </span>
              </button>
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

            {/* Disponibilité du matériel demandé pour ce créneau, comparée aux
                autres réservations (confirmées ou en attente) sur la même
                journée — pour que l'admin sache tout de suite si le
                matériel est libre avant de valider ou refuser. */}
            {(() => {
              const conflicts = getConflictingReservations(detailReservation);
              return conflicts.length === 0 ? (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-xs font-semibold text-emerald-300">
                    Disponible — aucune autre réservation sur ce créneau pour {detailReservation.equipmentName}.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 space-y-2">
                  <p className="text-xs font-semibold text-rose-300 flex items-center gap-2">
                    <XCircle className="w-4 h-4 shrink-0" />
                    Conflit avec {conflicts.length > 1 ? `${conflicts.length} autres réservations` : 'une autre réservation'}
                  </p>
                  <ul className="space-y-1.5">
                    {conflicts.map((conflict) => (
                      <li key={conflict.id} className="text-[11px] text-rose-200/90 pl-6">
                        <span className="font-semibold">{conflict.agentName}</span>
                        {' · '}
                        {conflict.startTime || conflict.startDate.slice(-5)}–{conflict.endTime || conflict.endDate.slice(-5)}
                        {' · '}
                        {conflict.equipmentName}
                        {' · '}
                        <span className={conflict.status === 'Confirmée' ? 'text-rose-300' : 'text-amber-300'}>
                          {conflict.status === 'Confirmée' ? 'validée' : 'en attente'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

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