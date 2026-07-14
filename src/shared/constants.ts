export const APP_NAME = 'Custos'
export const APP_ID = 'com.custos.app'
export const DB_FILENAME = 'custos.db'

/** Default global quick-add hotkey (configurable in Settings; ADR-010 — focus-main in Phase 0). */
export const DEFAULT_HOTKEY = 'Ctrl+Alt+L'

/** Claude model IDs — single source of truth (used from Phase 2). */
export const MODELS = {
  recall: 'claude-sonnet-4-6',
  suggest: 'claude-opus-4-8'
} as const

/** e.g. formatSessionLabel(3, 'The Ambush') -> 'Session 3 — The Ambush'. */
export function formatSessionLabel(num: number, title?: string | null): string {
  return title ? `Session ${num} — ${title}` : `Session ${num}`
}
