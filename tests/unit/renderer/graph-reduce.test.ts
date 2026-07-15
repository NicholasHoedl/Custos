import { describe, it, expect } from 'vitest'
import type { EntityType } from '@shared/entity-types'
import type { CampaignGraph, GraphEdge, GraphNode } from '@shared/graph-types'
// Pure renderer module (type-only shared imports; vitest resolves only @shared, so reach it by relative
// path). Covers the parent-grouping / transitive-collapse / minor-pruning core behind the Web view's
// legibility controls.
import {
  parentOf,
  descendantsOf,
  collapsibleParents,
  reduceGraph
} from '../../../src/renderer/src/lib/graph-reduce'

function node(id: string, type: EntityType = 'npc', over: Partial<GraphNode> = {}): GraphNode {
  return { id, name: id, type, image: null, lifecycle: 'active', faded: false, ...over }
}

function edge(from: string, to: string, relation: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: `${from}-${relation}-${to}`,
    from,
    to,
    relation,
    label: relation,
    description: null,
    fromDisposition: null,
    toDisposition: null,
    confidence: 'confirmed',
    directed: false,
    startSessionNumber: null,
    endSessionNumber: null,
    severed: false,
    justFormed: false,
    ...over
  }
}

const has = (edges: GraphEdge[], a: string, b: string, relation?: string): boolean =>
  edges.some(
    (e) =>
      ((e.from === a && e.to === b) || (e.from === b && e.to === a)) &&
      (relation === undefined || e.relation === relation)
  )

describe('parentOf', () => {
  it('reads the parent from both authored directions', () => {
    // located_in / member_of: child is `from`, parent is `to`.
    expect(parentOf('npc', [edge('npc', 'manor', 'located_in')])).toBe('manor')
    expect(parentOf('npc', [edge('npc', 'guild', 'member_of')])).toBe('guild')
    // contains / has_member: child is `to`, parent is `from`.
    expect(parentOf('npc', [edge('manor', 'npc', 'contains')])).toBe('manor')
    expect(parentOf('npc', [edge('guild', 'npc', 'has_member')])).toBe('guild')
  })

  it('returns null for a pure parent or a non-hierarchical tie', () => {
    expect(parentOf('manor', [edge('npc', 'manor', 'located_in')])).toBeNull()
    expect(parentOf('a', [edge('a', 'b', 'knows')])).toBeNull()
    expect(parentOf('a', [edge('a', 'b', 'not_a_real_relation')])).toBeNull()
  })
})

describe('descendantsOf', () => {
  it('collects transitive descendants, cycle-safe', () => {
    const edges = [
      edge('city', 'region', 'located_in'), // region contains city
      edge('inn', 'city', 'located_in'), // city contains inn
      edge('barkeep', 'inn', 'located_in') // inn contains barkeep
    ]
    expect(descendantsOf('region', edges)).toEqual(new Set(['city', 'inn', 'barkeep']))
    expect(descendantsOf('inn', edges)).toEqual(new Set(['barkeep']))
    // A malformed cycle must not hang.
    const cyclic = [edge('a', 'b', 'located_in'), edge('b', 'a', 'located_in')]
    expect(descendantsOf('a', cyclic)).toEqual(new Set(['b']))
  })
})

describe('collapsibleParents', () => {
  it('lists nodes that contain at least one child', () => {
    const edges = [edge('a', 'faction', 'member_of'), edge('faction', 'b', 'has_member')]
    expect(collapsibleParents(edges)).toEqual(new Set(['faction']))
  })
})

describe('reduceGraph — collapse', () => {
  const graph: CampaignGraph = {
    nodes: [
      node('faction', 'faction'),
      node('m1'),
      node('m2'),
      node('outsider'),
      node('mc', 'pc')
    ],
    edges: [
      edge('m1', 'faction', 'member_of'),
      edge('m2', 'faction', 'member_of'),
      edge('m1', 'outsider', 'knows'), // external tie from a member
      edge('m2', 'outsider', 'knows'), // second member → same outsider
      edge('mc', 'outsider', 'knows')
    ]
  }

  it('folds members into a counted super-node and reroutes external ties', () => {
    const r = reduceGraph(graph, { collapsed: new Set(['faction']) })
    const ids = r.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['faction', 'mc', 'outsider']) // m1 / m2 folded away
    expect(r.collapsedCounts.get('faction')).toBe(2)
    // The internal membership edges are gone; the two members' ties to `outsider` reroute to the
    // super-node and dedupe to ONE edge.
    expect(has(r.edges, 'faction', 'outsider', 'knows')).toBe(true)
    expect(r.edges.filter((e) => e.relation === 'member_of')).toHaveLength(0)
    expect(r.edges.filter((e) => has([e], 'faction', 'outsider'))).toHaveLength(1)
  })

  it('is a no-op when nothing is collapsed', () => {
    const r = reduceGraph(graph, {})
    expect(r.nodes).toHaveLength(graph.nodes.length)
    expect(r.edges).toHaveLength(graph.edges.length)
    expect(r.collapsedCounts.size).toBe(0)
  })

  it('subsumes a nested collapse into the highest surviving ancestor', () => {
    const nested: CampaignGraph = {
      nodes: [node('region', 'location'), node('city', 'location'), node('n'), node('x')],
      edges: [
        edge('city', 'region', 'located_in'),
        edge('n', 'city', 'located_in'),
        edge('n', 'x', 'knows')
      ]
    }
    const r = reduceGraph(nested, { collapsed: new Set(['region', 'city']) })
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['region', 'x'])
    expect(r.collapsedCounts.get('region')).toBe(2) // city + n
    expect(r.collapsedCounts.has('city')).toBe(false) // city itself was folded into region
    expect(has(r.edges, 'region', 'x', 'knows')).toBe(true)
  })
})

describe('reduceGraph — hide minor', () => {
  const graph: CampaignGraph = {
    nodes: [node('hub'), node('spoke'), node('extra'), node('loner'), node('mc', 'pc')],
    edges: [
      edge('hub', 'spoke', 'knows'),
      edge('hub', 'mc', 'knows'),
      edge('hub', 'extra', 'knows') // gives hub degree 3
    ]
  }

  it('drops the isolated / single-tie tail but keeps the main character', () => {
    const r = reduceGraph(graph, { hideMinor: true, minDegree: 2, mainCharacterId: 'mc' })
    const ids = r.nodes.map((n) => n.id).sort()
    expect(ids).toContain('hub') // degree 3
    expect(ids).toContain('mc') // degree 1 but the MC is always kept
    expect(ids).not.toContain('spoke') // degree 1
    expect(ids).not.toContain('extra') // degree 1
    expect(ids).not.toContain('loner') // degree 0
    // Edges touching a pruned node are gone.
    expect(has(r.edges, 'hub', 'spoke')).toBe(false)
  })

  it('never prunes a collapsed super-node even when its degree is low', () => {
    const g: CampaignGraph = {
      nodes: [
        node('faction', 'faction'),
        node('m1'),
        node('m2'),
        node('busy'),
        node('p'),
        node('q')
      ],
      edges: [
        edge('m1', 'faction', 'member_of'),
        edge('m2', 'faction', 'member_of'),
        edge('faction', 'busy', 'ally_of'), // super-node's only external tie → degree 1
        edge('busy', 'p', 'knows'),
        edge('busy', 'q', 'knows')
      ]
    }
    const r = reduceGraph(g, { collapsed: new Set(['faction']), hideMinor: true, minDegree: 2 })
    expect(r.nodes.map((n) => n.id)).toContain('faction') // survives despite degree 1
    expect(r.collapsedCounts.get('faction')).toBe(2)
  })
})
