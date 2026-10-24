import React, { useState } from 'react';
import { 
  Bookmark, Plus, Sun, Moon, HelpCircle, Camera, Bell, CheckCircle2, Calendar, 
  Trash2, Mail, UserPlus, FileText, Check, ExternalLink, Database, Users, Menu 
} from 'lucide-react';
import { useTasks } from '@/hooks/useTasks';
import { useContacts } from '@/hooks/useContacts';
import { useAuth } from '@/context/AuthContext';

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  type: 'reminder' | 'lead' | 'calendar' | 'mail' | 'document';
  read: boolean;
  nav: string;
  contactId?: string;
}

interface HeaderProps {
  onOpenNouveauLead: () => void;
  onOpenSqlImport?: () => void;
  onOpenTutorial: () => void;
  onOpenCameraReservation?: () => void;
  unreadCount?: number;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  selectedAgencyName: string;
  onNavigate?: (nav: string) => void;
  onSelectContact?: (contactId: string) => void;
  onToggleMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenNouveauLead,
  onOpenSqlImport,
  onOpenTutorial,
  onOpenCameraReservation,
  isDarkMode,
  onToggleTheme,
  selectedAgencyName,
  onNavigate,
  onSelectContact,
  onToggleMobileMenu,
}) => {
  const [showNotifs, setShowNotifs] = useState(false);
  const { currentUser, activeAgency } = useAuth();
  const { tasks = [] } = useTasks();
  const { contacts = [] } = useContacts();

  // Visibility check: Only for Admins or users/agencies of Novavisio & Immosphera
  const isCameraAllowed = 
    activeAgency?.id === '0cd9362c-316e-4b57-af0b-b6cea092961b' || // Novavisio
    activeAgency?.id === '15157da9-71ea-4760-ae1c-3bc99d9caa20' || // Immosphera
    activeAgency?.id === 'all' || 
    currentUser?.email?.includes('admin') || 
    currentUser?.email === 's.grazia@conseilfinances.fr';

  // Initial notifications combined with dynamic tasks and localStorage
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    try {
      const saved = localStorage.getItem('novasphere_notifications_v1');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.warn('Erreur lecture notifications:', err);
    }
    return [
      {
        id: 'notif-1',
        title: 'Relance banque HSBC',
        description: 'Dossier Jean Dupont - Échéance aujourd\'hui à 15:00',
        time: 'Il y a 10 min',
        type: 'reminder',
        read: false,
        nav: 'rappels',
        contactId: 'c1'
      },
      {
        id: 'notif-2',
        title: 'Nouveau Lead qualifié',
        description: 'Le dossier d\'emprunt de Marie Curie est validé.',
        time: 'Il y a 2 heures',
        type: 'lead',
        read: false,
        nav: 'clients',
        contactId: 'c2'
      },
      {
        id: 'notif-3',
        title: 'Rendez-vous Notaire',
        description: 'Signature finale pour M. et Mme Martin',
        time: 'Hier à 14:30',
        type: 'calendar',
        read: true,
        nav: 'agenda'
      },
      {
        id: 'notif-4',
        title: 'Nouveau message reçu',
        description: 'Confirmation de l\'offre de prêt - Banque Postale',
        time: 'Hier à 18:10',
        type: 'mail',
        read: true,
        nav: 'mail'
      },
      {
        id: 'notif-5',
        title: 'Document importé',
        description: 'Avis d\'imposition 2024 déposé par Pierre Durand',
        time: 'Il y a 2 jours',
        type: 'document',
        read: true,
        nav: 'documents'
      }
    ];
  });

  // Save notifications to localStorage
  React.useEffect(() => {
    try {
      localStorage.setItem('novasphere_notifications_v1', JSON.stringify(notifications));
    } catch (err) {
      console.warn('Erreur sauvegarde notifications:', err);
    }
  }, [notifications]);

  // Listen for custom notification dispatch from ChatView or other modules
  React.useEffect(() => {
    const handleNewNotif = (e: Event) => {
      const detail = (e as CustomEvent<NotificationItem>).detail;
      if (detail && detail.title) {
        setNotifications(prev => {
          // Avoid exact duplicate IDs
          if (prev.some(n => n.id === detail.id)) return prev;
          return [detail, ...prev];
        });
      }
    };
    window.addEventListener('crm_add_notification', handleNewNotif);
    return () => window.removeEventListener('crm_add_notification', handleNewNotif);
  }, []);

  // Sync tasks into notifications if not already present
  React.useEffect(() => {
    if (tasks.length > 0) {
      const taskNotifs: NotificationItem[] = tasks.slice(0, 5).map(task => {
        const contact = contacts.find(c => c.id === task.contactId);
        return {
          id: `task-notif-${task.id}`,
          title: task.title,
          description: contact ? `Client: ${contact.name}` : `Échéance: ${task.dueDate ? task.dueDate.split('T')[0] : 'À traiter'}`,
          time: 'Tâche CRM',
          type: 'reminder',
          read: task.completed,
          nav: 'rappels',
          contactId: task.contactId
        };
      });

      setNotifications(prev => {
        const existingIds = new Set(prev.map(n => n.id));
        const newItems = taskNotifs.filter(tn => !existingIds.has(tn.id));
        return newItems.length > 0 ? [...newItems, ...prev] : prev;
      });
    }
  }, [tasks, contacts]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleClearAll = () => {
    setNotifications([]);
  };

  const handleDeleteNotif = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleNotificationClick = (notif: NotificationItem) => {
    // Mark as read
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    setShowNotifs(false);

    // Navigation logic
    if (notif.contactId && onSelectContact) {
      onSelectContact(notif.contactId);
    } else if (notif.nav && onNavigate) {
      onNavigate(notif.nav);
    }
  };

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'reminder':
        return <Bell className="w-4 h-4 text-amber-500" />;
      case 'lead':
        return <UserPlus className="w-4 h-4 text-emerald-500" />;
      case 'calendar':
        return <Calendar className="w-4 h-4 text-blue-500" />;
      case 'mail':
        return <Mail className="w-4 h-4 text-purple-500" />;
      case 'document':
        return <FileText className="w-4 h-4 text-teal-500" />;
      default:
        return <Bell className="w-4 h-4 text-amber-500" />;
    }
  };

  return (
    <header className="h-16 bg-[#081318] border-b border-white/5 px-3 sm:px-6 flex items-center justify-between z-40 shrink-0 select-none">
      {/* Brand Title + Mobile Menu Burger */}
      <div className="flex items-center gap-2 sm:gap-3">
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[#E5B842] border border-white/10 md:hidden flex items-center justify-center shrink-0 active:scale-95 transition-transform"
            title="Ouvrir le menu principal"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <img
            src="/novasphere-logo.jpg"
            alt="NovaSphere Logo"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border border-[#E5B842]/40 shadow-md shrink-0"
            referrerPolicy="no-referrer"
          />
          <span className="text-white font-bold text-base sm:text-xl tracking-tight hidden xs:inline-block">NovaSphere</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline-block text-xs bg-white/5 text-gray-300 px-2.5 py-1 rounded-full border border-white/10 font-medium">
            {selectedAgencyName}
          </span>
          <span className="text-[10px] sm:text-xs bg-[#E5B842]/20 text-[#E5B842] border border-[#E5B842]/40 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-bold flex items-center gap-1 shadow-sm">
            <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>{contacts.length}</span>
          </span>
        </div>
      </div>

      {/* Right Top Bar Tools */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Bookmark icon button */}
        <button 
          title="Raccourcis enregistrés"
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5"
        >
          <Bookmark className="w-4 h-4" />
        </button>

        {/* Primary Lead Action Button */}
        <button
          onClick={onOpenNouveauLead}
          className="bg-[#E5B842] hover:bg-[#d9ab38] text-black font-semibold text-xs sm:text-sm px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-md hover:shadow-gold/20 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Nouveau lead</span>
        </button>

        {/* SQL Import Button */}
        {onOpenSqlImport && (
          <button
            onClick={onOpenSqlImport}
            className="bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 font-medium text-xs sm:text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all active:scale-95"
            title="Importer des données SQL (Dumps PostgreSQL)"
          >
            <Database className="w-4 h-4 text-[#E5B842]" />
            <span className="hidden sm:inline">Importer SQL</span>
          </button>
        )}

        {/* Theme Toggle Button */}
        <button
          onClick={onToggleTheme}
          title="Changer de thème"
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5"
        >
          {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Tutorial Link */}
        <button
          onClick={onOpenTutorial}
          className="hidden sm:flex items-center gap-1.5 text-xs text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
        >
          <HelpCircle className="w-4 h-4 text-[#E5B842]" />
          <span>Tutoriel</span>
        </button>

        {/* Camera Quick Access Icon Button for Admins & Immosphera / Novavisio */}
        {isCameraAllowed && (
          <button
            onClick={onOpenCameraReservation}
            title="Réserver du matériel (Caméra 360, Drone, CM)"
            className="p-2 rounded-lg bg-[#2a133d] hover:bg-[#3d1a58] text-purple-300 hover:text-white transition-all border border-purple-500/40 shadow-md flex items-center justify-center gap-1.5 cursor-pointer relative group"
          >
            <Camera className="w-4 h-4 text-purple-300 group-hover:scale-110 transition-transform" />
            <span className="hidden lg:inline text-xs font-bold text-purple-200">Réserver caméra</span>
          </button>
        )}

        {/* Bell Notification Button */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5 relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notification dropdown */}
          {showNotifs && (
            <>
              {/* Dark opaque backdrop overlay */}
              <div 
                className="fixed inset-0 bg-black/65 backdrop-blur-xs z-40 transition-opacity animate-fade-in cursor-pointer"
                onClick={() => setShowNotifs(false)}
                title="Cliquer pour fermer"
              />
              <div className="absolute right-0 mt-3 w-[calc(100vw-2rem)] xs:w-96 md:w-[500px] lg:w-[560px] max-w-[90vw] bg-[#0a1e20] border border-[#153c3f] rounded-2xl shadow-2xl z-50 text-sm text-slate-300 overflow-hidden animate-fade-in origin-top-right">
              {/* Header */}
              <div className="px-5 py-4 border-b border-[#153c3f] flex items-center justify-between bg-[#07191b]">
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-white text-base md:text-lg">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2.5 py-0.5 rounded-full font-bold">
                      {unreadCount} non lues
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  {unreadCount > 0 && (
                    <button 
                      onClick={handleMarkAllRead}
                      className="text-xs text-amber-500 hover:text-amber-400 font-medium transition-colors flex items-center gap-1 cursor-pointer"
                      title="Marquer tout comme lu"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Tout lire
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button 
                      onClick={handleClearAll}
                      className="text-xs text-rose-400 hover:text-rose-300 font-medium transition-colors flex items-center gap-1 ml-1 cursor-pointer"
                      title="Effacer toutes les notifications"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Tout effacer
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="max-h-[360px] md:max-h-[540px] lg:max-h-[620px] overflow-y-auto custom-scrollbar p-3 space-y-2">
                {notifications.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-10 h-10 text-slate-600 stroke-[1.5]" />
                    <p className="text-sm md:text-base">Aucune notification pour le moment.</p>
                  </div>
                ) : (
                  notifications.map(notif => (
                    <div
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`p-3.5 md:p-4 rounded-xl border transition-all flex gap-3.5 items-start group cursor-pointer relative ${
                        !notif.read
                          ? 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15'
                          : 'bg-[#07191b]/60 border-white/5 hover:bg-[#143c3f]/40'
                      }`}
                    >
                      {!notif.read && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 bg-amber-500 rounded-r-full" />
                      )}

                      <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-black/30 flex items-center justify-center shrink-0 border border-white/5 mt-0.5">
                        {getIcon(notif.type)}
                      </div>

                      <div className="flex-1 min-w-0 pr-6">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm md:text-base font-semibold truncate ${!notif.read ? 'text-white' : 'text-slate-300'}`}>
                            {notif.title}
                          </p>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                        <p className="text-xs md:text-sm text-slate-400 mt-1 line-clamp-3 leading-relaxed">
                          {notif.description}
                        </p>
                        <p className="text-[11px] md:text-xs text-amber-500/80 font-medium mt-2">
                          {notif.time}
                        </p>
                      </div>

                      {/* Delete notification button */}
                      <button
                        onClick={(e) => handleDeleteNotif(e, notif.id)}
                        className="absolute right-2 top-3 p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                        title="Supprimer cette notification"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="p-3.5 md:p-4 border-t border-[#153c3f] bg-[#07191b] flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">
                  {notifications.length} notification{notifications.length > 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => setShowNotifs(false)}
                  className="px-4 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-[#0a1e20] hover:bg-[#143c3f] border border-[#153c3f] rounded-xl transition-colors cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          </>
          )}
        </div>
      </div>
    </header>
  );
};
export default Header;

