import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, launchApp } from './helpers'

// Extract + Illuminate on the Sessions page (ADR-051, replacing the old locked "Close out" wizard). Both
// run AI — tier-1 capture extraction and tier-2 enrichment — so they're driven through the env-gated
// fake-AI seam (ADR-041): launchApp({ fakeAi: true }) makes the main process return canned proposals while
// the REAL IPC, validators, and DB apply still run. A dummy key is planted (the tools gate on key
// presence) + the window reloaded. Fresh DB per test; assertions on STRUCTURAL strings only, never counts.

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

// Create a campaign (+ mandatory MC), plant a dummy key + reload (so keyReady refetches), start a session,
// and record one chronicle entry — the raw material Extract turns into entities + notes.
async function setupSessionWithEntry(campaign: string, mc: string): Promise<void> {
  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name', { exact: true }).fill(campaign)
  await page.getByLabel('Main character').fill(mc)
  await page.getByRole('button', { name: 'Create' }).click()

  await page.evaluate(() =>
    (
      window as unknown as { ledger: { apikey: { set(k: string): Promise<void> } } }
    ).ledger.apikey.set('sk-ant-test')
  )
  await page.reload()

  await page.getByRole('button', { name: 'New session' }).click()
  await page.getByPlaceholder('A sentence or two').fill('The party met a stranger and struck a deal.')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('The party met a stranger and struck a deal.')).toBeVisible()
}

// Extract / Illuminate / Transcribe live on the Sessions page now; it auto-selects the newest session.
async function openSessions(): Promise<void> {
  await page.getByRole('button', { name: 'Sessions', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Extract/ })).toBeVisible()
}

test('extract: a session log becomes entities + notes in the Codex', async () => {
  await setupSessionWithEntry('Phandalin', 'Vargas')
  await openSessions()

  await page.getByRole('button', { name: /^Extract/ }).click()
  await expect(page.getByRole('dialog', { name: /Extract Session 1/ })).toBeVisible()

  // The fake extraction proposes an entity + a note → the review renders.
  await expect(page.getByRole('heading', { name: 'Entities' })).toBeVisible()
  await page.getByRole('button', { name: 'Apply to Session 1' }).click()

  // Done summary → close. A plain, closeable dialog (no locked wizard), pointing at Illuminate next.
  await expect(page.getByText(/run Illuminate to fill in ties/)).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The applied changeset is real: the extracted NPC now exists in the Codex.
  await page.getByRole('button', { name: 'Codex' }).click()
  await expect(page.getByText('Aldric Vane')).toBeVisible()
})

test('extract: discarding the proposal applies nothing', async () => {
  await setupSessionWithEntry('Neverwinter', 'Kael')
  await openSessions()

  await page.getByRole('button', { name: /^Extract/ }).click()
  await expect(page.getByRole('dialog', { name: /Extract Session 1/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entities' })).toBeVisible()

  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Nothing was applied — the proposed NPC was never created.
  await page.getByRole('button', { name: 'Codex' }).click()
  await expect(page.getByText('Aldric Vane')).toHaveCount(0)
})

test('illuminate: enriches an extracted entity with a reviewed field change', async () => {
  await setupSessionWithEntry('Phandalin', 'Vargas')
  await openSessions()

  // Extract first, so the session has a touched entity to illuminate.
  await page.getByRole('button', { name: /^Extract/ }).click()
  await page.getByRole('button', { name: 'Apply to Session 1' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Illuminate — the checklist lists the touched entity (checked by default; no auto-chain from Extract).
  await page.getByRole('button', { name: 'Illuminate', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /Illuminate Session 1/ })).toBeVisible()
  await expect(page.getByRole('checkbox').first()).toBeVisible()
  await page.getByRole('button', { name: /^Illuminate \d+ (entity|entities)$/ }).click()

  // The fake enrichment proposes a field change → the review renders → apply → close.
  await expect(page.getByRole('heading', { name: 'Field changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Apply to Session 1' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
