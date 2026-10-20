/**
 * The one Graph API HTTP client for everything under ads/channels/meta/
 * (plan §3.1). Reads and, from phase 5a on, writes go through here, so retry,
 * throttle and token handling live in one place.
 *
 * - The token comes from metaCredentialsFromEnv and is sent as a Bearer
 *   header. It is never logged, and any error text that echoes it is
 *   redacted before it leaves this file.
 * - HTTP 429 and Graph throttle codes (4, 17, 32, 613, and the 80000 to
 *   80014 business use case range) retry with exponential backoff. Meta does
 *   not execute a throttled request, so retrying a POST is safe.
 * - x-business-use-case-usage is read on every response. Above 75 on
 *   call_count, total_cputime or total_time, the client sleeps before it
 *   returns a good response, and sleeps then retries once on a failed one.
 */
import { metaCredentialsFromEnv } from './credentials'

export const GRAPH_BASE = 'https://graph.facebook.com'
export const GRAPH_VERSION = 'v23.0'

/** Graph error codes Meta uses for throttling. */
const THROTTLE_CODES = new Set([4, 17, 32, 613])
const isThrottleCode = (code: number | undefined): boolean =>
  code !== undefined && (THROTTLE_CODES.has(code) || (code >= 80000 && code <= 80014))

export const USAGE_BACKOFF_THRESHOLD = 75

export type GraphErrorKind = 'not_configured' | 'rate_limited' | 'api_error' | 'network' | 'bad_response'

export class GraphError extends Error {
  constructor(
    readonly kind: GraphErrorKind,
    message: string,
    readonly detail: { status?: number | undefined; code?: number | undefined; subcode?: number | undefined; fbtraceId?: string | undefined; path?: string | undefined } = {},
  ) {
    super(message)
    this.name = 'GraphError'
  }
}

export type GraphParams = Record<string, string | number | boolean | object | null | undefined>
export type GraphJson = Record<string, unknown>

export interface GraphClient {
  get(path: string, params?: GraphParams): Promise<GraphJson>
  post(path: string, body?: GraphParams): Promise<GraphJson>
  /** Follows cursor paging on a list edge and returns every `data` element. */
  getAll(path: string, params?: GraphParams, opts?: { maxPages?: number }): Promise<GraphJson[]>
}

export interface GraphClientDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  token?: () => string | null
  /** Retries after the first attempt on 429 or a throttle code. */
  maxRetries?: number
  baseDelayMs?: number
  /** Sleep when usage passes the threshold and Meta gives no regain estimate. */
  usageBackoffMs?: number
  /** Ceiling on any one sleep, so a cron invocation cannot hang past its budget. */
  maxSleepMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export interface UsageReading {
  /** The highest of call_count, total_cputime and total_time across every entry. */
  peak: number
  /** Minutes Meta estimates until access recovers, the largest across entries. */
  regainMinutes: number
}

/** Parses x-business-use-case-usage. Returns null when absent or unreadable. */
export function readBusinessUseCaseUsage(header: string | null): UsageReading | null {
  if (!header) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(header)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  let peak = 0
  let regainMinutes = 0
  for (const entries of Object.values(parsed as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue
      const r = e as Record<string, unknown>
      for (const k of ['call_count', 'total_cputime', 'total_time']) {
        const v = Number(r[k])
        if (Number.isFinite(v)) peak = Math.max(peak, v)
      }
      const regain = Number(r['estimated_time_to_regain_access'])
      if (Number.isFinite(regain)) regainMinutes = Math.max(regainMinutes, regain)
    }
  }
  return { peak, regainMinutes }
}

function encodeParams(params: GraphParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return out
}

