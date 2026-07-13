import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildConverseSystem, buildConverseUserContent, confidenceTag } =
  await import('../../../src/main/services/claude.service')

const TARGET = {
  name: 'Glasstaff',
  type: 'npc',
  status: null,
  lifecycle: 'active' as const,
  traits: [] as string[],
  goals: [] as string[],
  flaws: [] as string[]
}

describe('converse prompt assembly', () => {
  it('system carries the campaign + persona + the MC voice examples (ADR-049) and the Converse instructions', () => {
    const sys = buildConverseSystem({
      campaignName: 'Phandelver',
      campaignDescription: 'a frontier town',
      pcName: 'Vargas',
      pcRace: 'elf',
      pcClass: 'wizard',
      persona: 'THE-CHARACTER-BRIEF',
      voiceExamples: ['Coin first, questions later.']
    })
    const text = sys.map((b) => b.text).join('\n')
    expect(text).toContain('Phandelver')
    expect(text).toContain('THE-CHARACTER-BRIEF')
    // The Converse instructions (questions-only tagged spread, ADR-034), NOT the Suggest prompt.
    expect(text).toContain('QUESTIONS')
    expect(text).toContain('secret-seeking') // a tag from the question vocabulary
    expect(text).toContain('FUNNEL') // the funnel/trust-cost spread rule
    expect(text).toContain('elf wizard') // race/class stated for prompt parity
    // Dialogue-quality guardrails (natural-speech rework): the "sound like a real person" rule + the
    // few-shot example block that anchor short, spoken, in-character lines.
    expect(text).toContain('SOUND LIKE A REAL PERSON')
    expect(text).toContain('EXAMPLES')
    // Unlike Counsel, Converse RESTORES the MC voice examples — its questions are dialogue in the PC's
    // voice (ADR-049).
    expect(text).toContain('Voice examples')
    expect(text).toContain('Coin first, questions later.')
    // The cacheable breakpoint rides the last block (the voice block carries its own).
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
    expect(all).toContain('his debts') // the thread block
    // Ends with the explicit ask, naming the target.
    expect(texts[texts.length - 1]).toContain('Write only the in-character questions')
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
    expect((content[1] as { text: string }).text).toContain('Write only the in-character questions')
  })

  it("renders the target's recorded nature (traits / goals / flaws) as a fact block", () => {
    const content = buildConverseUserContent({
      target: {
        ...TARGET,
        traits: ['smooth-talker'],
        goals: ['serve the Black Spider'],
        flaws: ['vain']
      },
      notes: [],
      connections: null,
      tie: null,
      anchorLabel: null,
      asOf: false,
      pcName: 'Vargas'
    })
    const all = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(all).toContain('smooth-talker')
    expect(all).toContain('serve the Black Spider')
    expect(all).toContain('vain')
  })

  it('folds the conversation-so-far exchanges into a follow-up block when history is given (ADR-049)', () => {
    const content = buildConverseUserContent({
      target: TARGET,
      notes: [],
      connections: null,
      tie: null,
      history: [
        { question: 'Who do you answer to?', answer: 'He admitted he owes the Zhentarim.' },
        { question: 'And now?', answer: 'He swears he is done with them.' }
      ],
      anchorLabel: 'Session 3',
      asOf: false,
      pcName: 'Vargas'
    })
    const all = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(all).toContain('conversation so far') // the follow-up grounding block
    // Each turn renders the question ASKED + the answer, so the model can build on the real exchange.
    expect(all).toContain('You asked: "Who do you answer to?"')
    expect(all).toContain('They said: "He admitted he owes the Zhentarim."')
    expect(all).toContain('He swears he is done with them.')
    // With history, the closing ask ships FOLLOW-UP questions.
    expect((content[content.length - 1] as { text: string }).text).toContain('follow-up questions')
  })
})
