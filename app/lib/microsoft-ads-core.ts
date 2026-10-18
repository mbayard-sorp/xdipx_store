/**
 * Microsoft Advertising API v13, the pure half: environment config, REST
 * hosts, request headers, error parsing, and token encryption. No DB, no
 * network, so every rule here is unit-tested in microsoft-ads-core.test.ts.
 * The network half lives in microsoft-ads.server.ts.
 *
 * There is no official Node SDK (Microsoft ships .NET, Java, Python and PHP),
 * so this repo calls the REST endpoints with fetch and types only the
 * operations it uses. Request JSON shapes come from the "Request JSON"
 * template on each operation's learn.microsoft.com page.
 *
 * Sandbox and production are fully separate Microsoft accounts with separate
 * IDs and developer tokens, so every credential is read per environment.
 * MSADS_ENV picks one and defaults to sandbox: nothing reaches the production
 * account until the owner flips it on purpose.
 */

import crypto from 'node:crypto'

export type MsAdsEnv = 'sandbox' | 'production'

export type MsAdsService =
  | 'CampaignManagement'
  | 'CustomerManagement'
  | 'Reporting'
  | 'Bulk'
  | 'AdInsight'

/** Microsoft's shared sandbox developer token, published in its sandbox guide. Not a secret. */
export const SANDBOX_DEVELOPER_TOKEN = 'BBD37VB98'

/**
 * The OAuth scope differs by environment even though both use the same
 * login.microsoftonline.com endpoints: sandbox APIs only accept tokens minted
 * for the si.ads.microsoft.com resource and return 105 InvalidCredentials for
 * a production-scoped token. Source: MSA_PROD in BingAds-Python-SDK
 * bingads/authorization.py, which the SDK uses for sandbox by default.
 */
export function msAdsScope(env: MsAdsEnv): string {
  const resource = env === 'sandbox' ? 'https://si.ads.microsoft.com' : 'https://ads.microsoft.com'
  return `${resource}/msads.manage offline_access`
}

/** `common` covers both Entra work accounts and personal Microsoft accounts. Sandbox uses the same endpoints. */
export const MSADS_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
export const MSADS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

const SERVICE_HOST: Record<MsAdsService, string> = {
  CampaignManagement: 'campaign',
  CustomerManagement: 'clientcenter',
  Reporting:          'reporting',
  Bulk:               'bulk',
  AdInsight:          'adinsight',
}

/** Anything other than an explicit "production" is sandbox. */
export function msAdsEnv(env: NodeJS.ProcessEnv = process.env): MsAdsEnv {
  return env['MSADS_ENV'] === 'production' ? 'production' : 'sandbox'
}

export interface MsAdsConfig {
  env:            MsAdsEnv
  clientId:       string
  clientSecret:   string
  developerToken: string
  customerId:     string
  accountId:      string
}

/**
 * Credentials for the active environment. Client id and secret are shared (one
 * Entra app serves both); developer token and account IDs are per environment.
 * Missing values come back as '' so callers can say which one is missing.
 */
export function msAdsConfig(env: NodeJS.ProcessEnv = process.env): MsAdsConfig {
  const which = msAdsEnv(env)
  const sandbox = which === 'sandbox'
  return {
    env:            which,
    clientId:       env['MSADS_CLIENT_ID'] ?? '',
    clientSecret:   env['MSADS_CLIENT_SECRET'] ?? '',
    developerToken: sandbox
      ? env['MSADS_SANDBOX_DEVELOPER_TOKEN'] || SANDBOX_DEVELOPER_TOKEN
      : env['MSADS_DEVELOPER_TOKEN'] ?? '',
    customerId:     (sandbox ? env['MSADS_SANDBOX_CUSTOMER_ID'] : env['MSADS_CUSTOMER_ID']) ?? '',
    accountId:      (sandbox ? env['MSADS_SANDBOX_ACCOUNT_ID'] : env['MSADS_ACCOUNT_ID']) ?? '',
  }
}

/** Env var names still unset for the active environment, for setup pages and errors. */
export function missingConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const c = msAdsConfig(env)
  const sandbox = c.env === 'sandbox'
  const missing: string[] = []
  if (!c.clientId) missing.push('MSADS_CLIENT_ID')
  if (!c.clientSecret) missing.push('MSADS_CLIENT_SECRET')
  if (!env['MSADS_TOKEN_KEY']) missing.push('MSADS_TOKEN_KEY')
  if (!c.developerToken) missing.push('MSADS_DEVELOPER_TOKEN')
  if (!c.customerId) missing.push(sandbox ? 'MSADS_SANDBOX_CUSTOMER_ID' : 'MSADS_CUSTOMER_ID')
  if (!c.accountId) missing.push(sandbox ? 'MSADS_SANDBOX_ACCOUNT_ID' : 'MSADS_ACCOUNT_ID')
  return missing
}

