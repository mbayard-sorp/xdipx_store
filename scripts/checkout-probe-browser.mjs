/**
 * Browser-tier synthetic checkout probe (runs in GitHub Actions, not on Vercel).
 *
 * Walks the real purchase UI with Playwright: homepage, PDP, pick a variant,
 * add to cart, age confirm if shown, checkout button, arrival at the Shopify
 * hosted checkout with a contact/email field, and then — added in Stage G5 —
 * that there is a non-zero amount on that checkout page, which is what proves
 * the CART reached it rather than just that a checkout page rendered. Builds a
 * ProbeResult and POSTs it to /cron/checkout-probe-report, which records it and
 * alerts on failure through the same path as the server-side HTTP tier.
 *
 * Each step is isolated: a failure records a failed step and stops, so a broken
 * selector reports a diagnosable result rather than crashing the job. Analytics
 * requests are blocked so the probe never pollutes GA4 / Meta data.
 *
 * Env: BASE_URL, CRON_SECRET (required), PROBE_PRODUCT_HANDLE (optional),
 * PLAYWRIGHT_MODULE (absolute path to the isolated playwright install).
 */
import { pathToFileURL } from 'node:url'

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

/**
 * Playwright ships CommonJS. When PLAYWRIGHT_MODULE points at an absolute path
 * (which it does in CI, so the isolated install never touches the repo's
 * lockfile), `await import(path)` hands back a namespace whose named exports
 * come from cjs-module-lexer, and the lexer cannot see through playwright's
 * `module.exports = {...}`. `chromium` lands on `.default`, not on the
 * namespace, so destructuring it yields undefined and the very next line throws
 * "Cannot read properties of undefined (reading 'launch')".
 *
 * That is what the browser tier reported as `probe-crash` every day from
 * 2026-07-25 to 2026-07-30 while the HTTP tier stayed green, so the deepest
 * check of the money path was dark for six days and said so only in a message
 * nobody could act on. Read both shapes, and if neither is there, say which
 * module failed instead of dereferencing undefined.
 */
