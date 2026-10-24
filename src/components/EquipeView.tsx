import React, { useState } from 'react';
import { UserPlus, Mail, Phone, Building2, Shield, Plus } from 'lucide-react';
import { TeamMember, AGENCIES } from '@/types';

const INITIAL_MEMBERS: TeamMember[] = [
  {
    id: 'tm-1',
    name: 'Sylvain Grazia',
    email: 's.grazia@conseilfinances.fr',
    role: 'Super Admin & Directeur Général Multi-Agences',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 01 02 03 04',
    avatar: 'S',
    status: 'Actif',
  },
  {
    id: 'tm-2',
    name: 'Frédéric',
    email: 'f.novavisio@novavisio.fr',
    role: 'Responsable Visites Immersives 360° & Drone',
    agencyId: '0cd9362c-316e-4b57-af0b-b6cea092961b',
    phone: '06 12 34 56 78',
    avatar: 'F',
    status: 'Actif',
  },
  {
    id: 'tm-3',
    name: 'Sarah',
    email: 'sarah.immosphera@immosphera.fr',
    role: 'Conseillère Immobilier & Estimations',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 98 76 54 32',
    avatar: 'S',
    status: 'Actif',
  },
  {
    id: 'tm-4',
    name: 'Liam',
    email: 'liam.conseil@conseilsfinances.fr',
    role: 'Coordinateur Projets Multi-Agences',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 55 44 33 22',
    avatar: 'L',
    status: 'Actif',
  },
  {
    id: 'tm-5',
    name: 'Anaïs',
    email: 'anais.negociation@immosphera.fr',
    role: 'Négociatrice Immobilier & Location',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 44 33 22 11',
    avatar: 'A',
    status: 'Actif',
  },
  {
    id: 'tm-6',
    name: 'Mathieu',
    email: 'm.schnell@conseilsfinances.fr',
    role: 'Conseiller Prêts & Financements',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 77 88 99 00',
    avatar: 'M',
    status: 'Actif',
  },
  {
    id: 'tm-7',
    name: 'Corinne Escudier',
    email: 'corinne.escudier@novavisio.fr',
    role: 'Webmaster & Consultante Digital',
    agencyId: '0cd9362c-316e-4b57-af0b-b6cea092961b',
    phone: '06 33 22 11 00',
    avatar: 'C',
    status: 'Actif',
  }
];

export const EquipeView: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>(INITIAL_MEMBERS);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center font-bold">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Équipe & Conseillers</h1>
            <p className="text-xs text-gray-400">Annuaire des membres du groupe Conseils Finances / NovaSphere</p>
          </div>
        </div>

        <button className="bg-[#E5B842] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2">
          <Plus className="w-4 h-4" />
          <span>Inviter un collaborateur</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {members.map((m) => {
          const agency = AGENCIES.find((a) => a.id === m.agencyId);
          return (
            <div key={m.id} className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4 hover:border-white/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#E5B842] text-black font-bold flex items-center justify-center text-lg shrink-0">
                  {m.avatar}
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">{m.name}</h3>
                  <p className="text-xs text-[#E5B842] font-medium">{m.role}</p>
                </div>
              </div>

              <div className="p-3 bg-black/30 rounded-xl space-y-2 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-gray-400" />
                  <span>{m.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-gray-400" />
                  <span>{m.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-gray-400" />
                  <span>{agency?.name || 'Siège'}</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-xs pt-1">
                <span className="text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-semibold">
                  ● {m.status}
                </span>
                <button className="text-gray-400 hover:text-white">Gérer accès</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default EquipeView;
