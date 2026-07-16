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

// The bug reporter lives on the Settings page (ADR-060; the old sidebar launcher and its window snap
// are gone). The email hand-off itself isn't exercised — submit would POST to the live worker / open a
// mail client — so this guards the wiring: Settings section → dialog → the validation gate.
test('report-a-bug: the Settings section opens the dialog with name/description/screenshots', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Report a bug' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Your name')).toBeVisible()
  // exact: the auto-send description paragraph also contains the word "screenshots" (substring match
  // would be ambiguous); the form label is the only element whose exact text is "Screenshots".
  await expect(page.getByText('Screenshots', { exact: true })).toBeVisible()

  // Submit is gated on a description. (The auto-snap is best-effort, so no assertion on it.)
  // The label depends on whether the intake worker URL is baked in (ADR-058): live builds say
  // "Send report", endpoint-less builds say "Open email draft" — accept either. The spec never
  // clicks it, so no live POST fires from e2e.
  const submit = page.getByRole('button', { name: /Send report|Open email draft/ })
  await expect(submit).toBeDisabled()
  await page.getByLabel('What went wrong?').fill('The graph exploded')
  await expect(submit).toBeEnabled()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
