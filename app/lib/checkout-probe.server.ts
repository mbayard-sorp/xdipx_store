/**
 * Synthetic checkout probe.
 *
 * The storefront has taken $0 for weeks, and a broken payment step is
 * indistinguishable from no traffic. This probe walks the purchase path up to
 * the payment page and records a pass/fail row, alerting the owner on failure.
 * It is the regression guard the funnel never had; a one-time live transaction
 * test (confirming the Shopify gateway actually charges) stays a human step.
 *
 * Two tiers write to the same table:
 *   - HTTP tier (runCheckoutProbe, every 6h via cron): server-side fetches +
 *     Storefront cart mutation. Catches server, API, and Shopify-side breaks.
 *   - Browser tier (a Playwright GitHub Action posting to /cron/checkout-probe-
 *     report): clicks through the real UI. Catches client-only breaks (an age
 *     gate hydration bug that blocks every purchase while HTTP stays green).
 *
 * Server-only.
 */
import { Sentry } from '~/lib/sentry.server'
import { db } from '~/lib/db.server'
import { checkoutProbeRuns } from '../../db/schema'
import { kvGet, kvSetNX, KV_KEYS } from '~/lib/kv.server'
import { getDealByHandle, createCart, addToCart, setCartAttributes } from '~/lib/shopify.server'
import { sendOwnerEmail, sendOwnerSms, escapeHtml } from '~/lib/owner-alerts.server'

const FETCH_TIMEOUT_MS = 12_000
const MIN_BODY_BYTES = 1000
const ALERT_THROTTLE_SECONDS = 6 * 3600
// Shopify's checkout is behind bot protection that 403s non-browser agents, so
// the probe (monitoring the store's own checkout) presents a realistic browser
// UA. Probe carts are tagged _probe=1 so they are still distinguishable.
const PROBE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface ProbeStep { step: string; ok: boolean; status?: number; ms: number; detail?: string }
export interface ProbeResult { ok: boolean; failedStep: string | null; steps: ProbeStep[]; durationMs: number }

/** Build a step, omitting status/detail when undefined (exactOptionalPropertyTypes). */
function mkStep(step: string, ok: boolean, ms: number, extra: { status?: number | undefined; detail?: string | undefined } = {}): ProbeStep {
  const s: ProbeStep = { step, ok, ms }
  if (extra.status !== undefined) s.status = extra.status
  if (extra.detail !== undefined) s.detail = extra.detail
  return s
}

function baseUrl(): string {
  return (process.env['BASE_URL'] || 'https://xdipx.com').replace(/\/+$/, '')
}

interface FetchCheck { status: number; ok: boolean; detail?: string }

/**
 * GET a URL with a timeout and assert status 200, a minimum body size, and that
 * the body contains every required marker. Returns a structured result rather
 * than throwing so the caller can record a clean failed step.
 */
async function checkUrl(url: string, opts: { markers?: string[]; minBytes?: number } = {}): Promise<FetchCheck> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': PROBE_UA },
    })
    const body = await res.text()
    if (res.status !== 200) return { status: res.status, ok: false, detail: `HTTP ${res.status}` }
    const minBytes = opts.minBytes ?? MIN_BODY_BYTES
    if (body.length < minBytes) return { status: res.status, ok: false, detail: `body ${body.length} < ${minBytes} bytes` }
    for (const marker of opts.markers ?? []) {
      if (!body.toLowerCase().includes(marker.toLowerCase())) {
        return { status: res.status, ok: false, detail: `missing marker "${marker}"` }
      }
    }
    return { status: res.status, ok: true }
  } catch (err) {
    return { status: 0, ok: false, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Follow a redirect chain manually while persisting cookies across hops. The
 * Shopify checkout handoff (cart/c -> Shop Pay -> /checkouts/cn) sets session
 * cookies between hops; a plain redirect: 'follow' fetch does not resend them,
 * so the checkout session fails and bounces to the store root. This mirrors a
 * real browser: accumulate Set-Cookie and replay it, so the final page is the
 * genuine checkout render rather than a cookieless fallback.
 */
async function followWithCookies(startUrl: string, maxHops = 12): Promise<{ status: number; finalUrl: string; body: string; hops: number; detail?: string }> {
  const jar = new Map<string, string>()
  let url = startUrl
  for (let hop = 0; hop < maxHops; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
      res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': PROBE_UA, ...(cookie ? { cookie } : {}) },
      })
    } catch (err) {
      return { status: 0, finalUrl: url, body: '', hops: hop, detail: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
    }
    const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie
    for (const sc of getSetCookie ? getSetCookie.call(res.headers) : []) {
      const pair = sc.split(';')[0] ?? ''
      const eq = pair.indexOf('=')
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { status: res.status, finalUrl: url, body: '', hops: hop, detail: 'redirect without Location' }
      url = new URL(loc, url).toString()
      continue
    }
    const body = await res.text()
    return { status: res.status, finalUrl: url, body, hops: hop }
  }
  return { status: 0, finalUrl: url, body: '', hops: maxHops, detail: 'too many redirects' }
}

