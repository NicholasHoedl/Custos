import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildExtractionSystem, buildExtractionUserContent } = await import(
  '../../../src/main/services/claude.service'
)

const textOf = (blocks: unknown[]): string =>
  blocks.map((b) => (b as { text?: string }).text ?? '').join('\n')

describe('extraction prompt — field changes (ADR-028)', () => {
  it('the withChanges system carries the FIELD CHANGES instruction; the plain one does not', () => {
    const withChanges = buildExtractionSystem(true)[0].text
    const plain = buildExtractionSystem(false)[0].text
    expect(withChanges).toMatch(/FIELD CHANGES/)
    expect(withChanges).toMatch(/add.*cut.*alter/) // the three ops are described
    expect(plain).not.toMatch(/FIELD CHANGES/)
  })

  it('withChanges surfaces a MENTIONED entity’s current fields so a cut/alter can copy them verbatim', () => {
    const existing = [
      { id: 'e1', name: 'Glasstaff', type: 'npc', traits: ['Cautious'], goals: ['Guard the manor'] },
      { id: 'e2', name: 'Unmentioned', type: 'npc', traits: ['Shy'] }
    ]
    const content = textOf(buildExtractionUserContent('Glasstaff plots in the manor', existing, true))
    expect(content).toMatch(/Glasstaff/)
    expect(content).toMatch(/traits: Cautious/)
    expect(content).toMatch(/goals: Guard the manor/)
    // an entity NOT named in the text is listed for linking but WITHOUT its fields (keeps the prompt bounded)
    expect(content).not.toMatch(/traits: Shy/)
  })

  it('plain extraction never surfaces entity fields (the Import pane is unchanged)', () => {
    const existing = [{ id: 'e1', name: 'Glasstaff', type: 'npc', traits: ['Cautious'] }]
    const content = textOf(buildExtractionUserContent('Glasstaff plots', existing, false))
    expect(content).toMatch(/Glasstaff/) // still listed for linking
    expect(content).not.toMatch(/traits: Cautious/) // but no fields
  })
})
