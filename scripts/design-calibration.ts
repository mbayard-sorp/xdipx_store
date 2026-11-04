/**
 * design-calibration.ts — regenerate the committed design-critic calibration
 * corpus in docs/homepage-team/calibration/ (ticket #18635).
 *
 * WHY THIS EXISTS. `.claude/agents/design-critic.md`'s `<calibration>` block
 * requires the gate to score 5 known-good and 5 known-bad screenshots before a
 * BLOCK verdict is trusted; until that pass is recorded, the gate downgrades
 * every BLOCK it would otherwise issue to a REVISE. Ticket #16881 named Routine
 * B as the owner of recording it, and run 1703 then discovered the pass can
 * never run: the corpus was specified as HISTORICAL screenshots, `.design-
 * snapshots/` is gitignored, and a scheduled cloud routine runs in an ephemeral
 * container cloned fresh each time. No capture any run has ever taken still
 * exists by the time the next run starts. Ownership without supply.
 *
 * So the corpus stops being historical and becomes REPRODUCIBLE. Every entry in
 * CALIBRATION below is cut from a live capture of production, and each bad entry
 * is produced by injecting one documented CSS override that reinstates a defect
 * this repo actually shipped, cited to the ticket that fixed it. That is
 * strictly better than the historical corpus it replaces: it can be
 * regenerated, the geometry can be re-verified against the measurement the
 * fixing run recorded, and a good/bad pair can share a region so the only
 * difference between them is the defect.
 *
 * Usage:
 *   npx tsx scripts/design-calibration.ts                      # against production
 *   npx tsx scripts/design-calibration.ts --base http://localhost:3000
 *   npx tsx scripts/design-calibration.ts --out /tmp/cal       # somewhere other than docs/
 *   npx tsx scripts/design-calibration.ts --only bad-01-rail-header-collision-375
 *   npx tsx scripts/design-calibration.ts --manifest-only   # rebuild the index, re-shoot nothing
 *
 * It reuses `design-snapshots.ts`'s transport accommodations (curl-backed
 * request interception, chromium fallback path, edge-block detection) rather
 * than re-deriving them, because those are the parts that took three runs to
 * get right. See that file's CLOUD-ROUTINE TRANSPORT note.
 */

import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page, type Route } from '@playwright/test'
import sharp from 'sharp'
import {
  abortIsRenderCritical,
  curlFetch,
  looksLikeEdgeBlock,
  resolveExecutablePath,
  sanitizeResponseHeaders,
  shouldUseFetchTransport,
} from './design-snapshots'
import { cropCapture, measureCapture } from './design-crop'

export type CalibrationEntry = {
  /** File stem. `good-*` must score PASS, `bad-*` must score BLOCK. */
  slug: string
  expected: 'PASS' | 'BLOCK'
  /** Viewport width; height is only the window, captures are clipped regions. */
  width: number
  /** Seed a stored consent choice, which is required to see the tab bar at all. */
  consent?: boolean
  /** Region to capture: a CSS selector, or an explicit y-range of the full page. */
  selector?: string
  band?: { top: number; height: number }
  /**
   * The documented defect reinstatement, for `bad-*` entries. One rule, naming
   * the ticket whose fix it reverses. Never a decorative "make it look bad".
   */
  injectCss?: string
  /** One line for the README and for the gate's own notes. */
  carries: string
  /** The doctrine or brief rule the entry is calibrated against. */
  rule: string
  /**
   * Doctrine deviations visible in a `good-*` fixture that are NOT what it
   * calibrates. A near-miss PASS is more useful than a perfect one, but only if
   * the miss is written down: without this, a critic correctly marking the
   * fixture down reads as a calibration failure instead of a correct call.
   */
  knownDeviations?: string[]
}

/**
 * Five good, five bad. The good entries are regions the gate has already
 * measured clean on a previous cycle; the bad entries each reverse exactly one
 * shipped-and-fixed defect, so the corpus is a set of near-pairs rather than
 * ten unrelated images.
 */