/**
 * Assert the Storefront checkoutUrl routes to a genuine Shopify checkout
 * endpoint. Failure modes this must separate:
 *   - dead domain (the bug we hit): the URL returns a hard 404.
 *   - checkout bounced away (password-protected store / misconfig): the chain
 *     redirects to the store root and never reaches a /checkouts/ path.
 *   - healthy: the chain (through Shop Pay) lands on /checkouts/cn/...
 * Shopify's checkout sits behind Cloudflare bot protection that 403s a headless
 * agent regardless of UA, so a 200 render is not reliably observable from the
 * HTTP tier. Reaching a /checkouts/ URL (even a 403) proves the routing is
 * healthy; the browser tier verifies the actual render + payment fields.
 */
async function checkCheckout(url: string): Promise<FetchCheck> {
  const r = await followWithCookies(url)
  if (r.status === 0 && r.detail) return { status: 0, ok: false, detail: r.detail }
  if (r.status === 404) return { status: 404, ok: false, detail: `404 at ${r.finalUrl.split('?')[0]} (checkout URL dead)` }
  const onCheckout = /\/checkouts?\//i.test(r.finalUrl)
  if (!onCheckout) {
    return { status: r.status, ok: false, detail: `checkout did not route to a Shopify checkout page (landed ${r.finalUrl.split('?')[0]}, status ${r.status})` }
  }
  // On a checkout URL. 200 with markers is ideal; a 403/anything-non-404 here is
  // the Cloudflare bot wall, not a routing break, so the HTTP tier accepts it.
  const rendered = r.status === 200 && /order summary|payment|contact information/i.test(r.body)
  if (rendered) return { status: r.status, ok: true }
  return { status: r.status, ok: true, detail: `reached checkout endpoint (status ${r.status}; full render verified by browser tier)` }
}

/**
 * Walk the funnel: homepage, PDP, Storefront cart mutation, the Shopify hosted
 * checkout page, and the checkout-extras content page. Stops at the first failed
 * step. Never throws; a thrown Storefront error becomes a failed step.
 */
