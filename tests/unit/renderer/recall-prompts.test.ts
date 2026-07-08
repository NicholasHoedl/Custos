import { describe, it, expect } from 'vitest'
import { ENTITY_TYPES } from '@shared/entity-types'
// The catalog is a pure renderer module (type-only shared import); vitest resolves only @shared, so reach
// it by relative path. NOTE: distinct from tests/unit/services/recall-prompt.test.ts (the main-process
// LLM prompt-builder test) — this covers the Lore prebuilt-prompt (madlib) templates.
import { RECALL_PROMPTS } from '../../../src/renderer/src/lib/recall-prompts'

const EXPECTED_IDS = [
  'dossier',
  'relationship',
  'connections',
  'quest-status',
  'faction',
  'open-threads-entity',
  'open-threads-campaign'
]

describe('recall prompt catalog', () => {
  it('ships exactly the Core 7 with the locked, unique ids', () => {
    expect(RECALL_PROMPTS).toHaveLength(7)
    const ids = RECALL_PROMPTS.map((p) => p.id)
    expect(ids).toEqual(EXPECTED_IDS)
    expect(new Set(ids).size).toBe(7)
  })

  it('assembles each template to its exact query string', () => {
    const byId = new Map(RECALL_PROMPTS.map((p) => [p.id, p]))
    const cases: { id: string; values: Record<string, string>; expected: string }[] = [
      {
        id: 'dossier',
        values: { character: 'Sildar' },
        expected: 'Who is Sildar, and what do we know about them?'
      },
      {
        id: 'relationship',
        values: { subject: 'Kaelen', other: 'The Iron Coin' },
        expected: "What is Kaelen's relationship to The Iron Coin?"
      },
      {
        id: 'connections',
        values: { entity: 'Tresendar Manor' },
        expected: 'Who and what is Tresendar Manor connected to?'
      },
      {
        id: 'quest-status',
        values: { quest: 'Cragmaw Hideout' },
        expected: "Where does the quest Cragmaw Hideout stand, and what's left to do?"
      },
      {
        id: 'faction',
        values: { faction: 'The Redbrands' },
        expected: 'What is The Redbrands, who belongs to it, and what are they after?'
      },
      {
        id: 'open-threads-entity',
        values: { entity: 'Glasstaff' },
        expected:
          "What's still unresolved about Glasstaff — what's rumored or only suspected, and what should we be asking?"
      },
      {
        id: 'open-threads-campaign',
        values: {},
        expected: 'What are the biggest open threads and unanswered questions in the campaign right now?'
      }
    ]
    for (const c of cases) {
      const prompt = byId.get(c.id)
      expect(prompt, `missing prompt ${c.id}`).toBeDefined()
      expect(prompt!.assemble(c.values)).toBe(c.expected)
    }
  })

  it('consumes every declared slot and leaves no unfilled token', () => {
    for (const p of RECALL_PROMPTS) {
      const values = Object.fromEntries(p.slots.map((s) => [s.id, `«${s.id}»`]))
      const out = p.assemble(values)
      for (const s of p.slots) {
        expect(out, `${p.id} drops slot ${s.id}`).toContain(`«${s.id}»`)
      }
      expect(out, `${p.id} leaks a template brace`).not.toMatch(/[{}]/)
    }
  })

  it('declares valid, unique, type-constrained slots', () => {
    const typeSet = new Set<string>(ENTITY_TYPES)
    for (const p of RECALL_PROMPTS) {
      const ids = p.slots.map((s) => s.id)
      expect(new Set(ids).size, `${p.id} has duplicate slot ids`).toBe(ids.length)
      for (const s of p.slots) {
        expect(s.label.trim().length).toBeGreaterThan(0)
        if (s.types !== null) {
          expect(s.types.length, `${p.id}.${s.id} has empty types`).toBeGreaterThan(0)
          for (const t of s.types) expect(typeSet.has(t), `${p.id}.${s.id} bad type ${t}`).toBe(true)
        }
      }
    }
  })

  it('treats the campaign template as a zero-slot constant', () => {
    const campaign = RECALL_PROMPTS.find((p) => p.id === 'open-threads-campaign')!
    expect(campaign.slots).toHaveLength(0)
    expect(campaign.assemble({})).toBe(campaign.assemble({ ignored: 'x' }))
  })
})
