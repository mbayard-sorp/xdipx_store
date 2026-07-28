/**
 * GET  /api/team/pr?number=N
 * POST /api/team/pr  { op: 'preview-fetch', number, path, markers?, excerptChars? }
 *
 * The GitHub gateway for agents. Cloud routines are egress-restricted to
 * xdipx.com, so they cannot call api.github.com or a preview deployment
 * directly. This route does both server-side on Vercel, where the tokens live,
 * and hands back only what a QA routine needs to make a call.
 *
 * GET returns head SHA, changed files, check conclusions, mergeable state, the
 * preview URL, and the protected-path classification. The classification is
 * computed from the GitHub changed-file list only, never from PR text.
 *
 * POST 'preview-fetch' renders-by-proxy: it fetches one path of the PR's Vercel
 * preview (adding the automation bypass header when the project is protected)
 * and returns status, byte size, extracted markers, and a bounded excerpt.
 * Never the whole document: a 400 KB homepage would eat a routine's context for
 * no benefit.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import {
  classifyChangedFiles,
  findPreviewUrl,
  getChecksForRef,
  getPullRequest,
  isGithubConfigured,
  listPullRequestFiles,
  sanitizePreviewPath,
} from '~/lib/github.server'

const CONTEXT = 'api/team/pr'
/** Hard read cap on a preview response. Anything past this is not inspected. */
const MAX_PREVIEW_BYTES = 2_000_000
const DEFAULT_EXCERPT_CHARS = 1200
const MAX_EXCERPT_CHARS = 4000
const MAX_FILES_RETURNED = 300
const PREVIEW_TIMEOUT_MS = 25_000

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function parseNumber(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

export interface PreviewMarkers {
  title: string | null
  canonical: string | null
  h1: string[]
  imgCount: number
  jsonLdBlocks: number
  jsonLdParsed: number
  htmlClosed: boolean
  /** Presence of each caller-supplied substring, case-insensitive. */
  requested: Record<string, boolean>
}

function extractMarkers(html: string, requested: string[]): PreviewMarkers {
  const lower = html.toLowerCase()
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null
  const canonical =
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html)?.[1] ??
    null

  const h1: string[] = []
  for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) {
    const text = (m[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text) h1.push(text.slice(0, 160))
    if (h1.length >= 5) break
  }

  let jsonLdBlocks = 0
  let jsonLdParsed = 0
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    jsonLdBlocks += 1
    try {
      JSON.parse((m[1] ?? '').trim())
      jsonLdParsed += 1
    } catch {
      /* counted via jsonLdParsed < jsonLdBlocks */
    }
  }

  const req: Record<string, boolean> = {}
  for (const marker of requested) req[marker] = lower.includes(marker.toLowerCase())

  return {
    title,
    canonical,
    h1,
    imgCount: (html.match(/<img[\s>]/gi) ?? []).length,
    jsonLdBlocks,
    jsonLdParsed,
    htmlClosed: /<\/html>/i.test(html),
    requested: req,
  }
}

/** Visible-ish text, scripts and styles removed, whitespace collapsed. */
function excerpt(html: string, chars: number): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, chars)
}

/** Read at most MAX_PREVIEW_BYTES so a huge or streaming response cannot pin the function. */
async function readCapped(res: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    return { text, bytes: Buffer.byteLength(text), truncated: false }
  }
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      bytes += value.byteLength
      if (bytes > MAX_PREVIEW_BYTES) {
        truncated = true
        await reader.cancel()
        break
      }
      text += decoder.decode(value, { stream: true })
    }
  }
  text += decoder.decode()
  return { text, bytes, truncated }
}

