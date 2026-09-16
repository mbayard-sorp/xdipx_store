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
 *   npx tsx scripts/design-snapshots.ts --viewport mobile|tablet|desktop|wide (comma list ok)
 *   npx tsx scripts/design-snapshots.ts --viewport both      # mobile+desktop (default)
 *   npx tsx scripts/design-snapshots.ts --viewport doctrine  # 375/768/1440, the design-critic set
 *
 * Output: <out>/<route-name>.<viewport>.png, printed one per line.
 * Requires the Playwright chromium binary (`npx playwright install chromium`).
 *
 * CLOUD-ROUTINE TRANSPORT (ticket #8421). The mandatory design-critic gate runs
 * from a scheduled cloud routine, and that sandbox breaks this CLI two ways that
 * have nothing to do with the page under capture:
 *
 *   1. The image pre-installs one chromium build under PLAYWRIGHT_BROWSERS_PATH
 *      and forbids `playwright install`, so whenever the pinned @playwright/test
 *      wants a different build number, launch() dies with "Executable doesn't
 *      exist". `--executable-path` (auto-detected from PLAYWRIGHT_BROWSERS_PATH)
 *      points at the binary that is actually there.
 *   2. Egress goes through an HTTPS proxy whose CA chromium does not trust, so
 *      page.goto() fails at the TLS handshake (net::ERR_CERT_AUTHORITY_INVALID;
 *      it has also presented as ERR_CONNECTION_RESET). Node's fetch DOES trust
 *      it. `--via-fetch` therefore serves every request from Node instead of
 *      from chromium's own stack, leaving the renderer untouched.
 *
 * Both accommodations auto-enable only when their symptom is present, so local
 * and CI runs behave exactly as before. Force either way with
 * `--via-fetch` / `--no-via-fetch` and `--executable-path <path>`.
 */

import 'dotenv/config'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Route } from '@playwright/test'

// Node >= 20 only honours HTTPS_PROXY in the global fetch dispatcher when this
// is set, and it is read when that dispatcher is first built. Set it before any
// fetch in this process so --via-fetch can reach the origin through the proxy.
process.env['NODE_USE_ENV_PROXY'] ??= '1'

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}
function boolFlag(name: string): boolean {
  return argv.includes(`--${name}`)
}

/**
 * Hop-by-hop and body-framing headers. Re-sending these on a fulfilled response
 * describes a body that no longer exists: Node's fetch has already decompressed
 * the payload, so the original content-encoding/content-length would make
 * chromium try to gunzip plain bytes and render nothing.
 */
const DROPPED_RESPONSE_HEADERS =
  /^(content-encoding|content-length|transfer-encoding|connection|keep-alive|upgrade)$/i

export function sanitizeResponseHeaders(headers: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of headers) {
    if (!DROPPED_RESPONSE_HEADERS.test(k)) out[k] = v
  }
  return out
}

/**
 * True when chromium's own network stack cannot be trusted to reach `base`:
 * an HTTPS proxy is in the environment AND the target is not loopback (a local
 * dev server is reached directly and needs no interception).
 */
export function shouldUseFetchTransport(
  base: string,
  env: NodeJS.ProcessEnv,
  opts: { force?: boolean; disable?: boolean } = {},
): boolean {
  if (opts.disable) return false
  if (opts.force) return true
  const proxied = Boolean(env['HTTPS_PROXY'] ?? env['https_proxy'] ?? env['ALL_PROXY'] ?? env['all_proxy'])
  if (!proxied) return false
  let host: string
  try {
    host = new URL(base).hostname
  } catch {
    return false
  }
  return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0')
}

/**
 * The chromium binary to launch, or undefined to let Playwright resolve its own.
 * Explicit flag/env wins; otherwise fall back to the binary the sandbox image
 * pre-installed, which is only correct to use when Playwright's own resolution
 * would fail (the caller decides that by passing `bundledMissing`).
 */
