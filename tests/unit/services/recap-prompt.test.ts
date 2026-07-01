import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildRecapSystem, buildRecapUserContent } = await import(
  '../../../src/main/services/claude.service'
)

describe('recap prompt assembly', () => {
  it('system is the cacheable "previously on" instructions', () => {
    const sys = buildRecapSystem()
    const text = sys.map((b) => b.text).join('\n')
    expect(text).toMatch(/previously on/i)
    expect(sys[sys.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('user content is plain text (no document blocks), beats in order, ends with the ask', () => {
    const content = buildRecapUserContent({
      sessionLabel: 'Session 3 — The Redbrands',
      priorSummary: 'Earlier, they reached Phandalin.',
      beats: ['Found the hideout', 'Defeated Glasstaff'],
      notes: [{ names: 'Glasstaff', content: 'led the Redbrands' }],
      state: '- Glasstaff (npc): Defeated',
      relationships: '- Glasstaff located in Tresendar Manor'
    })
    for (const block of content) {
      expect(block.type).toBe('text') // never citeable document blocks
      expect((block as { citations?: unknown }).citations).toBeUndefined()
    }
    const text = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Earlier, they reached Phandalin.') // prior summary block
    expect(text).toContain('led the Redbrands') // note content
    expect(text).toContain('Tresendar Manor') // relationships block
    // beats appear in chronological order
    expect(text.indexOf('Found the hideout')).toBeLessThan(text.indexOf('Defeated Glasstaff'))
    // the final block is the ask
    expect((content[content.length - 1] as { text: string }).text).toContain('Write the')
  })

  it('omits the prior-summary block when there is no previous recap', () => {
    const content = buildRecapUserContent({
      sessionLabel: 'Session 1',
      priorSummary: null,
      beats: ['A thing happened'],
      notes: [],
      state: null,
      relationships: null
    })
    const text = content.map((b) => ('text' in b ? b.text : '')).join('\n')
    expect(text).not.toContain('For continuity')
  })
})
