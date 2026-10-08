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
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, type BrowserContext, type Route } from '@playwright/test'

const execFileAsync = promisify(execFile)

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
    if (DROPPED_RESPONSE_HEADERS.test(k)) continue
    // A repeated header (set-cookie, link) used to come through the old
    // Headers-object iteration already merged; assigning straight into the
    // record here instead kept only the last value (#14119).
    out[k] = k in out ? `${out[k]}, ${v}` : v
  }
  return out
}

/**
 * True when chromium's own network stack cannot be trusted to reach `base`:
 * an HTTPS proxy is in the environment AND the target is not loopback (a local
 * dev server is reached directly and needs no interception).
 *
 * Loopback is matched literally, not resolved. A local dev server addressed by
 * an alias (`http://dev.local:3000`, a compose service name, a LAN IP) on a
 * machine with an ambient `HTTPS_PROXY` will be intercepted; pass
 * `--no-via-fetch` there. The default `http://localhost:3000` is unaffected.
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
 *
 * One deliberate difference from the chromium-direct path: `redirect: 'follow'`
 * resolves the whole chain inside Node, so chromium sees a single 200 for the
 * URL it asked for and `page.url()` keeps reporting the PRE-redirect URL. The
 * captured pixels are the destination's and are correct, which is all this CLI
 * promises, but do not use `page.url()` here to discover where a route landed
 * (the repo still has 301s on `/for-him` and `/for-her`).
 */
/** Render-critical requests this capture could not serve. Reset per capture. */
const criticalAborts: string[] = []

async function fulfilFromNodeFetch(route: Route): Promise<void> {
  const request = route.request()
  try {
    const response = await curlFetch({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postDataBuffer(),
    })
    await route.fulfill({
      status: response.status,
      headers: sanitizeResponseHeaders(response.headers),
      body: response.body,
    })
  } catch (err) {
    if (abortIsRenderCritical(request.url(), request.resourceType())) {
      criticalAborts.push(`${request.resourceType()} ${request.url()}`)
    }
    process.stderr.write(`  via-fetch abort ${request.url()}: ${(err as Error).message}\n`)
    await route.abort().catch(() => {})
  }
}

/**
 * Request headers we never forward to curl. `host` and the `content-length`
 * family describe a connection and a body curl re-derives itself; forwarding
 * them produces a request that contradicts the one actually sent.
 * `accept-encoding` is dropped so curl negotiates its own and `--compressed`
 * hands back decoded bytes, which is the state `sanitizeResponseHeaders`
 * already assumes when it strips `content-encoding` off the response.
 */
const DROPPED_REQUEST_HEADERS = /^(host|content-length|accept-encoding|connection|keep-alive|upgrade|proxy-.*)$/i

/** A real HTTP header name. See the `--header` forwarding loop in `curlFetch`. */
const SAFE_HEADER_NAME_RE = /^[A-Za-z0-9-]+$/

/** Parse curl's `-D` dump into the last response's status and headers. */
export function parseCurlHeaderDump(dump: string): { status: number; headers: [string, string][] } {
  // `-L` appends one block per hop; the capture is the final hop's.
  const blocks = dump.split(/\r?\n\r?\n/).map(b => b.trim()).filter(Boolean)
  const last = blocks[blocks.length - 1] ?? ''
  const lines = last.split(/\r?\n/)
  const statusLine = lines.shift() ?? ''
  const status = Number(/^HTTP\/[\d.]+\s+(\d{3})/.exec(statusLine)?.[1] ?? 0)
  const headers: [string, string][] = []
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx > 0) headers.push([line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim()])
  }
  return { status, headers }
}

/**
 * The curl argv for one request, pulled out of `curlFetch` so the method and
 * header-forwarding decisions (#14119) are unit-testable without shelling out.
 */