export const CALIBRATION: CalibrationEntry[] = [
  {
    slug: 'good-01-rail-header-375',
    expected: 'PASS',
    width: 375,
    selector: 'div.flex.flex-wrap.items-end.justify-between.gap-4.mb-6',
    carries:
      'A rail header at the 375 floor after the #18637 fix: the heading owns a full-width row, the See-all drops onto its own row below it with its whitelist arrow intact.',
    rule: 'doctrine §2 (type hierarchy), CTA whitelist (the arrow is part of the label)',
  },
  {
    slug: 'good-02-tab-bar-375',
    expected: 'PASS',
    width: 375,
    consent: true,
    selector: 'nav[aria-label="Browse categories"]',
    carries:
      'The primary mobile navigation at 375 after the #18637 fix: every label renders at its natural width inside a horizontal scroller, in DM Sans, with the account tab pinned outside the scroller.',
    rule: 'doctrine §2 (DM Sans for nav, labels, CTA text), mobile-first at 375',
  },
  {
    slug: 'good-03-rail-band-1440',
    expected: 'PASS',
    width: 1440,
    consent: true,
    // Deliberately the SAME region and viewport as bad-05, so the only
    // difference between the two fixtures is the card chrome. A pair that
    // differs in one variable calibrates; two unrelated images do not.
    selector: 'section:has(> div > div.flex.flex-wrap.items-end.justify-between.gap-4.mb-6)',
    carries:
      'A storefront rail at 1440 in v3 chrome: flat paper-2 cards on a single plum-soft ground, each carrying the hairline border-line the doctrine requires, with no drop shadow and no second ground inside the band.',
    rule: 'doctrine §1 (one ground per band), §3 (hairline border-line on cards, never a shadow; no old-cream grounds), §5 (card system)',
    // Scored PASS at 4.33 by the calibration pass and agreed with, but it is a
    // NEAR-MISS, and saying so is what keeps it useful. Two real doctrine
    // deviations are visible in this fixture and are not what it calibrates:
    // card 5's art is a printed retail carton (§4.4 packaging, filed), and the
    // card brand eyebrow renders body sans ink-3 where §6 specifies mono ink-4
    // (ProductCarousel.tsx:397 against StorefrontProductCard.tsx:83-87, filed).
    // A critic marking this down on imagery or type is RIGHT, not miscalibrated.
    knownDeviations: [
      '§4.4: card 5 (nixie-rechargeable-wand-massager-ombre-metallic) renders its retail carton as card art.',
      '§6: the card brand eyebrow is body sans ink-3, not mono ink-4 (ProductCarousel.tsx:397).',
    ],
  },
  {
    slug: 'good-04-meet-emma-1440',
    expected: 'PASS',
    width: 1440,
    consent: true,
    selector: '#meet-emma',
    carries:
      'The Meet Emma band at 1440: editorial serif display against body copy in DM Sans, generous vertical rhythm, a single tinted ground.',
    rule: 'doctrine §2 (type pairing), §1 (spacing rhythm)',
  },
  {
    slug: 'good-05-ink-closer-1440',
    expected: 'PASS',
    width: 1440,
    consent: true,
    selector: '#discover',
    carries:
      'The ink closer band at 1440: white display type on bg-ink, one plum emphasis word lifted with .em-on-dark (~6.75:1), coral CTA measured at 5.51:1 white-on-coral.',
    rule: 'doctrine §2 (exactly one emphasis word per headline), WCAG AA floor (4.5:1 body, 3:1 large display)',
  },
  {
    slug: 'bad-01-rail-header-collision-375',
    expected: 'BLOCK',
    width: 375,
    selector: 'div.flex.flex-wrap.items-end.justify-between.gap-4.mb-6',
    // Reverses ProductCarousel.tsx's `basis-full sm:basis-auto sm:flex-1` back
    // to the `flex-1 min-w-0` that shipped for months. The 0% flex-basis lets
    // the heading column absorb every pixel of shrink, so the row never
    // overflows, the promised flex-wrap never fires, and the heading's TEXT
    // wraps onto the See-all's baseline instead. Tickets #468 / #16879a; the
    // fixing run measured heading last line x≈248 against See-all x≈269 at
    // 375, i.e. 21-26px horizontal clearance and zero vertical.
    injectCss:
      'div.flex.flex-wrap.items-end.justify-between.gap-4.mb-6 > div:first-child { flex: 1 1 0% !important; }',
    carries:
      'The rail header collision: the heading text ends on the same baseline as the See-all CTA with no vertical separation, so the CTA reads as a continuation of the sentence.',
    rule: 'doctrine §2 (type hierarchy must be legible as hierarchy), mobile-first at 375',
  },
  {
    slug: 'bad-02-tab-bar-runon-375',
    expected: 'BLOCK',
    width: 375,
    consent: true,
    selector: 'nav[aria-label="Browse categories"]',
    // Reverses MobileExploreMenu.tsx's `shrink-0 grow` back to `flex-1` and
    // removes the per-label padding. Seven Sanity-published menu items then get
    // equal slices narrower than their own labels. Measured on run 1703's
    // consented capture: labels ran x=25 to x=304 as one continuous glyph run
    // with inter-WORD gaps of 1-2px, reading
    // "PleasurePlayBodyWearDiscoverSaleNotebook".
    injectCss:
      'nav[aria-label="Browse categories"] button { flex: 1 1 0% !important; min-width: 0 !important; padding-left: 0 !important; padding-right: 0 !important; }',
    carries:
      'The primary mobile navigation rendered as one run-on glyph string: seven labels squeezed into slices narrower than themselves, with inter-word gaps indistinguishable from inter-letter gaps.',
    rule: 'mobile-first at 375 (CLAUDE.md), doctrine §2 (labels must read as labels)',
  },
  {
    slug: 'bad-03-nav-serif-375',
    expected: 'BLOCK',
    width: 375,
    consent: true,
    selector: 'nav[aria-label="Browse categories"]',
    // Reverses run 1298/1703's type fix on nav and CTA surfaces. Doctrine §2
    // assigns Newsreader to headlines and editorial display, and DM Sans to
    // "nav, labels, CTA text"; the tab bar, the explore flyout entries and the
    // consent "Accept all" button all shipped in the display serif.
    injectCss:
      'nav[aria-label="Browse categories"], nav[aria-label="Browse categories"] * { font-family: Newsreader, Georgia, serif !important; }',
    carries:
      'The primary navigation set in the display serif, where doctrine §2 assigns DM Sans. The band looks deliberate and is a type-system violation.',
    rule: 'doctrine §2 (Newsreader for display, DM Sans for nav / labels / CTA text)',
  },
  {
    slug: 'bad-04-plum-on-ink-1440',
    expected: 'BLOCK',
    width: 1440,
    consent: true,
    selector: '#discover',
    // Reverses .em-on-dark back to bare .em on the ink closer's headline:
    // --color-plum (#7A2BB8) against bg-ink reads about 2.5:1, under the AA
    // floor for display type. The owner flagged two live banners for exactly
    // this, which is why the mission brief §2 rule names the lift by class.
    injectCss:
      '#discover em.em { color: var(--color-plum) !important; }',
    carries:
      'Plum emphasis on an ink ground without the .em-on-dark lift: roughly 2.5:1, so the emphasis word is the least legible word in the headline it is meant to emphasise.',
    rule: 'mission brief §2 (plum on dark always uses .em-on-dark), WCAG AA floor per doctrine (3:1 large display)',
  },
  {
    slug: 'bad-05-v2-card-chrome-1440',
    expected: 'BLOCK',
    width: 1440,
    consent: true,
    // The rail band itself, located by the header row the #468 fix pinned,
    // because no storefront band on variant b carries a stable id (only
    // #meet-emma, #discover and #email-subscribe do).
    selector: 'section:has(> div > div.flex.flex-wrap.items-end.justify-between.gap-4.mb-6)',
    // Reinstates the v2 card chrome (rounded-2xl, drop-shadow, cream border)
    // that shipped on the team's main lever through the emmaCuratedRail ->
    // EmmaCuratedRail -> ProductCarousel wrapper path, bypassing the
    // VARIANT_B_SECTION_TYPES exclusion. Ticket #1450, found by run 183's live
    // self-capture, fixed in PR #506.
    injectCss:
      'section:has(> div > div.flex.flex-wrap.items-end.justify-between.gap-4.mb-6) a[href^="/products/"] { border-radius: 16px !important; box-shadow: 0 10px 24px rgba(26,20,24,0.18) !important; border: 1px solid #EFECE4 !important; background: #FAF4EA !important; padding: 10px !important; }',
    carries:
      'Stale v2 card chrome on a v3 storefront rail: rounded corners, a drop shadow and a cream border against the flat-on-paper card system the doctrine locks.',
    rule: 'doctrine §1 and §5 (flat coral on white paper, hairline frames, no drop shadows, no cream grounds)',
  },
]

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}

