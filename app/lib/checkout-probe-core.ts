/**
 * The checkout probe's decision rule, with nothing else in it.
 *
 * Split out of `checkout-probe.server.ts` for one reason: that module imports
 * Sentry, Neon, KV and the Shopify client, so a test of the pure rule could not
 * load it. This is the only signal in the estate permitted to page the owner by
 * SMS, and its decision rule should be testable without a network, a database
 * or an OpenTelemetry runtime.
 *
 * Same `checkout-probe*` protected glob as its parent, deliberately: the rule is
 * the money-path judgement, not an implementation detail of it.
 */

export interface FetchCheck {
  status: number
  ok: boolean
  detail?: string
  /** Response body when one was read. Callers that need to inspect the HTML
   *  (the daily SEO tripwire checks canonical + robots directives) read this
   *  instead of re-fetching the page. */
  body?: string
}

/**
 * Statuses a bot wall legitimately returns on a real, healthy checkout.
 *
 * Cloudflare answers a headless agent with 403 regardless of UA; 401 and 429 are
 * the other two shapes the same protection takes. Measured over 14 days, every
 * single `checkout-page` step recorded exactly 403, so in practice this tier
 * asserts routing, and the browser tier asserts the render.
 */
const BOT_WALL_STATUSES = new Set([401, 403, 429])

/**
 * Decide what a checkout-page response means. Pure, so it can be tested without
 * a network — this is the only signal in the estate permitted to page the owner
 * by SMS, and its decision rule should not live only inside a fetch.
 *
 * Failure modes this must separate:
 *   - dead domain (the bug we hit): the URL returns a hard 404.
 *   - checkout bounced away (password-protected store / misconfig): the chain
 *     redirects to the store root and never reaches a /checkouts/ path.
 *   - **checkout is up but erroring** (Stage G5, the gap this closes): the chain
 *     reaches /checkouts/ and Shopify answers 500, 502 or 503. The previous rule
 *     was "anything that is not a 404 is fine", so a checkout outage read as
 *     healthy and this probe would have printed GOOD through it.
 *   - healthy: the chain (through Shop Pay) lands on /checkouts/cn/... behind
 *     the bot wall, or renders outright.
 *
 * A status that is neither 2xx, nor a known bot wall, nor an understood failure
 * now fails rather than passing by default. "Not recognised" must not mean
 * "fine" on the money path.
 */
export function classifyCheckoutStatus(input: {
  status: number
  finalUrl: string
  body: string
  detail?: string | undefined
}): FetchCheck {
  const { status, finalUrl, body } = input
  const path = finalUrl.split('?')[0]

  if (status === 0) return { status: 0, ok: false, detail: input.detail ?? 'no response' }
  if (status === 404) return { status: 404, ok: false, detail: `404 at ${path} (checkout URL dead)` }

  if (!/\/checkouts?\//i.test(finalUrl)) {
    return { status, ok: false, detail: `checkout did not route to a Shopify checkout page (landed ${path}, status ${status})` }
  }

  // On a checkout URL, and Shopify is failing on it. Previously accepted.
  if (status >= 500) {
    return { status, ok: false, detail: `checkout endpoint returned ${status} at ${path} (Shopify checkout is erroring, not bot-walled)` }
  }

  if (status === 200) {
    const rendered = /order summary|payment|contact information/i.test(body)
    return rendered
      ? { status, ok: true }
      : { status, ok: true, detail: 'reached checkout endpoint (200 without render markers; full render verified by browser tier)' }
  }

  if (BOT_WALL_STATUSES.has(status)) {
    return { status, ok: true, detail: `reached checkout endpoint (status ${status}, bot wall; full render verified by browser tier)` }
  }

  // 4xx that is not the bot wall (410 gone, 451, a redirect loop landing on an
  // error page) and 3xx that never resolved. Unrecognised, so it fails.
  return { status, ok: false, detail: `unexpected status ${status} at ${path} (not a 200, not a known bot wall)` }
}
