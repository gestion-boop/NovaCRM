import React from 'react';
import { 
  Home, LayoutDashboard, Users, GitFork, FolderKanban, Calendar, 
  Bell, MessageSquare, Mail, UserPlus, FileText, FileEdit, 
  LifeBuoy, Settings, ChevronDown, ChevronLeft, ChevronRight, LogOut,
  Building2, Sparkles, Home as HomeIcon, Camera as CameraIcon, X
} from 'lucide-react';
import { AGENCIES, Agency } from '@/types';

export interface SidebarProps {
  currentNav: string;
  onSelectNav: (nav: string) => void;
  selectedAgency: Agency;
  onSelectAgency: (agency: Agency) => void;
  onSignOut: () => void;
  userEmail?: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  unreadRemindersCount?: number;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const NAV_ITEMS = [
  { id: 'accueil', label: 'Accueil', icon: Home },
  { id: 'tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'pipeline', label: 'Pipeline', icon: GitFork },
  { id: 'projets-internes', label: 'Projets internes', icon: FolderKanban },
  { id: 'agenda', label: 'Agenda', icon: Calendar },
  { id: 'rappels', label: 'Rappels', icon: Bell },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'equipe', label: 'Équipe', icon: UserPlus },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'notes', label: 'Notes', icon: FileEdit },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'parametres', label: 'Paramètres', icon: Settings },
  { id: 'assistant-ia', label: 'Assistant IA', icon: Sparkles },
  { id: 'lodgify', label: 'Lodgify', icon: HomeIcon },
  { id: 'reserver-camera', label: 'Réserver caméra', icon: CameraIcon },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentNav,
  onSelectNav,
  selectedAgency,
  onSelectAgency,
  onSignOut,
  userEmail,
  collapsed,
  onToggleCollapse,
  unreadRemindersCount = 0,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const [showAgencyMenu, setShowAgencyMenu] = React.useState(false);

  const handleNavClick = (navId: string) => {
    onSelectNav(navId);
    if (onCloseMobile) onCloseMobile();
  };

  const sidebarContent = (isMobile: boolean = false) => (
    <div className="flex flex-col justify-between h-full w-full">
      {/* Top Header & Agency Picker */}
      <div>
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/novasphere-logo.jpg"
              alt="NovaSphere Logo"
              className="w-9 h-9 rounded-full object-cover border border-[#E5B842]/40 shadow-md shrink-0"
              referrerPolicy="no-referrer"
            />
            {(!collapsed || isMobile) && (
              <div className="leading-tight">
                <h2 className="text-white font-bold text-sm">CRM NovaSphere</h2>
                <p className="text-[10px] text-gray-400">Gestion Immobilière & Prêts</p>
              </div>
            )}
          </div>

          {!isMobile ? (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title={collapsed ? "Déplier le menu" : "Réduire le menu"}
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          ) : (
            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="Fermer le menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Agency Switcher */}
        {(!collapsed || isMobile) && (
          <div className="p-3 relative">
            <button
              onClick={() => setShowAgencyMenu(!showAgencyMenu)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-6 h-6 rounded-lg bg-[#E5B842]/20 text-[#E5B842] flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-white truncate">{selectedAgency.name}</p>
                  <p className="text-[10px] text-amber-400 font-medium">Agence active</p>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
            </button>

            {/* Dropdown Menu for Agencies */}
            {showAgencyMenu && (
              <div className="absolute left-3 right-3 mt-1 bg-[#0E1A20] border border-white/10 rounded-xl shadow-xl z-50 p-1 space-y-1">
                {AGENCIES.map((agency) => (
                  <button
                    key={agency.id}
                    onClick={() => {
                      onSelectAgency(agency);
                      setShowAgencyMenu(false);
                      if (isMobile && onCloseMobile) onCloseMobile();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                      selectedAgency.id === agency.id
                        ? 'bg-[#E5B842]/20 text-[#E5B842] font-semibold'
                        : 'text-gray-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span>{agency.name}</span>
                    <span className="text-[10px] text-gray-400">{agency.city}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Navigation list */}
        <div className="px-3 py-2 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto custom-scrollbar">
          {(!collapsed || isMobile) && (
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 select-none">
              NAVIGATION
            </p>
          )}

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = currentNav === item.id;
            const showBadge = item.id === 'rappels' && unreadRemindersCount > 0;

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                title={collapsed && !isMobile ? `${item.label}${showBadge ? ` (${unreadRemindersCount})` : ''}` : undefined}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[#282112]/90 text-[#E5B842] border border-[#E5B842]/80 shadow-sm font-semibold'
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                } ${collapsed && !isMobile ? 'justify-center px-0' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#E5B842]' : 'text-gray-400'}`} />
                  {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
                </div>
                {(!collapsed || isMobile) && showBadge && (
                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-red-500 text-white shadow-sm shrink-0">
                    {unreadRemindersCount}
                  </span>
                )}
                {collapsed && !isMobile && showBadge && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#081318]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* User Profile Footer */}
      <div className="p-3 border-t border-white/5">
        {(!collapsed || isMobile) ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-white/5 p-2 rounded-xl border border-white/5">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-[#E5B842] text-black font-bold flex items-center justify-center text-sm shrink-0">
                  S
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-white truncate">Sylvain Grazia</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {userEmail || 's.grazia@conseilf...'}
                  </p>
                </div>
              </div>
              <button
                onClick={onSignOut}
                title="Déconnexion"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 text-center select-none">
              © 2026 NovaSphere
            </p>
          </div>
        ) : (
          <button
            onClick={onSignOut}
            title="Déconnexion"
            className="w-full py-2 flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex bg-[#081318] border-r border-white/5 flex-col justify-between transition-all duration-300 z-30 shrink-0 ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {sidebarContent(false)}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
          />
          {/* Slide-over Drawer Panel */}
          <div className="relative w-72 max-w-[80vw] bg-[#081318] border-r border-white/10 h-full shadow-2xl z-50 flex flex-col animate-fade-in">
            {sidebarContent(true)}
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
