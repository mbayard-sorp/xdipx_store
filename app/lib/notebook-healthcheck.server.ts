/**
 * Notebook render healthcheck (run on a cron — see server/cron.ts).
 *
 * Fetches the live `/notebook` index, the latest post, one category page, and
 * the latest post's `.md` twin, asserting each renders cleanly: HTTP 200, a
 * non-trivial body, at least one image, and valid JSON-LD (BlogPosting on the
 * post, ItemList on the index). The twin must serve `text/markdown`.
 *
 * REPORT-ONLY by design: unlike the homepage healthcheck there is no Sanity
 * rollback — the Notebook has no auto-publish path whose bad publish a
 * rollback would undo (daily posts are already voice-gated before publish).
 * Failures alert Sentry; a hard 5xx also opens/updates a P1 GitHub issue.
 *
 * Server-only.
 */
import { Sentry } from '~/lib/sentry.server'
import { getBlogPostsForSitemap, getBlogCategories } from '~/lib/sanity.server'

const FETCH_TIMEOUT_MS = 12_000
const MIN_BODY_BYTES = 1000
// Self-fetches can hit a cold instance; retry and keep the least-broken result
// so a transient degraded render never pages anyone.
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = 1500

export interface NotebookPageCheck {
  path: string
  status: number
  ok: boolean
  problems: string[]
  hardFail: boolean
}

export interface NotebookHealthResult {
  ok: boolean
  checks: NotebookPageCheck[]
  alerted: boolean
  message?: string
}

function siteOrigin(): string {
  const base =
    process.env['BASE_URL'] ||
    (process.env['VERCEL_URL'] ? `https://${process.env['VERCEL_URL']}` : '')
  return base.replace(/\/$/, '') || 'https://xdipx.com'
}

function extractJsonLd(html: string): { parsed: number; scripts: number; types: string[] } {
  let parsed = 0
  let scripts = 0
  const types: string[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    scripts += 1
    try {
      const json = JSON.parse((m[1] ?? '').trim()) as { '@type'?: string | string[] }
      parsed += 1
      const t = json['@type']
      if (typeof t === 'string') types.push(t)
      else if (Array.isArray(t)) types.push(...t)
    } catch {
      /* unparseable block — flagged via parsed < scripts */
    }
  }
  return { parsed, scripts, types }
}

interface PageExpectation {
  path: string
  /** JSON-LD @type that must appear on the page. */
  expectType?: string
  /** Expect a markdown twin instead of an HTML document. */
  markdown?: boolean
}

async function checkPageOnce(exp: PageExpectation, attempt: number): Promise<NotebookPageCheck> {
  // Cache-bust per attempt so the check exercises the origin render, not a
  // stale/truncated CDN entry (same reasoning as the homepage healthcheck).
  const bust = `__healthcheck=${Date.now()}-${attempt}`
  const url = `${siteOrigin()}${exp.path}${exp.path.includes('?') ? '&' : '?'}${bust}`
  const problems: string[] = []
  let status = 0
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: { 'user-agent': 'xdipx-notebook-healthcheck' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    status = res.status
    const body = await res.text()

    if (status !== 200) problems.push(`HTTP ${status}`)

    if (exp.markdown) {
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('text/markdown')) problems.push(`content-type "${ct}" is not text/markdown`)
      if (body.length < 200) problems.push(`markdown body too small (${body.length} bytes)`)
    } else {
      if (body.length < MIN_BODY_BYTES) problems.push(`body too small (${body.length} bytes)`)
      if (!/<img[\s>]/i.test(body)) problems.push('no <img> (hero/card images likely missing)')
      if (!/<\/html>/i.test(body)) problems.push('truncated HTML (no </html> — stream cut off)')
      const { parsed, scripts, types } = extractJsonLd(body)
      if (parsed === 0) problems.push('no valid JSON-LD')
      else if (parsed < scripts) problems.push(`malformed JSON-LD (${scripts - parsed} unparseable)`)
      if (exp.expectType && !types.includes(exp.expectType)) {
        problems.push(`JSON-LD missing @type ${exp.expectType}`)
      }
    }
  } catch (err) {
    problems.push(`fetch error: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { path: exp.path, status, ok: problems.length === 0, problems, hardFail: status >= 500 }
}

async function checkPage(exp: PageExpectation): Promise<NotebookPageCheck> {
  let best: NotebookPageCheck | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const c = await checkPageOnce(exp, attempt)
    if (c.ok) return c
    if (!best || c.problems.length < best.problems.length) best = c
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
    }
  }
  return best as NotebookPageCheck
}

/** Open (or comment on an existing) GitHub issue. Self-contained REST call. */
async function openHealthcheckIssue(title: string, body: string): Promise<string | null> {
  const token = process.env['GITHUB_TOKEN']
  const owner = process.env['GITHUB_OWNER']
  const repo = process.env['GITHUB_REPO']
  if (!token || !owner || !repo) {
    console.warn('[notebook-healthcheck] GITHUB_TOKEN/OWNER/REPO not set — skipping issue')
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
      body: JSON.stringify({ title, body, labels: ['healthcheck', 'P1'] }),
    })
    if (!create.ok) {
      console.error(`[notebook-healthcheck] issue create ${create.status}`)
      return null
    }
    return ((await create.json()) as { html_url: string }).html_url
  } catch (err) {
    console.error('[notebook-healthcheck] issue error', err)
    return null
  }
}

export async function runNotebookHealthcheck(): Promise<NotebookHealthResult> {
  // Resolve a live post + category so the check follows the real content set.
  const [posts, categories] = await Promise.all([
    getBlogPostsForSitemap().catch(() => []),
    getBlogCategories().catch(() => []),
  ])
  const latestSlug = posts[0]?.slug
  const categorySlug = categories[0]?.slug

  const expectations: PageExpectation[] = [
    { path: '/notebook', expectType: 'ItemList' },
    ...(latestSlug
      ? [
          { path: `/notebook/${latestSlug}`, expectType: 'BlogPosting' },
          { path: `/notebook/${latestSlug}.md`, markdown: true },
        ]
      : []),
    ...(categorySlug ? [{ path: `/notebook/category/${categorySlug}` }] : []),
  ]

  const checks = await Promise.all(expectations.map(checkPage))
  const healthy = checks.every((c) => c.ok)
  if (healthy) {
    return { ok: true, checks, alerted: false }
  }

  const failed = checks.filter((c) => !c.ok)
  const summary = failed.map((c) => `${c.path}: ${c.problems.join('; ')}`).join(' | ')
  const hard = failed.some((c) => c.hardFail)

  Sentry.captureException(
    new Error(`Notebook healthcheck ${hard ? 'failed' : 'soft-degraded'} — ${summary}`),
    {
      tags: { healthcheck: 'notebook', severity: hard ? 'P1' : 'P3' },
      extra: { checks },
    },
  )

  const result: NotebookHealthResult = { ok: false, checks, alerted: true }
  if (hard) {
    const issueBody = [
      `Notebook healthcheck failed against ${siteOrigin()}.`,
      '',
      '**Problems**',
      summary,
      '',
      '_Report-only check (no auto-recovery). Filed automatically by `/cron/notebook-healthcheck`._',
    ].join('\n')
    const issueUrl = await openHealthcheckIssue('[P1] Notebook healthcheck failing', issueBody)
    if (issueUrl) result.message = `issue: ${issueUrl}`
  }
  return result
}
