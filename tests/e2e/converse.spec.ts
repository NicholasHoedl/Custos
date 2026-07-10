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

// Converse (ADR-034/043) via the fake-AI seam: pick a character to talk WITH → a spread of tagged,
// in-character questions. Direct-fetch grounding, so no embedding model is involved.
test('Converse: preparing questions for a target returns a tagged spread', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')

  // A target character to talk with (an NPC — the default inscribe type).
  await page.getByRole('button', { name: 'Codex' }).click()
  await page.getByRole('button', { name: 'Inscribe' }).click()
  await page.getByLabel('Name').fill('Sister Garaele')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Sister Garaele' })).toBeVisible()

  await plantKeyAndReload(page)

  await page.getByRole('button', { name: 'Converse' }).click()
  // Choose the target: a role=combobox is named by its label (empty here), so scope to the main panel's
  // sole combobox rather than by name, then pick the NPC from the popover.
  await page.getByRole('main').getByRole('combobox').click()
  await page.getByRole('option', { name: /Sister Garaele/ }).click()
  await page.getByRole('button', { name: 'Prepare questions' }).click()

  // A canned question + its tag label prove the spread rendered (exact — "rapport" also appears in a read).
  await expect(page.getByText('What first brought you to this place?')).toBeVisible()
  await expect(page.getByText('Rapport', { exact: true })).toBeVisible()
})
