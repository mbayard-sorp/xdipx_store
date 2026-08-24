/**
 * Homepage self-heal healthcheck (run on a cron — see server/cron.ts).
 *
 * Fetches the live homepage `/` and the `/discover` finder and asserts each
 * renders cleanly: HTTP 200, a non-trivial body, at least one image (hero/LCP),
 * valid JSON-LD, and NO leftover "daily deal" framing in that JSON-LD.
 *
 *  - Healthy  → snapshot the current Sanity homepage doc as the last-good copy.
 *  - `/` broken → roll the Sanity homepage doc back to last-good, re-warm the
 *                 Variant A payload, and alert (Sentry + a P0 GitHub issue).
 *  - only `/discover` broken → alert only (a homepage rollback wouldn't help).
 *
 * This is the safety net that lets the autonomous merchandiser auto-publish
 * content: a bad publish is detected and reverted within the cron interval.
 * Server-only.
 */
import { Sentry } from '~/lib/sentry.server'
import { kvGet, kvSet } from '~/lib/kv.server'
import {
  getHomepageDocRaw,
  restoreHomepageDoc,
  getHomeConfig,
  invalidateCmsCache,
} from '~/lib/sanity.server'
import {
  warmHomepagePayloadA, invalidateHomepagePayloadA, invalidateHomepagePayloadB,
  readHomepagePayloadB,
} from '~/lib/homepage-payload.server'
import { fileDetectionTicket, makeDedupeKey } from '~/lib/detection-tickets.server'
import type {
  EmmaCuratedRailBlock,
  PlayTogetherBannerBlock,
  WayfinderMosaicBlock,
} from '~/types/cms'

const LAST_GOOD_KEY = 'homepage:healthcheck:lastgood'
const PATHS = ['/', '/discover']
const FETCH_TIMEOUT_MS = 12_000
const MIN_BODY_BYTES = 1000
// A single server-side self-fetch can hit a cold Fluid instance / a transient
// degraded render and momentarily lack the streamed hero <img> or JSON-LD. That
// is NOT grounds to destructively roll back Sanity content, so we retry a few
// times and only act on the best (least-broken) result.
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 1500

export interface PageCheck {
  path: string
  status: number
  ok: boolean
  problems: string[]
  /**
   * The fetched HTML, present ONLY when the caller passed `captureHtml`.
   * renderTruth() needs the body the render heuristics already fetched; every
   * other caller (and everything that serialises a PageCheck into a cron
   * response, a Sentry extra, or a GitHub issue) leaves it off so a ~200 KB
   * document never rides along.
   */
  html?: string
  /** The page is genuinely serving real content (HTTP 200 + a real-sized body). */
  bodyOk: boolean
  /**
   * A hard server failure (5xx) that restoring last-good Sanity CONTENT could
   * plausibly fix. A 200 that merely fails the render heuristics (no <img> /
   * JSON-LD) is NOT hard — a content rollback can't add an image, so we alert
   * without the destructive rollback.
   */
  hardFail: boolean
}

export interface HomepageHealthResult {
  ok: boolean
  checks: PageCheck[]
  action: 'snapshot' | 'rollback' | 'alert'
  rolledBack: boolean
  alerted: boolean
  message?: string
  /**
   * Render-truth verdict (see renderTruth below). Null only when the gate threw
   * so hard it produced nothing, which it is written not to do.
   */
  renderTruth?: RenderTruthResult | null
}

/**
 * Which variant `/` is actually serving for anonymous traffic, mirroring
 * resolveHomeVariant's cookieless fallback chain (Sanity homeConfig wins,
 * then HOME_VARIANT env, then legacy). The post-rollback rewarm must target
 * whatever payload the live homepage reads, not assume Variant A.
 */
async function activeServedVariant(): Promise<'a' | 'b' | 'legacy'> {
  try {
    const cfg = await getHomeConfig()
    if (cfg?.activeVariant === 'a' || cfg?.activeVariant === 'b') return cfg.activeVariant
  } catch {
    /* Sanity down — fall through to env, same as the live resolver. */
  }
  const env = process.env['HOME_VARIANT']
  if (env === 'a' || env === 'b' || env === 'legacy') return env
  return 'legacy'
}

function siteOrigin(): string {
  const base =
    process.env['BASE_URL'] ||
    (process.env['VERCEL_URL'] ? `https://${process.env['VERCEL_URL']}` : '')
  return base.replace(/\/$/, '') || 'https://xdipx.com'
}

/** Count JSON-LD <script> blocks and how many parse as valid JSON.
 *  Exported so the daily SEO regression tripwire (seo-daily.server.ts) asserts
 *  JSON-LD the same way this healthcheck does, rather than growing a second
 *  parser that could drift. */
export function extractJsonLd(html: string): { parsed: number; scripts: number } {
  let parsed = 0
  let scripts = 0
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    scripts += 1
    try {
      JSON.parse((m[1] ?? '').trim())
      parsed += 1
    } catch {
      /* unparseable block — flagged via parsed < scripts */
    }
  }
  return { parsed, scripts }
}

