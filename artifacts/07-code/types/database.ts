export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      organisations: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: Database["public"]["Enums"]["organisation_plan"]
          statut: Database["public"]["Enums"]["organisation_statut"]
          trial_ends_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: Database["public"]["Enums"]["organisation_plan"]
          statut?: Database["public"]["Enums"]["organisation_statut"]
          trial_ends_at: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: Database["public"]["Enums"]["organisation_plan"]
          statut?: Database["public"]["Enums"]["organisation_statut"]
          trial_ends_at?: string
        }
        Relationships: []
      }
      chantiers: {
        Row: {
          id: string
          organisation_id: string
          nom: string
          client_nom: string
          adresse: string
          code_postal: string
          budget_alloue: number | null
          budget_depense: number
          statut: Database["public"]["Enums"]["chantier_statut"]
          date_debut: string
          date_fin_prevue: string
          date_fin_reelle: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          nom: string
          client_nom: string
          adresse: string
          code_postal: string
          budget_alloue?: number | null
          budget_depense?: number
          statut?: Database["public"]["Enums"]["chantier_statut"]
          date_debut: string
          date_fin_prevue: string
          date_fin_reelle?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          nom?: string
          client_nom?: string
          adresse?: string
          code_postal?: string
          budget_alloue?: number | null
          budget_depense?: number
          statut?: Database["public"]["Enums"]["chantier_statut"]
          date_debut?: string
          date_fin_prevue?: string
          date_fin_reelle?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chantiers_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chantiers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      affectations: {
        Row: {
          id: string
          user_id: string
          chantier_id: string
          organisation_id: string
          vue: Database["public"]["Enums"]["affectation_vue"]
          date_debut: string
          date_fin: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          chantier_id: string
          organisation_id: string
          vue?: Database["public"]["Enums"]["affectation_vue"]
          date_debut: string
          date_fin?: string | null
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          chantier_id?: string
          organisation_id?: string
          vue?: Database["public"]["Enums"]["affectation_vue"]
          date_debut?: string
          date_fin?: string | null
          created_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affectations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affectations_chantier_id_fkey"
            columns: ["chantier_id"]
            isOneToOne: false
            referencedRelation: "chantiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affectations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      taches: {
        Row: {
          id: string
          chantier_id: string
          organisation_id: string
          titre: string
          description: string | null
          statut: Database["public"]["Enums"]["tache_statut"]
          assigned_to: string | null
          date_echeance: string | null
          bloque_raison: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          chantier_id: string
          organisation_id: string
          titre: string
          description?: string | null
          statut?: Database["public"]["Enums"]["tache_statut"]
          assigned_to?: string | null
          date_echeance?: string | null
          bloque_raison?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          chantier_id?: string
          organisation_id?: string
          titre?: string
          description?: string | null
          statut?: Database["public"]["Enums"]["tache_statut"]
          assigned_to?: string | null
          date_echeance?: string | null
          bloque_raison?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "taches_chantier_id_fkey"
            columns: ["chantier_id"]
            isOneToOne: false
            referencedRelation: "chantiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "taches_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "taches_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          has_supabase_auth: boolean
          id: string
          invitation_status:
            | Database["public"]["Enums"]["invitation_status"]
            | null
          nom: string
          organisation_id: string
          prenom: string
          qr_token: string | null
          role: Database["public"]["Enums"]["user_role"]
          telephone: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          has_supabase_auth?: boolean
          id?: string
          invitation_status?:
            | Database["public"]["Enums"]["invitation_status"]
            | null
          nom: string
          organisation_id: string
          prenom: string
          qr_token?: string | null
          role: Database["public"]["Enums"]["user_role"]
          telephone?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          has_supabase_auth?: boolean
          id?: string
          invitation_status?:
            | Database["public"]["Enums"]["invitation_status"]
            | null
          nom?: string
          organisation_id?: string
          prenom?: string
          qr_token?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          telephone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
    }
    Enums: {
      invitation_status: "pending" | "active" | "expired"
      organisation_plan: "starter" | "pro" | "business"
      organisation_statut:
        | "trial_active"
        | "trial_expired"
        | "active"
        | "suspended"
      user_role: "admin" | "conducteur" | "ouvrier"
      chantier_statut: "actif" | "archive"
      tache_statut: "a_faire" | "en_cours" | "termine" | "bloque"
      affectation_vue: "mes_taches" | "chantier_complet"
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

// ============================================================
// Alias de commodité pour les types d'enum fréquemment utilisés
// Évite d'écrire Database["public"]["Enums"]["user_role"] partout
// ============================================================

export type UserRole = Database["public"]["Enums"]["user_role"]
export type OrganisationStatut = Database["public"]["Enums"]["organisation_statut"]
export type OrganisationPlan = Database["public"]["Enums"]["organisation_plan"]
export type InvitationStatus = Database["public"]["Enums"]["invitation_status"]

// ============================================================
// Alias Sprint 2 — ENUMs des nouvelles tables
// ============================================================

export type ChantierStatut = Database["public"]["Enums"]["chantier_statut"]
export type TacheStatut = Database["public"]["Enums"]["tache_statut"]
export type AffectationVue = Database["public"]["Enums"]["affectation_vue"]

// ============================================================
// Interfaces Sprint 2 — types structurels des nouvelles tables
// ============================================================

export interface Chantier {
  id: string
  organisation_id: string
  nom: string
  client_nom: string
  adresse: string
  code_postal: string
  budget_alloue: number | null   // Q5 (2026-05-15) : nullable
  budget_depense: number
  statut: ChantierStatut
  date_debut: string             // ISO date YYYY-MM-DD
  date_fin_prevue: string
  date_fin_reelle: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Affectation {
  id: string
  user_id: string
  chantier_id: string
  organisation_id: string
  vue: AffectationVue
  date_debut: string
  date_fin: string | null
  created_by: string
  created_at: string
}

export interface Tache {
  id: string
  chantier_id: string
  organisation_id: string
  titre: string
  description: string | null
  statut: TacheStatut
  assigned_to: string | null
  date_echeance: string | null
  bloque_raison: string | null   // obligatoire (min 10 car.) si statut='bloque'
  created_by: string
  created_at: string
  updated_at: string
}

// ============================================================
// Types enrichis pour les réponses API (avec champs calculés ou joints)
// ============================================================

export type CouleurChantier = 'rouge' | 'orange' | 'vert'

export interface ChantierWithColoration extends Chantier {
  couleur: CouleurChantier
}

export interface TacheWithUser extends Tache {
  assigned_user?: {
    nom: string
    prenom: string
  } | null
}

export interface AffectationWithUser extends Affectation {
  user?: {
    nom: string
    prenom: string
    role: UserRole
  } | null
}

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      invitation_status: ["pending", "active", "expired"],
      organisation_plan: ["starter", "pro", "business"],
      organisation_statut: [
        "trial_active",
        "trial_expired",
        "active",
        "suspended",
      ],
      user_role: ["admin", "conducteur", "ouvrier"],
      // Sprint 2
      chantier_statut: ["actif", "archive"],
      tache_statut: ["a_faire", "en_cours", "termine", "bloque"],
      affectation_vue: ["mes_taches", "chantier_complet"],
    },
  },
} as const

