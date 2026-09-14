export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agencies: {
        Row: {
          accent_color: string
          created_at: string
          drive_folder_id: string | null
          id: string
          name: string
          slug: string
          storage_provider: string
        }
        Insert: {
          accent_color?: string
          created_at?: string
          drive_folder_id?: string | null
          id?: string
          name: string
          slug: string
          storage_provider?: string
        }
        Update: {
          accent_color?: string
          created_at?: string
          drive_folder_id?: string | null
          id?: string
          name?: string
          slug?: string
          storage_provider?: string
        }
        Relationships: []
      }
      agency_drive_tokens: {
        Row: {
          access_token: string
          agency_id: string
          connected_by: string | null
          created_at: string
          expires_at: string
          google_email: string | null
          id: string
          refresh_token: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          agency_id: string
          connected_by?: string | null
          created_at?: string
          expires_at: string
          google_email?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          agency_id?: string
          connected_by?: string | null
          created_at?: string
          expires_at?: string
          google_email?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agency_invitations: {
        Row: {
          accepted_at: string | null
          agency_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          agency_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          agency_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_invitations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_members: {
        Row: {
          agency_id: string
          created_at: string
          email_override: string | null
          id: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          email_override?: string | null
          id?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          email_override?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_members_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_ui_settings: {
        Row: {
          agency_id: string
          agenda_layout: Json
          chat_layout: Json
          created_at: string
          home_background_color: string | null
          home_background_opacity: number
          home_background_url: string | null
          home_layout: Json
          id: string
          theme_id: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          agenda_layout?: Json
          chat_layout?: Json
          created_at?: string
          home_background_color?: string | null
          home_background_opacity?: number
          home_background_url?: string | null
          home_layout?: Json
          id?: string
          theme_id?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          agenda_layout?: Json
          chat_layout?: Json
          created_at?: string
          home_background_color?: string | null
          home_background_opacity?: number
          home_background_url?: string | null
          home_layout?: Json
          id?: string
          theme_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_ui_settings_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_assistant_access: {
        Row: {
          granted_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      allowed_email_domains: {
        Row: {
          agency_id: string
          created_at: string
          domain: string
          id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          domain: string
          id?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          domain?: string
          id?: string
        }
        Relationships: []
      }
      announcement_agencies: {
        Row: {
          agency_id: string
          announcement_id: string
        }
        Insert: {
          agency_id: string
          announcement_id: string
        }
        Update: {
          agency_id?: string
          announcement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_agencies_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_agencies_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          message: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          message: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          message?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: number
          internal_token: string
          project_url: string
        }
        Insert: {
          id?: number
          internal_token: string
          project_url: string
        }
        Update: {
          id?: number
          internal_token?: string
          project_url?: string
        }
        Relationships: []
      }
      app_versions: {
        Row: {
          current_version: string | null
          id: number
          last_notified_at: string | null
          last_notified_version: string | null
          updated_at: string
        }
        Insert: {
          current_version?: string | null
          id?: number
          last_notified_at?: string | null
          last_notified_version?: string | null
          updated_at?: string
        }
        Update: {
          current_version?: string | null
          id?: number
          last_notified_at?: string | null
          last_notified_version?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          agency_id: string
          created_at: string
          description: string | null
          end_at: string
          gcal_etag: string | null
          gcal_event_id: string | null
          id: string
          is_done: boolean
          last_synced_at: string | null
          lead_id: string | null
          location: string | null
          source: string
          start_at: string
          sync_error: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          description?: string | null
          end_at: string
          gcal_etag?: string | null
          gcal_event_id?: string | null
          id?: string
          is_done?: boolean
          last_synced_at?: string | null
          lead_id?: string | null
          location?: string | null
          source?: string
          start_at: string
          sync_error?: string | null
          title: string
          type?: string
          user_id?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          description?: string | null
          end_at?: string
          gcal_etag?: string | null
          gcal_event_id?: string | null
          id?: string
          is_done?: boolean
          last_synced_at?: string | null
          lead_id?: string | null
          location?: string | null
          source?: string
          start_at?: string
          sync_error?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "assistant_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_threads: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      camera_reservations: {
        Row: {
          agency_id: string
          created_at: string
          description: string | null
          end_at: string
          gcal_etag: string | null
          gcal_event_id: string | null
          id: string
          last_synced_at: string | null
          refusal_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          start_at: string
          status: string
          sync_error: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          description?: string | null
          end_at: string
          gcal_etag?: string | null
          gcal_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          refusal_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          start_at: string
          status?: string
          sync_error?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          description?: string | null
          end_at?: string
          gcal_etag?: string | null
          gcal_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          refusal_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          start_at?: string
          status?: string
          sync_error?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "camera_reservations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_reads: {
        Row: {
          channel_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_reads_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          last_message_at: string | null
          name: string
          position: number
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_message_at?: string | null
          name: string
          position?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          last_message_at?: string | null
          name?: string
          position?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "chat_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_project_members: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "chat_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_project_user_positions: {
        Row: {
          position: number
          project_id: string
          user_id: string
        }
        Insert: {
          position?: number
          project_id: string
          user_id: string
        }
        Update: {
          position?: number
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_project_user_positions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "chat_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_projects: {
        Row: {
          agency_id: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_projects_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_shares: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          shared_by: string
          shared_with: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          shared_by: string
          shared_with: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          shared_by?: string
          shared_with?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          body: string
          created_at: string
          folder_id: string | null
          id: string
          is_pinned: boolean
          is_shared: boolean
          lead_id: string
          position: number
          sort_order: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          folder_id?: string | null
          id?: string
          is_pinned?: boolean
          is_shared?: boolean
          lead_id: string
          position?: number
          sort_order?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          folder_id?: string | null
          id?: string
          is_pinned?: boolean
          is_shared?: boolean
          lead_id?: string
          position?: number
          sort_order?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "note_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      confidential_questionnaires: {
        Row: {
          agency_id: string
          consent_status: string | null
          created_at: string
          created_by: string
          data: Json | null
          expires_at: string
          id: string
          kind: string
          lead_id: string
          sent_to_email: string
          signed_at: string | null
          snapshot: Json | null
          submitted_at: string | null
          token: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          agency_id: string
          consent_status?: string | null
          created_at?: string
          created_by: string
          data?: Json | null
          expires_at?: string
          id?: string
          kind?: string
          lead_id: string
          sent_to_email: string
          signed_at?: string | null
          snapshot?: Json | null
          submitted_at?: string | null
          token: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          agency_id?: string
          consent_status?: string | null
          created_at?: string
          created_by?: string
          data?: Json | null
          expires_at?: string
          id?: string
          kind?: string
          lead_id?: string
          sent_to_email?: string
          signed_at?: string | null
          snapshot?: Json | null
          submitted_at?: string | null
          token?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confidential_questionnaires_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confidential_questionnaires_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agency_id: string | null
          created_at: string
          created_by: string
          id: string
          last_message_at: string | null
          title: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          last_message_at?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_summaries: {
        Row: {
          agency_id: string | null
          content: string
          created_at: string
          id: string
          summary_date: string
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          content: string
          created_at?: string
          id?: string
          summary_date: string
          user_id: string
        }
        Update: {
          agency_id?: string | null
          content?: string
          created_at?: string
          id?: string
          summary_date?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          agency_id: string
          created_at: string
          drive_file_id: string | null
          drive_web_view_link: string | null
          file_name: string
          id: string
          is_folder: boolean
          is_shared: boolean
          lead_id: string | null
          mime_type: string | null
          parent_drive_folder_id: string | null
          parent_id: string | null
          size_bytes: number | null
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          drive_file_id?: string | null
          drive_web_view_link?: string | null
          file_name: string
          id?: string
          is_folder?: boolean
          is_shared?: boolean
          lead_id?: string | null
          mime_type?: string | null
          parent_drive_folder_id?: string | null
          parent_id?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          drive_file_id?: string | null
          drive_web_view_link?: string | null
          file_name?: string
          id?: string
          is_folder?: boolean
          is_shared?: boolean
          lead_id?: string | null
          mime_type?: string | null
          parent_drive_folder_id?: string | null
          parent_id?: string | null
          size_bytes?: number | null
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      entity_reads: {
        Row: {
          entity_id: string
          entity_type: string
          read_at: string
          user_id: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          read_at?: string
          user_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      home_tiles: {
        Row: {
          agency_id: string
          bg_image: string | null
          children: Json
          color: string
          created_at: string
          custom: boolean
          hidden: boolean
          icon: string
          id: string
          image_url: string | null
          is_folder: boolean
          key: string
          label: string
          logo_path: string | null
          position: number
          to_path: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          agency_id: string
          bg_image?: string | null
          children?: Json
          color?: string
          created_at?: string
          custom?: boolean
          hidden?: boolean
          icon?: string
          id?: string
          image_url?: string | null
          is_folder?: boolean
          key: string
          label: string
          logo_path?: string | null
          position?: number
          to_path?: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          agency_id?: string
          bg_image?: string | null
          children?: Json
          color?: string
          created_at?: string
          custom?: boolean
          hidden?: boolean
          icon?: string
          id?: string
          image_url?: string | null
          is_folder?: boolean
          key?: string
          label?: string
          logo_path?: string | null
          position?: number
          to_path?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_tiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      immosphera_partners: {
        Row: {
          category: Database["public"]["Enums"]["immosphera_partner_category"]
          company: string | null
          created_at: string
          created_by: string | null
          email: string | null
          first_name: string
          id: string
          intervention_area: string | null
          last_name: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          phone: string | null
          updated_at: string
          // Site internet + documents (carte de visite, photos...) — voir
          // ticket "Partenaires : site internet + documents en carrousel".
          // Nécessite la migration SQL fournie à l'utilisateur (colonnes pas
          // encore créées en base au moment de cet ajout côté code).
          website: string | null
          documents: Json
        }
        Insert: {
          category?: Database["public"]["Enums"]["immosphera_partner_category"]
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name: string
          id?: string
          intervention_area?: string | null
          last_name: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
          documents?: Json
        }
        Update: {
          category?: Database["public"]["Enums"]["immosphera_partner_category"]
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name?: string
          id?: string
          intervention_area?: string | null
          last_name?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
          documents?: Json
        }
        Relationships: []
      }
      immosphera_price_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_price: number | null
          old_price: number | null
          property_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_price?: number | null
          old_price?: number | null
          property_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_price?: number | null
          old_price?: number | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "immosphera_price_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "immosphera_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      immosphera_propals: {
        Row: {
          created_at: string
          id: string
          note: string | null
          property_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          property_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          property_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      immosphera_properties: {
        Row: {
          address: string
          agent_email: string | null
          agent_name: string | null
          agent_phone: string | null
          agent_photo: string | null
          bedrooms: number | null
          created_at: string
          created_by: string | null
          description: string | null
          giraffe_url: string | null
          id: string
          image_key: string | null
          images: string[] | null
          latitude: number | null
          listed_at: string | null
          listing_type: string
          listing_url: string | null
          location: string | null
          longitude: number | null
          mandate_number: string | null
          price: number | null
          property_type: Database["public"]["Enums"]["immosphera_property_type"]
          rooms: number | null
          status: string
          surface_area: number | null
          tech_details: Json | null
          title: string
          updated_at: string
          virtual_tour_url: string | null
          vr_headset_available: boolean
        }
        Insert: {
          address: string
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          agent_photo?: string | null
          bedrooms?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          giraffe_url?: string | null
          id?: string
          image_key?: string | null
          images?: string[] | null
          latitude?: number | null
          listed_at?: string | null
          listing_type?: string
          listing_url?: string | null
          location?: string | null
          longitude?: number | null
          mandate_number?: string | null
          price?: number | null
          property_type?: Database["public"]["Enums"]["immosphera_property_type"]
          rooms?: number | null
          status?: string
          surface_area?: number | null
          tech_details?: Json | null
          title: string
          updated_at?: string
          virtual_tour_url?: string | null
          vr_headset_available?: boolean
        }
        Update: {
          address?: string
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          agent_photo?: string | null
          bedrooms?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          giraffe_url?: string | null
          id?: string
          image_key?: string | null
          images?: string[] | null
          latitude?: number | null
          listed_at?: string | null
          listing_type?: string
          listing_url?: string | null
          location?: string | null
          longitude?: number | null
          mandate_number?: string | null
          price?: number | null
          property_type?: Database["public"]["Enums"]["immosphera_property_type"]
          rooms?: number | null
          status?: string
          surface_area?: number | null
          tech_details?: Json | null
          title?: string
          updated_at?: string
          virtual_tour_url?: string | null
          vr_headset_available?: boolean
        }
        Relationships: []
      }
      immosphera_share_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          property_id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          property_id: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          property_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "immosphera_share_tokens_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "immosphera_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      immosphera_tour_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          property_id: string
          token: string
          tour_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          property_id: string
          token?: string
          tour_type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          property_id?: string
          token?: string
          tour_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "immosphera_tour_tokens_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "immosphera_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_task_activity: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          task_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          task_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          task_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "internal_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_task_assignees: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          task_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          task_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "internal_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_task_checklist: {
        Row: {
          created_at: string
          created_by: string
          done_at: string | null
          done_by: string | null
          id: string
          is_done: boolean
          label: string
          position: number
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          label: string
          position?: number
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          done_at?: string | null
          done_by?: string | null
          id?: string
          is_done?: boolean
          label?: string
          position?: number
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_task_checklist_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "internal_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_task_message_reads: {
        Row: {
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_task_message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "internal_task_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_task_messages: {
        Row: {
          attachment_name: string | null
          attachment_size: number | null
          attachment_type: string | null
          attachment_url: string | null
          body: string
          created_at: string
          id: string
          kind: string
          task_id: string
          user_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          body: string
          created_at?: string
          id?: string
          kind?: string
          task_id: string
          user_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_task_messages_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "internal_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_tasks: {
        Row: {
          agency_id: string
          board_id: string
          column_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          id: string
          position: number
          priority: string
          title: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          board_id: string
          column_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          id?: string
          position?: number
          priority?: string
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          board_id?: string
          column_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          position?: number
          priority?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_tasks_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_tasks_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "task_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_tasks_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "task_board_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_checklists: {
        Row: {
          agency_id: string
          checklist_type: string
          created_at: string
          created_by: string | null
          id: string
          is_copropriete: boolean
          items: Json
          lead_id: string
          pipeline_id: string | null
          seller_type: string
          stage_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_id: string
          checklist_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_copropriete?: boolean
          items?: Json
          lead_id: string
          pipeline_id?: string | null
          seller_type?: string
          stage_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_id?: string
          checklist_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_copropriete?: boolean
          items?: Json
          lead_id?: string
          pipeline_id?: string | null
          seller_type?: string
          stage_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_checklists_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_checklists_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_checklists_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_checklists_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_conversations: {
        Row: {
          conversation_id: string
          created_at: string
          lead_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          lead_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          agency_id: string
          archived_at: string | null
          assigned_to: string | null
          budget: number | null
          comments: string | null
          company: Json | null
          contact_type: string | null
          created_at: string
          created_by: string | null
          email: string | null
          estimated_value: number | null
          first_name: string | null
          full_name: string
          geocoded_at: string | null
          id: string
          last_name: string | null
          latitude: number | null
          lead_type: string | null
          longitude: number | null
          master_contact_id: string | null
          notes: string | null
          phone: string | null
          pipeline_id: string | null
          pipeline_position: number | null
          property_type: string | null
          secondary_contact: Json | null
          sector: string | null
          source: string | null
          stage_id: string | null
          temperature: Database["public"]["Enums"]["lead_temperature"]
          updated_at: string
        }
        Insert: {
          agency_id: string
          archived_at?: string | null
          assigned_to?: string | null
          budget?: number | null
          comments?: string | null
          company?: Json | null
          contact_type?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          estimated_value?: number | null
          first_name?: string | null
          full_name: string
          geocoded_at?: string | null
          id?: string
          last_name?: string | null
          latitude?: number | null
          lead_type?: string | null
          longitude?: number | null
          master_contact_id?: string | null
          notes?: string | null
          phone?: string | null
          pipeline_id?: string | null
          pipeline_position?: number | null
          property_type?: string | null
          secondary_contact?: Json | null
          sector?: string | null
          source?: string | null
          stage_id?: string | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          updated_at?: string
        }
        Update: {
          agency_id?: string
          archived_at?: string | null
          assigned_to?: string | null
          budget?: number | null
          comments?: string | null
          company?: Json | null
          contact_type?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          estimated_value?: number | null
          first_name?: string | null
          full_name?: string
          geocoded_at?: string | null
          id?: string
          last_name?: string | null
          latitude?: number | null
          lead_type?: string | null
          longitude?: number | null
          master_contact_id?: string | null
          notes?: string | null
          phone?: string | null
          pipeline_id?: string | null
          pipeline_position?: number | null
          property_type?: string | null
          secondary_contact?: Json | null
          sector?: string | null
          source?: string | null
          stage_id?: string | null
          temperature?: Database["public"]["Enums"]["lead_temperature"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_master_contact_id_fkey"
            columns: ["master_contact_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      limova_settings: {
        Row: {
          auth_mode: string
          base_url: string
          chat_endpoint: string
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auth_mode?: string
          base_url?: string
          chat_endpoint?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auth_mode?: string
          base_url?: string
          chat_endpoint?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      lodgify_booking_notes: {
        Row: {
          agency_id: string
          beds: number | null
          booking_id: string
          checklist: Json
          created_at: string
          created_by: string | null
          id: string
          note_text: string
          persons_count: number | null
          updated_at: string
        }
        Insert: {
          agency_id: string
          beds?: number | null
          booking_id: string
          checklist?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          note_text?: string
          persons_count?: number | null
          updated_at?: string
        }
        Update: {
          agency_id?: string
          beds?: number | null
          booking_id?: string
          checklist?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          note_text?: string
          persons_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lodgify_booking_notes_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      lodgify_user_access: {
        Row: {
          agency_id: string
          created_at: string
          granted_by: string | null
          id: string
          property_ids: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          property_ids?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          property_ids?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lodgify_user_access_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lodgify_user_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lodgify_user_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_receipts: {
        Row: {
          created_at: string
          delivered_at: string | null
          message_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          message_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          message_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_duration: number | null
          attachment_mime: string | null
          attachment_url: string | null
          body: string | null
          channel_id: string | null
          conversation_id: string | null
          created_at: string
          edited_at: string | null
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          user_id: string
        }
        Insert: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_url?: string | null
          body?: string | null
          channel_id?: string | null
          conversation_id?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          user_id: string
        }
        Update: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_url?: string | null
          body?: string | null
          channel_id?: string | null
          conversation_id?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_goals: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          month: number
          target_amount: number
          user_id: string | null
          year: number
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          month: number
          target_amount?: number
          user_id?: string | null
          year: number
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          month?: number
          target_amount?: number
          user_id?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_goals_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      note_folders: {
        Row: {
          agency_id: string
          color: string | null
          created_at: string
          id: string
          name: string
          parent_id: string | null
          scope: string
          scope_ref: string | null
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          color?: string | null
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          scope: string
          scope_ref?: string | null
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          scope?: string
          scope_ref?: string | null
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "note_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      note_mentions: {
        Row: {
          created_at: string
          id: string
          mentioned_user_id: string
          note_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentioned_user_id: string
          note_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mentioned_user_id?: string
          note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_mentions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          agency_id: string
          audio_duration: number | null
          audio_mime: string | null
          audio_url: string | null
          body: string | null
          created_at: string
          folder_id: string | null
          id: string
          is_pinned: boolean
          sort_order: number | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          audio_duration?: number | null
          audio_mime?: string | null
          audio_url?: string | null
          body?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          is_pinned?: boolean
          sort_order?: number | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          audio_duration?: number | null
          audio_mime?: string | null
          audio_url?: string | null
          body?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          is_pinned?: boolean
          sort_order?: number | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "note_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agency_id: string | null
          body: string | null
          created_at: string
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          link: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          agency_id?: string | null
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          link?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          agency_id: string
          color: string
          created_at: string
          id: string
          name: string
          pipeline_id: string | null
          position: number
        }
        Insert: {
          agency_id: string
          color?: string
          created_at?: string
          id?: string
          name: string
          pipeline_id?: string | null
          position?: number
        }
        Update: {
          agency_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          pipeline_id?: string | null
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_todos: {
        Row: {
          agency_id: string
          body: string
          created_at: string
          id: string
          is_done: boolean
          pipeline_id: string | null
          position: number
          stage_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          body: string
          created_at?: string
          id?: string
          is_done?: boolean
          pipeline_id?: string | null
          position?: number
          stage_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          body?: string
          created_at?: string
          id?: string
          is_done?: boolean
          pipeline_id?: string | null
          position?: number
          stage_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pipelines: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          owner_id: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          owner_id?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          business_card_url: string | null
          business_cards: Json
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          is_validated: boolean
          job_title: string | null
          phone: string | null
          push_daily_reminders: boolean
          rc_pro_insurance: string | null
          rsac_number: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          business_card_url?: string | null
          business_cards?: Json
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          is_validated?: boolean
          job_title?: string | null
          phone?: string | null
          push_daily_reminders?: boolean
          rc_pro_insurance?: string | null
          rsac_number?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          business_card_url?: string | null
          business_cards?: Json
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_validated?: boolean
          job_title?: string | null
          phone?: string | null
          push_daily_reminders?: boolean
          rc_pro_insurance?: string | null
          rsac_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          agency_id: string
          assigned_to: string | null
          created_at: string
          description: string | null
          due_at: string
          id: string
          is_done: boolean
          label: string | null
          lead_id: string | null
          notified_at: string | null
          priority: Database["public"]["Enums"]["reminder_priority"]
          title: string
          user_id: string | null
        }
        Insert: {
          agency_id: string
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_at: string
          id?: string
          is_done?: boolean
          label?: string | null
          lead_id?: string | null
          notified_at?: string | null
          priority?: Database["public"]["Enums"]["reminder_priority"]
          title: string
          user_id?: string | null
        }
        Update: {
          agency_id?: string
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          due_at?: string
          id?: string
          is_done?: boolean
          label?: string | null
          lead_id?: string | null
          notified_at?: string | null
          priority?: Database["public"]["Enums"]["reminder_priority"]
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_entries: {
        Row: {
          agency_id: string
          amount: number
          created_at: string
          description: string | null
          earned_at: string
          id: string
          lead_id: string | null
          user_id: string | null
        }
        Insert: {
          agency_id: string
          amount: number
          created_at?: string
          description?: string | null
          earned_at?: string
          id?: string
          lead_id?: string | null
          user_id?: string | null
        }
        Update: {
          agency_id?: string
          amount?: number
          created_at?: string
          description?: string | null
          earned_at?: string
          id?: string
          lead_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_entries_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          body: string
          channel_id: string | null
          conversation_id: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          scheduled_at: string
          sent_at: string | null
          sent_message_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          channel_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          scheduled_at: string
          sent_at?: string | null
          sent_message_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          channel_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          scheduled_at?: string
          sent_at?: string | null
          sent_message_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_ticket_comments: {
        Row: {
          attachments: Json
          body: string | null
          created_at: string
          id: string
          is_system: boolean
          ticket_id: string
          user_id: string
        }
        Insert: {
          attachments?: Json
          body?: string | null
          created_at?: string
          id?: string
          is_system?: boolean
          ticket_id: string
          user_id: string
        }
        Update: {
          attachments?: Json
          body?: string | null
          created_at?: string
          id?: string
          is_system?: boolean
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          agency_id: string | null
          assigned_to: string | null
          attachments: Json
          category: Database["public"]["Enums"]["support_category"]
          created_at: string
          created_by: string
          description: string | null
          id: string
          priority: Database["public"]["Enums"]["support_priority"]
          status: Database["public"]["Enums"]["support_status"]
          title: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          assigned_to?: string | null
          attachments?: Json
          category: Database["public"]["Enums"]["support_category"]
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["support_priority"]
          status?: Database["public"]["Enums"]["support_status"]
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          assigned_to?: string | null
          attachments?: Json
          category?: Database["public"]["Enums"]["support_category"]
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["support_priority"]
          status?: Database["public"]["Enums"]["support_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      task_board_columns: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          name: string
          position: number
        }
        Insert: {
          board_id: string
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_board_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "task_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      task_boards: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_boards_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dismissed_items: {
        Row: {
          dismissed_at: string
          id: string
          item_id: string
          item_type: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          id?: string
          item_id: string
          item_type: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          id?: string
          item_id?: string
          item_type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_event_templates: {
        Row: {
          rdv_titles: Json
          task_titles: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          rdv_titles?: Json
          task_titles?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          rdv_titles?: Json
          task_titles?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_google_tokens: {
        Row: {
          access_token: string
          calendar_last_pull_at: string | null
          calendar_sync_token: string | null
          created_at: string
          expires_at: string
          google_email: string | null
          refresh_token: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_last_pull_at?: string | null
          calendar_sync_token?: string | null
          created_at?: string
          expires_at: string
          google_email?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_last_pull_at?: string | null
          calendar_sync_token?: string | null
          created_at?: string
          expires_at?: string
          google_email?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_pipeline_hidden: {
        Row: {
          created_at: string
          pipeline_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          pipeline_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          pipeline_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pipeline_hidden_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_tutorial_progress: {
        Row: {
          completed_at: string | null
          completed_steps: string[]
          mode: string
          started_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_steps?: string[]
          mode?: string
          started_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_steps?: string[]
          mode?: string
          started_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_ui_settings: {
        Row: {
          created_at: string
          home_background_opacity: number | null
          home_background_url: string | null
          mail_signature_html: string | null
          mail_signature_image_url: string | null
          theme_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          home_background_opacity?: number | null
          home_background_url?: string | null
          mail_signature_html?: string | null
          mail_signature_image_url?: string | null
          theme_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          home_background_opacity?: number | null
          home_background_url?: string | null
          mail_signature_html?: string | null
          mail_signature_image_url?: string | null
          theme_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      camera_reservation_approvers: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      can_access_chat_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_entity_read: {
        Args: { _entity_id: string; _entity_type: string; _user_id: string }
        Returns: boolean
      }
      can_access_immosphera: { Args: never; Returns: boolean }
      can_access_internal_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_lead: {
        Args: { _lead_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_lodgify_agency: {
        Args: { _agency_id: string }
        Returns: boolean
      }
      can_access_pipeline: {
        Args: { _pipeline_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_reaction_target: {
        Args: { _target: string; _type: string; _user: string }
        Returns: boolean
      }
      can_access_shared_lead: {
        Args: { _lead_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_lead_private: {
        Args: { _lead_id: string; _user_id: string }
        Returns: boolean
      }
      can_use_ai_assistant: { Args: never; Returns: boolean }
      can_view_profile: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      change_lead_pipeline: {
        Args: { p_lead_id: string; p_pipeline_id: string; p_stage_id?: string }
        Returns: undefined
      }
      change_lead_position: {
        Args: { p_lead_id: string; p_pipeline_position: number }
        Returns: undefined
      }
      change_lead_stage:
        | {
            Args: { p_lead_id: string; p_stage_id: string }
            Returns: undefined
          }
        | {
            Args: {
              p_lead_id: string
              p_pipeline_id?: string
              p_pipeline_position?: number
              p_stage_id: string
            }
            Returns: undefined
          }
      cleanup_dismissed_items: { Args: never; Returns: undefined }
      compute_consent_status: { Args: { _data: Json }; Returns: string }
      count_all_agencies: { Args: never; Returns: number }
      create_notification:
        | {
            Args: {
              _body: string
              _entity_id: string
              _entity_type: string
              _link: string
              _title: string
              _type: string
              _user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _agency_id: string
              _entity_id: string
              _entity_type: string
              _message: string
              _metadata: Json
              _title: string
              _type: string
              _user_id: string
            }
            Returns: string
          }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_user_setup: { Args: never; Returns: Json }
      expected_agency_for_email: { Args: { _email: string }; Returns: string }
      extract_mentions: { Args: { _text: string }; Returns: string[] }
      get_agency_slug_for_email: { Args: { _email: string }; Returns: string }
      get_or_create_lead_conversation: {
        Args: { _lead_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_send_push: {
        Args: {
          _message: string
          _tag?: string
          _title: string
          _url?: string
          _user_ids: string[]
        }
        Returns: number
      }
      is_agency_member: {
        Args: { _agency_id: string; _user_id: string }
        Returns: boolean
      }
      is_chat_project_creator: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      is_chat_project_in_user_agency: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      is_chat_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      is_conversation_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_general_chat_project: {
        Args: { _project_id: string }
        Returns: boolean
      }
      is_immosphera_agency: { Args: { _agency_id: string }; Returns: boolean }
      is_lead_guest: {
        Args: { _lead_id: string; _user_id: string }
        Returns: boolean
      }
      is_note_mentioned: {
        Args: { _note_id: string; _user_id: string }
        Returns: boolean
      }
      is_note_owner: {
        Args: { _note_id: string; _user_id: string }
        Returns: boolean
      }
      is_task_assignee: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      lead_copy_for_user: {
        Args: { _lead_id: string; _user_id: string }
        Returns: string
      }
      lead_family_ids: { Args: { _lead_id: string }; Returns: string[] }
      lead_master_id: { Args: { _lead_id: string }; Returns: string }
      lead_share_participants: { Args: { _lead_id: string }; Returns: string[] }
      lead_share_recipients_without_sender: {
        Args: { _lead_id: string; _sender_id: string }
        Returns: string[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      notify_due_reminders: { Args: never; Returns: number }
      notify_shared_lead_event: {
        Args: {
          _body: string
          _entity_id: string
          _entity_type: string
          _lead_id: string
          _link: string
          _sender_id: string
          _title: string
          _type: string
        }
        Returns: undefined
      }
      nova_agent_select: { Args: { query: string }; Returns: Json }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      restore_internal_task_assignees_for_email: {
        Args: { _email: string }
        Returns: number
      }
      review_camera_reservation: {
        Args: {
          _refusal_reason?: string
          _reservation_id: string
          _status: string
        }
        Returns: undefined
      }
      safe_uuid: { Args: { _t: string }; Returns: string }
      shares_agency_with: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      sync_lead_conversation: {
        Args: { _actor_id?: string; _lead_id: string }
        Returns: string
      }
      sync_user_agency_from_email: {
        Args: { _email: string; _user_id: string }
        Returns: undefined
      }
      task_agency_id: { Args: { _task_id: string }; Returns: string }
    }
    Enums: {
      app_role: "super_admin" | "commercial" | "intern"
      conversation_type: "direct" | "group"
      immosphera_partner_category:
        | "electricien"
        | "macon"
        | "plombier"
        | "platrier"
        | "diagnostiqueur"
        | "couvreur"
        | "peintre"
        | "jardinier"
        | "architecte"
        | "notaire"
        | "menuisier"
        | "chauffagiste"
        | "serrurier"
        | "carreleur"
        | "terrassier"
        | "geometre"
        | "courtier"
        | "demenageur"
        | "autre"
        | "multiservices"
        | "courtier_travaux"
        | "climaticien"
        | "automatisme"
        | "expert_fissure"
      immosphera_property_type:
        | "apartment"
        | "house"
        | "villa"
        | "studio"
        | "loft"
        | "commercial"
        | "land"
        | "other"
      lead_temperature: "chaud" | "tiede" | "froid"
      message_kind: "text" | "image" | "voice" | "file" | "video"
      reminder_priority: "urgent" | "normal" | "low"
      support_category: "technique" | "fonctionnalite" | "bug" | "autre"
      support_priority: "basse" | "normale" | "haute" | "urgente"
      support_status: "ouvert" | "en_cours" | "ferme"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "commercial", "intern"],
      conversation_type: ["direct", "group"],
      immosphera_partner_category: [
        "electricien",
        "macon",
        "plombier",
        "platrier",
        "diagnostiqueur",
        "couvreur",
        "peintre",
        "jardinier",
        "architecte",
        "notaire",
        "menuisier",
        "chauffagiste",
        "serrurier",
        "carreleur",
        "terrassier",
        "geometre",
        "courtier",
        "demenageur",
        "autre",
        "multiservices",
        "courtier_travaux",
        "climaticien",
        "automatisme",
        "expert_fissure",
      ],
      immosphera_property_type: [
        "apartment",
        "house",
        "villa",
        "studio",
        "loft",
        "commercial",
        "land",
        "other",
      ],
      lead_temperature: ["chaud", "tiede", "froid"],
      message_kind: ["text", "image", "voice", "file", "video"],
      reminder_priority: ["urgent", "normal", "low"],
      support_category: ["technique", "fonctionnalite", "bug", "autre"],
      support_priority: ["basse", "normale", "haute", "urgente"],
      support_status: ["ouvert", "en_cours", "ferme"],
    },
  },
} as const
