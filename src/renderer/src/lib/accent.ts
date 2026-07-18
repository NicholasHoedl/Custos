import type { AccentColor } from '@shared/entity-types'
import { ACCENT_COLORS } from '@shared/entity-types'

export { ACCENT_COLORS }
export type { AccentColor }

/** Display metadata for the Settings picker — a label and a representative swatch hex (the accent's base
 *  `--ember` value). The swatch is a preview only; globals.css `:root[data-accent]` is the source of truth
 *  for the applied theme, so these hexes must be kept in sync with those blocks. */
export const ACCENT_META: Record<AccentColor, { label: string; swatch: string }> = {
  ember: { label: 'Ember', swatch: '#d2732e' },
  cyan: { label: 'Cyan', swatch: '#2fb0c6' },
  green: { label: 'Green', swatch: '#4fa863' },
  red: { label: 'Red', swatch: '#cf463a' },
  yellow: { label: 'Yellow', swatch: '#d4a333' },
  purple: { label: 'Purple', swatch: '#8f5fbe' },
  steel: { label: 'Steel Blue', swatch: '#4a7fb5' },
  verdigris: { label: 'Verdigris', swatch: '#3f9285' },
  oxblood: { label: 'Oxblood', swatch: '#9c4256' },
  parchment: { label: 'Parchment', swatch: '#c9b78f' },
  rose: { label: 'Dusty Rose', swatch: '#bf7a88' },
  indigo: { label: 'Indigo', swatch: '#5f5fb0' }
}

/** Apply the accent to the document root; globals.css keys its token overrides off `[data-accent]`.
 *  Called once on launch (AppShell, from the persisted setting) and live on each pick (SettingsView). */
export function applyAccent(accent: AccentColor | undefined): void {
  document.documentElement.dataset.accent = accent ?? 'ember'
}
