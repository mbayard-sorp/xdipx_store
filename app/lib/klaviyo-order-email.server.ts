/**
 * Resolves a fulfilled order's buyer email and line items from Klaviyo's own
 * "Fulfilled Order" Shopify-integration event (ticket #19525). Klaviyo's
 * Shopify integration receives the full order object server-to-server, so
 * its mirrored event still carries the email and line items this store's
 * own Basic-plan Admin API token cannot see once Shopify redacts them
 * (`handleOrderFulfilled`, server/webhooks.ts — the `no_email_pii_redacted`
 * outcome this module is the fallback for).
 *
 * The metric id is looked up by name on every call rather than hardcoded:
 * confirmed live against this account 2026-11-02 that "Fulfilled Order" is
 * `WMB9hY` today, but a metric id is account-specific and not something to
 * ship as a constant.
 *
 * Caveat, stated plainly: the exact shape of a "Fulfilled Order" event's
 * `event_properties` (the order-id field, the line-items array) could not
 * be verified against a real event from this session — reading one would
 * mean pulling a live customer email and order contents into this
 * transcript, which this session's own PII-handling policy blocks, and
 * correctly so. The field paths below (`id` for the order id, `line_items[]
 * .sku` / `.product_id`) are the ones ticket #19525 specifies, which its
 * filer evidently read off a real event in their own session (the ticket
 * notes hitting Klaviyo's 429 rate limit while doing so). Every read here
 * is defensive — a field that isn't where expected resolves to `null`/empty
 * rather than throwing or fabricating a value, so a wrong guess about the
 * shape fails *safe* (reported as "no match found", never a wrong invite)
 * rather than *unsafe*. Confirm against one real log row before relying on
 * this in production.
 */

const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
const KLAVIYO_REVISION = '2024-10-15'

interface KlaviyoMetricsPage {
  data?: { id: string; attributes?: { name?: string } }[]
  links?: { next?: string | null }
}

interface KlaviyoEventsPage {
  data?: {
    id: string
    attributes?: { event_properties?: Record<string, unknown> }
    relationships?: { profile?: { data?: { id: string } | null } }
  }[]
  included?: {
    type: string
    id: string
    attributes?: { email?: string | null; first_name?: string | null; last_name?: string | null }
  }[]
  links?: { next?: string | null }
}

/**
 * GET with Klaviyo auth, retrying a 429 with exponential backoff (honoring
 * `Retry-After` when present). Never retries any other status.
 */
async function klaviyoGet<T>(path: string, maxRetries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${KLAVIYO_BASE}${path}`, {
      headers: {
        accept: 'application/json',
        revision: KLAVIYO_REVISION,
        Authorization: `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
      },
    })
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfterHeader = Number(res.headers.get('retry-after'))
      const waitSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 2 ** attempt
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
      continue
    }
    if (!res.ok) {
      throw new Error(`Klaviyo API GET ${path} ${res.status}: ${await res.text()}`)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
  }
}

function stripBase(url: string | null | undefined): string | null {
  if (!url) return null
  return url.startsWith(KLAVIYO_BASE) ? url.slice(KLAVIYO_BASE.length) : url
}

/** Metric id by exact name, paginated (the Metrics API has no name filter). */
export async function getMetricIdByName(name: string): Promise<string | null> {
  let path: string | null = '/metrics/'
  while (path) {
    const page = await klaviyoGet<KlaviyoMetricsPage>(path)
    const match = (page.data ?? []).find((m) => m.attributes?.name === name)
    if (match) return match.id
    path = stripBase(page.links?.next)
  }
  return null
}

export interface FulfilledOrderLineItem {
  sku: string | null
  productId: string | null
}

export interface FulfilledOrderMatch {
  email: string | null
  reviewerName: string | null
  lineItems: FulfilledOrderLineItem[]
}

function extractLineItems(eventProperties: Record<string, unknown>): FulfilledOrderLineItem[] {
  const raw = eventProperties['line_items']
  if (!Array.isArray(raw)) return []
  return raw.flatMap((li): FulfilledOrderLineItem[] => {
    if (!li || typeof li !== 'object') return []
    const rec = li as Record<string, unknown>
    const sku = typeof rec['sku'] === 'string' ? rec['sku'] : null
    const productId = rec['product_id'] != null ? String(rec['product_id']) : null
    if (!sku && !productId) return []
    return [{ sku, productId }]
  })
}

/**
 * Find the "Fulfilled Order" event matching `shopifyOrderId` within the last
 * `sinceDays` days, and return the Klaviyo profile's email plus the order's
 * line items from the event payload. `null` means no matching event was
 * found yet (the Klaviyo-Shopify sync can lag the webhook by minutes to
 * hours) — a miss, not an error, and the caller's retry-for-N-days loop is
 * exactly for this case.
 */
export async function resolveFulfilledOrderEmail(
  shopifyOrderId: string,
  opts: { sinceDays?: number } = {},
): Promise<FulfilledOrderMatch | null> {
  const metricId = await getMetricIdByName('Fulfilled Order')
  if (!metricId) return null

  const since = new Date(Date.now() - (opts.sinceDays ?? 14) * 24 * 60 * 60 * 1000).toISOString()
  const filter = `and(equals(metric_id,"${metricId}"),greater-or-equal(datetime,${since}))`
  let path: string | null =
    `/events/?filter=${encodeURIComponent(filter)}&include=profile&sort=-datetime&page[size]=100`

  while (path) {
    const page = await klaviyoGet<KlaviyoEventsPage>(path)

    for (const event of page.data ?? []) {
      const props = event.attributes?.event_properties ?? {}
      const eventOrderId = props['id'] != null ? String(props['id']) : null
      if (eventOrderId !== shopifyOrderId) continue

      const profileId = event.relationships?.profile?.data?.id ?? null
      const profile = profileId
        ? (page.included ?? []).find((inc) => inc.type === 'profile' && inc.id === profileId)
        : null
      const name = [profile?.attributes?.first_name, profile?.attributes?.last_name].filter(Boolean).join(' ')

      return {
        email: profile?.attributes?.email ?? null,
        reviewerName: name.trim().length > 0 ? name.trim() : null,
        lineItems: extractLineItems(props),
      }
    }

    path = stripBase(page.links?.next)
  }

  return null
}
