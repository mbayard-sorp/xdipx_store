// One-off: seed a sample sensation_dial on bloom-curve-g so the HOW IT FEELS
// block has something to render during manual PDP verification.
const domain = process.env['SHOPIFY_STORE_DOMAIN']
const token  = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']
const HANDLE = process.argv[2] ?? 'bloom-curve-g'

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

const { productByHandle } = await gql(
  `query($h: String!){ productByHandle(handle:$h){ id handle title } }`,
  { h: HANDLE },
)
if (!productByHandle) { console.error('product not found:', HANDLE); process.exit(1) }

const value = JSON.stringify({
  intensity: 4, quietness: 5, softness: 4, patternVariety: 3, buildup: 4, learningCurve: 2,
})

const data = await gql(
  `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ metafields{ id key } userErrors{ field message } } }`,
  { m: [{ ownerId: productByHandle.id, namespace: 'xdipx', key: 'sensation_dial', type: 'json', value }] },
)
const errs = data.metafieldsSet.userErrors
if (errs.length) { console.error(errs); process.exit(1) }
console.log('✓ seeded sensation_dial on', productByHandle.handle, '→', value)
