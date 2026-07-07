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

// Proves the per-type editor at runtime — reached now via the full "Add entity" form: traits as
// add/remove chips, the dropdown+custom status, and a type-specific field — all round-tripping into
// the detail view on create.
test('per-type profile editor: chips, custom status, type-specific field', async () => {
  await page.getByRole('button', { name: 'New saga' }).click()
  await page.getByLabel('Name').fill('Phandalin')
  await page.getByRole('button', { name: 'Create' }).click()

  // The Chronicle is the default view now; entity capture lives on the Codex view — navigate there.
  await page.getByRole('button', { name: 'Codex' }).click()

  // Open the full "Inscribe" pane (defaults to NPC) and drive its per-type fields directly.
  await page.getByRole('button', { name: 'Inscribe' }).click()
  await page.getByLabel('Name').fill('Aldric Vane')

  // Traits are chips: add two (Enter), remove one (×).
  const traits = page.getByLabel('Traits')
  await traits.fill('gruff')
  await traits.press('Enter')
  await traits.fill('loyal')
  await traits.press('Enter')
  await expect(page.getByRole('button', { name: 'Remove loyal' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove gruff' }).click()
  await expect(page.getByRole('button', { name: 'Remove gruff' })).toHaveCount(0)

  // Status: a curated dropdown that also accepts a custom typed value (its popover is portalled).
  await page.locator('#ef-status').click()
  await page.getByPlaceholder('Search or type…').fill('Cornered')
  await page.getByRole('option', { name: /Cornered/ }).click()
  await expect(page.locator('#ef-status')).toContainText('Cornered')

  // A type-specific field (NPC → Race).
  await page.getByLabel('Race').fill('Half-orc')

  await page.getByRole('button', { name: 'Create' }).click()

  // Detail view reflects all of it.
  await expect(page.getByText('loyal')).toBeVisible()
  await expect(page.getByText('gruff')).toHaveCount(0)
  await expect(page.getByText('Cornered')).toBeVisible()
  await expect(page.getByText('Half-orc')).toBeVisible()
})
