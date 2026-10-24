import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { AGENCIES } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Users, Coins, Briefcase, CheckCircle2, ArrowRight, Building, Sparkles } from 'lucide-react';
import { useContacts } from '@/hooks/useContacts';
import { useDeals } from '@/hooks/useDeals';
import { useTasks } from '@/hooks/useTasks';

export default function Dashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { contacts = [] } = useContacts();
  const { deals = [] } = useDeals();
  const { tasks = [] } = useTasks();
  // 1. Calculate general statistics
  const totalContacts = contacts.length;
  
  // Assuming deals has a stage. 
  // 'Dossier facture' is considered completed based on existing logic
  const activeDeals = deals.filter(d => d.stage !== 'Dossier facture').length;
  
  const totalDealValue = deals
    .filter(d => d.stage !== 'Perdu')
    .reduce((sum, d) => sum + d.amount, 0);
  
  const completedTasks = tasks.filter(t => t.completed).length;
  const pendingTasks = tasks.length - completedTasks;

  // 2. Prepare chart data: Stages Distribution
  // Filter only deals with amounts for the chart
  const stageData = [
    { name: 'To-Do', value: deals.filter(d => d.stage === 'To-Do List').reduce((s, d) => s + d.amount, 0) },
    { name: 'Contact', value: deals.filter(d => d.stage === 'Prise de contact').reduce((s, d) => s + d.amount, 0) },
    { name: 'Montage', value: deals.filter(d => d.stage === 'Montage bancaire').reduce((s, d) => s + d.amount, 0) },
    { name: 'Banque', value: deals.filter(d => d.stage === 'En Banque').reduce((s, d) => s + d.amount, 0) },
    { name: 'Accord', value: deals.filter(d => d.stage === 'Accord banque / Rendez-vous').reduce((s, d) => s + d.amount, 0) },
    { name: 'Édition', value: deals.filter(d => d.stage === 'Attente édition des offres').reduce((s, d) => s + d.amount, 0) },
    { name: 'Décompte', value: deals.filter(d => d.stage === 'Décompte / Rendez-vous notaire').reduce((s, d) => s + d.amount, 0) },
    { name: 'Facture', value: deals.filter(d => d.stage === 'Dossier facture').reduce((s, d) => s + d.amount, 0) },
  ].filter(item => item.value > 0);

  // 3. Prepare chart data: Agency Distribution
  const agencyDistribution = AGENCIES.map(agency => {
    const agencyDeals = deals.filter(d => d.agencyId === agency.id);
    const amount = agencyDeals.reduce((sum, d) => sum + d.amount, 0);
    return {
      name: agency.name,
      value: amount,
    };
  }).filter(item => item.value > 0);

  const COLORS = ['#10b981', '#f59e0b', '#0ea5e9', '#6366f1', '#ec4899'];

  const recentContacts = [...contacts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header section with ambient quote */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight">Tableau de bord</h2>
          <p className="text-sm text-slate-400">Suivi consolidé du courtage et de l'acquisition client.</p>
        </div>
        <div className="px-4 py-2 bg-[#102d31]/50 border border-[#1b4b4e] rounded-xl flex items-center gap-2.5 text-xs text-amber-400">
          <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
          <span>Objectif trimestriel de l'agence : à 78% d'accomplissement</span>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 - Prospects (Deep Teal theme) */}
        <div className="p-6 rounded-2xl bg-[#0a1e20] hover:bg-[#0c2628] border border-teal-500/25 hover:border-teal-500/40 shadow-lg hover:shadow-teal-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Prospects & Clients</span>
            <div className="text-3xl font-black text-white tracking-tight">{totalContacts}</div>
            <button 
              onClick={() => onNavigate('clients')} 
              className="text-[11px] text-amber-400 font-bold hover:text-amber-300 inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Gérer les contacts <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-center justify-center text-teal-400 group-hover:scale-105 transition-transform">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 2 - Dossiers Actifs (Deep Amber theme) */}
        <div className="p-6 rounded-2xl bg-[#0f1d18] hover:bg-[#152820] border border-amber-500/25 hover:border-amber-500/40 shadow-lg hover:shadow-amber-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Dossiers actifs</span>
            <div className="text-3xl font-black text-white tracking-tight">{activeDeals}</div>
            <button 
              onClick={() => onNavigate('pipeline')} 
              className="text-[11px] text-amber-400 font-bold hover:text-amber-300 inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Voir le pipeline <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
            <Briefcase className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 3 - Volume Financier (Deep Emerald theme) */}
        <div className="p-6 rounded-2xl bg-[#081e18] hover:bg-[#0c2c23] border border-emerald-500/25 hover:border-emerald-500/40 shadow-lg hover:shadow-emerald-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Volume financier</span>
            <div className="text-2xl font-black text-emerald-400 tracking-tight">{formatCurrency(totalDealValue)}</div>
            <span className="text-[11px] text-emerald-400/90 font-semibold tracking-wide block">Encours total sécurisé</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
            <Coins className="w-6 h-6" />
          </div>
        </div>

        {/* Metric 4 - Tâches en Attente (Deep Slate-Indigo theme) */}
        <div className="p-6 rounded-2xl bg-[#091722] hover:bg-[#0c2030] border border-indigo-500/25 hover:border-indigo-500/40 shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 hover:-translate-y-1 flex items-center justify-between group">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium tracking-wide">Tâches en attente</span>
            <div className="text-3xl font-black text-white tracking-tight">{pendingTasks}</div>
            <button 
              onClick={() => onNavigate('rappels')} 
              className="text-[11px] text-amber-400 font-bold hover:text-amber-300 inline-flex items-center gap-1 cursor-pointer transition-all hover:underline"
            >
              Traiter les tâches <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Visualizer charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stages Chart */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="font-bold text-sm text-white">Répartition du Volume par Étape (€)</h3>
            <p className="text-xs text-slate-400">Total des opportunités financières valorisées dans le pipeline.</p>
          </div>
          <div className="h-64 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageData}>
                <XAxis dataKey="name" stroke="#64748b" tickLine={false} />
                <YAxis stroke="#64748b" tickLine={false} width={45} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip 
                  formatter={(value: number) => [formatCurrency(value), 'Volume']}
                  contentStyle={{ backgroundColor: '#07181a', borderColor: '#1b4b4e', borderRadius: '12px' }}
                />
                <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Agency Chart */}
        <div className="p-6 rounded-2xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-sm text-white">Part de Marché par Agence</h3>
            <p className="text-xs text-slate-400">Répartition des investissements par pôle géographique.</p>
          </div>
          <div className="h-48 w-full flex items-center justify-center relative">
            {agencyDistribution.length === 0 ? (
              <span className="text-xs text-slate-500">Aucune donnée disponible</span>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={agencyDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {agencyDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), '']}
                    contentStyle={{ backgroundColor: '#07181a', borderColor: '#1b4b4e', borderRadius: '12px', fontSize: '11px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {agencyDistribution.length > 0 && (
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total</span>
                <span className="text-sm font-black text-white">{formatCurrency(totalDealValue)}</span>
              </div>
            )}
          </div>
          <div className="space-y-1 text-[11px]">
            {agencyDistribution.map((entry, idx) => (
              <div key={entry.name} className="flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                  <span>{entry.name}</span>
                </div>
                <span className="font-semibold text-white">{formatCurrency(entry.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recents list and Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Contacts List */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 space-y-4">
          <div>
            <h3 className="font-bold text-sm text-white">Prospects Récemment Enregistrés</h3>
            <p className="text-xs text-slate-400">Derniers dossiers ajoutés pour attribution ou qualification.</p>
          </div>
          {recentContacts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-[#144447]/40 rounded-xl">
              Aucun prospect enregistré. Cliquez sur "Clients & Leads" pour ajouter votre premier dossier.
            </div>
          ) : (
            <div className="divide-y divide-[#144447]/30">
              {recentContacts.map(c => {
                const agency = AGENCIES.find(a => a.id === c.agencyId);
                return (
                  <div key={c.id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 font-bold text-xs uppercase">
                        {c.name.substring(0, 2)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{c.name}</div>
                        <div className="text-[10px] text-slate-400">{c.email} • {c.phone}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-black/40 border border-[#144447]/60 text-[9px] font-semibold text-slate-300">
                        {agency?.name || 'Inconnue'}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase ${
                        c.status === 'Converti' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' :
                        c.status === 'Nouveau' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25' :
                        'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                      }`}>
                        {c.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="p-6 rounded-2xl bg-[#07191b] border border-[#144447]/60 hover:border-[#1e5d61] shadow-xl hover:shadow-teal-500/5 transition-all duration-300 space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Actualités Immobilières</span>
            </div>
            <h3 className="font-extrabold text-base text-white">Taux d'Intérêt du Moment</h3>
            <p className="text-xs text-slate-400 leading-relaxed mt-1">
              Les taux d'intérêt moyens sur 20 ans se stabilisent à <strong>3.65%</strong> en ce mois d'août 2026. Profitez-en pour relancer vos prospects "Proposition" et revoir leurs capacités de financement.
            </p>
          </div>

          <div className="pt-4 border-t border-[#144447]/40 text-xs text-slate-300 space-y-2">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-amber-500" />
              <span>Capacité moyenne : 240,000 €</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500" />
              <span>Délai d'accord : 14 jours ouvrés</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
