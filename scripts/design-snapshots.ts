/**
 * design-snapshots.ts — full-page storefront capture CLI (ticket #115 /
 * design-elevation p2-snapshots).
 *
 * The baseline-free sibling of the tests/visual/ regression harness: it
 * captures dated full-page screenshots of storefront routes for the
 * design-critic gate (Routine B step 4) and the post-publish spot-check
 * (Routine A), which score PIXELS, not diffs. Handles the two storefront
 * capture traps: the client-only age gate (localStorage is seeded before any
 * page script runs) and the below-the-fold Reveal blanking (the full height is
 * scrolled to trip every observer before capture).
 *
 * Usage:
 *   npx tsx scripts/design-snapshots.ts                              # localhost:3000, default routes
 *   npx tsx scripts/design-snapshots.ts --base https://xdipx.com     # against prod
 *   npx tsx scripts/design-snapshots.ts --routes /,/discover,/vault  # custom routes
 *   npx tsx scripts/design-snapshots.ts --out .design-snapshots/run1 # custom output dir
 *   npx tsx scripts/design-snapshots.ts --viewport mobile|desktop|both (default both)
 *
 * Output: <out>/<route-name>.<viewport>.png, printed one per line.
 * Requires the Playwright chromium binary (`npx playwright install chromium`).
 */

import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type BrowserContext } from '@playwright/test'

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}

const BASE = (flag('base') ?? process.env['VISUAL_BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '')
const ROUTES = (flag('routes') ?? '/,/discover,/faq,/about').split(',').map((r) => r.trim()).filter(Boolean)
const OUT = flag('out') ?? join('.design-snapshots', new Date().toISOString().slice(0, 10))
const VIEWPORT = flag('viewport') ?? 'both'

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1280, height: 800 },
}

function routeName(route: string): string {
  return route === '/' ? 'home' : route.replace(/^\//, '').replace(/\W+/g, '-')
}

async function preparedContext(width: number, height: number): Promise<BrowserContext> {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: 'reduce',
    colorScheme: 'light',
  })
  // Age gate: seed the exact storage shape use-age-verified.ts reads, before
  // any page script runs, so captures show the store rather than the gate.
  await context.addInitScript(() => {
    window.localStorage.setItem(
      'xdipx_age_verified',
      JSON.stringify({ verified: true, timestamp: Date.now(), version: '1.0' }),
    )
  })
  return context
}

async function capture(context: BrowserContext, route: string, file: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 })
    // Kill residual animation noise.
    await page.addStyleTag({
      content: '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
    })
    // Scroll the full height to trip every Reveal observer and lazy image,
    // then settle back at the top (see MEMORY: storefront screenshot capture).
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
    await page.screenshot({ path: file, fullPage: true })
    process.stdout.write(`${file}\n`)
  } finally {
    await page.close()
  }
}

async function main(): Promise<number> {
  const viewports = VIEWPORT === 'both' ? (['mobile', 'desktop'] as const) : [VIEWPORT]
  for (const vp of viewports) {
    if (!VIEWPORTS[vp]) {
      process.stderr.write(`ERROR: unknown viewport "${vp}" (mobile | desktop | both)\n`)
      return 2
    }
  }

  mkdirSync(OUT, { recursive: true })
  process.stderr.write(`capturing ${ROUTES.length} route(s) x ${viewports.length} viewport(s) from ${BASE} -> ${OUT}\n`)

  let failures = 0
  for (const vp of viewports) {
    const { width, height } = VIEWPORTS[vp]!
    const context = await preparedContext(width, height)
    try {
      for (const route of ROUTES) {
        const file = join(OUT, `${routeName(route)}.${vp}.png`)
        try {
          await capture(context, route, file)
        } catch (err) {
          failures++
          process.stderr.write(`ERROR ${route} (${vp}): ${(err as Error).message}\n`)
        }
      }
    } finally {
      await context.browser()?.close()
    }
  }

  process.stderr.write(failures === 0 ? 'done\n' : `done with ${failures} failure(s)\n`)
  return failures === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
