export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  agencyId: string;
  status: 'Nouveau' | 'Qualifié' | 'Proposition' | 'En Négociation' | 'Converti' | 'Perdu' | 'Froid' | 'Tiède' | 'Chaud';
  createdAt: string;
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
  budgetMax?: number;
  secteur?: string;
  typeBien?: string;
  pipeline?: string;
  statutLead?: string;
  honoraires?: number;
}

export interface Deal {
  id: string;
  title: string;
  amount: number;
  stage: 'To-Do List' | 'Prise de contact' | 'Montage bancaire' | 'En Banque' | 'Att Retour Caution' | 'Accord banque / Rendez-vous' | 'Attente édition des offres' | 'Décompte / Rendez-vous notaire' | 'Dossier facture' | 'Prospection' | 'Qualification' | 'Proposition' | 'Négociation' | 'Gagné' | 'Perdu';
  agencyId: string;
  contactId: string;
  createdAt: string;
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
    color: '#e5b842',
    city: 'Vue consolidée',
    themeId: 'graphite',
    homeBackgroundColor: '#e5b842'
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
  status: 'À faire' | 'En cours' | 'Terminé';
  agencyId: string;
  deadline: string;
  assignedMember: string;
  progress: number;
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
}

export interface SupportTicket {
  id: string;
  subject: string;
  clientName: string;
  priority: 'Basse' | 'Moyenne' | 'Urgent';
  status: 'Ouvert' | 'En cours' | 'Résolu';
  createdAt: string;
  description: string;
}

export interface CameraReservation {
  id: string;
  equipmentName: string;
  agentName: string;
  propertyAddress: string;
  startDate: string;
  endDate: string;
  status: 'Confirmée' | 'En attente' | 'Terminée';
}

