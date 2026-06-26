import { create } from 'zustand'

const CAMPAIGN_KEY = 'ledger.activeCampaignId'
const PC_KEY = 'ledger.activePcId'

function persisted(key: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
}
function persist(key: string, id: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (id) localStorage.setItem(key, id)
  else localStorage.removeItem(key)
}

// The active selections that drive the whole app (campaign / session / player character) plus the
// entity open in the detail panel. activeCampaignId and activePcId persist so relaunch restores
// context (the active PC matters for in-character Recall).
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
  activeCampaignId: persisted(CAMPAIGN_KEY),
  activeSessionId: null,
  activePcId: persisted(PC_KEY),
  selectedEntityId: null,
  setActiveCampaign: (id) => {
    persist(CAMPAIGN_KEY, id)
    persist(PC_KEY, null) // the active PC is campaign-scoped — clear it when the campaign changes
    set({ activeCampaignId: id, activeSessionId: null, activePcId: null, selectedEntityId: null })
  },
  setActiveSession: (id) => set({ activeSessionId: id }),
  setActivePc: (id) => {
    persist(PC_KEY, id)
    set({ activePcId: id })
  },
  setSelectedEntity: (id) => set({ selectedEntityId: id })
}))
