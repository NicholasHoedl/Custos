import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Force,
  type Simulation
} from 'd3-force'
import {
  BookOpen,
  Boxes,
  Camera,
  ExternalLink,
  EyeOff,
  MessagesSquare,
  Pause,
  Play,
  Search,
  Waypoints,
  X
} from 'lucide-react'
import { ENTITY_TYPE_LABELS, type EntityType, type NoteConfidence } from '@shared/entity-types'
import type { CampaignGraph, GraphEdge, GraphNode } from '@shared/graph-types'
import { collapsibleParents, descendantsOf, parentOf, reduceGraph } from '@renderer/lib/graph-reduce'
import { ENTITY_TYPE_COLOR, ENTITY_TYPE_ICON } from '@renderer/lib/entity-visuals'
import { PaneHeader } from '@renderer/components/chrome'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useUiStore } from '@renderer/store/ui-store'
import { useCampaigns, useCampaignGraph, useSessions } from '@renderer/hooks/use-ledger'

// The "Web" view (P2-3, enriched in the Web feature pass): a force-directed map of the campaign's
// relationships, rendered as hand-written SVG so it inherits the Ash & Ember theme. Beyond the base
// layout it now expresses the DATA the model already holds: edges are coloured by disposition (allied vs.
// hostile), dashed by confidence (rumoured/suspected), and arrowed by direction; nodes scale by how
// connected they are. A session TIME SLIDER (+ playback) reconstructs the web at any point in the story;
// FILTER / SEARCH / FOCUS tame a large cast; and a node is a launchpad into the AI lenses (Converse an
// NPC, ask Lore about a node or a pair). MainPanel keeps every view mounted, so the sim runs only while
// this view is active.

const LABEL_GAP = 8 // extra gap below the node edge for the name label

// Label level-of-detail (#1) — a growing cast overlaps its labels into mush, so labels are rationed:
// always shown on a small graph, once zoomed in, for important/hovered/focused nodes, and edge labels
// only when zoomed or hovered. These thresholds are the knobs.
const SMALL_GRAPH = 30 // ≤ this many (reduced) nodes → show every label (also keeps the 2-node e2e green)
const LABEL_ZOOM = 1.4 // zoom past this → reveal all node labels
const EDGE_LABEL_ZOOM = 1.6 // zoom past this → reveal edge labels
const IMPORTANT_DEGREE = 3 // a node with ≥ this many ties is a hub → always labelled

// Legend / filter order — the living (pc/npc/creature) before the structural (faction/location) and the
// inert (item/quest/event). Every EntityType appears; the entity-visuals maps keep this exhaustive.
const LEGEND_ORDER: EntityType[] = [
  'pc',
  'npc',
  'creature',
  'faction',
  'location',
  'item',
  'quest',
  'event'
]

// ---- Edge styling: emotional temperature + epistemic weight, from the tie's own fields ----
type EdgeTone = 'warm' | 'cold' | 'neutral'
// A tie's temperature, read from the two free-text dispositions (ADR-033) by keyword — imperfect but
// enough to paint alliances vs. frictions at a glance. Cold wins ties: a one-sided hostility is worth seeing.
const WARM_WORDS =
  /\b(all(y|ies|ied)|friend|love|loyal|trust|fond|grateful|protect|admire|respect|devot|kin|family|care|warm)/i
const COLD_WORDS =
  /\b(enem|hate|hostile|distrust|wary|fear|afraid|resent|rival|despis|betray|anger|angry|suspicio|contempt|threat|grudge|cold|cruel)/i
