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

// Proves the per-type editor at runtime: traits as add/remove chips, the dropdown+custom status, and a
// type-specific field — all round-tripping into the detail view.
test('per-type profile editor: chips, custom status, type-specific field', async () => {
  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name').fill('Phandalin')
  await page.getByRole('button', { name: 'Create' }).click()

  const quickAdd = page.getByPlaceholder(/Quick add/)
  await expect(quickAdd).toBeVisible()
  await quickAdd.fill('Aldric Vane')
  await quickAdd.press('Enter')
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toBeVisible()

  // Open the editor.
  await page.getByRole('button', { name: 'Edit' }).click()

  // Traits are chips now: add two (Enter), remove one (×).
  const traits = page.getByLabel('Traits')
  await traits.fill('gruff')
  await traits.press('Enter')
  await traits.fill('loyal')
  await traits.press('Enter')
  await expect(page.getByRole('button', { name: 'Remove loyal' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove gruff' }).click()
  await expect(page.getByRole('button', { name: 'Remove gruff' })).toHaveCount(0)

  // Status: a curated dropdown that also accepts a custom typed value.
  await page.locator('#ef-status').click()
  await page.getByPlaceholder('Search or type…').fill('Cornered')
  await page.getByRole('option', { name: /Cornered/ }).click()
  await expect(page.locator('#ef-status')).toContainText('Cornered')

  // A type-specific field (NPC → Race).
  await page.getByLabel('Race').fill('Half-orc')

  await page.getByRole('button', { name: 'Save' }).click()

  // Detail view reflects all of it.
  await expect(page.getByText('loyal')).toBeVisible()
  await expect(page.getByText('gruff')).toHaveCount(0)
  await expect(page.getByText('Cornered')).toBeVisible()
  await expect(page.getByText('Half-orc')).toBeVisible()
})
