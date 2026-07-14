import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const {
  buildExtractionSystem,
  buildExtractionUserContent,
  extractionSchema,
  rankExistingForExtraction
} = await import('../../../src/main/services/claude.service')

const textOf = (blocks: unknown[]): string =>
  blocks.map((b) => (b as { text?: string }).text ?? '').join('\n')

describe('rankExistingForExtraction (B2: roster ranking so the model links, not duplicates)', () => {
  const sildar = { name: 'Sildar Hallwinter' }
  const glasstaff = { name: 'Glasstaff' }
  const bystander = { name: 'Unrelated Bystander' }

  it('surfaces a first-name/partial reference above unmentioned entities', () => {
    // The log says only "Sildar" — the old exact-substring check missed "Sildar Hallwinter".
    const ranked = rankExistingForExtraction([bystander, sildar], 'We met Sildar at the inn.')
    expect(ranked[0].name).toBe('Sildar Hallwinter')
  })

  it('ranks a full-name substring above a partial-token match', () => {
    const ranked = rankExistingForExtraction([sildar, glasstaff], 'Glasstaff plotted; Sildar worried.')
    expect(ranked[0].name).toBe('Glasstaff') // exact full-name (rank 0) beats the "Sildar" token (rank 1)
  })

  it('caps the roster', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ name: `Name${i}` }))
    expect(rankExistingForExtraction(many, 'nothing matches here', 100)).toHaveLength(100)
  })
})

describe('extraction prompt — mode split (ADR-035)', () => {
  it('capture keeps STATUS CHANGES (chronology) but drops the tie/field instructions', () => {
    const capture = buildExtractionSystem('capture')[0].text
    expect(capture).toMatch(/STATUS CHANGES/) // tier 1 keeps status — it drives as-of chronology
    expect(capture).not.toMatch(/FIELD CHANGES/)
    expect(capture).not.toMatch(/RELATIONSHIPS\./)
    expect(capture).not.toMatch(/related_to/) // no relation vocabulary in the note-taker
  })

  it('the capture schema omits the tie/field arrays entirely (closed schema enforces)', () => {
    const capture = extractionSchema('capture') as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(capture.properties.statusChanges).toBeDefined()
    expect(capture.properties.relationshipChanges).toBeUndefined()
    expect(capture.properties.fieldChanges).toBeUndefined()
    expect(capture.required).toEqual(['entities', 'notes', 'statusChanges'])
    const full = extractionSchema('full') as { properties: Record<string, unknown>; required: string[] }
    expect(full.properties.relationshipChanges).toBeDefined()
    expect(full.properties.fieldChanges).toBeDefined()
    expect(full.required).toEqual([
      'entities',
      'notes',
      'statusChanges',
      'relationshipChanges',
      'fieldChanges'
    ])
  })

  it('the capture ask names entities, notes, and status changes — not ties or fields', () => {
    const content = textOf(buildExtractionUserContent('some text', [], 'capture'))
    expect(content).toMatch(/Extract the entities, notes, and status changes as JSON/)
    expect(content).not.toMatch(/relationship changes/)
  })
})

describe('extraction prompt — field changes (ADR-028)', () => {
  it('the full system carries the FIELD CHANGES instruction; capture does not', () => {
    const full = buildExtractionSystem('full')[0].text
    const capture = buildExtractionSystem('capture')[0].text
    expect(full).toMatch(/FIELD CHANGES/)
    expect(full).toMatch(/add.*cut.*alter/) // the three ops are described
    expect(capture).not.toMatch(/FIELD CHANGES/)
  })

  it('the full system asks for tie disposition + confidence (ADR-033)', () => {
    const full = buildExtractionSystem('full')[0].text
    expect(full).toMatch(/fromDisposition/)
    expect(full).toMatch(/how each side FEELS/)
    expect(full).toMatch(/rumored.*suspected/) // confidence hedging
  })

  it('full mode surfaces a MENTIONED entity’s current fields so a cut/alter can copy them verbatim', () => {
    const existing = [
      { id: 'e1', name: 'Glasstaff', type: 'npc', traits: ['Cautious'], goals: ['Guard the manor'] },
      { id: 'e2', name: 'Unmentioned', type: 'npc', traits: ['Shy'] }
    ]
    const content = textOf(buildExtractionUserContent('Glasstaff plots in the manor', existing, 'full'))
    expect(content).toMatch(/Glasstaff/)
    expect(content).toMatch(/traits: Cautious/)
    expect(content).toMatch(/goals: Guard the manor/)
    // an entity NOT named in the text is listed for linking but WITHOUT its fields (keeps the prompt bounded)
    expect(content).not.toMatch(/traits: Shy/)
  })

  it('capture extraction never surfaces entity fields (the note-taker stays lean)', () => {
    const existing = [{ id: 'e1', name: 'Glasstaff', type: 'npc', traits: ['Cautious'] }]
    const content = textOf(buildExtractionUserContent('Glasstaff plots', existing, 'capture'))
    expect(content).toMatch(/Glasstaff/) // still listed for linking
    expect(content).not.toMatch(/traits: Cautious/) // but no fields
  })
})

describe('extraction prompt — status vocabulary (ADR-031 as-built)', () => {
  it('teaches each type’s curated status presets (generated from the profiles)', () => {
    const sys = buildExtractionSystem('capture')[0].text
    expect(sys).toMatch(/pc: Active \| Inactive \| Dead/)
    expect(sys).toMatch(/npc: Alive \| Dead \| Missing \| Unknown/)
    expect(sys).toMatch(/quest: Active \| Completed \| Failed \| On Hold/)
  })
})

describe('extraction prompt — standing relationships (ADR-030 v3)', () => {
  it('the full system asks for STANDING ties and teaches the relation vocabulary', () => {
    const sys = buildExtractionSystem('full')[0].text
    expect(sys).toMatch(/STANDING relationship/) // not just narrated form/sever changes
    expect(sys).toMatch(/related_to \(FAMILY/) // the family relation is glossed (the "little sister" case)
    expect(sys).toMatch(/member_of/) // the vocabulary is spelled out, not schema-only
    expect(sys).toMatch(/sever" ONLY for a narrated ending/i)
    const capture = buildExtractionSystem('capture')[0].text
    expect(capture).not.toMatch(/related_to/) // the note-taker carries no tie vocabulary
  })

  it('names the backstory subject in the user turn so ties anchor to the character', () => {
    const existing = [{ id: 'mc-1', name: 'Alaeric', type: 'pc' }]
    const withSubject = textOf(
      buildExtractionUserContent('Raised in the dock ward…', existing, 'full', {
        id: 'mc-1',
        name: 'Alaeric'
      })
    )
    expect(withSubject).toMatch(/personal BACKSTORY of Alaeric/)
    expect(withSubject).toMatch(/mc-1/)
    expect(withSubject).toMatch(/standing ties/)
    const without = textOf(buildExtractionUserContent('Raised in the dock ward…', existing, 'full'))
    expect(without).not.toMatch(/BACKSTORY of/)
  })
})