const BASE = (flag('base') ?? process.env['VISUAL_BASE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')
const OUT = flag('out') ?? join('docs', 'homepage-team', 'calibration')
const ONLY = flag('only')
const VIA_FETCH = shouldUseFetchTransport(BASE, process.env, {
  force: argv.includes('--via-fetch'),
  disable: argv.includes('--no-via-fetch'),
})

const criticalAborts: string[] = []

async function fulfilFromCurl(route: Route): Promise<void> {
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
    if (abortIsRenderCritical(request.url(), request.resourceType(), BASE)) {
      criticalAborts.push(`${request.resourceType()} ${request.url()}`)
    }
    process.stderr.write(`  via-fetch abort ${request.url()}: ${(err as Error).message}\n`)
    await route.abort().catch(() => {})
  }
}

async function launchBrowser() {
  const explicit = resolveExecutablePath(process.env, { explicit: flag('executable-path') })
  if (explicit) return chromium.launch({ executablePath: explicit })
  try {
    return await chromium.launch()
  } catch (err) {
    const fallback = resolveExecutablePath(process.env, { bundledMissing: true })
    if (!fallback) throw err
    process.stderr.write(`chromium: falling back to ${fallback}\n`)
    return chromium.launch({ executablePath: fallback })
  }
}

/** Trip every Reveal observer and lazy image, then settle at the top. */
async function settlePage(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
  })
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
}

