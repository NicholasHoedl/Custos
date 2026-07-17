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

// The "Web" relationship-graph view (ROADMAP P2-3). Read-only + pure navigation (d3-force layout, no
// AI), so it runs in the keyless harness. Mirrors palette.spec's campaign+entity setup.
test('web: renders the relationship graph with a node per entity', async () => {
  // A campaign brings its mandatory main character (one entity → one node).
  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Phandalin')
  await page.getByLabel('Main character').fill('Vargas')
  await page.getByRole('button', { name: 'Create' }).click()

  // Add a second entity so the map has more than the lone MC.
  await page.getByRole('button', { name: 'Codex' }).click()
  await page.getByRole('button', { name: 'Add entity' }).click()
  await page.getByLabel('Name').fill('Sister Garaele')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Sister Garaele' })).toBeVisible()

  // Open Web from the sidebar. The header copy is unique to the view.
  await page.getByRole('button', { name: 'Web' }).click()
  await expect(page.getByRole('heading', { name: 'Web' })).toBeVisible()

  // The SVG canvas renders, with a node label per entity and the entity/tie counter.
  const svg = page.locator('svg.size-full')
  await expect(svg).toBeVisible()
  await expect(svg.locator('text', { hasText: 'Vargas' })).toBeVisible()
  await expect(svg.locator('text', { hasText: 'Sister Garaele' })).toBeVisible()
  await expect(page.getByText('2 entities · 0 ties')).toBeVisible()

  // The legibility controls (relationship-graph decluttering pass) are present.
  await expect(page.getByRole('button', { name: 'Hide minor' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hide rumored' })).toBeVisible()

  // Hide-minor prunes the isolated node (Sister Garaele has no ties) but never the main character; the
  // header reports the reduction. This exercises the effectiveGraph reduce path end-to-end.
  await page.getByRole('button', { name: 'Hide minor' }).click()
  await expect(svg.locator('text', { hasText: 'Sister Garaele' })).toHaveCount(0)
  await expect(svg.locator('text', { hasText: 'Vargas' })).toBeVisible()
  await expect(page.getByText('2 entities · 0 ties · 1 hidden')).toBeVisible()

  // Toggling it back restores the full cast + the plain counter.
  await page.getByRole('button', { name: 'Hide minor' }).click()
  await expect(svg.locator('text', { hasText: 'Sister Garaele' })).toBeVisible()
  await expect(page.getByText('2 entities · 0 ties', { exact: true })).toBeVisible()
})
