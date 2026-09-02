/**
 * The cheapest authenticated read per integration, and what its answer means.
 *
 * Every checker obeys one rule, and it is the same rule the blocker probes obey
 * (#4702): **only an authoritative rejection is `dead`.** A 401 or a 403 from a
 * correctly formed request is the credential answering. A timeout, a DNS
 * failure, a 5xx, or a response shape the checker does not recognise is
 * `unknown`, because an integration unreachable from this process is not proof
 * it is broken. Collapsing those two once turned six healthy Shopify webhooks
 * into a P1 owner blocker.
 *
 * Each read is chosen to be free and side-effect-free: an account lookup, a
 * rate-limit read, a `users/me`. Nothing here publishes, spends, or writes.
 */

import {
  INTEGRATIONS,
  credentialDedupeKey,
  integration,
  shouldFile,
  type CredentialState,
  type Integration,
} from '~/lib/credential-health'

const TIMEOUT_MS = 8_000

export interface CredentialVerdict {
  key: string
  label: string
  state: CredentialState
  detail: string
}

/** Missing env vars, by name. */
function missingEnv(i: Integration): string[] {
  return i.envVars.filter(v => !process.env[v]?.trim())
}

/**
 * Turn an HTTP response into a state.
 *
 * 2xx is live. 401 and 403 are the credential being rejected. Everything else
 * — including 404, which usually means the URL moved rather than the token
 * expired — is a could-not-ask, because a checker that guesses is worse than a
 * checker that abstains.
 */
function stateFromStatus(status: number): CredentialState {
  if (status >= 200 && status < 300) return 'live'
  if (status === 401 || status === 403) return 'dead'
  return 'unknown'
}

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}

type Checker = () => Promise<{ state: CredentialState; detail: string }>

const CHECKERS: Record<string, Checker> = {
  'shopify-admin': async () => {
    const domain = process.env['SHOPIFY_STORE_DOMAIN']!.trim()
    const res = await timedFetch(`https://${domain}/admin/api/2025-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']!.trim() },
    })
    return { state: stateFromStatus(res.status), detail: `shop.json HTTP ${res.status}` }
  },

  'shopify-storefront': async () => {
    const domain = process.env['SHOPIFY_STORE_DOMAIN']!.trim()
    const res = await timedFetch(`https://${domain}/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': process.env['SHOPIFY_STOREFRONT_ACCESS_TOKEN']!.trim(),
      },
      body: JSON.stringify({ query: '{ shop { name } }' }),
    })
    if (res.status < 200 || res.status >= 300) {
      return { state: stateFromStatus(res.status), detail: `storefront GraphQL HTTP ${res.status}` }
    }
    // Shopify answers 200 with an errors array on an invalid token, so status
    // alone is not the verdict here.
    const body = await res.json().catch(() => null) as { data?: { shop?: { name?: string } }; errors?: unknown[] } | null
    if (body?.data?.shop?.name) return { state: 'live', detail: `shop "${body.data.shop.name}"` }
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      return { state: 'dead', detail: `storefront returned errors: ${JSON.stringify(body.errors).slice(0, 160)}` }
    }
    return { state: 'unknown', detail: 'storefront answered 200 with an unrecognised shape' }
  },

  instagram: async () => {
    const { igRequest } = await import('~/lib/social-publish/instagram.server')
    const id = process.env['IG_BUSINESS_ACCOUNT_ID']!.trim()
    const r = await igRequest(`/${id}`, {
      method: 'GET',
      params: { fields: 'id,username' },
      token: process.env['IG_GRAPH_ACCESS_TOKEN']!.trim(),
    })
    if (r.ok) return { state: 'live', detail: `@${String(r.data['username'] ?? id)}` }
    const msg = r.error.message ?? 'unknown Graph error'
    // Meta answers 200-with-error, so the code is the verdict. 190 is the
    // access-token family (expired, revoked, password changed); 102 is a dead
    // session. A network error message is a could-not-ask.
    const code = r.error.code
    if (code === 190 || code === 102) return { state: 'dead', detail: `Graph error ${code}: ${msg}` }
    if (msg.startsWith('Network error')) return { state: 'unknown', detail: msg }
    return { state: 'unknown', detail: `Graph error ${code ?? '?'}: ${msg}` }
  },

  x: async () => {
    const { xVerifyCredentials } = await import('~/lib/twitter.server')
    return xVerifyCredentials()
  },

  klaviyo: async () => {
    const res = await timedFetch('https://a.klaviyo.com/api/accounts/', {
      headers: {
        Authorization: `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']!.trim()}`,
        revision: '2024-10-15',
      },
    })
    return { state: stateFromStatus(res.status), detail: `accounts HTTP ${res.status}` }
  },

  github: async () => {
    // rate_limit rather than /user: it works for both PAT shapes, costs nothing
    // against the limit, and returns the remaining budget, which is worth
    // seeing in the detail line when the release engine starts stalling.
    const res = await timedFetch('https://api.github.com/rate_limit', {
      headers: {
        Authorization: `Bearer ${process.env['GITHUB_TOKEN']!.trim()}`,
        Accept: 'application/vnd.github+json',
      },
    })
    const state = stateFromStatus(res.status)
    if (state !== 'live') return { state, detail: `rate_limit HTTP ${res.status}` }
    const body = await res.json().catch(() => null) as { rate?: { remaining?: number; limit?: number } } | null
    return { state, detail: `${body?.rate?.remaining ?? '?'}/${body?.rate?.limit ?? '?'} core requests left` }
  },

  vercel: async () => {
    const res = await timedFetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${process.env['VERCEL_TOKEN']!.trim()}` },
    })
    return { state: stateFromStatus(res.status), detail: `v2/user HTTP ${res.status}` }
  },

  twilio: async () => {
    const sid = process.env['TWILIO_ACCOUNT_SID']!.trim()
    const auth = Buffer.from(`${sid}:${process.env['TWILIO_AUTH_TOKEN']!.trim()}`).toString('base64')
    const res = await timedFetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    const state = stateFromStatus(res.status)
    if (state !== 'live') return { state, detail: `account fetch HTTP ${res.status}` }
    const body = await res.json().catch(() => null) as { status?: string } | null
    // A suspended or closed Twilio account answers 200 and sends nothing, which
    // is the quietest possible way for the pager to stop working.
    if (body?.status && body.status !== 'active') {
      return { state: 'dead', detail: `Twilio account status is "${body.status}", not active` }
    }
    return { state: 'live', detail: 'account active' }
  },

  runpod: async () => {
    const res = await timedFetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env['RUNPOD_API_KEY']!.trim()}`,
      },
      body: JSON.stringify({ query: '{ myself { id } }' }),
    })
    if (res.status < 200 || res.status >= 300) {
      return { state: stateFromStatus(res.status), detail: `graphql HTTP ${res.status}` }
    }
    const body = await res.json().catch(() => null) as { data?: { myself?: { id?: string } }; errors?: unknown[] } | null
    if (body?.data?.myself?.id) return { state: 'live', detail: 'myself resolved' }
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      return { state: 'dead', detail: `graphql errors: ${JSON.stringify(body.errors).slice(0, 160)}` }
    }
    return { state: 'unknown', detail: 'graphql answered 200 with an unrecognised shape' }
  },
}

