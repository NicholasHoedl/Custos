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
  await page.getByRole('button', { name: 'Add entity' }).click()
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

  // Follow-up v2 (ADR-049): you must PICK the suggestion you used, THEN paraphrase the answer. Pick the
  // open-probe card, feed an answer, follow up (the fake seam returns the canned four regardless).
  const card = page.locator('div.rounded-lg', { hasText: 'What first brought you to this place?' })
  await card.getByRole('button', { name: /Follow up on this/ }).click()
  await page
    .getByPlaceholder(/What did they say back/)
    .fill('She admits she is worried about a missing friend.')
  // exact — the card "Follow up on this →" buttons also contain "Follow up".
  await page.getByRole('button', { name: 'Follow up', exact: true }).click()
  // The exchange breadcrumb (their answer) proves the picked question + answer were captured…
  await expect(page.getByText('She admits she is worried about a missing friend.')).toBeVisible()
  // …and a fresh spread renders — a different canned question now shows in both turns' spreads.
  await expect(
    page.getByText('When all of this is over, what are you actually after?')
  ).toHaveCount(2)
})
