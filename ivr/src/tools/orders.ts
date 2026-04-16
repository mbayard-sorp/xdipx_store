/**
 * lookupOrder — Shopify Admin GraphQL order lookup by order name + zip last-4.
 *
 * Verification: caller says an order number (e.g. "1234") and the last four
 * digits of their billing zip. We match on both; without the zip match we
 * return `verification_failed` rather than leak order status to a caller who
 * doesn't know the zip.
 */
const DOMAIN = process.env['SHOPIFY_STORE_DOMAIN'] ?? ''
const TOKEN = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? ''
const ENDPOINT = `https://${DOMAIN}/admin/api/2024-10/graphql.json`

export interface LookupOrderInput {
  orderNumber: string
  zipLast4: string
}

export type LookupOrderResult =
  | {
      ok: true
      status: string // FULFILLED, UNFULFILLED, PARTIALLY_FULFILLED, RESTOCKED
      financialStatus: string
      tracking: string | null
      carrier: string | null
      eta: string | null // raw Shopify estimatedDeliveryAt when present
    }
  | { ok: false; error: 'not_found' | 'verification_failed' | 'lookup_failed'; message?: string }

interface AdminOrder {
  id: string
  name: string
  displayFulfillmentStatus: string
  displayFinancialStatus: string
  billingAddress: { zip: string | null } | null
  fulfillments: {
    trackingInfo: { number: string | null; company: string | null }[]
    estimatedDeliveryAt: string | null
  }[]
}

async function adminQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!DOMAIN || !TOKEN) throw new Error('Shopify Admin credentials missing')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify Admin ${res.status}`)
  const body = (await res.json()) as { data?: T; errors?: unknown }
  if (!body.data) throw new Error(`Shopify Admin error: ${JSON.stringify(body.errors)}`)
  return body.data
}

function normaliseOrderNumber(raw: string): string {
  // Strip everything except digits so "number one two three four", "#1234",
  // or "1,234" all become "1234".
  return raw.replace(/\D+/g, '')
}

export async function lookupOrder(input: LookupOrderInput): Promise<LookupOrderResult> {
  const number = normaliseOrderNumber(input.orderNumber)
  const zip = input.zipLast4.replace(/\D+/g, '').slice(-4)
  if (!number) return { ok: false, error: 'not_found', message: 'Empty order number.' }
  if (zip.length !== 4) return { ok: false, error: 'verification_failed', message: 'Need 4 digits of zip.' }

  try {
    const data = await adminQuery<{ orders: { edges: { node: AdminOrder }[] } }>(
      `query LookupOrder($q: String!) {
        orders(first: 1, query: $q) {
          edges { node {
            id
            name
            displayFulfillmentStatus
            displayFinancialStatus
            billingAddress { zip }
            fulfillments(first: 5) {
              trackingInfo { number company }
              estimatedDeliveryAt
            }
          } }
        }
      }`,
      { q: `name:#${number}` },
    )

    const order = data.orders.edges[0]?.node
    if (!order) return { ok: false, error: 'not_found' }

    const billingZip = (order.billingAddress?.zip ?? '').replace(/\D+/g, '').slice(-4)
    if (!billingZip || billingZip !== zip) {
      return { ok: false, error: 'verification_failed' }
    }

    const fulfill = order.fulfillments[0]
    const track = fulfill?.trackingInfo[0]
    return {
      ok: true,
      status: order.displayFulfillmentStatus,
      financialStatus: order.displayFinancialStatus,
      tracking: track?.number ?? null,
      carrier: track?.company ?? null,
      eta: fulfill?.estimatedDeliveryAt ?? null,
    }
  } catch (err) {
    return {
      ok: false,
      error: 'lookup_failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
