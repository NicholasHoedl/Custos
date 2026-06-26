import { describe, it, expect, beforeEach } from 'vitest'
import type { DbContext } from '../../../src/main/services/db-context'
import { createCampaign } from '../../../src/main/services/campaign.service'
import { createEntity } from '../../../src/main/services/entity.service'
import { createNote, deleteNote, listNotes } from '../../../src/main/services/note.service'
import { makeTestDb } from '../../helpers/test-db'

describe('note.service', () => {
  let ctx: DbContext
  let entityId: string

  beforeEach(() => {
    ctx = makeTestDb()
    const campaignId = createCampaign(ctx, { name: 'C' }).id
    entityId = createEntity(ctx, { campaignId, type: 'npc', name: 'Aldric' }).id
  })

  it('creates and lists notes for an entity', () => {
    createNote(ctx, { entityId, content: 'first' })
    createNote(ctx, { entityId, content: 'second' })
    const contents = listNotes(ctx, entityId).map((n) => n.content)
    expect(contents).toHaveLength(2)
    expect(contents).toContain('first')
    expect(contents).toContain('second')
  })

  it('deletes a single note, leaving the rest', () => {
    const keep = createNote(ctx, { entityId, content: 'keep' })
    const remove = createNote(ctx, { entityId, content: 'remove' })
    deleteNote(ctx, remove.id)
    const remaining = listNotes(ctx, entityId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(keep.id)
  })
})
