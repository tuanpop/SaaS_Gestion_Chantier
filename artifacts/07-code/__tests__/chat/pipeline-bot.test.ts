/**
 * __tests__/chat/pipeline-bot.test.ts
 *
 * Tests lancerPipelineBot — orchestrateur fire-and-forget
 *
 * S-8-09 BINDING STRUCTURAL TEST : executerAction JAMAIS importé dans pipeline-bot.ts
 *   Vérifié via grep du fichier source + validation du comportement
 *
 * D-8-13 BINDING : pipeline crée des proposals 'pending' — JAMAIS exécute
 * D-8-10 BINDING : ne throw jamais (fire-and-forget)
 * D-8-17 BINDING : rate-limit 10 Sonnet/h/chantier → message system si atteint
 * D-8-11 BINDING : trial expiré → skip LLM silencieux
 * D-8-16 BINDING : toute erreur loggée, jamais propagée
 *
 * Cas couverts :
 *   STRUCT-1 : executerAction JAMAIS importé dans pipeline-bot.ts (S-8-09 structural)
 *   STRUCT-2 : pipeline-bot.ts importe register.ts en premier (D-8-19)
 *   TRIAL-1 : trial expiré → skip silencieux (pas de message bot)
 *   NEUTRE-1 : intention neutre → aucun message inséré
 *   RATE-1 : rate-limit atteint → message système inséré
 *   CLAW-1 : claw_inline → message bot inséré, pas de proposition
 *   ACTION-1 : action_a_proposer → proposition 'pending' créée, jamais exécutée
 *   ACTION-2 : payload null → pas de proposition créée
 *   ERR-1 : erreur interne → ne throw jamais
 *   ERR-2 : construireContexteBot null → abandon silencieux
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ============================================================
// TEST STRUCTURAL S-8-09 (avant toute import du module)
// ============================================================

describe('S-8-09 STRUCTURAL : executerAction jamais importé dans pipeline-bot.ts', () => {
  it('STRUCT-1 : grep executerAction dans le source pipeline-bot.ts = 0 occurrences', () => {
    const pipelineBotPath = resolve(
      __dirname,
      '../../lib/chat/pipeline-bot.ts',
    )
    const source = readFileSync(pipelineBotPath, 'utf-8')

    // S-8-09 BINDING : executerAction ne doit JAMAIS apparaître dans pipeline-bot.ts
    // Ni en import, ni en appel, ni en commentaire de code actif
    // (on tolère un commentaire d'audit "AUDIT S-8-09 : grep executerAction = 0")
    const occurrences = source.match(/executerAction/g) ?? []

    // On tolère uniquement les commentaires d'audit (contiennent "grep executerAction")
    // Le test vérifie que le mot n'apparaît qu'en commentaire d'audit
    const codeOccurrences = occurrences.filter((_) => {
      // Filtrer : chercher les lignes contenant executerAction
      const lines = source.split('\n').filter((l) => l.includes('executerAction'))
      // Toutes les occurrences doivent être dans des lignes de commentaire (// ou *)
      return lines.some((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    })

    expect(codeOccurrences).toHaveLength(0)
  })

  it('STRUCT-2 : pipeline-bot.ts importe register.ts en première ligne (D-8-19)', () => {
    const pipelineBotPath = resolve(
      __dirname,
      '../../lib/chat/pipeline-bot.ts',
    )
    const source = readFileSync(pipelineBotPath, 'utf-8')
    const lines = source.split('\n')

    // Trouver la première ligne non-vide non-commentaire
    let firstImportLine = ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '') {
        continue
      }
      firstImportLine = trimmed
      break
    }

    // D-8-19 BINDING : le premier import doit être register.ts
    expect(firstImportLine).toContain("import '@/lib/llm/register'")
  })
})

// ============================================================
// Mocks hoisted
// ============================================================

const {
  mockAdminFrom,
  mockLogger,
  mockCheckRateLimit,
  mockCheckTrialGate,
  mockConstruireContexteBot,
  mockDetecterIntention,
  mockExtraireActionPayload,
  mockGenererReponseClawInline,
} = vi.hoisted(() => {
  const mockAdminFrom = vi.fn()
  return {
    mockAdminFrom,
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    mockCheckRateLimit: vi.fn(),
    mockCheckTrialGate: vi.fn(),
    mockConstruireContexteBot: vi.fn(),
    mockDetecterIntention: vi.fn(),
    mockExtraireActionPayload: vi.fn(),
    mockGenererReponseClawInline: vi.fn(),
  }
})

vi.mock('@/lib/llm/register', () => ({}))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))
vi.mock('@/lib/cache', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/lib/trial-gate', () => ({ checkTrialGate: mockCheckTrialGate }))
vi.mock('@/lib/chat/construireContexteBot', () => ({ construireContexteBot: mockConstruireContexteBot }))
vi.mock('@/lib/chat/detecterIntention', () => ({ detecterIntention: mockDetecterIntention }))
vi.mock('@/lib/chat/extraireAction', () => ({
  extraireActionPayload: mockExtraireActionPayload,
  genererReponseClawInline: mockGenererReponseClawInline,
}))

// Import APRÈS mocks
import { lancerPipelineBot } from '@/lib/chat/pipeline-bot'

// ============================================================
// Fixtures
// ============================================================

const CHANTIER_ID = 'chantier-uuid-0000-0000-000000000001'
const ORG_ID = 'org-uuid-0000-0000-0000-000000000001'
const MESSAGE_ID = 'msg-uuid-0000-0000-0000-000000000001'
const CHAT_ID = 'chat-uuid-0000-0000-0000-000000000001'

const baseParams = {
  messageId: MESSAGE_ID,
  contenu: 'Bonjour !',
  chantierId: CHANTIER_ID,
  chatId: CHAT_ID,
  organisationId: ORG_ID,
  roleAppelant: 'conducteur' as const,
}

const contexteFixture = {
  chantier: { id: CHANTIER_ID, nom: 'Test', statut: 'actif', date_debut: null, date_fin_prevue: null },
  taches: [],
  membres: [],
  derives_actives: [],
  role_appelant: 'conducteur' as const,
}

// Helper : mock adminClient insert/upsert (for messages + action_proposals)
function makeInsertMock(returnData: { id: string } = { id: 'new-uuid' }) {
  const singleFn = vi.fn().mockResolvedValue({ data: returnData, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    error: null,
  })
  const eqFn = vi.fn().mockReturnThis()
  return { insert: insertFn, select: selectFn, single: singleFn, update: updateFn, eq: eqFn }
}

// ============================================================
// Tests
// ============================================================

describe('lancerPipelineBot — orchestrateur fire-and-forget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TRIAL-1 : trial expiré → retour silencieux sans LLM ni message bot (D-8-11)', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: true, reason: 'trial_expired' })

    await lancerPipelineBot(baseParams)

    // Aucun appel LLM
    expect(mockDetecterIntention).not.toHaveBeenCalled()
    expect(mockExtraireActionPayload).not.toHaveBeenCalled()
    // Aucun message inséré
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })

  it('NEUTRE-1 : intention neutre → aucun message bot inséré', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockResolvedValueOnce({ type: 'neutre' })

    await lancerPipelineBot(baseParams)

    // Sonnet ne doit pas être appelé (neutre → arrêt après Haiku)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockExtraireActionPayload).not.toHaveBeenCalled()
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })

  it('RATE-1 : rate-limit Sonnet atteint → message système inséré (D-8-17)', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockResolvedValueOnce({ type: 'action_a_proposer', action_type: 'creer_tache' })
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: new Date() })

    // Mock adminClient insert (message system)
    const singleFn = vi.fn().mockResolvedValue({ data: { id: 'sys-msg-id' }, error: null })
    const selectFn = vi.fn().mockReturnValue({ single: singleFn })
    const insertFn = vi.fn().mockReturnValue({ select: selectFn })
    mockAdminFrom.mockReturnValue({ insert: insertFn })

    await lancerPipelineBot(baseParams)

    // Vérifier que checkRateLimit a été appelé avec la bonne clé (D-8-17)
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: `sonnet-chat:${CHANTIER_ID}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
    })

    // Un message système doit être inséré (rate-limit info)
    expect(mockAdminFrom).toHaveBeenCalledWith('messages')
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        contenu: expect.stringContaining('temporairement limité'),
      }),
    )
  })

  it('CLAW-1 : claw_inline → message bot inséré, pas de proposition créée (D-8-13)', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockResolvedValueOnce({ type: 'claw_inline', question: 'combien de tâches ?' })
    mockCheckRateLimit.mockReturnValueOnce({ allowed: true, remaining: 9, resetAt: new Date() })
    mockConstruireContexteBot.mockResolvedValueOnce(contexteFixture)
    mockGenererReponseClawInline.mockResolvedValueOnce('Il reste 3 tâches en cours.')

    const singleFn = vi.fn().mockResolvedValue({ data: { id: 'bot-msg-id' }, error: null })
    const selectFn = vi.fn().mockReturnValue({ single: singleFn })
    const insertFn = vi.fn().mockReturnValue({ select: selectFn })
    mockAdminFrom.mockReturnValue({ insert: insertFn })

    await lancerPipelineBot(baseParams)

    // Message bot inséré
    expect(mockAdminFrom).toHaveBeenCalledWith('messages')
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bot',
        contenu: 'Il reste 3 tâches en cours.',
      }),
    )

    // Aucune proposition créée (D-8-13)
    const insertCalls = insertFn.mock.calls as Array<Array<Record<string, unknown>>>
    const proposalInserts = insertCalls.filter(
      (args) => !!(args[0] && typeof args[0] === 'object' && 'statut' in args[0]),
    )
    // Si une proposition était insérée, elle aurait la clé 'statut'
    // On vérifie qu'aucun appel n'a inseré dans action_proposals
    const proposalFromCalls = (mockAdminFrom.mock.calls as Array<Array<string>>).filter(
      (args) => args[0] === 'action_proposals',
    )
    expect(proposalFromCalls).toHaveLength(0)
  })

  it('ACTION-1 : action_a_proposer → proposition pending créée (D-8-13), jamais exécutée', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockResolvedValueOnce({
      type: 'action_a_proposer',
      action_type: 'creer_tache',
    })
    mockCheckRateLimit.mockReturnValueOnce({ allowed: true, remaining: 9, resetAt: new Date() })
    mockConstruireContexteBot.mockResolvedValueOnce(contexteFixture)
    mockExtraireActionPayload.mockResolvedValueOnce({ titre: 'Fondations', description: 'Zone nord' })

    // Mock pour action_proposals insert + messages insert
    let callCount = 0
    const singleFn = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Insert action_proposals
        return Promise.resolve({ data: { id: 'proposal-id-001' }, error: null })
      }
      // Insert message bot confirmation
      return Promise.resolve({ data: { id: 'bot-msg-confirm' }, error: null })
    })
    const selectFn = vi.fn().mockReturnValue({ single: singleFn })
    const insertFn = vi.fn().mockReturnValue({ select: selectFn })
    const updateFn = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      error: null,
      then: vi.fn().mockResolvedValue({ error: null }),
    })
    // Pour l'update messages (liaison action_proposal_id), on simule aussi
    const eqChainFn = vi.fn().mockResolvedValue({ error: null })
    const updateEqFn = vi.fn().mockReturnValue({ eq: eqChainFn })

    mockAdminFrom.mockImplementation((tableName: string) => {
      if (tableName === 'messages') {
        return {
          insert: insertFn,
          update: () => ({ eq: () => ({ eq: eqChainFn }) }),
        }
      }
      if (tableName === 'action_proposals') {
        return { insert: insertFn }
      }
      return { insert: insertFn, update: updateFn }
    })

    await lancerPipelineBot(baseParams)

    // Vérifier que action_proposals a été inséré avec statut 'pending'
    const proposalFromCalls = (mockAdminFrom.mock.calls as Array<Array<string>>).filter(
      (args) => args[0] === 'action_proposals',
    )
    expect(proposalFromCalls.length).toBeGreaterThan(0)

    // Vérifier que le payload inséré contient statut 'pending' et les bonnes IDs (D-8-14)
    const proposalInsertCall = insertFn.mock.calls.find((args) => {
      const arg = args[0] as Record<string, unknown>
      return arg && arg['statut'] === 'pending'
    })
    expect(proposalInsertCall).toBeDefined()
    if (proposalInsertCall) {
      const arg = proposalInsertCall[0] as Record<string, unknown>
      expect(arg['statut']).toBe('pending')
      // D-8-14 : chantier_id/organisation_id du server (params), jamais du payload LLM
      expect(arg['chantier_id']).toBe(CHANTIER_ID)
      expect(arg['organisation_id']).toBe(ORG_ID)
    }
  })

  it('ACTION-2 : payload extraction null → pas de proposition créée', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockResolvedValueOnce({
      type: 'action_a_proposer',
      action_type: 'creer_tache',
    })
    mockCheckRateLimit.mockReturnValueOnce({ allowed: true, remaining: 9, resetAt: new Date() })
    mockConstruireContexteBot.mockResolvedValueOnce(contexteFixture)
    mockExtraireActionPayload.mockResolvedValueOnce(null) // extraction échoue

    await lancerPipelineBot(baseParams)

    // Aucune proposition créée, aucun message bot
    const proposalFromCalls = (mockAdminFrom.mock.calls as Array<Array<string>>).filter(
      (args) => args[0] === 'action_proposals',
    )
    expect(proposalFromCalls).toHaveLength(0)
    const messageFromCalls = (mockAdminFrom.mock.calls as Array<Array<string>>).filter(
      (args) => args[0] === 'messages',
    )
    expect(messageFromCalls).toHaveLength(0)
  })

  it('ERR-1 : erreur interne (checkTrialGate throw) → jamais throw (D-8-16)', async () => {
    mockCheckTrialGate.mockRejectedValueOnce(new Error('DB connection lost'))

    // BINDING D-8-16 : ne throw jamais (fire-and-forget)
    await expect(lancerPipelineBot(baseParams)).resolves.toBeUndefined()
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('ERR-2 : construireContexteBot null → abandon silencieux', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockResolvedValueOnce({ type: 'claw_inline', question: 'test ?' })
    mockCheckRateLimit.mockReturnValueOnce({ allowed: true, remaining: 9, resetAt: new Date() })
    mockConstruireContexteBot.mockResolvedValueOnce(null) // contexte introuvable

    await lancerPipelineBot(baseParams)

    // Aucun message bot inséré
    expect(mockAdminFrom).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ chantierId: CHANTIER_ID }),
      expect.stringContaining('contexte bot introuvable'),
    )
  })

  it('D-8-17 : clé rate-limit = sonnet-chat:${chantierId} (binding)', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockResolvedValueOnce({ type: 'action_a_proposer', action_type: 'alerte' })
    mockCheckRateLimit.mockReturnValueOnce({ allowed: true, remaining: 5, resetAt: new Date() })
    mockConstruireContexteBot.mockResolvedValueOnce(contexteFixture)
    mockExtraireActionPayload.mockResolvedValueOnce(null)

    await lancerPipelineBot(baseParams)

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `sonnet-chat:${CHANTIER_ID}`,
        limit: 10,
        windowMs: 3600000,
      }),
    )
  })

  it('ERR-3 : detecterIntention throw → fallback neutre (D-8-16)', async () => {
    mockCheckTrialGate.mockResolvedValueOnce({ blocked: false })
    mockDetecterIntention.mockRejectedValueOnce(new Error('Haiku unavailable'))

    await lancerPipelineBot(baseParams)

    // Fallback neutre → pas de Sonnet, pas de message
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockAdminFrom).not.toHaveBeenCalled()
    // Logger.error appelé pour le throw inattendu
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Haiku unavailable' }),
      expect.stringContaining('fallback neutre'),
    )
  })
})
