/**
 * Merchandised-pages healthcheck (category pages, drop pages, panel deck).
 *
 * Runs inside the existing /cron/homepage-healthcheck handler (see
 * server/cron.ts) — no schedule of its own, no vercel.json change. For every
 * categoryPage/dropPage doc that is status:'live' it fetches the live surface
 * and asserts the merchandised layer actually rendered: HTTP 200, untruncated
 * HTML, the masthead block marker present (a live doc rendering the fallback
 * collection page is the failure this check exists to catch), and at most one
 * FAQPage JSON-LD node. When the homepage payload carries a panel deck AND the
 * layout places it enabled, the deck's markers are asserted on the variant-b
 * homepage too.
 *
 * REPORT-ONLY by design, like the Notebook healthcheck: there is no rollback
 * path here (category publishes are already gate-checked by the routine, and
 * unpublishing a doc IS the rollback). Failures alert Sentry and file deduped
 * improvement-bus tickets; a hard 5xx escalates to P1. This check is NEVER
 * part of runReleaseSmoke() — a broken category page must not block or revert
 * an unrelated deploy.
 *
 * Freshness caveat: pages are cached (TTL + edge window, and cached() stores
 * negative results), so this check runs against what visitors actually see,
 * minutes behind Sanity. That is the point — it asserts the served truth, not
 * the CMS truth.
 *
 * Server-only.
 */
import { Sentry } from '~/lib/sentry.server'
import { getClient } from '~/lib/sanity.server'
import { readHomepagePayloadB } from '~/lib/homepage-payload.server'
import { kvSet } from '~/lib/kv.server'

/** Latest sweep verdict, read by the admin "Merchandised pages" panel. */
export const CATEGORY_HEALTH_LATEST_KEY = 'category-pages:healthcheck:latest'

/** Snapshot the latest verdict for the admin panel. Never throws. */
async function persistLatest(result: CategoryHealthResult): Promise<void> {
  try {
    await kvSet(CATEGORY_HEALTH_LATEST_KEY, { ...result, at: new Date().toISOString() })
  } catch (err) {
    console.warn('[category-healthcheck] latest snapshot failed', err)
  }
}

const FETCH_TIMEOUT_MS = 12_000
const MIN_BODY_BYTES = 1000
// Self-fetches can hit a cold instance; retry and keep the least-broken result
// so a transient degraded render never pages anyone.
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 1500

export interface CategoryPageCheck {
  path: string
  /** What this path is: a category aisle, a drop surface, or the deck. */
  surface: 'category' | 'drop' | 'deck'
  status: number
  ok: boolean
  problems: string[]
  hardFail: boolean
}

export interface CategoryHealthResult {
  ok: boolean
  /** Live docs found (0 checks + ok:true = nothing published yet, healthy). */
  liveDocs: number
  checks: CategoryPageCheck[]
  alerted: boolean
  /** Improvement-bus ticket ids filed for failing pages (0 = deduped/failed). */
  ticketsFiled?: number[]
}

function siteOrigin(): string {
  const base =
    process.env['BASE_URL'] ||
    (process.env['VERCEL_URL'] ? `https://${process.env['VERCEL_URL']}` : '')
  return base.replace(/\/$/, '') || 'https://xdipx.com'
}

function countJsonLdType(html: string, type: string): number {
  let count = 0
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const json = JSON.parse((m[1] ?? '').trim()) as { '@type'?: string | string[] }
      const t = json['@type']
      if (t === type || (Array.isArray(t) && t.includes(type))) count += 1
    } catch {
      /* unparseable blocks are the homepage/notebook checks' concern */
    }
  }
  return count
}

interface PageExpectation {
  path: string
  surface: CategoryPageCheck['surface']
  /** data-block / data-panel markers that must appear in the served HTML. */
  markers: string[]
}

