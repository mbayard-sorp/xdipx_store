/**
 * Order lookup for chat — Shopify Admin GraphQL by order name + zip last-4.
 * Mirrors the IVR implementation (ivr/src/tools/orders.ts) but runs in the
 * web app. Shared verification: we match order number AND zip; without both
 * we return verification_failed rather than leak order status.
 */
const DOMAIN = process.env['SHOPIFY_STORE_DOMAIN'] ?? ''
const TOKEN = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? ''
const ENDPOINT = `https://${DOMAIN}/admin/api/2024-10/graphql.json`

export type LookupOrderResult =
  | {
      ok: true
      status: string
      financialStatus: string
      tracking: string | null
      carrier: string | null
      eta: string | null
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

export async function lookupOrderForChat(
  orderNumber: string,
  zipLast4: string,
): Promise<LookupOrderResult> {
  const number = orderNumber.replace(/\D+/g, '')
  const zip = zipLast4.replace(/\D+/g, '').slice(-4)
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
