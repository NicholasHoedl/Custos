import { create } from 'zustand'

// The active selections that drive the whole app (campaign / session / player character).
// All null until Phase 1 lets the user create and select them.
interface AppState {
  activeCampaignId: string | null
  activeSessionId: string | null
  activePcId: string | null
  setActiveCampaign: (id: string | null) => void
  setActiveSession: (id: string | null) => void
  setActivePc: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeCampaignId: null,
  activeSessionId: null,
  activePcId: null,
  setActiveCampaign: (activeCampaignId) => set({ activeCampaignId }),
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
  setActivePc: (activePcId) => set({ activePcId })
}))
