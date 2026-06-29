import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const {
  buildSuggestSystem,
  buildSuggestUserContent,
  buildDirectionsSystem,
  buildDirectionsUserContent,
  formatCampaignThreads
} = await import('../../../src/main/services/claude.service')
type Chunk = Parameters<typeof buildSuggestUserContent>[1][number]

function chunk(over: Partial<Chunk> = {}): Chunk {
  return {
    kind: 'note',
    entityId: 'e1',
    entityName: 'Glasstaff',
    entityType: 'npc',
    noteId: 'n1',
    sessionId: 's1',
    sessionLabel: 'Session 3',
    content: 'an evil wizard who leads the Redbrands',
    score: 0.9,
    ...over
  }
}

describe('suggest prompt assembly (attitudes)', () => {
  it('system carries campaign + persona brief (cached at the end) and the attitude taxonomy', () => {
    const sys = buildSuggestSystem({
      campaignName: 'Phandelver',
      campaignDescription: 'a frontier town',
      pcName: 'Vargas',
      persona: 'THE-CHARACTER-BRIEF'
    })
    const text = sys.map((b) => b.text).join('\n')
    expect(text).toContain('Phandelver')
    expect(text).toContain('THE-CHARACTER-BRIEF')
    // the seven-attitude taxonomy lives in the instructions
    expect(text).toContain('compassionate')
    expect(text).toContain('cynical')
    // the cacheable breakpoint is on the last (persona) block
    expect(sys[sys.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('user content uses PLAIN TEXT blocks (never document/citations) and ends with the situation', () => {
    const content = buildSuggestUserContent(
      'The mayor is corrupt — what do you do?',
      [chunk()],
      '- Glasstaff located_in Tresendar Manor',
      "- The party's most recent session is Session 3."
    )
    // No citeable document blocks — citations are incompatible with output_config.format.
    for (const block of content) {
      expect(block.type).toBe('text')
      expect((block as { citations?: unknown }).citations).toBeUndefined()
    }
    const text = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Redbrands') // note content
    expect(text).toContain('Tresendar Manor') // relationships block
    expect(text).toContain('Session 3') // state block
    expect(content[content.length - 1]).toEqual({
      type: 'text',
      text: 'The situation right now:\nThe mayor is corrupt — what do you do?'
    })
  })

  it('omits the note/state/relationship blocks when empty — only the situation remains', () => {
    const content = buildSuggestUserContent('Go?', [])
    expect(content).toHaveLength(1)
    expect(content[0]).toEqual({ type: 'text', text: 'The situation right now:\nGo?' })
  })
})

describe('directions prompt assembly', () => {
  it('system uses the directions instructions, with the persona brief cached at the end', () => {
    const sys = buildDirectionsSystem({
      campaignName: 'Phandelver',
      campaignDescription: null,
      pcName: 'Vargas',
      persona: 'THE-BRIEF'
    })
    const text = sys.map((b) => b.text).join('\n')
    expect(text).toContain('Phandelver')
    expect(text).toContain('THE-BRIEF')
    expect(text).toContain('DO NEXT') // directions instructions, not the attitudes prompt
    expect(text).toContain('quest') // the category taxonomy
    expect(sys[sys.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('formatCampaignThreads lists open quests (with objective) and the other party members', () => {
    const out = formatCampaignThreads(
      [
        { name: 'Rescue Gundren', status: 'Active', objective: 'Find and free Gundren' },
        { name: 'Clear the Cave', status: 'On Hold', objective: null }
      ],
      [{ name: 'Elaria' }, { name: 'Cassius' }]
    )
    expect(out).toContain('Rescue Gundren (Active): Find and free Gundren')
    expect(out).toContain('Clear the Cave (On Hold)')
    expect(out).toContain('Elaria')
    expect(out).toContain('Cassius')
  })

  it('returns null campaign-threads when there are no quests or PCs', () => {
    expect(formatCampaignThreads([], [])).toBeNull()
  })

  it('user content is plain text (no citations), threads first, situation last', () => {
    const content = buildDirectionsUserContent(
      'We just got back to town.',
      '- Rescue Gundren (Active)',
      [chunk()],
      '- Glasstaff located_in Tresendar Manor',
      '- most recent session is Session 3'
    )
    for (const block of content) {
      expect(block.type).toBe('text')
      expect((block as { citations?: unknown }).citations).toBeUndefined()
    }
    const text = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Rescue Gundren') // threads block
    expect(text).toContain('Redbrands') // note chunk content
    expect(content[content.length - 1]).toEqual({
      type: 'text',
      text: 'Where things stand right now:\nWe just got back to town.'
    })
  })

  it('falls back to a between-scenes prompt when the situation is empty', () => {
    const content = buildDirectionsUserContent('', null, [])
    expect(content).toHaveLength(1)
    expect((content[0] as { text: string }).text).toContain('between scenes')
  })
})

describe('scene block in suggest builders', () => {
  it('buildSuggestUserContent inserts the scene after state, before relationships', () => {
    const content = buildSuggestUserContent('S', [], '- A owns B', '- state line', 'SCENE-BLOCK')
    const texts = content.map((b) => ('text' in b ? b.text : ''))
    const sceneIdx = texts.findIndex((t) => t === 'SCENE-BLOCK')
    expect(sceneIdx).toBeGreaterThan(texts.findIndex((t) => t.includes('state line')))
    expect(sceneIdx).toBeLessThan(texts.findIndex((t) => t.includes('A owns B')))
  })

  it('buildDirectionsUserContent inserts the scene after state, before relationships', () => {
    const content = buildDirectionsUserContent(
      'S',
      null,
      [],
      '- A owns B',
      '- state line',
      'SCENE-BLOCK'
    )
    const texts = content.map((b) => ('text' in b ? b.text : ''))
    const sceneIdx = texts.findIndex((t) => t === 'SCENE-BLOCK')
    expect(sceneIdx).toBeGreaterThan(texts.findIndex((t) => t.includes('state line')))
    expect(sceneIdx).toBeLessThan(texts.findIndex((t) => t.includes('A owns B')))
  })
})
