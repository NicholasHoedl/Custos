import { describe, it, expect } from 'vitest'
import type { EntityType, Lifecycle } from '@shared/entity-types'
import {
  statusLifecycleMismatches,
  factionConflicts,
  runDeterministicChecks,
  type CheckEntity,
  type CheckLink
} from '@shared/continuity-checks'

function ent(id: string, over: Partial<CheckEntity> = {}): CheckEntity {
  return { id, name: id, type: 'npc' as EntityType, status: null, lifecycle: 'active', ...over }
}
function link(
  fromEntityId: string,
  toEntityId: string,
  relation: string,
  live = true,
  id = `${fromEntityId}-${relation}-${toEntityId}`
): CheckLink {
  return { id, fromEntityId, toEntityId, relation, live }
}

const cats = (fs: { category: string }[]): string[] => fs.map((f) => f.category)

describe('statusLifecycleMismatches', () => {
  it('flags a preset status whose implied lifecycle differs, and attaches a set-lifecycle fix', () => {
    const out = statusLifecycleMismatches([
      ent('a', { status: 'Dead', lifecycle: 'active' as Lifecycle }) // npc "Dead" → ended
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'status-mismatch', source: 'check', entityIds: ['a'] })
    // The one-click fix snaps the lifecycle to the preset's ('ended'), targeting this entity.
    expect(out[0].fix?.actions).toHaveLength(1)
    expect(out[0].fix?.actions[0].action).toEqual({
      kind: 'set-lifecycle',
      entityId: 'a',
      lifecycle: 'ended'
    })
  })

  it('ignores a matching preset, free text, a null status, the presumed toggle, and an unknown type', () => {
    expect(
      statusLifecycleMismatches([
        ent('a', { status: 'Alive', lifecycle: 'active' }), // preset matches
        ent('b', { status: 'Brooding', lifecycle: 'active' }), // not a preset → skip
        ent('c', { status: null, lifecycle: 'active' }),
        // The "Presumed" toggle leaves status on its ended preset ("Dead") but flips lifecycle to
        // presumed_ended — a standard workflow, NOT a mismatch (regression guard).
        ent('d', { status: 'Dead', lifecycle: 'presumed_ended' }),
        // A legacy/imported off-union type must be skipped, never crash (regression guard).
        ent('e', { type: 'bogus' as EntityType, status: 'Dead', lifecycle: 'active' })
      ])
    ).toEqual([])
  })
})

describe('factionConflicts', () => {
  it('flags a pair that is BOTH a live ally and a live enemy, with a sever-tie fix per tie', () => {
    const out = factionConflicts(
      [ent('a'), ent('b')],
      [link('a', 'b', 'ally_of'), link('b', 'a', 'enemy_of')]
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'faction-conflict', severity: 'high' })
    expect([...out[0].entityIds].sort()).toEqual(['a', 'b'])
    // Two sever options carrying the SPECIFIC ally + enemy interval ids (derived ids from the helper).
    const actions = out[0].fix?.actions ?? []
    expect(actions).toHaveLength(2)
    expect(actions.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        { kind: 'sever-tie', linkId: 'a-ally_of-b' },
        { kind: 'sever-tie', linkId: 'b-enemy_of-a' }
      ])
    )
  })

  it('ignores a lone relation and a severed (non-live) opposite', () => {
    expect(factionConflicts([ent('a'), ent('b')], [link('a', 'b', 'ally_of')])).toEqual([])
    expect(
      factionConflicts(
        [ent('a'), ent('b')],
        [link('a', 'b', 'ally_of'), link('a', 'b', 'enemy_of', false)] // enemy tie already severed
      )
    ).toEqual([])
  })
})

describe('runDeterministicChecks', () => {
  it('returns nothing for a clean campaign', () => {
    const out = runDeterministicChecks({
      entities: [ent('a', { status: 'Alive' }), ent('b', { status: 'Alive' })],
      links: [link('a', 'b', 'ally_of')]
    })
    expect(out).toEqual([])
  })

  it('aggregates findings across all check kinds', () => {
    const out = runDeterministicChecks({
      entities: [ent('mismatch', { status: 'Dead', lifecycle: 'active' }), ent('x'), ent('y')],
      links: [link('x', 'y', 'ally_of'), link('x', 'y', 'enemy_of')]
    })
    expect(cats(out).sort()).toEqual(['faction-conflict', 'status-mismatch'].sort())
  })

  // A dead entity keeps its relationships — death does NOT sever a tie — so an ended entity that still
  // holds a live tie is NOT a slip. Regression guard for removing the old `liveTiesOnEndedEntities` /
  // `notesAfterEnded` checks; the semantic "still acting" case stays with the AI pass.
  it('does NOT flag a dead entity that still holds a live tie (ties persist past death)', () => {
    const out = runDeterministicChecks({
      entities: [ent('dead', { lifecycle: 'ended' }), ent('foe'), ent('fac')],
      links: [link('dead', 'foe', 'enemy_of'), link('dead', 'fac', 'member_of')]
    })
    expect(out).toEqual([])
  })
})
