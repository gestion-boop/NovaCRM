import React, { useState, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, Plus, Clock, MapPin, User, ChevronLeft, ChevronRight, 
  Video, RefreshCw, Trash2, CheckCircle2, ExternalLink, CalendarDays, CalendarRange, List
} from 'lucide-react';
import {
  format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  startOfWeek, startOfMonth, endOfMonth, endOfWeek, isSameMonth, isSameDay,
  eachDayOfInterval, parseISO, isToday
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  fetchGoogleCalendarEvents,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getCachedAccessToken,
  requestWorkspaceAccessToken,
  GoogleCalendarEvent,
} from '@/lib/workspace';

import { TRANSFERRED_CALENDAR_EVENTS } from '@/data/csvDataLoader';

interface EventItem {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  clientName: string;
  type: 'Rendez-vous Banque' | 'Visite Immobilière' | 'Signature Notaire' | 'Réunion Agence' | 'Tâche';
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

  return {
    id: ev.id,
    title: fullTitle,
    date: dateStr,
    time: timeStr,
    location: ev.location || 'Agence / In Situ',
    clientName: 'Client Transféré',
    type: mappedType,
  };
});

const INITIAL_EVENTS: EventItem[] = [];

type ViewMode = 'month' | 'week' | 'day';

export const AgendaView: React.FC = () => {
  const [events, setEvents] = useState<EventItem[]>(INITIAL_EVENTS);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  
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

  // Google Workspace Integration State
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Deletion confirmation modal
  const [eventToDelete, setEventToDelete] = useState<EventItem | null>(null);

  useEffect(() => {
    const token = getCachedAccessToken();
    if (token) {
      setIsGoogleConnected(true);
      loadGoogleEvents(token);
    }
  }, []);

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
        
        if (g.start.dateTime) {
          const d = new Date(g.start.dateTime);
          dateStr = format(d, 'yyyy-MM-dd');
          timeStr = format(d, 'HH:mm');
        } else if (g.start.date) {
          dateStr = g.start.date;
          timeStr = '00:00';
        }

        return {
          id: 'g-' + g.id,
          title: g.summary || 'Événement Google',
          date: dateStr,
          time: timeStr,
          location: g.location || '',
          clientName: g.description?.slice(0, 30) || '',
          type: g.hangoutLink ? 'Rendez-vous Banque' : 'Réunion Agence',
          meetLink: g.hangoutLink || g.conferenceData?.entryPoints?.[0]?.uri,
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
    setSelectedDateForModal(date);
    setSelectedTimeForModal(time);
    setTitle('');
    setLocation('');
    setClientName('');
    setType('Rendez-vous Banque');
    setShowModal(true);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    let createdMeetLink: string | undefined = undefined;
    let newGoogleId: string | undefined = undefined;

    const token = getCachedAccessToken();

    // Create Start and End Dates based on selectedDate and time
    const [hours, minutes] = selectedTimeForModal.split(':').map(Number);
    const startDate = new Date(selectedDateForModal);
    startDate.setHours(hours, minutes, 0, 0);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration

    if (token) {
      setSyncing(true);
      try {
        const created = await createGoogleCalendarEvent(token, {
          summary: title,
          description: `Client: ${clientName || 'Prospect'} - Créé depuis CRM Novasphere`,
          location: location || 'Agence',
          startISO: startDate.toISOString(),
          endISO: endDate.toISOString(),
          addMeetLink,
        });

        createdMeetLink = created.hangoutLink || created.conferenceData?.entryPoints?.[0]?.uri;
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
      date: format(selectedDateForModal, 'yyyy-MM-dd'),
      time: selectedTimeForModal,
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

  const confirmDeleteEvent = async () => {
    if (!eventToDelete) return;
    const token = getCachedAccessToken();

    if (eventToDelete.googleEventId && token) {
      try {
        await deleteGoogleCalendarEvent(token, eventToDelete.googleEventId);
        setStatusMessage('Événement supprimé de Google Calendar.');
      } catch (err: unknown) {
        console.error('Erreur suppression Google Calendar:', err);
      }
    }

    setEvents(events.filter((e) => e.id !== eventToDelete.id));
    setEventToDelete(null);
  };

  const navigatePrevious = () => {
    if (viewMode === 'month') setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === 'week') setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const navigateNext = () => {
    if (viewMode === 'month') setCurrentDate(addMonths(currentDate, 1));
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
                  } ${isTdy ? 'bg-blue-900/20' : ''}`}
                >
                  <div className="flex items-center justify-between px-1">
                    <span className={`text-xs font-bold ${isTdy ? 'text-[#E5B842]' : ''}`}>
                      {format(day, dateFormat)}
                    </span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map(ev => (
                      <div 
                        key={ev.id} 
                        onClick={(e) => { e.stopPropagation(); setEventToDelete(ev); }}
                        className={`text-[9px] px-1.5 py-0.5 rounded truncate ${
                          ev.type === 'Rendez-vous Banque' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                          ev.type === 'Visite Immobilière' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' :
                          ev.type === 'Signature Notaire' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                          ev.type === 'Tâche' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                          'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        }`}
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
      <div className="flex flex-col h-full bg-[#0E1A20] rounded-xl border border-white/10 overflow-hidden relative">
        <div className="flex shrink-0">
          {/* Time column header */}
          <div className="w-16 border-r border-b border-white/10 bg-white/5 shrink-0"></div>
          {/* Days headers */}
          <div className="flex-1 grid grid-cols-7 border-b border-white/10 bg-white/5">
            {days.map((day) => (
              <div key={day.toISOString()} className="py-2 text-center border-l border-white/10 first:border-l-0">
                <div className="text-xs font-semibold text-gray-400 capitalize">{format(day, 'EEE', { locale: fr })}</div>
                <div className={`text-sm font-bold ${isToday(day) ? 'text-[#E5B842]' : 'text-gray-200'}`}>
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
                  
                  return (
                    <div 
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); setEventToDelete(ev); }}
                      style={{ top: `${top}px`, height: '60px' }}
                      className={`absolute left-1 right-1 rounded p-1.5 overflow-hidden shadow-md cursor-pointer z-10 border ${
                        ev.type === 'Rendez-vous Banque' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' :
                        ev.type === 'Visite Immobilière' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30' :
                        ev.type === 'Signature Notaire' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30' :
                        ev.type === 'Tâche' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30' :
                        'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                      }`}
                    >
                      <div className="text-[10px] font-bold leading-tight line-clamp-1">{ev.title}</div>
                      <div className="text-[9px] opacity-80 mt-0.5">{ev.time}</div>
                    </div>
                  );
                })}
              </div>
            ))}
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
              <div className={`text-xl font-bold ${isToday(currentDate) ? 'text-[#E5B842]' : 'text-gray-200'}`}>
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
                  onClick={(e) => { e.stopPropagation(); setEventToDelete(ev); }}
                  style={{ top: `${top}px`, height: '76px' }}
                  className={`absolute left-2 right-4 rounded-lg p-3 overflow-hidden shadow-lg cursor-pointer z-10 border ${
                    ev.type === 'Rendez-vous Banque' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' :
                    ev.type === 'Visite Immobilière' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30' :
                    ev.type === 'Signature Notaire' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30' :
                    ev.type === 'Tâche' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30' :
                    'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-bold">{ev.title}</div>
                      <div className="text-xs opacity-80 mt-1 flex items-center gap-2">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {ev.time}</span>
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

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto h-[90vh] flex flex-col text-white">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 shrink-0">
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
            className="bg-[#E5B842] hover:bg-[#d9ab38] text-black font-semibold text-xs px-3 py-2 rounded-xl flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Ajouter</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 mb-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs flex items-center justify-between shrink-0">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-blue-400 hover:text-white font-bold text-xs">✕</button>
        </div>
      )}

      {/* Date Header / Navigation */}
      <div className="p-3 bg-white/5 border border-white/10 rounded-t-2xl flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300">
            Aujourd'hui
          </button>
          <div className="flex items-center gap-1">
            <button onClick={navigatePrevious} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-bold text-white text-sm min-w-[140px] text-center capitalize">
              {viewMode === 'month' 
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

      {/* Calendar Area */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'month' && renderMonthView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'day' && renderDayView()}
      </div>

      {/* Delete Confirmation Modal */}
      {eventToDelete && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
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
            <p className="text-xs text-gray-400">Voulez-vous supprimer ce rendez-vous ?</p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEventToDelete(null)} className="px-4 py-2 text-xs text-gray-400 hover:text-white font-medium bg-white/5 rounded-xl">
                Fermer
              </button>
              <button onClick={confirmDeleteEvent} className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-md w-full p-6 text-white">
            <h3 className="text-lg font-bold mb-4 text-[#E5B842]">Planifier le {format(selectedDateForModal, 'd MMM', { locale: fr })} à {selectedTimeForModal}</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Titre de la réunion / visite</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Rendez-vous montage prêt - M. Martin"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#E5B842]"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-gray-300">Heure de début</label>
                  <input
                    type="time"
                    required
                    value={selectedTimeForModal}
                    onChange={(e) => setSelectedTimeForModal(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#E5B842]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-gray-300">Type de RDV</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as EventItem['type'])}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#E5B842]"
                  >
                    <option value="Rendez-vous Banque" className="bg-[#0E1A20]">Banque</option>
                    <option value="Visite Immobilière" className="bg-[#0E1A20]">Visite Immo</option>
                    <option value="Signature Notaire" className="bg-[#0E1A20]">Notaire</option>
                    <option value="Réunion Agence" className="bg-[#0E1A20]">Interne Agence</option>
                    <option value="Tâche" className="bg-[#0E1A20]">Tâche (Rappel)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Nom du client / Contact</label>
                <input
                  type="text"
                  placeholder="ex: Alexandre Martin"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#E5B842]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1 text-gray-300">Lieu / Adresse</label>
                <input
                  type="text"
                  placeholder="ex: Agence Paris / Visioconférence"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[#E5B842]"
                />
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

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white bg-white/5 rounded-xl font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={syncing}
                  className="px-5 py-2 text-xs font-bold text-black bg-[#E5B842] hover:bg-[#d9ab38] rounded-xl flex items-center gap-2"
                >
                  {syncing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isGoogleConnected ? 'Enregistrer & Synchro' : 'Enregistrer'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default AgendaView;
