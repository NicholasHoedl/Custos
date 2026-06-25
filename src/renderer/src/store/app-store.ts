import { create } from 'zustand'

const CAMPAIGN_KEY = 'ledger.activeCampaignId'

function persistedCampaignId(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(CAMPAIGN_KEY) : null
}

// The active selections that drive the whole app (campaign / session / player character) plus the
// entity currently open in the detail panel. activeCampaignId is persisted so relaunch restores context.
interface AppState {
  activeCampaignId: string | null
  activeSessionId: string | null
  activePcId: string | null
  selectedEntityId: string | null
  setActiveCampaign: (id: string | null) => void
  setActiveSession: (id: string | null) => void
  setActivePc: (id: string | null) => void
  setSelectedEntity: (id: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeCampaignId: persistedCampaignId(),
  activeSessionId: null,
  activePcId: null,
  selectedEntityId: null,
  setActiveCampaign: (id) => {
    if (typeof localStorage !== 'undefined') {
      if (id) localStorage.setItem(CAMPAIGN_KEY, id)
      else localStorage.removeItem(CAMPAIGN_KEY)
    }
    // Switching campaigns clears the campaign-scoped selections.
    set({ activeCampaignId: id, activeSessionId: null, activePcId: null, selectedEntityId: null })
  },
  setActiveSession: (id) => set({ activeSessionId: id }),
  setActivePc: (id) => set({ activePcId: id }),
  setSelectedEntity: (id) => set({ selectedEntityId: id })
}))