/** Exported for reuse by the daily SEO tripwire (seo-daily.server.ts). */
export async function checkPageOnce(
  path: string,
  attempt: number,
  opts: { captureHtml?: boolean } = {},
): Promise<PageCheck> {
  // Cache-bust every attempt. Without this the self-fetch shares a Vercel CDN
  // cache entry with other non-browser fetchers (cache keys vary on
  // Accept-Encoding, not User-Agent), so the check can be served a stale — or
  // worse, truncated — cached copy instead of exercising the origin render it
  // exists to verify. The unique param forces a CDN MISS per attempt and keeps
  // an aborted attempt from ever poisoning a cache key anything else reads.
  const bust = `__healthcheck=${Date.now()}-${attempt}`
  const url = `${siteOrigin()}${path}${path.includes('?') ? '&' : '?'}${bust}`
  const problems: string[] = []
  let status = 0
  let bodyOk = false
  let captured: string | undefined
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: { 'user-agent': 'xdipx-homepage-healthcheck' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    status = res.status
    const html = await res.text()
    if (opts.captureHtml) captured = html

    if (status !== 200) problems.push(`HTTP ${status}`)
    if (html.length < MIN_BODY_BYTES) problems.push(`body too small (${html.length} bytes)`)
    if (!/<img[\s>]/i.test(html)) problems.push('no <img> (hero/LCP image likely missing)')
    if (!/<\/html>/i.test(html)) problems.push('truncated HTML (no </html> — stream cut off)')
    bodyOk = status === 200 && html.length >= MIN_BODY_BYTES

    const { parsed, scripts } = extractJsonLd(html)
    if (parsed === 0) problems.push('no valid JSON-LD')
    else if (parsed < scripts) problems.push(`malformed JSON-LD (${scripts - parsed} unparseable)`)
    // NOTE: brand-framing checks ("daily deal" etc.) are intentionally NOT here.
    // They belong to the SEO repositioning phase + the seo/aeo auditors — a render
    // healthcheck must not roll back over code-level copy a Sanity rollback can't fix.
  } catch (err) {
    problems.push(`fetch error: ${err instanceof Error ? err.message : String(err)}`)
  }
  // Only a 5xx is "hard" — a state that restoring last-good Sanity content could
  // plausibly fix. A 200 that trips the render heuristics, a fetch/timeout error,
  // or a tiny body are infra/degradation issues a content rollback cannot repair.
  const hardFail = status >= 500
  const check: PageCheck = { path, status, ok: problems.length === 0, problems, bodyOk, hardFail }
  if (captured !== undefined) check.html = captured
  return check
}

/**
 * Retry a page check up to MAX_ATTEMPTS. A clean pass wins immediately; otherwise
 * we keep the least-broken attempt (fewest problems). This absorbs a single cold
 * Fluid-instance / transient-degraded self-fetch so it cannot trigger a spurious
 * destructive rollback.
 */
async function checkPage(path: string, opts: { captureHtml?: boolean } = {}): Promise<PageCheck> {
  let best: PageCheck | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const c = await checkPageOnce(path, attempt, opts)
    if (c.ok) return c
    if (!best || c.problems.length < best.problems.length) best = c
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
    }
  }
  return best as PageCheck
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Render truth
 *
 * WHY THIS EXISTS. Between 2026-07-24 and 07-26 one malformed Sanity rail
 * document made every team-published block on the homepage fall back to the
 * hardcoded shell defaults. The merchandising team published a full slate on
 * all three days and none of it reached the page. Every check above passed the
 * entire time, because they only ask "is this a valid page?": HTTP 200, a body,
 * an <img>, parseable JSON-LD. A page rendering fallback content is a
 * perfectly valid page. Nobody noticed until the owner did.
 *
 * renderTruth closes that blindness by asking a different question: "is the
 * content the team published the content a visitor is actually looking at?" It
 * loads the published slate and asserts those exact strings appear in the live
 * HTML, and it hard-fails when a shell fallback marker renders in a slot where
 * team content was published.
 *
 * Two layers, because the failure can happen in two different places:
 *   1. Sanity -> payload. The raw homepage doc has published sections but the
 *      precomputed payload B blob (what the server renders from) has none. This
 *      is the exact 07-24 signature: the projection died on one bad reference
 *      and the whole slate came back empty.
 *   2. Payload -> pixels. The blob carries the slate but the live HTML shows
 *      the fallbacks anyway (a section-filter regression, the wrong variant
 *      being served, a render bug).
 *
 * This never triggers the Sanity rollback. That path stays exactly as it was:
 * it fires only on a hard 5xx homepage, because restoring an old document can
 * only fix a content-shaped failure. A render-truth mismatch files a ticket.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How long after a Sanity publish a mismatch is treated as "still propagating"
 * rather than a failure. The real window is blob warm (~15 min cron cadence)
 * plus a 900s edge window plus a stale-while-revalidate tail, so 30 minutes is
 * the honest ceiling. Inside it renderTruth reports `skipped:'propagating'` and
 * files nothing; the next 30-minute tick is the one that judges the publish.
 */
export const RENDER_TRUTH_PROPAGATION_MS = 30 * 60_000
const RENDER_TRUTH_MAX_ATTEMPTS = 3
const RENDER_TRUTH_RETRY_BACKOFF_MS = 2000
/** Only the first N `emmaCuratedRail` blocks render (StorefrontHome MAX_TEAM_RAILS). */
const RENDERED_TEAM_RAILS = 4
const FINGERPRINT_KEY_PREFIX = 'homepage:render-truth:fingerprint'
/** Latest full verdict, read by the owner digest's "Homepage now" section.
 *  The fingerprint key above only carries slot hashes for the sameness
 *  check, which is not enough for a human-readable report. */
