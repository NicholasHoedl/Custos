import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, createCampaign, launchApp, plantKeyAndReload } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp({ fakeAi: true }))
})

test.afterEach(async () => {
  await app?.close()
  cleanup(userDataDir)
})

// Transcribe (ADR-036, relocated to the Sessions page by ADR-051) via the fake-AI seam: paste text → the
// Keeper proposes a changeset → apply, stamped at the selected session. Reuses the same import.extract path
// as Extract, so `fakeExtraction` already covers it — this proves the standalone dialog end to end.
test('Transcribe: pasting notes proposes a changeset that applies', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')
  await plantKeyAndReload(page)

  // Transcribe lives on the Sessions page now and targets the selected session — start one (from the
  // Chronicle header; the app lands on Home per ADR-061), then open it.
  await page.getByRole('button', { name: 'Chronicle', exact: true }).click()
  await page.getByRole('button', { name: 'New session' }).click()
  await page.getByRole('button', { name: 'Sessions', exact: true }).click()
  await page.getByRole('button', { name: 'Transcribe', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await dialog
    .getByPlaceholder('Paste session notes')
    .fill('The party met Aldric in the tavern and struck a deal.')
  await dialog.getByRole('button', { name: 'Transcribe', exact: true }).click()

  // The changeset review renders (fake extraction → one entity + one note).
  await expect(page.getByRole('heading', { name: 'Entities' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()

  // Done — the summary offers another pass.
  await expect(page.getByRole('button', { name: 'Transcribe more' })).toBeVisible()
})
