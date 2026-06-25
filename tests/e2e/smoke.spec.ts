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
