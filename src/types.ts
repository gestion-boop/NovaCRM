export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  agencyId: string;
  status: 'Nouveau' | 'Qualifié' | 'Proposition' | 'En Négociation' | 'Converti' | 'Perdu' | 'Froid' | 'Tiède' | 'Chaud';
  createdAt: string;
  ownerUserId?: string;
  ownerEmail?: string;
  sharedWithUserIds?: string[];
  revenus?: number;
  apport?: number;
  credits?: number;
  contractType?: string;
  projectType?: string;
  coBorrower?: string;
  comments?: string;
  assignedTo?: string;
  contactType?: string;
  clientType?: string;
  // Demandé le 2 septembre pour Novavisio : « quand on choisit Professionnel
  // juste en dessous, on puisse mettre l'identité du professionnel avec
  // l'adresse ; cette information doit être à la vue sur la fiche client
  // quand on est sur le panneau gestion des clients ». Stockées dans la
  // colonne JSON `leads.company`, déjà prévue pour ça.
  companyName?: string;
  companyAddress?: string;
  // Même colonne JSON `leads.company` : SIRET, fonction, code postal et
  // ville, pour que la fiche modifiée reprenne exactement ce que la création
  // propose (demande du 3 septembre : « les mêmes infos pour rectifier »).
  companySiret?: string;
  companyRole?: string;
  companyZip?: string;
  companyCity?: string;
  // « CA devis à venir » (Novavisio) : montant du devis envoyé, en attente de
  // signature. Colonne `leads.pending_quote_amount`.
  caDevisAVenir?: number;
  // Devis signé (leads.signed_at) : posé à l'archivage, ou dès qu'un dossier
  // Novavisio entre dans une étape « signé » (3 septembre). Reste vrai
  // ensuite, même dans le pipeline officiel.
  signedAt?: string | null;
  // « Récurrence » : ce qui revient ensuite sur ce client (abonnement,
  // prestation renouvelée). Colonne `leads.recurring_amount`.
  recurrence?: number;
  type?: string;
  budgetMax?: number;
  secteur?: string;
  typeBien?: string;
  pipeline?: string;
  statutLead?: string;
  // Renommé « Commission agence » dans l'interface ImmoSphera : c'est le
  // chiffre d'affaires que l'agence encaisse. Montants déjà saisis = HT.
  honoraires?: number;
  // Commission du conseiller immobilier, saisie TTC ; le HT est calculé à
  // l'affichage (voir htDepuisTtc dans lib/utils).
  advisorCommissionTtc?: number;
  mandateNumber?: string;
  notes?: string;
  archivedAt?: string | null;
  // Corbeille (3 septembre) : date de mise à la corbeille, null sinon.
  deletedAt?: string | null;
  // Demandé le 5 septembre (Conseils Finances). Honoraires courtier : calculé
  // automatiquement à partir de `honoraires` (Sylvain 100 %, Eric Escourrou
  // 80 %, tous les autres 70 %) — modifiable si besoin.
  honorairesCourtier?: number;
  // Montant du crédit du client, base du calcul de Com banques.
  montantCredit?: number;
  // Banque retenue pour le crédit : Caisse d'Épargne, Banque Populaire,
  // Banque postale ou Société Générale.
  banqueChoisie?: string;
  // Com banques : calculée automatiquement à partir de montantCredit et du
  // taux de banqueChoisie — modifiable.
  comBanque?: number;
  // Demandé le 6 septembre : « comBanque, c'est ce que perçoit la banque
  // [comprendre : l'agence] ; à côté, la part qu'en reçoit le courtier,
  // selon son pourcentage ». Calculée automatiquement à partir de comBanque
  // et du même taux courtier que honorairesCourtier — modifiable.
  comBanqueCourtier?: number;
  // Apporteur d'affaires (agent immobilier référent) pour un dossier
  // Conciergerie ImmoSphera (6 septembre) : `leads.referrer_id`, référence
  // vers `real_estate_referrers`. Liste gérée, pas de texte libre.
  referrerId?: string | null;
  // Lien Vendeur ↔ Acquéreur (ImmoSphera, Transactions V2, 7 septembre) :
  // « rattacher la fiche client acquéreur à la fiche client vendeur et
  // pouvoir naviguer entre les deux, pour éviter qu'il y ait trop de cases
  // contact dans la pipeline ». Facultatif — l'agent choisit de lier ou
  // non. `leads.linked_lead_id`, référence vers une autre fiche `leads`.
  // Affiché dans les deux sens (voir ClientProfileView) : posé sur la
  // fiche Acquéreur, il fait apparaître automatiquement l'Acquéreur sur la
  // fiche Vendeur visée (recherche inverse par linkedLeadId === mon id).
  linkedLeadId?: string | null;
}

