import { describe, it, expect } from 'vitest'
import { DEFAULT_HOTKEY } from '@shared/constants'

describe('shared/constants', () => {
  it('exposes the default global quick-add hotkey', () => {
    expect(DEFAULT_HOTKEY).toBe('Ctrl+Alt+L')
  })
})
