import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCENT_COLORS,
  BASE_TEMPERATURES,
  READING_FONTS,
  TEXTURES,
  UI_SCALES
} from '@shared/entity-types'
// Pure renderer module — every document/localStorage touch is LAZY (inside applyAppearance /
// bootstrapAppearance), never at import, so this is safe under the no-DOM node test env. vitest
// resolves only @shared, so reach the renderer lib by relative path (mirrors accent.test.ts).
import {
  APPEARANCE_DEFAULTS,
  BASE_META,
  READING_FONT_META,
  TEXTURE_META,
  UI_SCALE_META,
  normalizeAppearance
} from '../../../src/renderer/src/lib/appearance'

// vitest runs from the repo root, so cwd-relative is stable (and avoids __dirname/ESM friction).
const CSS = readFileSync(join(process.cwd(), 'src/renderer/src/styles/globals.css'), 'utf-8')

describe('normalizeAppearance', () => {
  it('falls back to the defaults for empty input', () => {
    expect(normalizeAppearance(null)).toEqual(APPEARANCE_DEFAULTS)
    expect(normalizeAppearance(undefined)).toEqual(APPEARANCE_DEFAULTS)
    expect(normalizeAppearance({})).toEqual(APPEARANCE_DEFAULTS)
  })

  // settings.json is spread into the settings object unvalidated by the main process, and the
  // localStorage mirror is equally untrusted — this clamp is the only guard on either path.
  it('clamps unknown values per-field without discarding the valid neighbours', () => {
    const out = normalizeAppearance({
      accentColor: 'chartreuse' as never,
      uiScale: 'spacious',
      baseTemperature: 'tepid' as never,
      readingFont: 'serif',
      texture: 42 as never
    })
    expect(out.accentColor).toBe(APPEARANCE_DEFAULTS.accentColor)
    expect(out.baseTemperature).toBe(APPEARANCE_DEFAULTS.baseTemperature)
    expect(out.texture).toBe(APPEARANCE_DEFAULTS.texture)
    expect(out.uiScale).toBe('spacious')
    expect(out.readingFont).toBe('serif')
  })

  it('passes every canonical value through unchanged', () => {
    for (const v of ACCENT_COLORS) expect(normalizeAppearance({ accentColor: v }).accentColor).toBe(v)
    for (const v of UI_SCALES) expect(normalizeAppearance({ uiScale: v }).uiScale).toBe(v)
    for (const v of BASE_TEMPERATURES)
      expect(normalizeAppearance({ baseTemperature: v }).baseTemperature).toBe(v)
    for (const v of READING_FONTS) expect(normalizeAppearance({ readingFont: v }).readingFont).toBe(v)
    for (const v of TEXTURES) expect(normalizeAppearance({ texture: v }).texture).toBe(v)
  })

  it('defaults reproduce the pre-ADR-065 look', () => {
    expect(APPEARANCE_DEFAULTS).toEqual({
      accentColor: 'ember',
      uiScale: 'comfortable',
      baseTemperature: 'warm',
      readingFont: 'sans',
      texture: 'none'
    })
  })
})

describe('appearance option metadata', () => {
  it('has a non-empty label and hint for every option', () => {
    const tables = [
      [UI_SCALES, UI_SCALE_META],
      [BASE_TEMPERATURES, BASE_META],
      [READING_FONTS, READING_FONT_META],
      [TEXTURES, TEXTURE_META]
    ] as const
    for (const [values, meta] of tables) {
      for (const v of values) {
        const entry = (meta as Record<string, { label: string; hint: string }>)[v]
        expect(entry).toBeDefined()
        expect(entry.label.length).toBeGreaterThan(0)
        expect(entry.hint.length).toBeGreaterThan(0)
      }
    }
  })
})

// The TS unions and the CSS blocks are hand-synced (the same drift risk the accent system carries).
// This is the guard that actually catches the failure mode: a new union member with no CSS behind it
// would silently do nothing in the UI.
describe('globals.css drift guard', () => {
  it('defines a [data-ui-scale] block for every non-default scale', () => {
    for (const v of UI_SCALES) {
      if (v === APPEARANCE_DEFAULTS.uiScale) continue // the base :root IS the default
      expect(CSS).toContain(`[data-ui-scale='${v}']`)
    }
  })

  it('defines a [data-base] block for every non-default base temperature', () => {
    for (const v of BASE_TEMPERATURES) {
      if (v === APPEARANCE_DEFAULTS.baseTemperature) continue
      expect(CSS).toContain(`[data-base='${v}']`)
    }
  })

  it('defines a [data-reading-font] block for every non-default reading font', () => {
    for (const v of READING_FONTS) {
      if (v === APPEARANCE_DEFAULTS.readingFont) continue
      expect(CSS).toContain(`[data-reading-font='${v}']`)
    }
  })

  it('defines a [data-texture] rule for every non-default texture', () => {
    for (const v of TEXTURES) {
      if (v === APPEARANCE_DEFAULTS.texture) continue
      expect(CSS).toContain(`[data-texture='${v}']`)
    }
  })

  // Closes a gap accent.test.ts leaves open: it checks ACCENT_META against ACCENT_COLORS, but never
  // that the CSS actually has a block for each accent.
  it('defines a [data-accent] block for every non-default accent', () => {
    for (const v of ACCENT_COLORS) {
      if (v === APPEARANCE_DEFAULTS.accentColor) continue
      expect(CSS).toContain(`[data-accent='${v}']`)
    }
  })

  it('routes the font-reading utility through a non-self-referential token', () => {
    // `@theme inline { --font-reading: var(--font-reading) }` would be self-referential and survive
    // only by cascade luck — the alias must point at a differently-named source token.
    expect(CSS).toContain('--font-reading: var(--reading-family)')
    expect(CSS).toContain('--reading-family: var(--font-body)')
  })
})
