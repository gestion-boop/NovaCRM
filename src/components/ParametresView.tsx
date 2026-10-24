import React, { useState } from 'react';
import { Settings, Building2, Bell, Database, Server, CheckCircle2, FileText, Calendar, MessageSquare } from 'lucide-react';
import { AGENCIES, Agency } from '@/types';
import { SUPABASE_CONFIG_TRANSFERRED, TRANSFERRED_CALENDAR_EVENTS } from '@/data/csvDataLoader';

interface ParametresViewProps {
  selectedAgency: Agency;
  onSelectAgency: (agency: Agency) => void;
}

export const ParametresView: React.FC<ParametresViewProps> = ({
  selectedAgency,
  onSelectAgency,
}) => {
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(true);
  const [autoSync, setAutoSync] = useState(true);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-500/20 border border-slate-500/30 text-slate-300 flex items-center justify-center font-bold">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Paramètres & Configuration</h1>
          <p className="text-xs text-gray-400">Préférences d'agence, synchronisation Supabase et données intégrées</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Agence sélectionnée */}
        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[#E5B842]" />
            <h2 className="font-bold text-white text-sm">Agence en cours d'utilisation</h2>
          </div>

          <div className="space-y-2">
            {AGENCIES.map((ag) => (
              <button
                key={ag.id}
                onClick={() => onSelectAgency(ag)}
                className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                  selectedAgency.id === ag.id
                    ? 'bg-[#E5B842]/20 border-[#E5B842]/50 text-white font-semibold'
                    : 'bg-white/5 border-white/5 text-gray-300 hover:bg-white/10'
                }`}
              >
                <div>
                  <p className="text-xs font-bold text-white">{ag.name}</p>
                  <p className="text-[10px] text-gray-400">{ag.city}</p>
                </div>
                {selectedAgency.id === ag.id && (
                  <span className="text-[10px] bg-[#E5B842] text-black font-bold px-2 py-0.5 rounded-full">
                    Actif
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Notifications & Options */}
        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#E5B842]" />
            <h2 className="font-bold text-white text-sm">Notifications & Alertes</h2>
          </div>

          <div className="space-y-3 text-xs text-gray-300">
            <label className="flex items-center justify-between p-3 bg-black/20 rounded-xl cursor-pointer">
              <span>Alertes e-mail pour nouvelles offres de prêt</span>
              <input
                type="checkbox"
                checked={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.checked)}
                className="w-4 h-4 accent-[#E5B842]"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-black/20 rounded-xl cursor-pointer">
              <span>Rappels SMS pour rendez-vous notaires</span>
              <input
                type="checkbox"
                checked={notifySms}
                onChange={(e) => setNotifySms(e.target.checked)}
                className="w-4 h-4 accent-[#E5B842]"
              />
            </label>

            <label className="flex items-center justify-between p-3 bg-black/20 rounded-xl cursor-pointer">
              <span>Synchronisation Firestore & Supabase automatique</span>
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="w-4 h-4 accent-[#E5B842]"
              />
            </label>
          </div>
        </div>

        {/* Supabase & Integration */}
        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4 md:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-[#E5B842]" />
              <h2 className="font-bold text-white text-sm">Base de données Supabase transférée</h2>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Synchronisé
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 bg-black/30 rounded-xl border border-white/5 space-y-1.5">
              <p className="text-gray-400 font-medium text-[11px]">URL du Projet Supabase</p>
              <p className="font-mono text-white text-xs bg-white/5 p-2 rounded border border-white/10 select-all overflow-x-auto">
                {SUPABASE_CONFIG_TRANSFERRED.projectUrl}
              </p>
            </div>
            <div className="p-3.5 bg-black/30 rounded-xl border border-white/5 space-y-1.5">
              <p className="text-gray-400 font-medium text-[11px]">Jeton Interne Supabase</p>
              <p className="font-mono text-white text-xs bg-white/5 p-2 rounded border border-white/10 select-all overflow-x-auto truncate">
                {SUPABASE_CONFIG_TRANSFERRED.internalToken}
              </p>
            </div>
          </div>

          <div className="pt-2">
            <h3 className="text-xs font-semibold text-gray-300 mb-3">Données Transférées Intégrées dans l'Architecture :</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center gap-3">
                <Calendar className="w-4 h-4 text-[#E5B842]" />
                <div>
                  <p className="font-bold text-white">{TRANSFERRED_CALENDAR_EVENTS.length} évènements</p>
                  <p className="text-[10px] text-gray-400">Événements Agenda</p>
                </div>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center gap-3">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <div>
                  <p className="font-bold text-white">138 entrées</p>
                  <p className="text-[10px] text-gray-400">Lectures Canaux Chat</p>
                </div>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center gap-3">
                <FileText className="w-4 h-4 text-blue-400" />
                <div>
                  <p className="font-bold text-white">34 suivis</p>
                  <p className="text-[10px] text-gray-400">Lectures Annonces</p>
                </div>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center gap-3">
                <Server className="w-4 h-4 text-purple-400" />
                <div>
                  <p className="font-bold text-white">3 domaines</p>
                  <p className="text-[10px] text-gray-400">Thèmes Agences</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ParametresView;
