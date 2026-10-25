import React from 'react';
import {
  ChevronLeft, Users, GitFork, Bell, Calendar, FileEdit, FileText,
  BarChart2, Settings, Headphones, Camera, Sparkles, Folder, Plus, Mail
} from 'lucide-react';
import { Agency } from '@/types';
import { getAgencyLogo } from '@/lib/agency-logos';

interface MobileHeaderProps {
  currentNav: string;
  onBack: () => void;
  onOpenAction?: () => void;
  actionLabel?: string;
  activeAgency?: Agency | null;
  unreadRemindersCount?: number;
}

interface NavMeta {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  actionLabel?: string;
}

const NAV_META: Record<string, NavMeta> = {
  'clients': { title: 'Clients & Leads', Icon: Users, actionLabel: 'Nouveau lead' },
  'pipeline': { title: 'Pipeline', Icon: GitFork, actionLabel: 'Nouveau lead' },
  'rappels': { title: 'Tâches & Alertes', Icon: Bell, actionLabel: 'Nouvelle tâche' },
  'agenda': { title: 'Mon Agenda', Icon: Calendar, actionLabel: 'Nouveau RDV' },
  'notes': { title: 'Bloc-Notes', Icon: FileEdit, actionLabel: 'Nouvelle note' },
  'documents': { title: 'Documents', Icon: FileText, actionLabel: 'Ajouter' },
  'tableau-de-bord': { title: 'Tableau de bord', Icon: BarChart2 },
  'mail': { title: 'Mails', Icon: Mail, actionLabel: 'Écrire' },
  'equipe': { title: 'Équipe', Icon: Users },
  'projets-internes': { title: 'Projets internes', Icon: Folder, actionLabel: 'Nouveau projet' },
  'support': { title: 'Support & Tickets', Icon: Headphones },
  'reserver-camera': { title: 'Réserver caméra', Icon: Camera, actionLabel: 'Réserver' },
  'parametres': { title: 'Paramètres', Icon: Settings },
  'comptabilite': { title: 'Comptabilité', Icon: Sparkles },
  'immosphera360': { title: 'Immosphera 360', Icon: Sparkles },
};

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  currentNav,
  onBack,
  onOpenAction,
  actionLabel,
  activeAgency,
  unreadRemindersCount,
}) => {
  const meta = NAV_META[currentNav] || { title: 'Nova CRM', Icon: Sparkles };
  const Icon = meta.Icon;
  const effectiveActionLabel = actionLabel || meta.actionLabel;
  const logo = activeAgency?.name ? getAgencyLogo(activeAgency.name) : null;

  return (
    <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#07191c]/95 backdrop-blur-2xl border-b border-teal-500/20 shadow-md select-none">
      {/* Liseré supérieur doré */}
      <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#F7BC5F]/60 to-transparent pointer-events-none" />

      <div className="flex items-center justify-between px-3 h-14 pt-[env(safe-area-inset-top,0px)] gap-2">
        {/* Bouton Retour Accueil */}
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 py-1.5 px-2.5 -ml-1 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-slate-200 border border-white/10 text-xs font-bold transition-all shrink-0"
          aria-label="Retour à l'accueil"
        >
          <ChevronLeft className="w-4 h-4 text-[#F7BC5F] stroke-[2.5]" />
          <span>Accueil</span>
        </button>

        {/* Titre central + Icône */}
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
          <div className="w-7 h-7 rounded-lg bg-[#F7BC5F]/15 border border-[#F7BC5F]/30 text-[#F9C977] flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 stroke-[2.2]" />
          </div>
          <h1 className="text-sm font-extrabold text-white truncate tracking-tight">
            {meta.title}
          </h1>
          {currentNav === 'rappels' && typeof unreadRemindersCount === 'number' && unreadRemindersCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">
              {unreadRemindersCount}
            </span>
          )}
        </div>

        {/* Action contextuelle à droite */}
        <div className="flex items-center gap-1.5 shrink-0">
          {onOpenAction && effectiveActionLabel ? (
            <button
              type="button"
              onClick={onOpenAction}
              className="flex items-center gap-1 h-8 px-2.5 rounded-full bg-gradient-to-r from-[#FAD592] via-[#F9C977] to-[#D9A34E] text-[#1a1230] text-xs font-black shadow-md shadow-[#F7BC5F]/20 active:scale-95 transition-all"
              title={effectiveActionLabel}
              aria-label={effectiveActionLabel}
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span className="hidden xs:inline text-[11px] font-bold">{effectiveActionLabel}</span>
            </button>
          ) : logo ? (
            <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 p-0.5 flex items-center justify-center overflow-hidden">
              <img src={logo} alt="" className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-8" />
          )}
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
