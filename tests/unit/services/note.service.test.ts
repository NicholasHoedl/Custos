import { describe, it, expect, beforeEach } from 'vitest'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import {
  createNote,
  deleteNote,
  listAllNotes,
  listNotesForEntity,
  listNotesForSession,
  updateNote
} from '../../../src/main/services/note.service'
import { createSession } from '../../../src/main/services/session.service'
import { makeTestDb } from '../../helpers/test-db'

describe('note.service (note ↔ many entities)', () => {
  let ctx: DbContext
  let campaignId: string
  let a: string
  let b: string

  beforeEach(() => {
    ctx = makeTestDb()
    campaignId = createCampaign(ctx, { name: 'C' }).id
    a = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' }).id
    b = createEntity(ctx, { campaignId, type: 'location', name: 'Copper Kettle' }).id
  })

  it('creates a note associated with multiple entities, deduping the input ids', () => {
    const note = createNote(ctx, { campaignId, entityIds: [a, b, a], content: 'they met at the inn' })
    expect(note.content).toBe('they met at the inn')
    expect(note.entityIds).toHaveLength(2) // duplicate `a` collapsed
    expect([...note.entityIds].sort()).toEqual([a, b].sort())
  })

  it('creates an entity-less note as campaign lore (ADR-021)', () => {
    const lore = createNote(ctx, { campaignId, entityIds: [], content: 'the runes mean "beware"' })
    expect(lore.entityIds).toEqual([])
    expect(lore.campaignId).toBe(campaignId)
    // It appears in the campaign feed even though it tags no entity.
    expect(listAllNotes(ctx, campaignId).map((n) => n.id)).toContain(lore.id)
  })

  it('lists a shared note under each of its entities, populated with all its entityIds', () => {
    const shared = createNote(ctx, { campaignId, entityIds: [a, b], content: 'shared' })
    createNote(ctx, { campaignId, entityIds: [a], content: 'only A' })

    expect(listNotesForEntity(ctx, a).map((n) => n.content).sort()).toEqual(['only A', 'shared'])
    const bNotes = listNotesForEntity(ctx, b)
    expect(bNotes.map((n) => n.content)).toEqual(['shared'])
    expect([...bNotes[0].entityIds].sort()).toEqual([a, b].sort())
    expect(bNotes[0].id).toBe(shared.id)
  })

  it('listAllNotes returns each note once (deduped), scoped to the campaign', () => {
    const shared = createNote(ctx, { campaignId, entityIds: [a, b], content: 'shared' }) // 2 links → must appear once
    const solo = createNote(ctx, { campaignId, entityIds: [a], content: 'solo' })

    const all = listAllNotes(ctx, campaignId)
    expect(all).toHaveLength(2)
    expect(all.map((n) => n.id).sort()).toEqual([shared.id, solo.id].sort())

    const other = createCampaign(ctx, { name: 'Other' }).id
    expect(listAllNotes(ctx, other)).toHaveLength(0)
  })

  it('updateNote replaces the entity links and edits content', () => {
    const note = createNote(ctx, { campaignId, entityIds: [a], content: 'v1' })
    const updated = updateNote(ctx, note.id, { content: 'v2', entityIds: [b] })

    expect(updated.content).toBe('v2')
    expect(updated.entityIds).toEqual([b])
    expect(listNotesForEntity(ctx, a)).toHaveLength(0) // unlinked from A
    expect(listNotesForEntity(ctx, b).map((n) => n.id)).toEqual([note.id]) // now under B
  })

  it('updateNote can clear all entity links, leaving the note as campaign lore', () => {
    const note = createNote(ctx, { campaignId, entityIds: [a], content: 'keep me' })
    const updated = updateNote(ctx, note.id, { entityIds: [] })
    expect(updated.entityIds).toEqual([])
    expect(listNotesForEntity(ctx, a)).toHaveLength(0) // unlinked from A
    expect(listAllNotes(ctx, campaignId).map((n) => n.id)).toContain(note.id) // but still in the campaign
  })

  it('deletes a note, removing it from every entity it was under', () => {
    const shared = createNote(ctx, { campaignId, entityIds: [a, b], content: 'shared' })
    deleteNote(ctx, shared.id)
    expect(listNotesForEntity(ctx, a)).toHaveLength(0)
    expect(listNotesForEntity(ctx, b)).toHaveLength(0)
  })

  it('round-trips confidence, defaulting to confirmed and patching it on update', () => {
    const rumor = createNote(ctx, {
      campaignId,
      entityIds: [a],
      content: 'heard a rumor',
      confidence: 'rumored'
    })
    expect(rumor.confidence).toBe('rumored')

    const plain = createNote(ctx, { campaignId, entityIds: [a], content: 'a plain fact' })
    expect(plain.confidence).toBe('confirmed') // default when omitted

    const promoted = updateNote(ctx, rumor.id, { confidence: 'confirmed' })
    expect(promoted.confidence).toBe('confirmed')
  })

  it('listNotesForSession returns only that session’s notes, populated with their entityIds', () => {
    const s1 = createSession(ctx, { campaignId }).id
    const s2 = createSession(ctx, { campaignId }).id
    const first = createNote(ctx, { campaignId, entityIds: [a, b], content: 'first', sessionId: s1 })
    createNote(ctx, { campaignId, entityIds: [a], content: 'second', sessionId: s1 })
    createNote(ctx, { campaignId, entityIds: [b], content: 'other session', sessionId: s2 })
    createNote(ctx, { campaignId, entityIds: [a], content: 'no session' }) // sessionId null → excluded

    const notes = listNotesForSession(ctx, s1)
    expect(notes.map((n) => n.content).sort()).toEqual(['first', 'second'])
    const got = notes.find((n) => n.id === first.id)!
    expect([...got.entityIds].sort()).toEqual([a, b].sort())
  })
})
