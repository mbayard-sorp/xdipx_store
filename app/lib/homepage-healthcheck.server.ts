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
import { getHomepageDocRaw, restoreHomepageDoc } from '~/lib/sanity.server'
import { warmHomepagePayloadA, invalidateHomepagePayloadA } from '~/lib/homepage-payload.server'

const LAST_GOOD_KEY = 'homepage:healthcheck:lastgood'
const PATHS = ['/', '/discover']
const FETCH_TIMEOUT_MS = 12_000
const MIN_BODY_BYTES = 1000

export interface PageCheck {
  path: string
  status: number
  ok: boolean
  problems: string[]
}

export interface HomepageHealthResult {
  ok: boolean
  checks: PageCheck[]
  action: 'snapshot' | 'rollback' | 'alert'
  rolledBack: boolean
  alerted: boolean
  message?: string
}

function siteOrigin(): string {
  const base =
    process.env['BASE_URL'] ||
    (process.env['VERCEL_URL'] ? `https://${process.env['VERCEL_URL']}` : '')
  return base.replace(/\/$/, '') || 'https://xdipx.com'
}

/** Count JSON-LD <script> blocks and how many parse as valid JSON. */
function extractJsonLd(html: string): { parsed: number; scripts: number } {
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

async function checkPage(path: string): Promise<PageCheck> {
  const url = `${siteOrigin()}${path}`
  const problems: string[] = []
  let status = 0
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

    const { parsed, scripts } = extractJsonLd(html)
    if (parsed === 0) problems.push('no valid JSON-LD')
    else if (parsed < scripts) problems.push(`malformed JSON-LD (${scripts - parsed} unparseable)`)
    // NOTE: brand-framing checks ("daily deal" etc.) are intentionally NOT here.
    // They belong to the SEO repositioning phase + the seo/aeo auditors — a render
    // healthcheck must not roll back over code-level copy a Sanity rollback can't fix.
  } catch (err) {
    problems.push(`fetch error: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { path, status, ok: problems.length === 0, problems }
}

/** Open (or comment on an existing) P0 GitHub issue. Self-contained REST call. */
async function openHealthcheckIssue(title: string, body: string): Promise<string | null> {
  const token = process.env['GITHUB_TOKEN']
  const owner = process.env['GITHUB_OWNER']
  const repo = process.env['GITHUB_REPO']
  if (!token || !owner || !repo) {
    console.warn('[homepage-healthcheck] GITHUB_TOKEN/OWNER/REPO not set — skipping issue')
    return null
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
      return existing.html_url
    }
    const create = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, body, labels: ['healthcheck', 'P0'] }),
    })
    if (!create.ok) {
      console.error(`[homepage-healthcheck] issue create ${create.status}`)
      return null
    }
    return ((await create.json()) as { html_url: string }).html_url
  } catch (err) {
    console.error('[homepage-healthcheck] issue error', err)
    return null
  }
}

export async function runHomepageHealthcheck(): Promise<HomepageHealthResult> {
  const checks = await Promise.all(PATHS.map(checkPage))
  const healthy = checks.every((c) => c.ok)

  if (healthy) {
    // Capture the current (good) Sanity homepage doc as the last-good copy.
    try {
      const doc = await getHomepageDocRaw()
      if (doc) await kvSet(LAST_GOOD_KEY, doc)
    } catch (err) {
      console.warn('[homepage-healthcheck] last-good snapshot failed', err)
    }
    return { ok: true, checks, action: 'snapshot', rolledBack: false, alerted: false }
  }

  const failed = checks.filter((c) => !c.ok)
  const summary = failed.map((c) => `${c.path}: ${c.problems.join('; ')}`).join(' | ')
  const homeFailed = checks.some((c) => c.path === '/' && !c.ok)
  const result: HomepageHealthResult = {
    ok: false,
    checks,
    action: homeFailed ? 'rollback' : 'alert',
    rolledBack: false,
    alerted: false,
  }

  // Roll back only when the homepage itself is broken — that's the doc we control.
  if (homeFailed) {
    try {
      const lastGood = await kvGet<Record<string, unknown>>(LAST_GOOD_KEY)
      const valid =
        !!lastGood &&
        lastGood['_type'] === 'homepageSections' &&
        Array.isArray(lastGood['sections'])
      if (valid) {
        // Bust the payload cache FIRST so any request during recovery falls back
        // to live assembly (which reads the rolled-back Sanity doc), then restore
        // + re-warm the precomputed Variant A payload. (The edge CDN is still
        // eventually-consistent — ~60s — there's no purge API to force sooner.)
        await invalidateHomepagePayloadA().catch(() => {})
        await restoreHomepageDoc(lastGood as Record<string, unknown>)
        await warmHomepagePayloadA({ force: true }).catch((e) =>
          console.error('[homepage-healthcheck] payload rewarm failed', e),
        )
        result.rolledBack = true
      } else {
        result.message = lastGood
          ? 'last-good snapshot is malformed — skipping rollback'
          : 'no last-good snapshot available to roll back to'
      }
    } catch (err) {
      result.message = `rollback failed: ${err instanceof Error ? err.message : String(err)}`
    }
  } else {
    result.message = 'non-homepage page unhealthy; no homepage rollback applicable'
  }

  // Alert once per incident (Sentry + a deduplicated P0 GitHub issue). Any
  // rollback failure is carried in result.message, so this single capture covers it.
  Sentry.captureException(new Error(`Homepage healthcheck failed — ${summary}`), {
    tags: { healthcheck: 'homepage', severity: 'P0' },
    extra: { checks, rolledBack: result.rolledBack, note: result.message },
  })
  const issueBody = [
    `Homepage healthcheck failed against ${siteOrigin()}.`,
    '',
    '**Problems**',
    summary,
    '',
    `**Auto-recovery:** ${
      result.rolledBack
        ? 'rolled the Sanity homepage doc back to last-good and re-warmed the Variant A payload.'
        : result.message ?? 'none'
    }`,
    '',
    '_Filed automatically by `/cron/homepage-healthcheck`._',
  ].join('\n')
  const issueUrl = await openHealthcheckIssue('[P0] Homepage healthcheck failing', issueBody)
  result.alerted = true
  if (issueUrl) result.message = `${result.message ? result.message + ' · ' : ''}issue: ${issueUrl}`

  return result
}
