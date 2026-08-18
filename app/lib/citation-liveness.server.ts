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
 * and every request — the first and every redirect hop — targets only a host
 * already on the allowlist. Redirects are read with `redirect: 'manual'` and
 * followed by hand: a 3xx is chased only when its Location resolves to an https
 * URL whose host is itself on the allowlist, and only up to a small bounded hop
 * cap; a redirect pointing off-allowlist (or non-https) is refused, not chased.
 * A request can therefore never be pointed at an internal address or an
 * arbitrary host, whether directly or via a redirect.
 *
 * Two liveness distinctions the caller relies on (see ticket #3196): a refusal
 * from an allowlisted host (401/403/429, typically bot/WAF protection rejecting
 * our fixed user-agent) reports `reason:'blocked'`, kept separate from a genuine
 * 404/410 (`reason:'dead'`), so the caller can tell "we were refused" from "the
 * page is gone". A blocked page is still `live:false` — a 403 is never treated
 * as live, since a dead or paywalled page shipping as a citation is worse than
 * losing one.
 *
 * A third distinction, added for ticket #3946: some bot-protection services do
 * not refuse with a 403 at all, they answer 200 with the challenge page as the
 * whole document (Cloudflare "Just a moment", reCAPTCHA/hCaptcha gates,
 * Incapsula, PerimeterX). classifyStatus reads that 200 as `live`, so without a
 * body inspection an unread challenge page would ship as a citation. A 2xx whose
 * body/title is a challenge interstitial reports `reason:'challenge'` and stays
 * `live:false`. This is the silent cousin of `blocked`: the page is very likely
 * live, but we never saw its content, so it is treated the same way — kept only
 * when the accuracy gate independently confirms the source supports the claim.
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
  /**
   * Present when the URL was rejected before or after the request. Notable
   * values: `'blocked'` (allowlisted host refused us, 401/403/429 — refused, not
   * gone), `'challenge'` (a 2xx whose body is a bot-protection interstitial, e.g.
   * Cloudflare/reCAPTCHA/Incapsula — the real page was never seen), `'dead'` (a
   * genuine 404/410 or other non-2xx), `'redirect-off-allowlist'` (a 3xx pointing
   * off the allowlist or to non-https), `'too-many-redirects'`,
   * `'host-not-allowlisted'`, `'not-https'`, `'timeout'`, `'fetch-failed'`.
   */
  reason?: string
}

/** Max candidate URLs accepted in one request. */
export const MAX_LIVENESS_URLS = 10
const REQUEST_TIMEOUT_MS = 8_000
/** Cap on bytes read to find the <title>, so a huge page can't exhaust memory. */
const MAX_TITLE_SCAN_BYTES = 200_000
/**
 * Max same-host redirect hops followed before giving up. Small on purpose: a
 * canonicalizing redirect (www→apex, http→https, trailing slash) is one hop, so
 * this comfortably covers the real cases while bounding a redirect loop.
 */
export const MAX_REDIRECT_HOPS = 3

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase()
  return CITATION_HOST_ALLOWLIST.some((d) => h === d || h.endsWith(`.${d}`))
}

/** How a returned HTTP status maps onto a liveness verdict. */
export type StatusClass = 'live' | 'redirect' | 'blocked' | 'dead'

/**
 * Classify an HTTP status. `blocked` (401/403/429) means an allowlisted host
 * refused us — typically bot/WAF protection rejecting our fixed user-agent —
 * which is distinct from `dead` (any other non-2xx, e.g. a genuine 404/410).
 * Pure and exported so the blocked-vs-dead distinction is unit-testable.
 */
export function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) return 'live'
  if (status >= 300 && status < 400) return 'redirect'
  if (status === 401 || status === 403 || status === 429) return 'blocked'
  return 'dead'
}

/**
 * Decide whether a redirect may be followed. Given the URL the redirect came
 * from and its raw `Location` header, return the resolved target only when it is
 * an https URL whose host is itself on the allowlist; anything else (off-allowlist
 * host, non-https, missing or malformed Location) is refused. Relative Locations
 * are resolved against `from`. This is what preserves the SSRF property across a
 * redirect: no hop is ever made to a host that is not already allowlisted. Pure
 * and exported so redirect-to-off-allowlist refusal is unit-testable.
 */
