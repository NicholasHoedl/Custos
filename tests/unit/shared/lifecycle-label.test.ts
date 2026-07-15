import { describe, it, expect } from 'vitest'
import {
  ENTITY_TYPES,
  ENDED_LABELS,
  LIFECYCLE_LABELS,
  isDeathType,
  lifecycleLabel
} from '@shared/entity-types'

// Type-aware lifecycle terminology (ADR-054): "Fallen" reads wrong for a place/quest/item/faction/event.
describe('lifecycleLabel', () => {
  it('gives the ended bucket a type-appropriate word', () => {
    expect(lifecycleLabel('pc', 'ended')).toBe('Fallen')
    expect(lifecycleLabel('npc', 'ended')).toBe('Fallen')
    expect(lifecycleLabel('creature', 'ended')).toBe('Defeated')
    expect(lifecycleLabel('location', 'ended')).toBe('Destroyed')
    expect(lifecycleLabel('faction', 'ended')).toBe('Disbanded')
    expect(lifecycleLabel('quest', 'ended')).toBe('Closed')
    expect(lifecycleLabel('item', 'ended')).toBe('Destroyed')
    expect(lifecycleLabel('event', 'ended')).toBe('Concluded')
  })

  it('falls back to the neutral label for every non-ended lifecycle, for every type', () => {
    for (const t of ENTITY_TYPES) {
      expect(lifecycleLabel(t, 'active')).toBe(LIFECYCLE_LABELS.active)
      expect(lifecycleLabel(t, 'unknown')).toBe(LIFECYCLE_LABELS.unknown)
      expect(lifecycleLabel(t, 'presumed_ended')).toBe(LIFECYCLE_LABELS.presumed_ended)
    }
  })

  it('covers every entity type with a non-empty ended word', () => {
    for (const t of ENTITY_TYPES) expect(ENDED_LABELS[t]).toBeTruthy()
  })
})

describe('isDeathType', () => {
  it('is true only for the living cast (pc/npc/creature)', () => {
    expect(ENTITY_TYPES.filter(isDeathType).sort()).toEqual(['creature', 'npc', 'pc'])
    expect(isDeathType('location')).toBe(false)
    expect(isDeathType('faction')).toBe(false)
    expect(isDeathType('quest')).toBe(false)
    expect(isDeathType('item')).toBe(false)
    expect(isDeathType('event')).toBe(false)
  })
})