export interface PipelineDef {
  id: string;
  name: string;
  stages: string[];
}

export interface Deal {
  id: string;
  title: string;
  // Commission de l'agence, stockée en HT (colonne `estimated_value`) —
  // avec repli sur le budget quand elle est vide (carte du pipeline).
  amount: number;
  // La même colonne `estimated_value`, SANS repli : vide si rien n'a été
  // saisi. Conseils Finances (5 septembre) : le chiffre d'affaires ne doit
  // compter que des honoraires agence réellement saisis, jamais un budget.
  commissionAgenceHt?: number;
  // Commission du conseiller, stockée en TTC ; affichée en HT dans les
  // colonnes du pipeline (voir htDepuisTtc).
  advisorCommissionTtc?: number;
  // Commission Banque du dossier (leads.com_banque) : ce que l'AGENCE
  // perçoit de la banque, en plus des honoraires — figure dans le chiffre
  // d'affaires de l'agence, pas directement dans celui d'un courtier (voir
  // comBanqueCourtier ci-dessous, sa part à lui).
  comBanque?: number;
  // Honoraires courtier (leads.honoraires_courtier, Conseils Finances) :
  // calculé automatiquement sur la fiche client à partir des honoraires
  // agence et du taux du courtier (Sylvain 100 %, Eric 80 %, autres 70 %),
  // modifiable à la main. C'est ce champ — pas advisorCommissionTtc — qui
  // alimente « Commission des courtiers » sur Conseils Finances.
  honorairesCourtier?: number;
  // Corrigé le 6 septembre : « il faut uniquement comptabiliser la
  // commission qu'on leur donne, plus la commission Banque qu'on leur donne
  // en fonction de leur pourcentage » — comBanque est ce que perçoit
  // l'agence ; comBanqueCourtier (leads.com_banque_courtier) est la part
  // qu'en reçoit le courtier, calculée avec le même taux que
  // honorairesCourtier. C'est ce champ — pas comBanque — qui alimente la
  // case « Commission Banque » de chaque courtier.
  comBanqueCourtier?: number;
  // Cases à cocher du tableau détaillé de chaque courtier (6 septembre) :
  // vert une fois pointé/reçu, orange tant que ce n'est pas fait. Quatre
  // lignes distinctes, chacune vérifiable séparément : la part de l'agence
  // (commission_agence_validee, com_banque_agence_validee) et celle du
  // courtier (commission_validee, com_banque_validee) — « pour être sûr de
  // tout vérifier correctement ».
  commissionValidee: boolean;
  comBanqueValidee: boolean;
  commissionAgenceValidee: boolean;
  comBanqueAgenceValidee: boolean;
  // Numéro de mandat (leads.mandate_number) — affiché dans le détail du
  // chiffre d'affaires pour retrouver le dossier d'un coup d'œil.
  mandateNumber?: string;
  // « CA devis à venir » (Novavisio) : montant du devis envoyé, en attente de
  // signature. Colonne `leads.pending_quote_amount`.
  caDevisAVenir?: number;
  // Devis signé (leads.signed_at) : posé à l'archivage, ou dès qu'un dossier
  // Novavisio entre dans une étape « signé » (3 septembre). Reste vrai
  // ensuite, même dans le pipeline officiel.
  signedAt?: string | null;
  // « Récurrence » : ce qui revient ensuite sur ce client.
  recurrence?: number;
  // Ticket #35 : « c'est le conseiller qui va mettre son affaire sur le
  // pipeline » — c'est donc lui qui porte le chiffre d'affaires personnel.
  // Colonne `assigned_to` de la table leads, avec repli sur `created_by`
  // pour les affaires anterieures a l'attribution.
  advisorId?: string;
  // Identifiant reel de l'etape (leads.stage_id). `stage` n'en est que le
  // NOM : deux pipelines peuvent avoir une etape du meme nom, et surtout un
  // dossier peut n'avoir aucun pipeline enregistre alors que son etape, elle,
  // sait a quel pipeline elle appartient.
  stageId?: string;
  stage: string;
  pipelineId?: string;
  agencyId: string;
  contactId: string;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string | null;
  // Corbeille (3 septembre) : date de mise à la corbeille, null sinon.
  deletedAt?: string | null;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string;
  agencyId: string;
  createdAt: string;
  priority?: 'Basse' | 'Moyenne' | 'Haute' | 'Urgent';
  type?: 'Appel' | 'Rendez-vous' | 'Relance' | 'Document' | 'Tâche';
  contactId?: string;
  contactOrigin?: string;

