import { create } from 'zustand'

export type ViewKey =
  | 'home'
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

/** A lens's remembered answers (ROADMAP P1-1), lifted store-side (ADR-061) so the Home dashboard reads
 *  the same history the lens views write. Session-scoped by design (no persist); `at` orders the
 *  dashboard's cross-lens merge. */
export interface LensHistoryEntry {
  id: string
  /** Short human label for the picker row (the question / situation / target). */
  label: string
  /** The full save-able prose (same payload as Copy/Save note on the live result). */
  prose: string
  at: number
}
export type LensHistoryKey = 'recall' | 'suggest' | 'converse' | 'continuity'

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
  /** Per-lens answer history (see LensHistoryEntry). */
  lensHistory: Record<LensHistoryKey, LensHistoryEntry[]>
  setActiveView: (view: ViewKey) => void
  /** Remember a completed lens answer (cap 5; consecutive identical prose de-duped). */
  rememberLens: (lens: LensHistoryKey, label: string, prose: string) => void
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
  activeView: 'home',
  quickAddNonce: 0,
  searchFocusNonce: 0,
  entitiesVersion: 0,
  campaignsVersion: 0,
  sessionsVersion: 0,
  pendingLens: null,
  keySavedNonce: 0,
  lensHistory: { recall: [], suggest: [], converse: [], continuity: [] },
  setActiveView: (activeView) => set({ activeView }),
  rememberLens: (lens, label, prose) =>
    set((s) => {
      const prev = s.lensHistory[lens]
      if (prev[0]?.prose === prose) return s // same result re-observed — don't stack
      const entry: LensHistoryEntry = { id: crypto.randomUUID(), label, prose, at: Date.now() }
      return { lensHistory: { ...s.lensHistory, [lens]: [entry, ...prev].slice(0, 5) } }
    }),
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
