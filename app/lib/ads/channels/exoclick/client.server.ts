/**
 * The one ExoClick API v2 HTTP client for everything under
 * ads/channels/exoclick/ (plan §3.1, ticket #16675).
 *
 * - Auth: POST /v2/login with { api_token: EXOCLICK_API_KEY } returns a
 *   Bearer session token that lasts expires_in seconds (12 hours today). The
 *   client logs in once per process and reuses the token until a minute
 *   before it expires. A 401 on any read drops the cached token, logs in
 *   again and retries the read once.
 * - HTTP 429 and 5xx retry with exponential backoff, honouring Retry-After
 *   when ExoClick sends one. Every sleep is capped so a cron invocation
 *   cannot hang past its budget.
 * - Neither the API key nor the session token is ever logged. Error text that
 *   echoes either is redacted before it leaves this file.
 *
 * post, put and del share get's retry, redact and re-login behavior. A write
 * that can create something (a campaign, a banner) passes { retries: 0 } so a
 * 5xx on a request that may have landed is never sent twice. A write whose
 * repeat is harmless (pause, play, add to a block list) keeps the retries.
 * An empty 2xx body (ExoClick answers some writes with 204) reads as {}.
 *
 * Callers decide whether a write may happen at all: exoclick/mutate.server.ts
 * and operator.server.ts gate every call on exoclick_operator_enabled.
 */

export const EXO_BASE = 'https://api.exoclick.com/v2'

/** Seconds shaved off expires_in so a token is never used in its last minute. */
export const TOKEN_SKEW_SECONDS = 60

export type ExoErrorKind = 'not_configured' | 'token_rejected' | 'rate_limited' | 'api_error' | 'network' | 'bad_response'

export class ExoClickError extends Error {
  constructor(
    readonly kind: ExoErrorKind,
    message: string,
    readonly detail: { status?: number | undefined; path?: string | undefined } = {},
  ) {
    super(message)
    this.name = 'ExoClickError'
  }
}

export type ExoParams = Record<string, string | number | boolean | Array<string | number> | null | undefined>
export type ExoJson = Record<string, unknown>

export interface ExoSession {
  token: string
  /** Epoch ms after which the cached token is not reused. */
  expiresAtMs: number
  /** expires_in as ExoClick sent it, in seconds. */
  expiresIn: number
}

export interface ExoWriteOptions {
  /** Retries after the first attempt on 429 or 5xx. Defaults to the client's maxRetries. */
  retries?: number
}

export type ExoMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface ExoClient {
  /** A valid session, from cache when one is still good. */
  session(): Promise<ExoSession>
  get(path: string, params?: ExoParams): Promise<ExoJson>
  /** JSON body in, JSON out. A top-level array body is allowed (block lists). */
  post(path: string, body?: unknown, opts?: ExoWriteOptions): Promise<ExoJson>
  put(path: string, body?: unknown, opts?: ExoWriteOptions): Promise<ExoJson>
  del(path: string, body?: unknown, opts?: ExoWriteOptions): Promise<ExoJson>
  /** Drops the cached session. Tests and a 401 use it. */
  reset(): void
}

export interface ExoClientDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  apiKey?: () => string | null
  now?: () => number
  /** Retries after the first attempt on 429 or 5xx. */
  maxRetries?: number
  baseDelayMs?: number
  maxSleepMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function exoApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env['EXOCLICK_API_KEY']?.trim()
  return v ? v : null
}

/** Query string in the form ExoClick's docs show: arrays repeat as key[]=a&key[]=b. */
export function encodeExoParams(params: ExoParams): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) for (const item of v) qs.append(`${k}[]`, String(item))
    else qs.append(k, String(v))
  }
  return qs.toString()
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after')
  if (!h) return null
  const secs = Number(h)
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000
  const at = Date.parse(h)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

const retryable = (status: number) => status === 429 || status >= 500

function messageFrom(json: unknown, status: number): string {
  if (json && typeof json === 'object') {
    const o = json as ExoJson
    for (const k of ['message', 'error', 'detail']) {
      const v = o[k]
      if (typeof v === 'string' && v) return v
      if (v && typeof v === 'object' && typeof (v as ExoJson)['message'] === 'string') return (v as ExoJson)['message'] as string
    }
  }
  return `HTTP ${status}`
}

