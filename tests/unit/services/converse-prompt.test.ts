import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildConverseSystem, buildConverseUserContent, confidenceTag } = await import(
  '../../../src/main/services/claude.service'
)

const TARGET = { name: 'Glasstaff', type: 'npc', status: null, lifecycle: 'active' as const }

describe('converse prompt assembly', () => {
  it('system carries the campaign + persona brief (cached at the end) and the Converse instructions', () => {
    const sys = buildConverseSystem({
      campaignName: 'Phandelver',
      campaignDescription: 'a frontier town',
      pcName: 'Vargas',
      pcRace: 'elf',
      pcClass: 'wizard',
      persona: 'THE-CHARACTER-BRIEF'
    })
    const text = sys.map((b) => b.text).join('\n')
    expect(text).toContain('Phandelver')
    expect(text).toContain('THE-CHARACTER-BRIEF')
    // The Converse instructions (a briefing + questions), NOT the Suggest prompt.
    expect(text).toContain('BRIEFING')
    expect(text).toContain('QUESTIONS')
    expect(text).toContain('elf wizard') // race/class stated for prompt parity
    // The cacheable breakpoint is on the last (persona) block.
    expect(sys[sys.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('confidenceTag marks rumored/suspected notes and leaves confirmed unmarked', () => {
    expect(confidenceTag('rumored')).toBe(' · (rumored)')
    expect(confidenceTag('suspected')).toBe(' · (suspected)')
    expect(confidenceTag('confirmed')).toBe('')
  })

  it('user content is plain text (no citations), leads with the target, tags a rumored note, ends with the ask', () => {
    const content = buildConverseUserContent({
      target: TARGET,
      notes: [
        { confidence: 'confirmed', content: 'Leads the Redbrands.' },
        { confidence: 'rumored', content: 'Might answer to the Black Spider.' }
      ],
      connections: '- Glasstaff located_in Tresendar Manor',
      tie: '- Vargas enemy_of Glasstaff',
      focus: 'his debts',
      anchorLabel: 'Session 3',
      asOf: false,
      pcName: 'Vargas'
    })
    // No citeable document blocks — citations are incompatible with output_config.format.
    for (const block of content) {
      expect(block.type).toBe('text')
      expect((block as { citations?: unknown }).citations).toBeUndefined()
    }
    const texts = content.map((b) => ('text' in b ? b.text : ''))
    const all = texts.join('\n')
    expect(texts[0]).toContain('Glasstaff') // leads with who you're preparing to speak with
    expect(all).toContain('Redbrands') // a note
    expect(all).toContain('(rumored)') // the rumored note is tagged so the model hedges it
    expect(all).toContain('Tresendar Manor') // connections block
    expect(all).toContain('Vargas enemy_of Glasstaff') // the asker↔target tie
    expect(all).toContain('his debts') // the focus block
    // Ends with the explicit ask, naming the target.
    expect(texts[texts.length - 1]).toContain('Write the briefing')
    expect(texts[texts.length - 1]).toContain('Glasstaff')
  })

  it('as-of framing switches the anchor line to a reconstruction instruction', () => {
    const content = buildConverseUserContent({
      target: TARGET,
      notes: [],
      connections: null,
      tie: null,
      anchorLabel: 'Session 2',
      asOf: true,
      pcName: 'Vargas'
    })
    expect((content[0] as { text: string }).text).toContain('AS OF Session 2')
  })

  it('omits empty blocks — only the target identity and the ask remain', () => {
    const content = buildConverseUserContent({
      target: TARGET,
      notes: [],
      connections: null,
      tie: null,
      anchorLabel: null,
      asOf: false,
      pcName: 'Vargas'
    })
    expect(content).toHaveLength(2)
    expect((content[0] as { text: string }).text).toContain('Glasstaff')
    expect((content[1] as { text: string }).text).toContain('Write the briefing')
  })
})