export const RENDER_TRUTH_LATEST_KEY = 'homepage:render-truth:latest'

/**
 * The hardcoded shell copy each slot falls back to when nothing is published.
 * Seeing one of these while the team HAS published into that slot is the
 * unambiguous "your content did not reach the page" signal. Kept in sync with
 * app/components/store/StorefrontHome.tsx (FindYourWayIn, PhotoBand, EmmasEdit).
 */
export const FALLBACK_MARKERS = {
  wayfinder: 'Find your way in.',
  couples: 'Better together.',
  rails: "Emma's edit",
} as const

export type RenderTruthSection = 'payload' | 'hero' | 'rails' | 'wayfinder' | 'couples'

export interface RenderTruthAssertion {
  section: RenderTruthSection
  /** What the team published and a visitor should therefore be seeing. */
  expected: string
  ok: boolean
  /** True when the shell's hardcoded default rendered in this slot instead. */
  fallbackRendered: boolean
  detail?: string
}

/** The slate the team published, as the live page should be reflecting it. */
export interface PublishedSlate {
  /** Hero pin resolved to a real product at build time (what actually renders). */
  heroHandle: string | null
  /** The handle the team asked to pin, whether or not it resolved. */
  heroHandleRequested: string | null
  railTitles: string[]
  wayfinderHeading: string | null
  tileHeadlines: string[]
  couplesHeading: string | null
  /** Sanity asset ids for the wayfinder tile images (freshness fingerprint). */
  tileImageIds: string[]
  couplesImageId: string | null
  /** How many team blocks the payload carries. 0 with a non-empty Sanity doc = layer-1 break. */
  publishedBlockCount: number
}

export type SlateFingerprint = Record<string, string>

export interface RenderTruthResult {
  ok: boolean
  /** Non-null when no judgement was made, with the reason. */
  skipped:
    | 'variant-not-b'
    | 'no-payload'
    | 'nothing-published'
    | 'no-html'
    | 'propagating'
    | null
  assertions: RenderTruthAssertion[]
  /** Published strings that are NOT on the live page. */
  missing: string[]
  /** Slots showing the shell fallback despite published content. */
  fallbacks: string[]
  slate: PublishedSlate | null
  fingerprint: SlateFingerprint
  /** Fresh slots byte-identical to yesterday's snapshot. */
  sameSlots: string[]
  /** Ticket ids filed by this run (0 entries mean deduped or write failed). */
  ticketIds: number[]
  message?: string
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '-', ndash: '-',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
}

/**
 * Reduce an HTML document to a comparable representation of its VISIBLE text.
 *
 * Three things make a naive `html.includes(heading)` wrong here, and all three
 * are load-bearing:
 *
 *  - `<script>` blocks are stripped FIRST and completely. A React Router
 *    document embeds the entire loader payload as inline JS, so every rail
 *    title the team published is already in the bytes whether or not a single
 *    pixel of it rendered. Matching against that would make this check pass
 *    exactly when it most needs to fail.
 *  - Headings render with an emphasis word wrapped in `<em>` ("Wetter, longer,
 *    <em>together</em>."), so the published string is split across elements.
 *  - React escapes apostrophes and quotes, so "Emma's edit" ships as
 *    "Emma&#x27;s edit", and editors type curly quotes.
 *
 * Whitespace is removed rather than collapsed: tag removal can join or split
 * words at arbitrary points, and a space-insensitive comparison is immune to
 * both. Exported for tests.
 */
export function normalizeRenderedText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, '')
}

/** Normalize an expected marker the same way the page text was normalized. */
export function normalizeMarker(marker: string): string {
  return decodeEntities(marker)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, '')
}

/** Strip scripts/styles only, for assertions that read attributes, not text. */
function stripScripts(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
}

/**
 * Sanity CDN URLs embed the asset id:
 * `https://cdn.sanity.io/images/<proj>/<ds>/<assetId>-1600x900.jpg`. The id is
 * what changes when the art director generates a new image, so it is the right
 * unit for the day-over-day freshness fingerprint (a re-crop of the same asset
 * is not a fresh image). Falls back to the whole URL for non-Sanity hosts.
 */
