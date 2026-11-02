import React, { useEffect, useState } from 'react';
import { BarChart2, Bell, Calendar, Mail, MessageSquare } from 'lucide-react';
import { getCachedAccessToken, requestWorkspaceAccessToken, fetchGoogleCalendarEvents } from '@/lib/workspace';

interface Props {
  currentNav: string;
  onNavigate: (nav: string) => void;
  rappels: number;
  chat: number;
  mail: number;
}

// Test (branche test, tablette/ordinateur) : la rangée de tuiles de l'accueil
// (Tableau de bord, Rappels, Chat, Agenda, Mail) devient la barre du haut,
// visible sur tous les écrans.
export const DesktopTopStatusBar: React.FC<Props> = ({ currentNav, onNavigate, rappels, chat, mail }) => {
  const [agenda, setAgenda] = useState(0);
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        let token = getCachedAccessToken();
        if (!token) token = await requestWorkspaceAccessToken().catch(() => null);
        if (!token) return;
        const events = await fetchGoogleCalendarEvents(token);
        const debut = new Date(); debut.setHours(0, 0, 0, 0);
        const fin = new Date(debut); fin.setDate(fin.getDate() + 1);
        const n = events.filter((e) => {
          const brut = e.start?.dateTime || e.start?.date;
          if (!brut) return false;
          const d = new Date(brut);
          return d >= debut && d < fin;
        }).length;
        if (!annule) setAgenda(n);
      } catch { /* silencieux : le compteur reste à 0 */ }
    })();
    return () => { annule = true; };
  }, []);

  const items: Array<{ nav: string; label: string; statut: string; alerte: boolean; Icon: React.ElementType; gradient: string }> = [
    { nav: 'tableau-de-bord', label: 'Tableau de bord', statut: "Vue d'ensemble", alerte: false, Icon: BarChart2, gradient: 'from-[#0D9488] via-[#0F766E] to-[#042F2E]' },
    { nav: 'rappels', label: 'Rappels & Alertes', statut: rappels > 0 ? `${rappels} en attente` : 'À jour', alerte: rappels > 0, Icon: Bell, gradient: 'from-[#8B1E3F] via-[#63142A] to-[#3B0A18]' },
    { nav: 'chat', label: 'Chat Équipe', statut: chat > 0 ? `${chat} non lu${chat > 1 ? 's' : ''}` : 'À jour', alerte: chat > 0, Icon: MessageSquare, gradient: 'from-[#00B4DB] via-[#0083B0] to-[#005C8A]' },
    { nav: 'agenda', label: 'Agenda & RDV', statut: agenda > 0 ? `${agenda} aujourd'hui` : 'À jour', alerte: agenda > 0, Icon: Calendar, gradient: 'from-[#059669] via-[#047857] to-[#064E3B]' },
    { nav: 'mail', label: 'Mail', statut: mail > 0 ? `${mail} nouveau${mail > 1 ? 'x' : ''}` : 'À jour', alerte: mail > 0, Icon: Mail, gradient: 'from-[#1E3A8A] via-[#1E293B] to-[#0F172A]' },
  ];

  return (
    <div className="hidden md:block shrink-0 z-40 px-3 sm:px-5 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2">
      <div className="grid grid-cols-5 gap-2 sm:gap-3 max-w-7xl mx-auto">
        {items.map(({ nav, label, statut, alerte, Icon, gradient }) => (
          <button
            key={nav}
            type="button"
            onClick={() => onNavigate(nav)}
            title={label}
            className={`group p-2 sm:p-2.5 rounded-2xl bg-white/[0.05] backdrop-blur-md border shadow-[0_6px_16px_-6px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-all cursor-pointer flex items-center justify-between nv-effet-jaune ${
              currentNav === nav ? 'border-[#F7BC5F]/80' : 'border-white/10'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br ${gradient} border border-white/25 flex items-center justify-center shrink-0 shadow-md`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              <div className="truncate text-left min-w-0">
                <p className="text-[10px] text-gray-400 font-medium truncate">{label}</p>
                <p className="text-xs font-bold text-white truncate">{statut}</p>
              </div>
            </div>
            <span className={`w-2 h-2 rounded-full shrink-0 ml-1.5 ${alerte ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-white/20'}`} />
          </button>
        ))}
      </div>
    </div>
  );
};

export default DesktopTopStatusBar;
