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
      headers: { 'user-agent': 'xdipx-checkout-probe' },
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

  // 5. Shopify hosted checkout page loads (up to the payment page; we do not pay).
  t = Date.now()
  if (!record('checkout-page', await checkUrl(checkoutUrl, { markers: ['shopify'], minBytes: 500 }), t)) return finish()

  // 6. The checkout-extras content page is healthy.
  t = Date.now()
  record('checkout-extras', await checkUrl(`${base}/checkout-extras`), t)

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
