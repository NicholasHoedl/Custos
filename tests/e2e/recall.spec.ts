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

// Recall / Lore (ADR-043) via the fake-AI seam: a streamed answer + a Sources list. The seam keeps the
// model-free FUZZY retrieval real (dense/embeddings are skipped), so the Sources are genuinely grounded —
// the query names a seeded entity and that entity surfaces.
test('Recall: a query streams an answer and lists real fuzzy-grounded sources', async () => {
  await createCampaign(page, 'Phandalin', 'Vargas')

  // Seed an entity with a description so fuzzy retrieval has a chunk to return.
  await page.getByRole('button', { name: 'Codex' }).click()
  await page.getByRole('button', { name: 'Add entity' }).click()
  await page.getByLabel('Name').fill('Aldric Vane')
  await page
    .getByLabel('Description')
    .fill('A wary tavern-keeper who trades in favors and secrets.')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Aldric Vane' })).toBeVisible()

  await plantKeyAndReload(page)

  // exact — the Home dashboard's "Ask Lore" button (visible right after the reload) also substring-matches.
  await page.getByRole('button', { name: 'Lore', exact: true }).click()
  await page.getByPlaceholder('Who is Glastav').fill('Who is Aldric Vane, and can we trust him?')
  await page.getByRole('button', { name: 'Ask' }).click()

  // The canned answer streams in, and a Sources list renders — it only appears when retrieval returned
  // chunks, so its presence proves the real fuzzy grounding worked (the named entity was matched).
  await expect(page.getByText('From what the party has recorded')).toBeVisible()
  await expect(page.getByText('Sources').first()).toBeVisible()

  // Follow-up loop (overhaul): a second question continues the SAME thread — the transcript keeps the
  // first answer and adds a second (the submit button now reads "Follow up").
  await page.getByPlaceholder('Ask a follow-up').fill('And who does he owe?')
  await page.getByRole('button', { name: 'Follow up' }).click()
  await expect(page.getByText('From what the party has recorded')).toHaveCount(2)
})