async function checkPageOnce(exp: PageExpectation, attempt: number): Promise<CategoryPageCheck> {
  // Cache-bust per attempt so retries exercise the origin render, not a
  // stale/truncated CDN entry (same reasoning as the other healthchecks).
  const bust = `__healthcheck=${Date.now()}-${attempt}`
  const url = `${siteOrigin()}${exp.path}${exp.path.includes('?') ? '&' : '?'}${bust}`
  const problems: string[] = []
  let status = 0
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: { 'user-agent': 'xdipx-category-healthcheck' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    status = res.status
    const body = await res.text()

    if (status !== 200) problems.push(`HTTP ${status}`)
    if (body.length < MIN_BODY_BYTES) problems.push(`body too small (${body.length} bytes)`)
    if (!/<\/html>/i.test(body)) problems.push('truncated HTML (no </html> — stream cut off)')

    for (const marker of exp.markers) {
      if (!body.includes(marker)) {
        problems.push(`missing ${marker} (merchandised layer not rendering — fallback served)`)
      }
    }

    if (exp.surface !== 'deck') {
      const faqNodes = countJsonLdType(body, 'FAQPage')
      if (faqNodes > 1) problems.push(`${faqNodes} FAQPage JSON-LD nodes (must dedupe to one)`)
    }
  } catch (err) {
    problems.push(`fetch error: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { path: exp.path, surface: exp.surface, status, ok: problems.length === 0, problems, hardFail: status >= 500 }
}

async function checkPage(exp: PageExpectation): Promise<CategoryPageCheck> {
  let best: CategoryPageCheck | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const c = await checkPageOnce(exp, attempt)
    if (c.ok) return c
    if (!best || c.problems.length < best.problems.length) best = c
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
    }
  }
  return best as CategoryPageCheck
}

interface LiveDocs {
  categories: string[]
  drops: ('new' | 'on-sale')[]
}

async function fetchLiveDocs(): Promise<LiveDocs> {
  const client = getClient(false)
  if (!client) return { categories: [], drops: [] }
  try {
    const rows = await client.fetch<{
      categories?: (string | null)[]
      drops?: (string | null)[]
    }>(
      `{
        "categories": *[_type == "categoryPage" && status == "live"].shopifyCollectionHandle,
        "drops": *[_type == "dropPage" && status == "live"].routeKey,
      }`,
    )
    return {
      categories: (rows?.categories ?? []).filter((h): h is string => typeof h === 'string' && h.length > 0),
      drops: (rows?.drops ?? []).filter((r): r is 'new' | 'on-sale' => r === 'new' || r === 'on-sale'),
    }
  } catch (err) {
    console.error('[category-healthcheck] live-doc query failed:', err)
    return { categories: [], drops: [] }
  }
}

export async function runCategoryHealthcheck(): Promise<CategoryHealthResult> {
  const { categories, drops } = await fetchLiveDocs()

  const expectations: PageExpectation[] = [
    ...categories.map((handle): PageExpectation => ({
      path: `/collections/${handle}`,
      surface: 'category',
      markers: ['data-block="categoryMasthead"'],
    })),
    ...drops.map((routeKey): PageExpectation => ({
      path: routeKey === 'new' ? '/new' : '/collections/on-sale',
      surface: 'drop',
      markers: ['data-block="dropMasthead"'],
    })),
  ]

  // Deck render-truth, conditional: assert only when the payload actually
  // carries a deck AND the published layout places it enabled. Before the
  // two-key flip both are absent and the deck is (correctly) invisible —
  // asserting then would fail every run for the wrong reason.
  try {
    const payload = await readHomepagePayloadB()
    const deckPlaced = (payload?.layout?.sections ?? []).some(
      (s) => s._type === 'panelDeckSection' && s.enabled !== false,
    )
    if (payload?.panelDeck && deckPlaced) {
      expectations.push({
        // ?variant=b pins the storefront render so the assertion holds whatever
        // the served default is mid-rollout.
        path: '/?variant=b',
        surface: 'deck',
        markers: ['data-panel='],
      })
    }
  } catch (err) {
    console.warn('[category-healthcheck] payload read failed (deck check skipped):', err)
  }

  const liveDocs = categories.length + drops.length
  if (expectations.length === 0) {
    // Nothing published yet — healthy by definition, and the honest zero keeps
    // the admin panel from reading "all green" as "all covered".
    const empty: CategoryHealthResult = { ok: true, liveDocs, checks: [], alerted: false }
    await persistLatest(empty)
    return empty
  }

  const checks = await Promise.all(expectations.map(checkPage))
  const healthy = checks.every((c) => c.ok)
  if (healthy) {
    const green: CategoryHealthResult = { ok: true, liveDocs, checks, alerted: false }
    await persistLatest(green)
    return green
  }

  const failed = checks.filter((c) => !c.ok)
  const summary = failed.map((c) => `${c.path}: ${c.problems.join('; ')}`).join(' | ')
  const hard = failed.some((c) => c.hardFail)

  Sentry.captureException(
    new Error(`Category healthcheck ${hard ? 'failed' : 'soft-degraded'} — ${summary}`),
    {
      tags: { healthcheck: 'category-pages', severity: hard ? 'P1' : 'P3' },
      extra: { checks },
    },
  )

  const result: CategoryHealthResult = { ok: false, liveDocs, checks, alerted: true }

  // Ticket each failing page onto the improvement bus, deduped per path so a
  // page that stays broken across daily runs stays one ticket. Wrapped so a
  // failed write can never suppress the Sentry capture above.
  try {
    const { fileDetectionTicket, makeDedupeKey, priorityFromSeverity } =
      await import('~/lib/detection-tickets.server')
    result.ticketsFiled = []
    for (const c of failed) {
      result.ticketsFiled.push(
        await fileDetectionTicket({
          detector: 'category-healthcheck',
          dedupeKey: makeDedupeKey('category-page', c.path),
          priority: priorityFromSeverity(c.hardFail ? 'P1' : 'P3'),
          category: 'other',
          kind: 'code',
          suggestion:
            `Merchandised-page healthcheck failing on ${c.path} (HTTP ${c.status}).\n\n`
            + `Problems:\n${c.problems.map((p) => `- ${p}`).join('\n')}\n\n`
            + `Detected inside /cron/homepage-healthcheck against ${siteOrigin()}. `
            + 'If the masthead marker is missing, the live Sanity doc is not reaching the page: '
            + 'check the category resolver logs, then the doc itself. Unpublishing the doc '
            + '(status back to draft) is the rollback. Re-run the cron to confirm.',
          links: [{ kind: 'url', ref: `${siteOrigin()}${c.path}`, state: 'failed' }],
        }),
      )
    }
  } catch (err) {
    console.error('[category-healthcheck] ticket filing failed (ignored):', err)
  }

  await persistLatest(result)
  return result
}
