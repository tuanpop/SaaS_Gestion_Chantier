// lib/session-store.ts
// SERVEUR UNIQUEMENT — Node runtime obligatoire
//
// Interface abstraite ISessionStore + implementation PostgresSessionStore (D-054).
// Swappabilite preservee : V2 pourra introduire RedisSessionStore implementant la meme interface.
//
// D-3-002 : ce fichier est utilise UNIQUEMENT via lib/ouvrier-session.ts (helper centralise).
// Ne jamais importer session-store directement dans un Route Handler.

import type { OuvrierSession } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Type structurel minimal — evite les incompatibilites de parametres generiques
// entre @supabase/ssr et @supabase/supabase-js (pattern identique a lib/trial-gate.ts)
type AnySupabaseClient = Pick<SupabaseClient<Database>, 'from'>

// ============================================================
// Interface ISessionStore
// ============================================================

export interface ISessionStore {
  /** Cree une session avec TTL en secondes (D-051/PO-005 = 604800 = 7j) */
  create(sessionId: string, data: OuvrierSession, ttlSec: number): Promise<void>

  /**
   * Lit la session.
   * Renvoie null si expiree ou inexistante.
   * Cleanup lazy : WHERE expires_at > NOW() a chaque read (D-054 risque 4).
   */
  read(sessionId: string): Promise<OuvrierSession | null>

  /**
   * Sliding window : UPDATE expires_at = NOW() + ttlSec (D-051/PO-005).
   * Best-effort : si l'UPDATE echoue, la session reste valide jusqu'au TTL actuel.
   */
  touch(sessionId: string, ttlSec: number): Promise<void>

  /**
   * Invalidation cascade (D-3-011) : DELETE toutes sessions du user.
   * Retourne le nombre de sessions supprimees.
   * Appelee apres DELETE affectation pour invalider la session de l'ouvrier.
   */
  invalidateForUser(userId: string): Promise<number>

  /**
   * Suppression explicite d'une session (cas logout V2 — pas utilise Sprint 3).
   * Present dans l'interface pour completude et swappabilite future.
   */
  delete(sessionId: string): Promise<void>
}

// ============================================================
// PostgresSessionStore — implementation V1 (D-054)
// ============================================================

export class PostgresSessionStore implements ISessionStore {
  constructor(private readonly client: AnySupabaseClient) {}

  async create(sessionId: string, data: OuvrierSession, ttlSec: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString()
    // Cast vers Json via unknown — OuvrierSession est serialisable en JSON (pas de Symbol, Date, etc.)
    // Le type Json de database.ts est une union recursive qui n'accepte pas directement un objet type
    const { error } = await this.client.from('ouvrier_sessions').insert({
      session_id: sessionId,
      user_id: data.user_id,
      organisation_id: data.organisation_id,
      data: data as unknown as import('@/types/database').Json,
      expires_at: expiresAt,
    })
    if (error) throw new Error(`SessionStore.create: ${error.message}`)
  }

  async read(sessionId: string): Promise<OuvrierSession | null> {
    const nowIso = new Date().toISOString()
    const { data, error } = await this.client
      .from('ouvrier_sessions')
      .select('data')
      .eq('session_id', sessionId)
      .gt('expires_at', nowIso) // cleanup lazy — ignore les sessions expirees
      .maybeSingle()
    if (error || !data) return null
    return data.data as unknown as OuvrierSession
  }

  async touch(sessionId: string, ttlSec: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString()
    const { error } = await this.client
      .from('ouvrier_sessions')
      .update({ expires_at: expiresAt })
      .eq('session_id', sessionId)
    if (error) throw new Error(`SessionStore.touch: ${error.message}`)
  }

  async invalidateForUser(userId: string): Promise<number> {
    const { error, count } = await this.client
      .from('ouvrier_sessions')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
    if (error) throw new Error(`SessionStore.invalidateForUser: ${error.message}`)
    return count ?? 0
  }

  async delete(sessionId: string): Promise<void> {
    const { error } = await this.client
      .from('ouvrier_sessions')
      .delete()
      .eq('session_id', sessionId)
    if (error) throw new Error(`SessionStore.delete: ${error.message}`)
  }
}

// ============================================================
// Factory getSessionStore
// ============================================================
//
// Retourne une instance ISessionStore.
// V1 : PostgresSessionStore (D-054).
// V2 : pourra retourner RedisSessionStore si bascule (cf D-054 trigger conditions) :
//   - > 200 sessions simultanees, OU
//   - > 1 instance app concurrente
//
// Le caller (lib/ouvrier-session.ts) depend de cette factory uniquement —
// jamais de PostgresSessionStore directement.

export function getSessionStore(client: AnySupabaseClient): ISessionStore {
  return new PostgresSessionStore(client)
}
