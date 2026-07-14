import { describe, it, expect } from 'vitest'
import { ENTITY_TYPES, type Entity, type EntityType } from '@shared/entity-types'
// Pure renderer module (type-only shared import); vitest resolves only @shared, so reach it by relative
// path. Covers the slash-mention token parser + entity ranker behind the "quick write" autocomplete.
import { SLASH_TYPES, parseMentionToken, rankEntities } from '../../../src/renderer/src/lib/mention'

function ent(name: string, over: Partial<Entity> = {}): Entity {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    campaignId: 'c1',
    type: 'npc',
    name,
    description: null,
    image: null,
    traits: [],
    goals: [],
    flaws: [],
    voiceExamples: [],
    attributes: {},
    status: null,
    lifecycle: 'active',
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}

describe('SLASH_TYPES', () => {
  it('maps every code to a real EntityType', () => {
    for (const type of Object.values(SLASH_TYPES)) {
      expect(ENTITY_TYPES).toContain(type)
    }
  })

  it('reaches all eight entity types', () => {
    const reachable = new Set<EntityType>(Object.values(SLASH_TYPES))
    for (const type of ENTITY_TYPES) expect(reachable).toContain(type)
  })
})

describe('parseMentionToken', () => {
  const end = (s: string) => parseMentionToken(s, s.length)

  it('scopes a bare type code with an empty filter', () => {
    expect(end('/npc')).toEqual({ type: 'npc', filter: '', start: 0, end: 4 })
  })

  it('captures a name filter (spaces allowed) after the code', () => {
    expect(end('/npc Ald')).toEqual({ type: 'npc', filter: 'Ald', start: 0, end: 8 })
    expect(end('/loc winter keep')).toMatchObject({ type: 'location', filter: 'winter keep' })
  })

  it('accepts three-letter codes and full type names, case-insensitively', () => {
    expect(end('/loc')).toMatchObject({ type: 'location' })
    expect(end('/location')).toMatchObject({ type: 'location' })
    expect(end('/que')).toMatchObject({ type: 'quest' })
    expect(end('/fac')).toMatchObject({ type: 'faction' })
    expect(end('/eve')).toMatchObject({ type: 'event' })
    expect(end('/cre')).toMatchObject({ type: 'creature' })
    expect(end('/item')).toMatchObject({ type: 'item' })
    expect(end('/pc')).toMatchObject({ type: 'pc' })
    expect(end('/NPC')).toMatchObject({ type: 'npc' })
  })

  it('activates only at a word boundary and only up to the caret', () => {
    // leading prose is fine as long as the slash follows whitespace
    expect(end('hi /que dragon')).toEqual({ type: 'quest', filter: 'dragon', start: 3, end: 14 })
    // caret mid-string: text after the caret is ignored
    expect(parseMentionToken('see /npc here', 8)).toEqual({
      type: 'npc',
      filter: '',
      start: 4,
      end: 8
    })
  })

  it('ignores non-boundary slashes (URLs, and/or) and inner slashes inside a filter', () => {
    expect(end('and/or')).toBeNull()
    expect(end('http://x')).toBeNull()
    expect(end('/npc a/b')).toMatchObject({ type: 'npc', filter: 'a/b' })
  })

  it('never spans a newline', () => {
    expect(parseMentionToken('/npc\nfoo', 8)).toBeNull()
  })

  it('treats a bare or unknown slash as an all-types free-text filter (multi-word allowed)', () => {
    expect(end('/')).toEqual({ type: null, filter: '', start: 0, end: 1 })
    expect(end('/zzz')).toEqual({ type: null, filter: 'zzz', start: 0, end: 4 })
    expect(end('/zzz foo')).toEqual({ type: null, filter: 'zzz foo', start: 0, end: 8 }) // multi-word search
    expect(end('/glass staff')).toEqual({ type: null, filter: 'glass staff', start: 0, end: 12 })
    expect(end('hello world')).toBeNull() // no slash at all
  })
})

describe('rankEntities', () => {
  it('keeps only the token type', () => {
    const list = [ent('Aldric'), ent('Tavern', { type: 'location' }), ent('Bandits', { type: 'faction' })]
    const out = rankEntities(list, { type: 'npc', filter: '', start: 0, end: 4 })
    expect(out.map((e) => e.name)).toEqual(['Aldric'])
  })

  it('ranks name-prefix matches above mid-name matches, case-insensitively', () => {
    const list = [ent('Balin'), ent('Alric')] // both contain "al"; only Alric is a prefix
    const out = rankEntities(list, { type: 'npc', filter: 'AL', start: 0, end: 7 })
    expect(out.map((e) => e.name)).toEqual(['Alric', 'Balin'])
  })

  it('sinks ended/presumed-ended threads below active ones (without dropping them)', () => {
    const list = [ent('Aaron', { lifecycle: 'ended' }), ent('Zed')]
    const out = rankEntities(list, { type: 'npc', filter: '', start: 0, end: 4 })
    expect(out.map((e) => e.name)).toEqual(['Zed', 'Aaron']) // Zed first despite alpha order
  })

  it('caps the result list', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((n) => ent(n))
    const out = rankEntities(list, { type: 'npc', filter: '', start: 0, end: 4 }, { cap: 2 })
    expect(out).toHaveLength(2)
  })

  it('free-text (no type) searches across all types by name', () => {
    const list = [
      ent('Aldric Vane'),
      ent('Vanguard Keep', { type: 'location' }),
      ent('Bandits', { type: 'faction' })
    ]
    const out = rankEntities(list, { type: null, filter: 'van', start: 0, end: 4 })
    expect(out.map((e) => e.name)).toEqual(['Vanguard Keep', 'Aldric Vane']) // prefix "Van" outranks mid-name
  })

  it('honors an injected scorer (best score first)', () => {
    const list = [ent('Alpha'), ent('Zeta')]
    const score = (name: string): number => (name === 'Zeta' ? 5 : 1) // Zeta wins despite alpha order
    const out = rankEntities(list, { type: null, filter: 'x', start: 0, end: 2 }, { score })
    expect(out.map((e) => e.name)).toEqual(['Zeta', 'Alpha'])
  })
})
