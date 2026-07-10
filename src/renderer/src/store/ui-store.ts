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
  | 'settings'

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
  setActiveView: (view: ViewKey) => void
  requestQuickAddFocus: () => void
  requestSearchFocus: () => void
  bumpEntities: () => void
  bumpCampaigns: () => void
  bumpSessions: () => void
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'journal',
  quickAddNonce: 0,
  searchFocusNonce: 0,
  entitiesVersion: 0,
  campaignsVersion: 0,
  sessionsVersion: 0,
  setActiveView: (activeView) => set({ activeView }),
  requestQuickAddFocus: () =>
    set((s) => ({ activeView: 'capture', quickAddNonce: s.quickAddNonce + 1 })),
  requestSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
  bumpEntities: () => set((s) => ({ entitiesVersion: s.entitiesVersion + 1 })),
  bumpCampaigns: () => set((s) => ({ campaignsVersion: s.campaignsVersion + 1 })),
  bumpSessions: () => set((s) => ({ sessionsVersion: s.sessionsVersion + 1 }))
}))
