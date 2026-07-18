import type {
  AccentColor,
  BaseTemperature,
  ReadingFont,
  Texture,
  UiScale
} from '@shared/entity-types'
import {
  ACCENT_COLORS,
  BASE_TEMPERATURES,
  READING_FONTS,
  TEXTURES,
  UI_SCALES
} from '@shared/entity-types'
import { applyAccent } from './accent'

// The appearance layer (ADR-065) — the sibling of lib/accent.ts, extended to four more preferences.
// Each is applied as a `[data-*]` attribute on <html>, which globals.css keys its RAW-token overrides
// off; nothing here knows about individual components. `accent.ts` stays the sole owner of
// [data-accent] — this module delegates to it rather than writing that attribute itself.
//
// DOM and localStorage access is LAZY (inside functions, never at module scope): vitest runs
// `environment: 'node'`, so importing this module must not touch a browser global.

export { UI_SCALES, BASE_TEMPERATURES, READING_FONTS, TEXTURES }
export type { UiScale, BaseTemperature, ReadingFont, Texture }

/** The full applied appearance — every field resolved, no optionals. */
export interface Appearance {
  accentColor: AccentColor
  uiScale: UiScale
  baseTemperature: BaseTemperature
  readingFont: ReadingFont
  texture: Texture
}

/** Defaults reproduce the CURRENT look, so an existing install sees no change until the user picks. */
export const APPEARANCE_DEFAULTS: Appearance = {
  accentColor: 'ember',
  uiScale: 'comfortable',
  baseTemperature: 'warm',
  readingFont: 'sans',
  texture: 'none'
}

/** Display metadata for the Settings → Appearance controls: a short label and a one-line gloss. */
export const UI_SCALE_META: Record<UiScale, { label: string; hint: string }> = {
  compact: { label: 'Compact', hint: 'Fit more on screen' },
  comfortable: { label: 'Comfortable', hint: 'The default' },
  spacious: { label: 'Spacious', hint: 'Readable across a table' }
}

export const BASE_META: Record<BaseTemperature, { label: string; hint: string }> = {
  warm: { label: 'Warm', hint: 'Ash & Ember charcoal' },
  cold: { label: 'Cold', hint: 'Slate — suits the cold accents' }
}

export const READING_FONT_META: Record<ReadingFont, { label: string; hint: string }> = {
  sans: { label: 'Sans', hint: 'Bricolage Grotesque' },
  serif: { label: 'Serif', hint: 'Fraunces, for long reads' }
}

export const TEXTURE_META: Record<Texture, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'Clean canvas' },
  grain: { label: 'Grain', hint: 'A subtle film grain' }
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * Clamp arbitrary input to a valid `Appearance`, falling back per-field. This is the ONLY validation in
 * the chain and it guards BOTH sources: `settings.json` (the main process spreads it into the settings
 * object unvalidated) and the localStorage mirror (a new, equally untrusted input). Pure — safe to unit
 * test under the node environment.
 */
export function normalizeAppearance(raw: Partial<Appearance> | null | undefined): Appearance {
  const r = raw ?? {}
  return {
    accentColor: pick(ACCENT_COLORS, r.accentColor, APPEARANCE_DEFAULTS.accentColor),
    uiScale: pick(UI_SCALES, r.uiScale, APPEARANCE_DEFAULTS.uiScale),
    baseTemperature: pick(BASE_TEMPERATURES, r.baseTemperature, APPEARANCE_DEFAULTS.baseTemperature),
    readingFont: pick(READING_FONTS, r.readingFont, APPEARANCE_DEFAULTS.readingFont),
    texture: pick(TEXTURES, r.texture, APPEARANCE_DEFAULTS.texture)
  }
}

/** Where the pre-paint bootstrap reads its copy from. `settings.json` remains the durable source. */
const MIRROR_KEY = 'ledger.appearance'

/**
 * Apply an appearance to <html> and mirror it for the next launch. This is the SINGLE writer of the
 * mirror, so call sites cannot drift out of sync. Returns the normalized values actually applied.
 */
export function applyAppearance(raw: Partial<Appearance> | null | undefined): Appearance {
  const next = normalizeAppearance(raw)
  const root = document.documentElement
  applyAccent(next.accentColor) // accent.ts owns [data-accent]
  root.dataset.uiScale = next.uiScale
  root.dataset.base = next.baseTemperature
  root.dataset.readingFont = next.readingFont
  root.dataset.texture = next.texture
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(next))
  } catch {
    // A blocked or full quota must never break theming — the attributes are already applied.
  }
  return next
}

/**
 * Apply the mirrored appearance BEFORE React renders (called from main.tsx ahead of `createRoot`), so a
 * scale change doesn't reflow the whole UI once the settings IPC resolves. An inline <script> in
 * index.html would run earlier but is CSP-blocked (`script-src 'self'`, no 'unsafe-inline'), making this
 * the earliest CSP-safe point; a brief background-hue flash on the still-empty root can remain, which is
 * accepted rather than hiding the app behind `visibility: hidden` (that fails open into a blank window).
 */
export function bootstrapAppearance(): void {
  let raw: Partial<Appearance> | null = null
  try {
    const stored = localStorage.getItem(MIRROR_KEY)
    if (stored) raw = JSON.parse(stored) as Partial<Appearance>
  } catch {
    raw = null // corrupt/unreadable mirror → defaults; the settings.json load corrects it a beat later
  }
  applyAppearance(raw)
}
