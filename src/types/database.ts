export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      activities: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_demo: boolean;
          lead_id: string;
          metadata: Json;
          title: string;
          type: Database['public']['Enums']['activity_type'];
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_demo?: boolean;
          lead_id: string;
          metadata?: Json;
          title: string;
          type: Database['public']['Enums']['activity_type'];
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_demo?: boolean;
          lead_id?: string;
          metadata?: Json;
          title?: string;
          type?: Database['public']['Enums']['activity_type'];
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'activities_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      appointments: {
        Row: {
          assigned_to: string | null;
          confirmed: boolean;
          confirmed_at: string | null;
          created_at: string;
          created_by: string | null;
          duration_minutes: number;
          google_event_id: string | null;
          google_sync_status: string | null;
          google_synced_at: string | null;
          id: string;
          is_demo: boolean;
          lead_id: string;
          meeting_link: string | null;
          no_show_recovered: boolean;
          notes: string | null;
          scheduled_at: string;
          showed_up: boolean | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          confirmed?: boolean;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          duration_minutes?: number;
          google_event_id?: string | null;
          google_sync_status?: string | null;
          google_synced_at?: string | null;
          id?: string;
          is_demo?: boolean;
          lead_id: string;
          meeting_link?: string | null;
          no_show_recovered?: boolean;
          notes?: string | null;
          scheduled_at: string;
          showed_up?: boolean | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          confirmed?: boolean;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          duration_minutes?: number;
          google_event_id?: string | null;
          google_sync_status?: string | null;
          google_synced_at?: string | null;
          id?: string;
          is_demo?: boolean;
          lead_id?: string;
          meeting_link?: string | null;
          no_show_recovered?: boolean;
          notes?: string | null;
          scheduled_at?: string;
          showed_up?: boolean | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'appointments_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      automation_rules: {
        Row: {
          action_config: Json;
          action_type: Database['public']['Enums']['automation_action'];
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_active: boolean;
          last_run_at: string | null;
          name: string;
          trigger_config: Json;
          trigger_type: Database['public']['Enums']['automation_trigger'];
          updated_at: string;
        };
        Insert: {
          action_config?: Json;
          action_type: Database['public']['Enums']['automation_action'];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          last_run_at?: string | null;
          name: string;
          trigger_config?: Json;
          trigger_type: Database['public']['Enums']['automation_trigger'];
          updated_at?: string;
        };
        Update: {
          action_config?: Json;
          action_type?: Database['public']['Enums']['automation_action'];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          last_run_at?: string | null;
          name?: string;
          trigger_config?: Json;
          trigger_type?: Database['public']['Enums']['automation_trigger'];
          updated_at?: string;
        };
        Relationships: [];
      };
      automation_runs: {
        Row: {
          dedupe_key: string;
          error: string | null;
          executed_at: string;
          id: string;
          lead_id: string | null;
          rule_id: string;
          status: string;
        };
        Insert: {
          dedupe_key: string;
          error?: string | null;
          executed_at?: string;
          id?: string;
          lead_id?: string | null;
          rule_id: string;
          status?: string;
        };
        Update: {
          dedupe_key?: string;
          error?: string | null;
          executed_at?: string;
          id?: string;
          lead_id?: string | null;
          rule_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'automation_runs_rule_id_fkey';
            columns: ['rule_id'];
            isOneToOne: false;
            referencedRelation: 'automation_rules';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'automation_runs_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      contact_attempts: {
        Row: {
          attempt_number: number;
          attempted_at: string;
          channel: Database['public']['Enums']['contact_channel'];
          created_at: string;
          created_by: string | null;
          id: string;
          is_demo: boolean;
          lead_id: string;
          notes: string | null;
          outcome: Database['public']['Enums']['contact_outcome'];
          sla_breached: boolean;
          sla_deadline: string | null;
        };
        Insert: {
          attempt_number: number;
          attempted_at?: string;
          channel: Database['public']['Enums']['contact_channel'];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          lead_id: string;
          notes?: string | null;
          outcome: Database['public']['Enums']['contact_outcome'];
          sla_breached?: boolean;
          sla_deadline?: string | null;
        };
        Update: {
          attempt_number?: number;
          attempted_at?: string;
          channel?: Database['public']['Enums']['contact_channel'];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          lead_id?: string;
          notes?: string | null;
          outcome?: Database['public']['Enums']['contact_outcome'];
          sla_breached?: boolean;
          sla_deadline?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'contact_attempts_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      conversations: {
        Row: {
          ai_activated_at: string | null;
          ai_active: boolean;
          ai_deactivated_at: string | null;
          ai_muted: boolean;
          assigned_to: string | null;
          channel: string;
          contact_name: string | null;
          created_at: string;
          external_id: string;
          followup_day: number;
          followup_last_sent_at: string | null;
          followup_stop_reason: string | null;
          followup_stopped: boolean;
          id: string;
          is_demo: boolean;
          last_message_at: string | null;
          lead_id: string | null;
          shadow_mode: boolean;
          status: string;
          updated_at: string;
          waba_id: string | null;
          whatsapp_instance_id: string | null;
        };
        Insert: {
          ai_activated_at?: string | null;
          ai_active?: boolean;
          ai_deactivated_at?: string | null;
          ai_muted?: boolean;
          assigned_to?: string | null;
          channel: string;
          contact_name?: string | null;
          created_at?: string;
          external_id: string;
          followup_day?: number;
          followup_last_sent_at?: string | null;
          followup_stop_reason?: string | null;
          followup_stopped?: boolean;
          id?: string;
          is_demo?: boolean;
          last_message_at?: string | null;
          lead_id?: string | null;
          shadow_mode?: boolean;
          status?: string;
          updated_at?: string;
          waba_id?: string | null;
          whatsapp_instance_id?: string | null;
        };
        Update: {
          ai_activated_at?: string | null;
          ai_active?: boolean;
          ai_deactivated_at?: string | null;
          ai_muted?: boolean;
          assigned_to?: string | null;
          channel?: string;
          contact_name?: string | null;
          created_at?: string;
          external_id?: string;
          followup_day?: number;
          followup_last_sent_at?: string | null;
          followup_stop_reason?: string | null;
          followup_stopped?: boolean;
          id?: string;
          is_demo?: boolean;
          last_message_at?: string | null;
          lead_id?: string | null;
          shadow_mode?: boolean;
          status?: string;
          updated_at?: string;
          waba_id?: string | null;
          whatsapp_instance_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversations_whatsapp_instance_id_fkey';
            columns: ['whatsapp_instance_id'];
            isOneToOne: false;
            referencedRelation: 'whatsapp_instances';
            referencedColumns: ['id'];
          },
        ];
      };
      dashboard_config: {
        Row: {
          ano: number;
          created_at: string;
          created_by: string | null;
          id: string;
          investimento_por_canal: Json;
          investimento_total_ads: number;
          mes: number;
          meta_agendamentos: number;
          meta_faturamento: number;
          meta_leads: number;
          meta_vendas: number;
          updated_at: string;
        };
        Insert: {
          ano: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          investimento_por_canal?: Json;
          investimento_total_ads?: number;
          mes: number;
          meta_agendamentos?: number;
          meta_faturamento?: number;
          meta_leads?: number;
          meta_vendas?: number;
          updated_at?: string;
        };
        Update: {
          ano?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          investimento_por_canal?: Json;
          investimento_total_ads?: number;
          mes?: number;
          meta_agendamentos?: number;
          meta_faturamento?: number;
          meta_leads?: number;
          meta_vendas?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      deals: {
        Row: {
          cancel_reason: string | null;
          canceled_at: string | null;
          closed_by: string | null;
          contract_value: number;
          created_at: string;
          discount_pct: number | null;
          education_level: Database['public']['Enums']['education_level'] | null;
          enrollment_year: string | null;
          id: string;
          installments: number | null;
          is_demo: boolean;
          lead_id: string;
          monthly_value: number | null;
          notes: string | null;
          payment_method: string | null;
          sale_status: string;
          school_year: string | null;
          signed_at: string;
          student_name: string | null;
          updated_at: string;
        };
        Insert: {
          cancel_reason?: string | null;
          canceled_at?: string | null;
          closed_by?: string | null;
          contract_value?: number;
          created_at?: string;
          discount_pct?: number | null;
          education_level?: Database['public']['Enums']['education_level'] | null;
          enrollment_year?: string | null;
          id?: string;
          installments?: number | null;
          is_demo?: boolean;
          lead_id: string;
          monthly_value?: number | null;
          notes?: string | null;
          payment_method?: string | null;
          sale_status?: string;
          school_year?: string | null;
          signed_at?: string;
          student_name?: string | null;
          updated_at?: string;
        };
        Update: {
          cancel_reason?: string | null;
          canceled_at?: string | null;
          closed_by?: string | null;
          contract_value?: number;
          created_at?: string;
          discount_pct?: number | null;
          education_level?: Database['public']['Enums']['education_level'] | null;
          enrollment_year?: string | null;
          id?: string;
          installments?: number | null;
          is_demo?: boolean;
          lead_id?: string;
          monthly_value?: number | null;
          notes?: string | null;
          payment_method?: string | null;
          sale_status?: string;
          school_year?: string | null;
          signed_at?: string;
          student_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deals_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      duplicate_candidates: {
        Row: {
          confidence_layer: number;
          detected_at: string;
          id: string;
          lead_a_id: string;
          lead_b_id: string;
          name_similarity: number;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          supporting_signals: string[];
        };
        Insert: {
          confidence_layer: number;
          detected_at?: string;
          id?: string;
          lead_a_id: string;
          lead_b_id: string;
          name_similarity: number;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          supporting_signals?: string[];
        };
        Update: {
          confidence_layer?: number;
          detected_at?: string;
          id?: string;
          lead_a_id?: string;
          lead_b_id?: string;
          name_similarity?: number;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          supporting_signals?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'duplicate_candidates_lead_a_id_fkey';
            columns: ['lead_a_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'duplicate_candidates_lead_b_id_fkey';
            columns: ['lead_b_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      google_calendar_events: {
        Row: {
          all_day: boolean;
          appointment_id: string | null;
          attendees: Json | null;
          calendar_id: string;
          created_at: string;
          description: string | null;
          end_at: string | null;
          google_event_id: string;
          html_link: string | null;
          id: string;
          meet_link: string | null;
          start_at: string | null;
          status: string | null;
          summary: string | null;
          updated_at: string;
          updated_at_google: string | null;
        };
        Insert: {
          all_day?: boolean;
          appointment_id?: string | null;
          attendees?: Json | null;
          calendar_id?: string;
          created_at?: string;
          description?: string | null;
          end_at?: string | null;
          google_event_id: string;
          html_link?: string | null;
          id?: string;
          meet_link?: string | null;
          start_at?: string | null;
          status?: string | null;
          summary?: string | null;
          updated_at?: string;
          updated_at_google?: string | null;
        };
        Update: {
          all_day?: boolean;
          appointment_id?: string | null;
          attendees?: Json | null;
          calendar_id?: string;
          created_at?: string;
          description?: string | null;
          end_at?: string | null;
          google_event_id?: string;
          html_link?: string | null;
          id?: string;
          meet_link?: string | null;
          start_at?: string | null;
          status?: string | null;
          summary?: string | null;
          updated_at?: string;
          updated_at_google?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'google_calendar_events_appointment_id_fkey';
            columns: ['appointment_id'];
            isOneToOne: false;
            referencedRelation: 'appointments';
            referencedColumns: ['id'];
          },
        ];
      };
      google_calendar_tokens: {
        Row: {
          access_token: string;
          calendar_id: string;
          connected_email: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          last_refreshed_at: string | null;
          last_synced_at: string | null;
          refresh_token: string;
          sync_token: string | null;
        };
        Insert: {
          access_token: string;
          calendar_id?: string;
          connected_email?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          last_refreshed_at?: string | null;
          last_synced_at?: string | null;
          refresh_token: string;
          sync_token?: string | null;
        };
        Update: {
          access_token?: string;
          calendar_id?: string;
          connected_email?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_refreshed_at?: string | null;
          last_synced_at?: string | null;
          refresh_token?: string;
          sync_token?: string | null;
        };
        Relationships: [];
      };
      integration_tokens: {
        Row: {
          access_token: string;
          expires_at: string | null;
          key: string;
          refreshed_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          access_token: string;
          expires_at?: string | null;
          key: string;
          refreshed_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          access_token?: string;
          expires_at?: string | null;
          key?: string;
          refreshed_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          accepted_user_id: string | null;
          created_at: string;
          created_by: string | null;
          email: string;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          role: Database['public']['Enums']['user_role'];
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email: string;
          expires_at: string;
          id?: string;
          revoked_at?: string | null;
          role: Database['public']['Enums']['user_role'];
          token: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          role?: Database['public']['Enums']['user_role'];
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_accepted_user_id_fkey';
            columns: ['accepted_user_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      leads: {
        Row: {
          ad_creative: string | null;
          assigned_to: string | null;
          child_age: number | null;
          child_name: string | null;
          city: string | null;
          created_at: string;
          education_level: Database['public']['Enums']['education_level'] | null;
          email: string | null;
          facebook_user_id: string | null;
          id: string;
          instagram: string | null;
          instagram_user_id: string | null;
          interest_level: Database['public']['Enums']['interest_level'] | null;
          is_archived: boolean;
          is_demo: boolean;
          is_no_show: boolean;
          landing_page: string | null;
          last_entered_at: string;
          lost_reason: Database['public']['Enums']['lost_reason'] | null;
          merged_into: string | null;
          meta_ad_id: string | null;
          meta_ad_name: string | null;
          meta_adset_id: string | null;
          meta_adset_name: string | null;
          meta_campaign_id: string | null;
          meta_campaign_name: string | null;
          meta_entries: Json;
          meta_form_answers: Json | null;
          meta_form_id: string | null;
          meta_form_name: string | null;
          name: string;
          phone: string | null;
          phone_normalized: string | null;
          pipeline: Database['public']['Enums']['pipeline_kind'];
          qualification_next_action: string | null;
          qualification_next_action_at: string | null;
          qualification_note: string | null;
          qualification_status: string | null;
          qualification_updated_at: string | null;
          qualification_updated_by: string | null;
          school_year: string | null;
          source: Database['public']['Enums']['lead_source'] | null;
          stage: string;
          state: string | null;
          tags: string[];
          updated_at: string;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
          whatsapp_instance_id: string | null;
          with_child: boolean | null;
        };
        Insert: {
          ad_creative?: string | null;
          assigned_to?: string | null;
          child_age?: number | null;
          child_name?: string | null;
          city?: string | null;
          created_at?: string;
          education_level?: Database['public']['Enums']['education_level'] | null;
          email?: string | null;
          facebook_user_id?: string | null;
          id?: string;
          instagram?: string | null;
          instagram_user_id?: string | null;
          interest_level?: Database['public']['Enums']['interest_level'] | null;
          is_archived?: boolean;
          is_demo?: boolean;
          is_no_show?: boolean;
          landing_page?: string | null;
          last_entered_at?: string;
          lost_reason?: Database['public']['Enums']['lost_reason'] | null;
          merged_into?: string | null;
          meta_ad_id?: string | null;
          meta_ad_name?: string | null;
          meta_adset_id?: string | null;
          meta_adset_name?: string | null;
          meta_campaign_id?: string | null;
          meta_campaign_name?: string | null;
          meta_entries?: Json;
          meta_form_answers?: Json | null;
          meta_form_id?: string | null;
          meta_form_name?: string | null;
          name: string;
          phone?: string | null;
          phone_normalized?: string | null;
          pipeline?: Database['public']['Enums']['pipeline_kind'];
          qualification_next_action?: string | null;
          qualification_next_action_at?: string | null;
          qualification_note?: string | null;
          qualification_status?: string | null;
          qualification_updated_at?: string | null;
          qualification_updated_by?: string | null;
          school_year?: string | null;
          source?: Database['public']['Enums']['lead_source'] | null;
          stage: string;
          state?: string | null;
          tags?: string[];
          updated_at?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          whatsapp_instance_id?: string | null;
          with_child?: boolean | null;
        };
        Update: {
          ad_creative?: string | null;
          assigned_to?: string | null;
          child_age?: number | null;
          child_name?: string | null;
          city?: string | null;
          created_at?: string;
          education_level?: Database['public']['Enums']['education_level'] | null;
          email?: string | null;
          facebook_user_id?: string | null;
          id?: string;
          instagram?: string | null;
          instagram_user_id?: string | null;
          interest_level?: Database['public']['Enums']['interest_level'] | null;
          is_archived?: boolean;
          is_demo?: boolean;
          is_no_show?: boolean;
          landing_page?: string | null;
          last_entered_at?: string;
          lost_reason?: Database['public']['Enums']['lost_reason'] | null;
          merged_into?: string | null;
          meta_ad_id?: string | null;
          meta_ad_name?: string | null;
          meta_adset_id?: string | null;
          meta_adset_name?: string | null;
          meta_campaign_id?: string | null;
          meta_campaign_name?: string | null;
          meta_entries?: Json;
          meta_form_answers?: Json | null;
          meta_form_id?: string | null;
          meta_form_name?: string | null;
          name?: string;
          phone?: string | null;
          phone_normalized?: string | null;
          pipeline?: Database['public']['Enums']['pipeline_kind'];
          qualification_next_action?: string | null;
          qualification_next_action_at?: string | null;
          qualification_note?: string | null;
          qualification_status?: string | null;
          qualification_updated_at?: string | null;
          qualification_updated_by?: string | null;
          school_year?: string | null;
          source?: Database['public']['Enums']['lead_source'] | null;
          stage?: string;
          state?: string | null;
          tags?: string[];
          updated_at?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          whatsapp_instance_id?: string | null;
          with_child?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_merged_into_fkey';
            columns: ['merged_into'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_whatsapp_instance_id_fkey';
            columns: ['whatsapp_instance_id'];
            isOneToOne: false;
            referencedRelation: 'whatsapp_instances';
            referencedColumns: ['id'];
          },
        ];
      };
      message_templates: {
        Row: {
          channel: string;
          content: string;
          created_at: string;
          created_by: string | null;
          id: string;
          is_active: boolean;
          meta_template_language: string;
          meta_template_name: string | null;
          name: string;
          variables: string[];
        };
        Insert: {
          channel: string;
          content: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          meta_template_language?: string;
          meta_template_name?: string | null;
          name: string;
          variables?: string[];
        };
        Update: {
          channel?: string;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          meta_template_language?: string;
          meta_template_name?: string | null;
          name?: string;
          variables?: string[];
        };
        Relationships: [];
      };
      messages: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          content: string | null;
          conversation_id: string;
          created_at: string;
          direction: string;
          external_message_id: string | null;
          id: string;
          media_mime_type: string | null;
          media_url: string | null;
          metadata: Json | null;
          pending_approval: boolean;
          sender_type: string;
          sent_at: string | null;
          sent_by: string | null;
          status: string;
          type: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          content?: string | null;
          conversation_id: string;
          created_at?: string;
          direction: string;
          external_message_id?: string | null;
          id?: string;
          media_mime_type?: string | null;
          media_url?: string | null;
          metadata?: Json | null;
          pending_approval?: boolean;
          sender_type?: string;
          sent_at?: string | null;
          sent_by?: string | null;
          status?: string;
          type?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          content?: string | null;
          conversation_id?: string;
          created_at?: string;
          direction?: string;
          external_message_id?: string | null;
          id?: string;
          media_mime_type?: string | null;
          media_url?: string | null;
          metadata?: Json | null;
          pending_approval?: boolean;
          sender_type?: string;
          sent_at?: string | null;
          sent_by?: string | null;
          status?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          lead_id: string | null;
          read: boolean;
          title: string;
          type: Database['public']['Enums']['notification_type'];
          user_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          lead_id?: string | null;
          read?: boolean;
          title: string;
          type: Database['public']['Enums']['notification_type'];
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          lead_id?: string | null;
          read?: boolean;
          title?: string;
          type?: Database['public']['Enums']['notification_type'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      pipeline_stages: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          is_active: boolean;
          is_entry: boolean;
          is_terminal: boolean;
          name: string;
          pipeline: Database['public']['Enums']['pipeline_kind'];
          position: number;
          required_fields: string[];
          slug: string;
          stage_win_probability: number;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_entry?: boolean;
          is_terminal?: boolean;
          name: string;
          pipeline: Database['public']['Enums']['pipeline_kind'];
          position: number;
          required_fields?: string[];
          slug: string;
          stage_win_probability?: number;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_entry?: boolean;
          is_terminal?: boolean;
          name?: string;
          pipeline?: Database['public']['Enums']['pipeline_kind'];
          position?: number;
          required_fields?: string[];
          slug?: string;
          stage_win_probability?: number;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          assigned_to: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          due_at: string;
          duration_minutes: number;
          google_event_id: string | null;
          id: string;
          lead_id: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_at: string;
          duration_minutes?: number;
          google_event_id?: string | null;
          id?: string;
          lead_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_at?: string;
          duration_minutes?: number;
          google_event_id?: string | null;
          id?: string;
          lead_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
        ];
      };
      user_goals: {
        Row: {
          ano: number;
          created_at: string;
          created_by: string | null;
          id: string;
          mes: number;
          meta_agendamentos: number;
          meta_faturamento: number;
          meta_vendas: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ano: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          mes: number;
          meta_agendamentos?: number;
          meta_faturamento?: number;
          meta_vendas?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ano?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          mes?: number;
          meta_agendamentos?: number;
          meta_faturamento?: number;
          meta_vendas?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_goals_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_goals_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'user_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          id: string;
          name: string;
          phone: string | null;
          role: Database['public']['Enums']['user_role'];
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          id: string;
          name: string;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Relationships: [];
      };
      webhook_logs: {
        Row: {
          error_message: string | null;
          id: string;
          lead_id: string | null;
          payload: Json;
          processing_time_ms: number | null;
          received_at: string;
          source_id: string;
          status: string;
        };
        Insert: {
          error_message?: string | null;
          id?: string;
          lead_id?: string | null;
          payload?: Json;
          processing_time_ms?: number | null;
          received_at?: string;
          source_id: string;
          status?: string;
        };
        Update: {
          error_message?: string | null;
          id?: string;
          lead_id?: string | null;
          payload?: Json;
          processing_time_ms?: number | null;
          received_at?: string;
          source_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_logs_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'webhook_logs_source_id_fkey';
            columns: ['source_id'];
            isOneToOne: false;
            referencedRelation: 'webhook_sources';
            referencedColumns: ['id'];
          },
        ];
      };
      webhook_sources: {
        Row: {
          created_at: string;
          default_pipeline: Database['public']['Enums']['pipeline_kind'];
          default_stage: string;
          field_mapping: Json;
          id: string;
          is_active: boolean;
          name: string;
          secret: string;
          slug: string;
          tag_rules: Json;
        };
        Insert: {
          created_at?: string;
          default_pipeline?: Database['public']['Enums']['pipeline_kind'];
          default_stage?: string;
          field_mapping?: Json;
          id?: string;
          is_active?: boolean;
          name: string;
          secret: string;
          slug: string;
          tag_rules?: Json;
        };
        Update: {
          created_at?: string;
          default_pipeline?: Database['public']['Enums']['pipeline_kind'];
          default_stage?: string;
          field_mapping?: Json;
          id?: string;
          is_active?: boolean;
          name?: string;
          secret?: string;
          slug?: string;
          tag_rules?: Json;
        };
        Relationships: [];
      };
      whatsapp_instances: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          instance_token: string | null;
          is_active: boolean;
          is_connected: boolean;
          label: string | null;
          last_connected_at: string | null;
          last_disconnected_at: string | null;
          name: string;
          phone_number: string | null;
          phone_number_id: string | null;
          provider: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          instance_token?: string | null;
          is_active?: boolean;
          is_connected?: boolean;
          label?: string | null;
          last_connected_at?: string | null;
          last_disconnected_at?: string | null;
          name: string;
          phone_number?: string | null;
          phone_number_id?: string | null;
          provider?: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          instance_token?: string | null;
          is_active?: boolean;
          is_connected?: boolean;
          label?: string | null;
          last_connected_at?: string | null;
          last_disconnected_at?: string | null;
          name?: string;
          phone_number?: string | null;
          phone_number_id?: string | null;
          provider?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      auth_role: {
        Args: never;
        Returns: Database['public']['Enums']['user_role'];
      };
      set_lead_qualification: {
        Args: {
          p_lead_id: string;
          p_next_action?: string | null;
          p_next_action_at?: string | null;
          p_note?: string | null;
          p_status: string;
        };
        Returns: Database['public']['Tables']['leads']['Row'];
      };
      count_activities_for_leads: {
        Args: { lead_ids: string[] };
        Returns: {
          lead_id: string;
          activity_count: number;
        }[];
      };
      duplicate_lead_groups: {
        Args: never;
        Returns: {
          match_key: string;
          match_type: string;
          members: Json;
        }[];
      };
      find_name_duplicate_pairs: {
        Args: { min_sim?: number };
        Returns: {
          a_id: string;
          a_name: string;
          a_phone: string | null;
          a_email: string | null;
          a_city: string | null;
          a_state: string | null;
          a_created_at: string;
          a_activity_count: number;
          b_id: string;
          b_name: string;
          b_phone: string | null;
          b_email: string | null;
          b_city: string | null;
          b_state: string | null;
          b_created_at: string;
          b_activity_count: number;
          name_similarity: number;
        }[];
      };
      find_similar_leads_by_name: {
        Args: { p_lead_id: string; min_sim?: number; window_days?: number };
        Returns: {
          b_id: string;
          b_name: string;
          b_phone: string | null;
          b_email: string | null;
          b_city: string | null;
          b_state: string | null;
          b_created_at: string;
          b_activity_count: number;
          name_similarity: number;
        }[];
      };
      list_salespeople: {
        Args: never;
        Returns: {
          id: string;
          name: string;
          role: Database['public']['Enums']['user_role'];
        }[];
      };
    };
    Enums: {
      activity_type:
        | 'call'
        | 'whatsapp'
        | 'email'
        | 'stage_change'
        | 'appointment'
        | 'note'
        | 'qualification'
        | 'system';
      automation_action: 'notificar' | 'criar_tarefa' | 'enviar_whatsapp';
      automation_trigger:
        | 'lead_criado'
        | 'entrou_etapa'
        | 'parado_na_etapa'
        | 'visita_amanha'
        | 'sem_resposta';
      contact_channel: 'whatsapp' | 'phone' | 'email' | 'instagram' | 'presencial';
      contact_outcome: 'no_answer' | 'busy' | 'responded' | 'scheduled';
      education_level: 'infantil' | 'fundamental_1' | 'fundamental_2' | 'medio' | 'pre_enem';
      interest_level: 'baixo' | 'medio' | 'alto';
      lead_source:
        | 'meta_ads'
        | 'whatsapp'
        | 'instagram'
        | 'telefone'
        | 'presencial'
        | 'site'
        | 'indicacao'
        | 'organico'
        | 'evento'
        | 'reentrada'
        | 'outro';
      lost_reason:
        | 'preco'
        | 'momento'
        | 'distancia'
        | 'concorrente'
        | 'sem_vaga'
        | 'sem_resposta'
        | 'sem_interesse'
        | 'numero_invalido'
        | 'outro';
      notification_type:
        | 'novo_lead'
        | 'sla_vencendo'
        | 'no_show'
        | 'matricula_fechada'
        | 'followup'
        | 'lembrete'
        | 'sistema';
      pipeline_kind: 'comercial' | 'pos_matricula';
      user_role: 'admin' | 'comercial';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      activity_type: ['call', 'whatsapp', 'email', 'stage_change', 'appointment', 'note', 'system'],
      automation_action: ['notificar', 'criar_tarefa', 'enviar_whatsapp'],
      automation_trigger: [
        'lead_criado',
        'entrou_etapa',
        'parado_na_etapa',
        'visita_amanha',
        'sem_resposta',
      ],
      contact_channel: ['whatsapp', 'phone', 'email', 'instagram', 'presencial'],
      contact_outcome: ['no_answer', 'busy', 'responded', 'scheduled'],
      education_level: ['infantil', 'fundamental_1', 'fundamental_2', 'medio', 'pre_enem'],
      interest_level: ['baixo', 'medio', 'alto'],
      lead_source: [
        'meta_ads',
        'whatsapp',
        'instagram',
        'telefone',
        'presencial',
        'site',
        'indicacao',
        'organico',
        'evento',
        'reentrada',
        'outro',
      ],
      lost_reason: [
        'preco',
        'momento',
        'distancia',
        'concorrente',
        'sem_vaga',
        'sem_resposta',
        'sem_interesse',
        'numero_invalido',
        'outro',
      ],
      notification_type: [
        'novo_lead',
        'sla_vencendo',
        'no_show',
        'matricula_fechada',
        'followup',
        'lembrete',
        'sistema',
      ],
      pipeline_kind: ['comercial', 'pos_matricula'],
      user_role: ['admin', 'comercial'],
    },
  },
} as const;
