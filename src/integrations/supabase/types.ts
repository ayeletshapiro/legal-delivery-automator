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
      app_config: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_id: string | null
          vat_rate: number
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string | null
          vat_rate?: number
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string | null
          vat_rate?: number
        }
        Relationships: []
      }
      client_aliases: {
        Row: {
          alias: string
          client_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          alias: string
          client_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          alias?: string
          client_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_aliases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          client_name: string
          created_at: string
          google_sheet_id: string | null
          id: string
          is_archived: boolean
          is_miscellaneous: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          client_name: string
          created_at?: string
          google_sheet_id?: string | null
          id?: string
          is_archived?: boolean
          is_miscellaneous?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          client_name?: string
          created_at?: string
          google_sheet_id?: string | null
          id?: string
          is_archived?: boolean
          is_miscellaneous?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          client_id: string
          contact_ordered_by: string | null
          created_at: string
          delivery_date: string
          description: string
          id: string
          message_id: string
          notes: string | null
          price: number | null
          price_missing: boolean
          row_number: number | null
          sheet_name: string | null
          user_id: string
          write_error: string | null
          write_status: string
          written_at: string | null
        }
        Insert: {
          client_id: string
          contact_ordered_by?: string | null
          created_at?: string
          delivery_date: string
          description: string
          id?: string
          message_id: string
          notes?: string | null
          price?: number | null
          price_missing?: boolean
          row_number?: number | null
          sheet_name?: string | null
          user_id: string
          write_error?: string | null
          write_status?: string
          written_at?: string | null
        }
        Update: {
          client_id?: string
          contact_ordered_by?: string | null
          created_at?: string
          delivery_date?: string
          description?: string
          id?: string
          message_id?: string
          notes?: string | null
          price?: number | null
          price_missing?: boolean
          row_number?: number | null
          sheet_name?: string | null
          user_id?: string
          write_error?: string | null
          write_status?: string
          written_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "incoming_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      incoming_messages: {
        Row: {
          created_at: string
          error_detail: string | null
          id: string
          media_received: boolean
          message_type: Database["public"]["Enums"]["message_type"]
          processed_at: string | null
          raw_text: string | null
          sender_phone: string
          status: Database["public"]["Enums"]["message_status"]
          transcribed_text: string | null
          user_id: string | null
          whatsapp_message_id: string
        }
        Insert: {
          created_at?: string
          error_detail?: string | null
          id?: string
          media_received?: boolean
          message_type: Database["public"]["Enums"]["message_type"]
          processed_at?: string | null
          raw_text?: string | null
          sender_phone: string
          status?: Database["public"]["Enums"]["message_status"]
          transcribed_text?: string | null
          user_id?: string | null
          whatsapp_message_id: string
        }
        Update: {
          created_at?: string
          error_detail?: string | null
          id?: string
          media_received?: boolean
          message_type?: Database["public"]["Enums"]["message_type"]
          processed_at?: string | null
          raw_text?: string | null
          sender_phone?: string
          status?: Database["public"]["Enums"]["message_status"]
          transcribed_text?: string | null
          user_id?: string | null
          whatsapp_message_id?: string
        }
        Relationships: []
      }
      processing_errors: {
        Row: {
          created_at: string
          error_description: string | null
          error_type: string
          id: string
          message_id: string | null
          resolved_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_description?: string | null
          error_type: string
          id?: string
          message_id?: string | null
          resolved_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_description?: string | null
          error_type?: string
          id?: string
          message_id?: string | null
          resolved_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_errors_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "incoming_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
          whatsapp_phone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      message_status:
        | "received"
        | "processing"
        | "done"
        | "failed"
        | "missing_client"
        | "missing_details"
        | "transcription_failed"
        | "ignored"
      message_type: "text" | "audio" | "image" | "document"
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
      app_role: ["admin", "user"],
      message_status: [
        "received",
        "processing",
        "done",
        "failed",
        "missing_client",
        "missing_details",
        "transcription_failed",
        "ignored",
      ],
      message_type: ["text", "audio", "image", "document"],
    },
  },
} as const
