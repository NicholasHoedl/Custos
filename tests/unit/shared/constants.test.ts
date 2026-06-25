import { describe, it, expect } from 'vitest'
import { DEFAULT_HOTKEY, formatSessionLabel } from '@shared/constants'

describe('shared/constants', () => {
  it('exposes the default global quick-add hotkey', () => {
    expect(DEFAULT_HOTKEY).toBe('Ctrl+Alt+L')
  })

  it('formats session labels with and without a title', () => {
    expect(formatSessionLabel(3)).toBe('Session 3')
    expect(formatSessionLabel(3, 'The Goblin Ambush')).toBe('Session 3 — The Goblin Ambush')
  })
})
