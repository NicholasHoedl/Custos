import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  // Opt IN to the forced tutorial (all other specs skip it); fakeAi lets the key-validate run offline
  // (ADR-043/044).
  ;({ app, page, userDataDir } = await launchApp({ tutorial: true, fakeAi: true }))
})

test.afterEach(async () => {
  await app?.close()
  cleanup(userDataDir)
})

// The forced first-run tutorial (ADR-044, trimmed by ADR-045): a non-skippable guided wizard that must
// leave the user with a campaign, main character, and an empty first session. Driven end to end under the
// fake-AI seam (only the API-key validate needs it now). Overlay interactions are scoped to its dialog
// (the live app renders behind it).
test('tutorial: forced, non-skippable, and finishes with a usable campaign', async () => {
  const wiz = page.getByRole('dialog', { name: 'First-run tutorial' })

  // The overlay is up on first launch, and there's no escape hatch.
  await expect(wiz).toBeVisible()
  await expect(wiz.getByText('Step 1 of 9')).toBeVisible()
  await expect(wiz.getByRole('button', { name: /skip/i })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(wiz).toBeVisible() // Esc does nothing

  // 1 name → 2 campaign → 3 main character (creates the campaign + MC).
  await wiz.getByLabel('Your name').fill('Alex')
  await wiz.getByRole('button', { name: 'Next' }).click()
  await wiz.getByLabel('Campaign name').fill('Phandalin')
  await wiz.getByRole('button', { name: 'Next' }).click()
  await wiz.getByLabel(/Main character/).fill('Vargas')
  await wiz.getByRole('button', { name: 'Create campaign' }).click()

  // 4 session (auto-created — leaves an empty Session 1 to write into).
  await expect(wiz.getByText(/Ready when you are/)).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()

  // 5 API key: hard-required + validated (fake reports valid). The step also teaches how to get a key.
  await expect(wiz.getByText(/No key yet/)).toBeVisible()
  await wiz.getByLabel('Anthropic API key').fill('sk-ant-test')
  await wiz.getByRole('button', { name: /Verify/ }).click()

  // 6–8 tool tour (headings — the blurbs repeat some words, e.g. "Your world library").
  await expect(wiz.getByRole('heading', { name: 'Capture the story' })).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()
  await expect(wiz.getByRole('heading', { name: 'Your world' })).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()
  await expect(wiz.getByRole('heading', { name: 'Ask the Keeper' })).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()

  // 9 done → finish.
  await expect(wiz.getByText(/You're all set, Alex/)).toBeVisible()
  await wiz.getByRole('button', { name: 'Start writing' }).click()

  // The overlay is gone and the real app is usable: landed on the Chronicle with the campaign + MC live.
  // No close-out ran, so there's no extracted data — the surviving setup (locked MC + Session 1) is the proof.
  await expect(wiz).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chronicle' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Playing as Vargas/ })).toBeVisible()

  // The Quickstart guide — the loop teaching the trimmed tutorial no longer runs — opens from the sidebar.
  await page.getByRole('button', { name: 'Guide' }).click()
  const guide = page.getByRole('dialog', { name: 'Quickstart guide' })
  await expect(guide).toBeVisible()
  await expect(guide.getByRole('heading', { name: 'The loop' })).toBeVisible()
  await expect(guide.getByRole('heading', { name: 'Capture the story' })).toBeVisible()
})
