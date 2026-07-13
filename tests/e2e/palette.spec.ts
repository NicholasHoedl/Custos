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

const PALETTE_PLACEHOLDER = 'Jump to a view or find an entity…'

// The global ⌘/Ctrl+K command palette (ROADMAP P2-4): view navigation + entity find. Pure navigation,
// so it runs in the keyless e2e harness (no AI). Mirrors capture.spec's campaign+entity setup.
test('command palette: Ctrl+K navigates to a view and finds an entity', async () => {
  // A campaign is needed for the "Entities" group; create it (with its mandatory main character).
  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Phandalin')
  await page.getByLabel('Main character').fill('Vargas')
  await page.getByRole('button', { name: 'Create' }).click()

  // Ctrl+K opens the palette; "Go to → Lore" navigates. The Lore heading is unique to that view and
  // renders regardless of model state (the SetupCard sits below it).
  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toBeVisible()
  await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill('Lore')
  await page.getByRole('option', { name: 'Lore' }).click()
  await expect(page.getByRole('heading', { name: 'Lore' })).toBeVisible()
  await expect(page.getByPlaceholder(PALETTE_PLACEHOLDER)).toHaveCount(0) // palette closed on select

  // Add an entity in Codex so the palette has something to find.
  await page.getByRole('button', { name: 'Codex' }).click()
  await page.getByRole('button', { name: 'Inscribe' }).click()
  await page.getByLabel('Name').fill('Gundren Rockseeker')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Gundren Rockseeker' })).toBeVisible()

  // Navigate away, then find the entity through the palette — it should reopen it in Codex.
  await page.getByRole('button', { name: 'Sessions' }).click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill('Gundren')
  await page.getByRole('option', { name: /Gundren Rockseeker/ }).click()
  await expect(page.getByRole('heading', { name: 'Gundren Rockseeker' })).toBeVisible()
})