async function loadPr(number: number) {
  const pr = await getPullRequest(number, CONTEXT)
  if (!pr.ok) return { error: pr }
  const [files, checks, preview] = await Promise.all([
    listPullRequestFiles(number, CONTEXT),
    getChecksForRef(pr.data.headSha, CONTEXT),
    findPreviewUrl(pr.data.headSha, CONTEXT),
  ])
  return { pr: pr.data, files, checks, preview }
}

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)

  const number = parseNumber(new URL(request.url).searchParams.get('number'))
  if (number === null) return json({ ok: false, error: 'number query param required (positive integer)' }, 400)
  if (!isGithubConfigured()) {
    return json({ ok: false, skipped: true, error: 'GITHUB_TOKEN/OWNER/REPO not configured on this deployment' }, 503)
  }

  const res = await loadPr(number)
  if ('error' in res) {
    return json({ ok: false, error: res.error.error, status: res.error.status }, res.error.status === 404 ? 404 : 502)
  }
  const { pr, files, checks, preview } = res
  if (!files.ok) return json({ ok: false, error: files.error }, 502)

  const classification = classifyChangedFiles(files.data)

  return json({
    ok: true,
    pr: {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeableState,
      headSha: pr.headSha,
      headRef: pr.headRef,
      baseRef: pr.baseRef,
      htmlUrl: pr.htmlUrl,
      labels: pr.labels,
      author: pr.user,
      updatedAt: pr.updatedAt,
    },
    files: {
      count: files.data.length,
      truncated: files.data.length > MAX_FILES_RETURNED,
      items: files.data.slice(0, MAX_FILES_RETURNED).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        ...(f.previousFilename ? { previousFilename: f.previousFilename } : {}),
      })),
    },
    checks: checks.ok
      ? checks.data
      : { error: checks.error, checks: [], pending: [], failing: [], succeeded: [], allGreen: false },
    preview: { url: preview.ok ? preview.data : null, ...(preview.ok ? {} : { error: preview.error }) },
    // Computed from the changed-file list above and nothing else. PR title,
    // body, and ticket text are never inputs to this verdict.
    protectedPaths: classification,
  })
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ ok: false, error: 'invalid JSON body' }, 400)
  }

  const op = typeof body['op'] === 'string' ? body['op'] : ''
  if (op !== 'preview-fetch') return json({ ok: false, error: `unknown op "${op}" (expected 'preview-fetch')` }, 400)

  const number = parseNumber(body['number'])
  if (number === null) return json({ ok: false, error: 'number required (positive integer)' }, 400)

  const path = sanitizePreviewPath(body['path'])
  if (path === null) return json({ ok: false, error: 'path must be a site-relative path starting with a single /' }, 400)

  const markers = Array.isArray(body['markers'])
    ? (body['markers'] as unknown[]).filter((m): m is string => typeof m === 'string').slice(0, 25)
    : []
  const excerptChars = Math.min(
    Math.max(parseNumber(body['excerptChars']) ?? DEFAULT_EXCERPT_CHARS, 0),
    MAX_EXCERPT_CHARS,
  )

  if (!isGithubConfigured()) {
    return json({ ok: false, skipped: true, error: 'GITHUB_TOKEN/OWNER/REPO not configured on this deployment' }, 503)
  }

  const pr = await getPullRequest(number, CONTEXT)
  if (!pr.ok) return json({ ok: false, error: pr.error }, pr.status === 404 ? 404 : 502)

  const preview = await findPreviewUrl(pr.data.headSha, CONTEXT)
  if (!preview.ok) return json({ ok: false, error: preview.error }, 502)
  if (!preview.data) {
    return json(
      {
        ok: false,
        error: `no Vercel preview deployment found for ${pr.data.headSha.slice(0, 7)} (still building, or the build failed)`,
        headSha: pr.data.headSha,
      },
      409,
    )
  }

  const target = `${preview.data}${path}`
  const bypass = process.env['VERCEL_AUTOMATION_BYPASS_SECRET']
  const headers: Record<string, string> = { 'user-agent': 'xdipx-team-preview-fetch' }
  if (bypass) {
    headers['x-vercel-protection-bypass'] = bypass
    // Keeps the bypass from being written into the preview's own cookie jar.
    headers['x-vercel-set-bypass-cookie'] = 'false'
  }

  try {
    const res = await fetch(target, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    })
    const { text, bytes, truncated } = await readCapped(res)
    const finalUrl = res.url || target

    // Deployment Protection does not answer 401. It 302s to vercel.com/login,
    // which then returns a perfectly healthy 200 login page. Reporting that as
    // a successful render is the same silent-green failure the lighthouse gate
    // had, so leaving the preview origin counts as a wall, not a render.
    let offOrigin = false
    try {
      offOrigin = new URL(finalUrl).hostname !== new URL(target).hostname
    } catch {
      offOrigin = false
    }
    const protectionWall = res.status === 401 || res.status === 403 || offOrigin

    return json({
      ok: res.status === 200 && !protectionWall,
      url: target,
      finalUrl,
      status: res.status,
      bytes,
      truncated,
      bypassSent: Boolean(bypass),
      protectionWall,
      ...(protectionWall
        ? {
            error: bypass
              ? `preview did not serve its own origin (ended at ${finalUrl.slice(0, 120)}). The VERCEL_AUTOMATION_BYPASS_SECRET may be wrong or rotated.`
              : 'preview is behind Deployment Protection and VERCEL_AUTOMATION_BYPASS_SECRET is not set on this deployment, so this is an auth page, not the render under test.',
          }
        : {}),
      markers: extractMarkers(text, markers),
      excerpt: excerpt(text, excerptChars),
      headSha: pr.data.headSha,
    })
  } catch (e) {
    return json(
      { ok: false, url: target, error: e instanceof Error ? e.message : String(e), headSha: pr.data.headSha },
      502,
    )
  }
}