  createdBy?: string;
  assignedTo?: string;
}

export interface Agency {
  id: string;
  name: string;
  color: string; // Used for UI accent, now hex
  city: string;
  themeId?: string;
  homeBackgroundColor?: string;
}

export const AGENCIES: Agency[] = [
  { 
    id: '30f96ea9-41da-41c2-a95e-f5e7898f8d8e', 
    name: 'Conseils Finances', 
    color: '#d4a843', 
    city: 'Siège',
    themeId: 'graphite',
    homeBackgroundColor: '#d4a843'
  },
  { 
    id: '0cd9362c-316e-4b57-af0b-b6cea092961b', 
    name: 'Novavisio', 
    color: '#10b981', 
    city: 'Bureau',
    themeId: 'novasphere',
    homeBackgroundColor: '#10b981'
  },
  { 
    id: '15157da9-71ea-4760-ae1c-3bc99d9caa20', 
    name: 'Immosphera', 
    color: '#3b82f6', 
    city: 'Bureau',
    themeId: 'ocean',
    homeBackgroundColor: '#3b82f6'
  },
  {
    id: 'all',
    name: 'Toutes les sociétés',
    color: '#f7bc5f',
    city: 'Vue consolidée',
    themeId: 'graphite',
    homeBackgroundColor: '#f7bc5f'
  }
];

export interface HomeTile {
  id: string;
  title: string;
  iconName: string;
  gradient: string;
  badgeCount: number;
  navTarget: string;
  category?: string;
  isCustom?: boolean;
}

export interface InternalProject {
  id: string;
  title: string;
  description: string;
  // Correction : aligné sur InternalTaskStatus (InternalProjectBoard.tsx)
  // — même système de statuts/couleurs pour "Projet" (Pipeline interne) et
  // le tableau des tâches à l'intérieur d'un projet, jamais deux systèmes
  // différents.
  status: 'À faire' | 'En cours' | 'À vérifier' | 'Terminé';
  agencyId: string;
  deadline: string;
  assignedMember: string;
  progress: number;
}

// Ticket "Projets internes" (phase 1) : carte individuelle d'un tableau
// kanban à l'intérieur d'un projet (`InternalProject`/`task_boards`) — le
// projet lui-même garde son propre statut global (ci-dessus), les tâches
// en ont un séparé, propre au kanban (colonnes À faire/En cours/À
// vérifier/Terminé).
export type InternalTaskStatus = 'a_faire' | 'en_cours' | 'a_verifier' | 'termine';
export type InternalTaskPriority = 'basse' | 'normale' | 'haute' | 'urgente';

