import React, { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useContacts } from '@/hooks/useContacts';
import { useTasks } from '@/hooks/useTasks';
import { countTodayAndOverdueTasks } from '@/lib/taskUtils';

// Components
import Auth from './components/Auth';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import AccueilGrid from './components/AccueilGrid';
import Dashboard from './components/Dashboard';
import Contacts from './components/Contacts';
import Pipeline from './components/Pipeline';
import NouveauLeadModal from './components/NouveauLeadModal';
import TutorialModal from './components/TutorialModal';
import SqlImportModal from './components/SqlImportModal';
import CameraReservationModal from './components/CameraReservationModal';

// Subview components
import ProjetsInternes from './components/ProjetsInternes';
import AgendaView from './components/AgendaView';
import RappelsView from './components/RappelsView';
import ChatView from './components/ChatView';
import MailView from './components/MailView';
import EquipeView from './components/EquipeView';
import DocumentsView from './components/DocumentsView';
import NotesView from './components/NotesView';
import SupportView from './components/SupportView';
import ParametresView from './components/ParametresView';
import AssistantIAView from './components/AssistantIAView';
import LodgifyView from './components/LodgifyView';
import ReserverCameraView from './components/ReserverCameraView';
import ClientProfileView from './components/ClientProfileView';

export function App() {
  const { currentUser, activeAgency, setActiveAgency, authLoading, logout, loginAsDemo } = useAuth();
  const { unreadNotificationsCount, unreadMessagesCount } = useDashboardStats();
  const { addContact } = useContacts();
  const { tasks = [] } = useTasks();

  const unreadRemindersCount = countTodayAndOverdueTasks(tasks);

  // Agency & Layout state
  const [currentNav, setCurrentNav] = useState('accueil');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.remove('light-mode');
    } else {
      document.documentElement.classList.add('light-mode');
    }
  }, [isDarkMode]);

  // Modals state
  const [showNouveauLead, setShowNouveauLead] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showSqlImport, setShowSqlImport] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  
  // Client Profile Full View state
  const [selectedClientProfileId, setSelectedClientProfileId] = useState<string | null>(null);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign out error:", err);
    }
    logout();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#071015] flex flex-col items-center justify-center text-white p-4">
        <div className="w-12 h-12 rounded-full border-4 border-[#E5B842] border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide">Chargement de CRM NovaSphere...</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Auth onDemoAccess={loginAsDemo} />;
  }

  return (
    <div className="min-h-screen bg-[#071015] text-gray-100 flex flex-col font-sans overflow-hidden select-none">
      {/* Top Header Bar */}
      <Header
        onOpenNouveauLead={() => setShowNouveauLead(true)}
        onOpenSqlImport={() => setShowSqlImport(true)}
        onOpenTutorial={() => setShowTutorial(true)}
        onOpenCameraReservation={() => setShowCameraModal(true)}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(!isDarkMode)}
        selectedAgencyName={activeAgency.name}
        onNavigate={(nav) => {
          setCurrentNav(nav);
          setSelectedClientProfileId(null);
          if (nav === 'reserver-camera') {
            setShowCameraModal(true);
          }
        }}
        onSelectContact={(contactId) => {
          setSelectedClientProfileId(contactId);
        }}
        onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar */}
        <Sidebar
          currentNav={currentNav}
          onSelectNav={(nav) => {
            setCurrentNav(nav);
            setSelectedClientProfileId(null);
            if (nav === 'reserver-camera') {
              setShowCameraModal(true);
            }
          }}
          selectedAgency={activeAgency}
          onSelectAgency={setActiveAgency}
          onSignOut={handleSignOut}
          userEmail={currentUser?.email || 's.grazia@conseilfinances.fr'}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          unreadRemindersCount={unreadRemindersCount}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        {/* Main View Display */}
        <main className="flex-1 overflow-y-auto relative bg-[#071015] custom-scrollbar">
          {selectedClientProfileId ? (
            <ClientProfileView
              clientId={selectedClientProfileId}
              onBack={() => setSelectedClientProfileId(null)}
            />
          ) : (
            <>
              {currentNav === 'accueil' && (
                <AccueilGrid
                  onNavigate={setCurrentNav}
                  unreadRemindersCount={unreadRemindersCount}
                  unreadNotificationsCount={unreadNotificationsCount}
                  unreadMessagesCount={unreadMessagesCount}
                />
              )}

          {currentNav === 'tableau-de-bord' && (
            <div className="p-6">
              <Dashboard onNavigate={setCurrentNav} />
            </div>
          )}

          {currentNav === 'clients' && (
            <div className="p-6">
              <Contacts 
                onAddDeal={() => {}} 
                onSelectContact={(contactId) => setSelectedClientProfileId(contactId)}
              />
            </div>
          )}

          {currentNav === 'pipeline' && (
            <div className="p-6">
              <Pipeline 
                onSelectContact={(contactId) => setSelectedClientProfileId(contactId)}
              />
            </div>
          )}

          {currentNav === 'projets-internes' && (
            <ProjetsInternes agencyId={activeAgency.id} />
          )}

          {currentNav === 'agenda' && <AgendaView />}

          {currentNav === 'rappels' && (
            <RappelsView
              onSelectContact={setSelectedClientProfileId}
            />
          )}

          {currentNav === 'chat' && <ChatView />}

          {currentNav === 'mail' && <MailView />}

          {currentNav === 'equipe' && <EquipeView />}

          {currentNav === 'documents' && <DocumentsView />}

          {currentNav === 'notes' && <NotesView />}

          {currentNav === 'support' && <SupportView />}

          {currentNav === 'parametres' && (
            <ParametresView
              selectedAgency={activeAgency}
              onSelectAgency={setActiveAgency}
            />
          )}

          {currentNav === 'assistant-ia' && <AssistantIAView />}

          {currentNav === 'lodgify' && <LodgifyView />}

          {currentNav === 'reserver-camera' && (
            <ReserverCameraView onOpenModal={() => setShowCameraModal(true)} />
          )}
            </>
          )}
        </main>
      </div>

      {/* Nouveau Lead Modal */}
      <NouveauLeadModal
        isOpen={showNouveauLead}
        onClose={() => setShowNouveauLead(false)}
        onSubmit={async (data) => await addContact.mutateAsync(data)}
        selectedAgencyId={activeAgency.id}
      />

      {/* Tutorial Modal */}
      <TutorialModal
        isOpen={showTutorial}
        onClose={() => setShowTutorial(false)}
      />

      {/* SQL Import Modal */}
      <SqlImportModal
        isOpen={showSqlImport}
        onClose={() => setShowSqlImport(false)}
      />

      {/* Camera Reservation Modal */}
      <CameraReservationModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
      />
    </div>
  );
}

export default App;
