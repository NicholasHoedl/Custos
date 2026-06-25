import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const MAIN = join(__dirname, '..', '..', 'out', 'main', 'index.js')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

// Launch the built app against a throwaway userData dir so each run gets a clean, migrated DB and an
// isolated single-instance lock (so it won't collide with a running dev instance or a sibling spec).
export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ledger-e2e-'))
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userDataDir}`] })
  const page = await app.firstWindow()
  return { app, page, userDataDir }
}

export function cleanup(userDataDir: string): void {
  try {
    rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    // WAL/lock files can linger briefly on Windows; a leftover temp dir is harmless.
  }
}