export function buildCurlArgs(
  req: { url: string; method: string; headers: Record<string, string>; hasBody: boolean },
  paths: { bodyPath: string; headerPath: string; postPath: string },
): string[] {
  const args = [
    '--silent', '--show-error',
    '--location', '--max-redirs', '10',
    '--compressed',
    '--max-time', '60',
    '--output', paths.bodyPath,
    '--dump-header', paths.headerPath,
  ]
  // `--head` both issues HEAD and tells curl not to wait for a body that a
  // HEAD response never sends; `--request HEAD` alone did not stop curl
  // waiting on one (#14119, hangs until --max-time). For every other method,
  // `--request`/`-X` overrides curl's own redirect handling (curl manual, -L:
  // a POST is downgraded to GET on a 301/302 unless -X forces the method),
  // which is why a POST through this transport kept re-POSTing every redirect
  // hop `fetch` would have downgraded. So GET and POST are left for curl to
  // infer on its own (no body => GET, --data-binary => POST) and `--request`
  // is only forced for a method curl cannot infer.
  if (req.method === 'HEAD') {
    args.push('--head')
  } else if (req.method !== 'GET' && req.method !== 'POST') {
    args.push('--request', req.method)
  }
  for (const [k, v] of Object.entries(req.headers)) {
    // A header name beginning with `@` would make curl treat the whole
    // `--header` argument as an @filename read instead of a literal header
    // (curl manual, -H). chromium never emits one and there is no shell
    // involved (execFile with an argv array), so this is defence in depth
    // rather than a live hole (#14119).
    if (!DROPPED_REQUEST_HEADERS.test(k) && SAFE_HEADER_NAME_RE.test(k)) args.push('--header', `${k}: ${v}`)
  }
  if (req.hasBody) args.push('--data-binary', `@${paths.postPath}`)
  args.push('--url', req.url)
  return args
}

/**
 * One request, served by the `curl` binary instead of Node's `fetch`.
 *
 * Why this is not `fetch` (run 1298, 2026-10-07). The previous implementation
 * called Node's built-in fetch (undici). Vercel's bot protection now answers
 * undici with a 403 "This request was blocked" edge page, while `curl` from the
 * same machine, through the same agent proxy, gets a clean 200. Reproduced
 * directly and it is independent of `user-agent` and `accept` (both were
 * forwarded verbatim and still 403'd), so it is a TLS-fingerprint block that no
 * header can talk its way past.
 *
 * The failure mode is the reason this matters more than it looks: chromium
 * rendered the 403 page and the CLI wrote three PNGs and printed `done`, so a
 * blocked capture is indistinguishable from a successful one unless somebody
 * opens the file. Run 1298 handed three such PNGs to the design-critic gate
 * before noticing they were 98.5% white. `assertNotBlocked` below now fails the
 * capture loudly instead, because a silent wrong answer costs a whole cycle.
 *
 * curl also already trusts the agent-proxy CA, which is the same reason the
 * via-fetch transport exists at all: chromium's own stack cannot (see
 * `shouldUseFetchTransport`).
 */
export async function curlFetch(req: {
  url: string
  method: string
  headers: Record<string, string>
  body?: Buffer | null
}): Promise<{ status: number; headers: [string, string][]; body: Buffer }> {
  const dir = mkdtempSync(join(tmpdir(), 'design-snap-'))
  const bodyPath = join(dir, 'body')
  const headerPath = join(dir, 'headers')
  const postPath = join(dir, 'post')
  try {
    if (req.body?.length) writeFileSync(postPath, req.body)
    const args = buildCurlArgs(
      { url: req.url, method: req.method, headers: req.headers, hasBody: Boolean(req.body?.length) },
      { bodyPath, headerPath, postPath },
    )
    // The agent proxy drops connections intermittently: a plain curl of the
    // homepage through it returned a reset on 1 of 6 bare attempts, with no
    // involvement from this script. Retry the transport-level failures only
    // (7 could-not-connect, 35 recv failure, 52 empty reply, 56 recv error) —
    // an HTTP error is a real answer and curl exits 0 for it, so nothing here
    // retries a 403 or a 404.
    const RETRYABLE = new Set([7, 35, 52, 56])
    // Only idempotent methods. Exits 52 and 56 can occur after the server has
    // already seen the request, so retrying a POST (an analytics beacon fired
    // during the page load) could deliver it twice to production.
    const idempotent = req.method === 'GET' || req.method === 'HEAD'
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await execFileAsync('curl', args, { maxBuffer: 1024 * 1024 })
        const { status, headers } = parseCurlHeaderDump(readFileSync(headerPath, 'utf8'))
        return { status, headers, body: readFileSync(bodyPath) }
      } catch (err) {
        lastErr = err
        const code = (err as { code?: number }).code
        if (!idempotent || typeof code !== 'number' || !RETRYABLE.has(code)) throw err
        await new Promise(r => setTimeout(r, 150 * (attempt + 1)))
      }
    }
    throw lastErr
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Whether an aborted sub-resource can change what the screenshot shows.
 *
 * A dropped image leaves a gap the critic can see and judge. A dropped script
 * does not: with `entry.client` aborted the page never hydrates, and because
 * the Reveal primitive renders its final state on the server the PNG still
 * looks plausible. The capture would exit 0 on a page that never ran, which is
 * the same silent-wrong-answer this transport was rewritten to stop. Found by
 * the QA gate on run 1298, which saw real captures abort `entry.client`,
 * `motion`, `OptimizedImage` and others and still write a file and exit 0.
 */
