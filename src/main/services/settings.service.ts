import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/entity-types'
import { DEFAULT_HOTKEY } from '@shared/constants'

const DEFAULTS: AppSettings = {
  recallModel: 'claude-sonnet-4-6',
  suggestModel: 'claude-opus-4-8',
  suggestEffort: 'high',
  // Extraction (Transcribe + the session Extract tool + backstory) is structured data-entry behind a
  // validation net + review gate (ADR-035): Sonnet at medium effort is ~a quarter of Opus-high's cost.
  extractionModel: 'claude-sonnet-4-6',
  extractionEffort: 'medium',
  // Illuminate is decoupled (ADR-051) and fires one call PER touched entity — the cost driver. It's
  // review-gated, so it defaults to the cheapest tier (Haiku); raise it in Settings if proposals feel thin.
  illuminateModel: 'claude-haiku-4-5',
  illuminateEffort: 'medium',
  hotkey: DEFAULT_HOTKEY,
  tutorialCompleted: false, // forced first-run tutorial (ADR-044); flips true on completion
  accentColor: 'ember' // UI accent hue; the base :root in globals.css IS ember
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