export interface InternalTask {
  id: string;
  boardId: string;
  agencyId: string;
  title: string;
  description?: string;
  priority: InternalTaskPriority;
  status: InternalTaskStatus;
  dueDate?: string | null;
  position: number;
  collaboratorIds: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatGroupMemberRole = 'admin' | 'owner' | 'member';

export interface ChatGroupMember {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: ChatGroupMemberRole;
  joinedAt: string;
}

export interface ChatGroup {
  id: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  createdBy: string;
  createdAt: string;
  parentId?: string; // If defined, this is a sub-group
  members: ChatGroupMember[];
  isSpecialGroup?: boolean; // e.g. "les 3 entités"
  inheritParentMembers?: boolean;
  agencyId?: string;
  sortOrder?: number;
  chatMode?: string;
}

export interface ChatMessageReaction {
  emoji: string;
  users: { id: string; name: string }[];
}

export interface ChatMessageReadBy {
  userId: string;
  userName: string;
  readAt: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  senderId?: string;
  senderAvatar?: string;
  message: string;
  timestamp: string;
  isMe: boolean;
  channel: string; // group or sub-group ID
  agencyId?: string;
  isEdited?: boolean;
  editHistory?: { message: string; editedAt: string }[];
  isDeleted?: boolean; // "Ce message a été supprimé"
  deletedForMe?: string[]; // Array of user IDs
  reactions?: ChatMessageReaction[];
  readBy?: ChatMessageReadBy[];
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  audioDuration?: number; // duration in seconds
  driveFileId?: string;
  driveFolderName?: string; // e.g., "Messages CRM / NovaVisio"
}

export interface MailItem {
  id: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  read: boolean;
  starred: boolean;
  folder: 'inbox' | 'sent' | 'drafts' | 'archive';
  agencyId?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  agencyId: string;
  phone: string;
  avatar: string;
  avatarUrl?: string;
  status: 'Actif' | 'En conge' | 'Absent';
}

export interface DocItem {
  id: string;
  name: string;
  category: string;
  size: string;
  updatedAt: string;
  uploadedBy: string;
  url?: string;
  agencyId?: string;

  contactId?: string;
  contactName?: string;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  category: string;
  updatedAt: string;
  color?: string;
  agencyId?: string;
  contactId?: string;
  contactName?: string;
  isPinned?: boolean;
  order?: number;

  createdBy?: string;
  authorEmail?: string;
}

// Valeurs alignées sur les enums réels côté Supabase (support_priority,
// support_status, support_category) — voir SupportView.tsx pour le mapping
// affiché à l'utilisateur (ex. "Mineur/Important/Majeur" → basse/normale/urgente).
export type SupportPriority = 'basse' | 'normale' | 'haute' | 'urgente';
export type SupportStatus = 'ouvert' | 'en_cours' | 'ferme';
export type SupportCategory = 'technique' | 'fonctionnalite' | 'bug' | 'autre';

export interface SupportTicket {
  id: string;
  agencyId: string;
  createdBy: string;
  createdByName?: string;
  assignedTo?: string | null;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  title: string;
  description: string;
  attachments: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  // Corbeille (3 septembre) : date de mise à la corbeille, null sinon.
  deletedAt?: string | null;
}

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  body: string;
  attachments: string[];
  createdAt: string;
}

export interface CameraReservation {
  id: string;
  equipmentName: string;
  agentName: string;
  propertyAddress: string;
  startDate: string;
  endDate: string;
  status: 'Confirmée' | 'En attente' | 'Terminée' | 'Refusée';

  mandateNumber?: string;
  projectName?: string;
  note?: string;
  equipmentList?: string[];
  startTime?: string;
  endTime?: string;
  location?: string;

  agencyId?: string;
  createdByUserId?: string;
  createdByEmail?: string;
  createdAt?: string;
}

// Onglet Comptabilité (6 septembre, Conseils Finances) : « un vrai logiciel
// de comptabilité pour piloter ce qui va rentrer aussi, et avoir une vue sur
// le long terme ». Une ligne = un poste récurrent (loyer, assurance,
// abonnement, commission mensuelle...) ou ponctuel (une seule fois), positif
// pour une recette/encaissement, négatif pour une dépense/décaissement.
export interface TreasuryLine {
  id: string;
  agencyId: string;
  label: string;
  category: string;
  kind: 'recurrent' | 'ponctuel';
  // Signé : négatif = dépense, positif = recette.
  amount: number;
  // Pour un ponctuel : le mois exact où il tombe (1er du mois, ISO).
  // Pour un récurrent : le premier mois de la récurrence.
  month: string;
  // Récurrent uniquement : dernier mois où la ligne s'applique (incluse).
  // Vide = récurrence projetée indéfiniment.
  endMonth?: string | null;
  // Jour du mois où le prélèvement/virement tombe réellement (1-31),
  // optionnel — sans quoi la matérialisation automatique retombe sur le 1er
  // du mois (voir ComptabiliteView). Demandé le 6 septembre : « la date
  // n'est pas bonne car ça se prélève tous les 10 de chaque mois ».
  jourPrelevement?: number | null;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}