/** e.g. https://campaign.api.sandbox.bingads.microsoft.com/CampaignManagement/v13/Campaigns/QueryByAccountId */
export function serviceUrl(env: MsAdsEnv, service: MsAdsService, path: string): string {
  const sub = env === 'sandbox' ? 'api.sandbox' : 'api'
  const clean = path.replace(/^\/+/, '')
  return `https://${SERVICE_HOST[service]}.${sub}.bingads.microsoft.com/${service}/v13/${clean}`
}

export interface HeaderArgs {
  accessToken:    string
  developerToken: string
  /** Omit for CustomerManagement calls that are not scoped to an account (GetUser). */
  customerId?:    string | undefined
  accountId?:     string | undefined
}

export function requestHeaders(a: HeaderArgs): Record<string, string> {
  const h: Record<string, string> = {
    // The "Bearer " prefix is required on REST; SOAP took the bare token.
    Authorization:  `Bearer ${a.accessToken}`,
    DeveloperToken: a.developerToken,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  }
  if (a.customerId) h['CustomerId'] = a.customerId
  if (a.accountId) h['CustomerAccountId'] = a.accountId
  return h
}

// -- Errors -------------------------------------------------------------------

export interface MsAdsErrorItem {
  code:      number | null
  errorCode: string | null
  message:   string
  /** Position in the request batch, for PartialErrors/BatchErrors. */
  index:     number | null
}

/** CallRateExceeded: per-minute sliding window, Microsoft says wait 60 seconds. */
export const THROTTLE_CODE = 117

function toItem(raw: unknown): MsAdsErrorItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const code = typeof r['Code'] === 'number' ? r['Code'] : null
  const errorCode = typeof r['ErrorCode'] === 'string' ? r['ErrorCode'] : null
  const message = typeof r['Message'] === 'string' ? r['Message'] : ''
  const index = typeof r['Index'] === 'number' ? r['Index'] : null
  if (code === null && !errorCode && !message) return null
  return { code, errorCode, message, index }
}

function collect(value: unknown, out: MsAdsErrorItem[]): void {
  if (!Array.isArray(value)) return
  for (const raw of value) {
    // PartialErrors can hold nulls for the items that succeeded.
    const item = toItem(raw)
    if (item) out.push(item)
  }
}

/**
 * Pull every error Microsoft reported out of a response body. REST faults put
 * them under Errors / OperationErrors / BatchErrors; a call that partly
 * succeeds returns 200 with PartialErrors, so this runs on success bodies too.
 * Criterion and negative keyword adds report NestedPartialErrors instead: one
 * entry per failed batch item, each with its own BatchErrors list.
 */
export function extractErrors(body: unknown): { fault: MsAdsErrorItem[]; partial: MsAdsErrorItem[] } {
  const fault: MsAdsErrorItem[] = []
  const partial: MsAdsErrorItem[] = []
  if (!body || typeof body !== 'object') return { fault, partial }
  const b = body as Record<string, unknown>
  collect(b['Errors'], fault)
  collect(b['OperationErrors'], fault)
  collect(b['BatchErrors'], fault)
  collect(b['PartialErrors'], partial)
  if (Array.isArray(b['NestedPartialErrors'])) {
    for (const raw of b['NestedPartialErrors']) {
      if (!raw || typeof raw !== 'object') continue
      const nested = raw as Record<string, unknown>
      const before = partial.length
      collect(nested['BatchErrors'], partial)
      if (partial.length === before) collect([raw], partial)
    }
  }
  return { fault, partial }
}

export function isThrottle(items: MsAdsErrorItem[]): boolean {
  return items.some(e => e.code === THROTTLE_CODE || e.errorCode === 'CallRateExceeded')
}

export function describeErrors(items: MsAdsErrorItem[]): string {
  return items
    .map(e => [e.code ?? e.errorCode ?? '?', e.message].filter(Boolean).join(': '))
    .join('; ')
}

// -- Token encryption -----------------------------------------------------------

// AES-256-GCM. The key is SHA-256 of MSADS_TOKEN_KEY so any long random string
// works as the env value. Stored form: v1.<iv>.<tag>.<ciphertext>, base64url.

function keyFrom(secret: string): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error('MSADS_TOKEN_KEY must be set to a random string of at least 32 characters')
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest()
}

export function encryptToken(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.')
}

export function decryptToken(stored: string, secret: string): string {
  const [version, iv, tag, enc] = stored.split('.')
  if (version !== 'v1' || !iv || !tag || !enc) throw new Error('Unrecognised stored token format')
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8')
}
