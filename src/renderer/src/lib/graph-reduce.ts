// Pure graph-reduction core for the Web view (relationship graph legibility at scale). Keeping this
// side-effect-free — no React, no d3, only @shared types — lets the tricky bits (transitive collapse,
// edge rerouting, minor-node pruning) be unit-tested directly, the way the repo isolates other pure
// cores (lib/mention.ts, applyRerankScores, selectEnrichRoster). WebView.tsx feeds the live campaign
// graph through reduceGraph and renders/simulates the result, so hiding or collapsing actually TIGHTENS
// the force layout (the sim is built from these nodes/edges) rather than just masking render output.

import type { CampaignGraph, GraphEdge, GraphNode } from '@shared/graph-types'
import { isRelationKey, type RelationKey } from '@shared/relations'

// Which endpoint of a containment edge holds the PARENT (the location / faction). `located_in` and
// `member_of` are authored child→parent, so the parent is `to`; the inverse `contains` / `has_member`
// are parent→child, so the parent is `from`. These are exactly the RELATIONS with `hierarchical: true`.
const PARENT_SIDE: Partial<Record<RelationKey, 'from' | 'to'>> = {
  located_in: 'to',
  member_of: 'to',
  contains: 'from',
  has_member: 'from'
}

/**
 * The container / faction a node sits directly under, read from a hierarchical edge in either authored
 * direction (`located_in`/`member_of` OR the inverse `contains`/`has_member`). Generalizes WebView's old
 * `clusterOf` (which only saw the `located_in`/`member_of` direction). Returns the first parent found —
 * a node under both a place and a faction resolves to whichever hierarchical edge comes first — or null
 * when the node contains things but is contained by nothing.
 */
export function parentOf(nodeId: string, edges: GraphEdge[]): string | null {
  for (const e of edges) {
    if (!isRelationKey(e.relation)) continue
    const side = PARENT_SIDE[e.relation]
    if (!side) continue
    // The node is the CHILD when it sits on the non-parent side of the edge.
    if (side === 'to' && e.from === nodeId) return e.to
    if (side === 'from' && e.to === nodeId) return e.from
  }
  return null
}

/** parent id → its direct child ids, from the hierarchical edges (both authored directions). */
function buildChildrenMap(edges: GraphEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!isRelationKey(e.relation)) continue
    const side = PARENT_SIDE[e.relation]
    if (!side) continue
    const parent = side === 'to' ? e.to : e.from
    const child = side === 'to' ? e.from : e.to
    if (parent === child) continue
    let set = m.get(parent)
    if (!set) {
      set = new Set()
      m.set(parent, set)
    }
    set.add(child)
  }
  return m
}

function descendantsWith(parentId: string, children: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>()
  const queue: string[] = [parentId]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const child of children.get(cur) ?? []) {
      if (child === parentId || out.has(child)) continue // cycle-safe; never fold the root into itself
      out.add(child)
      queue.push(child)
    }
  }
  return out
}

/**
 * Every node transitively contained under `parentId` — BFS over the child map, so a collapsed location
 * folds in nested locations and their contents, not just the direct children (avoids orphaned
 * grandchildren). Cycle-safe; excludes the parent itself.
 */
export function descendantsOf(parentId: string, edges: GraphEdge[]): Set<string> {
  return descendantsWith(parentId, buildChildrenMap(edges))
}

/** Node ids that contain at least one child — the locations/factions a user may collapse. Derive this
 *  from the RAW (pre-collapse) edges, since collapsing removes a group's internal membership edges. */
export function collapsibleParents(edges: GraphEdge[]): Set<string> {
  const out = new Set<string>()
  for (const [parent, kids] of buildChildrenMap(edges)) if (kids.size > 0) out.add(parent)
  return out
}

export interface ReduceOptions {
  /** Parent ids to collapse — each folds its transitive descendants into a single super-node. */
  collapsed?: Set<string>
  /** Drop the long tail: nodes below `minDegree` live ties (never the MC or a super-node). */
  hideMinor?: boolean
  minDegree?: number
  mainCharacterId?: string | null
}