export function sanityAssetId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = /\/images\/[^/]+\/[^/]+\/([^/?#]+)/.exec(url)
  if (!m?.[1]) return url
  // Drop the `-<width>x<height>.<ext>` tail so a re-crop or a format swap of
  // the same source asset does not read as a fresh image.
  return m[1].replace(/-\d+x\d+\.[a-z0-9]+$/i, '')
}

interface LeanImage { url?: string | undefined; alt?: string | undefined }

/**
 * Read the published slate off the precomputed payload B blob, the exact
 * object the storefront renders from, so an assertion built here is an
 * assertion about what the server intended to show.
 */
export function extractPublishedSlate(payload: {
  pinnedProduct?: { handle?: string } | null
  emmaHero?: { featuredProductHandle?: string | null } | null
  contentBlocks?: { sections?: Array<{ _type: string }> }
}): PublishedSlate {
  const sections = payload.contentBlocks?.sections ?? []

  const rails = sections.filter(s => s._type === 'emmaCuratedRail') as EmmaCuratedRailBlock[]
  const wayfinder = sections.find(s => s._type === 'wayfinderMosaic') as WayfinderMosaicBlock | undefined
  const couples = sections.find(s => s._type === 'playTogetherBanner') as PlayTogetherBannerBlock | undefined

  const tiles = wayfinder?.wayfinderTiles ?? []
  const couplesImage = couples?.image as LeanImage | undefined

  return {
    heroHandle: payload.pinnedProduct?.handle ?? null,
    heroHandleRequested: payload.emmaHero?.featuredProductHandle?.trim() || null,
    railTitles: rails
      .slice(0, RENDERED_TEAM_RAILS)
      .map(r => (r.heading ?? '').trim())
      .filter(t => t.length > 0),
    wayfinderHeading: wayfinder?.heading?.trim() || null,
    tileHeadlines: tiles.map(t => (t.label ?? '').trim()).filter(t => t.length > 0),
    couplesHeading: couples?.heading?.trim() || null,
    tileImageIds: tiles
      .map(t => sanityAssetId((t.image as LeanImage | undefined)?.url))
      .filter((id): id is string => !!id),
    couplesImageId: sanityAssetId(couplesImage?.url),
    publishedBlockCount: sections.length,
  }
}

/**
 * Assert every published string is on the live page, and that no slot with
 * published content is showing the shell fallback instead.
 *
 * Pure: takes the slate and the HTML, returns assertions. Exported for tests.
 */
export function assertSlateRendered(slate: PublishedSlate, html: string): RenderTruthAssertion[] {
  const text = normalizeRenderedText(html)
  const attrs = stripScripts(html).toLowerCase()
  const out: RenderTruthAssertion[] = []
  const has = (marker: string) => text.includes(normalizeMarker(marker))

  // Hero. The pin renders as the LCP product's PDP link, so the handle appears
  // in an href rather than in body text.
  if (slate.heroHandleRequested && !slate.heroHandle) {
    out.push({
      section: 'hero',
      expected: slate.heroHandleRequested,
      ok: false,
      fallbackRendered: true,
      detail: 'pinned handle never resolved into the payload, so the hero is rotating, not pinned',
    })
  } else if (slate.heroHandle) {
    const handle = slate.heroHandle.toLowerCase()
    const ok = attrs.includes(`/products/${handle}"`) || attrs.includes(`/products/${handle}?`)
    const a: RenderTruthAssertion = {
      section: 'hero',
      expected: `/products/${slate.heroHandle}`,
      ok,
      fallbackRendered: !ok,
    }
    if (!ok) a.detail = 'pinned hero product is not linked anywhere on the page'
    out.push(a)
  }

  // Rails.
  const railsFellBack = slate.railTitles.length > 0 && has(FALLBACK_MARKERS.rails)
  for (const title of slate.railTitles) {
    const ok = has(title)
    const a: RenderTruthAssertion = {
      section: 'rails',
      expected: title,
      ok,
      fallbackRendered: !ok && railsFellBack,
    }
    if (!ok) {
      a.detail = railsFellBack
        ? `rail title missing and the shell "${FALLBACK_MARKERS.rails}" fallback rendered instead`
        : 'published rail title is not in the rendered page text'
    }
    out.push(a)
  }

  // Wayfinder mosaic: the band heading plus every published tile headline.
  const wayfinderPublished = !!slate.wayfinderHeading || slate.tileHeadlines.length > 0
  const wayfinderFellBack = wayfinderPublished && has(FALLBACK_MARKERS.wayfinder)
  const wayfinderExpected = [
    ...(slate.wayfinderHeading ? [slate.wayfinderHeading] : []),
    ...slate.tileHeadlines,
  ]
  for (const expected of wayfinderExpected) {
    const ok = has(expected)
    const a: RenderTruthAssertion = {
      section: 'wayfinder',
      expected,
      ok,
      fallbackRendered: !ok && wayfinderFellBack,
    }
    if (!ok) {
      a.detail = wayfinderFellBack
        ? `missing and the shell "${FALLBACK_MARKERS.wayfinder}" fallback rendered instead`
        : 'published wayfinder copy is not in the rendered page text'
    }
    out.push(a)
  }

  // Couples band.
  if (slate.couplesHeading) {
    const ok = has(slate.couplesHeading)
    const fellBack = !ok && has(FALLBACK_MARKERS.couples)
    const a: RenderTruthAssertion = {
      section: 'couples',
      expected: slate.couplesHeading,
      ok,
      fallbackRendered: fellBack,
    }
    if (!ok) {
      a.detail = fellBack
        ? `missing and the shell "${FALLBACK_MARKERS.couples}" fallback rendered instead`
        : 'published couples heading is not in the rendered page text'
    }
    out.push(a)
  }

  return out
}

/**
 * Fingerprint the slots the freshness rule designates as must-change daily.
 * Slots with nothing published fingerprint to '' and are excluded from the
 * sameness comparison, so "empty yesterday, empty today" never files a ticket
 * (that is the freshness gate's job, not this backstop's).
 */
export function fingerprintSlate(slate: PublishedSlate): SlateFingerprint {
  return {
    hero: slate.heroHandle ?? '',
    rails: slate.railTitles.join('|'),
    tiles: slate.tileImageIds.join('|'),
    couples: slate.couplesImageId ?? '',
  }
}

/**
 * Slots whose fingerprint is byte-identical across two days AND non-empty.
 * Two consecutive identical days is the signal the playbook's freshness rule
 * exists to prevent; this is its code-level backstop.
 */
export function compareFingerprints(
  today: SlateFingerprint,
  yesterday: SlateFingerprint | null | undefined,
): string[] {
  if (!yesterday) return []
  return Object.keys(today).filter(
    slot => today[slot] !== '' && today[slot] === yesterday[slot],
  )
}

/** UTC calendar day, the bucket the daily merchandise run publishes into. */
export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

function fingerprintKey(day: string): string {
  return `${FINGERPRINT_KEY_PREFIX}:${day}`
}

/**
 * Fetch the live homepage for render-truth, best of N. A clean pass wins
 * immediately; otherwise the least-broken body is used, same discipline as
 * checkPage. Reuses checkPageOnce so the cache-busting stays in one place: the
 * unique `__healthcheck` param forces a CDN MISS, which is what makes this an
 * assertion about the ORIGIN render rather than about whatever the edge happens
 * to be holding.
 */
async function fetchHomeHtml(): Promise<string | null> {
  let best: string | null = null
  for (let attempt = 1; attempt <= RENDER_TRUTH_MAX_ATTEMPTS; attempt++) {
    const c = await checkPageOnce('/', attempt, { captureHtml: true })
    if (c.html && c.bodyOk) return c.html
    if (c.html && !best) best = c.html
    if (attempt < RENDER_TRUTH_MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, RENDER_TRUTH_RETRY_BACKOFF_MS))
    }
  }
  return best
}

