import React, { useEffect, useState } from 'react';
import { CheckSquare, AlertTriangle, Clock, Megaphone, ListTodo, LayoutGrid } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useInternalProjectTasks } from '@/hooks/useInternalProjectTasks';

// Ticket "Rôle Stagiaire" (phase 2, section 1) : accueil volontairement
// minimal — tâches à faire, urgentes, nouvelles demandes, annonces,
// échéances proches. Rien de plus (consigne explicite : "ne surcharge pas
// cette interface").

interface StagiaireHomeProps {
  onOpenPipeline: () => void;
}

interface AnnouncementRow {
  id: string;
  message: string;
  created_at: string;
}

export const StagiaireHome: React.FC<StagiaireHomeProps> = ({ onOpenPipeline }) => {
  const { userProfile } = useAuth();
  const { tasks, isLoading } = useInternalProjectTasks({ type: 'mine' });
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let query = supabase
        .from('announcements')
        .select('id, message, created_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(5);
      // Signalé : "ne mets pas les annonces antécédentes" — un stagiaire qui
      // vient d'être invité ne doit voir que les annonces publiées APRÈS la
      // création de son compte, pas tout le backlog historique.
      if (userProfile?.createdAt) query = query.gte('created_at', userProfile.createdAt);
      const { data } = await query;
      if (!cancelled) setAnnouncements((data as AnnouncementRow[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [userProfile?.createdAt]);

  const todo = tasks.filter((t) => t.status !== 'termine');
  const urgent = todo.filter((t) => t.priority === 'urgente');
  const recent = [...todo]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((t) => Date.now() - new Date(t.createdAt).getTime() < 3 * 86400_000);
  const upcoming = todo
    .filter((t) => t.dueDate)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 5);

  const STAT_TILES = [
    { label: 'À faire', value: todo.length, icon: ListTodo, accent: '#38BDF8' },
    { label: 'Urgentes', value: urgent.length, icon: AlertTriangle, accent: '#F2637A' },
    { label: 'Nouvelles demandes', value: recent.length, icon: CheckSquare, accent: '#F7BC5F' },
    { label: 'Échéances proches', value: upcoming.length, icon: Clock, accent: '#A78BFA' },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 text-white">
      <div>
        <h1 className="text-xl font-bold text-white">Bonjour {userProfile?.displayName?.split(' ')[0] || ''} 👋</h1>
        <p className="text-xs text-gray-400">Voici ce qui vous attend aujourd'hui.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STAT_TILES.map((tile) => (
          <div key={tile.label} className="p-4 rounded-2xl bg-white/5 border border-white/10">
            <tile.icon className="w-5 h-5 mb-2" style={{ color: tile.accent }} />
            <div className="text-2xl font-black text-white">{isLoading ? '…' : tile.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">{tile.label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onOpenPipeline}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#F7BC5F] hover:bg-[#d9ab38] text-black text-sm font-bold transition-colors"
      >
        <LayoutGrid className="w-4 h-4" /> Voir mon pipeline de travail
      </button>

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">Prochaines échéances</h2>
          <div className="space-y-1.5">
            {upcoming.map((t) => (
              <div key={t.id} className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3">
                <span className="text-sm text-white truncate">{t.title}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{t.dueDate ? new Date(t.dueDate).toLocaleDateString('fr-FR') : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {announcements.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
            <Megaphone className="w-3.5 h-3.5" /> Annonces
          </h2>
          <div className="space-y-1.5">
            {announcements.map((a) => (
              <div key={a.id} className="p-3 rounded-xl bg-[#F7BC5F]/10 border border-[#F7BC5F]/25 text-sm text-white/90">
                {a.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StagiaireHome;
