import { create } from 'zustand'
import type { SceneContext, SceneMode, TimeOfDay } from '@shared/scene-types'

const CAMPAIGN_KEY = 'ledger.activeCampaignId'
const PC_KEY = 'ledger.activePcId'
const SCENE_KEY = 'ledger.scene'

function persisted(key: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
}
function persist(key: string, id: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (id) localStorage.setItem(key, id)
  else localStorage.removeItem(key)
}

const EMPTY_SCENE: SceneContext = {
  locationId: null,
  embarkedQuestId: null,
  nearbyPcIds: [],
  presentEntityIds: [],
  sceneMode: null,
  timeOfDay: null
}

function persistedScene(): SceneContext {
  const raw = persisted(SCENE_KEY)
  if (!raw) return { ...EMPTY_SCENE }
  try {
    return { ...EMPTY_SCENE, ...(JSON.parse(raw) as Partial<SceneContext>) }
  } catch {
    return { ...EMPTY_SCENE }
  }
}
function persistScene(scene: SceneContext): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(SCENE_KEY, JSON.stringify(scene))
}

// The active selections that drive the whole app (campaign / session / player character), the current
// "scene" (where the party is, the time, who's present, the quest in progress, whether in combat), and
// the entity open in the detail panel. activeCampaignId / activePcId / scene persist so relaunch
// restores context; the active PC and the scene are campaign-scoped and cleared when the campaign changes.
interface AppState {
  activeCampaignId: string | null
  activeSessionId: string | null
  activePcId: string | null
  selectedEntityId: string | null
  scene: SceneContext
  setActiveCampaign: (id: string | null) => void
  setActiveSession: (id: string | null) => void
  setActivePc: (id: string | null) => void
  setSelectedEntity: (id: string | null) => void
  setSceneLocation: (id: string | null) => void
  setEmbarkedQuest: (id: string | null) => void
  setNearbyPcs: (ids: string[]) => void
  setPresentEntities: (ids: string[]) => void
  setSceneMode: (mode: SceneMode | null) => void
  setTimeOfDay: (t: TimeOfDay | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeCampaignId: persisted(CAMPAIGN_KEY),
  activeSessionId: null,
  activePcId: persisted(PC_KEY),
  selectedEntityId: null,
  scene: persistedScene(),
  setActiveCampaign: (id) => {
    persist(CAMPAIGN_KEY, id)
    persist(PC_KEY, null) // the active PC is campaign-scoped — clear it when the campaign changes
    persistScene({ ...EMPTY_SCENE }) // the scene is campaign-scoped too
    set({
      activeCampaignId: id,
      activeSessionId: null,
      activePcId: null,
      selectedEntityId: null,
      scene: { ...EMPTY_SCENE }
    })
  },
  setActiveSession: (id) => set({ activeSessionId: id }),
  setActivePc: (id) =>
    set((s) => {
      persist(PC_KEY, id)
      // The active PC is never also "nearby" — drop it from the party list if present.
      const nearbyPcIds = id ? s.scene.nearbyPcIds.filter((p) => p !== id) : s.scene.nearbyPcIds
      const scene = { ...s.scene, nearbyPcIds }
      persistScene(scene)
      return { activePcId: id, scene }
    }),
  setSelectedEntity: (id) => set({ selectedEntityId: id }),
  setSceneLocation: (id) =>
    set((s) => {
      const scene = { ...s.scene, locationId: id }
      persistScene(scene)
      return { scene }
    }),
  setEmbarkedQuest: (id) =>
    set((s) => {
      const scene = { ...s.scene, embarkedQuestId: id }
      persistScene(scene)
      return { scene }
    }),
  setNearbyPcs: (ids) =>
    set((s) => {
      const scene = { ...s.scene, nearbyPcIds: ids }
      persistScene(scene)
      return { scene }
    }),
  setTimeOfDay: (t) =>
    set((s) => {
      const scene = { ...s.scene, timeOfDay: t }
      persistScene(scene)
      return { scene }
    }),
  setPresentEntities: (ids) =>
    set((s) => {
      const scene = { ...s.scene, presentEntityIds: ids }
      persistScene(scene)
      return { scene }
    }),
  setSceneMode: (mode) =>
    set((s) => {
      const scene = { ...s.scene, sceneMode: mode }
      persistScene(scene)
      return { scene }
    })
}))
