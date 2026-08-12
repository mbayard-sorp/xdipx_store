/**
 * Server-side citation URL liveness check.
 *
 * Why this exists: the content team's accuracy gate (sex-wellness-reviewer)
 * returns candidate Sources URLs, but the cloud sandbox the writer/reviewer run
 * in cannot reach the citation-source domains (the agent egress proxy blocks
 * medicalnewstoday.com, plannedparenthood.org, clevelandclinic.org, and peers),
 * so no citation could ever be verified and the Sources section was dropped on
 * every post that earned one. Production egress is open, so the routine POSTs
 * candidate URLs to /api/team/url-liveness (this module) and gets back a
 * per-URL HTTP status plus page title, letting it verify a citation mechanically
 * before appending Sources. See ticket #2417.
 *
 * Safety: this endpoint makes outbound requests on behalf of a caller, so it is
 * a potential SSRF vector. It is locked down three ways: it requires team-token
 * auth at the route (assertTeamAuth), it accepts only https URLs whose host is
 * on CITATION_HOST_ALLOWLIST (all public reputable health/authority domains),
 * and it never follows redirects (redirect: 'manual'), so a request is only ever
 * made to a host that is already on the allowlist. It can therefore never be
 * pointed at an internal address or an arbitrary host.
 */

/**
 * Hosts the accuracy gate is allowed to cite from. Suffix-matched, so a bare
 * domain also covers its subdomains (e.g. `ncbi.nlm.nih.gov` covers
 * `pubmed.ncbi.nlm.nih.gov`). The named-in-ticket set plus well-known peer
 * health and authority sources. Extend this list when the accuracy gate starts
 * citing a new reputable domain; keep it to public health/authority sources.
 */
export const CITATION_HOST_ALLOWLIST: readonly string[] = [
  // Named explicitly in ticket #2417
  'medicalnewstoday.com',
  'plannedparenthood.org',
  'clevelandclinic.org',
  'who.int',
  'ncbi.nlm.nih.gov', // covers pubmed.ncbi.nlm.nih.gov
  // Peer reputable health / authority sources the accuracy gate cites
  'nih.gov',
  'cdc.gov',
  'mayoclinic.org',
  'healthline.com',
  'medlineplus.gov',
  'kinseyinstitute.org',
  'ashasexualhealth.org',
  'issm.info',
  'nhs.uk',
] as const

/** Result of validating a candidate citation URL, before any network call. */
export type UrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string }

/** Per-URL liveness result returned to the caller. */
export interface LivenessResult {
  url: string
  /** True only on a 2xx response from an allowlisted host. */
  live: boolean
  /** HTTP status code, or null when the request could not be made at all. */
  status: number | null
  /** Page <title> text, present only on a 2xx html response. */
  title: string | null
  /** Present when the URL was rejected before or after the request. */
  reason?: string
}

/** Max candidate URLs accepted in one request. */
export const MAX_LIVENESS_URLS = 10
const REQUEST_TIMEOUT_MS = 8_000
/** Cap on bytes read to find the <title>, so a huge page can't exhaust memory. */
const MAX_TITLE_SCAN_BYTES = 200_000

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase()
  return CITATION_HOST_ALLOWLIST.some((d) => h === d || h.endsWith(`.${d}`))
}

/**
 * Pure, network-free validation of a candidate citation URL. Requires a
 * well-formed https URL whose host is on the allowlist. Exported so it can be
 * unit-tested without any outbound request.
 */
export function validateCitationUrl(raw: unknown): UrlValidation {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'not-a-string' }
  }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'malformed-url' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'not-https' }
  }
  if (!hostAllowed(url.hostname)) {
    return { ok: false, reason: 'host-not-allowlisted' }
  }
  return { ok: true, url }
}

/** Extract the first <title> from an html string. Returns null if none. */
export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  const decoded = (m[1] ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return decoded === '' ? null : decoded
}

async function checkOne(raw: string): Promise<LivenessResult> {
  const v = validateCitationUrl(raw)
  if (!v.ok) {
    return { url: raw, live: false, status: null, title: null, reason: v.reason }
  }
  try {
    const res = await fetch(v.url, {
      method: 'GET',
      // Never follow a redirect: a request must only ever hit an allowlisted
      // host, so we report the 3xx status rather than chase it off-allowlist.
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'user-agent': 'xdipx-citation-liveness/1.0 (+https://xdipx.com)',
        accept: 'text/html,application/xhtml+xml',
      },
    })
    const live = res.status >= 200 && res.status < 300
    let title: string | null = null
    if (live && (res.headers.get('content-type') ?? '').includes('html') && res.body) {
      title = extractTitle(await readCapped(res))
    }
    // A 3xx (opaqueredirect / manual) still means the URL resolves; report the
    // status so the caller can decide, but do not mark it live or read a body.
    const result: LivenessResult = { url: raw, live, status: res.status || null, title }
    if (res.status >= 300 && res.status < 400) result.reason = 'redirect-not-followed'
    return result
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'fetch-failed'
    return { url: raw, live: false, status: null, title: null, reason }
  }
}

/** Read at most MAX_TITLE_SCAN_BYTES of a response body as text. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let out = ''
  let read = 0
  try {
    while (read < MAX_TITLE_SCAN_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      read += value.byteLength
      out += decoder.decode(value, { stream: true })
      if (/<\/title>/i.test(out)) break // stop early once the title has closed
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return out
}

/**
 * Check a batch of candidate citation URLs. Rejected (non-allowlisted / malformed)
 * URLs come back with live:false and a reason and never trigger a request.
 * Runs the allowed ones concurrently.
 */
export async function checkCitationUrls(urls: string[]): Promise<LivenessResult[]> {
  return Promise.all(urls.slice(0, MAX_LIVENESS_URLS).map((u) => checkOne(u)))
}
