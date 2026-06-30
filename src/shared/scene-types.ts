// The "current scene" — the table's present moment (where the party is, the time, who's present, the
// quest in progress, and whether they're in a fight). Selected in the sidebar, threaded into Recall and
// Suggest, and woven into the prompt grounding (pinned + expanded). Entity references are IDs.

export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night'
}

// The KIND of moment the party is in — the strongest lever on what Suggest recommends (and Recall's
// tempo). Replaces the old in/out-of-combat boolean with a fuller taxonomy.
export const SCENE_MODES = [
  'combat',
  'social',
  'exploration',
  'stealth',
  'downtime',
  'travel'
] as const
export type SceneMode = (typeof SCENE_MODES)[number]

export const SCENE_MODE_LABELS: Record<SceneMode, string> = {
  combat: 'Combat',
  social: 'Social',
  exploration: 'Exploration',
  stealth: 'Stealth',
  downtime: 'Downtime',
  travel: 'Travel'
}

/** The current scene. Empty fields (null / []) mean "not set"; an all-empty scene is a no-op. */
export interface SceneContext {
  locationId: string | null
  embarkedQuestId: string | null
  nearbyPcIds: string[] // party members present (PCs)
  presentEntityIds: string[] // non-party actors present — the NPCs/factions you're facing or dealing with
  sceneMode: SceneMode | null
  timeOfDay: TimeOfDay | null
}
