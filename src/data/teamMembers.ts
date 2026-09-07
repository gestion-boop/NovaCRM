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

// ⚠️ IDENTIFIANTS SYNCHRONISÉS AVEC LES VRAIS COMPTES le 31/08/2026.
//
// Huit personnes portaient ici un identifiant qui ne correspondait à AUCUN
// compte — vestige d'une base précédente. Les conséquences étaient partout :
//   • le chat direct écrivait à des destinataires fantômes (143 rattachements
//     sur 237 pointaient dans le vide, le message n'arrivait jamais) ;
//   • les avatars et initiales ne se résolvaient plus (recherche par `id`) ;
//   • l'attribution d'un contact échouait sur la clé étrangère vers profiles.
//
// Les identifiants ci-dessous sont désormais ceux de `public.profiles`,
// retrouvés par adresse e-mail. Cinq personnes (Eric Escourrou, Lucie Perree,
// Coralia Ortega, Muriel Goepfert, Adrien Wyrwal) n'ont toujours aucun compte :
// leur identifiant reste fictif tant qu'elles ne sont pas activées.
//
// RÈGLE : ne jamais rechercher quelqu'un dans ce fichier par `id`. Toujours
// par ADRESSE E-MAIL, et ne s'en servir que pour l'habillage (photo, intitulé
// de poste). La source de vérité des personnes est la table `profiles`.

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
    id: '41d1f830-1605-4fc4-9362-a38c87b94574',
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
    id: 'de2cb2d6-8280-4db3-b161-f6a58f57a9e5',
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
    id: 'fd611b54-fced-4c6f-bc27-35dbe1d9cc89',
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
    id: '59362ce3-b580-44c8-bf92-b8dd3294e5ea',
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
    id: '448bf1fe-a459-4064-b631-72a3d85ad79e',
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
    id: 'f5c70ff8-66f9-418c-94f5-47c95b3b9cd1',
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
  // Philippe Serra (Conseils Finances) retiré de l'équipe le 7 septembre :
  // « il est dans Novavisio, on le garde que pour les stats dans Conseils
  // Finances ». Son compte CF (profiles e673a796…) et son agency_members
  // CF ont été retirés côté base — ses dossiers déjà attribués restent
  // comptés dans les stats CF (via leads.agency_id/assigned_to, indépendant
  // de cette liste et de agency_members), mais il n'apparaît plus dans
  // l'annuaire Équipe ni dans les listes d'attribution. Son vrai compte
  // reste celui de Novavisio (voir plus bas dans ce fichier si présent, ou
  // profiles 6db20980-c0a1-4c18-a7ce-23e0f5d39916).
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
    id: '3fd7bce8-cdd5-471c-96df-67c10a55d4b6',
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
  'tm-ch': '41d1f830-1605-4fc4-9362-a38c87b94574',
  'tm-cg': 'de2cb2d6-8280-4db3-b161-f6a58f57a9e5',
  'tm-ig': '37840474-e0d6-4ef8-938f-abe46da641c7',
  'tm-kb': 'fd611b54-fced-4c6f-bc27-35dbe1d9cc89',
  'tm-lp': '59362ce3-b580-44c8-bf92-b8dd3294e5ea',
  'tm-ps': '448bf1fe-a459-4064-b631-72a3d85ad79e',
  'tm-2': 'f5c70ff8-66f9-418c-94f5-47c95b3b9cd1',
  'tm-4': '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29',
  'tm-6': '8786eb04-9c69-42dd-b691-6c38fcca6899',
  'tm-7': 'f5c70ff8-66f9-418c-94f5-47c95b3b9cd1',
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