/**
 * The render-truth gate. Never throws: it runs inside a cron next to the
 * rollback path and must not be able to abort it.
 *
 * @param opts.html    Reuse an already-fetched homepage body (the healthcheck
 *                     has one) instead of paying for a second fetch.
 * @param opts.now     Injectable clock, for tests.
 * @param opts.fileTickets  Off for the release-engine smoke, which reports into
 *                     its own PR flow rather than the ticket queue.
 */
/**
 * Snapshot the latest verdict for the owner digest. Never throws: the digest
 * losing a section must not fail the healthcheck that produced it.
 */
async function persistLatestRenderTruth(result: RenderTruthResult): Promise<void> {
  try {
    await kvSet(RENDER_TRUTH_LATEST_KEY, { ...result, at: new Date().toISOString() })
  } catch (err) {
    console.warn('[render-truth] latest snapshot failed', err)
  }
}

export async function renderTruth(
  opts: { html?: string | undefined; now?: number; fileTickets?: boolean } = {},
): Promise<RenderTruthResult> {
  const now = opts.now ?? Date.now()
  const fileTickets = opts.fileTickets ?? true
  const base: RenderTruthResult = {
    ok: true,
    skipped: null,
    assertions: [],
    missing: [],
    fallbacks: [],
    slate: null,
    fingerprint: {},
    sameSlots: [],
    ticketIds: [],
  }

  try {
    // The published-slate surfaces below are variant b's. Variant a and legacy
    // render entirely different pages, so asserting storefront markers against
    // them would be nonsense, not a finding.
    const variant = await activeServedVariant()
    if (variant !== 'b') {
      return { ...base, skipped: 'variant-not-b', message: `homepage is serving variant ${variant}` }
    }

    const [payload, rawDoc] = await Promise.all([
      readHomepagePayloadB().catch(() => null),
      getHomepageDocRaw().catch(() => null),
    ])
    if (!payload) {
      return { ...base, skipped: 'no-payload', message: 'no precomputed payload B blob to assert against' }
    }

    const slate = extractPublishedSlate(payload)
    const fingerprint = fingerprintSlate(slate)

    // Propagation window. A publish inside the last 30 minutes has not
    // necessarily cleared blob warm + the edge window yet, and reporting that
    // as a failure would make the gate cry wolf on every good publish.
    const updatedAtRaw = rawDoc?.['_updatedAt']
    const updatedAt = typeof updatedAtRaw === 'string' ? Date.parse(updatedAtRaw) : NaN
    const propagating = Number.isFinite(updatedAt) && now - updatedAt < RENDER_TRUTH_PROPAGATION_MS

    // Layer 1: Sanity -> payload. Sections published but none reached the blob.
    const rawSections = Array.isArray(rawDoc?.['sections']) ? (rawDoc['sections'] as unknown[]) : []
    const assertions: RenderTruthAssertion[] = []
    if (rawSections.length > 0 && slate.publishedBlockCount === 0) {
      assertions.push({
        section: 'payload',
        expected: `${rawSections.length} published Sanity section(s) resolved into the homepage payload`,
        ok: false,
        fallbackRendered: true,
        detail:
          'the Sanity homepage doc has sections but payload B carries none, so every slot is rendering shell defaults. '
          + 'This is the 2026-07-24 signature: one malformed block kills the whole projection.',
      })
    }

    // Layer 2: payload -> pixels.
    let html = opts.html
    if (slate.publishedBlockCount > 0 || slate.heroHandleRequested) {
      if (!html) html = (await fetchHomeHtml()) ?? undefined
      if (!html) {
        return {
          ...base,
          slate,
          fingerprint,
          skipped: 'no-html',
          message: 'could not fetch the live homepage to assert against',
        }
      }
      assertions.push(...assertSlateRendered(slate, html))
    } else if (assertions.length === 0) {
      return {
        ...base,
        slate,
        fingerprint,
        skipped: 'nothing-published',
        message: 'no team content published, nothing to assert',
      }
    }

    // Sameness backstop: compare the designated fresh slots with yesterday's.
    const today = utcDay(now)
    const yesterday = utcDay(now - 86_400_000)
    let sameSlots: string[] = []
    try {
      const prior = await kvGet<SlateFingerprint>(fingerprintKey(yesterday))
      sameSlots = compareFingerprints(fingerprint, prior)
      await kvSet(fingerprintKey(today), fingerprint)
    } catch (err) {
      console.warn('[render-truth] fingerprint snapshot failed', err)
    }

    const failed = assertions.filter(a => !a.ok)
    const missing = failed.map(a => a.expected)
    const fallbacks = [...new Set(failed.filter(a => a.fallbackRendered).map(a => a.section))]
    const result: RenderTruthResult = {
      ...base,
      assertions,
      missing,
      fallbacks,
      slate,
      fingerprint,
      sameSlots,
      ok: failed.length === 0,
      skipped: propagating && failed.length > 0 ? 'propagating' : null,
    }
    if (propagating && failed.length > 0) {
      result.ok = true
      result.message =
        `${failed.length} assertion(s) failing but the Sanity doc changed `
        + `${Math.round((now - updatedAt) / 60_000)} min ago, inside the propagation window, so not reporting`
      await persistLatestRenderTruth(result)
      return result
    }

    if (fileTickets) {
      result.ticketIds = await fileRenderTruthTickets(failed, sameSlots, today, slate)
      // Close the sameness tickets for slots that DID change. The dedupe key is
      // undated on purpose ("one open conversation until the slot changes"),
      // but nothing ever ended the conversation, so an open row kept holding
      // the key and suppressed re-detection for that slot indefinitely. Four
      // slots were muted this way. Closing them here is what makes the undated
      // key safe.
      const changed = Object.keys(fingerprint).filter(
        slot => fingerprint[slot] !== '' && !sameSlots.includes(slot),
      )
      await closeStaleSamenessTickets(changed, today)
    }
    await persistLatestRenderTruth(result)
    return result
  } catch (err) {
    // A broken gate must never take down the healthcheck that hosts it.
    console.error('[render-truth] check failed (ignored)', err)
    return { ...base, message: `render-truth error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * One ticket per failing section (not per failing string), so a rail slate that
 * loses six titles at once is one conversation. Sameness files per slot.
 */
async function fileRenderTruthTickets(
  failed: RenderTruthAssertion[],
  sameSlots: string[],
  day: string,
  slate: PublishedSlate,
): Promise<number[]> {
  const ids: number[] = []
  const bySection = new Map<RenderTruthSection, RenderTruthAssertion[]>()
  for (const a of failed) {
    const list = bySection.get(a.section) ?? []
    list.push(a)
    bySection.set(a.section, list)
  }

  for (const [section, items] of bySection) {
    const lines = items.map(a => `- expected: ${a.expected}${a.detail ? ` (${a.detail})` : ''}`)
    ids.push(
      await fileDetectionTicket({
        detector: 'render-truth',
        // Dated: a render break on a specific day's slate is a distinct
        // incident from the same section breaking a week later. The scope
        // declares that, so canonicalization keeps the date instead of
        // stripping it as a recurring-signal mistake.
        dedupeKey: makeDedupeKey('render', section, day),
        dedupeScope: 'daily',
        priority: 1,
        category: 'agents',
        suggestion:
          `Render-truth FAILED on the homepage "${section}" slot (${day}).\n\n`
          + `The merchandising team published content that is not reaching the live page. `
          + `Published content that did not render:\n${lines.join('\n')}\n\n`
          + `Payload block count: ${slate.publishedBlockCount}. `
          + `Fix the publish-to-render path, then re-run /cron/homepage-healthcheck to confirm the markers appear.`,
        links: [{ kind: 'url', ref: `${siteOrigin()}/`, state: 'failed' }],
      }),
    )
  }

  for (const slot of sameSlots) {
    ids.push(
      await fileDetectionTicket({
        detector: 'render-truth',
        // Undated: one open conversation until the slot actually changes.
        dedupeKey: makeDedupeKey('sameness', slot),
        priority: 3,
        category: 'agents',
        kind: 'process',
        suggestion:
          `Homepage freshness: the "${slot}" slot is byte-identical to yesterday (${day}).\n\n`
          + `The merchandise routine's freshness rule designates this slot as must-change daily. `
          + `Two consecutive identical days means the run either reused the slot or never touched it. `
          + `Check the daily run's art-director step and the slot's reuse-first default.`,
      }),
    )
  }

  return ids
}

