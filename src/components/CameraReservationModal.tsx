import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Camera, X, Clock, ClipboardList, Calendar, Hash, Briefcase,
  CheckCircle2, XCircle, Video, Film, Package, Clapperboard,
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
import {
  ajouterMinutes,
  creneauConflit,
  creneauxAffiches,
  disponibiliteJour,
  heuresFinAffichees,
  libelleDuree,
  plageConflit,
} from '@/lib/creneauxReservationCamera';
import { FormulaireReservationMateriel } from '@/components/reservation/FormulaireReservationMateriel';

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
  const [voirReservations, setVoirReservations] = useState(false);
  const [etapeMobile, setEtapeMobile] = useState(1);
  const [sensMois, setSensMois] = useState<1 | -1>(1);
  const [ecranEtroit, setEcranEtroit] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [ongletHoraire, setOngletHoraire] = useState<'debut' | 'fin'>('debut');
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const appliquer = () => setEcranEtroit(media.matches);
    media.addEventListener('change', appliquer);
    return () => media.removeEventListener('change', appliquer);
  }, []);

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
    if (!isOpen) return;
    setVoirReservations(false);
    setEtapeMobile(1);
    setOngletHoraire('debut');
  }, [isOpen]);

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
    setOngletHoraire('debut');
  }, [isOpen, editReservation]);

  if (!isOpen) return null;

  const MATERIELS = [
    { id: 'Caméra Giraffe', label: 'Caméra Giraffe', detail: 'Visites immersives', tint: 'from-violet-950 to-fuchsia-900', Icon: Video },
    { id: 'Caméra DJI', label: 'Caméra DJI', detail: 'Visites immersives', tint: 'from-slate-800 to-violet-950', Icon: Camera },
    { id: 'Caméra X4', label: 'Caméra X4', detail: 'Photos 360', tint: 'from-zinc-800 to-slate-900', Icon: Package },
    { id: 'Community Manager', label: 'Community Manager', detail: 'Photos pro', tint: 'from-amber-950 to-orange-950', Icon: Clapperboard },
  ];

  // Calendar calculations
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  const changerMois = (delta: 1 | -1) => {
    setSensMois(delta);
    const next = new Date(year, month + delta, 1);
    setViewDate(next);
    const max = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    setSelectedDayNum((jour) => Math.min(jour, max));
  };
  const allerAujourdhui = () => {
    const maintenant = new Date();
    setSensMois(maintenant >= viewDate ? 1 : -1);
    setViewDate(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
    setSelectedDayNum(maintenant.getDate());
    if (ecranEtroit) setEtapeMobile(2);
  };
  const choisirJour = (jour: number) => {
    setSelectedDayNum(jour);
    if (ecranEtroit) setEtapeMobile(2);
  };
  const choisirDebut = (heure: string) => {
    const reservationsDuCreneau = selectedDayReservations;
    const equipement = selectedEquipment;
    const ignore = editReservation?.id;
    if (creneauConflit(heure, reservationsDuCreneau, equipement, ignore)) {
      setSubmitError('Cette heure de début est déjà prise pour le matériel choisi.');
      return;
    }
    setStartTime(heure);
    setEndTime((fin) => (fin > heure ? fin : ajouterMinutes(heure, 60)));
    setOngletHoraire('fin');
    setSubmitError(null);
  };
  const choisirFin = (heure: string) => {
    const reservationsDuCreneau = selectedDayReservations;
    const equipement = selectedEquipment;
    const ignore = editReservation?.id;
    if (heure <= startTime) {
      // Si l'utilisateur clique une heure antérieure ou égale au début, on repositionne intelligemment le début
      setStartTime(heure);
      setEndTime(ajouterMinutes(heure, 60));
      setSubmitError(null);
      return;
    }
    if (plageConflit(startTime, heure, reservationsDuCreneau, equipement, ignore)) {
      setSubmitError('Cette plage chevauche une réservation déjà posée pour ce matériel.');
      return;
    }
    setEndTime(heure);
    setSubmitError(null);
    if (ecranEtroit) setEtapeMobile(3);
  };

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
      setSubmitError('Choisissez l’heure de début, puis l’heure de fin.');
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

  const aujourdhui = new Date();
  const aujourdhuiIso = `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, '0')}-${String(aujourdhui.getDate()).padStart(2, '0')}`;
  const premierJour = new Date(year, month, 1).getDay();
  const decalage = (premierJour + 6) % 7;
  const jours = [
    ...Array.from({ length: decalage }, (_, index) => ({
      cle: `vide-${month}-${index}`,
      jour: null as number | null,
      selectionne: false,
      passe: false,
      niveau: null,
    })),
    ...Array.from({ length: totalDaysInMonth }, (_, index) => {
      const jour = index + 1;
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
      return {
        cle: iso,
        jour,
        selectionne: jour === selectedDayNum,
        passe: iso < aujourdhuiIso,
        niveau: disponibiliteJour(iso, aujourdhuiIso, reservations, selectedEquipment),
      };
    }),
  ];
  const dateChoisie = new Date(year, month, selectedDayNum).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const creneauxDebut = creneauxAffiches(startTime).map((heure) => ({
    debut: heure,
    occupe: creneauConflit(heure, selectedDayReservations, selectedEquipment, editReservation?.id),
    actif: heure === startTime,
  }));
  const creneauxFin = heuresFinAffichees(startTime, endTime).map((heure) => ({
    debut: heure,
    occupe: plageConflit(startTime, heure, selectedDayReservations, selectedEquipment, editReservation?.id),
    dansPlage: heure > startTime && heure < endTime,
    actif: heure === endTime,
  }));
  const plage = endTime > startTime
    ? `${startTime} – ${endTime} · ${libelleDuree(startTime, endTime)}`
    : 'Choisissez l’heure de début, puis l’heure de fin.';
  const reservationsDuJour = selectedDayReservations
    .filter((reservation) => reservation.status !== 'Refusée')
    .map((reservation) => ({
      id: reservation.id,
      label: reservation.equipmentName,
      horaire: `${reservation.startTime || reservation.startDate.slice(-5)}–${reservation.endTime || reservation.endDate.slice(-5)}`,
      statut: reservation.status,
    }));
  const resumes: [string, string, string, string] = [
    dateChoisie,
    plage,
    selectedEquipment.join(', ') || 'Aucun matériel',
    location.trim() || 'Lieu, projet, note',
  ];
  const reservationsVisibles = (isCameraAdmin
    ? reservations
    : reservations.filter((reservation) => reservation.createdByUserId === currentUser?.uid)
  ).slice().sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 backdrop-blur-sm p-0 sm:p-6 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="bg-[var(--nv-surface-1)] text-[var(--ink-1)] border border-[var(--nv-border-1)] w-full sm:max-w-6xl rounded-t-[28px] sm:rounded-[28px] shadow-2xl h-[100dvh] sm:h-[min(92vh,920px)] max-h-[100dvh] flex flex-col overflow-hidden"
      >
        <div className="shrink-0 bg-[var(--nv-surface-1)] px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex items-start gap-3 border-b border-[var(--nv-border-1)]">
          <div className="w-11 h-11 rounded-2xl bg-violet-600 text-white flex items-center justify-center shrink-0">
            <Camera className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-[var(--ink-1)] tracking-tight">
              {editReservation ? 'Modifier la réservation' : 'Réservation de matériel'}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--ink-2)] mt-0.5">
              Réservez facilement une caméra pour vos prises de vue immersives.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVoirReservations((ouvert) => !ouvert)}
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[var(--nv-border-1)] text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--nv-wash)]"
          >
            <ClipboardList className="w-4 h-4" />
            {voirReservations ? 'Nouvelle demande' : 'Vos réservations'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="w-9 h-9 rounded-full text-[var(--ink-2)] hover:bg-[var(--nv-wash)] hover:text-[var(--ink-1)] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          <button
            type="button"
            onClick={() => setVoirReservations((ouvert) => !ouvert)}
            className="sm:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[var(--nv-border-1)] text-sm font-medium text-[var(--ink-2)]"
          >
            <ClipboardList className="w-4 h-4" />
            {voirReservations ? 'Nouvelle demande' : 'Vos réservations'}
          </button>

          {isCameraAdmin && pendingReservations.length > 0 && !isSuccess && (
            <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-violet-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {pendingReservations.length} demande{pendingReservations.length > 1 ? 's' : ''} en attente
              </p>
              {pendingReservations.map((res) => (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => {
                    const [datePart] = res.startDate.split(' ');
                    const [y, m, d] = datePart.split('-').map(Number);
                    if (y && m && d) {
                      setViewDate(new Date(y, m - 1, 1));
                      setSelectedDayNum(d);
                    }
                    setDetailReservation(res);
                  }}
                  className="w-full flex items-center justify-between gap-3 bg-[var(--nv-field)] border border-[var(--nv-border-1)] rounded-xl px-3 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--ink-1)] truncate">{res.equipmentName}</span>
                    <span className="block text-[11px] text-[var(--ink-2)] truncate">{res.agentName} · {formatReservationDateFr(res)}</span>
                  </span>
                  <span className="text-xs font-semibold text-[var(--ink-violet)] shrink-0">Contrôler</span>
                </button>
              ))}
            </div>
          )}

          {(submitError || loadError) && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-[var(--ink-rose)] text-sm">
              {submitError || loadError}
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {isSuccess ? (
              <motion.div
                key="succes"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="py-16 text-center"
              >
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <h3 className="text-lg font-semibold text-[var(--ink-1)] mt-3">
                  {editReservation ? 'Réservation mise à jour' : 'Demande enregistrée'}
                </h3>
                <p className="text-sm text-[var(--ink-2)] mt-1">
                  {editReservation
                    ? 'Les modifications ont été enregistrées.'
                    : 'Sylvain et Mélanie Grazia ont été notifiés.'}
                </p>
              </motion.div>
            ) : voirReservations ? (
              <motion.div
                key="liste"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
                className="space-y-2"
              >
                {reservationsVisibles.length === 0 ? (
                  <p className="text-sm text-[var(--ink-2)] py-8 text-center">Aucune réservation pour le moment.</p>
                ) : reservationsVisibles.map((reservation) => (
                  <div key={reservation.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--nv-border-1)] bg-[var(--nv-field)] px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--ink-1)] truncate">{reservation.equipmentName}</p>
                      <p className="text-xs text-[var(--ink-2)] truncate">{formatReservationDateFr(reservation)}</p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full shrink-0 ${
                      reservation.status === 'Confirmée'
                        ? 'bg-emerald-500/15 text-[var(--ink-emerald)]'
                        : reservation.status === 'Refusée'
                          ? 'bg-rose-500/15 text-[var(--ink-rose)]'
                          : 'bg-amber-500/15 text-[var(--ink-amber)]'
                    }`}>
                      {reservation.status}
                    </span>
                  </div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="formulaire"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.25 }}
              >
                {loadingReservations && (
                  <p className="text-xs text-[var(--ink-violet)] mb-3">Chargement du planning...</p>
                )}
                <FormulaireReservationMateriel
                  mobile={ecranEtroit}
                  etape={etapeMobile}
                  onEtape={setEtapeMobile}
                  resumes={resumes}
                  moisLabel={`${monthNames[month]} ${year}`}
                  moisCle={`${year}-${month}`}
                  sensMois={sensMois}
                  onMoisPrecedent={() => changerMois(-1)}
                  onMoisSuivant={() => changerMois(1)}
                  onAujourdhui={allerAujourdhui}
                  jours={jours}
                  onChoisirJour={choisirJour}
                  dateChoisie={dateChoisie}
                  ongletHoraire={ongletHoraire}
                  onOngletHoraire={setOngletHoraire}
                  debut={startTime}
                  fin={endTime}
                  creneauxDebut={creneauxDebut}
                  creneauxFin={creneauxFin}
                  plage={plage}
                  onChoisirDebut={choisirDebut}
                  onChoisirFin={choisirFin}
                  reservationsDuJour={reservationsDuJour}
                  materiels={MATERIELS.map((materiel) => ({
                    ...materiel,
                    selectionne: selectedEquipment.includes(materiel.id),
                  }))}
                  onBasculerMateriel={toggleEquipment}
                  lieu={location}
                  onLieu={setLocation}
                  projet={projectName}
                  onProjet={setProjectName}
                  mandat={mandateNumber}
                  onMandat={setMandateNumber}
                  note={note}
                  onNote={setNote}
                  onAnnuler={onClose}
                  onConfirmer={() => { void handleSubmit({ preventDefault() {} } as React.FormEvent); }}
                  confirmationLabel={submitting ? 'Enregistrement...' : editReservation ? 'Enregistrer les modifications' : 'Confirmer la réservation'}
                  confirmationDesactivee={submitting || loadingReservations || endTime <= startTime}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

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