/**
 * Check one integration.
 *
 * Never throws. A checker that raises has, by definition, not got an answer, so
 * it becomes `unknown` — the same throw-to-null boundary `guardedRun` puts
 * around the blocker probes, for the same reason.
 */
export async function checkCredential(key: string): Promise<CredentialVerdict> {
  const i = integration(key)
  if (!i) return { key, label: key, state: 'unknown', detail: 'no such integration in the registry' }

  const missing = missingEnv(i)
  if (missing.length > 0) {
    return { key, label: i.label, state: 'unconfigured', detail: `not set: ${missing.join(', ')}` }
  }
  const checker = CHECKERS[key]
  if (!checker) return { key, label: i.label, state: 'unknown', detail: 'no checker implemented' }

  try {
    const r = await checker()
    return { key, label: i.label, state: r.state, detail: r.detail }
  } catch (err) {
    return { key, label: i.label, state: 'unknown', detail: `could not ask: ${String(err).slice(0, 160)}` }
  }
}

/** Check everything, in parallel. Nine cheap reads, once every six hours. */
export async function checkAllCredentials(): Promise<CredentialVerdict[]> {
  return Promise.all(INTEGRATIONS.map(i => checkCredential(i.key)))
}

/**
 * File one blocker per credential that is authoritatively broken.
 *
 * `unknown` files nothing, ever. That is the whole discipline: this sweep runs
 * every six hours against nine third-party APIs, so transient failures are
 * certain, and a blocker list that fills with them is a blocker list nobody
 * reads.
 */
export async function fileCredentialBlockers(verdicts: readonly CredentialVerdict[]): Promise<string[]> {
  const { fileBlocker } = await import('~/lib/owner-blockers.server')
  const filed: string[] = []
  for (const v of verdicts) {
    const i = integration(v.key)
    if (!i || !shouldFile(i, v.state)) continue
    try {
      await fileBlocker({
        dedupeKey: credentialDedupeKey(v.key),
        title: v.state === 'dead'
          ? `${i.label} credential is rejected: renew it`
          : `${i.label} is not configured and the fleet needs it`,
        detail:
          `${v.detail}\n\nEnv: ${i.envVars.join(', ')}\n\n`
          + `What stops: ${i.breaks}\n\n`
          + 'Detected by the credential health sweep on /cron/janitor-sweep. It only files on an '
          + 'authoritative rejection (a 401, a 403, or a provider error code that names the token); '
          + 'a timeout or a 5xx is recorded as "could not ask" and files nothing.',
        unblocks: i.breaks,
        whereToGo: i.whereToGo,
        category: 'credential',
        priority: i.moneyPath ? 1 : 2,
        source: 'sweep',
        sourceRef: 'cron:janitor-sweep',
        verifyProbe: 'credential_live',
        verifyArg: v.key,
      })
      filed.push(v.key)
    } catch (err) {
      // Same rule as everywhere else in this program: bookkeeping must never
      // turn a working sweep into a failed one.
      console.error(`[credential-health] could not file blocker for ${v.key} (ignored):`, err)
    }
  }
  return filed
}