export function abortIsRenderCritical(url: string, resourceType: string, base: string = BASE): boolean {
  if (resourceType === 'image' || resourceType === 'media') return false
  // Third-party scripts (gtag, GTM, Klaviyo) are `script` too, and none of them
  // changes what the critic scores, so failing the capture over an analytics
  // bundle would just make the gate flaky. First-party only.
  if (!isSameOrigin(url, base)) return false
  // Fonts are critical despite being an asset: app.css defines metric-adjusted
  // fallback faces, so a dropped Newsreader renders a plausible page in the
  // wrong typeface, and the typeface IS what doctrine §2 is judging. Same
  // "looks fine, silently wrong" class as a dropped script.
  return resourceType === 'document' || resourceType === 'script'
    || resourceType === 'stylesheet' || resourceType === 'font'
}

function isSameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

/**
 * Edge-block signatures of a captured document (run 1298, widened #14119).
 * Vercel's bot wall answers with a ~7 KB HTML page, and chromium renders it
 * perfectly happily, so without this check the CLI reports success and writes
 * a screenshot of an error page.
 *
 * The generic phrases stay restricted to a non-200 status below: the
 * storefront legitimately ships the words "blocked" (card_art_blocked) and
 * could ship "403" in Notebook copy, so matching them on a 200 would flag the
 * real site. The challenge page's own ray id (`cle1::<timestamp>-<id>`) is
 * specific enough that it cannot appear in real content, so it is checked on
 * any status, including the 200 and 429 the challenge page can also answer
 * with.
 */
const EDGE_BLOCK_SIGNATURES: { re: RegExp; anyStatus: boolean }[] = [
  { re: /\bcle\d::\d+-[A-Za-z0-9]+\b/, anyStatus: true },
  { re: /This request was blocked/i, anyStatus: false },
  { re: /\b403 FORBIDDEN\b/i, anyStatus: false },
]

export function looksLikeEdgeBlock(status: number, html: string): boolean {
  return EDGE_BLOCK_SIGNATURES.some(({ re, anyStatus }) => (anyStatus || status !== 200) && re.test(html))
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
  if (VIA_FETCH) {
    // The transport is curl, which reads the proxy environment itself, so the
    // NODE_USE_ENV_PROXY shim the old undici path needed is gone with it.
    await context.route('**/*', fulfilFromNodeFetch)
  }
  return context
}

async function capture(context: BrowserContext, route: string, file: string): Promise<void> {
  criticalAborts.length = 0
  const page = await context.newPage()
  try {
    const response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60_000 })
    // A bot wall renders fine, so a blocked document would otherwise be written
    // out as a perfectly valid screenshot of an error page and reported as a
    // success (run 1298 handed three of those to the design-critic gate). Fail
    // the capture instead: a missing file is obvious, a wrong one is not.
    const status = response?.status() ?? 0
    if (looksLikeEdgeBlock(status, await page.content())) {
      throw new Error(
        `${BASE}${route} answered ${status} with an edge block page, not the site. ` +
        `The capture transport is being refused upstream; no screenshot written.`,
      )
    }
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
    if (criticalAborts.length) {
      throw new Error(
        `${criticalAborts.length} render-critical request(s) could not be served, so this ` +
        `page did not fully load and its screenshot would misrepresent it:\n` +
        criticalAborts.map(u => `         ${u}`).join('\n'),
      )
    }
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
  // The proxied transport is curl, so say so once and plainly. Without this a
  // missing binary surfaces as one "spawn curl ENOENT" abort per request and
  // then a bare net::ERR_FAILED from goto(), which reads like the site is down
  // rather than like a missing dependency. Deliberately no fallback to Node
  // fetch: it is the thing Vercel 403s, and falling back would reintroduce the
  // silent wrong-capture that `looksLikeEdgeBlock` exists to prevent.
  if (VIA_FETCH) {
    try {
      await execFileAsync('curl', ['--version'])
    } catch {
      process.stderr.write(
        'ERROR: the via-fetch transport needs the curl binary on PATH.\n' +
        '       Install curl, or pass --no-via-fetch to let chromium fetch directly\n' +
        '       (which needs chromium to trust your proxy CA).\n',
      )
      return 2
    }
  }

  mkdirSync(OUT, { recursive: true })
  process.stderr.write(`capturing ${ROUTES.length} route(s) x ${viewports.length} viewport(s) from ${BASE} -> ${OUT}\n`)
  process.stderr.write(`transport: ${VIA_FETCH ? 'curl (via-fetch)' : 'chromium direct'}\n`)

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