type SessionKey = string
function sessionKey(e: CalibrationEntry): SessionKey {
  return `${e.width}:${e.consent ? 'consent' : 'banner'}`
}

async function main(): Promise<number> {
  // Rebuild manifest.json from the PNGs already on disk. Used after editing an
  // entry's prose, so the index can be corrected without re-shooting fixtures
  // against a storefront that has moved since they were taken.
  if (argv.includes('--manifest-only')) {
    await writeManifest(OUT)
    console.log(`manifest.json rebuilt from the committed PNGs in ${OUT}`)
    return 0
  }
  const entries = CALIBRATION.filter((e) => !ONLY || e.slug === ONLY)
  if (entries.length === 0) {
    console.error(`no calibration entry matches --only ${ONLY}`)
    return 1
  }
  mkdirSync(OUT, { recursive: true })

  const groups = new Map<SessionKey, CalibrationEntry[]>()
  for (const e of entries) {
    const k = sessionKey(e)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }

  const written: { slug: string; expected: string; bytes: number; width: number; height: number }[] = []
  const browser = await launchBrowser()
  try {
    for (const [key, group] of groups) {
      const [widthStr, mode] = key.split(':')
      const width = Number(widthStr)
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
        colorScheme: 'light',
      })
      await context.addInitScript(() => {
        window.localStorage.setItem(
          'xdipx_age_verified',
          JSON.stringify({ verified: true, timestamp: Date.now(), version: '1.0' }),
        )
      })
      if (mode === 'consent') {
        await context.addInitScript(() => {
          window.localStorage.setItem(
            'xdipx_consent',
            JSON.stringify({ type: 'essential_only', version: '1.0', ts: Date.now() }),
          )
        })
      }
      if (VIA_FETCH) await context.route('**/*', fulfilFromCurl)

      criticalAborts.length = 0
      const page = await context.newPage()
      const response = await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
      const status = response?.status() ?? 0
      if (looksLikeEdgeBlock(status, await page.content())) {
        throw new Error(
          `${BASE}/ answered ${status} with an edge block page, not the storefront. No calibration image written.`,
        )
      }
      await settlePage(page)
      if (criticalAborts.length) {
        throw new Error(
          `${criticalAborts.length} render-critical request(s) could not be served at ${width}px: ` +
            `${criticalAborts.slice(0, 3).join(', ')}. No calibration image written from this session.`,
        )
      }

      for (const entry of group) {
        const out = join(OUT, `${entry.slug}.png`)
        let handle: Awaited<ReturnType<Page['addStyleTag']>> | undefined
        if (entry.injectCss) {
          handle = await page.addStyleTag({ content: entry.injectCss })
          await page.waitForTimeout(200)
        }
        try {
          if (entry.band) {
            // Geometric band crop: full page first, then cut. Used where the
            // region is "three consecutive bands" rather than one element.
            const full = join(OUT, `.tmp-${entry.slug}.png`)
            await page.screenshot({ path: full, fullPage: true })
            const m = await measureCapture(full)
            if (m.looksLikeBotWall) {
              throw new Error(
                `${entry.slug}: full-page capture matched the bot-wall signature ` +
                  `(${(m.whiteFraction * 100).toFixed(1)}% near-white at mean ${m.meanLuminance.toFixed(1)}).`,
              )
            }
            const cropped = await cropCapture({ input: full, out, top: entry.band.top, height: entry.band.height })
            rmSync(full, { force: true })
            written.push({ slug: entry.slug, expected: entry.expected, bytes: cropped.bytes, width: cropped.width, height: cropped.height })
          } else if (entry.selector) {
            const locator = page.locator(entry.selector).first()
            const count = await page.locator(entry.selector).count()
            if (count === 0) throw new Error(`${entry.slug}: selector matched nothing: ${entry.selector}`)
            await locator.scrollIntoViewIfNeeded()
            await page.waitForTimeout(250)
            await locator.screenshot({ path: out })
            const m = await measureCapture(out)
            written.push({ slug: entry.slug, expected: entry.expected, bytes: 0, width: m.width, height: m.height })
          } else {
            throw new Error(`${entry.slug}: entry has neither selector nor band`)
          }
        } finally {
          // `el` is typed Node; the style tag is always an Element. CI cannot see
          // this (tsconfig excludes scripts/**), so it is asserted rather than left.
          if (handle) await handle.evaluate((el) => (el as Element).remove()).catch(() => {})
          await page.waitForTimeout(150)
        }
        console.log(`${out} (expected ${entry.expected})`)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }

  await writeManifest(OUT)
  console.log(`\n${written.length} calibration image(s) written to ${OUT}`)
  return 0
}

