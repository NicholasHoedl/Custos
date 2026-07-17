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

const ENTRY = 'We arrived at the ruined tower.'

// Insert-session-before (ADR-062): the backfill flow for a campaign that started tracking mid-story.
// Keyless — pure UI + the renumber cascade. Locators are role/visible-scoped throughout (the hidden
// mounted Home/Chronicle views also carry session labels and the entry text as plain DOM text).
test('insert before: backfills a new Session 1 and renumbers the rest, entries travel', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')

  // Two sessions from the Chronicle header; the entry lands in the ACTIVE session (Session 2).
  // Wait for each create to land (the header combobox shows the new active session) — two blind
  // clicks race their fire-and-forget creates and can leave Session 1 active.
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click()
  await page.getByRole('button', { name: 'New session' }).click()
  await expect(page.getByRole('combobox').filter({ hasText: /Session 1/ })).toBeVisible()
  await page.getByRole('button', { name: 'New session' }).click()
  await expect(page.getByRole('combobox').filter({ hasText: /Session 2/ })).toBeVisible()
  await page.getByPlaceholder('A sentence or two').fill(ENTRY)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  // `.first()` — the hidden mounted Sessions view may mirror the entry; Chronicle's copy is first in DOM.
  await expect(page.getByText(ENTRY).first()).toBeVisible()

  // Sessions view auto-selects the newest — pick Session 1 (the backfill anchor) instead.
  await page.getByRole('button', { name: 'Sessions', exact: true }).click()
  await page.getByRole('button', { name: /Session 1/ }).click()
  await expect(page.getByRole('heading', { name: 'Session 1', exact: true })).toBeVisible()

  // Insert before it: confirm dialog → the renumber runs → the NEW empty Session 1 is selected.
  await page.getByRole('button', { name: 'Insert before' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Insert session' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // Rail now reads Session 3 / 2 / 1; the selected detail is the new empty Session 1.
  await expect(page.getByRole('button', { name: /Session 3/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Session 2/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Session 1', exact: true })).toBeVisible()
  await expect(page.getByText('No chronicle entries for this session.')).toBeVisible()

  // The entry travelled with its renumbered session: it now lives under Session 3. (`.last()` — the
  // hidden Chronicle view carries the same text earlier in the DOM; the Sessions copy is the visible one.)
  await page.getByRole('button', { name: /Session 3/ }).click()
  await expect(page.getByRole('heading', { name: 'Session 3', exact: true })).toBeVisible()
  await expect(page.getByText(ENTRY).last()).toBeVisible()
})
