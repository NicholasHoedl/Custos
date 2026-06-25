import { describe, it, expect } from 'vitest'
import {
  RELATION_LIST,
  RELATIONS,
  isRelationAllowed,
  relationsForTypes
} from '@shared/relations'

describe('relation registry', () => {
  it('every relation resolves its inverse key', () => {
    for (const def of RELATION_LIST) {
      expect(RELATIONS[def.inverseKey]).toBeDefined()
      if (def.symmetric) expect(def.inverseKey).toBe(def.key)
    }
  })

  it('directed pairs are mutual inverses', () => {
    for (const def of RELATION_LIST) {
      if (!def.symmetric) {
        expect(RELATIONS[def.inverseKey].inverseKey).toBe(def.key)
      }
    }
  })

  it('relationsForTypes filters by allowed from/to types', () => {
    const keys = relationsForTypes('npc', 'location').map((r) => r.key)
    expect(keys).toContain('located_in')
    expect(keys).not.toContain('owns') // owns is npc -> item
  })

  it('isRelationAllowed validates type compatibility and unknown keys', () => {
    expect(isRelationAllowed('located_in', 'npc', 'location')).toBe(true)
    expect(isRelationAllowed('located_in', 'npc', 'item')).toBe(false)
    expect(isRelationAllowed('bogus', 'npc', 'location')).toBe(false)
  })
})
