/**
 * Browser-tier synthetic checkout probe (runs in GitHub Actions, not on Vercel).
 *
 * Walks the real purchase UI with Playwright: homepage, PDP, add to cart, age
 * confirm if shown, checkout button, arrival at the Shopify hosted checkout with
 * a contact/email field. Builds a ProbeResult and POSTs it to
 * /cron/checkout-probe-report, which records it and alerts on failure through
 * the same path as the server-side HTTP tier.
 *
 * Each step is isolated: a failure records a failed step and stops, so a broken
 * selector reports a diagnosable result rather than crashing the job. Analytics
 * requests are blocked so the probe never pollutes GA4 / Meta data.
 *
 * Env: BASE_URL, CRON_SECRET (required), PROBE_PRODUCT_HANDLE (optional),
 * PLAYWRIGHT_MODULE (absolute path to the isolated playwright install).
 */
const BASE = (process.env.BASE_URL || 'https://xdipx.com').replace(/\/+$/, '')
const SECRET = process.env.CRON_SECRET
const HANDLE = process.env.PROBE_PRODUCT_HANDLE || ''
const PW = process.env.PLAYWRIGHT_MODULE || 'playwright'

const steps = []
const started = Date.now()
function push(step, ok, detail) {
  steps.push({ step, ok, ms: Date.now() - started, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? ` (${detail})` : ''}`)
}

async function report(result) {
  if (!SECRET) { console.error('CRON_SECRET missing; cannot report'); return }
  try {
    const res = await fetch(`${BASE}/cron/checkout-probe-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(result),
    })
    console.log(`report -> HTTP ${res.status}`)
  } catch (err) {
    console.error('report POST failed:', err)
  }
}

const { chromium } = await import(PW)

let browser
let ok = true
try {
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  // Never let the probe touch analytics.
  await context.route(/googletagmanager\.com|google-analytics\.com|facebook\.(com|net)|connect\.facebook/, r => r.abort())
  const page = await context.newPage()

  // 1. Homepage.
  try {
    const res = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const good = !!res && res.status() === 200
    push('homepage', good, good ? undefined : `HTTP ${res ? res.status() : 'none'}`)
    if (!good) throw new Error('stop')
  } catch (e) { if (e.message !== 'stop') push('homepage', false, e.message); ok = false }

  // 2/3. Resolve + open a PDP.
  if (ok) {
    try {
      let pdpUrl = HANDLE ? `${BASE}/products/${HANDLE}` : null
      if (!pdpUrl) {
        const link = page.locator('a[href^="/products/"]').first()
        await link.waitFor({ timeout: 15000 })
        const href = await link.getAttribute('href')
        pdpUrl = href?.startsWith('http') ? href : `${BASE}${href}`
      }
      const res = await page.goto(pdpUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      const good = !!res && res.status() === 200
      push('pdp', good, good ? pdpUrl : `HTTP ${res ? res.status() : 'none'}`)
      if (!good) throw new Error('stop')
    } catch (e) { if (e.message !== 'stop') push('pdp', false, e.message); ok = false }
  }

  // 4. Add to cart.
  if (ok) {
    try {
      const addBtn = page.getByRole('button', { name: /add to cart|i'll take it|take it/i }).first()
      await addBtn.waitFor({ timeout: 15000 })
      await addBtn.click()
      push('add-to-cart', true)
    } catch (e) { push('add-to-cart', false, e.message); ok = false }
  }

  // 5. Age confirm, if the click-through gate is shown (non-fatal if absent).
  if (ok) {
    try {
      const confirm = page.getByRole('button', { name: /enter ♥|enter|18 or older|yes.*18/i }).first()
      if (await confirm.isVisible({ timeout: 4000 }).catch(() => false)) {
        await confirm.click()
        push('age-confirm', true, 'confirmed')
      } else {
        push('age-confirm', true, 'not shown')
      }
    } catch (e) { push('age-confirm', true, `skipped: ${e.message}`) }
  }

  // 6. Checkout button -> arrive at the Shopify hosted checkout.
  if (ok) {
    try {
      const checkout = page.getByRole('link', { name: /check ?out/i }).first()
      await checkout.waitFor({ timeout: 15000 })
      await Promise.all([
        page.waitForURL(/\/checkouts?\/|myshopify\.com|shopify/i, { timeout: 30000 }),
        checkout.click(),
      ])
      push('checkout-nav', true, page.url().split('?')[0])
    } catch (e) { push('checkout-nav', false, e.message); ok = false }
  }

  // 7. Confirm a real checkout page: a contact/email field is present.
  if (ok) {
    try {
      const field = page.locator('input[type="email"], input[name*="email" i], input[autocomplete="email"], #email').first()
      const visible = await field.isVisible({ timeout: 20000 }).catch(() => false)
      push('checkout-page', visible, visible ? undefined : 'no email/contact field found on checkout')
      if (!visible) ok = false
    } catch (e) { push('checkout-page', false, e.message); ok = false }
  }
} catch (err) {
  push('probe-crash', false, err instanceof Error ? err.message : String(err))
  ok = false
} finally {
  if (browser) await browser.close().catch(() => {})
}

const failed = steps.find(s => !s.ok)
const result = { ok: !failed, failedStep: failed ? failed.step : null, steps, durationMs: Date.now() - started }
await report(result)
process.exit(result.ok ? 0 : 1)
