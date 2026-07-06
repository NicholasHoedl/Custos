import { describe, it, expect } from 'vitest'
import { ENTITY_TYPES, LIFECYCLES, type EntityType, type Lifecycle } from '@shared/entity-types'
import { ENTITY_PROFILES, profileFor, profileKeys } from '@shared/entity-profiles'

describe('entity-profiles', () => {
  it('defines a profile for every entity type', () => {
    for (const t of ENTITY_TYPES) {
      expect(ENTITY_PROFILES[t], t).toBeDefined()
    }
  })

  it('every select field declares non-empty options', () => {
    for (const t of ENTITY_TYPES) {
      for (const f of profileFor(t).fields) {
        if (f.kind === 'select') {
          expect(f.options, `${t}.${f.key}`).toBeDefined()
          expect((f.options ?? []).length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('field keys are unique within a type and match profileKeys', () => {
    for (const t of ENTITY_TYPES) {
      const keys = profileFor(t).fields.map((f) => f.key)
      expect(new Set(keys).size, t).toBe(keys.length)
      expect(profileKeys(t)).toEqual(new Set(keys))
    }
  })

  it('preserves the Suggest contract: PC and NPC promote traits + goals', () => {
    for (const t of ['pc', 'npc'] as const) {
      expect(profileFor(t).traits, t).toBe(true)
      expect(profileFor(t).goals, t).toBe(true)
    }
  })

  it('reflects the per-type intent: items have no goals, and every type has status presets', () => {
    expect(profileFor('item').goals).toBe(false)
    for (const t of ENTITY_TYPES) {
      expect(profileFor(t).status, t).not.toBeNull()
    }
  })

  it('every status preset carries a valid lifecycle, with unique labels per type', () => {
    for (const t of ENTITY_TYPES) {
      const presets = profileFor(t).status ?? []
      expect(presets.length, t).toBeGreaterThan(0)
      const labels = presets.map((p) => p.label)
      expect(new Set(labels).size, t).toBe(labels.length)
      for (const p of presets) {
        expect(LIFECYCLES, `${t}.${p.label}`).toContain(p.lifecycle)
      }
    }
  })

  it('maps "over" presets to an ending lifecycle (the keyword heuristic would wrongly say active)', () => {
    const life = (t: EntityType, label: string): Lifecycle | undefined =>
      profileFor(t).status?.find((p) => p.label === label)?.lifecycle
    expect(life('creature', 'Defeated')).toBe('ended')
    expect(life('quest', 'Completed')).toBe('ended')
    expect(life('quest', 'Failed')).toBe('ended')
    expect(life('faction', 'Disbanded')).toBe('ended')
    expect(life('location', 'Destroyed')).toBe('ended')
    expect(life('npc', 'Missing')).toBe('presumed_ended')
    expect(life('item', 'Lost')).toBe('presumed_ended')
  })
})
