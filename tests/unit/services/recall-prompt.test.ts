import { describe, it, expect, vi } from 'vitest'
import type { RelationshipView } from '@shared/graph-types'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildSystem, buildUserContent, formatRelationships, formatState, formatScene } = await import(
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
    confidence: 'confirmed',
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

  it('suffixes the document title with an epistemic tag for rumored/suspected notes (so the model hedges)', () => {
    const content = buildUserContent('q', [
      chunk({ entityName: 'Rumor', sessionLabel: null, confidence: 'rumored' }),
      chunk({ entityName: 'Hunch', sessionLabel: null, confidence: 'suspected' }),
      chunk({ entityName: 'Fact', sessionLabel: null, confidence: 'confirmed' })
    ])
    const titles = content
      .filter((b) => (b as { type?: string }).type === 'document')
      .map((b) => (b as { title: string }).title)
    expect(titles).toContain('Rumor · (rumored)')
    expect(titles).toContain('Hunch · (suspected)')
    expect(titles).toContain('Fact') // confirmed carries no tag
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
  it('formats the anchor + states, marks ended, and skips active entities with no status', () => {
    const out = formatState('Session 3 — The Redbrands', [
      { name: 'Iarno', type: 'npc', status: 'Defeated', lifecycle: 'ended' },
      { name: 'Mira', type: 'npc', status: null, lifecycle: 'active' },
      { name: 'End the Redbrands', type: 'quest', status: 'Completed', lifecycle: 'ended' }
    ])
    expect(out).toContain('most recent session is Session 3')
    expect(out).toContain('- Iarno (npc) [ended]: Defeated')
    expect(out).toContain('- End the Redbrands (quest) [ended]: Completed')
    expect(out).not.toContain('Mira') // active + no status → skipped
  })

  it('surfaces an ended entity even with no free-text status', () => {
    const out = formatState(null, [{ name: 'Gone', type: 'npc', status: null, lifecycle: 'ended' }])
    expect(out).toContain('- Gone (npc) [ended]')
  })

  it('marks presumed_ended as UNCONFIRMED so the model hedges, not asserts (C2)', () => {
    const out = formatState(null, [
      { name: 'Gundren', type: 'npc', status: 'Missing', lifecycle: 'presumed_ended' },
      { name: 'Vanished', type: 'creature', status: null, lifecycle: 'presumed_ended' }
    ])
    expect(out).toContain('- Gundren (npc) [presumed ended — unconfirmed]: Missing')
    expect(out).toContain('- Vanished (creature) [presumed ended — unconfirmed]') // surfaced w/o status
    expect(out).not.toContain('[ended]') // distinct from the confirmed-ended marker
  })

  it('uses an AS OF anchor (not "the present") when asOf is set', () => {
    const out = formatState(
      'Session 2',
      [{ name: 'X', type: 'npc', status: 'Alive', lifecycle: 'active' }],
      true
    )
    expect(out).toContain('AS OF Session 2')
    expect(out).not.toContain('the present')
  })

  it('returns null with no anchor and nothing to surface, but keeps a lone anchor', () => {
    expect(formatState(null, [{ name: 'X', type: 'npc', status: null, lifecycle: 'active' }])).toBeNull()
    expect(
      formatState('Session 1', [{ name: 'X', type: 'npc', status: null, lifecycle: 'active' }])
    ).toContain('Session 1')
  })

  it('buildUserContent inserts the state block (as present/FACT) before the query', () => {
    const content = buildUserContent('Q?', [], null, "- The party's most recent session is Session 3.")
    expect(content[content.length - 1]).toEqual({ type: 'text', text: 'Q?' })
    const text = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Session 3')
    expect(text).toContain('present')
  })
})

describe('scene grounding', () => {
  it('formatScene renders where/when/mode/party/facing/quest/here, and null when empty', () => {
    const block = formatScene({
      location: { name: 'Stonehill Inn', status: 'Safe', containerName: 'Phandalin' },
      quest: { name: 'Rescue Gundren', objective: 'Find and free Gundren' },
      nearbyPcNames: ['Elaria'],
      facingNames: ['Glasstaff'],
      hereNames: ['Toblen'],
      timeOfDay: 'Evening',
      mode: 'Combat',
      sceneSet: true
    })
    expect(block).toContain('Where: Stonehill Inn (in Phandalin) — Safe')
    expect(block).toContain('When: Evening')
    expect(block).toContain("What's happening: Combat")
    expect(block).toContain('Party present: Elaria')
    expect(block).toContain('In the scene: Glasstaff')
    expect(block).toContain('Pursuing: Rescue Gundren (Find and free Gundren)')
    expect(block).toContain('Also here: Toblen')

    expect(
      formatScene({
        location: null,
        quest: null,
        nearbyPcNames: [],
        facingNames: [],
        hereNames: [],
        timeOfDay: null,
        mode: null,
        sceneSet: false
      })
    ).toBeNull()
  })

  it('buildUserContent inserts the scene block after state, before relationships', () => {
    const content = buildUserContent('Q?', [], '- A owns B', '- state line', 'SCENE-BLOCK')
    const texts = content.map((b) => ('text' in b ? b.text : ''))
    const sceneIdx = texts.findIndex((t) => t === 'SCENE-BLOCK')
    expect(sceneIdx).toBeGreaterThan(texts.findIndex((t) => t.includes('state line')))
    expect(sceneIdx).toBeLessThan(texts.findIndex((t) => t.includes('A owns B')))
    expect(content[content.length - 1]).toEqual({ type: 'text', text: 'Q?' })
  })
})
