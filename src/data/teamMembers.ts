import { TeamMember } from '@/types';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(val?: string | null): boolean {
  if (!val || typeof val !== 'string') return false;
  return UUID_REGEX.test(val.trim());
}

export function toValidUuidOrNull(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

export const TEAM_MEMBERS: TeamMember[] = [
  {
    id: '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29',
    name: 'Sylvain Grazia',
    email: 's.grazia@conseilfinances.fr',
    role: 'Super Admin & Directeur Général Multi-Agences',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 19 44 55 54',
    avatar: 'SG',
    avatarUrl: '/team/sylvain_grazia.png',
    status: 'Actif',
  },
  {
    id: '15bcec53-de3e-40b8-8b7e-bb6874836f29',
    name: 'Mélanie Grazia',
    email: 'gestion@immosphera.fr',
    role: "Gérante d'Agence",
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 33 27 46 81',
    avatar: 'MG',
    avatarUrl: '/team/melanie_grazia.png',
    status: 'Actif',
  },
  {
    id: '878b36f3-1f8f-4206-af8b-3e4ade7a59fe',
    name: 'Christophe Hirsch',
    email: 'christophe.hirsch@immosphera.fr',
    role: 'Conseiller Immobilier',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 13 91 22 66',
    avatar: 'CH',
    avatarUrl: '/team/christophe_hirsch.png',
    status: 'Actif',
  },
  {
    id: '77273e9e-17f2-4dd8-b3c6-40f2845d557c',
    name: 'Clémence Grandguillaume',
    email: 'clemence.grandguillaume@immosphera.fr',
    role: 'Conseillère Immobilier',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '07 86 04 82 93',
    avatar: 'CG',
    avatarUrl: '/team/clemence_grandguillaume.png',
    status: 'Actif',
  },
  {
    // Signalé : "message envoyé mais elle ne le reçoit pas" — cet id ne
    // correspondait plus à aucun profil réel (ancien compte, jamais mis à
    // jour ici après la recréation de son compte le 28/08). Toute nouvelle
    // conversation démarrée depuis cette liste statique (voir
    // colleaguesForNewConv dans ChatViewSupabase.tsx) ajoutait donc un membre
    // fantôme, invisible pour elle. Corrigé avec son id réel actuel
    // (profiles.id) ; les conversations déjà créées avec l'ancien id ont été
    // réparées directement en base.
    id: '8b1a2e9a-2ac2-43da-b4f1-970d99aad4f0',
    name: 'Isabelle Gensonnie',
    email: 'isabelle.gensonnie@immosphera.fr',
    role: 'Commerciale',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 07 19 46 09',
    avatar: 'IG',
    avatarUrl: '/team/isabelle_gensonnie.png',
    status: 'Actif',
  },
  {
    id: 'b6fc1112-3c61-44c1-ad45-20ba8e6cc070',
    name: 'Karine Brebion',
    email: 'karine.brebion@immosphera.fr',
    role: 'Conseillère Immobilier & Courtage',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '+33 6 24 63 26 46',
    avatar: 'KB',
    avatarUrl: '/team/karine_brebion.png',
    status: 'Actif',
  },
  {
    id: '3c6797de-456a-4988-8358-7e3d813e9474',
    name: 'Laetitia Pioche',
    email: 'laetitia.pioche@immosphera.fr',
    role: 'Conseillère Immobilier',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '07 88 37 73 92',
    avatar: 'LP',
    avatarUrl: '/team/laetitia_pioche.png',
    status: 'Actif',
  },
  {
    id: 'a1cc619f-c73d-4359-998c-5dd5254f6348',
    name: 'Pauline Segura',
    email: 'pauline.s@immosphera.fr',
    role: 'Conseillère Immobilier',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '07 62 34 10 78',
    avatar: 'PS',
    avatarUrl: '/team/pauline_segura.png',
    status: 'Actif',
  },
  {
    id: '4fdf3cf2-da17-4ca7-9e3b-ebc8c44d8d0a',
    name: 'Natacha Jaillet',
    email: 'natacha.jaillet@novavisio.fr',
    role: 'Commerciale NovaVisio',
    agencyId: '0cd9362c-316e-4b57-af0b-b6cea092961b',
    phone: '06 30 31 00 65',
    avatar: 'NJ',
    avatarUrl: '/team/natacha_jaillet.png',
    status: 'Actif',
  },
  {
    id: '8786eb04-9c69-42dd-b691-6c38fcca6899',
    name: 'Eric Escourrou',
    email: 'escourroueric@conseilfinances.fr',
    role: 'Courtier Prêts & Financements',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 84 03 28 41',
    avatar: 'EE',
    avatarUrl: '/team/eric_escourrou.png',
    status: 'Actif',
  },
  {
    id: 'ecbc2f9d-5fa6-4017-b210-419354f45b92',
    name: 'Lucie Perree',
    email: 'lucie.perree@conseilfinances.fr',
    role: 'Courtière Prêts & Financements',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 69 58 77 15',
    avatar: 'LP',
    avatarUrl: '/team/lucie_perree.png',
    status: 'Actif',
  },
  {
    id: '78325b51-8161-4c9c-ac83-9bb65d6cad9d',
    name: 'Coralia Ortega',
    email: 'coralia.ortega@conseilfinances.fr',
    role: 'Mandataire de Courtage',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 01 93 71 39',
    avatar: 'CO',
    avatarUrl: '/team/coralia_ortega.png',
    status: 'Actif',
  },
  {
    id: 'bbd92360-bc40-4d41-9c16-fec3ac570dcb',
    name: 'Philippe Serra',
    email: 'p.serra@conseilfinances.fr',
    role: 'Gérant & Associé',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 50 88 25 92',
    avatar: 'PS',
    avatarUrl: '/team/philippe_serra.png',
    status: 'Actif',
  },
  {
    id: 'd62f8712-425e-4a32-b709-dc11fc8234d2',
    name: 'Muriel Goepfert',
    email: 'secretariat@conseilfinances.fr',
    role: 'Secrétariat Général',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 01 02 03 04',
    avatar: 'MG',
    avatarUrl: '/team/muriel_goepfert.png',
    status: 'Actif',
  },
  {
    id: '4e2a4ef6-6d50-44b3-8e8d-49bb72f0f6d5',
    name: 'Sarah Combres',
    email: 'combressarah725@gmail.com',
    role: 'Community Manager Immosphera',
    agencyId: '15157da9-71ea-4760-ae1c-3bc99d9caa20',
    phone: '06 99 01 77 02',
    avatar: 'SC',
    avatarUrl: '/team/sarah_combres.png',
    status: 'Actif',
  },
  {
    id: '1500b366-cc64-421b-9fe3-239150657e85',
    name: 'Adrien Wyrwal',
    email: 'wyrwaladrien22@gmail.com',
    role: 'Collaborateur',
    agencyId: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e',
    phone: '06 00 00 00 00',
    avatar: 'AW',
    avatarUrl: '/nova-mascotte.png',
    status: 'Actif',
  }
];

// Mapping for legacy IDs
const LEGACY_ID_MAP: Record<string, string> = {
  'tm-1': '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29',
  'tm-mg': '15bcec53-de3e-40b8-8b7e-bb6874836f29',
  'tm-ch': '878b36f3-1f8f-4206-af8b-3e4ade7a59fe',
  'tm-cg': '77273e9e-17f2-4dd8-b3c6-40f2845d557c',
  'tm-ig': '37840474-e0d6-4ef8-938f-abe46da641c7',
  'tm-kb': 'b6fc1112-3c61-44c1-ad45-20ba8e6cc070',
  'tm-lp': '3c6797de-456a-4988-8358-7e3d813e9474',
  'tm-ps': 'a1cc619f-c73d-4359-998c-5dd5254f6348',
  'tm-2': '4fdf3cf2-da17-4ca7-9e3b-ebc8c44d8d0a',
  'tm-4': '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29',
  'tm-6': '8786eb04-9c69-42dd-b691-6c38fcca6899',
  'tm-7': '4fdf3cf2-da17-4ca7-9e3b-ebc8c44d8d0a',
};

export function getAssignedUser(assignedTo?: string): TeamMember {
  if (!assignedTo) return TEAM_MEMBERS[0];
  const query = assignedTo.trim().toLowerCase();

  // If legacy ID
  if (LEGACY_ID_MAP[assignedTo]) {
    const targetUuid = LEGACY_ID_MAP[assignedTo];
    const found = TEAM_MEMBERS.find(m => m.id === targetUuid);
    if (found) return found;
  }

  // Exact ID match
  const matchId = TEAM_MEMBERS.find(m => m.id.toLowerCase() === query);
  if (matchId) return matchId;

  // Email match
  const matchEmail = TEAM_MEMBERS.find(m => m.email.toLowerCase() === query);
  if (matchEmail) return matchEmail;

  // Name match
  const matchName = TEAM_MEMBERS.find(m => m.name.toLowerCase() === query || m.name.toLowerCase().includes(query) || query.includes(m.name.toLowerCase()));
  if (matchName) return matchName;

  return TEAM_MEMBERS[0];
}

export function getAssignedUserIdAsUuid(assignedTo?: string | null): string | null {
  if (!assignedTo || typeof assignedTo !== 'string') return null;
  const trimmed = assignedTo.trim();
  if (isUuid(trimmed)) return trimmed;

  if (LEGACY_ID_MAP[trimmed]) {
    return LEGACY_ID_MAP[trimmed];
  }

  const member = getAssignedUser(trimmed);
  if (member && isUuid(member.id)) {
    return member.id;
  }

  return null;
}
