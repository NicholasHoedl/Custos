import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, createCampaign, launchApp, plantKeyAndReload } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp({ fakeAi: true }))
})

test.afterEach(async () => {
  await app?.close()
  cleanup(userDataDir)
})

// Continuity (ADR-056) via the fake-AI seam: the deterministic checks always run, and the AI pass returns a
// canned contradiction. Asserts the full wiring — nav → IPC → service → fake seam → findings report.
test('Continuity: running the audit renders the findings report', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')
  await plantKeyAndReload(page) // a key so the AI pass runs (the seam short-circuits the real Claude call)

  await page.getByRole('button', { name: 'Continuity' }).click()
  await expect(page.getByRole('heading', { name: 'Continuity' })).toBeVisible()

  await page.getByRole('button', { name: 'Run check' }).click()

  // The canned AI contradiction finding renders (proves IPC + service + fake seam + the report view).
  await expect(page.getByText(/Sword of Souls/)).toBeVisible()
})
