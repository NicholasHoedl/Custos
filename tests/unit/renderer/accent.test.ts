import { describe, it, expect } from 'vitest'
import { ACCENT_COLORS } from '@shared/entity-types'
// Pure renderer module — applyAccent's DOM write is lazy (inside the fn), not run at import, so this is
// safe under the no-DOM test env. vitest resolves only @shared, so reach the renderer lib by relative
// path (mirrors mention.test.ts). Guards the picker's swatch/label metadata against drift.
import { ACCENT_META } from '../../../src/renderer/src/lib/accent'

describe('accent metadata', () => {
  it('has a label and a 6-digit hex swatch for every accent color', () => {
    for (const c of ACCENT_COLORS) {
      expect(ACCENT_META[c]).toBeDefined()
      expect(ACCENT_META[c].label.length).toBeGreaterThan(0)
      expect(ACCENT_META[c].swatch).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('has no metadata entries beyond the known accents', () => {
    expect(Object.keys(ACCENT_META).sort()).toEqual([...ACCENT_COLORS].sort())
  })

  it('keeps ember first (the default) with its canonical swatch', () => {
    expect(ACCENT_COLORS[0]).toBe('ember')
    expect(ACCENT_META.ember.swatch).toBe('#d2732e')
  })
})