export function createGraphClient(deps: GraphClientDeps = {}): GraphClient {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? defaultSleep
  const tokenFn = deps.token ?? (() => metaCredentialsFromEnv().token)
  const maxRetries = deps.maxRetries ?? 3
  const baseDelayMs = deps.baseDelayMs ?? 1000
  const usageBackoffMs = deps.usageBackoffMs ?? 5000
  const maxSleepMs = deps.maxSleepMs ?? 30_000

  const usageSleepMs = (u: UsageReading): number =>
    Math.min(maxSleepMs, u.regainMinutes > 0 ? u.regainMinutes * 60_000 : usageBackoffMs)

  async function request(method: 'GET' | 'POST', path: string, params: GraphParams): Promise<GraphJson> {
    const token = tokenFn()
    if (!token) throw new GraphError('not_configured', 'Meta access token is not set (META_ADS_ACCESS_TOKEN or META_ACCESS_TOKEN).', { path })
    const redact = (s: string) => s.split(token).join('[redacted]')
    const clean = path.replace(/^\/+/, '')
    let url = `${GRAPH_BASE}/${GRAPH_VERSION}/${clean}`
    const init: RequestInit = { method, headers: { authorization: `Bearer ${token}` } }
    if (method === 'GET') {
      const qs = new URLSearchParams(encodeParams(params)).toString()
      if (qs) url += `?${qs}`
    } else {
      init.headers = { ...(init.headers as Record<string, string>), 'content-type': 'application/json' }
      init.body = JSON.stringify(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)))
    }

    let usageRetryUsed = false
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetchImpl(url, init)
      } catch (err) {
        throw new GraphError('network', redact(`Graph ${method} ${clean} failed: ${err instanceof Error ? err.message : String(err)}`), { path: clean })
      }
      const usage = readBusinessUseCaseUsage(res.headers.get('x-business-use-case-usage'))
      const hot = usage !== null && usage.peak > USAGE_BACKOFF_THRESHOLD
      const json = (await res.json().catch(() => null)) as GraphJson | null
      const err = json && typeof json['error'] === 'object' && json['error'] ? (json['error'] as Record<string, unknown>) : null

      if (res.ok && !err) {
        if (json === null) throw new GraphError('bad_response', `Graph ${method} ${clean} returned a body that is not JSON.`, { status: res.status, path: clean })
        if (hot) await sleep(usageSleepMs(usage))
        return json
      }

      const code = typeof err?.['code'] === 'number' ? (err['code'] as number) : undefined
      const subcode = typeof err?.['error_subcode'] === 'number' ? (err['error_subcode'] as number) : undefined
      const fbtraceId = typeof err?.['fbtrace_id'] === 'string' ? (err['fbtrace_id'] as string) : undefined
      const detail = { status: res.status, code, subcode, fbtraceId, path: clean }
      const throttled = res.status === 429 || isThrottleCode(code)

      if (throttled && attempt < maxRetries) {
        const backoff = Math.min(maxSleepMs, baseDelayMs * 2 ** attempt)
        await sleep(hot ? Math.max(backoff, usageSleepMs(usage)) : backoff)
        continue
      }
      if (!throttled && hot && !usageRetryUsed) {
        usageRetryUsed = true
        await sleep(usageSleepMs(usage))
        continue
      }

      const raw = typeof err?.['error_user_msg'] === 'string'
        ? (err['error_user_msg'] as string)
        : typeof err?.['message'] === 'string' ? (err['message'] as string) : `HTTP ${res.status}`
      const msg = redact(`Graph ${method} ${clean} refused: ${raw}`)
      throw new GraphError(throttled ? 'rate_limited' : 'api_error', msg, detail)
    }
  }

  return {
    get: (path, params = {}) => request('GET', path, params),
    post: (path, body = {}) => request('POST', path, body),
    async getAll(path, params = {}, opts = {}) {
      const maxPages = opts.maxPages ?? 50
      const out: GraphJson[] = []
      let after: string | undefined
      for (let page = 0; page < maxPages; page++) {
        const json = await request('GET', path, after ? { ...params, after } : params)
        const data = json['data']
        if (!Array.isArray(data)) throw new GraphError('bad_response', `Graph GET ${path} returned no data array.`, { path })
        for (const row of data) if (row && typeof row === 'object') out.push(row as GraphJson)
        const paging = json['paging'] as { next?: unknown; cursors?: { after?: unknown } } | undefined
        const next = paging?.cursors?.after
        if (!paging?.next || typeof next !== 'string') return out
        after = next
      }
      throw new GraphError('bad_response', `Graph GET ${path} paged past ${maxPages} pages.`, { path })
    },
  }
}

let defaultClient: GraphClient | null = null
const client = (): GraphClient => (defaultClient ??= createGraphClient())

export const graphGet = (path: string, params?: GraphParams): Promise<GraphJson> => client().get(path, params)
export const graphPost = (path: string, body?: GraphParams): Promise<GraphJson> => client().post(path, body)