/**
 * End the conversation for slots that changed today.
 *
 * The sameness tickets use an undated dedupe key so a slot that stays stale
 * stays one row rather than accumulating one a day. The unique index that
 * enforces that excludes only `applied` and `dismissed`, so an open row holds
 * the key: once a sameness ticket was filed and never closed, the detector
 * could not file another one for that slot ever again. Four slots were silently
 * muted this way, which is the freshness alarm being off precisely when
 * merchandising most needed it.
 *
 * A slot that changed is self-evidently fixed, so its row is closed with
 * evidence rather than waiting for a human to notice a resolved alarm.
 */
async function closeStaleSamenessTickets(changedSlots: string[], day: string): Promise<void> {
  if (changedSlots.length === 0) return
  try {
    const { listSuggestions, transitionSuggestion } = await import('~/lib/team.server')
    const { makeDedupeKey } = await import('~/lib/detection-tickets.server')

    // Every close goes through the ALLOWED map, which team.server calls the
    // single arbiter of transition authority. The first version of this
    // function did a bulk db.update straight to 'applied', which walked two
    // edges the map forbids and skipped decided_by, the note link, and the
    // status guard. The map now carries a fenced `system` + `process` edge for
    // exactly this, so the arbiter stays the only place authority is defined.
    const keys = changedSlots.map(s => makeDedupeKey('sameness', s))
    const open = await listSuggestions({
      dedupeKeys: keys,
      kinds: ['process'],
      statuses: ['proposed', 'approved'],
    })

    const note =
      `Resolved ${day}: the slot changed, so the freshness rule is satisfied. `
      + 'Closed automatically by /cron/homepage-healthcheck.'

    const closed: number[] = []
    for (const row of open) {
      try {
        await transitionSuggestion(row.id, 'applied', 'system', { note })
        closed.push(row.id)
      } catch (err) {
        // transitionSuggestion throws rather than returning, and a 409 here
        // just means something else moved the row first. Per-row, so one slot
        // losing a race cannot stop the others from closing.
        if (String(err).includes('409')) continue
        console.warn(`[render-truth] could not close sameness ticket #${row.id} (ignored)`, err)
      }
    }

    if (closed.length > 0) {
      console.log(`[render-truth] closed ${closed.length} resolved sameness ticket(s): ${closed.map(id => `#${id}`).join(', ')}`)
    }
  } catch (err) {
    // Never let bookkeeping break the healthcheck that hosts it.
    console.warn('[render-truth] sameness ticket close failed (ignored)', err)
  }
}

/** Open (or comment on an existing) P0 GitHub issue. Self-contained REST call. */
/**
 * Returns the issue URL plus whether it was newly created. `created` is the
 * transition signal the owner-alert hook keys on: an ongoing outage comments
 * on the existing open issue every 30 min, and must not SMS every tick.
 */
async function openHealthcheckIssue(
  title: string,
  body: string,
): Promise<{ url: string | null; created: boolean }> {
  const token = process.env['GITHUB_TOKEN']
  const owner = process.env['GITHUB_OWNER']
  const repo = process.env['GITHUB_REPO']
  if (!token || !owner || !repo) {
    console.warn('[homepage-healthcheck] GITHUB_TOKEN/OWNER/REPO not set — skipping issue')
    return { url: null, created: false }
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
  try {
    const q = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open in:title "${title}"`)
    const search = await fetch(`https://api.github.com/search/issues?q=${q}`, { headers })
    const existing = search.ok
      ? (((await search.json()) as { items?: Array<{ number: number; html_url: string }> }).items ?? [])[0]
      : undefined
    if (existing) {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${existing.number}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body }),
      })
      return { url: existing.html_url, created: false }
    }
    const create = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, body, labels: ['healthcheck', 'P0'] }),
    })
    if (!create.ok) {
      console.error(`[homepage-healthcheck] issue create ${create.status}`)
      return { url: null, created: false }
    }
    return { url: ((await create.json()) as { html_url: string }).html_url, created: true }
  } catch (err) {
    console.error('[homepage-healthcheck] issue error', err)
    return { url: null, created: false }
  }
}

