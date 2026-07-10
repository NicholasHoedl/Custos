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

// Draft-from-backstory (ADR-029/030/043) via the fake-AI seam: the main character's two-step derive —
// step 1 profile fields (fakeDerive), step 2 world entities/notes (the existing fakeExtraction in 'full'
// mode). Persona regeneration on apply is also faked, so the whole flow runs offline/keyless.
test('Draft from backstory: the two-step derive applies profile then world', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')
  await plantKeyAndReload(page)

  // The main character lives on the Character page; a saved backstory enables the derive.
  await page.getByRole('button', { name: 'Character' }).click()
  const backstory = page.getByPlaceholder('Where they come from')
  await backstory.fill('Vargas grew up in the dockside slums and swore to find who burned them down.')
  await backstory.blur() // InlineText saves on blur → "Draft from backstory" enables

  // `exact` skips the adjacent "About Draft from backstory" info-popover trigger; the button enables once
  // the blur-save of the backstory lands (Playwright auto-waits for it to become clickable).
  await page.getByRole('button', { name: 'Draft from backstory', exact: true }).click()

  // Step 1 — profile fields → apply.
  await page.getByRole('button', { name: 'Apply & continue' }).click()

  // Step 2 — world entities/notes → add to the campaign.
  await page.getByRole('button', { name: 'Add to campaign' }).click()

  // Done.
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
})
