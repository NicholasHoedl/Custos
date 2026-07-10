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

// Recap (ADR-013/043) via the fake-AI seam: a "Previously…" summary streamed for one session and saved
// to its summary. No embeddings, no retrieval — recap reads the session directly.
test('Recap: generating a recap streams text and saves it to the session', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')
  await plantKeyAndReload(page)

  // A session with one chronicle entry gives the recap something to summarize.
  await page.getByRole('button', { name: 'New session' }).click()
  await page.getByPlaceholder('A sentence or two').fill('The party met a stranger and struck a deal.')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('The party met a stranger and struck a deal.')).toBeVisible()

  // Sessions view auto-selects the newest session → its recap panel is shown.
  await page.getByRole('button', { name: 'Sessions' }).click()
  await page.getByRole('button', { name: 'Generate recap' }).click()

  await expect(page.getByText('The session opened in the tavern')).toBeVisible()
  await expect(page.getByText("Saved to this session")).toBeVisible()
})