export async function runHomepageHealthcheck(): Promise<HomepageHealthResult> {
  // Capture the homepage body so render-truth can assert against the exact
  // document the render heuristics just graded, rather than re-fetching.
  const checks = await Promise.all(
    PATHS.map((p) => checkPage(p, p === '/' ? { captureHtml: true } : {})),
  )
  const healthy = checks.every((c) => c.ok)
  const home = checks.find((c) => c.path === '/')
  const homeHtml = home?.html
  // Never let a ~200 KB document ride along into the cron JSON response, the
  // Sentry extras, or the GitHub issue body.
  for (const c of checks) delete c.html

  // Render truth: is the team's published content actually on the page? Runs
  // regardless of the heuristics above, because the whole point is that a page
  // rendering fallback content passes every one of them. Never throws, and
  // deliberately does NOT feed the rollback decision below.
  const rt = await renderTruth({ html: homeHtml })
  if (!rt.ok) {
    Sentry.captureException(
      new Error(`Homepage render-truth failed. Missing: ${rt.missing.join(' | ')}`),
      {
        tags: { healthcheck: 'render-truth', severity: 'P1' },
        extra: {
          missing: rt.missing,
          fallbacks: rt.fallbacks,
          slate: rt.slate,
          tickets: rt.ticketIds,
        },
      },
    )
  }

  // Refresh the last-good snapshot whenever the homepage is genuinely serving
  // real content (HTTP 200 + real body), even if a render heuristic is being
  // flaky on this self-fetch. This keeps last-good current instead of freezing it
  // at a stale revision a later rollback would wrongly restore over team content.
  if (home?.bodyOk) {
    try {
      const doc = await getHomepageDocRaw()
      if (doc) await kvSet(LAST_GOOD_KEY, doc)
    } catch (err) {
      console.warn('[homepage-healthcheck] last-good snapshot failed', err)
    }
  }

  if (healthy) {
    // A render-truth failure is a real failure even when every render heuristic
    // passed. That is the entire point: for three days in July the heuristics
    // all passed while the published slate reached nobody. It reports 503 from
    // the cron route and files a ticket, but it never rolls anything back.
    return {
      ok: rt.ok,
      checks,
      action: 'snapshot',
      rolledBack: false,
      alerted: !rt.ok,
      renderTruth: rt,
      ...(rt.ok ? {} : { message: `render-truth failed: ${rt.missing.join(' | ')}` }),
    }
  }

  const failed = checks.filter((c) => !c.ok)
  const summary = failed.map((c) => `${c.path}: ${c.problems.join('; ')}`).join(' | ')
  // Roll back ONLY on a hard (5xx) homepage failure. A homepage that returns 200
  // but trips the render heuristics is not a Sanity-content failure — restoring an
  // old doc cannot add a missing hero image, and doing so would silently wipe the
  // merchandising team's published rails/notebook. Those cases alert, never roll back.
  const homeHardBroken = !!home?.hardFail
  const result: HomepageHealthResult = {
    ok: false,
    checks,
    action: homeHardBroken ? 'rollback' : 'alert',
    rolledBack: false,
    alerted: false,
    renderTruth: rt,
  }

  if (homeHardBroken) {
    try {
      const lastGood = await kvGet<Record<string, unknown>>(LAST_GOOD_KEY)
      const valid =
        !!lastGood &&
        lastGood['_type'] === 'homepageSections' &&
        Array.isArray(lastGood['sections'])
      if (valid) {
        // Bust the payload + Sanity KV caches FIRST so any request during
        // recovery falls back to live assembly (which reads the rolled-back
        // Sanity doc), then restore and re-warm the payload the live variant
        // actually serves. (The edge CDN is still eventually-consistent —
        // ~60s — there's no purge API to force sooner.)
        await Promise.all([
          invalidateHomepagePayloadA().catch(() => {}),
          invalidateHomepagePayloadB().catch(() => {}),
        ])
        invalidateCmsCache()
        await restoreHomepageDoc(lastGood as Record<string, unknown>)
        const servedVariant = await activeServedVariant()
        if (servedVariant === 'b') {
          // Variant b is precomputed too now, so a rollback has to rebuild its
          // blob against the restored doc. Without this the storefront would
          // keep serving the bad content out of KV/Neon until the next warm,
          // which is exactly the window the rollback exists to close.
          const { warmHomepagePayloadB } = await import('~/lib/storefront-home.server')
          await warmHomepagePayloadB({ force: true }).catch((e) =>
            console.error('[homepage-healthcheck] storefront payload rewarm failed', e),
          )
        } else {
          await warmHomepagePayloadA({ force: true }).catch((e) =>
            console.error('[homepage-healthcheck] payload rewarm failed', e),
          )
        }
        result.rolledBack = true
      } else {
        result.message = lastGood
          ? 'last-good snapshot is malformed — skipping rollback'
          : 'no last-good snapshot available to roll back to'
      }
    } catch (err) {
      result.message = `rollback failed: ${err instanceof Error ? err.message : String(err)}`
    }
  } else if (home && !home.ok) {
    result.message =
      'homepage returned 200 but tripped render heuristics — not a Sanity-content failure; alerting without rollback'
  } else {
    result.message = 'non-homepage page unhealthy; no homepage rollback applicable'
  }

  // A hard (5xx) failure or an actual rollback is a real P0. A soft 200-degradation
  // (render heuristic tripped on the self-fetch) is worth a lower-severity Sentry
  // breadcrumb but must NOT spam a P0 GitHub issue every 30 min.
  const isP0 = homeHardBroken || result.rolledBack
  Sentry.captureException(
    new Error(`Homepage healthcheck ${isP0 ? 'failed' : 'soft-degraded'} — ${summary}`),
    {
      tags: { healthcheck: 'homepage', severity: isP0 ? 'P0' : 'P2' },
      extra: { checks, rolledBack: result.rolledBack, note: result.message },
    },
  )
  result.alerted = true
  if (isP0) {
    const issueBody = [
      `Homepage healthcheck failed against ${siteOrigin()}.`,
      '',
      '**Problems**',
      summary,
      '',
      `**Auto-recovery:** ${
        result.rolledBack
          ? 'rolled the Sanity homepage doc back to last-good and re-warmed the payload for the live variant.'
          : result.message ?? 'none'
      }`,
      '',
      '_Filed automatically by `/cron/homepage-healthcheck`._',
    ].join('\n')
    const issue = await openHealthcheckIssue('[P0] Homepage healthcheck failing', issueBody)
    if (issue.url) result.message = `${result.message ? result.message + ' · ' : ''}issue: ${issue.url}`
    // Owner alert only on the transition (newly created issue), never on the
    // every-30-min recurrence comments. Both senders are non-throwing.
    if (issue.created) {
      const { sendOwnerSms, sendOwnerEmail, escapeHtml } = await import('~/lib/owner-alerts.server')
      await sendOwnerSms(`xdipx P0: homepage healthcheck failing. ${summary}`)
      await sendOwnerEmail(
        '[P0] xdipx homepage healthcheck failing',
        `<pre style="font-family:monospace;white-space:pre-wrap;">${escapeHtml(issueBody)}</pre>${issue.url ? `<p><a href="${issue.url}">${issue.url}</a></p>` : ''}`,
      )
    }
  }

  return result
}
