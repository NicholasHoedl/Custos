import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure prompt builders
// can be imported under the node test runtime.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildEnrichSystem, buildEnrichUserContent } = await import(
  '../../../src/main/services/claude.service'
)

const textOf = (blocks: unknown[]): string =>
  blocks.map((b) => (b as { text?: string }).text ?? '').join('\n')

const SUBJECT = {
  id: 'e-glass',
  name: 'Glasstaff',
  type: 'npc',
  description: 'A smooth-talking wizard.',
  status: 'Alive',
  lifecycle: 'active' as const,
  traits: ['Cautious'],
  goals: ['Guard the manor'],
  flaws: [] as string[],
  attributes: { race: 'Human', role: 'Redbrand leader' }
}

describe('enrich prompt (Illuminate, ADR-035)', () => {
  it('system demands real ids, forbids #index and creating entities/notes/status, and names description', () => {
    const sys = buildEnrichSystem()[0].text
    expect(sys).toMatch(/REAL entity ids only/i)
    expect(sys).toMatch(/never "#index"/)
    expect(sys).toMatch(/Never propose new entities, notes, or status changes/)
    expect(sys).toMatch(/never change a name or type/)
    expect(sys).toMatch(/"description"/) // the scalar column is an allowed field here
    expect(sys).toMatch(/related_to \(FAMILY/) // the shared relation vocabulary gloss
    expect(sys).toMatch(/fromDisposition/) // ADR-033 enrichment fields
    expect(sys).toMatch(/NEVER re-propose a tie already in the live relationships list/)
    // The cacheable breakpoint.
    expect(buildEnrichSystem()[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('user content carries the profile verbatim (the oldValue source), ties, roster, and capped notes', () => {
    const content = buildEnrichUserContent(
      SUBJECT,
      [
        { content: 'Glasstaff led the Redbrands.', confidence: 'confirmed' },
        { content: 'He may answer to the Black Spider.', confidence: 'rumored' }
      ],
      '- e-manor · Glasstaff located_in Tresendar Manor',
      [{ id: 'e-manor', name: 'Tresendar Manor', type: 'location' }],
      5 // earlier notes omitted by the cap
    )
    const all = textOf(content as unknown[])
    // Profile block — every field the model may copy into oldValue, verbatim.
    expect(all).toMatch(/e-glass · Glasstaff \(npc\)/)
    expect(all).toMatch(/description: A smooth-talking wizard\./)
    expect(all).toMatch(/traits: Cautious/)
    expect(all).toMatch(/goals: Guard the manor/)
    expect(all).toMatch(/role: Redbrand leader/)
    // Live ties carry the far endpoint's REAL id (a sever must reference it).
    expect(all).toMatch(/e-manor · Glasstaff located_in Tresendar Manor/)
    // Roster for relationship endpoints.
    expect(all).toMatch(/reference by id/i)
    // Note history: count, cap notice, confidence tag.
    expect(all).toMatch(/2 notes, oldest first/)
    expect(all).toMatch(/\(\+5 earlier notes omitted\)/)
    expect(all).toMatch(/· \(rumored\)/)
    // The ask.
    expect(all).toMatch(/relationship changes and field changes for Glasstaff/)
  })

  it('omits the tie and cap lines when there is nothing to show', () => {
    const content = buildEnrichUserContent(SUBJECT, [], null, [])
    const all = textOf(content as unknown[])
    expect(all).not.toMatch(/LIVE relationships/)
    expect(all).not.toMatch(/omitted/)
  })
})
