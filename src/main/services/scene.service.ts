import { SCENE_MODE_LABELS, type SceneContext } from '@shared/scene-types'
import type { Entity, Lifecycle } from '@shared/entity-types'
import type { RelationshipView } from '@shared/graph-types'
import type { DbContext } from './db-context'
import { resolveEntityState } from './chronology.service'
import { getEntity } from './entity.service'
import { getHierarchy, listForEntity } from './link.service'
import { formatScene } from './claude.service'

// How much of the "expanded" scene to pin — bounded so the prompt stays in budget.
const MAX_HERE = 10
const MAX_QUEST_INVOLVED = 8

export interface ResolvedScene {
  block: string | null // the formatted present-scene block (null when nothing is set)
  pinned: Entity[] // entities to fold into grounding regardless of vector similarity
  quest: Entity | null // the embarked quest (for Suggest directions threads)
  nearbyPcs: Entity[] // the nearby party members (for Suggest directions threads)
}

export type RelItem = { name: string; views: RelationshipView[] }
export type StateItem = { name: string; type: string; status: string | null; lifecycle: Lifecycle }

/** Fold a set of pinned entities' relationships + status into the gather accumulators (deduped). */
export function gatherPinned(
  ctx: DbContext,
  pinned: Entity[],
  seen: Set<string>,
  relItems: RelItem[],
  stateItems: StateItem[],
  asOf?: number
): void {
  for (const e of pinned) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    relItems.push({ name: e.name, views: listForEntity(ctx, e.id, asOf) })
    const st = resolveEntityState(ctx, e, asOf)
    stateItems.push({ name: e.name, type: e.type, status: st.status, lifecycle: st.lifecycle })
  }
}

function questObjective(q: Entity): string | null {
  const v = q.attributes.objective
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Resolve the renderer-selected scene into (a) a formatted present-moment block, (b) the set of entities
 * to PIN into grounding — the location, embarked quest, nearby + active PC, PLUS the location's contents
 * and the quest's involved NPCs (the "expand") — and (c) the quest / nearby PCs for directions threads.
 * Returns an empty result when no scene is set.
 */
export function resolveScene(
  ctx: DbContext,
  scene: SceneContext | undefined,
  activePcId: string | null,
  asOf?: number
): ResolvedScene {
  if (!scene) return { block: null, pinned: [], quest: null, nearbyPcs: [] }

  const location = scene.locationId ? getEntity(ctx, scene.locationId) : null
  const quest = scene.embarkedQuestId ? getEntity(ctx, scene.embarkedQuestId) : null
  const nearbyPcs = scene.nearbyPcIds
    .map((id) => getEntity(ctx, id))
    .filter((e): e is Entity => e !== null && e.type === 'pc')
  // Non-party actors the party is facing / dealing with (NPCs, factions) — the focus of the advice.
  const facing = scene.presentEntityIds
    .map((id) => getEntity(ctx, id))
    .filter((e): e is Entity => e !== null && e.type !== 'pc')

  // Nothing meaningful set → no scene grounding at all (keeps behavior unchanged when the feature is
  // unused; the renderer always sends a scene object, so this is the common "untouched" case).
  const sceneSet =
    Boolean(location) ||
    Boolean(quest) ||
    nearbyPcs.length > 0 ||
    facing.length > 0 ||
    Boolean(scene.sceneMode)
  if (!sceneSet) return { block: null, pinned: [], quest: null, nearbyPcs: [] }

  const activePc = activePcId ? getEntity(ctx, activePcId) : null

  // Expand: who/what is AT the location (its contents), and who the quest involves.
  const hierarchy = location ? getHierarchy(ctx, location.id, 'location') : null
  const lastAncestor = hierarchy?.ancestors[hierarchy.ancestors.length - 1]
  const containerName = lastAncestor ? lastAncestor.name : null
  // Keep "Also here" distinct from the active/nearby PCs and the facing actors, listed separately.
  const exclude = new Set<string>(
    [activePcId, ...scene.nearbyPcIds, ...facing.map((e) => e.id)].filter((id): id is string =>
      Boolean(id)
    )
  )
  const hereEntities = hierarchy
    ? hierarchy.descendants
        .map((d) => d.entity)
        .filter((e) => !exclude.has(e.id))
        .slice(0, MAX_HERE)
    : []
  const questInvolved = quest
    ? listForEntity(ctx, quest.id)
        .map((v) => v.other)
        .slice(0, MAX_QUEST_INVOLVED)
    : []

  // Pin everything we want grounded regardless of vector similarity, deduped by id.
  const pinnedMap = new Map<string, Entity>()
  for (const e of [
    activePc,
    location,
    quest,
    ...nearbyPcs,
    ...facing,
    ...hereEntities,
    ...questInvolved
  ]) {
    if (e) pinnedMap.set(e.id, e)
  }

  const block = formatScene({
    location: location
      ? { name: location.name, status: resolveEntityState(ctx, location, asOf).status, containerName }
      : null,
    quest: quest ? { name: quest.name, objective: questObjective(quest) } : null,
    nearbyPcNames: nearbyPcs.map((p) => p.name),
    facingNames: facing.map((e) => e.name),
    hereNames: hereEntities.map((e) => e.name),
    mode: scene.sceneMode ? SCENE_MODE_LABELS[scene.sceneMode] : null,
    sceneSet: true
  })

  return { block, pinned: [...pinnedMap.values()], quest, nearbyPcs }
}