function dispositionTone(text: string | null): EdgeTone {
  if (!text) return 'neutral'
  if (COLD_WORDS.test(text)) return 'cold'
  if (WARM_WORDS.test(text)) return 'warm'
  return 'neutral'
}
function edgeTone(e: GraphEdge): EdgeTone {
  const a = dispositionTone(e.fromDisposition)
  const b = dispositionTone(e.toDisposition)
  if (a === 'cold' || b === 'cold') return 'cold'
  if (a === 'warm' || b === 'warm') return 'warm'
  return 'neutral'
}
const TONE_COLOR: Record<EdgeTone, string> = {
  warm: '#5f9c86', // sage — allied
  cold: '#c9704c', // ember-clay — hostile
  neutral: 'var(--iron)'
}
const CONFIDENCE_DASH: Record<NoteConfidence, string | undefined> = {
  confirmed: undefined,
  suspected: '6 5',
  rumored: '2 5'
}
function edgeTitle(e: GraphEdge): string {
  const bits = [e.label]
  if (e.confidence !== 'confirmed') bits[0] = `${e.label} (${e.confidence})`
  if (e.description) bits.push(e.description)
  if (e.fromDisposition) bits.push(`→ feels: ${e.fromDisposition}`)
  if (e.toDisposition) bits.push(`← feels: ${e.toDisposition}`)
  return bits.join(' · ')
}
// Node radius grows with degree so the campaign's hubs read as bigger.
function radiusFor(degree: number): number {
  return 16 + Math.min(16, degree * 2.2)
}

