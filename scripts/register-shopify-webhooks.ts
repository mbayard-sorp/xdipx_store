/**
 * Register (and audit) the Shopify webhook subscriptions this store depends on.
 *
 * Why this exists: on 2026-08-21 a live Admin API check found ZERO webhook
 * subscriptions registered for ANY topic in production (webhookSubscriptions
 * returned an empty list). That means every handler in server/webhooks.ts —
 * orders/create (Purchase CAPI to Meta + the wholesale-cost metafield write),
 * inventory_levels/update (Klaviyo back-in-stock + the restock social trigger),
 * and the rest — has never once executed via webhook delivery. It is the same
 * quiet-failure shape documented for orders/create in
 * app/lib/purchase-capi.server.ts. Nothing in the repo registered these, so
 * they stayed dead silently. See owner blocker no-shopify-webhooks-registered
 * and improvement-bus tickets #4361 / #4594.
 *
 * The registration mutation itself is an owner action: creating a live
 * subscription starts real customer emails (Klaviyo) and ad-platform events
 * (Meta CAPI) firing, which is a spend/money decision per
 * docs/store-team/operating-system.md section 7. So this script is inert by
 * default: with no flag it only LISTS what is registered and reports what is
 * missing. It mutates production only when invoked with --apply.
 *
 * The route -> topic map (WEBHOOK_TOPICS) is the single source of truth for
 * which topics the server serves. scripts/register-shopify-webhooks.test.ts
 * asserts it never drifts from the routes createWebhookRoutes() actually
 * mounts, so a new webhook route can never ship without a registration entry.
 *
 * Usage:
 *   npx tsx scripts/register-shopify-webhooks.ts            # audit only, no writes
 *   npx tsx scripts/register-shopify-webhooks.ts --apply    # create missing subscriptions (OWNER)
 *
 * Env: SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN for live calls;
 *      BASE_URL for the callback host (defaults to https://xdipx.com).
 */

import './_load-env'
import { createWebhookRoutes } from '../server/webhooks'

/**
 * Route segment (under the /webhooks mount) -> Shopify REST webhook topic.
 * Every route createWebhookRoutes() mounts must appear here; the drift test
 * enforces the correspondence in both directions.
 */
export const WEBHOOK_TOPICS: Readonly<Record<string, string>> = {
  'order-created': 'orders/create',
  'order-fulfilled': 'orders/fulfilled',
  'product-created': 'products/create',
  'product-updated': 'products/update',
  'inventory-update': 'inventory_levels/update',
  'returns-update': 'returns/update',
}

/** The Express mount point for the webhook router (server/index.ts). */
export const WEBHOOK_MOUNT = '/webhooks'

interface RouteLayer {
  route?: { path: string; methods?: Record<string, boolean> }
}

/**
 * The POST route segments createWebhookRoutes() actually mounts, read from the
 * live router rather than a hand-kept list, so the drift check cannot be fooled
 * by a stale copy. Segments are returned without their leading slash, sorted.
 */
export function registeredWebhookRoutes(): string[] {
  const router = createWebhookRoutes() as unknown as { stack: RouteLayer[] }
  return router.stack
    .filter(layer => layer.route && layer.route.methods && layer.route.methods['post'])
    .map(layer => layer.route!.path.replace(/^\//, ''))
    .sort()
}

/**
 * Drift between WEBHOOK_TOPICS and the routes the server serves. Pure, so the
 * test can drive it with no credentials.
 *   unmappedRoutes: served by the router but absent from WEBHOOK_TOPICS
 *                   (a webhook that will never be registered).
 *   staleTopics:    present in WEBHOOK_TOPICS but no longer served
 *                   (a subscription that would point at a dead endpoint).
 */
export function webhookRegistrationDrift(): { unmappedRoutes: string[]; staleTopics: string[] } {
  const served = new Set(registeredWebhookRoutes())
  const mapped = new Set(Object.keys(WEBHOOK_TOPICS))
  return {
    unmappedRoutes: [...served].filter(route => !mapped.has(route)).sort(),
    staleTopics: [...mapped].filter(route => !served.has(route)).sort(),
  }
}

/** Full callback URL for a route segment, e.g. https://xdipx.com/webhooks/order-created. */
export function callbackUrl(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${WEBHOOK_MOUNT}/${route}`
}

interface ShopifyWebhook {
  id: number
  topic: string
  address: string
}

async function listWebhooks(): Promise<ShopifyWebhook[]> {
  const { shopifyAdmin } = await import('~/lib/shopify.server')
  const { webhooks } = await shopifyAdmin<{ webhooks: ShopifyWebhook[] }>('/webhooks.json?limit=250')
  return webhooks
}

async function createWebhook(topic: string, address: string): Promise<ShopifyWebhook> {
  const { shopifyAdmin } = await import('~/lib/shopify.server')
  const { webhook } = await shopifyAdmin<{ webhook: ShopifyWebhook }>('/webhooks.json', 'POST', {
    webhook: { topic, address, format: 'json' },
  })
  return webhook
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  const baseUrl = process.env['BASE_URL'] || 'https://xdipx.com'

  const drift = webhookRegistrationDrift()
  if (drift.unmappedRoutes.length || drift.staleTopics.length) {
    console.error('[register-webhooks] WEBHOOK_TOPICS is out of sync with the served routes:')
    if (drift.unmappedRoutes.length) console.error(`  served but unmapped: ${drift.unmappedRoutes.join(', ')}`)
    if (drift.staleTopics.length) console.error(`  mapped but not served: ${drift.staleTopics.join(', ')}`)
    return 1
  }

  if (!process.env['SHOPIFY_STORE_DOMAIN'] || !process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']) {
    console.log('[register-webhooks] SHOPIFY credentials absent: cannot audit or register. Set SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_ACCESS_TOKEN.')
    return 0
  }

  const existing = await listWebhooks()
  const existingByTopic = new Map(existing.map(w => [w.topic, w]))
  console.log(`[register-webhooks] ${existing.length} subscription(s) currently registered.`)

  const desired = Object.entries(WEBHOOK_TOPICS).map(([route, topic]) => ({
    route,
    topic,
    address: callbackUrl(baseUrl, route),
  }))

  const missing = desired.filter(d => {
    const current = existingByTopic.get(d.topic)
    return !current || current.address !== d.address
  })

  if (missing.length === 0) {
    console.log('[register-webhooks] All expected topics are registered at the expected address. Nothing to do.')
    return 0
  }

  console.log(`[register-webhooks] ${missing.length} topic(s) missing or pointing at the wrong address:`)
  for (const m of missing) console.log(`  - ${m.topic} -> ${m.address}`)

  if (!apply) {
    console.log('[register-webhooks] DRY RUN. Re-run with --apply to create these subscriptions (owner action: this starts live customer sends and ad events firing).')
    return 0
  }

  let created = 0
  for (const m of missing) {
    try {
      const w = await createWebhook(m.topic, m.address)
      console.log(`[register-webhooks] created ${m.topic} (id ${w.id}) -> ${w.address}`)
      created++
    } catch (err) {
      console.error(`[register-webhooks] FAILED to create ${m.topic}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`[register-webhooks] created ${created}/${missing.length} subscription(s). Confirm with a fresh listing.`)
  return created === missing.length ? 0 : 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().then(
    code => process.exit(code),
    err => { console.error('[register-webhooks] failed:', err); process.exit(1) },
  )
}
