import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation
} from 'd3-force'
import { Waypoints } from 'lucide-react'
import { ENTITY_TYPE_LABELS } from '@shared/entity-types'
import type { CampaignGraph, GraphNode } from '@shared/graph-types'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useCampaigns, useCampaignGraph } from '@renderer/hooks/use-ledger'

// The "Web" view (P2-3): a read-only, force-directed map of the campaign's LIVE relationships. d3-force
// computes the layout; we render it as hand-written SVG so it inherits the Ash & Ember theme (the ember
// accent is reserved for the main character; everyone else stays in the muted iron register — the design
// guardrail). Pan (background drag) · zoom (wheel) · drag a node to reposition (it pins) · click a node
// to open it (MC → Character, else Codex). MainPanel keeps every view mounted, so the simulation only
// runs while this view is active and stops when hidden.

const NODE_R = 22 // node circle radius (world units)
const LABEL_GAP = 30 // where the name sits below the node center

interface SimNode extends GraphNode {
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}
interface SimLink {
  source: string | SimNode
  target: string | SimNode
  id: string
  label: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// A stable signature of the graph's shape — the simulation only rebuilds when the node/edge SET changes
// (add/remove/rename/re-tie), not on every unrelated re-render.
function graphSignature(g: CampaignGraph): string {
  return (
    g.nodes.map((n) => `${n.id}:${n.lifecycle}`).join(',') +
    '|' +
    g.edges.map((e) => `${e.id}:${e.label}`).join(',')
  )
}

export function WebView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const isActive = useUiStore((s) => s.activeView === 'web')
  const { graph, refresh } = useCampaignGraph(activeCampaignId)
  const { campaigns } = useCampaigns()
  const mainCharacterId = campaigns.find((c) => c.id === activeCampaignId)?.mainCharacterId ?? null

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const rafRef = useRef<number | null>(null)
  // Positions survive a rebuild (re-tie, rename) so the map doesn't scramble on every change.
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const [, repaint] = useReducer((n: number) => n + 1, 0)

