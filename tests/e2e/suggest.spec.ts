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

// A fresh instance has no campaign, so the real Counsel view renders its own empty state.
test('Counsel nav opens the real view (empty state without a campaign)', async () => {
  await page.getByRole('button', { name: 'Counsel' }).click()
  await expect(page.getByText('Choose a campaign in the sidebar to seek counsel.')).toBeVisible()
})

// The live "in the moment" path (ADR-048/043) driven through the fake-AI seam: 4 narrative option cards.
test('Counsel: a charged moment returns four narrative option cards', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')
  await plantKeyAndReload(page)

  await page.getByRole('button', { name: 'Counsel' }).click()
  await page
    .getByPlaceholder('The mayor just admitted')
    .fill('The Redbrands surround the party in the town square.')
  await page.getByRole('button', { name: 'Seek counsel' }).click()

  // Each card is a plain-English action-verb TITLE + a concise EXPLANATION + tag chips — no D&D
  // mechanics, no expand (ADR-048). The canned title + explanation + a tag prove the spread rendered.
  await expect(page.getByText('Offer them a way to walk away with their pride.')).toBeVisible()
  await expect(page.getByText('Propose a compromise that lets both sides back down.')).toBeVisible()
  await expect(page.getByText('Protective')).toBeVisible()

  // Refine (per-moment re-roll): a nudge chip re-asks the SAME moment and replaces the spread. The fake
  // seam returns the canned four regardless, so a title is still on screen afterward (no crash/clear).
  await page.getByRole('button', { name: 'Bolder' }).click()
  await expect(page.getByText('Offer them a way to walk away with their pride.')).toBeVisible()
})
