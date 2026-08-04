/**
 * search-ping.server.ts
 *
 * Best-effort, non-blocking search-engine discovery pings fired after the deal
 * rotation publishes new URLs, so Bing / Yandex (via IndexNow) re-crawl the
 * homepage and the freshly-activated product fast.
 *
 * Google is intentionally NOT pinged: its standalone sitemap-ping endpoint was
 * deprecated in 2023. Google discovery is driven by the updated `lastmod` we
 * already emit in [sitemap.xml].tsx plus normal crawl scheduling.
 *
 * Inert unless SEARCH_PING_ENABLED === 'true'. Never throws — discovery pings
 * must never be able to fail a deal rotation.
 *
 * `submitIndexNow` is the shared transport: the bulk pusher
 * (indexnow-bulk.server.ts) uses it too, so chunking, retry, and the
 * never-throw contract live in exactly one place.
 */
export const SITE_ORIGIN = 'https://xdipx.com'

/** IndexNow's documented per-request ceiling. Larger payloads are rejected. */
export const INDEXNOW_MAX_URLS_PER_REQUEST = 10_000

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow'
const REQUEST_TIMEOUT_MS = 20_000
/** One retry only, and only for transient classes. A discovery ping is not
 *  worth holding a serverless invocation open for a long backoff ladder. */
const MAX_ATTEMPTS = 2
const RETRY_BACKOFF_MS = 1_000

export interface IndexNowChunkResult {
  urls: string[]
  status: number
  ok: boolean
  error?: string
}

/** Absolutize a path and drop anything that is not a same-origin http(s) URL. */
export function normalizeUrls(paths: string[], origin = SITE_ORIGIN): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    if (!raw || typeof raw !== 'string') continue
    const abs = raw.startsWith('http') ? raw : `${origin}${raw.startsWith('/') ? raw : `/${raw}`}`
    let parsed: URL
    try { parsed = new URL(abs) } catch { continue }
    // IndexNow rejects a payload wholesale if any URL is off-host, so a single
    // stray CDN or Shopify link would silently kill the whole batch.
    if (parsed.host !== new URL(origin).host) continue
    if (seen.has(parsed.toString())) continue
    seen.add(parsed.toString())
    out.push(parsed.toString())
  }
  return out
}

/** Split a URL list into request-sized chunks. Pure; unit-tested. */
export function chunkUrls(urls: string[], size = INDEXNOW_MAX_URLS_PER_REQUEST): string[][] {
  const capped = Math.max(1, size)
  const chunks: string[][] = []
  for (let i = 0; i < urls.length; i += capped) chunks.push(urls.slice(i, i + capped))
  return chunks
}

/**
 * Whether a failed attempt is worth one retry. 429 is deliberately NOT
 * retried in-process: being rate-limited means back off until the next run,
 * and hammering it again a second later is how a key gets deprioritised.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || (status >= 500 && status < 600)
}

/**
 * POST one chunk to IndexNow. Never throws: a transport failure comes back as
 * `{ ok: false, status: 0 }` so callers can decide whether to stop or carry on.
 */
export async function submitIndexNowChunk(
  urls: string[],
  opts: { key: string; origin?: string } ,
): Promise<IndexNowChunkResult> {
  const origin = opts.origin ?? SITE_ORIGIN
  const host = new URL(origin).host
  let last: IndexNowChunkResult = { urls, status: 0, ok: false, error: 'no attempt made' }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          host,
          key: opts.key,
          keyLocation: `${origin}/indexnow.txt`,
          urlList: urls,
        }),
        signal: ctrl.signal,
      })
      last = { urls, status: res.status, ok: res.ok }
      if (res.ok || !isRetryableStatus(res.status)) return last
    } catch (err) {
      last = { urls, status: 0, ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
    }
    if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS))
  }
  return last
}

export interface IndexNowSubmitResult {
  skipped?: string
  submitted: number
  chunks: IndexNowChunkResult[]
}

/**
 * Chunk + submit an arbitrary URL list. Respects SEARCH_PING_ENABLED and the
 * presence of INDEXNOW_API_KEY, and never throws.
 */
export async function submitIndexNow(
  paths: string[],
  opts: { origin?: string; chunkSize?: number } = {},
): Promise<IndexNowSubmitResult> {
  if (process.env['SEARCH_PING_ENABLED'] !== 'true') {
    return { skipped: 'SEARCH_PING_ENABLED is not true', submitted: 0, chunks: [] }
  }
  const key = process.env['INDEXNOW_API_KEY']
  if (!key) {
    console.warn('[search-ping] SEARCH_PING_ENABLED set but INDEXNOW_API_KEY missing — skipping')
    return { skipped: 'INDEXNOW_API_KEY missing', submitted: 0, chunks: [] }
  }

  const origin = opts.origin ?? SITE_ORIGIN
  const urlList = normalizeUrls(paths, origin)
  if (urlList.length === 0) return { skipped: 'no submittable URLs', submitted: 0, chunks: [] }

  const chunks: IndexNowChunkResult[] = []
  let submitted = 0
  for (const chunk of chunkUrls(urlList, opts.chunkSize)) {
    const result = await submitIndexNowChunk(chunk, { key, origin })
    chunks.push(result)
    if (result.ok) submitted += chunk.length
    console.log(`[search-ping] IndexNow ${result.status} for ${chunk.length} url(s)`)
    // A rate limit or a server error means stop pushing for this run; the
    // remaining chunks are simply retried on the next scheduled pass.
    if (!result.ok && (result.status === 429 || isRetryableStatus(result.status))) break
  }
  return { submitted, chunks }
}

/**
 * Original fire-and-forget entry point. Unchanged contract: takes paths,
 * returns void, never throws. Call sites in api.revalidate.blog and
 * api.webhooks.sanity-publish depend on exactly this shape.
 */
export async function pingSearchEngines(paths: string[]): Promise<void> {
  try {
    await submitIndexNow(paths)
  } catch (err) {
    console.error('[search-ping] IndexNow ping failed (non-blocking):', err)
  }
}
