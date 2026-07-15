import { describe, it, expect, vi, beforeEach } from 'vitest'

// Exercise the REAL enrich validation (shared with import, ADR-035) on an in-memory DB; mock electron /
// network / the Claude SDK call. enrichChangeset returns the raw two-array shape; we assert
// enrich.service cleans + post-filters it (real-id-only, subject-only, field whitelist).
const { enrichFn, isAvailableFn } = vi.hoisted(() => ({
  enrichFn: vi.fn(),
  isAvailableFn: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '127.0.0.1', family: 4 }) }))
vi.mock('../../../src/main/services/settings.service', () => ({
  getSettings: () => ({
    recallModel: 'claude-sonnet-4-6',
    suggestModel: 'claude-opus-4-8',
    suggestEffort: 'high',
    extractionModel: 'claude-sonnet-4-6',
    extractionEffort: 'medium',
    illuminateModel: 'claude-haiku-4-5',
    illuminateEffort: 'medium',
    hotkey: ''
  })
}))
vi.mock('../../../src/main/services/embedding-index.service', () => ({
  indexEntity: vi.fn(),
  indexNote: vi.fn(),
  backfill: vi.fn()
}))
vi.mock('../../../src/main/services/claude.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/claude.service')>()
  return { ...actual, isAvailable: isAvailableFn, enrichChangeset: enrichFn }
})
vi.mock('electron-log/main', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { makeTestDb } from '../../helpers/test-db'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createSession } from '../../../src/main/services/session.service'
import { createEntity, updateEntity } from '../../../src/main/services/entity.service'
import { createLink } from '../../../src/main/services/link.service'
import { createNote } from '../../../src/main/services/note.service'
import {
  enrichEntity,
  listTouchedEntities,
  selectEnrichRoster
} from '../../../src/main/services/enrich.service'

const sig = (): AbortSignal => new AbortController().signal

beforeEach(() => {
  vi.clearAllMocks()
  isAvailableFn.mockReturnValue(true)
})

describe('enrich.service — listTouchedEntities (the pre-flight checklist)', () => {
  it('unions the session notes’ entities with counts, excluding other sessions, sorted by count', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const s1 = createSession(ctx, { campaignId })
    const s2 = createSession(ctx, { campaignId })
    const a = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' })
    const b = createEntity(ctx, { campaignId, type: 'location', name: 'Barrow' })
    const c = createEntity(ctx, { campaignId, type: 'npc', name: 'Cora' })
    createNote(ctx, { campaignId, entityIds: [a.id, b.id], content: 'n1', sessionId: s1.id })
    createNote(ctx, { campaignId, entityIds: [a.id], content: 'n2', sessionId: s1.id })
    createNote(ctx, { campaignId, entityIds: [c.id], content: 'other session', sessionId: s2.id })
    createNote(ctx, { campaignId, entityIds: [c.id], content: 'undated' }) // no session → not counted

    const touched = listTouchedEntities(ctx, s1.id)
    expect(touched.map((t) => t.name)).toEqual(['Aldric', 'Barrow']) // count desc, then name
    expect(touched[0].noteCount).toBe(2)
    expect(touched[1].noteCount).toBe(1)
    expect(touched[0].type).toBe('npc')
  })

  it('returns empty for a session with no notes', () => {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const s = createSession(ctx, { campaignId })
    expect(listTouchedEntities(ctx, s.id)).toEqual([])
  })
})

