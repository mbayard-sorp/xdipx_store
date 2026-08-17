/**
 * Playwright config for the visual snapshot harness (tests/visual/, ticket
 * #115 / design-elevation p2-snapshots + p3-axe).
 *
 * Scope: ONLY tests/visual/*.visual.ts. Unit tests stay on vitest (`npm test`);
 * the `.visual.ts` suffix keeps these files out of vitest's default
 * `*.{test,spec}.*` glob so the two runners never collide.
 *
 * Run:
 *   npx playwright test                                  # against local dev (auto-started)
 *   VISUAL_BASE_URL=https://xdipx.com npx playwright test  # against a deployed target
 *   npx playwright test --update-snapshots               # re-baseline after an intended change
 *
 * Baselines are committed under tests/visual/__screenshots__/ with a
 * platform-free path template so a re-baseline on another OS overwrites the
 * same files rather than forking per-platform copies.
 */

import { defineConfig, devices } from '@playwright/test'

const external = process.env['VISUAL_BASE_URL']

export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '**/*.visual.ts',
  // Storefront pages share caches/KV warms; serial keeps captures deterministic.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    toHaveScreenshot: {
      // Content-bearing pages on a live store are never pixel-exact (fonts,
      // AVIF decode, sub-pixel AA, copy that wraps differently after a merch
      // rotation). 5% catches real layout/palette regressions while surviving
      // rendering noise. NOTE: live content can also change the page HEIGHT,
      // which fails as a size mismatch regardless of ratio — the intended
      // workflow is re-baseline against the current main/production state,
      // then compare the PR preview immediately (see tests/visual/README.md).
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{projectName}/{arg}{ext}',
  use: {
    baseURL: external ?? 'http://localhost:3000',
    colorScheme: 'light',
    // reducedMotion is a context option (not a first-class test option), so the
    // Reveal primitive renders final states instead of entrance animations.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    // Mobile-first per the project guide: 375px is the primary surface.
    // browserName pins chromium: the iPhone preset defaults to webkit, which
    // is not installed everywhere and would fork the committed baselines.
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 180_000,
        },
      }),
})
