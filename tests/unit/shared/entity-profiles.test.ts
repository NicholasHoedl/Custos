import { describe, it, expect } from 'vitest'
import { ENTITY_TYPES } from '@shared/entity-types'
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

  it('reflects the per-type intent: items have no goals, events have no status', () => {
    expect(profileFor('item').goals).toBe(false)
    expect(profileFor('event').status).toBeNull()
  })
})