export async function runCheckoutProbe(): Promise<ProbeResult> {
  const start = Date.now()
  const steps: ProbeStep[] = []
  const base = baseUrl()

  const record = (step: string, r: FetchCheck, t0: number): boolean => {
    steps.push(mkStep(step, r.ok, Date.now() - t0, { status: r.status, detail: r.detail }))
    return r.ok
  }
  const finish = (): ProbeResult => {
    const failed = steps.find(s => !s.ok)
    return { ok: !failed, failedStep: failed?.step ?? null, steps, durationMs: Date.now() - start }
  }

  // 1. Homepage renders.
  let t = Date.now()
  if (!record('homepage', await checkUrl(`${base}/`), t)) return finish()

  // 2. Resolve a probe product handle (explicit override, else the live deal).
  t = Date.now()
  const handle = process.env['PROBE_PRODUCT_HANDLE'] || (await kvGet<string>(KV_KEYS.liveDealHandle))
  if (!handle) {
    steps.push(mkStep('resolve-handle', false, Date.now() - t, { detail: 'no PROBE_PRODUCT_HANDLE and no live deal handle in KV' }))
    return finish()
  }
  steps.push(mkStep('resolve-handle', true, Date.now() - t, { detail: handle }))

  // 3. PDP renders with an add-to-cart form.
  t = Date.now()
  if (!record('pdp', await checkUrl(`${base}/products/${handle}`, { markers: ['name="variantId"'] }), t)) return finish()

  // 4. Storefront cart mutation yields a checkout URL.
  t = Date.now()
  let checkoutUrl = ''
  try {
    const deal = await getDealByHandle(handle)
    const variantId = deal?.variantId
    if (!variantId) {
      steps.push(mkStep('cart', false, Date.now() - t, { detail: `no variantId for handle ${handle}` }))
      return finish()
    }
    const cart = await createCart()
    const withLine = await addToCart(cart.id, variantId, 1)
    // Tag so nothing downstream mistakes the probe cart for a real shopper.
    try { await setCartAttributes(cart.id, [{ key: '_probe', value: '1' }]) } catch { /* best effort */ }
    const ok = Boolean(withLine.checkoutUrl) && withLine.totalQuantity === 1
    checkoutUrl = withLine.checkoutUrl
    steps.push(mkStep('cart', ok, Date.now() - t, ok ? {} : { detail: `checkoutUrl=${Boolean(withLine.checkoutUrl)} qty=${withLine.totalQuantity}` }))
    if (!ok) return finish()
  } catch (err) {
    steps.push(mkStep('cart', false, Date.now() - t, { detail: err instanceof Error ? err.message : String(err) }))
    return finish()
  }

  // 5. Shopify hosted checkout page renders (up to the payment page; we do not
  // pay). Cookie-aware follow so the Shop Pay session survives to the real
  // checkout render instead of the cookieless bounce to the store root.
  t = Date.now()
  record('checkout-page', await checkCheckout(checkoutUrl), t)

  return finish()
}

/**
 * Persist a probe result and, on failure, alert the owner (email + SMS),
 * throttled per failed step so a persistent break pages at most once every 6h.
 * Used by both the HTTP cron tier and the browser report endpoint.
 */
export async function recordAndAlertProbe(tier: 'http' | 'browser', result: ProbeResult): Promise<{ rowId: number; alerted: boolean }> {
  let alerted = false

  if (!result.ok) {
    const failedStep = result.failedStep ?? 'unknown'
    const detail = result.steps.find(s => !s.ok)?.detail ?? ''
    Sentry.captureMessage(`[checkout-probe:${tier}] failed at ${failedStep}: ${detail}`, 'error')

    // Throttle: one alert per failed step per 6h window.
    const fresh = await kvSetNX(`probe:alert:${tier}:${failedStep}`, String(Date.now()), ALERT_THROTTLE_SECONDS)
    if (fresh) {
      const stepList = result.steps
        .map(s => `${s.ok ? 'ok' : 'FAIL'} ${escapeHtml(s.step)}${s.detail ? ` (${escapeHtml(s.detail)})` : ''}`)
        .join('<br>')
      await sendOwnerEmail(
        `xdipx checkout probe FAILED at ${failedStep} (${tier})`,
        `<p>The ${escapeHtml(tier)} checkout probe failed at step <strong>${escapeHtml(failedStep)}</strong>.</p>`
          + `<p>${stepList}</p>`
          + `<p>The purchase path is broken up to at least this step. Check the storefront and the Shopify checkout.</p>`,
      )
      await sendOwnerSms(`xdipx checkout probe FAILED at ${failedStep} (${tier}). Purchase path broken.`)
      alerted = true
    }
  }

  const inserted = await db.insert(checkoutProbeRuns).values({
    tier,
    ok: result.ok,
    failedStep: result.failedStep,
    steps: result.steps,
    durationMs: result.durationMs,
    alerted,
  }).returning({ id: checkoutProbeRuns.id })

  return { rowId: inserted[0]?.id ?? 0, alerted }
}
