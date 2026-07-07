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

// A fresh e2e instance has no campaign, so the real SuggestView renders its own empty state. This
// confirms the Phase-3 placeholder is replaced and the view is wired into the sidebar nav. The live
// 4-card path requires a real API key + network and is covered by the manual harness, not e2e.
test('Counsel nav opens the real Counsel view', async () => {
  await page.getByRole('button', { name: 'Counsel' }).click()
  await expect(page.getByText('Choose a saga in the sidebar to seek counsel.')).toBeVisible()
})