const pwNamespace = await import(PW.startsWith('/') ? pathToFileURL(PW).href : PW)
const chromium = pwNamespace.chromium ?? pwNamespace.default?.chromium
if (!chromium) {
  push('probe-crash', false, `playwright module at ${PW} exposed no chromium export`)
  await report({ ok: false, failedStep: 'probe-crash', steps, durationMs: Date.now() - started })
  process.exit(1)
}

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
      // Wait for hydration before touching anything. The add-to-cart control is
      // a React Router fetcher.Form: until the client bundle takes over, the
      // same click is a native form POST that navigates the browser to the raw
      // /api/cart JSON response. Clicking too early makes the probe measure the
      // unhydrated fallback rather than the path a shopper actually walks.
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      push('pdp', good, good ? pdpUrl : `HTTP ${res ? res.status() : 'none'}`)
      if (!good) throw new Error('stop')
    } catch (e) { if (e.message !== 'stop') push('pdp', false, e.message); ok = false }
  }

  // 3b. Pick a variant, when the product has options.
  //
  // A multi-variant PDP renders its add-to-cart button disabled and labelled
  // "Pick a size"/"Pick a volume" until an option is chosen, and the option
  // control is a 56px CircleOptionSelector that opens a listbox on click. A
  // probe that skips this step fails at add-to-cart on every multi-variant
  // product, which is a property of the probe and not of the store. Whether it
  // hit one was pure luck of which product was featured that day.
  //
  // Non-fatal: single-variant products expose no trigger and go straight
  // through, so absence is recorded as "single variant", not as a failure.
  if (ok) {
    try {
      // The option selectors are siblings of the cart form, not children of it:
      // the PDP renders them and the form side by side in one flex row. Scope to
      // that shared parent so we never pick up the navbar or chat triggers.
      const triggers = page.locator('form[action="/api/cart"]').first()
        .locator('xpath=..').locator('button[aria-expanded]')
      const count = await triggers.count()
      if (count === 0) {
        push('pick-variant', true, 'single variant')
      } else {
        let picked = 0
        for (let i = 0; i < count; i++) {
          const trigger = triggers.nth(i)
          const label = (await trigger.getAttribute('aria-label')) || `option ${i + 1}`
          await trigger.scrollIntoViewIfNeeded()
          await trigger.click({ timeout: 10000 })
          // The listbox animates in (AnimatePresence), so the options exist
          // before they are stable enough to click. Wait for the container
          // first, then for an enabled option.
          await page.locator('[role="listbox"]').first().waitFor({ timeout: 10000 })
          const option = page.locator('[role="option"]:not([disabled])').first()
          await option.waitFor({ state: 'visible', timeout: 10000 })
          await option.click()
          picked++
          await page.waitForTimeout(400)
          void label
        }
        push('pick-variant', picked === count, `${picked}/${count} option axes selected`)
        if (picked !== count) ok = false
      }
    } catch (e) { push('pick-variant', false, e.message); ok = false }
  }

  // 4. Add to cart.
  if (ok) {
    try {
      const addBtn = page.getByRole('button', { name: /add to cart|i'll take it|take it/i }).first()
      await addBtn.waitFor({ timeout: 15000 })
      await addBtn.click()
      // The add is a fetcher POST to /api/cart; the drawer opens only once it
      // resolves. Wait for the drawer rather than assuming the click alone
      // means the line landed in the cart.
      await page.locator('#cart-drawer').waitFor({ state: 'visible', timeout: 20000 })
      push('add-to-cart', true, 'cart drawer opened')
    } catch (e) { push('add-to-cart', false, e.message); ok = false }
  }

  // 5. Age confirm, if the click-through gate is shown (non-fatal if absent).
  //
  // The gate renders *inside* the cart drawer at add-to-cart time, in front of
  // the checkout link, so this step is on the critical path and not the
  // afterthought its position suggests. The live button reads "Yes, let me in ♥",
  // which the previous pattern (/enter ♥|enter|18 or older|yes.*18/) did not
  // match: "18" appears in the drawer's question text, never in the button's
  // accessible name. Match the label that ships.
  if (ok) {
    try {
      const confirm = page.getByRole('button', { name: /let me in|enter ♥|18 or older|yes.*18/i }).first()
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
      // Shopify's hosted checkout renders its contact fields client-side and is
      // materially slower than any page we serve. Let it settle before step 7
      // asserts, so a slow checkout reads as slow rather than as missing.
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})
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
  // 8. Confirm there is money on the checkout page (Stage G5).
  //
  // Step 7 proves a checkout page rendered. It does not prove the CART reached
  // it, and those are different failures: a checkout showing an email field over
  // an empty basket, or a $0.00 total, is a broken money path that every
  // assertion above passes cleanly. This is the gap the audit meant by "the
  // browser tier stops at the checkout page", and it is the last assertion
  // before a real card would be needed.
  //
  // Deliberately markup-agnostic. Shopify's checkout DOM varies by theme and
  // changes without notice, so this reads text rather than selectors, and takes
  // the LARGEST amount on the page: a collapsed mobile order summary (this
  // context is 390px wide) puts the total in the disclosure header, and any
  // stray $0.00 elsewhere cannot drag the maximum down. `textContent` rather
  // than `innerText` on purpose — if the figure is in the DOM at all we want to
  // see it, even inside a collapsed region.
  if (ok) {
    try {
      const text = (await page.locator('body').textContent({ timeout: 15000 })) ?? ''
      const amounts = [...text.matchAll(/(?:\$|USD\s?)\s?(\d[\d,]*\.\d{2})/g)]
        .map(m => Number(m[1].replace(/,/g, '')))
        .filter(n => Number.isFinite(n))
      const max = amounts.length ? Math.max(...amounts) : 0
      const good = max > 0
      push(
        'checkout-total',
        good,
        good
          ? `largest amount $${max.toFixed(2)} of ${amounts.length} figures`
          : `no positive amount on the checkout page (${amounts.length} figures found) — the cart may not have carried through`,
      )
      if (!good) ok = false
    } catch (e) { push('checkout-total', false, e.message); ok = false }
  }

  // 9. Is a payment section present? Recorded, NOT fatal, and the split is
  // deliberate rather than timid.
  //
  // A checkout with no way to pay is a real money-path break, so this belongs
  // in the probe. But payment-provider markup is the most variable thing on the
  // page, this probe is one of only two signals allowed to page the owner by
  // SMS, and a false page at 07:30 costs more trust than a missed one costs
  // money — a genuinely dead payment section also shows up as a zero total in
  // step 8, which IS fatal. So it records for now and graduates to fatal once
  // it has a clean run history to justify the promotion.
  if (ok) {
    try {
      const text = (await page.locator('body').textContent({ timeout: 10000 })) ?? ''
      const seen = /payment|card number|credit card|pay with/i.test(text)
      push('checkout-payment', true, seen ? 'payment section present' : 'OBSERVED: no payment section text found (not failing the probe)')
    } catch (e) { push('checkout-payment', true, `skipped: ${e.message}`) }
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
