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
// `fakeAi` sets LEDGER_FAKE_AI so the main process serves canned AI (ADR-041). By default we set
// LEDGER_SKIP_TUTORIAL so the forced first-run wizard (ADR-044) doesn't block every spec — pass
// `{ tutorial: true }` to opt IN (the tutorial spec).
export async function launchApp(opts?: { fakeAi?: boolean; tutorial?: boolean }): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ledger-e2e-'))
  const env = {
    ...process.env,
    ...(opts?.fakeAi ? { LEDGER_FAKE_AI: '1' } : {}),
    ...(opts?.tutorial ? {} : { LEDGER_SKIP_TUTORIAL: '1' })
  } as Record<string, string>
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userDataDir}`], env })
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

// ---- Shared drive-path helpers for the AI-lens specs (fake-AI seam, ADR-041/043) ----

/** Create a campaign + its mandatory main character via the New-campaign dialog. */
export async function createCampaign(page: Page, name: string, mainCharacter: string): Promise<void> {
  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Main character').fill(mainCharacter)
  await page.getByRole('button', { name: 'Create' }).click()
}

/** Plant a dummy API key (the lenses gate on key PRESENCE, not validity) and reload so the views'
 *  `useOnboarding` refetches `keyReady` (and, under LEDGER_FAKE_AI, `modelReady`). */
export async function plantKeyAndReload(page: Page): Promise<void> {
  await page.evaluate(() =>
    (
      window as unknown as { ledger: { apikey: { set(k: string): Promise<void> } } }
    ).ledger.apikey.set('sk-ant-test')
  )
  await page.reload()
}
