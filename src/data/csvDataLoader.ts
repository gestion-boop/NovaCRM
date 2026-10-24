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
  internalToken: string;
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

export const SUPABASE_CONFIG_TRANSFERRED: SupabaseProjectConfig = {
  id: 1,
  projectUrl: 'https://nuegrgmdvykzgxpqgckc.supabase.co',
  internalToken: '0ba5d666f76e1f9216d62158b80fc615d36a2ed84e48176e088578a2ef1f579a'
};

export const TRANSFERRED_CALENDAR_EVENTS: TransferredCalendarEvent[] = [];