export function createExoClient(deps: ExoClientDeps = {}): ExoClient {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? defaultSleep
  const apiKeyFn = deps.apiKey ?? (() => exoApiKeyFromEnv())
  const now = deps.now ?? (() => Date.now())
  const maxRetries = deps.maxRetries ?? 3
  const baseDelayMs = deps.baseDelayMs ?? 1000
  const maxSleepMs = deps.maxSleepMs ?? 30_000

  let cached: ExoSession | null = null
  let inflight: Promise<ExoSession> | null = null

  const redactor = (secrets: Array<string | null | undefined>) => (s: string) => {
    let out = s
    for (const secret of secrets) if (secret) out = out.split(secret).join('[redacted]')
    return out
  }

  const backoff = (attempt: number, res: Response | null) =>
    Math.min(maxSleepMs, (res && retryAfterMs(res)) ?? baseDelayMs * 2 ** attempt)

  async function login(): Promise<ExoSession> {
    const key = apiKeyFn()
    if (!key) throw new ExoClickError('not_configured', 'ExoClick API key is not set (EXOCLICK_API_KEY).', { path: 'login' })
    const redact = redactor([key])
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetchImpl(`${EXO_BASE}/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ api_token: key }),
        })
      } catch (err) {
        throw new ExoClickError('network', redact(`ExoClick login failed: ${err instanceof Error ? err.message : String(err)}`), { path: 'login' })
      }
      if (retryable(res.status) && attempt < maxRetries) {
        await sleep(backoff(attempt, res))
        continue
      }
      const json = (await res.json().catch(() => null)) as ExoJson | null
      if (res.status === 401 || res.status === 403) {
        throw new ExoClickError('token_rejected', redact(`ExoClick login refused: ${messageFrom(json, res.status)}`), { status: res.status, path: 'login' })
      }
      if (!res.ok) {
        const kind: ExoErrorKind = res.status === 429 ? 'rate_limited' : 'api_error'
        throw new ExoClickError(kind, redact(`ExoClick login failed: ${messageFrom(json, res.status)}`), { status: res.status, path: 'login' })
      }
      const token = json && typeof json['token'] === 'string' ? (json['token'] as string) : ''
      const expiresIn = Number(json?.['expires_in'])
      if (!token) throw new ExoClickError('bad_response', 'ExoClick login returned no token.', { status: res.status, path: 'login' })
      const life = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600
      return {
        token,
        expiresIn: life,
        expiresAtMs: now() + Math.max(0, life - TOKEN_SKEW_SECONDS) * 1000,
      }
    }
  }

  async function session(): Promise<ExoSession> {
    if (cached && now() < cached.expiresAtMs) return cached
    // One login at a time, so parallel reads in a cold process share it.
    inflight ??= login().finally(() => { inflight = null })
    cached = await inflight
    return cached
  }

  async function request(method: ExoMethod, path: string, params: ExoParams, body: unknown, retries: number): Promise<ExoJson> {
    const clean = path.replace(/^\/+/, '')
    const qs = encodeExoParams(params)
    const url = `${EXO_BASE}/${clean}${qs ? `?${qs}` : ''}`
    const hasBody = body !== undefined
    let reloggedIn = false
    for (let attempt = 0; ; attempt++) {
      const s = await session()
      const redact = redactor([s.token, apiKeyFn()])
      let res: Response
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${s.token}`,
            accept: 'application/json',
            ...(hasBody ? { 'content-type': 'application/json' } : {}),
          },
          ...(hasBody ? { body: JSON.stringify(body) } : {}),
        })
      } catch (err) {
        throw new ExoClickError('network', redact(`ExoClick ${method} ${clean} failed: ${err instanceof Error ? err.message : String(err)}`), { path: clean })
      }
      if (res.status === 401 && !reloggedIn) {
        // The session died early (revoked, or another process logged in). Log in once more.
        reloggedIn = true
        cached = null
        attempt--
        continue
      }
      if (retryable(res.status) && attempt < retries) {
        await sleep(backoff(attempt, res))
        continue
      }
      const text = await res.text().catch(() => '')
      let json: ExoJson | null = null
      try {
        json = text ? (JSON.parse(text) as ExoJson) : null
      } catch {
        json = null
      }
      if (res.ok) {
        // Reads must return JSON. A write may answer with nothing at all.
        if (method !== 'GET' && !text.trim()) return {}
        if (!json || typeof json !== 'object') {
          throw new ExoClickError('bad_response', `ExoClick ${method} ${clean} returned a body that is not JSON.`, { status: res.status, path: clean })
        }
        return json
      }
      const kind: ExoErrorKind = res.status === 401 || res.status === 403 ? 'token_rejected' : res.status === 429 ? 'rate_limited' : 'api_error'
      throw new ExoClickError(kind, redact(`ExoClick ${method} ${clean} refused: ${messageFrom(json, res.status)}`), { status: res.status, path: clean })
    }
  }

  const get = (path: string, params: ExoParams = {}) => request('GET', path, params, undefined, maxRetries)
  const write = (method: Exclude<ExoMethod, 'GET'>) => (path: string, body?: unknown, opts: ExoWriteOptions = {}) =>
    request(method, path, {}, body, opts.retries ?? maxRetries)

  return {
    session,
    get,
    post: write('POST'),
    put: write('PUT'),
    del: write('DELETE'),
    reset() {
      cached = null
    },
  }
}

/** The process-wide client. Its session cache lives as long as the function instance. */
export const exoClient: ExoClient = createExoClient()

/** `exoGet(path, params)` on the process-wide client. */
export function exoGet(path: string, params?: ExoParams): Promise<ExoJson> {
  return exoClient.get(path, params)
}