  const [dims, setDims] = useState({ w: 900, h: 640 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [links, setLinks] = useState<SimLink[]>([])

  // Pointer interaction state (kept in a ref so mid-drag moves don't thrash React state).
  const drag = useRef<{
    mode: 'pan' | 'node' | null
    node: SimNode | null
    startX: number
    startY: number
    startView: { x: number; y: number; k: number }
    moved: boolean
  }>({ mode: null, node: null, startX: 0, startY: 0, startView: view, moved: false })

  const signature = useMemo(() => graphSignature(graph), [graph])

  // Refetch the moment the view becomes active (entitiesVersion covers changes while it's already open).
  useEffect(() => {
    if (isActive) refresh()
  }, [isActive, refresh])

  // Track the container size so forceCenter puts the cloud in the middle of the visible area.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0 && r.height > 0) setDims({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Build (or rebuild) the force simulation. Only runs while the view is active; a fresh sim on every
  // activation is cheap for campaign-sized graphs and lets us reheat + re-center on the current size.
  useEffect(() => {
    if (!isActive || graph.nodes.length === 0) {
      simRef.current?.stop()
      simRef.current = null
      return
    }
    const simNodes: SimNode[] = graph.nodes.map((n) => {
      const prev = posRef.current.get(n.id)
      return { ...n, x: prev?.x, y: prev?.y }
    })
    const byId = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks: SimLink[] = graph.edges
      .filter((e) => byId.has(e.from) && byId.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, id: e.id, label: e.label }))

    const sim = forceSimulation<SimNode, SimLink>(simNodes)
      .force('charge', forceManyBody<SimNode>().strength(-420))
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(110)
          .strength(0.5)
      )
      .force('center', forceCenter(dims.w / 2, dims.h / 2))
      .force('collide', forceCollide<SimNode>(NODE_R + 14))
      .on('tick', () => {
        for (const n of simNodes) {
          if (n.x != null && n.y != null) posRef.current.set(n.id, { x: n.x, y: n.y })
        }
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            repaint()
          })
        }
      })

    simRef.current = sim
    setNodes(simNodes)
    setLinks(simLinks)

    return () => {
      sim.stop()
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // Keyed on the graph SHAPE (signature) + size — NOT the graph object identity — so unrelated
    // re-renders don't rebuild the sim mid-settle. `graph`/`repaint` are intentionally omitted.
  }, [isActive, signature, dims.w, dims.h])

  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect()
    const px = clientX - (rect?.left ?? 0)
    const py = clientY - (rect?.top ?? 0)
    return { x: (px - view.x) / view.k, y: (py - view.y) / view.k }
  }

  function onNodePointerDown(e: React.PointerEvent, node: SimNode): void {
    e.stopPropagation()
    svgRef.current?.setPointerCapture(e.pointerId)
    drag.current = {
      mode: 'node',
      node,
      startX: e.clientX,
      startY: e.clientY,
      startView: view,
      moved: false
    }
    simRef.current?.alphaTarget(0.3).restart()
  }

  function onBackgroundPointerDown(e: React.PointerEvent): void {
    svgRef.current?.setPointerCapture(e.pointerId)
    drag.current = {
      mode: 'pan',
      node: null,
      startX: e.clientX,
      startY: e.clientY,
      startView: view,
      moved: false
    }
  }

  function onPointerMove(e: React.PointerEvent): void {
    const d = drag.current
    if (!d.mode) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
    if (d.mode === 'pan') {
      setView({ ...d.startView, x: d.startView.x + dx, y: d.startView.y + dy })
    } else if (d.mode === 'node' && d.node) {
      const w = toWorld(e.clientX, e.clientY)
      d.node.fx = w.x
      d.node.fy = w.y
    }
  }

  function onPointerUp(e: React.PointerEvent): void {
    const d = drag.current
    svgRef.current?.releasePointerCapture(e.pointerId)
    if (d.mode === 'node' && d.node) {
      simRef.current?.alphaTarget(0)
      // A tap (no real movement) opens the entity; a drag leaves it pinned where dropped.
      if (!d.moved) openNode(d.node)
    }
    drag.current = { mode: null, node: null, startX: 0, startY: 0, startView: view, moved: false }
  }

  function onWheel(e: React.WheelEvent): void {
    const rect = svgRef.current?.getBoundingClientRect()
    const mx = e.clientX - (rect?.left ?? 0)
    const my = e.clientY - (rect?.top ?? 0)
    const k2 = Math.min(3, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 0.89)))
    const f = k2 / view.k
    setView({ k: k2, x: mx - (mx - view.x) * f, y: my - (my - view.y) * f })
  }

  function openNode(node: SimNode): void {
    if (node.id === mainCharacterId) setActiveView('character')
    else {
      setSelectedEntity(node.id)
      setActiveView('capture')
    }
  }

  const hasCampaign = Boolean(activeCampaignId)
  const empty = hasCampaign && graph.nodes.length === 0

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Waypoints className="size-4 text-primary" />
          <h1 className="font-display text-lg font-semibold text-foreground">Web</h1>
          <span className="text-xs text-muted-foreground">The campaign’s living relationships</span>
        </div>
        {graph.nodes.length > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {graph.nodes.length} {graph.nodes.length === 1 ? 'entity' : 'entities'} ·{' '}
            {graph.edges.length} {graph.edges.length === 1 ? 'tie' : 'ties'}
          </span>
        )}
      </header>

      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {!hasCampaign ? (
          <CenterNote>Choose a campaign to see its web of relationships.</CenterNote>
        ) : empty ? (
          <CenterNote>
            No entities yet. Inscribe a few in the Codex and tie them together — they’ll appear here.
          </CenterNote>
        ) : (
          <svg
            ref={svgRef}
            className="size-full touch-none select-none"
            style={{ cursor: drag.current.mode === 'pan' ? 'grabbing' : 'grab' }}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
          >
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {links.map((l) => {
                const s = l.source as SimNode
                const t = l.target as SimNode
                if (s?.x == null || t?.x == null || s.y == null || t.y == null) return null
                const mx = (s.x + t.x) / 2
                const my = (s.y + t.y) / 2
                return (
                  <g key={l.id}>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="var(--iron)"
                      strokeWidth={1.5}
                    />
                    <text
                      x={mx}
                      y={my}
                      textAnchor="middle"
                      dy="-0.2em"
                      className="font-mono"
                      fontSize={8}
                      fill="var(--ash)"
                    >
                      {l.label}
                    </text>
                  </g>
                )
              })}

              {nodes.map((n) => {
                if (n.x == null || n.y == null) return null
                return (
                  <GraphNodeGlyph
                    key={n.id}
                    node={n}
                    isMain={n.id === mainCharacterId}
                    onPointerDown={(e) => onNodePointerDown(e, n)}
                  />
                )
              })}
            </g>
          </svg>
        )}

        {!empty && hasCampaign && (
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] text-muted-foreground/70">
            drag to pan · scroll to zoom · drag a node to move it · click to open
          </p>
        )}
      </div>
    </div>
  )
}

function GraphNodeGlyph({
  node,
  isMain,
  onPointerDown
}: {
  node: SimNode
  isMain: boolean
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const dim = node.lifecycle === 'ended' || node.lifecycle === 'presumed_ended'
  const ring = isMain ? 'var(--ember)' : 'var(--iron)'
  const clipId = `web-clip-${node.id}`
  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      onPointerDown={onPointerDown}
      style={{ cursor: 'pointer', opacity: dim ? 0.5 : 1 }}
    >
      <title>
        {node.name} · {ENTITY_TYPE_LABELS[node.type]}
      </title>
      <circle r={NODE_R} fill="var(--char-raised)" stroke={ring} strokeWidth={isMain ? 2.5 : 1.5} />
      {node.image ? (
        <>
          <clipPath id={clipId}>
            <circle r={NODE_R - 2} />
          </clipPath>
          <image
            href={node.image}
            x={-(NODE_R - 2)}
            y={-(NODE_R - 2)}
            width={(NODE_R - 2) * 2}
            height={(NODE_R - 2) * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
            style={dim ? { filter: 'grayscale(1)' } : undefined}
          />
        </>
      ) : (
        <text
          textAnchor="middle"
          dy="0.35em"
          className="font-display"
          fontSize={13}
          fontWeight={600}
          fill="var(--bone-dim)"
        >
          {initials(node.name)}
        </text>
      )}
      <text
        y={LABEL_GAP}
        textAnchor="middle"
        className="font-sans"
        fontSize={11}
        fill="var(--bone)"
        style={{ paintOrder: 'stroke', stroke: 'var(--char)', strokeWidth: 3 }}
      >
        {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
      </text>
    </g>
  )
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
