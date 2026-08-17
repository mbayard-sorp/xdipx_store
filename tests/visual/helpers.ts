/**
 * Shared page-preparation for the visual harness (ticket #115).
 *
 * Two storefront realities every capture has to handle:
 *
 *   1. The age gate is client-only localStorage (app/lib/use-age-verified.ts),
 *      so an unprepared page screenshots the AgeGatePanel, not the store.
 *      `verifyAge` seeds the exact storage shape the hook reads BEFORE any
 *      page script runs.
 *
 *   2. Below-the-fold sections sit behind the Reveal primitive
 *      (app/components/motion/Reveal.tsx). A naive full-page capture blanks
 *      everything below the fold (see MEMORY: storefront screenshot capture).
 *      `settlePage` scrolls the full height to trip every IntersectionObserver,
 *      then returns to the top; combined with `reducedMotion: 'reduce'` in the
 *      config, every section renders its final state.
 */

import type { Locator, Page } from '@playwright/test'

const AGE_STORAGE_KEY = 'xdipx_age_verified'

/** Seed the age-gate localStorage entry before any page script runs. */
export async function verifyAge(page: Page): Promise<void> {
  await page.addInitScript(
    ([key]) => {
      window.localStorage.setItem(
        key!,
        JSON.stringify({ verified: true, timestamp: Date.now(), version: '1.0' }),
      )
    },
    [AGE_STORAGE_KEY],
  )
}

/** Kill residual animation/transition noise the reduced-motion hint misses. */
export async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  })
}

/** Scroll the whole page (trips reveal observers + lazy images), then back to top. */
export async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight / 2
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, document.body.scrollHeight)
    await new Promise((r) => setTimeout(r, 250))
    window.scrollTo(0, 0)
  })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(300)
  // Snap the document height to a 32px grid: sub-pixel layout jitter otherwise
  // produces 1px full-page height differences between runs, and toHaveScreenshot
  // fails ANY size mismatch before the diff ratio is even consulted.
  await page.evaluate(() => {
    const h = document.documentElement.scrollHeight
    document.body.style.minHeight = `${Math.ceil(h / 32) * 32}px`
  })
}

/** Navigate + prepare a storefront route for a stable full-page capture. */
export async function openSettled(page: Page, path: string): Promise<void> {
  await verifyAge(page)
  await page.goto(path, { waitUntil: 'networkidle' })
  await freezeMotion(page)
  await settlePage(page)
}

/**
 * Product regions to mask on content-only runs: merchandising rotates daily
 * (and rail items reshuffle per minute-bucket via reshuffleRailsWithSeed), so
 * the pixels inside product cards are content, not design. Whole card anchors
 * are masked — not just the <img> — because the title/price text reshuffles
 * with the card and would otherwise flake every run. Set
 * VISUAL_INCLUDE_PRODUCT_IMAGES=1 for a full-fidelity (unmasked) run.
 */
export function productImageMasks(page: Page): Locator[] {
  if (process.env['VISUAL_INCLUDE_PRODUCT_IMAGES'] === '1') return []
  return [
    // Whole product-card regions (image + title + price rotate together).
    page.locator('a[href^="/products/"]'),
    // Any remaining Shopify CDN imagery (hero media outside a card anchor).
    page.locator('img[src*="cdn.shopify.com"]'),
    // Sanity-hosted editorial/mood imagery also rotates with the daily merch.
    page.locator('img[src*="cdn.sanity.io"]'),
  ]
}
