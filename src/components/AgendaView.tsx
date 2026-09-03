import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar as CalendarIcon, Plus, Clock, MapPin, User, ChevronLeft, ChevronRight, 
  Video, RefreshCw, Trash2, CheckCircle2, ExternalLink, CalendarDays, CalendarRange, List, Camera
} from 'lucide-react';
import {
  format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  startOfWeek, startOfMonth, endOfMonth, endOfWeek, isSameMonth, isSameDay,
  eachDayOfInterval, parseISO, isToday
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  fetchGoogleCalendarEvents,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getCachedAccessToken,
  requestWorkspaceAccessToken,
  hydrateAccessTokenFromSession,
  GoogleCalendarEvent,
} from '@/lib/workspace';

// Intervalle de synchro automatique avec Google Calendar (5 min)
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { TEAM_MEMBERS } from '@/data/teamMembers';

import { TRANSFERRED_CALENDAR_EVENTS } from '@/data/csvDataLoader';

interface EventItem {
  id: string;
  title: string;
  date: string;
  time: string;
  // Ticket #29/#30/#36 : heure et date de fin, pour une durée réelle
  // (au lieu d'1h fixe) et les événements sur plusieurs journées.
  endDate: string;
  endTime: string;
  allDay?: boolean;
  description?: string;
  // Emails séparés par virgule/espace — tel que saisis, transmis tels quels
  // à Google Calendar.
  attendees?: string;
  // Disponibilité (ticket #35/#42/#44) : true = Occupé (bloque le créneau,
  // transparency "opaque" côté Google), false = Disponible ("transparent").
  busy?: boolean;
  location: string;
  clientName: string;
  type: 'Rendez-vous Banque' | 'Visite Immobilière' | 'Signature Notaire' | 'Réunion Agence' | 'Tâche' | 'Réservation Caméra';
  isCameraReservation?: boolean;
  cameraReservationId?: string;
  cameraCreatedByUserId?: string;
  meetLink?: string;
  isGoogleEvent?: boolean;
  googleEventId?: string;
}

const MAPPED_TRANSFERRED_EVENTS: EventItem[] = TRANSFERRED_CALENDAR_EVENTS.map((ev) => {
  const dt = new Date(ev.startAt);
  const dateStr = format(dt, 'yyyy-MM-dd');
  const timeStr = format(dt, 'HH:mm');
  
  let mappedType: EventItem['type'] = 'Rendez-vous Banque';
  if (ev.type === 'task') {
    mappedType = 'Tâche';
  } else if (ev.title.toLowerCase().includes('visite')) {
    mappedType = 'Visite Immobilière';
  } else if (ev.title.toLowerCase().includes('signature') || ev.description.toLowerCase().includes('compromis')) {
    mappedType = 'Signature Notaire';
  } else if (ev.title.toLowerCase().includes('réunion') || ev.title.toLowerCase().includes('visio') || ev.title.toLowerCase().includes('équipe')) {
    mappedType = 'Réunion Agence';
  } else {
    mappedType = 'Rendez-vous Banque';
  }

  const fullTitle = ev.description ? `${ev.title} - ${ev.description}` : ev.title;
  const endDt = new Date(dt.getTime() + 60 * 60 * 1000);

  return {
    id: ev.id,
    title: fullTitle,
    date: dateStr,
    time: timeStr,
    endDate: format(endDt, 'yyyy-MM-dd'),
    endTime: format(endDt, 'HH:mm'),
    busy: true,
    location: ev.location || 'Agence / In Situ',
    clientName: 'Client Transféré',
    type: mappedType,
  };
});

const INITIAL_EVENTS: EventItem[] = MAPPED_TRANSFERRED_EVENTS;

type ViewMode = 'month' | 'week' | 'day' | 'list';

interface AgendaViewProps {
  // Compteur incrémenté par le « + » de la barre du bas (téléphone) : ouvre
  // la fenêtre de création d'événement. Un compteur et non un booléen, et on
  // mémorise la dernière valeur traitée — sinon revenir sur l'Agenda
  // rouvrirait la fenêtre tout seul, comme c'était arrivé sur la messagerie.
  createSignal?: number;
}

