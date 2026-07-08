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

// Open the full "Inscribe" form (top of the entity browser; defaults to NPC), fill it, and create.
async function addEntity(name: string, description?: string): Promise<void> {
  await page.getByRole('button', { name: 'Inscribe' }).click() // opens the Inscribe pane (not a popup)
  await page.getByLabel('Name').fill(name)
  if (description) await page.getByLabel('Description').fill(description)
  await page.getByRole('button', { name: 'Create' }).click()
}

// Drives the real UI through the preload bridge — proves SPEC Flows A + B end-to-end at runtime:
// campaign → session → add entities (full profile form) → typed relationship → local search → delete.
test('capture flow: campaign, session, entities, link, search, delete', async () => {
  // Flow A — create and activate a campaign (with its mandatory main character, ADR-029).
  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Phandalin')
  await page.getByLabel('Main character').fill('Vargas')
  await page.getByRole('button', { name: 'Create' }).click()

  // Start a session (auto-numbered) from the Chronicle header — the session control moved there
  // (ADR-036), so this must happen BEFORE navigating away (the default view is Chronicle).
  await page.getByRole('button', { name: 'New session' }).click()
  await expect(page.getByText(/Session 1/).first()).toBeVisible()

  // Entity capture lives on the Codex view — navigate there.
  await page.getByRole('button', { name: 'Codex' }).click()

  // Flow B — add an NPC via the full "Add entity" form; on create it opens in the detail panel.
  // (.first(): the description also renders as the browser row's line-clamped snippet.)
  await addEntity('Aldric Vane', 'Owes the party a favor.')
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toBeVisible()
  await expect(page.getByText('Owes the party a favor.').first()).toBeVisible()

  // A second NPC, so we have something to link to.
  await addEntity('Mirna Dendrar')
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

  // Local search finds the entity via its description content.
  await page.getByPlaceholder('Search…').fill('favor')
  await expect(page.getByText(/favor/i).last()).toBeVisible()
  await page.getByPlaceholder('Search…').fill('')

  // Delete the selected entity (with confirmation) — it cascades and clears from list + detail.
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Aldric Vane/ })).toHaveCount(0)
})
