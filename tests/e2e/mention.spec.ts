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

// Entity quick-write: typing "/npc" in the Chronicle composer opens a filtered menu of NPCs; picking one
// drops the entity's plain name in place of the token. Pure UI — no AI, no fake-AI seam (the menu reads
// the local entity list). Proves the reusable MentionTextarea end to end on its primary call site.
test('mention: /npc offers an entity and inserts its name', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')

  // Seed an NPC to mention (Codex → Add entity form, defaults to NPC).
  await page.getByRole('button', { name: 'Codex' }).click()
  await page.getByRole('button', { name: 'Add entity' }).click()
  await page.getByLabel('Name').fill('Aldric Vane')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toBeVisible()

  // Back to Chronicle and start a session so the capture composer renders.
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click()
  await page.getByRole('button', { name: 'New session' }).click()

  const composer = page.getByPlaceholder(/What happened/)
  await composer.click()
  await composer.pressSequentially('/npc')

  // The autocomplete menu offers the seeded NPC (role=option, portaled from the Popover).
  const option = page.getByRole('option', { name: /Aldric Vane/ })
  await expect(option).toBeVisible()

  // Keyboard-select it — the "/npc" token is replaced by the plain entity name (+ a trailing space).
  await composer.press('ArrowDown')
  await composer.press('Enter')
  await expect(composer).toHaveValue(/Aldric Vane\s/)
  await expect(composer).not.toHaveValue(/\/npc/)
  await expect(option).toHaveCount(0) // menu closed after the pick
})

test('mention: free-text /<name> fuzzy-searches all types (multi-word, no category code)', async () => {
  // Reuses the campaign + "Aldric Vane" seeded by the first test (shared app via beforeAll).
  const composer = page.getByPlaceholder(/What happened/)
  await composer.fill('') // clear what the previous test inserted
  await composer.click()
  await composer.pressSequentially('/aldric van') // multi-word, no type code → fuzzy name search

  const option = page.getByRole('option', { name: /Aldric Vane/ })
  await expect(option).toBeVisible()
  await option.click() // mouse-select this time

  await expect(composer).toHaveValue(/Aldric Vane\s/)
  await expect(composer).not.toHaveValue(/\/aldric/)
})

// The Chronicle header info popover (ChronicleInfo) — same variety as the AI lenses' LensPromptInfo, with
// the extraction/insight best-practices. Static copy, so a plain UI check (reuses the campaign above).
test('chronicle: the header info popover explains writing for extraction', async () => {
  await page.getByRole('button', { name: 'About Chronicle' }).click()
  await expect(page.getByText('Writing for the Keeper')).toBeVisible()
  await expect(page.getByText(/Use real names/)).toBeVisible()
})