export const AgendaView: React.FC<AgendaViewProps> = ({ createSignal }) => {
  // L'agenda n'avait aucune adaptation mobile : vue Semaine par défaut (sept
  // colonnes sur un téléphone), hauteur figée à 90 % de l'écran, et un en-tête
  // de trois lignes avant le premier rendez-vous. Voir plus bas.
  const isMobile = useIsMobile();
  const dernierCreateSignal = useRef(createSignal ?? 0);
  const { currentUser, userProfile, activeAgency } = useAuth();

  // Réservations caméra : visibles uniquement sur les agendas Immosphera et
  // Novavisio, une fois validées par un admin caméra ; seuls Sylvain et
  // Mélanie Grazia peuvent les modifier/supprimer.
  const CAMERA_ADMIN_UIDS = [
    '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29', // Sylvain Grazia
    '15bcec53-de3e-40b8-8b7e-bb6874836f29', // Mélanie Grazia
  ];
  const CAMERA_VISIBLE_AGENCY_IDS = [
    '0cd9362c-316e-4b57-af0b-b6cea092961b', // Novavisio
    '15157da9-71ea-4760-ae1c-3bc99d9caa20', // Immosphera
  ];
  const isCameraAgendaAdmin = !!currentUser && CAMERA_ADMIN_UIDS.includes(currentUser.uid);
  const [events, setEvents] = useState<EventItem[]>(INITIAL_EVENTS);
  const [currentDate, setCurrentDate] = useState(new Date());
  // Sur téléphone, la vue Semaine est illisible (sept colonnes d'heures sur
  // 390 px). On ouvre sur la Liste, calquée sur l'agenda d'iOS. Lu une seule
  // fois, à la construction : pas de bascule sous les yeux de l'utilisateur,
  // et son choix suivant n'est jamais écrasé.
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'list' : 'week')
  );
  
  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [selectedDateForModal, setSelectedDateForModal] = useState<Date>(new Date());
  const [selectedTimeForModal, setSelectedTimeForModal] = useState<string>('09:00');
  
  // Form State
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [clientName, setClientName] = useState('');
  const [type, setType] = useState<EventItem['type']>('Rendez-vous Banque');
  const [addMeetLink, setAddMeetLink] = useState(true);
  // Ticket #29-#36 : champs alignés sur Google Calendar (date/heure de fin,
  // toute la journée, description, participants, disponibilité).
  const [endDateForModal, setEndDateForModal] = useState<Date>(new Date());
  const [endTimeForModal, setEndTimeForModal] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [description, setDescription] = useState('');
  const [attendeesInput, setAttendeesInput] = useState('');
  const [busy, setBusy] = useState(true);

  // Google Workspace Integration State
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Deletion confirmation modal
  const [eventToDelete, setEventToDelete] = useState<EventItem | null>(null);
  const [editingCameraTime, setEditingCameraTime] = useState<{ date: string; startTime: string; endTime: string } | null>(null);
  const [savingCameraTime, setSavingCameraTime] = useState(false);

  // Édition d'un événement existant (synchro bidirectionnelle : la modif est
  // poussée vers Google Calendar si l'événement y est lié)
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);

  useEffect(() => {
    // Ticket #23 (nouvelle base) : au premier chargement, le jeton en
    // mémoire est toujours vide (reset à chaque reload) — on essaie donc de
    // le retrouver depuis la session Supabase déjà persistée avant de
    // conclure qu'il faut se reconnecter à Google.
    (async () => {
      const token = getCachedAccessToken() || (await hydrateAccessTokenFromSession());
      if (token) {
        setIsGoogleConnected(true);
        loadGoogleEvents(token);
      }
    })();
  }, []);

  /*
   * Synchro bidirectionnelle automatique : tant que la connexion Google est
   * active, on retire régulièrement les changements faits côté Google
   * Calendar (ajout/modif/suppression depuis Gmail, mobile, etc.), sans
   * attendre que l'utilisateur clique sur "Sync". On resynchronise aussi
   * quand l'onglet redevient visible/actif.
   */
  useEffect(() => {
    if (!isGoogleConnected) return;

    const syncFromGoogle = () => {
      const token = getCachedAccessToken();
      if (token) loadGoogleEvents(token);
    };

    const interval = setInterval(syncFromGoogle, AUTO_SYNC_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncFromGoogle();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', syncFromGoogle);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', syncFromGoogle);
    };
  }, [isGoogleConnected]);

  /*
   * Réservations caméra (table Supabase `camera_reservations`, réelle et
   * synchronisée avec Google Calendar par un autre système) en temps réel.
   * Toute nouvelle réservation validée apparaît automatiquement dans l'agenda.
   */
  useEffect(() => {
    if (!currentUser) return;

    // Visible uniquement sur les agendas Immosphera / Novavisio (ou "Toutes
    // les agences"), et seulement une fois la réservation validée par un
    // admin caméra — les demandes en attente/refusées ne polluent pas le
    // calendrier.
    const agendaShowsCameraEvents =
      activeAgency.id === 'all' || CAMERA_VISIBLE_AGENCY_IDS.includes(activeAgency.id);

    const loadCameraEvents = async () => {
      if (!agendaShowsCameraEvents) {
        setEvents((previous) => previous.filter((event) => !event.isCameraReservation));
        return;
      }

      const { data, error } = await supabase
        .from('camera_reservations' as any)
        .select('*')
        .eq('status', 'accepted');

      if (error) {
        console.error('Erreur synchronisation réservations caméra :', error);
        setStatusMessage("Impossible de synchroniser les réservations caméra.");
        return;
      }

      const cameraEvents: EventItem[] = ((data ?? []) as any[]).map((row) => {
        let desc: Record<string, unknown> = {};
        try {
          desc = row.description ? JSON.parse(row.description) : {};
        } catch { /* ignore */ }

        const equipmentKeyToLabel: Record<string, string> = {
          giraffe: 'Caméra Giraffe',
          dji: 'Caméra DJI',
          x4: 'Caméra X4',
          cm: 'Community Manager',
        };
        const equipmentEntries = Object.entries((desc.equipment as Record<string, boolean>) || {});
        const equipmentName = equipmentEntries.filter(([, v]) => !!v).map(([k]) => equipmentKeyToLabel[k] || k).join(', ') || 'Matériel / Caméra';

        const startDate = new Date(row.start_at as string);
        const date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
        const time = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;

        // Fin de la réservation : elle n'était pas reprise du tout, si bien
        // que ces événements retombaient sur la durée par défaut au lieu du
        // créneau réellement réservé.
        const endDateObj = row.end_at ? new Date(row.end_at as string) : startDate;
        const endDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;
        const endTime = `${String(endDateObj.getHours()).padStart(2, '0')}:${String(endDateObj.getMinutes()).padStart(2, '0')}`;

        const member = TEAM_MEMBERS.find((m) => m.id === row.user_id);
        const projectName = (desc.projet as string) || '';

        return {
          id: `camera-${row.id}`,
          title: projectName ? `Caméra • ${projectName}` : `Réservation • ${equipmentName}`,
          date,
          time,
          endDate,
          endTime,
          location: (desc.lieu as string) || '',
          clientName: member?.name || '',
          type: 'Réservation Caméra' as const,
          isCameraReservation: true,
          cameraReservationId: row.id,
          cameraCreatedByUserId: row.user_id,
        };
      });

      setEvents((previous) => {
        const withoutCamera = previous.filter((event) => !event.isCameraReservation);
        return [...withoutCamera, ...cameraEvents];
      });
    };

    void loadCameraEvents();

    const channel = supabase
      .channel('camera_reservations_agenda')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'camera_reservations' }, () => loadCameraEvents())
      .subscribe();

    const unsubscribe = () => { supabase.removeChannel(channel); };
    return () => unsubscribe();
  }, [currentUser?.uid, activeAgency.id]);

  const handleConnectGoogle = async () => {
    setSyncing(true);
    setStatusMessage(null);
    try {
      const token = await requestWorkspaceAccessToken();
      setIsGoogleConnected(true);
      await loadGoogleEvents(token);
      setStatusMessage('Connecté à Google Calendar avec succès !');
    } catch (err: unknown) {
      setStatusMessage((err as Error).message || 'Échec de la connexion Google Workspace');
    } finally {
      setSyncing(false);
    }
  };

  const loadGoogleEvents = async (token: string) => {
    setSyncing(true);
    try {
      const gItems = await fetchGoogleCalendarEvents(token);
      
      const mapped: EventItem[] = gItems.map((g) => {
        let dateStr = '2026-08-05';
        let timeStr = '12:00';
        let endDateStr = dateStr;
        let endTimeStr = '13:00';
        const allDay = !g.start.dateTime && !!g.start.date;

        if (g.start.dateTime) {
          const d = new Date(g.start.dateTime);
          dateStr = format(d, 'yyyy-MM-dd');
          timeStr = format(d, 'HH:mm');
        } else if (g.start.date) {
          dateStr = g.start.date;
          timeStr = '00:00';
        }

        if (g.end.dateTime) {
          const d = new Date(g.end.dateTime);
          endDateStr = format(d, 'yyyy-MM-dd');
          endTimeStr = format(d, 'HH:mm');
        } else if (g.end.date) {
          // Google renseigne une borne de fin EXCLUSIVE pour les événements
          // "Toute la journée" (le lendemain du dernier jour réel) — on
          // retranche un jour pour retrouver la date affichée à l'utilisateur.
          const d = new Date(g.end.date);
          d.setDate(d.getDate() - 1);
          endDateStr = format(d, 'yyyy-MM-dd');
          endTimeStr = '23:59';
        } else {
          endDateStr = dateStr;
          endTimeStr = timeStr;
        }

        return {
          id: 'g-' + g.id,
          title: g.summary || 'Événement Google',
          date: dateStr,
          time: timeStr,
          endDate: endDateStr,
          endTime: endTimeStr,
          allDay,
          description: g.description || '',
          attendees: (g.attendees || []).map((a) => a.email).join(', '),
          busy: g.transparency !== 'transparent',
          location: g.location || '',
          clientName: g.description?.slice(0, 30) || '',
          type: g.hangoutLink ? 'Rendez-vous Banque' : 'Réunion Agence',
          meetLink: g.hangoutLink || (g as any).conferenceData?.entryPoints?.[0]?.uri,
          isGoogleEvent: true,
          googleEventId: g.id,
        };
      });

      setEvents((prev) => {
        const local = prev.filter((e) => !e.isGoogleEvent);
        return [...mapped, ...local];
      });
    } catch (err: unknown) {
      console.error(err);
      setStatusMessage('Impossible de charger les événements depuis Google Calendar');
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenModal = (date: Date, time: string = '09:00') => {
    setEditingEvent(null);
    setSelectedDateForModal(date);
    setSelectedTimeForModal(time);
    setTitle('');
    setLocation('');
    setClientName('');
    setType('Rendez-vous Banque');
    // Fin par défaut : même jour, +1h.
    const [h, m] = time.split(':').map(Number);
    const defaultEnd = new Date(date);
    defaultEnd.setHours(h, m + 60, 0, 0);
    setEndDateForModal(defaultEnd);
    setEndTimeForModal(format(defaultEnd, 'HH:mm'));
    setAllDay(false);
    setDescription('');
    setAttendeesInput('');
    setBusy(true);
    setShowModal(true);
  };

  useEffect(() => {
    const signal = createSignal ?? 0;
    if (signal === dernierCreateSignal.current) return;
    dernierCreateSignal.current = signal;
    if (!signal) return;
    handleOpenModal(currentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSignal]);

  // Ouvre le modal en mode édition, pré-rempli avec l'événement existant.
  // Toute modification enregistrée sera poussée vers Google Calendar si
  // l'événement y est lié (synchro bidirectionnelle CRM ↔ Google).
  const handleOpenEditModal = (ev: EventItem) => {
    if (ev.isCameraReservation) return; // géré séparément via camera_reservations
    setEditingEvent(ev);
    setSelectedDateForModal(parseISO(ev.date));
    setSelectedTimeForModal(ev.time);
    setTitle(ev.title);
    setLocation(ev.location || '');
    setClientName(ev.clientName || '');
    setType(ev.type);
    setAddMeetLink(!!ev.meetLink);
    setEndDateForModal(ev.endDate ? parseISO(ev.endDate) : parseISO(ev.date));
    setEndTimeForModal(ev.endTime || ev.time);
    setAllDay(!!ev.allDay);
    setDescription(ev.description || '');
    setAttendeesInput(ev.attendees || '');
    setBusy(ev.busy !== false);
    setEventToDelete(null);
    setShowModal(true);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const token = getCachedAccessToken();

    // Create Start and End Dates based on selectedDate/time et la fin
    // choisie (ticket #29 : heure de fin réelle, #30 : jours différents).
    const [hours, minutes] = selectedTimeForModal.split(':').map(Number);
    const startDate = new Date(selectedDateForModal);
    startDate.setHours(hours, minutes, 0, 0);

    const [endHours, endMinutes] = endTimeForModal.split(':').map(Number);
    const endDate = new Date(endDateForModal);
    endDate.setHours(endHours, endMinutes, 0, 0);

    // Garde-fou : une fin avant le début n'a pas de sens, on la ramène à
    // +30 min du début plutôt que de créer un événement à durée négative.
    const safeEndDate = endDate.getTime() > startDate.getTime() ? endDate : new Date(startDate.getTime() + 30 * 60 * 1000);

    const descriptionWithClient = description.trim()
      ? `${description.trim()}\n\nClient: ${clientName || 'Prospect'}`
      : `Client: ${clientName || 'Prospect'}`;

    if (editingEvent) {
      // --- Mode édition : mise à jour, poussée vers Google si lié ---
      let updatedMeetLink = editingEvent.meetLink;

      if (token && editingEvent.googleEventId) {
        setSyncing(true);
        try {
          const updated = await updateGoogleCalendarEvent(token, editingEvent.googleEventId, {
            summary: title,
            description: descriptionWithClient,
            location: location || 'Agence',
            startISO: startDate.toISOString(),
            endISO: safeEndDate.toISOString(),
            allDay,
            attendees: attendeesInput,
            busy,
          });
          updatedMeetLink = updated.hangoutLink || (updated as any).conferenceData?.entryPoints?.[0]?.uri || updatedMeetLink;
          setStatusMessage('Rendez-vous mis à jour sur Google Calendar !');
        } catch (err: unknown) {
          console.error('Erreur mise à jour Google Calendar:', err);
          setStatusMessage((err as Error).message || "Impossible de mettre à jour l'événement sur Google Calendar.");
        } finally {
          setSyncing(false);
        }
      }

      const updatedEv: EventItem = {
        ...editingEvent,
        title,
        date: format(startDate, 'yyyy-MM-dd'),
        time: format(startDate, 'HH:mm'),
        endDate: format(safeEndDate, 'yyyy-MM-dd'),
        endTime: format(safeEndDate, 'HH:mm'),
        allDay,
        description: description.trim(),
        attendees: attendeesInput.trim(),
        busy,
        location: location || '',
        clientName: clientName || '',
        type,
        meetLink: updatedMeetLink,
      };

      setEvents((prev) => prev.map((e2) => (e2.id === editingEvent.id ? updatedEv : e2)));
      setEditingEvent(null);
      setShowModal(false);
      return;
    }

    // --- Mode création ---
    let createdMeetLink: string | undefined = undefined;
    let newGoogleId: string | undefined = undefined;

    if (token) {
      setSyncing(true);
      try {
        const created = await createGoogleCalendarEvent(token, {
          summary: title,
          description: descriptionWithClient,
          location: location || 'Agence',
          startISO: startDate.toISOString(),
          endISO: safeEndDate.toISOString(),
          addMeetLink,
          allDay,
          attendees: attendeesInput,
          busy,
        });

        createdMeetLink = created.hangoutLink || (created as any).conferenceData?.entryPoints?.[0]?.uri;
        newGoogleId = created.id;
        setStatusMessage('Rendez-vous synchronisé sur Google Calendar et Meet !');
      } catch (err: unknown) {
        console.error('Erreur création Google Calendar:', err);
      } finally {
        setSyncing(false);
      }
    }

    const newEv: EventItem = {
      id: 'e-' + Date.now(),
      title,
      date: format(startDate, 'yyyy-MM-dd'),
      time: format(startDate, 'HH:mm'),
      endDate: format(safeEndDate, 'yyyy-MM-dd'),
      endTime: format(safeEndDate, 'HH:mm'),
      allDay,
      description: description.trim(),
      attendees: attendeesInput.trim(),
      busy,
      location: location || '',
      clientName: clientName || '',
      type,
      meetLink: createdMeetLink || (addMeetLink ? `https://meet.google.com/meet-${Math.random().toString(36).substring(2, 8)}` : undefined),
      isGoogleEvent: !!newGoogleId,
      googleEventId: newGoogleId,
    };

    setEvents([...events, newEv]);
    setShowModal(false);
  };

  const handleOpenCameraTimeEditor = (ev: EventItem) => {
    if (!ev.cameraReservationId) return;
    setEditingCameraTime({ date: ev.date, startTime: ev.time, endTime: '' });
  };

  const handleSaveCameraTime = async () => {
    if (!eventToDelete?.cameraReservationId || !editingCameraTime) return;
    setSavingCameraTime(true);
    try {
      const { date, startTime, endTime } = editingCameraTime;
      const startAtIso = new Date(`${date}T${startTime}:00`).toISOString();
      const endAtIso = new Date(`${date}T${endTime || startTime}:00`).toISOString();
      const { error } = await supabase
        .from('camera_reservations' as any)
        .update({ start_at: startAtIso, end_at: endAtIso } as any)
        .eq('id', eventToDelete.cameraReservationId);
      if (error) throw error;
      setStatusMessage('Réservation caméra mise à jour.');
      setEditingCameraTime(null);
      setEventToDelete(null);
    } catch (err) {
      console.error('Erreur modification réservation caméra :', err);
      setStatusMessage("Impossible de modifier la réservation caméra.");
    } finally {
      setSavingCameraTime(false);
    }
  };

  const confirmDeleteEvent = async () => {
    if (!eventToDelete) return;

    /*
     * Une réservation caméra doit être supprimée dans Supabase.
     * Le listener temps réel la retirera ensuite automatiquement de l'agenda.
     */
    if (
      eventToDelete.isCameraReservation &&
      eventToDelete.cameraReservationId
    ) {
      if (!isCameraAgendaAdmin) {
        setStatusMessage(
          "Seuls Sylvain et Mélanie Grazia peuvent supprimer une réservation caméra."
        );
        setEventToDelete(null);
        return;
      }

      try {
        const { error } = await supabase
          .from('camera_reservations' as any)
          .delete()
          .eq('id', eventToDelete.cameraReservationId);
        if (error) throw error;

        setStatusMessage(
          'Réservation caméra supprimée du planning.'
        );
      } catch (err: unknown) {
        console.error(
          'Erreur suppression réservation caméra :',
          err
        );

        setStatusMessage(
          "Impossible de supprimer la réservation caméra."
        );
      }

      setEventToDelete(null);
      return;
    }

    const token = getCachedAccessToken();

    if (eventToDelete.googleEventId && token) {
      try {
        await deleteGoogleCalendarEvent(
          token,
          eventToDelete.googleEventId
        );

        setStatusMessage(
          'Événement supprimé de Google Calendar.'
        );
      } catch (err: unknown) {
        console.error(
          'Erreur suppression Google Calendar:',
          err
        );

        setStatusMessage(
          "Impossible de supprimer l'événement Google."
        );
        setEventToDelete(null);
        return;
      }
    }

    setEvents((current) =>
      current.filter(
        (event) => event.id !== eventToDelete.id
      )
    );

    setEventToDelete(null);
  };

  const navigatePrevious = () => {
    if (viewMode === 'month' || viewMode === 'list') setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === 'week') setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const navigateNext = () => {
    if (viewMode === 'month' || viewMode === 'list') setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === 'week') setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const getDayEvents = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return events.filter(e => e.date === dateStr).sort((a, b) => a.time.localeCompare(b.time));
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const dateFormat = "d";
    
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    return (
      <div className="flex flex-col h-full bg-[#0E1A20] rounded-xl border border-white/10 overflow-hidden">
        {/* Days Header */}
        <div className="grid grid-cols-7 border-b border-white/10 bg-white/5 shrink-0">
          {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-gray-400">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar Grid */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-7 auto-rows-fr h-full">
            {days.map((day, i) => {
              const isSameMnth = isSameMonth(day, monthStart);
              const isTdy = isToday(day);
              const dayEvents = getDayEvents(day);
              
              return (
                <div 
                  key={day.toISOString()} 
                  onClick={() => handleOpenModal(day)}
                  className={`min-h-[100px] border-b border-r border-white/10 p-1 transition-colors cursor-pointer hover:bg-white/5 ${
                    !isSameMnth ? 'bg-black/20 text-gray-600' : 'text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between px-1">
                    <span
                      className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                        isTdy ? 'bg-[#FF3B30] text-white' : ''
                      }`}
                    >
                      {format(day, dateFormat)}
                    </span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map(ev => (
                      <div
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); setEditingCameraTime(null); setEventToDelete(ev); }}
                        // Signalé : "la couleur de l'apparence agenda n'est pas
                        // prise en compte" — chaque type de rdv avait sa
                        // couleur codée en dur, indépendante du réglage
                        // Paramètres > Apparence. Une seule couleur
                        // personnalisable pour tout le calendrier désormais
                        // (variables déjà posées par ce réglage, jamais lues
                        // ici jusqu'à présent).
                        //
                        // Opacité portée de 0,2 à 0,7 le 31/08/2026, demande
                        // explicite : "les couleurs de l'agenda sont fades, le
                        // jaune ne ressort pas". Bug nº 5 (1er septembre) :
                        // encore trop transparentes — la couleur est désormais
                        // posée pleine. C'est aussi la bonne teinte de fond :
                        // --calendar-accent-text-color (#061719) est calculée
                        // pour se lire SUR la couleur d'accent, pas sur un fond
                        // délavé.
                        className={`text-[9px] px-1.5 py-0.5 rounded truncate border ${ev.busy === false ? 'opacity-60 border-dashed' : ''}`}
                        style={{
                          backgroundColor: 'rgb(var(--calendar-accent-color-rgb))',
                          color: 'var(--calendar-accent-text-color)',
                          borderColor: 'rgb(var(--calendar-accent-color-rgb))',
                        }}
                        title={ev.busy === false ? 'Disponible' : 'Occupé'}
                      >
                        {ev.time} {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[9px] text-gray-500 px-1">+{dayEvents.length - 3} autres</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
    const endDate = endOfWeek(currentDate, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7:00 to 20:00

    return (
      // Sept colonnes d'heures sur 390 px sont illisibles : sur téléphone, la
      // grille garde une largeur minimale et défile horizontalement, plutôt
      // que d'écraser chaque jour sur 50 px.
      <div className={`flex flex-col h-full bg-[#0E1A20] rounded-xl border border-white/10 relative ${isMobile ? 'overflow-x-auto' : 'overflow-hidden'}`}>
        <div className={isMobile ? 'min-w-[680px] flex flex-col h-full' : 'contents'}>
        <div className="flex shrink-0">
          {/* Time column header */}
          <div className="w-16 border-r border-b border-white/10 bg-white/5 shrink-0"></div>
          {/* Days headers */}
          <div className="flex-1 grid grid-cols-7 border-b border-white/10 bg-white/5">
            {days.map((day) => (
              <div key={day.toISOString()} className="py-2 text-center border-l border-white/10 first:border-l-0">
                <div className="text-xs font-semibold text-gray-400 capitalize">{format(day, 'EEE', { locale: fr })}</div>
                <div
                  className={`mx-auto w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold ${
                    isToday(day) ? 'border-2 border-[#0EA5A5] text-[#0EA5A5]' : 'text-gray-200'
                  }`}
                >
                  {format(day, 'd')}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar flex">
          {/* Times column */}
          <div className="w-16 border-r border-white/10 shrink-0 bg-black/20">
            {hours.map(hour => (
              <div key={hour} className="h-16 border-b border-white/5 flex items-start justify-center text-xs text-gray-500 py-1 font-medium">
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>
          
          {/* Grid */}
          <div className="flex-1 grid grid-cols-7">
            {days.map(day => (
              <div key={day.toISOString()} className="border-l border-white/10 first:border-l-0 relative">
                {hours.map(hour => {
                  const hourStr = `${hour.toString().padStart(2, '0')}:00`;
                  return (
                    <div 
                      key={hour} 
                      onClick={() => handleOpenModal(day, hourStr)}
                      className="h-16 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                    ></div>
                  );
                })}
                
                {/* Events for this day */}
                {getDayEvents(day).map(ev => {
                  const [hourStr, minStr] = ev.time.split(':');
                  const evHour = parseInt(hourStr, 10);
                  const evMin = parseInt(minStr, 10);

                  // Only show if between 7 and 20
                  if (evHour < 7 || evHour > 20) return null;

                  const top = ((evHour - 7) * 64) + (evMin / 60 * 64);

                  // Ticket #36 : hauteur du bloc proportionnelle à la durée
                  // réelle (heure de fin - heure de début), au lieu d'une
                  // hauteur fixe de 60px identique pour tous les événements.
                  const PIXELS_PER_HOUR = 64;
                  let heightPx = 60;
                  if (ev.endTime && !ev.allDay) {
                    const [endHourStr, endMinStr] = ev.endTime.split(':');
                    const endHour = parseInt(endHourStr, 10);
                    const endMin = parseInt(endMinStr, 10);
                    const durationMinutes = (endHour * 60 + endMin) - (evHour * 60 + evMin);
                    if (durationMinutes > 0) {
                      heightPx = Math.max(20, (durationMinutes / 60) * PIXELS_PER_HOUR);
                    }
                  }

                  return (
                    <div
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); setEditingCameraTime(null); setEventToDelete(ev); }}
                      style={{
                        top: `${top}px`,
                        height: `${heightPx}px`,
                        backgroundColor: 'rgb(var(--calendar-accent-color-rgb))',
                        color: 'var(--calendar-accent-text-color)',
                        borderColor: 'rgb(var(--calendar-accent-color-rgb))',
                      }}
                      className={`absolute left-1 right-1 rounded p-1.5 overflow-hidden shadow-md cursor-pointer z-10 border ${ev.busy === false ? 'opacity-60 border-dashed' : ''}`}
                      title={ev.busy === false ? 'Disponible' : 'Occupé'}
                    >
                      <div className="text-[10px] font-bold leading-tight line-clamp-1">{ev.title}</div>
                      <div className="text-[9px] opacity-80 mt-0.5">{ev.allDay ? 'Toute la journée' : `${ev.time}${ev.endTime ? ` - ${ev.endTime}` : ''}`}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7:00 to 22:00
    const dayEvents = getDayEvents(currentDate);

    return (
      <div className="flex flex-col h-full bg-[#0E1A20] rounded-xl border border-white/10 overflow-hidden relative">
        <div className="p-3 border-b border-white/10 bg-white/5 flex items-center justify-center shrink-0">
           <div className="text-center">
              <div className="text-sm font-semibold text-gray-400 capitalize">{format(currentDate, 'EEEE', { locale: fr })}</div>
              <div className={`text-xl font-bold ${isToday(currentDate) ? 'text-[#0EA5A5]' : 'text-gray-200'}`}>
                {format(currentDate, 'd MMMM yyyy', { locale: fr })}
              </div>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar flex">
          {/* Times column */}
          <div className="w-20 border-r border-white/10 shrink-0 bg-black/20">
            {hours.map(hour => (
              <div key={hour} className="h-20 border-b border-white/5 flex items-start justify-center text-sm text-gray-500 py-2 font-medium">
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>
          
          {/* Grid */}
          <div className="flex-1 relative">
            {hours.map(hour => {
              const hourStr = `${hour.toString().padStart(2, '0')}:00`;
              return (
                <div 
                  key={hour} 
                  onClick={() => handleOpenModal(currentDate, hourStr)}
                  className="h-20 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                ></div>
              );
            })}
            
            {/* Events for this day */}
            {dayEvents.map(ev => {
              const [hourStr, minStr] = ev.time.split(':');
              const evHour = parseInt(hourStr, 10);
              const evMin = parseInt(minStr, 10);
              
              if (evHour < 7 || evHour > 22) return null;
              
              const top = ((evHour - 7) * 80) + (evMin / 60 * 80);
              
              return (
                <div 
                  key={ev.id}
                  onClick={(e) => { e.stopPropagation(); setEditingCameraTime(null); setEventToDelete(ev); }}
                  style={{
                    top: `${top}px`,
                    height: '76px',
                    backgroundColor: 'rgb(var(--calendar-accent-color-rgb))',
                    color: 'var(--calendar-accent-text-color)',
                    borderColor: 'rgb(var(--calendar-accent-color-rgb))',
                  }}
                  className="absolute left-2 right-4 rounded-lg p-3 overflow-hidden shadow-lg cursor-pointer z-10 border"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-bold flex items-center gap-1.5">
                        {ev.isCameraReservation && <Camera className="w-3.5 h-3.5" />}
                        {ev.title}
                      </div>
                      <div className="text-xs opacity-80 mt-1 flex items-center gap-2">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {ev.allDay ? 'Toute la journée' : `${ev.time}${ev.endTime ? ` - ${ev.endTime}` : ''}`}</span>
                        {ev.busy === false && <span className="text-emerald-400 font-semibold">Disponible</span>}
                        {ev.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3"/> {ev.location}</span>}
                        {ev.clientName && <span className="flex items-center gap-1"><User className="w-3 h-3"/> {ev.clientName}</span>}
                      </div>
                    </div>
                    {ev.meetLink && (
                      <a href={ev.meetLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1">
                        <Video className="w-3 h-3" /> Meet
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };


  // Vue « Liste » — reprise de l'agenda d'iOS : un défilement continu, un
  // en-tête par jour (y compris les jours vides, comme chez Apple), la date
  // du jour en rouge, un liseré de couleur à gauche de chaque événement et
  // les heures alignées à droite (début en clair, fin en gris).
  const listDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(addMonths(currentDate, 2)) }),
    [currentDate]
  );
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const listTodayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (viewMode !== 'list') return;
    // Se caler sur aujourd'hui à l'ouverture, plutôt que sur le 1er du mois.
    const t = window.setTimeout(() => {
      listTodayRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }, 0);
    return () => window.clearTimeout(t);
  }, [viewMode, currentDate]);

  const renderListView = () => (
    <div className="flex flex-col h-full bg-[#0E1A20] rounded-xl border border-white/10 overflow-hidden">
      <div ref={listScrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-6 py-3">
        {listDays.map((day) => {
          const dayEvents = getDayEvents(day);
          const isTdy = isToday(day);
          return (
            <div key={day.toISOString()} ref={isTdy ? listTodayRef : undefined} className="scroll-mt-3">
              <div
                onClick={() => handleOpenModal(day)}
                className={`pt-5 pb-2 text-[15px] font-bold capitalize cursor-pointer ${
                  isTdy ? 'text-[#FF3B30]' : 'text-white'
                }`}
              >
                {format(day, 'EEEE - d MMM', { locale: fr })}
              </div>
              {dayEvents.length === 0 ? (
                <div className="border-b border-white/5" />
              ) : (
                dayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    onClick={() => handleOpenEditModal(ev)}
                    className="flex items-start gap-3 py-2.5 border-b border-white/5 cursor-pointer hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <span
                      className={`w-1 self-stretch rounded-full shrink-0 ${ev.busy === false ? 'opacity-50' : ''}`}
                      style={{ backgroundColor: 'rgb(var(--calendar-accent-color-rgb))' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-white truncate">{ev.title}</div>
                      {ev.location && (
                        <div className="flex items-center gap-1 text-xs text-gray-400 truncate">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {ev.location}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0 leading-tight">
                      {ev.allDay ? (
                        <div className="text-sm text-gray-400">jour entier</div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold text-white tabular-nums">{ev.time}</div>
                          <div className="text-sm text-gray-500 tabular-nums">{ev.endTime}</div>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Libellé de la période affichée, commun à l'en-tête d'ordinateur et à
  // celui du téléphone.
  const titrePeriode = viewMode === 'month' || viewMode === 'list'
    ? format(currentDate, 'MMMM yyyy', { locale: fr })
    : viewMode === 'week'
      ? `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'd MMM', { locale: fr })} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: fr })}`
      : format(currentDate, 'd MMMM yyyy', { locale: fr });

  return (
    // `h-[90vh]` dépassait la zone utile : la coquille réserve déjà de la place
    // pour la barre de navigation, le bas de l'agenda passait donc dessous.
    <div className={`${isMobile ? 'h-full px-2 pt-2' : 'p-4 sm:p-6 h-[90vh]'} max-w-7xl mx-auto flex flex-col text-white`}>
      {/* EN-TÊTE TÉLÉPHONE — une ligne pour naviguer, une ligne d'onglets.
          L'ancien bloc (titre « Mon Agenda », sous-titre, quatre onglets, Sync
          et Ajouter) occupait trois lignes avant le premier rendez-vous, et
          les onglets débordaient. Ici, tout tient en deux lignes ; « Ajouter »
          rejoint le « + » de la barre du bas, comme sur la messagerie. */}
      {isMobile && (
        <div className="shrink-0 flex flex-col gap-2 mb-2">
          <div className="flex items-center gap-1">
            <button
              onClick={navigatePrevious}
              aria-label="Période précédente"
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-300 active:bg-white/10"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="flex-1 min-w-0 text-center text-base font-bold text-white capitalize truncate">
              {titrePeriode}
            </span>
            <button
              onClick={navigateNext}
              aria-label="Période suivante"
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-300 active:bg-white/10"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 h-9 shrink-0 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-slate-200 active:bg-white/10"
            >
              Auj.
            </button>
            <button
              onClick={handleConnectGoogle}
              disabled={syncing}
              aria-label={isGoogleConnected ? 'Synchroniser' : 'Connecter Google'}
              className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center border ${
                isGoogleConnected
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-white/10 border-white/20 text-white'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Sélecteur de vue, à la manière d'iOS : quatre segments de largeur
              égale, toujours entièrement visibles. */}
          <div className="flex p-1 bg-white/5 border border-white/10 rounded-2xl">
            {([['list', 'Liste'], ['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']] as const).map(([mode, libelle]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex-1 py-2 text-[13px] font-bold rounded-xl transition-colors ${
                  viewMode === mode ? 'bg-white/15 text-white' : 'text-gray-400'
                }`}
              >
                {libelle}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isMobile && (<>
      {/* Signalé (30/08/2026, capture à l'appui) : "on ne peut pas voir le
          haut, mets un fond comme les autres panneaux" — aucun fond du
          tout ici, la photo de fond de page passait entièrement à travers
          (même correctif que Notes/Documents/Caméra/Support). */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 shrink-0 bg-[#0a1e20]/95 border border-white/10 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Mon Agenda</h1>
            <p className="text-xs text-gray-400">Connecté avec Google Workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Toggles */}
          <div className="flex p-1 bg-white/5 border border-white/10 rounded-xl mr-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Liste
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${viewMode === 'day' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Jour
            </button>
            <button 
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${viewMode === 'week' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Semaine
            </button>
            <button 
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${viewMode === 'month' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Mois
            </button>
          </div>

          <button
            onClick={handleConnectGoogle}
            disabled={syncing}
            className={`text-xs px-3 py-2 rounded-xl border flex items-center gap-2 font-semibold transition-all ${
              isGoogleConnected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isGoogleConnected ? 'Sync' : 'Connecter Google'}</span>
          </button>

          <button
            onClick={() => handleOpenModal(currentDate)}
            className="bg-[#0EA5A5] hover:bg-[#d9ab38] text-black font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Ajouter</span>
          </button>
        </div>
      </div>

      </>)}

      {statusMessage && (
        <div className="p-3 mb-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs flex items-center justify-between shrink-0">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-blue-400 hover:text-white font-bold text-xs">✕</button>
        </div>
      )}

      {/* Date Header / Navigation — remplacée sur téléphone par l'en-tête
          compact ci-dessus, qui porte déjà les flèches et « Aujourd'hui ». */}
      {!isMobile && (<>
      {/* Signalé (mode jour) : "le texte en haut n'est pas lisible". Cette
          barre était en `bg-white/5`, un voile translucide sans fond réel :
          posée entre deux cartes blanches, elle laissait voir la photo de
          fond derrière ses libellés. `.nv-panel` lui donne la même surface
          que le reste des cartes (voir index.css). */}
      <div className="p-3 nv-panel border border-white/10 rounded-t-2xl flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300">
            Aujourd'hui
          </button>
          <div className="flex items-center gap-1">
            <button onClick={navigatePrevious} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-bold text-white text-sm min-w-[140px] text-center capitalize">
              {viewMode === 'month' || viewMode === 'list'
                ? format(currentDate, 'MMMM yyyy', { locale: fr })
                : viewMode === 'week'
                  ? `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'd MMM', { locale: fr })} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: fr })}`
                  : format(currentDate, 'd MMMM yyyy', { locale: fr })
              }
            </span>
            <button onClick={navigateNext} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      </>)}

      {/* Calendar Area */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'month' && renderMonthView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'day' && renderDayView()}
        {viewMode === 'list' && renderListView()}
      </div>

      {/* Delete Confirmation Modal */}
      {eventToDelete && (
        <Superposition><div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-sm w-full p-6 text-white space-y-4">
            <h3 className="text-base font-bold text-rose-400">Gérer l'événement</h3>
            <p className="text-sm font-semibold">{eventToDelete.title}</p>
            <p className="text-xs text-gray-300">
              {eventToDelete.date} à {eventToDelete.time}
            </p>
            {eventToDelete.meetLink && (
              <a href={eventToDelete.meetLink} target="_blank" rel="noreferrer" className="inline-flex px-3 py-2 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 font-semibold text-xs items-center gap-2">
                <Video className="w-4 h-4" /> Rejoindre la visio Meet
              </a>
            )}
            <hr className="border-white/10" />

            {eventToDelete.isCameraReservation && editingCameraTime ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-[11px] text-gray-400">Date</label>
                  <input
                    type="date"
                    value={editingCameraTime.date}
                    onChange={(e) => setEditingCameraTime((prev) => prev && { ...prev, date: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">Début</label>
                      <input
                        type="time"
                        value={editingCameraTime.startTime}
                        onChange={(e) => setEditingCameraTime((prev) => prev && { ...prev, startTime: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">Fin</label>
                      <input
                        type="time"
                        value={editingCameraTime.endTime}
                        onChange={(e) => setEditingCameraTime((prev) => prev && { ...prev, endTime: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-1">
                  <button onClick={() => setEditingCameraTime(null)} className="px-4 py-2 text-xs text-gray-400 hover:text-white font-medium bg-white/5 rounded-xl">
                    Annuler
                  </button>
                  <button
                    onClick={() => void handleSaveCameraTime()}
                    disabled={savingCameraTime}
                    className="px-4 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-xl"
                  >
                    {savingCameraTime ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400">
                  {eventToDelete.isCameraReservation
                    ? 'Voulez-vous modifier ou supprimer cette réservation caméra ?'
                    : 'Voulez-vous supprimer ce rendez-vous ?'}
                </p>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setEventToDelete(null)} className="px-4 py-2 text-xs text-gray-400 hover:text-white font-medium bg-white/5 rounded-xl">
                    Fermer
                  </button>
                  {!eventToDelete.isCameraReservation && (
                    <button
                      onClick={() => handleOpenEditModal(eventToDelete)}
                      className="px-4 py-2 text-xs font-bold text-black bg-[#0EA5A5] hover:bg-[#d9ab38] rounded-xl"
                    >
                      Modifier
                    </button>
                  )}
                  {eventToDelete.isCameraReservation && isCameraAgendaAdmin && (
                    <button
                      onClick={() => handleOpenCameraTimeEditor(eventToDelete)}
                      className="px-4 py-2 text-xs font-bold text-black bg-violet-400 hover:bg-violet-300 rounded-xl"
                    >
                      Modifier date/heure
                    </button>
                  )}
                  {(!eventToDelete.isCameraReservation || isCameraAgendaAdmin) && (
                    <button onClick={confirmDeleteEvent} className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl">
                      Supprimer
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div></Superposition>
      )}

      {/* Create Event Modal */}
      {showModal && (
        <Superposition><div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md sm:max-w-2xl w-full max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[88vh] overflow-y-auto overscroll-contain p-5 sm:p-6 text-white custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
            <h3 className="text-lg font-bold mb-4 text-[#0EA5A5]">
              {editingEvent ? 'Modifier le' : 'Planifier le'} {format(selectedDateForModal, 'd MMM', { locale: fr })} à {selectedTimeForModal}
            </h3>
            {/* Disposition en 2 colonnes à partir de sm : le formulaire s'est
                beaucoup étoffé (heure de fin, description, participants...),
                l'étaler en largeur sur desktop évite un long défilement
                vertical inutile quand la place horizontale ne manque pas. */}
            <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-gray-300">Titre de la réunion / visite</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Rendez-vous montage prêt - M. Martin"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                />
              </div>

              {/* Toute la journée — bascule les champs horaires vers de
                  simples sélecteurs de date (ticket #31). */}
              <div className="sm:col-span-2 flex items-center justify-between p-2.5 bg-white/5 border border-white/10 rounded-xl">
                <span className="text-xs font-semibold text-gray-200">Toute la journée</span>
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="w-4 h-4 accent-[#F7BC5F]"
                />
              </div>

              {/* Début / Fin — ticket #29/#30 : date+heure de fin réelle,
                  jour de fin distinct pour les événements multi-jours. */}
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Début</label>
                <div className="flex gap-1.5">
                  <input
                    type="date"
                    required
                    value={format(selectedDateForModal, 'yyyy-MM-dd')}
                    onChange={(e) => setSelectedDateForModal(parseISO(e.target.value))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                  />
                  {!allDay && (
                    <input
                      type="time"
                      required
                      value={selectedTimeForModal}
                      onChange={(e) => setSelectedTimeForModal(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Fin</label>
                <div className="flex gap-1.5">
                  <input
                    type="date"
                    required
                    value={format(endDateForModal, 'yyyy-MM-dd')}
                    onChange={(e) => setEndDateForModal(parseISO(e.target.value))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                  />
                  {!allDay && (
                    <input
                      type="time"
                      required
                      value={endTimeForModal}
                      onChange={(e) => setEndTimeForModal(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Type de RDV</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as EventItem['type'])}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                >
                  <option value="Rendez-vous Banque" className="bg-[#0E1A20]">Banque</option>
                  <option value="Visite Immobilière" className="bg-[#0E1A20]">Visite Immo</option>
                  <option value="Signature Notaire" className="bg-[#0E1A20]">Notaire</option>
                  <option value="Réunion Agence" className="bg-[#0E1A20]">Interne Agence</option>
                  <option value="Tâche" className="bg-[#0E1A20]">Tâche (Rappel)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Nom du client / Contact</label>
                <input
                  type="text"
                  placeholder="ex: Alexandre Martin"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Lieu / Adresse</label>
                <input
                  type="text"
                  placeholder="ex: Agence Paris / Visioconférence"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Participants (emails séparés par une virgule)</label>
                <input
                  type="text"
                  placeholder="ex: collegue@conseilfinances.fr, client@gmail.com"
                  value={attendeesInput}
                  onChange={(e) => setAttendeesInput(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1 text-gray-300">Description / informations complémentaires</label>
                <textarea
                  placeholder="Détails, contexte, pièces à apporter..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5] resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Disponibilité</label>
                <select
                  value={busy ? 'busy' : 'free'}
                  onChange={(e) => setBusy(e.target.value === 'busy')}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#0EA5A5]"
                >
                  <option value="busy" className="bg-[#0E1A20]">Occupé (bloque le créneau)</option>
                  <option value="free" className="bg-[#0E1A20]">Disponible (créneau non bloqué)</option>
                </select>
              </div>

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-blue-400" />
                  <div>
                    <span className="text-xs font-semibold text-blue-200 block">Google Meet</span>
                    <span className="text-[10px] text-blue-300/60 block">Ajouter un lien de visioconférence</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={addMeetLink}
                  onChange={(e) => setAddMeetLink(e.target.checked)}
                  className="w-4 h-4 accent-blue-500"
                />
              </div>

              <div className="sm:col-span-2 flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingEvent(null); }}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white bg-white/5 rounded-xl font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={syncing}
                  className="px-5 py-2 text-xs font-bold text-black bg-[#0EA5A5] hover:bg-[#d9ab38] rounded-xl flex items-center gap-2"
                >
                  {syncing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {editingEvent
                      ? (isGoogleConnected ? 'Modifier & Synchro' : 'Modifier')
                      : (isGoogleConnected ? 'Enregistrer & Synchro' : 'Enregistrer')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div></Superposition>
      )}
    </div>
  );
};
// Signalé (3 septembre) : « sur mobile, agenda, puis clic sur une case pour
// créer un RDV, on ne peut pas scroller en bas ». Les fenêtres étaient
// rendues DANS <main>, qui a son propre contexte d'empilement (z-[1]) : la
// barre de navigation du bas (z-40, fixe) passait donc au-dessus du bas de la
// fenêtre et cachait les boutons, et 88vh dépassait la hauteur réellement
// visible sur téléphone. Rendues dans <body>, hauteur en dvh, marge basse
// pour la zone sûre.
const Superposition: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);

export default AgendaView;
