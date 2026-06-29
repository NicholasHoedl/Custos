import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/entity-types'
import { DEFAULT_HOTKEY } from '@shared/constants'

const DEFAULTS: AppSettings = {
  theme: 'dark',
  fontSize: 'md',
  recallModel: 'claude-sonnet-4-6',
  suggestModel: 'claude-opus-4-8',
  suggestEffort: 'high',
  hotkey: DEFAULT_HOTKEY
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  try {
    if (!existsSync(settingsPath())) return { ...DEFAULTS }
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Partial<AppSettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
  return next
}
