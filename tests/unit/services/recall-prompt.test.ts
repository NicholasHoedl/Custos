import { describe, it, expect, vi } from 'vitest'
import type { RelationshipView } from '@shared/graph-types'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildSystem, buildUserContent, formatRelationships, formatState } = await import(
  '../../../src/main/services/claude.service'
)
type Chunk = Parameters<typeof buildUserContent>[1][number]

function chunk(over: Partial<Chunk> = {}): Chunk {
  return {
    kind: 'note',
    entityId: 'e1',
    entityName: 'Glastav',
    entityType: 'npc',
    noteId: 'n1',
    sessionId: 's1',
    sessionLabel: 'Session 3',
    content: 'an evil wizard who leads the Redbrands',
    score: 0.9,
    ...over
  }
}

describe('recall prompt assembly', () => {
  it('in-character system carries campaign + persona + restraint, cached at the end', () => {
    const sys = buildSystem('in_character', {
      campaignName: 'Phandelver',
      campaignDescription: 'a frontier town',
      pcName: 'Vargas',
      persona: 'THE-CHARACTER-BRIEF'
    })
    const text = sys.map((b) => b.text).join('\n')
    expect(text).toContain('Phandelver')
    expect(text).toContain('THE-CHARACTER-BRIEF')
    expect(text.toLowerCase()).toContain('restraint')
    // The cacheable breakpoint is on the last (persona) block.
    expect(sys[sys.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('falls back to a factual system when there is no persona', () => {
    const sys = buildSystem('in_character', {
      campaignName: 'C',
      campaignDescription: null,
      pcName: null,
      persona: null
    })
    expect(sys).toHaveLength(1)
    expect(sys[0].text.toLowerCase()).toContain('only the retrieved notes')
  })

  it('user content is citeable document blocks followed by the query', () => {
    const content = buildUserContent('Who is Glastav?', [chunk()])
    const doc = content[0] as { type: string; title?: string; citations?: { enabled: boolean } }
    expect(doc.type).toBe('document')
    expect(doc.citations).toEqual({ enabled: true })
    expect(doc.title).toContain('Glastav')
    expect(doc.title).toContain('Session 3')
    expect(content[content.length - 1]).toEqual({ type: 'text', text: 'Who is Glastav?' })
  })
})

describe('relationship context (grounding)', () => {
  const view = (
    id: string,
    label: string,
    otherName: string,
    description: string | null = null
  ): RelationshipView =>
    ({
      link: { id, description },
      direction: 'out',
      label,
      other: { name: otherName }
    }) as unknown as RelationshipView

  it('formats relationships as factual lines, de-duped by edge id', () => {
    const out = formatRelationships([
      { name: 'Elaria', views: [view('l1', 'owns', 'Glass Staff', 'claimed it')] },
      { name: 'Glass Staff', views: [view('l1', 'owned by', 'Elaria')] } // same edge l1 → dropped
    ])
    expect(out).toContain('- Elaria owns Glass Staff (claimed it)')
    expect(out).not.toContain('owned by')
    expect(out?.split('\n')).toHaveLength(1)
  })

  it('returns null when there are no relationships', () => {
    expect(formatRelationships([{ name: 'Nobody', views: [] }])).toBeNull()
  })

  it('caps relationships per entity', () => {
    const views = Array.from({ length: 50 }, (_, i) => view(`e${i}`, 'knows', `P${i}`))
    const out = formatRelationships([{ name: 'Hub', views }], 6, 24)
    expect(out?.split('\n')).toHaveLength(6)
  })

  it('buildUserContent inserts the relationships block as FACT before the query', () => {
    const content = buildUserContent('Who?', [], '- Elaria owns Glass Staff')
    expect(content[content.length - 1]).toEqual({ type: 'text', text: 'Who?' })
    const text = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Elaria owns Glass Staff')
    expect(text).toContain('FACT')
  })

  it('buildUserContent omits the relationships block when there are none', () => {
    expect(buildUserContent('Who?', [])).toHaveLength(1) // just the query
  })
})

describe('current-state grounding', () => {
  it('formats the session anchor + entity statuses and skips null statuses', () => {
    const out = formatState('Session 3 — The Redbrands', [
      { name: 'Iarno', type: 'npc', status: 'Defeated' },
      { name: 'Mira', type: 'npc', status: null },
      { name: 'End the Redbrands', type: 'quest', status: 'Completed' }
    ])
    expect(out).toContain('most recent session is Session 3')
    expect(out).toContain('- Iarno (npc): Defeated')
    expect(out).toContain('- End the Redbrands (quest): Completed')
    expect(out).not.toContain('Mira')
  })

  it('returns null with no session and no statuses, but keeps a lone session anchor', () => {
    expect(formatState(null, [{ name: 'X', type: 'npc', status: null }])).toBeNull()
    expect(formatState('Session 1', [{ name: 'X', type: 'npc', status: null }])).toContain('Session 1')
  })

  it('buildUserContent inserts the state block (as present/FACT) before the query', () => {
    const content = buildUserContent('Q?', [], null, "- The party's most recent session is Session 3.")
    expect(content[content.length - 1]).toEqual({ type: 'text', text: 'Q?' })
    const text = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Session 3')
    expect(text).toContain('present')
  })
})
