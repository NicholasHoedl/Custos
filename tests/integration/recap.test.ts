import { describe, it, expect, vi, beforeEach } from 'vitest'

// Exercise the REAL recap orchestration (gather → stream → persist) on an in-memory DB; mock only the
// modules that touch electron / the network / the Claude SDK. Keep the real formatters; stub `recap`.
const { claudeRecapFn, isAvailableFn } = vi.hoisted(() => ({
  claudeRecapFn: vi.fn(),
  isAvailableFn: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '127.0.0.1', family: 4 }) }))
vi.mock('../../src/main/services/settings.service', () => ({
  getSettings: () => ({
    recallModel: 'claude-sonnet-4-6',
    suggestModel: 'claude-opus-4-8',
    suggestEffort: 'high',
    hotkey: ''
  })
}))
vi.mock('../../src/main/services/claude.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/services/claude.service')>()
  return { ...actual, isAvailable: isAvailableFn, recap: claudeRecapFn }
})

import { RECAP_CHUNK_CHANNEL, RECAP_DONE_CHANNEL } from '@shared/ipc-types'
import { makeTestDb } from '../helpers/test-db'
import { createCampaign } from '../../src/main/services/campaign.service'
import { createSession, getSession } from '../../src/main/services/session.service'
import { createEntity } from '../../src/main/services/entity.service'
import { createNote } from '../../src/main/services/note.service'
import { createEvent } from '../../src/main/services/event.service'
import { generateRecap } from '../../src/main/services/recap.service'

const sig = (): AbortSignal => new AbortController().signal

function collector(): { events: { channel: string; payload: unknown }[]; send: (c: string, p: unknown) => void } {
  const events: { channel: string; payload: unknown }[] = []
  return { events, send: (channel, payload) => events.push({ channel, payload }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  isAvailableFn.mockReturnValue(true)
})

describe('recap.service', () => {
  it('streams a recap, grounds it in the session, and saves it to the session summary', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'Phandelver' }).id
    const session = createSession(ctx, { campaignId })
    const glasstaff = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Glasstaff',
      status: 'Defeated'
    })
    createNote(ctx, {
      campaignId,
      entityIds: [glasstaff.id],
      content: 'Glasstaff led the Redbrands.',
      sessionId: session.id
    })
    createEvent(ctx, { sessionId: session.id, content: 'The party stormed the hideout.' })

    claudeRecapFn.mockImplementation(async (params: { onText: (t: string) => void }) => {
      params.onText('Previously, ')
      params.onText('the party won.')
    })

    const { events, send } = collector()
    await generateRecap(ctx, send, { requestId: 'r1', campaignId, sessionId: session.id }, sig())

    const streamed = events
      .filter((e) => e.channel === RECAP_CHUNK_CHANNEL)
      .map((e) => (e.payload as { text: string }).text)
      .join('')
    expect(streamed).toBe('Previously, the party won.')
    const done = events.find((e) => e.channel === RECAP_DONE_CHANNEL)
    expect((done?.payload as { reason: string }).reason).toBe('ok')
    // persisted to the session summary
    expect(getSession(ctx, session.id)?.summary).toBe('Previously, the party won.')

    // the beats + notes reached the Claude call
    const call = claudeRecapFn.mock.calls[0][0] as {
      input: { beats: string[]; notes: { content: string }[] }
    }
    expect(call.input.beats).toContain('The party stormed the hideout.')
    expect(call.input.notes.some((n) => n.content.includes('Redbrands'))).toBe(true)
  })

  it('returns reason "empty" and never calls Claude for a session with no beats or notes', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })

    const { events, send } = collector()
    await generateRecap(ctx, send, { requestId: 'r1', campaignId, sessionId: session.id }, sig())

    expect(
      (events.find((e) => e.channel === RECAP_DONE_CHANNEL)?.payload as { reason: string }).reason
    ).toBe('empty')
    expect(claudeRecapFn).not.toHaveBeenCalled()
    expect(getSession(ctx, session.id)?.summary).toBeNull()
  })

  it('returns reason "no_key" and leaves the summary untouched when no key is set', async () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    const npc = createEntity(ctx, { campaignId, type: 'npc', name: 'X' })
    createNote(ctx, { campaignId, entityIds: [npc.id], content: 'something happened', sessionId: session.id })
    isAvailableFn.mockReturnValue(false)

    const { events, send } = collector()
    await generateRecap(ctx, send, { requestId: 'r1', campaignId, sessionId: session.id }, sig())

    expect(
      (events.find((e) => e.channel === RECAP_DONE_CHANNEL)?.payload as { reason: string }).reason
    ).toBe('no_key')
    expect(claudeRecapFn).not.toHaveBeenCalled()
    expect(getSession(ctx, session.id)?.summary).toBeNull()
  })
})
