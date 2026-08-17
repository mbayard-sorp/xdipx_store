# Visual snapshot harness (ticket #115 / design-elevation p2-snapshots + p3-axe)

Playwright full-page screenshot regression + axe accessibility sweep for the
storefront's stable surfaces (`/`, `/discover`, `/faq`, `/about`), mobile
(375px-class) and desktop, chromium only.

## Files

- `../../playwright.config.ts` — runner config (testMatch `*.visual.ts`, so
  vitest never picks these up).
- `helpers.ts` — age-gate seeding, motion freeze, scroll-to-settle (the Reveal
  primitive blanks below-the-fold captures otherwise), product-card masks.
- `storefront.visual.ts` — the snapshot specs. Baselines live in
  `__screenshots__/` (platform-free paths, committed).
- `axe.visual.ts` — axe sweep on the same prepared pages; only `serious` /
  `critical` violations fail (p3-axe's bar). Full violation lists attach to the
  report.
- `../../scripts/design-snapshots.ts` — baseline-free capture CLI for the
  design-critic (scores pixels, not diffs).

## Running

```bash
npx playwright install chromium                    # once per machine
npx playwright test                                # local dev server (auto-started)
VISUAL_BASE_URL=https://xdipx.com npx playwright test        # against a deployment
npx playwright test --update-snapshots             # accept an intended change
VISUAL_INCLUDE_PRODUCT_IMAGES=1 npx playwright test  # full-fidelity, no masks
```

## The live-content caveat (read before trusting a red run)

This is a live store: merchandising rotates daily and rail items reshuffle per
minute-bucket. Product-card regions are masked by default, but rotated COPY can
wrap to a different line count and change the page height, which fails as an
image-size mismatch no matter the diff tolerance.

So the reliable regression workflow is **re-baseline, then compare
immediately**:

```bash
VISUAL_BASE_URL=https://xdipx.com npx playwright test --update-snapshots  # current prod = baseline
VISUAL_BASE_URL=<pr-preview-url>  npx playwright test                     # what did the PR change?
```

A red run against week-old baselines usually means content moved, not that the
design broke; eyeball the diff in `test-results/` before treating it as a
regression, and re-baseline when the change was intended.
