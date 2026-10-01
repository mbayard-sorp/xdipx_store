/**
 * Backfill order_attribution for orders placed before migration 111 shipped
 * (ticket #12669). Reads each order's customAttributes (note_attributes) and
 * referrerUrl via the Admin GraphQL API and writes one row per order, the
 * same shape handleOrderCreated now writes going forward.
 *
 *   DATABASE_URL=<prod> SHOPIFY_ADMIN_ACCESS_TOKEN=<token> \
 *     npx tsx scripts/backfill-order-attribution.ts 1002 1003 1004 1005 1006 1007 1008
 *
 * Order numbers, not ids — the script resolves each to its order id via the
 * Admin GraphQL API before reading attributes.
 */

import { adminGraphQL } from '../app/lib/shopify.server'
import { classifyChannelGroup } from '../server/webhooks'
import { db } from '../app/lib/db.server'
import { orderAttribution } from '../db/schema'

interface OrderNode {
  id: string
  totalPriceSet: { shopMoney: { amount: string } }
  customAttributes: { key: string; value: string }[]
  sourceName: string | null
  // Order has no referring_site/landing_site fields of its own over GraphQL
  // (those are REST-only, which is what the live webhook reads); the closest
  // GraphQL equivalent is the first session on customerJourneySummary, which
  // can be null (journey attribution not ready, or the order predates it).
  customerJourneySummary: { firstVisit: { referrerUrl: string | null; landingPage: string | null } | null } | null
}

async function resolveOrder(orderNumber: string): Promise<OrderNode | null> {
  const data = await adminGraphQL<{ orders: { nodes: OrderNode[] } }>(
    `query($q: String!) {
      orders(first: 1, query: $q) {
        nodes {
          id
          totalPriceSet { shopMoney { amount } }
          customAttributes { key value }
          sourceName
          customerJourneySummary {
            firstVisit { referrerUrl landingPage }
          }
        }
      }
    }`,
    { q: `name:#${orderNumber}` },
  )
  return data.orders.nodes[0] ?? null
}

async function main() {
  const orderNumbers = process.argv.slice(2)
  if (orderNumbers.length === 0) {
    console.error('Usage: npx tsx scripts/backfill-order-attribution.ts <order-number> [<order-number> ...]')
    process.exit(1)
  }

  let written = 0
  for (const orderNumber of orderNumbers) {
    const order = await resolveOrder(orderNumber).catch(err => {
      console.error(`[backfill-order-attribution] #${orderNumber}: lookup failed`, err)
      return null
    })
    if (!order) {
      console.warn(`[backfill-order-attribution] #${orderNumber}: not found, skipping`)
      continue
    }

    const attrOf = (key: string): string | undefined =>
      order.customAttributes.find(a => a.key === key)?.value
    const shopifyOrderId = order.id.replace('gid://shopify/Order/', '')
    const utmSource = attrOf('_utm_source') ?? null
    const referringSite = order.customerJourneySummary?.firstVisit?.referrerUrl ?? null
    const landingSite = order.customerJourneySummary?.firstVisit?.landingPage ?? null
    const channelGroup = classifyChannelGroup({
      utmSource,
      referringSite,
      sourceName: order.sourceName,
    })

    await db.insert(orderAttribution).values({
      shopifyOrderId,
      utmSource,
      utmMedium:      attrOf('_utm_medium') ?? null,
      utmCampaign:    attrOf('_utm_campaign') ?? null,
      utmContent:     attrOf('_utm_content') ?? null,
      refCode:        attrOf('_ref_code') ?? null,
      referringSite,
      landingSite,
      sourceName:     order.sourceName,
      channelGroup,
      totalPrice:     order.totalPriceSet.shopMoney.amount,
    }).onConflictDoNothing({ target: orderAttribution.shopifyOrderId })

    console.log(`[backfill-order-attribution] #${orderNumber} (${shopifyOrderId}): channel_group=${channelGroup}`)
    written++
  }

  console.log(`[backfill-order-attribution] done: ${written}/${orderNumbers.length} orders written`)
}

main().catch(err => {
  console.error('[backfill-order-attribution] fatal:', err)
  process.exit(1)
})