/**
 * A machine-readable index beside the images, so the gate can read expected
 * verdicts without parsing the README prose.
 *
 * It carries a sha256 and the pixel dimensions of every committed PNG, which is
 * the only thing binding a file to the entry that named it (qa-reviewer, run
 * 1837). Without it, a fixture re-shot at a different width, left stale after an
 * `injectCss` edit, or swapped between two slugs passes every other guard: they
 * check that a file EXISTS, not that it is the right file. Regenerating now
 * means committing new hashes, which is the honest behaviour.
 */
export async function writeManifest(dir: string): Promise<void> {
  const entries = []
  for (const e of CALIBRATION) {
    const file = join(dir, `${e.slug}.png`)
    const bytes = readFileSync(file)
    const meta = await sharp(bytes).metadata()
    entries.push({
      slug: e.slug,
      file: `${e.slug}.png`,
      expected: e.expected,
      viewport: `${e.width}px${e.consent ? ' (consent stored)' : ''}`,
      carries: e.carries,
      rule: e.rule,
      reinstates: e.injectCss ?? null,
      knownDeviations: e.knownDeviations ?? null,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      pixels: `${meta.width}x${meta.height}`,
      bytes: bytes.length,
    })
  }
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        generatedFrom: BASE,
        note: 'Regenerate with: npx tsx scripts/design-calibration.ts (or --manifest-only to rebuild this file from the committed PNGs without re-shooting them). Expected verdicts are the point of the fixture; do not edit them to match a gate run.',
        scope:
          'Calibrated 2026-11-04 (run 1837): 10/10 agreement, no overlap. Trusted BLOCK is licensed for layout geometry, type-role, contrast and token/palette classes ONLY. Imagery, interest floor, theme expression, day-over-day distinctness and motion have no fixture here and keep issuing withheld-BLOCK REVISE.',
        entries,
      },
      null,
      2,
    )}\n`,
  )
}

if (process.argv[1]?.endsWith('design-calibration.ts')) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
