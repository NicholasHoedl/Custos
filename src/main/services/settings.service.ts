import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/entity-types'
import { DEFAULT_HOTKEY } from '@shared/constants'

const DEFAULTS: AppSettings = {
  recallModel: 'claude-sonnet-4-6',
  suggestModel: 'claude-opus-4-8',
  suggestEffort: 'high',
  // Extraction is structured data-entry behind a validation net + review gate (ADR-035): Sonnet at
  // medium effort is ~a quarter of Opus-high's cost per close-out with little quality to lose there.
  extractionModel: 'claude-sonnet-4-6',
  extractionEffort: 'medium',
  hotkey: DEFAULT_HOTKEY,
  tutorialCompleted: false // forced first-run tutorial (ADR-044); flips true on completion
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
