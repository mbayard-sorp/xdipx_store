/**
 * Should this request produce a Meta CAPI conversion event?
 *
 * Context for why this exists. A 2026-07-31 audit found roughly 36,000
 * ViewContent events in 28 days against a store doing single-digit daily human
 * sessions, including hourly spikes over 6,000. CAPI events fire from loaders,
 * and a loader runs for anything that requests the route: crawlers, scrapers,
 * uptime probes, and (the one nobody had named) link prefetches.
 *
 * That last one is the quiet majority. React Router's `prefetch="intent"` on
 * VaultCard, MegaMenu and MobileExploreMenu issues a real `.data` request on
 * hover, so one pass across a mega-menu fires several ViewContent events for
 * products the visitor never looked at.
 *
 * Bot signal poisons everything downstream: Event Match Quality is computed
 * against it, lookalike and retargeting audiences train on it, and any
 * conversion-optimized campaign would bid toward crawler behavior.
 *
 * Deliberately NOT using rejectIfBot() from botid.server: it returns a 403,
 * which in a product loader would de-index the page, it no-ops outside real
 * production so it cannot be tested on preview, and this repo already
 * documented it flagging real users at api.ask-emma.tsx.
 */
import { isCrawlerRequest } from './crawler-ua.server'
import { isLikelyBot } from './is-bot.server'

/**
 * True when the browser is speculatively fetching, not when a person navigated.
 *
 * Every engine labels these, just not the same way. Chrome ships `Sec-Purpose:
 * prefetch` (and `prefetch;prerender`), older Chrome sent `Purpose: prefetch`,
 * Firefox sends `X-Moz: prefetch`, and Safari sends `X-Purpose: preview` for
 * link previews.
 */
export function isPrefetchRequest(request: Request): boolean {
  const h = request.headers

  const secPurpose = h.get('sec-purpose')
  if (secPurpose && secPurpose.toLowerCase().includes('prefetch')) return true
  if (secPurpose && secPurpose.toLowerCase().includes('prerender')) return true

  const purpose = h.get('purpose')
  if (purpose && purpose.toLowerCase() === 'prefetch') return true

  const moz = h.get('x-moz')
  if (moz && moz.toLowerCase() === 'prefetch') return true

  const xPurpose = h.get('x-purpose')
  if (xPurpose && xPurpose.toLowerCase() === 'preview') return true

  return false
}

/**
 * Cookie the store's own synthetic traffic carries (the browser checkout probe
 * in scripts/checkout-probe-browser.mjs sets it before its first navigation).
 * The probe walked the whole purchase path once a day, and every walk landed in
 * the Meta dataset as one AddToCart, one InitiateCheckout and one PageView.
 */
export const SYNTHETIC_COOKIE = 'xdipx_synthetic'
/** Header form of the same marker, for server-side probes that use fetch. */
export const SYNTHETIC_HEADER = 'x-xdipx-synthetic'

/** True when the request says it is the store's own probe or healthcheck. */
export function isSyntheticRequest(request: Request): boolean {
  if (request.headers.get(SYNTHETIC_HEADER)) return true
  const cookie = request.headers.get('cookie') ?? ''
  return new RegExp(`(?:^|;\\s*)${SYNTHETIC_COOKIE}=1(?:;|$)`).test(cookie)
}

/**
 * Bare runtime HTTP clients. Node's built-in fetch sends `node` (undici) and
 * Bun sends `Bun/<version>`. The /cron/warm job fetches the live PDP with
 * Node's fetch every 15 minutes, and none of these strings carry a generic
 * crawler token, so isCrawlerRequest let them through.
 */
function isRuntimeClient(request: Request): boolean {
  const ua = (request.headers.get('user-agent') ?? '').trim().toLowerCase()
  return ua === 'node' || ua.startsWith('undici') || ua.startsWith('bun/') || ua.startsWith('deno/')
}

/**
 * True when a CAPI conversion event should be sent for this request.
 *
 * Suppressing an event here must also suppress its browser-pixel counterpart,
 * or the two sides stop sharing an event id and Meta counts one conversion
 * twice. The call sites do that by returning a null event id, which the client
 * effects already treat as "do not fire".
 */
export function isCapiEligible(request: Request): boolean {
  if (isSyntheticRequest(request)) return false
  if (isPrefetchRequest(request)) return false
  if (isRuntimeClient(request)) return false
  if (isCrawlerRequest(request)) return false
  if (isLikelyBot(request)) return false
  return true
}
