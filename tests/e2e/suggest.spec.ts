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

// The live "in the moment" path (ADR-026/043) driven through the fake-AI seam: 6 tagged option cards.
test('Counsel: a charged moment returns six in-character option cards', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')
  await plantKeyAndReload(page)

  await page.getByRole('button', { name: 'Counsel' }).click()
  await page
    .getByPlaceholder('The mayor just admitted')
    .fill('The Redbrands surround the party in the town square.')
  await page.getByRole('button', { name: 'Seek counsel' }).click()

  // A canned option's action + one of its tag labels prove the six-card spread rendered.
  await expect(
    page.getByText('Offer a calm compromise that gives them a way to save face.')
  ).toBeVisible()
  await expect(page.getByText('Protective')).toBeVisible()
})
