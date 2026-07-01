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
      account_action_requests: {
        Row: {
          email: string | null
          id: string
          requested_at: string | null
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          type: string
          updated_at: string | null
        }
        Insert: {
          email?: string | null
          id: string
          requested_at?: string | null
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status: string
          type: string
          updated_at?: string | null
        }
        Update: {
          email?: string | null
          id?: string
          requested_at?: string | null
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string
          created_at: string | null
          id: string
          metadata: Json | null
          summary: string
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id: string
          created_at?: string | null
          id: string
          metadata?: Json | null
          summary: string
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          summary?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      certificates: {
        Row: {
          authority_label: string
          course_category: string
          course_id: string
          course_slug: string
          course_title: string
          created_at: string
          enrollment_id: string
          id: string
          issued_at: string | null
          sponsor_logo_url: string | null
          status: string
          student_full_name: string | null
          teacher_name: string | null
          teacher_signature_url: string | null
          updated_at: string
          user_id: string
          verification_code: string
        }
        Insert: {
          authority_label?: string
          course_category: string
          course_id: string
          course_slug: string
          course_title: string
          created_at?: string
          enrollment_id: string
          id: string
          issued_at?: string | null
          sponsor_logo_url?: string | null
          status?: string
          student_full_name?: string | null
          teacher_name?: string | null
          teacher_signature_url?: string | null
          updated_at?: string
          user_id: string
          verification_code: string
        }
        Update: {
          authority_label?: string
          course_category?: string
          course_id?: string
          course_slug?: string
          course_title?: string
          created_at?: string
          enrollment_id?: string
          id?: string
          issued_at?: string | null
          sponsor_logo_url?: string | null
          status?: string
          student_full_name?: string | null
          teacher_name?: string | null
          teacher_signature_url?: string | null
          updated_at?: string
          user_id?: string
          verification_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      checkout_locks: {
        Row: {
          acquired_at: string
          expires_at: string | null
          lock_key: string
        }
        Insert: {
          acquired_at?: string
          expires_at?: string | null
          lock_key: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string | null
          lock_key?: string
        }
        Relationships: []
      }
      community_comments: {
        Row: {
          author_id: string
          author_name: string
          author_role: string
          body: string
          course_slug: string
          created_at: string | null
          id: string
          parent_id: string | null
          post_id: string
          updated_at: string | null
        }
        Insert: {
          author_id: string
          author_name: string
          author_role: string
          body: string
          course_slug: string
          created_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          author_name?: string
          author_role?: string
          body?: string
          course_slug?: string
          created_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_post_likes: {
        Row: {
          created_at: string
          liker_id: string
          post_id: string
        }
        Insert: {
          created_at?: string
          liker_id: string
          post_id: string
        }
        Update: {
          created_at?: string
          liker_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_id: string
          author_name: string
          author_role: string
          body: string
          category: string
          course_slug: string
          created_at: string | null
          id: string
          pinned: boolean | null
          updated_at: string | null
        }
        Insert: {
          author_id: string
          author_name: string
          author_role: string
          body: string
          category: string
          course_slug: string
          created_at?: string | null
          id?: string
          pinned?: boolean | null
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          author_name?: string
          author_role?: string
          body?: string
          category?: string
          course_slug?: string
          created_at?: string | null
          id?: string
          pinned?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      community_reports: {
        Row: {
          comment_id: string | null
          course_slug: string
          created_at: string | null
          detail: string | null
          id: string
          post_id: string
          reason: string
          reporter_email: string | null
          reporter_id: string
          reporter_name: string
          status: string
          target_author_id: string
          target_author_name: string
          target_type: string
          updated_at: string | null
        }
        Insert: {
          comment_id?: string | null
          course_slug: string
          created_at?: string | null
          detail?: string | null
          id?: string
          post_id: string
          reason: string
          reporter_email?: string | null
          reporter_id: string
          reporter_name: string
          status?: string
          target_author_id: string
          target_author_name: string
          target_type: string
          updated_at?: string | null
        }
        Update: {
          comment_id?: string | null
          course_slug?: string
          created_at?: string | null
          detail?: string | null
          id?: string
          post_id?: string
          reason?: string
          reporter_email?: string | null
          reporter_id?: string
          reporter_name?: string
          status?: string
          target_author_id?: string
          target_author_name?: string
          target_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      course_assets: {
        Row: {
          content_type: string
          course_id: string
          created_at: string | null
          download_url: string | null
          file_name: string
          id: string
          is_preview: boolean
          kind: string
          lesson_id: string | null
          module_id: string | null
          owner_id: string
          size: number
          storage_path: string
          updated_at: string | null
        }
        Insert: {
          content_type: string
          course_id: string
          created_at?: string | null
          download_url?: string | null
          file_name: string
          id: string
          is_preview?: boolean
          kind: string
          lesson_id?: string | null
          module_id?: string | null
          owner_id: string
          size: number
          storage_path: string
          updated_at?: string | null
        }
        Update: {
          content_type?: string
          course_id?: string
          created_at?: string | null
          download_url?: string | null
          file_name?: string
          id?: string
          is_preview?: boolean
          kind?: string
          lesson_id?: string | null
          module_id?: string | null
          owner_id?: string
          size?: number
          storage_path?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_assets_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_event_rsvps: {
        Row: {
          attendee_email: string | null
          attendee_name: string
          course_slug: string
          created_at: string
          event_id: string
          status: string
          uid: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attendee_email?: string | null
          attendee_name: string
          course_slug: string
          created_at?: string
          event_id: string
          status: string
          uid: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attendee_email?: string | null
          attendee_name?: string
          course_slug?: string
          created_at?: string
          event_id?: string
          status?: string
          uid?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "course_events"
            referencedColumns: ["id"]
          },
        ]
      }
      course_events: {
        Row: {
          course_id: string
          course_slug: string
          course_title: string
          created_at: string
          description: string
          external_url: string
          id: string
          owner_id: string
          recording_asset_id: string | null
          starts_at: string
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          course_id: string
          course_slug: string
          course_title: string
          created_at?: string
          description: string
          external_url: string
          id?: string
          owner_id: string
          recording_asset_id?: string | null
          starts_at: string
          status: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          course_slug?: string
          course_title?: string
          created_at?: string
          description?: string
          external_url?: string
          id?: string
          owner_id?: string
          recording_asset_id?: string | null
          starts_at?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      course_lesson_content: {
        Row: {
          content_text: string | null
          course_id: string
          created_at: string
          external_url: string | null
          lesson_id: string
          updated_at: string
        }
        Insert: {
          content_text?: string | null
          course_id: string
          created_at?: string
          external_url?: string | null
          lesson_id: string
          updated_at?: string
        }
        Update: {
          content_text?: string | null
          course_id?: string
          created_at?: string
          external_url?: string | null
          lesson_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_lesson_content_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_reviews: {
        Row: {
          author_name: string
          body: string | null
          course_id: string
          created_at: string | null
          id: string
          rating: number
          status: string
          updated_at: string | null
        }
        Insert: {
          author_name: string
          body?: string | null
          course_id: string
          created_at?: string | null
          id: string
          rating: number
          status?: string
          updated_at?: string | null
        }
        Update: {
          author_name?: string
          body?: string | null
          course_id?: string
          created_at?: string | null
          id?: string
          rating?: number
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_reviews_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_subscriptions: {
        Row: {
          course_slug: string
          created_at: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          course_slug: string
          created_at?: string
          id: string
          status: string
          user_id: string
        }
        Update: {
          course_slug?: string
          created_at?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_subscriptions_course_slug_fkey"
            columns: ["course_slug"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "course_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      course_title_keys: {
        Row: {
          title_key: string
        }
        Insert: {
          title_key: string
        }
        Update: {
          title_key?: string
        }
        Relationships: []
      }
      courses: {
        Row: {
          categories: string[] | null
          category: string
          cover_image_url: string | null
          created_at: string | null
          currency: string | null
          drip_interval_days: number | null
          drip_strategy: string | null
          enrollment_count: number | null
          featured: boolean | null
          featured_rank: number | null
          free_preview_lesson_id: string | null
          id: string
          installments_enabled: boolean | null
          installments_max: number | null
          learning_outcomes: string[] | null
          lesson_count: number
          members_cover_asset_id: string | null
          members_description: string | null
          members_subtitle: string | null
          members_theme: string | null
          members_title: string | null
          modules: Json
          owner_id: string
          payment_type: string | null
          platform_fee_bps: number | null
          price_amount_minor: number | null
          rating_average: number | null
          rating_count: number | null
          rating_sum: number | null
          review_count: number | null
          review_note: string | null
          slug: string | null
          status: string
          summary: string
          title: string
          title_key: string | null
          trending_score: number | null
          updated_at: string | null
        }
        Insert: {
          categories?: string[] | null
          category: string
          cover_image_url?: string | null
          created_at?: string | null
          currency?: string | null
          drip_interval_days?: number | null
          drip_strategy?: string | null
          enrollment_count?: number | null
          featured?: boolean | null
          featured_rank?: number | null
          free_preview_lesson_id?: string | null
          id: string
          installments_enabled?: boolean | null
          installments_max?: number | null
          learning_outcomes?: string[] | null
          lesson_count?: number
          members_cover_asset_id?: string | null
          members_description?: string | null
          members_subtitle?: string | null
          members_theme?: string | null
          members_title?: string | null
          modules?: Json
          owner_id: string
          payment_type?: string | null
          platform_fee_bps?: number | null
          price_amount_minor?: number | null
          rating_average?: number | null
          rating_count?: number | null
          rating_sum?: number | null
          review_count?: number | null
          review_note?: string | null
          slug?: string | null
          status?: string
          summary: string
          title: string
          title_key?: string | null
          trending_score?: number | null
          updated_at?: string | null
        }
        Update: {
          categories?: string[] | null
          category?: string
          cover_image_url?: string | null
          created_at?: string | null
          currency?: string | null
          drip_interval_days?: number | null
          drip_strategy?: string | null
          enrollment_count?: number | null
          featured?: boolean | null
          featured_rank?: number | null
          free_preview_lesson_id?: string | null
          id?: string
          installments_enabled?: boolean | null
          installments_max?: number | null
          learning_outcomes?: string[] | null
          lesson_count?: number
          members_cover_asset_id?: string | null
          members_description?: string | null
          members_subtitle?: string | null
          members_theme?: string | null
          members_title?: string | null
          modules?: Json
          owner_id?: string
          payment_type?: string | null
          platform_fee_bps?: number | null
          price_amount_minor?: number | null
          rating_average?: number | null
          rating_count?: number | null
          rating_sum?: number | null
          review_count?: number | null
          review_note?: string | null
          slug?: string | null
          status?: string
          summary?: string
          title?: string
          title_key?: string | null
          trending_score?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          course_category: string
          course_id: string
          course_image: string
          course_slug: string
          course_title: string
          created_at: string
          id: string
          last_lesson_id: string | null
          progress_percent: number
          source: string
          status: string
          subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          course_category: string
          course_id: string
          course_image: string
          course_slug: string
          course_title: string
          created_at?: string
          id: string
          last_lesson_id?: string | null
          progress_percent?: number
          source: string
          status: string
          subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          course_category?: string
          course_id?: string
          course_image?: string
          course_slug?: string
          course_title?: string
          created_at?: string
          id?: string
          last_lesson_id?: string | null
          progress_percent?: number
          source?: string
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboards: {
        Row: {
          entries: Json
          updated_at: string | null
          window: string
        }
        Insert: {
          entries: Json
          updated_at?: string | null
          window: string
        }
        Update: {
          entries?: Json
          updated_at?: string | null
          window?: string
        }
        Relationships: []
      }
      lesson_comments: {
        Row: {
          author_id: string
          author_name: string
          body: string
          course_id: string
          created_at: string | null
          id: string
          lesson_id: string
          updated_at: string | null
        }
        Insert: {
          author_id: string
          author_name: string
          body: string
          course_id: string
          created_at?: string | null
          id?: string
          lesson_id: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          author_name?: string
          body?: string
          course_id?: string
          created_at?: string | null
          id?: string
          lesson_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_comments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string
          enrollment_id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          enrollment_id: string
          lesson_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          enrollment_id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      member_stats: {
        Row: {
          display_name: string
          level: number
          points: number
          total_likes_received: number
          uid: string
          updated_at: string | null
        }
        Insert: {
          display_name?: string
          level?: number
          points?: number
          total_likes_received?: number
          uid: string
          updated_at?: string | null
        }
        Update: {
          display_name?: string
          level?: number
          points?: number
          total_likes_received?: number
          uid?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_stats_uid_fkey"
            columns: ["uid"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_name: string | null
          body: string
          created_at: string | null
          link: string | null
          notification_id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_name?: string | null
          body: string
          created_at?: string | null
          link?: string | null
          notification_id: string
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          actor_name?: string | null
          body?: string
          created_at?: string | null
          link?: string | null
          notification_id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      orders: {
        Row: {
          amount_minor: number
          checkout_session_id: string | null
          course_id: string | null
          course_slug: string | null
          course_title: string | null
          created_at: string
          currency: string
          id: string
          payment_intent_id: string | null
          platform_fee_bps: number | null
          provider: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          checkout_session_id?: string | null
          course_id?: string | null
          course_slug?: string | null
          course_title?: string | null
          created_at?: string
          currency: string
          id: string
          payment_intent_id?: string | null
          platform_fee_bps?: number | null
          provider?: string | null
          status: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          checkout_session_id?: string | null
          course_id?: string | null
          course_slug?: string | null
          course_title?: string | null
          created_at?: string
          currency?: string
          id?: string
          payment_intent_id?: string | null
          platform_fee_bps?: number | null
          provider?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          id: string
          order_id: string
          status: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          id: string
          order_id: string
          status: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          order_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      payout_ledger: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          id: string
          payment_id: string | null
          platform_fee_minor: number
          status: string
          teacher_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          id: string
          payment_id?: string | null
          platform_fee_minor?: number
          status: string
          teacher_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          id?: string
          payment_id?: string | null
          platform_fee_minor?: number
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_ledger_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      platform_config: {
        Row: {
          doc_id: string
          payout_release_delay_days: number | null
        }
        Insert: {
          doc_id: string
          payout_release_delay_days?: number | null
        }
        Update: {
          doc_id?: string
          payout_release_delay_days?: number | null
        }
        Relationships: []
      }
      points_events: {
        Row: {
          created_at: string
          delta: number
          id: string
          kind: string
          liker_id: string
          post_id: string
          uid: string
        }
        Insert: {
          created_at?: string
          delta: number
          id: string
          kind: string
          liker_id: string
          post_id: string
          uid: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          kind?: string
          liker_id?: string
          post_id?: string
          uid?: string
        }
        Relationships: []
      }
      processed_stripe_events: {
        Row: {
          processed_at: string
          stripe_event_id: string
        }
        Insert: {
          processed_at?: string
          stripe_event_id: string
        }
        Update: {
          processed_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          bio: string | null
          credentials: Json | null
          display_name: string | null
          photo_url: string | null
          uid: string
          updated_at: string | null
          username: string | null
        }
        Insert: {
          bio?: string | null
          credentials?: Json | null
          display_name?: string | null
          photo_url?: string | null
          uid: string
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          bio?: string | null
          credentials?: Json | null
          display_name?: string | null
          photo_url?: string | null
          uid?: string
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          count: number
          key: string
          updated_at: string
          window_started_at: string
        }
        Update: {
          count?: number
          key?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["uid"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_response: string | null
          category: string
          created_at: string | null
          id: string
          message: string
          responded_at: string | null
          responded_by: string | null
          status: string
          subject: string
          updated_at: string | null
          user_email: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          admin_response?: string | null
          category: string
          created_at?: string | null
          id?: string
          message: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          subject: string
          updated_at?: string | null
          user_email?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          admin_response?: string | null
          category?: string
          created_at?: string | null
          id?: string
          message?: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          subject?: string
          updated_at?: string | null
          user_email?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          bio: string | null
          created_at: string
          credentials: Json | null
          current_plan_id: string | null
          display_name: string | null
          email: string | null
          goals: Json | null
          last_login_at: string
          marketing_consent: boolean | null
          onboarding_answers: Json | null
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          onboarding_path: string | null
          phone_number: string | null
          photo_url: string | null
          preferences: Json | null
          privacy_accepted_at: string | null
          privacy_version: string | null
          roles: Json
          storefront: Json | null
          stripe_connect_charges_enabled: boolean | null
          stripe_connect_payouts_enabled: boolean | null
          stripe_connect_status: string | null
          stripe_connect_updated_at: string | null
          stripe_connected_account_id: string | null
          stripe_customer_id: string | null
          teacher_signature_url: string | null
          teacher_terms_accepted_at: string | null
          teacher_terms_version: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          timezone: string | null
          uid: string
          updated_at: string
          username: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          credentials?: Json | null
          current_plan_id?: string | null
          display_name?: string | null
          email?: string | null
          goals?: Json | null
          last_login_at?: string
          marketing_consent?: boolean | null
          onboarding_answers?: Json | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          onboarding_path?: string | null
          phone_number?: string | null
          photo_url?: string | null
          preferences?: Json | null
          privacy_accepted_at?: string | null
          privacy_version?: string | null
          roles?: Json
          storefront?: Json | null
          stripe_connect_charges_enabled?: boolean | null
          stripe_connect_payouts_enabled?: boolean | null
          stripe_connect_status?: string | null
          stripe_connect_updated_at?: string | null
          stripe_connected_account_id?: string | null
          stripe_customer_id?: string | null
          teacher_signature_url?: string | null
          teacher_terms_accepted_at?: string | null
          teacher_terms_version?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          timezone?: string | null
          uid: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          credentials?: Json | null
          current_plan_id?: string | null
          display_name?: string | null
          email?: string | null
          goals?: Json | null
          last_login_at?: string
          marketing_consent?: boolean | null
          onboarding_answers?: Json | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          onboarding_path?: string | null
          phone_number?: string | null
          photo_url?: string | null
          preferences?: Json | null
          privacy_accepted_at?: string | null
          privacy_version?: string | null
          roles?: Json
          storefront?: Json | null
          stripe_connect_charges_enabled?: boolean | null
          stripe_connect_payouts_enabled?: boolean | null
          stripe_connect_status?: string | null
          stripe_connect_updated_at?: string | null
          stripe_connected_account_id?: string | null
          stripe_customer_id?: string | null
          teacher_signature_url?: string | null
          teacher_terms_accepted_at?: string | null
          teacher_terms_version?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          timezone?: string | null
          uid?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      wishlists: {
        Row: {
          course_id: string
          course_slug: string
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          course_id: string
          course_slug: string
          created_at?: string | null
          id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          course_id?: string
          course_slug?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_enrollment_for_course_slug: {
        Args: { p_slug: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_moderator: { Args: never; Returns: boolean }
      is_ops: { Args: never; Returns: boolean }
      is_service_role: { Args: never; Returns: boolean }
      is_support: { Args: never; Returns: boolean }
      is_target_author: {
        Args: { p_post_id: string; p_target_type: string }
        Returns: boolean
      }
      is_teacher: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
