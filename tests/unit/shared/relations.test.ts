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

  it('creatures can be located, involved, owned, and opposed (C1)', () => {
    // A creature lives somewhere, is involved in quests/events, can hoard items, and is an actor for
    // ally/enemy edges — but stays out of social/org relations (member_of, knows, quest_giver_of).
    const fromLocation = relationsForTypes('creature', 'location').map((r) => r.key)
    expect(fromLocation).toContain('located_in')
    expect(relationsForTypes('creature', 'quest').map((r) => r.key)).toContain('involved_in')
    expect(isRelationAllowed('owns', 'creature', 'item')).toBe(true)
    expect(isRelationAllowed('enemy_of', 'creature', 'npc')).toBe(true)
    expect(isRelationAllowed('ally_of', 'pc', 'creature')).toBe(true)
    expect(isRelationAllowed('member_of', 'creature', 'faction')).toBe(false)
    expect(isRelationAllowed('knows', 'creature', 'npc')).toBe(false)
  })
})
