import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Camera, X, ChevronLeft, ChevronRight, Clock, MapPin, Calendar,
  Hash, Briefcase, CheckCircle2, XCircle, Video, Film, Package, Clapperboard, Send,
  FileText,
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
  // Demande explicite : pouvoir cliquer sur une réservation déjà enregistrée
  // (depuis ReserverCameraView) pour la modifier au lieu d'en recréer une —
  // ouvre ce même formulaire pré-rempli, en UPDATE plutôt qu'en INSERT.
  editReservation?: StoredCameraReservation | null;
}

// Refonte (21 octobre, demande explicite : « les personnes se mélangent »,
// maquette validée par Sylvain) : qui a déjà réservé quoi devait avant se
// deviner en recoupant une liste séparée. Chaque agent reçoit maintenant un
// avatar (initiales + couleur stable, dérivée de son nom) affiché directement
// sur le créneau ou le matériel qu'il occupe — plus besoin de recouper.
const AVATAR_PALETTE = ['#2dd4bf', '#38bdf8', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#4ade80', '#60a5fa'];
const getAgentInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};
const getAgentColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

// Grille de créneaux fixes de 30 min (remplace les deux champs horaires
// libres) — bornes vérifiées en base le 21 octobre pour couvrir toutes les
// réservations réelles existantes (09:00-19:00).
const SLOT_STEP_MINUTES = 30;
const SLOT_GRID_START_MIN = 8 * 60;
const SLOT_GRID_END_MIN = 19 * 60 + 30;
const minutesToTime = (mins: number): string => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const SLOT_TIMES: string[] = [];
for (let m = SLOT_GRID_START_MIN; m < SLOT_GRID_END_MIN; m += SLOT_STEP_MINUTES) {
  SLOT_TIMES.push(minutesToTime(m));
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
    setSelectedEquipment(
      editReservation.equipmentList?.length
        ? editReservation.equipmentList
        : editReservation.equipmentName.split(',').map((item) => item.trim())
    );
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
    { id: 'Caméra Giraffe', label: 'Caméra Giraffe', sub: 'Visites immersives', icon: Video, tileClass: 'bg-gradient-to-br from-teal-700 to-teal-400' },
    { id: 'Caméra DJI', label: 'Caméra DJI', sub: 'Visites immersives', icon: Camera, tileClass: 'bg-gradient-to-br from-blue-700 to-blue-400' },
    { id: 'Caméra X4', label: 'Caméra X4', sub: 'Visites immersives', icon: Package, tileClass: 'bg-gradient-to-br from-zinc-600 to-zinc-400' },
    { id: 'Community Manager', label: 'Community Manager', sub: 'Photos & réseaux', icon: Clapperboard, tileClass: 'bg-gradient-to-br from-amber-700 to-amber-400' },
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

  // Refonte (21 octobre) : clic sur un créneau — premier clic (ou clic sur un
  // créneau antérieur au début actuel) repart d'une réservation de 30 min à
  // cet horaire ; un clic sur un créneau plus tardif étend la fin jusqu'à
  // couvrir ce créneau, comme un sélecteur de plage de dates classique.
  const handleSlotClick = (time: string) => {
    if (time <= startTime) {
      setStartTime(time);
      setEndTime(minutesToTime(timeToMinutes(time) + SLOT_STEP_MINUTES));
    } else {
      setEndTime(minutesToTime(timeToMinutes(time) + SLOT_STEP_MINUTES));
    }
  };

  // Réservations du jour sélectionné
  const formattedDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDayNum).padStart(2, '0')}`;

  const selectedDayReservations = reservations
    .filter((reservation) => reservation.startDate.startsWith(formattedDateStr))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Refonte (21 octobre) : renvoie désormais la réservation en conflit (pas
  // juste un booléen) pour pouvoir afficher QUI bloque le créneau/matériel —
  // c'est le cœur du correctif « les personnes se mélangent ».
  const findConflictingReservation = (
    equipment: string,
    start: string,
    end: string,
    excludeId?: string
  ): StoredCameraReservation | null => {
    return (
      selectedDayReservations.find((reservation) => {
        if (excludeId && reservation.id === excludeId) return false;

        const bookedEquipment = reservation.equipmentList?.length
          ? reservation.equipmentList
          : reservation.equipmentName.split(',').map((item) => item.trim());

        if (!bookedEquipment.includes(equipment)) {
          return false;
        }

        const bookedStart = reservation.startTime || reservation.startDate.slice(-5);
        const bookedEnd = reservation.endTime || reservation.endDate.slice(-5);

        return start < bookedEnd && end > bookedStart;
      }) || null
    );
  };

  const hasTimeConflict = (equipment: string, start: string, end: string, excludeId?: string) =>
    !!findConflictingReservation(equipment, start, end, excludeId);

  // Un créneau de la grille (étape 2) est pris dès qu'il chevauche une
  // réservation sur L'UN des matériels actuellement sélectionnés.
  const findSlotConflict = (slotStart: string): StoredCameraReservation | null => {
    const slotEnd = minutesToTime(timeToMinutes(slotStart) + SLOT_STEP_MINUTES);
    for (const equipment of selectedEquipment) {
      const conflict = findConflictingReservation(equipment, slotStart, slotEnd, editReservation?.id);
      if (conflict) return conflict;
    }
    return null;
  };

  // Trombinoscope du jour (bandeau en haut du formulaire) : un agent par
  // personne, même s'il a plusieurs réservations ce jour-là.
  const todaysAgents = Array.from(
    new Map(selectedDayReservations.map((reservation) => [reservation.agentName, reservation])).values()
  );

  // Grille du calendrier mensuel (remplace le défilement horizontal) — cases
  // des mois voisins non cliquables, pastille de densité par jour.
  const firstDayWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = lundi
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCalendarCells = Math.ceil((firstDayWeekday + totalDaysInMonth) / 7) * 7;
  const calendarCells = Array.from({ length: totalCalendarCells }, (_, idx) => {
    const dayOffset = idx - firstDayWeekday;
    if (dayOffset < 0) {
      return { label: daysInPrevMonth + dayOffset + 1, inMonth: false as const, dayNum: null, isSelected: false, density: null };
    }
    if (dayOffset >= totalDaysInMonth) {
      return { label: dayOffset - totalDaysInMonth + 1, inMonth: false as const, dayNum: null, isSelected: false, density: null };
    }
    const dayNum = dayOffset + 1;
    const dayDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayCount = reservations.filter((r) => r.startDate.startsWith(dayDate)).length;
    const density = dayCount === 0 ? null : dayCount >= 4 ? 'full' : dayCount >= 2 ? 'busy' : 'light';
    return { label: dayNum, inMonth: true as const, dayNum, isSelected: dayNum === selectedDayNum, density };
  });

  // Conflits avec les autres réservations (mêmes équipements, créneau qui se
  // chevauche) — utilisé pour l'indicateur de disponibilité vu par l'admin
  // dans la fenêtre de contrôle d'une demande.
  const getConflictingReservations = (target: StoredCameraReservation) => {
    return reservations.filter((reservation) => {
      if (reservation.id === target.id) return false;
      if (reservation.status === 'Refusée') return false;

      const sameDay = reservation.startDate.slice(0, 10) === target.startDate.slice(0, 10);
      if (!sameDay) return false;

      const sharesEquipment = reservation.equipmentList.some((equipment) =>
        target.equipmentList.includes(equipment)
      );
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      {/* Demande explicite (21 octobre) : « plein écran sur PC pour ne pas
          scrolled » — hauteur désormais fixée à (quasi) toute la fenêtre au
          lieu de s'ajuster au contenu (qui dépassait sur les écrans moins
          hauts) ; le défilement, s'il en reste besoin sur un tout petit
          écran, se fait maintenant DANS la fenêtre plutôt que sur tout le
          fond derrière elle. */}
      <div className="bg-[#09151c] border border-[#182e38] rounded-3xl w-full sm:max-w-[1760px] sm:h-[calc(100vh-32px)] p-6 sm:p-9 text-white shadow-2xl relative space-y-7 overflow-y-auto custom-scrollbar">
        
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

          {/* Refonte (21 octobre, demande explicite : « les personnes se
              mélangent ») — maquette validée par Sylvain. Calendrier mensuel
              + grille de créneaux + liste de matériel, tous les trois avec
              un avatar nominatif dès qu'ils sont déjà pris, plus un bandeau
              listant qui a déjà réservé ce jour-là : qui a quoi est visible
              d'un coup d'œil, sans recouper une liste séparée. */}
          <form onSubmit={handleSubmit} className="space-y-6">

            {hasExistingReservation && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-purple-950/20 border border-purple-500/25 rounded-2xl">
                <div className="flex shrink-0">
                  {todaysAgents.map((agent, idx) => (
                    <span
                      key={agent.id}
                      title={agent.agentName}
                      style={{ backgroundColor: getAgentColor(agent.agentName), marginLeft: idx === 0 ? 0 : -8 }}
                      className="w-7 h-7 rounded-full border-2 border-[#09151c] flex items-center justify-center text-[10px] font-extrabold text-[#04090c]"
                    >
                      {getAgentInitials(agent.agentName)}
                    </span>
                  ))}
                </div>
                <p className="text-xs font-bold text-purple-200 flex-1">
                  {selectedDayReservations.length} réservation{selectedDayReservations.length > 1 ? 's' : ''} ce jour — vérifiez avant de choisir, pour éviter les doublons.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

              {/* 1. Date */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-sm font-black flex items-center justify-center shrink-0">1</span>
                  <label className="text-base font-extrabold text-white">Choisir une date *</label>
                </div>
                <div className="bg-[#051319] border border-[#132c37] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      className="w-8 h-8 rounded-full bg-[#0a1a21] hover:bg-[#132c37] text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-bold text-slate-200">{monthNames[month]} {year}</span>
                    <button
                      type="button"
                      onClick={handleNextMonth}
                      className="w-8 h-8 rounded-full bg-[#0a1a21] hover:bg-[#132c37] text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                    {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((wd, i) => (
                      <span key={i} className="text-center text-[10px] font-extrabold text-slate-500">{wd}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {calendarCells.map((cell, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={!cell.inMonth}
                        onClick={() => cell.inMonth && cell.dayNum && setSelectedDayNum(cell.dayNum)}
                        className={`relative h-11 rounded-lg flex items-center justify-center text-sm font-bold transition-colors ${
                          !cell.inMonth
                            ? 'text-slate-700 cursor-default'
                            : cell.isSelected
                            ? 'bg-gradient-to-br from-purple-600 via-fuchsia-600 to-pink-600 text-white shadow-md shadow-purple-900/40 cursor-pointer'
                            : 'text-slate-300 hover:bg-white/5 cursor-pointer'
                        }`}
                      >
                        {cell.label}
                        {cell.inMonth && cell.density && !cell.isSelected && (
                          <span
                            className="absolute bottom-1.5 w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: cell.density === 'full' ? '#fb7185' : cell.density === 'busy' ? '#fbbf24' : '#a78bfa' }}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3.5 mt-4 pt-4 border-t border-[#132c37] flex-wrap">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa]" />Disponible</span>
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-[#fbbf24]" />Peu de créneaux</span>
                    <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-[#fb7185]" />Complet</span>
                  </div>
                </div>
              </div>

              {/* 2. Créneau */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-sm font-black flex items-center justify-center shrink-0">2</span>
                  <label className="text-base font-extrabold text-white">Choisir un créneau *</label>
                </div>
                <div className="bg-[#051319] border border-[#132c37] rounded-2xl p-5">
                  <p className="text-xs font-bold text-slate-400 mb-4 capitalize">
                    {dayNames[new Date(year, month, selectedDayNum).getDay()]} {selectedDayNum} {monthNames[month].toLowerCase()} {year}
                  </p>
                  <div className="grid grid-cols-3 gap-2.5 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                    {SLOT_TIMES.map((time) => {
                      const conflict = findSlotConflict(time);
                      const taken = !!conflict;
                      const inRange = !taken && timeToMinutes(time) >= timeToMinutes(startTime) && timeToMinutes(time) < timeToMinutes(endTime);
                      return (
                        <button
                          key={time}
                          type="button"
                          disabled={taken}
                          onClick={() => handleSlotClick(time)}
                          className={`h-14 rounded-xl flex flex-col items-center justify-center gap-1 border transition-colors ${
                            taken
                              ? 'bg-[#0a1319] border-[#1c2b32] cursor-default'
                              : inRange
                              ? 'bg-gradient-to-br from-purple-600 via-fuchsia-600 to-pink-600 border-transparent shadow-md shadow-purple-900/40 cursor-pointer'
                              : 'bg-[#09151c] border-[#16303b] hover:border-purple-500/40 cursor-pointer'
                          }`}
                        >
                          <span className={`text-xs font-extrabold ${taken ? 'text-slate-600 line-through' : inRange ? 'text-white' : 'text-slate-200'}`}>
                            {time}
                          </span>
                          {conflict && (
                            <span className="flex items-center gap-1">
                              <span
                                style={{ backgroundColor: getAgentColor(conflict.agentName) }}
                                className="w-4 h-4 rounded-full flex items-center justify-center text-[6.5px] font-extrabold text-[#04090c] shrink-0"
                              >
                                {getAgentInitials(conflict.agentName)}
                              </span>
                              <span className="text-[8.5px] font-bold text-slate-500 truncate max-w-[46px]">{conflict.agentName.split(' ')[0]}</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-4 pt-4 border-t border-[#132c37] text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-purple-400" />
                    {startTime} – {endTime}
                  </p>
                </div>
              </div>

              {/* 3. Matériel */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-sm font-black flex items-center justify-center shrink-0">3</span>
                    <label className="text-base font-extrabold text-white">Matériel requis *</label>
                  </div>
                  <span className="text-xs text-slate-400 font-medium">
                    {selectedEquipment.length} sélectionné
                  </span>
                </div>

                <div className="space-y-2.5">
                  {EQUIPMENT_OPTIONS.map((item) => {
                    const isSelected = selectedEquipment.includes(item.id);
                    const conflict = findConflictingReservation(item.id, startTime, endTime, editReservation?.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleEquipment(item.id)}
                        aria-pressed={isSelected}
                        className={`w-full p-4 rounded-2xl border flex items-center gap-3.5 cursor-pointer transition-all select-none text-left ${
                          isSelected
                            ? 'bg-[#28133b] border-purple-500 text-white shadow-sm shadow-purple-900/20'
                            : 'bg-[#051319] border-[#132c37] text-slate-300 hover:border-purple-500/40'
                        }`}
                      >
                        <span className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 text-white ${item.tileClass}`}>
                          <item.icon className="w-6 h-6" strokeWidth={1.8} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-extrabold truncate">{item.label}</span>
                          <span className="block text-[11px] text-slate-500 truncate mt-0.5">{item.sub}</span>
                        </span>
                        {conflict ? (
                          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 shrink-0">
                            <span
                              style={{ backgroundColor: getAgentColor(conflict.agentName) }}
                              className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-extrabold text-[#04090c] shrink-0"
                            >
                              {getAgentInitials(conflict.agentName)}
                            </span>
                            <span className="text-[9px] font-extrabold text-amber-300 truncate max-w-[70px]">Pris par {conflict.agentName.split(' ')[0]}</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[9px] font-extrabold text-emerald-400 shrink-0">Libre</span>
                        )}
                        <span
                          aria-hidden="true"
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            isSelected ? 'border-transparent bg-gradient-to-br from-purple-600 via-fuchsia-600 to-pink-600' : 'border-slate-600'
                          }`}
                        >
                          {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-white" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 4. Informations complémentaires */}
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white text-xs font-black flex items-center justify-center shrink-0">4</span>
                <label className="text-sm font-extrabold text-white">Informations complémentaires</label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                    rows={2}
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