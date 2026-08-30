export interface TransferredCalendarEvent {
  id: string;
  agencyId: string;
  leadId?: string;
  userId: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  location?: string;
  createdAt: string;
  type: 'rdv' | 'task';
  gcalEventId?: string;
  source: string;
  isDone: boolean;
}

export interface SupabaseProjectConfig {
  id: number;
  projectUrl: string;
}

export interface ChannelMemberLastRead {
  userId: string;
  channelId: string;
  lastReadAt: string;
}

export interface AnnouncementRead {
  announcementId: string;
  userId: string;
  readAt: string;
}

/**
 * Configuration publique Supabase transférée.
 *
 * IMPORTANT :
 * Aucun token privé ou secret ne doit être stocké dans le frontend.
 * Les clés sensibles devront être utilisées uniquement côté serveur.
 */
export const SUPABASE_CONFIG_TRANSFERRED: SupabaseProjectConfig = {
  id: 1,
  projectUrl: 'https://nuegrgmdvykzgxpqgckc.supabase.co',
};

export const TRANSFERRED_CALENDAR_EVENTS: TransferredCalendarEvent[] = [];