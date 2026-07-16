import { create } from 'zustand'

export type ViewKey =
  | 'character'
  | 'journal'
  | 'sessions'
  | 'capture'
  | 'web'
  | 'recall'
  | 'suggest'
  | 'converse'
  | 'continuity'
  | 'settings'

/** A cross-view request to open an AI lens pre-seeded from elsewhere — e.g. the Web graph: a node →
 *  Converse that NPC, or a node / node-pair → Lore query. The destination lens view (kept mounted by
 *  MainPanel) reads it once on change, seeds its input, and clears it via `consumePendingLens`. */
export interface PendingLens {
  view: 'recall' | 'converse'
  targetId?: string // Converse: the character to talk WITH
  query?: string // Recall: the question to pre-fill
}

interface UiState {
  activeView: ViewKey
  /** Bumped to request the quick-add bar focus itself (global hotkey / Ctrl+K). */
  quickAddNonce: number
  /** Bumped to request the sidebar search focus itself (Ctrl+F). */
  searchFocusNonce: number
  /** Bumped whenever an entity is created/updated/deleted, so every entity list (the scene selectors,
   *  the browser, …) refetches — independent `useEntities` instances share no other invalidation. */
  entitiesVersion: number
  /** Same pattern for campaigns/sessions, so a create from the onboarding checklist (or elsewhere)
   *  refreshes every `useCampaigns`/`useSessions` instance, not just the one that created it. */
  campaignsVersion: number
  sessionsVersion: number
  /** A pending "open this lens, pre-seeded" request (see PendingLens). Null when nothing is queued. */
  pendingLens: PendingLens | null
  /** Bumped by SettingsView after each key save+validate cycle — the spotlight tutorial's apikey step
   *  (ADR-059) re-validates once per bump instead of polling (the key flow has no other push signal). */
  keySavedNonce: number
  setActiveView: (view: ViewKey) => void
  requestQuickAddFocus: () => void
  requestSearchFocus: () => void
  /** Switch to a lens view and queue its seed (target/query). The lens view consumes it on mount. */
  openLens: (p: PendingLens) => void
  consumePendingLens: () => void
  bumpEntities: () => void
  bumpCampaigns: () => void
  bumpSessions: () => void
  bumpKeySaved: () => void
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'journal',
  quickAddNonce: 0,
  searchFocusNonce: 0,
  entitiesVersion: 0,
  campaignsVersion: 0,
  sessionsVersion: 0,
  pendingLens: null,
  keySavedNonce: 0,
  setActiveView: (activeView) => set({ activeView }),
  requestQuickAddFocus: () =>
    set((s) => ({ activeView: 'capture', quickAddNonce: s.quickAddNonce + 1 })),
  requestSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
  openLens: (p) => set({ activeView: p.view, pendingLens: p }),
  consumePendingLens: () => set({ pendingLens: null }),
  bumpEntities: () => set((s) => ({ entitiesVersion: s.entitiesVersion + 1 })),
  bumpCampaigns: () => set((s) => ({ campaignsVersion: s.campaignsVersion + 1 })),
  bumpSessions: () => set((s) => ({ sessionsVersion: s.sessionsVersion + 1 })),
  bumpKeySaved: () => set((s) => ({ keySavedNonce: s.keySavedNonce + 1 }))
}))