export function resolveRedirectTarget(from: URL, location: string | null): UrlValidation {
  if (location == null || location.trim() === '') {
    return { ok: false, reason: 'redirect-no-location' }
  }
  let next: URL
  try {
    next = new URL(location.trim(), from)
  } catch {
    return { ok: false, reason: 'redirect-malformed-location' }
  }
  if (next.protocol !== 'https:' || !hostAllowed(next.hostname)) {
    return { ok: false, reason: 'redirect-off-allowlist' }
  }
  return { ok: true, url: next }
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

/**
 * Detect a bot-protection / WAF interstitial served with a 2xx status. Some
 * challenge services (Cloudflare "Just a moment", reCAPTCHA/hCaptcha gates,
 * Incapsula/Imperva, PerimeterX) answer 200 with the challenge as the whole
 * document rather than a 401/403, so classifyStatus reads them as `live` and,
 * without this check, the unread challenge page would ship as a citation
 * (ticket #3946: run 362 fetched a PMC article and got back a 200 titled
 * "Checking your browser - reCAPTCHA").
 *
 * Title signals are matched as human-readable phrases; body signals are matched
 * only against WAF-specific machinery (script hooks, resource paths, challenge
 * tokens), never bare English words, so a genuine health article that merely
 * mentions "captcha" or "Cloudflare" in its prose is not misflagged. Pure and
 * exported so the 200-challenge case is unit-testable without a network call.
 */
export function isChallengePage(title: string | null, bodyText: string): boolean {
  const t = (title ?? '').toLowerCase()
  const titleSignals = [
    'checking your browser',
    'just a moment',
    'attention required', // "Attention Required! | Cloudflare"
    'verifying you are human',
    'access denied',
    'are you a robot',
    'one more step', // classic Cloudflare captcha page
  ]
  if (titleSignals.some((s) => t.includes(s))) return true

  const bodySignals: readonly RegExp[] = [
    /cf-browser-verification|cf_chl_|cf-challenge|challenge-platform/i, // Cloudflare
    /g-?recaptcha|grecaptcha\.render|www\.google\.com\/recaptcha/i, // reCAPTCHA
    /h-?captcha\.com|\bhcaptcha\b/i, // hCaptcha
    /_incapsula_resource|incapsula incident/i, // Incapsula / Imperva
    /perimeterx|px-captcha|_pxhd\b/i, // PerimeterX
    /enable javascript and cookies to continue/i, // generic JS/cookie gate
    /ddos protection by cloudflare/i,
  ]
  return bodySignals.some((re) => re.test(bodyText))
}

async function checkOne(raw: string): Promise<LivenessResult> {
  const v = validateCitationUrl(raw)
  if (!v.ok) {
    return { url: raw, live: false, status: null, title: null, reason: v.reason }
  }
  let current = v.url
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetch(current, {
        method: 'GET',
        // Read redirects rather than let fetch chase them: a request must only
        // ever hit an allowlisted host, so we resolve each 3xx by hand and follow
        // it only when its Location is itself on the allowlist (below).
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'user-agent': 'xdipx-citation-liveness/1.0 (+https://xdipx.com)',
          accept: 'text/html,application/xhtml+xml',
        },
      })
      const cls = classifyStatus(res.status)

      if (cls === 'redirect') {
        const target = resolveRedirectTarget(current, res.headers.get('location'))
        if (!target.ok) {
          // Off-allowlist / non-https / missing Location: refuse, do not chase.
          return { url: raw, live: false, status: res.status || null, title: null, reason: target.reason }
        }
        if (hop >= MAX_REDIRECT_HOPS) {
          return { url: raw, live: false, status: res.status || null, title: null, reason: 'too-many-redirects' }
        }
        current = target.url
        continue
      }

      if (cls === 'live') {
        let title: string | null = null
        if ((res.headers.get('content-type') ?? '').includes('html') && res.body) {
          const body = await readCapped(res)
          title = extractTitle(body)
          if (isChallengePage(title, body)) {
            // A 2xx whose body is a bot-protection interstitial: the real page
            // was never seen. Report it distinctly from a plain 403 `blocked`,
            // still `live:false`, and surface the challenge title (the title is
            // exactly what exposed this on ticket #3946).
            return { url: raw, live: false, status: res.status || null, title, reason: 'challenge' }
          }
        }
        return { url: raw, live: true, status: res.status || null, title }
      }

      // Non-2xx, non-3xx: refused (blocked) vs gone (dead), reported distinctly so
      // the caller can tell a WAF refusal from a genuine 404/410. Never live.
      return {
        url: raw,
        live: false,
        status: res.status || null,
        title: null,
        reason: cls === 'blocked' ? 'blocked' : 'dead',
      }
    }
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
