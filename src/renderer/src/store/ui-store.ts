import { create } from 'zustand'

export type ViewKey = 'capture' | 'recall' | 'suggest' | 'settings'

interface UiState {
  activeView: ViewKey
  /** Bumped to request the quick-add bar focus itself (global hotkey / Ctrl+K). */
  quickAddNonce: number
  /** Bumped to request the sidebar search focus itself (Ctrl+F). */
  searchFocusNonce: number
  /** Bumped whenever an entity is created/updated/deleted, so every entity list (the scene selectors,
   *  the browser, …) refetches — independent `useEntities` instances share no other invalidation. */
  entitiesVersion: number
  setActiveView: (view: ViewKey) => void
  requestQuickAddFocus: () => void
  requestSearchFocus: () => void
  bumpEntities: () => void
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'capture',
  quickAddNonce: 0,
  searchFocusNonce: 0,
  entitiesVersion: 0,
  setActiveView: (activeView) => set({ activeView }),
  requestQuickAddFocus: () =>
    set((s) => ({ activeView: 'capture', quickAddNonce: s.quickAddNonce + 1 })),
  requestSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
  bumpEntities: () => set((s) => ({ entitiesVersion: s.entitiesVersion + 1 }))
}))
