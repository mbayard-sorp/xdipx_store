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
} from '~/lib/homepage-payload.server'

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
export async function checkPageOnce(path: string, attempt: number): Promise<PageCheck> {
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
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: { 'user-agent': 'xdipx-homepage-healthcheck' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    status = res.status
    const html = await res.text()

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
  return { path, status, ok: problems.length === 0, problems, bodyOk, hardFail }
}

/**
 * Retry a page check up to MAX_ATTEMPTS. A clean pass wins immediately; otherwise
 * we keep the least-broken attempt (fewest problems). This absorbs a single cold
 * Fluid-instance / transient-degraded self-fetch so it cannot trigger a spurious
 * destructive rollback.
 */
async function checkPage(path: string): Promise<PageCheck> {
  let best: PageCheck | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const c = await checkPageOnce(path, attempt)
    if (c.ok) return c
    if (!best || c.problems.length < best.problems.length) best = c
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
    }
  }
  return best as PageCheck
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
  const checks = await Promise.all(PATHS.map(checkPage))
  const healthy = checks.every((c) => c.ok)
  const home = checks.find((c) => c.path === '/')

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
    return { ok: true, checks, action: 'snapshot', rolledBack: false, alerted: false }
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
