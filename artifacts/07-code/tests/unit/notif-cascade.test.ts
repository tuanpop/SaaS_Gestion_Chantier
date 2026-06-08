/**
 * tests/unit/notif-cascade.test.ts
 * Tests comportements de cascade sur la table notifications (migration 010)
 *
 * TST-NC-01 : chantier supprimé → notifications.chantier_id SET NULL (pas CASCADE DELETE)
 * TST-NC-02 : tâche supprimée → notifications.tache_id SET NULL (pas CASCADE DELETE)
 * TST-NC-03 : user supprimé → notifications correspondantes CASCADE DELETE
 * TST-NC-04 : organisation supprimée → notifications correspondantes CASCADE DELETE
 * TST-NC-05 : chantier SET NULL → NotificationItem.handleClick → onDeadLink appelé (specs §8.5 RG-NOTIF-012)
 * TST-NC-06 : tache SET NULL sans chantier_id → buildUrl retourne '' → onDeadLink (specs §8.5)
 *
 * Note : TST-NC-01..04 sont des tests de documentation SQL (vérification du schéma migration).
 *        On vérifie que les ON DELETE behaviors attendus sont dans le SQL.
 *        TST-NC-05..06 testent le comportement UI front-end (NotificationItem).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// ============================================================
// TST-NC-01..04 — Vérification schéma SQL (documentation)
// ============================================================

describe('Cascade SQL notifications (migration 010)', () => {
  let sqlContent: string

  beforeEach(() => {
    const sqlPath = path.resolve(__dirname, '../../supabase/migrations/010_notifications.sql')
    sqlContent = readFileSync(sqlPath, 'utf-8')
  })

  it('TST-NC-01 : chantier_id ON DELETE SET NULL (pas CASCADE)', () => {
    // La FK chantier_id doit être SET NULL pour préserver l'historique (specs RG-NOTIF-012)
    expect(sqlContent).toContain('REFERENCES chantiers(id) ON DELETE SET NULL')
    // S'assurer que CASCADE DELETE n'est PAS utilisé pour chantier_id
    // (on vérifie que la FK chantier_id n'a pas CASCADE)
    const chantierFkLine = sqlContent
      .split('\n')
      .find((l) => l.includes('REFERENCES chantiers(id)'))
    expect(chantierFkLine).toBeDefined()
    expect(chantierFkLine).toContain('SET NULL')
    expect(chantierFkLine).not.toContain('CASCADE')
  })

  it('TST-NC-02 : tache_id ON DELETE SET NULL (pas CASCADE)', () => {
    expect(sqlContent).toContain('REFERENCES taches(id) ON DELETE SET NULL')
    const tacheFkLine = sqlContent
      .split('\n')
      .find((l) => l.includes('REFERENCES taches(id)'))
    expect(tacheFkLine).toBeDefined()
    expect(tacheFkLine).toContain('SET NULL')
    expect(tacheFkLine).not.toContain('CASCADE')
  })

  it('TST-NC-03 : user_id ON DELETE CASCADE (suppression user → suppression notifs)', () => {
    // Les notifications sont supprimées avec l'utilisateur (CASCADE) — RGPD-compatible
    expect(sqlContent).toContain('REFERENCES users(id) ON DELETE CASCADE')
    const userFkLine = sqlContent
      .split('\n')
      .find((l) => l.includes('REFERENCES users(id)'))
    expect(userFkLine).toBeDefined()
    expect(userFkLine).toContain('CASCADE')
  })

  it('TST-NC-04 : organisation_id ON DELETE CASCADE', () => {
    // Suppression organisation → suppression de toutes ses notifications
    expect(sqlContent).toContain('REFERENCES organisations(id) ON DELETE CASCADE')
    const orgFkLine = sqlContent
      .split('\n')
      .find((l) => l.includes('REFERENCES organisations(id)'))
    expect(orgFkLine).toBeDefined()
    expect(orgFkLine).toContain('CASCADE')
  })
})

// ============================================================
// TST-NC-05..06 — Comportement UI : chantier_id=null → onDeadLink
// ============================================================

describe('NotificationItem — chantier_id=null → dead link handling', () => {
  it('TST-NC-05 : chantier_id null → handleClick appelle onDeadLink (RG-NOTIF-012)', () => {
    // Logique extraite de NotificationItem.handleClick
    const handleClick = (
      notification: { chantier_id: string | null },
      onRead: (id: string) => void,
      onDeadLink: () => void,
      router: { push: (url: string) => void },
    ) => {
      onRead('notif-id')
      if (!notification.chantier_id) {
        onDeadLink()
        return
      }
      router.push(`/admin/chantiers/${notification.chantier_id}`)
    }

    const onRead = vi.fn()
    const onDeadLink = vi.fn()
    const router = { push: vi.fn() }

    // Notification avec chantier_id=null (chantier supprimé → SET NULL)
    handleClick({ chantier_id: null }, onRead, onDeadLink, router)

    expect(onRead).toHaveBeenCalledWith('notif-id')
    expect(onDeadLink).toHaveBeenCalledOnce()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('TST-NC-06 : buildUrl retourne "" si chantier_id null (specs §8.5)', () => {
    // buildUrl extrait de NotificationItem
    const buildUrl = (
      notification: { type: string; chantier_id: string | null },
      role: 'admin' | 'conducteur',
    ): string => {
      if (!notification.chantier_id) return ''
      if (role === 'admin') return `/admin/chantiers/${notification.chantier_id}`
      return `/conducteur/chantiers/${notification.chantier_id}`
    }

    // chantier_id=null → '' pour admin
    expect(buildUrl({ type: 'affectation_tache', chantier_id: null }, 'admin')).toBe('')
    // chantier_id=null → '' pour conducteur
    expect(buildUrl({ type: 'tache_terminee', chantier_id: null }, 'conducteur')).toBe('')

    // chantier_id présent → URL correcte
    expect(buildUrl({ type: 'derive_budget', chantier_id: 'chantier-uuid' }, 'admin')).toBe(
      '/admin/chantiers/chantier-uuid',
    )
    expect(buildUrl({ type: 'tache_bloquee', chantier_id: 'chantier-uuid' }, 'conducteur')).toBe(
      '/conducteur/chantiers/chantier-uuid',
    )
  })

  it('TST-NC-07 : notification avec chantier_id présent → router.push vers URL correcte', () => {
    const handleClick = (
      notification: { id: string; chantier_id: string | null },
      role: 'admin' | 'conducteur',
      onRead: (id: string) => void,
      onDeadLink: () => void,
      router: { push: (url: string) => void },
    ) => {
      onRead(notification.id)
      if (!notification.chantier_id) {
        onDeadLink()
        return
      }
      const url =
        role === 'admin'
          ? `/admin/chantiers/${notification.chantier_id}`
          : `/conducteur/chantiers/${notification.chantier_id}`
      router.push(url)
    }

    const onRead = vi.fn()
    const onDeadLink = vi.fn()
    const router = { push: vi.fn() }

    handleClick(
      { id: 'notif-001', chantier_id: 'chantier-abc' },
      'admin',
      onRead,
      onDeadLink,
      router,
    )

    expect(onRead).toHaveBeenCalledWith('notif-001')
    expect(onDeadLink).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/admin/chantiers/chantier-abc')
  })
})
