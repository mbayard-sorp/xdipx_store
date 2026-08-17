/**
 * Backfill review invites for paid + fulfilled orders that predate the
 * ORDERS_FULFILLED webhook (registered 2026-08-05) or were dropped by the
 * old handler. Ticket #3443.
 *
 *   npx tsx scripts/backfill-review-invites.ts                          # dry run (default)
 *   npx tsx scripts/backfill-review-invites.ts --apply                  # write scheduled invites
 *   npx tsx scripts/backfill-review-invites.ts --emails-file emails.json --apply
 *   npx tsx scripts/backfill-review-invites.ts --order 1002 --apply
 *   npx tsx scripts/backfill-review-invites.ts --delay-days 3 --apply
 *
 * DRY-RUN BY DEFAULT, deliberately. Invites are inserted as status
 * 'scheduled'; the daily /cron/review-reminders job delivers them through the
 * existing Klaviyo "Review Invite Sent" event, where Klaviyo's own
 * suppression/consent handling applies. There is no explicit marketing-consent
 * check in that path, so nothing sends until an operator has seen the plan and
 * passed --apply.
 *
 * PII reality on this store (verified 2026-08-16): the Basic plan refuses
 * customer PII on the Admin API — REST returns orders with email,
 * contact_email, and every customer name/email field nulled; GraphQL errors
 * with ACCESS_DENIED ("only available on Shopify, Advanced, and Plus plans").
 * So this script cannot read customer emails from Shopify. The owner CAN see
 * them in the Shopify admin UI, so the email source is an operator-supplied
 * mapping file (--emails-file), JSON keyed by order number:
 *
 *   { "1002": { "email": "customer@example.com", "name": "First L." } }
 *
 * If a future plan upgrade unredacts the API, the payload fields are used
 * automatically and the mapping file becomes optional.
 *
 * Idempotent: (order, product) pairs that already have a review_invites row
 * are skipped, and duplicate products within an order collapse to one invite.
 */
import './_load-env'
import { readFileSync } from 'node:fs'

interface Args {
  apply: boolean
  emailsFile: string | null
  order: string | null
  delayDays: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    apply:      argv.includes('--apply'),
    emailsFile: value('--emails-file') ?? null,
    order:      value('--order') ?? null,
    // 0 by default: these orders were fulfilled long ago, the "wait a few days
    // after delivery" purpose of invite_delay_days has already been served.
    delayDays:  parseInt(value('--delay-days') ?? '0', 10),
  }
}

interface RestLineItem {
  product_id?: number | null
  sku?: string | null
  title?: string
}

interface RestOrder {
  id: number
  order_number: number
  created_at?: string
  financial_status?: string
  fulfillment_status?: string | null
  email?: string | null
  contact_email?: string | null
  customer?: { id?: number; email?: string | null; first_name?: string | null; last_name?: string | null } | null
  line_items?: RestLineItem[]
}

type EmailMap = Record<string, { email: string; name?: string }>

function loadEmailMap(path: string | null): EmailMap {
  if (!path) return {}
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as EmailMap
  for (const [orderNumber, entry] of Object.entries(parsed)) {
    if (!entry?.email || !entry.email.includes('@')) {
      throw new Error(`--emails-file entry for order ${orderNumber} has no valid email`)
    }
  }
  return parsed
}

async function main(): Promise<void> {
  const args = parseArgs()
  const emailMap = loadEmailMap(args.emailsFile)

  const { shopifyAdmin } = await import('../app/lib/shopify.server')
  const { createInvite, getInvitedProductIdsForOrder } = await import('../app/lib/reviews.server')

  // fields= keeps the response lean; PII fields are requested but arrive null
  // on the Basic plan (see header).
  const fields = 'id,order_number,created_at,email,contact_email,financial_status,fulfillment_status,customer,line_items'
  const { orders } = await shopifyAdmin<{ orders: RestOrder[] }>(
    `/orders.json?status=any&limit=250&fields=${fields}`,
  )

  const eligible = orders.filter(o =>
    (o.financial_status === 'paid' || o.financial_status === 'partially_refunded') &&
    o.fulfillment_status === 'fulfilled' &&
    (!args.order || String(o.order_number) === args.order),
  )

  console.log(`${orders.length} order(s) total, ${eligible.length} paid+fulfilled${args.order ? ` matching #${args.order}` : ''}`)
  console.log(args.apply ? 'MODE: apply (writing scheduled invites)' : 'MODE: dry run (pass --apply to write)')

  const sendAfter = new Date(Date.now() + args.delayDays * 24 * 60 * 60 * 1000)
  let planned = 0
  let skippedExisting = 0
  let blockedNoEmail = 0

  for (const order of eligible) {
    const mapped = emailMap[String(order.order_number)]
    const email = order.email || order.contact_email || order.customer?.email || mapped?.email || null
    const name =
      [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') ||
      mapped?.name || 'Customer'

    const header = `order ${order.id} (#${order.order_number}, ${order.created_at ?? 'unknown date'})`
    if (!email) {
      blockedNoEmail++
      console.log(`  BLOCKED ${header}: no email (PII redacted on the Basic plan and no --emails-file entry for "${order.order_number}")`)
      continue
    }

    const alreadyInvited = await getInvitedProductIdsForOrder(String(order.id))
    const seen = new Set<string>()

    for (const li of order.line_items ?? []) {
      if (!li.product_id) continue
      const gid = `gid://shopify/Product/${li.product_id}`
      if (seen.has(gid)) continue
      seen.add(gid)

      if (alreadyInvited.has(gid)) {
        skippedExisting++
        console.log(`  SKIP    ${header}: invite already exists for ${gid} (${li.title ?? li.sku})`)
        continue
      }

      planned++
      console.log(`  ${args.apply ? 'CREATE' : 'PLAN'}  ${header}: ${gid} (${li.title ?? li.sku}) -> ${email}, send after ${sendAfter.toISOString()}`)

      if (args.apply) {
        await createInvite({
          shopifyOrderId:    String(order.id),
          shopifyCustomerId: order.customer?.id ? String(order.customer.id) : undefined,
          shopifyProductId:  gid,
          reviewerEmail:     email,
          reviewerName:      name,
          sendAfter,
        })
      }
    }
  }

  console.log(`\n${args.apply ? 'Created' : 'Would create'}: ${planned} invite(s); already invited: ${skippedExisting}; blocked (no email): ${blockedNoEmail}`)
  if (planned > 0 && args.apply) {
    console.log('Scheduled invites are delivered by the daily /cron/review-reminders run once send_after passes.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
