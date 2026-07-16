import { describe, it, expect, vi, beforeEach } from 'vitest'

// Continuity "Fix" round-trip (ADR-056): the deterministic checks attach structured fix actions carrying REAL
// ids; applying them via the SAME primitives the renderer's hook uses (updateEntity / severLink) clears the
// finding on the next run. The AI pass is skipped (isAvailable = false) so only the deterministic half runs —
// everything else (DB, checks, apply) is REAL.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../src/main/services/embedding-index.service', () => ({
  indexEntity: vi.fn(),
  indexNote: vi.fn(),
  backfill: vi.fn()
}))
vi.mock('../../src/main/services/claude.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/services/claude.service')>()),
  isAvailable: () => false // skip the AI pass — exercise the deterministic checks + their fixes only
}))

import type { ContinuityFinding, ContinuityFixAction } from '@shared/continuity-types'
import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession } from '../../src/main/services/session.service'
import { createEntity, updateEntity, getEntity } from '../../src/main/services/entity.service'
import { createLink, severLink, listLinksForCampaign } from '../../src/main/services/link.service'
import { runContinuity } from '../../src/main/services/continuity.service'

const signal = new AbortController().signal
const byCategory = (fs: ContinuityFinding[], c: string): ContinuityFinding | undefined =>
  fs.find((f) => f.category === c)

beforeEach(() => vi.clearAllMocks())

describe('Continuity fix round-trip (ADR-056 deterministic fix actions)', () => {
  it('status-mismatch → set-lifecycle clears the finding on re-run', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    createSession(ctx, { campaignId })
    // Force a mismatch: an npc whose "Dead" status implies `ended`, but stored as `active`.
    const klarg = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Klarg',
      status: 'Dead',
      lifecycle: 'active'
    })

    const before = await runContinuity(ctx, { campaignId }, signal)
    const finding = byCategory(before.findings, 'status-mismatch')
    expect(finding?.fix?.actions).toHaveLength(1)
    const action = finding!.fix!.actions[0].action as Extract<
      ContinuityFixAction,
      { kind: 'set-lifecycle' }
    >
    expect(action).toMatchObject({ kind: 'set-lifecycle', entityId: klarg.id, lifecycle: 'ended' })

    // Apply exactly what the renderer's applyFix does for this action.
    updateEntity(ctx, action.entityId, { lifecycle: action.lifecycle })
    expect(getEntity(ctx, klarg.id)!.lifecycle).toBe('ended')

    const after = await runContinuity(ctx, { campaignId }, signal)
    expect(byCategory(after.findings, 'status-mismatch')).toBeUndefined()
  })

  it('faction-conflict → sever-tie clears the finding and closes the chosen tie', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    createSession(ctx, { campaignId })
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'Sildar' })
    const b = createEntity(ctx, { campaignId, type: 'npc', name: 'Iarno' })
    createLink(ctx, { campaignId, fromEntityId: a.id, toEntityId: b.id, relation: 'ally_of' })
    createLink(ctx, { campaignId, fromEntityId: a.id, toEntityId: b.id, relation: 'enemy_of' })

    const before = await runContinuity(ctx, { campaignId }, signal)
    const finding = byCategory(before.findings, 'faction-conflict')
    // Two sever options, each carrying a real interval id.
    expect(finding?.fix?.actions).toHaveLength(2)
    const severs = finding!.fix!.actions.map((x) => x.action) as Extract<
      ContinuityFixAction,
      { kind: 'sever-tie' }
    >[]
    expect(severs.every((s) => s.kind === 'sever-tie' && typeof s.linkId === 'string')).toBe(true)

    // Sever the first offered tie (the GM picks one).
    severLink(ctx, severs[0].linkId)

    const after = await runContinuity(ctx, { campaignId }, signal)
    expect(byCategory(after.findings, 'faction-conflict')).toBeUndefined()
    // One tie closed, one still open — the pair is no longer BOTH allies and enemies.
    const links = listLinksForCampaign(ctx, campaignId)
    expect(links.filter((l) => l.endSessionNumber === null)).toHaveLength(1)
    expect(links.filter((l) => l.endSessionNumber !== null)).toHaveLength(1)
  })
})
