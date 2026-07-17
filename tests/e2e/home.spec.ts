import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, createCampaign, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, page, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await app?.close()
  cleanup(userDataDir)
})

// The Home dashboard (ADR-061): the default landing view. Keyless — every widget has an idle/empty
// state, and the ask box only PRE-FILLS Lore (no AI call).
test('home: default landing, fills in after campaign creation, ask box seeds Lore', async () => {
  // The app lands on Home; with no campaign it shows the shared empty state (`.first()` — the hidden
  // mounted views render their own NoCampaign copies; Home's is first in the DOM and the visible one).
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await expect(page.getByText('No campaign yet').first()).toBeVisible()

  // Create the campaign (+ its mandatory main character) through the real sidebar dialog.
  await createCampaign(page, 'Phandalin', 'Vargas')

  // The hero header and the memory stats reflect the new campaign.
  await expect(page.getByRole('heading', { name: 'Phandalin' })).toBeVisible()
  await expect(page.getByText('1 PC', { exact: true })).toBeVisible()

  // Before session 1 (ADR-063): a brand-new campaign with a bare MC and no session surfaces both setup
  // nudges in the needs-attention strip. (Keyless launch also shows the key/model nags.)
  await expect(page.getByText('Fill in your character')).toBeVisible()
  await expect(page.getByText('Start your first session')).toBeVisible()

  // The ask box routes into Lore with the query PRE-FILLED (openLens seam — no auto-ask).
  await page.getByPlaceholder('What do we know about…').fill('who is Vargas')
  await page.getByRole('button', { name: 'Ask Lore' }).click()
  await expect(page.getByRole('heading', { name: 'Lore' })).toBeVisible()
  await expect(page.getByPlaceholder(/Who is Glastav/)).toHaveValue('who is Vargas')
})
