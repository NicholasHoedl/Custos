import { test, expect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { cleanup, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  // Opt IN to the forced tutorial (all other specs skip it); fakeAi lets the key-validate run offline
  // (ADR-043/060).
  ;({ app, page, userDataDir } = await launchApp({ tutorial: true, fakeAi: true }))
})

test.afterEach(async () => {
  await app?.close()
  cleanup(userDataDir)
})

// Drive the welcome page + steps 1–16 (up to arriving at the apikey ACTION step, step 17). Returns the
// shared coach-mark locator sitting on the apikey step, from which the two tests diverge (fill-key vs
// Skip-for-now). Shared so the happy path and the skip path exercise the same 16-step walkthrough once.
async function driveToApiKey(page: Page): Promise<Locator> {
  // Step 0 — the welcome page: non-skippable, name required.
  const welcome = page.getByRole('dialog', { name: 'First-run tutorial' })
  await expect(welcome).toBeVisible()
  await expect(welcome.getByRole('button', { name: /skip/i })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(welcome).toBeVisible() // Esc does nothing
  await welcome.getByLabel('Your name').fill('Alex')
  await welcome.getByRole('button', { name: 'Begin' }).click()

  // Every tour surface (popover coach mark, over-nav card, review card) carries aria-label "Tutorial".
  const coach = page.getByRole('dialog', { name: 'Tutorial', exact: true })

  // 1 campaign (ACTION): the REAL sidebar + button, the REAL dialog (campaign + MC atomically).
  await expect(coach.getByText('Step 1 of 19')).toBeVisible()
  await page.getByRole('button', { name: 'New campaign' }).click()
  const dlg = page.getByRole('dialog', { name: 'New campaign' })
  await dlg.getByLabel('Name', { exact: true }).fill('Phandalin')
  await dlg.getByLabel('Main character').fill('Vargas')
  await dlg.getByRole('button', { name: 'Create' }).click()

  // 2 Character page (PAGE — content undimmed, card over the navbar).
  await expect(coach.getByRole('heading', { name: 'The Character page' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 3 Chronicle page (PAGE).
  await expect(coach.getByRole('heading', { name: 'The Chronicle' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 4 session (ACTION): the real Chronicle-header control.
  await expect(coach.getByText('Step 4 of 19')).toBeVisible()
  await page.getByRole('button', { name: 'New session' }).click()

  // 5 the composer (INFO).
  await expect(coach.getByRole('heading', { name: 'Writing chronicle entries' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 6 Sessions page (PAGE — the newest session auto-selects, so the tools render).
  await expect(coach.getByRole('heading', { name: 'The Sessions page' })).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 7–10 the four session tools, individually (INFO each).
  for (const title of ['Extract', 'Illuminate', 'Transcribe', 'Generate recap']) {
    await expect(coach.getByRole('heading', { name: title })).toBeVisible()
    await coach.getByRole('button', { name: 'Next' }).click()
  }

  // 11–15 the tool pages (PAGE each).
  for (const title of ['The Codex', 'The Web', 'Lore', 'Counsel', 'Converse']) {
    await expect(coach.getByRole('heading', { name: title })).toBeVisible()
    await coach.getByRole('button', { name: 'Next' }).click()
  }

  // 16 Continuity (PAGE) — carries the segue into the API-key step.
  await expect(coach.getByRole('heading', { name: 'Continuity' })).toBeVisible()
  await expect(coach.getByText(/set yours up next/)).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 17 apikey (ACTION): the REAL Settings key card.
  await expect(coach.getByText('Step 17 of 19')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Anthropic API key', exact: true })).toBeVisible()
  return coach
}

// Steps 18–19 + Finish, common to both paths: the tour closes on Home (ADR-061).
async function finishTour(page: Page, coach: Locator): Promise<void> {
  // 18 Settings page (PAGE, view-only + scrollable) — mentions Report a bug's new home.
  await expect(coach.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(coach.getByText(/Report a bug/)).toBeVisible()
  await coach.getByRole('button', { name: 'Next' }).click()

  // 19 the review card (REVIEW): loop recap + tool purposes + Quickstart pointer → Finish.
  await expect(coach.getByRole('heading', { name: /all set/ })).toBeVisible()
  await expect(coach.getByRole('heading', { name: 'The loop' })).toBeVisible()
  await expect(coach.getByText(/Quickstart guide/)).toBeVisible()
  await coach.getByRole('button', { name: 'Finish' }).click()

  await expect(coach).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Playing as Vargas/ })).toBeVisible()
}

// The forced first-run tutorial, per-page edition (ADR-060): one welcome page (name), then 19 stops
// through the REAL app — ACTION steps use the real dialogs/controls, PAGE steps show whole pages
// undimmed with the coach card over the navbar, and the tour closes on a front-and-center review card.
test('tutorial: welcome page then a per-page spotlight walkthrough (key entered)', async () => {
  const coach = await driveToApiKey(page)

  // The key step accepts a valid key (fake validate reports valid) and auto-advances.
  await page.getByPlaceholder('sk-ant-…').fill('sk-ant-test')
  await page.getByRole('button', { name: 'Save & validate' }).click()

  await finishTour(page, coach)

  // The app is usable — everything was created through the REAL UI.
  await expect(page.getByRole('button', { name: 'Chronicle', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Guide' }).click()
  await expect(page.getByRole('dialog', { name: 'Quickstart guide' })).toBeVisible()
})

// The API key is OPTIONAL (ADR-063): "Skip for now" advances the tour keyless, and Home's needs-attention
// strip then carries the reminder (plus the "fill in your character" item, since no persona was generated).
test('tutorial: the API-key step can be skipped, and Home then nags for it', async () => {
  const coach = await driveToApiKey(page)

  // Skip instead of entering a key — the tour advances with no key saved.
  await coach.getByRole('button', { name: 'Skip for now' }).click()

  await finishTour(page, coach)

  // keyReady stays honest (only modelReady is faked), so the Home strip shows the key reminder — and the
  // "fill in your character" item, because the tour created the MC without generating a persona.
  await expect(page.getByText('Add your Anthropic API key')).toBeVisible()
  await expect(page.getByText('Fill in your character')).toBeVisible()
})