interface SimNode extends GraphNode {
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  r: number // radius (degree-scaled)
  cluster: string | null // location/faction parent id (for the optional grouping force)
}
interface SimLink {
  source: string | SimNode
  target: string | SimNode
  id: string
  from: string
  to: string
  label: string
  directed: boolean
  tone: EdgeTone
  confidence: NoteConfidence // raw certainty, so the "hide rumoured" filter can read it
  dash: string | undefined
  title: string
  severed: boolean
  justFormed: boolean
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// A stable signature of the graph's shape + edge styling — the sim rebuilds when the node/edge SET or the
// styling-relevant fields change (add/remove/rename/re-tie, or a time-slider move that swaps the live edges),
// preserving positions via posRef so the map never scrambles.
function graphSignature(g: CampaignGraph): string {
  return (
    g.nodes.map((n) => `${n.id}:${n.lifecycle}`).join(',') +
    '|' +
    g.edges.map((e) => `${e.id}:${e.severed ? 's' : e.justFormed ? 'f' : 'l'}`).join(',')
  )
}

// A gentle grouping force (opt-in): each tick, nudge every node toward the centroid of its cluster
// siblings so locations/factions read as loose neighbourhoods. Off by default, so it's contained even if
// the layout it produces is imperfect.
function clusterForce(): Force<SimNode, SimLink> {
  let ns: SimNode[] = []
  const force: Force<SimNode, SimLink> = (alpha) => {
    const cen = new Map<string, { x: number; y: number; n: number }>()
    for (const n of ns) {
      if (!n.cluster || n.x == null || n.y == null) continue
      const c = cen.get(n.cluster) ?? { x: 0, y: 0, n: 0 }
      c.x += n.x
      c.y += n.y
      c.n += 1
      cen.set(n.cluster, c)
    }
    for (const n of ns) {
      if (!n.cluster || n.x == null || n.y == null) continue
      const c = cen.get(n.cluster)!
      n.vx = (n.vx ?? 0) + (c.x / c.n - n.x) * 0.14 * alpha
      n.vy = (n.vy ?? 0) + (c.y / c.n - n.y) * 0.14 * alpha
    }
  }
  force.initialize = (nodesArr) => {
    ns = nodesArr
  }
  return force
}

export function WebView() {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const setSelectedEntity = useAppStore((s) => s.setSelectedEntity)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const openLens = useUiStore((s) => s.openLens)
  const isActive = useUiStore((s) => s.activeView === 'web')
  const { sessions } = useSessions(activeCampaignId)

  // Time: null = "now" (live), else the session number the web is reconstructed AS OF.
  const [asOf, setAsOf] = useState<number | null>(null)
  const { graph, refresh } = useCampaignGraph(activeCampaignId, asOf ?? undefined)
  const { campaigns } = useCampaigns()
  const mainCharacterId = campaigns.find((c) => c.id === activeCampaignId)?.mainCharacterId ?? null

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const rafRef = useRef<number | null>(null)
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const [, repaint] = useReducer((n: number) => n + 1, 0)

  const [dims, setDims] = useState({ w: 900, h: 640 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [links, setLinks] = useState<SimLink[]>([])

  // View controls.
  const [hidden, setHidden] = useState<Set<EntityType>>(new Set()) // filtered-out types
  const [hideFallen, setHideFallen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null) // isolate this node + its neighbours
  const [pair, setPair] = useState<string[]>([]) // up to 2 nodes, for "what's between them"
  const [search, setSearch] = useState('')
  const [cluster, setCluster] = useState(false)
  const [hideMinor, setHideMinor] = useState(false) // #2: drop the isolated / single-tie long tail
  const [hideWeak, setHideWeak] = useState(false) // #4: hide rumoured / suspected ties
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()) // #3: folded-away parent ids
  const [hoveredId, setHoveredId] = useState<string | null>(null) // #1: label LOD on hover
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [playing, setPlaying] = useState(false)

  const drag = useRef<{
    mode: 'pan' | 'node' | null
    node: SimNode | null
    startX: number
    startY: number
    startView: { x: number; y: number; k: number }
    moved: boolean
  }>({ mode: null, node: null, startX: 0, startY: 0, startView: view, moved: false })

  // Reduce the live graph for legibility (#2 hide-minor, #3 collapse) — this is what the sim BUILDS from
  // and what we render, so hiding / collapsing actually tightens the layout instead of just masking
  // output. Type / fallen / focus filters stay render-only (visibleIds) so toggling them never
  // reshuffles the map.
  const effective = useMemo(
    () => reduceGraph(graph, { collapsed, hideMinor, mainCharacterId }),
    [graph, collapsed, hideMinor, mainCharacterId]
  )
  // Parents the user CAN collapse — read from the RAW (pre-collapse) edges, since collapsing removes a
  // group's internal membership edges (a collapsed super-node would otherwise stop looking collapsible).
  const collapsible = useMemo(() => collapsibleParents(graph.edges), [graph.edges])
  // #3: how many entities sit under each collapsible parent — feeds the count badge + toggle affordance.
  const descendantCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const id of collapsible) m.set(id, descendantsOf(id, graph.edges).size)
    return m
  }, [collapsible, graph.edges])

  const signature = useMemo(
    () => graphSignature(effective) + (cluster ? '|C' : ''),
    [effective, cluster]
  )
  const sessionNumbers = useMemo(
    () => sessions.map((s) => s.number).sort((a, b) => a - b),
    [sessions]
  )

  // Degree (how many live ties touch each node) → node size. Over the REDUCED edges, so a super-node's
  // size reflects its rerouted external ties and pruned nodes fall away.
  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const e of effective.edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1)
      d.set(e.to, (d.get(e.to) ?? 0) + 1)
    }
    return d
  }, [effective.edges])

  // Neighbours of the focused node (1 hop) — for the isolate/dim treatment.
  const neighborhood = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const e of effective.edges) {
      if (e.from === focusId) set.add(e.to)
      if (e.to === focusId) set.add(e.from)
    }
    return set
  }, [focusId, effective.edges])

  // Which node ids are visible after the type / fallen / focus filters (render-only, over the reduced set).
  const visibleIds = useMemo(() => {
    const set = new Set<string>()
    for (const n of effective.nodes) {
      if (hidden.has(n.type)) continue
      if (hideFallen && n.faded) continue
      if (neighborhood && !neighborhood.has(n.id)) continue
      set.add(n.id)
    }
    return set
  }, [effective.nodes, hidden, hideFallen, neighborhood])

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    return new Set(effective.nodes.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id))
  }, [search, effective.nodes])

  useEffect(() => {
    if (isActive) refresh()
  }, [isActive, refresh])

  // Playback: step the as-of slider forward one session at a time, then stop at "now".
  useEffect(() => {
    if (!playing) return
    if (sessionNumbers.length === 0) {
      setPlaying(false)
      return
    }
    const id = setInterval(() => {
      setAsOf((cur) => {
        const first = sessionNumbers[0]
        const last = sessionNumbers[sessionNumbers.length - 1]
        if (cur === null) return first
        const next = sessionNumbers.find((n) => n > cur)
        if (next === undefined || cur >= last) {
          setPlaying(false)
          return null // reached the present
        }
        return next
      })
    }, 1400)
    return () => clearInterval(id)
  }, [playing, sessionNumbers])

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

  // Build (or rebuild) the force simulation. Positions carry over via posRef so a rebuild (re-tie, rename,
  // time-slider move) settles from where things already are rather than scrambling.
  useEffect(() => {
    if (!isActive || effective.nodes.length === 0) {
      simRef.current?.stop()
      simRef.current = null
      return
    }
    const simNodes: SimNode[] = effective.nodes.map((n) => {
      const prev = posRef.current.get(n.id)
      return {
        ...n,
        x: prev?.x,
        y: prev?.y,
        r: radiusFor(degree.get(n.id) ?? 0),
        cluster: cluster ? parentOf(n.id, effective.edges) : null
      }
    })
    const byId = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks: SimLink[] = effective.edges
      .filter((e) => byId.has(e.from) && byId.has(e.to))
      .map((e) => ({
        source: e.from,
        target: e.to,
        id: e.id,
        from: e.from,
        to: e.to,
        label: e.label,
        directed: e.directed,
        tone: edgeTone(e),
        confidence: e.confidence,
        dash: CONFIDENCE_DASH[e.confidence],
        title: edgeTitle(e),
        severed: e.severed,
        justFormed: e.justFormed
      }))

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
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => d.r + 10)
      )
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

    // Optional clustering (opt-in): a gentle force pulling location/faction siblings together.
    if (cluster) sim.force('cluster', clusterForce())

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
  }, [isActive, signature, dims.w, dims.h])

  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect()
    const px = clientX - (rect?.left ?? 0)
    const py = clientY - (rect?.top ?? 0)
    return { x: (px - view.x) / view.k, y: (py - view.y) / view.k }
  }

  function onNodePointerDown(e: React.PointerEvent, node: SimNode): void {
    e.stopPropagation()
    if (e.button === 2) return // right-click handled by onContextMenu
    setMenu(null)
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
    setMenu(null)
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

  function onPointerUp(e: React.PointerEvent, shift: boolean): void {
    const d = drag.current
    svgRef.current?.releasePointerCapture(e.pointerId)
    if (d.mode === 'node' && d.node) {
      simRef.current?.alphaTarget(0)
      if (!d.moved) {
        // A tap: shift-tap builds a 2-node comparison; a plain tap toggles focus on that node.
        if (shift) togglePair(d.node.id)
        else setFocusId((cur) => (cur === d.node!.id ? null : d.node!.id))
      }
    } else if (d.mode === 'pan' && !d.moved) {
      setFocusId(null) // tap the background = clear focus
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

  function openNode(id: string): void {
    if (id === mainCharacterId) setActiveView('character')
    else {
      setSelectedEntity(id)
      setActiveView('capture')
    }
  }

  function togglePair(id: string): void {
    setPair((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      return [...cur, id].slice(-2) // keep the two most recent
    })
  }

  // #3: fold a location/faction (and everything under it) into one super-node, or expand it back.
  function toggleCollapse(id: string): void {
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setMenu(null)
  }

  // Centre the viewport on a node's cached position (jump-to, from search).
  function centerOn(id: string): void {
    const p = posRef.current.get(id)
    if (!p) return
    setView((v) => ({ ...v, x: dims.w / 2 - p.x * v.k, y: dims.h / 2 - p.y * v.k }))
  }

  function exportPng(): void {
    const svg = svgRef.current
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const svg64 = btoa(unescape(encodeURIComponent(xml)))
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = dims.w * scale
      canvas.height = dims.h * scale
      const cx = canvas.getContext('2d')
      if (!cx) return
      cx.scale(scale, scale)
      cx.fillStyle =
        getComputedStyle(document.documentElement).getPropertyValue('--char').trim() || '#17130f'
      cx.fillRect(0, 0, dims.w, dims.h)
      cx.drawImage(img, 0, 0)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = 'campaign-web.png'
      a.click()
    }
    img.src = `data:image/svg+xml;base64,${svg64}`
  }

  const nodeById = useMemo(() => new Map(effective.nodes.map((n) => [n.id, n])), [effective.nodes])
  const pairNames = pair.map((id) => nodeById.get(id)?.name).filter(Boolean) as string[]

  function askBetween(): void {
    if (pair.length !== 2) return
    const [a, b] = pairNames
    openLens({
      view: 'recall',
      query: `What is the relationship and shared history between ${a} and ${b}? What do we know that connects them?`
    })
    setPair([])
  }

  const menuNode = menu ? nodeById.get(menu.id) : null

  const hasCampaign = Boolean(activeCampaignId)
  const empty = hasCampaign && graph.nodes.length === 0
  const asOfLabel = asOf === null ? 'Now' : `Session ${asOf}`
  // #1: a small map never needs decluttering — show every label (also keeps the 2-node e2e green).
  const smallGraph = effective.nodes.length <= SMALL_GRAPH
  // #130: how many entities the reductions (#2/#3) fold out of view, for the header's "· N hidden".
  const hiddenCount = graph.nodes.length - effective.nodes.length

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        icon={Waypoints}
        title="Web"
        action={
          graph.nodes.length > 0 ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchMatches && searchMatches.size > 0) {
                      centerOn([...searchMatches][0])
                    }
                  }}
                  placeholder="Find…"
                  className="h-7 w-32 pl-7 text-xs"
                />
              </div>
              <span className="whitespace-nowrap font-mono text-[0.6875rem] text-muted-foreground">
                {graph.nodes.length} {graph.nodes.length === 1 ? 'entity' : 'entities'} ·{' '}
                {graph.edges.length} {graph.edges.length === 1 ? 'tie' : 'ties'}
                {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                title="Save as PNG"
                onClick={exportPng}
              >
                <Camera className="size-4" />
              </Button>
            </div>
          ) : undefined
        }
      />

      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {!hasCampaign ? (
          <CenterNote>Choose a campaign to see its web of relationships.</CenterNote>
        ) : empty ? (
          <CenterNote>
            No entities yet. Add a few in the Codex and tie them together — they’ll appear
            here.
          </CenterNote>
        ) : (
          <svg
            ref={svgRef}
            className="size-full touch-none select-none"
            style={{ cursor: drag.current.mode === 'pan' ? 'grabbing' : 'grab' }}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(e, e.shiftKey)}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          >
            <defs>
              {(['warm', 'cold', 'neutral'] as EdgeTone[]).map((t) => (
                <marker
                  key={t}
                  id={`web-arrow-${t}`}
                  viewBox="0 0 8 8"
                  refX={7}
                  refY={4}
                  markerWidth={6}
                  markerHeight={6}
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill={TONE_COLOR[t]} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {links.map((l) => {
                const s = l.source as SimNode
                const t = l.target as SimNode
                if (s?.x == null || t?.x == null || s.y == null || t.y == null) return null
                const mx = (s.x + t.x) / 2
                const my = (s.y + t.y) / 2
                const inFocus =
                  !neighborhood || (neighborhood.has(l.from) && neighborhood.has(l.to))
                const visible = visibleIds.has(l.from) && visibleIds.has(l.to)
                if (!visible) return null
                if (hideWeak && l.confidence !== 'confirmed') return null // #4
                const color = TONE_COLOR[l.tone]
                const faded = l.severed || !inFocus
                // #1: edge labels are the worst clutter — show only when zoomed in, an endpoint is
                // hovered, or the edge sits inside the focused subgraph. Colour + arrow carry the rest.
                const showEdgeLabel =
                  view.k >= EDGE_LABEL_ZOOM ||
                  hoveredId === l.from ||
                  hoveredId === l.to ||
                  (!!focusId && inFocus)
                return (
                  <g key={l.id} style={{ opacity: faded ? 0.28 : 1 }}>
                    {/* Invisible wide hit-line so the thin edge is hoverable. */}
                    <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="transparent" strokeWidth={12}>
                      <title>{l.title}</title>
                    </line>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke={color}
                      strokeWidth={l.justFormed ? 2.5 : 1.5}
                      strokeDasharray={l.severed ? '1 4' : l.dash}
                      markerEnd={l.directed ? `url(#web-arrow-${l.tone})` : undefined}
                    />
                    {showEdgeLabel && (
                      <text
                        x={mx}
                        y={my}
                        textAnchor="middle"
                        dy="-0.2em"
                        className="pointer-events-none font-mono"
                        fontSize={8}
                        fill="var(--ash)"
                      >
                        {l.label}
                      </text>
                    )}
                  </g>
                )
              })}

              {nodes.map((n) => {
                if (n.x == null || n.y == null) return null
                if (!visibleIds.has(n.id)) return null
                // #1: ration labels — always on a small map or when zoomed, else only hubs / the MC /
                // a collapsed group / the hovered node / the focused neighbourhood get one.
                const showLabel =
                  smallGraph ||
                  view.k >= LABEL_ZOOM ||
                  n.id === mainCharacterId ||
                  collapsed.has(n.id) ||
                  (degree.get(n.id) ?? 0) >= IMPORTANT_DEGREE ||
                  hoveredId === n.id ||
                  (!!neighborhood && neighborhood.has(n.id))
                return (
                  <GraphNodeGlyph
                    key={n.id}
                    node={n}
                    isMain={n.id === mainCharacterId}
                    inPair={pair.includes(n.id)}
                    match={searchMatches ? searchMatches.has(n.id) : null}
                    showLabel={showLabel}
                    groupSize={collapsible.has(n.id) ? (descendantCounts.get(n.id) ?? 0) : null}
                    collapsed={collapsed.has(n.id)}
                    onHoverChange={(h) => setHoveredId(h ? n.id : (cur) => (cur === n.id ? null : cur))}
                    onToggleCollapse={() => toggleCollapse(n.id)}
                    onPointerDown={(e) => onNodePointerDown(e, n)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const rect = containerRef.current?.getBoundingClientRect()
                      setMenu({
                        id: n.id,
                        x: e.clientX - (rect?.left ?? 0),
                        y: e.clientY - (rect?.top ?? 0)
                      })
                    }}
                  />
                )
              })}
            </g>
          </svg>
        )}

        {/* Legend doubles as the type filter — each row is a switch that shows/hides that type's nodes. */}
        {!empty && hasCampaign && (
          <div className="absolute bottom-3 left-3 flex flex-col gap-2">
            <div className="rounded-md border border-border/60 bg-card/80 px-2.5 py-2 backdrop-blur-sm">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-[0.5625rem] font-medium uppercase tracking-wide text-muted-foreground/70">
                  Show types
                </span>
                {hidden.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setHidden(new Set())}
                    className="text-[0.5625rem] text-primary hover:underline"
                  >
                    Show all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {LEGEND_ORDER.map((t) => {
                  const Icon = ENTITY_TYPE_ICON[t]
                  const off = hidden.has(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      role="switch"
                      aria-checked={!off}
                      title={off ? `Show ${ENTITY_TYPE_LABELS[t]}` : `Hide ${ENTITY_TYPE_LABELS[t]}`}
                      onClick={() =>
                        setHidden((cur) => {
                          const next = new Set(cur)
                          if (next.has(t)) next.delete(t)
                          else next.add(t)
                          return next
                        })
                      }
                      className={cn(
                        'flex items-center gap-1.5 rounded px-1 text-left transition-opacity hover:bg-muted/40',
                        off && 'opacity-45'
                      )}
                    >
                      {off ? (
                        <EyeOff className="size-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <Icon className="size-3 shrink-0" style={{ color: ENTITY_TYPE_COLOR[t] }} />
                      )}
                      <span className={cn('text-[0.625rem] text-muted-foreground', off && 'line-through')}>
                        {ENTITY_TYPE_LABELS[t]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ToggleChip on={hideFallen} onClick={() => setHideFallen((v) => !v)}>
                Hide gone
              </ToggleChip>
              <ToggleChip on={hideMinor} onClick={() => setHideMinor((v) => !v)}>
                Hide minor
              </ToggleChip>
              <ToggleChip on={hideWeak} onClick={() => setHideWeak((v) => !v)}>
                Hide rumored
              </ToggleChip>
              <ToggleChip on={cluster} onClick={() => setCluster((v) => !v)}>
                Cluster
              </ToggleChip>
              {collapsed.size > 0 && (
                <ToggleChip on onClick={() => setCollapsed(new Set())}>
                  <X className="size-3" /> Expand all
                </ToggleChip>
              )}
              {focusId && (
                <ToggleChip on onClick={() => setFocusId(null)}>
                  <X className="size-3" /> Focus
                </ToggleChip>
              )}
            </div>
          </div>
        )}

        {/* Time scrubber + playback. */}
        {!empty && hasCampaign && sessionNumbers.length > 0 && (
          <div className="absolute right-3 top-3 flex items-center gap-2 rounded-md border border-border/60 bg-card/80 px-2.5 py-1.5 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              title={playing ? 'Pause' : 'Play through the sessions'}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <input
              type="range"
              min={sessionNumbers[0]}
              max={sessionNumbers[sessionNumbers.length - 1] + 1}
              step={1}
              value={asOf ?? sessionNumbers[sessionNumbers.length - 1] + 1}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPlaying(false)
                setAsOf(v > sessionNumbers[sessionNumbers.length - 1] ? null : v)
              }}
              className="h-1 w-40 cursor-pointer accent-[var(--ember-bright)]"
            />
            <span className="w-16 shrink-0 font-mono text-[0.625rem] text-muted-foreground">
              {asOfLabel}
            </span>
          </div>
        )}

        {/* Pair-compare pill. */}
        {pair.length === 2 && (
          <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg">
            <span className="text-xs text-muted-foreground">
              {pairNames[0]} &amp; {pairNames[1]}
            </span>
            <Button size="sm" className="h-6 rounded-full text-xs" onClick={askBetween}>
              What’s between them?
            </Button>
            <button
              type="button"
              onClick={() => setPair([])}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Node context menu (right-click). */}
        {menu && menuNode && (
          <>
            <div className="fixed inset-0 z-10" onPointerDown={() => setMenu(null)} />
            <div
              className="absolute z-20 min-w-44 overflow-hidden rounded-md border border-border bg-popover py-1 text-sm shadow-lg"
              style={{ left: menu.x, top: menu.y }}
            >
              <div className="truncate px-3 py-1 text-xs font-medium text-muted-foreground">
                {menuNode.name}
              </div>
              <MenuItem
                icon={ExternalLink}
                onClick={() => {
                  openNode(menu.id)
                  setMenu(null)
                }}
              >
                Open
              </MenuItem>
              {collapsible.has(menu.id) && (
                <MenuItem icon={Boxes} onClick={() => toggleCollapse(menu.id)}>
                  {collapsed.has(menu.id)
                    ? `Expand group (${descendantCounts.get(menu.id) ?? 0})`
                    : `Collapse group (${descendantCounts.get(menu.id) ?? 0})`}
                </MenuItem>
              )}
              {(menuNode.type === 'npc' || menuNode.type === 'pc') &&
                menu.id !== mainCharacterId && (
                  <MenuItem
                    icon={MessagesSquare}
                    onClick={() => {
                      openLens({ view: 'converse', targetId: menu.id })
                      setMenu(null)
                    }}
                  >
                    Prepare questions
                  </MenuItem>
                )}
              <MenuItem
                icon={BookOpen}
                onClick={() => {
                  openLens({
                    view: 'recall',
                    query: `What do we know about ${menuNode.name}?`
                  })
                  setMenu(null)
                }}
              >
                Ask Lore about them
              </MenuItem>
            </div>
          </>
        )}

        {!empty && hasCampaign && (
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[0.625rem] text-muted-foreground/70">
            click a node to focus · shift-click two to compare · right-click for actions · drag to
            pan · scroll to zoom
          </p>
        )}
      </div>
    </div>
  )
}

function GraphNodeGlyph({
  node,
  isMain,
  inPair,
  match,
  showLabel,
  groupSize,
  collapsed,
  onHoverChange,
  onToggleCollapse,
  onPointerDown,
  onContextMenu
}: {
  node: SimNode
  isMain: boolean
  inPair: boolean
  match: boolean | null // search: true = matches, false = doesn't, null = no active search
  showLabel: boolean // #1: label rationing
  groupSize: number | null // #3: descendant count if a collapsible parent, else null
  collapsed: boolean // #3: currently folded into a super-node
  onHoverChange: (hovering: boolean) => void
  onToggleCollapse: () => void
  onPointerDown: (e: React.PointerEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const r = node.r
  const dim = node.faded || match === false
  const typeColor = ENTITY_TYPE_COLOR[node.type]
  const ring = inPair
    ? 'var(--ember-bright)'
    : isMain
      ? 'var(--ember-bright)'
      : match
        ? 'var(--bone)'
        : typeColor
  const TypeIcon = ENTITY_TYPE_ICON[node.type]
  const clipId = `web-clip-${node.id}`
  const strokeW = inPair ? 3.5 : isMain ? 3 : collapsed ? 3 : match ? 2.5 : 1.75
  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
      style={{ cursor: 'pointer', opacity: dim ? 0.45 : 1 }}
    >
      <title>
        {node.name} · {ENTITY_TYPE_LABELS[node.type]}
      </title>
      {/* #3: a dashed outer halo marks a collapsed super-node as "contains a group". */}
      {collapsed && (
        <circle
          r={r + 4}
          fill="none"
          stroke="var(--ember)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          opacity={0.7}
        />
      )}
      <circle r={r} fill="var(--char-raised)" stroke={ring} strokeWidth={strokeW} />
      {node.image ? (
        <>
          <clipPath id={clipId}>
            <circle r={r - 2} />
          </clipPath>
          <image
            href={node.image}
            x={-(r - 2)}
            y={-(r - 2)}
            width={(r - 2) * 2}
            height={(r - 2) * 2}
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
          fontSize={Math.round(r * 0.6)}
          fontWeight={600}
          fill="var(--bone-dim)"
        >
          {initials(node.name)}
        </text>
      )}
      {/* Type badge (color + glyph) at the node's lower-right — type reads without hovering. */}
      <g transform={`translate(${r * 0.72},${r * 0.72})`}>
        <circle r={8.5} fill="var(--char)" stroke={typeColor} strokeWidth={1.5} />
        <TypeIcon x={-5.5} y={-5.5} width={11} height={11} color={typeColor} strokeWidth={2.25} />
      </g>
      {/* #3: collapse / expand control at the top-right — a clickable count on any parent with children.
          Filled ember when folded (click to expand), muted outline when open (click to fold N in). */}
      {groupSize != null && groupSize > 0 && (
        <g
          transform={`translate(${r * 0.72},${-r * 0.72})`}
          onPointerDown={(e) => {
            e.stopPropagation() // don't start a node drag / focus toggle
            onToggleCollapse()
          }}
          style={{ cursor: 'pointer' }}
        >
          <title>
            {collapsed ? `Expand — ${groupSize} hidden inside` : `Collapse ${groupSize} into this`}
          </title>
          <circle
            r={9}
            fill={collapsed ? 'var(--ember-bright)' : 'var(--char)'}
            stroke={collapsed ? 'var(--ember-bright)' : 'var(--iron)'}
            strokeWidth={1.5}
          />
          <text
            textAnchor="middle"
            dy="0.32em"
            className="font-mono"
            fontSize={9}
            fontWeight={700}
            fill={collapsed ? 'var(--char)' : 'var(--bone)'}
          >
            {groupSize}
          </text>
        </g>
      )}
      {showLabel && (
        <text
          y={r + LABEL_GAP}
          textAnchor="middle"
          className="font-sans"
          fontSize={11}
          fill="var(--bone)"
          style={{ paintOrder: 'stroke', stroke: 'var(--char)', strokeWidth: 3 }}
        >
          {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
        </text>
      )}
    </g>
  )
}

function ToggleChip({
  on,
  onClick,
  children
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.625rem] transition-colors',
        on
          ? 'border-primary/40 bg-primary/15 text-primary'
          : 'border-border/60 bg-card/80 text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function MenuItem({
  icon: Icon,
  onClick,
  children
}: {
  icon: typeof ExternalLink
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-muted/60"
    >
      <Icon className="size-3.5 text-muted-foreground" />
      {children}
    </button>
  )
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
