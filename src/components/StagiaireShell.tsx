import React, { useEffect, useState } from 'react';
import { Home, LayoutGrid, LogOut, FileText, Calendar, FileEdit } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, NovaSphereUserProfile } from '@/context/AuthContext';
import { StagiaireHome } from './StagiaireHome';
import { InternalProjectBoard } from './InternalProjectBoard';
import DocumentsView from './DocumentsView';
import AgendaView from './AgendaView';
import NotesView from './NotesView';

// Ticket "Rôle Stagiaire" (phase 2) : interface entièrement séparée du
// reste du CRM — pas de Sidebar générale, pas d'accès aux autres onglets.
// Accueil (simplifié) et son pipeline de tâches sont TOUJOURS inclus.
// C'est ce composant qu'App.tsx affiche à la place de tout le reste quand
// `userProfile.role === 'intern'`.
//
// Ticket "Paramètres/Nova/Utilisateurs/Annonces" (5/16) : "invitation
// stagiaire enrichie" — un admin peut ouvrir des modules additionnels à
// l'invitation (userProfile.internAllowedModules, cf. intern_details en
// base) ; ils apparaissent ici en onglets dynamiques, chacun rendu avec le
// même composant autonome que dans le CRM complet — jamais de version
// dupliquée/simplifiée à maintenir en parallèle.
const EXTRA_MODULES: Record<string, { label: string; icon: React.ElementType; Component: React.ComponentType }> = {
  documents: { label: 'Documents', icon: FileText, Component: DocumentsView },
  agenda: { label: 'Agenda', icon: Calendar, Component: AgendaView },
  notes: { label: 'Notes', icon: FileEdit, Component: NotesView },
};

export const StagiaireShell: React.FC = () => {
  const { userProfile, logout } = useAuth();
  const allowedExtraModules = (userProfile?.internAllowedModules || []).filter((id) => id in EXTRA_MODULES);
  const [tab, setTab] = useState<'accueil' | 'pipeline' | string>('accueil');
  const [users, setUsers] = useState<NovaSphereUserProfile[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('profiles').select('*');
      if (cancelled) return;
      setUsers(
        (data || []).map((u: any) => ({
          uid: u.id,
          email: u.email || '',
          displayName: u.full_name || u.email || 'Membre',
          photoURL: u.avatar_url || null,
          role: 'user',
          agencyIds: [],
          active: true,
          createdAt: u.created_at || new Date().toISOString(),
          updatedAt: u.updated_at || new Date().toISOString(),
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-screen bg-[#071015] text-gray-100 flex flex-col font-sans overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 bg-[#07191b]">
        <div className="flex items-center gap-2">
          <img src="/nova-mascotte.png" alt="Nova CRM" className="w-7 h-7" />
          <span className="font-black text-white text-sm">Nova CRM</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F7BC5F]/15 text-[#F9C977] border border-[#F7BC5F]/30 ml-1">Stagiaire</span>
        </div>
        <button onClick={() => void logout()} className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/15 text-gray-400 hover:text-rose-300 transition-colors" title="Se déconnecter">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {tab === 'accueil' ? (
          <StagiaireHome onOpenPipeline={() => setTab('pipeline')} />
        ) : tab === 'pipeline' ? (
          <div className="p-6 max-w-5xl mx-auto">
            <InternalProjectBoard
              scope={{ type: 'mine' }}
              boardTitle={`Bonjour ${userProfile?.displayName?.split(' ')[0] || ''} — mon pipeline`}
              users={users}
              canCreateTasks={false}
            />
          </div>
        ) : (
          (() => {
            const extra = EXTRA_MODULES[tab];
            if (!extra) return null;
            const Comp = extra.Component;
            return <Comp />;
          })()
        )}
      </main>

      <nav className="shrink-0 flex items-center justify-around border-t border-white/10 bg-[#07191b] py-2 sm:hidden overflow-x-auto">
        <button
          onClick={() => setTab('accueil')}
          className={`flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl text-[10px] font-bold shrink-0 ${tab === 'accueil' ? 'text-[#F9C977]' : 'text-gray-400'}`}
        >
          <Home className="w-4 h-4" /> Accueil
        </button>
        <button
          onClick={() => setTab('pipeline')}
          className={`flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl text-[10px] font-bold shrink-0 ${tab === 'pipeline' ? 'text-[#F9C977]' : 'text-gray-400'}`}
        >
          <LayoutGrid className="w-4 h-4" /> Pipeline
        </button>
        {allowedExtraModules.map((id) => {
          const { label, icon: Icon } = EXTRA_MODULES[id];
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl text-[10px] font-bold shrink-0 ${tab === id ? 'text-[#F9C977]' : 'text-gray-400'}`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          );
        })}
      </nav>

      {/* Desktop : mêmes entrées, en haut à la place du dock mobile. */}
      <div className="hidden sm:flex items-center justify-center gap-2 border-t border-white/10 bg-[#07191b] py-2 shrink-0 flex-wrap">
        <button
          onClick={() => setTab('accueil')}
          className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 ${tab === 'accueil' ? 'bg-[#F7BC5F]/15 text-[#F9C977] border border-[#F7BC5F]/30' : 'text-gray-400 hover:text-white'}`}
        >
          <Home className="w-3.5 h-3.5" /> Accueil
        </button>
        <button
          onClick={() => setTab('pipeline')}
          className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 ${tab === 'pipeline' ? 'bg-[#F7BC5F]/15 text-[#F9C977] border border-[#F7BC5F]/30' : 'text-gray-400 hover:text-white'}`}
        >
          <LayoutGrid className="w-3.5 h-3.5" /> Mon pipeline
        </button>
        {allowedExtraModules.map((id) => {
          const { label, icon: Icon } = EXTRA_MODULES[id];
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 ${tab === id ? 'bg-[#F7BC5F]/15 text-[#F9C977] border border-[#F7BC5F]/30' : 'text-gray-400 hover:text-white'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StagiaireShell;
