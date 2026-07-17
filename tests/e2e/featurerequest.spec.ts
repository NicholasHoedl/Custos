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

// The feature requester lives beside the bug reporter in the Settings "Feedback" section (ADR-064). The
// email hand-off isn't exercised — submit would POST to the live worker / open a mail client — so this
// guards the wiring: Settings → dialog → the two-field validation gate.
test('request-a-feature: the Feedback section opens the dialog gated on problem + proposed feature', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Request a feature' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Your name')).toBeVisible()
  await expect(page.getByLabel('What problem are you facing?')).toBeVisible()
  await expect(page.getByLabel('What would you like to see?')).toBeVisible()

  // Submit needs BOTH the problem and the proposed feature. Label depends on whether the worker URL is
  // baked in (ADR-058): "Send request" vs "Open email draft". The spec never clicks it (no live POST).
  const submit = page.getByRole('button', { name: /Send request|Open email draft/ })
  await expect(submit).toBeDisabled()
  await page.getByLabel('What problem are you facing?').fill('Notes are hard to find')
  await expect(submit).toBeDisabled() // still — only one field filled
  await page.getByLabel('What would you like to see?').fill('Add full-text search')
  await expect(submit).toBeEnabled()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
