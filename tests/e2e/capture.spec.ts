import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, launchApp } from './helpers'

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

// Drives the real UI through the preload bridge — proves SPEC Flows A + B end-to-end at runtime:
// campaign → session → quick-add entities → session-linked note → typed relationship → local search.
test('capture flow: campaign, session, entities, note, link, search, delete', async () => {
  // Flow A — create and activate a campaign.
  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name').fill('Phandalin')
  await page.getByRole('button', { name: 'Create' }).click()

  // Quick-add appears only once a campaign is active.
  const quickAdd = page.getByPlaceholder(/Quick add/)
  await expect(quickAdd).toBeVisible()

  // Start a session (auto-numbered).
  await page.getByRole('button', { name: 'New session' }).click()
  await expect(page.getByText(/Session 1/).first()).toBeVisible()

  // Flow B — quick-add an NPC; it opens in the detail panel.
  await quickAdd.fill('Aldric Vane')
  await quickAdd.press('Enter')
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toBeVisible()

  // Add a timestamped, session-linked note.
  await page.getByPlaceholder(/Add a note/).fill('Owes the party a favor.')
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('Owes the party a favor.')).toBeVisible()

  // A second NPC, so we have something to link to.
  await quickAdd.fill('Mirna Dendrar')
  await quickAdd.press('Enter')
  await expect(page.getByRole('heading', { name: 'Mirna Dendrar' })).toBeVisible()

  // Re-select the first NPC and create a typed relationship to the second.
  await page.getByRole('button', { name: /Aldric Vane/ }).click()
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toBeVisible()
  await page.getByRole('button', { name: /Link to/ }).click()
  await page.getByPlaceholder('Search entities…').fill('Mirna')
  await page.getByRole('option', { name: /Mirna Dendrar/ }).click()
  await page.getByRole('button', { name: 'Add link' }).click()

  // The registry's directional label renders on the source entity.
  await expect(page.getByText('ally of')).toBeVisible()

  // Local search finds the entity via its note content (note-hit → parent entity).
  await page.getByPlaceholder('Search…').fill('favor')
  await expect(page.getByText(/favor/i).last()).toBeVisible()
  await page.getByPlaceholder('Search…').fill('')

  // Delete the selected entity (with confirmation) — it cascades and clears from list + detail.
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Aldric Vane/ })).toHaveCount(0)
})
