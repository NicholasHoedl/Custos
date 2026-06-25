import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({ args: [join(__dirname, '..', '..', 'out', 'main', 'index.js')] })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
})

test('launches with the Ledger window title', async () => {
  expect(await page.title()).toBe('Ledger')
})

test('renders the Ledger wordmark', async () => {
  await expect(page.getByText('Ledger').first()).toBeVisible()
})

test('typed IPC bridge round-trips: campaign.list() -> []', async () => {
  const campaigns = await page.evaluate(() =>
    // window.ledger is the preload bridge; cast so the node test config needn't pull in DOM/preload types.
    (
      globalThis as unknown as { ledger: { campaign: { list(): Promise<unknown[]> } } }
    ).ledger.campaign.list()
  )
  expect(campaigns).toEqual([])
})