export function resolveExecutablePath(
  env: NodeJS.ProcessEnv,
  opts: { explicit?: string; bundledMissing?: boolean; exists?: (p: string) => boolean } = {},
): string | undefined {
  const exists = opts.exists ?? existsSync
  const explicit = opts.explicit ?? env['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
  if (explicit) return explicit
  if (!opts.bundledMissing) return undefined
  const root = env['PLAYWRIGHT_BROWSERS_PATH']
  if (!root || root === '0') return undefined
  const candidate = join(root, 'chromium')
  return exists(candidate) ? candidate : undefined
}

const BASE = (flag('base') ?? process.env['VISUAL_BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '')
const ROUTES = (flag('routes') ?? '/,/discover,/faq,/about').split(',').map((r) => r.trim()).filter(Boolean)
const OUT = flag('out') ?? join('.design-snapshots', new Date().toISOString().slice(0, 10))
const VIEWPORT = flag('viewport') ?? 'both'
const VIA_FETCH = shouldUseFetchTransport(BASE, process.env, {
  force: boolFlag('via-fetch'),
  disable: boolFlag('no-via-fetch'),
})

// `mobile`/`desktop` keep their original sizes so existing callers are
// unchanged; `tablet`/`wide` were added because the design-critic gate scores
// 375/768/1440 and the first two were the only sizes this CLI could produce.
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
  wide: { width: 1440, height: 900 },
}

/** `both` is the historical mobile+desktop pair; anything else is a comma list. */
export function parseViewports(spec: string): string[] {
  if (spec === 'both') return ['mobile', 'desktop']
  if (spec === 'doctrine') return ['mobile', 'tablet', 'wide']
  return spec.split(',').map((v) => v.trim()).filter(Boolean)
}

function routeName(route: string): string {
  return route === '/' ? 'home' : route.replace(/^\//, '').replace(/\W+/g, '-')
}

/**
 * Serve one chromium request from Node's fetch instead of chromium's own
 * network stack. Failures abort the single request rather than the capture:
 * a third-party analytics beacon that will not load must not blank the page.
 */
async function fulfilFromNodeFetch(route: Route): Promise<void> {
  const request = route.request()
  try {
    const response = await fetch(request.url(), {
      method: request.method(),
      headers: request.headers(),
      body: request.postDataBuffer() ?? undefined,
      redirect: 'follow',
    })
    await route.fulfill({
      status: response.status,
      headers: sanitizeResponseHeaders(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  } catch (err) {
    process.stderr.write(`  via-fetch abort ${request.url()}: ${(err as Error).message}\n`)
    await route.abort().catch(() => {})
  }
}

async function launchBrowser() {
  const explicit = resolveExecutablePath(process.env, { explicit: flag('executable-path') })
  if (explicit) {
    process.stderr.write(`chromium: ${explicit} (explicit)\n`)
    return chromium.launch({ executablePath: explicit })
  }
  try {
    return await chromium.launch()
  } catch (err) {
    // Playwright resolved a browser build the sandbox image does not carry, and
    // `playwright install` is unavailable there. Retry against what IS present.
    const fallback = resolveExecutablePath(process.env, { bundledMissing: true })
    if (!fallback) throw err
    process.stderr.write(
      `chromium: bundled build unavailable (${(err as Error).message.split('\n')[0]}); falling back to ${fallback}\n`,
    )
    return chromium.launch({ executablePath: fallback })
  }
}

async function preparedContext(width: number, height: number): Promise<BrowserContext> {
  const browser = await launchBrowser()
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
  if (VIA_FETCH) await context.route('**/*', fulfilFromNodeFetch)
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
  const viewports = parseViewports(VIEWPORT)
  const known = Object.keys(VIEWPORTS).join(' | ')
  if (viewports.length === 0) {
    process.stderr.write(`ERROR: no viewport selected (${known} | both | doctrine)\n`)
    return 2
  }
  for (const vp of viewports) {
    if (!VIEWPORTS[vp]) {
      process.stderr.write(`ERROR: unknown viewport "${vp}" (${known} | both | doctrine)\n`)
      return 2
    }
  }

  mkdirSync(OUT, { recursive: true })
  process.stderr.write(`capturing ${ROUTES.length} route(s) x ${viewports.length} viewport(s) from ${BASE} -> ${OUT}\n`)
  process.stderr.write(`transport: ${VIA_FETCH ? 'node fetch (via-fetch)' : 'chromium direct'}\n`)

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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`ERROR: ${(err as Error).message}\n`)
      process.exit(2)
    },
  )
}
