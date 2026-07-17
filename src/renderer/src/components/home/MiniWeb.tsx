import { useMemo } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'
import type { EntityType } from '@shared/entity-types'
import type { CampaignGraph } from '@shared/graph-types'
import { ENTITY_TYPE_COLOR } from '@renderer/lib/entity-visuals'

// The Home dashboard's relationship-web teaser (ADR-061): a tiny STATIC render of the live graph —
// same force recipe as the real Web view, but run to completion synchronously in a useMemo
// (`.stop()` + tick×150) instead of animating. Dots colored by entity type, the main character ringed
// in ember, no labels, no interaction beyond "click anywhere → open the Web".

const W = 320
const H = 176
const MAX_NODES = 50

interface MiniNode extends SimulationNodeDatum {
  id: string
  type: EntityType
  mc: boolean
  deg: number
}
type MiniLink = SimulationLinkDatum<MiniNode>

export function MiniWeb({
  graph,
  mainCharacterId,
  onOpen
}: {
  graph: CampaignGraph
  mainCharacterId: string | null
  onOpen: () => void
}) {
  const layout = useMemo(() => {
    const degree = new Map<string, number>()
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
    }
    let nodes = graph.nodes
    if (nodes.length > MAX_NODES) {
      // Teaser, not atlas: keep the best-connected corner of the web.
      nodes = [...nodes]
        .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
        .slice(0, MAX_NODES)
    }
    const keep = new Set(nodes.map((n) => n.id))
    const simNodes: MiniNode[] = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      mc: n.id === mainCharacterId,
      deg: degree.get(n.id) ?? 0
    }))
    if (simNodes.length < 2) return null
    const simLinks: MiniLink[] = graph.edges
      .filter((e) => keep.has(e.from) && keep.has(e.to))
      .map((e) => ({ source: e.from, target: e.to }))

    const sim = forceSimulation<MiniNode>(simNodes)
      .force('charge', forceManyBody<MiniNode>().strength(-60))
      .force(
        'link',
        forceLink<MiniNode, MiniLink>(simLinks)
          .id((d) => d.id)
          .distance(28)
          .strength(0.6)
      )
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide<MiniNode>().radius(7))
      .stop()
    for (let i = 0; i < 150; i++) sim.tick()
    for (const n of simNodes) {
      n.x = Math.max(8, Math.min(W - 8, n.x ?? W / 2))
      n.y = Math.max(8, Math.min(H - 8, n.y ?? H / 2))
    }
    return { simNodes, simLinks }
  }, [graph, mainCharacterId])

  if (!layout) {
    return (
      <p className="text-xs text-muted-foreground">
        The web grows as ties form — Extract and Illuminate weave it from your chronicle.
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the Web"
      title="Open the Web"
      className="block w-full cursor-pointer rounded-md transition-opacity hover:opacity-85"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full">
        {layout.simLinks.map((l, i) => {
          const s = l.source as MiniNode
          const t = l.target as MiniNode
          return (
            <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="var(--iron)" strokeWidth={0.75} />
          )
        })}
        {layout.simNodes.map((n) => (
          <circle
            key={n.id}
            cx={n.x}
            cy={n.y}
            r={n.mc ? 5 : 3 + Math.min(2, n.deg * 0.4)}
            fill={ENTITY_TYPE_COLOR[n.type]}
            stroke={n.mc ? 'var(--ember-bright)' : 'none'}
            strokeWidth={n.mc ? 1.5 : 0}
          />
        ))}
      </svg>
    </button>
  )
}
