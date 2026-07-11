import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  // Opt IN to the forced tutorial (all other specs skip it); fakeAi lets the key-validate + close-out run
  // offline (ADR-043/044).
  ;({ app, page, userDataDir } = await launchApp({ tutorial: true, fakeAi: true }))
})

test.afterEach(async () => {
  await app?.close()
  cleanup(userDataDir)
})

// The forced first-run tutorial (ADR-044): a non-skippable guided wizard that must leave the user with a
// campaign, character, and session. Driven end to end under the fake-AI seam. Overlay interactions are
// scoped to its dialog (the live app renders behind it), except the real close-out (a separate dialog).
test('tutorial: forced, non-skippable, and finishes with a usable campaign', async () => {
  const wiz = page.getByRole('dialog', { name: 'First-run tutorial' })

  // The overlay is up on first launch, and there's no escape hatch.
  await expect(wiz).toBeVisible()
  await expect(wiz.getByText('Step 1 of 11')).toBeVisible()
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

  // 4 session (auto-created).
  await expect(wiz.getByText(/Ready when you are/)).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()

  // 5 chronicle: a real entry.
  await wiz.getByPlaceholder('The party met Aldric').fill('We reached the town of Phandalin.')
  await wiz.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(wiz.getByText('We reached the town of Phandalin.')).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()

  // 6 API key: hard-required + validated (fake reports valid).
  await wiz.getByLabel('Anthropic API key').fill('sk-ant-test')
  await wiz.getByRole('button', { name: /Verify/ }).click()

  // 7 close-out: the REAL locked wizard (its own dialog), driven to done (extraction faked).
  await wiz.getByRole('button', { name: 'Close out session' }).click()
  const closeout = page.getByRole('dialog', { name: /Close out Session 1/ })
  await expect(closeout).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entities' })).toBeVisible()
  await page.getByRole('button', { name: 'Approve & continue' }).click()
  await page.getByRole('button', { name: 'Finish without illuminating' }).click()
  await expect(page.getByText('Session closed out — here’s what was recorded.')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // 8–10 tool tour (headings — the blurbs repeat some words, e.g. "Your world library").
  await expect(wiz.getByRole('heading', { name: 'Capture the story' })).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()
  await expect(wiz.getByRole('heading', { name: 'Your world' })).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()
  await expect(wiz.getByRole('heading', { name: 'Ask the Keeper' })).toBeVisible()
  await wiz.getByRole('button', { name: 'Next' }).click()

  // 11 done → finish.
  await expect(wiz.getByText(/You're all set, Alex/)).toBeVisible()
  await wiz.getByRole('button', { name: 'Start writing' }).click()

  // The overlay is gone and the real app is usable, landed on the Chronicle with the campaign live.
  await expect(wiz).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chronicle' })).toBeVisible()
  // The extracted NPC from the close-out is in the Codex → the whole flow really wrote data.
  await page.getByRole('button', { name: 'Codex' }).click()
  await expect(page.getByText('Aldric Vane')).toBeVisible()
})
