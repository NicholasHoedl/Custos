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

/** The current scene. Empty fields (null / [] / false) mean "not set"; an all-empty scene is a no-op. */
export interface SceneContext {
  locationId: string | null
  embarkedQuestId: string | null
  nearbyPcIds: string[]
  timeOfDay: TimeOfDay | null
  inCombat: boolean
}
