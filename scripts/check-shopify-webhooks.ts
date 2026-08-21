/**
 * check-shopify-webhooks.ts: the ONE correct way to ask whether this store's
 * Shopify webhooks are registered.
 *
 * WHY THIS SCRIPT EXISTS. On 2026-08-21 a P1 owner blocker was filed reading
 * "CONFIRMED: zero Shopify webhooks registered in production", independently
 * repeated by R-DEV and by QA. It was wrong. All six subscriptions existed and
 * had since 2026-04-18 / 07-31 / 08-05.
 *
 * The trap: **Shopify scopes `webhookSubscriptions` to the app making the
 * query.** An app can only ever see its OWN subscriptions. The zero-result came
 * from asking through a different app (an MCP connector) than the one that owns
 * them. Nothing was broken; the instrument was pointed at the wrong shop-app.
 *
 * Why it mattered: the blocker's remedy was "register them via the Admin UI".
 * The UI issues a DIFFERENT HMAC secret than `verifyShopifyWebhook` checks
 * against (`server/webhooks.ts`), so acting on it would have added six
 * subscriptions whose every delivery 401s, while the working ones kept running.
 * A non-problem would have become a real and very hard to diagnose outage.
 *
 * So: always query with `SHOPIFY_ADMIN_ACCESS_TOKEN`, the custom-app token
 * paired with `SHOPIFY_WEBHOOK_SECRET`. Never with a connector, never from the
 * Admin UI, and never conclude "not registered" from an empty list returned by
 * anything else.
 *
 *   SHOPIFY_STORE_DOMAIN=... SHOPIFY_ADMIN_ACCESS_TOKEN=... \
 *     npx tsx scripts/check-shopify-webhooks.ts [--json]
 *
 * Exit 0 = every expected topic is registered. Exit 1 = something is missing or
 * pointed at the wrong URL. Exit 2 = could not tell (missing credentials), which
 * is deliberately NOT the same as "not registered".
 */

/** Topic -> the route in `server/webhooks.ts` that must receive it. */
export const EXPECTED_WEBHOOKS: ReadonlyArray<readonly [string, string]> = [
  ['ORDERS_CREATE', '/webhooks/order-created'],
  ['ORDERS_FULFILLED', '/webhooks/order-fulfilled'],
  ['PRODUCTS_CREATE', '/webhooks/product-created'],
  ['PRODUCTS_UPDATE', '/webhooks/product-updated'],
  ['INVENTORY_LEVELS_UPDATE', '/webhooks/inventory-update'],
  ['RETURNS_UPDATE', '/webhooks/returns-update'],
]

async function main(): Promise<void> {
  const domain = (process.env['SHOPIFY_STORE_DOMAIN'] ?? '').trim().replace(/\\n$/, '')
  const token = (process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? '').trim()
  const asJson = process.argv.includes('--json')

  if (!domain || !token) {
    console.error(
      'Cannot tell: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN are both required. ' +
        'An empty result from any other credential proves nothing, because Shopify scopes ' +
        'webhookSubscriptions to the querying app.',
    )
    process.exit(2)
  }

  const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ webhookSubscriptions(first: 100) { nodes { id topic createdAt
                 endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
    }),
  })
  if (!res.ok) {
    console.error(`Cannot tell: Admin API returned ${res.status}.`)
    process.exit(2)
  }
  const body = (await res.json()) as {
    data?: { webhookSubscriptions?: { nodes?: Array<Record<string, any>> } }
    errors?: unknown
  }
  if (body.errors || !body.data?.webhookSubscriptions?.nodes) {
    console.error(`Cannot tell: ${JSON.stringify(body.errors ?? 'malformed response')}`)
    process.exit(2)
  }

  const live = body.data.webhookSubscriptions.nodes.map(n => ({
    topic: String(n['topic']),
    url: String(n['endpoint']?.callbackUrl ?? ''),
    createdAt: String(n['createdAt'] ?? ''),
  }))

  const findings = EXPECTED_WEBHOOKS.map(([topic, path]) => {
    const hit = live.find(l => l.topic === topic)
    return {
      topic,
      path,
      registered: !!hit,
      urlOk: !!hit && hit.url.endsWith(path),
      url: hit?.url ?? null,
      createdAt: hit?.createdAt ?? null,
    }
  })
  const bad = findings.filter(f => !f.registered || !f.urlOk)

  if (asJson) {
    console.log(JSON.stringify({ shop: domain, total: live.length, findings, ok: bad.length === 0 }, null, 2))
  } else {
    console.log(`shop ${domain}: ${live.length} subscription(s) visible to THIS app\n`)
    for (const f of findings) {
      const mark = !f.registered ? 'MISSING' : !f.urlOk ? 'WRONG URL' : 'ok'
      console.log(`  ${mark.padEnd(9)} ${f.topic.padEnd(24)} ${f.url ?? f.path}`)
    }
    if (bad.length) {
      console.log(
        '\nRegister missing topics with the Admin API (webhookSubscriptionCreate) using THIS ' +
          'same token. Do NOT use the Shopify Admin UI: it issues a different HMAC secret than ' +
          'server/webhooks.ts verifies against, so those deliveries would all 401.',
      )
    }
  }
  process.exit(bad.length === 0 ? 0 : 1)
}

await main()
