import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cleanup, launchApp } from './helpers'

// The "Close out session" wizard (ROADMAP P2-6) — the most complex UI in the app, and until now the only
// one with no e2e. It runs two AI calls (tier-1 extraction, tier-2 enrichment), so it's driven here
// through the env-gated fake-AI seam (ADR-041): `launchApp({ fakeAi: true })` sets LEDGER_FAKE_AI, and the
// main process returns canned proposals — the REAL IPC, validators, and DB apply still run. A dummy key is
// planted (the wizard gates on key presence, not validity) and the window reloaded so `keyReady` refetches.
// Each test gets its own app + fresh DB. Assertions are on STRUCTURAL strings only — never model counts.

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

// Create a campaign (+ mandatory main character), plant a dummy key + reload so the wizard's key gate
// passes, then start a session and record one chronicle entry to close out.
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
  // Two composers contain "What happened?" (the chronicle entry + the Transcribe dialog textarea) — the
  // "A sentence or two" tail is unique to the chronicle entry composer.
  await page.getByPlaceholder('A sentence or two').fill('The party met a stranger and struck a deal.')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('The party met a stranger and struck a deal.')).toBeVisible()
}

test('close-out: full happy path through both tiers to the done summary', async () => {
  await setupSessionWithEntry('Phandalin', 'Vargas')

  // Open the locked wizard.
  await page.getByRole('button', { name: /Close out session/ }).click()
  await expect(page.getByRole('dialog', { name: /Close out Session 1/ })).toBeVisible()

  // Tier 1 — the fake extraction proposes an entity + a note, so the review renders.
  await expect(page.getByRole('heading', { name: 'Entities' })).toBeVisible()
  await page.getByRole('button', { name: 'Approve & continue' }).click()

  // Tier 2 — the Illuminate checklist lists the touched entity (unchecked, since it was just created).
  const checkbox = page.getByRole('checkbox')
  await expect(checkbox).toBeVisible()
  await checkbox.check()
  await page.getByRole('button', { name: /^Illuminate \d+ (entity|entities)$/ }).click()

  // The fake enrichment proposes a field change → the tier-2 review renders.
  await expect(page.getByRole('heading', { name: 'Field changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Approve & finish' }).click()

  // Done — the summary, then a free exit (the only non-reject way out of the locked dialog).
  await expect(page.getByText('Session closed out — here’s what was recorded.')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The applied changeset is real: the extracted NPC now exists in the Codex.
  await page.getByRole('button', { name: 'Codex' }).click()
  await expect(page.getByText('Aldric Vane')).toBeVisible()
})

test('close-out: rejecting the tier-1 proposal discards it and exits the lock', async () => {
  await setupSessionWithEntry('Neverwinter', 'Kael')

  await page.getByRole('button', { name: /Close out session/ }).click()
  await expect(page.getByRole('dialog', { name: /Close out Session 1/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entities' })).toBeVisible()

  // Reject → the confirm step (the locked dialog's guarded exit) → exit.
  await page.getByRole('button', { name: 'Reject & close' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByText('Discard the Chronicle proposals?')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reject & exit' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Nothing was applied — the proposed NPC was never created.
  await page.getByRole('button', { name: 'Codex' }).click()
  await expect(page.getByText('Aldric Vane')).toHaveCount(0)
})
