/**
 * Visual regression snapshots for the storefront's stable surfaces
 * (ticket #115 / design-elevation p2-snapshots).
 *
 * Product-image regions are masked by default (content-only runs): daily
 * merchandising rotates products, and the harness exists to catch DESIGN
 * regressions — layout, spacing, palette, typography — not content rotation.
 * Copy still changes with merchandising, so expect intentional diffs after a
 * merch run on '/' and re-baseline with --update-snapshots when the change was
 * deliberate.
 *
 *   npx playwright test                       # against local dev (auto-starts)
 *   VISUAL_BASE_URL=… npx playwright test     # against a deployment
 *   npx playwright test --update-snapshots    # accept an intended change
 */

import { expect, test } from '@playwright/test'
import { openSettled, productImageMasks } from './helpers'

const ROUTES: Array<{ path: string; name: string }> = [
  { path: '/', name: 'home' },
  { path: '/discover', name: 'discover' },
  { path: '/faq', name: 'faq' },
  { path: '/about', name: 'about' },
]

for (const { path, name } of ROUTES) {
  test(`${name} full-page snapshot`, async ({ page }) => {
    await openSettled(page, path)
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      mask: productImageMasks(page),
      maskColor: '#F4F3F1', // paper-3, so masks read as quiet surfaces not black holes
    })
  })
}