describe('enrich.service — enrichEntity (validation + post-filters)', () => {
  function setup() {
    const ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    const session = createSession(ctx, { campaignId })
    const subject = createEntity(ctx, {
      campaignId,
      type: 'npc',
      name: 'Glasstaff',
      description: 'A wizard.',
      traits: ['Cautious']
    })
    const manor = createEntity(ctx, { campaignId, type: 'location', name: 'Tresendar Manor' })
    const spider = createEntity(ctx, { campaignId, type: 'npc', name: 'The Black Spider' })
    return { ctx, campaignId, session, subject, manor, spider }
  }

  it('keeps a valid form tie carrying the ADR-033 enrichment fields; drops #index and unknown refs', async () => {
    const { ctx, campaignId, session, subject, spider } = setup()
    enrichFn.mockResolvedValue({
      relationshipChanges: [
        {
          fromRef: subject.id,
          toRef: spider.id,
          relation: 'ally_of',
          action: 'form',
          description: 'serves him',
          fromDisposition: 'fearful',
          toDisposition: 'dismissive',
          confidence: 'suspected'
        },
        { fromRef: '#0', toRef: spider.id, relation: 'ally_of', action: 'form' }, // #index → dropped
        { fromRef: subject.id, toRef: 'nonexistent', relation: 'knows', action: 'form' } // unknown id → dropped
      ],
      fieldChanges: []
    })

    const res = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: subject.id },
      sig()
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.relationshipChanges).toHaveLength(1)
    const tie = res.relationshipChanges[0]
    expect(tie.relation).toBe('ally_of')
    expect(tie.description).toBe('serves him')
    expect(tie.fromDisposition).toBe('fearful')
    expect(tie.toDisposition).toBe('dismissive')
    expect(tie.confidence).toBe('suspected')
  })

  it('drops an already-live tie (either authoring direction) but keeps a narrated sever', async () => {
    const { ctx, campaignId, session, subject, manor } = setup()
    createLink(ctx, {
      campaignId,
      fromEntityId: subject.id,
      toEntityId: manor.id,
      relation: 'located_in'
    })
    enrichFn.mockResolvedValue({
      relationshipChanges: [
        // Same edge, authored from the OTHER side — still live → dropped (ADR-031 via findOpenLink).
        { fromRef: manor.id, toRef: subject.id, relation: 'contains', action: 'form' },
        // A sever of the live edge is a real change → kept.
        { fromRef: subject.id, toRef: manor.id, relation: 'located_in', action: 'sever' }
      ],
      fieldChanges: []
    })

    const res = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: subject.id },
      sig()
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.relationshipChanges).toHaveLength(1)
    expect(res.relationshipChanges[0].action).toBe('sever')
  })

  it('drops changes that do not involve the subject (ties) or target it (fields)', async () => {
    const { ctx, campaignId, session, subject, manor, spider } = setup()
    enrichFn.mockResolvedValue({
      relationshipChanges: [
        // Valid on its own, but neither endpoint is the subject → post-filtered out.
        { fromRef: spider.id, toRef: manor.id, relation: 'located_in', action: 'form' }
      ],
      fieldChanges: [
        // Valid shape, but targets another entity → post-filtered out.
        { entityRef: spider.id, field: 'traits', op: 'add', value: 'Sinister', oldValue: '' }
      ]
    })

    const res = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: subject.id },
      sig()
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.relationshipChanges).toHaveLength(0)
    expect(res.fieldChanges).toHaveLength(0)
  })

  it('field rules: description DROPPED, list alter DROPPED (ADR-055), no-ops dropped, mismatch dropped, off-whitelist dropped', async () => {
    const { ctx, campaignId, session, subject } = setup()
    enrichFn.mockResolvedValue({
      relationshipChanges: [],
      fieldChanges: [
        // Description is OFF the enrich whitelist now — Illuminate no longer edits the prose summary, so
        // this alter is DROPPED (the per-session sweep churned it with transient details).
        { entityRef: subject.id, field: 'description', op: 'alter', value: 'Iarno in disguise.', oldValue: '' },
        // A no-op description would drop anyway; now it drops off-whitelist too.
        { entityRef: subject.id, field: 'description', op: 'add', value: 'A wizard.', oldValue: '' },
        // List add is kept…
        { entityRef: subject.id, field: 'traits', op: 'add', value: 'Duplicitous', oldValue: '' },
        // …but a list ALTER is dropped even when oldValue matches verbatim (ADR-055: traits/goals/flaws
        // are add/cut only — Illuminate can't reword an item to track its progress)…
        { entityRef: subject.id, field: 'traits', op: 'alter', value: 'Wary', oldValue: 'Cautious' },
        // …and a non-verbatim list alter is dropped too.
        { entityRef: subject.id, field: 'traits', op: 'alter', value: 'X', oldValue: 'Not A Real Trait' },
        // A field outside traits/goals/flaws + the npc profile keys (description is off-whitelist too now)
        // → whitelist-dropped (F2).
        { entityRef: subject.id, field: 'mood', op: 'add', value: 'grumpy', oldValue: '' }
      ]
    })

    const res = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: subject.id },
      sig()
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.fieldChanges.map((f) => `${f.field}:${f.op}`)).toEqual(['traits:add'])
  })

  it('an empty model result is ok:true with empty arrays — the sweep steady-state', async () => {
    const { ctx, campaignId, session, subject } = setup()
    // Enrichment reads notes for grounding; give it one so the gather path runs.
    createNote(ctx, { campaignId, entityIds: [subject.id], content: 'n', sessionId: session.id })
    updateEntity(ctx, subject.id, { status: 'Alive' })
    enrichFn.mockResolvedValue({ relationshipChanges: [], fieldChanges: [] })

    const res = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: subject.id },
      sig()
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.relationshipChanges).toEqual([])
    expect(res.fieldChanges).toEqual([])
  })

  it('runs on the ILLUMINATE model/effort knobs, decoupled from extraction (ADR-051)', async () => {
    const { ctx, campaignId, session, subject } = setup()
    enrichFn.mockResolvedValue({ relationshipChanges: [], fieldChanges: [] })

    await enrichEntity(ctx, { campaignId, sessionId: session.id, entityId: subject.id }, sig())
    const call = enrichFn.mock.calls[0][0] as { model: string; effort: string }
    expect(call.model).toBe('claude-haiku-4-5') // illuminateModel — NOT extraction (sonnet) or suggest (opus)
    expect(call.effort).toBe('medium') // illuminateEffort
  })

  it('slims the roster to note-mentioned entities + live tie endpoints (ADR-035 cost tuning)', async () => {
    const { ctx, campaignId, session, subject, manor, spider } = setup()
    // Manor is a live TIE endpoint (never named in notes); Spider is NAMED in a note; Bystander is neither.
    createLink(ctx, {
      campaignId,
      fromEntityId: subject.id,
      toEntityId: manor.id,
      relation: 'located_in'
    })
    createNote(ctx, {
      campaignId,
      entityIds: [subject.id],
      content: 'He whispers about The Black Spider after dark.',
      sessionId: session.id
    })
    const bystander = createEntity(ctx, { campaignId, type: 'npc', name: 'Unrelated Bystander' })
    enrichFn.mockResolvedValue({ relationshipChanges: [], fieldChanges: [] })

    await enrichEntity(ctx, { campaignId, sessionId: session.id, entityId: subject.id }, sig())
    const call = enrichFn.mock.calls[0][0] as { existing: Array<{ id: string }> }
    const ids = call.existing.map((e) => e.id)
    expect(ids).toContain(manor.id) // tie endpoint — kept (a sever must reference it)
    expect(ids).toContain(spider.id) // named in the notes — kept
    expect(ids).not.toContain(bystander.id) // neither — dropped from the prompt
    expect(ids).not.toContain(subject.id) // never itself
  })

  it('guards: no_key (model never called), invalid entity, truncated → too_long', async () => {
    const { ctx, campaignId, session, subject } = setup()

    isAvailableFn.mockReturnValue(false)
    const noKey = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: subject.id },
      sig()
    )
    expect(noKey.ok).toBe(false)
    if (!noKey.ok) expect(noKey.reason).toBe('no_key')
    expect(enrichFn).not.toHaveBeenCalled()

    isAvailableFn.mockReturnValue(true)
    const bad = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: 'nonexistent' },
      sig()
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe('invalid')

    enrichFn.mockRejectedValue(new Error('truncated'))
    const long = await enrichEntity(
      ctx,
      { campaignId, sessionId: session.id, entityId: subject.id },
      sig()
    )
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.reason).toBe('too_long')
  })
})

