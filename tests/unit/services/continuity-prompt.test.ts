import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders can
// be imported under the node test runtime (mirrors converse-prompt.test).
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildContinuitySystem, buildContinuityUserContent } = await import(
  '../../../src/main/services/claude.service'
)

const textOf = (blocks: unknown[]): string =>
  blocks.map((b) => (b as { text?: string }).text ?? '').join('\n')

describe('continuity prompt (ADR-056)', () => {
  it('the system is an out-of-character audit brief — no persona/voice', () => {
    const sys = buildContinuitySystem()[0].text
    expect(sys).toMatch(/CONTINUITY ERRORS/)
    expect(sys).toMatch(/\[ended\] entity is still ACTING/)
    expect(sys).toMatch(/unresolved-rumor/)
    expect(sys).toMatch(/OUT of character/)
    expect(sys).not.toMatch(/voice/i) // maintenance report, not narration
    expect(buildContinuitySystem()[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('the user content renders id-bearing entities (with [ended]), ties, confidence-tagged notes, and the ask', () => {
    const content = buildContinuityUserContent({
      entities: [
        { id: 'e-glass', name: 'Glasstaff', type: 'npc', status: 'Dead', lifecycle: 'ended' },
        { id: 'e-sildar', name: 'Sildar', type: 'npc', status: 'Alive', lifecycle: 'active' }
      ],
      tieLines: '- Glasstaff enemy of Sildar',
      notes: [
        {
          sessionNumber: 3,
          entityNames: ['Glasstaff'],
          content: 'Glasstaff plots in the manor.',
          confidence: 'rumored'
        }
      ],
      omittedNotes: 5,
      alreadyFlagged: ['Glasstaff status/lifecycle mismatch']
    })
    const all = textOf(content as unknown[])
    expect(all).toMatch(/e-glass · Glasstaff \(npc\) \[ended\]: Dead/) // id-bearing + [ended] mark + status
    expect(all).toMatch(/Glasstaff enemy of Sildar/) // ties block
    expect(all).toMatch(/Glasstaff plots in the manor\. · \(rumored\)/) // note + confidence tag
    expect(all).toMatch(/\+5 older notes omitted/) // token-cap advisory
    expect(all).toMatch(/Already flagged by automatic checks/) // dedup hint
    expect(all).toMatch(/Glasstaff status\/lifecycle mismatch/)
    expect(all).toMatch(/real entity ids only/) // the ask
  })

  it('omits the ties, notes, and already-flagged blocks when empty', () => {
    const content = buildContinuityUserContent({
      entities: [{ id: 'e1', name: 'A', type: 'npc', status: null, lifecycle: 'active' }],
      tieLines: null,
      notes: [],
      omittedNotes: 0,
      alreadyFlagged: []
    })
    const all = textOf(content as unknown[])
    expect(all).not.toMatch(/Current relationships/)
    expect(all).not.toMatch(/Notes, newest first/)
    expect(all).not.toMatch(/Already flagged/)
  })
})
