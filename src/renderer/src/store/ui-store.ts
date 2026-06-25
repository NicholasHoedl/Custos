import { create } from 'zustand'

export type ViewKey = 'capture' | 'recall' | 'suggest' | 'settings'

interface UiState {
  activeView: ViewKey
  setActiveView: (view: ViewKey) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'capture',
  setActiveView: (activeView) => set({ activeView })
}))
