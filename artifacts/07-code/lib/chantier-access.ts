// lib/chantier-access.ts
// Helper : vérification accès conducteur/admin à un chantier
//
// Décision Q1 (2026-05-15) :
//   Admin -> tous les chantiers de son organisation (RLS suffit)
//   Conducteur -> chantiers où il est created_by OU a une affectation active
//
// La vérification d'appartenance à l'organisation est garantie par la RLS Supabase
// (isolation_org sur la table chantiers). Ce helper ajoute la vérification de périmètre
// conducteur PAR DESSUS la RLS (defense en profondeur).
//
// I-06 : canAccessChantier retourne false sans distinguer "inexistant" de "hors périmètre"
// pour ne pas révéler d'information sur l'existence de ressources hors périmètre.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, UserRole } from '@/types/database'
import { ForbiddenError } from '@/lib/errors'
import { logger } from '@/lib/logger'

// Type structurel compatible avec createClient() et createServerClient()
type AnySupabaseClient = Pick<SupabaseClient<Database>, 'from'>

// ============================================================
// canAccessChantier — vérification non-bloquante
// ============================================================

/**
 * Vérifie qu'un utilisateur a le droit d'accéder à un chantier.
 *
 * - Admin : tous les chantiers de son organisation (RLS garantit l'isolation)
 * - Conducteur : chantiers dont il est created_by OU a une affectation (active ou passée)
 *
 * Retourne false si le chantier n'existe pas, est hors organisation, ou hors périmètre.
 * Ne distingue pas les cas (I-06) pour ne pas révéler d'information.
 */
export async function canAccessChantier(
  supabase: AnySupabaseClient,
  chantierId: string,
  organisationId: string,
  userId: string,
  role: UserRole,
): Promise<boolean> {
  // Admin : la RLS isolation_org est suffisante — vérifier juste que le chantier existe dans l'org
  if (role === 'admin') {
    const { data, error } = await supabase
      .from('chantiers')
      .select('id')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .maybeSingle()

    if (error) {
      logger.error(
        { error: error.message, chantierId, organisationId, userId },
        'chantier-access: erreur DB (admin check)',
      )
      return false
    }

    return data !== null
  }

  // Conducteur : created_by OU affecté
  if (role === 'conducteur') {
    // 1. Vérifier si le conducteur est le créateur du chantier
    const { data: createdChantier, error: errorCreated } = await supabase
      .from('chantiers')
      .select('id')
      .eq('id', chantierId)
      .eq('organisation_id', organisationId)
      .eq('created_by', userId)
      .maybeSingle()

    if (errorCreated) {
      logger.error(
        { error: errorCreated.message, chantierId, userId },
        'chantier-access: erreur DB (conducteur created_by check)',
      )
      return false
    }

    if (createdChantier !== null) {
      return true
    }

    // 2. Vérifier si le conducteur a une affectation sur ce chantier
    const { data: affectation, error: errorAffectation } = await supabase
      .from('affectations')
      .select('id')
      .eq('chantier_id', chantierId)
      .eq('user_id', userId)
      .eq('organisation_id', organisationId)
      .maybeSingle()

    if (errorAffectation) {
      logger.error(
        { error: errorAffectation.message, chantierId, userId },
        'chantier-access: erreur DB (conducteur affectation check)',
      )
      return false
    }

    return affectation !== null
  }

  // Ouvrier : pas d'accès JWT en Sprint 2 (Sprint 3 = QR + session Redis)
  // Les ouvriers n'ont pas de JWT Supabase (has_supabase_auth=false)
  return false
}

// ============================================================
// assertChantierAccess — throw ForbiddenError si pas d'accès
// ============================================================

/**
 * Vérifie l'accès et throw ForbiddenError si refusé.
 * Utilisé dans les handlers pour court-circuiter avec HTTP 403/404.
 *
 * Note : les handlers retournent 404 (I-06) pour ne pas révéler l'existence
 * de ressources hors périmètre. Le ForbiddenError est transformé en 404 dans les handlers.
 */
export async function assertChantierAccess(
  supabase: AnySupabaseClient,
  chantierId: string,
  organisationId: string,
  userId: string,
  role: UserRole,
): Promise<void> {
  const hasAccess = await canAccessChantier(
    supabase,
    chantierId,
    organisationId,
    userId,
    role,
  )

  if (!hasAccess) {
    throw new ForbiddenError()
  }
}
