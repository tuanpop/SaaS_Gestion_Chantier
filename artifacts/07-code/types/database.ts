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
          // Sprint 3 — migration 006 (D-051/PO-014)
          // JAMAIS expose via /api/ouvrier/* — D-3-004 BINDING
          note_privee_conducteur: string | null
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
          note_privee_conducteur?: string | null
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
          note_privee_conducteur?: string | null
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
      ouvrier_sessions: {
        Row: {
          session_id: string
          user_id: string
          organisation_id: string
          data: Json
          created_at: string
          expires_at: string
        }
        Insert: {
          session_id?: string
          user_id: string
          organisation_id: string
          data: Json
          created_at?: string
          expires_at: string
        }
        Update: {
          session_id?: string
          user_id?: string
          organisation_id?: string
          data?: Json
          created_at?: string
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ouvrier_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ouvrier_sessions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      // Sprint 4 — D-019 (mise a jour manuelle requise car piege TS Windows UTF-16)
      // Table photos (migration 008) — HEIC retire (D-056/PO-4-02 amende 2026-06-07)
      photos: {
        Row: {
          id: string
          tache_id: string
          organisation_id: string
          uploader_id: string
          storage_path: string              // JAMAIS expose API (D-4-006)
          commentaire: string | null
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp'
          taille_octets: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tache_id: string
          organisation_id: string
          uploader_id: string
          storage_path: string
          commentaire?: string | null
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp'
          taille_octets: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tache_id?: string
          organisation_id?: string
          uploader_id?: string
          storage_path?: string
          commentaire?: string | null
          mime_type?: 'image/jpeg' | 'image/png' | 'image/webp'
          taille_octets?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_tache_id_fkey"
            columns: ["tache_id"]
            isOneToOne: false
            referencedRelation: "taches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_uploader_id_fkey"
            columns: ["uploader_id"]
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
          deleted_at: string | null
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
          deleted_at?: string | null
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
          deleted_at?: string | null
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
  // Sprint 3 — migration 006 (D-051/PO-014) — JAMAIS expose via /api/ouvrier/* (D-3-004)
  note_privee_conducteur: string | null
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
    telephone?: string | null  // S4-F02 — affichage conducteur (RG-TEL-001)
  } | null
}

// ============================================================
// Types dedies vue ouvrier — Sprint 3 (D-3-008 + D-3-004)
// ============================================================
// SECURITE : note_privee_conducteur est INTENTIONNELLEMENT ABSENTE de tous ces types.
// Defense par compilation TypeScript (K3-CR-02 niveau 2/4).
// Toute tentative d'inclure ce champ echoue au build.
// ============================================================

export type TacheOuvrier = {
  id: string
  titre: string
  statut: 'a_faire' | 'en_cours' | 'termine' | 'bloque'
  // AUDIT: note_privee_conducteur JAMAIS inclus — D-3-004 BINDING
}

// ============================================================
// Sprint 4 — types photos (D-4-007 breaking change, D-4-019)
// SECURITE : storage_path JAMAIS dans PhotoOuvrierDisplay ni PhotoConducteurDisplay (D-4-006)
// ============================================================

/** Row complete interne (jamais renvoyee brute au client — D-4-006) */
export interface Photo {
  id: string
  tache_id: string
  organisation_id: string
  uploader_id: string
  storage_path: string              // JAMAIS expose API (D-4-006)
  commentaire: string | null
  // HEIC retire (D-056/PO-4-02 amende 2026-06-07) : whitelist stricte JPEG/PNG/WebP
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp'
  taille_octets: number
  created_at: string
  updated_at: string
}

/**
 * Contrat API client ouvrier — PAS de storage_path (D-4-006)
 * BREAKING (D-4-007) : ancien PhotoOuvrier.url -> renomme signed_url dans TOUS les callers.
 */
export interface PhotoOuvrierDisplay {
  id: string
  commentaire: string | null
  created_at: string
  uploader_id: string               // pour is_mine cote UI
  signed_url: string                // ajoutee serveur (TTL 1h), jamais en DB — K4-MED-04 (pino redact)
}

/**
 * F005/D-4-019 — props server->client conducteur, PAS de storage_path
 * Generee server-side dans conducteur/chantiers/[id]/page.tsx
 */
export interface PhotoConducteurDisplay {
  id: string
  tache_id: string
  commentaire: string | null
  created_at: string
  uploader_id: string
  uploader_nom?: string             // optionnel (affichage auteur dans la grille moderation)
  signed_url: string                // generee server-side (signPhotoPaths), jamais en DB
}

/**
 * @deprecated Sprint 3 uniquement — utiliser PhotoOuvrierDisplay (D-4-007 breaking change)
 * Conserve temporairement pour eviter des erreurs de compilation en cascade.
 * A supprimer quand tous les callers sont migres.
 */
export type PhotoOuvrier = PhotoOuvrierDisplay

// TacheMienne et TacheAutre sont STRICTEMENT DISJOINTES (D-3-008).
// Le discriminant `is_mine` est un literal type, pas une prop partagee.
// TypeScript empeche de passer une TacheAutre la ou une TacheMienne est attendue.

export type TacheMienne = TacheOuvrier & {
  is_mine: true
  description_complete: string | null
  description_courte: string | null
  bloque_raison: string | null
  date_echeance: string | null
  // D-4-007 BREAKING CHANGE : photos_count supprime, remplace par photos: PhotoOuvrierDisplay[]
  // count = photos.length
  photos: PhotoOuvrierDisplay[]
  photos_truncated?: boolean
}

export type TacheAutre = TacheOuvrier & {
  is_mine: false
  description_courte: string | null
  // TacheAutre : aucune photo exposee (D-3-024 coherent D-4-007)
}

export type GetChantierOuvrierResponse = {
  chantier: {
    id: string
    nom: string
    client_nom: string
    adresse: string
    code_postal: string
    statut: string
    date_debut: string | null
    date_fin_prevue: string | null
  }
  taches: Array<TacheMienne | TacheAutre>
  conducteur: {
    nom: string
    prenom: string
    telephone: string | null
  }
}

// ============================================================
// Interface session Redis ouvrier (D-3-003)
// ============================================================

export interface OuvrierSession {
  user_id: string
  organisation_id: string
  role: 'ouvrier'
  affectations: Array<{
    affectation_id: string
    chantier_id: string
    // PO-3-03 : ignore en Sprint 3 — vue moyenne forcee pour tous
    vue: 'mes_taches' | 'chantier_complet'
  }>
  created_at: number
}

// ============================================================
// Sprint 4 Visibilité — types notifications (D-019 : extension manuelle)
// Ajout manuel requis car piège TS Windows UTF-16 (pattern établi Sprint 4)
// SECURITE : note_privee_conducteur et storage_path JAMAIS dans ces types (K4V-09, RG-NOTIF-014/015)
// ============================================================

export type NotificationType =
  | 'affectation_tache'
  | 'tache_terminee'
  | 'tache_bloquee'
  | 'derive_budget'
  | 'echeance_chantier'
  | 'echeance_tache'
  | 'derive_proactive'  // Sprint 6 — détection proactive cron (migration 014 ADD VALUE)
  | 'briefing_lundi'    // Sprint 7 — briefing automatique lundi matin (migration 016 ADD VALUE)

export interface Notification {
  id: string
  organisation_id: string
  user_id: string
  type: NotificationType
  titre: string
  message: string
  chantier_id: string | null
  tache_id: string | null
  lu: boolean
  read_at: string | null  // ISO 8601
  created_at: string       // ISO 8601
}

/** Shape renvoyée au client (identique à Notification — storage_path et note_privee n'existent pas ici) */
export type NotificationDisplay = Notification

/** Réponse de GET /api/notifications */
export interface NotificationsListResponse {
  notifications: NotificationDisplay[]
  unread_count: number
  next_cursor: string | null  // ISO 8601 created_at du dernier item, null si fin
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

