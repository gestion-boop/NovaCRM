import { TeamMember } from '@/types';

export const TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'tm-1',
    name: 'Sylvain Grazia',
    email: 's.grazia@conseilfinances.fr',
    role: 'Super Admin & Directeur Général Multi-Agences',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 01 02 03 04',
    avatar: 'SG',
    status: 'Actif',
  },
  {
    id: 'tm-2',
    name: 'Frédéric',
    email: 'f.novavisio@novavisio.fr',
    role: 'Responsable Visites Immersives 360° & Drone',
    agencyId: '0cd9362c-316e-4b57-af0b-b6cea092961b',
    phone: '06 12 34 56 78',
    avatar: 'FR',
    status: 'Actif',
  },
  {
    id: 'tm-3',
    name: 'Sarah',
    email: 'sarah.immosphera@immosphera.fr',
    role: 'Conseillère Immobilier & Estimations',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 98 76 54 32',
    avatar: 'SA',
    status: 'Actif',
  },
  {
    id: 'tm-4',
    name: 'Liam',
    email: 'liam.conseil@conseilsfinances.fr',
    role: 'Coordinateur Projets Multi-Agences',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 55 44 33 22',
    avatar: 'LI',
    status: 'Actif',
  },
  {
    id: 'tm-5',
    name: 'Anaïs',
    email: 'anais.negociation@immosphera.fr',
    role: 'Négociatrice Immobilier & Location',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 44 33 22 11',
    avatar: 'AN',
    status: 'Actif',
  },
  {
    id: 'tm-6',
    name: 'Mathieu',
    email: 'm.schnell@conseilsfinances.fr',
    role: 'Conseiller Prêts & Financements',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 77 88 99 00',
    avatar: 'MA',
    status: 'Actif',
  },
  {
    id: 'tm-7',
    name: 'Corinne Escudier',
    email: 'corinne.escudier@novavisio.fr',
    role: 'Webmaster & Consultante Digital',
    agencyId: '0cd9362c-316e-4b57-af0b-b6cea092961b',
    phone: '06 33 22 11 00',
    avatar: 'CE',
    status: 'Actif',
  }
];

export function getAssignedUser(assignedTo?: string): TeamMember {
  if (assignedTo) {
    const found = TEAM_MEMBERS.find(m => 
      m.id === assignedTo || 
      m.name.toLowerCase() === assignedTo.toLowerCase() || 
      m.email.toLowerCase() === assignedTo.toLowerCase()
    );
    if (found) return found;
  }
  return TEAM_MEMBERS[0];
}