export interface ReducedGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** super-node id → number of descendants folded into it (drives the count badge). */
  collapsedCounts: Map<string, number>
}

/**
 * Reduce the live campaign graph for legibility:
 *  1. COLLAPSE — for each collapsed parent, remove its transitive descendants, keep the parent as the
 *     super-node (its own id IS the super-node id — no synthetic node), re-point every descendant's
 *     EXTERNAL edges onto the parent, drop the now-internal edges (self-loops), and dedupe the parallels
 *     that rerouting creates. Nested collapses subsume: a descendant that was itself collapsed just folds
 *     into the highest surviving ancestor.
 *  2. HIDE-MINOR — on the collapsed graph, drop nodes below `minDegree` live ties, except the main
 *     character and any super-node.
 * The returned nodes/edges are what WebView both SIMULATES and renders, so the layout tightens.
 */
export function reduceGraph(graph: CampaignGraph, opts: ReduceOptions = {}): ReducedGraph {
  const collapsed = opts.collapsed ?? new Set<string>()
  const hideMinor = opts.hideMinor ?? false
  const minDegree = opts.minDegree ?? 2
  const mainCharacterId = opts.mainCharacterId ?? null

  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const children = buildChildrenMap(graph.edges)

  // Descendant sets, memoized (a parent is queried for both `removed` and `collapsedCounts`).
  const descCache = new Map<string, Set<string>>()
  const descOf = (id: string): Set<string> => {
    let d = descCache.get(id)
    if (!d) {
      d = descendantsWith(id, children)
      descCache.set(id, d)
    }
    return d
  }

  // Everything folded away by any collapse (a collapsed parent nested inside another lands here too).
  const removed = new Set<string>()
  for (const id of collapsed) {
    if (!nodeIds.has(id)) continue
    for (const d of descOf(id)) removed.add(d)
  }
  // Super-nodes = collapsed parents that survive (not folded into a higher collapse) and have children.
  const superNodes = [...collapsed].filter(
    (id) => nodeIds.has(id) && !removed.has(id) && descOf(id).size > 0
  )
  // Map each removed node to the surviving super-node it folds into (first surviving ancestor wins).
  const remap = new Map<string, string>()
  const collapsedCounts = new Map<string, number>()
  for (const s of superNodes) {
    const desc = descOf(s)
    collapsedCounts.set(s, desc.size)
    for (const d of desc) if (!remap.has(d)) remap.set(d, s)
  }
  const project = (id: string): string => remap.get(id) ?? id

  let nodes = graph.nodes.filter((n) => !removed.has(n.id))
  const survivingIds = new Set(nodes.map((n) => n.id))

  // Reroute endpoints onto super-nodes; drop internal edges (self-loops) and dedupe the parallels that
  // rerouting produces (many members tied to the same outsider → one edge from the super-node).
  const seen = new Set<string>()
  let edges: GraphEdge[] = []
  for (const e of graph.edges) {
    const from = project(e.from)
    const to = project(e.to)
    if (from === to) continue // internal to a collapsed group
    if (!survivingIds.has(from) || !survivingIds.has(to)) continue // dangling
    const key = from < to ? `${from}|${to}|${e.relation}` : `${to}|${from}|${e.relation}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(from === e.from && to === e.to ? e : { ...e, from, to })
  }

  if (hideMinor) {
    const deg = new Map<string, number>()
    for (const e of edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
    }
    const kept = new Set(
      nodes
        .filter(
          (n) =>
            n.id === mainCharacterId ||
            collapsedCounts.has(n.id) ||
            (deg.get(n.id) ?? 0) >= minDegree
        )
        .map((n) => n.id)
    )
    nodes = nodes.filter((n) => kept.has(n.id))
    edges = edges.filter((e) => kept.has(e.from) && kept.has(e.to))
  }

  return { nodes, edges, collapsedCounts }
}