describe('selectEnrichRoster (B1: roster scans the full note history)', () => {
  const spider = { id: 'spider', name: 'The Black Spider' }
  const manor = { id: 'manor', name: 'Tresendar Manor' } // a live tie endpoint, never named in notes
  const bystander = { id: 'bystander', name: 'Unrelated Bystander' }

  it('includes an entity mentioned only in an OLD note (beyond the prompt cap) + tie endpoints', () => {
    const notes = [
      { content: 'Session 1: he served The Black Spider.' }, // the ONLY mention — an "old" note
      ...Array.from({ length: 30 }, () => ({ content: 'later, unrelated goings-on' }))
    ]
    const ids = selectEnrichRoster([spider, manor, bystander], notes, new Set(['manor'])).map(
      (e) => e.id
    )
    expect(ids).toContain('spider') // named anywhere in history → kept (B1)
    expect(ids).toContain('manor') // tie endpoint → kept even though never named
    expect(ids).not.toContain('bystander') // neither → dropped
  })

  it('pins the main character even when neither named nor a tie endpoint, ranked first (guard #1)', () => {
    const pc = { id: 'pc', name: 'Alaeric Gray' } // the implicit narrator — never named in the note text
    const ids = selectEnrichRoster(
      [pc, spider, manor, bystander],
      [{ content: 'We spoke to The Black Spider.' }], // names Spider, NOT Alaeric
      new Set(['manor']),
      100,
      new Set(['pc'])
    ).map((e) => e.id)
    expect(ids[0]).toBe('pc') // pinned → ranked first, so it survives the cap and can be a tie endpoint
    expect(ids).toContain('spider') // still kept (named)
    expect(ids).toContain('manor') // still kept (tie endpoint)
    expect(ids).not.toContain('bystander')
  })

  it('respects the cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, name: `Name${i}` }))
    const notes = many.map((e) => ({ content: e.name }))
    expect(selectEnrichRoster(many, notes, new Set(), 25)).toHaveLength(25)
  })
})
