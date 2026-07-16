import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  // Opt IN to the forced tutorial (all other specs skip it); fakeAi lets the key-validate run offline
  // (ADR-043/059).
  ;({ app, page, userDataDir } = await launchApp({ tutorial: true, fakeAi: true }))
})

test.afterEach(async () => {
  await app?.close()
  cleanup(userDataDir)
})

// The forced first-run tutorial, spotlight edition (ADR-059): one full-screen welcome page (name), then
// a scrim-and-coach-mark tour through the REAL app — the campaign is created via the real dialog, the
// session via the real Chronicle-header button, the key via the real Settings card (fake validate says
// valid). Action steps auto-advance on state; info steps advance via Next; nothing is skippable.
test('tutorial: welcome page then a forced spotlight tour through the real app', async () => {
  // Step 0 — the welcome page: non-skippable, name required.
  const welcome = page.getByRole('dialog', { name: 'First-run tutorial' })
  await expect(welcome).toBeVisible()
  await expect(welcome.getByRole('button', { name: /skip/i })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(welcome).toBeVisible() // Esc does nothing
  await welcome.getByLabel('Your name').fill('Alex')
  await welcome.getByRole('button', { name: 'Begin' }).click()

  // The coach mark is a portalled popover with an accessible name (exact — 'Tutorial' is a substring
  // of the welcome card's 'First-run tutorial').
  const coach = page.getByRole('dialog', { name: 'Tutorial', exact: true })

  // 1 campaign (ACTION): the REAL sidebar + button, the REAL dialog (campaign + MC atomically, ADR-029).
  await expect(coach.getByText('Step 1 of 9')).toBeVisible()
  await page.getByRole('button', { name: 'New campaign' }).click()
  const dlg = page.getByRole('dialog', { name: 'New campaign' })
  await dlg.getByLabel('Name', { exact: true }).fill('Phandalin')
  await dlg.getByLabel('Main character').fill('Vargas')
  await dlg.getByRole('button', { name: 'Create' }).click()

  // 2 character (INFO) — the detector auto-advanced on the campaign appearing.
  await expect(coach.getByText('Step 2 of 9')).toBeVisible()
  await expect(coach.getByRole('heading', { name: 'Meet the Character page' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 3 session (ACTION): the real Chronicle-header control.
  await expect(coach.getByText('Step 3 of 9')).toBeVisible()
  await page.getByRole('button', { name: 'New session' }).click()

  // 4 apikey (ACTION): Settings is brought forward; the REAL key card (fake validate reports valid).
  await expect(coach.getByText('Step 4 of 9')).toBeVisible()
  // exact — the coach mark's own heading is "Add your Anthropic API key" (substring collision)
  await expect(page.getByRole('heading', { name: 'Anthropic API key', exact: true })).toBeVisible()
  await page.getByPlaceholder('sk-ant-…').fill('sk-ant-test')
  await page.getByRole('button', { name: 'Save & validate' }).click()

  // 5–7 the three nav-group INFO steps; the ask group now includes Continuity (guide-content fix).
  await expect(coach.getByRole('heading', { name: 'Capture the story' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()
  await expect(coach.getByRole('heading', { name: 'Your world' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()
  await expect(coach.getByRole('heading', { name: 'Ask the Keeper' })).toBeVisible()
  await expect(coach.getByText('Continuity', { exact: true })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 8 bug report, 9 guide → Finish.
  await expect(coach.getByText('Step 8 of 9')).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()
  await expect(coach.getByText('Step 9 of 9')).toBeVisible()
  await coach.getByRole('button', { name: 'Finish' }).click()

  // The tour is gone and the app is usable — everything was created through the REAL UI.
  await expect(coach).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chronicle', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Playing as Vargas/ })).toBeVisible()

  // The Quickstart guide the tour pointed at still opens from the sidebar.
  await page.getByRole('button', { name: 'Guide' }).click()
  const guide = page.getByRole('dialog', { name: 'Quickstart guide' })
  await expect(guide).toBeVisible()
  await expect(guide.getByRole('heading', { name: 'The loop' })).toBeVisible()
})
