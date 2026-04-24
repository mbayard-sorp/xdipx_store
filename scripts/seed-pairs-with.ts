// One-off: seed Emma-voice pairing_why + accessory_product_ids on a product so
// the PDP "Pairs with" rail has something to render during manual verification.
const domain = process.env['SHOPIFY_STORE_DOMAIN']
const token  = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']

const PRODUCT_GID = process.argv[2] ?? 'gid://shopify/Product/8741193187499'

const PAIRS: Array<{ gid: string; why: string }> = [
  {
    gid: 'gid://shopify/Product/8707223912619',
    why: "A little slick goes a long way — this one stays put without getting tacky.",
  },
  {
    gid: 'gid://shopify/Product/8707224076459',
    why: "I use this on every toy I own. Foam on, wipe off, back in the drawer.",
  },
  {
    gid: 'gid://shopify/Product/8717914112171',
    why: "For when you want the curve + a buzzy bullet for outside play — tiny but loud.",
  },
]

async function gql(query: string, variables?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token! },
    body: JSON.stringify({ query, variables }),
  })
  const json: any = await res.json()
  if (!res.ok || json.errors) { console.error(json); process.exit(1) }
  return json.data
}

const accessoryIds = PAIRS.map(p => p.gid)
const pairingWhy   = Object.fromEntries(PAIRS.map(p => [p.gid, p.why]))

const data = await gql(
  `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ metafields{ id key } userErrors{ field message } } }`,
  {
    m: [
      { ownerId: PRODUCT_GID, namespace: 'xdipx', key: 'accessory_product_ids', type: 'json', value: JSON.stringify(accessoryIds) },
      { ownerId: PRODUCT_GID, namespace: 'xdipx', key: 'pairing_why',           type: 'json', value: JSON.stringify(pairingWhy)   },
    ],
  },
)
const errs = data.metafieldsSet.userErrors
if (errs.length) { console.error(errs); process.exit(1) }
console.log('✓ seeded pairs on', PRODUCT_GID)
for (const p of PAIRS) console.log('  -', p.gid.split('/').pop(), '→', p.why)
